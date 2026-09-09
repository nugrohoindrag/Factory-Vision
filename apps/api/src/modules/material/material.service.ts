import type {
  BillOfMaterial,
  ConsumptionStatus,
  MaterialConsumption,
  MaterialInventory,
  MaterialReadiness,
  MaterialReadinessStatus,
  MaterialRequirement,
  MaterialReservation,
  MaterialTransaction,
} from '@factory-vision/domain-types';
import type pg from 'pg';
import { withTenant } from '../../platform/db/pool.js';
import { ApiError } from '../../platform/http/api-error.js';
import type { Executor } from '../../platform/db/executor.js';
import type { MasterDataService } from '../master-data/master-data.service.js';
import type { ProductionService } from '../production/production.service.js';
import type { EventService } from '../event/event.service.js';
import { MaterialRepository, type MovementInput, type Warehouse } from './material.repository.js';

/**
 * Material readiness and consumption (Improvement PRD §3, US-M001, US-M003).
 *
 * Two questions, one module: "can this be made" — which is a BOM exploded
 * against stock — and "what was actually used", which is a movement that has
 * to change stock and leave a ledger entry behind it.
 *
 * Everything that touches inventory runs inside one `withTenant` transaction,
 * so a consumption that fails halfway leaves neither a phantom issue nor a
 * balance that disagrees with its ledger.
 */

/** One exploded line before it meets inventory. */
interface ExplodedLine {
  materialId: string;
  bomId: string;
  quantity: number;
  uom: string;
  level: number;
}

export class MaterialService {
  private readonly repo = new MaterialRepository();

  constructor(
    private readonly masterData: MasterDataService,
    private readonly production: ProductionService,
    private readonly events: EventService
  ) {}

  // ==========================================================
  // Warehouses and inventory
  // ==========================================================

  async listWarehouses(tenantId: string): Promise<Warehouse[]> {
    return withTenant(tenantId, (client) => this.repo.listWarehouses(client, tenantId));
  }

  async createWarehouse(
    tenantId: string,
    input: { code: string; name: string; plantId?: string; warehouseType?: string }
  ): Promise<Warehouse> {
    const warehouse: Warehouse = {
      id: `wh-${Date.now()}`,
      tenantId,
      plantId: input.plantId,
      code: input.code,
      name: input.name,
      warehouseType: input.warehouseType ?? 'RAW_MATERIAL',
      status: 'ACTIVE',
    };
    await withTenant(tenantId, (client) => this.repo.upsertWarehouse(client, warehouse));
    return warehouse;
  }

  async listInventory(
    tenantId: string,
    filter: { materialId?: string; warehouseId?: string; belowReorder?: boolean; search?: string } = {}
  ): Promise<MaterialInventory[]> {
    return withTenant(tenantId, (client) => this.repo.listInventory(client, tenantId, filter));
  }

