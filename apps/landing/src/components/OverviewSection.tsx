import React from 'react';
import { motion } from 'motion/react';
import { Icon } from '@factory-vision/ui';
import { FactoryVisionIcon } from '@factory-vision/ui/fv';

export const OverviewSection: React.FC = () => {
  return (
    <section className="fv-section-py" style={{ backgroundColor: '#FFFFFF' }}>
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
          <p className="fv-section-desc" style={{ margin: '0 auto', color: '#334155' }}>
            Break down manufacturing data silos. Factory Vision synchronizes planning, machine sensors,
            operator actions, and quality inspections into a single synchronized digital nervous system.
          </p>
        </div>

        {/* Visual Ecosystem Architecture Diagram */}
        <div
          className="fv-card"
          style={{
            padding: '36px',
            backgroundColor: '#FFFFFF',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {/* Top Level: Central Engine */}
          <div style={{ textAlign: 'center', marginBottom: '36px', position: 'relative' }}>
            <div
              style={{
                display: 'inline-flex',
                flexDirection: 'column',
                alignItems: 'center',
                background: 'linear-gradient(135deg, #001D39 0%, #0A4174 100%)',
                color: '#FFFFFF',
                padding: '20px 44px',
                borderRadius: '24px',
                boxShadow: '0 12px 30px rgba(10, 65, 116, 0.25)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px' }}>
                <FactoryVisionIcon size={28} />
                <span style={{ fontSize: '22px', fontWeight: 800, letterSpacing: '0.03em' }}>
                  FACTORY VISION
                </span>
              </div>
              <span style={{ fontSize: '12px', opacity: 0.95, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600, color: '#FFFFFF' }}>
                Real-Time MES Intelligence Engine
              </span>
            </div>
          </div>

          {/* 3 Main Pillars Grid */}
          <div className="fv-grid-3" style={{ position: 'relative', zIndex: 1, marginBottom: '32px' }}>
            {/* Pillar 1: Production */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="fv-card"
              style={{ padding: '24px', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                <div
                  style={{
                    width: '42px',
                    height: '42px',
                    borderRadius: '12px',
                    backgroundColor: '#F0F9FF',
                    color: '#0A4174',
                    border: '1px solid #BAE6FD',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon name="assignment" size={22} />
                </div>
                <div>
                  <h4 style={{ fontSize: '18px', fontWeight: 800, color: '#001D39' }}>Production</h4>
                  <span style={{ fontSize: '12px', color: '#64748B', fontWeight: 600 }}>Orders & Planning</span>
                </div>
              </div>
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {['Production Orders', 'Work Order Scheduling', 'Batch & Lot Control', 'Bill of Materials (BOM)', 'Routing & WIP Progress'].map((item) => (
                  <li
                    key={item}
                    style={{
                      fontSize: '13px',
                      color: '#334155',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontWeight: 500,
                    }}
                  >
                    <Icon name="check_circle" size={16} color="#0A4174" />
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
              style={{ padding: '24px', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                <div
                  style={{
                    width: '42px',
                    height: '42px',
                    borderRadius: '12px',
                    backgroundColor: '#F0F9FF',
                    color: '#0284C7',
                    border: '1px solid #BAE6FD',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon name="precision_manufacturing" size={22} />
                </div>
                <div>
                  <h4 style={{ fontSize: '18px', fontWeight: 800, color: '#001D39' }}>Machines</h4>
                  <span style={{ fontSize: '12px', color: '#64748B', fontWeight: 600 }}>Edge Telemetry</span>
                </div>
              </div>
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {['Real-Time Running / Idle / Down', 'Edge PLC & Sensor Ingestion', 'Automated Downtime Tagging', 'Cycle Time Monitoring', 'Maintenance & Spares Alert'].map((item) => (
                  <li
                    key={item}
                    style={{
                      fontSize: '13px',
                      color: '#334155',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontWeight: 500,
                    }}
                  >
                    <Icon name="check_circle" size={16} color="#0284C7" />
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
              style={{ padding: '24px', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                <div
                  style={{
                    width: '42px',
                    height: '42px',
                    borderRadius: '12px',
                    backgroundColor: '#ECFDF5',
                    color: '#059669',
                    border: '1px solid #A7F3D0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon name="group" size={22} />
                </div>
                <div>
                  <h4 style={{ fontSize: '18px', fontWeight: 800, color: '#001D39' }}>People</h4>
                  <span style={{ fontSize: '12px', color: '#64748B', fontWeight: 600 }}>Shopfloor Workforce</span>
                </div>
              </div>
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {['Touchscreen Operator Terminal', 'Shift Setup & Handover Logs', 'Activity & Task Logging', 'Skills & Station Authorization', 'Real-Time Andon Call System'].map((item) => (
                  <li
                    key={item}
                    style={{
                      fontSize: '13px',
                      color: '#334155',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontWeight: 500,
                    }}
                  >
                    <Icon name="check_circle" size={16} color="#059669" />
                    {item}
                  </li>
                ))}
              </ul>
            </motion.div>
          </div>

          {/* Bottom Aggregate Layer: Quality, OEE & Insights */}
          <div
            style={{
              borderTop: '1px solid #E2E8F0',
              paddingTop: '28px',
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '16px',
            }}
            className="fv-overview-bottom-grid"
          >
            <div
              style={{
                backgroundColor: '#FFFFFF',
                border: '1px solid #E2E8F0',
                borderRadius: '16px',
                padding: '16px 20px',
                display: 'flex',
                alignItems: 'center',
                gap: '14px',
                boxShadow: 'var(--fv-card-shadow)',
              }}
            >
              <div
                style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '10px',
                  backgroundColor: '#F0F9FF',
                  color: '#0A4174',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Icon name="verified" size={20} />
              </div>
              <span style={{ fontSize: '14px', fontWeight: 700, color: '#001D39' }}>
                Quality Control & Traceability
              </span>
            </div>

            <div
              style={{
                backgroundColor: '#FFFFFF',
                border: '1px solid #E2E8F0',
                borderRadius: '16px',
                padding: '16px 20px',
                display: 'flex',
                alignItems: 'center',
                gap: '14px',
                boxShadow: 'var(--fv-card-shadow)',
              }}
            >
              <div
                style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '10px',
                  backgroundColor: '#ECFDF5',
                  color: '#059669',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Icon name="analytics" size={20} />
              </div>
              <span style={{ fontSize: '14px', fontWeight: 700, color: '#001D39' }}>
                OEE & Loss Categorization
              </span>
            </div>

            <div
              style={{
                backgroundColor: '#FFFFFF',
                border: '1px solid #E2E8F0',
                borderRadius: '16px',
                padding: '16px 20px',
                display: 'flex',
                alignItems: 'center',
                gap: '14px',
                boxShadow: 'var(--fv-card-shadow)',
              }}
            >
              <div
                style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '10px',
                  backgroundColor: '#F0F9FF',
                  color: '#0284C7',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Icon name="insights" size={20} />
              </div>
              <span style={{ fontSize: '14px', fontWeight: 700, color: '#001D39' }}>
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
