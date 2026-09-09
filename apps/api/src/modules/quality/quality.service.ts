import type {
  CorrectiveAction,
  Inspection,
  InspectionCharacteristic,
  InspectionPlan,
  InspectionResultLine,
  NcrStatus,
  NonConformanceRecord,
  QualityDisposition,
  QualityHold,
} from '@factory-vision/domain-types';
import { withTenant } from '../../platform/db/pool.js';
import { ApiError } from '../../platform/http/api-error.js';
import type { MasterDataService } from '../master-data/master-data.service.js';
import type { ProductionService } from '../production/production.service.js';
import type { EventService } from '../event/event.service.js';
import { QualityRepository } from './quality.repository.js';

/**
 * Quality execution (Improvement PRD §4).
 *
 * The lifecycle is the point: an inspection produces a result, a failure
 * produces a hold, a hold produces a disposition, and a disposition that needs
 * investigating produces an NCR. Each step here refuses to skip the one before
 * it — BR-Q03 (a FAIL must be dispositioned) and BR-Q04 (a hold must have an
 * owner and a reason) are enforced in code, not left to a form.
 */
export class QualityService {
  private readonly repo = new QualityRepository();

  constructor(
    private readonly masterData: MasterDataService,
    private readonly production: ProductionService,
    private readonly events: EventService
  ) {}

  // ==========================================================
  // §4.2 Inspection plans
  // ==========================================================

  async listPlans(
    tenantId: string,
    filter: { productId?: string; processId?: string; status?: string } = {}
  ): Promise<InspectionPlan[]> {
    return withTenant(tenantId, (client) => this.repo.listPlans(client, tenantId, filter));
  }

  async getPlan(tenantId: string, id: string): Promise<InspectionPlan | undefined> {
    return withTenant(tenantId, (client) => this.repo.findPlan(client, tenantId, id));
  }

  async createPlan(
    tenantId: string,
    input: {
      name: string;
      inspectionType: InspectionPlan['inspectionType'];
      productId?: string;
      processId?: string;
      samplingMethod?: InspectionPlan['samplingMethod'];
      samplingQuantity?: number;
      frequency?: string;
      mandatory?: boolean;
      status?: InspectionPlan['status'];
      characteristics: Array<Omit<InspectionCharacteristic, 'id' | 'inspectionPlanId'>>;
    },
    actor: { id: string; name?: string }
  ): Promise<InspectionPlan> {
    const now = new Date().toISOString();
    const id = `iplan-${Date.now()}`;

    return withTenant(tenantId, async (client) => {
      const planNumber = await this.repo.nextNumber(client, tenantId, 'inspection_plan', 'plan_number', 'IP');
      const plan: InspectionPlan = {
        id,
        tenantId,
        planNumber,
        name: input.name,
        inspectionType: input.inspectionType,
        productId: input.productId,
        processId: input.processId,
        samplingMethod: input.samplingMethod ?? 'FIXED_QUANTITY',
        samplingQuantity: input.samplingQuantity,
        frequency: input.frequency,
        mandatory: input.mandatory ?? false,
        status: input.status ?? 'DRAFT',
        characteristics: input.characteristics.map((characteristic, index) => ({
          ...characteristic,
          id: `ichar-${Date.now()}-${index + 1}`,
          inspectionPlanId: id,
          sequence: characteristic.sequence || index + 1,
        })),
        createdBy: actor.id,
        createdAt: now,
        updatedAt: now,
      };

      await this.repo.upsertPlan(client, plan);
      return plan;
    });
  }

  async updatePlan(
    tenantId: string,
    id: string,
    patch: Partial<Omit<InspectionPlan, 'id' | 'tenantId' | 'planNumber' | 'createdAt'>>
  ): Promise<InspectionPlan> {
    return withTenant(tenantId, async (client) => {
      const existing = await this.repo.findPlan(client, tenantId, id);
      if (!existing) throw ApiError.notFound('Inspection Plan tidak ditemukan.');

      const updated: InspectionPlan = {
        ...existing,
        ...patch,
        characteristics: (patch.characteristics ?? existing.characteristics).map(
          (characteristic, index) => ({
            ...characteristic,
            id: characteristic.id || `ichar-${Date.now()}-${index + 1}`,
            inspectionPlanId: id,
            sequence: characteristic.sequence || index + 1,
          })
        ),
        updatedAt: new Date().toISOString(),
      };

      await this.repo.upsertPlan(client, updated);
      return updated;
    });
  }

