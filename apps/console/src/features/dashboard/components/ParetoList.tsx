import React from 'react';
import { toneColor, type Tone } from '@factory-vision/ui/fv';

export interface ParetoRow {
  id: string;
  label: string;
  sublabel?: string;
  /** Formatted magnitude, e.g. "3.472 min" or "2.264 pcs". */
  valueText: string;
  percentage: number;
  cumulative: number;
}

export interface ParetoListProps {
  rows: ParetoRow[];
  tone?: Tone;
  emptyMessage?: string;
  onSelect?: (id: string) => void;
}

/**
 * A Pareto bar list, used by both (downtime by reason) and
 * (defects by reason).
 *
 * The bar is the share of total; the cumulative figure is what turns a ranked
 * list into an actual Pareto, so it is shown rather than left to be inferred.
 * Intensity steps down the list so the "vital few" separate visually from the
 * tail without the rows needing different hues.
 */
export const ParetoList: React.FC<ParetoListProps> = ({
  rows,
  tone = 'chart-1',
  emptyMessage = 'Belum ada data untuk periode ini.',
  onSelect,
}) => {
  if (rows.length === 0) {
    return (
      <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)', padding: '8px 0' }}>
        {emptyMessage}
      </div>
    );
  }

  const max = Math.max(...rows.map((r) => r.percentage), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {rows.map((row, index) => (
        <div
          key={row.id}
          onClick={onSelect ? () => onSelect(row.id) : undefined}
          style={{ cursor: onSelect ? 'pointer' : 'default' }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              gap: '10px',
              marginBottom: '4px',
            }}
          >
            <span style={{ fontSize: '12px', fontWeight: 600, minWidth: 0 }}>
              {row.label}
              {row.sublabel && (
                <span style={{ color: 'var(--color-on-surface-variant)', fontWeight: 500 }}>
                  {' '}
                  · {row.sublabel}
                </span>
              )}
            </span>
            <span
              style={{
                fontSize: '11.5px',
                fontWeight: 700,
                whiteSpace: 'nowrap',
                fontFeatureSettings: '"tnum" 1',
              }}
            >
              {row.valueText}
              <span style={{ color: 'var(--color-on-surface-variant)', fontWeight: 500 }}>
                {' '}
                ({row.percentage}%)
              </span>
            </span>
          </div>

          <div
            style={{
              height: '8px',
              borderRadius: 'var(--radius-pill)',
              backgroundColor: 'var(--color-surface-container-high)',
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            <div
              style={{
                width: `${(row.percentage / max) * 100}%`,
                height: '100%',
                borderRadius: 'var(--radius-pill)',
                backgroundColor: toneColor[tone],
                // The tail of a Pareto matters less; fade it rather than recolour it.
                opacity: Math.max(0.4, 1 - index * 0.16),
              }}
            />
          </div>

          <div
            style={{
              fontSize: '10px',
              color: 'var(--color-on-surface-variant)',
              marginTop: '3px',
              fontFeatureSettings: '"tnum" 1',
            }}
          >
            Kumulatif {row.cumulative}%
          </div>
        </div>
      ))}
    </div>
  );
};
