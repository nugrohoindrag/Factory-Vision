import { ProductionRecord, DowntimeRecord, DowntimeStatus, RecordSource } from '@factory-vision/domain-types';

/**
 * Deterministic shop-floor history generator.
 *
 * require trend and previous-period comparison, which
 * cannot be answered from a single day of records. Rather than have the
 * dashboard fabricate a trend line in the browser, the API seeds a realistic
 * back-catalogue of production and downtime records and every trend endpoint
 * aggregates from it, so the numbers on screen always reconcile with the
 * transaction data behind them.
 *
 * The generator is seeded per (date, line), so a restart reproduces the exact
 * same history: charts do not reshuffle between reloads, and a value quoted in
 * a screenshot still matches after a redeploy.
 *
 * This is demo/pilot data. Replace this module with a real query once the
 * production database is wired in (`pg` is already a declared dependency).
 */

/** mulberry32, small, fast, and stable across Node versions. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Pick a value in [min, max) from a generator. */
function between(rand: () => number, min: number, max: number): number {
  return min + rand() * (max - min);
}

function addDays(isoDate: string, delta: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/**
 * How well a line runs.
 *
 * The demo dataset has to contain a good, an average and an under-performer, or
 * the Good / Watch / Critical statuses on the dashboard never all appear and
 * the drill-down has nothing to find. Rather than hand-write outliers, each
 * line carries a profile and the generator shapes downtime, speed loss and
 * reject rate from it.
 */
export type PerformanceProfile = 'GOOD' | 'AVERAGE' | 'POOR';

interface ProfileShape {
  /** Inclusive-exclusive range of downtime events per shift. */
  events: [number, number];
  /** Multiplier applied to each event's duration. */
  downtimeScale: number;
  /** Speed-loss factor range: output as a fraction of theoretical capacity. */
  performance: [number, number];
  /** Reject rate range. */
  reject: [number, number];
}

const PROFILES: Record<PerformanceProfile, ProfileShape> = {
  GOOD: { events: [1, 3], downtimeScale: 0.85, performance: [0.88, 0.95], reject: [0.004, 0.014] },
  AVERAGE: { events: [1, 4], downtimeScale: 1.0, performance: [0.84, 0.93], reject: [0.012, 0.028] },
  POOR: { events: [2, 5], downtimeScale: 1.35, performance: [0.74, 0.86], reject: [0.026, 0.052] },
};

export interface HistoryLineSpec {
  lineId: string;
  processId?: string;
  batchId?: string;
  /** Optional: line-03 in the pilot seed has no machine assigned. */
  machineId?: string;
  workOrderId: string;
  operatorId: string;
  /** Shapes downtime, speed loss and reject rate. */
  profile?: PerformanceProfile;
  /** Units the line is scheduled to produce in one shift. */
  dailyTarget: number;
  /**
   * Ideal cycle time of the product on this line. Output is bounded by
   * run time / ideal cycle, so Performance stays below 100% the way it does on
   * a real line, a plan that exceeds physical capacity shows up as missed
   * achievement, not as a Performance figure pinned at 1.0.
   */
  idealCycleSeconds: number;
}

export interface HistorySeedInput {
  tenantId: string;
  /** Most recent day already covered by the hand-written seed; history stops the day before. */
  anchorDate: string;
  /** How many days of history to generate, ending the day before `anchorDate`. */
  days: number;
  shiftId: string;
  /** Minutes of planned production time per line per day ( Availability). */
  plannedProductionMinutes: number;
  lines: HistoryLineSpec[];
  /** Downtime reason ids to draw from, weighted by position (first is most frequent). */
  downtimeReasonIds: string[];
  /** Reject reason ids to draw from, weighted by position (first is most frequent). */
  rejectReasonIds: string[];
}

export interface GeneratedHistory {
  production: ProductionRecord[];
  downtime: DowntimeRecord[];
}

/**
 * Draw an index with a falling weight, so the Pareto endpoints get a genuine
 * "vital few" shape instead of a flat distribution.
 */
function weightedIndex(rand: () => number, length: number): number {
  const roll = rand();
  // Weights approximate 40% / 25% / 18% / 12% / rest.
  const cutoffs = [0.4, 0.65, 0.83, 0.95];
  for (let i = 0; i < Math.min(length - 1, cutoffs.length); i += 1) {
    if (roll < cutoffs[i]) return i;
  }
  return length - 1;
}

export function generateHistory(input: HistorySeedInput): GeneratedHistory {
  const production: ProductionRecord[] = [];
  const downtime: DowntimeRecord[] = [];

  const plannedSeconds = input.plannedProductionMinutes * 60;

  for (let back = input.days; back >= 1; back -= 1) {
    const shiftDate = addDays(input.anchorDate, -back);
    const weekday = new Date(`${shiftDate}T00:00:00.000Z`).getUTCDay();
    // Sunday is a non-production day for the pilot factory.
    if (weekday === 0) continue;

    for (const line of input.lines) {
      const rand = mulberry32(hashSeed(`${shiftDate}:${line.lineId}:${line.processId || ''}`));
      const profile = PROFILES[line.profile ?? 'AVERAGE'];

      // --- Downtime first: it determines run time, hence availability. ---
      const eventCount = Math.floor(between(rand, profile.events[0], profile.events[1]));
      let dayDowntimeSeconds = 0;

      for (let e = 0; e < eventCount; e += 1) {
        const reasonId = input.downtimeReasonIds[weightedIndex(rand, input.downtimeReasonIds.length)];
        // Setup/changeover is the planned category in the pilot taxonomy.
        const isPlanned = reasonId.includes('setup') || reasonId.includes('cleaning');
        const durationSeconds = Math.round(
          between(rand, isPlanned ? 600 : 480, isPlanned ? 2100 : 3000) * profile.downtimeScale
        );
        const startOffsetSeconds = Math.round(between(rand, 900, plannedSeconds - durationSeconds - 900));

        const startMs = Date.parse(`${shiftDate}T07:00:00.000Z`) + startOffsetSeconds * 1000;
        const endMs = startMs + durationSeconds * 1000;

        dayDowntimeSeconds += durationSeconds;

        downtime.push({
          id: `dt-hist-${shiftDate}-${line.lineId}-${e + 1}`,
          tenantId: input.tenantId,
          workOrderId: line.workOrderId,
          processId: line.processId,
          machineId: line.machineId ?? '',
          lineId: line.lineId,
          shiftId: input.shiftId,
          shiftDate,
          reasonId,
          startTime: new Date(startMs).toISOString(),
          endTime: new Date(endMs).toISOString(),
          durationSeconds,
          isPlanned,
          notes: 'Catatan downtime historis',
          clientEventId: `evt-dt-hist-${shiftDate}-${line.lineId}-${e + 1}`,
          status: DowntimeStatus.RESOLVED,
        });
      }

      // --- Output: bounded by what the run time can physically produce. ---
      const runSeconds = Math.max(1, plannedSeconds - dayDowntimeSeconds);
      const capacity = runSeconds / line.idealCycleSeconds;
      // Speed loss and minor stops keep a real line below its ideal rate.
      const performanceFactor = between(rand, profile.performance[0], profile.performance[1]);
      const totalCount = Math.max(
        1,
        Math.round(Math.min(capacity * performanceFactor, line.dailyTarget * 1.02))
      );

      const rejectRate = between(rand, profile.reject[0], profile.reject[1]);
      const rejectQuantity = Math.round(totalCount * rejectRate);
      const goodQuantity = Math.max(0, totalCount - rejectQuantity);

      production.push({
        id: `pr-hist-${shiftDate}-${line.lineId}-${line.processId || 'main'}`,
        tenantId: input.tenantId,
        workOrderId: line.workOrderId,
        processId: line.processId,
        batchId: line.batchId,
        machineId: line.machineId ?? '',
        operatorId: line.operatorId,
        shiftId: input.shiftId,
        shiftDate,
        goodQuantity,
        rejectQuantity,
        rejectReasonId:
          rejectQuantity > 0
            ? input.rejectReasonIds[weightedIndex(rand, input.rejectReasonIds.length)]
            : undefined,
        recordedAt: `${shiftDate}T15:00:00.000Z`,
        source: RecordSource.OPERATOR_MANUAL,
        clientEventId: `evt-pr-hist-${shiftDate}-${line.lineId}-${line.processId || 'main'}`,
        notes: 'Total output shift historis',
      });
    }
  }

  return { production, downtime };
}
