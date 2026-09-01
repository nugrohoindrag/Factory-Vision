import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { motion } from 'motion/react';
import { Icon } from '@factory-vision/ui';
import { FactoryVisionIcon } from '@factory-vision/ui/fv';
export const OverviewSection = () => {
    return (_jsxs("section", { className: "fv-section-py", style: { backgroundColor: '#FFFFFF' }, children: [_jsxs("div", { className: "fv-landing-container", children: [_jsxs("div", { style: { textAlign: 'center', maxWidth: '800px', margin: '0 auto 48px' }, children: [_jsxs("div", { className: "fv-eyebrow", children: [_jsx(Icon, { name: "hub", size: 16 }), "Unified Ecosystem"] }), _jsx("h2", { className: "fv-section-title", children: "One Operational View of Your Factory" }), _jsx("p", { className: "fv-section-desc", style: { margin: '0 auto', color: '#334155' }, children: "Break down manufacturing data silos. Factory Vision synchronizes planning, machine sensors, operator actions, and quality inspections into a single synchronized digital nervous system." })] }), _jsxs("div", { className: "fv-card", style: {
                            padding: '36px',
                            backgroundColor: '#FFFFFF',
                            position: 'relative',
                            overflow: 'hidden',
                        }, children: [_jsx("div", { style: { textAlign: 'center', marginBottom: '36px', position: 'relative' }, children: _jsxs("div", { style: {
                                        display: 'inline-flex',
                                        flexDirection: 'column',
                                        alignItems: 'center',
                                        background: 'linear-gradient(135deg, #001D39 0%, #0A4174 100%)',
                                        color: '#FFFFFF',
                                        padding: '20px 44px',
                                        borderRadius: '24px',
                                        boxShadow: '0 12px 30px rgba(10, 65, 116, 0.25)',
                                        border: '1px solid rgba(255, 255, 255, 0.2)',
                                    }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px' }, children: [_jsx(FactoryVisionIcon, { size: 28 }), _jsx("span", { style: { fontSize: '22px', fontWeight: 800, letterSpacing: '0.03em' }, children: "FACTORY VISION" })] }), _jsx("span", { style: { fontSize: '12px', opacity: 0.95, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600, color: '#FFFFFF' }, children: "Real-Time MES Intelligence Engine" })] }) }), _jsxs("div", { className: "fv-grid-3", style: { position: 'relative', zIndex: 1, marginBottom: '32px' }, children: [_jsxs(motion.div, { initial: { opacity: 0, y: 16 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true }, className: "fv-card", style: { padding: '24px', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0' }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }, children: [_jsx("div", { style: {
                                                            width: '42px',
                                                            height: '42px',
                                                            borderRadius: '12px',
                                                            backgroundColor: '#F0F9FF',
                                                            color: '#0A4174',
                                                            border: '1px solid #BAE6FD',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                        }, children: _jsx(Icon, { name: "assignment", size: 22 }) }), _jsxs("div", { children: [_jsx("h4", { style: { fontSize: '18px', fontWeight: 800, color: '#001D39' }, children: "Production" }), _jsx("span", { style: { fontSize: '12px', color: '#64748B', fontWeight: 600 }, children: "Orders & Planning" })] })] }), _jsx("ul", { style: { listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '10px' }, children: ['Production Orders', 'Work Order Scheduling', 'Batch & Lot Control', 'Bill of Materials (BOM)', 'Routing & WIP Progress'].map((item) => (_jsxs("li", { style: {
                                                        fontSize: '13px',
                                                        color: '#334155',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '8px',
                                                        fontWeight: 500,
                                                    }, children: [_jsx(Icon, { name: "check_circle", size: 16, color: "#0A4174" }), item] }, item))) })] }), _jsxs(motion.div, { initial: { opacity: 0, y: 16 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true }, transition: { delay: 0.1 }, className: "fv-card", style: { padding: '24px', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0' }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }, children: [_jsx("div", { style: {
                                                            width: '42px',
                                                            height: '42px',
                                                            borderRadius: '12px',
                                                            backgroundColor: '#F0F9FF',
                                                            color: '#0284C7',
                                                            border: '1px solid #BAE6FD',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                        }, children: _jsx(Icon, { name: "precision_manufacturing", size: 22 }) }), _jsxs("div", { children: [_jsx("h4", { style: { fontSize: '18px', fontWeight: 800, color: '#001D39' }, children: "Machines" }), _jsx("span", { style: { fontSize: '12px', color: '#64748B', fontWeight: 600 }, children: "Edge Telemetry" })] })] }), _jsx("ul", { style: { listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '10px' }, children: ['Real-Time Running / Idle / Down', 'Edge PLC & Sensor Ingestion', 'Automated Downtime Tagging', 'Cycle Time Monitoring', 'Maintenance & Spares Alert'].map((item) => (_jsxs("li", { style: {
                                                        fontSize: '13px',
                                                        color: '#334155',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '8px',
                                                        fontWeight: 500,
                                                    }, children: [_jsx(Icon, { name: "check_circle", size: 16, color: "#0284C7" }), item] }, item))) })] }), _jsxs(motion.div, { initial: { opacity: 0, y: 16 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true }, transition: { delay: 0.2 }, className: "fv-card", style: { padding: '24px', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0' }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }, children: [_jsx("div", { style: {
                                                            width: '42px',
                                                            height: '42px',
                                                            borderRadius: '12px',
                                                            backgroundColor: '#ECFDF5',
                                                            color: '#059669',
                                                            border: '1px solid #A7F3D0',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                        }, children: _jsx(Icon, { name: "group", size: 22 }) }), _jsxs("div", { children: [_jsx("h4", { style: { fontSize: '18px', fontWeight: 800, color: '#001D39' }, children: "People" }), _jsx("span", { style: { fontSize: '12px', color: '#64748B', fontWeight: 600 }, children: "Shopfloor Workforce" })] })] }), _jsx("ul", { style: { listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '10px' }, children: ['Touchscreen Operator Terminal', 'Shift Setup & Handover Logs', 'Activity & Task Logging', 'Skills & Station Authorization', 'Real-Time Andon Call System'].map((item) => (_jsxs("li", { style: {
                                                        fontSize: '13px',
                                                        color: '#334155',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '8px',
                                                        fontWeight: 500,
                                                    }, children: [_jsx(Icon, { name: "check_circle", size: 16, color: "#059669" }), item] }, item))) })] })] }), _jsxs("div", { style: {
                                    borderTop: '1px solid #E2E8F0',
                                    paddingTop: '28px',
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(3, 1fr)',
                                    gap: '16px',
                                }, className: "fv-overview-bottom-grid", children: [_jsxs("div", { style: {
                                            backgroundColor: '#FFFFFF',
                                            border: '1px solid #E2E8F0',
                                            borderRadius: '16px',
                                            padding: '16px 20px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '14px',
                                            boxShadow: 'var(--fv-card-shadow)',
                                        }, children: [_jsx("div", { style: {
                                                    width: '38px',
                                                    height: '38px',
                                                    borderRadius: '10px',
                                                    backgroundColor: '#F0F9FF',
                                                    color: '#0A4174',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    flexShrink: 0,
                                                }, children: _jsx(Icon, { name: "verified", size: 20 }) }), _jsx("span", { style: { fontSize: '14px', fontWeight: 700, color: '#001D39' }, children: "Quality Control & Traceability" })] }), _jsxs("div", { style: {
                                            backgroundColor: '#FFFFFF',
                                            border: '1px solid #E2E8F0',
                                            borderRadius: '16px',
                                            padding: '16px 20px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '14px',
                                            boxShadow: 'var(--fv-card-shadow)',
                                        }, children: [_jsx("div", { style: {
                                                    width: '38px',
                                                    height: '38px',
                                                    borderRadius: '10px',
                                                    backgroundColor: '#ECFDF5',
                                                    color: '#059669',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    flexShrink: 0,
                                                }, children: _jsx(Icon, { name: "analytics", size: 20 }) }), _jsx("span", { style: { fontSize: '14px', fontWeight: 700, color: '#001D39' }, children: "OEE & Loss Categorization" })] }), _jsxs("div", { style: {
                                            backgroundColor: '#FFFFFF',
                                            border: '1px solid #E2E8F0',
                                            borderRadius: '16px',
                                            padding: '16px 20px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '14px',
                                            boxShadow: 'var(--fv-card-shadow)',
                                        }, children: [_jsx("div", { style: {
                                                    width: '38px',
                                                    height: '38px',
                                                    borderRadius: '10px',
                                                    backgroundColor: '#F0F9FF',
                                                    color: '#0284C7',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    flexShrink: 0,
                                                }, children: _jsx(Icon, { name: "insights", size: 20 }) }), _jsx("span", { style: { fontSize: '14px', fontWeight: 700, color: '#001D39' }, children: "Factory-Wide Actionable Insights" })] })] })] })] }), _jsx("style", { children: `
        @media (max-width: 900px) {
          .fv-overview-bottom-grid {
            grid-template-columns: 1fr !important;
          }
        }
      ` })] }));
};
//# sourceMappingURL=OverviewSection.js.map