  /**
   * Sets stock to an absolute figure (a stock take), writing the difference to
   * the ledger as an ADJUSTMENT.
   *
   * §39 requires every material adjustment to be audited; the caller records
   * the audit entry, and the ledger carries the reason regardless.
   */
  async adjustInventory(
    tenantId: string,
    input: {
      materialId: string;
      warehouseId?: string;
      onHandQuantity: number;
      uom?: string;
      reorderPoint?: number;
      safetyStock?: number;
      reason: string;
      actorId: string;
      actorName?: string;
    }
  ): Promise<MaterialInventory> {
    return withTenant(tenantId, async (client) => {
      const warehouseId = await this.resolveWarehouseId(client, tenantId, input.warehouseId);
      const material = this.requireMaterial(tenantId, input.materialId);
      const uom = input.uom ?? material.unit ?? 'PCS';
      const current = await this.repo.findInventory(client, tenantId, input.materialId, warehouseId);
      const delta = input.onHandQuantity - (current?.onHandQuantity ?? 0);

      if (delta !== 0) {
        await this.repo.applyMovement(client, {
          tenantId,
          materialId: input.materialId,
          warehouseId,
          transactionType: 'ADJUSTMENT',
          onHandDelta: delta,
          uom,
          referenceType: 'STOCK_TAKE',
          reason: input.reason,
          actorId: input.actorId,
          actorName: input.actorName,
        });
      }

      // Thresholds are not a movement, so they are written straight.
      if (input.reorderPoint !== undefined || input.safetyStock !== undefined) {
        const after = await this.repo.findInventory(client, tenantId, input.materialId, warehouseId);
        await this.repo.upsertInventory(client, {
          tenantId,
          materialId: input.materialId,
          warehouseId,
          uom,
          onHandQuantity: after?.onHandQuantity ?? input.onHandQuantity,
          reservedQuantity: after?.reservedQuantity ?? 0,
          incomingQuantity: after?.incomingQuantity ?? 0,
          reorderPoint: input.reorderPoint ?? current?.reorderPoint,
          safetyStock: input.safetyStock ?? current?.safetyStock,
        });
      }

      const updated = await this.repo.findInventory(client, tenantId, input.materialId, warehouseId);
      return updated!;
    });
  }

  /** Books incoming supply — a purchase or transfer expected inside the horizon. */
  async recordIncoming(
    tenantId: string,
    input: {
      materialId: string;
      warehouseId?: string;
      quantity: number;
      uom?: string;
      reference?: string;
      actorId: string;
      actorName?: string;
    }
  ): Promise<MaterialTransaction> {
    return withTenant(tenantId, async (client) => {
      const warehouseId = await this.resolveWarehouseId(client, tenantId, input.warehouseId);
      const material = this.requireMaterial(tenantId, input.materialId);
      return this.repo.applyMovement(client, {
        tenantId,
        materialId: input.materialId,
        warehouseId,
        transactionType: 'RECEIPT',
        onHandDelta: 0,
        incomingDelta: input.quantity,
        uom: input.uom ?? material.unit ?? 'PCS',
        referenceType: 'PURCHASE',
        referenceId: input.reference,
        reason: 'Incoming supply dijadwalkan',
        actorId: input.actorId,
        actorName: input.actorName,
      });
    });
  }

  /** Receives incoming supply into stock: incoming goes down, on-hand goes up. */
  async receiveMaterial(
    tenantId: string,
    input: {
      materialId: string;
      warehouseId?: string;
      quantity: number;
      uom?: string;
      reference?: string;
      actorId: string;
      actorName?: string;
    }
  ): Promise<MaterialTransaction> {
    return withTenant(tenantId, async (client) => {
      const warehouseId = await this.resolveWarehouseId(client, tenantId, input.warehouseId);
      const material = this.requireMaterial(tenantId, input.materialId);
      const current = await this.repo.findInventory(client, tenantId, input.materialId, warehouseId);
      // Never let `incoming` go negative: a receipt for stock nobody booked as
      // incoming is still a receipt.
      const incomingDelta = -Math.min(input.quantity, current?.incomingQuantity ?? 0);

      return this.repo.applyMovement(client, {
        tenantId,
        materialId: input.materialId,
        warehouseId,
        transactionType: 'RECEIPT',
        onHandDelta: input.quantity,
        incomingDelta,
        uom: input.uom ?? material.unit ?? 'PCS',
        referenceType: 'GOODS_RECEIPT',
        referenceId: input.reference,
        actorId: input.actorId,
        actorName: input.actorName,
      });
    });
  }

  async listTransactions(
    tenantId: string,
    filter: { materialId?: string; referenceId?: string; from?: string; to?: string; limit?: number } = {}
  ): Promise<MaterialTransaction[]> {
    return withTenant(tenantId, (client) => this.repo.listTransactions(client, tenantId, filter));
  }

  // ==========================================================
  // §3.1 Availability check
  // ==========================================================

