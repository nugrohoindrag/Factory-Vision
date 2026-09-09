import type {
  MaintenancePartUsage,
  MaintenancePlan,
  MaintenanceRecord,
  MaintenanceRequest,
  MaintenanceState,
} from '@factory-vision/domain-types';
import { asIsoString, orUndefined, type Executor } from '../../platform/db/executor.js';

/** Maintenance plans, requests and records (migration 029). */

interface PlanRow {
  id: string;
  tenant_id: string;
  plan_number: string;
  name: string;
  machine_id: string;
  machine_name: string;
  trigger_type: string;
  interval_value: string;
  interval_unit: string;
  tasks: string[] | null;
  estimated_duration_minutes: number | null;
  last_performed_at: Date | string | null;
  last_performed_meter: string | null;
  next_due_at: Date | string | null;
  next_due_meter: string | null;
  warning_threshold: string | null;
  status: string;
  created_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function toPlan(row: PlanRow): MaintenancePlan {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    planNumber: row.plan_number,
    name: row.name,
    machineId: row.machine_id,
    machineName: row.machine_name,
    triggerType: row.trigger_type as MaintenancePlan['triggerType'],
    intervalValue: Number(row.interval_value),
    intervalUnit: row.interval_unit,
    tasks: row.tasks ?? [],
    estimatedDurationMinutes: row.estimated_duration_minutes ?? undefined,
    lastPerformedAt: row.last_performed_at ? asIsoString(row.last_performed_at) : undefined,
    lastPerformedMeter: row.last_performed_meter === null ? undefined : Number(row.last_performed_meter),
    nextDueAt: row.next_due_at ? asIsoString(row.next_due_at) : undefined,
    nextDueMeter: row.next_due_meter === null ? undefined : Number(row.next_due_meter),
    warningThreshold: row.warning_threshold === null ? undefined : Number(row.warning_threshold),
    status: row.status as MaintenancePlan['status'],
    createdBy: orUndefined(row.created_by),
    createdAt: asIsoString(row.created_at),
    updatedAt: asIsoString(row.updated_at),
  };
}

const PLAN_SELECT = `
  SELECT mp.id, mp.tenant_id, mp.plan_number, mp.name, mp.machine_id, m.name AS machine_name,
         mp.trigger_type, mp.interval_value, mp.interval_unit, mp.tasks,
         mp.estimated_duration_minutes, mp.last_performed_at, mp.last_performed_meter,
         mp.next_due_at, mp.next_due_meter, mp.warning_threshold, mp.status,
         mp.created_by, mp.created_at, mp.updated_at
    FROM maintenance_plan mp
    JOIN machine m ON m.id = mp.machine_id
`;

interface RequestRow {
  id: string;
  tenant_id: string;
  request_number: string;
  machine_id: string;
  machine_name: string;
  maintenance_type: string;
  priority: string;
  problem_description: string;
  reported_symptom: string | null;
  work_order_id: string | null;
  downtime_id: string | null;
  requested_by: string;
  requested_by_name: string | null;
  requested_at: Date | string;
  status: string;
  maintenance_record_id: string | null;
  notes: string | null;
}

function toRequest(row: RequestRow): MaintenanceRequest {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    requestNumber: row.request_number,
    machineId: row.machine_id,
    machineName: row.machine_name,
    maintenanceType: row.maintenance_type as MaintenanceRequest['maintenanceType'],
    priority: row.priority as MaintenanceRequest['priority'],
    problemDescription: row.problem_description,
    reportedSymptom: orUndefined(row.reported_symptom),
    workOrderId: orUndefined(row.work_order_id),
    downtimeId: orUndefined(row.downtime_id),
    requestedBy: row.requested_by,
    requestedByName: orUndefined(row.requested_by_name),
    requestedAt: asIsoString(row.requested_at),
    status: row.status as MaintenanceRequest['status'],
    maintenanceRecordId: orUndefined(row.maintenance_record_id),
    notes: orUndefined(row.notes),
  };
}

