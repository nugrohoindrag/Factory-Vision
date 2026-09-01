import React from 'react';
import { ProcessPerformanceRow } from '@factory-vision/domain-types';
import { StatusBadge, Icon } from '@factory-vision/ui';

interface ProcessPerformanceTableProps {
  processes: ProcessPerformanceRow[];
  isLoading?: boolean;
}

export const ProcessPerformanceTable: React.FC<ProcessPerformanceTableProps> = ({ processes, isLoading }) => {
  if (isLoading) {
    return (
      <div
        style={{
          backgroundColor: 'var(--color-surface)',
          borderRadius: 'var(--radius-lg, 16px)',
          border: '1px solid var(--color-outline-variant)',
          padding: 'var(--space-6)',
          textAlign: 'center',
          color: 'var(--color-on-surface-variant)',
          fontSize: '13px',
        }}
      >
        Memuat performa multi-proses produksi, ...
      </div>
    );
  }

  const getOeeStatus = (oee: number) => {
    if (oee >= 85) return { label: 'GOOD', color: 'var(--color-success)' };
    if (oee >= 70) return { label: 'WATCH', color: 'var(--color-warning)' };
    return { label: 'CRITICAL', color: 'var(--color-error)' };
  };

  return (
    <div
      style={{
        backgroundColor: 'var(--color-surface)',
        borderRadius: 'var(--radius-lg, 16px)',
        border: '1px solid var(--color-outline-variant)',
        overflow: 'hidden',
        boxShadow: 'var(--elevation-1)',
      }}
    >
      <div
        style={{
          padding: `var(--space-4) var(--space-5)`,
          borderBottom: '1px solid var(--color-outline-variant)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: 'var(--color-surface-container)',
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
            Performa Efisiensi Berdasarkan Tahapan Proses ( &)
          </h3>
          <p style={{ margin: `var(--space-1) 0 0`, fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
            Monitoring OEE, Availability, Performance, dan Quality terisolasi pada setiap stasiun manufaktur
          </p>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            fontSize: '11.5px',
            color: 'var(--color-on-surface-variant)',
          }}
        >
          <Icon name="hub" size={16} />
          <span>{processes.length} Tahapan Terintegrasi</span>
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
          <thead>
            <tr
              style={{
                backgroundColor: 'var(--color-surface-container-high)',
                borderBottom: '1px solid var(--color-outline-variant)',
              }}
            >
              <th style={{ padding: `var(--space-3) var(--space-4)`, fontWeight: 800 }}>Tahapan Proses</th>
              <th style={{ padding: `var(--space-3) var(--space-3)`, fontWeight: 700 }}>Target vs Aktual</th>
              <th style={{ padding: `var(--space-3) var(--space-3)`, fontWeight: 700 }}>Achievement</th>
              <th style={{ padding: `var(--space-3) var(--space-3)`, fontWeight: 700 }}>Jumlah Reject</th>
              <th style={{ padding: `var(--space-3) var(--space-3)`, fontWeight: 700 }}>Downtime</th>
              <th style={{ padding: `var(--space-3) var(--space-3)`, fontWeight: 700 }}>Availability</th>
              <th style={{ padding: `var(--space-3) var(--space-3)`, fontWeight: 700 }}>Performance</th>
              <th style={{ padding: `var(--space-3) var(--space-3)`, fontWeight: 700 }}>Quality</th>
              <th style={{ padding: `var(--space-3) var(--space-4)`, fontWeight: 800 }}>OEE Proses</th>
            </tr>
          </thead>
          <tbody>
            {processes.map((proc) => {
              const status = getOeeStatus(proc.oee);
              return (
                <tr key={proc.processId} style={{ borderBottom: '1px solid var(--color-outline-variant)' }}>
                  <td style={{ padding: `var(--space-3) var(--space-4)` }}>
                    <div style={{ fontWeight: 800, fontSize: '13px', color: 'var(--color-on-surface)' }}>
                      {proc.processName}
                    </div>
                    <div
                      style={{ fontSize: '10.5px', color: 'var(--color-on-surface-variant)', marginTop: 'var(--space-1)' }}
                    >
                      Kode: <strong>{proc.processCode}</strong>
                    </div>
                  </td>

                  <td style={{ padding: `var(--space-3) var(--space-3)` }}>
                    <div style={{ fontWeight: 700, color: 'var(--color-on-surface)' }}>
                      {proc.goodQuantity.toLocaleString('en-US')} PCS
                    </div>
                    <div style={{ fontSize: '10.5px', color: 'var(--color-on-surface-variant)' }}>
                      Target: {proc.targetQuantity.toLocaleString('en-US')} PCS
                    </div>
                  </td>

                  <td style={{ padding: `var(--space-3) var(--space-3)` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                      <span
                        style={{
                          fontWeight: 800,
                          color: proc.achievementPct >= 90 ? 'var(--color-success)' : 'var(--color-warning)',
                        }}
                      >
                        {proc.achievementPct}%
                      </span>
                    </div>
                    <div
                      style={{
                        width: '80px',
                        height: '4px',
                        backgroundColor: 'var(--color-surface-container-high)',
                        borderRadius: 'var(--radius-pill)',
                        overflow: 'hidden',
                        marginTop: 'var(--space-1)',
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          width: `${Math.min(100, proc.achievementPct)}%`,
                          backgroundColor:
                            proc.achievementPct >= 90 ? 'var(--color-success)' : 'var(--color-warning)',
                          borderRadius: 'var(--radius-pill)',
                        }}
                      />
                    </div>
                  </td>

                  <td style={{ padding: `var(--space-3) var(--space-3)` }}>
                    <div
                      style={{
                        fontWeight: 700,
                        color: proc.rejectQuantity > 0 ? 'var(--color-error)' : 'var(--color-on-surface)',
                      }}
                    >
                      {proc.rejectQuantity.toLocaleString('en-US')} PCS
                    </div>
                    <div style={{ fontSize: '10.5px', color: 'var(--color-on-surface-variant)' }}>
                      Rate:{' '}
                      {proc.goodQuantity + proc.rejectQuantity > 0
                        ? ((proc.rejectQuantity / (proc.goodQuantity + proc.rejectQuantity)) * 100).toFixed(1)
                        : 0}
                      %
                    </div>
                  </td>

                  <td style={{ padding: `var(--space-3) var(--space-3)` }}>
                    <span
                      style={{
                        fontWeight: 700,
                        color: proc.downtimeMinutes > 60 ? 'var(--color-error)' : 'var(--color-on-surface)',
                      }}
                    >
                      {proc.downtimeMinutes} Menit
                    </span>
                  </td>

                  <td style={{ padding: `var(--space-3) var(--space-3)`, fontWeight: 700 }}>{proc.availability}%</td>

                  <td style={{ padding: `var(--space-3) var(--space-3)`, fontWeight: 700 }}>{proc.performance}%</td>

                  <td style={{ padding: `var(--space-3) var(--space-3)`, fontWeight: 700 }}>{proc.quality}%</td>

                  <td style={{ padding: `var(--space-3) var(--space-4)` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                      <span style={{ fontWeight: 900, fontSize: '14px', color: status.color }}>
                        {proc.oee}%
                      </span>
                      <span
                        style={{
                          padding: `var(--space-1) var(--space-2)`,
                          borderRadius: 'var(--radius-pill)',
                          fontSize: '9.5px',
                          fontWeight: 800,
                          backgroundColor: `${status.color}18`,
                          color: status.color,
                          border: `1px solid ${status.color}35`,
                        }}
                      >
                        {status.label}
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
