import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Icon } from '@factory-vision/ui';
export const ModulesSection = () => {
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
    return (_jsxs("section", { id: "modules", className: "fv-section-py", style: { backgroundColor: 'var(--color-primary)', color: 'var(--color-on-primary)' }, children: [_jsxs("div", { className: "fv-landing-container", children: [_jsxs("div", { style: { textAlign: 'center', maxWidth: '780px', margin: '0 auto 48px' }, children: [_jsxs("div", { className: "fv-eyebrow-on-blue", children: [_jsx(Icon, { name: "widgets", size: 16 }), "Comprehensive Modules"] }), _jsx("h2", { className: "fv-section-title-on-blue", children: "Everything Your Production Team Needs" }), _jsx("p", { className: "fv-section-desc-on-blue", style: { margin: '0 auto' }, children: "Built specifically for discrete and batch manufacturing. Each module works standalone or seamlessly together." })] }), _jsx("div", { style: {
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 'var(--space-3)',
                            flexWrap: 'wrap',
                            marginBottom: 'var(--space-10)',
                        }, children: modules.map((mod, index) => {
                            const isSelected = activeModule === index;
                            return (_jsxs("button", { onClick: () => setActiveModule(index), style: {
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 'var(--space-2)',
                                    padding: `var(--space-3) var(--space-6)`,
                                    borderRadius: '9999px',
                                    border: isSelected ? '1px solid var(--color-on-primary)' : '1px solid color-mix(in srgb, var(--color-on-primary) 25%, transparent)',
                                    backgroundColor: isSelected ? 'var(--color-on-primary)' : 'color-mix(in srgb, var(--color-on-primary) 10%, transparent)',
                                    color: isSelected ? 'var(--color-primary)' : 'var(--color-on-primary)',
                                    fontWeight: 700,
                                    fontSize: '14px',
                                    whiteSpace: 'nowrap',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s ease',
                                    boxShadow: isSelected ? 'var(--elevation-2)' : 'none',
                                }, children: [_jsx(Icon, { name: mod.icon, size: 18 }), mod.title] }, mod.id));
                        }) }), _jsx(AnimatePresence, { mode: "wait", children: _jsxs(motion.div, { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -16 }, transition: { duration: 0.25 }, className: "fv-card-on-blue", style: {
                                padding: 'var(--space-10)',
                                backgroundColor: 'var(--color-surface)',
                                display: 'grid',
                                gridTemplateColumns: '1.2fr 1fr',
                                gap: 'var(--space-10)',
                                alignItems: 'center',
                            }, children: [_jsxs("div", { children: [_jsx("div", { style: { display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }, children: _jsxs("span", { style: {
                                                    backgroundColor: 'var(--color-info-container)',
                                                    color: 'var(--color-on-info-container)',
                                                    border: '1px solid var(--color-info-container)',
                                                    padding: `var(--space-1) var(--space-3)`,
                                                    borderRadius: '9999px',
                                                    fontSize: '12px',
                                                    fontWeight: 700,
                                                    textTransform: 'uppercase',
                                                }, children: [current.title, " Module"] }) }), _jsx("h3", { style: { fontSize: '26px', fontWeight: 800, marginBottom: 'var(--space-3)', color: 'var(--color-on-surface)' }, children: current.tagline }), _jsx("p", { style: { fontSize: '15px', color: 'var(--color-on-surface-variant)', marginBottom: 'var(--space-8)', lineHeight: 1.55 }, children: "Equipped with industrial capabilities designed to streamline daily shopfloor operations and eliminate manual paperwork." }), _jsx("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 'var(--space-4)' }, children: current.features.map((f) => (_jsxs("div", { style: {
                                                    padding: 'var(--space-4)',
                                                    borderRadius: '14px',
                                                    backgroundColor: 'var(--color-surface-container-low)',
                                                    border: '1px solid var(--color-outline-variant)',
                                                }, children: [_jsx("div", { style: { fontWeight: 800, fontSize: '14px', color: 'var(--color-primary)', marginBottom: 'var(--space-1)' }, children: f.name }), _jsx("div", { style: { fontSize: '12px', color: 'var(--color-on-surface-variant)', lineHeight: 1.45 }, children: f.desc })] }, f.name))) })] }), _jsx("div", { children: _jsxs("div", { className: "fv-browser-frame", children: [_jsxs("div", { className: "fv-browser-header", children: [_jsxs("div", { className: "fv-browser-dots", children: [_jsx("span", { className: "fv-browser-dot" }), _jsx("span", { className: "fv-browser-dot" }), _jsx("span", { className: "fv-browser-dot" })] }), _jsxs("div", { className: "fv-browser-address-bar", children: [_jsx(Icon, { name: "verified", size: 12 }), _jsxs("span", { children: ["app.factoryvision.io/", current.id] })] })] }), _jsx("div", { className: "fv-browser-body", children: _jsx("img", { src: current.screenshot, alt: `${current.title} Screenshot`, className: "fv-browser-img", loading: "lazy" }) })] }) })] }, current.id) })] }), _jsx("style", { children: `
        @media (max-width: 960px) {
          #modules .fv-card-on-blue {
            grid-template-columns: 1fr !important;
          }
        }
      ` })] }));
};
//# sourceMappingURL=ModulesSection.js.map