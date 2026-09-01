import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { motion } from 'motion/react';
import { Icon } from '@factory-vision/ui';
export const DataDecisionSection = () => {
    const shopfloorEvents = [
        { name: 'PLC Sensor Strokes', icon: 'memory', color: '#0A4174' },
        { name: 'Operator Output Tally', icon: 'devices', color: '#059669' },
        { name: 'Downtime & Stoppage Codes', icon: 'report_problem', color: '#DC2626' },
        { name: 'Quality Inspection Results', icon: 'verified', color: '#0284C7' },
        { name: 'Shift Handover Notes', icon: 'assignment', color: '#D97706' },
    ];
    const outcomes = [
        { title: 'Instant Bottleneck Alleviation', desc: 'Rebalance production lines before starvation occurs' },
        { title: 'Automated Root-Cause OEE', desc: 'Eliminate chronic micro-stoppages with hard telemetry' },
        { title: 'Proactive Maintenance', desc: 'Schedule tooling swaps based on actual machine cycle strokes' },
        { title: 'Audit-Ready Traceability', desc: 'Export certified batch genealogy reports in one click' },
    ];
    return (_jsxs("section", { className: "fv-section-py", style: { backgroundColor: '#FFFFFF' }, children: [_jsxs("div", { className: "fv-landing-container", children: [_jsxs("div", { style: { textAlign: 'center', maxWidth: '800px', margin: '0 auto 48px' }, children: [_jsxs("div", { className: "fv-eyebrow", children: [_jsx(Icon, { name: "analytics", size: 16 }), "Data Intelligence Loop"] }), _jsx("h2", { className: "fv-section-title", children: "Every Production Event Becomes Actionable Data" }), _jsx("p", { className: "fv-section-desc", style: { margin: '0 auto', color: '#334155' }, children: "Transform scattered shopfloor noise into high-fidelity operational decisions. Continuous event streams power real-time dashboards and instant countermeasures." })] }), _jsx("div", { className: "fv-card", style: {
                            padding: '36px',
                            backgroundColor: '#FFFFFF',
                            position: 'relative',
                        }, children: _jsxs("div", { style: {
                                display: 'grid',
                                gridTemplateColumns: '1fr auto 1.2fr auto 1fr',
                                gap: '20px',
                                alignItems: 'center',
                            }, className: "fv-pipeline-grid", children: [_jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: '10px' }, children: [_jsx("div", { style: { fontSize: '12px', fontWeight: 800, color: '#64748B', textTransform: 'uppercase', marginBottom: '4px' }, children: "01 Shopfloor Events" }), shopfloorEvents.map((ev) => (_jsxs("div", { style: {
                                                backgroundColor: '#F8FAFC',
                                                border: '1px solid #E2E8F0',
                                                borderRadius: '12px',
                                                padding: '12px 14px',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '12px',
                                                fontSize: '13px',
                                                fontWeight: 600,
                                                color: '#001D39',
                                            }, children: [_jsx(Icon, { name: ev.icon, size: 18, color: ev.color }), _jsx("span", { children: ev.name })] }, ev.name)))] }), _jsx("div", { style: { textAlign: 'center', color: '#0A4174' }, className: "fv-pipeline-arrow", children: _jsx(Icon, { name: "arrow_forward", size: 32 }) }), _jsxs(motion.div, { initial: { scale: 0.96 }, whileInView: { scale: 1 }, viewport: { once: true }, style: {
                                        background: 'linear-gradient(135deg, #001D39 0%, #0A4174 100%)',
                                        color: '#FFFFFF',
                                        borderRadius: '24px',
                                        padding: '36px 24px',
                                        textAlign: 'center',
                                        boxShadow: '0 16px 36px rgba(10, 65, 116, 0.3)',
                                        border: '1px solid rgba(255, 255, 255, 0.2)',
                                    }, children: [_jsx(Icon, { name: "insights", size: 42, style: { marginBottom: '12px', color: '#FFFFFF' } }), _jsx("h4", { style: { fontSize: '22px', fontWeight: 800, marginBottom: '6px' }, children: "FACTORY VISION" }), _jsx("div", { style: { fontSize: '13px', opacity: 0.95, lineHeight: 1.4, marginBottom: '16px', color: '#FFFFFF' }, children: "Real-Time Event Processing & Calculation Engine" }), _jsx("div", { style: {
                                                backgroundColor: 'rgba(255, 255, 255, 0.15)',
                                                padding: '8px 16px',
                                                borderRadius: '9999px',
                                                fontSize: '12px',
                                                fontWeight: 700,
                                                letterSpacing: '0.04em',
                                                display: 'inline-block',
                                                color: '#FFFFFF',
                                            }, children: "< 100ms Ingestion Latency" })] }), _jsx("div", { style: { textAlign: 'center', color: '#0A4174' }, className: "fv-pipeline-arrow", children: _jsx(Icon, { name: "arrow_forward", size: 32 }) }), _jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: '10px' }, children: [_jsx("div", { style: { fontSize: '12px', fontWeight: 800, color: '#64748B', textTransform: 'uppercase', marginBottom: '4px' }, children: "02 Better Decisions" }), outcomes.map((out) => (_jsxs("div", { style: {
                                                backgroundColor: '#F8FAFC',
                                                border: '1px solid #E2E8F0',
                                                borderRadius: '12px',
                                                padding: '12px 14px',
                                            }, children: [_jsx("div", { style: { fontWeight: 800, fontSize: '13px', color: '#0A4174', marginBottom: '2px' }, children: out.title }), _jsx("div", { style: { fontSize: '11px', color: '#334155', lineHeight: 1.35 }, children: out.desc })] }, out.title)))] })] }) })] }), _jsx("style", { children: `
        @media (max-width: 900px) {
          .fv-pipeline-grid {
            grid-template-columns: 1fr !important;
          }
          .fv-pipeline-arrow {
            display: none !important;
          }
        }
      ` })] }));
};
//# sourceMappingURL=DataDecisionSection.js.map