interface RecordRow {
  id: string;
  tenant_id: string;
  maintenance_number: string;
  machine_id: string;
  machine_name: string;
  maintenance_type: string;
  maintenance_plan_id: string | null;
  maintenance_request_id: string | null;
  downtime_id: string | null;
  status: string;
  problem: string | null;
  root_cause: string | null;
  action_taken: string | null;
  requester_id: string | null;
  requester_name: string | null;
  technician_id: string | null;
  technician_name: string | null;
  scheduled_for: Date | string | null;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  duration_minutes: number | null;
  result: string | null;
  cost_reference: string | null;
  notes: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function toRecord(row: RecordRow, parts: MaintenancePartUsage[]): MaintenanceRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    maintenanceNumber: row.maintenance_number,
    machineId: row.machine_id,
    machineName: row.machine_name,
    maintenanceType: row.maintenance_type as MaintenanceRecord['maintenanceType'],
    maintenancePlanId: orUndefined(row.maintenance_plan_id),
    maintenanceRequestId: orUndefined(row.maintenance_request_id),
    downtimeId: orUndefined(row.downtime_id),
    status: row.status as MaintenanceState,
    problem: orUndefined(row.problem),
    rootCause: orUndefined(row.root_cause),
    actionTaken: orUndefined(row.action_taken),
    requesterId: orUndefined(row.requester_id),
    requesterName: orUndefined(row.requester_name),
    technicianId: orUndefined(row.technician_id),
    technicianName: orUndefined(row.technician_name),
    scheduledFor: row.scheduled_for ? asIsoString(row.scheduled_for) : undefined,
    startedAt: row.started_at ? asIsoString(row.started_at) : undefined,
    completedAt: row.completed_at ? asIsoString(row.completed_at) : undefined,
    durationMinutes: row.duration_minutes ?? undefined,
    result: (row.result ?? undefined) as MaintenanceRecord['result'],
    costReference: row.cost_reference === null ? undefined : Number(row.cost_reference),
    parts,
    notes: orUndefined(row.notes),
    createdAt: asIsoString(row.created_at),
    updatedAt: asIsoString(row.updated_at),
  };
}

const RECORD_SELECT = `
  SELECT mr.id, mr.tenant_id, mr.maintenance_number, mr.machine_id, m.name AS machine_name,
         mr.maintenance_type, mr.maintenance_plan_id, mr.maintenance_request_id, mr.downtime_id,
         mr.status, mr.problem, mr.root_cause, mr.action_taken, mr.requester_id, mr.requester_name,
         mr.technician_id, mr.technician_name, mr.scheduled_for, mr.started_at, mr.completed_at,
         mr.duration_minutes, mr.result, mr.cost_reference, mr.notes, mr.created_at, mr.updated_at
    FROM maintenance_record mr
    JOIN machine m ON m.id = mr.machine_id
`;

export class MaintenanceRepository {
  // ================= Plans =================

  async listPlans(
    exec: Executor,
    tenantId: string,
    filter: { id?: string; machineId?: string; status?: string } = {}
  ): Promise<MaintenancePlan[]> {
    const where = ['mp.tenant_id = $1'];
    const params: unknown[] = [tenantId];

    if (filter.id) {
      params.push(filter.id);
      where.push(`mp.id = $${params.length}`);
    }
    if (filter.machineId) {
      params.push(filter.machineId);
      where.push(`mp.machine_id = $${params.length}`);
    }
    if (filter.status) {
      params.push(filter.status);
      where.push(`mp.status = $${params.length}`);
    }

    const rows = await exec.query<PlanRow>(
      `${PLAN_SELECT} WHERE ${where.join(' AND ')} ORDER BY mp.next_due_at NULLS LAST, mp.plan_number`,
      params
    );
    return rows.rows.map(toPlan);
  }

