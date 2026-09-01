import React from 'react';
import { motion } from 'motion/react';
import { Icon } from '@factory-vision/ui';

interface HeroSectionProps {
  onOpenDemo: () => void;
}

export const HeroSection: React.FC<HeroSectionProps> = ({ onOpenDemo }) => {
  return (
    <section
      style={{
        position: 'relative',
        paddingTop: 'var(--space-12)',
        paddingBottom: 'calc(var(--space-12) * 2)',
        backgroundColor: 'var(--color-surface)',
        overflow: 'hidden',
      }}
    >
      <div className="fv-landing-container" style={{ position: 'relative', zIndex: 1 }}>
        {/* Header Text & Positioning */}
        <div style={{ textAlign: 'center', maxWidth: '880px', margin: '0 auto 48px' }}>
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.2, 0, 0, 1] }}
            className="fv-eyebrow"
          >
            <Icon name="precision_manufacturing" size={16} />
            Next-Gen Manufacturing Execution System
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.08, ease: [0.2, 0, 0, 1] }}
            style={{
              fontSize: 'clamp(38px, 5.8vw, 68px)',
              fontWeight: 800,
              lineHeight: 1.08,
              letterSpacing: '-0.03em',
              color: 'var(--color-on-surface)',
              marginBottom: 'var(--space-5)',
            }}
          >
            See Your Factory.<br />
            <span style={{ color: 'var(--color-primary)' }}>
              Control Your Production.
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.16, ease: [0.2, 0, 0, 1] }}
            className="fv-section-desc"
            style={{ margin: '0 auto 36px', color: 'var(--color-on-surface-variant)', fontSize: 'clamp(17px, 2vw, 20px)' }}
          >
            Factory Vision is a modern Manufacturing Execution System that connects
            production orders, machines, operators, quality, and performance in one
            real-time operational platform.
          </motion.p>

          {/* Action CTAs */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.24, ease: [0.2, 0, 0, 1] }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 'var(--space-4)',
              flexWrap: 'wrap',
            }}
          >
            <button
              onClick={onOpenDemo}
              className="fv-btn-primary"
              style={{ padding: `var(--space-4) var(--space-8)`, fontSize: '16px' }}
            >
              Book a Demo
              <Icon name="calendar_today" size={18} />
            </button>
            <a
              href="#showcase"
              className="fv-btn-secondary"
              style={{ padding: `var(--space-4) var(--space-8)`, fontSize: '16px' }}
            >
              Explore the Platform
              <Icon name="visibility" size={18} />
            </a>
          </motion.div>
        </div>

        {/* Dashboard Product Hero Showcase with Floating Cards */}
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.32, ease: [0.2, 0, 0, 1] }}
          style={{ position: 'relative', marginTop: 'var(--space-8)' }}
        >
          {/* Main Dashboard Browser Frame */}
          <div className="fv-browser-frame">
            <div className="fv-browser-header">
              <div className="fv-browser-dots">
                <span className="fv-browser-dot" style={{ backgroundColor: 'var(--color-error)' }} />
                <span className="fv-browser-dot" style={{ backgroundColor: 'var(--color-warning)' }} />
                <span className="fv-browser-dot" style={{ backgroundColor: 'var(--color-success)' }} />
              </div>
              <div className="fv-browser-address-bar">
                <Icon name="lock" size={12} />
                <span>app.factoryvision.io/executive-dashboard</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <span className="fv-status-dot running" />
                <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-success)' }}>
                  LIVE SHOPFLOOR STREAM
                </span>
              </div>
            </div>

            <div className="fv-browser-body">
              <img
                src="/screenshots/01-executive-dashboard.png"
                alt="Factory Vision Executive Dashboard"
                className="fv-browser-img"
                loading="eager"
              />
            </div>
          </div>

          {/* Floating Operational Telemetry Card 1 - Live OEE */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 0.6 }}
            className="fv-floating-card fv-floating-top-left"
            style={{
              position: 'absolute',
              top: '-24px',
              left: '-20px',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-success-container)',
              borderRadius: '16px',
              padding: `var(--space-4) var(--space-5)`,
              boxShadow: 'var(--elevation-3)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-4)',
              zIndex: 2,
            }}
          >
            <div
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '12px',
                backgroundColor: 'var(--color-success-container)',
                color: 'var(--color-on-success-container)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="speed" size={24} />
            </div>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)', fontWeight: 700, letterSpacing: '0.04em' }}>
                PLANT OEE TODAY
              </div>
              <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--color-on-surface)' }} className="fv-num">
                87.4% <span style={{ fontSize: '13px', color: 'var(--color-success)', fontWeight: 700 }}>+4.2%</span>
              </div>
            </div>
          </motion.div>

          {/* Floating Operational Telemetry Card 2 - Active Machines */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 0.7 }}
            className="fv-floating-card fv-floating-top-right"
            style={{
              position: 'absolute',
              top: '40px',
              right: '-20px',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-info-container)',
              borderRadius: '16px',
              padding: `var(--space-4) var(--space-5)`,
              boxShadow: 'var(--elevation-3)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-4)',
              zIndex: 2,
            }}
          >
            <div
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '12px',
                backgroundColor: 'var(--color-info-container)',
                color: 'var(--color-on-info-container)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="precision_manufacturing" size={24} />
            </div>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)', fontWeight: 700, letterSpacing: '0.04em' }}>
                RUNNING LINES
              </div>
              <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--color-on-surface)' }} className="fv-num">
                12 / 12 Active
              </div>
            </div>
          </motion.div>

          {/* Floating Operational Telemetry Card 3 - Quality Yield */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.8 }}
            className="fv-floating-card fv-floating-bottom-left"
            style={{
              position: 'absolute',
              bottom: '-24px',
              right: '48px',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-outline-variant)',
              borderRadius: '16px',
              padding: `var(--space-4) var(--space-5)`,
              boxShadow: 'var(--elevation-3)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-4)',
              zIndex: 2,
            }}
          >
            <div
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '12px',
                backgroundColor: 'var(--color-info-container)',
                color: 'var(--color-on-info-container)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="verified" size={24} />
            </div>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)', fontWeight: 700, letterSpacing: '0.04em' }}>
                FIRST-PASS YIELD
              </div>
              <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--color-on-surface)' }} className="fv-num">
                99.62% <span style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)', fontWeight: 600 }}>(Defect: 0.38%)</span>
              </div>
            </div>
          </motion.div>
        </motion.div>
      </div>

      <style>{`
        @media (max-width: 900px) {
          .fv-floating-card {
            display: none !important;
          }
        }
      `}</style>
    </section>
  );
};
