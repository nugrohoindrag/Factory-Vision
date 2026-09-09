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
import { asDateString, asIsoString, orUndefined, type Executor } from '../../platform/db/executor.js';

/**
 * The quality lifecycle's storage (migration 028).
 *
 * Names — of the product, the work order, the process — are joined rather than
 * copied. A quality record is read weeks later, and it should show what the
 * product is called now, not what it was called at inspection time. The
 * decisions themselves (result, disposition, owner) are of course stored.
 */

// ---------------------------------------------------------------- plans

interface PlanRow {
  id: string;
  tenant_id: string;
  plan_number: string;
  name: string;
  inspection_type: string;
  product_id: string | null;
  product_name: string | null;
  process_id: string | null;
  process_name: string | null;
  sampling_method: string;
  sampling_quantity: string | null;
  frequency: string | null;
  mandatory: boolean;
  status: string;
  created_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface CharacteristicRow {
  id: string;
  inspection_plan_id: string;
  sequence: number;
  name: string;
  data_type: string;
  specification: string | null;
  lower_limit: string | null;
  upper_limit: string | null;
  target_value: string | null;
  uom: string | null;
  required: boolean;
}

function toCharacteristic(row: CharacteristicRow): InspectionCharacteristic {
  return {
    id: row.id,
    inspectionPlanId: row.inspection_plan_id,
    sequence: row.sequence,
    name: row.name,
    dataType: row.data_type as InspectionCharacteristic['dataType'],
    specification: orUndefined(row.specification),
    lowerLimit: row.lower_limit === null ? undefined : Number(row.lower_limit),
    upperLimit: row.upper_limit === null ? undefined : Number(row.upper_limit),
    targetValue: row.target_value === null ? undefined : Number(row.target_value),
    uom: orUndefined(row.uom),
    required: row.required,
  };
}

function toPlan(row: PlanRow, characteristics: InspectionCharacteristic[]): InspectionPlan {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    planNumber: row.plan_number,
    name: row.name,
    inspectionType: row.inspection_type as InspectionPlan['inspectionType'],
    productId: orUndefined(row.product_id),
    productName: orUndefined(row.product_name),
    processId: orUndefined(row.process_id),
    processName: orUndefined(row.process_name),
    samplingMethod: row.sampling_method as InspectionPlan['samplingMethod'],
    samplingQuantity: row.sampling_quantity === null ? undefined : Number(row.sampling_quantity),
    frequency: orUndefined(row.frequency),
    mandatory: row.mandatory,
    status: row.status as InspectionPlan['status'],
    characteristics,
    createdBy: orUndefined(row.created_by),
    createdAt: asIsoString(row.created_at),
    updatedAt: asIsoString(row.updated_at),
  };
}

const PLAN_SELECT = `
  SELECT ip.id, ip.tenant_id, ip.plan_number, ip.name, ip.inspection_type,
         ip.product_id, p.name AS product_name, ip.process_id, pr.name AS process_name,
         ip.sampling_method, ip.sampling_quantity, ip.frequency, ip.mandatory, ip.status,
         ip.created_by, ip.created_at, ip.updated_at
    FROM inspection_plan ip
    LEFT JOIN product p ON p.id = ip.product_id
    LEFT JOIN production_process pr ON pr.id = ip.process_id
`;

// ---------------------------------------------------------- inspections

interface InspectionRow {
  id: string;
  tenant_id: string;
  inspection_number: string;
  inspection_plan_id: string | null;
  plan_name: string | null;
  inspection_type: string;
  work_order_id: string | null;
  wo_number: string | null;
  batch_id: string | null;
  batch_number: string | null;
  product_id: string | null;
  product_name: string | null;
  process_id: string | null;
  machine_id: string | null;
  inspected_quantity: string;
  passed_quantity: string;
  failed_quantity: string;
  uom: string | null;
  result: string;
  operator_id: string | null;
  operator_name: string | null;
  inspector_id: string;
  inspector_name: string | null;
  inspected_at: Date | string;
  disposition_id: string | null;
  idempotency_key: string | null;
  notes: string | null;
}

const INSPECTION_SELECT = `
  SELECT i.id, i.tenant_id, i.inspection_number, i.inspection_plan_id, ip.name AS plan_name,
         i.inspection_type, i.work_order_id, w.wo_number, i.batch_id, b.batch_number,
         i.product_id, p.name AS product_name, i.process_id, i.machine_id,
         i.inspected_quantity, i.passed_quantity, i.failed_quantity, i.uom, i.result,
         i.operator_id, o.name AS operator_name, i.inspector_id, i.inspector_name,
         i.inspected_at, i.disposition_id, i.idempotency_key, i.notes
    FROM inspection i
    LEFT JOIN inspection_plan ip ON ip.id = i.inspection_plan_id
    LEFT JOIN work_order w ON w.id = i.work_order_id
    LEFT JOIN production_batch b ON b.id = i.batch_id
    LEFT JOIN product p ON p.id = i.product_id
    LEFT JOIN operator o ON o.id = i.operator_id
`;