  async upsertPlan(exec: Executor, plan: MaintenancePlan): Promise<void> {
    await exec.query(
      `INSERT INTO maintenance_plan (
         id, tenant_id, plan_number, name, machine_id, trigger_type, interval_value, interval_unit,
         tasks, estimated_duration_minutes, last_performed_at, last_performed_meter,
         next_due_at, next_due_meter, warning_threshold, status, created_by, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, machine_id = EXCLUDED.machine_id,
         trigger_type = EXCLUDED.trigger_type, interval_value = EXCLUDED.interval_value,
         interval_unit = EXCLUDED.interval_unit, tasks = EXCLUDED.tasks,
         estimated_duration_minutes = EXCLUDED.estimated_duration_minutes,
         last_performed_at = EXCLUDED.last_performed_at,
         last_performed_meter = EXCLUDED.last_performed_meter,
         next_due_at = EXCLUDED.next_due_at, next_due_meter = EXCLUDED.next_due_meter,
         warning_threshold = EXCLUDED.warning_threshold, status = EXCLUDED.status,
         updated_at = EXCLUDED.updated_at`,
      [
        plan.id,
        plan.tenantId,
        plan.planNumber,
        plan.name,
        plan.machineId,
        plan.triggerType,
        plan.intervalValue,
        plan.intervalUnit,
        JSON.stringify(plan.tasks),
        plan.estimatedDurationMinutes ?? null,
        plan.lastPerformedAt ?? null,
        plan.lastPerformedMeter ?? null,
        plan.nextDueAt ?? null,
        plan.nextDueMeter ?? null,
        plan.warningThreshold ?? null,
        plan.status,
        plan.createdBy ?? null,
        plan.createdAt,
        plan.updatedAt,
      ]
    );
  }

  async deletePlan(exec: Executor, tenantId: string, id: string): Promise<void> {
    await exec.query('DELETE FROM maintenance_plan WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
  }

  // ================= Requests =================

  async insertRequest(exec: Executor, request: MaintenanceRequest): Promise<void> {
    await exec.query(
      `INSERT INTO maintenance_request (
         id, tenant_id, request_number, machine_id, maintenance_type, priority, problem_description,
         reported_symptom, work_order_id, downtime_id, requested_by, requested_by_name,
         requested_at, status, notes
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        request.id,
        request.tenantId,
        request.requestNumber,
        request.machineId,
        request.maintenanceType,
        request.priority,
        request.problemDescription,
        request.reportedSymptom ?? null,
        request.workOrderId ?? null,
        request.downtimeId ?? null,
        request.requestedBy,
        request.requestedByName ?? null,
        request.requestedAt,
        request.status,
        request.notes ?? null,
      ]
    );
  }

  async listRequests(
    exec: Executor,
    tenantId: string,
    filter: { id?: string; status?: string; machineId?: string; limit?: number } = {}
  ): Promise<MaintenanceRequest[]> {
    const where = ['mq.tenant_id = $1'];
    const params: unknown[] = [tenantId];

    if (filter.id) {
      params.push(filter.id);
      where.push(`mq.id = $${params.length}`);
    }
    if (filter.status) {
      params.push(filter.status);
      where.push(`mq.status = $${params.length}`);
    }
    if (filter.machineId) {
      params.push(filter.machineId);
      where.push(`mq.machine_id = $${params.length}`);
    }
    params.push(Math.min(filter.limit ?? 200, 1000));

    const rows = await exec.query<RequestRow>(
      `SELECT mq.id, mq.tenant_id, mq.request_number, mq.machine_id, m.name AS machine_name,
              mq.maintenance_type, mq.priority, mq.problem_description, mq.reported_symptom,
              mq.work_order_id, mq.downtime_id, mq.requested_by, mq.requested_by_name,
              mq.requested_at, mq.status, mq.maintenance_record_id, mq.notes
         FROM maintenance_request mq
         JOIN machine m ON m.id = mq.machine_id
        WHERE ${where.join(' AND ')}
        ORDER BY mq.requested_at DESC LIMIT $${params.length}`,
      params
    );
    return rows.rows.map(toRequest);
  }

  async setRequestStatus(
    exec: Executor,
    tenantId: string,
    id: string,
    status: MaintenanceRequest['status'],
    maintenanceRecordId?: string
  ): Promise<void> {
    await exec.query(
      `UPDATE maintenance_request
          SET status = $3, maintenance_record_id = COALESCE($4, maintenance_record_id)
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, status, maintenanceRecordId ?? null]
    );
  }

  // ================= Records =================

