import React from 'react';
import { motion } from 'motion/react';
import { Icon } from '@factory-vision/ui';

export const LiveProductionSection: React.FC = () => {
  const steps = [
    { num: '01', title: 'Production Order', desc: 'ERP order released to plant' },
    { num: '02', title: 'Work Order', desc: 'Assigned to line & shift schedule' },
    { num: '03', title: 'Operator Execution', desc: 'One-tap job start on tablet terminal' },
    { num: '04', title: 'Machine Activity', desc: 'Sensors log cycle times & strokes' },
    { num: '05', title: 'Output & Quality', desc: 'Good vs reject tally with digital QC' },
    { num: '06', title: 'Performance Analytics', desc: 'Instant OEE & cost calculation' },
  ];

  return (
    <section id="shopfloor" className="fv-section-py" style={{ backgroundColor: 'var(--color-surface)' }}>
      <div className="fv-landing-container">
        {/* Header */}
        <div style={{ textAlign: 'center', maxWidth: '800px', margin: '0 auto 48px' }}>
          <div className="fv-eyebrow">
            <Icon name="play_arrow" size={16} />
            Shopfloor Execution
          </div>
          <h2 className="fv-section-title">
            From Production Order to Actual Production
          </h2>
          <p className="fv-section-desc" style={{ margin: '0 auto', color: 'var(--color-on-surface-variant)' }}>
            Give operators a simple, distraction-free interface to execute production, record output,
            report downtime, and capture shopfloor events in real time.
          </p>
        </div>

        {/* Workflow Pipeline Steps */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(6, 1fr)',
            gap: 'var(--space-4)',
            marginBottom: 'var(--space-12)',
          }}
          className="fv-workflow-steps"
        >
          {steps.map((s, idx) => (
            <motion.div
              key={s.num}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: idx * 0.08 }}
              className="fv-card"
              style={{
                backgroundColor: 'var(--color-surface)',
                padding: `var(--space-5) var(--space-4)`,
                position: 'relative',
              }}
            >
              <div
                style={{
                  fontSize: '12px',
                  fontWeight: 800,
                  color: 'var(--color-on-info-container)',
                  backgroundColor: 'var(--color-info-container)',
                  border: '1px solid var(--color-info-container)',
                  padding: `var(--space-1) var(--space-2)`,
                  borderRadius: '9999px',
                  display: 'inline-block',
                  marginBottom: 'var(--space-2)',
                }}
              >
                STEP {s.num}
              </div>
              <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--color-on-surface)', marginBottom: 'var(--space-1)' }}>
                {s.title}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)', lineHeight: 1.35 }}>
                {s.desc}
              </div>
            </motion.div>
          ))}
        </div>

        {/* Live Operator Terminal Spotlight */}
        <div
          className="fv-card fv-live-production-grid"
          style={{
            padding: 'var(--space-10)',
            backgroundColor: 'var(--color-surface)',
            display: 'grid',
            gridTemplateColumns: '1.15fr 0.85fr',
            gap: 'var(--space-10)',
            alignItems: 'center',
          }}
        >
          {/* Left: Terminal Mockup */}
          <div>
            <div className="fv-browser-frame">
              <div className="fv-browser-header">
                <div className="fv-browser-dots">
                  <span className="fv-browser-dot" />
                  <span className="fv-browser-dot" />
                  <span className="fv-browser-dot" />
                </div>
                <div className="fv-browser-address-bar">
                  <Icon name="devices" size={14} />
                  <span>terminal.factoryvision.io/station-cnc-02</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <span className="fv-status-dot running" />
                  <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--color-success)' }}>RUNNING</span>
                </div>
              </div>
              <div className="fv-browser-body">
                <img
                  src="/screenshots/20-operator-terminal.png"
                  alt="Factory Vision Operator Terminal"
                  className="fv-browser-img"
                  loading="lazy"
                />
              </div>
            </div>
          </div>

          {/* Right: Operational Details & Live Counters */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            <div>
              <span
                style={{
                  fontSize: '12px',
                  fontWeight: 700,
                  color: 'var(--color-on-info-container)',
                  backgroundColor: 'var(--color-info-container)',
                  border: '1px solid var(--color-info-container)',
                  padding: `var(--space-1) var(--space-3)`,
                  borderRadius: '9999px',
                  textTransform: 'uppercase',
                }}
              >
                Touch-Optimized Operator Terminal
              </span>
              <h3 style={{ fontSize: '26px', fontWeight: 800, margin: `var(--space-3) 0 var(--space-2)`, color: 'var(--color-primary)' }}>
                Built for High-Speed Shopfloor Entry
              </h3>
              <p style={{ fontSize: '15px', color: 'var(--color-on-surface)', lineHeight: 1.55 }}>
                Large touch targets, zero complicated forms, and immediate visual feedback.
                Operators can log production output in under 3 seconds without leaving their workstation.
              </p>
            </div>

            {/* Live Telemetry Tally Box */}
            <div
              style={{
                backgroundColor: 'var(--color-surface-container-low)',
                border: '1px solid var(--color-outline-variant)',
                borderRadius: '16px',
                padding: 'var(--space-5)',
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 'var(--space-4)',
                textAlign: 'center',
              }}
            >
              <div>
                <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)', fontWeight: 700 }}>
                  GOOD OUTPUT
                </div>
                <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--color-success)' }} className="fv-num">
                  3,820 <span style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>pcs</span>
                </div>
              </div>
              <div>
                <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)', fontWeight: 700 }}>
                  SCRAP / DEFECT
                </div>
                <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--color-error)' }} className="fv-num">
                  14 <span style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>pcs</span>
                </div>
              </div>
              <div>
                <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)', fontWeight: 700 }}>
                  PROGRESS
                </div>
                <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--color-primary)' }} className="fv-num">
                  85.2%
                </div>
              </div>
            </div>

            {/* Feature Highlights */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', fontSize: '14px', color: 'var(--color-on-surface)' }}>
                <Icon name="check_circle" size={18} color="var(--color-primary)" />
                <span>Single-tap output and scrap increments with audio confirmation</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', fontSize: '14px', color: 'var(--color-on-surface)' }}>
                <Icon name="report_problem" size={18} color="var(--color-warning)" />
                <span>Instant downtime tagging (No Material, Tool Change, Breakdown, Setup)</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', fontSize: '14px', color: 'var(--color-on-surface)' }}>
                <Icon name="verified" size={18} color="var(--color-success)" />
                <span>Offline-resilient caching with automatic background sync upon reconnection</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 1024px) {
          .fv-workflow-steps {
            grid-template-columns: repeat(3, 1fr) !important;
          }
          .fv-live-production-grid {
            grid-template-columns: 1fr !important;
          }
        }
        @media (max-width: 640px) {
          .fv-workflow-steps {
            grid-template-columns: repeat(2, 1fr) !important;
          }
        }
      `}</style>
    </section>
  );
};