function toInspection(row: InspectionRow, lines: InspectionResultLine[]): Inspection {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    inspectionNumber: row.inspection_number,
    inspectionPlanId: orUndefined(row.inspection_plan_id),
    inspectionPlanName: orUndefined(row.plan_name),
    inspectionType: row.inspection_type as Inspection['inspectionType'],
    workOrderId: orUndefined(row.work_order_id),
    workOrderNumber: orUndefined(row.wo_number),
    batchId: orUndefined(row.batch_id),
    batchNumber: orUndefined(row.batch_number),
    productId: orUndefined(row.product_id),
    productName: orUndefined(row.product_name),
    processId: orUndefined(row.process_id),
    machineId: orUndefined(row.machine_id),
    inspectedQuantity: Number(row.inspected_quantity),
    passedQuantity: Number(row.passed_quantity),
    failedQuantity: Number(row.failed_quantity),
    uom: orUndefined(row.uom),
    result: row.result as Inspection['result'],
    operatorId: orUndefined(row.operator_id),
    operatorName: orUndefined(row.operator_name),
    inspectorId: row.inspector_id,
    inspectorName: row.inspector_name ?? row.inspector_id,
    inspectedAt: asIsoString(row.inspected_at),
    dispositionId: orUndefined(row.disposition_id),
    idempotencyKey: orUndefined(row.idempotency_key),
    notes: orUndefined(row.notes),
    lines,
  };
}

export class QualityRepository {
  // ================= Inspection plans =================

  async listPlans(
    exec: Executor,
    tenantId: string,
    filter: { productId?: string; processId?: string; status?: string } = {}
  ): Promise<InspectionPlan[]> {
    const where = ['ip.tenant_id = $1'];
    const params: unknown[] = [tenantId];

    if (filter.productId) {
      params.push(filter.productId);
      where.push(`ip.product_id = $${params.length}`);
    }
    if (filter.processId) {
      params.push(filter.processId);
      where.push(`ip.process_id = $${params.length}`);
    }
    if (filter.status) {
      params.push(filter.status);
      where.push(`ip.status = $${params.length}`);
    }

    const plans = await exec.query<PlanRow>(
      `${PLAN_SELECT} WHERE ${where.join(' AND ')} ORDER BY ip.created_at DESC`,
      params
    );
    if (plans.rows.length === 0) return [];

    const characteristics = await exec.query<CharacteristicRow>(
      `SELECT id, inspection_plan_id, sequence, name, data_type, specification,
              lower_limit, upper_limit, target_value, uom, required
         FROM inspection_characteristic
        WHERE tenant_id = $1
        ORDER BY sequence`,
      [tenantId]
    );

    const byPlan = new Map<string, InspectionCharacteristic[]>();
    for (const row of characteristics.rows) {
      const list = byPlan.get(row.inspection_plan_id) ?? [];
      list.push(toCharacteristic(row));
      byPlan.set(row.inspection_plan_id, list);
    }
    return plans.rows.map((row) => toPlan(row, byPlan.get(row.id) ?? []));
  }

  async findPlan(exec: Executor, tenantId: string, id: string): Promise<InspectionPlan | undefined> {
    const plans = await exec.query<PlanRow>(`${PLAN_SELECT} WHERE ip.tenant_id = $1 AND ip.id = $2`, [
      tenantId,
      id,
    ]);
    if (!plans.rows[0]) return undefined;
    const characteristics = await exec.query<CharacteristicRow>(
      `SELECT id, inspection_plan_id, sequence, name, data_type, specification,
              lower_limit, upper_limit, target_value, uom, required
         FROM inspection_characteristic WHERE inspection_plan_id = $1 ORDER BY sequence`,
      [id]
    );
    return toPlan(plans.rows[0], characteristics.rows.map(toCharacteristic));
  }

