import { ProductionOrderStatus } from '@factory-vision/domain-types';
import type { ProductionOrder } from '@factory-vision/domain-types';
import { asDateString, asIsoString, type Executor } from '../../platform/db/executor.js';

/**
 * `production_order` (persistence fix §18, phase 3).
 *
 * Work orders reference a production order by foreign key, so this has to be
 * durable before anything below it can be. `due_date` is a DATE and is read
 * with `to_char` for the same reason `shift_date` is: node-postgres would hand
 * back local midnight and shift the date by a day west of the server.
 */
const COLUMNS = `
  id, tenant_id, order_number, product_id, quantity,
  to_char(due_date, 'YYYY-MM-DD') AS due_date, status, created_by, created_at
`;

interface Row {
  id: string;
  tenant_id: string;
  order_number: string;
  product_id: string;
  quantity: number;
  due_date: string;
  status: string | null;
  created_by: string | null;
  created_at: Date | string;
}

function toDomain(row: Row): ProductionOrder {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    orderNumber: row.order_number,
    productId: row.product_id,
    quantity: Number(row.quantity ?? 0),
    dueDate: asDateString(row.due_date),
    status: (row.status as ProductionOrderStatus) ?? ProductionOrderStatus.DRAFT,
    createdBy: row.created_by ?? '',
    createdAt: asIsoString(row.created_at),
  };
}

export class ProductionOrderRepository {
  async create(exec: Executor, order: ProductionOrder): Promise<ProductionOrder> {
    const result = await exec.query<Row>(
      `INSERT INTO production_order (id, tenant_id, order_number, product_id, quantity, due_date, status, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO NOTHING
       RETURNING ${COLUMNS}`,
      [
        order.id,
        order.tenantId,
        order.orderNumber,
        order.productId,
        order.quantity,
        order.dueDate,
        order.status,
        order.createdBy,
        order.createdAt,
      ]
    );
    if (result.rows[0]) return toDomain(result.rows[0]);
    const existing = await this.findById(exec, order.tenantId, order.id);
    if (!existing) throw new Error(`production_order ${order.id} could not be created or read back.`);
    return existing;
  }

  async findById(exec: Executor, tenantId: string, id: string): Promise<ProductionOrder | undefined> {
    const result = await exec.query<Row>(
      `SELECT ${COLUMNS} FROM production_order WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id]
    );
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async list(
    exec: Executor,
    tenantId: string,
    filter: { limit?: number; offset?: number } = {}
  ): Promise<ProductionOrder[]> {
    const result = await exec.query<Row>(
      `SELECT ${COLUMNS} FROM production_order
        WHERE tenant_id = $1
        ORDER BY due_date ASC, id ASC
        LIMIT $2 OFFSET $3`,
      [tenantId, Math.min(filter.limit ?? 2000, 20000), filter.offset ?? 0]
    );
    return result.rows.map(toDomain);
  }

  async update(
    exec: Executor,
    tenantId: string,
    id: string,
    patch: Partial<Omit<ProductionOrder, 'id' | 'tenantId'>>
  ): Promise<ProductionOrder | undefined> {
    const result = await exec.query<Row>(
      `UPDATE production_order
          SET order_number = COALESCE($3, order_number),
              product_id   = COALESCE($4, product_id),
              quantity     = COALESCE($5, quantity),
              due_date     = COALESCE($6::date, due_date),
              status       = COALESCE($7, status)
        WHERE tenant_id = $1 AND id = $2
        RETURNING ${COLUMNS}`,
      [
        tenantId,
        id,
        patch.orderNumber ?? null,
        patch.productId ?? null,
        patch.quantity ?? null,
        patch.dueDate ?? null,
        patch.status ?? null,
      ]
    );
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async delete(exec: Executor, tenantId: string, id: string): Promise<boolean> {
    const result = await exec.query('DELETE FROM production_order WHERE tenant_id = $1 AND id = $2', [
      tenantId,
      id,
    ]);
    return (result.rowCount ?? 0) > 0;
  }

  async count(exec: Executor, tenantId: string): Promise<number> {
    const result = await exec.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM production_order WHERE tenant_id = $1',
      [tenantId]
    );
    return Number(result.rows[0]?.n ?? 0);
  }
}
