import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { motion } from 'motion/react';
import { Icon } from '@factory-vision/ui';
export const DataDecisionSection = () => {
    const shopfloorEvents = [
        { name: 'PLC Sensor Strokes', icon: 'memory', color: 'var(--color-primary)' },
        { name: 'Operator Output Tally', icon: 'devices', color: 'var(--color-success)' },
        { name: 'Downtime & Stoppage Codes', icon: 'report_problem', color: 'var(--color-error)' },
        { name: 'Quality Inspection Results', icon: 'verified', color: 'var(--color-info)' },
        { name: 'Shift Handover Notes', icon: 'assignment', color: 'var(--color-warning)' },
    ];
    const outcomes = [
        { title: 'Instant Bottleneck Alleviation', desc: 'Rebalance production lines before starvation occurs' },
        { title: 'Automated Root-Cause OEE', desc: 'Eliminate chronic micro-stoppages with hard telemetry' },
        { title: 'Proactive Maintenance', desc: 'Schedule tooling swaps based on actual machine cycle strokes' },
        { title: 'Audit-Ready Traceability', desc: 'Export certified batch genealogy reports in one click' },
    ];
    return (_jsxs("section", { className: "fv-section-py", style: { backgroundColor: 'var(--color-surface)' }, children: [_jsxs("div", { className: "fv-landing-container", children: [_jsxs("div", { style: { textAlign: 'center', maxWidth: '800px', margin: '0 auto 48px' }, children: [_jsxs("div", { className: "fv-eyebrow", children: [_jsx(Icon, { name: "analytics", size: 16 }), "Data Intelligence Loop"] }), _jsx("h2", { className: "fv-section-title", children: "Every Production Event Becomes Actionable Data" }), _jsx("p", { className: "fv-section-desc", style: { margin: '0 auto', color: 'var(--color-on-surface-variant)' }, children: "Transform scattered shopfloor noise into high-fidelity operational decisions. Continuous event streams power real-time dashboards and instant countermeasures." })] }), _jsx("div", { className: "fv-card", style: {
                            padding: 'var(--space-10)',
                            backgroundColor: 'var(--color-surface)',
                            position: 'relative',
                        }, children: _jsxs("div", { style: {
                                display: 'grid',
                                gridTemplateColumns: '1fr auto 1.2fr auto 1fr',
                                gap: 'var(--space-5)',
                                alignItems: 'center',
                            }, className: "fv-pipeline-grid", children: [_jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }, children: [_jsx("div", { style: { fontSize: '12px', fontWeight: 800, color: 'var(--color-on-surface-variant)', textTransform: 'uppercase', marginBottom: 'var(--space-1)' }, children: "01 Shopfloor Events" }), shopfloorEvents.map((ev) => (_jsxs("div", { style: {
                                                backgroundColor: 'var(--color-surface-container-low)',
                                                border: '1px solid var(--color-outline-variant)',
                                                borderRadius: '12px',
                                                padding: `var(--space-3) var(--space-4)`,
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 'var(--space-3)',
                                                fontSize: '13px',
                                                fontWeight: 600,
                                                color: 'var(--color-on-surface)',
                                            }, children: [_jsx(Icon, { name: ev.icon, size: 18, color: ev.color }), _jsx("span", { children: ev.name })] }, ev.name)))] }), _jsx("div", { style: { textAlign: 'center', color: 'var(--color-primary)' }, className: "fv-pipeline-arrow", children: _jsx(Icon, { name: "arrow_forward", size: 32 }) }), _jsxs(motion.div, { initial: { scale: 0.96 }, whileInView: { scale: 1 }, viewport: { once: true }, style: {
                                        background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary) 100%)',
                                        color: 'var(--color-on-primary)',
                                        borderRadius: '24px',
                                        padding: `var(--space-10) var(--space-6)`,
                                        textAlign: 'center',
                                        boxShadow: 'var(--elevation-4)',
                                        border: '1px solid color-mix(in srgb, var(--color-on-primary) 20%, transparent)',
                                    }, children: [_jsx(Icon, { name: "insights", size: 42, style: { marginBottom: 'var(--space-3)', color: 'var(--color-on-primary)' } }), _jsx("h4", { style: { fontSize: '22px', fontWeight: 800, marginBottom: 'var(--space-2)' }, children: "FACTORY VISION" }), _jsx("div", { style: { fontSize: '13px', opacity: 0.95, lineHeight: 1.4, marginBottom: 'var(--space-4)', color: 'var(--color-on-primary)' }, children: "Real-Time Event Processing & Calculation Engine" }), _jsx("div", { style: {
                                                backgroundColor: 'color-mix(in srgb, var(--color-on-primary) 15%, transparent)',
                                                padding: `var(--space-2) var(--space-4)`,
                                                borderRadius: '9999px',
                                                fontSize: '12px',
                                                fontWeight: 700,
                                                letterSpacing: '0.04em',
                                                display: 'inline-block',
                                                color: 'var(--color-on-primary)',
                                            }, children: "< 100ms Ingestion Latency" })] }), _jsx("div", { style: { textAlign: 'center', color: 'var(--color-primary)' }, className: "fv-pipeline-arrow", children: _jsx(Icon, { name: "arrow_forward", size: 32 }) }), _jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }, children: [_jsx("div", { style: { fontSize: '12px', fontWeight: 800, color: 'var(--color-on-surface-variant)', textTransform: 'uppercase', marginBottom: 'var(--space-1)' }, children: "02 Better Decisions" }), outcomes.map((out) => (_jsxs("div", { style: {
                                                backgroundColor: 'var(--color-surface-container-low)',
                                                border: '1px solid var(--color-outline-variant)',
                                                borderRadius: '12px',
                                                padding: `var(--space-3) var(--space-4)`,
                                            }, children: [_jsx("div", { style: { fontWeight: 800, fontSize: '13px', color: 'var(--color-primary)', marginBottom: 'var(--space-1)' }, children: out.title }), _jsx("div", { style: { fontSize: '11px', color: 'var(--color-on-surface-variant)', lineHeight: 1.35 }, children: out.desc })] }, out.title)))] })] }) })] }), _jsx("style", { children: `
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