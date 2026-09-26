import React from 'react';
import type { ProcessPerformanceRow } from '@factory-vision/domain-types';
import { SurfaceCard } from '@factory-vision/ui/fv';
import { CELL, StatusPill } from './LinePerformanceTable.js';

interface ProcessPerformanceTableProps {
  processes: ProcessPerformanceRow[];
  isLoading?: boolean;
}

const rejectRate = (proc: ProcessPerformanceRow): string => {
  const total = proc.goodQuantity + proc.rejectQuantity;
  return total > 0 ? ((proc.rejectQuantity / total) * 100).toFixed(2) : '0';
};

/**
 * Process Performance, "Which process step is losing efficiency?"
 *
 * The same card, table and status pill as Plant / Line Performance above it,
 * one row per routing step with its OEE broken into Availability, Performance
 * and Quality. Rows arrive in routing sequence from the API, so the flow
 * reads top to bottom, and the status is the API's own classification against
 * the tenant's KPI targets, the same verdict the line rows carry.
 */
export const ProcessPerformanceTable: React.FC<ProcessPerformanceTableProps> = ({ processes: rows, isLoading }) => {
  return (
    <SurfaceCard padding="md" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div>
        <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 700 }}>Process Performance</h3>
        <div style={{ fontSize: '10.5px', color: 'var(--color-on-surface-variant)', marginTop: 'var(--space-1)' }}>
          OEE, Availability, Performance dan Quality per tahapan proses, urut sesuai routing
          {rows.length > 0 && ` · ${rows.length} tahapan`}
        </div>
      </div>

      {isLoading ? (
        <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)', padding: `var(--space-3) 0` }}>
          Memuat performa proses…
        </div>
      ) : rows.length === 0 ? (
        <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)', padding: `var(--space-3) 0` }}>
          Belum ada data performa proses untuk periode ini.
        </div>
      ) : (
        <div className="fv-table-scroll">
          <table className="fv-table" style={{ minWidth: '900px' }}>
            <thead>
              <tr>
                <th>Proses</th>
                <th className="fv-num">OEE</th>
                <th className="fv-num">Output</th>
                <th className="fv-num">Target</th>
                <th className="fv-num">Achievement</th>
                <th className="fv-num">Downtime</th>
                <th className="fv-num">Reject</th>
                <th className="fv-num">Availability</th>
                <th className="fv-num">Performance</th>
                <th className="fv-num">Quality</th>
                <th style={{ textAlign: 'center' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((proc) => (
                <tr key={proc.processId}>
                  <td>
                    <div style={{ fontWeight: 700 }}>{proc.processName}</div>
                    <div style={{ fontSize: '10.5px', color: 'var(--color-on-surface-variant)' }}>
                      {proc.processCode}
                    </div>
                  </td>
                  <td className="fv-num" style={{ ...CELL, fontWeight: 800 }}>{proc.oee}%</td>
                  <td className="fv-num" style={CELL}>{proc.goodQuantity.toLocaleString('en-US')}</td>
                  <td className="fv-num" style={CELL}>{proc.targetQuantity.toLocaleString('en-US')}</td>
                  <td className="fv-num" style={CELL}>{proc.achievementPct}%</td>
                  <td className="fv-num" style={CELL}>{proc.downtimeMinutes.toLocaleString('en-US')} min</td>
                  <td className="fv-num" style={CELL}>{rejectRate(proc)}%</td>
                  <td className="fv-num" style={CELL}>{proc.availability}%</td>
                  <td className="fv-num" style={CELL}>{proc.performance}%</td>
                  <td className="fv-num" style={CELL}>{proc.quality}%</td>
                  <td style={{ ...CELL, textAlign: 'center' }}>
                    <StatusPill status={proc.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SurfaceCard>
  );
};
