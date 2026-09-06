import { randomUUID } from 'crypto';
import { WorkOrderStatus } from '@factory-vision/domain-types';
import type { WorkOrder } from '@factory-vision/domain-types';
import type { Executor } from '../../platform/db/executor.js';
import { ApiError } from '../../platform/http/api-error.js';
import { QuantityFlowService, QuantityFlowViolation } from './quantity-flow.service.js';
import { WorkOrderRepository } from './work-order.repository.js';

/**
 * Dynamic Work Order splitting (§25.7).
 *
 * A supervisor who needs a process to finish sooner splits its Work Order and
 * runs the pieces side by side — 1.000 pcs of Tire Building becomes 500 on
 * TBM-001 and 500 on TBM-002, on different shifts and different operators, and
 * the two finish in half the wall-clock time.
 *
 * Splitting is an **operational act, never seed data**. Nothing here is
 * pre-planted: how a work order is divided depends on what the floor looks like
 * on the day, so the split exists only once a supervisor performs it.
 *
 * The shape it produces, and the traceability the whole feature exists for:
 *
 * ```text
 * Production Order
 *   └── Parent WO            (routing sequence 1..n, one per process)
 *         └── Child WO 1     TBM, 1.000 pcs        ← split here
 *               ├── 1A       500 pcs, TBM-001
 *               └── 1B       500 pcs, TBM-002
 * ```
 *
 * Three rules make the result trustworthy, and each is enforced rather than
 * documented:
 *
 * - **A split divides the work exhaustively.** `SUM(child.planned) =
 *   parent.planned`, via `QuantityFlowService.assertSplitPlannedExact` — the
 *   invariant was written for this and had no caller until now.
 * - **The parent keeps no production of its own.** `ProcessChainService`
 *   already assumes it ("after a split the predecessor is a parent that holds
 *   no production records of its own"), which is what lets a successor read
 *   the children's transferred quantity instead. A work order that has already
 *   recorded output therefore cannot be split — the figures would be counted
 *   twice on roll-up, and the honest answer is to tell the supervisor what has
 *   been produced rather than to quietly double it.
 * - **The parent releases its machine and mold.** `uq_work_order_machine_in_
 *   production` allows one running work order per machine, so a parent still
 *   holding TBM-001 would block its own child from starting there. Execution
 *   moves to the children; the container does not occupy a machine.
 */

export interface SplitPartInput {
  plannedQuantity: number;
  machineId?: string;
  workCenterId?: string;
  moldId?: string;
  shiftId?: string;
  plannedStart?: string;
  plannedEnd?: string;
}

export interface SplitWorkOrderResult {
  parent: WorkOrder;
  children: WorkOrder[];
}

/** Statuses a split can be performed from. */
const SPLITTABLE: WorkOrderStatus[] = [
  WorkOrderStatus.SCHEDULED,
  WorkOrderStatus.CONFIRMED,
  WorkOrderStatus.IN_PRODUCTION,
];

/** A, B, C … AA, AB — enough for any split a human would make, and then some. */
const suffixFor = (index: number): string => {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
};

const recordedQuantity = (wo: WorkOrder): number =>
  (wo.outputQuantity ?? 0) +
  (wo.rejectQuantity ?? 0) +
  (wo.scrapQuantity ?? 0) +
  (wo.reworkQuantity ?? 0) +
  (wo.transferredQuantity ?? 0) +
  (wo.inputQuantity ?? 0);

export class WorkOrderSplitService {
  constructor(private readonly workOrders = new WorkOrderRepository()) {}

