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
        padding: `var(--space-1) var(--space-3)`,
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

// Header fill, cell rhythm and numeric alignment come from `.fv-table`; only
// what that rule does not decide is set here.
const CELL: React.CSSProperties = { whiteSpace: 'nowrap' };

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
  <SurfaceCard padding="md" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
    <div>
      <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 700 }}>Plant / Line Performance</h3>
      <div style={{ fontSize: '10.5px', color: 'var(--color-on-surface-variant)', marginTop: 'var(--space-1)' }}>
        Diurutkan dari OEE terendah, masalah terbesar tampil paling atas
      </div>
    </div>

    {plants.length > 1 && (
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        {plants.map((plant) => (
          <div
            key={plant.plantId}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              padding: `var(--space-2) var(--space-3)`,
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
      <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)', padding: `var(--space-3) 0` }}>
        Memuat performa lini…
      </div>
    ) : lines.length === 0 ? (
      <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)', padding: `var(--space-3) 0` }}>
        Belum ada data performa lini untuk periode ini.
      </div>
    ) : (
      <div className="fv-table-scroll">
        <table className="fv-table" style={{ minWidth: '620px' }}>
          <thead>
            <tr>
              <th>Line</th>
              <th className="fv-num">OEE</th>
              <th className="fv-num">Output</th>
              <th className="fv-num">Achievement</th>
              <th className="fv-num">Downtime</th>
              <th className="fv-num">Reject</th>
              <th style={{ textAlign: 'center' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr
                key={line.lineId}
                onClick={onSelectLine ? () => onSelectLine(line.lineId) : undefined}
                style={{ cursor: onSelectLine ? 'pointer' : 'default' }}
              >
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
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
                <td className="fv-num" style={{ ...CELL, fontWeight: 800 }}>{line.oee}%</td>
                <td className="fv-num" style={CELL}>{line.goodQuantity.toLocaleString('en-US')}</td>
                <td className="fv-num" style={CELL}>{line.achievementPct}%</td>
                <td className="fv-num" style={CELL}>{line.downtimeMinutes.toLocaleString('en-US')} min</td>
                <td className="fv-num" style={CELL}>{line.rejectRatePct}%</td>
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
