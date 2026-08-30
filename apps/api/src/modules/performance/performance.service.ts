import {
  OEEDaily,
  OEEComponents,
  WOProgressSnapshot,
  DowntimeCategory,
  RejectCategory,
  DowntimeParetoItem,
  RejectParetoItem,
  DailyPerformancePoint,
  ProductionTrendPoint,
  OeeTrendPoint,
  ExecutiveKpi,
  KpiMetric,
  KpiStatus,
  KpiTarget,
  LinePerformanceRow,
  PlantPerformanceRow,
  ProcessPerformanceRow,
  DowntimeSummary,
  QualitySummary,
  OrderStatusSummary,
  OperationalAlert,
  WorkOrderStatus,
  ProductionOrderStatus,
} from '@factory-vision/domain-types';
import { ProductionService } from '../production/production.service.js';
import { ShopFloorService } from '../shopfloor/shopfloor.service.js';
import { MasterDataService } from '../master-data/master-data.service.js';

export type { DowntimeParetoItem };

/** Default analysis window when a caller does not specify one. */
const DEFAULT_WINDOW_DAYS = 30;

/**
 * One line's aggregated result for one shift date, the single grain every
 * Executive Dashboard endpoint rolls up from, so a KPI card, a trend point and
 * a line row can never disagree with each other.
 */
interface LineDayMetrics {
  shiftDate: string;
  lineId: string;
  plannedSeconds: number;
  downtimeSeconds: number;
  plannedDowntimeSeconds: number;
  unplannedDowntimeSeconds: number;
  runSeconds: number;
  goodQuantity: number;
  rejectQuantity: number;
  targetQuantity: number;
  idealCycleSeconds: number;
  /**
   * Machines that contributed to this line-day. Planned Production Time is the
   * sum across them, so a line's OEE is the roll-up of its machines' rather
   * than a second, disagreeing calculation (US-035).
   */
  machineIds: Set<string>;
  /** Σ (units × the machine's own Ideal Cycle Time), for a weighted rate. */
  idealSecondsAccum: number;
}

export class PerformanceService {
  constructor(
    private productionService: ProductionService,
    private shopFloorService: ShopFloorService,
    private masterDataService: MasterDataService
  ) {}

  calculateOee(
    plannedSeconds: number,
    runSeconds: number,
    goodCount: number,
    rejectCount: number,
    idealCycleSeconds: number
  ): OEEComponents {
    const totalCount = goodCount + rejectCount;

    // Availability = Run Time / Planned Production Time
    const availability = plannedSeconds > 0 ? Math.min(1.0, Math.max(0.0, runSeconds / plannedSeconds)) : 0;

    // Performance = (Ideal Cycle Time * Total Count) / Run Time
    const performance =
      runSeconds > 0 && totalCount > 0
        ? Math.min(1.0, Math.max(0.0, (idealCycleSeconds * totalCount) / runSeconds))
        : 0;

    // Quality = Good Count / Total Count
    const quality = totalCount > 0 ? Math.min(1.0, Math.max(0.0, goodCount / totalCount)) : 1.0;

    // OEE = Availability * Performance * Quality
    const oee = Number((availability * performance * quality).toFixed(4));

    return {
      availability: Number(availability.toFixed(4)),
      performance: Number(performance.toFixed(4)),
      quality: Number(quality.toFixed(4)),
      oee,
    };
  }

  getLiveProductionBoard(tenantId: string) {
    const workOrders = this.productionService.getWorkOrders(tenantId);
    const activeDowntimes = this.shopFloorService.getActiveDowntimes(tenantId);
    const lines = this.masterDataService.getLines(tenantId);
    const products = this.masterDataService.getProducts(tenantId);
    const downtimeRecords = this.shopFloorService.getDowntimeRecords(tenantId);

    // The board reports the current shift, so scope downtime to the latest
    // shift date present in the data rather than the whole history.
    const latestShiftDate = downtimeRecords
      .map((d) => d.shiftDate)
      .sort()
      .pop();

    const downtimeByLine = new Map<string, number>();
    for (const record of downtimeRecords) {
      if (latestShiftDate && record.shiftDate !== latestShiftDate) continue;
      downtimeByLine.set(
        record.lineId,
        (downtimeByLine.get(record.lineId) ?? 0) + (record.durationSeconds ?? 0)
      );
    }

    return workOrders.map((wo) => {
      const achievementPct =
        wo.targetQuantity > 0 ? Math.round((wo.goodQuantity / wo.targetQuantity) * 100) : 0;

      // Planned time, run time and ideal cycle all come from master data and
      // recorded downtime. They used to be hardcoded (8h planned, a flat 7.2h
      // run time and a 12s cycle for every product), which pinned Availability
      // at 90% on every line and computed Performance for the CNC line, a 45s
      // product, against a 12s cycle, understating its OEE roughly fourfold.
      const line = lines.find((l) => l.id === wo.lineId);
      const product = products.find((p) => p.id === wo.productId);

      const plannedTimeSec = (line?.plannedProductionTimeMinutes ?? 480) * 60;
      const downtimeSec = downtimeByLine.get(wo.lineId) ?? 0;
      const runTimeSec = Math.max(0, plannedTimeSec - downtimeSec);
      const idealCycleSec = product?.idealCycleTimeSeconds ?? 12;

      const oeeComp = this.calculateOee(
        plannedTimeSec,
        runTimeSec,
        wo.goodQuantity,
        wo.rejectQuantity,
        idealCycleSec
      );

      const hasActiveDowntime = activeDowntimes.some((d) => d.workOrderId === wo.id || d.lineId === wo.lineId);

      return {
        lineId: wo.lineId,
        workOrder: wo,
        achievementPct,
        hasActiveDowntime,
        oee: Math.round(oeeComp.oee * 100),
        availability: Math.round(oeeComp.availability * 100),
        performance: Math.round(oeeComp.performance * 100),
        quality: Math.round(oeeComp.quality * 100),
      };
    });
  }

