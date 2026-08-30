import React from 'react';
import { Icon } from '@factory-vision/ui';
import { SurfaceCard, toneContainer, toneOnContainer, type Tone } from '@factory-vision/ui/fv';
import type { LinePerformanceRow, PlantPerformanceRow } from '@factory-vision/api-client';

export interface LinePerformanceTableProps {
  lines: LinePerformanceRow[];
  plants: PlantPerformanceRow[];
  isLoading?: boolean;
  onSelectLine?: (lineId: string) => void;
}

const STATUS_TONE: Record<LinePerformanceRow['status'], Tone> = {
  GOOD: 'success',
  WATCH: 'warning',
  CRITICAL: 'error',
};

const StatusPill: React.FC<{ status: LinePerformanceRow['status'] }> = ({ status }) => {
  const tone = STATUS_TONE[status];
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 10px',
        borderRadius: 'var(--radius-pill)',
        fontSize: '10px',
        fontWeight: 800,
        letterSpacing: '0.03em',
        backgroundColor: toneContainer[tone],
        color: toneOnContainer[tone],
      }}
    >
      {status}
    </span>
  );
};

const HEAD: React.CSSProperties = {
  padding: '6px 8px',
  fontSize: '10px',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--color-on-surface-variant)',
  textAlign: 'right',
  whiteSpace: 'nowrap',
};

const CELL: React.CSSProperties = {
  padding: '7px 8px',
  fontSize: '11.5px',
  textAlign: 'right',
  fontFeatureSettings: '"tnum" 1',
  whiteSpace: 'nowrap',
};

/**
 * Plant / Production Line Performance, "Where is the biggest problem?"
 *
 * Rows arrive already sorted worst-OEE-first from the API, so the line that
 * needs attention is the first thing read. Clicking a row drills through to the
 * live board for that line, per the drill-down principle.
 */
export const LinePerformanceTable: React.FC<LinePerformanceTableProps> = ({
  lines,
  plants,
  isLoading,
  onSelectLine,
}) => (
  <SurfaceCard padding="md" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
    <div>
      <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 700 }}>Plant / Line Performance</h3>
      <div style={{ fontSize: '10.5px', color: 'var(--color-on-surface-variant)', marginTop: '2px' }}>
        Diurutkan dari OEE terendah, masalah terbesar tampil paling atas
      </div>
    </div>

    {plants.length > 1 && (
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {plants.map((plant) => (
          <div
            key={plant.plantId}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '5px 10px',
              borderRadius: 'var(--radius-pill)',
              backgroundColor: 'var(--color-surface-container)',
              fontSize: '11.5px',
            }}
          >
            <strong>{plant.plantName}</strong>
            <span style={{ color: 'var(--color-on-surface-variant)', fontFeatureSettings: '"tnum" 1' }}>
              OEE {plant.oee}% · {plant.achievementPct}%
            </span>
            <StatusPill status={plant.status} />
          </div>
        ))}
      </div>
    )}

    {isLoading ? (
      <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)', padding: '12px 0' }}>
        Memuat performa lini…
      </div>
    ) : lines.length === 0 ? (
      <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)', padding: '12px 0' }}>
        Belum ada data performa lini untuk periode ini.
      </div>
    ) : (
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '620px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-outline-variant)' }}>
              <th style={{ ...HEAD, textAlign: 'left' }}>Line</th>
              <th style={HEAD}>OEE</th>
              <th style={HEAD}>Output</th>
              <th style={HEAD}>Achievement</th>
              <th style={HEAD}>Downtime</th>
              <th style={HEAD}>Reject</th>
              <th style={{ ...HEAD, textAlign: 'center' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr
                key={line.lineId}
                onClick={onSelectLine ? () => onSelectLine(line.lineId) : undefined}
                style={{
                  borderBottom: '1px solid var(--color-outline-variant)',
                  cursor: onSelectLine ? 'pointer' : 'default',
                }}
              >
                <td style={{ ...CELL, textAlign: 'left', whiteSpace: 'normal' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {line.hasActiveDowntime && (
                      <Icon name="warning" size={14} color="var(--color-error)" label="Sedang downtime" />
                    )}
                    <div>
                      <div style={{ fontWeight: 700 }}>{line.lineName}</div>
                      <div style={{ fontSize: '10.5px', color: 'var(--color-on-surface-variant)' }}>
                        {line.plantName}
                      </div>
                    </div>
                  </div>
                </td>
                <td style={{ ...CELL, fontWeight: 800 }}>{line.oee}%</td>
                <td style={CELL}>{line.goodQuantity.toLocaleString('en-US')}</td>
                <td style={CELL}>{line.achievementPct}%</td>
                <td style={CELL}>{line.downtimeMinutes.toLocaleString('en-US')} min</td>
                <td style={CELL}>{line.rejectRatePct}%</td>
                <td style={{ ...CELL, textAlign: 'center' }}>
                  <StatusPill status={line.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </SurfaceCard>
);
