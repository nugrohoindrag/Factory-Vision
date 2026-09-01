import { randomUUID } from 'crypto';
import type { Mold, ProductMoldCompatibility } from '@factory-vision/domain-types';
import { asOptionalIsoString, orUndefined, type Executor } from '../../platform/db/executor.js';

/**
 * `mold` and `product_mold_compatibility` (MES-006).
 *
 * Both tables have existed since migration 008 and both were already read —
 * `product_mold_compatibility` is what ADR-36 consults to decide whether a Work
 * Order needs a mold before it can be confirmed. Nothing could write them: the
 * route permissions named `/api/v1/molds*` and no router answered there, so a
 * pilot factory could only get moulds into the system with `psql`.
 *
 * Compatibility is deactivated rather than deleted wherever a Work Order might
 * already have been confirmed against it. The row is the evidence for why that
 * confirmation was allowed, and evidence that disappears when the rule changes
 * is not evidence.
 */

export interface MoldWithCompatibility extends Mold {
  compatibilities: Array<
    ProductMoldCompatibility & { productSku?: string; productName?: string }
  >;
  currentMachineName?: string;
}

interface MoldRow {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  cavity_count: number;
  status: string;
  current_machine_id: string | null;
  current_machine_name?: string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
}

interface CompatibilityRow {
  id: string;
  tenant_id: string;
  product_id: string;
  mold_id: string;
  active: boolean;
  created_at: Date | string | null;
  product_sku?: string | null;
  product_name?: string | null;
}

const MOLD_COLUMNS = `
  m.id, m.tenant_id, m.code, m.name, m.cavity_count, m.status, m.current_machine_id,
  m.created_at, m.updated_at
`;

function toMold(row: MoldRow): Mold & { currentMachineName?: string } {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    code: row.code,
    name: row.name,
    cavityCount: Number(row.cavity_count),
    status: row.status as Mold['status'],
    currentMachineId: orUndefined(row.current_machine_id),
    currentMachineName: orUndefined(row.current_machine_name ?? null),
    createdAt: asOptionalIsoString(row.created_at),
    updatedAt: asOptionalIsoString(row.updated_at),
  };
}

function toCompatibility(
  row: CompatibilityRow
): ProductMoldCompatibility & { productSku?: string; productName?: string } {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    productId: row.product_id,
    moldId: row.mold_id,
    active: row.active,
    createdAt: asOptionalIsoString(row.created_at),
    productSku: orUndefined(row.product_sku ?? null),
    productName: orUndefined(row.product_name ?? null),
  };
}

export interface MoldFilter {
  status?: string;
  search?: string;
  /** Only moulds compatible with this product, per an active compatibility. */
  productId?: string;
  machineId?: string;
}

export interface MoldInput {
  code: string;
  name: string;
  cavityCount: number;
  status?: string;
  currentMachineId?: string | null;
}

export class MoldRepository {
  async list(exec: Executor, tenantId: string, filter: MoldFilter = {}): Promise<Mold[]> {
    const where = ['m.tenant_id = $1'];
    const params: unknown[] = [tenantId];

    if (filter.status) {
      params.push(filter.status);
      where.push(`m.status = $${params.length}`);
    }
    if (filter.machineId) {
      params.push(filter.machineId);
      where.push(`m.current_machine_id = $${params.length}`);
    }
    if (filter.search) {
      params.push(`%${filter.search.toLowerCase()}%`);
      where.push(`(lower(m.code) LIKE $${params.length} OR lower(m.name) LIKE $${params.length})`);
    }
    if (filter.productId) {
      params.push(filter.productId);
      // Only an *active* compatibility counts. A deactivated row is history —
      // it explains a past confirmation, it does not offer a mould today.
      where.push(
        `EXISTS (
           SELECT 1 FROM product_mold_compatibility c
            WHERE c.tenant_id = m.tenant_id AND c.mold_id = m.id
              AND c.product_id = $${params.length} AND c.active = TRUE
         )`
      );
    }

    const result = await exec.query<MoldRow>(
      `SELECT ${MOLD_COLUMNS}, mc.name AS current_machine_name
         FROM mold m
         LEFT JOIN machine mc ON mc.id = m.current_machine_id AND mc.tenant_id = m.tenant_id
        WHERE ${where.join(' AND ')}
        ORDER BY m.code`,
      params
    );
    return result.rows.map(toMold);
  }