  /**
   * Divides one Work Order into two or more children.
   *
   * Runs inside the caller's transaction: a half-written split — children
   * inserted, parent never flagged — would leave quantity counted twice for
   * every read that follows.
   */
  async split(
    exec: Executor,
    tenantId: string,
    workOrderId: string,
    parts: SplitPartInput[],
    actor?: string
  ): Promise<SplitWorkOrderResult> {
    const parent = await this.workOrders.findById(exec, tenantId, workOrderId);
    if (!parent) throw ApiError.notFound('Work order tidak ditemukan.');

    this.assertSplittable(parent, parts);

    const now = new Date().toISOString();
    const children: WorkOrder[] = [];

    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i]!;
      const child: WorkOrder = {
        id: randomUUID(),
        tenantId: parent.tenantId,
        // Traceability is carried by the number as well as the column, so a
        // supervisor reading a shop-floor terminal sees where 1A came from.
        woNumber: `${parent.woNumber}-${suffixFor(i)}`,
        parentWorkOrderId: parent.id,
        // Children inherit the parent's place in the routing chain, so the
        // successor process still resolves its predecessors correctly.
        predecessorWorkOrderId: parent.predecessorWorkOrderId,
        productionPlanLineId: parent.productionPlanLineId,
        productionOrderId: parent.productionOrderId,
        productId: parent.productId,
        processId: parent.processId,
        routingId: parent.routingId,
        sequence: parent.sequence,
        lineId: parent.lineId,
        unit: parent.unit,
        priority: parent.priority,
        isBatchManaged: parent.isBatchManaged,
        hasChildWorkOrder: false,

        // What the supervisor decided, per piece of the split.
        plannedQuantity: part.plannedQuantity,
        machineId: part.machineId ?? undefined,
        workCenterId: part.workCenterId ?? parent.workCenterId,
        moldId: part.moldId ?? undefined,
        shiftId: part.shiftId ?? parent.shiftId,
        plannedStart: part.plannedStart ?? parent.plannedStart,
        plannedEnd: part.plannedEnd ?? parent.plannedEnd,

        // A child starts empty. Everything it produces is its own.
        inputQuantity: 0,
        outputQuantity: 0,
        rejectQuantity: 0,
        scrapQuantity: 0,
        reworkQuantity: 0,
        transferredQuantity: 0,

        // A running parent yields children that are ready to start but not
        // started: each is begun separately, which is the point of splitting.
        status:
          parent.status === WorkOrderStatus.SCHEDULED
            ? WorkOrderStatus.SCHEDULED
            : WorkOrderStatus.CONFIRMED,
        confirmedBy: parent.status === WorkOrderStatus.SCHEDULED ? undefined : (actor ?? parent.confirmedBy),
        confirmedAt: parent.status === WorkOrderStatus.SCHEDULED ? undefined : now,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      children.push(await this.workOrders.create(exec, child));
    }

