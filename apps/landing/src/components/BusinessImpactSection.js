import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { motion } from 'motion/react';
import { Icon } from '@factory-vision/ui';
export const BusinessImpactSection = () => {
    const impacts = [
        {
            icon: 'visibility',
            title: 'Real-Time Visibility',
            tagline: 'Eliminate blind spots across shifts and stations',
            desc: 'Know exactly what is being produced at any given second, track WIP levels between stations, and prevent unnoticed bottlenecks.',
            metric: '100%',
            metricLabel: 'Real-time shift awareness',
        },
        {
            icon: 'trending_up',
            title: 'Productivity & Utilization',
            tagline: 'Minimize idle time and speed losses',
            desc: 'Expose micro-stoppages, shorten changeover durations with standardized setup workflows, and maximize machine availability.',
            metric: '+15-25%',
            metricLabel: 'Capacity utilization unlock',
        },
        {
            icon: 'verified',
            title: 'Total Traceability',
            tagline: 'Audit-proof batch and quality records',
            desc: 'Link every raw material heat lot and operator action to finished goods. Resolve customer defect inquiries in seconds instead of days.',
            metric: '< 30s',
            metricLabel: 'Complete genealogy lookup',
        },
        {
            icon: 'insights',
            title: 'Confident Decision Making',
            tagline: 'Fact-based shopfloor continuous improvement',
            desc: 'Empower supervisors and management with uncorrupted automated telemetry rather than subjective end-of-shift guesstimates.',
            metric: '0',
            metricLabel: 'Paper checksheets required',
        },
    ];
    return (_jsx("section", { className: "fv-section-py", style: { backgroundColor: 'var(--color-primary)', color: 'var(--color-on-primary)' }, children: _jsxs("div", { className: "fv-landing-container", children: [_jsxs("div", { style: { textAlign: 'center', maxWidth: '800px', margin: '0 auto 48px' }, children: [_jsxs("div", { className: "fv-eyebrow-on-blue", children: [_jsx(Icon, { name: "verified", size: 16 }), "Measurable Value"] }), _jsx("h2", { className: "fv-section-title-on-blue", children: "Built to Improve Factory Performance" }), _jsx("p", { className: "fv-section-desc-on-blue", style: { margin: '0 auto' }, children: "Transforming shopfloor execution delivers immediate operational dividends across production velocity, quality compliance, and machine availability." })] }), _jsx("div", { className: "fv-grid-2", style: { gap: 'var(--space-8)' }, children: impacts.map((imp, idx) => (_jsx(motion.div, { initial: { opacity: 0, y: 20 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true }, transition: { delay: idx * 0.08 }, className: "fv-card-on-blue", style: {
                            padding: 'var(--space-10)',
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between',
                        }, children: _jsxs("div", { children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-5)' }, children: [_jsx("div", { style: {
                                                width: '48px',
                                                height: '48px',
                                                borderRadius: '14px',
                                                backgroundColor: 'var(--color-info-container)',
                                                color: 'var(--color-on-info-container)',
                                                border: '1px solid var(--color-info-container)',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                            }, children: _jsx(Icon, { name: imp.icon, size: 26 }) }), _jsxs("div", { style: { textAlign: 'right' }, children: [_jsx("div", { style: { fontSize: '28px', fontWeight: 800, color: 'var(--color-info)' }, className: "fv-num", children: imp.metric }), _jsx("div", { style: { fontSize: '11px', color: 'var(--color-on-surface-variant)', fontWeight: 700, textTransform: 'uppercase' }, children: imp.metricLabel })] })] }), _jsx("h3", { style: { fontSize: '22px', fontWeight: 800, color: 'var(--color-on-surface)', marginBottom: 'var(--space-1)' }, children: imp.title }), _jsx("div", { style: { fontSize: '13px', fontWeight: 700, color: 'var(--color-primary)', marginBottom: 'var(--space-3)' }, children: imp.tagline }), _jsx("p", { style: { fontSize: '15px', color: 'var(--color-on-surface)', lineHeight: 1.55 }, children: imp.desc })] }) }, imp.title))) })] }) }));
};
//# sourceMappingURL=BusinessImpactSection.js.map