  async insertRecord(exec: Executor, record: MaintenanceRecord): Promise<void> {
    await exec.query(
      `INSERT INTO maintenance_record (
         id, tenant_id, maintenance_number, machine_id, maintenance_type, maintenance_plan_id,
         maintenance_request_id, downtime_id, status, problem, root_cause, action_taken,
         requester_id, requester_name, technician_id, technician_name, scheduled_for,
         started_at, completed_at, duration_minutes, result, cost_reference, notes,
         created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)`,
      [
        record.id,
        record.tenantId,
        record.maintenanceNumber,
        record.machineId,
        record.maintenanceType,
        record.maintenancePlanId ?? null,
        record.maintenanceRequestId ?? null,
        record.downtimeId ?? null,
        record.status,
        record.problem ?? null,
        record.rootCause ?? null,
        record.actionTaken ?? null,
        record.requesterId ?? null,
        record.requesterName ?? null,
        record.technicianId ?? null,
        record.technicianName ?? null,
        record.scheduledFor ?? null,
        record.startedAt ?? null,
        record.completedAt ?? null,
        record.durationMinutes ?? null,
        record.result ?? null,
        record.costReference ?? null,
        record.notes ?? null,
        record.createdAt,
        record.updatedAt,
      ]
    );
  }

  async updateRecord(
    exec: Executor,
    tenantId: string,
    id: string,
    patch: Partial<{
      status: MaintenanceState;
      technicianId: string;
      technicianName: string;
      scheduledFor: string;
      startedAt: string;
      completedAt: string;
      durationMinutes: number;
      problem: string;
      rootCause: string;
      actionTaken: string;
      result: MaintenanceRecord['result'];
      costReference: number;
      downtimeId: string;
      notes: string;
    }>
  ): Promise<void> {
    const columns: Record<string, unknown> = {
      status: patch.status,
      technician_id: patch.technicianId,
      technician_name: patch.technicianName,
      scheduled_for: patch.scheduledFor,
      started_at: patch.startedAt,
      completed_at: patch.completedAt,
      duration_minutes: patch.durationMinutes,
      problem: patch.problem,
      root_cause: patch.rootCause,
      action_taken: patch.actionTaken,
      result: patch.result,
      cost_reference: patch.costReference,
      downtime_id: patch.downtimeId,
      notes: patch.notes,
    };

    const sets: string[] = [];
    const params: unknown[] = [tenantId, id];
    for (const [column, value] of Object.entries(columns)) {
      if (value === undefined) continue;
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    }
    if (sets.length === 0) return;
    sets.push('updated_at = CURRENT_TIMESTAMP');

    await exec.query(
      `UPDATE maintenance_record SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2`,
      params
    );
  }

  async listRecords(
    exec: Executor,
    tenantId: string,
    filter: {
      id?: string;
      machineId?: string;
      status?: string;
      maintenanceType?: string;
      from?: string;
      to?: string;
      limit?: number;
    } = {}
  ): Promise<MaintenanceRecord[]> {
    const where = ['mr.tenant_id = $1'];
    const params: unknown[] = [tenantId];

    if (filter.id) {
      params.push(filter.id);
      where.push(`mr.id = $${params.length}`);
    }
    if (filter.machineId) {
      params.push(filter.machineId);
      where.push(`mr.machine_id = $${params.length}`);
    }
    if (filter.status) {
      params.push(filter.status);
      where.push(`mr.status = $${params.length}`);
    }
    if (filter.maintenanceType) {
      params.push(filter.maintenanceType);
      where.push(`mr.maintenance_type = $${params.length}`);
    }
    if (filter.from) {
      params.push(filter.from);
      where.push(`COALESCE(mr.started_at, mr.created_at) >= $${params.length}`);
    }
    if (filter.to) {
      params.push(filter.to);
      where.push(`COALESCE(mr.started_at, mr.created_at) <= $${params.length}`);
    }
    params.push(Math.min(filter.limit ?? 200, 1000));

    const rows = await exec.query<RecordRow>(
      `${RECORD_SELECT} WHERE ${where.join(' AND ')}
        ORDER BY COALESCE(mr.started_at, mr.created_at) DESC LIMIT $${params.length}`,
      params
    );
    if (rows.rows.length === 0) return [];

    const parts = await exec.query<{
      id: string;
      maintenance_record_id: string;
      part_id: string | null;
      part_name: string;
      quantity: string;
      uom: string;
      cost_reference: string | null;
    }>(
      `SELECT id, maintenance_record_id, part_id, part_name, quantity, uom, cost_reference
         FROM maintenance_part_usage WHERE maintenance_record_id = ANY($1::varchar[])`,
      [rows.rows.map((row) => row.id)]
    );

    const byRecord = new Map<string, MaintenancePartUsage[]>();
    for (const row of parts.rows) {
      const list = byRecord.get(row.maintenance_record_id) ?? [];
      list.push({
        id: row.id,
        maintenanceRecordId: row.maintenance_record_id,
        partId: orUndefined(row.part_id),
        partName: row.part_name,
        quantity: Number(row.quantity),
        uom: row.uom,
        costReference: row.cost_reference === null ? undefined : Number(row.cost_reference),
      });
      byRecord.set(row.maintenance_record_id, list);
    }

    return rows.rows.map((row) => toRecord(row, byRecord.get(row.id) ?? []));
  }

