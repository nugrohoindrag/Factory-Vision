import type {
  ConsumptionStatus,
  MaterialConsumption,
  MaterialInventory,
  MaterialRequirement,
  MaterialReservation,
  MaterialState,
  MaterialTransaction,
} from '@factory-vision/domain-types';
import { asDateString, asIsoString, orUndefined, type Executor } from '../../platform/db/executor.js';

/**
 * Material inventory, reservations, requirements, consumption and the stock
 * ledger (migration 027).
 *
 * Everything that changes stock goes through `applyMovement`, which updates
 * `material_inventory` and appends the `material_transaction` that explains
 * it. Two writers, one for the balance and one for the ledger, would
 * eventually disagree, and the ledger is the thing an auditor reads.
 */

interface InventoryRow {
  id: string;
  tenant_id: string;
  material_id: string;
  material_sku: string;
  material_name: string;
  warehouse_id: string;
  warehouse_name: string;
  uom: string;
  on_hand_quantity: string;
  reserved_quantity: string;
  incoming_quantity: string;
  available_quantity: string;
  reorder_point: string | null;
  safety_stock: string | null;
  state: string;
  updated_at: Date | string;
}

const INVENTORY_SELECT = `
  SELECT i.id, i.tenant_id, i.material_id, p.sku AS material_sku, p.name AS material_name,
         i.warehouse_id, w.name AS warehouse_name, i.uom,
         i.on_hand_quantity, i.reserved_quantity, i.incoming_quantity, i.available_quantity,
         i.reorder_point, i.safety_stock, i.state, i.updated_at
    FROM material_inventory i
    JOIN product p ON p.id = i.material_id
    JOIN warehouse w ON w.id = i.warehouse_id
`;

function toInventory(row: InventoryRow): MaterialInventory {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    materialId: row.material_id,
    materialSku: row.material_sku,
    materialName: row.material_name,
    warehouseId: row.warehouse_id,
    warehouseName: row.warehouse_name,
    uom: row.uom,
    onHandQuantity: Number(row.on_hand_quantity),
    reservedQuantity: Number(row.reserved_quantity),
    incomingQuantity: Number(row.incoming_quantity),
    availableQuantity: Number(row.available_quantity),
    reorderPoint: row.reorder_point === null ? undefined : Number(row.reorder_point),
    safetyStock: row.safety_stock === null ? undefined : Number(row.safety_stock),
    state: row.state as MaterialState,
    updatedAt: asIsoString(row.updated_at),
  };
}

export interface Warehouse {
  id: string;
  tenantId: string;
  plantId?: string;
  code: string;
  name: string;
  warehouseType: string;
  status: string;
}

/** A stock movement: what moved, by how much, and why. */
export interface MovementInput {
  tenantId: string;
  materialId: string;
  warehouseId: string;
  transactionType: MaterialTransaction['transactionType'];
  /** Signed delta on `on_hand`. Negative issues stock, positive receives it. */
  onHandDelta: number;
  /** Signed delta on `reserved`. */
  reservedDelta?: number;
  /** Signed delta on `incoming`. */
  incomingDelta?: number;
  uom: string;
  referenceType?: string;
  referenceId?: string;
  reason?: string;
  actorId: string;
  actorName?: string;
}

export class MaterialRepository {
  // --- Warehouse ----------------------------------------------------