  /**
   * Explodes a product's active BOM, following sub-assemblies down.
   *
   * Multi-level (§3.2): a component that is itself made in this plant has a
   * BOM of its own, and the raw material a shortage report should name is at
   * the bottom of that chain. The sub-assembly is reported too — a plant that
   * stocks it wants to see it — and `visited` stops a BOM that (wrongly)
   * references itself from exploding forever.
   */
  private async explode(
    tenantId: string,
    productId: string,
    quantity: number,
    level = 1,
    visited: Set<string> = new Set(),
    into: ExplodedLine[] = []
  ): Promise<ExplodedLine[]> {
    if (level > 10 || visited.has(productId)) return into;
    visited.add(productId);

    const bom = await this.masterData.getActiveBomForProduct(tenantId, productId);
    if (!bom) return into;

    for (const component of bom.components) {
      // Scrap allowance: a line that loses 2% has to start with 2% more.
      const scrapFactor = 1 + (component.scrapPercentage ?? 0) / 100;
      const required = component.quantity * quantity * scrapFactor;

      into.push({
        materialId: component.componentPartId,
        bomId: bom.id,
        quantity: required,
        uom: component.uom,
        level,
      });

      if (component.componentType === 'SUB_ASSEMBLY') {
        await this.explode(tenantId, component.componentPartId, required, level + 1, visited, into);
      }
    }
    return into;
  }

  /** Merges exploded lines by material, keeping the shallowest level. */
  private static collapse(lines: ExplodedLine[]): ExplodedLine[] {
    const merged = new Map<string, ExplodedLine>();
    for (const line of lines) {
      const existing = merged.get(line.materialId);
      if (existing) {
        existing.quantity += line.quantity;
        existing.level = Math.min(existing.level, line.level);
      } else {
        merged.set(line.materialId, { ...line });
      }
    }
    return [...merged.values()];
  }

  /** §3.1 — shortage decides the status; nothing else does. */
  private static readinessOf(required: number, available: number): MaterialReadinessStatus {
    const shortage = required - available;
    if (shortage <= 0) return 'READY';
    if (available > 0) return 'PARTIAL';
    return 'SHORTAGE';
  }

  /**
   * Resolves exploded demand against stock and stores the result.
   *
   * The requirement rows are persisted (§37) so "material was READY when we
   * scheduled it" stays answerable after the stock has moved on.
   */
  private async resolveRequirements(
    client: pg.PoolClient,
    tenantId: string,
    source: { type: 'PRODUCTION_PLAN' | 'WORK_ORDER'; id: string; label: string; date: string },
    lines: ExplodedLine[]
  ): Promise<MaterialRequirement[]> {
    const collapsed = MaterialService.collapse(lines);
    const totals = await this.repo.totalsByMaterial(
      client,
      tenantId,
      collapsed.map((line) => line.materialId)
    );
    const now = new Date().toISOString();

    const requirements: MaterialRequirement[] = collapsed.map((line, index) => {
      const stock = totals.get(line.materialId);
      const onHand = stock?.onHand ?? 0;
      const reserved = stock?.reserved ?? 0;
      const incoming = stock?.incoming ?? 0;
      const available = onHand - reserved + incoming;
      const material = this.masterData.getProductById(tenantId, line.materialId);

      return {
        id: `mreq-${source.id}-${index + 1}`,
        tenantId,
        sourceType: source.type,
        sourceId: source.id,
        sourceLabel: source.label,
        materialId: line.materialId,
        materialSku: material?.sku ?? line.materialId,
        materialName: material?.name ?? line.materialId,
        bomId: line.bomId,
        level: line.level,
        requiredQuantity: Number(line.quantity.toFixed(4)),
        onHandQuantity: onHand,
        reservedQuantity: reserved,
        incomingQuantity: incoming,
        availableQuantity: available,
        shortageQuantity: Number(Math.max(line.quantity - available, 0).toFixed(4)),
        uom: line.uom,
        requirementDate: source.date,
        status: MaterialService.readinessOf(line.quantity, available),
        createdAt: now,
      };
    });

    await this.repo.replaceRequirements(client, tenantId, source.type, source.id, requirements);
    return requirements;
  }

