import { MachineState } from '@factory-vision/domain-types';
import type {
  MaintenanceKpi,
  MaintenancePlan,
  MaintenanceRecord,
  MaintenanceRequest,
  MaintenanceState,
  MaintenanceType,
} from '@factory-vision/domain-types';
import { withTenant } from '../../platform/db/pool.js';
import { ApiError } from '../../platform/http/api-error.js';
import type { MasterDataService } from '../master-data/master-data.service.js';
import type { ShopFloorService } from '../shopfloor/shopfloor.service.js';
import type { EventService } from '../event/event.service.js';
import { MaintenanceRepository } from './maintenance.repository.js';

/**
 * Maintenance management (Improvement PRD §5).
 *
 * Preventive work is generated from a plan and a meter, corrective from a
 * request, emergency from a breakdown. The last of those is the one with teeth:
 * BR-MT03 makes it produce a downtime record and take the machine offline, so
 * the OEE figure and the maintenance report describe the same hour.
 *
 * BR-MT04 — "a machine in maintenance takes no new work order" — is answered
 * by `isMachineBlocked`, which the production board and the dispatcher consult.
 */
export class MaintenanceService {
  private readonly repo = new MaintenanceRepository();

  constructor(
    private readonly masterData: MasterDataService,
    private readonly shopFloor: ShopFloorService,
    private readonly events: EventService
  ) {}

  // ==========================================================
  // §5.2 Preventive maintenance plans
  // ==========================================================

  /**
   * Where a plan stands right now.
   *
   * Derived on read rather than stored: a plan does not become OVERDUE by
   * anything happening, it becomes overdue by time passing, and a stored status
   * would be wrong every morning until something wrote to it.
   */
  private static dueStatus(plan: MaintenancePlan, meter?: number): MaintenancePlan['dueStatus'] {
    if (plan.status !== 'ACTIVE') return 'SKIPPED';

    if (plan.triggerType === 'CALENDAR') {
      if (!plan.nextDueAt) return 'UPCOMING';
      const dueMs = new Date(plan.nextDueAt).getTime();
      const now = Date.now();
      if (now > dueMs) return 'OVERDUE';
      const warningDays = plan.warningThreshold ?? 3;
      return dueMs - now <= warningDays * 86_400_000 ? 'DUE' : 'UPCOMING';
    }

    // Meter-based: hours run or cycles produced since the last service.
    if (plan.nextDueMeter === undefined || meter === undefined) return 'UPCOMING';
    if (meter >= plan.nextDueMeter) return 'OVERDUE';
    const warning = plan.warningThreshold ?? plan.intervalValue * 0.1;
    return plan.nextDueMeter - meter <= warning ? 'DUE' : 'UPCOMING';
  }

  /** The next due moment, from the interval and the last service. */
  private static computeNextDue(plan: MaintenancePlan, performedAt: string, meter?: number) {
    if (plan.triggerType === 'CALENDAR') {
      const days =
        plan.intervalUnit.toUpperCase() === 'WEEK'
          ? plan.intervalValue * 7
          : plan.intervalUnit.toUpperCase() === 'MONTH'
            ? plan.intervalValue * 30
            : plan.intervalValue;
      return {
        nextDueAt: new Date(new Date(performedAt).getTime() + days * 86_400_000).toISOString(),
        nextDueMeter: undefined as number | undefined,
      };
    }
    return {
      nextDueAt: undefined as string | undefined,
      nextDueMeter: (meter ?? plan.lastPerformedMeter ?? 0) + plan.intervalValue,
    };
  }

  async listPlans(
    tenantId: string,
    filter: { machineId?: string; status?: string } = {}
  ): Promise<MaintenancePlan[]> {
    const plans = await withTenant(tenantId, (client) => this.repo.listPlans(client, tenantId, filter));
    return plans.map((plan) => ({ ...plan, dueStatus: MaintenanceService.dueStatus(plan) }));
  }

