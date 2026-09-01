import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Icon } from '@factory-vision/ui';

export const MonitoringSection: React.FC = () => {
  const [filter, setFilter] = useState<'all' | 'running' | 'idle' | 'downtime'>('all');

  const machines = [
    {
      id: 'CNC-01',
      name: '5-Axis CNC Milling 01',
      line: 'Line A (Precision Machining)',
      status: 'running',
      order: '#WO-2026-0841',
      product: 'Engine Housing Aluminium 6061',
      operator: 'Budi Santoso',
      target: 450,
      actual: 398,
      speed: '98.5%',
      uptime: '6h 42m',
    },
    {
      id: 'CNC-02',
      name: '5-Axis CNC Milling 02',
      line: 'Line A (Precision Machining)',
      status: 'running',
      order: '#WO-2026-0842',
      product: 'Connecting Rod Forged Steel',
      operator: 'Agus Pratama',
      target: 600,
      actual: 540,
      speed: '96.2%',
      uptime: '7h 10m',
    },
    {
      id: 'STAMP-01',
      name: 'Hydraulic Press 400T',
      line: 'Line B (Stamping & Press)',
      status: 'idle',
      order: '#WO-2026-0850',
      product: 'Chassis Bracket Reinforcement',
      operator: 'Dewi Lestari',
      target: 1200,
      actual: 890,
      speed: 'Waiting Coil Feed',
      uptime: '42m Idle',
    },
    {
      id: 'ROBOT-01',
      name: 'Robotic Weld Cell 01',
      line: 'Line C (Automated Assembly)',
      status: 'downtime',
      order: '#WO-2026-0865',
      product: 'Exhaust Manifold Sub-Assembly',
      operator: 'Rian Hidayat',
      target: 350,
      actual: 180,
      speed: 'Tip Replacement',
      uptime: '18m Down',
    },
  ];

  const filteredMachines = filter === 'all' ? machines : machines.filter((m) => m.status === filter);

  return (
    <section className="fv-section-py" style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-on-primary)' }}>
      <div className="fv-landing-container">
        {/* Section Header */}
        <div style={{ textAlign: 'center', maxWidth: '800px', margin: '0 auto 48px' }}>
          <div className="fv-eyebrow-on-blue">
            <Icon name="precision_manufacturing" size={16} />
            Live Machine Monitoring
          </div>
          <h2 className="fv-section-title-on-blue">
            Know What's Happening on the Shopfloor, Now
          </h2>
          <p className="fv-section-desc-on-blue" style={{ margin: '0 auto' }}>
            Instant machine fleet telemetry. Get direct visibility into active jobs, cycle speed, operator assignments,
            and andon stoppage events.
          </p>
        </div>

        {/* Real-time Status Counter Banner */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 'var(--space-4)',
            marginBottom: 'var(--space-10)',
          }}
          className="fv-status-summary-grid"
        >
          <div
            onClick={() => setFilter('all')}
            style={{
              padding: 'var(--space-5)',
              backgroundColor: 'var(--color-surface)',
              border: filter === 'all' ? '2px solid var(--color-primary)' : '1px solid var(--color-outline-variant)',
              borderRadius: '16px',
              cursor: 'pointer',
              boxShadow: 'var(--elevation-2)',
              transition: 'all 0.15s ease',
            }}
          >
            <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 'var(--space-1)' }}>
              ALL MACHINES
            </div>
            <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--color-on-surface)' }} className="fv-num">
              18 <span style={{ fontSize: '13px', color: 'var(--color-on-surface-variant)', fontWeight: 600 }}>Total Units</span>
            </div>
          </div>

          <div
            onClick={() => setFilter('running')}
            style={{
              padding: 'var(--space-5)',
              backgroundColor: 'var(--color-surface)',
              border: filter === 'running' ? '2px solid var(--color-success)' : '1px solid var(--color-outline-variant)',
              borderRadius: '16px',
              cursor: 'pointer',
              boxShadow: 'var(--elevation-2)',
              transition: 'all 0.15s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: '11px', color: 'var(--color-success)', fontWeight: 800, marginBottom: 'var(--space-1)' }}>
              <span className="fv-status-dot running" />
              RUNNING
            </div>
            <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--color-success)' }} className="fv-num">
              12 <span style={{ fontSize: '13px', color: 'var(--color-on-surface-variant)', fontWeight: 600 }}>Operating</span>
            </div>
          </div>

          <div
            onClick={() => setFilter('idle')}
            style={{
              padding: 'var(--space-5)',
              backgroundColor: 'var(--color-surface)',
              border: filter === 'idle' ? '2px solid var(--color-warning)' : '1px solid var(--color-outline-variant)',
              borderRadius: '16px',
              cursor: 'pointer',
              boxShadow: 'var(--elevation-2)',
              transition: 'all 0.15s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: '11px', color: 'var(--color-warning)', fontWeight: 800, marginBottom: 'var(--space-1)' }}>
              <span className="fv-status-dot idle" />
              IDLE / CHANGEOVER
            </div>
            <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--color-warning)' }} className="fv-num">
              3 <span style={{ fontSize: '13px', color: 'var(--color-on-surface-variant)', fontWeight: 600 }}>Standby</span>
            </div>
          </div>

          <div
            onClick={() => setFilter('downtime')}
            style={{
              padding: 'var(--space-5)',
              backgroundColor: 'var(--color-surface)',
              border: filter === 'downtime' ? '2px solid var(--color-error)' : '1px solid var(--color-outline-variant)',
              borderRadius: '16px',
              cursor: 'pointer',
              boxShadow: 'var(--elevation-2)',
              transition: 'all 0.15s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: '11px', color: 'var(--color-error)', fontWeight: 800, marginBottom: 'var(--space-1)' }}>
              <span className="fv-status-dot downtime" />
              DOWNTIME
            </div>
            <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--color-error)' }} className="fv-num">
              2 <span style={{ fontSize: '13px', color: 'var(--color-on-surface-variant)', fontWeight: 600 }}>Alerts</span>
            </div>
          </div>
        </div>

        {/* Machine Cards Matrix */}
        <div className="fv-grid-2" style={{ gap: 'var(--space-6)' }}>
          {filteredMachines.map((m) => {
            const progress = Math.min(100, Math.round((m.actual / m.target) * 100));
            const statusColor =
              m.status === 'running'
                ? 'var(--color-success)'
                : m.status === 'idle'
                ? 'var(--color-warning)'
                : 'var(--color-error)';

            const statusBg =
              m.status === 'running'
                ? 'var(--color-success-container)'
                : m.status === 'idle'
                ? 'var(--color-warning-container)'
                : 'var(--color-error-container)';

            return (
              <div
                key={m.id}
                className="fv-card-on-blue"
                style={{
                  padding: 'var(--space-8)',
                  backgroundColor: 'var(--color-surface)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-4)',
                }}
              >
                {/* Header row */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-1)' }}>
                      <span className={`fv-status-dot ${m.status}`} />
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 800,
                          color: statusColor,
                          backgroundColor: statusBg,
                          padding: `var(--space-1) var(--space-2)`,
                          borderRadius: '9999px',
                          textTransform: 'uppercase',
                        }}
                      >
                        {m.status} · {m.uptime}
                      </span>
                    </div>
                    <h4 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
                      {m.id} · {m.name}
                    </h4>
                    <span style={{ fontSize: '13px', color: 'var(--color-on-surface-variant)', fontWeight: 500 }}>
                      {m.line}
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: '12px',
                      fontWeight: 700,
                      backgroundColor: 'var(--color-info-container)',
                      color: 'var(--color-on-info-container)',
                      border: '1px solid var(--color-info-container)',
                      padding: `var(--space-1) var(--space-3)`,
                      borderRadius: '8px',
                      fontFamily: 'monospace',
                    }}
                  >
                    {m.order}
                  </span>
                </div>

                {/* Product & Operator */}
                <div
                  style={{
                    backgroundColor: 'var(--color-surface-container-low)',
                    border: '1px solid var(--color-outline-variant)',
                    padding: `var(--space-3) var(--space-4)`,
                    borderRadius: '12px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '13px',
                  }}
                >
                  <div>
                    <span style={{ color: 'var(--color-on-surface-variant)', fontSize: '11px', display: 'block', fontWeight: 600 }}>
                      RUNNING PART
                    </span>
                    <strong style={{ color: 'var(--color-on-surface)', fontSize: '14px' }}>{m.product}</strong>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ color: 'var(--color-on-surface-variant)', fontSize: '11px', display: 'block', fontWeight: 600 }}>
                      OPERATOR
                    </span>
                    <strong style={{ color: 'var(--color-primary)', fontSize: '14px' }}>{m.operator}</strong>
                  </div>
                </div>

                {/* Target vs Actual Progress */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: 'var(--space-2)' }}>
                    <span style={{ color: 'var(--color-on-surface-variant)' }}>
                      Progress: <strong style={{ color: 'var(--color-on-surface)' }}>{m.actual} / {m.target} pcs</strong>
                    </span>
                    <span style={{ fontWeight: 800, color: 'var(--color-primary)' }}>{progress}%</span>
                  </div>
                  <div
                    style={{
                      height: '8px',
                      backgroundColor: 'var(--color-outline-variant)',
                      borderRadius: '9999px',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${progress}%`,
                        backgroundColor: statusColor,
                        borderRadius: '9999px',
                        transition: 'width 0.5s ease',
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .fv-status-summary-grid {
            grid-template-columns: repeat(2, 1fr) !important;
          }
        }
      `}</style>
    </section>
  );
};