  async upsertPlan(exec: Executor, plan: InspectionPlan): Promise<void> {
    await exec.query(
      `INSERT INTO inspection_plan (
         id, tenant_id, plan_number, name, inspection_type, product_id, process_id,
         sampling_method, sampling_quantity, frequency, mandatory, status,
         created_by, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, inspection_type = EXCLUDED.inspection_type,
         product_id = EXCLUDED.product_id, process_id = EXCLUDED.process_id,
         sampling_method = EXCLUDED.sampling_method, sampling_quantity = EXCLUDED.sampling_quantity,
         frequency = EXCLUDED.frequency, mandatory = EXCLUDED.mandatory, status = EXCLUDED.status,
         updated_at = EXCLUDED.updated_at`,
      [
        plan.id,
        plan.tenantId,
        plan.planNumber,
        plan.name,
        plan.inspectionType,
        plan.productId ?? null,
        plan.processId ?? null,
        plan.samplingMethod,
        plan.samplingQuantity ?? null,
        plan.frequency ?? null,
        plan.mandatory,
        plan.status,
        plan.createdBy ?? null,
        plan.createdAt,
        plan.updatedAt,
      ]
    );

    await exec.query('DELETE FROM inspection_characteristic WHERE inspection_plan_id = $1', [plan.id]);
    for (const characteristic of plan.characteristics) {
      await exec.query(
        `INSERT INTO inspection_characteristic (
           id, tenant_id, inspection_plan_id, sequence, name, data_type, specification,
           lower_limit, upper_limit, target_value, uom, required
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          characteristic.id,
          plan.tenantId,
          plan.id,
          characteristic.sequence,
          characteristic.name,
          characteristic.dataType,
          characteristic.specification ?? null,
          characteristic.lowerLimit ?? null,
          characteristic.upperLimit ?? null,
          characteristic.targetValue ?? null,
          characteristic.uom ?? null,
          characteristic.required,
        ]
      );
    }
  }

  async deletePlan(exec: Executor, tenantId: string, id: string): Promise<void> {
    await exec.query('DELETE FROM inspection_plan WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
  }

  /** Mandatory active plans for a product/process pair (BR-Q01, BR-Q02). */
  async mandatoryPlans(
    exec: Executor,
    tenantId: string,
    productId?: string,
    processId?: string
  ): Promise<InspectionPlan[]> {
    const result = await exec.query<PlanRow>(
      `${PLAN_SELECT}
        WHERE ip.tenant_id = $1 AND ip.mandatory = TRUE AND ip.status = 'ACTIVE'
          AND (ip.product_id IS NULL OR ip.product_id = $2)
          AND (ip.process_id IS NULL OR ip.process_id = $3)`,
      [tenantId, productId ?? null, processId ?? null]
    );
    return result.rows.map((row) => toPlan(row, []));
  }

  // ================= Inspections =================

  async insertInspection(exec: Executor, inspection: Inspection): Promise<void> {
    await exec.query(
      `INSERT INTO inspection (
         id, tenant_id, inspection_number, inspection_plan_id, inspection_type, work_order_id,
         batch_id, product_id, process_id, machine_id, inspected_quantity, passed_quantity,
         failed_quantity, uom, result, operator_id, inspector_id, inspector_name, inspected_at,
         idempotency_key, notes
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
      [
        inspection.id,
        inspection.tenantId,
        inspection.inspectionNumber,
        inspection.inspectionPlanId ?? null,
        inspection.inspectionType,
        inspection.workOrderId ?? null,
        inspection.batchId ?? null,
        inspection.productId ?? null,
        inspection.processId ?? null,
        inspection.machineId ?? null,
        inspection.inspectedQuantity,
        inspection.passedQuantity,
        inspection.failedQuantity,
        inspection.uom ?? null,
        inspection.result,
        inspection.operatorId ?? null,
        inspection.inspectorId,
        inspection.inspectorName,
        inspection.inspectedAt,
        inspection.idempotencyKey ?? null,
        inspection.notes ?? null,
      ]
    );

    for (const line of inspection.lines) {
      await exec.query(
        `INSERT INTO inspection_result_line (
           id, tenant_id, inspection_id, characteristic_id, characteristic_name,
           expected_value, actual_value, numeric_value, result, notes
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          line.id,
          inspection.tenantId,
          inspection.id,
          line.characteristicId || null,
          line.characteristicName,
          line.expectedValue ?? null,
          line.actualValue ?? null,
          line.numericValue ?? null,
          line.result,
          line.notes ?? null,
        ]
      );
    }
  }

  async listInspections(
    exec: Executor,
    tenantId: string,
    filter: {
      workOrderId?: string;
      batchId?: string;
      productId?: string;
      result?: string;
      idempotencyKey?: string;
      from?: string;
      to?: string;
      limit?: number;
    } = {}
  ): Promise<Inspection[]> {
    const where = ['i.tenant_id = $1'];
    const params: unknown[] = [tenantId];

    if (filter.workOrderId) {
      params.push(filter.workOrderId);
      where.push(`i.work_order_id = $${params.length}`);
    }
    if (filter.batchId) {
      params.push(filter.batchId);
      where.push(`i.batch_id = $${params.length}`);
    }
    if (filter.productId) {
      params.push(filter.productId);
      where.push(`i.product_id = $${params.length}`);
    }
    if (filter.result) {
      params.push(filter.result);
      where.push(`i.result = $${params.length}`);
    }
    if (filter.idempotencyKey) {
      params.push(filter.idempotencyKey);
      where.push(`i.idempotency_key = $${params.length}`);
    }
    if (filter.from) {
      params.push(filter.from);
      where.push(`i.inspected_at >= $${params.length}`);
    }
    if (filter.to) {
      params.push(filter.to);
      where.push(`i.inspected_at <= $${params.length}`);
    }
    params.push(Math.min(filter.limit ?? 200, 1000));

    const rows = await exec.query<InspectionRow>(
      `${INSPECTION_SELECT} WHERE ${where.join(' AND ')}
        ORDER BY i.inspected_at DESC LIMIT $${params.length}`,
      params
    );
    if (rows.rows.length === 0) return [];

    const lines = await exec.query<{
      id: string;
      inspection_id: string;
      characteristic_id: string | null;
      characteristic_name: string;
      expected_value: string | null;
      actual_value: string | null;
      numeric_value: string | null;
      result: string;
      notes: string | null;
    }>(
      `SELECT id, inspection_id, characteristic_id, characteristic_name, expected_value,
              actual_value, numeric_value, result, notes
         FROM inspection_result_line
        WHERE inspection_id = ANY($1::varchar[])`,
      [rows.rows.map((row) => row.id)]
    );

    const byInspection = new Map<string, InspectionResultLine[]>();
    for (const row of lines.rows) {
      const list = byInspection.get(row.inspection_id) ?? [];
      list.push({
        id: row.id,
        inspectionId: row.inspection_id,
        characteristicId: row.characteristic_id ?? '',
        characteristicName: row.characteristic_name,
        expectedValue: orUndefined(row.expected_value),
        actualValue: orUndefined(row.actual_value),
        numericValue: row.numeric_value === null ? undefined : Number(row.numeric_value),
        result: row.result as InspectionResultLine['result'],
        notes: orUndefined(row.notes),
      });
      byInspection.set(row.inspection_id, list);
    }

    return rows.rows.map((row) => toInspection(row, byInspection.get(row.id) ?? []));
  }

  async setInspectionDisposition(
    exec: Executor,
    tenantId: string,
    inspectionId: string,
    dispositionId: string
  ): Promise<void> {
    await exec.query(
      'UPDATE inspection SET disposition_id = $3 WHERE tenant_id = $1 AND id = $2',
      [tenantId, inspectionId, dispositionId]
    );
  }

  /** First Pass Yield inputs for a period (§25). */
  async yieldTotals(
    exec: Executor,
    tenantId: string,
    from: string,
    to: string
  ): Promise<{ inspected: number; passed: number; failed: number; inspections: number; failures: number }> {
    const result = await exec.query<{
      inspected: string;
      passed: string;
      failed: string;
      inspections: string;
      failures: string;
    }>(
      `SELECT COALESCE(sum(inspected_quantity), 0)::text AS inspected,
              COALESCE(sum(passed_quantity), 0)::text AS passed,
              COALESCE(sum(failed_quantity), 0)::text AS failed,
              count(*)::text AS inspections,
              count(*) FILTER (WHERE result = 'FAIL')::text AS failures
         FROM inspection
        WHERE tenant_id = $1 AND inspected_at >= $2 AND inspected_at <= $3`,
      [tenantId, from, to]
    );
    const row = result.rows[0];
    return {
      inspected: Number(row?.inspected ?? 0),
      passed: Number(row?.passed ?? 0),
      failed: Number(row?.failed ?? 0),
      inspections: Number(row?.inspections ?? 0),
      failures: Number(row?.failures ?? 0),
    };
  }

  // ================= Holds =================

  async insertHold(exec: Executor, hold: QualityHold): Promise<void> {
    await exec.query(
      `INSERT INTO quality_hold (
         id, tenant_id, hold_number, work_order_id, batch_id, product_id, material_id,
         inspection_id, quantity, uom, reason, owner_id, owner_name, status, held_by, held_at, notes
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        hold.id,
        hold.tenantId,
        hold.holdNumber,
        hold.workOrderId ?? null,
        hold.batchId ?? null,
        hold.productId ?? null,
        hold.materialId ?? null,
        hold.inspectionId ?? null,
        hold.quantity,
        hold.uom ?? null,
        hold.reason,
        hold.ownerId,
        hold.ownerName,
        hold.status,
        hold.heldBy,
        hold.heldAt,
        hold.notes ?? null,
      ]
    );
  }

  async listHolds(
    exec: Executor,
    tenantId: string,
    filter: { id?: string; status?: string; workOrderId?: string; batchId?: string } = {}
  ): Promise<QualityHold[]> {
    const where = ['h.tenant_id = $1'];
    const params: unknown[] = [tenantId];

    if (filter.id) {
      params.push(filter.id);
      where.push(`h.id = $${params.length}`);
    }
    if (filter.status) {
      params.push(filter.status);
      where.push(`h.status = $${params.length}`);
    }
    if (filter.workOrderId) {
      params.push(filter.workOrderId);
      where.push(`h.work_order_id = $${params.length}`);
    }
    if (filter.batchId) {
      params.push(filter.batchId);
      where.push(`h.batch_id = $${params.length}`);
    }

    const rows = await exec.query<{
      id: string;
      tenant_id: string;
      hold_number: string;
      work_order_id: string | null;
      wo_number: string | null;
      batch_id: string | null;
      batch_number: string | null;
      product_id: string | null;
      product_name: string | null;
      material_id: string | null;
      inspection_id: string | null;
      quantity: string;
      uom: string | null;
      reason: string;
      owner_id: string;
      owner_name: string | null;
      status: string;
      held_by: string;
      held_at: Date | string;
      released_by: string | null;
      released_at: Date | string | null;
      disposition_id: string | null;
      notes: string | null;
    }>(
      `SELECT h.id, h.tenant_id, h.hold_number, h.work_order_id, w.wo_number, h.batch_id,
              b.batch_number, h.product_id, p.name AS product_name, h.material_id, h.inspection_id,
              h.quantity, h.uom, h.reason, h.owner_id, h.owner_name, h.status, h.held_by, h.held_at,
              h.released_by, h.released_at, h.disposition_id, h.notes
         FROM quality_hold h
         LEFT JOIN work_order w ON w.id = h.work_order_id
         LEFT JOIN production_batch b ON b.id = h.batch_id
         LEFT JOIN product p ON p.id = h.product_id
        WHERE ${where.join(' AND ')}
        ORDER BY h.held_at DESC`,
      params
    );

    return rows.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      holdNumber: row.hold_number,
      workOrderId: orUndefined(row.work_order_id),
      workOrderNumber: orUndefined(row.wo_number),
      batchId: orUndefined(row.batch_id),
      batchNumber: orUndefined(row.batch_number),
      productId: orUndefined(row.product_id),
      productName: orUndefined(row.product_name),
      materialId: orUndefined(row.material_id),
      inspectionId: orUndefined(row.inspection_id),
      quantity: Number(row.quantity),
      uom: orUndefined(row.uom),
      reason: row.reason,
      ownerId: row.owner_id,
      ownerName: row.owner_name ?? row.owner_id,
      status: row.status as QualityHold['status'],
      heldBy: row.held_by,
      heldAt: asIsoString(row.held_at),
      releasedBy: orUndefined(row.released_by),
      releasedAt: row.released_at ? asIsoString(row.released_at) : undefined,
      dispositionId: orUndefined(row.disposition_id),
      notes: orUndefined(row.notes),
    }));
  }

