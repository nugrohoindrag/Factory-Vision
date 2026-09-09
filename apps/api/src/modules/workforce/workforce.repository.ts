import type {
  LaborAssignment,
  LaborTimeRecord,
  OperatorAvailability,
  OperatorAvailabilityState,
  OperatorQualification,
  OperatorShiftAssignment,
  QualificationRequirement,
  QualificationStatus,
  Skill,
} from '@factory-vision/domain-types';
import { asDateString, asIsoString, orUndefined, type Executor } from '../../platform/db/executor.js';

/** Skills, qualifications, shift assignment, availability and labour (migration 030). */
export class WorkforceRepository {
  // ================= Skills =================

  async listSkills(exec: Executor, tenantId: string): Promise<Skill[]> {
    const rows = await exec.query<{
      id: string;
      tenant_id: string;
      code: string;
      name: string;
      category: string | null;
      description: string | null;
      max_level: number;
      created_at: Date | string;
    }>(
      `SELECT id, tenant_id, code, name, category, description, max_level, created_at
         FROM skill WHERE tenant_id = $1 ORDER BY category NULLS LAST, code`,
      [tenantId]
    );
    return rows.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      code: row.code,
      name: row.name,
      category: orUndefined(row.category),
      description: orUndefined(row.description),
      maxLevel: row.max_level,
      createdAt: asIsoString(row.created_at),
    }));
  }

  async upsertSkill(exec: Executor, skill: Skill): Promise<void> {
    await exec.query(
      `INSERT INTO skill (id, tenant_id, code, name, category, description, max_level, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET
         code = EXCLUDED.code, name = EXCLUDED.name, category = EXCLUDED.category,
         description = EXCLUDED.description, max_level = EXCLUDED.max_level`,
      [
        skill.id,
        skill.tenantId,
        skill.code,
        skill.name,
        skill.category ?? null,
        skill.description ?? null,
        skill.maxLevel,
        skill.createdAt,
      ]
    );
  }

  async deleteSkill(exec: Executor, tenantId: string, id: string): Promise<void> {
    await exec.query('DELETE FROM skill WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
  }

  // ================= Qualifications =================

  /**
   * `status` is derived, not read.
   *
   * A stored ACTIVE on a certificate that expired last month is exactly the
   * bug BR-W02 warns about, so the expiry is compared here in SQL and the
   * stored column only carries the manual SUSPENDED decision.
   */
  async listQualifications(
    exec: Executor,
    tenantId: string,
    filter: { id?: string; operatorId?: string; skillId?: string; expiringWithinDays?: number } = {}
  ): Promise<OperatorQualification[]> {
    const where = ['q.tenant_id = $1'];
    const params: unknown[] = [tenantId];

    if (filter.id) {
      params.push(filter.id);
      where.push(`q.id = $${params.length}`);
    }
    if (filter.operatorId) {
      params.push(filter.operatorId);
      where.push(`q.operator_id = $${params.length}`);
    }
    if (filter.skillId) {
      params.push(filter.skillId);
      where.push(`q.skill_id = $${params.length}`);
    }
    if (filter.expiringWithinDays !== undefined) {
      params.push(filter.expiringWithinDays);
      where.push(
        `q.expiry_date IS NOT NULL AND q.expiry_date <= CURRENT_DATE + ($${params.length} || ' days')::interval`
      );
    }

    const rows = await exec.query<{
      id: string;
      tenant_id: string;
      operator_id: string;
      operator_name: string;
      skill_id: string;
      skill_code: string;
      skill_name: string;
      level: number;
      certified_date: Date | string;
      expiry_date: Date | string | null;
      issuer: string | null;
      certificate_number: string | null;
      effective_status: string;
      suspended_reason: string | null;
      created_by: string | null;
      created_at: Date | string;
      updated_at: Date | string;
    }>(
      `SELECT q.id, q.tenant_id, q.operator_id, o.name AS operator_name, q.skill_id,
              s.code AS skill_code, s.name AS skill_name, q.level, q.certified_date, q.expiry_date,
              q.issuer, q.certificate_number,
              CASE
                WHEN q.status = 'SUSPENDED' THEN 'SUSPENDED'
                WHEN q.expiry_date IS NOT NULL AND q.expiry_date < CURRENT_DATE THEN 'EXPIRED'
                ELSE 'ACTIVE'
              END AS effective_status,
              q.suspended_reason, q.created_by, q.created_at, q.updated_at
         FROM operator_qualification q
         JOIN operator o ON o.id = q.operator_id
         JOIN skill s ON s.id = q.skill_id
        WHERE ${where.join(' AND ')}
        ORDER BY o.name, s.code`,
      params
    );

    return rows.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      operatorId: row.operator_id,
      operatorName: row.operator_name,
      skillId: row.skill_id,
      skillCode: row.skill_code,
      skillName: row.skill_name,
      level: row.level,
      certifiedDate: asDateString(row.certified_date),
      expiryDate: row.expiry_date ? asDateString(row.expiry_date) : undefined,
      issuer: orUndefined(row.issuer),
      certificateNumber: orUndefined(row.certificate_number),
      status: row.effective_status as QualificationStatus,
      suspendedReason: orUndefined(row.suspended_reason),
      createdBy: orUndefined(row.created_by),
      createdAt: asIsoString(row.created_at),
      updatedAt: asIsoString(row.updated_at),
    }));
  }

  async upsertQualification(exec: Executor, qualification: OperatorQualification): Promise<void> {
    await exec.query(
      `INSERT INTO operator_qualification (
         id, tenant_id, operator_id, skill_id, level, certified_date, expiry_date, issuer,
         certificate_number, status, suspended_reason, created_by, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (tenant_id, operator_id, skill_id) DO UPDATE SET
         level = EXCLUDED.level, certified_date = EXCLUDED.certified_date,
         expiry_date = EXCLUDED.expiry_date, issuer = EXCLUDED.issuer,
         certificate_number = EXCLUDED.certificate_number, status = EXCLUDED.status,
         suspended_reason = EXCLUDED.suspended_reason, updated_at = EXCLUDED.updated_at`,
      [
        qualification.id,
        qualification.tenantId,
        qualification.operatorId,
        qualification.skillId,
        qualification.level,
        qualification.certifiedDate,
        qualification.expiryDate ?? null,
        qualification.issuer ?? null,
        qualification.certificateNumber ?? null,
        // Only the manual decision is stored; expiry is derived on read.
        qualification.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE',
        qualification.suspendedReason ?? null,
        qualification.createdBy ?? null,
        qualification.createdAt,
        qualification.updatedAt,
      ]
    );
  }

  async deleteQualification(exec: Executor, tenantId: string, id: string): Promise<void> {
    await exec.query('DELETE FROM operator_qualification WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
  }

  // ================= Requirements =================

  async listRequirements(
    exec: Executor,
    tenantId: string,
    filter: { targetType?: string; targetId?: string } = {}
  ): Promise<QualificationRequirement[]> {
    const where = ['r.tenant_id = $1'];
    const params: unknown[] = [tenantId];

    if (filter.targetType) {
      params.push(filter.targetType);
      where.push(`r.target_type = $${params.length}`);
    }
    if (filter.targetId) {
      params.push(filter.targetId);
      where.push(`r.target_id = $${params.length}`);
    }

    const rows = await exec.query<{
      id: string;
      tenant_id: string;
      target_type: string;
      target_id: string;
      target_name: string | null;
      skill_id: string;
      skill_code: string;
      skill_name: string;
      minimum_level: number;
      mandatory: boolean;
      created_at: Date | string;
    }>(
      `SELECT r.id, r.tenant_id, r.target_type, r.target_id,
              COALESCE(m.name, p.name) AS target_name,
              r.skill_id, s.code AS skill_code, s.name AS skill_name,
              r.minimum_level, r.mandatory, r.created_at
         FROM qualification_requirement r
         JOIN skill s ON s.id = r.skill_id
         LEFT JOIN machine m ON m.id = r.target_id AND r.target_type = 'MACHINE'
         LEFT JOIN production_process p ON p.id = r.target_id AND r.target_type = 'PROCESS'
        WHERE ${where.join(' AND ')}
        ORDER BY r.target_type, target_name NULLS LAST, s.code`,
      params
    );

    return rows.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      targetType: row.target_type as QualificationRequirement['targetType'],
      targetId: row.target_id,
      targetName: row.target_name ?? row.target_id,
      skillId: row.skill_id,
      skillCode: row.skill_code,
      skillName: row.skill_name,
      minimumLevel: row.minimum_level,
      mandatory: row.mandatory,
      createdAt: asIsoString(row.created_at),
    }));
  }

  async upsertRequirement(exec: Executor, requirement: QualificationRequirement): Promise<void> {
    await exec.query(
      `INSERT INTO qualification_requirement (
         id, tenant_id, target_type, target_id, skill_id, minimum_level, mandatory, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (tenant_id, target_type, target_id, skill_id) DO UPDATE SET
         minimum_level = EXCLUDED.minimum_level, mandatory = EXCLUDED.mandatory`,
      [
        requirement.id,
        requirement.tenantId,
        requirement.targetType,
        requirement.targetId,
        requirement.skillId,
        requirement.minimumLevel,
        requirement.mandatory,
        requirement.createdAt,
      ]
    );
  }

  async deleteRequirement(exec: Executor, tenantId: string, id: string): Promise<void> {
    await exec.query('DELETE FROM qualification_requirement WHERE tenant_id = $1 AND id = $2', [
      tenantId,
      id,
    ]);
  }

  // ================= Shift assignment =================

  async listShiftAssignments(
    exec: Executor,
    tenantId: string,
    filter: { operatorId?: string; shiftId?: string; onDate?: string } = {}
  ): Promise<OperatorShiftAssignment[]> {
    const where = ['a.tenant_id = $1'];
    const params: unknown[] = [tenantId];

    if (filter.operatorId) {
      params.push(filter.operatorId);
      where.push(`a.operator_id = $${params.length}`);
    }
    if (filter.shiftId) {
      params.push(filter.shiftId);
      where.push(`a.shift_id = $${params.length}`);
    }
    if (filter.onDate) {
      params.push(filter.onDate);
      where.push(
        `a.effective_from <= $${params.length}::date AND (a.effective_to IS NULL OR a.effective_to >= $${params.length}::date)`
      );
    }

    const rows = await exec.query<{
      id: string;
      tenant_id: string;
      operator_id: string;
      operator_name: string;
      shift_id: string;
      shift_name: string;
      effective_from: Date | string;
      effective_to: Date | string | null;
      is_default: boolean;
      created_by: string | null;
      created_at: Date | string;
    }>(
      `SELECT a.id, a.tenant_id, a.operator_id, o.name AS operator_name, a.shift_id,
              s.name AS shift_name, a.effective_from, a.effective_to, a.is_default,
              a.created_by, a.created_at
         FROM operator_shift_assignment a
         JOIN operator o ON o.id = a.operator_id
         JOIN shift s ON s.id = a.shift_id
        WHERE ${where.join(' AND ')}
        ORDER BY o.name, a.effective_from DESC`,
      params
    );

    return rows.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      operatorId: row.operator_id,
      operatorName: row.operator_name,
      shiftId: row.shift_id,
      shiftName: row.shift_name,
      effectiveFrom: asDateString(row.effective_from),
      effectiveTo: row.effective_to ? asDateString(row.effective_to) : undefined,
      isDefault: row.is_default,
      createdBy: orUndefined(row.created_by),
      createdAt: asIsoString(row.created_at),
    }));
  }

  async insertShiftAssignment(exec: Executor, assignment: OperatorShiftAssignment): Promise<void> {
    await exec.query(
      `INSERT INTO operator_shift_assignment (
         id, tenant_id, operator_id, shift_id, effective_from, effective_to, is_default, created_by, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        assignment.id,
        assignment.tenantId,
        assignment.operatorId,
        assignment.shiftId,
        assignment.effectiveFrom,
        assignment.effectiveTo ?? null,
        assignment.isDefault,
        assignment.createdBy ?? null,
        assignment.createdAt,
      ]
    );
  }

  async deleteShiftAssignment(exec: Executor, tenantId: string, id: string): Promise<void> {
    await exec.query('DELETE FROM operator_shift_assignment WHERE tenant_id = $1 AND id = $2', [
      tenantId,
      id,
    ]);
  }

  // ================= Availability =================

  /**
   * Current availability for every operator, or one of them.
   *
   * `DISTINCT ON` takes the latest row whose window contains now; an operator
   * who has never had one written is AVAILABLE, which is the sane default for
   * a plant that has not started using the feature.
   */
  async currentAvailability(
    exec: Executor,
    tenantId: string,
    operatorId?: string
  ): Promise<OperatorAvailability[]> {
    const params: unknown[] = [tenantId];
    let operatorClause = '';
    if (operatorId) {
      params.push(operatorId);
      operatorClause = ` AND o.id = $${params.length}`;
    }

    const rows = await exec.query<{
      id: string | null;
      operator_id: string;
      operator_name: string;
      state: string | null;
      shift_id: string | null;
      shift_name: string | null;
      effective_from: Date | string | null;
      effective_to: Date | string | null;
      reason: string | null;
      updated_by: string | null;
      updated_at: Date | string | null;
    }>(
      `SELECT a.id, o.id AS operator_id, o.name AS operator_name, a.state, a.shift_id,
              s.name AS shift_name, a.effective_from, a.effective_to, a.reason,
              a.updated_by, a.updated_at
         FROM operator o
         LEFT JOIN LATERAL (
           SELECT * FROM operator_availability av
            WHERE av.tenant_id = o.tenant_id AND av.operator_id = o.id
              AND av.effective_from <= CURRENT_TIMESTAMP
              AND (av.effective_to IS NULL OR av.effective_to >= CURRENT_TIMESTAMP)
            ORDER BY av.effective_from DESC
            LIMIT 1
         ) a ON TRUE
         LEFT JOIN shift s ON s.id = a.shift_id
        WHERE o.tenant_id = $1 AND o.status = 'ACTIVE'${operatorClause}
        ORDER BY o.name`,
      params
    );

    return rows.rows.map((row) => ({
      id: row.id ?? `avail-default-${row.operator_id}`,
      tenantId,
      operatorId: row.operator_id,
      operatorName: row.operator_name,
      state: (row.state ?? 'AVAILABLE') as OperatorAvailabilityState,
      shiftId: orUndefined(row.shift_id),
      shiftName: orUndefined(row.shift_name),
      effectiveFrom: row.effective_from ? asIsoString(row.effective_from) : new Date().toISOString(),
      effectiveTo: row.effective_to ? asIsoString(row.effective_to) : undefined,
      reason: orUndefined(row.reason),
      updatedBy: orUndefined(row.updated_by),
      updatedAt: row.updated_at ? asIsoString(row.updated_at) : new Date().toISOString(),
    }));
  }

  /** Closes the open window and opens a new one, so the history stays whole. */
  async setAvailability(exec: Executor, availability: OperatorAvailability): Promise<void> {
    await exec.query(
      `UPDATE operator_availability
          SET effective_to = CURRENT_TIMESTAMP
        WHERE tenant_id = $1 AND operator_id = $2 AND effective_to IS NULL`,
      [availability.tenantId, availability.operatorId]
    );
    await exec.query(
      `INSERT INTO operator_availability (
         id, tenant_id, operator_id, state, shift_id, effective_from, effective_to,
         reason, updated_by, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, CURRENT_TIMESTAMP)`,
      [
        availability.id,
        availability.tenantId,
        availability.operatorId,
        availability.state,
        availability.shiftId ?? null,
        availability.effectiveFrom,
        availability.effectiveTo ?? null,
        availability.reason ?? null,
        availability.updatedBy ?? null,
      ]
    );
  }

  // ================= Labour requirement & assignment =================

  async upsertLaborRequirement(
    exec: Executor,
    input: {
      tenantId: string;
      workOrderId: string;
      requiredOperators: number;
      processId?: string;
      machineId?: string;
      shiftId?: string;
      notes?: string;
    }
  ): Promise<void> {
    await exec.query(
      `INSERT INTO labor_requirement (
         id, tenant_id, work_order_id, process_id, machine_id, required_operators, shift_id, notes, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8, CURRENT_TIMESTAMP)
       ON CONFLICT (tenant_id, work_order_id) DO UPDATE SET
         process_id = EXCLUDED.process_id, machine_id = EXCLUDED.machine_id,
         required_operators = EXCLUDED.required_operators, shift_id = EXCLUDED.shift_id,
         notes = EXCLUDED.notes, updated_at = CURRENT_TIMESTAMP`,
      [
        `lreq-${input.workOrderId}`,
        input.tenantId,
        input.workOrderId,
        input.processId ?? null,
        input.machineId ?? null,
        input.requiredOperators,
        input.shiftId ?? null,
        input.notes ?? null,
      ]
    );
  }

  async findLaborRequirement(
    exec: Executor,
    tenantId: string,
    workOrderId: string
  ): Promise<{
    requiredOperators: number;
    processId?: string;
    machineId?: string;
    shiftId?: string;
    notes?: string;
    updatedAt: string;
  } | undefined> {
    const rows = await exec.query<{
      required_operators: number;
      process_id: string | null;
      machine_id: string | null;
      shift_id: string | null;
      notes: string | null;
      updated_at: Date | string;
    }>(
      `SELECT required_operators, process_id, machine_id, shift_id, notes, updated_at
         FROM labor_requirement WHERE tenant_id = $1 AND work_order_id = $2`,
      [tenantId, workOrderId]
    );
    const row = rows.rows[0];
    if (!row) return undefined;
    return {
      requiredOperators: row.required_operators,
      processId: orUndefined(row.process_id),
      machineId: orUndefined(row.machine_id),
      shiftId: orUndefined(row.shift_id),
      notes: orUndefined(row.notes),
      updatedAt: asIsoString(row.updated_at),
    };
  }

  async insertAssignment(exec: Executor, assignment: LaborAssignment): Promise<void> {
    await exec.query(
      `INSERT INTO labor_assignment (
         id, tenant_id, work_order_id, operator_id, role, shift_id, assigned_by, assigned_at,
         status, qualification_check
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        assignment.id,
        assignment.tenantId,
        assignment.workOrderId,
        assignment.operatorId,
        assignment.role ?? null,
        assignment.shiftId ?? null,
        assignment.assignedBy,
        assignment.assignedAt,
        assignment.status,
        assignment.qualificationCheck ? JSON.stringify(assignment.qualificationCheck) : null,
      ]
    );
  }

  async listAssignments(
    exec: Executor,
    tenantId: string,
    filter: { id?: string; workOrderId?: string; operatorId?: string; status?: string; active?: boolean } = {}
  ): Promise<LaborAssignment[]> {
    const where = ['a.tenant_id = $1'];
    const params: unknown[] = [tenantId];

    if (filter.id) {
      params.push(filter.id);
      where.push(`a.id = $${params.length}`);
    }
    if (filter.workOrderId) {
      params.push(filter.workOrderId);
      where.push(`a.work_order_id = $${params.length}`);
    }
    if (filter.operatorId) {
      params.push(filter.operatorId);
      where.push(`a.operator_id = $${params.length}`);
    }
    if (filter.status) {
      params.push(filter.status);
      where.push(`a.status = $${params.length}`);
    }
    if (filter.active) {
      where.push("a.status IN ('ASSIGNED', 'ACTIVE')");
    }

    const rows = await exec.query<{
      id: string;
      tenant_id: string;
      work_order_id: string;
      wo_number: string;
      operator_id: string;
      operator_name: string;
      role: string | null;
      shift_id: string | null;
      assigned_by: string;
      assigned_at: Date | string;
      unassigned_at: Date | string | null;
      status: string;
      qualification_check: LaborAssignment['qualificationCheck'] | null;
    }>(
      `SELECT a.id, a.tenant_id, a.work_order_id, w.wo_number, a.operator_id, o.name AS operator_name,
              a.role, a.shift_id, a.assigned_by, a.assigned_at, a.unassigned_at, a.status,
              a.qualification_check
         FROM labor_assignment a
         JOIN work_order w ON w.id = a.work_order_id
         JOIN operator o ON o.id = a.operator_id
        WHERE ${where.join(' AND ')}
        ORDER BY a.assigned_at DESC`,
      params
    );

    return rows.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      workOrderId: row.work_order_id,
      workOrderNumber: row.wo_number,
      operatorId: row.operator_id,
      operatorName: row.operator_name,
      role: orUndefined(row.role),
      shiftId: orUndefined(row.shift_id),
      assignedBy: row.assigned_by,
      assignedAt: asIsoString(row.assigned_at),
      unassignedAt: row.unassigned_at ? asIsoString(row.unassigned_at) : undefined,
      status: row.status as LaborAssignment['status'],
      qualificationCheck: row.qualification_check ?? undefined,
    }));
  }

  async setAssignmentStatus(
    exec: Executor,
    tenantId: string,
    id: string,
    status: LaborAssignment['status']
  ): Promise<void> {
    await exec.query(
      `UPDATE labor_assignment
          SET status = $3,
              unassigned_at = CASE WHEN $3 IN ('COMPLETED', 'CANCELLED') THEN CURRENT_TIMESTAMP ELSE unassigned_at END
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, status]
    );
  }

  /** Assignments that overlap a window, for the board's operator conflicts. */
  async assignmentsInWindow(
    exec: Executor,
    tenantId: string,
    from: string,
    to: string
  ): Promise<Array<{ workOrderId: string; operatorId: string; operatorName: string }>> {
    const rows = await exec.query<{ work_order_id: string; operator_id: string; operator_name: string }>(
      `SELECT a.work_order_id, a.operator_id, o.name AS operator_name
         FROM labor_assignment a
         JOIN work_order w ON w.id = a.work_order_id
         JOIN operator o ON o.id = a.operator_id
        WHERE a.tenant_id = $1 AND a.status IN ('ASSIGNED', 'ACTIVE')
          AND w.planned_start <= $3 AND w.planned_end >= $2`,
      [tenantId, from, to]
    );
    return rows.rows.map((row) => ({
      workOrderId: row.work_order_id,
      operatorId: row.operator_id,
      operatorName: row.operator_name,
    }));
  }

  // ================= Labour time =================

  async insertTimeRecord(exec: Executor, record: LaborTimeRecord): Promise<void> {
    await exec.query(
      `INSERT INTO labor_time_record (
         id, tenant_id, operator_id, work_order_id, shift_id, shift_date, started_at, ended_at,
         productive_minutes, available_minutes, category, recorded_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        record.id,
        record.tenantId,
        record.operatorId,
        record.workOrderId ?? null,
        record.shiftId ?? null,
        record.shiftDate,
        record.startedAt,
        record.endedAt ?? null,
        record.productiveMinutes,
        record.availableMinutes,
        record.category,
        record.recordedBy ?? null,
      ]
    );
  }

  async listTimeRecords(
    exec: Executor,
    tenantId: string,
    filter: { operatorId?: string; workOrderId?: string; from?: string; to?: string; limit?: number } = {}
  ): Promise<LaborTimeRecord[]> {
    const where = ['t.tenant_id = $1'];
    const params: unknown[] = [tenantId];

    if (filter.operatorId) {
      params.push(filter.operatorId);
      where.push(`t.operator_id = $${params.length}`);
    }
    if (filter.workOrderId) {
      params.push(filter.workOrderId);
      where.push(`t.work_order_id = $${params.length}`);
    }
    if (filter.from) {
      params.push(filter.from);
      where.push(`t.shift_date >= $${params.length}::date`);
    }
    if (filter.to) {
      params.push(filter.to);
      where.push(`t.shift_date <= $${params.length}::date`);
    }
    params.push(Math.min(filter.limit ?? 500, 5000));

    const rows = await exec.query<{
      id: string;
      tenant_id: string;
      operator_id: string;
      operator_name: string;
      work_order_id: string | null;
      wo_number: string | null;
      shift_id: string | null;
      shift_date: Date | string;
      started_at: Date | string;
      ended_at: Date | string | null;
      productive_minutes: string;
      available_minutes: string;
      category: string;
      recorded_by: string | null;
    }>(
      `SELECT t.id, t.tenant_id, t.operator_id, o.name AS operator_name, t.work_order_id, w.wo_number,
              t.shift_id, t.shift_date, t.started_at, t.ended_at, t.productive_minutes,
              t.available_minutes, t.category, t.recorded_by
         FROM labor_time_record t
         JOIN operator o ON o.id = t.operator_id
         LEFT JOIN work_order w ON w.id = t.work_order_id
        WHERE ${where.join(' AND ')}
        ORDER BY t.shift_date DESC, t.started_at DESC
        LIMIT $${params.length}`,
      params
    );

    return rows.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      operatorId: row.operator_id,
      operatorName: row.operator_name,
      workOrderId: orUndefined(row.work_order_id),
      workOrderNumber: orUndefined(row.wo_number),
      shiftId: orUndefined(row.shift_id),
      shiftDate: asDateString(row.shift_date),
      startedAt: asIsoString(row.started_at),
      endedAt: row.ended_at ? asIsoString(row.ended_at) : undefined,
      productiveMinutes: Number(row.productive_minutes),
      availableMinutes: Number(row.available_minutes),
      category: row.category as LaborTimeRecord['category'],
      recordedBy: orUndefined(row.recorded_by),
    }));
  }
}
