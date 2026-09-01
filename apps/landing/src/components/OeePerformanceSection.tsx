import React from 'react';
import { motion } from 'motion/react';
import { Icon } from '@factory-vision/ui';

export const OeePerformanceSection: React.FC = () => {
  const kpis = [
    { label: 'Overall Equipment Effectiveness (OEE)', val: '82.4%', sub: 'World-Class Benchmark: 85%', tone: '#0A4174' },
    { label: 'Availability Rate', val: '91.2%', sub: 'Planned vs Actual Operating Time', tone: '#059669' },
    { label: 'Performance Efficiency', val: '89.4%', sub: 'Standard vs Actual Cycle Speed', tone: '#0284C7' },
    { label: 'Quality Yield Rate', val: '98.1%', sub: 'Good Output vs Total Inspected', tone: '#D97706' },
  ];

  const losses = [
    { category: '01 Equipment Breakdown', pct: '4.2%', desc: 'Unplanned mechanical failures & sensor trips', color: '#DC2626' },
    { category: '02 Setup & Adjustments', pct: '4.6%', desc: 'Tooling swaps & recipe parameter changeovers', color: '#D97706' },
    { category: '03 Small Stops & Idling', pct: '4.8%', desc: 'Part misfeeds, sensor pauses & micro-stops', color: '#0284C7' },
    { category: '04 Reduced Speed', pct: '3.0%', desc: 'Running below theoretical maximum cycle speed', color: '#0284C7' },
    { category: '05 Startup Rejects', pct: '0.9%', desc: 'Initial run scrap during line warm-up', color: '#DC2626' },
    { category: '06 Production Defects', pct: '1.0%', desc: 'Dimensional out-of-spec & surface rework', color: '#DC2626' },
  ];

  return (
    <section id="oee" className="fv-section-py" style={{ backgroundColor: '#FFFFFF' }}>
      <div className="fv-landing-container">
        {/* Header */}
        <div style={{ textAlign: 'center', maxWidth: '800px', margin: '0 auto 48px' }}>
          <div className="fv-eyebrow">
            <Icon name="insights" size={16} />
            OEE & Continuous Improvement
          </div>
          <h2 className="fv-section-title">
            Turn Production Data Into Performance
          </h2>
          <p className="fv-section-desc" style={{ margin: '0 auto', color: '#334155' }}>
            Automatically calculate Availability, Performance, and Quality without waiting for manual shift tallying.
            Drill straight into the root causes holding back your factory output.
          </p>
        </div>

        {/* 4 OEE Gauges Banner */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '16px',
            marginBottom: '48px',
          }}
          className="fv-oee-kpi-grid"
        >
          {kpis.map((kpi, idx) => (
            <motion.div
              key={kpi.label}
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: idx * 0.08 }}
              className="fv-card"
              style={{
                padding: '28px 24px',
                backgroundColor: '#FFFFFF',
                borderTop: `4px solid ${kpi.tone}`,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ fontSize: '12px', color: '#64748B', fontWeight: 700, textTransform: 'uppercase', marginBottom: '8px', lineHeight: 1.4 }}>
                  {kpi.label}
                </div>
                <div style={{ fontSize: '36px', fontWeight: 800, color: '#001D39', marginBottom: '4px' }} className="fv-num">
                  {kpi.val}
                </div>
              </div>
              <div style={{ fontSize: '13px', color: '#334155', marginTop: '8px', fontWeight: 500 }}>
                {kpi.sub}
              </div>
            </motion.div>
          ))}
        </div>

        {/* 2-Column Deep Dive: Loss Analysis & Real OEE Screenshot */}
        <div
          className="fv-card fv-oee-deepdive-grid"
          style={{
            padding: '36px',
            backgroundColor: '#FFFFFF',
            display: 'grid',
            gridTemplateColumns: '1.1fr 1fr',
            gap: '36px',
            alignItems: 'center',
          }}
        >
          {/* Left: Why Are We Losing Production? */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
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
                Six Big Losses Breakdown
              </span>
            </div>
            <h3 style={{ fontSize: '26px', fontWeight: 800, margin: '8px 0', color: '#001D39' }}>
              Why Are We Losing Production?
            </h3>
            <p style={{ fontSize: '15px', color: '#334155', marginBottom: '24px', lineHeight: 1.55 }}>
              Identify exactly where productive capacity leaks during the shift with automated loss categorization.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '10px' }}>
              {losses.map((loss) => (
                <div
                  key={loss.category}
                  style={{
                    backgroundColor: '#F8FAFC',
                    border: '1px solid #E2E8F0',
                    borderRadius: '12px',
                    padding: '12px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: '#001D39' }}>
                      {loss.category}
                    </div>
                    <div style={{ fontSize: '12px', color: '#64748B' }}>
                      {loss.desc}
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: '14px',
                      fontWeight: 800,
                      color: loss.color,
                      padding: '4px 10px',
                      backgroundColor: '#FFFFFF',
                      border: '1px solid #E2E8F0',
                      borderRadius: '9999px',
                    }}
                    className="fv-num"
                  >
                    -{loss.pct}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Actual Product OEE Analytics Screenshot Frame */}
          <div>
            <div className="fv-browser-frame">
              <div className="fv-browser-header">
                <div className="fv-browser-dots">
                  <span className="fv-browser-dot" />
                  <span className="fv-browser-dot" />
                  <span className="fv-browser-dot" />
                </div>
                <div className="fv-browser-address-bar">
                  <Icon name="analytics" size={12} />
                  <span>app.factoryvision.io/oee-analytics</span>
                </div>
              </div>
              <div className="fv-browser-body">
                <img
                  src="/screenshots/03-oee.png"
                  alt="Factory Vision OEE Analytics"
                  className="fv-browser-img"
                  loading="lazy"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 1024px) {
          .fv-oee-kpi-grid {
            grid-template-columns: repeat(2, 1fr) !important;
          }
          .fv-oee-deepdive-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
};
