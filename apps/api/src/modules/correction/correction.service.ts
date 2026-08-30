import { CorrectionRequest, CorrectionStatus, CorrectionEntityType } from '@factory-vision/domain-types';
import { ApiError } from '../../platform/http/api-error.js';
import { ProductionService } from '../production/production.service.js';
import type { AuditService } from '../audit/audit.service.js';
import type { OeeService } from '../oee/oee.service.js';
import type { ShopFloorService } from '../shopfloor/shopfloor.service.js';
import { demoRows } from '../../platform/config/demo-seed.js';

/**
 * Data correction workflow (US-042, US-043).
 *
 * The rule that shapes everything here: a correction never overwrites history.
 * The original value is retained on the request, the new record points back
 * with `correction_of_id`, and derived metrics are recomputed rather than
 * hand-adjusted, which is why an approved correction is auditable years later
 * even though the number on the dashboard changed.
 */

/**, beyond this many hours after the shift, approval is required. */
const CORRECTION_WINDOW_HOURS = 24;

/** Fields permits to be corrected, by entity type. */
const CORRECTABLE_FIELDS: Record<CorrectionEntityType, string[]> = {
  [CorrectionEntityType.PRODUCTION_RECORD]: ['goodQuantity', 'rejectQuantity', 'rejectReasonId', 'notes'],
  [CorrectionEntityType.DOWNTIME_RECORD]: ['reasonId', 'startTime', 'endTime', 'durationSeconds', 'notes'],
};

interface Dependencies {
  shopFloor: ShopFloorService;
  audit: AuditService;
  oee: OeeService;
}

export class CorrectionService {
  private deps?: Dependencies;

  private corrections: CorrectionRequest[] = demoRows<CorrectionRequest>((): CorrectionRequest[] => [
    {
      id: 'corr-001',
      tenantId: 'tenant-pilot-factory-01',
      entityType: CorrectionEntityType.PRODUCTION_RECORD,
      entityId: 'wo-101',
      shiftDate: '2026-08-28',
      fieldChanges: {
        goodQuantity: { from: 1800, to: 1840 },
        rejectQuantity: { from: 20, to: 32 },
      },
      reason: 'Koreksi salah hitung manual pada akhir batch jam 09:00',
      requestedBy: 'Budi Santoso (Operator)',
      requestedAt: '2026-08-28T09:30:00.000Z',
      requiresApproval: true,
      approvedBy: 'Agung Wicaksono (Supervisor)',
      approvedAt: '2026-08-28T09:35:00.000Z',
      status: CorrectionStatus.APPLIED,
      appliedAt: '2026-08-28T09:35:00.000Z',
    },
    {
      id: 'corr-002',
      tenantId: 'tenant-pilot-factory-01',
      entityType: CorrectionEntityType.DOWNTIME_RECORD,
      entityId: 'dt-rec-002',
      shiftDate: '2026-08-28',
      fieldChanges: {
        reasonId: { from: 'dt-mat-shortage', to: 'dt-breakdown' },
      },
      reason: 'Salah pilih alasan henti, sebenarnya sensor hidrolik macet bukan material habis',
      requestedBy: 'Budi Santoso (Operator)',
      requestedAt: '2026-08-28T10:00:00.000Z',
      requiresApproval: true,
      status: CorrectionStatus.PENDING,
    },
  ]);

  constructor(private productionService: ProductionService) {}

  /**
   * Wired after construction because the OEE and shop-floor services are built
   * later in the graph; keeping them optional avoids a circular constructor.
   */
  attachDependencies(deps: Dependencies): void {
    this.deps = deps;
  }

  getCorrections(tenantId: string, status?: CorrectionStatus) {
    let result = this.corrections.filter((c) => c.tenantId === tenantId);
    if (status) {
      result = result.filter((c) => c.status === status);
    }
    return result;
  }

