/**
 * Production Quantity Flow invariants (MES-017, §10).
 *
 * The four buckets are mutually exclusive: a unit is in exactly one of
 * `output`, `reject`, `scrap`, `rework`. **Output never means good + reject** —
 * that conflation is what let a factory report more good parts than it had
 * material for, and it is the single rule this file exists to enforce.
 *
 * ```text
 * input >= output + reject + scrap + rework
 * transferred <= output
 * wip = input − output − reject − scrap − rework      (0 when COMPLETED)
 * ```
 *
 * Identical for a Work Order and for a Batch (§9 Q5): they are the same shape of
 * counter at two levels, so they get the same checks from the same code rather
 * than two implementations that drift.
 *
 * Violations name the invariant *and the colliding numbers*. "ck_quantity_flow
 * violated" sends a supervisor to a DBA; "input 100 lebih kecil dari output 90
 * + reject 20 = 110, selisih 10" sends them to the record they mistyped.
 */

export type QuantityScope = 'WORK_ORDER' | 'BATCH';

export interface QuantityFlow {
  plannedQuantity?: number;
  inputQuantity: number;
  outputQuantity: number;
  rejectQuantity: number;
  scrapQuantity: number;
  reworkQuantity: number;
  transferredQuantity: number;
}

export type QuantityInvariant =
  | 'NON_NEGATIVE'
  | 'INPUT_COVERS_DISPOSITION'
  | 'TRANSFERRED_WITHIN_OUTPUT'
  | 'WIP_ZERO_ON_COMPLETION';

export interface QuantityViolation {
  invariant: QuantityInvariant;
  /** Indonesian, names the colliding figures. Safe to show a supervisor. */
  message: string;
}

export class QuantityFlowViolation extends Error {
  readonly scope: QuantityScope;
  readonly entityId: string;
  readonly violations: QuantityViolation[];

  constructor(scope: QuantityScope, entityId: string, violations: QuantityViolation[]) {
    const label = scope === 'BATCH' ? 'Batch' : 'Work Order';
    super(`Quantity flow ${label} ${entityId} tidak valid. ${violations.map((v) => v.message).join(' ')}`);
    this.name = 'QuantityFlowViolation';
    this.scope = scope;
    this.entityId = entityId;
    this.violations = violations;
  }

  /** The invariant names that failed, for a caller that wants to branch. */
  get failed(): QuantityInvariant[] {
    return this.violations.map((v) => v.invariant);
  }
}

const LABELS: Record<keyof QuantityFlow, string> = {
  plannedQuantity: 'planned',
  inputQuantity: 'input',
  outputQuantity: 'output',
  rejectQuantity: 'reject',
  scrapQuantity: 'scrap',
  reworkQuantity: 'rework',
  transferredQuantity: 'transferred',
};

function n(value: number | undefined): number {
  return Number.isFinite(value as number) ? Number(value) : 0;
}

export class QuantityFlowService {
  /**
   * `wip = input − output − reject − scrap − rework`.
   *
   * The remainder of the first invariant: units that entered the process and
   * have not yet been dispositioned. Derived, never stored — a stored WIP would
   * freeze the moment a record was corrected.
   */
  static workInProgress(flow: QuantityFlow): number {
    return (
      n(flow.inputQuantity) -
      n(flow.outputQuantity) -
      n(flow.rejectQuantity) -
      n(flow.scrapQuantity) -
      n(flow.reworkQuantity)
    );
  }

  /**
   * Yield, derived on demand (§10: "Yield tidak disimpan").
   * `undefined` rather than 0 when nothing has entered: a process with no input
   * has no yield, and reporting 0% would look like total failure.
   */
  static yieldRatio(flow: QuantityFlow): number | undefined {
    const input = n(flow.inputQuantity);
    if (input <= 0) return undefined;
    return n(flow.outputQuantity) / input;
  }

