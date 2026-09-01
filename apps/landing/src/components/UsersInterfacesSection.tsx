import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Icon } from '@factory-vision/ui';

export const UsersInterfacesSection: React.FC = () => {
  const [selectedPersona, setSelectedPersona] = useState(0);

  const personas = [
    {
      id: 'management',
      title: 'Executive & Plant Management',
      shortTitle: 'Management',
      icon: 'analytics',
      tagline: 'See the entire factory at a glance without chasing manual spreadsheets.',
      screenshot: '/screenshots/01-executive-dashboard.png',
      photo: '/assets/factory/factory-floor.jpg',
      benefits: [
        'Multi-plant and multi-line OEE benchmarking',
        'Executive dashboards with real-time KPI rollups',
        'Financial loss analysis and downtime cost impact',
        'Enterprise audit trail and SLA monitoring',
      ],
    },
    {
      id: 'production',
      title: 'PPIC & Production Supervisors',
      shortTitle: 'Production Team',
      icon: 'precision_manufacturing',
      tagline: 'Control daily production schedules, work orders, and shopfloor dispatching.',
      screenshot: '/screenshots/06-live-board.png',
      photo: '/assets/operators/technician-inspection.jpg',
      benefits: [
        'Live dispatching and sequencing of Work Orders',
        'Real-time line status board and Bottleneck heatmaps',
        'Instant andon stoppage notifications with reason codes',
        'Automated shift handover logs and output tallies',
      ],
    },
    {
      id: 'operators',
      title: 'Frontline Machine Operators',
      shortTitle: 'Shopfloor Operators',
      icon: 'devices',
      tagline: 'Execute production simply with ultra-fast touchscreen terminals.',
      screenshot: '/screenshots/20-operator-terminal.png',
      photo: '/assets/operators/operator-tablet.jpg',
      benefits: [
        '3-second output and scrap piece count logging',
        'One-tap downtime reason reporting (Material, Tooling, Jam)',
        'Built-in digital SOPs, drawings, and checksheets',
        'Offline-resilient terminal operations',
      ],
    },
  ];

  const current = personas[selectedPersona];

  return (
    <section className="fv-section-py" style={{ backgroundColor: '#001D39', color: '#FFFFFF' }}>
      <div className="fv-landing-container">
        {/* Header */}
        <div style={{ textAlign: 'center', maxWidth: '800px', margin: '0 auto 48px' }}>
          <div className="fv-eyebrow-on-blue">
            <Icon name="group" size={16} />
            Tailored Experiences
          </div>
          <h2 className="fv-section-title-on-blue">
            Built for Everyone on the Factory Floor
          </h2>
          <p className="fv-section-desc-on-blue" style={{ margin: '0 auto' }}>
            From executives in the boardroom to frontline machine operators on the shopfloor,
            Factory Vision provides role-tailored interfaces that make everyday manufacturing work frictionless.
          </p>
        </div>

        {/* Persona Selectors */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            gap: '12px',
            flexWrap: 'wrap',
            marginBottom: '36px',
          }}
        >
          {personas.map((p, idx) => {
            const isSelected = selectedPersona === idx;
            return (
              <button
                key={p.id}
                onClick={() => setSelectedPersona(idx)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '12px 26px',
                  borderRadius: '9999px',
                  border: isSelected ? '1px solid #FFFFFF' : '1px solid rgba(255, 255, 255, 0.25)',
                  backgroundColor: isSelected ? '#FFFFFF' : 'rgba(255, 255, 255, 0.1)',
                  color: isSelected ? '#001D39' : '#FFFFFF',
                  fontWeight: 700,
                  fontSize: '15px',
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  boxShadow: isSelected ? '0 4px 16px rgba(0, 0, 0, 0.3)' : 'none',
                }}
              >
                <Icon name={p.icon} size={20} />
                {p.shortTitle}
              </button>
            );
          })}
        </div>

        {/* Persona Showcase Box */}
        <AnimatePresence mode="wait">
          <motion.div
            key={current.id}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.25 }}
            className="fv-card-on-blue"
            style={{
              padding: '36px',
              backgroundColor: '#FFFFFF',
              display: 'grid',
              gridTemplateColumns: '1fr 1.15fr',
              gap: '36px',
              alignItems: 'center',
            }}
          >
            {/* Left: Role Benefits */}
            <div>
              <span
                style={{
                  fontSize: '12px',
                  fontWeight: 700,
                  color: '#0A4174',
                  backgroundColor: '#F0F9FF',
                  border: '1px solid #BAE6FD',
                  padding: '4px 12px',
                  borderRadius: '9999px',
                  textTransform: 'uppercase',
                }}
              >
                {current.shortTitle} Experience
              </span>
              <h3 style={{ fontSize: '26px', fontWeight: 800, margin: '12px 0 8px', color: '#001D39' }}>
                {current.title}
              </h3>
              <p style={{ fontSize: '15px', color: '#334155', lineHeight: 1.55, marginBottom: '24px' }}>
                {current.tagline}
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {current.benefits.map((b) => (
                  <div
                    key={b}
                    style={{
                      padding: '14px 18px',
                      backgroundColor: '#F8FAFC',
                      border: '1px solid #E2E8F0',
                      borderRadius: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      fontSize: '14px',
                      fontWeight: 600,
                      color: '#001D39',
                    }}
                  >
                    <Icon name="check_circle" size={18} color="#0A4174" />
                    <span>{b}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: Persona UI Screenshot & Context Photo */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="fv-browser-frame">
                <div className="fv-browser-header">
                  <div className="fv-browser-dots">
                    <span className="fv-browser-dot" />
                    <span className="fv-browser-dot" />
                    <span className="fv-browser-dot" />
                  </div>
                  <div className="fv-browser-address-bar">
                    <Icon name="visibility" size={12} />
                    <span>app.factoryvision.io/{current.id}</span>
                  </div>
                </div>
                <div className="fv-browser-body">
                  <img
                    src={current.screenshot}
                    alt={`${current.title} UI Preview`}
                    className="fv-browser-img"
                    loading="lazy"
                  />
                </div>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      <style>{`
        @media (max-width: 960px) {
          .fv-card-on-blue {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
};