  private static summarise(
    source: { type: 'PRODUCTION_PLAN' | 'WORK_ORDER'; id: string; label: string },
    requirements: MaterialRequirement[]
  ): MaterialReadiness {
    const ready = requirements.filter((r) => r.status === 'READY').length;
    const shortage = requirements.filter((r) => r.status !== 'READY').length;

    // A source with no BOM has not been checked, rather than being trivially
    // ready — reporting READY for a product nobody has written a BOM for is
    // the failure mode BR-M03 exists to prevent.
    const status: MaterialReadinessStatus =
      requirements.length === 0 ? 'NOT_CHECKED' : shortage === 0 ? 'READY' : ready > 0 ? 'PARTIAL' : 'SHORTAGE';

    return {
      sourceType: source.type,
      sourceId: source.id,
      sourceLabel: source.label,
      status,
      readinessPercentage:
        requirements.length === 0 ? 0 : Number(((ready / requirements.length) * 100).toFixed(1)),
      totalRequirements: requirements.length,
      readyRequirements: ready,
      shortageRequirements: shortage,
      checkedAt: new Date().toISOString(),
      requirements,
    };
  }

  /** US-M001 for one work order. */
  async checkWorkOrder(tenantId: string, workOrderId: string): Promise<MaterialReadiness> {
    const workOrder = await this.production.getWorkOrderById(tenantId, workOrderId);
    if (!workOrder) throw ApiError.notFound('Work Order tidak ditemukan.');

    const quantity = workOrder.plannedQuantity || workOrder.targetQuantity || 0;
    const lines = await this.explode(tenantId, workOrder.productId, quantity);
    const date = (workOrder.plannedStart ?? new Date().toISOString()).slice(0, 10);

    return withTenant(tenantId, async (client) => {
      const requirements = await this.resolveRequirements(
        client,
        tenantId,
        { type: 'WORK_ORDER', id: workOrderId, label: workOrder.woNumber, date },
        lines
      );
      return MaterialService.summarise(
        { type: 'WORK_ORDER', id: workOrderId, label: workOrder.woNumber },
        requirements
      );
    });
  }

  /** US-M001 for a whole production plan (BR-M01). */
  async checkProductionPlan(
    tenantId: string,
    planId: string,
    demand: Array<{ productId: string; plannedQuantity: number; requiredDate: string; planNumber: string }>
  ): Promise<MaterialReadiness> {
    const lines: ExplodedLine[] = [];
    let date = new Date().toISOString().slice(0, 10);
    let label = planId;

    for (const line of demand) {
      label = line.planNumber;
      if (line.requiredDate < date || date === new Date().toISOString().slice(0, 10)) {
        date = line.requiredDate;
      }
      await this.explode(tenantId, line.productId, line.plannedQuantity, 1, new Set(), lines);
    }

    return withTenant(tenantId, async (client) => {
      const requirements = await this.resolveRequirements(
        client,
        tenantId,
        { type: 'PRODUCTION_PLAN', id: planId, label, date },
        lines
      );
      return MaterialService.summarise(
        { type: 'PRODUCTION_PLAN', id: planId, label },
        requirements
      );
    });
  }

  /** The stored result of the last check, without recomputing it. */
  async storedRequirements(
    tenantId: string,
    filter: { sourceType?: string; sourceId?: string; status?: string } = {}
  ): Promise<MaterialRequirement[]> {
    return withTenant(tenantId, (client) => this.repo.listRequirements(client, tenantId, filter));
  }

  /** Explodes without touching inventory — used by MRP for gross requirement. */
  async explodeDemand(tenantId: string, productId: string, quantity: number): Promise<ExplodedLine[]> {
    return MaterialService.collapse(await this.explode(tenantId, productId, quantity));
  }

  // ==========================================================
  // Reservation
  // ==========================================================

