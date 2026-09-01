import React from 'react';
import { motion } from 'motion/react';
import { Icon } from '@factory-vision/ui';

export const DataDecisionSection: React.FC = () => {
  const shopfloorEvents = [
    { name: 'PLC Sensor Strokes', icon: 'memory', color: 'var(--color-primary)' },
    { name: 'Operator Output Tally', icon: 'devices', color: 'var(--color-success)' },
    { name: 'Downtime & Stoppage Codes', icon: 'report_problem', color: 'var(--color-error)' },
    { name: 'Quality Inspection Results', icon: 'verified', color: 'var(--color-info)' },
    { name: 'Shift Handover Notes', icon: 'assignment', color: 'var(--color-warning)' },
  ];

  const outcomes = [
    { title: 'Instant Bottleneck Alleviation', desc: 'Rebalance production lines before starvation occurs' },
    { title: 'Automated Root-Cause OEE', desc: 'Eliminate chronic micro-stoppages with hard telemetry' },
    { title: 'Proactive Maintenance', desc: 'Schedule tooling swaps based on actual machine cycle strokes' },
    { title: 'Audit-Ready Traceability', desc: 'Export certified batch genealogy reports in one click' },
  ];

  return (
    <section className="fv-section-py" style={{ backgroundColor: 'var(--color-surface)' }}>
      <div className="fv-landing-container">
        {/* Header */}
        <div style={{ textAlign: 'center', maxWidth: '800px', margin: '0 auto 48px' }}>
          <div className="fv-eyebrow">
            <Icon name="analytics" size={16} />
            Data Intelligence Loop
          </div>
          <h2 className="fv-section-title">
            Every Production Event Becomes Actionable Data
          </h2>
          <p className="fv-section-desc" style={{ margin: '0 auto', color: 'var(--color-on-surface-variant)' }}>
            Transform scattered shopfloor noise into high-fidelity operational decisions.
            Continuous event streams power real-time dashboards and instant countermeasures.
          </p>
        </div>

        {/* Data Pipeline Flow Diagram */}
        <div
          className="fv-card"
          style={{
            padding: 'var(--space-10)',
            backgroundColor: 'var(--color-surface)',
            position: 'relative',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto 1.2fr auto 1fr',
              gap: 'var(--space-5)',
              alignItems: 'center',
            }}
            className="fv-pipeline-grid"
          >
            {/* Step 1: Shopfloor Signals */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div style={{ fontSize: '12px', fontWeight: 800, color: 'var(--color-on-surface-variant)', textTransform: 'uppercase', marginBottom: 'var(--space-1)' }}>
                01 Shopfloor Events
              </div>
              {shopfloorEvents.map((ev) => (
                <div
                  key={ev.name}
                  style={{
                    backgroundColor: 'var(--color-surface-container-low)',
                    border: '1px solid var(--color-outline-variant)',
                    borderRadius: '12px',
                    padding: `var(--space-3) var(--space-4)`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-3)',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: 'var(--color-on-surface)',
                  }}
                >
                  <Icon name={ev.icon} size={18} color={ev.color} />
                  <span>{ev.name}</span>
                </div>
              ))}
            </div>

            {/* Arrow 1 */}
            <div style={{ textAlign: 'center', color: 'var(--color-primary)' }} className="fv-pipeline-arrow">
              <Icon name="arrow_forward" size={32} />
            </div>

            {/* Step 2: Factory Vision Engine */}
            <motion.div
              initial={{ scale: 0.96 }}
              whileInView={{ scale: 1 }}
              viewport={{ once: true }}
              style={{
                background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary) 100%)',
                color: 'var(--color-on-primary)',
                borderRadius: '24px',
                padding: `var(--space-10) var(--space-6)`,
                textAlign: 'center',
                boxShadow: 'var(--elevation-4)',
                border: '1px solid color-mix(in srgb, var(--color-on-primary) 20%, transparent)',
              }}
            >
              <Icon name="insights" size={42} style={{ marginBottom: 'var(--space-3)', color: 'var(--color-on-primary)' }} />
              <h4 style={{ fontSize: '22px', fontWeight: 800, marginBottom: 'var(--space-2)' }}>
                FACTORY VISION
              </h4>
              <div style={{ fontSize: '13px', opacity: 0.95, lineHeight: 1.4, marginBottom: 'var(--space-4)', color: 'var(--color-on-primary)' }}>
                Real-Time Event Processing & Calculation Engine
              </div>
              <div
                style={{
                  backgroundColor: 'color-mix(in srgb, var(--color-on-primary) 15%, transparent)',
                  padding: `var(--space-2) var(--space-4)`,
                  borderRadius: '9999px',
                  fontSize: '12px',
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  display: 'inline-block',
                  color: 'var(--color-on-primary)',
                }}
              >
                &lt; 100ms Ingestion Latency
              </div>
            </motion.div>

            {/* Arrow 2 */}
            <div style={{ textAlign: 'center', color: 'var(--color-primary)' }} className="fv-pipeline-arrow">
              <Icon name="arrow_forward" size={32} />
            </div>

            {/* Step 3: Actionable Decisions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div style={{ fontSize: '12px', fontWeight: 800, color: 'var(--color-on-surface-variant)', textTransform: 'uppercase', marginBottom: 'var(--space-1)' }}>
                02 Better Decisions
              </div>
              {outcomes.map((out) => (
                <div
                  key={out.title}
                  style={{
                    backgroundColor: 'var(--color-surface-container-low)',
                    border: '1px solid var(--color-outline-variant)',
                    borderRadius: '12px',
                    padding: `var(--space-3) var(--space-4)`,
                  }}
                >
                  <div style={{ fontWeight: 800, fontSize: '13px', color: 'var(--color-primary)', marginBottom: 'var(--space-1)' }}>
                    {out.title}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)', lineHeight: 1.35 }}>
                    {out.desc}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 900px) {
          .fv-pipeline-grid {
            grid-template-columns: 1fr !important;
          }
          .fv-pipeline-arrow {
            display: none !important;
          }
        }
      `}</style>
    </section>
  );
};
