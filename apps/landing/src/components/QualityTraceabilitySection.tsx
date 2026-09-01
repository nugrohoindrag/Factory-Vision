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
    <section className="fv-section-py" style={{ backgroundColor: '#001D39', color: '#FFFFFF' }}>
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
            padding: '36px',
            backgroundColor: '#FFFFFF',
            display: 'grid',
            gridTemplateColumns: '1fr 1.1fr',
            gap: '36px',
            alignItems: 'center',
          }}
        >
          {/* Left: Quality Workflow & Sample Lot Card */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div>
              <h3 style={{ fontSize: '26px', fontWeight: 800, color: '#001D39', marginBottom: '8px' }}>
                Complete Batch Genealogy Trace
              </h3>
              <p style={{ fontSize: '15px', color: '#334155', lineHeight: 1.55 }}>
                Track exactly which operator, machine, tool, and raw batch went into every serial number.
              </p>
            </div>

            {/* Live Sample Batch Trace Card */}
            <div
              style={{
                backgroundColor: '#F8FAFC',
                border: '1px solid #E2E8F0',
                borderRadius: '16px',
                padding: '24px',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <span style={{ fontSize: '11px', color: '#64748B', fontWeight: 700, textTransform: 'uppercase' }}>
                    INSPECTED BATCH
                  </span>
                  <div style={{ fontSize: '18px', fontWeight: 800, color: '#001D39' }}>
                    #LOT-2026-0881 (Aluminium 6061-T6)
                  </div>
                </div>
                <span
                  style={{
                    backgroundColor: '#ECFDF5',
                    color: '#059669',
                    border: '1px solid #A7F3D0',
                    padding: '4px 12px',
                    borderRadius: '9999px',
                    fontSize: '12px',
                    fontWeight: 800,
                  }}
                >
                  PASSED QC
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                <div style={{ backgroundColor: '#FFFFFF', padding: '12px', borderRadius: '10px', border: '1px solid #E2E8F0' }}>
                  <div style={{ fontSize: '11px', color: '#64748B', fontWeight: 600 }}>Inspected</div>
                  <div style={{ fontSize: '16px', fontWeight: 800, color: '#001D39' }}>150 pcs</div>
                </div>
                <div style={{ backgroundColor: '#FFFFFF', padding: '12px', borderRadius: '10px', border: '1px solid #E2E8F0' }}>
                  <div style={{ fontSize: '11px', color: '#64748B', fontWeight: 600 }}>Defect Rate</div>
                  <div style={{ fontSize: '16px', fontWeight: 800, color: '#059669' }}>0.00%</div>
                </div>
                <div style={{ backgroundColor: '#FFFFFF', padding: '12px', borderRadius: '10px', border: '1px solid #E2E8F0' }}>
                  <div style={{ fontSize: '11px', color: '#64748B', fontWeight: 600 }}>Inspector</div>
                  <div style={{ fontSize: '16px', fontWeight: 800, color: '#0A4174' }}>QC Station 1</div>
                </div>
              </div>
            </div>

            {/* Quality Workflow Checklist */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {steps.map((st, i) => (
                <div key={st.title} style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                  <div
                    style={{
                      width: '24px',
                      height: '24px',
                      borderRadius: '50%',
                      backgroundColor: '#F0F9FF',
                      color: '#0A4174',
                      border: '1px solid #BAE6FD',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '12px',
                      fontWeight: 800,
                      flexShrink: 0,
                      marginTop: '2px',
                    }}
                  >
                    {i + 1}
                  </div>
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: '#001D39' }}>
                      {st.title}
                    </div>
                    <div style={{ fontSize: '12px', color: '#334155' }}>
                      {st.desc}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Inspection Photo & Screenshot */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
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
                  background: 'linear-gradient(180deg, transparent 40%, rgba(0, 29, 57, 0.85) 100%)',
                }}
              />
              <div style={{ position: 'absolute', bottom: '16px', left: '16px', color: '#FFFFFF' }}>
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