  async closeHold(
    exec: Executor,
    tenantId: string,
    id: string,
    input: { status: QualityHold['status']; releasedBy: string; dispositionId?: string }
  ): Promise<void> {
    await exec.query(
      `UPDATE quality_hold
          SET status = $3, released_by = $4, released_at = CURRENT_TIMESTAMP,
              disposition_id = COALESCE($5, disposition_id)
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, input.status, input.releasedBy, input.dispositionId ?? null]
    );
  }

  /** BR-Q02 — anything still on hold for this work order blocks the handoff. */
  async openHoldQuantity(exec: Executor, tenantId: string, workOrderId: string): Promise<number> {
    const result = await exec.query<{ total: string }>(
      `SELECT COALESCE(sum(quantity), 0)::text AS total
         FROM quality_hold
        WHERE tenant_id = $1 AND work_order_id = $2 AND status = 'OPEN'`,
      [tenantId, workOrderId]
    );
    return Number(result.rows[0]?.total ?? 0);
  }

  // ================= Dispositions =================

  async insertDisposition(exec: Executor, disposition: QualityDisposition): Promise<void> {
    await exec.query(
      `INSERT INTO quality_disposition (
         id, tenant_id, inspection_id, quality_hold_id, work_order_id, batch_id, product_id,
         decision, quantity, uom, reason, defect_code, ncr_id, decided_by, decided_by_name, decided_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        disposition.id,
        disposition.tenantId,
        disposition.inspectionId ?? null,
        disposition.qualityHoldId ?? null,
        disposition.workOrderId ?? null,
        disposition.batchId ?? null,
        disposition.productId ?? null,
        disposition.decision,
        disposition.quantity,
        disposition.uom ?? null,
        disposition.reason,
        disposition.defectCode ?? null,
        disposition.ncrId ?? null,
        disposition.decidedBy,
        disposition.decidedByName ?? null,
        disposition.decidedAt,
      ]
    );
  }