  async createPlan(
    tenantId: string,
    input: {
      name: string;
      machineId: string;
      triggerType: MaintenancePlan['triggerType'];
      intervalValue: number;
      intervalUnit?: string;
      tasks?: string[];
      estimatedDurationMinutes?: number;
      warningThreshold?: number;
      startFrom?: string;
    },
    actor: { id: string; name?: string }
  ): Promise<MaintenancePlan> {
    const machine = this.masterData.getMachineById(tenantId, input.machineId);
    if (!machine) throw ApiError.notFound('Mesin tidak ditemukan.');

    const now = new Date().toISOString();
    return withTenant(tenantId, async (client) => {
      const draft: MaintenancePlan = {
        id: `mplan-${Date.now()}`,
        tenantId,
        planNumber: await this.repo.nextNumber(client, tenantId, 'maintenance_plan', 'PM'),
        name: input.name,
        machineId: input.machineId,
        machineName: machine.name,
        triggerType: input.triggerType,
        intervalValue: input.intervalValue,
        intervalUnit: input.intervalUnit ?? (input.triggerType === 'CALENDAR' ? 'DAY' : 'HOUR'),
        tasks: input.tasks ?? [],
        estimatedDurationMinutes: input.estimatedDurationMinutes,
        warningThreshold: input.warningThreshold,
        status: 'ACTIVE',
        createdBy: actor.id,
        createdAt: now,
        updatedAt: now,
      };

      // A brand-new plan is due one interval from now, not immediately.
      const due = MaintenanceService.computeNextDue(draft, input.startFrom ?? now);
      const plan = { ...draft, ...due };
      await this.repo.upsertPlan(client, plan);
      return { ...plan, dueStatus: MaintenanceService.dueStatus(plan) };
    });
  }

  async updatePlan(
    tenantId: string,
    id: string,
    patch: Partial<Omit<MaintenancePlan, 'id' | 'tenantId' | 'planNumber' | 'createdAt'>>
  ): Promise<MaintenancePlan> {
    return withTenant(tenantId, async (client) => {
      const [existing] = await this.repo.listPlans(client, tenantId, { id });
      if (!existing) throw ApiError.notFound('Maintenance Plan tidak ditemukan.');

      const plan: MaintenancePlan = { ...existing, ...patch, updatedAt: new Date().toISOString() };
      await this.repo.upsertPlan(client, plan);
      return { ...plan, dueStatus: MaintenanceService.dueStatus(plan) };
    });
  }

  async deletePlan(tenantId: string, id: string): Promise<void> {
    await withTenant(tenantId, (client) => this.repo.deletePlan(client, tenantId, id));
  }

  /**
   * BR-MT01 — turns due plans into maintenance work.
   *
   * Idempotent by construction: a plan that already has an open record is
   * skipped, so running this hourly from a job does not queue the same service
   * twenty-four times.
   */
  async generateDueWork(
    tenantId: string,
    actor: { id: string; name?: string }
  ): Promise<MaintenanceRecord[]> {
    const plans = await this.listPlans(tenantId, { status: 'ACTIVE' });
    const due = plans.filter((plan) => plan.dueStatus === 'DUE' || plan.dueStatus === 'OVERDUE');
    const created: MaintenanceRecord[] = [];

    for (const plan of due) {
      const open = await withTenant(tenantId, (client) =>
        this.repo.listRecords(client, tenantId, { machineId: plan.machineId, limit: 50 })
      );
      const alreadyQueued = open.some(
        (record) =>
          record.maintenancePlanId === plan.id &&
          !['COMPLETED', 'CANCELLED'].includes(record.status)
      );
      if (alreadyQueued) continue;

      created.push(
        await this.createRecord(
          tenantId,
          {
            machineId: plan.machineId,
            maintenanceType: 'PREVENTIVE',
            maintenancePlanId: plan.id,
            problem: plan.tasks.join(', ') || plan.name,
            scheduledFor: plan.nextDueAt,
            status: 'PLANNED',
          },
          actor
        )
      );
    }
    return created;
  }

