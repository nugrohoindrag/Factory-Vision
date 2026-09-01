import { randomUUID } from 'crypto';
import { CapacityPlanStatus, CapacityStatus } from '@factory-vision/domain-types';
import { withTenant } from '../../../platform/db/pool.js';
import type { Executor } from '../../../platform/db/executor.js';
import { ApiError } from '../../../platform/http/api-error.js';
import {
  CapacityPlanRepository,
  type CapacityPlanRecord,
  type CapacityPlanLineRecord,
} from '../infrastructure/capacity-plan.repository.js';
import { PlanningReferenceRepository } from '../infrastructure/planning-reference.repository.js';
import type { Job } from '@factory-vision/job-queue';
import { getJobQueue } from '../../../platform/queue/index.js';
import { PlanningAudit } from '../infrastructure/planning-audit.js';
import { OutboxRepository } from '../infrastructure/outbox.repository.js';
import { capacityPlanPrefix, nextNumber } from '../domain/numbering.js';
import { PLANNING_EVENTS, planningEvent } from '../domain/planning.events.js';
import {
  assessCapacity,
  daysInPeriod,
  shiftMinutes,
  type MachineCapacityInput,
} from '../domain/capacity.engine.js';

/**
 * Capacity Plan (MES-031, MES-032, MES-033).
 *
 * A capacity plan is a **snapshot**, like a forecast: recalculating writes a new
 * row and supersedes the one before it. A plan that was decided when the plant
 * had twelve machines has to keep showing twelve machines, even after the
 * thirteenth arrives — otherwise last month's Capacity Up request stops making
 * sense.
 *
 * Every number here is derived from master data. Nothing is typed: the three
 * capacity statuses are computed (§45.6) and there is no endpoint that sets one.
 */

export interface CapacityPlanDetail extends CapacityPlanRecord {
  lines: CapacityPlanLineRecord[];
}

export interface ComputeCapacityInput {
  periodStart: string;
  periodEnd: string;
  /** Overrides the tenant default from `planning_config`. */
  planningUtilizationPct?: number;
  plantId?: string;
  lineId?: string;
  productIds?: string[];
}

export class CapacityPlanService {
  private readonly plans = new CapacityPlanRepository();
  private readonly reference = new PlanningReferenceRepository();
  private readonly jobs = getJobQueue();
  private readonly audit = new PlanningAudit();
  private readonly outbox = new OutboxRepository();

  // --- Reads ----------------------------------------------------------

  async list(tenantId: string, filter: { status?: CapacityPlanStatus } = {}): Promise<CapacityPlanRecord[]> {
    return withTenant(tenantId, (client) => this.plans.list(client, tenantId, filter));
  }

  async get(tenantId: string, id: string): Promise<CapacityPlanDetail> {
    return withTenant(tenantId, async (client) => {
      const plan = await this.plans.findById(client, tenantId, id);
      if (!plan) throw ApiError.notFound('Capacity plan tidak ditemukan.');
      return { ...plan, lines: await this.plans.listLines(client, tenantId, id) };
    });
  }

  /** The live snapshot for a period, if one has been computed. */
  async latestForPeriod(tenantId: string, periodStart: string): Promise<CapacityPlanDetail | undefined> {
    return withTenant(tenantId, async (client) => {
      const [latest] = await this.plans.list(client, tenantId, {
        status: CapacityPlanStatus.COMPUTED,
        periodStart,
      });
      if (!latest) return undefined;
      return { ...latest, lines: await this.plans.listLines(client, tenantId, latest.id) };
    });
  }

  // --- Computation (MES-031, MES-032) ---------------------------------

  /**
   * Computes and stores a capacity snapshot.
   *
   * One line per product with demand in the period. Capacity is assembled from
   * shifts × days × compatible machines, minus the planned downtime already on
   * the calendar; the machines that could not be computed travel with the line
   * rather than being dropped.
   */
  async compute(
    tenantId: string,
    input: ComputeCapacityInput,
    actorId: string
  ): Promise<CapacityPlanDetail> {
    if (Date.parse(input.periodEnd) < Date.parse(input.periodStart)) {
      throw ApiError.validation('Periode capacity plan tidak valid.', [
        { field: 'periodEnd', code: 'OUT_OF_RANGE', message: 'Period end harus setelah period start.' },
      ]);
    }

    return withTenant(tenantId, async (client) =>
      this.computeWithin(client, tenantId, input, actorId)
    );
  }

