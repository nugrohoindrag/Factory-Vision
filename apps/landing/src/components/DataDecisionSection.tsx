import React from 'react';
import { motion } from 'motion/react';
import { Icon } from '@factory-vision/ui';

export const DataDecisionSection: React.FC = () => {
  const shopfloorEvents = [
    { name: 'PLC Sensor Strokes', icon: 'memory', color: '#0A4174' },
    { name: 'Operator Output Tally', icon: 'devices', color: '#059669' },
    { name: 'Downtime & Stoppage Codes', icon: 'report_problem', color: '#DC2626' },
    { name: 'Quality Inspection Results', icon: 'verified', color: '#0284C7' },
    { name: 'Shift Handover Notes', icon: 'assignment', color: '#D97706' },
  ];

  const outcomes = [
    { title: 'Instant Bottleneck Alleviation', desc: 'Rebalance production lines before starvation occurs' },
    { title: 'Automated Root-Cause OEE', desc: 'Eliminate chronic micro-stoppages with hard telemetry' },
    { title: 'Proactive Maintenance', desc: 'Schedule tooling swaps based on actual machine cycle strokes' },
    { title: 'Audit-Ready Traceability', desc: 'Export certified batch genealogy reports in one click' },
  ];

  return (
    <section className="fv-section-py" style={{ backgroundColor: '#FFFFFF' }}>
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
          <p className="fv-section-desc" style={{ margin: '0 auto', color: '#334155' }}>
            Transform scattered shopfloor noise into high-fidelity operational decisions.
            Continuous event streams power real-time dashboards and instant countermeasures.
          </p>
        </div>

        {/* Data Pipeline Flow Diagram */}
        <div
          className="fv-card"
          style={{
            padding: '36px',
            backgroundColor: '#FFFFFF',
            position: 'relative',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto 1.2fr auto 1fr',
              gap: '20px',
              alignItems: 'center',
            }}
            className="fv-pipeline-grid"
          >
            {/* Step 1: Shopfloor Signals */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ fontSize: '12px', fontWeight: 800, color: '#64748B', textTransform: 'uppercase', marginBottom: '4px' }}>
                01 Shopfloor Events
              </div>
              {shopfloorEvents.map((ev) => (
                <div
                  key={ev.name}
                  style={{
                    backgroundColor: '#F8FAFC',
                    border: '1px solid #E2E8F0',
                    borderRadius: '12px',
                    padding: '12px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: '#001D39',
                  }}
                >
                  <Icon name={ev.icon} size={18} color={ev.color} />
                  <span>{ev.name}</span>
                </div>
              ))}
            </div>

            {/* Arrow 1 */}
            <div style={{ textAlign: 'center', color: '#0A4174' }} className="fv-pipeline-arrow">
              <Icon name="arrow_forward" size={32} />
            </div>

            {/* Step 2: Factory Vision Engine */}
            <motion.div
              initial={{ scale: 0.96 }}
              whileInView={{ scale: 1 }}
              viewport={{ once: true }}
              style={{
                background: 'linear-gradient(135deg, #001D39 0%, #0A4174 100%)',
                color: '#FFFFFF',
                borderRadius: '24px',
                padding: '36px 24px',
                textAlign: 'center',
                boxShadow: '0 16px 36px rgba(10, 65, 116, 0.3)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
              }}
            >
              <Icon name="insights" size={42} style={{ marginBottom: '12px', color: '#FFFFFF' }} />
              <h4 style={{ fontSize: '22px', fontWeight: 800, marginBottom: '6px' }}>
                FACTORY VISION
              </h4>
              <div style={{ fontSize: '13px', opacity: 0.95, lineHeight: 1.4, marginBottom: '16px', color: '#FFFFFF' }}>
                Real-Time Event Processing & Calculation Engine
              </div>
              <div
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.15)',
                  padding: '8px 16px',
                  borderRadius: '9999px',
                  fontSize: '12px',
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  display: 'inline-block',
                  color: '#FFFFFF',
                }}
              >
                &lt; 100ms Ingestion Latency
              </div>
            </motion.div>

            {/* Arrow 2 */}
            <div style={{ textAlign: 'center', color: '#0A4174' }} className="fv-pipeline-arrow">
              <Icon name="arrow_forward" size={32} />
            </div>

            {/* Step 3: Actionable Decisions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ fontSize: '12px', fontWeight: 800, color: '#64748B', textTransform: 'uppercase', marginBottom: '4px' }}>
                02 Better Decisions
              </div>
              {outcomes.map((out) => (
                <div
                  key={out.title}
                  style={{
                    backgroundColor: '#F8FAFC',
                    border: '1px solid #E2E8F0',
                    borderRadius: '12px',
                    padding: '12px 14px',
                  }}
                >
                  <div style={{ fontWeight: 800, fontSize: '13px', color: '#0A4174', marginBottom: '2px' }}>
                    {out.title}
                  </div>
                  <div style={{ fontSize: '11px', color: '#334155', lineHeight: 1.35 }}>
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
