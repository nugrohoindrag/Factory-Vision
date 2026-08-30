import React from 'react';
import { Icon } from '@factory-vision/ui';
import { SurfaceCard } from '@factory-vision/ui/fv';
import type { QualitySummary } from '@factory-vision/api-client';
import { ParetoList } from './ParetoList.js';

export interface QualityPerformanceCardProps {
  summary?: QualitySummary;
  isLoading?: boolean;
  onDrillDown?: (reasonId?: string) => void;
}

const Stat: React.FC<{ label: string; value: string; tone?: string }> = ({ label, value, tone }) => (
  <div
    style={{
      padding: '7px 9px',
      borderRadius: 'var(--radius-sm, 6px)',
      backgroundColor: 'var(--color-surface-container)',
    }}
  >
    <div style={{ fontSize: '10px', color: 'var(--color-on-surface-variant)', fontWeight: 600 }}>{label}</div>
    <div
      style={{
        fontSize: '13.5px',
        fontWeight: 800,
        marginTop: '2px',
        color: tone ?? 'var(--color-on-surface)',
        fontFeatureSettings: '"tnum" 1',
      }}
    >
      {value}
    </div>
  </div>
);

/**
 * Quality Performance, "Is quality within target, and what is the
 * largest defect contributor?"
 *
 * The Pareto is aggregated server-side from reject records by reason. It is
 * never derived from an assumed split of the total reject count.
 */
export const QualityPerformanceCard: React.FC<QualityPerformanceCardProps> = ({
  summary,
  isLoading,
  onDrillDown,
}) => {
  const onTarget = summary?.qualityTargetPct != null ? summary.qualityPct >= summary.qualityTargetPct : null;

  return (
    <SurfaceCard padding="md" style={{ display: 'flex', flexDirection: 'column', gap: '11px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 700 }}>Defect Pareto</h3>
          <div style={{ fontSize: '10.5px', color: 'var(--color-on-surface-variant)', marginTop: '2px' }}>
            Kontributor reject terbesar pada periode terpilih
          </div>
        </div>
        {onDrillDown && (
          <button
            type="button"
            onClick={() => onDrillDown()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '3px 9px',
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
            Quality Analytics
            <Icon name="arrow_forward" size={13} />
          </button>
        )}
      </div>

      {isLoading || !summary ? (
        <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
          Memuat performa kualitas…
        </div>
      ) : (
        <>
          <div
            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', gap: '8px' }}
          >
            <Stat
              label="Quality"
              value={`${summary.qualityPct}%`}
              tone={onTarget === false ? 'var(--color-error)' : 'var(--color-success)'}
            />
            <Stat
              label="Target"
              value={summary.qualityTargetPct != null ? `${summary.qualityTargetPct}%` : ', '}
            />
            <Stat
              label="Variance"
              value={
                summary.qualityVariancePct != null
                  ? `${summary.qualityVariancePct >= 0 ? '+' : ''}${summary.qualityVariancePct}`
                  : ', '
              }
              tone={
                summary.qualityVariancePct != null && summary.qualityVariancePct < 0
                  ? 'var(--color-error)'
                  : 'var(--color-success)'
              }
            />
            <Stat label="Reject rate" value={`${summary.rejectRatePct}%`} />
            <Stat label="Jumlah Reject" value={`${summary.rejectQuantity.toLocaleString('en-US')} pcs`} />
          </div>

          <ParetoList
            tone="warning"
            rows={summary.pareto.slice(0, 5).map((item) => ({
              id: item.reasonId,
              label: item.reasonName,
              sublabel: item.category,
              valueText: `${item.totalRejectQuantity.toLocaleString('en-US')} pcs`,
              percentage: item.percentageOfTotal,
              cumulative: item.cumulativePercentage,
            }))}
            onSelect={onDrillDown ? (reasonId) => onDrillDown(reasonId) : undefined}
            emptyMessage="Tidak ada reject tercatat pada periode ini."
          />

          {summary.byLine.length > 0 && (
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
                Reject rate per lini
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                {summary.byLine.map((line) => (
                  <div
                    key={line.lineId}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '11px',
                      padding: '5px 9px',
                      borderRadius: 'var(--radius-sm, 6px)',
                      backgroundColor: 'var(--color-surface-container)',
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>{line.lineName}</span>
                    <span style={{ color: 'var(--color-on-surface-variant)', fontFeatureSettings: '"tnum" 1' }}>
                      {line.rejectQuantity.toLocaleString('en-US')} pcs · {line.rejectRatePct}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </SurfaceCard>
  );
};
