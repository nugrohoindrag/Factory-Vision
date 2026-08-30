import type {
  BottleneckRow,
  KpiStatus,
  MachinePerformanceRow,
  OeeCalculationConfig,
  OeeCalculationResult,
  OeeReportItem,
  OeeValidationEntry,
  OeeValidationGapClass,
  OeeValidationItem,
  TargetVsActualDimension,
  TargetVsActualRow,
  TargetVsActualSummary,
} from '@factory-vision/domain-types';
import { ApiError } from '../../platform/http/api-error.js';
import { MasterDataService } from '../master-data/master-data.service.js';
import { ProductionService } from '../production/production.service.js';
import { ShopFloorService } from '../shopfloor/shopfloor.service.js';

const PILOT_TENANT = 'tenant-pilot-factory-01';
const DEFAULT_WINDOW_DAYS = 30;

/** Filters shared by every drill-down, report and bottleneck query. */
export interface OeeFilter {
  days?: number;
  from?: string;
  to?: string;
  plantId?: string;
  lineId?: string;
  processId?: string;
  machineId?: string;
  shiftId?: string;
  productId?: string;
  /** Line ids the caller's scope permits; undefined means tenant-wide. */
  allowedLineIds?: string[];
}

/**
 * The machine × shift × day grain.
 *
 * Every OEE surface in the product rolls up from this one shape, which is why
 * the Executive card, the process table, the machine drill-down and the OEE
 * report can never quote different numbers for the same window.
 */
interface MachineDayRow {
  shiftDate: string;
  shiftId: string;
  machineId: string;
  lineId: string;
  processId?: string;
  productId?: string;
  plannedSeconds: number;
  plannedDowntimeSeconds: number;
  unplannedDowntimeSeconds: number;
  goodQuantity: number;
  rejectQuantity: number;
  targetQuantity: number;
  idealCycleSeconds?: number;
}

/**
 * OEE calculation, drill-down and pilot validation (US-027, US-032-US-037,
 * US-041, US-025).
 *
 * Holds the tenant's operational definitions so a factory can move
 * from "planned downtime counts against Availability" to the opposite without
 * anyone editing a formula, the version bump then makes every stored figure
 * traceable to the definition that produced it.
 */
export class OeeService {
  private configs = new Map<string, OeeCalculationConfig>();
  private validations: OeeValidationEntry[] = [];

  constructor(
    private masterData: MasterDataService,
    private production: ProductionService,
    private shopFloor: ShopFloorService
  ) {
    this.seedValidationChecklist(PILOT_TENANT);
  }

  // =========================================================
  // US-032-US-035, configuration and the calculation itself
  // =========================================================

  getConfig(tenantId: string): OeeCalculationConfig {
    let config = this.configs.get(tenantId);
    if (!config) {
      config = {
        tenantId,
        calcVersion: 1,
        // baseline: planned downtime stays inside Planned Production
        // Time, so setup and cleaning also lower Availability. A deliberate,
        // stated choice the pilot is meant to challenge.
        pptExcludesPlannedDowntime: false,
        idealCycleSource: 'PRODUCT_MACHINE',
        allowIdealCycleFallback: false,
        updatedAt: new Date().toISOString(),
        updatedBy: 'system',
      };
      this.configs.set(tenantId, config);
    }
    return config;
  }

  /**
   * Changing an operational definition bumps `calc_version`.
   *
   * requires definition gaps to be closed by configuration plus a
   * recompute, never an ad-hoc patch. Because every figure is derived from the
   * event log on read, the version bump *is* the recompute, and it stamps
   * subsequent results so a comparison against the factory's own spreadsheet
   * says which definition it was run under.
   */
  updateConfig(
    tenantId: string,
    patch: Partial<
      Pick<OeeCalculationConfig, 'pptExcludesPlannedDowntime' | 'idealCycleSource' | 'allowIdealCycleFallback'>
    >,
    actorId: string
  ): OeeCalculationConfig {
    const config = this.getConfig(tenantId);
    const changed =
      (patch.pptExcludesPlannedDowntime !== undefined &&
        patch.pptExcludesPlannedDowntime !== config.pptExcludesPlannedDowntime) ||
      (patch.idealCycleSource !== undefined && patch.idealCycleSource !== config.idealCycleSource) ||
      (patch.allowIdealCycleFallback !== undefined &&
        patch.allowIdealCycleFallback !== config.allowIdealCycleFallback);

    if (patch.pptExcludesPlannedDowntime !== undefined) {
      config.pptExcludesPlannedDowntime = patch.pptExcludesPlannedDowntime;
    }
    if (patch.idealCycleSource !== undefined) config.idealCycleSource = patch.idealCycleSource;
    if (patch.allowIdealCycleFallback !== undefined)
      config.allowIdealCycleFallback = patch.allowIdealCycleFallback;

    if (changed) config.calcVersion += 1;
    config.updatedAt = new Date().toISOString();
    config.updatedBy = actorId;
    return config;
  }