  /** Every violation in `flow`, in the order the invariants are documented. */
  static check(
    flow: QuantityFlow,
    options: { completed?: boolean } = {}
  ): QuantityViolation[] {
    const violations: QuantityViolation[] = [];

    // --- Nothing is negative -------------------------------------------
    for (const [key, label] of Object.entries(LABELS) as [keyof QuantityFlow, string][]) {
      const value = flow[key];
      if (value === undefined) continue;
      if (!Number.isFinite(value)) {
        violations.push({
          invariant: 'NON_NEGATIVE',
          message: `Quantity ${label} bukan angka yang valid (${String(value)}).`,
        });
        continue;
      }
      if (value < 0) {
        violations.push({
          invariant: 'NON_NEGATIVE',
          message: `Quantity ${label} tidak boleh negatif (${value}).`,
        });
      }
    }

    const input = n(flow.inputQuantity);
    const output = n(flow.outputQuantity);
    const reject = n(flow.rejectQuantity);
    const scrap = n(flow.scrapQuantity);
    const rework = n(flow.reworkQuantity);
    const transferred = n(flow.transferredQuantity);

    // --- input >= output + reject + scrap + rework ----------------------
    const disposition = output + reject + scrap + rework;
    if (input < disposition) {
      violations.push({
        invariant: 'INPUT_COVERS_DISPOSITION',
        message:
          `Input ${input} lebih kecil dari output ${output} + reject ${reject} + scrap ${scrap} + ` +
          `rework ${rework} = ${disposition}; selisih ${disposition - input}. ` +
          'Output tidak pernah mencakup reject — keempat bucket saling eksklusif.',
      });
    }

    // --- transferred <= output ------------------------------------------
    if (transferred > output) {
      violations.push({
        invariant: 'TRANSFERRED_WITHIN_OUTPUT',
        message:
          `Transferred ${transferred} melebihi output ${output}; selisih ${transferred - output}. ` +
          'Hanya quantity yang lolos kualitas dapat diserahkan ke process berikutnya.',
      });
    }

    // --- WIP must be 0 at completion ------------------------------------
    if (options.completed) {
      const wip = input - disposition;
      if (wip !== 0) {
        violations.push({
          invariant: 'WIP_ZERO_ON_COMPLETION',
          message:
            `WIP harus nol saat COMPLETED, saat ini ${wip} ` +
            `(input ${input} − output ${output} − reject ${reject} − scrap ${scrap} − rework ${rework}). ` +
            'Selesaikan disposisi seluruh unit yang masuk sebelum menutup.',
        });
      }
    }

    return violations;
  }

  /** Throws `QuantityFlowViolation` when `flow` breaks any invariant. */
  static assert(
    scope: QuantityScope,
    entityId: string,
    flow: QuantityFlow,
    options: { completed?: boolean } = {}
  ): void {
    const violations = this.check(flow, options);
    if (violations.length > 0) {
      throw new QuantityFlowViolation(scope, entityId, violations);
    }
  }

  /**
   * Checks the flow a delta would produce, without applying it.
   *
   * The one shape that matters at write time: a production record adds to the
   * counters, and it must be refused *before* the row lands, not discovered by
   * a nightly reconciliation.
   */
  static assertDelta(
    scope: QuantityScope,
    entityId: string,
    current: QuantityFlow,
    delta: Partial<QuantityFlow>,
    options: { completed?: boolean } = {}
  ): QuantityFlow {
    const next: QuantityFlow = {
      plannedQuantity: current.plannedQuantity,
      inputQuantity: n(current.inputQuantity) + n(delta.inputQuantity),
      outputQuantity: n(current.outputQuantity) + n(delta.outputQuantity),
      rejectQuantity: n(current.rejectQuantity) + n(delta.rejectQuantity),
      scrapQuantity: n(current.scrapQuantity) + n(delta.scrapQuantity),
      reworkQuantity: n(current.reworkQuantity) + n(delta.reworkQuantity),
      transferredQuantity: n(current.transferredQuantity) + n(delta.transferredQuantity),
    };
    this.assert(scope, entityId, next, options);
    return next;
  }

  /**
   * `SUM(batch.planned) <= work_order.planned` (§9 Q1–Q3).
   *
   * Less is allowed and is called *remaining batch capacity*; only exceeding is
   * refused. This is the deliberate difference from Split, where
   * `SUM(child.planned) = parent.planned` because a split divides the work
   * exhaustively — see `assertSplitPlannedExact`.
   */
  static assertBatchPlannedWithinWorkOrder(
    workOrderId: string,
    workOrderPlanned: number,
    batchPlannedTotal: number
  ): void {
    if (batchPlannedTotal > workOrderPlanned) {
      throw new QuantityFlowViolation('BATCH', workOrderId, [
        {
          invariant: 'INPUT_COVERS_DISPOSITION',
          message:
            `Total planned quantity batch ${batchPlannedTotal} melebihi planned quantity Work Order ` +
            `${workOrderPlanned}; kelebihan ${batchPlannedTotal - workOrderPlanned}. ` +
            'Total batch boleh kurang (sisanya remaining batch capacity), tidak boleh lebih.',
        },
      ]);
    }
  }

  /** `SUM(child.planned) = parent.planned` (§9 Q6, §25.7). */
  static assertSplitPlannedExact(
    parentWorkOrderId: string,
    parentPlanned: number,
    childPlannedTotal: number
  ): void {
    if (childPlannedTotal !== parentPlanned) {
      throw new QuantityFlowViolation('WORK_ORDER', parentWorkOrderId, [
        {
          invariant: 'INPUT_COVERS_DISPOSITION',
          message:
            `Total planned quantity child ${childPlannedTotal} tidak sama dengan planned quantity parent ` +
            `${parentPlanned}; selisih ${childPlannedTotal - parentPlanned}. ` +
            'Split membagi habis pekerjaan, jadi totalnya harus persis sama.',
        },
      ]);
    }
  }

  /**
   * `available_quantity(successor) = Σ predecessor.transferred − Σ successor.input` (§13).
   *
   * A recommendation, not a constraint: planning more than is available is
   * warned about and allowed, because the shop floor legitimately knows things
   * the counters do not yet.
   */
  static availableQuantity(predecessorTransferred: number, successorInput: number): number {
    return Math.max(n(predecessorTransferred) - n(successorInput), 0);
  }
}