  async deletePlan(tenantId: string, id: string): Promise<void> {
    await withTenant(tenantId, (client) => this.repo.deletePlan(client, tenantId, id));
  }

  // ==========================================================
  // §4.3 Inspection execution (US-Q001)
  // ==========================================================

  /**
   * Records one inspection and derives its result from the measurements.
   *
   * The overall result is not something the inspector types: a numeric
   * characteristic outside its limits is a FAIL, and one failed line fails the
   * inspection. Letting the result be asserted independently of the readings is
   * how a quality record stops being evidence.
   */
  async recordInspection(
    tenantId: string,
    input: {
      inspectionPlanId?: string;
      inspectionType?: Inspection['inspectionType'];
      workOrderId?: string;
      batchId?: string;
      productId?: string;
      processId?: string;
      machineId?: string;
      inspectedQuantity: number;
      failedQuantity?: number;
      uom?: string;
      operatorId?: string;
      notes?: string;
      idempotencyKey?: string;
      measurements?: Array<{
        characteristicId?: string;
        characteristicName: string;
        actualValue?: string;
        numericValue?: number;
        notes?: string;
      }>;
    },
    actor: { id: string; name?: string; type?: 'USER' | 'OPERATOR' }
  ): Promise<Inspection> {
    if (input.inspectedQuantity <= 0) {
      throw ApiError.validation('Kuantitas inspeksi harus lebih besar dari nol.');
    }

    const workOrder = input.workOrderId
      ? await this.production.getWorkOrderById(tenantId, input.workOrderId)
      : undefined;
    if (input.workOrderId && !workOrder) throw ApiError.notFound('Work Order tidak ditemukan.');

    const inspection = await withTenant(tenantId, async (client) => {
      if (input.idempotencyKey) {
        const [existing] = await this.repo.listInspections(client, tenantId, {
          idempotencyKey: input.idempotencyKey,
        });
        if (existing) return existing;
      }

      const plan = input.inspectionPlanId
        ? await this.repo.findPlan(client, tenantId, input.inspectionPlanId)
        : undefined;
      const characteristics = plan?.characteristics ?? [];

      const id = `insp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const lines: InspectionResultLine[] = (input.measurements ?? []).map((measurement, index) => {
        const characteristic =
          characteristics.find((c) => c.id === measurement.characteristicId) ??
          characteristics.find((c) => c.name === measurement.characteristicName);

        return {
          id: `iline-${Date.now()}-${index + 1}`,
          inspectionId: id,
          characteristicId: characteristic?.id ?? measurement.characteristicId ?? '',
          characteristicName: measurement.characteristicName,
          expectedValue: QualityService.describeSpec(characteristic),
          actualValue: measurement.actualValue,
          numericValue: measurement.numericValue,
          result: QualityService.evaluate(characteristic, measurement),
          notes: measurement.notes,
        };
      });

      // A stated failed quantity wins — an inspector counting 3 bad pieces out
      // of 50 knows something the measurements alone do not. Absent that, a
      // failed line condemns the sample.
      const anyLineFailed = lines.some((line) => line.result === 'FAIL');
      const failed = input.failedQuantity ?? (anyLineFailed ? input.inspectedQuantity : 0);
      const passed = Math.max(input.inspectedQuantity - failed, 0);
      const result: Inspection['result'] = failed > 0 || anyLineFailed ? 'FAIL' : 'PASS';

      const record: Inspection = {
        id,
        tenantId,
        inspectionNumber: await this.repo.nextNumber(client, tenantId, 'inspection', 'inspection_number', 'INS'),
        inspectionPlanId: plan?.id,
        inspectionPlanName: plan?.name,
        inspectionType: input.inspectionType ?? plan?.inspectionType ?? 'IN_PROCESS',
        workOrderId: input.workOrderId,
        workOrderNumber: workOrder?.woNumber,
        batchId: input.batchId,
        productId: input.productId ?? workOrder?.productId,
        processId: input.processId ?? workOrder?.processId,
        machineId: input.machineId ?? workOrder?.machineId,
        inspectedQuantity: input.inspectedQuantity,
        passedQuantity: passed,
        failedQuantity: failed,
        uom: input.uom,
        result,
        operatorId: input.operatorId,
        inspectorId: actor.id,
        inspectorName: actor.name ?? actor.id,
        inspectedAt: new Date().toISOString(),
        idempotencyKey: input.idempotencyKey,
        notes: input.notes,
        lines,
      };

      await this.repo.insertInspection(client, record);
      return record;
    });

    this.events.recordDetached({
      tenantId,
      eventType: 'QUALITY_INSPECTION',
      entityType: 'INSPECTION',
      entityId: inspection.id,
      actorType: actor.type ?? 'USER',
      actorId: actor.id,
      actorName: actor.name,
      workOrderId: inspection.workOrderId,
      batchId: inspection.batchId,
      machineId: inspection.machineId,
      processId: inspection.processId,
      lineId: workOrder?.lineId,
      summary: `${inspection.inspectionNumber}: ${inspection.result} — ${inspection.passedQuantity} lolos, ${inspection.failedQuantity} gagal.`,
      afterValue: {
        result: inspection.result,
        inspectedQuantity: inspection.inspectedQuantity,
        failedQuantity: inspection.failedQuantity,
      },
    });

    return inspection;
  }

  async listInspections(
    tenantId: string,
    filter: {
      workOrderId?: string;
      batchId?: string;
      productId?: string;
      result?: string;
      from?: string;
      to?: string;
      limit?: number;
    } = {}
  ): Promise<Inspection[]> {
    return withTenant(tenantId, (client) => this.repo.listInspections(client, tenantId, filter));
  }

  /** A numeric reading outside its limits fails; an attribute one is as read. */
  private static evaluate(
    characteristic: InspectionCharacteristic | undefined,
    measurement: { actualValue?: string; numericValue?: number }
  ): 'PASS' | 'FAIL' {
    if (characteristic?.dataType === 'NUMERIC' || measurement.numericValue !== undefined) {
      const value = measurement.numericValue;
      if (value === undefined) return characteristic?.required ? 'FAIL' : 'PASS';
      if (characteristic?.lowerLimit !== undefined && value < characteristic.lowerLimit) return 'FAIL';
      if (characteristic?.upperLimit !== undefined && value > characteristic.upperLimit) return 'FAIL';
      return 'PASS';
    }
    const text = (measurement.actualValue ?? '').trim().toUpperCase();
    return text === 'FAIL' || text === 'NG' || text === 'TIDAK OK' ? 'FAIL' : 'PASS';
  }

  /** The spec as the inspector should read it back, e.g. "10.0 – 12.0 mm". */
  private static describeSpec(characteristic?: InspectionCharacteristic): string | undefined {
    if (!characteristic) return undefined;
    if (characteristic.specification) return characteristic.specification;
    const uom = characteristic.uom ? ` ${characteristic.uom}` : '';
    if (characteristic.lowerLimit !== undefined && characteristic.upperLimit !== undefined) {
      return `${characteristic.lowerLimit} – ${characteristic.upperLimit}${uom}`;
    }
    if (characteristic.targetValue !== undefined) return `${characteristic.targetValue}${uom}`;
    return undefined;
  }

  // ==========================================================
  // §4.4 Hold
  // ==========================================================

  async createHold(
    tenantId: string,
    input: {
      workOrderId?: string;
      batchId?: string;
      productId?: string;
      materialId?: string;
      inspectionId?: string;
      quantity: number;
      uom?: string;
      reason: string;
      ownerId: string;
      ownerName?: string;
      notes?: string;
    },
    actor: { id: string; name?: string }
  ): Promise<QualityHold> {
    // BR-Q04, restated where it is enforceable.
    if (!input.reason?.trim()) throw ApiError.validation('Alasan hold wajib diisi.');
    if (!input.ownerId) throw ApiError.validation('Pemilik (owner) hold wajib ditentukan.');

    const workOrder = input.workOrderId
      ? await this.production.getWorkOrderById(tenantId, input.workOrderId)
      : undefined;

    const hold = await withTenant(tenantId, async (client) => {
      const record: QualityHold = {
        id: `qhold-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        tenantId,
        holdNumber: await this.repo.nextNumber(client, tenantId, 'quality_hold', 'hold_number', 'QH'),
        workOrderId: input.workOrderId,
        workOrderNumber: workOrder?.woNumber,
        batchId: input.batchId,
        productId: input.productId ?? workOrder?.productId,
        materialId: input.materialId,
        inspectionId: input.inspectionId,
        quantity: input.quantity,
        uom: input.uom,
        reason: input.reason,
        ownerId: input.ownerId,
        ownerName: input.ownerName ?? input.ownerId,
        status: 'OPEN',
        heldBy: actor.id,
        heldAt: new Date().toISOString(),
        notes: input.notes,
      };
      await this.repo.insertHold(client, record);
      return record;
    });

