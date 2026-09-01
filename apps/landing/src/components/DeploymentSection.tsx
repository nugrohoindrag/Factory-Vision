import React from 'react';
import { motion } from 'motion/react';
import { Icon } from '@factory-vision/ui';

export const DeploymentSection: React.FC = () => {
  return (
    <section id="deployment" className="fv-section-py" style={{ backgroundColor: '#0B0B0D', color: '#FFFFFF' }}>
      <div className="fv-landing-container">
        {/* Header */}
        <div style={{ textAlign: 'center', maxWidth: '800px', margin: '0 auto 48px' }}>
          <div className="fv-eyebrow">
            <Icon name="cloud" size={16} />
            Flexible Architecture
          </div>
          <h2 className="fv-section-title">
            Fits the Way Your Factory Operates
          </h2>
          <p className="fv-section-desc" style={{ margin: '0 auto' }}>
            Whether you operate in a high-security isolated factory network or require cloud-native multi-plant visibility,
            Factory Vision provides flexible deployment models without compromise.
          </p>
        </div>

        {/* Cloud vs On-Premise 2 Columns */}
        <div className="fv-grid-2" style={{ gap: '28px', marginBottom: '36px' }}>
          {/* Cloud Option */}
          <div
            className="fv-card"
            style={{
              padding: '36px',
              backgroundColor: '#15171C',
              border: '1px solid #232730',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <div
                style={{
                  width: '52px',
                  height: '52px',
                  borderRadius: '14px',
                  backgroundColor: 'rgba(56, 189, 248, 0.15)',
                  color: '#38BDF8',
                  border: '1px solid rgba(56, 189, 248, 0.35)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: '20px',
                }}
              >
                <Icon name="cloud" size={28} />
              </div>
              <h3 style={{ fontSize: '24px', fontWeight: 800, color: '#FFFFFF', marginBottom: '8px' }}>
                Cloud / Hybrid Deployment
              </h3>
              <p style={{ fontSize: '15px', color: '#BDD8E9', lineHeight: 1.55, marginBottom: '24px' }}>
                Access plant dashboards from any device or corporate headquarters with zero server maintenance and automatic updates.
              </p>

              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {[
                  'Multi-tenant and multi-plant global visibility',
                  'Instant scalability without local server provisioning',
                  'Automated encrypted backups and disaster recovery',
                  '99.9% SLA with modern microservice architecture',
                ].map((item) => (
                  <li key={item} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', color: '#FFFFFF' }}>
                    <Icon name="check_circle" size={18} color="#38BDF8" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div
              style={{
                marginTop: '28px',
                padding: '14px 18px',
                backgroundColor: '#121418',
                border: '1px solid #282C37',
                borderRadius: '12px',
                fontSize: '13px',
                color: '#BDD8E9',
              }}
            >
              <strong style={{ color: '#38BDF8' }}>Ideal for:</strong> Multi-site manufacturers, fast-growing mid-market plants, and distributed operations.
            </div>
          </div>

          {/* On-Premise Option */}
          <div
            className="fv-card"
            style={{
              padding: '36px',
              backgroundColor: '#15171C',
              border: '1px solid #232730',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <div
                style={{
                  width: '52px',
                  height: '52px',
                  borderRadius: '14px',
                  backgroundColor: 'rgba(16, 185, 129, 0.15)',
                  color: '#10B981',
                  border: '1px solid rgba(16, 185, 129, 0.35)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: '20px',
                }}
              >
                <Icon name="dns" size={28} />
              </div>
              <h3 style={{ fontSize: '24px', fontWeight: 800, color: '#FFFFFF', marginBottom: '8px' }}>
                On-Premise / Air-Gapped
              </h3>
              <p style={{ fontSize: '15px', color: '#BDD8E9', lineHeight: 1.55, marginBottom: '24px' }}>
                Keep 100% of your manufacturing telemetry and recipe data strictly inside your local plant network and firewalls.
              </p>

              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {[
                  'Full operational continuity during internet outages',
                  'Strict data residency compliance within factory perimeter',
                  'Local edge gateway connection to PLC & SCADA protocols',
                  'Docker & Kubernetes containerized infrastructure',
                ].map((item) => (
                  <li key={item} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', color: '#FFFFFF' }}>
                    <Icon name="check_circle" size={18} color="#10B981" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div
              style={{
                marginTop: '28px',
                padding: '14px 18px',
                backgroundColor: '#121418',
                border: '1px solid #282C37',
                borderRadius: '12px',
                fontSize: '13px',
                color: '#BDD8E9',
              }}
            >
              <strong style={{ color: '#10B981' }}>Ideal for:</strong> Defense, automotive tier-1, and mission-critical production with strict OT security policies.
            </div>
          </div>
        </div>

        {/* Security & Governance Highlights */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '16px',
          }}
          className="fv-security-grid"
        >
          {[
            { icon: 'lock', title: 'Enterprise RBAC', desc: 'Granular role permissions for operators, leads & admins' },
            { icon: 'history', title: 'Audit Trail', desc: 'Tamper-proof logs for all recipe overrides & approvals' },
            { icon: 'devices', title: 'Edge Ingestion', desc: 'Native OPC-UA, MQTT, Modbus & REST API bridges' },
            { icon: 'admin_panel_settings', title: 'OT Isolation', desc: 'Separated shopfloor network traffic and DMZ zones' },
          ].map((sec) => (
            <div
              key={sec.title}
              style={{
                padding: '20px',
                backgroundColor: '#15171C',
                border: '1px solid #232730',
                borderRadius: '16px',
                boxShadow: 'var(--fv-card-shadow)',
              }}
            >
              <div
                style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '10px',
                  backgroundColor: 'rgba(56, 189, 248, 0.15)',
                  color: '#38BDF8',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: '12px',
                }}
              >
                <Icon name={sec.icon} size={20} />
              </div>
              <div style={{ fontSize: '15px', fontWeight: 800, color: '#FFFFFF', marginBottom: '4px' }}>
                {sec.title}
              </div>
              <div style={{ fontSize: '12px', color: '#8E9BAE', lineHeight: 1.4 }}>
                {sec.desc}
              </div>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @media (max-width: 900px) {
          .fv-security-grid {
            grid-template-columns: repeat(2, 1fr) !important;
          }
        }
      `}</style>
    </section>
  );
};
