import { WorkOrderStatus } from '@factory-vision/domain-types';

/**
 * The Work Order lifecycle as an explicit transition table (MES-015, §11).
 *
 * ```text
 * DRAFT ──► SCHEDULED ──► CONFIRMED ──► IN_PRODUCTION ──► COMPLETED
 *   │           │             │               │
 *   └───────────┴─────────────┴───────────────┴──► CANCELLED
 * ```
 *
 * Three things this file exists to make impossible:
 *
 * - **`RELEASED`, `IN_PROGRESS` and `PAUSED` do not exist** (ADR-18). `CONFIRMED`
 *   replaced `RELEASED` and there is no `/release` endpoint.
 * - **Production stopping does not move the Work Order.** A stoppage is a
 *   `downtime_record` plus a machine state change; the WO stays `IN_PRODUCTION`.
 *   That is why there is no state to move it to.
 * - **A rejected transition names its cause.** "Cannot move from CONFIRMED to
 *   IN_PRODUCTION" tells a supervisor nothing; "mesin belum ditetapkan" tells
 *   them what to fix.
 *
 * Everything here is pure. Guards are evaluated against facts the caller has
 * already read, so the whole table is unit-testable without a database, which
 * is the point of lifting it out of the service (MES-015-5).
 */

const LEGAL_TRANSITIONS: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  [WorkOrderStatus.DRAFT]: [WorkOrderStatus.SCHEDULED, WorkOrderStatus.CANCELLED],
  [WorkOrderStatus.SCHEDULED]: [
    WorkOrderStatus.CONFIRMED,
    WorkOrderStatus.DRAFT,
    WorkOrderStatus.CANCELLED,
  ],
  [WorkOrderStatus.CONFIRMED]: [
    WorkOrderStatus.IN_PRODUCTION,
    WorkOrderStatus.SCHEDULED,
    WorkOrderStatus.CANCELLED,
  ],
  [WorkOrderStatus.IN_PRODUCTION]: [WorkOrderStatus.COMPLETED, WorkOrderStatus.CANCELLED],
  [WorkOrderStatus.COMPLETED]: [],
  [WorkOrderStatus.CANCELLED]: [],
};

/** Statuses the v1.0 model deliberately does not have (ADR-18, §11). */
export const RETIRED_WORK_ORDER_STATUSES = ['RELEASED', 'IN_PROGRESS', 'PAUSED'] as const;

/**
 * The facts a guard needs, gathered by the caller.
 *
 * Two groups, and the difference matters:
 *
 * - **The work order's own columns** — `plannedQuantity`, `plannedStart`,
 *   `plannedEnd`, `sequence`, `machineId`, `moldId`, `shiftId`. A caller
 *   holding the row always knows these, so absent means *not set on the work
 *   order* and the guard fails.
 * - **Facts read from elsewhere** — assignments, conflicts, occupancy, shift
 *   state, hanging downtime, the predecessor. Absent means *not evaluated*, and
 *   the guard is skipped rather than invented. A caller that can determine the
 *   fact must pass it; passing an empty array is an assertion that there are
 *   none, which is different from not asking.
 */
export interface WorkOrderTransitionContext {
  plannedQuantity?: number;
  plannedStart?: string;
  plannedEnd?: string;
  sequence?: number;
  machineId?: string;
  moldId?: string;
  shiftId?: string;
  /**
   * Whether a mold is part of this work order's confirmation checklist (ADR-36).
   *
   * Mold is required only where the product declares an active
   * `product_mold_compatibility`. §15 makes that table the source of truth for
   * whether a product uses a mold at all; a product with none has nothing to
   * assign, and requiring one would make confirmation impossible rather than
   * careful. Where the product does use a mold, the guard still bites.
   *
   * Left undefined, the guard is skipped, in line with the "facts read from
   * elsewhere" convention above.
   */
  moldRequired?: boolean;
  /** Operators assigned to the work order; `CONFIRMED → IN_PRODUCTION` needs one. */
  assignedOperatorIds?: string[];
  /** Open schedule conflicts on machine, mold or capacity. Any entry blocks. */
  openScheduleConflicts?: string[];
  /** Resources whose compatibility with the product failed validation. */
  incompatibleResources?: string[];
  /** Machine or mold already occupied by another work order right now. */
  occupiedResources?: string[];
  /** `true` when the shift the WO is scheduled into is currently running. */
  shiftActive?: boolean;
  /** Count of `downtime_record` rows still ACTIVE against this work order. */
  activeDowntimeCount?: number;
  /** Predecessor facts, for the §13 soft/strict process sequence guard. */
  predecessor?: {
    workOrderId: string;
    status: WorkOrderStatus;
    /** `SUM(predecessor.transferred) − SUM(this.input)`, §13. */
    availableQuantity: number;
  };
  /** §13: `false` (default) accepts a predecessor that is merely in production. */
  strictProcessSequence?: boolean;
  /** Mandatory for any transition into CANCELLED. */
  reason?: string;
}