  async findById(exec: Executor, tenantId: string, id: string): Promise<Mold | undefined> {
    const result = await exec.query<MoldRow>(
      `SELECT ${MOLD_COLUMNS}, mc.name AS current_machine_name
         FROM mold m
         LEFT JOIN machine mc ON mc.id = m.current_machine_id AND mc.tenant_id = m.tenant_id
        WHERE m.tenant_id = $1 AND m.id = $2`,
      [tenantId, id]
    );
    return result.rows[0] ? toMold(result.rows[0]) : undefined;
  }

  async findByCode(exec: Executor, tenantId: string, code: string): Promise<Mold | undefined> {
    const result = await exec.query<MoldRow>(
      `SELECT ${MOLD_COLUMNS}, NULL AS current_machine_name
         FROM mold m WHERE m.tenant_id = $1 AND lower(m.code) = lower($2)`,
      [tenantId, code]
    );
    return result.rows[0] ? toMold(result.rows[0]) : undefined;
  }

  async create(exec: Executor, tenantId: string, input: MoldInput): Promise<Mold> {
    const result = await exec.query<MoldRow>(
      `INSERT INTO mold (id, tenant_id, code, name, cavity_count, status, current_machine_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${MOLD_COLUMNS.replace(/m\./g, '')}, NULL AS current_machine_name`,
      [
        `mold-${randomUUID()}`,
        tenantId,
        input.code,
        input.name,
        input.cavityCount,
        input.status ?? 'AVAILABLE',
        input.currentMachineId ?? null,
      ]
    );
    return toMold(result.rows[0]);
  }

  async update(
    exec: Executor,
    tenantId: string,
    id: string,
    changes: Partial<MoldInput>
  ): Promise<Mold | undefined> {
    const sets: string[] = [];
    const params: unknown[] = [tenantId, id];

    const push = (column: string, value: unknown): void => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };

    if (changes.code !== undefined) push('code', changes.code);
    if (changes.name !== undefined) push('name', changes.name);
    if (changes.cavityCount !== undefined) push('cavity_count', changes.cavityCount);
    if (changes.status !== undefined) push('status', changes.status);
    // `null` is meaningful here — it detaches the mould from its machine — so
    // the check is for `undefined`, which means "not mentioned in this PATCH".
    if (changes.currentMachineId !== undefined) push('current_machine_id', changes.currentMachineId);

    if (sets.length === 0) return this.findById(exec, tenantId, id);

