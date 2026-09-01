import React from 'react';
import { Icon } from '@factory-vision/ui';
import { SurfaceCard } from '@factory-vision/ui/fv';
import type { OeeTrendPoint, ExecutiveKpi } from '@factory-vision/api-client';
import { TrendChart } from './TrendChart.js';

export interface OeePerformanceCardProps {
  trend: OeeTrendPoint[];
  /** Availability / Performance / Quality cards come from the same KPI payload. */
  kpis: ExecutiveKpi[];
  isLoading?: boolean;
  onDrillDown?: () => void;
}

const dayLabel = (isoDate: string) =>
  new Date(`${isoDate}T00:00:00.000Z`).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  });

const PILLAR_TONE = {
  AVAILABILITY: 'var(--color-chart-secondary)',
  PERFORMANCE: 'var(--color-chart-tertiary)',
  QUALITY: 'var(--color-chart-quaternary)',
} as const;

/**
 * OEE Performance, actual against target, against the previous period,
 * with the three pillars broken out beneath.
 */
export const OeePerformanceCard: React.FC<OeePerformanceCardProps> = ({
  trend,
  kpis,
  isLoading,
  onDrillDown,
}) => {
  const pillars = (['AVAILABILITY', 'PERFORMANCE', 'QUALITY'] as const)
    .map((metric) => kpis.find((k) => k.metric === metric))
    .filter((k): k is ExecutiveKpi => Boolean(k));

  const latest = trend[trend.length - 1];

  return (
    <SurfaceCard padding="md" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 700 }}>OEE Trend</h3>
          <div style={{ fontSize: '10.5px', color: 'var(--color-on-surface-variant)', marginTop: 'var(--space-1)' }}>
            Actual • Target • Periode sebelumnya
          </div>
        </div>
        {onDrillDown && (
          <button
            type="button"
            onClick={onDrillDown}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--space-1)',
              padding: `var(--space-1) var(--space-3)`,
              borderRadius: 'var(--radius-pill)',
              border: '1px solid var(--color-outline-variant)',
              backgroundColor: 'transparent',
              color: 'var(--color-primary)',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            Analitik OEE
            <Icon name="arrow_forward" size={13} />
          </button>
        )}
      </div>

      {isLoading ? (
        <div
          style={{
            height: 155,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '12px',
            color: 'var(--color-on-surface-variant)',
          }}
        >
          Memuat trend OEE…
        </div>
      ) : (
        <TrendChart
          labels={trend.map((p) => dayLabel(p.shiftDate))}
          unit="%"
          series={[
            {
              key: 'oee',
              label: 'Actual OEE',
              tone: 'chart-1',
              values: trend.map((p) => p.oee),
              fillArea: true,
            },
            {
              key: 'target',
              label: 'Target OEE',
              tone: 'success',
              style: 'dashed',
              values: trend.map((p) => p.targetOee),
            },
            {
              key: 'previous',
              label: 'Periode sebelumnya',
              tone: 'neutral',
              style: 'dashed',
              values: trend.map((p) => p.previousPeriodOee),
            },
          ]}
        />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-2)' }}>
        {pillars.map((pillar) => (
          <div
            key={pillar.metric}
            style={{
              padding: `var(--space-2) var(--space-2)`,
              borderRadius: 'var(--radius-sm, 6px)',
              backgroundColor: 'var(--color-surface-container)',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '10px', color: 'var(--color-on-surface-variant)', fontWeight: 600 }}>
              {pillar.label}
            </div>
            <div
              style={{
                fontSize: '14px',
                fontWeight: 800,
                marginTop: 'var(--space-1)',
                color: PILLAR_TONE[pillar.metric as keyof typeof PILLAR_TONE],
                fontFeatureSettings: '"tnum" 1',
              }}
            >
              {pillar.value}%
            </div>
            {pillar.target !== undefined && (
              <div style={{ fontSize: '10px', color: 'var(--color-on-surface-variant)', marginTop: 'var(--space-1)' }}>
                target {pillar.target}%
              </div>
            )}
          </div>
        ))}
      </div>

      {latest && (
        <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
          Hari terakhir ({dayLabel(latest.shiftDate)}): OEE{' '}
          <strong style={{ color: 'var(--color-on-surface)' }}>{latest.oee}%</strong>
          {latest.targetOee !== null && ` terhadap target ${latest.targetOee}%`}
        </div>
      )}
    </SurfaceCard>
  );
};