/** What the caller must apply after a transition is accepted (MES-015-3). */
export interface WorkOrderTransitionEffects {
  /** Stamp `actual_start` with this timestamp. */
  setActualStart?: boolean;
  /** Stamp `actual_end` with this timestamp. */
  setActualEnd?: boolean;
  /** Stamp `confirmed_by` / `confirmed_at`. */
  setConfirmed?: boolean;
  /** Drive the assigned machine to this state. */
  machineState?: 'RUNNING' | 'IDLE';
  /** Persist the mandatory cancellation reason. */
  setStatusReason?: boolean;
  /** Aggregate quantities and propagate to the successor / customer order. */
  aggregateOnCompletion?: boolean;
}

export interface WorkOrderTransitionDecision {
  allowed: boolean;
  /** Populated when `allowed` is false; each entry names one unmet guard. */
  reasons: string[];
  effects: WorkOrderTransitionEffects;
}

/**
 * Thrown when a transition is refused. Carries the individual guard failures so
 * a route can render them as a list rather than one run-on sentence.
 */
export class WorkOrderTransitionError extends Error {
  readonly from: WorkOrderStatus;
  readonly to: WorkOrderStatus;
  readonly reasons: string[];

  constructor(from: WorkOrderStatus, to: WorkOrderStatus, reasons: string[]) {
    super(
      `Work Order tidak dapat berpindah dari ${from} ke ${to}: ${reasons.join(' ')}`
    );
    this.name = 'WorkOrderTransitionError';
    this.from = from;
    this.to = to;
    this.reasons = reasons;
  }
}

function isBlank(value: string | undefined): boolean {
  return value === undefined || value === null || String(value).trim() === '';
}

export class WorkOrderStateMachine {
  /** Whether the transition exists in the table at all, guards aside. */
  static canTransition(current: WorkOrderStatus, next: WorkOrderStatus): boolean {
    const allowed = LEGAL_TRANSITIONS[current] || [];
    return allowed.includes(next);
  }

  static allowedTargets(current: WorkOrderStatus): WorkOrderStatus[] {
    return [...(LEGAL_TRANSITIONS[current] || [])];
  }

