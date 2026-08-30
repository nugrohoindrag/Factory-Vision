import { WorkOrderStatus, DowntimeStatus } from '@factory-vision/domain-types';
import type { ShiftHandoverContext, ShiftHandoverRecord } from '@factory-vision/domain-types';
import { ApiError } from '../../platform/http/api-error.js';
import { MasterDataService } from '../master-data/master-data.service.js';
import { ProductionService } from '../production/production.service.js';
import { ShopFloorService } from '../shopfloor/shopfloor.service.js';

/**
 * Shift performance and handover (US-022, US-023).
 *
 * The handover screen is the one place a supervisor hands responsibility over
 * verbally today asks for the same conversation backed by numbers, so
 * the context is assembled server-side from the same records the reports use
 * rather than re-derived by the console.
 */
export class ShiftHandoverService {
  private handovers: ShiftHandoverRecord[] = [];

  constructor(
    private masterData: MasterDataService,
    private production: ProductionService,
    private shopFloor: ShopFloorService
  ) {}

  /** The most recent shift date present in the transaction data. */
  private async latestShiftDate(tenantId: string): Promise<string> {
    const production = await this.shopFloor.getProductionRecords(tenantId);
    const downtime = await this.shopFloor.getDowntimeRecords(tenantId);
    const dates = [
      ...production.map((r) => r.shiftDate),
      ...downtime.map((r) => r.shiftDate),
    ].sort();
    return dates[dates.length - 1] ?? new Date().toISOString().slice(0, 10);
  }

  async buildContext(
    tenantId: string,
    params: { lineId: string; shiftId?: string; shiftDate?: string }
  ): Promise<ShiftHandoverContext> {
    const line = this.masterData.getLineById(tenantId, params.lineId);
    if (!line) throw ApiError.notFound('Production line tidak ditemukan.');

    const shiftDate = params.shiftDate ?? await this.latestShiftDate(tenantId);
    const shifts = this.masterData.getShifts(tenantId);
    const shiftId = params.shiftId ?? shifts.find((s) => s.active)?.id ?? 'shift-1';
    const shift = shifts.find((s) => s.id === shiftId);

    const allWorkOrders = await this.production.getWorkOrders(tenantId);
    const workOrders = allWorkOrders.filter((wo) => wo.lineId === params.lineId);
    const workOrderIds = new Set(workOrders.map((wo) => wo.id));

    const allProduction = await this.shopFloor.getProductionRecords(tenantId);
    const productionRecords = allProduction.filter(
      (r) => r.shiftDate === shiftDate && r.shiftId === shiftId && workOrderIds.has(r.workOrderId)
    );

    const allDowntime = await this.shopFloor.getDowntimeRecords(tenantId, params.lineId);
    const downtimeRecords = allDowntime.filter(
      (r) => r.shiftDate === shiftDate && r.shiftId === shiftId
    );

    const goodQuantity = productionRecords.reduce((acc, r) => acc + r.goodQuantity, 0);
    const rejectQuantity = productionRecords.reduce((acc, r) => acc + r.rejectQuantity, 0);
    const totalQuantity = goodQuantity + rejectQuantity;

    // The shift's target is what the work orders scheduled onto this line ask
    // for; a completed order still counts, because the outgoing shift was
    // measured against it.
    const targetQuantity = workOrders
      .filter((wo) => wo.status !== WorkOrderStatus.CANCELLED)
      .reduce((acc, wo) => acc + wo.targetQuantity, 0);

    const downtimeSeconds = downtimeRecords.reduce((acc, r) => acc + (r.durationSeconds ?? 0), 0);
    const unplannedSeconds = downtimeRecords
      .filter((r) => !r.isPlanned)
      .reduce((acc, r) => acc + (r.durationSeconds ?? 0), 0);

    const topDowntimeReason = rankTop(
      downtimeRecords.map((r) => [r.reasonId, r.durationSeconds ?? 0] as const)
    );
    const topRejectReason = rankTop(
      productionRecords
        .filter((r) => r.rejectReasonId && r.rejectQuantity > 0)
        .map((r) => [r.rejectReasonId!, r.rejectQuantity] as const)
    );

    const reasonName = (id: string | null, kind: 'downtime' | 'reject'): string | null => {
      if (!id) return null;
      const list =
        kind === 'downtime'
          ? this.masterData.getDowntimeReasons(tenantId)
          : this.masterData.getRejectReasons(tenantId);
      return list.find((r) => r.id === id)?.name ?? id;
    };

    const products = this.masterData.getProducts(tenantId);
    const openWorkOrders = workOrders
      .filter((wo) =>
        [WorkOrderStatus.IN_PROGRESS, WorkOrderStatus.PAUSED, WorkOrderStatus.RELEASED].includes(wo.status)
      )
      .map((wo) => ({
        id: wo.id,
        woNumber: wo.woNumber,
        productName: products.find((p) => p.id === wo.productId)?.name ?? wo.productId,
        status: wo.status,
        achievementPct:
          wo.targetQuantity > 0 ? Number(((wo.goodQuantity / wo.targetQuantity) * 100).toFixed(1)) : 0,
      }));

    const previousHandover =
      this.handovers
        .filter((h) => h.tenantId === tenantId && h.lineId === params.lineId)
        .filter((h) => h.shiftDate < shiftDate || (h.shiftDate === shiftDate && h.shiftId !== shiftId))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;

    return {
      lineId: params.lineId,
      lineName: line.name,
      shiftId,
      shiftName: shift?.name ?? shiftId,
      shiftDate,
      targetQuantity,
      goodQuantity,
      rejectQuantity,
      achievementPct: targetQuantity > 0 ? Number(((goodQuantity / targetQuantity) * 100).toFixed(1)) : 0,
      remainingTarget: Math.max(0, targetQuantity - goodQuantity),
      rejectRatePct: totalQuantity > 0 ? Number(((rejectQuantity / totalQuantity) * 100).toFixed(2)) : 0,
      downtimeMinutes: Math.round(downtimeSeconds / 60),
      unplannedDowntimeMinutes: Math.round(unplannedSeconds / 60),
      topDowntimeReason: reasonName(topDowntimeReason, 'downtime'),
      topRejectReason: reasonName(topRejectReason, 'reject'),
      openWorkOrders,
      activeDowntimeCount: downtimeRecords.filter((r) => r.status === DowntimeStatus.ACTIVE).length,
      previousHandover,
    };
  }