  getDowntimePareto(tenantId: string, lineId?: string): DowntimeParetoItem[] {
    const records = this.shopFloorService.getDowntimeRecords(tenantId, lineId);
    const reasons = this.masterDataService.getDowntimeReasons(tenantId);

    const map = new Map<string, { duration: number; count: number; reason: any }>();

    for (const r of records) {
      const reasonObj = reasons.find((rs) => rs.id === r.reasonId) || {
        id: r.reasonId,
        code: 'OTHER',
        name: 'Uncategorized Reason',
        category: DowntimeCategory.MACHINE,
      };

      const duration = r.durationSeconds || 0;
      const current = map.get(r.reasonId) || { duration: 0, count: 0, reason: reasonObj };
      current.duration += duration;
      current.count += 1;
      map.set(r.reasonId, current);
    }

    const totalDowntimeSeconds = Array.from(map.values()).reduce((acc, v) => acc + v.duration, 0) || 1;

    // Sort descending by duration
    const sorted = Array.from(map.entries())
      .map(([reasonId, data]) => ({
        reasonId,
        reasonCode: data.reason.code,
        reasonName: data.reason.name,
        category: data.reason.category,
        totalDurationSeconds: data.duration,
        totalDurationMinutes: Math.round(data.duration / 60),
        occurrenceCount: data.count,
        percentageOfTotal: Number(((data.duration / totalDowntimeSeconds) * 100).toFixed(1)),
        cumulativePercentage: 0,
      }))
      .sort((a, b) => b.totalDurationSeconds - a.totalDurationSeconds);

    let cumulative = 0;
    for (const item of sorted) {
      cumulative += item.percentageOfTotal;
      item.cumulativePercentage = Number(Math.min(100, cumulative).toFixed(1));
    }

    return sorted;
  }

  // =========================================================================
  // EXECUTIVE DASHBOARD
  //
  // Every method below rolls up from `getLineDayMetrics`, so the KPI cards,
  // the trend lines, the plant/line table and the alerts are guaranteed to
  // agree with one another and with the underlying transaction records.
  // =========================================================================

