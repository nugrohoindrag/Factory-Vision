import React from 'react';
import { motion } from 'motion/react';
import { Icon } from '@factory-vision/ui';

export const VisibilitySection: React.FC = () => {
  const pillars = [
    {
      id: 'production',
      title: 'Production Visibility',
      tagline: 'Know exactly what is being produced, where, and how much at every station.',
      image: '/assets/factory/smart-factory-line.jpg',
      icon: 'precision_manufacturing',
      badge: 'Order Tracking',
      statLabel: 'Active Work Orders',
      statValue: '28 Orders in Progress',
      highlight: '100% Real-Time WIP Visibility',
    },
    {
      id: 'machines',
      title: 'Machine Fleet Health',
      tagline: 'See machine status, speed degradation, and andon stoppages in real time.',
      image: '/assets/machines/cnc-milling-machine.jpg',
      icon: 'memory',
      badge: 'Edge Telemetry',
      statLabel: 'Machine Fleet Status',
      statValue: '12 Running · 2 Idle',
      highlight: 'Instant Downtime Root-Cause',
    },
    {
      id: 'operators',
      title: 'Operator Empowerment',
      tagline: 'Connect every production activity to the frontline people executing it.',
      image: '/assets/operators/technician-inspection.jpg',
      icon: 'badge',
      badge: 'Shopfloor Execution',
      statLabel: 'Active Shift Workforce',
      statValue: '46 Operators Logged In',
      highlight: 'Zero-Friction Tablet Entry',
    },
    {
      id: 'performance',
      title: 'Performance & OEE',
      tagline: 'Understand what is driving productivity, efficiency, and capacity losses.',
      image: '/assets/factory/factory-floor.jpg',
      icon: 'insights',
      badge: 'Continuous Improvement',
      statLabel: 'Efficiency Benchmark',
      statValue: '87.4% Plant OEE',
      highlight: 'Continuous Loss Elimination',
    },
  ];

  return (
    <section id="overview" className="fv-section-py" style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-on-primary)' }}>
      <div className="fv-landing-container">
        {/* Section Header */}
        <div style={{ textAlign: 'center', maxWidth: '780px', margin: '0 auto 48px' }}>
          <div className="fv-eyebrow-on-blue">
            <Icon name="visibility" size={16} />
            Operational Visibility
          </div>
          <h2 className="fv-section-title-on-blue">
            Your Factory Is Running.<br />
            <span>But Do You Really See It?</span>
          </h2>
          <p className="fv-section-desc-on-blue" style={{ margin: '0 auto' }}>
            Traditional spreadsheets and delayed shift reports leave blind spots across the shopfloor.
            Factory Vision provides a single source of truth connecting every heartbeat of your manufacturing process.
          </p>
        </div>

        {/* 4 Pillars Grid with Photography + UI Data Snippets */}
        <div className="fv-grid-2" style={{ gap: 'var(--space-8)' }}>
          {pillars.map((pillar, idx) => (
            <motion.div
              key={pillar.id}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.5, delay: idx * 0.1 }}
              className="fv-card-on-blue"
              style={{
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                backgroundColor: 'var(--color-surface)',
              }}
            >
              {/* Photo Area with Overlay Badge */}
              <div style={{ position: 'relative', height: '240px', overflow: 'hidden' }}>
                <img
                  src={pillar.image}
                  alt={pillar.title}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    transition: 'transform 0.4s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'scale(1.04)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'scale(1.0)';
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'linear-gradient(180deg, transparent 35%, var(--color-media-scrim) 100%)',
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    top: '16px',
                    left: '16px',
                    backgroundColor: 'var(--color-media-scrim)',
                    backdropFilter: 'blur(6px)',
                    color: 'var(--color-on-primary)',
                    padding: `var(--space-2) var(--space-4)`,
                    borderRadius: '9999px',
                    fontSize: '12px',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                    boxShadow: 'var(--elevation-1)',
                  }}
                >
                  <Icon name={pillar.icon} size={15} />
                  {pillar.badge}
                </div>

                <div
                  style={{
                    position: 'absolute',
                    bottom: '16px',
                    left: '20px',
                    right: '20px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    color: 'var(--color-on-primary)',
                  }}
                >
                  <span style={{ fontSize: '13px', opacity: 0.9, fontWeight: 500 }}>{pillar.statLabel}</span>
                  <span style={{ fontSize: '15px', fontWeight: 800, color: 'var(--color-on-primary)' }} className="fv-num">
                    {pillar.statValue}
                  </span>
                </div>
              </div>

              {/* Content Area */}
              <div style={{ padding: 'var(--space-8)', display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'space-between' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                    <h3 style={{ fontSize: '22px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
                      {pillar.title}
                    </h3>
                    <span
                      style={{
                        fontSize: '12px',
                        fontWeight: 700,
                        color: 'var(--color-on-info-container)',
                        backgroundColor: 'var(--color-info-container)',
                        border: '1px solid var(--color-info-container)',
                        padding: `var(--space-1) var(--space-3)`,
                        borderRadius: '9999px',
                      }}
                    >
                      {pillar.highlight}
                    </span>
                  </div>
                  <p style={{ fontSize: '15px', color: 'var(--color-on-surface-variant)', lineHeight: 1.55 }}>
                    {pillar.tagline}
                  </p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};