  async insertPart(exec: Executor, tenantId: string, part: MaintenancePartUsage): Promise<void> {
    await exec.query(
      `INSERT INTO maintenance_part_usage (
         id, tenant_id, maintenance_record_id, part_id, part_name, quantity, uom, cost_reference
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        part.id,
        tenantId,
        part.maintenanceRecordId,
        part.partId ?? null,
        part.partName,
        part.quantity,
        part.uom,
        part.costReference ?? null,
      ]
    );
  }

  /** BR-MT04 — is this machine in the middle of maintenance right now. */
  async machineUnderMaintenance(exec: Executor, tenantId: string, machineId: string): Promise<boolean> {
    const result = await exec.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM maintenance_record
        WHERE tenant_id = $1 AND machine_id = $2
          AND status IN ('IN_PROGRESS', 'WAITING_PART', 'TESTING')`,
      [tenantId, machineId]
    );
    return Number(result.rows[0]?.n ?? 0) > 0;
  }

  /** MTBF / MTTR inputs for a period (§25). */
  async reliabilityTotals(
    exec: Executor,
    tenantId: string,
    from: string,
    to: string,
    machineId?: string
  ): Promise<{ failures: number; repairMinutes: number; emergencies: number; preventive: number }> {
    const params: unknown[] = [tenantId, from, to];
    let machineClause = '';
    if (machineId) {
      params.push(machineId);
      machineClause = ` AND machine_id = $${params.length}`;
    }

    const result = await exec.query<{
      failures: string;
      repair_minutes: string;
      emergencies: string;
      preventive: string;
    }>(
      `SELECT count(*) FILTER (WHERE maintenance_type IN ('CORRECTIVE', 'EMERGENCY'))::text AS failures,
              COALESCE(sum(duration_minutes) FILTER (WHERE maintenance_type IN ('CORRECTIVE', 'EMERGENCY')), 0)::text
                AS repair_minutes,
              count(*) FILTER (WHERE maintenance_type = 'EMERGENCY')::text AS emergencies,
              count(*) FILTER (WHERE maintenance_type = 'PREVENTIVE' AND status = 'COMPLETED')::text AS preventive
         FROM maintenance_record
        WHERE tenant_id = $1 AND COALESCE(started_at, created_at) >= $2
          AND COALESCE(started_at, created_at) <= $3${machineClause}`,
      params
    );
    const row = result.rows[0];
    return {
      failures: Number(row?.failures ?? 0),
      repairMinutes: Number(row?.repair_minutes ?? 0),
      emergencies: Number(row?.emergencies ?? 0),
      preventive: Number(row?.preventive ?? 0),
    };
  }

  async nextNumber(exec: Executor, tenantId: string, table: string, prefix: string): Promise<string> {
    const result = await exec.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM ${table} WHERE tenant_id = $1`,
      [tenantId]
    );
    const next = Number(result.rows[0]?.n ?? 0) + 1;
    return `${prefix}-${new Date().getFullYear()}-${String(next).padStart(4, '0')}`;
  }
}