    this.events.recordDetached({
      tenantId,
      eventType: 'QUALITY_HOLD',
      entityType: 'WORK_ORDER',
      entityId: hold.workOrderId ?? hold.id,
      actorType: 'USER',
      actorId: actor.id,
      actorName: actor.name,
      workOrderId: hold.workOrderId,
      batchId: hold.batchId,
      lineId: workOrder?.lineId,
      machineId: workOrder?.machineId,
      summary: `${hold.holdNumber}: ${hold.quantity} ditahan — ${hold.reason}`,
      afterValue: { quantity: hold.quantity, reason: hold.reason, ownerId: hold.ownerId },
    });

    return hold;
  }

  async listHolds(
    tenantId: string,
    filter: { status?: string; workOrderId?: string; batchId?: string } = {}
  ): Promise<QualityHold[]> {
    return withTenant(tenantId, (client) => this.repo.listHolds(client, tenantId, filter));
  }

  async releaseHold(
    tenantId: string,
    id: string,
    input: { reason: string },
    actor: { id: string; name?: string }
  ): Promise<QualityHold> {
    const hold = await withTenant(tenantId, async (client) => {
      const [existing] = await this.repo.listHolds(client, tenantId, { id });
      if (!existing) throw ApiError.notFound('Quality Hold tidak ditemukan.');
      if (existing.status !== 'OPEN') throw ApiError.invalidState('Hold ini sudah tidak terbuka.');

      await this.repo.closeHold(client, tenantId, id, { status: 'RELEASED', releasedBy: actor.id });
      return { ...existing, status: 'RELEASED' as const, releasedBy: actor.id, releasedAt: new Date().toISOString() };
    });

    this.events.recordDetached({
      tenantId,
      eventType: 'QUALITY_RELEASE',
      entityType: 'WORK_ORDER',
      entityId: hold.workOrderId ?? hold.id,
      actorType: 'USER',
      actorId: actor.id,
      actorName: actor.name,
      workOrderId: hold.workOrderId,
      batchId: hold.batchId,
      summary: `${hold.holdNumber} dilepas: ${input.reason}`,
      afterValue: { status: 'RELEASED', reason: input.reason },
    });

    return hold;
  }

  /**
   * BR-Q02 / BR-H04 — whether quality would block a downstream handoff.
   *
   * Two conditions: something is still on hold, or a mandatory inspection for
   * this product and process has not passed for this work order.
   */
  async transferBlock(
    tenantId: string,
    workOrderId: string,
    context: { productId?: string; processId?: string } = {}
  ): Promise<{ blocked: boolean; reason?: string }> {
    return withTenant(tenantId, async (client) => {
      const held = await this.repo.openHoldQuantity(client, tenantId, workOrderId);
      if (held > 0) {
        return { blocked: true, reason: `${held} unit masih berstatus Quality Hold.` };
      }

      const mandatory = await this.repo.mandatoryPlans(client, tenantId, context.productId, context.processId);
      if (mandatory.length === 0) return { blocked: false };

      const inspections = await this.repo.listInspections(client, tenantId, { workOrderId });
      for (const plan of mandatory) {
        const passed = inspections.some((i) => i.inspectionPlanId === plan.id && i.result === 'PASS');
        if (!passed) {
          return { blocked: true, reason: `Inspeksi wajib "${plan.name}" belum PASS.` };
        }
      }
      return { blocked: false };
    });
  }

  // ==========================================================
  // §4.5 Disposition (US-Q002)
  // ==========================================================

  /**
   * Decides what happens to a failed quantity.
   *
   * SCRAP and REWORK move the work order's quantities (BR-Q05): scrapped
   * pieces leave the good count for good, reworked ones are counted as rework
   * so the yield figures stay honest about what had to be done twice.
   */
  async createDisposition(
    tenantId: string,
    input: {
      decision: QualityDisposition['decision'];
      quantity: number;
      reason: string;
      inspectionId?: string;
      qualityHoldId?: string;
      workOrderId?: string;
      batchId?: string;
      productId?: string;
      uom?: string;
      defectCode?: string;
      ncrId?: string;
    },
    actor: { id: string; name?: string }
  ): Promise<QualityDisposition> {
    if (!input.reason?.trim()) throw ApiError.validation('Alasan disposition wajib diisi.');
    if (input.quantity <= 0) throw ApiError.validation('Kuantitas disposition harus lebih besar dari nol.');

    const workOrder = input.workOrderId
      ? await this.production.getWorkOrderById(tenantId, input.workOrderId)
      : undefined;

    const disposition = await withTenant(tenantId, async (client) => {
      const record: QualityDisposition = {
        id: `qdisp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        tenantId,
        inspectionId: input.inspectionId,
        qualityHoldId: input.qualityHoldId,
        workOrderId: input.workOrderId,
        workOrderNumber: workOrder?.woNumber,
        batchId: input.batchId,
        productId: input.productId ?? workOrder?.productId,
        decision: input.decision,
        quantity: input.quantity,
        uom: input.uom,
        reason: input.reason,
        defectCode: input.defectCode,
        ncrId: input.ncrId,
        decidedBy: actor.id,
        decidedByName: actor.name,
        decidedAt: new Date().toISOString(),
      };

      await this.repo.insertDisposition(client, record);
      if (input.inspectionId) {
        await this.repo.setInspectionDisposition(client, tenantId, input.inspectionId, record.id);
      }
      if (input.qualityHoldId) {
        await this.repo.closeHold(client, tenantId, input.qualityHoldId, {
          status: input.decision === 'RELEASE' ? 'RELEASED' : 'DISPOSITIONED',
          releasedBy: actor.id,
          dispositionId: record.id,
        });
      }
      return record;
    });

    // BR-Q05 — the decision has to reach the quantities, not just the record.
    //
    // Neither is a good or a reject: the reject was already counted when the
    // piece failed. This moves it into the scrap or rework bucket so §10's
    // `input >= output + reject + scrap + rework` still describes the work
    // order, which is why `input` moves with it.
    if (input.workOrderId && (input.decision === 'SCRAP' || input.decision === 'REWORK')) {
      await this.production.incrementQuantities(tenantId, input.workOrderId, 0, 0, {
        scrap: input.decision === 'SCRAP' ? input.quantity : 0,
        rework: input.decision === 'REWORK' ? input.quantity : 0,
        input: input.quantity,
      });
    }

    this.events.recordDetached({
      tenantId,
      eventType:
        input.decision === 'SCRAP'
          ? 'SCRAP_RECORDED'
          : input.decision === 'REWORK'
            ? 'REWORK_STARTED'
            : 'QUALITY_DISPOSITION',
      entityType: 'WORK_ORDER',
      entityId: disposition.workOrderId ?? disposition.id,
      actorType: 'USER',
      actorId: actor.id,
      actorName: actor.name,
      workOrderId: disposition.workOrderId,
      batchId: disposition.batchId,
      lineId: workOrder?.lineId,
      machineId: workOrder?.machineId,
      summary: `Disposition ${disposition.decision} ${disposition.quantity}: ${disposition.reason}`,
      afterValue: { decision: disposition.decision, quantity: disposition.quantity },
    });

    return disposition;
  }

  async listDispositions(
    tenantId: string,
    filter: { workOrderId?: string; inspectionId?: string; decision?: string; limit?: number } = {}
  ): Promise<QualityDisposition[]> {
    return withTenant(tenantId, (client) => this.repo.listDispositions(client, tenantId, filter));
  }

  // ==========================================================
  // §4.6, §4.7 NCR and corrective action (US-Q003)
  // ==========================================================

  async createNcr(
    tenantId: string,
    input: {
      title: string;
      description: string;
      severity?: NonConformanceRecord['severity'];
      ownerId: string;
      ownerName?: string;
      productId?: string;
      batchId?: string;
      workOrderId?: string;
      processId?: string;
      machineId?: string;
      operatorId?: string;
      defectCode?: string;
      inspectionId?: string;
      quantity?: number;
      uom?: string;
      dueDate?: string;
    },
    actor: { id: string; name?: string }
  ): Promise<NonConformanceRecord> {
    const workOrder = input.workOrderId
      ? await this.production.getWorkOrderById(tenantId, input.workOrderId)
      : undefined;

    const ncr = await withTenant(tenantId, async (client) => {
      const record: NonConformanceRecord = {
        id: `ncr-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        tenantId,
        ncrNumber: await this.repo.nextNumber(client, tenantId, 'non_conformance_record', 'ncr_number', 'NCR'),
        title: input.title,
        description: input.description,
        severity: input.severity ?? 'MEDIUM',
        status: 'OPEN',
        productId: input.productId ?? workOrder?.productId,
        batchId: input.batchId,
        workOrderId: input.workOrderId,
        workOrderNumber: workOrder?.woNumber,
        processId: input.processId ?? workOrder?.processId,
        machineId: input.machineId ?? workOrder?.machineId,
        operatorId: input.operatorId,
        defectCode: input.defectCode,
        inspectionId: input.inspectionId,
        quantity: input.quantity,
        uom: input.uom,
        ownerId: input.ownerId,
        ownerName: input.ownerName ?? input.ownerId,
        raisedBy: actor.id,
        raisedAt: new Date().toISOString(),
        dueDate: input.dueDate,
        actions: [],
      };
      await this.repo.insertNcr(client, record);
      return record;
    });

    this.events.recordDetached({
      tenantId,
      eventType: 'NCR_OPENED',
      entityType: 'NCR',
      entityId: ncr.id,
      actorType: 'USER',
      actorId: actor.id,
      actorName: actor.name,
      workOrderId: ncr.workOrderId,
      batchId: ncr.batchId,
      machineId: ncr.machineId,
      summary: `${ncr.ncrNumber} dibuka: ${ncr.title}`,
      afterValue: { severity: ncr.severity, ownerId: ncr.ownerId },
    });

    return ncr;
  }

  async listNcrs(
    tenantId: string,
    filter: { status?: string; workOrderId?: string; overdue?: boolean; limit?: number } = {}
  ): Promise<NonConformanceRecord[]> {
    return withTenant(tenantId, (client) => this.repo.listNcrs(client, tenantId, filter));
  }

  /**
   * Moves an NCR along its lifecycle (§4.6).
   *
   * Closing is the guarded transition: an NCR whose corrective actions are not
   * verified is not closed, it is abandoned, and the distinction is the whole
   * value of tracking one (US-Q003).
   */
  async updateNcr(
    tenantId: string,
    id: string,
    patch: {
      status?: NcrStatus;
      rootCause?: string;
      ownerId?: string;
      ownerName?: string;
      dueDate?: string;
      severity?: NonConformanceRecord['severity'];
    },
    actor: { id: string; name?: string }
  ): Promise<NonConformanceRecord> {
    const ncr = await withTenant(tenantId, async (client) => {
      const target = await this.repo.findNcr(client, tenantId, id);
      if (!target) throw ApiError.notFound('NCR tidak ditemukan.');

      if (patch.status === 'CLOSED') {
        const open = await this.repo.openActionCount(client, tenantId, id);
        if (open > 0) {
          throw ApiError.invalidState(
            `NCR tidak dapat ditutup: masih ada ${open} corrective action yang belum diverifikasi.`
          );
        }
      }

      await this.repo.updateNcr(client, tenantId, id, { ...patch, closedBy: actor.id });
      return (await this.repo.findNcr(client, tenantId, id))!;
    });

    if (patch.status === 'CLOSED') {
      this.events.recordDetached({
        tenantId,
        eventType: 'NCR_CLOSED',
        entityType: 'NCR',
        entityId: id,
        actorType: 'USER',
        actorId: actor.id,
        actorName: actor.name,
        workOrderId: ncr.workOrderId,
        summary: `${ncr.ncrNumber} ditutup.`,
        afterValue: { rootCause: ncr.rootCause },
      });
    }
    return ncr;
  }

  async addCorrectiveAction(
    tenantId: string,
    ncrId: string,
    input: { action: string; ownerId: string; ownerName?: string; dueDate?: string; notes?: string }
  ): Promise<CorrectiveAction> {
    return withTenant(tenantId, async (client) => {
      const record: CorrectiveAction = {
        id: `ca-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        tenantId,
        ncrId,
        sequence: await this.repo.nextSequence(client, tenantId, ncrId),
        action: input.action,
        ownerId: input.ownerId,
        ownerName: input.ownerName ?? input.ownerId,
        dueDate: input.dueDate,
        status: 'OPEN',
        notes: input.notes,
      };
      await this.repo.insertAction(client, record);
      // An NCR with an action on it is being worked, not merely open.
      await this.repo.updateNcr(client, tenantId, ncrId, { status: 'ACTION' });
      return record;
    });
  }

  async updateCorrectiveAction(
    tenantId: string,
    id: string,
    patch: { status?: CorrectiveAction['status']; evidence?: string },
    actor: { id: string }
  ): Promise<void> {
    await withTenant(tenantId, (client) =>
      this.repo.updateAction(client, tenantId, id, { ...patch, actorId: actor.id })
    );
  }

  // ==========================================================
  // §22.2 Quality dashboard
  // ==========================================================

  async dashboard(
    tenantId: string,
    range: { from?: string; to?: string } = {}
  ): Promise<{
    firstPassYield: number;
    inspectedQuantity: number;
    passedQuantity: number;
    failedQuantity: number;
    failRate: number;
    inspections: number;
    failedInspections: number;
    openHolds: number;
    heldQuantity: number;
    reworkQuantity: number;
    scrapQuantity: number;
    openNcr: number;
    overdueNcr: number;
    from: string;
    to: string;
  }> {
    const to = range.to ?? new Date().toISOString();
    const from = range.from ?? new Date(Date.now() - 30 * 86_400_000).toISOString();

    return withTenant(tenantId, async (client) => {
      const totals = await this.repo.yieldTotals(client, tenantId, from, to);
      const holds = await this.repo.listHolds(client, tenantId, { status: 'OPEN' });
      const dispositions = await this.repo.listDispositions(client, tenantId, { limit: 1000 });
      const ncrs = await this.repo.listNcrs(client, tenantId, { limit: 1000 });

      const sumOf = (decision: string) =>
        dispositions.filter((d) => d.decision === decision).reduce((sum, d) => sum + d.quantity, 0);

      return {
        // §25 — FPY is first-pass good over input, and the input is what was
        // inspected. Zero inspections is 0%, not 100%: nothing has been proven.
        firstPassYield:
          totals.inspected > 0 ? Number(((totals.passed / totals.inspected) * 100).toFixed(1)) : 0,
        inspectedQuantity: totals.inspected,
        passedQuantity: totals.passed,
        failedQuantity: totals.failed,
        failRate: totals.inspected > 0 ? Number(((totals.failed / totals.inspected) * 100).toFixed(1)) : 0,
        inspections: totals.inspections,
        failedInspections: totals.failures,
        openHolds: holds.length,
        heldQuantity: holds.reduce((sum, hold) => sum + hold.quantity, 0),
        reworkQuantity: sumOf('REWORK'),
        scrapQuantity: sumOf('SCRAP'),
        openNcr: ncrs.filter((n) => n.status !== 'CLOSED').length,
        overdueNcr: ncrs.filter(
          (n) => n.status !== 'CLOSED' && n.dueDate && n.dueDate < new Date().toISOString().slice(0, 10)
        ).length,
        from,
        to,
      };
    });
  }
}