  private async computeWithin(
    client: Executor,
    tenantId: string,
    input: ComputeCapacityInput,
    actorId: string,
    supersedes?: CapacityPlanRecord
  ): Promise<CapacityPlanDetail> {
    const config = await this.reference.getConfig(client, tenantId);
    const utilization = input.planningUtilizationPct ?? config.planningUtilizationPct;

    const shifts = await this.reference.listShifts(client, tenantId);
    const activeShifts = shifts.filter((s) => s.active);
    const days = daysInPeriod(input.periodStart, input.periodEnd);
    // Rostered minutes per machine over the period: every active shift, every
    // day. A machine belongs to one line and therefore to one plant, so the
    // same figure applies to each of them.
    const minutesPerMachine =
      days *
      activeShifts.reduce(
        (sum, shift) => sum + shiftMinutes(shift.startTime, shift.endTime, shift.breakMinutes),
        0
      );

    const plannedDowntime = await this.plans.plannedDowntimeMinutes(
      client,
      tenantId,
      input.periodStart,
      input.periodEnd
    );

    let demandRows = await this.plans.demandByProduct(
      client,
      tenantId,
      input.periodStart,
      input.periodEnd
    );
    if (input.productIds && input.productIds.length > 0) {
      const wanted = new Set(input.productIds);
      demandRows = demandRows.filter((row) => wanted.has(row.productId));
    }

    const fallbackLine = await this.reference.firstActiveLine(client, tenantId);
    const planNumber = await nextNumber(
      client,
      tenantId,
      'capacity_plan',
      'plan_number',
      capacityPlanPrefix(input.periodStart)
    );

    const plan = await this.plans.insert(client, {
      id: `cap-${randomUUID()}`,
      tenantId,
      planNumber,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      planningUtilizationPct: utilization,
      status: CapacityPlanStatus.COMPUTED,
    });

    const lines: CapacityPlanLineRecord[] = [];
    const gapEvents: { productId: string; assessment: ReturnType<typeof assessCapacity> }[] = [];

    for (const demand of demandRows) {
      const machines = await this.reference.listCompatibleMachines(
        client,
        tenantId,
        demand.productId,
        { plantId: input.plantId, lineId: input.lineId }
      );

      const inputs: MachineCapacityInput[] = machines.map((machine) => ({
        machineId: machine.machineId,
        machineCode: machine.machineCode,
        machineName: machine.machineName,
        lineId: machine.lineId,
        plantId: machine.plantId,
        machineStatus: machine.machineStatus,
        idealCycleTimeSeconds: machine.idealCycleTimeSeconds,
        availableMinutes: minutesPerMachine,
        plannedDowntimeMinutes: plannedDowntime.get(machine.machineId) ?? 0,
      }));

      const assessment = assessCapacity(inputs, utilization, demand.demandQuantity);

      const plantId = machines[0]?.plantId ?? fallbackLine?.plantId;
      if (!plantId) {
        // `capacity_plan_line.plant_id` is NOT NULL, and a tenant with no plant
        // has nothing to plan against. Say so rather than failing on a
        // constraint the planner cannot interpret.
        throw ApiError.invalidState(
          'Tenant belum memiliki plant atau production line aktif, sehingga kapasitas tidak dapat dihitung.'
        );
      }

      lines.push(
        await this.plans.insertLine(client, {
          id: `capl-${randomUUID()}`,
          tenantId,
          capacityPlanId: plan.id,
          plantId,
          lineId: input.lineId ?? machines[0]?.lineId,
          productId: demand.productId,
          totalCapacity: assessment.totalCapacity,
          planningCapacity: assessment.planningCapacity,
          capacityBuffer: assessment.capacityBuffer,
          demandQuantity: assessment.demandQuantity,
          plannedQuantity: demand.plannedQuantity,
          capacityUtilization: assessment.capacityUtilization,
          capacityGap: assessment.capacityGap,
          capacityStatus: assessment.capacityStatus,
          uncomputedMachines: assessment.uncomputedMachines,
          availableMinutes: assessment.availableMinutes,
        })
      );

      if (assessment.capacityStatus === CapacityStatus.CAPACITY_UP_REQUIRED) {
        gapEvents.push({ productId: demand.productId, assessment });
      }
    }

    if (supersedes) {
      await this.plans.markSuperseded(client, tenantId, supersedes.id, plan.id);
    }

    await this.audit.record(client, {
      tenantId,
      actorId,
      actorType: 'SYSTEM',
      entityType: 'capacity_plan',
      entityId: plan.id,
      action: supersedes ? 'RECALCULATE' : 'COMPUTE',
      previousValue: supersedes ? { supersededPlanId: supersedes.id } : undefined,
      newValue: {
        planNumber: plan.planNumber,
        planningUtilizationPct: utilization,
        periodDays: days,
        minutesPerMachine,
        lineCount: lines.length,
      },
    });

    // One event per product that cannot be met, so a consumer can raise the
    // Capacity Up conversation without polling the plan.
    for (const gap of gapEvents) {
      await this.outbox.publish(
        client,
        tenantId,
        planningEvent(PLANNING_EVENTS.CAPACITY_GAP_DETECTED, 'capacity_plan', plan.id, {
          capacityPlanId: plan.id,
          productId: gap.productId,
          demandQuantity: gap.assessment.demandQuantity,
          totalCapacity: gap.assessment.totalCapacity,
          capacityGap: gap.assessment.capacityGap,
          capacityStatus: gap.assessment.capacityStatus,
        })
      );
    }

    return { ...plan, lines };
  }