  /**
   * Reserves the material a work order needs (§15 RESERVED).
   *
   * Reservation moves nothing physically: on-hand is unchanged and `reserved`
   * goes up, which is exactly what takes the quantity out of everyone else's
   * availability.
   */
  async reserveForWorkOrder(
    tenantId: string,
    workOrderId: string,
    actor: { id: string; name?: string }
  ): Promise<MaterialReservation[]> {
    const readiness = await this.checkWorkOrder(tenantId, workOrderId);
    const workOrder = await this.production.getWorkOrderById(tenantId, workOrderId);

    return withTenant(tenantId, async (client) => {
      const existing = await this.repo.listReservations(client, tenantId, {
        workOrderId,
        status: 'RESERVED',
      });
      if (existing.length > 0) return existing;

      const warehouseId = await this.resolveWarehouseId(client, tenantId, undefined);
      const created: MaterialReservation[] = [];

      for (const requirement of readiness.requirements) {
        // Reserve what is actually there; a reservation larger than stock
        // would make `available` negative and hide the shortage rather than
        // show it. The shortage is already on the requirement row.
        const quantity = Math.min(requirement.requiredQuantity, Math.max(requirement.onHandQuantity, 0));
        if (quantity <= 0) continue;

        const reservation: MaterialReservation = {
          id: `mres-${Date.now()}-${created.length + 1}`,
          tenantId,
          materialId: requirement.materialId,
          materialSku: requirement.materialSku,
          materialName: requirement.materialName,
          warehouseId,
          workOrderId,
          workOrderNumber: workOrder?.woNumber,
          quantity,
          uom: requirement.uom,
          status: 'RESERVED',
          reservedBy: actor.id,
          reservedAt: new Date().toISOString(),
        };

        await this.repo.insertReservation(client, reservation);
        await this.repo.applyMovement(client, {
          tenantId,
          materialId: requirement.materialId,
          warehouseId,
          transactionType: 'RESERVATION',
          onHandDelta: 0,
          reservedDelta: quantity,
          uom: requirement.uom,
          referenceType: 'WORK_ORDER',
          referenceId: workOrderId,
          reason: `Reservasi untuk ${workOrder?.woNumber ?? workOrderId}`,
          actorId: actor.id,
          actorName: actor.name,
        });
        created.push(reservation);
      }

      if (created.length > 0) {
        this.events.recordDetached({
          tenantId,
          eventType: 'MATERIAL_RESERVED',
          entityType: 'WORK_ORDER',
          entityId: workOrderId,
          actorType: 'USER',
          actorId: actor.id,
          actorName: actor.name,
          workOrderId,
          machineId: workOrder?.machineId,
          lineId: workOrder?.lineId,
          summary: `${created.length} material direservasi untuk ${workOrder?.woNumber ?? workOrderId}.`,
          metadata: { materials: created.map((r) => r.materialSku) },
        });
      }
      return created;
    });
  }

  async releaseReservation(
    tenantId: string,
    reservationId: string,
    actor: { id: string; name?: string }
  ): Promise<void> {
    await withTenant(tenantId, async (client) => {
      const [reservation] = (await this.repo.listReservations(client, tenantId, {})).filter(
        (r) => r.id === reservationId
      );
      if (!reservation) throw ApiError.notFound('Reservasi material tidak ditemukan.');
      if (reservation.status !== 'RESERVED') return;

      await this.repo.setReservationStatus(client, tenantId, reservationId, 'RELEASED');
      await this.repo.applyMovement(client, {
        tenantId,
        materialId: reservation.materialId,
        warehouseId: reservation.warehouseId ?? (await this.resolveWarehouseId(client, tenantId, undefined)),
        transactionType: 'RELEASE',
        onHandDelta: 0,
        reservedDelta: -reservation.quantity,
        uom: reservation.uom,
        referenceType: 'WORK_ORDER',
        referenceId: reservation.workOrderId,
        reason: 'Reservasi dilepas',
        actorId: actor.id,
        actorName: actor.name,
      });
    });
  }