  /**
   * The one OEE computation (, US-032-US-035).
   *
   * Returns its inputs alongside its outputs: "Calculation dapat direproduksi"
   * means somebody must be able to re-derive the number by hand, which they
   * cannot do from three percentages.
   */
  calculate(
    tenantId: string,
    input: {
      plannedProductionSeconds: number;
      plannedDowntimeSeconds: number;
      unplannedDowntimeSeconds: number;
      goodCount: number;
      rejectCount: number;
      idealCycleSeconds?: number;
    }
  ): OeeCalculationResult {
    const config = this.getConfig(tenantId);
    const totalDowntime = input.plannedDowntimeSeconds + input.unplannedDowntimeSeconds;

    //, the tenant flag decides whether planned stoppages are subtracted
    // from Planned Production Time or left in it to depress Availability.
    const plannedProductionSeconds = config.pptExcludesPlannedDowntime
      ? Math.max(0, input.plannedProductionSeconds - input.plannedDowntimeSeconds)
      : input.plannedProductionSeconds;

    const subtractedDowntime = config.pptExcludesPlannedDowntime
      ? input.unplannedDowntimeSeconds
      : totalDowntime;

    const runTimeSeconds = Math.max(0, plannedProductionSeconds - subtractedDowntime);
    const totalCount = input.goodCount + input.rejectCount;

    const availability = plannedProductionSeconds > 0 ? clamp01(runTimeSeconds / plannedProductionSeconds) : 0;

    // US-034: a zero denominator is handled safely rather than producing NaN.
    const quality = totalCount > 0 ? clamp01(input.goodCount / totalCount) : 1;

    const idealCycleMissing = input.idealCycleSeconds === undefined || input.idealCycleSeconds <= 0;

    // US-033 /: without a configured rate, Performance is not guessed.
    // It reports zero and raises `idealCycleMissing` so the UI can say the
    // master data is incomplete instead of showing a plausible fiction.
    const performance =
      idealCycleMissing || runTimeSeconds <= 0 || totalCount <= 0
        ? 0
        : clamp01((input.idealCycleSeconds! * totalCount) / runTimeSeconds);

    const oee = idealCycleMissing ? 0 : round4(availability * performance * quality);

    return {
      availability: round4(availability),
      performance: round4(performance),
      quality: round4(quality),
      oee,
      inputs: {
        plannedProductionSeconds,
        plannedDowntimeSeconds: input.plannedDowntimeSeconds,
        unplannedDowntimeSeconds: input.unplannedDowntimeSeconds,
        runTimeSeconds,
        idealCycleSeconds: idealCycleMissing ? null : input.idealCycleSeconds!,
        goodCount: input.goodCount,
        rejectCount: input.rejectCount,
        totalCount,
      },
      calcVersion: config.calcVersion,
      pptExcludesPlannedDowntime: config.pptExcludesPlannedDowntime,
      idealCycleMissing,
      computedAt: new Date().toISOString(),
    };
  }

  // =========================================================
  // The shared grain
  // =========================================================