  // ==========================================================
  // §5.3 Corrective: request → diagnosis → work
  // ==========================================================

  async createRequest(
    tenantId: string,
    input: {
      machineId: string;
      maintenanceType?: MaintenanceType;
      priority?: MaintenanceRequest['priority'];
      problemDescription: string;
      reportedSymptom?: string;
      workOrderId?: string;
      downtimeId?: string;
      notes?: string;
    },
    actor: { id: string; name?: string; type?: 'USER' | 'OPERATOR' }
  ): Promise<MaintenanceRequest> {
    const machine = this.masterData.getMachineById(tenantId, input.machineId);
    if (!machine) throw ApiError.notFound('Mesin tidak ditemukan.');

    const request = await withTenant(tenantId, async (client) => {
      const record: MaintenanceRequest = {
        id: `mreq-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        tenantId,
        requestNumber: await this.repo.nextNumber(client, tenantId, 'maintenance_request', 'MR'),
        machineId: input.machineId,
        machineName: machine.name,
        maintenanceType: input.maintenanceType ?? 'CORRECTIVE',
        priority: input.priority ?? 'MEDIUM',
        problemDescription: input.problemDescription,
        reportedSymptom: input.reportedSymptom,
        workOrderId: input.workOrderId,
        downtimeId: input.downtimeId,
        requestedBy: actor.id,
        requestedByName: actor.name,
        requestedAt: new Date().toISOString(),
        status: 'REQUESTED',
        notes: input.notes,
      };
      await this.repo.insertRequest(client, record);
      return record;
    });

    this.events.recordDetached({
      tenantId,
      eventType: 'MAINTENANCE_REQUESTED',
      entityType: 'MACHINE',
      entityId: request.machineId,
      actorType: actor.type ?? 'USER',
      actorId: actor.id,
      actorName: actor.name,
      machineId: request.machineId,
      workOrderId: request.workOrderId,
      summary: `${request.requestNumber}: ${request.problemDescription}`,
      afterValue: { priority: request.priority, maintenanceType: request.maintenanceType },
    });

    return request;
  }

  async listRequests(
    tenantId: string,
    filter: { status?: string; machineId?: string; limit?: number } = {}
  ): Promise<MaintenanceRequest[]> {
    return withTenant(tenantId, (client) => this.repo.listRequests(client, tenantId, filter));
  }

  /** Accepting a request is what turns it into work someone is doing. */
  async acceptRequest(
    tenantId: string,
    requestId: string,
    input: { technicianId?: string; technicianName?: string; scheduledFor?: string },
    actor: { id: string; name?: string }
  ): Promise<MaintenanceRecord> {
    const [request] = await withTenant(tenantId, (client) =>
      this.repo.listRequests(client, tenantId, { id: requestId })
    );
    if (!request) throw ApiError.notFound('Maintenance Request tidak ditemukan.');
    if (request.status === 'CONVERTED') {
      throw ApiError.invalidState('Permintaan ini sudah menjadi pekerjaan maintenance.');
    }

    const record = await this.createRecord(
      tenantId,
      {
        machineId: request.machineId,
        maintenanceType: request.maintenanceType,
        maintenanceRequestId: request.id,
        downtimeId: request.downtimeId,
        problem: request.problemDescription,
        requesterId: request.requestedBy,
        requesterName: request.requestedByName,
        technicianId: input.technicianId,
        technicianName: input.technicianName,
        scheduledFor: input.scheduledFor,
        status: 'PLANNED',
      },
      actor
    );

    await withTenant(tenantId, (client) =>
      this.repo.setRequestStatus(client, tenantId, requestId, 'CONVERTED', record.id)
    );
    return record;
  }

  async rejectRequest(tenantId: string, requestId: string): Promise<void> {
    await withTenant(tenantId, (client) =>
      this.repo.setRequestStatus(client, tenantId, requestId, 'REJECTED')
    );
  }

  // ==========================================================
  // §5.4, §5.5 Records
  // ==========================================================

  async createRecord(
    tenantId: string,
    input: {
      machineId: string;
      maintenanceType: MaintenanceType;
      maintenancePlanId?: string;
      maintenanceRequestId?: string;
      downtimeId?: string;
      problem?: string;
      requesterId?: string;
      requesterName?: string;
      technicianId?: string;
      technicianName?: string;
      scheduledFor?: string;
      status?: MaintenanceState;
      notes?: string;
    },
    actor: { id: string; name?: string }
  ): Promise<MaintenanceRecord> {
    const machine = this.masterData.getMachineById(tenantId, input.machineId);
    if (!machine) throw ApiError.notFound('Mesin tidak ditemukan.');

    const now = new Date().toISOString();
    return withTenant(tenantId, async (client) => {
      const record: MaintenanceRecord = {
        id: `mtn-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        tenantId,
        maintenanceNumber: await this.repo.nextNumber(client, tenantId, 'maintenance_record', 'MT'),
        machineId: input.machineId,
        machineName: machine.name,
        maintenanceType: input.maintenanceType,
        maintenancePlanId: input.maintenancePlanId,
        maintenanceRequestId: input.maintenanceRequestId,
        downtimeId: input.downtimeId,
        status: input.status ?? 'PLANNED',
        problem: input.problem,
        requesterId: input.requesterId ?? actor.id,
        requesterName: input.requesterName ?? actor.name,
        technicianId: input.technicianId,
        technicianName: input.technicianName,
        scheduledFor: input.scheduledFor,
        parts: [],
        notes: input.notes,
        createdAt: now,
        updatedAt: now,
      };
      await this.repo.insertRecord(client, record);
      return record;
    });
  }