  async listReservations(
    tenantId: string,
    filter: { workOrderId?: string; materialId?: string; status?: string } = {}
  ): Promise<MaterialReservation[]> {
    return withTenant(tenantId, (client) => this.repo.listReservations(client, tenantId, filter));
  }

  // ==========================================================
  // §3.3 Consumption
  // ==========================================================

  /**
   * Records material issued to a work order, and takes it out of stock.
   *
   * BR-M04: consumption beyond what is available is refused unless the caller
   * is authorized to override, because the alternative is negative stock that
   * nobody notices until a stock take. The override is recorded on the row.
   *
   * BR-M05: the work order is mandatory, and the signature enforces it.
   */
  async recordConsumption(
    tenantId: string,
    input: {
      workOrderId: string;
      materialId: string;
      actualQuantity: number;
      plannedQuantity?: number;
      warehouseId?: string;
      batchId?: string;
      processId?: string;
      machineId?: string;
      operatorId?: string;
      consumptionType?: MaterialConsumption['consumptionType'];
      uom?: string;
      notes?: string;
      idempotencyKey?: string;
      allowOverride?: boolean;
    },
    actor: { id: string; name?: string; type?: 'USER' | 'OPERATOR' }
  ): Promise<MaterialConsumption> {
    if (input.actualQuantity <= 0) {
      throw ApiError.validation('Kuantitas konsumsi harus lebih besar dari nol.');
    }

    const workOrder = await this.production.getWorkOrderById(tenantId, input.workOrderId);
    if (!workOrder) throw ApiError.notFound('Work Order tidak ditemukan.');
    const material = this.requireMaterial(tenantId, input.materialId);

    const consumption = await withTenant(tenantId, async (client) => {
      // An offline terminal replays its queue; the same key must not issue the
      // material twice (§38).
      if (input.idempotencyKey) {
        const existing = await this.repo.findConsumptionByIdempotencyKey(
          client,
          tenantId,
          input.idempotencyKey
        );
        if (existing) return existing;
      }

      const warehouseId = await this.resolveWarehouseId(client, tenantId, input.warehouseId);
      const uom = input.uom ?? material.unit ?? 'PCS';
      const isReturn = input.consumptionType === 'RETURN';

      if (!isReturn && !input.allowOverride) {
        const stock = await this.repo.findInventory(client, tenantId, input.materialId, warehouseId);
        const onHand = stock?.onHandQuantity ?? 0;
        if (input.actualQuantity > onHand) {
          throw ApiError.conflict(
            `Stok ${material.sku} tidak mencukupi: tersedia ${onHand} ${uom}, diminta ${input.actualQuantity} ${uom}.`
          );
        }
      }

      // The planned figure comes from the stored requirement when the caller
      // does not supply one, so the variance is against the BOM rather than
      // against whatever the operator remembered.
      const planned = input.plannedQuantity ?? (await this.plannedFor(client, tenantId, input));
      const variance = Number((input.actualQuantity - planned).toFixed(4));
      const status: ConsumptionStatus =
        planned <= 0 || Math.abs(variance) < 0.0001
          ? 'NORMAL'
          : variance > 0
            ? 'OVER_CONSUMPTION'
            : 'UNDER_CONSUMPTION';

      const record: MaterialConsumption = {
        id: `mcon-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        tenantId,
        workOrderId: input.workOrderId,
        workOrderNumber: workOrder.woNumber,
        batchId: input.batchId,
        processId: input.processId ?? workOrder.processId,
        machineId: input.machineId ?? workOrder.machineId,
        materialId: input.materialId,
        materialSku: material.sku,
        materialName: material.name,
        warehouseId,
        plannedQuantity: planned,
        actualQuantity: input.actualQuantity,
        varianceQuantity: variance,
        variancePercentage: planned > 0 ? Number(((variance / planned) * 100).toFixed(2)) : 0,
        uom,
        consumptionType: input.consumptionType ?? 'PRODUCTION',
        status,
        operatorId: input.operatorId,
        recordedBy: actor.id,
        consumedAt: new Date().toISOString(),
        idempotencyKey: input.idempotencyKey,
        notes: input.notes,
      };

      await this.repo.insertConsumption(client, record);

      // A return puts material back (§3.3); everything else takes it out.
      await this.repo.applyMovement(client, {
        tenantId,
        materialId: input.materialId,
        warehouseId,
        transactionType: isReturn ? 'RETURN' : 'ISSUE',
        onHandDelta: isReturn ? input.actualQuantity : -input.actualQuantity,
        // Issuing against a reservation consumes it, so the reserved figure
        // comes down with the stock rather than double-counting the shortage.
        reservedDelta: isReturn
          ? 0
          : -(await this.reservedAgainst(client, tenantId, input.workOrderId, input.materialId, input.actualQuantity)),
        uom,
        referenceType: 'MATERIAL_CONSUMPTION',
        referenceId: record.id,
        reason: input.notes ?? `${record.consumptionType} ${workOrder.woNumber}`,
        actorId: actor.id,
        actorName: actor.name,
      });

      return record;
    });

    this.events.recordDetached({
      tenantId,
      eventType: consumption.consumptionType === 'RETURN' ? 'MATERIAL_RETURNED' : 'MATERIAL_CONSUMED',
      entityType: 'WORK_ORDER',
      entityId: consumption.workOrderId,
      actorType: actor.type ?? 'USER',
      actorId: actor.id,
      actorName: actor.name,
      workOrderId: consumption.workOrderId,
      batchId: consumption.batchId,
      machineId: consumption.machineId,
      processId: consumption.processId,
      lineId: workOrder.lineId,
      summary: `${consumption.materialSku}: ${consumption.actualQuantity} ${consumption.uom} pada ${consumption.workOrderNumber}.`,
      afterValue: {
        materialId: consumption.materialId,
        quantity: consumption.actualQuantity,
        variance: consumption.varianceQuantity,
        status: consumption.status,
      },
    });

    return consumption;
  }

  async listConsumption(
    tenantId: string,
    filter: {
      workOrderId?: string;
      materialId?: string;
      status?: ConsumptionStatus;
      from?: string;
      to?: string;
      limit?: number;
    } = {}
  ): Promise<MaterialConsumption[]> {
    return withTenant(tenantId, (client) => this.repo.listConsumption(client, tenantId, filter));
  }

  /**
   * Planned vs actual for one work order, per material (§3.3).
   *
   * Planned comes from the stored requirement; actual from what was issued.
   * Materials with a requirement but no issue appear too — an unconsumed
   * material is the interesting half of a variance report.
   */
  async consumptionVariance(
    tenantId: string,
    workOrderId: string
  ): Promise<
    Array<{
      materialId: string;
      materialSku: string;
      materialName: string;
      plannedQuantity: number;
      actualQuantity: number;
      varianceQuantity: number;
      variancePercentage: number;
      uom: string;
      status: ConsumptionStatus;
    }>
  > {
    return withTenant(tenantId, async (client) => {
      const requirements = await this.repo.listRequirements(client, tenantId, {
        sourceType: 'WORK_ORDER',
        sourceId: workOrderId,
      });
      const consumed = await this.repo.consumedByMaterial(client, tenantId, workOrderId);

      const rows = requirements.map((req) => {
        const actual = consumed.get(req.materialId) ?? 0;
        consumed.delete(req.materialId);
        const variance = Number((actual - req.requiredQuantity).toFixed(4));
        return {
          materialId: req.materialId,
          materialSku: req.materialSku,
          materialName: req.materialName,
          plannedQuantity: req.requiredQuantity,
          actualQuantity: actual,
          varianceQuantity: variance,
          variancePercentage:
            req.requiredQuantity > 0 ? Number(((variance / req.requiredQuantity) * 100).toFixed(2)) : 0,
          uom: req.uom,
          status: (Math.abs(variance) < 0.0001
            ? 'NORMAL'
            : variance > 0
              ? 'OVER_CONSUMPTION'
              : 'UNDER_CONSUMPTION') as ConsumptionStatus,
        };
      });

      // Anything issued that the BOM never asked for is pure over-consumption.
      for (const [materialId, actual] of consumed) {
        const material = this.masterData.getProductById(tenantId, materialId);
        rows.push({
          materialId,
          materialSku: material?.sku ?? materialId,
          materialName: material?.name ?? materialId,
          plannedQuantity: 0,
          actualQuantity: actual,
          varianceQuantity: actual,
          variancePercentage: 0,
          uom: material?.unit ?? 'PCS',
          status: 'OVER_CONSUMPTION',
        });
      }

      return rows;
    });
  }

  // ==========================================================
  // Helpers
  // ==========================================================

  private requireMaterial(tenantId: string, materialId: string) {
    const material = this.masterData.getProductById(tenantId, materialId);
    if (!material) throw ApiError.notFound(`Material ${materialId} tidak ditemukan.`);
    return material;
  }

  /**
   * The warehouse to move stock in or out of.
   *
   * Created on first use rather than demanded up front: a pilot install should
   * be able to record its first consumption without a warehouse master.
   */
  private async resolveWarehouseId(
    client: pg.PoolClient,
    tenantId: string,
    requested?: string
  ): Promise<string> {
    if (requested) return requested;
    const existing = await this.repo.defaultWarehouse(client, tenantId);
    if (existing) return existing.id;

    const id = `wh-${tenantId}-main`;
    await this.repo.upsertWarehouse(client, {
      id,
      tenantId,
      code: 'WH-MAIN',
      name: 'Gudang Utama',
      warehouseType: 'RAW_MATERIAL',
      status: 'ACTIVE',
    });
    return id;
  }

  /** The BOM quantity this issue should be measured against. */
  private async plannedFor(
    client: pg.PoolClient,
    tenantId: string,
    input: { workOrderId: string; materialId: string }
  ): Promise<number> {
    const requirements = await this.repo.listRequirements(client, tenantId, {
      sourceType: 'WORK_ORDER',
      sourceId: input.workOrderId,
    });
    return requirements.find((r) => r.materialId === input.materialId)?.requiredQuantity ?? 0;
  }

  /**
   * How much of an issue is covered by an existing reservation.
   *
   * Bounded by both the reservation and the issue so a reservation is never
   * over-consumed, which would push `reserved` negative.
   */
  private async reservedAgainst(
    client: pg.PoolClient,
    tenantId: string,
    workOrderId: string,
    materialId: string,
    quantity: number
  ): Promise<number> {
    const reservations = await this.repo.listReservations(client, tenantId, {
      workOrderId,
      materialId,
      status: 'RESERVED',
    });
    let remaining = quantity;
    let consumed = 0;

    for (const reservation of reservations) {
      if (remaining <= 0) break;
      const take = Math.min(reservation.quantity, remaining);
      consumed += take;
      remaining -= take;
      if (take >= reservation.quantity) {
        await this.repo.setReservationStatus(client, tenantId, reservation.id, 'CONSUMED');
      }
    }
    return consumed;
  }

  /** Exposed for MRP, which needs stock without going through a requirement. */
  async stockTotals(
    tenantId: string,
    materialIds: string[]
  ): Promise<Map<string, { onHand: number; reserved: number; incoming: number; available: number; uom: string }>> {
    return withTenant(tenantId, (client) => this.repo.totalsByMaterial(client, tenantId, materialIds));
  }

  /** Exposed for MRP so a run and its results share one transaction. */
  get repository(): MaterialRepository {
    return this.repo;
  }
}

export type { Warehouse, MovementInput, Executor, BillOfMaterial };
