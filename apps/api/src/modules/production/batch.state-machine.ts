import { ProductionBatchStatus, WorkOrderStatus } from '@factory-vision/domain-types';

/**
 * The Batch lifecycle (MES-016, §12).
 *
 * ```text
 * PLANNED ──► IN_PRODUCTION ──► COMPLETED
 *     │             │
 *     └─────────────┴──────────► CANCELLED
 * ```
 *
 * Deliberately shallow. A Batch has **no** `SCHEDULED` and **no** `CONFIRMED`:
 * both are Work Order concerns, and a batch that repeated them would be a
 * second WO lifecycle wearing a different name. A batch says how execution is
 * going, nothing more.
 *
 * The two rules that catch people out:
 *
 * - A batch may only start once its **parent Work Order is IN_PRODUCTION**. A
 *   batch is a slice of that work order's execution; there is nothing for it to
 *   be a slice of before the work order has started.
 * - Cancelling a batch does **not** cancel the Work Order. It releases the
 *   remaining planned quantity, and the shortfall shows up as missing output.
 */

const LEGAL_TRANSITIONS: Partial<Record<ProductionBatchStatus, ProductionBatchStatus[]>> = {
  [ProductionBatchStatus.PLANNED]: [
    ProductionBatchStatus.IN_PRODUCTION,
    ProductionBatchStatus.CANCELLED,
  ],
  [ProductionBatchStatus.IN_PRODUCTION]: [
    ProductionBatchStatus.COMPLETED,
    ProductionBatchStatus.CANCELLED,
  ],
  [ProductionBatchStatus.COMPLETED]: [],
  [ProductionBatchStatus.CANCELLED]: [],
};

/**
 * Statuses `ProductionBatchStatus` still carries for rows written before the
 * v1.0 model, and what each one means in the new lifecycle.
 *
 * They are not reachable by any transition: a batch can be read in one of these
 * states, and it moves out of it by being interpreted as its v1.0 equivalent.
 */
const LEGACY_ALIASES: Partial<Record<ProductionBatchStatus, ProductionBatchStatus>> = {
  [ProductionBatchStatus.ACTIVE]: ProductionBatchStatus.IN_PRODUCTION,
  [ProductionBatchStatus.HOLD]: ProductionBatchStatus.IN_PRODUCTION,
  [ProductionBatchStatus.SCRAPPED]: ProductionBatchStatus.CANCELLED,
};

/** Statuses the batch model deliberately does not have (§12). */
export const RETIRED_BATCH_STATUSES = ['SCHEDULED', 'CONFIRMED', 'PAUSED'] as const;

export interface BatchTransitionContext {
  /** Status of the Work Order this batch belongs to. */
  workOrderStatus?: WorkOrderStatus;
  plannedQuantity?: number;
  /** Count of `downtime_record` rows still ACTIVE against *this batch*. */
  activeDowntimeCount?: number;
  /** Mandatory for CANCELLED (§12) — persisted to `production_batch.status_reason`. */
  reason?: string;
}

export interface BatchTransitionEffects {
  setActualStart?: boolean;
  setActualEnd?: boolean;
  setStatusReason?: boolean;
  /** Roll this batch's quantities up into its Work Order. */
  aggregateToWorkOrder?: boolean;
  /** Return the unstarted planned quantity to the work order's remaining capacity. */
  releaseRemainingPlanned?: boolean;
}

export interface BatchTransitionDecision {
  allowed: boolean;
  reasons: string[];
  effects: BatchTransitionEffects;
}

export class BatchTransitionError extends Error {
  readonly from: ProductionBatchStatus;
  readonly to: ProductionBatchStatus;
  readonly reasons: string[];

  constructor(from: ProductionBatchStatus, to: ProductionBatchStatus, reasons: string[]) {
    super(`Batch tidak dapat berpindah dari ${from} ke ${to}: ${reasons.join(' ')}`);
    this.name = 'BatchTransitionError';
    this.from = from;
    this.to = to;
    this.reasons = reasons;
  }
}

export class BatchStateMachine {
  /** Maps a legacy status onto the v1.0 lifecycle; other statuses pass through. */
  static normalize(status: ProductionBatchStatus): ProductionBatchStatus {
    return LEGACY_ALIASES[status] ?? status;
  }

  static canTransition(current: ProductionBatchStatus, next: ProductionBatchStatus): boolean {
    const from = this.normalize(current);
    return (LEGAL_TRANSITIONS[from] ?? []).includes(next);
  }

  static allowedTargets(current: ProductionBatchStatus): ProductionBatchStatus[] {
    return [...(LEGAL_TRANSITIONS[this.normalize(current)] ?? [])];
  }

  static evaluate(
    current: ProductionBatchStatus,
    next: ProductionBatchStatus,
    context: BatchTransitionContext = {}
  ): BatchTransitionDecision {
    const from = this.normalize(current);

    if (from === next) {
      return { allowed: false, reasons: [`Batch sudah berstatus ${next}.`], effects: {} };
    }

    if (!this.canTransition(from, next)) {
      return {
        allowed: false,
        reasons: [
          `Transisi ${from} → ${next} tidak ada pada lifecycle batch. ` +
            `Dari ${from} hanya diizinkan: ${this.allowedTargets(from).join(', ') || '(tidak ada)'}.`,
        ],
        effects: {},
      };
    }

    const reasons: string[] = [];
    const effects: BatchTransitionEffects = {};

    if (next === ProductionBatchStatus.CANCELLED) {
      if (!context.reason || context.reason.trim() === '') {
        reasons.push('Alasan pembatalan (status_reason) wajib diisi.');
      }
      effects.setStatusReason = true;
      // Quantity already recorded still counts; only the untouched remainder is
      // released. Cancelling a batch never touches the parent Work Order.
      effects.releaseRemainingPlanned = true;
      return { allowed: reasons.length === 0, reasons, effects };
    }

    if (from === ProductionBatchStatus.PLANNED && next === ProductionBatchStatus.IN_PRODUCTION) {
      if (context.workOrderStatus !== undefined && context.workOrderStatus !== WorkOrderStatus.IN_PRODUCTION) {
        reasons.push(
          `Work Order induk harus berstatus IN_PRODUCTION sebelum batch dimulai, saat ini ${context.workOrderStatus}.`
        );
      }
      if (context.plannedQuantity !== undefined && context.plannedQuantity <= 0) {
        reasons.push('Planned quantity batch harus lebih dari nol.');
      }
      effects.setActualStart = true;
      return { allowed: reasons.length === 0, reasons, effects };
    }

    if (from === ProductionBatchStatus.IN_PRODUCTION && next === ProductionBatchStatus.COMPLETED) {
      const active = context.activeDowntimeCount ?? 0;
      if (active > 0) {
        reasons.push(
          `Masih ada ${active} downtime record berstatus ACTIVE pada batch ini; selesaikan downtime sebelum menutup batch.`
        );
      }
      effects.setActualEnd = true;
      effects.aggregateToWorkOrder = true;
      return { allowed: reasons.length === 0, reasons, effects };
    }

    return { allowed: true, reasons: [], effects };
  }

  static validateTransition(
    current: ProductionBatchStatus,
    next: ProductionBatchStatus,
    context: BatchTransitionContext = {}
  ): BatchTransitionEffects {
    const decision = this.evaluate(current, next, context);
    if (!decision.allowed) {
      throw new BatchTransitionError(this.normalize(current), next, decision.reasons);
    }
    return decision.effects;
  }
}
