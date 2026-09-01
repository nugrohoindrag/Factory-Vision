import React from 'react';
import { FactoryVisionLogo } from '@factory-vision/ui/fv';
import { Icon } from '@factory-vision/ui';

export const Footer: React.FC = () => {
  return (
    <footer
      style={{
        backgroundColor: 'var(--color-primary)',
        color: 'var(--color-on-primary)',
        paddingTop: 'calc(var(--space-8) * 2)',
        paddingBottom: 'var(--space-10)',
        borderTop: '1px solid color-mix(in srgb, var(--color-on-primary) 18%, transparent)',
      }}
    >
      <div className="fv-landing-container">
        {/* Footer Main 4 Columns */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1.5fr 1fr 1fr 1fr',
            gap: 'var(--space-10)',
            marginBottom: 'var(--space-12)',
          }}
          className="fv-footer-grid"
        >
          {/* Col 1: Brand info */}
          <div>
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <FactoryVisionLogo size="md" variant="full" />
            </div>
            <p style={{ fontSize: '14px', color: 'var(--color-on-primary)', lineHeight: 1.6, maxWidth: '320px', marginBottom: 'var(--space-5)' }}>
              The modern Manufacturing Execution System empowering discrete and batch industrial factories with real-time operational intelligence.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <span className="fv-status-dot running" />
              <span style={{ fontSize: '12px', color: 'var(--color-primary-soft)', fontWeight: 700 }}>
                Systems Operational · Cloud & Edge Live
              </span>
            </div>
          </div>

          {/* Col 2: Product Modules */}
          <div>
            <h4 style={{ fontSize: '14px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-primary-soft)', marginBottom: 'var(--space-4)' }}>
              Product Modules
            </h4>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {['Production Orders & WIP', 'Shopfloor & Operator Terminal', 'Machine Fleet & Andon', 'OEE & Loss Analytics', 'Quality & Lot Traceability', 'Master Data & Administration'].map((m) => (
                <li key={m}>
                  <a
                    href="#modules"
                    style={{ fontSize: '13px', color: 'var(--color-primary-soft)', textDecoration: 'none', transition: 'color 0.15s ease' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = 'var(--color-on-primary)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = 'var(--color-primary-soft)';
                    }}
                  >
                    {m}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Col 3: Architecture & Security */}
          <div>
            <h4 style={{ fontSize: '14px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-primary-soft)', marginBottom: 'var(--space-4)' }}>
              Architecture
            </h4>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {['Cloud & Hybrid Hosting', 'On-Premise / Air-Gapped', 'Edge Gateway Protocols (OPC-UA)', 'Enterprise RBAC & Security', 'Tamper-Proof Audit Trail', 'REST APIs & Webhooks'].map((s) => (
                <li key={s}>
                  <a
                    href="#deployment"
                    style={{ fontSize: '13px', color: 'var(--color-primary-soft)', textDecoration: 'none', transition: 'color 0.15s ease' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = 'var(--color-on-primary)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = 'var(--color-primary-soft)';
                    }}
                  >
                    {s}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Col 4: Platform Links */}
          <div>
            <h4 style={{ fontSize: '14px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-primary-soft)', marginBottom: 'var(--space-4)' }}>
              Platform
            </h4>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {['Operator Terminal', 'Management Console', 'Documentation', 'Release Notes v1.0', 'Contact Technical Sales', 'Schedule Plant Walkthrough'].map((item) => (
                <li key={item}>
                  <a
                    href="#"
                    style={{ fontSize: '13px', color: 'var(--color-primary-soft)', textDecoration: 'none', transition: 'color 0.15s ease' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = 'var(--color-on-primary)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = 'var(--color-primary-soft)';
                    }}
                  >
                    {item}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Footer Bottom Strip */}
        <div
          style={{
            borderTop: '1px solid color-mix(in srgb, var(--color-on-primary) 18%, transparent)',
            paddingTop: 'var(--space-6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '12px',
            color: 'var(--color-primary-soft)',
            flexWrap: 'wrap',
            gap: 'var(--space-3)',
          }}
        >
          <div>
            © {new Date().getFullYear()} Factory Vision Inc. All rights reserved. Enterprise Manufacturing Execution System.
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-5)' }}>
            <span style={{ cursor: 'pointer' }}>Privacy Policy</span>
            <span style={{ cursor: 'pointer' }}>Terms of Service</span>
            <span style={{ cursor: 'pointer' }}>Security Whitepaper</span>
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 900px) {
          .fv-footer-grid {
            grid-template-columns: 1fr 1fr !important;
          }
        }
        @media (max-width: 500px) {
          .fv-footer-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </footer>
  );
};