  async listRecords(
    tenantId: string,
    filter: {
      machineId?: string;
      status?: string;
      maintenanceType?: string;
      from?: string;
      to?: string;
      limit?: number;
    } = {}
  ): Promise<MaintenanceRecord[]> {
    return withTenant(tenantId, (client) => this.repo.listRecords(client, tenantId, filter));
  }

  async assignTechnician(
    tenantId: string,
    id: string,
    input: { technicianId: string; technicianName?: string; scheduledFor?: string }
  ): Promise<MaintenanceRecord> {
    return withTenant(tenantId, async (client) => {
      await this.repo.updateRecord(client, tenantId, id, {
        technicianId: input.technicianId,
        technicianName: input.technicianName,
        scheduledFor: input.scheduledFor,
      });
      const [record] = await this.repo.listRecords(client, tenantId, { id });
      if (!record) throw ApiError.notFound('Maintenance Record tidak ditemukan.');
      return record;
    });
  }

  /** Work begins; the machine goes to MAINTENANCE and stops taking new work. */
  async startWork(
    tenantId: string,
    id: string,
    actor: { id: string; name?: string }
  ): Promise<MaintenanceRecord> {
    const record = await withTenant(tenantId, async (client) => {
      const [existing] = await this.repo.listRecords(client, tenantId, { id });
      if (!existing) throw ApiError.notFound('Maintenance Record tidak ditemukan.');
      if (existing.status === 'COMPLETED') {
        throw ApiError.invalidState('Pekerjaan maintenance ini sudah selesai.');
      }

      await this.repo.updateRecord(client, tenantId, id, {
        status: 'IN_PROGRESS',
        startedAt: existing.startedAt ?? new Date().toISOString(),
        technicianId: existing.technicianId ?? actor.id,
        technicianName: existing.technicianName ?? actor.name,
      });
      const [updated] = await this.repo.listRecords(client, tenantId, { id });
      return updated!;
    });

    // §5.4 puts the machine OFFLINE while it is being worked on. The enum has
    // no MAINTENANCE state and does not need one: what production has to know
    // is that the machine cannot take work, and OFFLINE says exactly that.
    this.setMachineState(tenantId, record.machineId, MachineState.OFFLINE);

    this.events.recordDetached({
      tenantId,
      eventType: 'MAINTENANCE_STARTED',
      entityType: 'MACHINE',
      entityId: record.machineId,
      actorType: 'USER',
      actorId: actor.id,
      actorName: actor.name,
      machineId: record.machineId,
      summary: `${record.maintenanceNumber} (${record.maintenanceType}) dimulai pada ${record.machineName}.`,
      afterValue: { status: 'IN_PROGRESS', technicianId: record.technicianId },
    });

    return record;
  }