  /**
   * Aggregate production and downtime records into one row per (shift date,
   * line) over the requested window.
   *
   * Two modelling decisions worth knowing:
   *
   * - **Planned production time** counts a line on a day only if that line
   * recorded production or downtime that day. A line that was not scheduled
   * must not drag the plant's Availability down.
   * - **Daily target** is the sum of the target quantities of the work orders
   * assigned to that line. In this model a work order is a one-shift job, so
   * its target is the line's target for the day.
   */
  private getLineDayMetrics(tenantId: string, days: number = DEFAULT_WINDOW_DAYS): LineDayMetrics[] {
    const lines = this.masterDataService.getLines(tenantId);
    const products = this.masterDataService.getProducts(tenantId);
    const workOrders = this.productionService.getWorkOrders(tenantId);
    const productionRecords = this.shopFloorService.getProductionRecords(tenantId);
    const downtimeRecords = this.shopFloorService.getDowntimeRecords(tenantId);

    const lineById = new Map(lines.map((l) => [l.id, l]));

    // Target per line, taken from the work orders scheduled on it.
    const targetByLine = new Map<string, number>();
    for (const wo of workOrders) {
      targetByLine.set(wo.lineId, (targetByLine.get(wo.lineId) ?? 0) + wo.targetQuantity);
    }

    const workOrderLine = new Map(workOrders.map((wo) => [wo.id, wo.lineId]));
    const workOrderById = new Map(workOrders.map((wo) => [wo.id, wo]));

    /**
     * Ideal Cycle Time for one record, resolved for its own Product × Machine
     * pair. Using one product's rate for the whole line, as
     * this used to, makes a mixing record count as if it were a tyre and puts
     * the line's Performance at odds with its machines'.
     */
    const idealCycleFor = (workOrderId: string, machineId: string | undefined): number => {
      const wo = workOrderById.get(workOrderId);
      const resolved = this.masterDataService.resolveIdealCycleSeconds(
        tenantId,
        wo?.productId,
        machineId || wo?.machineId
      );
      if (resolved) return resolved;
      const product = products.find((p) => p.id === wo?.productId);
      return product?.idealCycleTimeSeconds ?? 12;
    };

    // key = `${shiftDate}|${lineId}`
    const buckets = new Map<string, LineDayMetrics>();

    const bucketFor = (shiftDate: string, lineId: string): LineDayMetrics | undefined => {
      const line = lineById.get(lineId);
      if (!line) return undefined;
      const key = `${shiftDate}|${lineId}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          shiftDate,
          lineId,
          plannedSeconds: 0,
          downtimeSeconds: 0,
          plannedDowntimeSeconds: 0,
          unplannedDowntimeSeconds: 0,
          runSeconds: 0,
          goodQuantity: 0,
          rejectQuantity: 0,
          targetQuantity: targetByLine.get(lineId) ?? 0,
          idealCycleSeconds: 0,
          machineIds: new Set<string>(),
          idealSecondsAccum: 0,
        };
        buckets.set(key, bucket);
      }
      return bucket;
    };

    for (const record of productionRecords) {
      const lineId = workOrderLine.get(record.workOrderId);
      if (!lineId) continue;
      const bucket = bucketFor(record.shiftDate, lineId);
      if (!bucket) continue;
      bucket.goodQuantity += record.goodQuantity;
      bucket.rejectQuantity += record.rejectQuantity;
      const machineId = record.machineId || workOrderById.get(record.workOrderId)?.machineId;
      if (machineId) bucket.machineIds.add(machineId);
      bucket.idealSecondsAccum +=
        idealCycleFor(record.workOrderId, machineId) * (record.goodQuantity + record.rejectQuantity);
    }

    for (const record of downtimeRecords) {
      const bucket = bucketFor(record.shiftDate, record.lineId);
      if (!bucket) continue;
      const seconds = record.durationSeconds ?? 0;
      bucket.downtimeSeconds += seconds;
      if (record.isPlanned) bucket.plannedDowntimeSeconds += seconds;
      else bucket.unplannedDowntimeSeconds += seconds;
      if (record.machineId) bucket.machineIds.add(record.machineId);
    }

    const all = Array.from(buckets.values());
    for (const bucket of all) {
      // Planned Production Time is per machine, summed over the machines that
      // actually ran, the same basis the machine-grain engine uses, so a line
      // row and its machine rows reconcile.
      const line = lineById.get(bucket.lineId);
      const perMachineSeconds = (line?.plannedProductionTimeMinutes ?? 480) * 60;
      bucket.plannedSeconds = Math.max(1, bucket.machineIds.size) * perMachineSeconds;

      const units = bucket.goodQuantity + bucket.rejectQuantity;
      bucket.idealCycleSeconds = units > 0 ? bucket.idealSecondsAccum / units : 0;
      bucket.runSeconds = Math.max(0, bucket.plannedSeconds - bucket.downtimeSeconds);
    }

    // Trim to the most recent `days` distinct shift dates.
    const dates = Array.from(new Set(all.map((b) => b.shiftDate))).sort();
    const kept = new Set(dates.slice(-days));

    return all.filter((b) => kept.has(b.shiftDate)).sort((a, b) => a.shiftDate.localeCompare(b.shiftDate));
  }

  /** Roll a set of line-days into one OEE result, weighting by run time. */
  private rollUpOee(rows: LineDayMetrics[]): OEEComponents & { totalCount: number } {
    const plannedSeconds = rows.reduce((acc, r) => acc + r.plannedSeconds, 0);
    const runSeconds = rows.reduce((acc, r) => acc + r.runSeconds, 0);
    const goodCount = rows.reduce((acc, r) => acc + r.goodQuantity, 0);
    const rejectCount = rows.reduce((acc, r) => acc + r.rejectQuantity, 0);
    const totalCount = goodCount + rejectCount;

    // Ideal time is summed per line, because lines run different products.
    const idealSeconds = rows.reduce(
      (acc, r) => acc + r.idealCycleSeconds * (r.goodQuantity + r.rejectQuantity),
      0
    );

    const availability = plannedSeconds > 0 ? Math.min(1, runSeconds / plannedSeconds) : 0;
    const performance = runSeconds > 0 ? Math.min(1, idealSeconds / runSeconds) : 0;
    const quality = totalCount > 0 ? Math.min(1, goodCount / totalCount) : 1;

    return {
      availability: Number(availability.toFixed(4)),
      performance: Number(performance.toFixed(4)),
      quality: Number(quality.toFixed(4)),
      oee: Number((availability * performance * quality).toFixed(4)),
      totalCount,
    };
  }

  private static pct(value: number): number {
    return Number((value * 100).toFixed(1));
  }

  /**
   * Daily performance series, the shared backbone for and
   */
  getDailyPerformance(tenantId: string, days: number = DEFAULT_WINDOW_DAYS): DailyPerformancePoint[] {
    const rows = this.getLineDayMetrics(tenantId, days);
    const byDate = new Map<string, LineDayMetrics[]>();
    for (const row of rows) {
      const list = byDate.get(row.shiftDate) ?? [];
      list.push(row);
      byDate.set(row.shiftDate, list);
    }

    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([shiftDate, dayRows]) => {
        const oee = this.rollUpOee(dayRows);
        const goodQuantity = dayRows.reduce((acc, r) => acc + r.goodQuantity, 0);
        const rejectQuantity = dayRows.reduce((acc, r) => acc + r.rejectQuantity, 0);
        const targetQuantity = dayRows.reduce((acc, r) => acc + r.targetQuantity, 0);
        const total = goodQuantity + rejectQuantity;

        return {
          shiftDate,
          targetQuantity,
          goodQuantity,
          rejectQuantity,
          achievementPct: targetQuantity > 0 ? Math.round((goodQuantity / targetQuantity) * 100) : 0,
          rejectRatePct: total > 0 ? Number(((rejectQuantity / total) * 100).toFixed(2)) : 0,
          plannedMinutes: Math.round(dayRows.reduce((acc, r) => acc + r.plannedSeconds, 0) / 60),
          downtimeMinutes: Math.round(dayRows.reduce((acc, r) => acc + r.downtimeSeconds, 0) / 60),
          plannedDowntimeMinutes: Math.round(
            dayRows.reduce((acc, r) => acc + r.plannedDowntimeSeconds, 0) / 60
          ),
          unplannedDowntimeMinutes: Math.round(
            dayRows.reduce((acc, r) => acc + r.unplannedDowntimeSeconds, 0) / 60
          ),
          availability: PerformanceService.pct(oee.availability),
          performance: PerformanceService.pct(oee.performance),
          quality: PerformanceService.pct(oee.quality),
          oee: PerformanceService.pct(oee.oee),
        };
      });
  }

  /**
   * The eight Executive KPI cards: current value, target, variance,
   * status, and the comparison against the immediately preceding window of the
   * same length.
   */
  getExecutiveKpi(tenantId: string, days: number = 7): ExecutiveKpi[] {
    // Pull two windows so "previous period" is a like-for-like comparison.
    const series = this.getDailyPerformance(tenantId, days * 2);
    const current = series.slice(-days);
    const previous = series.slice(-days * 2, -days);

    const summarise = (window: DailyPerformancePoint[]) => {
      if (window.length === 0) {
        return {
          oee: 0,
          availability: 0,
          performance: 0,
          quality: 0,
          output: 0,
          achievement: 0,
          rejectRate: 0,
          downtime: 0,
        };
      }
      const good = window.reduce((acc, d) => acc + d.goodQuantity, 0);
      const reject = window.reduce((acc, d) => acc + d.rejectQuantity, 0);
      const target = window.reduce((acc, d) => acc + d.targetQuantity, 0);
      const total = good + reject;
      const mean = (pick: (d: DailyPerformancePoint) => number) =>
        Number((window.reduce((acc, d) => acc + pick(d), 0) / window.length).toFixed(1));

      return {
        oee: mean((d) => d.oee),
        availability: mean((d) => d.availability),
        performance: mean((d) => d.performance),
        quality: mean((d) => d.quality),
        output: good,
        achievement: target > 0 ? Number(((good / target) * 100).toFixed(1)) : 0,
        rejectRate: total > 0 ? Number(((reject / total) * 100).toFixed(2)) : 0,
        downtime: Math.round(window.reduce((acc, d) => acc + d.downtimeMinutes, 0) / window.length),
      };
    };

    const now = summarise(current);
    const before = summarise(previous);
    const targets = this.masterDataService.getKpiTargets(tenantId);

    const build = (
      metric: KpiMetric,
      label: string,
      unit: string,
      value: number,
      previousValue: number,
      fallbackDirection: KpiTarget['direction']
    ): ExecutiveKpi => {
      const target = targets.find((t) => t.metric === metric);
      const direction = target?.direction ?? fallbackDirection;

      const deltaVsPrevious = Number((value - previousValue).toFixed(2));
      const deltaPct =
        previousValue !== 0 ? Number(((deltaVsPrevious / Math.abs(previousValue)) * 100).toFixed(1)) : 0;
      const trend = deltaVsPrevious > 0 ? 'UP' : deltaVsPrevious < 0 ? 'DOWN' : 'FLAT';
      const trendIsFavourable =
        deltaVsPrevious === 0
          ? true
          : direction === 'HIGHER_IS_BETTER'
            ? deltaVsPrevious > 0
            : deltaVsPrevious < 0;

      const kpi: ExecutiveKpi = {
        metric,
        label,
        value,
        unit,
        direction,
        previousValue,
        deltaVsPrevious,
        deltaPct,
        trend,
        trendIsFavourable,
      };

      if (target) {
        // Attainment reads the same way for both directions: 100 means "on target".
        const attainment =
          direction === 'HIGHER_IS_BETTER'
            ? target.targetValue > 0
              ? (value / target.targetValue) * 100
              : 0
            : value > 0
              ? (target.targetValue / value) * 100
              : 100;

        kpi.target = target.targetValue;
        kpi.variance = Number((value - target.targetValue).toFixed(2));
        kpi.attainmentPct = Number(attainment.toFixed(1));
        kpi.status =
          attainment <= target.criticalThresholdPct
            ? 'CRITICAL'
            : attainment <= target.watchThresholdPct
              ? 'WATCH'
              : 'GOOD';
      }

      return kpi;
    };

    return [
      build('OEE', 'OEE', '%', now.oee, before.oee, 'HIGHER_IS_BETTER'),
      build('AVAILABILITY', 'Availability', '%', now.availability, before.availability, 'HIGHER_IS_BETTER'),
      build('PERFORMANCE', 'Performance', '%', now.performance, before.performance, 'HIGHER_IS_BETTER'),
      build('QUALITY', 'Quality', '%', now.quality, before.quality, 'HIGHER_IS_BETTER'),
      build('PRODUCTION_OUTPUT', 'Production Output', 'pcs', now.output, before.output, 'HIGHER_IS_BETTER'),
      build(
        'PRODUCTION_ACHIEVEMENT',
        'Production Achievement',
        '%',
        now.achievement,
        before.achievement,
        'HIGHER_IS_BETTER'
      ),
      build('REJECT_RATE', 'Reject Rate', '%', now.rejectRate, before.rejectRate, 'LOWER_IS_BETTER'),
      build('DOWNTIME', 'Downtime', 'min', now.downtime, before.downtime, 'LOWER_IS_BETTER'),
    ];
  }

  /** Target vs Actual over time, with the preceding window overlaid. */
  getProductionTrend(tenantId: string, days: number = 7): ProductionTrendPoint[] {
    const series = this.getDailyPerformance(tenantId, days * 2);
    const current = series.slice(-days);
    const previous = series.slice(-days * 2, -days);

    return current.map((point, index) => ({
      shiftDate: point.shiftDate,
      targetQuantity: point.targetQuantity,
      goodQuantity: point.goodQuantity,
      achievementPct: point.achievementPct,
      previousPeriodGoodQuantity: previous[index]?.goodQuantity ?? null,
    }));
  }

  /** OEE Actual vs Target vs Previous Period. */
  getOeeTrend(tenantId: string, days: number = 7): OeeTrendPoint[] {
    const series = this.getDailyPerformance(tenantId, days * 2);
    const current = series.slice(-days);
    const previous = series.slice(-days * 2, -days);
    const target = this.masterDataService.getKpiTarget(tenantId, 'OEE');

    return current.map((point, index) => ({
      shiftDate: point.shiftDate,
      oee: point.oee,
      availability: point.availability,
      performance: point.performance,
      quality: point.quality,
      targetOee: target?.targetValue ?? null,
      previousPeriodOee: previous[index]?.oee ?? null,
    }));
  }

  /**
   * Classify a line or plant against the OEE and achievement targets
   * ( Good / Watch / Critical).
   */
  private classify(tenantId: string, oeePct: number, achievementPct: number): KpiStatus {
    const oeeTarget = this.masterDataService.getKpiTarget(tenantId, 'OEE')?.targetValue ?? 80;
    const achievementTarget =
      this.masterDataService.getKpiTarget(tenantId, 'PRODUCTION_ACHIEVEMENT')?.targetValue ?? 100;

    const oeeAttainment = oeeTarget > 0 ? (oeePct / oeeTarget) * 100 : 100;
    const achievementAttainment = achievementTarget > 0 ? (achievementPct / achievementTarget) * 100 : 100;
    const worst = Math.min(oeeAttainment, achievementAttainment);

    if (worst <= 85) return 'CRITICAL';
    if (worst <= 95) return 'WATCH';
    return 'GOOD';
  }

  /** Per-line comparison table. */
  getLinePerformance(tenantId: string, days: number = 7): LinePerformanceRow[] {
    const rows = this.getLineDayMetrics(tenantId, days);
    const lines = this.masterDataService.getLines(tenantId);
    const plants = this.masterDataService.getPlants(tenantId);
    const activeDowntimes = this.shopFloorService.getActiveDowntimes(tenantId);

    const byLine = new Map<string, LineDayMetrics[]>();
    for (const row of rows) {
      const list = byLine.get(row.lineId) ?? [];
      list.push(row);
      byLine.set(row.lineId, list);
    }

    return lines
      .filter((line) => line.status === 'ACTIVE')
      .map((line) => {
        const lineRows = byLine.get(line.id) ?? [];
        const oee = this.rollUpOee(lineRows);
        const plant = plants.find((p) => p.id === line.plantId);

        const goodQuantity = lineRows.reduce((acc, r) => acc + r.goodQuantity, 0);
        const rejectQuantity = lineRows.reduce((acc, r) => acc + r.rejectQuantity, 0);
        const targetQuantity = lineRows.reduce((acc, r) => acc + r.targetQuantity, 0);
        const total = goodQuantity + rejectQuantity;
        const achievementPct = targetQuantity > 0 ? Math.round((goodQuantity / targetQuantity) * 100) : 0;
        const oeePct = PerformanceService.pct(oee.oee);

        return {
          lineId: line.id,
          lineName: line.name,
          plantId: line.plantId,
          plantName: plant?.name ?? line.plantId,
          oee: oeePct,
          availability: PerformanceService.pct(oee.availability),
          performance: PerformanceService.pct(oee.performance),
          quality: PerformanceService.pct(oee.quality),
          goodQuantity,
          targetQuantity,
          achievementPct,
          downtimeMinutes: Math.round(lineRows.reduce((acc, r) => acc + r.downtimeSeconds, 0) / 60),
          rejectQuantity,
          rejectRatePct: total > 0 ? Number(((rejectQuantity / total) * 100).toFixed(2)) : 0,
          hasActiveDowntime: activeDowntimes.some((d) => d.lineId === line.id),
          status: this.classify(tenantId, oeePct, achievementPct),
        };
      })
      .sort((a, b) => a.oee - b.oee);
  }

  /** Plant rollup of `getLinePerformance` ( "production by plant"). */
  getPlantPerformance(tenantId: string, days: number = 7): PlantPerformanceRow[] {
    const lineRows = this.getLinePerformance(tenantId, days);
    const byPlant = new Map<string, LinePerformanceRow[]>();
    for (const row of lineRows) {
      const list = byPlant.get(row.plantId) ?? [];
      list.push(row);
      byPlant.set(row.plantId, list);
    }

    return Array.from(byPlant.entries())
      .map(([plantId, rows]) => {
        const goodQuantity = rows.reduce((acc, r) => acc + r.goodQuantity, 0);
        const rejectQuantity = rows.reduce((acc, r) => acc + r.rejectQuantity, 0);
        const targetQuantity = rows.reduce((acc, r) => acc + r.targetQuantity, 0);
        const total = goodQuantity + rejectQuantity;
        const achievementPct = targetQuantity > 0 ? Math.round((goodQuantity / targetQuantity) * 100) : 0;
        // Output-weighted OEE, so a busy line counts for more than an idle one.
        const weightBase = rows.reduce((acc, r) => acc + r.goodQuantity, 0) || rows.length;
        const oee = Number(
          (
            rows.reduce((acc, r) => acc + r.oee * (r.goodQuantity || 1), 0) /
            (rows.reduce((acc, r) => acc + (r.goodQuantity || 1), 0) || weightBase)
          ).toFixed(1)
        );

        return {
          plantId,
          plantName: rows[0]?.plantName ?? plantId,
          lineCount: rows.length,
          oee,
          goodQuantity,
          targetQuantity,
          achievementPct,
          downtimeMinutes: rows.reduce((acc, r) => acc + r.downtimeMinutes, 0),
          rejectQuantity,
          rejectRatePct: total > 0 ? Number(((rejectQuantity / total) * 100).toFixed(2)) : 0,
          status: this.classify(tenantId, oee, achievementPct),
        };
      })
      .sort((a, b) => a.oee - b.oee);
  }

  /** Multi-process performance breakdown. */
  getProcessPerformance(tenantId: string, days: number = 7): ProcessPerformanceRow[] {
    const processes = this.masterDataService.getProcesses(tenantId);
    const workOrders = this.productionService.getWorkOrders(tenantId);
    const woProcessMap = new Map(workOrders.map((wo) => [wo.id, wo.processId]));

    const allProd = this.shopFloorService.getProductionRecords(tenantId);
    const allDt = this.shopFloorService.getDowntimeRecords(tenantId);
    const allDates = Array.from(
      new Set([...allProd.map((r) => r.shiftDate), ...allDt.map((r) => r.shiftDate)])
    ).sort();
    const keptDates = new Set(allDates.slice(-days));

    const prodRecords = allProd.filter((r) => keptDates.has(r.shiftDate));
    const dtRecords = allDt.filter((r) => keptDates.has(r.shiftDate));

    return processes
      .map((proc) => {
        const pProd = prodRecords.filter(
          (r) => r.processId === proc.id || (!r.processId && woProcessMap.get(r.workOrderId) === proc.id)
        );
        const pDt = dtRecords.filter(
          (r) => r.processId === proc.id || (!r.processId && woProcessMap.get(r.workOrderId || '') === proc.id)
        );

        const goodQuantity = pProd.reduce((acc, r) => acc + r.goodQuantity, 0);
        const rejectQuantity = pProd.reduce((acc, r) => acc + r.rejectQuantity, 0);

        const procWos = workOrders.filter((w) => w.processId === proc.id);
        const targetQuantity =
          procWos.reduce((acc, w) => acc + w.targetQuantity, 0) ||
          (goodQuantity > 0 ? Math.round(goodQuantity * 1.08) : 1000);
        const achievementPct = targetQuantity > 0 ? Math.round((goodQuantity / targetQuantity) * 100) : 0;

        const downtimeSeconds = pDt.reduce((acc, r) => acc + (r.durationSeconds || 0), 0);
        const downtimeMinutes = Math.round(downtimeSeconds / 60);

        const uniqueDates = new Set([...pProd.map((r) => r.shiftDate), ...pDt.map((r) => r.shiftDate)]);
        const daysCount = Math.max(1, uniqueDates.size);
        const plannedSeconds = daysCount * 480 * 60;
        const runSeconds = Math.max(0, plannedSeconds - downtimeSeconds);

        const idealCycleSec =
          proc.code === 'MIX'
            ? 90
            : proc.code === 'EXT'
              ? 45
              : proc.code === 'TBM'
                ? 150
                : proc.code === 'CPR'
                  ? 750
                  : 30;

        const oeeComp = this.calculateOee(
          plannedSeconds,
          runSeconds,
          goodQuantity,
          rejectQuantity,
          idealCycleSec
        );
        const oeePct = PerformanceService.pct(oeeComp.oee);

        return {
          processId: proc.id,
          processCode: proc.code,
          processName: proc.name,
          sequenceDefault: proc.sequenceDefault,
          oee: oeePct,
          availability: PerformanceService.pct(oeeComp.availability),
          performance: PerformanceService.pct(oeeComp.performance),
          quality: PerformanceService.pct(oeeComp.quality),
          goodQuantity,
          rejectQuantity,
          targetQuantity,
          achievementPct,
          downtimeMinutes,
          status: this.classify(tenantId, oeePct, achievementPct),
        };
      })
      .sort((a, b) => a.sequenceDefault - b.sequenceDefault);
  }

  /** Defect Pareto, the quality counterpart of `getDowntimePareto`. */
  getRejectPareto(tenantId: string, lineId?: string): RejectParetoItem[] {
    const reasons = this.masterDataService.getRejectReasons(tenantId);
    const workOrders = this.productionService.getWorkOrders(tenantId);
    const workOrderLine = new Map(workOrders.map((wo) => [wo.id, wo.lineId]));

    const records = this.shopFloorService
      .getProductionRecords(tenantId)
      .filter((r) => r.rejectQuantity > 0)
      .filter((r) => !lineId || workOrderLine.get(r.workOrderId) === lineId);

    const map = new Map<string, { quantity: number; count: number }>();
    for (const record of records) {
      const key = record.rejectReasonId ?? 'UNCATEGORISED';
      const current = map.get(key) ?? { quantity: 0, count: 0 };
      current.quantity += record.rejectQuantity;
      current.count += 1;
      map.set(key, current);
    }

    const totalRejects = Array.from(map.values()).reduce((acc, v) => acc + v.quantity, 0) || 1;

    const sorted: RejectParetoItem[] = Array.from(map.entries())
      .map(([reasonId, data]) => {
        const reason = reasons.find((r) => r.id === reasonId);
        return {
          reasonId,
          reasonCode: reason?.code ?? 'UNCAT',
          reasonName: reason?.name ?? 'Uncategorised Defect',
          category: reason?.category ?? RejectCategory.OTHER,
          totalRejectQuantity: data.quantity,
          occurrenceCount: data.count,
          percentageOfTotal: Number(((data.quantity / totalRejects) * 100).toFixed(1)),
          cumulativePercentage: 0,
        };
      })
      .sort((a, b) => b.totalRejectQuantity - a.totalRejectQuantity);

    let cumulative = 0;
    for (const item of sorted) {
      cumulative += item.percentageOfTotal;
      item.cumulativePercentage = Number(Math.min(100, cumulative).toFixed(1));
    }

    return sorted;
  }

  /** Loss overview above the downtime Pareto. */
  getDowntimeSummary(tenantId: string, days: number = 7): DowntimeSummary {
    const rows = this.getLineDayMetrics(tenantId, days);
    const dates = new Set(rows.map((r) => r.shiftDate));
    const lines = this.masterDataService.getLines(tenantId);
    const machines = this.masterDataService.getMachines(tenantId);

    const records = this.shopFloorService.getDowntimeRecords(tenantId).filter((r) => dates.has(r.shiftDate));

    const totalSeconds = records.reduce((acc, r) => acc + (r.durationSeconds ?? 0), 0);
    const plannedSeconds = records
      .filter((r) => r.isPlanned)
      .reduce((acc, r) => acc + (r.durationSeconds ?? 0), 0);
    const plannedProductionSeconds = rows.reduce((acc, r) => acc + r.plannedSeconds, 0);

    const groupBy = <T>(
      keyOf: (r: (typeof records)[number]) => string | undefined,
      nameOf: (key: string) => string,
      shape: (key: string, name: string, minutes: number, count: number) => T
    ): T[] => {
      const map = new Map<string, { seconds: number; count: number }>();
      for (const record of records) {
        const key = keyOf(record);
        if (!key) continue;
        const current = map.get(key) ?? { seconds: 0, count: 0 };
        current.seconds += record.durationSeconds ?? 0;
        current.count += 1;
        map.set(key, current);
      }
      return Array.from(map.entries())
        .map(([key, v]) => shape(key, nameOf(key), Math.round(v.seconds / 60), v.count))
        .sort((a: any, b: any) => b.downtimeMinutes - a.downtimeMinutes);
    };

    return {
      totalDowntimeMinutes: Math.round(totalSeconds / 60),
      plannedDowntimeMinutes: Math.round(plannedSeconds / 60),
      unplannedDowntimeMinutes: Math.round((totalSeconds - plannedSeconds) / 60),
      plannedProductionMinutes: Math.round(plannedProductionSeconds / 60),
      downtimeRatePct:
        plannedProductionSeconds > 0 ? Number(((totalSeconds / plannedProductionSeconds) * 100).toFixed(1)) : 0,
      occurrenceCount: records.length,
      averageDurationMinutes: records.length > 0 ? Math.round(totalSeconds / records.length / 60) : 0,
      pareto: this.getDowntimePareto(tenantId),
      byLine: groupBy(
        (r) => r.lineId,
        (key) => lines.find((l) => l.id === key)?.name ?? key,
        (lineId, lineName, downtimeMinutes, occurrenceCount) => ({
          lineId,
          lineName,
          downtimeMinutes,
          occurrenceCount,
        })
      ),
      topMachines: groupBy(
        (r) => r.machineId,
        (key) => machines.find((m) => m.id === key)?.name ?? key,
        (machineId, machineName, downtimeMinutes, occurrenceCount) => ({
          machineId,
          machineName,
          downtimeMinutes,
          occurrenceCount,
        })
      ).slice(0, 5),
    };
  }

  /** Quality overview above the defect Pareto. */
  getQualitySummary(tenantId: string, days: number = 7): QualitySummary {
    const rows = this.getLineDayMetrics(tenantId, days);
    const lines = this.masterDataService.getLines(tenantId);
    const qualityTarget = this.masterDataService.getKpiTarget(tenantId, 'QUALITY');

    const goodQuantity = rows.reduce((acc, r) => acc + r.goodQuantity, 0);
    const rejectQuantity = rows.reduce((acc, r) => acc + r.rejectQuantity, 0);
    const totalQuantity = goodQuantity + rejectQuantity;
    const qualityPct = totalQuantity > 0 ? Number(((goodQuantity / totalQuantity) * 100).toFixed(2)) : 100;

    const byLineMap = new Map<string, { good: number; reject: number }>();
    for (const row of rows) {
      const current = byLineMap.get(row.lineId) ?? { good: 0, reject: 0 };
      current.good += row.goodQuantity;
      current.reject += row.rejectQuantity;
      byLineMap.set(row.lineId, current);
    }

    return {
      goodQuantity,
      rejectQuantity,
      totalQuantity,
      rejectRatePct: totalQuantity > 0 ? Number(((rejectQuantity / totalQuantity) * 100).toFixed(2)) : 0,
      qualityPct,
      qualityTargetPct: qualityTarget?.targetValue ?? null,
      qualityVariancePct: qualityTarget ? Number((qualityPct - qualityTarget.targetValue).toFixed(2)) : null,
      pareto: this.getRejectPareto(tenantId),
      byLine: Array.from(byLineMap.entries())
        .map(([lineId, v]) => {
          const total = v.good + v.reject;
          return {
            lineId,
            lineName: lines.find((l) => l.id === lineId)?.name ?? lineId,
            rejectQuantity: v.reject,
            rejectRatePct: total > 0 ? Number(((v.reject / total) * 100).toFixed(2)) : 0,
          };
        })
        .sort((a, b) => b.rejectRatePct - a.rejectRatePct),
    };
  }

  /**
   * Schedule health.
   *
   * Classification, from the order's due date and the progress of its work
   * orders:
   * OVERDUE, past due and not complete
   * DELAYED, due today or tomorrow and materially behind
   * AT_RISK, due within three days and behind the pace needed to finish
   */
  getOrderStatusSummary(tenantId: string, asOf: string = new Date().toISOString()): OrderStatusSummary {
    const orders = this.productionService.getProductionOrders(tenantId);
    const workOrders = this.productionService.getWorkOrders(tenantId);
    const asOfMs = Date.parse(asOf);

    const summary: OrderStatusSummary = {
      planned: 0,
      running: 0,
      completed: 0,
      atRisk: 0,
      delayed: 0,
      overdue: 0,
      total: orders.length,
      attentionOrders: [],
    };

    for (const order of orders) {
      const orderWos = workOrders.filter((wo) => wo.productionOrderId === order.id);
      const target = orderWos.reduce((acc, wo) => acc + wo.targetQuantity, 0) || order.quantity;
      const good = orderWos.reduce((acc, wo) => acc + wo.goodQuantity, 0);
      const achievementPct = target > 0 ? Math.round((good / target) * 100) : 0;

      const isComplete =
        order.status === ProductionOrderStatus.COMPLETED ||
        (orderWos.length > 0 && orderWos.every((wo) => wo.status === WorkOrderStatus.COMPLETED));
      const isRunning = orderWos.some((wo) => wo.status === WorkOrderStatus.IN_PROGRESS);

      if (isComplete) summary.completed += 1;
      else if (isRunning) summary.running += 1;
      else summary.planned += 1;

      if (isComplete) continue;

      const daysToDue = Math.floor((Date.parse(order.dueDate) - asOfMs) / 86_400_000);
      let classification: 'AT_RISK' | 'DELAYED' | 'OVERDUE' | null = null;

      if (daysToDue < 0) {
        classification = 'OVERDUE';
        summary.overdue += 1;
      } else if (daysToDue <= 1 && achievementPct < 90) {
        classification = 'DELAYED';
        summary.delayed += 1;
      } else if (daysToDue <= 3 && achievementPct < 60) {
        classification = 'AT_RISK';
        summary.atRisk += 1;
      }

      if (classification) {
        summary.attentionOrders.push({
          id: order.id,
          orderNumber: order.orderNumber,
          dueDate: order.dueDate,
          status: order.status,
          achievementPct,
          daysToDue,
          classification,
        });
      }
    }

    summary.attentionOrders.sort((a, b) => a.daysToDue - b.daysToDue);
    return summary;
  }

  /**
   * The exception layer. Rules are evaluated against the same
   * aggregates the cards use, and each alert carries the console route that
   * answers it, per the drill-down principle.
   */
  getOperationalAlerts(tenantId: string, days: number = 7): OperationalAlert[] {
    const alerts: OperationalAlert[] = [];
    const raisedAt = new Date().toISOString();

    const oeeTarget = this.masterDataService.getKpiTarget(tenantId, 'OEE');
    const rejectTarget = this.masterDataService.getKpiTarget(tenantId, 'REJECT_RATE');
    const downtimeTarget = this.masterDataService.getKpiTarget(tenantId, 'DOWNTIME');

    // --- Line-level rules ---
    for (const line of this.getLinePerformance(tenantId, days)) {
      if (oeeTarget && line.oee < oeeTarget.targetValue) {
        const attainment = (line.oee / oeeTarget.targetValue) * 100;
        alerts.push({
          id: `alert-oee-${line.lineId}`,
          severity: attainment <= oeeTarget.criticalThresholdPct ? 'CRITICAL' : 'WARNING',
          rule: 'LINE_OEE_BELOW_TARGET',
          title: `${line.lineName} OEE below target`,
          detail: `OEE ${line.oee}% against a ${oeeTarget.targetValue}% target over the last ${days} days.`,
          drillDownPath: `/live-board?lineId=${line.lineId}`,
          entityType: 'LINE',
          entityId: line.lineId,
          observedValue: line.oee,
          thresholdValue: oeeTarget.targetValue,
          raisedAt,
        });
      }

      if (rejectTarget && line.rejectRatePct > rejectTarget.targetValue) {
        alerts.push({
          id: `alert-reject-${line.lineId}`,
          severity: line.rejectRatePct > rejectTarget.targetValue * 2 ? 'CRITICAL' : 'WARNING',
          rule: 'LINE_REJECT_RATE_ABOVE_THRESHOLD',
          title: `${line.lineName} reject rate above threshold`,
          detail: `Reject rate ${line.rejectRatePct}% against a ${rejectTarget.targetValue}% ceiling.`,
          drillDownPath: `/reports?tab=production&lineId=${line.lineId}`,
          entityType: 'LINE',
          entityId: line.lineId,
          observedValue: line.rejectRatePct,
          thresholdValue: rejectTarget.targetValue,
          raisedAt,
        });
      }

      if (line.hasActiveDowntime) {
        alerts.push({
          id: `alert-active-downtime-${line.lineId}`,
          severity: 'CRITICAL',
          rule: 'LINE_DOWNTIME_ACTIVE',
          title: `${line.lineName} is stopped`,
          detail: 'An unresolved downtime event is open on this line right now.',
          drillDownPath: `/downtime-analytics?lineId=${line.lineId}`,
          entityType: 'LINE',
          entityId: line.lineId,
          observedValue: 1,
          thresholdValue: 0,
          raisedAt,
        });
      }
    }

    // --- Machine rule: repeated breakdown ---
    const downtimeSummary = this.getDowntimeSummary(tenantId, days);
    for (const machine of downtimeSummary.topMachines) {
      if (machine.occurrenceCount >= 8) {
        alerts.push({
          id: `alert-repeat-breakdown-${machine.machineId}`,
          severity: 'WARNING',
          rule: 'MACHINE_REPEATED_BREAKDOWN',
          title: `${machine.machineName} stopped repeatedly`,
          detail: `${machine.occurrenceCount} downtime events totalling ${machine.downtimeMinutes} minutes in the last ${days} days.`,
          drillDownPath: `/downtime-analytics?machineId=${machine.machineId}`,
          entityType: 'MACHINE',
          entityId: machine.machineId,
          observedValue: machine.occurrenceCount,
          thresholdValue: 8,
          raisedAt,
        });
      }
    }

    // --- Plant rule: OEE dropped versus the previous period ---
    const kpis = this.getExecutiveKpi(tenantId, days);
    const oeeKpi = kpis.find((k) => k.metric === 'OEE');
    if (oeeKpi && oeeKpi.trend === 'DOWN' && Math.abs(oeeKpi.deltaPct) >= 5) {
      alerts.push({
        id: 'alert-oee-drop',
        severity: Math.abs(oeeKpi.deltaPct) >= 10 ? 'CRITICAL' : 'WARNING',
        rule: 'OEE_DROP_VS_PREVIOUS_PERIOD',
        title: 'OEE dropped versus the previous period',
        detail: `OEE fell ${Math.abs(oeeKpi.deltaVsPrevious).toFixed(1)} points (${oeeKpi.deltaPct}%) against the preceding ${days} days.`,
        drillDownPath: '/downtime-analytics',
        entityType: 'TENANT',
        entityId: tenantId,
        observedValue: oeeKpi.value,
        thresholdValue: oeeKpi.previousValue,
        raisedAt,
      });
    }

    // --- Downtime budget rule ---
    const downtimeKpi = kpis.find((k) => k.metric === 'DOWNTIME');
    if (downtimeTarget && downtimeKpi && downtimeKpi.value > downtimeTarget.targetValue) {
      alerts.push({
        id: 'alert-downtime-budget',
        severity: 'WARNING',
        rule: 'DOWNTIME_ABOVE_BUDGET',
        title: 'Daily downtime above budget',
        detail: `Averaging ${downtimeKpi.value} minutes per day against a ${downtimeTarget.targetValue} minute budget.`,
        drillDownPath: '/downtime-analytics',
        entityType: 'TENANT',
        entityId: tenantId,
        observedValue: downtimeKpi.value,
        thresholdValue: downtimeTarget.targetValue,
        raisedAt,
      });
    }

    // --- Schedule rules ---
    const orders = this.getOrderStatusSummary(tenantId);
    for (const order of orders.attentionOrders) {
      alerts.push({
        id: `alert-order-${order.id}`,
        severity: order.classification === 'OVERDUE' ? 'CRITICAL' : 'WARNING',
        rule: `PRODUCTION_ORDER_${order.classification}`,
        title: `${order.orderNumber} is ${order.classification.toLowerCase().replace('_', ' ')}`,
        detail:
          order.daysToDue < 0
            ? `Due ${Math.abs(order.daysToDue)} day(s) ago at ${order.achievementPct}% complete.`
            : `Due in ${order.daysToDue} day(s) at ${order.achievementPct}% complete.`,
        drillDownPath: `/work-orders?tab=PO&orderId=${order.id}`,
        entityType: 'PRODUCTION_ORDER',
        entityId: order.id,
        observedValue: order.achievementPct,
        thresholdValue: 100,
        raisedAt,
      });
    }

    const severityRank: Record<OperationalAlert['severity'], number> = {
      CRITICAL: 0,
      WARNING: 1,
      INFORMATIONAL: 2,
    };
    return alerts.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
  }
}
