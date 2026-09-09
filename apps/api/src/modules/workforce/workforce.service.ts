import type {
  LaborAssignment,
  LaborRequirement,
  LaborStatus,
  LaborTimeRecord,
  LaborUtilization,
  OperatorAvailability,
  OperatorAvailabilityState,
  OperatorEligibility,
  OperatorQualification,
  QualificationRequirement,
  Skill,
} from '@factory-vision/domain-types';
import type pg from 'pg';
import { withTenant } from '../../platform/db/pool.js';
import { ApiError } from '../../platform/http/api-error.js';
import type { MasterDataService } from '../master-data/master-data.service.js';
import type { ProductionService } from '../production/production.service.js';
import type { EventService } from '../event/event.service.js';
import { WorkforceRepository } from './workforce.repository.js';

/**
 * Workforce and labour (Improvement PRD §6).
 *
 * The module exists to answer one question at the moment somebody is assigned:
 * may this operator run this machine, on this process, right now. Eligibility
 * is computed rather than stored (§6.2, §6.3) — a stored "qualified" flag
 * cannot say which certificate expired, and that is precisely what the person
 * making the assignment needs to know.
 */
export class WorkforceService {
  private readonly repo = new WorkforceRepository();

  constructor(
    private readonly masterData: MasterDataService,
    private readonly production: ProductionService,
    private readonly events: EventService
  ) {}

  // ==========================================================
  // Skills and requirements
  // ==========================================================

  async listSkills(tenantId: string): Promise<Skill[]> {
    return withTenant(tenantId, (client) => this.repo.listSkills(client, tenantId));
  }

  async createSkill(
    tenantId: string,
    input: { code: string; name: string; category?: string; description?: string; maxLevel?: number }
  ): Promise<Skill> {
    const skill: Skill = {
      id: `skill-${Date.now()}`,
      tenantId,
      code: input.code,
      name: input.name,
      category: input.category,
      description: input.description,
      maxLevel: input.maxLevel ?? 3,
      createdAt: new Date().toISOString(),
    };
    await withTenant(tenantId, (client) => this.repo.upsertSkill(client, skill));
    return skill;
  }

  async updateSkill(tenantId: string, id: string, patch: Partial<Skill>): Promise<Skill> {
    return withTenant(tenantId, async (client) => {
      const existing = (await this.repo.listSkills(client, tenantId)).find((s) => s.id === id);
      if (!existing) throw ApiError.notFound('Skill tidak ditemukan.');
      const skill = { ...existing, ...patch, id, tenantId };
      await this.repo.upsertSkill(client, skill);
      return skill;
    });
  }

  async deleteSkill(tenantId: string, id: string): Promise<void> {
    await withTenant(tenantId, (client) => this.repo.deleteSkill(client, tenantId, id));
  }

  async listRequirements(
    tenantId: string,
    filter: { targetType?: string; targetId?: string } = {}
  ): Promise<QualificationRequirement[]> {
    return withTenant(tenantId, (client) => this.repo.listRequirements(client, tenantId, filter));
  }

  async setRequirement(
    tenantId: string,
    input: {
      targetType: QualificationRequirement['targetType'];
      targetId: string;
      skillId: string;
      minimumLevel?: number;
      mandatory?: boolean;
    }
  ): Promise<QualificationRequirement> {
    return withTenant(tenantId, async (client) => {
      const skill = (await this.repo.listSkills(client, tenantId)).find((s) => s.id === input.skillId);
      if (!skill) throw ApiError.notFound('Skill tidak ditemukan.');

      const requirement: QualificationRequirement = {
        id: `qreq-${input.targetType}-${input.targetId}-${input.skillId}`,
        tenantId,
        targetType: input.targetType,
        targetId: input.targetId,
        targetName: this.targetName(tenantId, input.targetType, input.targetId),
        skillId: input.skillId,
        skillCode: skill.code,
        skillName: skill.name,
        minimumLevel: input.minimumLevel ?? 1,
        mandatory: input.mandatory ?? true,
        createdAt: new Date().toISOString(),
      };
      await this.repo.upsertRequirement(client, requirement);
      return requirement;
    });
  }

