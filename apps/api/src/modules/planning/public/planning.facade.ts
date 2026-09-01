import { withTenant } from '../../../platform/db/pool.js';
import type { Executor } from '../../../platform/db/executor.js';
import { CustomerOrderService } from '../application/customer-order.service.js';
import { PlanningReferenceRepository } from '../infrastructure/planning-reference.repository.js';

/**
 * Everything another module is allowed to ask planning (MES-019-2).
 *
 * Kept small on purpose. Each method answers one question a *consumer* has,
 * phrased in the consumer's terms — not a window onto planning's repositories.
 * Widening it is how a module boundary quietly stops being one.
 */

export interface PlanLineDemandView {
  productionPlanLineId: string;
  productId: string;
  plannedQuantity: number;
  demandQuantity: number;
  /** Every Customer Order this plan line is producing for (ADR-22). */
  demands: {
    customerOrderId: string;
    customerOrderNumber: string;
    customerOrderLineId: string;
    customerId: string;
    customerName: string;
    demandQuantity: number;
    requestedDeliveryDate?: string;
  }[];
}

/**
 * The read-only customer view of a Work Order (`GET /v1/work-orders/{id}/demand`).
 *
 * A Work Order stores **no** customer, order or allocation (ADR-22, §25.5). It
 * reaches them through its plan line, which is why this is derived on request
 * and never a column.
 */
export interface WorkOrderDemandView extends PlanLineDemandView {
  workOrderId: string;
}

export class PlanningFacade {
  private readonly orders = new CustomerOrderService();
  private readonly reference = new PlanningReferenceRepository();

  /**
   * Recomputes a Customer Order's derived status (MES-026).
   *
   * Called by whatever changed a production fact — a Work Order starting, output
   * being recorded — so the order's status follows reality without production
   * needing to know the derivation rules.
   */
  async refreshCustomerOrderStatus(tenantId: string, customerOrderId: string): Promise<void> {
    await this.orders.recomputeStatus(tenantId, customerOrderId);
  }

  /** Recomputes every order a plan line serves; used after a WO transition. */
  async refreshOrdersForPlanLine(tenantId: string, productionPlanLineId: string): Promise<number> {
    return withTenant(tenantId, async (client) => {
      const rows = await client.query<{ customer_order_id: string }>(
        `SELECT DISTINCT customer_order_id FROM production_plan_demand
          WHERE tenant_id = $1 AND production_plan_line_id = $2`,
        [tenantId, productionPlanLineId]
      );
      for (const row of rows.rows) {
        await this.orders.refreshStatus(client, tenantId, row.customer_order_id);
      }
      return rows.rows.length;
    });
  }

  /**
   * Records finished goods against the Customer Order lines a plan line serves
   * (§8 A4, §11's COMPLETED effect).
   *
   * Finished goods are the output of the **last process** in the routing, which
   * is why production calls this only when a work order with no successor
   * completes. Aggregating across processes would report 38.750 pcs for an
   * order of 10.000 (§8 A2).
   *
   * One plan line can serve several orders, so the quantity is split pro-rata by
   * each order's `demand_quantity` — the same proportion the demand was
   * aggregated in — capped at what each line still needs. The rounding
   * remainder goes to the earliest requested delivery date, because that is the
   * line most at risk of being reported short.
   */
  async propagateProducedQuantity(
    tenantId: string,
    productionPlanLineId: string,
    outputQuantity: number
  ): Promise<number> {
    if (outputQuantity <= 0) return 0;

    return withTenant(tenantId, async (client) => {
      const demands = await client.query<{
        customer_order_id: string;
        customer_order_line_id: string;
        demand_quantity: number;
        ordered_quantity: number;
        produced_quantity: number;
        requested_delivery_date: string;
      }>(
        `SELECT ppd.customer_order_id, ppd.customer_order_line_id, ppd.demand_quantity,
                col.ordered_quantity, col.produced_quantity,
                to_char(COALESCE(col.requested_delivery_date, co.requested_delivery_date), 'YYYY-MM-DD')
                  AS requested_delivery_date
           FROM production_plan_demand ppd
           JOIN customer_order_line col ON col.id = ppd.customer_order_line_id
           JOIN customer_order co ON co.id = ppd.customer_order_id
          WHERE ppd.tenant_id = $1 AND ppd.production_plan_line_id = $2
          ORDER BY requested_delivery_date, ppd.customer_order_line_id
          FOR UPDATE OF col`,
        [tenantId, productionPlanLineId]
      );
      if (demands.rows.length === 0) return 0;

      const totalDemand = demands.rows.reduce((sum, row) => sum + Number(row.demand_quantity), 0);
      if (totalDemand <= 0) return 0;

      let distributed = 0;
      const shares = demands.rows.map((row) => {
        const remaining = Math.max(Number(row.ordered_quantity) - Number(row.produced_quantity), 0);
        const share = Math.min(
          Math.floor((outputQuantity * Number(row.demand_quantity)) / totalDemand),
          remaining
        );
        distributed += share;
        return { row, share, remaining };
      });

      // Hand the rounding remainder to the earliest delivery date that can
      // still take it.
      let leftover = Math.min(outputQuantity, totalDemand) - distributed;
      for (const entry of shares) {
        if (leftover <= 0) break;
        const room = entry.remaining - entry.share;
        const extra = Math.min(room, leftover);
        entry.share += extra;
        leftover -= extra;
      }

      const touchedOrders = new Set<string>();
      for (const entry of shares) {
        if (entry.share <= 0) continue;
        await client.query(
          `UPDATE customer_order_line
              SET produced_quantity = produced_quantity + $3, updated_at = CURRENT_TIMESTAMP
            WHERE tenant_id = $1 AND id = $2`,
          [tenantId, entry.row.customer_order_line_id, entry.share]
        );
        touchedOrders.add(entry.row.customer_order_id);
      }

      for (const orderId of touchedOrders) {
        await this.orders.refreshStatus(client, tenantId, orderId);
      }
      return touchedOrders.size;
    });
  }