  /**
   * Evaluates the transition and every guard §11 attaches to it.
   *
   * Collects all failures rather than returning at the first, so a work order
   * missing three things to be confirmable reports three things.
   */
  static evaluate(
    current: WorkOrderStatus,
    next: WorkOrderStatus,
    context: WorkOrderTransitionContext = {}
  ): WorkOrderTransitionDecision {
    if (current === next) {
      return {
        allowed: false,
        reasons: [`Work Order sudah berstatus ${current}.`],
        effects: {},
      };
    }

    if (!this.canTransition(current, next)) {
      return {
        allowed: false,
        reasons: [
          `Transisi ${current} → ${next} tidak ada pada state machine. ` +
            `Dari ${current} hanya diizinkan: ${this.allowedTargets(current).join(', ') || '(tidak ada)'}.`,
        ],
        effects: {},
      };
    }

    const reasons: string[] = [];
    const effects: WorkOrderTransitionEffects = {};

    // --- any → CANCELLED: reason is mandatory (§11) ---------------------
    if (next === WorkOrderStatus.CANCELLED) {
      if (isBlank(context.reason)) {
        reasons.push('Alasan pembatalan wajib diisi.');
      }
      effects.setStatusReason = true;
      return { allowed: reasons.length === 0, reasons, effects };
    }

    // --- DRAFT → SCHEDULED ----------------------------------------------
    if (current === WorkOrderStatus.DRAFT && next === WorkOrderStatus.SCHEDULED) {
      if (!context.plannedQuantity || context.plannedQuantity <= 0) {
        reasons.push('Planned quantity harus lebih dari nol sebelum dijadwalkan.');
      }
      if (isBlank(context.plannedStart)) reasons.push('Planned start belum ditetapkan.');
      if (isBlank(context.plannedEnd)) reasons.push('Planned end belum ditetapkan.');
      if (
        !isBlank(context.plannedStart) &&
        !isBlank(context.plannedEnd) &&
        Date.parse(context.plannedEnd!) <= Date.parse(context.plannedStart!)
      ) {
        reasons.push('Planned end harus setelah planned start.');
      }
      if (context.sequence === undefined || context.sequence === null) {
        reasons.push('Sequence process belum ditetapkan.');
      }
      for (const conflict of context.openScheduleConflicts ?? []) {
        reasons.push(`Konflik jadwal terbuka: ${conflict}.`);
      }
      return { allowed: reasons.length === 0, reasons, effects };
    }

    // --- SCHEDULED → CONFIRMED: the confirmation checklist ---------------
    if (current === WorkOrderStatus.SCHEDULED && next === WorkOrderStatus.CONFIRMED) {
      if (!context.plannedQuantity || context.plannedQuantity <= 0) {
        reasons.push('Planned quantity belum ditetapkan.');
      }
      if (isBlank(context.plannedStart) || isBlank(context.plannedEnd)) {
        reasons.push('Jadwal (planned start dan end) belum lengkap.');
      }
      if (isBlank(context.machineId)) reasons.push('Mesin belum ditetapkan.');
      if (context.moldRequired && isBlank(context.moldId)) {
        reasons.push('Mold belum ditetapkan.');
      }
      if (isBlank(context.shiftId)) reasons.push('Shift belum ditetapkan.');
      if (context.assignedOperatorIds !== undefined && context.assignedOperatorIds.length === 0) {
        reasons.push('Operator belum ditugaskan.');
      }
      for (const resource of context.incompatibleResources ?? []) {
        reasons.push(`Resource tidak compatible dengan product: ${resource}.`);
      }
      for (const conflict of context.openScheduleConflicts ?? []) {
        reasons.push(`Konflik terbuka harus diselesaikan: ${conflict}.`);
      }
      effects.setConfirmed = true;
      return { allowed: reasons.length === 0, reasons, effects };
    }

    // --- CONFIRMED → IN_PRODUCTION --------------------------------------
    if (current === WorkOrderStatus.CONFIRMED && next === WorkOrderStatus.IN_PRODUCTION) {
      if (context.assignedOperatorIds !== undefined && context.assignedOperatorIds.length === 0) {
        reasons.push('Operator belum ditugaskan pada Work Order ini.');
      }
      if (context.shiftActive === false) {
        reasons.push('Shift yang dijadwalkan belum aktif.');
      }
      for (const resource of context.occupiedResources ?? []) {
        reasons.push(`Resource sedang dipakai Work Order lain: ${resource}.`);
      }
      reasons.push(...this.predecessorGuardFailures(context));

      effects.setActualStart = true;
      effects.machineState = 'RUNNING';
      return { allowed: reasons.length === 0, reasons, effects };
    }

    // --- IN_PRODUCTION → COMPLETED --------------------------------------
    if (current === WorkOrderStatus.IN_PRODUCTION && next === WorkOrderStatus.COMPLETED) {
      const active = context.activeDowntimeCount ?? 0;
      if (active > 0) {
        reasons.push(
          `Masih ada ${active} downtime record berstatus ACTIVE; selesaikan downtime sebelum menutup Work Order.`
        );
      }
      effects.setActualEnd = true;
      effects.machineState = 'IDLE';
      effects.aggregateOnCompletion = true;
      return { allowed: reasons.length === 0, reasons, effects };
    }

    // --- Backward moves (SCHEDULED → DRAFT, CONFIRMED → SCHEDULED) -------
    // Reopening a work order for adjustment carries no checklist of its own;
    // what it must not do is silently unstamp a confirmation, so the caller is
    // told to clear it.
    if (next === WorkOrderStatus.DRAFT || next === WorkOrderStatus.SCHEDULED) {
      return { allowed: true, reasons: [], effects: { setConfirmed: false } };
    }

    return { allowed: true, reasons: [], effects };
  }

  /**
   * The soft predecessor guard (§13, MES-015-4).
   *
   * Default (`strict_process_sequence = false`): the predecessor must be at
   * least in production and must actually have handed something over, because
   * starting a process with nothing to work on is the error worth catching.
   * Strict: the predecessor must have finished.
   */
  private static predecessorGuardFailures(context: WorkOrderTransitionContext): string[] {
    const predecessor = context.predecessor;
    if (!predecessor) return [];

    const failures: string[] = [];
    if (context.strictProcessSequence) {
      if (predecessor.status !== WorkOrderStatus.COMPLETED) {
        failures.push(
          `Mode strict: process sebelumnya (${predecessor.workOrderId}) harus COMPLETED, saat ini ${predecessor.status}.`
        );
      }
      return failures;
    }

    const started =
      predecessor.status === WorkOrderStatus.IN_PRODUCTION ||
      predecessor.status === WorkOrderStatus.COMPLETED;
    if (!started) {
      failures.push(
        `Process sebelumnya (${predecessor.workOrderId}) belum berjalan, saat ini ${predecessor.status}.`
      );
    }
    if (predecessor.availableQuantity <= 0) {
      failures.push(
        `Belum ada quantity yang diserahkan process sebelumnya (available ${predecessor.availableQuantity}).`
      );
    }
    return failures;
  }

  /** Evaluates and throws when refused. */
  static validateTransition(
    current: WorkOrderStatus,
    next: WorkOrderStatus,
    context: WorkOrderTransitionContext = {}
  ): WorkOrderTransitionEffects {
    const decision = this.evaluate(current, next, context);
    if (!decision.allowed) {
      throw new WorkOrderTransitionError(current, next, decision.reasons);
    }
    return decision.effects;
  }
}
