import React from 'react';
import { Icon } from '@factory-vision/ui';
import { SurfaceCard } from '@factory-vision/ui/fv';
import type { DowntimeSummary } from '@factory-vision/api-client';
import { ParetoList } from './ParetoList.js';

export interface DowntimeAnalysisCardProps {
  summary?: DowntimeSummary;
  isLoading?: boolean;
  onDrillDown?: (reasonId?: string) => void;
}

const Stat: React.FC<{ label: string; value: string; tone?: string }> = ({ label, value, tone }) => (
  <div
    style={{
      padding: `var(--space-2) var(--space-3)`,
      borderRadius: 'var(--radius-sm, 6px)',
      backgroundColor: 'var(--color-surface-container)',
    }}
  >
    <div style={{ fontSize: '10px', color: 'var(--color-on-surface-variant)', fontWeight: 600 }}>{label}</div>
    <div
      style={{
        fontSize: '13.5px',
        fontWeight: 800,
        marginTop: 'var(--space-1)',
        color: tone ?? 'var(--color-on-surface)',
        fontFeatureSettings: '"tnum" 1',
      }}
    >
      {value}
    </div>
  </div>
);

/**
 * Downtime Analysis, "What is the main cause of production loss?"
 *
 * A loss overview and the Top 5 Pareto, deliberately not the transaction list:
 * excludes the full downtime log from this page.
 */
export const DowntimeAnalysisCard: React.FC<DowntimeAnalysisCardProps> = ({
  summary,
  isLoading,
  onDrillDown,
}) => (
  <SurfaceCard padding="md" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
      <div>
        <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 700 }}>Downtime Pareto, Top 5</h3>
        <div style={{ fontSize: '10.5px', color: 'var(--color-on-surface-variant)', marginTop: 'var(--space-1)' }}>
          Penyebab utama production loss pada periode terpilih
        </div>
      </div>
      {onDrillDown && (
        <button
          type="button"
          onClick={() => onDrillDown()}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--space-1)',
            padding: `var(--space-1) var(--space-3)`,
            borderRadius: 'var(--radius-pill)',
            border: '1px solid var(--color-outline-variant)',
            backgroundColor: 'transparent',
            color: 'var(--color-primary)',
            fontSize: '10.5px',
            fontWeight: 700,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Downtime Analytics
          <Icon name="arrow_forward" size={13} />
        </button>
      )}
    </div>

    {isLoading || !summary ? (
      <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
        Memuat analisis downtime…
      </div>
    ) : (
      <>
        <div
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', gap: 'var(--space-2)' }}
        >
          <Stat label="Total" value={`${summary.totalDowntimeMinutes.toLocaleString('en-US')} min`} />
          <Stat
            label="Unplanned"
            value={`${summary.unplannedDowntimeMinutes.toLocaleString('en-US')} min`}
            tone="var(--color-error)"
          />
          <Stat label="Planned" value={`${summary.plannedDowntimeMinutes.toLocaleString('en-US')} min`} />
          <Stat label="Downtime rate" value={`${summary.downtimeRatePct}%`} />
          <Stat label="Rata-rata" value={`${summary.averageDurationMinutes} min`} />
        </div>

        <ParetoList
          tone="error"
          rows={summary.pareto.slice(0, 5).map((item) => ({
            id: item.reasonId,
            label: item.reasonName,
            sublabel: `${item.occurrenceCount}×`,
            valueText: `${item.totalDurationMinutes.toLocaleString('en-US')} min`,
            percentage: item.percentageOfTotal,
            cumulative: item.cumulativePercentage,
          }))}
          onSelect={onDrillDown ? (reasonId) => onDrillDown(reasonId) : undefined}
          emptyMessage="Tidak ada downtime tercatat pada periode ini."
        />

        {summary.topMachines.length > 0 && (
          <div>
            <div
              style={{
                fontSize: '10px',
                fontWeight: 700,
                color: 'var(--color-on-surface-variant)',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                marginBottom: 'var(--space-2)',
              }}
            >
              Mesin paling bermasalah
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {summary.topMachines.slice(0, 3).map((machine) => (
                <div
                  key={machine.machineId}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '11px',
                    padding: `var(--space-2) var(--space-3)`,
                    borderRadius: 'var(--radius-sm, 6px)',
                    backgroundColor: 'var(--color-surface-container)',
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{machine.machineName}</span>
                  <span style={{ color: 'var(--color-on-surface-variant)', fontFeatureSettings: '"tnum" 1' }}>
                    {machine.downtimeMinutes.toLocaleString('en-US')} min · {machine.occurrenceCount}×
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
