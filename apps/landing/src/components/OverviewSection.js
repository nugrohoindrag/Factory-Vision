import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { motion } from 'motion/react';
import { Icon } from '@factory-vision/ui';
import { FactoryVisionIcon } from '@factory-vision/ui/fv';
export const OverviewSection = () => {
    return (_jsxs("section", { className: "fv-section-py", style: { backgroundColor: 'var(--color-surface)' }, children: [_jsxs("div", { className: "fv-landing-container", children: [_jsxs("div", { style: { textAlign: 'center', maxWidth: '800px', margin: '0 auto 48px' }, children: [_jsxs("div", { className: "fv-eyebrow", children: [_jsx(Icon, { name: "hub", size: 16 }), "Unified Ecosystem"] }), _jsx("h2", { className: "fv-section-title", children: "One Operational View of Your Factory" }), _jsx("p", { className: "fv-section-desc", style: { margin: '0 auto', color: 'var(--color-on-surface-variant)' }, children: "Break down manufacturing data silos. Factory Vision synchronizes planning, machine sensors, operator actions, and quality inspections into a single synchronized digital nervous system." })] }), _jsxs("div", { className: "fv-card", style: {
                            padding: 'var(--space-10)',
                            backgroundColor: 'var(--color-surface)',
                            position: 'relative',
                            overflow: 'hidden',
                        }, children: [_jsx("div", { style: { textAlign: 'center', marginBottom: 'var(--space-10)', position: 'relative' }, children: _jsxs("div", { style: {
                                        display: 'inline-flex',
                                        flexDirection: 'column',
                                        alignItems: 'center',
                                        background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary) 100%)',
                                        color: 'var(--color-on-primary)',
                                        padding: `var(--space-5) var(--space-12)`,
                                        borderRadius: '24px',
                                        boxShadow: 'var(--elevation-3)',
                                        border: '1px solid color-mix(in srgb, var(--color-on-primary) 20%, transparent)',
                                    }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-2)' }, children: [_jsx(FactoryVisionIcon, { size: 28 }), _jsx("span", { style: { fontSize: '22px', fontWeight: 800, letterSpacing: '0.03em' }, children: "FACTORY VISION" })] }), _jsx("span", { style: { fontSize: '12px', opacity: 0.95, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600, color: 'var(--color-on-primary)' }, children: "Real-Time MES Intelligence Engine" })] }) }), _jsxs("div", { className: "fv-grid-3", style: { position: 'relative', zIndex: 1, marginBottom: 'var(--space-8)' }, children: [_jsxs(motion.div, { initial: { opacity: 0, y: 16 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true }, className: "fv-card", style: { padding: 'var(--space-6)', backgroundColor: 'var(--color-surface-container-low)', border: '1px solid var(--color-outline-variant)' }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }, children: [_jsx("div", { style: {
                                                            width: '42px',
                                                            height: '42px',
                                                            borderRadius: '12px',
                                                            backgroundColor: 'var(--color-info-container)',
                                                            color: 'var(--color-on-info-container)',
                                                            border: '1px solid var(--color-info-container)',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                        }, children: _jsx(Icon, { name: "assignment", size: 22 }) }), _jsxs("div", { children: [_jsx("h4", { style: { fontSize: '18px', fontWeight: 800, color: 'var(--color-on-surface)' }, children: "Production" }), _jsx("span", { style: { fontSize: '12px', color: 'var(--color-on-surface-variant)', fontWeight: 600 }, children: "Orders & Planning" })] })] }), _jsx("ul", { style: { listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }, children: ['Production Orders', 'Work Order Scheduling', 'Batch & Lot Control', 'Bill of Materials (BOM)', 'Routing & WIP Progress'].map((item) => (_jsxs("li", { style: {
                                                        fontSize: '13px',
                                                        color: 'var(--color-on-surface-variant)',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: 'var(--space-2)',
                                                        fontWeight: 500,
                                                    }, children: [_jsx(Icon, { name: "check_circle", size: 16, color: "var(--color-primary)" }), item] }, item))) })] }), _jsxs(motion.div, { initial: { opacity: 0, y: 16 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true }, transition: { delay: 0.1 }, className: "fv-card", style: { padding: 'var(--space-6)', backgroundColor: 'var(--color-surface-container-low)', border: '1px solid var(--color-outline-variant)' }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }, children: [_jsx("div", { style: {
                                                            width: '42px',
                                                            height: '42px',
                                                            borderRadius: '12px',
                                                            backgroundColor: 'var(--color-info-container)',
                                                            color: 'var(--color-on-info-container)',
                                                            border: '1px solid var(--color-info-container)',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                        }, children: _jsx(Icon, { name: "precision_manufacturing", size: 22 }) }), _jsxs("div", { children: [_jsx("h4", { style: { fontSize: '18px', fontWeight: 800, color: 'var(--color-on-surface)' }, children: "Machines" }), _jsx("span", { style: { fontSize: '12px', color: 'var(--color-on-surface-variant)', fontWeight: 600 }, children: "Edge Telemetry" })] })] }), _jsx("ul", { style: { listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }, children: ['Real-Time Running / Idle / Down', 'Edge PLC & Sensor Ingestion', 'Automated Downtime Tagging', 'Cycle Time Monitoring', 'Maintenance & Spares Alert'].map((item) => (_jsxs("li", { style: {
                                                        fontSize: '13px',
                                                        color: 'var(--color-on-surface-variant)',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: 'var(--space-2)',
                                                        fontWeight: 500,
                                                    }, children: [_jsx(Icon, { name: "check_circle", size: 16, color: "var(--color-info)" }), item] }, item))) })] }), _jsxs(motion.div, { initial: { opacity: 0, y: 16 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true }, transition: { delay: 0.2 }, className: "fv-card", style: { padding: 'var(--space-6)', backgroundColor: 'var(--color-surface-container-low)', border: '1px solid var(--color-outline-variant)' }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }, children: [_jsx("div", { style: {
                                                            width: '42px',
                                                            height: '42px',
                                                            borderRadius: '12px',
                                                            backgroundColor: 'var(--color-success-container)',
                                                            color: 'var(--color-on-success-container)',
                                                            border: '1px solid var(--color-success-container)',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                        }, children: _jsx(Icon, { name: "group", size: 22 }) }), _jsxs("div", { children: [_jsx("h4", { style: { fontSize: '18px', fontWeight: 800, color: 'var(--color-on-surface)' }, children: "People" }), _jsx("span", { style: { fontSize: '12px', color: 'var(--color-on-surface-variant)', fontWeight: 600 }, children: "Shopfloor Workforce" })] })] }), _jsx("ul", { style: { listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }, children: ['Touchscreen Operator Terminal', 'Shift Setup & Handover Logs', 'Activity & Task Logging', 'Skills & Station Authorization', 'Real-Time Andon Call System'].map((item) => (_jsxs("li", { style: {
                                                        fontSize: '13px',
                                                        color: 'var(--color-on-surface-variant)',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: 'var(--space-2)',
                                                        fontWeight: 500,
                                                    }, children: [_jsx(Icon, { name: "check_circle", size: 16, color: "var(--color-success)" }), item] }, item))) })] })] }), _jsxs("div", { style: {
                                    borderTop: '1px solid var(--color-outline-variant)',
                                    paddingTop: 'var(--space-8)',
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(3, 1fr)',
                                    gap: 'var(--space-4)',
                                }, className: "fv-overview-bottom-grid", children: [_jsxs("div", { style: {
                                            backgroundColor: 'var(--color-surface)',
                                            border: '1px solid var(--color-outline-variant)',
                                            borderRadius: '16px',
                                            padding: `var(--space-4) var(--space-5)`,
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 'var(--space-4)',
                                            boxShadow: 'var(--fv-card-shadow)',
                                        }, children: [_jsx("div", { style: {
                                                    width: '38px',
                                                    height: '38px',
                                                    borderRadius: '10px',
                                                    backgroundColor: 'var(--color-info-container)',
                                                    color: 'var(--color-on-info-container)',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    flexShrink: 0,
                                                }, children: _jsx(Icon, { name: "verified", size: 20 }) }), _jsx("span", { style: { fontSize: '14px', fontWeight: 700, color: 'var(--color-on-surface)' }, children: "Quality Control & Traceability" })] }), _jsxs("div", { style: {
                                            backgroundColor: 'var(--color-surface)',
                                            border: '1px solid var(--color-outline-variant)',
                                            borderRadius: '16px',
                                            padding: `var(--space-4) var(--space-5)`,
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 'var(--space-4)',
                                            boxShadow: 'var(--fv-card-shadow)',
                                        }, children: [_jsx("div", { style: {
                                                    width: '38px',
                                                    height: '38px',
                                                    borderRadius: '10px',
                                                    backgroundColor: 'var(--color-success-container)',
                                                    color: 'var(--color-on-success-container)',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    flexShrink: 0,
                                                }, children: _jsx(Icon, { name: "analytics", size: 20 }) }), _jsx("span", { style: { fontSize: '14px', fontWeight: 700, color: 'var(--color-on-surface)' }, children: "OEE & Loss Categorization" })] }), _jsxs("div", { style: {
                                            backgroundColor: 'var(--color-surface)',
                                            border: '1px solid var(--color-outline-variant)',
                                            borderRadius: '16px',
                                            padding: `var(--space-4) var(--space-5)`,
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 'var(--space-4)',
                                            boxShadow: 'var(--fv-card-shadow)',
                                        }, children: [_jsx("div", { style: {
                                                    width: '38px',
                                                    height: '38px',
                                                    borderRadius: '10px',
                                                    backgroundColor: 'var(--color-info-container)',
                                                    color: 'var(--color-on-info-container)',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    flexShrink: 0,
                                                }, children: _jsx(Icon, { name: "insights", size: 20 }) }), _jsx("span", { style: { fontSize: '14px', fontWeight: 700, color: 'var(--color-on-surface)' }, children: "Factory-Wide Actionable Insights" })] })] })] })] }), _jsx("style", { children: `
        @media (max-width: 900px) {
          .fv-overview-bottom-grid {
            grid-template-columns: 1fr !important;
          }
        }
      ` })] }));
};
//# sourceMappingURL=OverviewSection.js.map