    // The parent becomes a container: flagged as split, and holding neither
    // machine nor mold so its children can claim them.
    await exec.query(
      `UPDATE work_order
          SET has_child_work_order = TRUE,
              machine_id = NULL,
              mold_id = NULL,
              updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, parent.id]
    );

    const updatedParent = await this.workOrders.findById(exec, tenantId, parent.id);
    return { parent: updatedParent ?? parent, children };
  }

  /**
   * Folds the children's production back into the parent (§25.7 roll-up).
   *
   * The parent's counters are a pure sum, never incremented in place, so
   * running this twice produces the same answer as running it once — which
   * matters, because it runs after every child completion.
   *
   * A parent whose children have all finished is finished too, and only then
   * may the next routing process start.
   */
  async rollUp(exec: Executor, tenantId: string, parentWorkOrderId: string): Promise<WorkOrder | undefined> {
    const parent = await this.workOrders.findById(exec, tenantId, parentWorkOrderId);
    if (!parent || !parent.hasChildWorkOrder) return parent;

    const totals = await exec.query<{
      children: string;
      completed: string;
      cancelled: string;
      started: string;
      input: string;
      output: string;
      reject: string;
      scrap: string;
      rework: string;
      transferred: string;
      last_end: string | null;
      first_start: string | null;
    }>(
      `SELECT COUNT(*)::text                                                        AS children,
              COUNT(*) FILTER (WHERE status = 'COMPLETED')::text                    AS completed,
              COUNT(*) FILTER (WHERE status = 'CANCELLED')::text                    AS cancelled,
              COUNT(*) FILTER (WHERE status = 'IN_PRODUCTION')::text                 AS started,
              COALESCE(SUM(input_quantity), 0)::text                                AS input,
              COALESCE(SUM(output_quantity), 0)::text                               AS output,
              COALESCE(SUM(reject_quantity), 0)::text                               AS reject,
              COALESCE(SUM(scrap_quantity), 0)::text                                AS scrap,
              COALESCE(SUM(rework_quantity), 0)::text                               AS rework,
              COALESCE(SUM(transferred_quantity), 0)::text                          AS transferred,
              MAX(actual_end)::text                                                 AS last_end,
              MIN(actual_start)::text                                               AS first_start
         FROM work_order
        WHERE tenant_id = $1 AND parent_work_order_id = $2`,
      [tenantId, parentWorkOrderId]
    );

    const row = totals.rows[0];
    if (!row || Number(row.children) === 0) return parent;

    // Cancelled children are not work anyone still owes, so they do not hold
    // the parent open; a parent with nothing but cancelled children stays put.
    const active = Number(row.children) - Number(row.cancelled);
    const allDone = active > 0 && Number(row.completed) === active;

    // A parent whose first child has started is running, and has to say so:
    // the successor process's predecessor guard accepts IN_PRODUCTION or
    // COMPLETED, so a parent left at CONFIRMED would stall the routing chain
    // while its children were visibly producing.
    const anyStarted = Number(row.started) > 0 || Number(row.completed) > 0;
    const startParent = !allDone && anyStarted && parent.status === WorkOrderStatus.CONFIRMED;

    await exec.query(
      `UPDATE work_order
          SET input_quantity       = $3,
              output_quantity      = $4,
              reject_quantity      = $5,
              scrap_quantity       = $6,
              rework_quantity      = $7,
              transferred_quantity = $8,
              actual_start         = COALESCE(actual_start, $9),
              actual_end           = CASE WHEN $10 THEN $11 ELSE actual_end END,
              status               = CASE
                                       WHEN $10 THEN 'COMPLETED'
                                       WHEN $12 THEN 'IN_PRODUCTION'
                                       ELSE status
                                     END,
              updated_at           = now()
        WHERE tenant_id = $1 AND id = $2`,
      [
        tenantId,
        parentWorkOrderId,
        Number(row.input),
        Number(row.output),
        Number(row.reject),
        Number(row.scrap),
        Number(row.rework),
        Number(row.transferred),
        row.first_start,
        allDone,
        row.last_end,
        startParent,
      ]
    );

    return this.workOrders.findById(exec, tenantId, parentWorkOrderId);
  }

  /** Every reason a split would be wrong, reported together rather than one at a time. */
  private assertSplittable(parent: WorkOrder, parts: SplitPartInput[]): void {
    if (parent.hasChildWorkOrder) {
      throw ApiError.invalidState(
        `Work order ${parent.woNumber} sudah pernah di-split. Split salah satu child-nya jika perlu dibagi lagi.`
      );
    }
    if (!SPLITTABLE.includes(parent.status)) {
      throw ApiError.invalidState(
        `Work order berstatus ${parent.status} tidak dapat di-split. ` +
          `Status yang bisa: ${SPLITTABLE.join(', ')}.`
      );
    }
    if (parts.length < 2) {
      throw ApiError.validation('Split menghasilkan minimal 2 child work order.', [
        { field: 'parts', code: 'TOO_FEW_PARTS', message: 'Minimal 2 bagian.' },
      ]);
    }
    for (const [i, part] of parts.entries()) {
      if (!Number.isFinite(part.plannedQuantity) || part.plannedQuantity <= 0) {
        throw ApiError.validation(`Bagian ke-${i + 1}: planned quantity harus lebih besar dari nol.`, [
          {
            field: `parts[${i}].plannedQuantity`,
            code: 'MUST_BE_POSITIVE',
            message: 'Harus lebih besar dari nol.',
          },
        ]);
      }
    }

    const recorded = recordedQuantity(parent);
    if (recorded > 0) {
      throw ApiError.invalidState(
        `Work order ${parent.woNumber} sudah mencatat produksi (output ${parent.outputQuantity}, ` +
          `reject ${parent.rejectQuantity}, input ${parent.inputQuantity}). ` +
          'Parent hasil split tidak boleh memiliki catatan produksi sendiri, karena hasil child ' +
          'akan dijumlahkan ke parent dan angkanya akan terhitung dua kali.'
      );
    }

    const total = parts.reduce((sum, part) => sum + part.plannedQuantity, 0);
    try {
      QuantityFlowService.assertSplitPlannedExact(parent.id, parent.plannedQuantity, total);
    } catch (error) {
      // The invariant speaks in domain terms; the API has to answer in a status
      // code. Unconverted this surfaced as a 500, which told a supervisor their
      // split had crashed the server rather than that the numbers do not add up
      // — and this is the single rule they are most likely to get wrong.
      if (error instanceof QuantityFlowViolation) {
        throw ApiError.validation(
          error.message,
          error.violations.map((violation) => ({
            field: 'parts',
            code: violation.invariant,
            message: violation.message,
          }))
        );
      }
      throw error;
    }
  }
}