  async deleteRequirement(tenantId: string, id: string): Promise<void> {
    await withTenant(tenantId, (client) => this.repo.deleteRequirement(client, tenantId, id));
  }

  // ==========================================================
  // §6.1 Qualifications (US-W001)
  // ==========================================================

  async listQualifications(
    tenantId: string,
    filter: { operatorId?: string; skillId?: string; expiringWithinDays?: number } = {}
  ): Promise<OperatorQualification[]> {
    return withTenant(tenantId, (client) => this.repo.listQualifications(client, tenantId, filter));
  }

  async setQualification(
    tenantId: string,
    input: {
      operatorId: string;
      skillId: string;
      level: number;
      certifiedDate?: string;
      expiryDate?: string;
      issuer?: string;
      certificateNumber?: string;
      status?: OperatorQualification['status'];
      suspendedReason?: string;
    },
    actor: { id: string; name?: string }
  ): Promise<OperatorQualification> {
    const operator = this.masterData.getOperatorById(tenantId, input.operatorId);
    if (!operator) throw ApiError.notFound('Operator tidak ditemukan.');

    return withTenant(tenantId, async (client) => {
      const skill = (await this.repo.listSkills(client, tenantId)).find((s) => s.id === input.skillId);
      if (!skill) throw ApiError.notFound('Skill tidak ditemukan.');
      if (input.level < 1 || input.level > skill.maxLevel) {
        throw ApiError.validation(`Level harus antara 1 dan ${skill.maxLevel} untuk skill ${skill.code}.`);
      }

      const now = new Date().toISOString();
      const qualification: OperatorQualification = {
        id: `qual-${input.operatorId}-${input.skillId}`,
        tenantId,
        operatorId: input.operatorId,
        operatorName: operator.name,
        skillId: input.skillId,
        skillCode: skill.code,
        skillName: skill.name,
        level: input.level,
        certifiedDate: input.certifiedDate ?? now.slice(0, 10),
        expiryDate: input.expiryDate,
        issuer: input.issuer,
        certificateNumber: input.certificateNumber,
        status: input.status ?? 'ACTIVE',
        suspendedReason: input.suspendedReason,
        createdBy: actor.id,
        createdAt: now,
        updatedAt: now,
      };

      await this.repo.upsertQualification(client, qualification);
      const [stored] = await this.repo.listQualifications(client, tenantId, {
        operatorId: input.operatorId,
        skillId: input.skillId,
      });
      return stored ?? qualification;
    });
  }

  async deleteQualification(tenantId: string, id: string): Promise<void> {
    await withTenant(tenantId, (client) => this.repo.deleteQualification(client, tenantId, id));
  }

  // ==========================================================
  // §6.4 Shift assignment (US-W002)
  // ==========================================================

  async listShiftAssignments(
    tenantId: string,
    filter: { operatorId?: string; shiftId?: string; onDate?: string } = {}
  ) {
    return withTenant(tenantId, (client) => this.repo.listShiftAssignments(client, tenantId, filter));
  }

