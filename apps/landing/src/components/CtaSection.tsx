import React from 'react';
import { motion } from 'motion/react';
import { Icon } from '@factory-vision/ui';

interface CtaSectionProps {
  onOpenDemo: () => void;
}

export const CtaSection: React.FC<CtaSectionProps> = ({ onOpenDemo }) => {
  return (
    <section className="fv-section-py" style={{ backgroundColor: '#0B0B0D' }}>
      <div className="fv-landing-container">
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          style={{
            background: 'linear-gradient(135deg, #15171C 0%, #0E1A2B 50%, #0A4174 100%)',
            color: '#FFFFFF',
            borderRadius: '28px',
            padding: '64px 36px',
            textAlign: 'center',
            boxShadow: '0 24px 60px rgba(0, 0, 0, 0.8)',
            border: '1px solid rgba(123, 189, 232, 0.35)',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {/* Ambient light glow */}
          <div
            style={{
              position: 'absolute',
              top: '-80px',
              left: '50%',
              transform: 'translateX(-50%)',
              width: '600px',
              height: '300px',
              background: 'radial-gradient(circle, rgba(56, 189, 248, 0.25) 0%, transparent 70%)',
              filter: 'blur(60px)',
              pointerEvents: 'none',
            }}
          />

          <div style={{ position: 'relative', zIndex: 1, maxWidth: '720px', margin: '0 auto' }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 16px',
                borderRadius: '9999px',
                backgroundColor: 'rgba(56, 189, 248, 0.15)',
                backdropFilter: 'blur(8px)',
                border: '1px solid rgba(56, 189, 248, 0.35)',
                fontSize: '12px',
                fontWeight: 700,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                marginBottom: '20px',
                color: '#38BDF8',
              }}
            >
              <Icon name="verified" size={16} />
              Production Ready Platform
            </div>

            <h2
              style={{
                fontSize: 'clamp(32px, 4.5vw, 48px)',
                fontWeight: 800,
                lineHeight: 1.15,
                letterSpacing: '-0.025em',
                marginBottom: '16px',
                color: '#FFFFFF',
              }}
            >
              See What Your Factory Can See.
            </h2>

            <p
              style={{
                fontSize: 'clamp(16px, 1.8vw, 19px)',
                lineHeight: 1.6,
                marginBottom: '36px',
                color: '#BDD8E9',
              }}
            >
              Join modern manufacturing plants transforming their production execution with real-time shopfloor telemetry,
              automated OEE, and zero-defect batch traceability.
            </p>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '16px',
                flexWrap: 'wrap',
              }}
            >
              <button
                onClick={onOpenDemo}
                className="fv-btn-primary"
                style={{
                  padding: '16px 36px',
                  fontSize: '16px',
                }}
              >
                Book a Live Demo
                <Icon name="arrow_forward" size={18} />
              </button>

              <a
                href="#overview"
                className="fv-btn-secondary"
                style={{
                  padding: '16px 32px',
                  fontSize: '16px',
                }}
              >
                Explore Modules
                <Icon name="visibility" size={18} />
              </a>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
};