  list(tenantId: string, filter: { lineId?: string; shiftDate?: string } = {}): ShiftHandoverRecord[] {
    return this.handovers
      .filter((h) => h.tenantId === tenantId)
      .filter((h) => !filter.lineId || h.lineId === filter.lineId)
      .filter((h) => !filter.shiftDate || h.shiftDate === filter.shiftDate)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  create(
    tenantId: string,
    payload: {
      lineId: string;
      shiftId: string;
      shiftDate: string;
      outgoingSupervisorId: string;
      outgoingSupervisorName: string;
      incomingSupervisorId?: string;
      incomingSupervisorName?: string;
      notes: string;
      openIssues?: string[];
    }
  ): ShiftHandoverRecord {
    if (!this.masterData.getLineById(tenantId, payload.lineId)) {
      throw ApiError.notFound('Production line tidak ditemukan.');
    }

    // One handover per line per shift per day: a second record would leave the
    // incoming supervisor guessing which note is current.
    const existing = this.handovers.find(
      (h) =>
        h.tenantId === tenantId &&
        h.lineId === payload.lineId &&
        h.shiftId === payload.shiftId &&
        h.shiftDate === payload.shiftDate
    );
    if (existing) {
      existing.notes = payload.notes;
      existing.openIssues = payload.openIssues ?? existing.openIssues;
      existing.incomingSupervisorId = payload.incomingSupervisorId ?? existing.incomingSupervisorId;
      existing.incomingSupervisorName = payload.incomingSupervisorName ?? existing.incomingSupervisorName;
      return existing;
    }

    const record: ShiftHandoverRecord = {
      id: `hnd-${Date.now()}`,
      tenantId,
      lineId: payload.lineId,
      shiftId: payload.shiftId,
      shiftDate: payload.shiftDate,
      outgoingSupervisorId: payload.outgoingSupervisorId,
      outgoingSupervisorName: payload.outgoingSupervisorName,
      incomingSupervisorId: payload.incomingSupervisorId,
      incomingSupervisorName: payload.incomingSupervisorName,
      notes: payload.notes,
      openIssues: payload.openIssues ?? [],
      createdAt: new Date().toISOString(),
    };

    this.handovers.push(record);
    return record;
  }

  acknowledge(tenantId: string, id: string, incoming: { id: string; name: string }): ShiftHandoverRecord {
    const record = this.handovers.find((h) => h.tenantId === tenantId && h.id === id);
    if (!record) throw ApiError.notFound('Catatan handover tidak ditemukan.');
    record.incomingSupervisorId = incoming.id;
    record.incomingSupervisorName = incoming.name;
    record.acknowledgedAt = new Date().toISOString();
    return record;
  }
}

/** The key with the largest accumulated weight, or null when there is none. */
function rankTop(pairs: ReadonlyArray<readonly [string, number]>): string | null {
  const totals = new Map<string, number>();
  for (const [key, weight] of pairs) {
    totals.set(key, (totals.get(key) ?? 0) + weight);
  }
  const ranked = Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
  return ranked[0]?.[0] ?? null;
}
