import React from 'react';
import { SurfaceCard } from '@factory-vision/ui/fv';
import type { ProductionTrendPoint, PlantPerformanceRow } from '@factory-vision/api-client';
import { TrendChart } from './TrendChart.js';

export interface ProductionPerformanceCardProps {
  trend: ProductionTrendPoint[];
  plants: PlantPerformanceRow[];
  isLoading?: boolean;
}

const dayLabel = (isoDate: string) =>
  new Date(`${isoDate}T00:00:00.000Z`).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  });

const Figure: React.FC<{ label: string; value: string; tone?: string }> = ({ label, value, tone }) => (
  <div>
    <div style={{ fontSize: '10px', color: 'var(--color-on-surface-variant)', fontWeight: 600 }}>{label}</div>
    <div
      style={{
        fontSize: '16px',
        fontWeight: 800,
        letterSpacing: '-0.02em',
        color: tone ?? 'var(--color-on-surface)',
        fontFeatureSettings: '"tnum" 1',
        marginTop: '2px',
      }}
    >
      {value}
    </div>
  </div>
);

/**
 * Production Performance, "Is production running to target?"
 *
 * Target, actual, achievement and gap for the window, the same three figures
 * defines, plus the Target vs Actual trend with the preceding period
 * overlaid and a per-plant breakdown.
 */
export const ProductionPerformanceCard: React.FC<ProductionPerformanceCardProps> = ({
  trend,
  plants,
  isLoading,
}) => {
  const target = trend.reduce((acc, p) => acc + p.targetQuantity, 0);
  const actual = trend.reduce((acc, p) => acc + p.goodQuantity, 0);
  const gap = actual - target;
  const achievement = target > 0 ? Math.round((actual / target) * 100) : 0;

  return (
    <SurfaceCard padding="md" style={{ display: 'flex', flexDirection: 'column', gap: '11px' }}>
      <div>
        <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 700 }}>Target vs Actual Production</h3>
        <div style={{ fontSize: '10.5px', color: 'var(--color-on-surface-variant)', marginTop: '2px' }}>
          Akumulasi periode terpilih, dibandingkan periode sebelumnya
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))',
          gap: '10px',
          paddingBottom: '4px',
          borderBottom: '1px solid var(--color-outline-variant)',
        }}
      >
        <Figure label="Target" value={target.toLocaleString('en-US')} />
        <Figure label="Actual" value={actual.toLocaleString('en-US')} />
        <Figure
          label="Gap"
          value={`${gap >= 0 ? '+' : ''}${gap.toLocaleString('en-US')}`}
          tone={gap >= 0 ? 'var(--color-success)' : 'var(--color-error)'}
        />
        <Figure
          label="Pencapaian"
          value={`${achievement}%`}
          tone={achievement >= 100 ? 'var(--color-success)' : 'var(--color-warning)'}
        />
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
          Memuat trend produksi…
        </div>
      ) : (
        <TrendChart
          labels={trend.map((p) => dayLabel(p.shiftDate))}
          unit="pcs"
          series={[
            {
              key: 'actual',
              label: 'Actual',
              tone: 'chart-1',
              values: trend.map((p) => p.goodQuantity),
              fillArea: true,
            },
            {
              key: 'target',
              label: 'Target',
              tone: 'chart-3',
              style: 'dashed',
              values: trend.map((p) => p.targetQuantity),
            },
            {
              key: 'previous',
              label: 'Periode sebelumnya',
              tone: 'neutral',
              style: 'dashed',
              values: trend.map((p) => p.previousPeriodGoodQuantity),
            },
          ]}
        />
      )}

      {plants.length > 0 && (
        <div>
          <div
            style={{
              fontSize: '10px',
              fontWeight: 700,
              color: 'var(--color-on-surface-variant)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              marginBottom: '6px',
            }}
          >
            Produksi per Plant
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {plants.map((plant) => (
              <div
                key={plant.plantId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '10px',
                  padding: '8px 10px',
                  borderRadius: 'var(--radius-sm, 6px)',
                  backgroundColor: 'var(--color-surface-container)',
                }}
              >
                <span style={{ fontSize: '12px', fontWeight: 600 }}>{plant.plantName}</span>
                <span
                  style={{
                    fontSize: '11.5px',
                    color: 'var(--color-on-surface-variant)',
                    fontFeatureSettings: '"tnum" 1',
                  }}
                >
                  {plant.goodQuantity.toLocaleString('en-US')} / {plant.targetQuantity.toLocaleString('en-US')}{' '}
                  · <strong style={{ color: 'var(--color-on-surface)' }}>{plant.achievementPct}%</strong>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </SurfaceCard>
  );
};
