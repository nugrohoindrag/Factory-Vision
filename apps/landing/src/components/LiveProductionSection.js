import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { motion } from 'motion/react';
import { Icon } from '@factory-vision/ui';
export const LiveProductionSection = () => {
    const steps = [
        { num: '01', title: 'Production Order', desc: 'ERP order released to plant' },
        { num: '02', title: 'Work Order', desc: 'Assigned to line & shift schedule' },
        { num: '03', title: 'Operator Execution', desc: 'One-tap job start on tablet terminal' },
        { num: '04', title: 'Machine Activity', desc: 'Sensors log cycle times & strokes' },
        { num: '05', title: 'Output & Quality', desc: 'Good vs reject tally with digital QC' },
        { num: '06', title: 'Performance Analytics', desc: 'Instant OEE & cost calculation' },
    ];
    return (_jsxs("section", { id: "shopfloor", className: "fv-section-py", style: { backgroundColor: '#FFFFFF' }, children: [_jsxs("div", { className: "fv-landing-container", children: [_jsxs("div", { style: { textAlign: 'center', maxWidth: '800px', margin: '0 auto 48px' }, children: [_jsxs("div", { className: "fv-eyebrow", children: [_jsx(Icon, { name: "play_arrow", size: 16 }), "Shopfloor Execution"] }), _jsx("h2", { className: "fv-section-title", children: "From Production Order to Actual Production" }), _jsx("p", { className: "fv-section-desc", style: { margin: '0 auto', color: '#334155' }, children: "Give operators a simple, distraction-free interface to execute production, record output, report downtime, and capture shopfloor events in real time." })] }), _jsx("div", { style: {
                            display: 'grid',
                            gridTemplateColumns: 'repeat(6, 1fr)',
                            gap: '14px',
                            marginBottom: '48px',
                        }, className: "fv-workflow-steps", children: steps.map((s, idx) => (_jsxs(motion.div, { initial: { opacity: 0, y: 16 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true }, transition: { delay: idx * 0.08 }, className: "fv-card", style: {
                                backgroundColor: '#FFFFFF',
                                padding: '18px 14px',
                                position: 'relative',
                            }, children: [_jsxs("div", { style: {
                                        fontSize: '12px',
                                        fontWeight: 800,
                                        color: '#0A4174',
                                        backgroundColor: '#F0F9FF',
                                        border: '1px solid #BAE6FD',
                                        padding: '2px 8px',
                                        borderRadius: '9999px',
                                        display: 'inline-block',
                                        marginBottom: '8px',
                                    }, children: ["STEP ", s.num] }), _jsx("div", { style: { fontSize: '14px', fontWeight: 800, color: '#001D39', marginBottom: '4px' }, children: s.title }), _jsx("div", { style: { fontSize: '12px', color: '#334155', lineHeight: 1.35 }, children: s.desc })] }, s.num))) }), _jsxs("div", { className: "fv-card fv-live-production-grid", style: {
                            padding: '36px',
                            backgroundColor: '#FFFFFF',
                            display: 'grid',
                            gridTemplateColumns: '1.15fr 0.85fr',
                            gap: '36px',
                            alignItems: 'center',
                        }, children: [_jsx("div", { children: _jsxs("div", { className: "fv-browser-frame", children: [_jsxs("div", { className: "fv-browser-header", children: [_jsxs("div", { className: "fv-browser-dots", children: [_jsx("span", { className: "fv-browser-dot" }), _jsx("span", { className: "fv-browser-dot" }), _jsx("span", { className: "fv-browser-dot" })] }), _jsxs("div", { className: "fv-browser-address-bar", children: [_jsx(Icon, { name: "devices", size: 14 }), _jsx("span", { children: "terminal.factoryvision.io/station-cnc-02" })] }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: '6px' }, children: [_jsx("span", { className: "fv-status-dot running" }), _jsx("span", { style: { fontSize: '11px', fontWeight: 800, color: '#059669' }, children: "RUNNING" })] })] }), _jsx("div", { className: "fv-browser-body", children: _jsx("img", { src: "/screenshots/20-operator-terminal.png", alt: "Factory Vision Operator Terminal", className: "fv-browser-img", loading: "lazy" }) })] }) }), _jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: '20px' }, children: [_jsxs("div", { children: [_jsx("span", { style: {
                                                    fontSize: '12px',
                                                    fontWeight: 700,
                                                    color: '#0A4174',
                                                    backgroundColor: '#F0F9FF',
                                                    border: '1px solid #BAE6FD',
                                                    padding: '4px 12px',
                                                    borderRadius: '9999px',
                                                    textTransform: 'uppercase',
                                                }, children: "Touch-Optimized Operator Terminal" }), _jsx("h3", { style: { fontSize: '26px', fontWeight: 800, margin: '12px 0 8px', color: '#001D39' }, children: "Built for High-Speed Shopfloor Entry" }), _jsx("p", { style: { fontSize: '15px', color: '#334155', lineHeight: 1.55 }, children: "Large touch targets, zero complicated forms, and immediate visual feedback. Operators can log production output in under 3 seconds without leaving their workstation." })] }), _jsxs("div", { style: {
                                            backgroundColor: '#F8FAFC',
                                            border: '1px solid #E2E8F0',
                                            borderRadius: '16px',
                                            padding: '20px',
                                            display: 'grid',
                                            gridTemplateColumns: 'repeat(3, 1fr)',
                                            gap: '14px',
                                            textAlign: 'center',
                                        }, children: [_jsxs("div", { children: [_jsx("div", { style: { fontSize: '11px', color: '#64748B', fontWeight: 700 }, children: "GOOD OUTPUT" }), _jsxs("div", { style: { fontSize: '24px', fontWeight: 800, color: '#059669' }, className: "fv-num", children: ["3,820 ", _jsx("span", { style: { fontSize: '12px', color: '#64748B' }, children: "pcs" })] })] }), _jsxs("div", { children: [_jsx("div", { style: { fontSize: '11px', color: '#64748B', fontWeight: 700 }, children: "SCRAP / DEFECT" }), _jsxs("div", { style: { fontSize: '24px', fontWeight: 800, color: '#DC2626' }, className: "fv-num", children: ["14 ", _jsx("span", { style: { fontSize: '12px', color: '#64748B' }, children: "pcs" })] })] }), _jsxs("div", { children: [_jsx("div", { style: { fontSize: '11px', color: '#64748B', fontWeight: 700 }, children: "PROGRESS" }), _jsx("div", { style: { fontSize: '24px', fontWeight: 800, color: '#0A4174' }, className: "fv-num", children: "85.2%" })] })] }), _jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: '10px' }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', color: '#001D39' }, children: [_jsx(Icon, { name: "check_circle", size: 18, color: "#0A4174" }), _jsx("span", { children: "Single-tap output and scrap increments with audio confirmation" })] }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', color: '#001D39' }, children: [_jsx(Icon, { name: "report_problem", size: 18, color: "#D97706" }), _jsx("span", { children: "Instant downtime tagging (No Material, Tool Change, Breakdown, Setup)" })] }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', color: '#001D39' }, children: [_jsx(Icon, { name: "verified", size: 18, color: "#059669" }), _jsx("span", { children: "Offline-resilient caching with automatic background sync upon reconnection" })] })] })] })] })] }), _jsx("style", { children: `
        @media (max-width: 1024px) {
          .fv-workflow-steps {
            grid-template-columns: repeat(3, 1fr) !important;
          }
          .fv-live-production-grid {
            grid-template-columns: 1fr !important;
          }
        }
        @media (max-width: 640px) {
          .fv-workflow-steps {
            grid-template-columns: repeat(2, 1fr) !important;
          }
        }
      ` })] }));
};
//# sourceMappingURL=LiveProductionSection.js.map