  // --- Recalculation (MES-033-2) --------------------------------------

  /** `POST /v1/capacity-plans/{id}/recalculate` — enqueues the job. */
  async enqueueRecalculate(tenantId: string, planId: string, actorId: string): Promise<Job> {
    return withTenant(tenantId, async (client) => {
      const plan = await this.plans.findById(client, tenantId, planId);
      if (!plan) throw ApiError.notFound('Capacity plan tidak ditemukan.');
      return this.jobs.enqueue(
        {
          tenantId,
          jobType: 'CAPACITY_PLAN_RECALCULATE',
          payload: { capacityPlanId: planId },
          requestedBy: actorId,
        },
        client
      );
    });
  }

  /**
   * Recomputes a plan's period as a new snapshot.
   *
   * The original is superseded, never edited. That is the whole point: a plan
   * already used by a Production Plan keeps the numbers it was used with, and
   * the new figures live beside them (MES-033).
   */
  async runRecalculate(
    tenantId: string,
    planId: string,
    actorId: string
  ): Promise<CapacityPlanDetail> {
    return withTenant(tenantId, async (client) => {
      const existing = await this.plans.findById(client, tenantId, planId);
      if (!existing) throw ApiError.notFound('Capacity plan tidak ditemukan.');

      const config = await this.reference.getConfig(client, tenantId);
      // A plan already referenced keeps the utilization it was computed with, so
      // a later policy change cannot rewrite a decision that was already taken.
      const referenced = await this.plans.isReferencedByPlan(client, tenantId, planId);
      const utilization = referenced
        ? existing.planningUtilizationPct
        : config.planningUtilizationPct;

      return this.computeWithin(
        client,
        tenantId,
        {
          periodStart: existing.periodStart,
          periodEnd: existing.periodEnd,
          planningUtilizationPct: utilization,
        },
        actorId,
        existing
      );
    });
  }

  /**
   * Capacity for one product, computed on the fly.
   *
   * Used by the Production Plan wizard's Step 2, which needs the capacity status
   * for a quantity the planner is still typing and must not write a snapshot for
   * every keystroke.
   */
  async assessProduct(
    tenantId: string,
    input: { productId: string; periodStart: string; periodEnd: string; demandQuantity: number }
  ): Promise<ReturnType<typeof assessCapacity>> {
    return withTenant(tenantId, async (client) => {
      const config = await this.reference.getConfig(client, tenantId);
      const shifts = (await this.reference.listShifts(client, tenantId)).filter((s) => s.active);
      const days = daysInPeriod(input.periodStart, input.periodEnd);
      const minutesPerMachine =
        days *
        shifts.reduce(
          (sum, shift) => sum + shiftMinutes(shift.startTime, shift.endTime, shift.breakMinutes),
          0
        );

      const plannedDowntime = await this.plans.plannedDowntimeMinutes(
        client,
        tenantId,
        input.periodStart,
        input.periodEnd
      );
      const machines = await this.reference.listCompatibleMachines(client, tenantId, input.productId);

      return assessCapacity(
        machines.map((machine) => ({
          machineId: machine.machineId,
          machineCode: machine.machineCode,
          machineName: machine.machineName,
          lineId: machine.lineId,
          plantId: machine.plantId,
          machineStatus: machine.machineStatus,
          idealCycleTimeSeconds: machine.idealCycleTimeSeconds,
          availableMinutes: minutesPerMachine,
          plannedDowntimeMinutes: plannedDowntime.get(machine.machineId) ?? 0,
        })),
        config.planningUtilizationPct,
        input.demandQuantity
      );
    });
  }
}
