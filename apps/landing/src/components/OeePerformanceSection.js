import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { motion } from 'motion/react';
import { Icon } from '@factory-vision/ui';
export const OeePerformanceSection = () => {
    const kpis = [
        { label: 'Overall Equipment Effectiveness (OEE)', val: '82.4%', sub: 'World-Class Benchmark: 85%', tone: 'var(--color-primary)' },
        { label: 'Availability Rate', val: '91.2%', sub: 'Planned vs Actual Operating Time', tone: 'var(--color-success)' },
        { label: 'Performance Efficiency', val: '89.4%', sub: 'Standard vs Actual Cycle Speed', tone: 'var(--color-info)' },
        { label: 'Quality Yield Rate', val: '98.1%', sub: 'Good Output vs Total Inspected', tone: 'var(--color-warning)' },
    ];
    const losses = [
        { category: '01 Equipment Breakdown', pct: '4.2%', desc: 'Unplanned mechanical failures & sensor trips', color: 'var(--color-error)' },
        { category: '02 Setup & Adjustments', pct: '4.6%', desc: 'Tooling swaps & recipe parameter changeovers', color: 'var(--color-warning)' },
        { category: '03 Small Stops & Idling', pct: '4.8%', desc: 'Part misfeeds, sensor pauses & micro-stops', color: 'var(--color-info)' },
        { category: '04 Reduced Speed', pct: '3.0%', desc: 'Running below theoretical maximum cycle speed', color: 'var(--color-info)' },
        { category: '05 Startup Rejects', pct: '0.9%', desc: 'Initial run scrap during line warm-up', color: 'var(--color-error)' },
        { category: '06 Production Defects', pct: '1.0%', desc: 'Dimensional out-of-spec & surface rework', color: 'var(--color-error)' },
    ];
    return (_jsxs("section", { id: "oee", className: "fv-section-py", style: { backgroundColor: 'var(--color-surface)' }, children: [_jsxs("div", { className: "fv-landing-container", children: [_jsxs("div", { style: { textAlign: 'center', maxWidth: '800px', margin: '0 auto 48px' }, children: [_jsxs("div", { className: "fv-eyebrow", children: [_jsx(Icon, { name: "insights", size: 16 }), "OEE & Continuous Improvement"] }), _jsx("h2", { className: "fv-section-title", children: "Turn Production Data Into Performance" }), _jsx("p", { className: "fv-section-desc", style: { margin: '0 auto', color: 'var(--color-on-surface-variant)' }, children: "Automatically calculate Availability, Performance, and Quality without waiting for manual shift tallying. Drill straight into the root causes holding back your factory output." })] }), _jsx("div", { style: {
                            display: 'grid',
                            gridTemplateColumns: 'repeat(4, 1fr)',
                            gap: 'var(--space-4)',
                            marginBottom: 'var(--space-12)',
                        }, className: "fv-oee-kpi-grid", children: kpis.map((kpi, idx) => (_jsxs(motion.div, { initial: { opacity: 0, scale: 0.95 }, whileInView: { opacity: 1, scale: 1 }, viewport: { once: true }, transition: { delay: idx * 0.08 }, className: "fv-card", style: {
                                padding: `var(--space-8) var(--space-6)`,
                                backgroundColor: 'var(--color-surface)',
                                borderTop: `4px solid ${kpi.tone}`,
                                display: 'flex',
                                flexDirection: 'column',
                                justifyContent: 'space-between',
                            }, children: [_jsxs("div", { children: [_jsx("div", { style: { fontSize: '12px', color: 'var(--color-on-surface-variant)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 'var(--space-2)', lineHeight: 1.4 }, children: kpi.label }), _jsx("div", { style: { fontSize: '36px', fontWeight: 800, color: 'var(--color-on-surface)', marginBottom: 'var(--space-1)' }, className: "fv-num", children: kpi.val })] }), _jsx("div", { style: { fontSize: '13px', color: 'var(--color-on-surface-variant)', marginTop: 'var(--space-2)', fontWeight: 500 }, children: kpi.sub })] }, kpi.label))) }), _jsxs("div", { className: "fv-card fv-oee-deepdive-grid", style: {
                            padding: 'var(--space-10)',
                            backgroundColor: 'var(--color-surface)',
                            display: 'grid',
                            gridTemplateColumns: '1.1fr 1fr',
                            gap: 'var(--space-10)',
                            alignItems: 'center',
                        }, children: [_jsxs("div", { children: [_jsx("div", { style: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }, children: _jsx("span", { style: {
                                                fontSize: '12px',
                                                fontWeight: 700,
                                                color: 'var(--color-on-info-container)',
                                                backgroundColor: 'var(--color-info-container)',
                                                border: '1px solid var(--color-info-container)',
                                                padding: `var(--space-1) var(--space-3)`,
                                                borderRadius: '9999px',
                                                textTransform: 'uppercase',
                                            }, children: "Six Big Losses Breakdown" }) }), _jsx("h3", { style: { fontSize: '26px', fontWeight: 800, margin: `var(--space-2) 0`, color: 'var(--color-on-surface)' }, children: "Why Are We Losing Production?" }), _jsx("p", { style: { fontSize: '15px', color: 'var(--color-on-surface-variant)', marginBottom: 'var(--space-6)', lineHeight: 1.55 }, children: "Identify exactly where productive capacity leaks during the shift with automated loss categorization." }), _jsx("div", { style: { display: 'grid', gridTemplateColumns: '1fr', gap: 'var(--space-3)' }, children: losses.map((loss) => (_jsxs("div", { style: {
                                                backgroundColor: 'var(--color-surface-container-low)',
                                                border: '1px solid var(--color-outline-variant)',
                                                borderRadius: '12px',
                                                padding: `var(--space-3) var(--space-4)`,
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                            }, children: [_jsxs("div", { children: [_jsx("div", { style: { fontSize: '14px', fontWeight: 700, color: 'var(--color-on-surface)' }, children: loss.category }), _jsx("div", { style: { fontSize: '12px', color: 'var(--color-on-surface-variant)' }, children: loss.desc })] }), _jsxs("span", { style: {
                                                        fontSize: '14px',
                                                        fontWeight: 800,
                                                        color: loss.color,
                                                        padding: `var(--space-1) var(--space-3)`,
                                                        backgroundColor: 'var(--color-surface)',
                                                        border: '1px solid var(--color-outline-variant)',
                                                        borderRadius: '9999px',
                                                    }, className: "fv-num", children: ["-", loss.pct] })] }, loss.category))) })] }), _jsx("div", { children: _jsxs("div", { className: "fv-browser-frame", children: [_jsxs("div", { className: "fv-browser-header", children: [_jsxs("div", { className: "fv-browser-dots", children: [_jsx("span", { className: "fv-browser-dot" }), _jsx("span", { className: "fv-browser-dot" }), _jsx("span", { className: "fv-browser-dot" })] }), _jsxs("div", { className: "fv-browser-address-bar", children: [_jsx(Icon, { name: "analytics", size: 12 }), _jsx("span", { children: "app.factoryvision.io/oee-analytics" })] })] }), _jsx("div", { className: "fv-browser-body", children: _jsx("img", { src: "/screenshots/03-oee.png", alt: "Factory Vision OEE Analytics", className: "fv-browser-img", loading: "lazy" }) })] }) })] })] }), _jsx("style", { children: `
        @media (max-width: 1024px) {
          .fv-oee-kpi-grid {
            grid-template-columns: repeat(2, 1fr) !important;
          }
          .fv-oee-deepdive-grid {
            grid-template-columns: 1fr !important;
          }
        }
      ` })] }));
};
//# sourceMappingURL=OeePerformanceSection.js.map