    sets.push('updated_at = CURRENT_TIMESTAMP');
    const result = await exec.query<MoldRow>(
      `UPDATE mold SET ${sets.join(', ')}
        WHERE tenant_id = $1 AND id = $2
       RETURNING ${MOLD_COLUMNS.replace(/m\./g, '')}, NULL AS current_machine_name`,
      params
    );
    return result.rows[0] ? toMold(result.rows[0]) : undefined;
  }

  async remove(exec: Executor, tenantId: string, id: string): Promise<boolean> {
    const result = await exec.query(`DELETE FROM mold WHERE tenant_id = $1 AND id = $2`, [
      tenantId,
      id,
    ]);
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Counts the production references that make a mould undeletable.
   *
   * A mould named by a Work Order or a batch is part of that record's history.
   * Deleting it would either break the foreign key or, worse, silently lose why
   * a confirmation was allowed.
   */
  async referenceCounts(
    exec: Executor,
    tenantId: string,
    id: string
  ): Promise<{ workOrders: number; batches: number; compatibilities: number }> {
    const result = await exec.query<{ work_orders: string; batches: string; compat: string }>(
      `SELECT
         (SELECT count(*) FROM work_order WHERE tenant_id = $1 AND mold_id = $2)::text AS work_orders,
         (SELECT count(*) FROM production_batch WHERE tenant_id = $1 AND mold_id = $2)::text AS batches,
         (SELECT count(*) FROM product_mold_compatibility WHERE tenant_id = $1 AND mold_id = $2)::text AS compat`,
      [tenantId, id]
    );
    const row = result.rows[0];
    return {
      workOrders: Number(row?.work_orders ?? 0),
      batches: Number(row?.batches ?? 0),
      compatibilities: Number(row?.compat ?? 0),
    };
  }

  // --- Compatibility --------------------------------------------------

  async listCompatibilities(
    exec: Executor,
    tenantId: string,
    filter: { moldId?: string; productId?: string; activeOnly?: boolean } = {}
  ): Promise<Array<ProductMoldCompatibility & { productSku?: string; productName?: string }>> {
    const where = ['c.tenant_id = $1'];
    const params: unknown[] = [tenantId];
    if (filter.moldId) {
      params.push(filter.moldId);
      where.push(`c.mold_id = $${params.length}`);
    }
    if (filter.productId) {
      params.push(filter.productId);
      where.push(`c.product_id = $${params.length}`);
    }
    if (filter.activeOnly) where.push('c.active = TRUE');

    const result = await exec.query<CompatibilityRow>(
      `SELECT c.id, c.tenant_id, c.product_id, c.mold_id, c.active, c.created_at,
              p.sku AS product_sku, p.name AS product_name
         FROM product_mold_compatibility c
         LEFT JOIN product p ON p.id = c.product_id AND p.tenant_id = c.tenant_id
        WHERE ${where.join(' AND ')}
        ORDER BY p.sku NULLS LAST, c.created_at`,
      params
    );
    return result.rows.map(toCompatibility);
  }

  async findCompatibility(
    exec: Executor,
    tenantId: string,
    id: string
  ): Promise<ProductMoldCompatibility | undefined> {
    const result = await exec.query<CompatibilityRow>(
      `SELECT id, tenant_id, product_id, mold_id, active, created_at
         FROM product_mold_compatibility WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id]
    );
    return result.rows[0] ? toCompatibility(result.rows[0]) : undefined;
  }

  /**
   * Links a product to a mould, reactivating a link that already exists.
   *
   * `uq_prod_mold_compat` makes the pair unique, so re-adding a previously
   * deactivated link has to reactivate it rather than fail — the alternative
   * would be an operator seeing "already exists" for a row they cannot see.
   */
  async upsertCompatibility(
    exec: Executor,
    tenantId: string,
    moldId: string,
    productId: string,
    active = true
  ): Promise<ProductMoldCompatibility> {
    const result = await exec.query<CompatibilityRow>(
      `INSERT INTO product_mold_compatibility (id, tenant_id, product_id, mold_id, active)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, product_id, mold_id)
       DO UPDATE SET active = EXCLUDED.active
       RETURNING id, tenant_id, product_id, mold_id, active, created_at`,
      [`pmc-${randomUUID()}`, tenantId, productId, moldId, active]
    );
    return toCompatibility(result.rows[0]);
  }

  async setCompatibilityActive(
    exec: Executor,
    tenantId: string,
    id: string,
    active: boolean
  ): Promise<ProductMoldCompatibility | undefined> {
    const result = await exec.query<CompatibilityRow>(
      `UPDATE product_mold_compatibility SET active = $3
        WHERE tenant_id = $1 AND id = $2
       RETURNING id, tenant_id, product_id, mold_id, active, created_at`,
      [tenantId, id, active]
    );
    return result.rows[0] ? toCompatibility(result.rows[0]) : undefined;
  }

  /** Whether a product exists in this tenant, for a clear 422 rather than a FK error. */
  async productExists(exec: Executor, tenantId: string, productId: string): Promise<boolean> {
    const result = await exec.query(`SELECT 1 FROM product WHERE tenant_id = $1 AND id = $2`, [
      tenantId,
      productId,
    ]);
    return (result.rowCount ?? 0) > 0;
  }

  async machineExists(exec: Executor, tenantId: string, machineId: string): Promise<boolean> {
    const result = await exec.query(`SELECT 1 FROM machine WHERE tenant_id = $1 AND id = $2`, [
      tenantId,
      machineId,
    ]);
    return (result.rowCount ?? 0) > 0;
  }
}
