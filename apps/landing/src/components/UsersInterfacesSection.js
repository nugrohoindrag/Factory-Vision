import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Icon } from '@factory-vision/ui';
export const UsersInterfacesSection = () => {
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
    return (_jsxs("section", { className: "fv-section-py", style: { backgroundColor: 'var(--color-primary)', color: 'var(--color-on-primary)' }, children: [_jsxs("div", { className: "fv-landing-container", children: [_jsxs("div", { style: { textAlign: 'center', maxWidth: '800px', margin: '0 auto 48px' }, children: [_jsxs("div", { className: "fv-eyebrow-on-blue", children: [_jsx(Icon, { name: "group", size: 16 }), "Tailored Experiences"] }), _jsx("h2", { className: "fv-section-title-on-blue", children: "Built for Everyone on the Factory Floor" }), _jsx("p", { className: "fv-section-desc-on-blue", style: { margin: '0 auto' }, children: "From executives in the boardroom to frontline machine operators on the shopfloor, Factory Vision provides role-tailored interfaces that make everyday manufacturing work frictionless." })] }), _jsx("div", { style: {
                            display: 'flex',
                            justifyContent: 'center',
                            gap: 'var(--space-3)',
                            flexWrap: 'wrap',
                            marginBottom: 'var(--space-10)',
                        }, children: personas.map((p, idx) => {
                            const isSelected = selectedPersona === idx;
                            return (_jsxs("button", { onClick: () => setSelectedPersona(idx), style: {
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 'var(--space-3)',
                                    padding: `var(--space-3) var(--space-8)`,
                                    borderRadius: '9999px',
                                    border: isSelected ? '1px solid var(--color-on-primary)' : '1px solid color-mix(in srgb, var(--color-on-primary) 25%, transparent)',
                                    backgroundColor: isSelected ? 'var(--color-on-primary)' : 'color-mix(in srgb, var(--color-on-primary) 10%, transparent)',
                                    color: isSelected ? 'var(--color-primary)' : 'var(--color-on-primary)',
                                    fontWeight: 700,
                                    fontSize: '15px',
                                    whiteSpace: 'nowrap',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s ease',
                                    boxShadow: isSelected ? 'var(--elevation-2)' : 'none',
                                }, children: [_jsx(Icon, { name: p.icon, size: 20 }), p.shortTitle] }, p.id));
                        }) }), _jsx(AnimatePresence, { mode: "wait", children: _jsxs(motion.div, { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -16 }, transition: { duration: 0.25 }, className: "fv-card-on-blue", style: {
                                padding: 'var(--space-10)',
                                backgroundColor: 'var(--color-surface)',
                                display: 'grid',
                                gridTemplateColumns: '1fr 1.15fr',
                                gap: 'var(--space-10)',
                                alignItems: 'center',
                            }, children: [_jsxs("div", { children: [_jsxs("span", { style: {
                                                fontSize: '12px',
                                                fontWeight: 700,
                                                color: 'var(--color-on-info-container)',
                                                backgroundColor: 'var(--color-info-container)',
                                                border: '1px solid var(--color-info-container)',
                                                padding: `var(--space-1) var(--space-3)`,
                                                borderRadius: '9999px',
                                                textTransform: 'uppercase',
                                            }, children: [current.shortTitle, " Experience"] }), _jsx("h3", { style: { fontSize: '26px', fontWeight: 800, margin: `var(--space-3) 0 var(--space-2)`, color: 'var(--color-primary)' }, children: current.title }), _jsx("p", { style: { fontSize: '15px', color: 'var(--color-on-surface)', lineHeight: 1.55, marginBottom: 'var(--space-6)' }, children: current.tagline }), _jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }, children: current.benefits.map((b) => (_jsxs("div", { style: {
                                                    padding: `var(--space-4) var(--space-5)`,
                                                    backgroundColor: 'var(--color-surface-container-low)',
                                                    border: '1px solid var(--color-outline-variant)',
                                                    borderRadius: '12px',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 'var(--space-3)',
                                                    fontSize: '14px',
                                                    fontWeight: 600,
                                                    color: 'var(--color-on-surface)',
                                                }, children: [_jsx(Icon, { name: "check_circle", size: 18, color: "var(--color-primary)" }), _jsx("span", { children: b })] }, b))) })] }), _jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }, children: _jsxs("div", { className: "fv-browser-frame", children: [_jsxs("div", { className: "fv-browser-header", children: [_jsxs("div", { className: "fv-browser-dots", children: [_jsx("span", { className: "fv-browser-dot" }), _jsx("span", { className: "fv-browser-dot" }), _jsx("span", { className: "fv-browser-dot" })] }), _jsxs("div", { className: "fv-browser-address-bar", children: [_jsx(Icon, { name: "visibility", size: 12 }), _jsxs("span", { children: ["app.factoryvision.io/", current.id] })] })] }), _jsx("div", { className: "fv-browser-body", children: _jsx("img", { src: current.screenshot, alt: `${current.title} UI Preview`, className: "fv-browser-img", loading: "lazy" }) })] }) })] }, current.id) })] }), _jsx("style", { children: `
        @media (max-width: 960px) {
          .fv-card-on-blue {
            grid-template-columns: 1fr !important;
          }
        }
      ` })] }));
};
//# sourceMappingURL=UsersInterfacesSection.js.map