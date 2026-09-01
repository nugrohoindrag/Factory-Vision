import React from 'react';
import { motion } from 'motion/react';
import { Icon } from '@factory-vision/ui';

export const QualityTraceabilitySection: React.FC = () => {
  const steps = [
    { title: 'Work Order Bound', desc: 'Inspection criteria automatically loaded from SKU specs' },
    { title: 'Batch / Lot Assignment', desc: 'Raw material heat number & supplier lot verification' },
    { title: 'In-Line Quality Check', desc: 'Dimensional sampling & digital checksheets' },
    { title: 'Defect Tagging & Quarantine', desc: 'Instant defect categorization & hold trigger' },
    { title: 'End-to-End Genealogy', desc: 'Forward & backward trace report for audit compliance' },
  ];

  return (
    <section className="fv-section-py" style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-on-primary)' }}>
      <div className="fv-landing-container">
        {/* Header */}
        <div style={{ textAlign: 'center', maxWidth: '800px', margin: '0 auto 48px' }}>
          <div className="fv-eyebrow-on-blue">
            <Icon name="verified" size={16} />
            Built-In Quality & Traceability
          </div>
          <h2 className="fv-section-title-on-blue">
            Quality Is Part of Production
          </h2>
          <p className="fv-section-desc-on-blue" style={{ margin: '0 auto' }}>
            Never rely on disconnected paper checksheets. Factory Vision enforces quality checkpoints directly inside the
            operator workflow and preserves complete lot genealogy from raw coils to finished pallets.
          </p>
        </div>

        {/* 2-Column Showcase */}
        <div
          className="fv-card-on-blue"
          style={{
            padding: 'var(--space-10)',
            backgroundColor: 'var(--color-surface)',
            display: 'grid',
            gridTemplateColumns: '1fr 1.1fr',
            gap: 'var(--space-10)',
            alignItems: 'center',
          }}
        >
          {/* Left: Quality Workflow & Sample Lot Card */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
            <div>
              <h3 style={{ fontSize: '26px', fontWeight: 800, color: 'var(--color-primary)', marginBottom: 'var(--space-2)' }}>
                Complete Batch Genealogy Trace
              </h3>
              <p style={{ fontSize: '15px', color: 'var(--color-on-surface)', lineHeight: 1.55 }}>
                Track exactly which operator, machine, tool, and raw batch went into every serial number.
              </p>
            </div>

            {/* Live Sample Batch Trace Card */}
            <div
              style={{
                backgroundColor: 'var(--color-surface-container-low)',
                border: '1px solid var(--color-outline-variant)',
                borderRadius: '16px',
                padding: 'var(--space-6)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-4)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <span style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)', fontWeight: 700, textTransform: 'uppercase' }}>
                    INSPECTED BATCH
                  </span>
                  <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
                    #LOT-2026-0881 (Aluminium 6061-T6)
                  </div>
                </div>
                <span
                  style={{
                    backgroundColor: 'var(--color-success-container)',
                    color: 'var(--color-on-success-container)',
                    border: '1px solid var(--color-success-container)',
                    padding: `var(--space-1) var(--space-3)`,
                    borderRadius: '9999px',
                    fontSize: '12px',
                    fontWeight: 800,
                  }}
                >
                  PASSED QC
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-3)' }}>
                <div style={{ backgroundColor: 'var(--color-surface)', padding: 'var(--space-3)', borderRadius: '10px', border: '1px solid var(--color-outline-variant)' }}>
                  <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)', fontWeight: 600 }}>Inspected</div>
                  <div style={{ fontSize: '16px', fontWeight: 800, color: 'var(--color-on-surface)' }}>150 pcs</div>
                </div>
                <div style={{ backgroundColor: 'var(--color-surface)', padding: 'var(--space-3)', borderRadius: '10px', border: '1px solid var(--color-outline-variant)' }}>
                  <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)', fontWeight: 600 }}>Defect Rate</div>
                  <div style={{ fontSize: '16px', fontWeight: 800, color: 'var(--color-success)' }}>0.00%</div>
                </div>
                <div style={{ backgroundColor: 'var(--color-surface)', padding: 'var(--space-3)', borderRadius: '10px', border: '1px solid var(--color-outline-variant)' }}>
                  <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)', fontWeight: 600 }}>Inspector</div>
                  <div style={{ fontSize: '16px', fontWeight: 800, color: 'var(--color-primary)' }}>QC Station 1</div>
                </div>
              </div>
            </div>

            {/* Quality Workflow Checklist */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {steps.map((st, i) => (
                <div key={st.title} style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
                  <div
                    style={{
                      width: '24px',
                      height: '24px',
                      borderRadius: '50%',
                      backgroundColor: 'var(--color-info-container)',
                      color: 'var(--color-on-info-container)',
                      border: '1px solid var(--color-info-container)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '12px',
                      fontWeight: 800,
                      flexShrink: 0,
                      marginTop: 'var(--space-1)',
                    }}
                  >
                    {i + 1}
                  </div>
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--color-on-surface)' }}>
                      {st.title}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
                      {st.desc}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Inspection Photo & Screenshot */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            <div style={{ position: 'relative', borderRadius: '16px', overflow: 'hidden', height: '220px' }}>
              <img
                src="/assets/quality/quality-control-lab.jpg"
                alt="Quality Inspection Lab"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'linear-gradient(180deg, transparent 40%, var(--color-media-scrim) 100%)',
                }}
              />
              <div style={{ position: 'absolute', bottom: '16px', left: '16px', color: 'var(--color-on-primary)' }}>
                <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.9 }}>
                  In-Line Metrology Station
                </span>
                <div style={{ fontSize: '16px', fontWeight: 800 }}>Zero-Defect Manufacturing Protocol</div>
              </div>
            </div>

            <div className="fv-browser-frame">
              <div className="fv-browser-header">
                <div className="fv-browser-dots">
                  <span className="fv-browser-dot" />
                  <span className="fv-browser-dot" />
                  <span className="fv-browser-dot" />
                </div>
                <div className="fv-browser-address-bar">
                  <Icon name="verified" size={12} />
                  <span>app.factoryvision.io/quality-traceability</span>
                </div>
              </div>
              <div className="fv-browser-body">
                <img
                  src="/screenshots/08-bottlenecks.png"
                  alt="Quality Analysis Screenshot"
                  className="fv-browser-img"
                  loading="lazy"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 960px) {
          .fv-quality-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
};
