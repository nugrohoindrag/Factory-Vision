import React from 'react';
import { Icon } from '@factory-vision/ui';
import { MetricCard, Section, Item, type Tone } from '@factory-vision/ui/fv';
import type { ExecutiveKpi, DailyPerformancePoint, KpiMetric } from '@factory-vision/api-client';

export interface ExecutiveKpiGridProps {
  kpis: ExecutiveKpi[];
  /** Daily series the sparklines are drawn from, real history, never synthetic. */
  daily: DailyPerformancePoint[];
  isLoading?: boolean;
}

const ICONS: Record<KpiMetric, string> = {
  OEE: 'speed',
  AVAILABILITY: 'schedule',
  PERFORMANCE: 'bolt',
  QUALITY: 'verified',
  PRODUCTION_OUTPUT: 'inventory_2',
  PRODUCTION_ACHIEVEMENT: 'target',
  REJECT_RATE: 'cancel',
  DOWNTIME: 'timer_off',
};

/** Which daily field backs each KPI's sparkline. */
const SPARK_SOURCE: Record<KpiMetric, (d: DailyPerformancePoint) => number> = {
  OEE: (d) => d.oee,
  AVAILABILITY: (d) => d.availability,
  PERFORMANCE: (d) => d.performance,
  QUALITY: (d) => d.quality,
  PRODUCTION_OUTPUT: (d) => d.goodQuantity,
  PRODUCTION_ACHIEVEMENT: (d) => d.achievementPct,
  REJECT_RATE: (d) => d.rejectRatePct,
  DOWNTIME: (d) => d.downtimeMinutes,
};

const STATUS_TONE = { GOOD: 'success', WATCH: 'warning', CRITICAL: 'error' } as const;

function formatValue(kpi: ExecutiveKpi): string {
  if (kpi.unit === 'pcs') return `${Math.round(kpi.value).toLocaleString('en-US')} pcs`;
  if (kpi.unit === 'min') return `${Math.round(kpi.value).toLocaleString('en-US')} min`;
  return `${kpi.value}%`;
}

/**
 * Executive KPI, the eight cards management reads first.
 *
 * Every card carries value, target, variance and status from the API. Nothing
 * here is derived in the browser: a card with no configured target simply
 * renders without one rather than inventing a benchmark.
 */
export const ExecutiveKpiGrid: React.FC<ExecutiveKpiGridProps> = ({ kpis, daily, isLoading }) => {
  if (isLoading) {
    return (
      <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>Memuat KPI eksekutif…</div>
    );
  }

  return (
    <>
      {/*
 Fixed 4-up so the eight KPI always read as two even rows, rather than
 reflowing to 5 or 6 across on a wide monitor. `minmax(0, …)` keeps a long
 value from pushing the track wider than its share. Below desktop the grid
 steps down to 2-up and then 1-up, so the page never scrolls sideways.
 */}
      <style>{`.fv-kpi-grid { display: grid; gap: 10px; grid-template-columns: repeat(4, minmax(0, 1fr)); }
 @media (max-width: 1180px) {.fv-kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
 @media (max-width: 560px) {.fv-kpi-grid { grid-template-columns: minmax(0, 1fr); } }
 `}</style>
      <Section stagger className="fv-kpi-grid">
        {kpis.map((kpi) => {
          // Tone follows status where a target exists, so a card that is off
          // target reads as off target without needing to be decoded.
          const tone: Tone = kpi.status ? STATUS_TONE[kpi.status] : 'primary';

          const spark = daily.map(SPARK_SOURCE[kpi.metric]);

          // A favourable move is always green, whichever direction it went,
          // reject rate falling is good news, and must not render as "negative".
          const deltaType = kpi.trend === 'FLAT' ? 'neutral' : kpi.trendIsFavourable ? 'positive' : 'negative';

          const deltaMagnitude =
            kpi.unit === 'pcs'
              ? Math.abs(kpi.deltaVsPrevious).toLocaleString('en-US')
              : Math.abs(kpi.deltaVsPrevious).toFixed(kpi.unit === 'min' ? 0 : 1);

          return (
            <Item key={kpi.metric} style={{ height: '100%' }}>
              <MetricCard
                label={kpi.label}
                value={formatValue(kpi)}
                tone={tone}
                statusBadge={kpi.status ? kpi.status : undefined}
                delta={`${deltaMagnitude} vs periode lalu`}
                deltaType={deltaType}
                subValue={
                  kpi.target !== undefined
                    ? `Target ${kpi.target}${kpi.unit === 'pcs' ? '' : kpi.unit === 'min' ? ' min' : '%'} · ${
                        kpi.variance !== undefined && kpi.variance >= 0 ? '+' : ''
                      }${kpi.variance}`
                    : 'Tanpa target'
                }
                sparklineData={spark.length > 1 ? spark : undefined}
                icon={<Icon name={ICONS[kpi.metric]} />}
              />
            </Item>
          );
        })}
      </Section>
    </>
  );
};
