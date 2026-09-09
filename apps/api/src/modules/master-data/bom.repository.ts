import type { BillOfMaterial, BillOfMaterialItem, BillOfMaterialStatus } from '@factory-vision/domain-types';
import { asDateString, asIsoString, orUndefined, type Executor } from '../../platform/db/executor.js';

/**
 * `bill_of_material` and `bill_of_material_item` (migration 022).
 *
 * The schema shipped with 022; nothing read or wrote it, so a BOM lived in an
 * array and every restart lost it. Material planning explodes the BOM to get a
 * requirement, and a requirement that cannot be traced back to a stored BOM is
 * not traceable at all (Improvement PRD §37, §49) — so the BOM becomes a
 * projection of the database like the rest of the master data.
 *
 * A component's SKU and name are joined from `product` rather than copied: the
 * BOM is master data, and master data reads current names.
 */
interface BomRow {
  id: string;
  tenant_id: string;
  bom_number: string;
  product_id: string;
  product_sku: string;
  product_name: string;
  product_revision: string | null;
  bom_name: string;
  version: string;
  status: string;
  effective_date: Date | string;
  end_date: Date | string | null;
  description: string | null;
  created_by: string | null;
  created_at: Date | string;
  updated_by: string | null;
  updated_at: Date | string;
}

interface ItemRow {
  id: string;
  bom_id: string;
  line_number: number;
  component_part_id: string;
  component_sku: string | null;
  component_name: string | null;
  component_type: string;
  quantity: string | number;
  uom: string;
  scrap_percentage: string | number | null;
  sequence: number | null;
  reference: string | null;
  notes: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function toItem(row: ItemRow): BillOfMaterialItem {
  return {
    id: row.id,
    bomId: row.bom_id,
    lineNumber: row.line_number,
    componentPartId: row.component_part_id,
    componentPartSku: row.component_sku ?? row.component_part_id,
    componentPartName: row.component_name ?? 'Component Part',
    componentType: row.component_type as BillOfMaterialItem['componentType'],
    quantity: Number(row.quantity),
    uom: row.uom,
    scrapPercentage: row.scrap_percentage === null ? 0 : Number(row.scrap_percentage),
    sequence: row.sequence ?? row.line_number,
    reference: orUndefined(row.reference),
    notes: orUndefined(row.notes),
    createdAt: asIsoString(row.created_at),
    updatedAt: asIsoString(row.updated_at),
  };
}

function toDomain(row: BomRow, components: BillOfMaterialItem[]): BillOfMaterial {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    bomNumber: row.bom_number,
    productId: row.product_id,
    productSku: row.product_sku,
    productName: row.product_name,
    productRevision: orUndefined(row.product_revision),
    bomName: row.bom_name,
    version: row.version,
    status: row.status as BillOfMaterialStatus,
    effectiveDate: asDateString(row.effective_date),
    endDate: row.end_date ? asDateString(row.end_date) : undefined,
    description: orUndefined(row.description),
    components,
    createdBy: orUndefined(row.created_by),
    createdAt: asIsoString(row.created_at),
    updatedBy: orUndefined(row.updated_by),
    updatedAt: asIsoString(row.updated_at),
  };
}

export class BomRepository {
  async list(exec: Executor, tenantId: string): Promise<BillOfMaterial[]> {
    const boms = await exec.query<BomRow>(
      `SELECT b.id, b.tenant_id, b.bom_number, b.product_id, p.sku AS product_sku, p.name AS product_name,
              b.product_revision, b.bom_name, b.version, b.status, b.effective_date, b.end_date,
              b.description, b.created_by, b.created_at, b.updated_by, b.updated_at
         FROM bill_of_material b
         JOIN product p ON p.id = b.product_id
        WHERE b.tenant_id = $1
        ORDER BY b.created_at DESC`,
      [tenantId]
    );
    if (boms.rows.length === 0) return [];

    const items = await exec.query<ItemRow>(
      `SELECT i.id, i.bom_id, i.line_number, i.component_part_id, c.sku AS component_sku,
              c.name AS component_name, i.component_type, i.quantity, i.uom, i.scrap_percentage,
              i.sequence, i.reference, i.notes, i.created_at, i.updated_at
         FROM bill_of_material_item i
         LEFT JOIN product c ON c.id = i.component_part_id
        WHERE i.tenant_id = $1
        ORDER BY i.line_number`,
      [tenantId]
    );

    const byBom = new Map<string, BillOfMaterialItem[]>();
    for (const row of items.rows) {
      const list = byBom.get(row.bom_id) ?? [];
      list.push(toItem(row));
      byBom.set(row.bom_id, list);
    }

    return boms.rows.map((row) => toDomain(row, byBom.get(row.id) ?? []));
  }

