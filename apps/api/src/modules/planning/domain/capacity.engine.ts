import { CapacityStatus } from '@factory-vision/domain-types';

/**
 * Capacity calculation, status and gap (MES-031, MES-032, §45.6).
 *
 * ```text
 * Total Capacity    = Σ ( available machine minutes ÷ ideal cycle time )
 *                     over machines compatible with the Product
 * Planning Capacity = Total Capacity × planning_utilization_pct   (default 80%)
 * Capacity Buffer   = Total Capacity − Planning Capacity
 * Capacity Gap      = max(Demand − Total Capacity, 0)
 * ```
 *
 * | Status | Condition |
 * |---|---|
 * | `WITHIN_PLAN` | Demand ≤ Planning Capacity |
 * | `ADDITIONAL_DEMAND` | Planning Capacity < Demand ≤ Total Capacity |
 * | `CAPACITY_UP_REQUIRED` | Demand > Total Capacity |
 *
 * The rule that matters most is the one about absence. **A machine with no
 * ideal cycle time for the product is not counted, and is reported.** Treating
 * it as zero capacity would silently understate what the plant can do, and a
 * planner would raise a Capacity Up request against a machine that was simply
 * missing a master-data row. §45.6 calls this "kapasitas belum terhitung", and
 * it travels with every figure this engine produces.
 *
 * Status is **computed, never typed** (§45.6 acceptance criteria): it is derived
 * here and stored, so it cannot be argued with in a form field.
 */

export interface MachineCapacityInput {
  machineId: string;
  machineCode: string;
  machineName: string;
  lineId: string;
  plantId: string;
  machineStatus: string;
  /** Absent means the `product_machine_rate` row does not exist for this pair. */
  idealCycleTimeSeconds?: number;
  /** Minutes the machine is rostered for across the period. */
  availableMinutes: number;
  /** Scheduled planned downtime in the period, already subtracted where known. */
  plannedDowntimeMinutes?: number;
}

export interface UncomputedMachine {
  machineId: string;
  machineCode: string;
  reason: 'NO_IDEAL_CYCLE_TIME' | 'MACHINE_INACTIVE';
  /** Indonesian, ready to render in the "kapasitas belum terhitung" panel. */
  message: string;
}

export interface CapacityCalculation {
  totalCapacity: number;
  planningCapacity: number;
  capacityBuffer: number;
  planningUtilizationPct: number;
  /** Minutes that actually contributed to `totalCapacity`. */
  availableMinutes: number;
  /** Machines deliberately left out, each with the reason. */
  uncomputedMachines: UncomputedMachine[];
  /** Per-machine contribution, so the total can be explained (§18.3). */
  contributions: {
    machineId: string;
    machineCode: string;
    availableMinutes: number;
    idealCycleTimeSeconds: number;
    capacity: number;
  }[];
}

export interface CapacityAssessment extends CapacityCalculation {
  demandQuantity: number;
  capacityGap: number;
  capacityUtilization: number;
  capacityStatus: CapacityStatus;
}

/**
 * Total capacity from the machines that can actually make the product.
 *
 * `availableMinutes − plannedDowntimeMinutes` is the time that exists; dividing
 * by the ideal cycle time turns it into pieces. An inactive machine is excluded
 * and reported for the same reason a rate-less one is: silence about it would
 * look like capacity the plant does not have.
 */