  async assignShift(
    tenantId: string,
    input: {
      operatorId: string;
      shiftId: string;
      effectiveFrom?: string;
      effectiveTo?: string;
      isDefault?: boolean;
    },
    actor: { id: string; name?: string }
  ) {
    const operator = this.masterData.getOperatorById(tenantId, input.operatorId);
    if (!operator) throw ApiError.notFound('Operator tidak ditemukan.');
    const shift = this.masterData.getShifts(tenantId).find((s) => s.id === input.shiftId);
    if (!shift) throw ApiError.notFound('Shift tidak ditemukan.');

    const assignment = {
      id: `osa-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      tenantId,
      operatorId: input.operatorId,
      operatorName: operator.name,
      shiftId: input.shiftId,
      shiftName: shift.name,
      effectiveFrom: input.effectiveFrom ?? new Date().toISOString().slice(0, 10),
      effectiveTo: input.effectiveTo,
      isDefault: input.isDefault ?? false,
      createdBy: actor.id,
      createdAt: new Date().toISOString(),
    };

    await withTenant(tenantId, (client) => this.repo.insertShiftAssignment(client, assignment));
    return assignment;
  }

  async removeShiftAssignment(tenantId: string, id: string): Promise<void> {
    await withTenant(tenantId, (client) => this.repo.deleteShiftAssignment(client, tenantId, id));
  }

  // ==========================================================
  // §6.5 Availability (US-W003)
  // ==========================================================

  async listAvailability(tenantId: string, operatorId?: string): Promise<OperatorAvailability[]> {
    return withTenant(tenantId, (client) => this.repo.currentAvailability(client, tenantId, operatorId));
  }

  async setAvailability(
    tenantId: string,
    input: {
      operatorId: string;
      state: OperatorAvailabilityState;
      shiftId?: string;
      effectiveFrom?: string;
      effectiveTo?: string;
      reason?: string;
    },
    actor: { id: string; name?: string }
  ): Promise<OperatorAvailability> {
    const operator = this.masterData.getOperatorById(tenantId, input.operatorId);
    if (!operator) throw ApiError.notFound('Operator tidak ditemukan.');

    const availability: OperatorAvailability = {
      id: `avail-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      tenantId,
      operatorId: input.operatorId,
      operatorName: operator.name,
      state: input.state,
      shiftId: input.shiftId,
      effectiveFrom: input.effectiveFrom ?? new Date().toISOString(),
      effectiveTo: input.effectiveTo,
      reason: input.reason,
      updatedBy: actor.id,
      updatedAt: new Date().toISOString(),
    };

    await withTenant(tenantId, (client) => this.repo.setAvailability(client, availability));
    return availability;
  }

  // ==========================================================
  // §6.2, §6.3 Eligibility (US-W004, BR-W01/02/03)
  // ==========================================================

  /**
   * Whether each operator may take this machine and process, and why not.
   *
   * The answer is a list, not a boolean, because a supervisor choosing an
   * operator wants to see the near misses — "Level 1, needs Level 2" is
   * actionable in a way that an absence from a dropdown is not.
   */
  async eligibility(
    tenantId: string,
    context: { machineId?: string; processId?: string; operatorIds?: string[]; onDate?: string }
  ): Promise<OperatorEligibility[]> {
    return withTenant(tenantId, async (client) => {
      const requirements = await this.gatherRequirements(client, tenantId, context);
      const availability = await this.repo.currentAvailability(client, tenantId);
      const shiftAssignments = await this.repo.listShiftAssignments(client, tenantId, {
        onDate: context.onDate ?? new Date().toISOString().slice(0, 10),
      });

      const operators = this.masterData
        .getOperators(tenantId)
        .filter((operator) => operator.status === 'ACTIVE')
        .filter((operator) => !context.operatorIds || context.operatorIds.includes(operator.id));

      const result: OperatorEligibility[] = [];
      for (const operator of operators) {
        const qualifications = await this.repo.listQualifications(client, tenantId, {
          operatorId: operator.id,
        });
        const state =
          availability.find((row) => row.operatorId === operator.id)?.state ?? 'AVAILABLE';
        const shift = shiftAssignments.find((row) => row.operatorId === operator.id);

        const matched: OperatorEligibility['matchedSkills'] = [];
        const missing: OperatorEligibility['missingSkills'] = [];

        for (const requirement of requirements) {
          const held = qualifications.find((q) => q.skillId === requirement.skillId);
          if (!held) {
            missing.push({
              skillCode: requirement.skillCode,
              skillName: requirement.skillName,
              minimumLevel: requirement.minimumLevel,
              reason: 'Belum memiliki kualifikasi ini.',
            });
            continue;
          }
          // BR-W02 — an expired or suspended certificate is not a qualification.
          if (held.status !== 'ACTIVE') {
            missing.push({
              skillCode: requirement.skillCode,
              skillName: requirement.skillName,
              minimumLevel: requirement.minimumLevel,
              reason: held.status === 'EXPIRED' ? 'Kualifikasi sudah kedaluwarsa.' : 'Kualifikasi disuspensi.',
            });
            continue;
          }
          if (held.level < requirement.minimumLevel) {
            missing.push({
              skillCode: requirement.skillCode,
              skillName: requirement.skillName,
              minimumLevel: requirement.minimumLevel,
              reason: `Level ${held.level}, dibutuhkan minimal ${requirement.minimumLevel}.`,
            });
            continue;
          }
          matched.push({ skillCode: held.skillCode, skillName: held.skillName, level: held.level });
        }

        // Only mandatory requirements block; an optional one that is unmet is
        // reported so the supervisor can weigh it (§6.2's "recommends").
        const blockingMissing = missing.filter((entry) =>
          requirements.some(
            (requirement) => requirement.skillCode === entry.skillCode && requirement.mandatory
          )
        );
        const qualified = blockingMissing.length === 0;
        const available = state === 'AVAILABLE' || state === 'ASSIGNED';

        result.push({
          operatorId: operator.id,
          operatorName: operator.name,
          eligible: qualified && available,
          qualified,
          available,
          availabilityState: state,
          matchedSkills: matched,
          missingSkills: missing,
          shiftId: shift?.shiftId,
          shiftName: shift?.shiftName,
          blockedReason: !available
            ? `Operator berstatus ${state}.`
            : blockingMissing.length > 0
              ? blockingMissing.map((entry) => `${entry.skillCode}: ${entry.reason}`).join(' ')
              : undefined,
        });
      }

      return result.sort(
        (a, b) => Number(b.eligible) - Number(a.eligible) || a.operatorName.localeCompare(b.operatorName)
      );
    });
  }

