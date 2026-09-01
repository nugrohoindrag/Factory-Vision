import React from 'react';
import { motion } from 'motion/react';
import { Icon } from '@factory-vision/ui';
import { FactoryVisionIcon } from '@factory-vision/ui/fv';

export const OverviewSection: React.FC = () => {
  return (
    <section className="fv-section-py" style={{ backgroundColor: 'var(--color-surface)' }}>
      <div className="fv-landing-container">
        {/* Header */}
        <div style={{ textAlign: 'center', maxWidth: '800px', margin: '0 auto 48px' }}>
          <div className="fv-eyebrow">
            <Icon name="hub" size={16} />
            Unified Ecosystem
          </div>
          <h2 className="fv-section-title">
            One Operational View of Your Factory
          </h2>
          <p className="fv-section-desc" style={{ margin: '0 auto', color: 'var(--color-on-surface-variant)' }}>
            Break down manufacturing data silos. Factory Vision synchronizes planning, machine sensors,
            operator actions, and quality inspections into a single synchronized digital nervous system.
          </p>
        </div>

        {/* Visual Ecosystem Architecture Diagram */}
        <div
          className="fv-card"
          style={{
            padding: 'var(--space-10)',
            backgroundColor: 'var(--color-surface)',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {/* Top Level: Central Engine */}
          <div style={{ textAlign: 'center', marginBottom: 'var(--space-10)', position: 'relative' }}>
            <div
              style={{
                display: 'inline-flex',
                flexDirection: 'column',
                alignItems: 'center',
                background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary) 100%)',
                color: 'var(--color-on-primary)',
                padding: `var(--space-5) var(--space-12)`,
                borderRadius: '24px',
                boxShadow: 'var(--elevation-3)',
                border: '1px solid color-mix(in srgb, var(--color-on-primary) 20%, transparent)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
                <FactoryVisionIcon size={28} />
                <span style={{ fontSize: '22px', fontWeight: 800, letterSpacing: '0.03em' }}>
                  FACTORY VISION
                </span>
              </div>
              <span style={{ fontSize: '12px', opacity: 0.95, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600, color: 'var(--color-on-primary)' }}>
                Real-Time MES Intelligence Engine
              </span>
            </div>
          </div>

          {/* 3 Main Pillars Grid */}
          <div className="fv-grid-3" style={{ position: 'relative', zIndex: 1, marginBottom: 'var(--space-8)' }}>
            {/* Pillar 1: Production */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="fv-card"
              style={{ padding: 'var(--space-6)', backgroundColor: 'var(--color-surface-container-low)', border: '1px solid var(--color-outline-variant)' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
                <div
                  style={{
                    width: '42px',
                    height: '42px',
                    borderRadius: '12px',
                    backgroundColor: 'var(--color-info-container)',
                    color: 'var(--color-on-info-container)',
                    border: '1px solid var(--color-info-container)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon name="assignment" size={22} />
                </div>
                <div>
                  <h4 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--color-primary)' }}>Production</h4>
                  <span style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)', fontWeight: 600 }}>Orders & Planning</span>
                </div>
              </div>
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {['Production Orders', 'Work Order Scheduling', 'Batch & Lot Control', 'Bill of Materials (BOM)', 'Routing & WIP Progress'].map((item) => (
                  <li
                    key={item}
                    style={{
                      fontSize: '13px',
                      color: 'var(--color-on-surface-variant)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-2)',
                      fontWeight: 500,
                    }}
                  >
                    <Icon name="check_circle" size={16} color="var(--color-primary)" />
                    {item}
                  </li>
                ))}
              </ul>
            </motion.div>

            {/* Pillar 2: Machines */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="fv-card"
              style={{ padding: 'var(--space-6)', backgroundColor: 'var(--color-surface-container-low)', border: '1px solid var(--color-outline-variant)' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
                <div
                  style={{
                    width: '42px',
                    height: '42px',
                    borderRadius: '12px',
                    backgroundColor: 'var(--color-info-container)',
                    color: 'var(--color-on-info-container)',
                    border: '1px solid var(--color-info-container)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon name="precision_manufacturing" size={22} />
                </div>
                <div>
                  <h4 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--color-primary)' }}>Machines</h4>
                  <span style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)', fontWeight: 600 }}>Edge Telemetry</span>
                </div>
              </div>
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {['Real-Time Running / Idle / Down', 'Edge PLC & Sensor Ingestion', 'Automated Downtime Tagging', 'Cycle Time Monitoring', 'Maintenance & Spares Alert'].map((item) => (
                  <li
                    key={item}
                    style={{
                      fontSize: '13px',
                      color: 'var(--color-on-surface-variant)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-2)',
                      fontWeight: 500,
                    }}
                  >
                    <Icon name="check_circle" size={16} color="var(--color-info)" />
                    {item}
                  </li>
                ))}
              </ul>
            </motion.div>

            {/* Pillar 3: People */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2 }}
              className="fv-card"
              style={{ padding: 'var(--space-6)', backgroundColor: 'var(--color-surface-container-low)', border: '1px solid var(--color-outline-variant)' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
                <div
                  style={{
                    width: '42px',
                    height: '42px',
                    borderRadius: '12px',
                    backgroundColor: 'var(--color-success-container)',
                    color: 'var(--color-on-success-container)',
                    border: '1px solid var(--color-success-container)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon name="group" size={22} />
                </div>
                <div>
                  <h4 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--color-primary)' }}>People</h4>
                  <span style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)', fontWeight: 600 }}>Shopfloor Workforce</span>
                </div>
              </div>
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {['Touchscreen Operator Terminal', 'Shift Setup & Handover Logs', 'Activity & Task Logging', 'Skills & Station Authorization', 'Real-Time Andon Call System'].map((item) => (
                  <li
                    key={item}
                    style={{
                      fontSize: '13px',
                      color: 'var(--color-on-surface-variant)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-2)',
                      fontWeight: 500,
                    }}
                  >
                    <Icon name="check_circle" size={16} color="var(--color-success)" />
                    {item}
                  </li>
                ))}
              </ul>
            </motion.div>
          </div>

          {/* Bottom Aggregate Layer: Quality, OEE & Insights */}
          <div
            style={{
              borderTop: '1px solid var(--color-outline-variant)',
              paddingTop: 'var(--space-8)',
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 'var(--space-4)',
            }}
            className="fv-overview-bottom-grid"
          >
            <div
              style={{
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-outline-variant)',
                borderRadius: '16px',
                padding: `var(--space-4) var(--space-5)`,
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-4)',
                boxShadow: 'var(--fv-card-shadow)',
              }}
            >
              <div
                style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '10px',
                  backgroundColor: 'var(--color-info-container)',
                  color: 'var(--color-on-info-container)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Icon name="verified" size={20} />
              </div>
              <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--color-on-surface)' }}>
                Quality Control & Traceability
              </span>
            </div>

            <div
              style={{
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-outline-variant)',
                borderRadius: '16px',
                padding: `var(--space-4) var(--space-5)`,
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-4)',
                boxShadow: 'var(--fv-card-shadow)',
              }}
            >
              <div
                style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '10px',
                  backgroundColor: 'var(--color-success-container)',
                  color: 'var(--color-on-success-container)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Icon name="analytics" size={20} />
              </div>
              <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--color-on-surface)' }}>
                OEE & Loss Categorization
              </span>
            </div>

            <div
              style={{
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-outline-variant)',
                borderRadius: '16px',
                padding: `var(--space-4) var(--space-5)`,
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-4)',
                boxShadow: 'var(--fv-card-shadow)',
              }}
            >
              <div
                style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '10px',
                  backgroundColor: 'var(--color-info-container)',
                  color: 'var(--color-on-info-container)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Icon name="insights" size={20} />
              </div>
              <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--color-on-surface)' }}>
                Factory-Wide Actionable Insights
              </span>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 900px) {
          .fv-overview-bottom-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
};
