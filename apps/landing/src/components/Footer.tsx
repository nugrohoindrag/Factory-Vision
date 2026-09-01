import React from 'react';
import { FactoryVisionLogo } from '@factory-vision/ui/fv';
import { Icon } from '@factory-vision/ui';

export const Footer: React.FC = () => {
  return (
    <footer
      style={{
        backgroundColor: '#0B0B0D',
        color: '#FFFFFF',
        paddingTop: '64px',
        paddingBottom: '40px',
        borderTop: '1px solid #232730',
      }}
    >
      <div className="fv-landing-container">
        {/* Footer Main 4 Columns */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1.5fr 1fr 1fr 1fr',
            gap: '36px',
            marginBottom: '48px',
          }}
          className="fv-footer-grid"
        >
          {/* Col 1: Brand info */}
          <div>
            <div style={{ marginBottom: '16px' }}>
              <FactoryVisionLogo size="md" variant="full" />
            </div>
            <p style={{ fontSize: '14px', color: '#BDD8E9', lineHeight: 1.6, maxWidth: '320px', marginBottom: '20px' }}>
              The modern Manufacturing Execution System empowering discrete and batch industrial factories with real-time operational intelligence.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="fv-status-dot running" />
              <span style={{ fontSize: '12px', color: '#7BBDE8', fontWeight: 700 }}>
                Systems Operational · Cloud & Edge Live
              </span>
            </div>
          </div>

          {/* Col 2: Product Modules */}
          <div>
            <h4 style={{ fontSize: '14px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#7BBDE8', marginBottom: '16px' }}>
              Product Modules
            </h4>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {['Production Orders & WIP', 'Shopfloor & Operator Terminal', 'Machine Fleet & Andon', 'OEE & Loss Analytics', 'Quality & Lot Traceability', 'Master Data & Administration'].map((m) => (
                <li key={m}>
                  <a
                    href="#modules"
                    style={{ fontSize: '13px', color: '#8E9BAE', textDecoration: 'none', transition: 'color 0.15s ease' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = '#FFFFFF';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = '#8E9BAE';
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
            <h4 style={{ fontSize: '14px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#7BBDE8', marginBottom: '16px' }}>
              Architecture
            </h4>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {['Cloud & Hybrid Hosting', 'On-Premise / Air-Gapped', 'Edge Gateway Protocols (OPC-UA)', 'Enterprise RBAC & Security', 'Tamper-Proof Audit Trail', 'REST APIs & Webhooks'].map((s) => (
                <li key={s}>
                  <a
                    href="#deployment"
                    style={{ fontSize: '13px', color: '#8E9BAE', textDecoration: 'none', transition: 'color 0.15s ease' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = '#FFFFFF';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = '#8E9BAE';
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
            <h4 style={{ fontSize: '14px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#7BBDE8', marginBottom: '16px' }}>
              Platform
            </h4>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {['Operator Terminal', 'Management Console', 'Documentation', 'Release Notes v1.0', 'Contact Technical Sales', 'Schedule Plant Walkthrough'].map((item) => (
                <li key={item}>
                  <a
                    href="#"
                    style={{ fontSize: '13px', color: '#8E9BAE', textDecoration: 'none', transition: 'color 0.15s ease' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = '#FFFFFF';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = '#8E9BAE';
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
            borderTop: '1px solid #232730',
            paddingTop: '24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '12px',
            color: '#8E9BAE',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div>
            © {new Date().getFullYear()} Factory Vision Inc. All rights reserved. Enterprise Manufacturing Execution System.
          </div>
          <div style={{ display: 'flex', gap: '20px' }}>
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
