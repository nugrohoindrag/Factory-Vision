import { WorkOrderStatus } from '@factory-vision/domain-types';
import type { WorkOrder } from '@factory-vision/domain-types';
import { withTenant } from '../../platform/db/pool.js';
import type { Executor } from '../../platform/db/executor.js';
import { ApiError } from '../../platform/http/api-error.js';
import { WorkOrderRepository } from './work-order.repository.js';
import { QuantityFlowService } from './quantity-flow.service.js';

/**
 * Predecessor / successor traversal for the process chain (MES-018, §6).
 *
 * The chain is read from `predecessor_work_order_id`, **never derived from
 * `sequence`**. Sequence numbers are not contiguous in real routings (the pilot
 * has 1, 3, 4, 5), a split produces several work orders sharing one sequence,
 * and a routing can be edited after the fact — any of which makes "the previous
 * sequence number" the wrong answer. The column says what the chain is; the
 * index on it makes the reverse direction just as cheap.
 *
 * Split-safe by construction: children inherit their parent's predecessor, so a
 * successor asking for its predecessors gets every child of the split rather
 * than a parent that holds no records of its own (§8 A1b).
 */

export interface ProcessChainNode {
  workOrderId: string;
  woNumber: string;
  processId?: string;
  sequence?: number;
  status: WorkOrderStatus;
  plannedQuantity: number;
  inputQuantity: number;
  outputQuantity: number;
  transferredQuantity: number;
  parentWorkOrderId?: string;
  isSplitParent: boolean;
}

export interface ProcessChain {
  workOrder: ProcessChainNode;
  /** Ordered from the first process of the routing up to the immediate predecessor. */
  predecessors: ProcessChainNode[];
  /** The immediate predecessor, or `undefined` for the first process. */
  predecessor?: ProcessChainNode;
  /** Work orders whose `predecessor_work_order_id` is this one. */
  successors: ProcessChainNode[];
  /** True when this work order is the first process of its routing. */
  isFirstProcess: boolean;
  /** True when nothing follows it. */
  isLastProcess: boolean;
  /** §13: `Σ predecessor.transferred − this.input`, 0 at the first process. */
  availableQuantity: number;
}

function toNode(wo: WorkOrder): ProcessChainNode {
  return {
    workOrderId: wo.id,
    woNumber: wo.woNumber,
    processId: wo.processId,
    sequence: wo.sequence,
    status: wo.status,
    plannedQuantity: wo.plannedQuantity,
    inputQuantity: wo.inputQuantity,
    outputQuantity: wo.outputQuantity,
    transferredQuantity: wo.transferredQuantity,
    parentWorkOrderId: wo.parentWorkOrderId,
    isSplitParent: Boolean(wo.hasChildWorkOrder),
  };
}

export class ProcessChainService {
  private readonly workOrders = new WorkOrderRepository();

  /** The immediate predecessor, read from the explicit column. */
  async predecessorOf(
    exec: Executor,
    tenantId: string,
    workOrder: WorkOrder
  ): Promise<WorkOrder | undefined> {
    if (!workOrder.predecessorWorkOrderId) return undefined;
    return this.workOrders.findById(exec, tenantId, workOrder.predecessorWorkOrderId);
  }

  /**
   * Work orders that name `workOrderId` as their predecessor.
   *
   * Found through the index on `predecessor_work_order_id` rather than by
   * scanning for `sequence + 1` (MES-018-1).
   */
  async successorsOf(exec: Executor, tenantId: string, workOrderId: string): Promise<WorkOrder[]> {
    const rows = await exec.query<{ id: string }>(
      `SELECT id FROM work_order
        WHERE tenant_id = $1 AND predecessor_work_order_id = $2
        ORDER BY sequence NULLS LAST, wo_number`,
      [tenantId, workOrderId]
    );
    const found: WorkOrder[] = [];
    for (const row of rows.rows) {
      const wo = await this.workOrders.findById(exec, tenantId, row.id);
      if (wo) found.push(wo);
    }
    return found;
  }

  /**
   * Every work order that hands quantity to this one.
   *
   * After a split the predecessor is a parent that holds no production records
   * of its own, so what actually transferred lives on its children. This
   * resolves that: a parent is replaced by its children, which is what makes
   * "rantai tetap benar setelah Work Order di-split" true.
   */
  async effectivePredecessors(
    exec: Executor,
    tenantId: string,
    workOrder: WorkOrder
  ): Promise<WorkOrder[]> {
    const direct = await this.predecessorOf(exec, tenantId, workOrder);
    if (!direct) return [];
    if (!direct.hasChildWorkOrder) return [direct];

    const children = await exec.query<{ id: string }>(
      `SELECT id FROM work_order WHERE tenant_id = $1 AND parent_work_order_id = $2 ORDER BY wo_number`,
      [tenantId, direct.id]
    );
    const resolved: WorkOrder[] = [];
    for (const row of children.rows) {
      const child = await this.workOrders.findById(exec, tenantId, row.id);
      if (child) resolved.push(child);
    }
    // A parent flagged as split but with no children left is still the honest
    // answer; falling back to it beats reporting no predecessor at all.
    return resolved.length > 0 ? resolved : [direct];
  }

  /** `Σ predecessor.transferred − this.input`, floored at zero (§13). */
  async availableQuantity(exec: Executor, tenantId: string, workOrder: WorkOrder): Promise<number> {
    const predecessors = await this.effectivePredecessors(exec, tenantId, workOrder);
    if (predecessors.length === 0) return 0;
    const transferred = predecessors.reduce((sum, wo) => sum + wo.transferredQuantity, 0);
    return QuantityFlowService.availableQuantity(transferred, workOrder.inputQuantity);
  }

  /** Walks backwards to the first process, following the explicit column. */
  async chainOf(exec: Executor, tenantId: string, workOrderId: string): Promise<ProcessChain> {
    const workOrder = await this.workOrders.findById(exec, tenantId, workOrderId);
    if (!workOrder) throw ApiError.notFound('Work order tidak ditemukan.');

    const predecessors: WorkOrder[] = [];
    const seen = new Set<string>([workOrder.id]);
    let cursor: WorkOrder | undefined = workOrder;

    while (cursor?.predecessorWorkOrderId) {
      // A cycle cannot be created through the API, but a bad migration or a
      // hand-edited row could; walking one forever would hang the request.
      if (seen.has(cursor.predecessorWorkOrderId)) break;
      seen.add(cursor.predecessorWorkOrderId);
      const previous: WorkOrder | undefined = await this.workOrders.findById(
        exec,
        tenantId,
        cursor.predecessorWorkOrderId
      );
      if (!previous) break;
      predecessors.unshift(previous);
      cursor = previous;
    }

    const successors = await this.successorsOf(exec, tenantId, workOrder.id);
    const immediate = predecessors[predecessors.length - 1];

    return {
      workOrder: toNode(workOrder),
      predecessors: predecessors.map(toNode),
      predecessor: immediate ? toNode(immediate) : undefined,
      successors: successors.map(toNode),
      isFirstProcess: !workOrder.predecessorWorkOrderId,
      isLastProcess: successors.length === 0,
      availableQuantity: await this.availableQuantity(exec, tenantId, workOrder),
    };
  }

  /** `GET /v1/work-orders/{id}/chain` (MES-018-3). */
  async getChain(tenantId: string, workOrderId: string): Promise<ProcessChain> {
    return withTenant(tenantId, (client) => this.chainOf(client, tenantId, workOrderId));
  }
}