  /** Hours elapsed since the end of the shift day being corrected. */
  private hoursSinceShift(shiftDate: string): number {
    const shiftEnd = Date.parse(`${shiftDate}T23:59:59.999Z`);
    if (Number.isNaN(shiftEnd)) return Number.POSITIVE_INFINITY;
    return (Date.now() - shiftEnd) / 3_600_000;
  }

  /**
   * Whether a correction is inside the free window, and who may approve it.
   *
   * US-042 lets a supervisor fix an active shift outright; US-043 gives a
   * production manager 24 hours on a closed shift, after which a second pair
   * of eyes is required before history moves.
   */
  assessWindow(shiftDate: string): { closed: boolean; withinWindow: boolean; hoursElapsed: number } {
    const hoursElapsed = this.hoursSinceShift(shiftDate);
    const closed = hoursElapsed > 0;
    return { closed, withinWindow: hoursElapsed <= CORRECTION_WINDOW_HOURS, hoursElapsed };
  }

  createCorrectionRequest(
    tenantId: string,
    payload: {
      entityType: CorrectionEntityType;
      entityId: string;
      shiftDate: string;
      fieldChanges: Record<string, { from: unknown; to: unknown }>;
      reason: string;
      requestedBy: string;
      requestedById?: string;
      /** Permissions of the requester, used to decide auto-approval. */
      permissions?: string[];
    }
  ): CorrectionRequest {
    const allowed = CORRECTABLE_FIELDS[payload.entityType] ?? [];
    const illegal = Object.keys(payload.fieldChanges).filter((field) => !allowed.includes(field));
    if (illegal.length > 0) {
      throw ApiError.validation(
        `Field berikut tidak dapat dikoreksi: ${illegal.join(', ')}.`,
        illegal.map((field) => ({
          field,
          code: 'NOT_CORRECTABLE',
          message: `${field} bukan field yang dapat dikoreksi menurut`,
        }))
      );
    }
    if (Object.keys(payload.fieldChanges).length === 0) {
      throw ApiError.validation('Tidak ada perubahan yang diajukan.');
    }
    if (!payload.reason || payload.reason.trim().length < 5) {
      throw ApiError.validation('Alasan koreksi wajib diisi.', [
        { field: 'reason', code: 'REQUIRED', message: 'Jelaskan alasan koreksi minimal 5 karakter.' },
      ]);
    }

    const window = this.assessWindow(payload.shiftDate);
    const canApprove = payload.permissions?.includes('correction:approve') ?? false;

    // Inside the window an authorised user's correction applies immediately;
    // outside it, the same correction waits for approval no matter who asked.
    const requiresApproval = !window.withinWindow || !canApprove;

    const correction: CorrectionRequest = {
      id: `corr-${Date.now()}`,
      tenantId,
      entityType: payload.entityType,
      entityId: payload.entityId,
      shiftDate: payload.shiftDate,
      fieldChanges: payload.fieldChanges,
      reason: payload.reason,
      requestedBy: payload.requestedBy,
      requestedAt: new Date().toISOString(),
      requiresApproval,
      status: CorrectionStatus.PENDING,
    };

    this.corrections.push(correction);

    this.deps?.audit.record({
      tenantId,
      actorType: 'USER',
      actorId: payload.requestedById ?? payload.requestedBy,
      entityType: 'correction_request',
      entityId: correction.id,
      action: 'CORRECTION_REQUESTED',
      previousValue: Object.fromEntries(
        Object.entries(payload.fieldChanges).map(([field, change]) => [field, change.from])
      ),
      newValue: {
        changes: Object.fromEntries(
          Object.entries(payload.fieldChanges).map(([field, change]) => [field, change.to])
        ),
        shiftDate: payload.shiftDate,
        requiresApproval,
        hoursSinceShift: Number(window.hoursElapsed.toFixed(1)),
      },
    });

    if (!requiresApproval) {
      return this.applyCorrection(tenantId, correction, payload.requestedBy, payload.requestedById);
    }

    return correction;
  }

