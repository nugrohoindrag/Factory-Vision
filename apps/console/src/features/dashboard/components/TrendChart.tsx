import React, { useId } from 'react';
import { Tone, toneColor } from '@factory-vision/ui/fv';

export interface TrendSeries {
  key: string;
  label: string;
  values: Array<number | null>;
  tone: Tone;
  /** Dashed lines read as reference, not as measured output. */
  style?: 'solid' | 'dashed';
  /** Fill the area under the line. Only ever set this on one series. */
  fillArea?: boolean;
}

export interface TrendChartProps {
  labels: string[];
  series: TrendSeries[];
  height?: number;
  /** Suffix on axis and tooltip figures, e.g. '%' or ' pcs'. */
  unit?: string;
  /** Force the y-axis floor. Defaults to a padded minimum across all series. */
  yMin?: number;
  yMax?: number;
  emptyMessage?: string;
}

const PAD = { top: 10, right: 10, bottom: 19, left: 34 };

/**
 * Multi-series line chart for the Executive Dashboard's trend bands.
 *
 * The design system's `LineChart` renders a single series and
 * both need three at once (actual, target, previous period), so this draws its
 * own SVG. Every colour comes from a `Tone`, so it follows theme like anything
 * else, no literal colour appears below ( of the design guideline).
 */
export const TrendChart: React.FC<TrendChartProps> = ({
  labels,
  series,
  height = 155,
  unit = '',
  yMin,
  yMax,
  emptyMessage = 'Data belum tersedia untuk periode ini.',
}) => {
  const gradientId = useId().replace(/:/g, '');
  const width = 640; // viewBox width; the SVG scales to its container.

  const numbers = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  if (labels.length === 0 || numbers.length === 0) {
    return (
      <div
        style={{
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--color-on-surface-variant)',
          fontSize: '12px',
        }}
      >
        {emptyMessage}
      </div>
    );
  }

  const rawMin = yMin ?? Math.min(...numbers);
  const rawMax = yMax ?? Math.max(...numbers);
  const span = rawMax - rawMin || 1;
  const min = yMin ?? Math.max(0, rawMin - span * 0.15);
  const max = yMax ?? rawMax + span * 0.15;

  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;

  const x = (index: number) =>
    PAD.left + (labels.length === 1 ? plotW / 2 : (index / (labels.length - 1)) * plotW);
  const y = (value: number) => PAD.top + plotH - ((value - min) / (max - min)) * plotH;

  const gridLines = [0, 0.25, 0.5, 0.75, 1];

  /** Build a path, breaking it wherever a series has no value for that day. */
  const pathFor = (values: Array<number | null>) => {
    const segments: string[] = [];
    let open = false;
    values.forEach((value, index) => {
      if (value === null) {
        open = false;
        return;
      }
      segments.push(`${open ? 'L' : 'M'} ${x(index).toFixed(1)} ${y(value).toFixed(1)}`);
      open = true;
    });
    return segments.join(' ');
  };

  const areaSeries = series.find((s) => s.fillArea);

  // Show at most 7 x-axis labels so dates never collide.
  const labelStep = Math.max(1, Math.ceil(labels.length / 7));

  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label={series.map((s) => s.label).join(', ')}
        style={{ display: 'block', minWidth: '320px' }}
      >
        {areaSeries && (
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={toneColor[areaSeries.tone]} stopOpacity="0.22" />
              <stop offset="100%" stopColor={toneColor[areaSeries.tone]} stopOpacity="0" />
            </linearGradient>
          </defs>
        )}

        {/* Grid and y-axis ticks */}
        {gridLines.map((ratio) => {
          const value = max - ratio * (max - min);
          const gy = PAD.top + ratio * plotH;
          return (
            <g key={ratio}>
              <line
                x1={PAD.left}
                y1={gy}
                x2={width - PAD.right}
                y2={gy}
                stroke="var(--color-chart-grid)"
                strokeWidth="1"
              />
              <text
                x={PAD.left - 6}
                y={gy + 3.5}
                textAnchor="end"
                fontSize="9"
                fill="var(--color-on-surface-variant)"
                style={{ fontFeatureSettings: '"tnum" 1' }}
              >
                {Math.round(value).toLocaleString('en-US')}
              </text>
            </g>
          );
        })}

        {/* Area fill under the primary series */}
        {areaSeries && (
          <path
            d={`${pathFor(areaSeries.values)} L ${x(labels.length - 1).toFixed(1)} ${(PAD.top + plotH).toFixed(1)} L ${x(0).toFixed(1)} ${(PAD.top + plotH).toFixed(1)} Z`}
            fill={`url(#${gradientId})`}
            stroke="none"
          />
        )}

        {/* Series */}
        {series.map((s) => (
          <path
            key={s.key}
            d={pathFor(s.values)}
            fill="none"
            stroke={toneColor[s.tone]}
            strokeWidth={s.style === 'dashed' ? 1.5 : 2.25}
            strokeDasharray={s.style === 'dashed' ? '5 4' : undefined}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {/* Points on solid series only; a reference line needs no markers. */}
        {series
          .filter((s) => s.style !== 'dashed')
          .map((s) =>
            s.values.map((value, index) =>
              value === null ? null : (
                <circle
                  key={`${s.key}-${index}`}
                  cx={x(index)}
                  cy={y(value)}
                  r="2.5"
                  fill="var(--color-surface)"
                  stroke={toneColor[s.tone]}
                  strokeWidth="1.75"
                />
              )
            )
          )}

        {/* X-axis labels */}
        {labels.map((label, index) =>
          index % labelStep === 0 || index === labels.length - 1 ? (
            <text
              key={label + index}
              x={x(index)}
              y={height - 6}
              textAnchor="middle"
              fontSize="9"
              fill="var(--color-on-surface-variant)"
            >
              {label}
            </text>
          ) : null
        )}
      </svg>

      {/* Legend */}
      <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', marginTop: '6px' }}>
        {series.map((s) => (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span
              style={{
                width: '14px',
                height: s.style === 'dashed' ? '0' : '3px',
                borderRadius: 'var(--radius-pill)',
                backgroundColor: s.style === 'dashed' ? 'transparent' : toneColor[s.tone],
                borderTop: s.style === 'dashed' ? `2px dashed ${toneColor[s.tone]}` : undefined,
                display: 'inline-block',
              }}
            />
            <span style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)', fontWeight: 600 }}>
              {s.label}
              {unit ? ` (${unit.trim()})` : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
