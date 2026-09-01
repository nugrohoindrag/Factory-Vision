import React from 'react';
import { motion } from 'motion/react';
import { Icon } from '@factory-vision/ui';

interface CtaSectionProps {
  onOpenDemo: () => void;
}

export const CtaSection: React.FC<CtaSectionProps> = ({ onOpenDemo }) => {
  return (
    <section className="fv-section-py" style={{ backgroundColor: 'var(--color-inverse-surface)' }}>
      <div className="fv-landing-container">
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          style={{
            background: 'var(--color-primary)',
            color: 'var(--color-inverse-on-surface)',
            borderRadius: '28px',
            padding: `calc(var(--space-8) * 2) var(--space-10)`,
            textAlign: 'center',
            boxShadow: 'var(--elevation-5)',
            border: '1px solid color-mix(in srgb, var(--color-primary-soft) 35%, transparent)',
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
              background: 'radial-gradient(circle, color-mix(in srgb, var(--color-info) 25%, transparent) 0%, transparent 70%)',
              filter: 'blur(60px)',
              pointerEvents: 'none',
            }}
          />

          <div style={{ position: 'relative', zIndex: 1, maxWidth: '720px', margin: '0 auto' }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                padding: `var(--space-2) var(--space-4)`,
                borderRadius: '9999px',
                backgroundColor: 'var(--color-info-container)',
                backdropFilter: 'blur(8px)',
                border: '1px solid var(--color-info-container)',
                fontSize: '12px',
                fontWeight: 700,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                marginBottom: 'var(--space-5)',
                color: 'var(--color-info)',
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
                marginBottom: 'var(--space-4)',
                color: 'var(--color-inverse-on-surface)',
              }}
            >
              See What Your Factory Can See.
            </h2>

            <p
              style={{
                fontSize: 'clamp(16px, 1.8vw, 19px)',
                lineHeight: 1.6,
                marginBottom: 'var(--space-10)',
                color: 'var(--color-primary-container)',
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
                gap: 'var(--space-4)',
                flexWrap: 'wrap',
              }}
            >
              <button
                onClick={onOpenDemo}
                className="fv-btn-primary"
                style={{
                  padding: `var(--space-4) var(--space-10)`,
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
                  padding: `var(--space-4) var(--space-8)`,
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