  /**
   * Planned Production Time for one line-shift.
   *
   * The line's configured `plannedProductionTimeMinutes` wins: it is the field
   * the factory sets deliberately, and it is what the pilot will be asked to
   * confirm in validation item V1. Shift duration minus breaks is the
   * fallback for a line that has not been configured yet.
   */
  private plannedSecondsForShift(tenantId: string, shiftId: string, lineId: string): number {
    const line = this.masterData.getLineById(tenantId, lineId);
    if (line?.plannedProductionTimeMinutes) return line.plannedProductionTimeMinutes * 60;

    const shift = this.masterData.getShiftById(tenantId, shiftId);
    if (shift) {
      const [sh, sm] = shift.startTime.split(':').map(Number);
      const [eh, em] = shift.endTime.split(':').map(Number);
      let minutes = eh * 60 + em - (sh * 60 + sm);
      if (minutes <= 0) minutes += 24 * 60;
      return Math.max(0, (minutes - (shift.breakMinutes ?? 0)) * 60);
    }
    return 480 * 60;
  }

  private async machineDayRows(tenantId: string, filter: OeeFilter): Promise<MachineDayRow[]> {
    const config = this.getConfig(tenantId);
    const workOrders = await this.production.getWorkOrders(tenantId);
    const workOrderById = new Map(workOrders.map((wo) => [wo.id, wo]));
    const productionRecords = await this.shopFloor.getProductionRecords(tenantId);
    const downtimeRecords = await this.shopFloor.getDowntimeRecords(tenantId);

    // Daily target per machine: the seeded and hand-entered work orders carry a
    // per-shift target, so the machine's target for a day is the sum of the
    // targets of the work orders routed to it.
    const targetByMachine = new Map<string, number>();
    for (const wo of workOrders) {
      const key = wo.machineId ?? `line:${wo.lineId}`;
      targetByMachine.set(key, (targetByMachine.get(key) ?? 0) + wo.targetQuantity);
    }

    const buckets = new Map<string, MachineDayRow>();

    const bucketFor = (
      shiftDate: string,
      shiftId: string,
      machineId: string,
      lineId: string,
      processId?: string,
      productId?: string
    ): MachineDayRow => {
      const key = `${shiftDate}|${shiftId}|${machineId}|${lineId}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          shiftDate,
          shiftId,
          machineId,
          lineId,
          processId,
          productId,
          plannedSeconds: this.plannedSecondsForShift(tenantId, shiftId, lineId),
          plannedDowntimeSeconds: 0,
          unplannedDowntimeSeconds: 0,
          goodQuantity: 0,
          rejectQuantity: 0,
          targetQuantity: targetByMachine.get(machineId) ?? targetByMachine.get(`line:${lineId}`) ?? 0,
          idealCycleSeconds: this.masterData.resolveIdealCycleSeconds(
            tenantId,
            productId,
            machineId,
            config.idealCycleSource
          ),
        };
        buckets.set(key, bucket);
      }
      if (!bucket.processId && processId) bucket.processId = processId;
      if (!bucket.productId && productId) bucket.productId = productId;
      return bucket;
    };

    for (const record of productionRecords) {
      const wo = workOrderById.get(record.workOrderId);
      const lineId = wo?.lineId;
      if (!lineId) continue;
      const machineId = record.machineId || wo?.machineId || '';
      if (!machineId) continue;
      const bucket = bucketFor(
        record.shiftDate,
        record.shiftId,
        machineId,
        lineId,
        record.processId ?? wo?.processId,
        wo?.productId
      );
      bucket.goodQuantity += record.goodQuantity;
      bucket.rejectQuantity += record.rejectQuantity;
    }

    for (const record of downtimeRecords) {
      const machineId = record.machineId;
      if (!machineId) continue;
      const wo = record.workOrderId ? workOrderById.get(record.workOrderId) : undefined;
      const bucket = bucketFor(
        record.shiftDate,
        record.shiftId,
        machineId,
        record.lineId,
        record.processId ?? wo?.processId,
        wo?.productId
      );
      const seconds = record.durationSeconds ?? 0;
      if (record.isPlanned) bucket.plannedDowntimeSeconds += seconds;
      else bucket.unplannedDowntimeSeconds += seconds;
    }

    // Late-resolve the ideal cycle: a bucket's product only becomes known once
    // its first record lands, which may be after the bucket was created.
    for (const bucket of buckets.values()) {
      if (bucket.idealCycleSeconds === undefined) {
        bucket.idealCycleSeconds = this.masterData.resolveIdealCycleSeconds(
          tenantId,
          bucket.productId,
          bucket.machineId,
          config.idealCycleSource
        );
      }
    }

    return this.applyFilter(Array.from(buckets.values()), filter);
  }

  private applyFilter(rows: MachineDayRow[], filter: OeeFilter): MachineDayRow[] {
    let result = rows;

    if (filter.allowedLineIds) {
      const allowed = new Set(filter.allowedLineIds);
      result = result.filter((r) => allowed.has(r.lineId));
    }
    if (filter.lineId) result = result.filter((r) => r.lineId === filter.lineId);
    if (filter.processId) result = result.filter((r) => r.processId === filter.processId);
    if (filter.machineId) result = result.filter((r) => r.machineId === filter.machineId);
    if (filter.shiftId) result = result.filter((r) => r.shiftId === filter.shiftId);
    if (filter.productId) result = result.filter((r) => r.productId === filter.productId);
    if (filter.from) result = result.filter((r) => r.shiftDate >= filter.from!);
    if (filter.to) result = result.filter((r) => r.shiftDate <= filter.to!);

    if (!filter.from && !filter.to) {
      const days = filter.days ?? DEFAULT_WINDOW_DAYS;
      const dates = Array.from(new Set(result.map((r) => r.shiftDate))).sort();
      const kept = new Set(dates.slice(-days));
      result = result.filter((r) => kept.has(r.shiftDate));
    }

    return result.sort((a, b) => a.shiftDate.localeCompare(b.shiftDate));
  }

  /** Rolls a set of rows into one OEE result via the configured definitions. */
  private roll(tenantId: string, rows: MachineDayRow[]): OeeCalculationResult & { targetQuantity: number } {
    const plannedSeconds = rows.reduce((acc, r) => acc + r.plannedSeconds, 0);
    const plannedDowntime = rows.reduce((acc, r) => acc + r.plannedDowntimeSeconds, 0);
    const unplannedDowntime = rows.reduce((acc, r) => acc + r.unplannedDowntimeSeconds, 0);
    const good = rows.reduce((acc, r) => acc + r.goodQuantity, 0);
    const reject = rows.reduce((acc, r) => acc + r.rejectQuantity, 0);
    const target = rows.reduce((acc, r) => acc + r.targetQuantity, 0);

    // Mixed products mean no single cycle time applies, so the roll-up uses the
    // ideal *time* each row earned and divides it back out, the standard way
    // to aggregate Performance without pretending the mix was homogeneous.
    const totalUnits = good + reject;
    const idealSeconds = rows.reduce(
      (acc, r) => acc + (r.idealCycleSeconds ?? 0) * (r.goodQuantity + r.rejectQuantity),
      0
    );
    const anyRate = rows.some((r) => r.idealCycleSeconds !== undefined && r.idealCycleSeconds > 0);
    const weightedCycle = anyRate && totalUnits > 0 ? idealSeconds / totalUnits : undefined;

    const result = this.calculate(tenantId, {
      plannedProductionSeconds: plannedSeconds,
      plannedDowntimeSeconds: plannedDowntime,
      unplannedDowntimeSeconds: unplannedDowntime,
      goodCount: good,
      rejectCount: reject,
      idealCycleSeconds: weightedCycle,
    });

    return { ...result, targetQuantity: target };
  }

  private classify(tenantId: string, oeePct: number, achievementPct: number): KpiStatus {
    const oeeTarget = this.masterData.getKpiTarget(tenantId, 'OEE')?.targetValue ?? 85;
    const achievementTarget =
      this.masterData.getKpiTarget(tenantId, 'PRODUCTION_ACHIEVEMENT')?.targetValue ?? 100;

    const oeeAttainment = oeeTarget > 0 ? (oeePct / oeeTarget) * 100 : 100;
    const achievementAttainment = achievementTarget > 0 ? (achievementPct / achievementTarget) * 100 : 100;
    const worst = Math.min(oeeAttainment, achievementAttainment);

    if (worst < 90) return 'CRITICAL';
    if (worst < 95) return 'WATCH';
    return 'GOOD';
  }

  // =========================================================
  // US-027, Process to Machine drill-down
  // =========================================================

  async getMachinePerformance(tenantId: string, filter: OeeFilter): Promise<MachinePerformanceRow[]> {
    const rows = await this.machineDayRows(tenantId, filter);
    const machines = this.masterData.getMachines(tenantId);
    const workCenters = this.masterData.getWorkCenters(tenantId);
    const lines = this.masterData.getLines(tenantId);
    const processes = this.masterData.getProcesses(tenantId);

    const byMachine = new Map<string, MachineDayRow[]>();
    for (const row of rows) {
      const list = byMachine.get(row.machineId) ?? [];
      list.push(row);
      byMachine.set(row.machineId, list);
    }

    return Array.from(byMachine.entries())
      .map(([machineId, machineRows]) => {
        const rolled = this.roll(tenantId, machineRows);
        const machine = machines.find((m) => m.id === machineId);
        const workCenter = workCenters.find((w) => w.id === machine?.workCenterId);
        const lineId = machineRows[0].lineId;
        const line = lines.find((l) => l.id === lineId);
        const processId = machineRows.find((r) => r.processId)?.processId ?? null;
        const process = processes.find((p) => p.id === processId);

        const good = rolled.inputs.goodCount;
        const target = rolled.targetQuantity;
        const achievementPct = target > 0 ? round1((good / target) * 100) : 0;
        const oeePct = round1(rolled.oee * 100);

        return {
          machineId,
          machineCode: machine?.code ?? machineId,
          machineName: machine?.name ?? machineId,
          workCenterId: workCenter?.id ?? '',
          workCenterName: workCenter?.name ?? '-',
          processId,
          processName: process?.name ?? null,
          lineId,
          lineName: line?.name ?? lineId,
          oee: oeePct,
          availability: round1(rolled.availability * 100),
          performance: round1(rolled.performance * 100),
          quality: round1(rolled.quality * 100),
          goodQuantity: good,
          rejectQuantity: rolled.inputs.rejectCount,
          targetQuantity: target,
          achievementPct,
          plannedMinutes: Math.round(rolled.inputs.plannedProductionSeconds / 60),
          runMinutes: Math.round(rolled.inputs.runTimeSeconds / 60),
          downtimeMinutes: Math.round(
            (rolled.inputs.plannedDowntimeSeconds + rolled.inputs.unplannedDowntimeSeconds) / 60
          ),
          idealCycleSeconds: rolled.inputs.idealCycleSeconds,
          idealCycleMissing: rolled.idealCycleMissing,
          status: this.classify(tenantId, oeePct, achievementPct),
        } satisfies MachinePerformanceRow;
      })
      .sort((a, b) => a.oee - b.oee);
  }

  // =========================================================
  // US-037, Bottleneck analysis
  // =========================================================

  /**
   * Ranks constraints by the output they cost (US-037).
   *
   * Ranking by OEE alone would put a barely-used machine with a poor score
   * above the press that actually starved the plant of 4,000 tyres. Lost units
   * against target is what a manager can act on, so that is the ranking key,
   * with the dominant OEE factor named so they know which lever to pull.
   */
  async getBottlenecks(tenantId: string, filter: OeeFilter & { kind?: 'PROCESS' | 'MACHINE' }): Promise<BottleneckRow[]> {
    const kind = filter.kind ?? 'MACHINE';
    const rows = await this.machineDayRows(tenantId, filter);
    const machines = this.masterData.getMachines(tenantId);
    const processes = this.masterData.getProcesses(tenantId);
    const lines = this.masterData.getLines(tenantId);

    const groups = new Map<string, MachineDayRow[]>();
    for (const row of rows) {
      const key = kind === 'PROCESS' ? (row.processId ?? 'unassigned') : row.machineId;
      const list = groups.get(key) ?? [];
      list.push(row);
      groups.set(key, list);
    }

    const candidates = Array.from(groups.entries()).map(([key, groupRows]) => {
      const rolled = this.roll(tenantId, groupRows);
      const good = rolled.inputs.goodCount;
      const target = rolled.targetQuantity;
      const lostUnits = Math.max(0, target - good);

      const availabilityLoss = 1 - rolled.availability;
      const performanceLoss = 1 - rolled.performance;
      const qualityLoss = 1 - rolled.quality;
      const losses: Array<[BottleneckRow['dominantLoss'], number]> = [
        ['AVAILABILITY', availabilityLoss],
        ['PERFORMANCE', performanceLoss],
        ['QUALITY', qualityLoss],
      ];
      losses.sort((a, b) => b[1] - a[1]);

      const machine = machines.find((m) => m.id === key);
      const process = processes.find((p) => p.id === key);
      const lineId = groupRows[0].lineId;
      const line = lines.find((l) => l.id === lineId);
      const ownProcess = processes.find((p) => p.id === groupRows.find((r) => r.processId)?.processId);

      return {
        kind,
        rank: 0,
        entityId: key,
        entityName: kind === 'PROCESS' ? (process?.name ?? 'Tanpa Proses') : (machine?.name ?? key),
        contextLabel: kind === 'PROCESS' ? (line?.name ?? lineId) : (ownProcess?.name ?? line?.name ?? lineId),
        oee: round1(rolled.oee * 100),
        availability: round1(rolled.availability * 100),
        performance: round1(rolled.performance * 100),
        quality: round1(rolled.quality * 100),
        lostUnits,
        lostUnitsPct: target > 0 ? round1((lostUnits / target) * 100) : 0,
        downtimeMinutes: Math.round(
          (rolled.inputs.plannedDowntimeSeconds + rolled.inputs.unplannedDowntimeSeconds) / 60
        ),
        rejectQuantity: rolled.inputs.rejectCount,
        dominantLoss: losses[0][0],
        dominantLossPct: round1(losses[0][1] * 100),
        drillDownPath:
          kind === 'PROCESS'
            ? `/oee?processId=${encodeURIComponent(key)}`
            : `/oee?machineId=${encodeURIComponent(key)}`,
      } satisfies BottleneckRow;
    });

    return candidates
      .sort((a, b) => b.lostUnits - a.lostUnits || a.oee - b.oee)
      .map((row, index) => ({ ...row, rank: index + 1 }));
  }

  // =========================================================
  // US-041, OEE report
  // =========================================================

  async getOeeReport(tenantId: string, filter: OeeFilter): Promise<OeeReportItem[]> {
    const rows = await this.machineDayRows(tenantId, filter);
    const machines = this.masterData.getMachines(tenantId);
    const lines = this.masterData.getLines(tenantId);
    const processes = this.masterData.getProcesses(tenantId);
    const products = this.masterData.getProducts(tenantId);
    const shifts = this.masterData.getShifts(tenantId);

    return rows
      .map((row) => {
        const rolled = this.roll(tenantId, [row]);
        const machine = machines.find((m) => m.id === row.machineId);
        const line = lines.find((l) => l.id === row.lineId);
        const process = processes.find((p) => p.id === row.processId);
        const product = products.find((p) => p.id === row.productId);
        const shift = shifts.find((s) => s.id === row.shiftId);

        return {
          shiftDate: row.shiftDate,
          shiftId: row.shiftId,
          shiftName: shift?.name ?? row.shiftId,
          lineId: row.lineId,
          lineName: line?.name ?? row.lineId,
          machineId: row.machineId,
          machineName: machine?.name ?? row.machineId,
          processId: row.processId ?? null,
          processName: process?.name ?? null,
          productId: row.productId ?? null,
          productName: product?.name ?? null,
          availability: round1(rolled.availability * 100),
          performance: round1(rolled.performance * 100),
          quality: round1(rolled.quality * 100),
          oee: round1(rolled.oee * 100),
          plannedMinutes: Math.round(rolled.inputs.plannedProductionSeconds / 60),
          runMinutes: Math.round(rolled.inputs.runTimeSeconds / 60),
          downtimeMinutes: Math.round(
            (rolled.inputs.plannedDowntimeSeconds + rolled.inputs.unplannedDowntimeSeconds) / 60
          ),
          goodQuantity: rolled.inputs.goodCount,
          rejectQuantity: rolled.inputs.rejectCount,
          totalQuantity: rolled.inputs.totalCount,
          idealCycleMissing: rolled.idealCycleMissing,
          calcVersion: rolled.calcVersion,
        } satisfies OeeReportItem;
      })
      .sort((a, b) => b.shiftDate.localeCompare(a.shiftDate) || a.machineName.localeCompare(b.machineName));
  }

  // =========================================================
  // US-025, Target vs Actual
  // =========================================================

  async getTargetVsActual(
    tenantId: string,
    dimension: TargetVsActualDimension,
    filter: OeeFilter
  ): Promise<TargetVsActualSummary> {
    const rows = await this.machineDayRows(tenantId, filter);
    const lines = this.masterData.getLines(tenantId);
    const processes = this.masterData.getProcesses(tenantId);
    const products = this.masterData.getProducts(tenantId);
    const shifts = this.masterData.getShifts(tenantId);

    const keyOf = (row: MachineDayRow): string => {
      switch (dimension) {
        case 'LINE':
          return row.lineId;
        case 'PROCESS':
          return row.processId ?? 'unassigned';
        case 'PRODUCT':
          return row.productId ?? 'unassigned';
        case 'SHIFT':
          return row.shiftId;
        case 'DATE':
        default:
          return row.shiftDate;
      }
    };

    const labelOf = (key: string): string => {
      switch (dimension) {
        case 'LINE':
          return lines.find((l) => l.id === key)?.name ?? key;
        case 'PROCESS':
          return processes.find((p) => p.id === key)?.name ?? 'Tanpa Proses';
        case 'PRODUCT':
          return products.find((p) => p.id === key)?.name ?? 'Tanpa Produk';
        case 'SHIFT':
          return shifts.find((s) => s.id === key)?.name ?? key;
        case 'DATE':
        default:
          return key;
      }
    };

    const groups = new Map<string, MachineDayRow[]>();
    for (const row of rows) {
      const key = keyOf(row);
      const list = groups.get(key) ?? [];
      list.push(row);
      groups.set(key, list);
    }

    // Straight-line forecast: how the window ends if the run rate so far holds.
    const dates = Array.from(new Set(rows.map((r) => r.shiftDate))).sort();
    const elapsedDays = dates.length;
    const windowDays = filter.days ?? elapsedDays;

    const resultRows: TargetVsActualRow[] = Array.from(groups.entries())
      .map(([key, groupRows]) => {
        const actual = groupRows.reduce((acc, r) => acc + r.goodQuantity, 0);
        const reject = groupRows.reduce((acc, r) => acc + r.rejectQuantity, 0);
        const target = groupRows.reduce((acc, r) => acc + r.targetQuantity, 0);
        const achievementPct = target > 0 ? round1((actual / target) * 100) : 0;
        const forecastQuantity =
          elapsedDays > 0 && windowDays > elapsedDays ? Math.round((actual / elapsedDays) * windowDays) : null;

        return {
          dimension,
          key,
          label: labelOf(key),
          targetQuantity: target,
          actualQuantity: actual,
          rejectQuantity: reject,
          variance: actual - target,
          achievementPct,
          status: this.classify(tenantId, achievementPct, achievementPct),
          forecastQuantity,
          forecastAchievementPct:
            forecastQuantity !== null && target > 0 ? round1((forecastQuantity / target) * 100) : null,
        } satisfies TargetVsActualRow;
      })
      .sort((a, b) => a.achievementPct - b.achievementPct);

    const totalTarget = resultRows.reduce((acc, r) => acc + r.targetQuantity, 0);
    const totalActual = resultRows.reduce((acc, r) => acc + r.actualQuantity, 0);
    const achievementPct = totalTarget > 0 ? round1((totalActual / totalTarget) * 100) : 0;

    return {
      dimension,
      totalTarget,
      totalActual,
      totalVariance: totalActual - totalTarget,
      achievementPct,
      status: this.classify(tenantId, achievementPct, achievementPct),
      rows: resultRows,
    };
  }

  // =========================================================
  // US-036, Pilot OEE validation log
  // =========================================================

  /** The six items makes a mandatory pilot gate. */
  private seedValidationChecklist(tenantId: string): void {
    const titles: Record<OeeValidationItem, string> = {
      V1: 'Definisi Planned Production Time disepakati dengan pabrik',
      V2: 'Definisi Run Time dan perlakuan downtime terverifikasi',
      V3: 'Ideal Cycle Time per Product × Machine tervalidasi',
      V4: 'Total Count dan Good Count sesuai perhitungan pabrik',
      V5: 'Perlakuan is_planned pada setup/cleaning disepakati',
      V6: 'Hasil OEE MES vs perhitungan pabrik berada dalam toleransi',
    };
    const now = new Date().toISOString();
    for (const item of Object.keys(titles) as OeeValidationItem[]) {
      this.validations.push({
        id: `oeeval-${item.toLowerCase()}`,
        tenantId,
        item,
        title: titles[item],
        scopeLabel: 'Pilot area, Curing Press (CPR-001/002)',
        shiftDate: '',
        mesValue: null,
        factoryValue: null,
        gap: null,
        gapClass: 'NONE',
        status: 'OPEN',
        resolution: '',
        resolvedByConfigChange: false,
        calcVersion: this.getConfig(tenantId).calcVersion,
        notes: '',
        recordedBy: 'system',
        recordedAt: now,
        updatedAt: now,
      });
    }
  }

  getValidationEntries(tenantId: string): OeeValidationEntry[] {
    return this.validations.filter((v) => v.tenantId === tenantId).sort((a, b) => a.item.localeCompare(b.item));
  }

  /**
   * Records a comparison against the factory's own figure (US-036).
   *
   * The gap is classified, never patched: a definition gap is closed by
   * changing the tenant's OEE configuration and recomputing, which is what
   * `resolvedByConfigChange` asserts and `calcVersion` evidences.
   */
  upsertValidationEntry(
    tenantId: string,
    item: OeeValidationItem,
    payload: {
      scopeLabel?: string;
      shiftDate?: string;
      mesValue?: number | null;
      factoryValue?: number | null;
      gapClass?: OeeValidationGapClass;
      status?: OeeValidationEntry['status'];
      resolution?: string;
      resolvedByConfigChange?: boolean;
      notes?: string;
    },
    actorId: string
  ): OeeValidationEntry {
    const entry = this.validations.find((v) => v.tenantId === tenantId && v.item === item);
    if (!entry) throw ApiError.notFound(`Item validasi ${item} tidak ditemukan.`);

    if (payload.scopeLabel !== undefined) entry.scopeLabel = payload.scopeLabel;
    if (payload.shiftDate !== undefined) entry.shiftDate = payload.shiftDate;
    if (payload.mesValue !== undefined) entry.mesValue = payload.mesValue;
    if (payload.factoryValue !== undefined) entry.factoryValue = payload.factoryValue;
    if (payload.gapClass !== undefined) entry.gapClass = payload.gapClass;
    if (payload.status !== undefined) entry.status = payload.status;
    if (payload.resolution !== undefined) entry.resolution = payload.resolution;
    if (payload.resolvedByConfigChange !== undefined) {
      entry.resolvedByConfigChange = payload.resolvedByConfigChange;
    }
    if (payload.notes !== undefined) entry.notes = payload.notes;

    entry.gap =
      entry.mesValue !== null && entry.factoryValue !== null
        ? round1(entry.mesValue - entry.factoryValue)
        : null;

    if (entry.status === 'RESOLVED' && entry.gapClass === 'DEFINITION' && !entry.resolvedByConfigChange) {
      throw ApiError.validation(
        'Definition gap harus diselesaikan melalui perubahan konfigurasi + recompute, bukan patch ad-hoc.',
        [
          {
            field: 'resolvedByConfigChange',
            code: 'REQUIRED',
            message: 'Tandai penyelesaian melalui perubahan konfigurasi OEE.',
          },
        ]
      );
    }

    entry.calcVersion = this.getConfig(tenantId).calcVersion;
    entry.recordedBy = actorId;
    entry.updatedAt = new Date().toISOString();
    return entry;
  }

  /** True when every V1-V6 item is resolved, the readiness gate. */
  getValidationGateStatus(tenantId: string): { passed: boolean; open: OeeValidationItem[] } {
    const entries = this.getValidationEntries(tenantId);
    const open = entries.filter((e) => e.status !== 'RESOLVED').map((e) => e.item);
    return { passed: open.length === 0, open };
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round4(value: number): number {
  return Number(value.toFixed(4));
}

function round1(value: number): number {
  return Number(value.toFixed(1));
}