  /** Machine and process requirements combined, deduplicated by skill. */
  private async gatherRequirements(
    client: pg.PoolClient,
    tenantId: string,
    context: { machineId?: string; processId?: string }
  ): Promise<QualificationRequirement[]> {
    const requirements: QualificationRequirement[] = [];
    if (context.machineId) {
      requirements.push(
        ...(await this.repo.listRequirements(client, tenantId, {
          targetType: 'MACHINE',
          targetId: context.machineId,
        }))
      );
    }
    if (context.processId) {
      requirements.push(
        ...(await this.repo.listRequirements(client, tenantId, {
          targetType: 'PROCESS',
          targetId: context.processId,
        }))
      );
    }

    // The same skill demanded by both the machine and the process resolves to
    // the higher level, and is mandatory if either says so.
    const bySkill = new Map<string, QualificationRequirement>();
    for (const requirement of requirements) {
      const existing = bySkill.get(requirement.skillId);
      if (!existing) {
        bySkill.set(requirement.skillId, requirement);
        continue;
      }
      bySkill.set(requirement.skillId, {
        ...existing,
        minimumLevel: Math.max(existing.minimumLevel, requirement.minimumLevel),
        mandatory: existing.mandatory || requirement.mandatory,
      });
    }
    return [...bySkill.values()];
  }

  // ==========================================================
  // §6.6 Labour requirement and assignment
  // ==========================================================

  async setLaborRequirement(
    tenantId: string,
    workOrderId: string,
    input: { requiredOperators: number; shiftId?: string; notes?: string }
  ): Promise<LaborRequirement> {
    const workOrder = await this.production.getWorkOrderById(tenantId, workOrderId);
    if (!workOrder) throw ApiError.notFound('Work Order tidak ditemukan.');

    await withTenant(tenantId, (client) =>
      this.repo.upsertLaborRequirement(client, {
        tenantId,
        workOrderId,
        requiredOperators: input.requiredOperators,
        processId: workOrder.processId,
        machineId: workOrder.machineId,
        shiftId: input.shiftId ?? workOrder.shiftId,
        notes: input.notes,
      })
    );
    return this.laborStatus(tenantId, workOrderId);
  }