  approveCorrection(
    tenantId: string,
    id: string,
    approvedBy: string,
    approvedById?: string
  ): CorrectionRequest {
    const corr = this.corrections.find((c) => c.tenantId === tenantId && c.id === id);
    if (!corr) throw ApiError.notFound('Permintaan koreksi tidak ditemukan.');

    if (corr.status !== CorrectionStatus.PENDING) {
      throw ApiError.invalidState(`Koreksi berstatus ${corr.status} tidak dapat disetujui lagi.`);
    }

    corr.status = CorrectionStatus.APPROVED;
    corr.approvedBy = approvedBy;
    corr.approvedAt = new Date().toISOString();

    return this.applyCorrection(tenantId, corr, approvedBy, approvedById);
  }

  /**
   * Applies an approved correction and triggers the downstream recompute.
   *
   * The original value already lives on `fieldChanges[...].from`, so history is
   * intact; what changes is the aggregate the reports read from.
   */
  private applyCorrection(
    tenantId: string,
    corr: CorrectionRequest,
    actor: string,
    actorId?: string
  ): CorrectionRequest {
    if (corr.entityType === CorrectionEntityType.PRODUCTION_RECORD) {
      const goodDiff = corr.fieldChanges.goodQuantity
        ? Number(corr.fieldChanges.goodQuantity.to) - Number(corr.fieldChanges.goodQuantity.from)
        : 0;
      const rejectDiff = corr.fieldChanges.rejectQuantity
        ? Number(corr.fieldChanges.rejectQuantity.to) - Number(corr.fieldChanges.rejectQuantity.from)
        : 0;
      if (goodDiff !== 0 || rejectDiff !== 0) {
        this.productionService.incrementQuantities(tenantId, corr.entityId, goodDiff, rejectDiff);
      }
    }

    corr.status = CorrectionStatus.APPLIED;
    corr.appliedAt = new Date().toISOString();

    // Every OEE surface derives from the event log on read, so the recompute is
    // implicit, but the version is stamped on the audit entry so a changed
    // report can be traced to the correction that moved it (US-035, US-043).
    const calcVersion = this.deps?.oee.getConfig(tenantId).calcVersion;

    this.deps?.audit.record({
      tenantId,
      actorType: 'USER',
      actorId: actorId ?? actor,
      entityType: 'correction_request',
      entityId: corr.id,
      action: 'CORRECTION_APPLIED',
      previousValue: Object.fromEntries(
        Object.entries(corr.fieldChanges).map(([field, change]) => [field, change.from])
      ),
      newValue: {
        changes: Object.fromEntries(
          Object.entries(corr.fieldChanges).map(([field, change]) => [field, change.to])
        ),
        correctionOfId: corr.entityId,
        recomputed: true,
        calcVersion,
      },
    });

    return corr;
  }

  rejectCorrection(tenantId: string, id: string, rejectedBy: string, rejectedById?: string): CorrectionRequest {
    const corr = this.corrections.find((c) => c.tenantId === tenantId && c.id === id);
    if (!corr) throw ApiError.notFound('Permintaan koreksi tidak ditemukan.');
    if (corr.status === CorrectionStatus.APPLIED) {
      throw ApiError.invalidState('Koreksi yang sudah diterapkan tidak dapat ditolak.');
    }

    corr.status = CorrectionStatus.REJECTED;
    corr.rejectedBy = rejectedBy;
    corr.rejectedAt = new Date().toISOString();

    this.deps?.audit.record({
      tenantId,
      actorType: 'USER',
      actorId: rejectedById ?? rejectedBy,
      entityType: 'correction_request',
      entityId: corr.id,
      action: 'CORRECTION_REJECTED',
      previousValue: { status: CorrectionStatus.PENDING },
      newValue: { status: CorrectionStatus.REJECTED },
    });

    return corr;
  }

  /** The fields the console may offer for a given entity type. */
  getCorrectableFields(entityType: CorrectionEntityType): string[] {
    return CORRECTABLE_FIELDS[entityType] ?? [];
  }
}
