import React from 'react';
import { motion } from 'motion/react';
import { Icon } from '@factory-vision/ui';

export const BusinessImpactSection: React.FC = () => {
  const impacts = [
    {
      icon: 'visibility',
      title: 'Real-Time Visibility',
      tagline: 'Eliminate blind spots across shifts and stations',
      desc: 'Know exactly what is being produced at any given second, track WIP levels between stations, and prevent unnoticed bottlenecks.',
      metric: '100%',
      metricLabel: 'Real-time shift awareness',
    },
    {
      icon: 'trending_up',
      title: 'Productivity & Utilization',
      tagline: 'Minimize idle time and speed losses',
      desc: 'Expose micro-stoppages, shorten changeover durations with standardized setup workflows, and maximize machine availability.',
      metric: '+15–25%',
      metricLabel: 'Capacity utilization unlock',
    },
    {
      icon: 'verified',
      title: 'Total Traceability',
      tagline: 'Audit-proof batch and quality records',
      desc: 'Link every raw material heat lot and operator action to finished goods. Resolve customer defect inquiries in seconds instead of days.',
      metric: '< 30s',
      metricLabel: 'Complete genealogy lookup',
    },
    {
      icon: 'insights',
      title: 'Confident Decision Making',
      tagline: 'Fact-based shopfloor continuous improvement',
      desc: 'Empower supervisors and management with uncorrupted automated telemetry rather than subjective end-of-shift guesstimates.',
      metric: '0',
      metricLabel: 'Paper checksheets required',
    },
  ];

  return (
    <section className="fv-section-py" style={{ backgroundColor: '#0B0B0D', color: '#FFFFFF' }}>
      <div className="fv-landing-container">
        {/* Header */}
        <div style={{ textAlign: 'center', maxWidth: '800px', margin: '0 auto 48px' }}>
          <div className="fv-eyebrow">
            <Icon name="verified" size={16} />
            Measurable Value
          </div>
          <h2 className="fv-section-title">
            Built to Improve Factory Performance
          </h2>
          <p className="fv-section-desc" style={{ margin: '0 auto' }}>
            Transforming shopfloor execution delivers immediate operational dividends across production velocity,
            quality compliance, and machine availability.
          </p>
        </div>

        {/* 4 Impact Pillars Grid */}
        <div className="fv-grid-2" style={{ gap: '28px' }}>
          {impacts.map((imp, idx) => (
            <motion.div
              key={imp.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: idx * 0.08 }}
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
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
                  <div
                    style={{
                      width: '48px',
                      height: '48px',
                      borderRadius: '14px',
                      backgroundColor: 'rgba(56, 189, 248, 0.15)',
                      color: '#38BDF8',
                      border: '1px solid rgba(56, 189, 248, 0.35)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon name={imp.icon} size={26} />
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div
                      style={{ fontSize: '28px', fontWeight: 800, color: '#38BDF8' }}
                      className="fv-num"
                    >
                      {imp.metric}
                    </div>
                    <div style={{ fontSize: '11px', color: '#8E9BAE', fontWeight: 700, textTransform: 'uppercase' }}>
                      {imp.metricLabel}
                    </div>
                  </div>
                </div>

                <h3 style={{ fontSize: '22px', fontWeight: 800, color: '#FFFFFF', marginBottom: '4px' }}>
                  {imp.title}
                </h3>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#7BBDE8', marginBottom: '12px' }}>
                  {imp.tagline}
                </div>
                <p style={{ fontSize: '15px', color: '#BDD8E9', lineHeight: 1.55 }}>
                  {imp.desc}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};