  /**
   * §6.6 — required against available qualified, for one work order.
   *
   * "Available qualified" counts the operators who could be assigned right
   * now, not the ones who are: a work order with two of two assigned is
   * SUFFICIENT even if nobody else in the plant could cover it.
   */
  async laborStatus(tenantId: string, workOrderId: string): Promise<LaborRequirement> {
    const workOrder = await this.production.getWorkOrderById(tenantId, workOrderId);
    if (!workOrder) throw ApiError.notFound('Work Order tidak ditemukan.');

    const stored = await withTenant(tenantId, (client) =>
      this.repo.findLaborRequirement(client, tenantId, workOrderId)
    );
    const required = stored?.requiredOperators ?? 1;

    const assignments = await this.listAssignments(tenantId, { workOrderId, active: true });
    const eligible = await this.eligibility(tenantId, {
      machineId: workOrder.machineId,
      processId: workOrder.processId,
    });
    const availableQualified = eligible.filter((entry) => entry.eligible).length;

    const status: LaborStatus =
      assignments.length >= required
        ? assignments.length > required
          ? 'OVERSTAFFED'
          : 'SUFFICIENT'
        : 'SHORTAGE';

    return {
      id: `lreq-${workOrderId}`,
      tenantId,
      workOrderId,
      workOrderNumber: workOrder.woNumber,
      processId: workOrder.processId,
      machineId: workOrder.machineId,
      requiredOperators: required,
      assignedOperators: assignments.length,
      availableQualifiedOperators: availableQualified,
      status,
      shiftId: stored?.shiftId ?? workOrder.shiftId,
      notes: stored?.notes,
      updatedAt: stored?.updatedAt ?? new Date().toISOString(),
    };
  }

