import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Icon } from '@factory-vision/ui';

export const ModulesSection: React.FC = () => {
  const [activeModule, setActiveModule] = useState(0);

  const modules = [
    {
      id: 'production',
      title: 'Production',
      icon: 'precision_manufacturing',
      tagline: 'End-to-end management from ERP demand release to shopfloor dispatch.',
      features: [
        { name: 'Production Order', desc: 'Manage customer demand, release orders, and track ERP integration.' },
        { name: 'Work Order', desc: 'Split orders into station-level job orders with routing and operations.' },
        { name: 'Production Schedule', desc: 'Visual timeline and sequence planning across machines and shifts.' },
        { name: 'Routing & BOM', desc: 'Enforce multi-step manufacturing sequences with standard cycle times.' },
        { name: 'Batch & Lot Control', desc: 'Maintain strict lot numbering and raw material linkage.' },
        { name: 'WIP Tracking', desc: 'Live visibility of work-in-progress inventories between workstations.' },
      ],
      screenshot: '/screenshots/05-work-orders.png',
    },
    {
      id: 'shopfloor',
      title: 'Shopfloor',
      icon: 'devices',
      tagline: 'Empower frontline operators and capture real-time machine telemetry.',
      features: [
        { name: 'Live Production Board', desc: 'Bird-eye monitoring of live status across all plant lines and cells.' },
        { name: 'Operator Terminal', desc: 'Intuitive tablet UI for starting jobs, recording output, and scrap.' },
        { name: 'Machine Status & Andon', desc: 'Instant running/idle/down tracking with visual and acoustic alerts.' },
        { name: 'Downtime Categorization', desc: 'One-tap downtime logging with predefined reason tree codes.' },
        { name: 'Production Events', desc: 'Micro-stoppage, speed loss, and changeover event logs.' },
        { name: 'Shift & Handover Logs', desc: 'Structured operator handover notes, supervisor approvals, and notes.' },
      ],
      screenshot: '/screenshots/06-live-board.png',
    },
    {
      id: 'quality',
      title: 'Quality',
      icon: 'verified',
      tagline: 'Embed quality into production flow rather than an afterthought.',
      features: [
        { name: 'Quality Inspection', desc: 'Inline and end-of-line dimensional and visual inspection sheets.' },
        { name: 'Quality Records', desc: 'Digital checksheets with pass/fail tolerances and operator sign-off.' },
        { name: 'Defect Tracking', desc: 'Categorize defect Pareto, root-cause classifications, and scrap costs.' },
        { name: 'Quality History & Traceability', desc: 'Forward and backward lot traceability for audits and recalls.' },
        { name: 'Hold & Quarantine', desc: 'Instantly flag suspected lots to prevent defective dispatch.' },
        { name: 'SPC & Trend Analytics', desc: 'Statistical process control charts to catch drift before defects.' },
      ],
      screenshot: '/screenshots/08-bottlenecks.png',
    },
    {
      id: 'performance',
      title: 'Performance & OEE',
      icon: 'analytics',
      tagline: 'Transform raw shopfloor numbers into clear operational intelligence.',
      features: [
        { name: 'Automated OEE Calculation', desc: 'Continuous Availability, Performance, and Quality percentage scoring.' },
        { name: 'Target vs. Actual', desc: 'Hourly piece-count comparison against standard cycle time targets.' },
        { name: 'Downtime Analysis', desc: 'Pareto charts of top downtime reasons, MTBF, and MTTR trends.' },
        { name: 'Line Performance Benchmark', desc: 'Cross-line and cross-shift efficiency comparison.' },
        { name: 'Production Reports', desc: 'Automated daily, weekly, and monthly PDF/Excel summary reports.' },
        { name: 'Bottleneck Detection', desc: 'Identify constrained machines choking factory throughput.' },
      ],
      screenshot: '/screenshots/03-oee.png',
    },
    {
      id: 'admin',
      title: 'Administration',
      icon: 'admin_panel_settings',
      tagline: 'Enterprise-grade governance, security, and flexible master data.',
      features: [
        { name: 'User Management', desc: 'Manage operators, supervisors, planners, and executive accounts.' },
        { name: 'Roles & Permissions (RBAC)', desc: 'Granular access controls by department, plant, and action.' },
        { name: 'Audit Trail', desc: 'Tamper-proof logs of every parameter change and override action.' },
        { name: 'Plant & Machine Master', desc: 'Configure lines, work centers, PLC connections, and IoT tags.' },
        { name: 'Product & SKU Master', desc: 'Manage part numbers, cycle time standards, and unit conversions.' },
        { name: 'Shift & Calendar Config', desc: 'Define multi-shift schedules, breaks, and holiday calendars.' },
      ],
      screenshot: '/screenshots/12-audit-logs.png',
    },
  ];

  const current = modules[activeModule];

  return (
    <section id="modules" className="fv-section-py" style={{ backgroundColor: '#001D39', color: '#FFFFFF' }}>
      <div className="fv-landing-container">
        {/* Section Header */}
        <div style={{ textAlign: 'center', maxWidth: '780px', margin: '0 auto 48px' }}>
          <div className="fv-eyebrow-on-blue">
            <Icon name="widgets" size={16} />
            Comprehensive Modules
          </div>
          <h2 className="fv-section-title-on-blue">
            Everything Your Production Team Needs
          </h2>
          <p className="fv-section-desc-on-blue" style={{ margin: '0 auto' }}>
            Built specifically for discrete and batch manufacturing. Each module works standalone or seamlessly together.
          </p>
        </div>

        {/* Module Switcher Tabs */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            flexWrap: 'wrap',
            marginBottom: '36px',
          }}
        >
          {modules.map((mod, index) => {
            const isSelected = activeModule === index;
            return (
              <button
                key={mod.id}
                onClick={() => setActiveModule(index)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '12px 24px',
                  borderRadius: '9999px',
                  border: isSelected ? '1px solid #FFFFFF' : '1px solid rgba(255, 255, 255, 0.25)',
                  backgroundColor: isSelected ? '#FFFFFF' : 'rgba(255, 255, 255, 0.1)',
                  color: isSelected ? '#001D39' : '#FFFFFF',
                  fontWeight: 700,
                  fontSize: '14px',
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  boxShadow: isSelected ? '0 4px 16px rgba(0, 0, 0, 0.3)' : 'none',
                }}
              >
                <Icon name={mod.icon} size={18} />
                {mod.title}
              </button>
            );
          })}
        </div>

        {/* Active Module Showcase Card */}
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
              gridTemplateColumns: '1.2fr 1fr',
              gap: '36px',
              alignItems: 'center',
            }}
          >
            {/* Left: Features Matrix */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                <span
                  style={{
                    backgroundColor: '#F0F9FF',
                    color: '#0A4174',
                    border: '1px solid #BAE6FD',
                    padding: '4px 12px',
                    borderRadius: '9999px',
                    fontSize: '12px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                  }}
                >
                  {current.title} Module
                </span>
              </div>
              <h3 style={{ fontSize: '26px', fontWeight: 800, marginBottom: '10px', color: '#001D39' }}>
                {current.tagline}
              </h3>
              <p style={{ fontSize: '15px', color: '#334155', marginBottom: '28px', lineHeight: 1.55 }}>
                Equipped with industrial capabilities designed to streamline daily shopfloor operations and eliminate manual paperwork.
              </p>

              {/* 6 Capabilities in 2 Columns */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
                {current.features.map((f) => (
                  <div
                    key={f.name}
                    style={{
                      padding: '16px',
                      borderRadius: '14px',
                      backgroundColor: '#F8FAFC',
                      border: '1px solid #E2E8F0',
                    }}
                  >
                    <div style={{ fontWeight: 800, fontSize: '14px', color: '#0A4174', marginBottom: '4px' }}>
                      {f.name}
                    </div>
                    <div style={{ fontSize: '12px', color: '#334155', lineHeight: 1.45 }}>
                      {f.desc}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: Actual Product Screenshot Frame */}
            <div>
              <div className="fv-browser-frame">
                <div className="fv-browser-header">
                  <div className="fv-browser-dots">
                    <span className="fv-browser-dot" />
                    <span className="fv-browser-dot" />
                    <span className="fv-browser-dot" />
                  </div>
                  <div className="fv-browser-address-bar">
                    <Icon name="verified" size={12} />
                    <span>app.factoryvision.io/{current.id}</span>
                  </div>
                </div>
                <div className="fv-browser-body">
                  <img
                    src={current.screenshot}
                    alt={`${current.title} Screenshot`}
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
          #modules .fv-card-on-blue {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
};