export function calculateCapacity(
  machines: MachineCapacityInput[],
  planningUtilizationPct: number
): CapacityCalculation {
  const uncomputedMachines: UncomputedMachine[] = [];
  const contributions: CapacityCalculation['contributions'] = [];
  let totalCapacity = 0;
  let availableMinutes = 0;

  for (const machine of machines) {
    if (machine.machineStatus !== 'ACTIVE') {
      uncomputedMachines.push({
        machineId: machine.machineId,
        machineCode: machine.machineCode,
        reason: 'MACHINE_INACTIVE',
        message: `Mesin ${machine.machineCode} berstatus ${machine.machineStatus} dan tidak dihitung dalam kapasitas.`,
      });
      continue;
    }

    if (!machine.idealCycleTimeSeconds || machine.idealCycleTimeSeconds <= 0) {
      uncomputedMachines.push({
        machineId: machine.machineId,
        machineCode: machine.machineCode,
        reason: 'NO_IDEAL_CYCLE_TIME',
        message:
          `Mesin ${machine.machineCode} belum memiliki ideal cycle time untuk product ini, ` +
          'sehingga kapasitasnya belum terhitung — bukan berarti kapasitasnya nol.',
      });
      continue;
    }

    const effectiveMinutes = Math.max(
      machine.availableMinutes - (machine.plannedDowntimeMinutes ?? 0),
      0
    );
    const capacity = Math.floor((effectiveMinutes * 60) / machine.idealCycleTimeSeconds);

    availableMinutes += effectiveMinutes;
    totalCapacity += capacity;
    contributions.push({
      machineId: machine.machineId,
      machineCode: machine.machineCode,
      availableMinutes: effectiveMinutes,
      idealCycleTimeSeconds: machine.idealCycleTimeSeconds,
      capacity,
    });
  }

  const planningCapacity = Math.floor((totalCapacity * planningUtilizationPct) / 100);

  return {
    totalCapacity,
    planningCapacity,
    // Derived by subtraction rather than as `total × (100 − pct)`, so buffer and
    // planning capacity always add back up to the total despite the flooring.
    capacityBuffer: totalCapacity - planningCapacity,
    planningUtilizationPct,
    availableMinutes,
    uncomputedMachines,
    contributions,
  };
}

/** The three capacity statuses, in the order §45.6 defines them. */
export function determineCapacityStatus(
  demandQuantity: number,
  totalCapacity: number,
  planningCapacity: number
): CapacityStatus {
  if (demandQuantity <= planningCapacity) return CapacityStatus.WITHIN_PLAN;
  if (demandQuantity <= totalCapacity) return CapacityStatus.ADDITIONAL_DEMAND;
  return CapacityStatus.CAPACITY_UP_REQUIRED;
}

/** Capacity plus the verdict on a given demand. */
export function assessCapacity(
  machines: MachineCapacityInput[],
  planningUtilizationPct: number,
  demandQuantity: number
): CapacityAssessment {
  const calculation = calculateCapacity(machines, planningUtilizationPct);
  return {
    ...calculation,
    demandQuantity,
    capacityGap: Math.max(demandQuantity - calculation.totalCapacity, 0),
    // Ratio against total, not against planning capacity: utilization above 80%
    // is the interesting signal, and dividing by planning capacity would hide it
    // by reporting 100% exactly when the buffer starts being used.
    capacityUtilization:
      calculation.totalCapacity > 0
        ? Math.round((demandQuantity / calculation.totalCapacity) * 10000) / 10000
        : 0,
    capacityStatus: determineCapacityStatus(
      demandQuantity,
      calculation.totalCapacity,
      calculation.planningCapacity
    ),
  };
}

/**
 * Rostered minutes for one machine over a period.
 *
 * Shift length × working days. A shift that crosses midnight is still one shift
 * of work, so its length is measured forward from its start rather than by
 * subtracting clock times, which would produce a negative.
 */
export function shiftMinutes(startTime: string, endTime: string, breakMinutes: number): number {
  const [startHour, startMinute] = startTime.split(':').map(Number);
  const [endHour, endMinute] = endTime.split(':').map(Number);
  const start = startHour * 60 + startMinute;
  let end = endHour * 60 + endMinute;
  if (end <= start) end += 24 * 60;
  return Math.max(end - start - breakMinutes, 0);
}

/**
 * Days in `[from, to]` inclusive.
 *
 * Every calendar day counts: which days a plant runs is a roster question the
 * v1.0 schema does not model, and assuming a five-day week would understate a
 * plant on three shifts seven days a week — the common shape in the pilot's
 * segment.
 */
export function daysInPeriod(from: string, to: string): number {
  const start = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.floor((end - start) / 86_400_000) + 1;
}