  /**
   * Assigns an operator, refusing what BR-W01 and BR-W03 forbid.
   *
   * The eligibility snapshot is stored on the assignment: months later,
   * "were they qualified when you put them on that machine" has to be
   * answerable from the record rather than from today's certificates.
   */
  async assignOperator(
    tenantId: string,
    input: { workOrderId: string; operatorId: string; role?: string; shiftId?: string; force?: boolean },
    actor: { id: string; name?: string }
  ): Promise<LaborAssignment> {
    const workOrder = await this.production.getWorkOrderById(tenantId, input.workOrderId);
    if (!workOrder) throw ApiError.notFound('Work Order tidak ditemukan.');

    const [eligibility] = await this.eligibility(tenantId, {
      machineId: workOrder.machineId,
      processId: workOrder.processId,
      operatorIds: [input.operatorId],
    });
    if (!eligibility) throw ApiError.notFound('Operator tidak ditemukan atau tidak aktif.');

    if (!eligibility.eligible && !input.force) {
      throw ApiError.conflict(
        eligibility.blockedReason ??
          'Operator tidak memenuhi syarat kualifikasi atau ketersediaan untuk penugasan ini.'
      );
    }

    const assignment: LaborAssignment = {
      id: `lasg-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      tenantId,
      workOrderId: input.workOrderId,
      workOrderNumber: workOrder.woNumber,
      operatorId: input.operatorId,
      operatorName: eligibility.operatorName,
      role: input.role,
      shiftId: input.shiftId ?? workOrder.shiftId,
      assignedBy: actor.id,
      assignedAt: new Date().toISOString(),
      status: 'ASSIGNED',
      qualificationCheck: {
        qualified: eligibility.qualified,
        matchedSkills: eligibility.matchedSkills.map((skill) => `${skill.skillCode} L${skill.level}`),
        missingSkills: eligibility.missingSkills.map((skill) => `${skill.skillCode}: ${skill.reason}`),
      },
    };

    await withTenant(tenantId, async (client) => {
      await this.repo.insertAssignment(client, assignment);
      // The operator is now spoken for; availability follows the assignment
      // rather than needing a second, forgettable step.
      await this.repo.setAvailability(client, {
        id: `avail-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        tenantId,
        operatorId: input.operatorId,
        operatorName: eligibility.operatorName,
        state: 'ASSIGNED',
        shiftId: assignment.shiftId,
        effectiveFrom: assignment.assignedAt,
        reason: `Ditugaskan pada ${workOrder.woNumber}`,
        updatedBy: actor.id,
        updatedAt: assignment.assignedAt,
      });
    });

    this.events.recordDetached({
      tenantId,
      eventType: 'OPERATOR_ASSIGNED',
      entityType: 'WORK_ORDER',
      entityId: input.workOrderId,
      actorType: 'USER',
      actorId: actor.id,
      actorName: actor.name,
      workOrderId: input.workOrderId,
      machineId: workOrder.machineId,
      lineId: workOrder.lineId,
      summary: `${eligibility.operatorName} ditugaskan pada ${workOrder.woNumber}.`,
      afterValue: { operatorId: input.operatorId, qualified: eligibility.qualified, forced: input.force ?? false },
    });

    return assignment;
  }

  async listAssignments(
    tenantId: string,
    filter: { workOrderId?: string; operatorId?: string; status?: string; active?: boolean } = {}
  ): Promise<LaborAssignment[]> {
    return withTenant(tenantId, (client) => this.repo.listAssignments(client, tenantId, filter));
  }

  async unassignOperator(
    tenantId: string,
    assignmentId: string,
    actor: { id: string; name?: string }
  ): Promise<void> {
    const assignment = await withTenant(tenantId, async (client) => {
      const [existing] = await this.repo.listAssignments(client, tenantId, { id: assignmentId });
      if (!existing) throw ApiError.notFound('Penugasan tidak ditemukan.');

      await this.repo.setAssignmentStatus(client, tenantId, assignmentId, 'CANCELLED');
      await this.repo.setAvailability(client, {
        id: `avail-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        tenantId,
        operatorId: existing.operatorId,
        operatorName: existing.operatorName,
        state: 'AVAILABLE',
        effectiveFrom: new Date().toISOString(),
        reason: `Dilepas dari ${existing.workOrderNumber}`,
        updatedBy: actor.id,
        updatedAt: new Date().toISOString(),
      });
      return existing;
    });

    this.events.recordDetached({
      tenantId,
      eventType: 'OPERATOR_UNASSIGNED',
      entityType: 'WORK_ORDER',
      entityId: assignment.workOrderId,
      actorType: 'USER',
      actorId: actor.id,
      actorName: actor.name,
      workOrderId: assignment.workOrderId,
      summary: `${assignment.operatorName} dilepas dari ${assignment.workOrderNumber}.`,
    });
  }

  // ==========================================================
  // §6.7 Labour utilisation (US-W005)
  // ==========================================================

  async recordTime(
    tenantId: string,
    input: {
      operatorId: string;
      workOrderId?: string;
      shiftId?: string;
      shiftDate?: string;
      startedAt: string;
      endedAt?: string;
      productiveMinutes: number;
      availableMinutes: number;
      category?: LaborTimeRecord['category'];
    },
    actor: { id: string }
  ): Promise<LaborTimeRecord> {
    const operator = this.masterData.getOperatorById(tenantId, input.operatorId);
    if (!operator) throw ApiError.notFound('Operator tidak ditemukan.');

    const record: LaborTimeRecord = {
      id: `ltr-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      tenantId,
      operatorId: input.operatorId,
      operatorName: operator.name,
      workOrderId: input.workOrderId,
      shiftId: input.shiftId,
      shiftDate: input.shiftDate ?? input.startedAt.slice(0, 10),
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      productiveMinutes: input.productiveMinutes,
      availableMinutes: input.availableMinutes,
      category: input.category ?? 'PRODUCTIVE',
      recordedBy: actor.id,
    };

    await withTenant(tenantId, (client) => this.repo.insertTimeRecord(client, record));
    return record;
  }

  async listTimeRecords(
    tenantId: string,
    filter: { operatorId?: string; workOrderId?: string; from?: string; to?: string; limit?: number } = {}
  ): Promise<LaborTimeRecord[]> {
    return withTenant(tenantId, (client) => this.repo.listTimeRecords(client, tenantId, filter));
  }

  /**
   * §6.7 — `productive / available × 100`, grouped by whatever scope is asked
   * for. Zero available minutes yields 0%, never a division by zero dressed up
   * as a percentage.
   */
  async utilization(
    tenantId: string,
    scope: LaborUtilization['scope'],
    range: { from?: string; to?: string } = {}
  ): Promise<LaborUtilization[]> {
    const records = await this.listTimeRecords(tenantId, {
      from: range.from,
      to: range.to,
      limit: 5000,
    });

    const buckets = new Map<string, { name: string; productive: number; available: number }>();
    for (const record of records) {
      const key =
        scope === 'OPERATOR'
          ? record.operatorId
          : scope === 'SHIFT'
            ? (record.shiftId ?? 'unassigned')
            : 'plant';
      const name =
        scope === 'OPERATOR'
          ? record.operatorName
          : scope === 'SHIFT'
            ? (this.masterData.getShifts(tenantId).find((s) => s.id === record.shiftId)?.name ??
              'Tanpa Shift')
            : 'Seluruh Plant';

      const bucket = buckets.get(key) ?? { name, productive: 0, available: 0 };
      bucket.productive += record.productiveMinutes;
      bucket.available += record.availableMinutes;
      buckets.set(key, bucket);
    }

    return [...buckets.entries()]
      .map(([id, bucket]) => ({
        scope,
        scopeId: id,
        scopeName: bucket.name,
        productiveMinutes: Number(bucket.productive.toFixed(1)),
        availableMinutes: Number(bucket.available.toFixed(1)),
        utilizationPercentage:
          bucket.available > 0 ? Number(((bucket.productive / bucket.available) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.utilizationPercentage - a.utilizationPercentage);
  }

  // ==========================================================
  // §22.4 Workforce dashboard
  // ==========================================================

  async dashboard(tenantId: string): Promise<{
    operatorsTotal: number;
    operatorsAvailable: number;
    operatorsAssigned: number;
    operatorsUnavailable: number;
    qualificationsActive: number;
    qualificationsExpired: number;
    qualificationsExpiringSoon: number;
    utilizationPercentage: number;
  }> {
    const availability = await this.listAvailability(tenantId);
    const qualifications = await this.listQualifications(tenantId);
    const expiringSoon = await this.listQualifications(tenantId, { expiringWithinDays: 30 });
    const [plant] = await this.utilization(tenantId, 'PLANT', {
      from: new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10),
    });

    return {
      operatorsTotal: availability.length,
      operatorsAvailable: availability.filter((row) => row.state === 'AVAILABLE').length,
      operatorsAssigned: availability.filter((row) => row.state === 'ASSIGNED' || row.state === 'WORKING')
        .length,
      operatorsUnavailable: availability.filter((row) =>
        ['ABSENT', 'LEAVE', 'SICK', 'OFFLINE'].includes(row.state)
      ).length,
      qualificationsActive: qualifications.filter((q) => q.status === 'ACTIVE').length,
      qualificationsExpired: qualifications.filter((q) => q.status === 'EXPIRED').length,
      qualificationsExpiringSoon: expiringSoon.filter((q) => q.status === 'ACTIVE').length,
      utilizationPercentage: plant?.utilizationPercentage ?? 0,
    };
  }

  private targetName(
    tenantId: string,
    targetType: QualificationRequirement['targetType'],
    targetId: string
  ): string {
    if (targetType === 'MACHINE') {
      return this.masterData.getMachineById(tenantId, targetId)?.name ?? targetId;
    }
    return this.masterData.getProcesses(tenantId).find((p) => p.id === targetId)?.name ?? targetId;
  }
}