  async listDispositions(
    exec: Executor,
    tenantId: string,
    filter: { workOrderId?: string; inspectionId?: string; decision?: string; limit?: number } = {}
  ): Promise<QualityDisposition[]> {
    const where = ['d.tenant_id = $1'];
    const params: unknown[] = [tenantId];

    if (filter.workOrderId) {
      params.push(filter.workOrderId);
      where.push(`d.work_order_id = $${params.length}`);
    }
    if (filter.inspectionId) {
      params.push(filter.inspectionId);
      where.push(`d.inspection_id = $${params.length}`);
    }
    if (filter.decision) {
      params.push(filter.decision);
      where.push(`d.decision = $${params.length}`);
    }
    params.push(Math.min(filter.limit ?? 200, 1000));

    const rows = await exec.query<{
      id: string;
      tenant_id: string;
      inspection_id: string | null;
      quality_hold_id: string | null;
      work_order_id: string | null;
      wo_number: string | null;
      batch_id: string | null;
      product_id: string | null;
      decision: string;
      quantity: string;
      uom: string | null;
      reason: string;
      defect_code: string | null;
      ncr_id: string | null;
      decided_by: string;
      decided_by_name: string | null;
      decided_at: Date | string;
    }>(
      `SELECT d.id, d.tenant_id, d.inspection_id, d.quality_hold_id, d.work_order_id, w.wo_number,
              d.batch_id, d.product_id, d.decision, d.quantity, d.uom, d.reason, d.defect_code,
              d.ncr_id, d.decided_by, d.decided_by_name, d.decided_at
         FROM quality_disposition d
         LEFT JOIN work_order w ON w.id = d.work_order_id
        WHERE ${where.join(' AND ')}
        ORDER BY d.decided_at DESC LIMIT $${params.length}`,
      params
    );

    return rows.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      inspectionId: orUndefined(row.inspection_id),
      qualityHoldId: orUndefined(row.quality_hold_id),
      workOrderId: orUndefined(row.work_order_id),
      workOrderNumber: orUndefined(row.wo_number),
      batchId: orUndefined(row.batch_id),
      productId: orUndefined(row.product_id),
      decision: row.decision as QualityDisposition['decision'],
      quantity: Number(row.quantity),
      uom: orUndefined(row.uom),
      reason: row.reason,
      defectCode: orUndefined(row.defect_code),
      ncrId: orUndefined(row.ncr_id),
      decidedBy: row.decided_by,
      decidedByName: orUndefined(row.decided_by_name),
      decidedAt: asIsoString(row.decided_at),
    }));
  }

  // ================= NCR =================

  async insertNcr(exec: Executor, ncr: NonConformanceRecord): Promise<void> {
    await exec.query(
      `INSERT INTO non_conformance_record (
         id, tenant_id, ncr_number, title, description, severity, status, product_id, batch_id,
         work_order_id, process_id, machine_id, operator_id, defect_code, inspection_id, quantity,
         uom, root_cause, owner_id, owner_name, raised_by, raised_at, due_date
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
      [
        ncr.id,
        ncr.tenantId,
        ncr.ncrNumber,
        ncr.title,
        ncr.description,
        ncr.severity,
        ncr.status,
        ncr.productId ?? null,
        ncr.batchId ?? null,
        ncr.workOrderId ?? null,
        ncr.processId ?? null,
        ncr.machineId ?? null,
        ncr.operatorId ?? null,
        ncr.defectCode ?? null,
        ncr.inspectionId ?? null,
        ncr.quantity ?? null,
        ncr.uom ?? null,
        ncr.rootCause ?? null,
        ncr.ownerId,
        ncr.ownerName,
        ncr.raisedBy,
        ncr.raisedAt,
        ncr.dueDate ?? null,
      ]
    );
  }

  async updateNcr(
    exec: Executor,
    tenantId: string,
    id: string,
    patch: {
      status?: NcrStatus;
      rootCause?: string;
      ownerId?: string;
      ownerName?: string;
      dueDate?: string;
      severity?: string;
      closedBy?: string;
    }
  ): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [tenantId, id];

    const push = (column: string, value: unknown) => {
      if (value === undefined) return;
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };

    push('status', patch.status);
    push('root_cause', patch.rootCause);
    push('owner_id', patch.ownerId);
    push('owner_name', patch.ownerName);
    push('due_date', patch.dueDate);
    push('severity', patch.severity);
    if (patch.status === 'CLOSED') {
      push('closed_by', patch.closedBy ?? null);
      sets.push('closed_at = CURRENT_TIMESTAMP');
    }
    if (sets.length === 0) return;

    await exec.query(
      `UPDATE non_conformance_record SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2`,
      params
    );
  }

  async listNcrs(
    exec: Executor,
    tenantId: string,
    filter: { id?: string; status?: string; workOrderId?: string; overdue?: boolean; limit?: number } = {}
  ): Promise<NonConformanceRecord[]> {
    const where = ['n.tenant_id = $1'];
    const params: unknown[] = [tenantId];

    if (filter.id) {
      params.push(filter.id);
      where.push(`n.id = $${params.length}`);
    }
    if (filter.status) {
      params.push(filter.status);
      where.push(`n.status = $${params.length}`);
    }
    if (filter.workOrderId) {
      params.push(filter.workOrderId);
      where.push(`n.work_order_id = $${params.length}`);
    }
    if (filter.overdue) {
      where.push("n.due_date IS NOT NULL AND n.due_date < CURRENT_DATE AND n.status <> 'CLOSED'");
    }
    params.push(Math.min(filter.limit ?? 200, 1000));

    const rows = await exec.query<{
      id: string;
      tenant_id: string;
      ncr_number: string;
      title: string;
      description: string;
      severity: string;
      status: string;
      product_id: string | null;
      product_name: string | null;
      batch_id: string | null;
      work_order_id: string | null;
      wo_number: string | null;
      process_id: string | null;
      machine_id: string | null;
      operator_id: string | null;
      defect_code: string | null;
      inspection_id: string | null;
      quantity: string | null;
      uom: string | null;
      root_cause: string | null;
      owner_id: string;
      owner_name: string | null;
      raised_by: string;
      raised_at: Date | string;
      due_date: Date | string | null;
      closed_by: string | null;
      closed_at: Date | string | null;
    }>(
      `SELECT n.id, n.tenant_id, n.ncr_number, n.title, n.description, n.severity, n.status,
              n.product_id, p.name AS product_name, n.batch_id, n.work_order_id, w.wo_number,
              n.process_id, n.machine_id, n.operator_id, n.defect_code, n.inspection_id,
              n.quantity, n.uom, n.root_cause, n.owner_id, n.owner_name, n.raised_by, n.raised_at,
              n.due_date, n.closed_by, n.closed_at
         FROM non_conformance_record n
         LEFT JOIN product p ON p.id = n.product_id
         LEFT JOIN work_order w ON w.id = n.work_order_id
        WHERE ${where.join(' AND ')}
        ORDER BY n.raised_at DESC LIMIT $${params.length}`,
      params
    );
    if (rows.rows.length === 0) return [];

    const actions = await exec.query<ActionRow>(
      `SELECT id, tenant_id, ncr_id, sequence, action, owner_id, owner_name, due_date, status,
              completed_at, completed_by, verified_at, verified_by, evidence, notes
         FROM corrective_action
        WHERE ncr_id = ANY($1::varchar[])
        ORDER BY sequence`,
      [rows.rows.map((row) => row.id)]
    );

    const byNcr = new Map<string, CorrectiveAction[]>();
    for (const row of actions.rows) {
      const list = byNcr.get(row.ncr_id) ?? [];
      list.push(toAction(row));
      byNcr.set(row.ncr_id, list);
    }

    return rows.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      ncrNumber: row.ncr_number,
      title: row.title,
      description: row.description,
      severity: row.severity as NonConformanceRecord['severity'],
      status: row.status as NcrStatus,
      productId: orUndefined(row.product_id),
      productName: orUndefined(row.product_name),
      batchId: orUndefined(row.batch_id),
      workOrderId: orUndefined(row.work_order_id),
      workOrderNumber: orUndefined(row.wo_number),
      processId: orUndefined(row.process_id),
      machineId: orUndefined(row.machine_id),
      operatorId: orUndefined(row.operator_id),
      defectCode: orUndefined(row.defect_code),
      inspectionId: orUndefined(row.inspection_id),
      quantity: row.quantity === null ? undefined : Number(row.quantity),
      uom: orUndefined(row.uom),
      rootCause: orUndefined(row.root_cause),
      ownerId: row.owner_id,
      ownerName: row.owner_name ?? row.owner_id,
      raisedBy: row.raised_by,
      raisedAt: asIsoString(row.raised_at),
      dueDate: row.due_date ? asDateString(row.due_date) : undefined,
      closedBy: orUndefined(row.closed_by),
      closedAt: row.closed_at ? asIsoString(row.closed_at) : undefined,
      actions: byNcr.get(row.id) ?? [],
    }));
  }

  async findNcr(exec: Executor, tenantId: string, id: string): Promise<NonConformanceRecord | undefined> {
    const rows = await this.listNcrs(exec, tenantId, { id });
    return rows[0];
  }

  // ================= Corrective actions =================

  async insertAction(exec: Executor, action: CorrectiveAction): Promise<void> {
    await exec.query(
      `INSERT INTO corrective_action (
         id, tenant_id, ncr_id, sequence, action, owner_id, owner_name, due_date, status, evidence, notes
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        action.id,
        action.tenantId,
        action.ncrId,
        action.sequence,
        action.action,
        action.ownerId,
        action.ownerName,
        action.dueDate ?? null,
        action.status,
        action.evidence ?? null,
        action.notes ?? null,
      ]
    );
  }

  async updateAction(
    exec: Executor,
    tenantId: string,
    id: string,
    patch: { status?: CorrectiveAction['status']; evidence?: string; actorId?: string }
  ): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [tenantId, id];

    if (patch.status) {
      params.push(patch.status);
      sets.push(`status = $${params.length}`);
      if (patch.status === 'COMPLETED') {
        params.push(patch.actorId ?? null);
        sets.push(`completed_by = $${params.length}`, 'completed_at = CURRENT_TIMESTAMP');
      }
      if (patch.status === 'VERIFIED') {
        params.push(patch.actorId ?? null);
        sets.push(`verified_by = $${params.length}`, 'verified_at = CURRENT_TIMESTAMP');
      }
    }
    if (patch.evidence !== undefined) {
      params.push(patch.evidence);
      sets.push(`evidence = $${params.length}`);
    }
    if (sets.length === 0) return;

    await exec.query(
      `UPDATE corrective_action SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2`,
      params
    );
  }

  /** BR-Q "NCR can be closed only after required action" (US-Q003). */
  async openActionCount(exec: Executor, tenantId: string, ncrId: string): Promise<number> {
    const result = await exec.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM corrective_action
        WHERE tenant_id = $1 AND ncr_id = $2 AND status NOT IN ('VERIFIED', 'CANCELLED')`,
      [tenantId, ncrId]
    );
    return Number(result.rows[0]?.n ?? 0);
  }

  async nextSequence(exec: Executor, tenantId: string, ncrId: string): Promise<number> {
    const result = await exec.query<{ n: string }>(
      'SELECT COALESCE(max(sequence), 0)::text AS n FROM corrective_action WHERE tenant_id = $1 AND ncr_id = $2',
      [tenantId, ncrId]
    );
    return Number(result.rows[0]?.n ?? 0) + 1;
  }

  /** Sequential number within a tenant, used for every quality document. */
  async nextNumber(exec: Executor, tenantId: string, table: string, column: string, prefix: string): Promise<string> {
    const result = await exec.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM ${table} WHERE tenant_id = $1`,
      [tenantId]
    );
    const next = Number(result.rows[0]?.n ?? 0) + 1;
    const year = new Date().getFullYear();
    return `${prefix}-${year}-${String(next).padStart(4, '0')}`;
  }
}

interface ActionRow {
  id: string;
  tenant_id: string;
  ncr_id: string;
  sequence: number;
  action: string;
  owner_id: string;
  owner_name: string | null;
  due_date: Date | string | null;
  status: string;
  completed_at: Date | string | null;
  completed_by: string | null;
  verified_at: Date | string | null;
  verified_by: string | null;
  evidence: string | null;
  notes: string | null;
}

function toAction(row: ActionRow): CorrectiveAction {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    ncrId: row.ncr_id,
    sequence: row.sequence,
    action: row.action,
    ownerId: row.owner_id,
    ownerName: row.owner_name ?? row.owner_id,
    dueDate: row.due_date ? asDateString(row.due_date) : undefined,
    status: row.status as CorrectiveAction['status'],
    completedAt: row.completed_at ? asIsoString(row.completed_at) : undefined,
    completedBy: orUndefined(row.completed_by),
    verifiedAt: row.verified_at ? asIsoString(row.verified_at) : undefined,
    verifiedBy: orUndefined(row.verified_by),
    evidence: orUndefined(row.evidence),
    notes: orUndefined(row.notes),
  };
}