  async listWarehouses(exec: Executor, tenantId: string): Promise<Warehouse[]> {
    const result = await exec.query<{
      id: string;
      tenant_id: string;
      plant_id: string | null;
      code: string;
      name: string;
      warehouse_type: string;
      status: string;
    }>(
      `SELECT id, tenant_id, plant_id, code, name, warehouse_type, status
         FROM warehouse WHERE tenant_id = $1 ORDER BY code`,
      [tenantId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      plantId: orUndefined(row.plant_id),
      code: row.code,
      name: row.name,
      warehouseType: row.warehouse_type,
      status: row.status,
    }));
  }

  async upsertWarehouse(exec: Executor, warehouse: Warehouse): Promise<void> {
    await exec.query(
      `INSERT INTO warehouse (id, tenant_id, plant_id, code, name, warehouse_type, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET
         plant_id = EXCLUDED.plant_id, code = EXCLUDED.code, name = EXCLUDED.name,
         warehouse_type = EXCLUDED.warehouse_type, status = EXCLUDED.status`,
      [
        warehouse.id,
        warehouse.tenantId,
        warehouse.plantId ?? null,
        warehouse.code,
        warehouse.name,
        warehouse.warehouseType,
        warehouse.status,
      ]
    );
  }

  /**
   * The warehouse stock is issued from when the caller did not name one.
   *
   * A mid-market plant runs one raw-material store; asking an operator which
   * warehouse a consumption came out of would be a question with one answer.
   */
  async defaultWarehouse(exec: Executor, tenantId: string): Promise<Warehouse | undefined> {
    const rows = await this.listWarehouses(exec, tenantId);
    return rows.find((w) => w.warehouseType === 'RAW_MATERIAL' && w.status === 'ACTIVE') ?? rows[0];
  }

  // --- Inventory ----------------------------------------------------

  async listInventory(
    exec: Executor,
    tenantId: string,
    filter: { materialId?: string; warehouseId?: string; belowReorder?: boolean; search?: string } = {}
  ): Promise<MaterialInventory[]> {
    const where = ['i.tenant_id = $1'];
    const params: unknown[] = [tenantId];

    if (filter.materialId) {
      params.push(filter.materialId);
      where.push(`i.material_id = $${params.length}`);
    }
    if (filter.warehouseId) {
      params.push(filter.warehouseId);
      where.push(`i.warehouse_id = $${params.length}`);
    }
    if (filter.belowReorder) {
      where.push('i.reorder_point IS NOT NULL AND i.available_quantity <= i.reorder_point');
    }
    if (filter.search) {
      params.push(`%${filter.search.toLowerCase()}%`);
      where.push(`(lower(p.sku) LIKE $${params.length} OR lower(p.name) LIKE $${params.length})`);
    }

    const result = await exec.query<InventoryRow>(
      `${INVENTORY_SELECT} WHERE ${where.join(' AND ')} ORDER BY p.sku, w.code`,
      params
    );
    return result.rows.map(toInventory);
  }

  async findInventory(
    exec: Executor,
    tenantId: string,
    materialId: string,
    warehouseId: string
  ): Promise<MaterialInventory | undefined> {
    const result = await exec.query<InventoryRow>(
      `${INVENTORY_SELECT} WHERE i.tenant_id = $1 AND i.material_id = $2 AND i.warehouse_id = $3`,
      [tenantId, materialId, warehouseId]
    );
    return result.rows[0] ? toInventory(result.rows[0]) : undefined;
  }

  /**
   * Stock of one material across every warehouse.
   *
   * Availability is asked plant-wide — "do we have 10,000 of RM-001" — and
   * only drilled into by warehouse afterwards (§3.1).
   */
  async totalsByMaterial(
    exec: Executor,
    tenantId: string,
    materialIds: string[]
  ): Promise<Map<string, { onHand: number; reserved: number; incoming: number; available: number; uom: string }>> {
    const totals = new Map<
      string,
      { onHand: number; reserved: number; incoming: number; available: number; uom: string }
    >();
    if (materialIds.length === 0) return totals;

    const result = await exec.query<{
      material_id: string;
      on_hand: string;
      reserved: string;
      incoming: string;
      available: string;
      uom: string;
    }>(
      `SELECT material_id,
              sum(on_hand_quantity)::text AS on_hand,
              sum(reserved_quantity)::text AS reserved,
              sum(incoming_quantity)::text AS incoming,
              sum(available_quantity)::text AS available,
              min(uom) AS uom
         FROM material_inventory
        WHERE tenant_id = $1 AND material_id = ANY($2::varchar[])
        GROUP BY material_id`,
      [tenantId, materialIds]
    );

    for (const row of result.rows) {
      totals.set(row.material_id, {
        onHand: Number(row.on_hand),
        reserved: Number(row.reserved),
        incoming: Number(row.incoming),
        available: Number(row.available),
        uom: row.uom,
      });
    }
    return totals;
  }

  async upsertInventory(
    exec: Executor,
    input: {
      tenantId: string;
      materialId: string;
      warehouseId: string;
      uom: string;
      onHandQuantity: number;
      reservedQuantity?: number;
      incomingQuantity?: number;
      reorderPoint?: number;
      safetyStock?: number;
      state?: MaterialState;
    }
  ): Promise<void> {
    const reserved = input.reservedQuantity ?? 0;
    const incoming = input.incomingQuantity ?? 0;
    await exec.query(
      `INSERT INTO material_inventory (
         id, tenant_id, material_id, warehouse_id, uom,
         on_hand_quantity, reserved_quantity, incoming_quantity, available_quantity,
         reorder_point, safety_stock, state, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, CURRENT_TIMESTAMP)
       ON CONFLICT (tenant_id, material_id, warehouse_id) DO UPDATE SET
         uom = EXCLUDED.uom,
         on_hand_quantity = EXCLUDED.on_hand_quantity,
         reserved_quantity = EXCLUDED.reserved_quantity,
         incoming_quantity = EXCLUDED.incoming_quantity,
         available_quantity = EXCLUDED.available_quantity,
         reorder_point = EXCLUDED.reorder_point,
         safety_stock = EXCLUDED.safety_stock,
         state = EXCLUDED.state,
         updated_at = CURRENT_TIMESTAMP`,
      [
        `minv-${input.materialId}-${input.warehouseId}`,
        input.tenantId,
        input.materialId,
        input.warehouseId,
        input.uom,
        input.onHandQuantity,
        reserved,
        incoming,
        input.onHandQuantity - reserved + incoming,
        input.reorderPoint ?? null,
        input.safetyStock ?? null,
        input.state ?? 'AVAILABLE',
      ]
    );
  }

  /**
   * Applies one stock movement and writes its ledger entry.
   *
   * `available` is recomputed from the three quantities in the same statement,
   * so the stored figure can never drift from the formula in §3.1. The row is
   * created on demand: a plant that receives a material it has never stocked
   * should not have to declare it first.
   */
  async applyMovement(exec: Executor, movement: MovementInput): Promise<MaterialTransaction> {
    const reservedDelta = movement.reservedDelta ?? 0;
    const incomingDelta = movement.incomingDelta ?? 0;

    const updated = await exec.query<{ on_hand: string; available: string }>(
      `INSERT INTO material_inventory (
         id, tenant_id, material_id, warehouse_id, uom,
         on_hand_quantity, reserved_quantity, incoming_quantity, available_quantity, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, CURRENT_TIMESTAMP)
       ON CONFLICT (tenant_id, material_id, warehouse_id) DO UPDATE SET
         on_hand_quantity = material_inventory.on_hand_quantity + $6,
         reserved_quantity = material_inventory.reserved_quantity + $7,
         incoming_quantity = material_inventory.incoming_quantity + $8,
         available_quantity = (material_inventory.on_hand_quantity + $6)
                            - (material_inventory.reserved_quantity + $7)
                            + (material_inventory.incoming_quantity + $8),
         updated_at = CURRENT_TIMESTAMP
       RETURNING on_hand_quantity::text AS on_hand, available_quantity::text AS available`,
      [
        `minv-${movement.materialId}-${movement.warehouseId}`,
        movement.tenantId,
        movement.materialId,
        movement.warehouseId,
        movement.uom,
        movement.onHandDelta,
        reservedDelta,
        incomingDelta,
        movement.onHandDelta - reservedDelta + incomingDelta,
      ]
    );

    const balanceAfter = Number(updated.rows[0]?.on_hand ?? 0);
    const id = `mtx-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const quantity =
      movement.onHandDelta !== 0
        ? movement.onHandDelta
        : reservedDelta !== 0
          ? reservedDelta
          : incomingDelta;

    await exec.query(
      `INSERT INTO material_transaction (
         id, tenant_id, material_id, warehouse_id, transaction_type, quantity, uom,
         balance_after, reference_type, reference_id, reason, actor_id, actor_name
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        id,
        movement.tenantId,
        movement.materialId,
        movement.warehouseId,
        movement.transactionType,
        quantity,
        movement.uom,
        balanceAfter,
        movement.referenceType ?? null,
        movement.referenceId ?? null,
        movement.reason ?? null,
        movement.actorId,
        movement.actorName ?? null,
      ]
    );

    return {
      id,
      tenantId: movement.tenantId,
      materialId: movement.materialId,
      materialSku: '',
      materialName: '',
      warehouseId: movement.warehouseId,
      transactionType: movement.transactionType,
      quantity,
      uom: movement.uom,
      balanceAfter,
      referenceType: movement.referenceType,
      referenceId: movement.referenceId,
      reason: movement.reason,
      actorId: movement.actorId,
      actorName: movement.actorName,
      occurredAt: new Date().toISOString(),
    };
  }

  // --- Transactions -------------------------------------------------

  async listTransactions(
    exec: Executor,
    tenantId: string,
    filter: { materialId?: string; referenceId?: string; from?: string; to?: string; limit?: number } = {}
  ): Promise<MaterialTransaction[]> {
    const where = ['t.tenant_id = $1'];
    const params: unknown[] = [tenantId];

    if (filter.materialId) {
      params.push(filter.materialId);
      where.push(`t.material_id = $${params.length}`);
    }
    if (filter.referenceId) {
      params.push(filter.referenceId);
      where.push(`t.reference_id = $${params.length}`);
    }
    if (filter.from) {
      params.push(filter.from);
      where.push(`t.occurred_at >= $${params.length}`);
    }
    if (filter.to) {
      params.push(filter.to);
      where.push(`t.occurred_at <= $${params.length}`);
    }
    params.push(Math.min(filter.limit ?? 300, 2000));

    const result = await exec.query<{
      id: string;
      tenant_id: string;
      material_id: string;
      material_sku: string;
      material_name: string;
      warehouse_id: string | null;
      transaction_type: string;
      quantity: string;
      uom: string;
      balance_after: string;
      reference_type: string | null;
      reference_id: string | null;
      reason: string | null;
      actor_id: string;
      actor_name: string | null;
      occurred_at: Date | string;
    }>(
      `SELECT t.id, t.tenant_id, t.material_id, p.sku AS material_sku, p.name AS material_name,
              t.warehouse_id, t.transaction_type, t.quantity, t.uom, t.balance_after,
              t.reference_type, t.reference_id, t.reason, t.actor_id, t.actor_name, t.occurred_at
         FROM material_transaction t
         JOIN product p ON p.id = t.material_id
        WHERE ${where.join(' AND ')}
        ORDER BY t.occurred_at DESC, t.id DESC
        LIMIT $${params.length}`,
      params
    );

    return result.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      materialId: row.material_id,
      materialSku: row.material_sku,
      materialName: row.material_name,
      warehouseId: orUndefined(row.warehouse_id),
      transactionType: row.transaction_type as MaterialTransaction['transactionType'],
      quantity: Number(row.quantity),
      uom: row.uom,
      balanceAfter: Number(row.balance_after),
      referenceType: orUndefined(row.reference_type),
      referenceId: orUndefined(row.reference_id),
      reason: orUndefined(row.reason),
      actorId: row.actor_id,
      actorName: orUndefined(row.actor_name),
      occurredAt: asIsoString(row.occurred_at),
    }));
  }

  // --- Reservations -------------------------------------------------

  async listReservations(
    exec: Executor,
    tenantId: string,
    filter: { workOrderId?: string; materialId?: string; status?: string } = {}
  ): Promise<MaterialReservation[]> {
    const where = ['r.tenant_id = $1'];
    const params: unknown[] = [tenantId];

    if (filter.workOrderId) {
      params.push(filter.workOrderId);
      where.push(`r.work_order_id = $${params.length}`);
    }
    if (filter.materialId) {
      params.push(filter.materialId);
      where.push(`r.material_id = $${params.length}`);
    }
    if (filter.status) {
      params.push(filter.status);
      where.push(`r.status = $${params.length}`);
    }

    const result = await exec.query<{
      id: string;
      tenant_id: string;
      material_id: string;
      material_sku: string;
      material_name: string;
      warehouse_id: string | null;
      work_order_id: string | null;
      wo_number: string | null;
      production_plan_id: string | null;
      quantity: string;
      uom: string;
      status: string;
      reserved_by: string;
      reserved_at: Date | string;
      released_at: Date | string | null;
      notes: string | null;
    }>(
      `SELECT r.id, r.tenant_id, r.material_id, p.sku AS material_sku, p.name AS material_name,
              r.warehouse_id, r.work_order_id, w.wo_number, r.production_plan_id,
              r.quantity, r.uom, r.status, r.reserved_by, r.reserved_at, r.released_at, r.notes
         FROM material_reservation r
         JOIN product p ON p.id = r.material_id
         LEFT JOIN work_order w ON w.id = r.work_order_id
        WHERE ${where.join(' AND ')}
        ORDER BY r.reserved_at DESC`,
      params
    );

    return result.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      materialId: row.material_id,
      materialSku: row.material_sku,
      materialName: row.material_name,
      warehouseId: orUndefined(row.warehouse_id),
      workOrderId: orUndefined(row.work_order_id),
      workOrderNumber: orUndefined(row.wo_number),
      productionPlanId: orUndefined(row.production_plan_id),
      quantity: Number(row.quantity),
      uom: row.uom,
      status: row.status as MaterialReservation['status'],
      reservedBy: row.reserved_by,
      reservedAt: asIsoString(row.reserved_at),
      releasedAt: row.released_at ? asIsoString(row.released_at) : undefined,
      notes: orUndefined(row.notes),
    }));
  }

  async insertReservation(exec: Executor, reservation: MaterialReservation): Promise<void> {
    await exec.query(
      `INSERT INTO material_reservation (
         id, tenant_id, material_id, warehouse_id, work_order_id, production_plan_id,
         quantity, uom, status, reserved_by, reserved_at, notes
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        reservation.id,
        reservation.tenantId,
        reservation.materialId,
        reservation.warehouseId ?? null,
        reservation.workOrderId ?? null,
        reservation.productionPlanId ?? null,
        reservation.quantity,
        reservation.uom,
        reservation.status,
        reservation.reservedBy,
        reservation.reservedAt,
        reservation.notes ?? null,
      ]
    );
  }

  async setReservationStatus(
    exec: Executor,
    tenantId: string,
    id: string,
    status: MaterialReservation['status']
  ): Promise<void> {
    await exec.query(
      `UPDATE material_reservation
          SET status = $3,
              released_at = CASE WHEN $3 IN ('RELEASED', 'CONSUMED') THEN CURRENT_TIMESTAMP ELSE released_at END
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, status]
    );
  }

  // --- Requirements -------------------------------------------------

  async replaceRequirements(
    exec: Executor,
    tenantId: string,
    sourceType: string,
    sourceId: string,
    requirements: MaterialRequirement[]
  ): Promise<void> {
    await exec.query(
      'DELETE FROM material_requirement WHERE tenant_id = $1 AND source_type = $2 AND source_id = $3',
      [tenantId, sourceType, sourceId]
    );
    for (const req of requirements) {
      await exec.query(
        `INSERT INTO material_requirement (
           id, tenant_id, source_type, source_id, source_label, material_id, bom_id, level,
           required_quantity, on_hand_quantity, reserved_quantity, incoming_quantity,
           available_quantity, shortage_quantity, uom, requirement_date, status, warehouse_id, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        [
          req.id,
          req.tenantId,
          req.sourceType,
          req.sourceId,
          req.sourceLabel,
          req.materialId,
          req.bomId ?? null,
          req.level,
          req.requiredQuantity,
          req.onHandQuantity,
          req.reservedQuantity,
          req.incomingQuantity,
          req.availableQuantity,
          req.shortageQuantity,
          req.uom,
          req.requirementDate,
          req.status,
          req.warehouseId ?? null,
          req.createdAt,
        ]
      );
    }
  }

  async listRequirements(
    exec: Executor,
    tenantId: string,
    filter: { sourceType?: string; sourceId?: string; status?: string } = {}
  ): Promise<MaterialRequirement[]> {
    const where = ['r.tenant_id = $1'];
    const params: unknown[] = [tenantId];

    if (filter.sourceType) {
      params.push(filter.sourceType);
      where.push(`r.source_type = $${params.length}`);
    }
    if (filter.sourceId) {
      params.push(filter.sourceId);
      where.push(`r.source_id = $${params.length}`);
    }
    if (filter.status) {
      params.push(filter.status);
      where.push(`r.status = $${params.length}`);
    }

    const result = await exec.query<{
      id: string;
      tenant_id: string;
      source_type: string;
      source_id: string;
      source_label: string | null;
      material_id: string;
      material_sku: string;
      material_name: string;
      bom_id: string | null;
      bom_number: string | null;
      level: number;
      required_quantity: string;
      on_hand_quantity: string;
      reserved_quantity: string;
      incoming_quantity: string;
      available_quantity: string;
      shortage_quantity: string;
      uom: string;
      requirement_date: Date | string | null;
      status: string;
      warehouse_id: string | null;
      created_at: Date | string;
    }>(
      `SELECT r.id, r.tenant_id, r.source_type, r.source_id, r.source_label, r.material_id,
              p.sku AS material_sku, p.name AS material_name, r.bom_id, b.bom_number, r.level,
              r.required_quantity, r.on_hand_quantity, r.reserved_quantity, r.incoming_quantity,
              r.available_quantity, r.shortage_quantity, r.uom, r.requirement_date, r.status,
              r.warehouse_id, r.created_at
         FROM material_requirement r
         JOIN product p ON p.id = r.material_id
         LEFT JOIN bill_of_material b ON b.id = r.bom_id
        WHERE ${where.join(' AND ')}
        ORDER BY r.level, p.sku`,
      params
    );

    return result.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      sourceType: row.source_type as MaterialRequirement['sourceType'],
      sourceId: row.source_id,
      sourceLabel: row.source_label ?? row.source_id,
      materialId: row.material_id,
      materialSku: row.material_sku,
      materialName: row.material_name,
      bomId: orUndefined(row.bom_id),
      bomNumber: orUndefined(row.bom_number),
      level: row.level,
      requiredQuantity: Number(row.required_quantity),
      onHandQuantity: Number(row.on_hand_quantity),
      reservedQuantity: Number(row.reserved_quantity),
      incomingQuantity: Number(row.incoming_quantity),
      availableQuantity: Number(row.available_quantity),
      shortageQuantity: Number(row.shortage_quantity),
      uom: row.uom,
      requirementDate: row.requirement_date ? asDateString(row.requirement_date) : '',
      status: row.status as MaterialRequirement['status'],
      warehouseId: orUndefined(row.warehouse_id),
      createdAt: asIsoString(row.created_at),
    }));
  }

  // --- Consumption --------------------------------------------------

  async insertConsumption(exec: Executor, consumption: MaterialConsumption): Promise<void> {
    await exec.query(
      `INSERT INTO material_consumption (
         id, tenant_id, work_order_id, batch_id, process_id, machine_id, material_id, warehouse_id,
         planned_quantity, actual_quantity, variance_quantity, uom, consumption_type, status,
         operator_id, recorded_by, consumed_at, idempotency_key, notes
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [
        consumption.id,
        consumption.tenantId,
        consumption.workOrderId,
        consumption.batchId ?? null,
        consumption.processId ?? null,
        consumption.machineId ?? null,
        consumption.materialId,
        consumption.warehouseId ?? null,
        consumption.plannedQuantity,
        consumption.actualQuantity,
        consumption.varianceQuantity,
        consumption.uom,
        consumption.consumptionType,
        consumption.status,
        consumption.operatorId ?? null,
        consumption.recordedBy,
        consumption.consumedAt,
        consumption.idempotencyKey ?? null,
        consumption.notes ?? null,
      ]
    );
  }

  async findConsumptionByIdempotencyKey(
    exec: Executor,
    tenantId: string,
    key: string
  ): Promise<MaterialConsumption | undefined> {
    const rows = await this.listConsumption(exec, tenantId, { idempotencyKey: key });
    return rows[0];
  }

  async listConsumption(
    exec: Executor,
    tenantId: string,
    filter: {
      workOrderId?: string;
      materialId?: string;
      status?: ConsumptionStatus;
      idempotencyKey?: string;
      from?: string;
      to?: string;
      limit?: number;
    } = {}
  ): Promise<MaterialConsumption[]> {
    const where = ['c.tenant_id = $1'];
    const params: unknown[] = [tenantId];

    if (filter.workOrderId) {
      params.push(filter.workOrderId);
      where.push(`c.work_order_id = $${params.length}`);
    }
    if (filter.materialId) {
      params.push(filter.materialId);
      where.push(`c.material_id = $${params.length}`);
    }
    if (filter.status) {
      params.push(filter.status);
      where.push(`c.status = $${params.length}`);
    }
    if (filter.idempotencyKey) {
      params.push(filter.idempotencyKey);
      where.push(`c.idempotency_key = $${params.length}`);
    }
    if (filter.from) {
      params.push(filter.from);
      where.push(`c.consumed_at >= $${params.length}`);
    }
    if (filter.to) {
      params.push(filter.to);
      where.push(`c.consumed_at <= $${params.length}`);
    }
    params.push(Math.min(filter.limit ?? 300, 2000));

    const result = await exec.query<{
      id: string;
      tenant_id: string;
      work_order_id: string;
      wo_number: string | null;
      batch_id: string | null;
      process_id: string | null;
      machine_id: string | null;
      material_id: string;
      material_sku: string;
      material_name: string;
      warehouse_id: string | null;
      planned_quantity: string;
      actual_quantity: string;
      variance_quantity: string;
      uom: string;
      consumption_type: string;
      status: string;
      operator_id: string | null;
      operator_name: string | null;
      recorded_by: string;
      consumed_at: Date | string;
      idempotency_key: string | null;
      notes: string | null;
    }>(
      `SELECT c.id, c.tenant_id, c.work_order_id, w.wo_number, c.batch_id, c.process_id, c.machine_id,
              c.material_id, p.sku AS material_sku, p.name AS material_name, c.warehouse_id,
              c.planned_quantity, c.actual_quantity, c.variance_quantity, c.uom, c.consumption_type,
              c.status, c.operator_id, o.name AS operator_name, c.recorded_by, c.consumed_at,
              c.idempotency_key, c.notes
         FROM material_consumption c
         JOIN product p ON p.id = c.material_id
         LEFT JOIN work_order w ON w.id = c.work_order_id
         LEFT JOIN operator o ON o.id = c.operator_id
        WHERE ${where.join(' AND ')}
        ORDER BY c.consumed_at DESC
        LIMIT $${params.length}`,
      params
    );

    return result.rows.map((row) => {
      const planned = Number(row.planned_quantity);
      const variance = Number(row.variance_quantity);
      return {
        id: row.id,
        tenantId: row.tenant_id,
        workOrderId: row.work_order_id,
        workOrderNumber: row.wo_number ?? row.work_order_id,
        batchId: orUndefined(row.batch_id),
        processId: orUndefined(row.process_id),
        machineId: orUndefined(row.machine_id),
        materialId: row.material_id,
        materialSku: row.material_sku,
        materialName: row.material_name,
        warehouseId: orUndefined(row.warehouse_id),
        plannedQuantity: planned,
        actualQuantity: Number(row.actual_quantity),
        varianceQuantity: variance,
        variancePercentage: planned > 0 ? Number(((variance / planned) * 100).toFixed(2)) : 0,
        uom: row.uom,
        consumptionType: row.consumption_type as MaterialConsumption['consumptionType'],
        status: row.status as ConsumptionStatus,
        operatorId: orUndefined(row.operator_id),
        operatorName: orUndefined(row.operator_name),
        recordedBy: row.recorded_by,
        consumedAt: asIsoString(row.consumed_at),
        idempotencyKey: orUndefined(row.idempotency_key),
        notes: orUndefined(row.notes),
      };
    });
  }

  /** Consumption already booked against a work order, per material. */
  async consumedByMaterial(
    exec: Executor,
    tenantId: string,
    workOrderId: string
  ): Promise<Map<string, number>> {
    const result = await exec.query<{ material_id: string; total: string }>(
      `SELECT material_id,
              sum(CASE WHEN consumption_type = 'RETURN' THEN -actual_quantity ELSE actual_quantity END)::text AS total
         FROM material_consumption
        WHERE tenant_id = $1 AND work_order_id = $2
        GROUP BY material_id`,
      [tenantId, workOrderId]
    );
    return new Map(result.rows.map((row) => [row.material_id, Number(row.total)]));
  }
}
