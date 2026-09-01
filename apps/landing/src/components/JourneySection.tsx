import React from 'react';
import { motion } from 'motion/react';
import { Icon } from '@factory-vision/ui';

export const JourneySection: React.FC = () => {
  const steps = [
    { title: 'Customer Order', status: 'completed', desc: '#SO-10294 (4,500 pcs) ingested from ERP' },
    { title: 'PPIC Planning', status: 'completed', desc: 'Auto-scheduled to Line A across 3 shifts' },
    { title: 'Work Order Dispatch', status: 'completed', desc: 'BOM & tooling parameters released to CNC-01 & 02' },
    { title: 'Shopfloor Execution', status: 'active', desc: '3,820 / 4,500 pcs produced (84.7%)' },
    { title: 'Quality Verification', status: 'active', desc: '3,760 pcs accepted (0.3% scrap rate)' },
    { title: 'Packing & Dispatch', status: 'pending', desc: 'Pallet barcode generation & ERP closeout' },
  ];

  return (
    <section className="fv-section-py" style={{ backgroundColor: 'var(--color-surface)' }}>
      <div className="fv-landing-container">
        {/* Header */}
        <div style={{ textAlign: 'center', maxWidth: '800px', margin: '0 auto 48px' }}>
          <div className="fv-eyebrow">
            <Icon name="trending_up" size={16} />
            Lifecycle Journey
          </div>
          <h2 className="fv-section-title">
            Follow Every Order Through the Factory
          </h2>
          <p className="fv-section-desc" style={{ margin: '0 auto', color: 'var(--color-on-surface-variant)' }}>
            Get complete visibility from customer sales order intake down to machine execution, quality inspection,
            and final warehouse dispatch.
          </p>
        </div>

        {/* Interactive Order Progress Card */}
        <div
          className="fv-card"
          style={{
            padding: 'var(--space-10)',
            backgroundColor: 'var(--color-surface)',
            maxWidth: '1000px',
            margin: '0 auto',
          }}
        >
          {/* Order Header Summary */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingBottom: 'var(--space-6)',
              borderBottom: '1px solid var(--color-outline-variant)',
              marginBottom: 'var(--space-8)',
              flexWrap: 'wrap',
              gap: 'var(--space-3)',
            }}
          >
            <div>
              <span style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)', fontWeight: 700, textTransform: 'uppercase' }}>
                TRACKING ACTIVE SALES ORDER
              </span>
              <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
                #SO-10294 · Precision Flange Assembly
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <span
                style={{
                  backgroundColor: 'var(--color-info-container)',
                  color: 'var(--color-primary)',
                  border: '1px solid var(--color-info-container)',
                  padding: `var(--space-2) var(--space-4)`,
                  borderRadius: '9999px',
                  fontSize: '13px',
                  fontWeight: 800,
                }}
              >
                In Production (84.7%)
              </span>
            </div>
          </div>

          {/* Timeline 6 Stages */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {steps.map((st, idx) => {
              const isCompleted = st.status === 'completed';
              const isActive = st.status === 'active';

              const badgeColor = isCompleted
                ? 'var(--color-success)'
                : isActive
                ? 'var(--color-primary)'
                : 'var(--color-on-surface-variant)';

              const badgeBg = isCompleted
                ? 'var(--color-success-container)'
                : isActive
                ? 'var(--color-info-container)'
                : 'var(--color-surface-container-low)';

              const badgeBorder = isCompleted
                ? 'var(--color-success-container)'
                : isActive
                ? 'var(--color-info-container)'
                : 'var(--color-outline-variant)';

              return (
                <motion.div
                  key={st.title}
                  initial={{ opacity: 0, x: -16 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: idx * 0.08 }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: `var(--space-4) var(--space-5)`,
                    backgroundColor: 'var(--color-surface-container-low)',
                    border: '1px solid var(--color-outline-variant)',
                    borderRadius: '14px',
                    gap: 'var(--space-4)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
                    <div
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '50%',
                        backgroundColor: badgeBg,
                        color: badgeColor,
                        border: `1px solid ${badgeBorder}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '13px',
                        fontWeight: 800,
                        flexShrink: 0,
                      }}
                    >
                      {isCompleted ? <Icon name="check" size={16} /> : idx + 1}
                    </div>
                    <div>
                      <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
                        {st.title}
                      </div>
                      <div style={{ fontSize: '13px', color: 'var(--color-on-surface-variant)' }}>
                        {st.desc}
                      </div>
                    </div>
                  </div>

                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 800,
                      textTransform: 'uppercase',
                      padding: `var(--space-1) var(--space-3)`,
                      borderRadius: '9999px',
                      backgroundColor: badgeBg,
                      color: badgeColor,
                      border: `1px solid ${badgeBorder}`,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {st.status}
                  </span>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
};