  /** §13's `strict_process_sequence`, for the predecessor guard. */
  async strictProcessSequence(tenantId: string): Promise<boolean> {
    const config = await withTenant(tenantId, (client) => this.reference.getConfig(client, tenantId));
    return config.strictProcessSequence;
  }

  /** The demand behind a plan line, with each contributing Customer Order. */
  async planLineDemand(
    tenantId: string,
    productionPlanLineId: string
  ): Promise<PlanLineDemandView | undefined> {
    return withTenant(tenantId, (client) =>
      this.readPlanLineDemand(client, tenantId, productionPlanLineId)
    );
  }

  /** `GET /v1/work-orders/{id}/demand` — derived, read-only (§25.5). */
  async workOrderDemand(
    tenantId: string,
    workOrderId: string
  ): Promise<WorkOrderDemandView | undefined> {
    return withTenant(tenantId, async (client) => {
      const wo = await client.query<{ production_plan_line_id: string | null }>(
        'SELECT production_plan_line_id FROM work_order WHERE tenant_id = $1 AND id = $2',
        [tenantId, workOrderId]
      );
      const planLineId = wo.rows[0]?.production_plan_line_id;
      if (!planLineId) return undefined;

      const demand = await this.readPlanLineDemand(client, tenantId, planLineId);
      return demand ? { workOrderId, ...demand } : undefined;
    });
  }

  private async readPlanLineDemand(
    exec: Executor,
    tenantId: string,
    productionPlanLineId: string
  ): Promise<PlanLineDemandView | undefined> {
    const line = await exec.query<{
      id: string;
      product_id: string;
      planned_quantity: number;
      demand_quantity: number;
    }>(
      `SELECT id, product_id, planned_quantity, demand_quantity
         FROM production_plan_line WHERE tenant_id = $1 AND id = $2`,
      [tenantId, productionPlanLineId]
    );
    const row = line.rows[0];
    if (!row) return undefined;

    const demands = await exec.query<{
      customer_order_id: string;
      order_number: string;
      customer_order_line_id: string;
      customer_id: string;
      customer_name: string;
      demand_quantity: number;
      requested_delivery_date: string | null;
    }>(
      `SELECT ppd.customer_order_id, co.order_number, ppd.customer_order_line_id,
              co.customer_id, c.name AS customer_name, ppd.demand_quantity,
              to_char(COALESCE(col.requested_delivery_date, co.requested_delivery_date), 'YYYY-MM-DD')
                AS requested_delivery_date
         FROM production_plan_demand ppd
         JOIN customer_order co ON co.id = ppd.customer_order_id
         JOIN customer c ON c.id = co.customer_id
         JOIN customer_order_line col ON col.id = ppd.customer_order_line_id
        WHERE ppd.tenant_id = $1 AND ppd.production_plan_line_id = $2
        ORDER BY co.order_number, col.line_no`,
      [tenantId, productionPlanLineId]
    );

    return {
      productionPlanLineId: row.id,
      productId: row.product_id,
      plannedQuantity: Number(row.planned_quantity),
      demandQuantity: Number(row.demand_quantity),
      demands: demands.rows.map((d) => ({
        customerOrderId: d.customer_order_id,
        customerOrderNumber: d.order_number,
        customerOrderLineId: d.customer_order_line_id,
        customerId: d.customer_id,
        customerName: d.customer_name,
        demandQuantity: Number(d.demand_quantity),
        requestedDeliveryDate: d.requested_delivery_date ?? undefined,
      })),
    };
  }
}