  /** The BOM a requirement should be exploded from: ACTIVE, and in date. */
  async findActiveForProduct(
    exec: Executor,
    tenantId: string,
    productId: string
  ): Promise<BillOfMaterial | undefined> {
    const result = await exec.query<BomRow>(
      `SELECT b.id, b.tenant_id, b.bom_number, b.product_id, p.sku AS product_sku, p.name AS product_name,
              b.product_revision, b.bom_name, b.version, b.status, b.effective_date, b.end_date,
              b.description, b.created_by, b.created_at, b.updated_by, b.updated_at
         FROM bill_of_material b
         JOIN product p ON p.id = b.product_id
        WHERE b.tenant_id = $1 AND b.product_id = $2 AND b.status = 'ACTIVE'
          AND b.effective_date <= CURRENT_DATE
          AND (b.end_date IS NULL OR b.end_date >= CURRENT_DATE)
        ORDER BY b.effective_date DESC
        LIMIT 1`,
      [tenantId, productId]
    );
    const row = result.rows[0];
    if (!row) return undefined;

    const items = await exec.query<ItemRow>(
      `SELECT i.id, i.bom_id, i.line_number, i.component_part_id, c.sku AS component_sku,
              c.name AS component_name, i.component_type, i.quantity, i.uom, i.scrap_percentage,
              i.sequence, i.reference, i.notes, i.created_at, i.updated_at
         FROM bill_of_material_item i
         LEFT JOIN product c ON c.id = i.component_part_id
        WHERE i.bom_id = $1
        ORDER BY i.line_number`,
      [row.id]
    );
    return toDomain(row, items.rows.map(toItem));
  }

  /**
   * Writes the header and replaces the component list.
   *
   * Replace rather than merge: a BOM's lines are renumbered on every edit, so
   * matching old rows to new ones would be guesswork. The delete and the
   * inserts share the caller's transaction, so a BOM is never briefly empty.
   */
  async upsert(exec: Executor, bom: BillOfMaterial): Promise<void> {
    await exec.query(
      `INSERT INTO bill_of_material (
         id, tenant_id, bom_number, product_id, product_revision, bom_name, version, status,
         effective_date, end_date, description, created_by, created_at, updated_by, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (id) DO UPDATE SET
         bom_number = EXCLUDED.bom_number,
         product_id = EXCLUDED.product_id,
         product_revision = EXCLUDED.product_revision,
         bom_name = EXCLUDED.bom_name,
         version = EXCLUDED.version,
         status = EXCLUDED.status,
         effective_date = EXCLUDED.effective_date,
         end_date = EXCLUDED.end_date,
         description = EXCLUDED.description,
         updated_by = EXCLUDED.updated_by,
         updated_at = EXCLUDED.updated_at`,
      [
        bom.id,
        bom.tenantId,
        bom.bomNumber,
        bom.productId,
        bom.productRevision ?? null,
        bom.bomName,
        bom.version,
        bom.status,
        bom.effectiveDate,
        bom.endDate ?? null,
        bom.description ?? null,
        bom.createdBy ?? null,
        bom.createdAt,
        bom.updatedBy ?? null,
        bom.updatedAt,
      ]
    );

    await exec.query('DELETE FROM bill_of_material_item WHERE bom_id = $1', [bom.id]);
    for (const item of bom.components) {
      await exec.query(
        `INSERT INTO bill_of_material_item (
           id, bom_id, tenant_id, line_number, component_part_id, component_type,
           quantity, uom, scrap_percentage, sequence, reference, notes, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          item.id,
          bom.id,
          bom.tenantId,
          item.lineNumber,
          item.componentPartId,
          item.componentType,
          item.quantity,
          item.uom,
          item.scrapPercentage ?? 0,
          item.sequence ?? item.lineNumber,
          item.reference ?? null,
          item.notes ?? null,
          item.createdAt ?? bom.createdAt,
          item.updatedAt ?? bom.updatedAt,
        ]
      );
    }
  }

  async setStatus(exec: Executor, tenantId: string, id: string, status: BillOfMaterialStatus): Promise<void> {
    await exec.query(
      'UPDATE bill_of_material SET status = $3, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = $1 AND id = $2',
      [tenantId, id, status]
    );
  }

  /** Supersedes whatever else was ACTIVE for the product, so exactly one is. */
  async deactivateOthers(exec: Executor, tenantId: string, productId: string, keepId: string): Promise<void> {
    await exec.query(
      `UPDATE bill_of_material
          SET status = 'INACTIVE', updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = $1 AND product_id = $2 AND id <> $3 AND status = 'ACTIVE'`,
      [tenantId, productId, keepId]
    );
  }

  async delete(exec: Executor, tenantId: string, id: string): Promise<void> {
    await exec.query('DELETE FROM bill_of_material WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
  }
}