  /**
   * Completion, which BR-MT05 requires to state a result.
   *
   * Three things happen together: the record closes with a duration, the plan
   * that generated it moves to its next due point, and the machine comes back
   * to IDLE. An emergency also resolves the downtime it opened, so the machine
   * is not left running against an open downtime record.
   */
  async completeWork(
    tenantId: string,
    id: string,
    input: {
      result: NonNullable<MaintenanceRecord['result']>;
      rootCause?: string;
      actionTaken?: string;
      costReference?: number;
      notes?: string;
      meterReading?: number;
      parts?: Array<{ partId?: string; partName: string; quantity: number; uom?: string; costReference?: number }>;
    },
    actor: { id: string; name?: string }
  ): Promise<MaintenanceRecord> {
    if (!input.result) throw ApiError.validation('Hasil penyelesaian maintenance wajib diisi.');

    const record = await withTenant(tenantId, async (client) => {
      const [existing] = await this.repo.listRecords(client, tenantId, { id });
      if (!existing) throw ApiError.notFound('Maintenance Record tidak ditemukan.');
      if (existing.status === 'COMPLETED') return existing;

      const completedAt = new Date().toISOString();
      const startedAt = existing.startedAt ?? completedAt;
      const durationMinutes = Math.max(
        0,
        Math.round((new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 60_000)
      );

      await this.repo.updateRecord(client, tenantId, id, {
        status: 'COMPLETED',
        startedAt,
        completedAt,
        durationMinutes,
        result: input.result,
        rootCause: input.rootCause,
        actionTaken: input.actionTaken,
        costReference: input.costReference,
        notes: input.notes,
      });

      for (const [index, part] of (input.parts ?? []).entries()) {
        await this.repo.insertPart(client, tenantId, {
          id: `mpart-${Date.now()}-${index + 1}`,
          maintenanceRecordId: id,
          partId: part.partId,
          partName: part.partName,
          quantity: part.quantity,
          uom: part.uom ?? 'PCS',
          costReference: part.costReference,
        });
      }

      // The plan's clock restarts from the service that was actually done.
      if (existing.maintenancePlanId) {
        const [plan] = await this.repo.listPlans(client, tenantId, { id: existing.maintenancePlanId });
        if (plan) {
          const due = MaintenanceService.computeNextDue(plan, completedAt, input.meterReading);
          await this.repo.upsertPlan(client, {
            ...plan,
            lastPerformedAt: completedAt,
            lastPerformedMeter: input.meterReading ?? plan.lastPerformedMeter,
            ...due,
            updatedAt: completedAt,
          });
        }
      }

      const [updated] = await this.repo.listRecords(client, tenantId, { id });
      return updated!;
    });

    // BR-MT03's other half: the downtime the emergency opened has to close.
    if (record.downtimeId) {
      try {
        await this.shopFloor.resolveDowntime(tenantId, record.downtimeId, {
          clientEventId: `maintenance-complete-${record.id}`,
          occurredAt: record.completedAt ?? new Date().toISOString(),
        });
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(
          '[maintenance] gagal menutup downtime terkait:',
          error instanceof Error ? error.message : error
        );
      }
    }

    this.setMachineState(tenantId, record.machineId, MachineState.IDLE);

    this.events.recordDetached({
      tenantId,
      eventType: 'MAINTENANCE_COMPLETED',
      entityType: 'MACHINE',
      entityId: record.machineId,
      actorType: 'USER',
      actorId: actor.id,
      actorName: actor.name,
      machineId: record.machineId,
      summary: `${record.maintenanceNumber} selesai (${input.result}), ${record.durationMinutes ?? 0} menit.`,
      afterValue: {
        result: input.result,
        durationMinutes: record.durationMinutes,
        rootCause: input.rootCause,
      },
    });

    return record;
  }

  /**
   * §5.4 — a breakdown, in one call.
   *
   * Downtime first, then the maintenance record pointing at it, then the
   * machine offline. In that order because the downtime is the thing the plant
   * is losing money to; if the maintenance record fails to write, the loss is
   * still recorded and OEE is still right.
   */
  async raiseEmergency(
    tenantId: string,
    input: {
      machineId: string;
      problem: string;
      workOrderId?: string;
      lineId?: string;
      operatorId?: string;
      shiftId?: string;
      reasonId?: string;
      technicianId?: string;
      technicianName?: string;
    },
    actor: { id: string; name?: string; type?: 'USER' | 'OPERATOR' }
  ): Promise<{ record: MaintenanceRecord; downtimeId?: string }> {
    const machine = this.masterData.getMachineById(tenantId, input.machineId);
    if (!machine) throw ApiError.notFound('Mesin tidak ditemukan.');

    let downtimeId: string | undefined;
    const reasonId = input.reasonId ?? this.emergencyReasonId(tenantId);
    if (reasonId) {
      try {
        const downtime = await this.shopFloor.startDowntime(tenantId, {
          machineId: input.machineId,
          lineId: input.lineId ?? this.lineOf(tenantId, machine.workCenterId),
          workOrderId: input.workOrderId,
          operatorId: input.operatorId,
          shiftId: input.shiftId,
          reasonId,
          notes: input.problem,
          clientEventId: `emergency-${Date.now()}-${input.machineId}`,
          occurredAt: new Date().toISOString(),
        });
        downtimeId = downtime.id;
      } catch (error) {
        // A missing shift or reason must not stop the repair from being
        // recorded; the gap is logged and the maintenance record still exists.
        // eslint-disable-next-line no-console
        console.error(
          '[maintenance] gagal membuka downtime untuk emergency:',
          error instanceof Error ? error.message : error
        );
      }
    }

    const record = await this.createRecord(
      tenantId,
      {
        machineId: input.machineId,
        maintenanceType: 'EMERGENCY',
        downtimeId,
        problem: input.problem,
        technicianId: input.technicianId,
        technicianName: input.technicianName,
        status: 'IN_PROGRESS',
      },
      actor
    );

    await withTenant(tenantId, (client) =>
      this.repo.updateRecord(client, tenantId, record.id, {
        startedAt: new Date().toISOString(),
      })
    );

    this.setMachineState(tenantId, input.machineId, MachineState.OFFLINE);

    this.events.recordDetached({
      tenantId,
      eventType: 'MAINTENANCE_STARTED',
      entityType: 'MACHINE',
      entityId: input.machineId,
      actorType: actor.type ?? 'USER',
      actorId: actor.id,
      actorName: actor.name,
      machineId: input.machineId,
      workOrderId: input.workOrderId,
      summary: `Emergency maintenance ${record.maintenanceNumber}: ${input.problem}`,
      afterValue: { downtimeId, machineState: MachineState.OFFLINE },
    });

    return { record: { ...record, downtimeId, startedAt: new Date().toISOString() }, downtimeId };
  }

  /** BR-MT04 — the dispatcher's question before assigning a machine. */
  async isMachineBlocked(tenantId: string, machineId: string): Promise<boolean> {
    return withTenant(tenantId, (client) =>
      this.repo.machineUnderMaintenance(client, tenantId, machineId)
    );
  }

  /** Every machine currently under maintenance, for the board in one query. */
  async blockedMachines(tenantId: string): Promise<Set<string>> {
    const records = await this.listRecords(tenantId, { limit: 500 });
    return new Set(
      records
        .filter((record) => ['IN_PROGRESS', 'WAITING_PART', 'TESTING'].includes(record.status))
        .map((record) => record.machineId)
    );
  }

  // ==========================================================
  // §22.3 Maintenance dashboard
  // ==========================================================

  async kpi(
    tenantId: string,
    range: { from?: string; to?: string; machineId?: string } = {}
  ): Promise<MaintenanceKpi & { from: string; to: string }> {
    const to = range.to ?? new Date().toISOString();
    const from = range.from ?? new Date(Date.now() - 30 * 86_400_000).toISOString();

    return withTenant(tenantId, async (client) => {
      const totals = await this.repo.reliabilityTotals(client, tenantId, from, to, range.machineId);
      const plans = await this.repo.listPlans(client, tenantId, { status: 'ACTIVE' });
      const overdue = plans.filter(
        (plan) => MaintenanceService.dueStatus(plan) === 'OVERDUE'
      ).length;

      const machines = range.machineId
        ? [range.machineId]
        : this.masterData.getMachines(tenantId).map((machine) => machine.id);
      const windowHours = Math.max(
        (new Date(to).getTime() - new Date(from).getTime()) / 3_600_000,
        1
      );
      // Total machine-hours in the window, less what maintenance consumed.
      const grossHours = windowHours * Math.max(machines.length, 1);
      const maintenanceHours = totals.repairMinutes / 60;
      const operatingHours = Math.max(grossHours - maintenanceHours, 0);

      return {
        machineAvailabilityPercentage:
          grossHours > 0 ? Number(((operatingHours / grossHours) * 100).toFixed(1)) : 0,
        // §25 — compliance is completed preventive work over what the plans
        // asked for; a plan that is overdue is exactly the work not done.
        pmCompliancePercentage:
          totals.preventive + overdue > 0
            ? Number(((totals.preventive / (totals.preventive + overdue)) * 100).toFixed(1))
            : 100,
        breakdownCount: totals.failures,
        mtbfHours: totals.failures > 0 ? Number((operatingHours / totals.failures).toFixed(1)) : 0,
        mttrHours: totals.failures > 0 ? Number((maintenanceHours / totals.failures).toFixed(2)) : 0,
        overdueCount: overdue,
        emergencyCount: totals.emergencies,
        maintenanceDowntimeMinutes: totals.repairMinutes,
        from,
        to,
      };
    });
  }

  // ==========================================================
  // Helpers
  // ==========================================================

  /** A machine belongs to a line through its work centre, never directly. */
  private lineOf(tenantId: string, workCenterId: string): string | undefined {
    return this.masterData.getWorkCenters(tenantId).find((wc) => wc.id === workCenterId)
      ?.productionLineId;
  }

  /** The seeded MT-EMG code (migration 029), or any unplanned machine reason. */
  private emergencyReasonId(tenantId: string): string | undefined {
    const reasons = this.masterData.getDowntimeReasons(tenantId);
    return (
      reasons.find((reason) => reason.code === 'MT-EMG' && reason.active)?.id ??
      reasons.find((reason) => reason.category === 'MACHINE' && !reason.isPlanned && reason.active)?.id
    );
  }

  /**
   * Moves the machine's state, without letting a master-data hiccup fail the
   * maintenance call that has already been recorded.
   */
  private setMachineState(tenantId: string, machineId: string, state: MachineState): void {
    try {
      this.masterData.updateMachine(tenantId, machineId, { currentState: state });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(
        '[maintenance] gagal memperbarui status mesin:',
        error instanceof Error ? error.message : error
      );
    }
  }
}
