import React from 'react';
import { motion } from 'motion/react';
import { Icon } from '@factory-vision/ui';

export const DeploymentSection: React.FC = () => {
  return (
    <section id="deployment" className="fv-section-py" style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-on-primary)' }}>
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
        <div className="fv-grid-2" style={{ gap: 'var(--space-8)', marginBottom: 'var(--space-10)' }}>
          {/* Cloud Option */}
          <div
            className="fv-card"
            style={{
              padding: 'var(--space-10)',
              backgroundColor: 'var(--color-primary)',
              border: '1px solid color-mix(in srgb, var(--color-on-primary) 18%, transparent)',
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
                  backgroundColor: 'var(--color-info-container)',
                  color: 'var(--color-on-info-container)',
                  border: '1px solid var(--color-info-container)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 'var(--space-5)',
                }}
              >
                <Icon name="cloud" size={28} />
              </div>
              <h3 style={{ fontSize: '24px', fontWeight: 800, color: 'var(--color-on-primary)', marginBottom: 'var(--space-2)' }}>
                Cloud / Hybrid Deployment
              </h3>
              <p style={{ fontSize: '15px', color: 'var(--color-on-primary)', lineHeight: 1.55, marginBottom: 'var(--space-6)' }}>
                Access plant dashboards from any device or corporate headquarters with zero server maintenance and automatic updates.
              </p>

              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {[
                  'Multi-tenant and multi-plant global visibility',
                  'Instant scalability without local server provisioning',
                  'Automated encrypted backups and disaster recovery',
                  '99.9% SLA with modern microservice architecture',
                ].map((item) => (
                  <li key={item} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', fontSize: '14px', color: 'var(--color-on-primary)' }}>
                    <Icon name="check_circle" size={18} color="var(--color-info)" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div
              style={{
                marginTop: 'var(--space-8)',
                padding: `var(--space-4) var(--space-5)`,
                backgroundColor: 'var(--color-primary)',
                border: '1px solid color-mix(in srgb, var(--color-on-primary) 24%, transparent)',
                borderRadius: '12px',
                fontSize: '13px',
                color: 'var(--color-on-primary)',
              }}
            >
              <strong style={{ color: 'var(--color-info)' }}>Ideal for:</strong> Multi-site manufacturers, fast-growing mid-market plants, and distributed operations.
            </div>
          </div>

          {/* On-Premise Option */}
          <div
            className="fv-card"
            style={{
              padding: 'var(--space-10)',
              backgroundColor: 'var(--color-primary)',
              border: '1px solid color-mix(in srgb, var(--color-on-primary) 18%, transparent)',
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
                  backgroundColor: 'var(--color-success-container)',
                  color: 'var(--color-success)',
                  border: '1px solid var(--color-success-container)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 'var(--space-5)',
                }}
              >
                <Icon name="dns" size={28} />
              </div>
              <h3 style={{ fontSize: '24px', fontWeight: 800, color: 'var(--color-on-primary)', marginBottom: 'var(--space-2)' }}>
                On-Premise / Air-Gapped
              </h3>
              <p style={{ fontSize: '15px', color: 'var(--color-on-primary)', lineHeight: 1.55, marginBottom: 'var(--space-6)' }}>
                Keep 100% of your manufacturing telemetry and recipe data strictly inside your local plant network and firewalls.
              </p>

              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {[
                  'Full operational continuity during internet outages',
                  'Strict data residency compliance within factory perimeter',
                  'Local edge gateway connection to PLC & SCADA protocols',
                  'Docker & Kubernetes containerized infrastructure',
                ].map((item) => (
                  <li key={item} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', fontSize: '14px', color: 'var(--color-on-primary)' }}>
                    <Icon name="check_circle" size={18} color="var(--color-success)" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div
              style={{
                marginTop: 'var(--space-8)',
                padding: `var(--space-4) var(--space-5)`,
                backgroundColor: 'var(--color-primary)',
                border: '1px solid color-mix(in srgb, var(--color-on-primary) 24%, transparent)',
                borderRadius: '12px',
                fontSize: '13px',
                color: 'var(--color-on-primary)',
              }}
            >
              <strong style={{ color: 'var(--color-success)' }}>Ideal for:</strong> Defense, automotive tier-1, and mission-critical production with strict OT security policies.
            </div>
          </div>
        </div>

        {/* Security & Governance Highlights */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 'var(--space-4)',
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
                padding: 'var(--space-5)',
                backgroundColor: 'var(--color-primary)',
                border: '1px solid color-mix(in srgb, var(--color-on-primary) 18%, transparent)',
                borderRadius: '16px',
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
                  marginBottom: 'var(--space-3)',
                }}
              >
                <Icon name={sec.icon} size={20} />
              </div>
              <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--color-on-primary)', marginBottom: 'var(--space-1)' }}>
                {sec.title}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)', lineHeight: 1.4 }}>
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
