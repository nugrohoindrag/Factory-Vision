import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Icon } from '@factory-vision/ui';
export const ShowcaseSection = () => {
    const [activeTab, setActiveTab] = useState(0);
    const items = [
        {
            id: '01',
            title: 'Executive Overview',
            screenshot: '/screenshots/01-executive-dashboard.png',
            icon: 'dashboard',
            description: 'Single-pane executive dashboard featuring plant-wide OEE, active work orders, target vs actual output, and live machine fleet health.',
            highlights: ['Real-time plant KPIs', 'Multi-line status rail', 'Hourly production pace counter'],
        },
        {
            id: '02',
            title: 'Production Performance',
            screenshot: '/screenshots/02-production-performance.png',
            icon: 'trending_up',
            description: 'Granular hourly and shift performance breakdown comparing standard cycle times against actual shopfloor execution.',
            highlights: ['Variance vs target analysis', 'Pacing trend charts', 'Line-by-line efficiency index'],
        },
        {
            id: '03',
            title: 'Work Orders Management',
            screenshot: '/screenshots/05-work-orders.png',
            icon: 'assignment',
            description: 'Centralized work order dispatching, routing sequences, SKU specifications, target quantities, and real-time completion status.',
            highlights: ['ERP order synchronization', 'Routing steps & stations', 'Batch & lot assignment'],
        },
        {
            id: '04',
            title: 'Live Production Board',
            screenshot: '/screenshots/06-live-board.png',
            icon: 'dashboard',
            description: 'Real-time andon overview displaying all active production lines, current operators, running SKUs, and immediate stoppage alerts.',
            highlights: ['Visual andon status flags', 'Station speed telemetry', 'Instant shift handover log'],
        },
        {
            id: '05',
            title: 'Operator Terminal',
            screenshot: '/screenshots/20-operator-terminal.png',
            icon: 'devices',
            description: 'Ultra-fast touchscreen interface built for shopfloor workers to start work orders, log good vs scrap counts, and tag downtime reasons.',
            highlights: ['Large touch buttons', '3-second piece logging', 'Offline-resilient local store'],
        },
        {
            id: '06',
            title: 'Downtime Analysis',
            screenshot: '/screenshots/04-downtime.png',
            icon: 'schedule',
            description: 'Comprehensive downtime tracking with category Pareto breakdowns, Mean Time Between Failures (MTBF), and Mean Time to Repair (MTTR).',
            highlights: ['Pareto loss analysis', 'Stoppage duration timeline', 'Reason tree categorization'],
        },
        {
            id: '07',
            title: 'OEE Analytics',
            screenshot: '/screenshots/03-oee.png',
            icon: 'speed',
            description: 'Automated calculation and historical benchmarking of Availability, Performance, and Quality factors across machines and shifts.',
            highlights: ['Six Big Losses breakdown', 'Historical trend comparison', 'Shift & machine filtering'],
        },
        {
            id: '08',
            title: 'Bottlenecks & Quality',
            screenshot: '/screenshots/08-bottlenecks.png',
            icon: 'analytics',
            description: 'Identify machine constraints choking line throughput and monitor quality checksheets, defect distributions, and scrap rates.',
            highlights: ['Constraint cycle heatmap', 'Defect Pareto charts', 'Zero-defect quality audit'],
        },
        {
            id: '09',
            title: 'Production Reports',
            screenshot: '/screenshots/09-reports-production.png',
            icon: 'description',
            description: 'Automated executive and operational reporting with one-click export to PDF/Excel for management meetings and customer audits.',
            highlights: ['Shift summary PDF exports', 'Audit-ready lot histories', 'Automated scheduled delivery'],
        },
    ];
    const current = items[activeTab];
    return (_jsx("section", { id: "showcase", className: "fv-section-py", style: { backgroundColor: 'var(--color-primary)', color: 'var(--color-on-primary)' }, children: _jsxs("div", { className: "fv-landing-container", children: [_jsxs("div", { style: { textAlign: 'center', maxWidth: '800px', margin: '0 auto 48px' }, children: [_jsxs("div", { className: "fv-eyebrow-on-blue", children: [_jsx(Icon, { name: "visibility", size: 16 }), "Live Product Showcase"] }), _jsx("h2", { className: "fv-section-title-on-blue", children: "The Complete Manufacturing Execution Platform" }), _jsx("p", { className: "fv-section-desc-on-blue", style: { margin: '0 auto' }, children: "Explore the actual screens and workflows powering daily operations on the factory floor." })] }), _jsx("div", { style: {
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 'var(--space-3)',
                        flexWrap: 'wrap',
                        marginBottom: 'var(--space-10)',
                    }, children: items.map((it, idx) => {
                        const isSelected = activeTab === idx;
                        return (_jsxs("button", { onClick: () => setActiveTab(idx), style: {
                                display: 'flex',
                                alignItems: 'center',
                                gap: 'var(--space-2)',
                                padding: `var(--space-3) var(--space-5)`,
                                borderRadius: '9999px',
                                border: isSelected ? '1px solid var(--color-on-primary)' : '1px solid color-mix(in srgb, var(--color-on-primary) 25%, transparent)',
                                backgroundColor: isSelected ? 'var(--color-on-primary)' : 'color-mix(in srgb, var(--color-on-primary) 10%, transparent)',
                                color: isSelected ? 'var(--color-primary)' : 'var(--color-on-primary)',
                                fontSize: '13px',
                                fontWeight: 700,
                                whiteSpace: 'nowrap',
                                cursor: 'pointer',
                                transition: 'all 0.15s ease',
                                boxShadow: isSelected ? 'var(--elevation-2)' : 'none',
                            }, children: [_jsx(Icon, { name: it.icon, size: 16 }), _jsx("span", { children: it.title })] }, it.id));
                    }) }), _jsx(AnimatePresence, { mode: "wait", children: _jsxs(motion.div, { initial: { opacity: 0, scale: 0.98 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0, scale: 0.98 }, transition: { duration: 0.25 }, className: "fv-card-on-blue", style: {
                            padding: 'var(--space-10)',
                            backgroundColor: 'var(--color-surface)',
                        }, children: [_jsxs("div", { style: {
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    flexWrap: 'wrap',
                                    gap: 'var(--space-4)',
                                    marginBottom: 'var(--space-6)',
                                }, children: [_jsxs("div", { children: [_jsxs("span", { style: {
                                                    fontSize: '12px',
                                                    fontWeight: 700,
                                                    color: 'var(--color-primary)',
                                                    backgroundColor: 'var(--color-info-container)',
                                                    border: '1px solid var(--color-info-container)',
                                                    padding: `var(--space-1) var(--space-3)`,
                                                    borderRadius: '9999px',
                                                    textTransform: 'uppercase',
                                                }, children: ["Screen ", current.id, " of 09"] }), _jsx("h3", { style: { fontSize: '26px', fontWeight: 800, margin: `var(--space-2) 0 var(--space-1)`, color: 'var(--color-on-surface)' }, children: current.title }), _jsx("p", { style: { fontSize: '15px', color: 'var(--color-on-surface-variant)', maxWidth: '640px' }, children: current.description })] }), _jsx("div", { style: { display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }, children: current.highlights.map((hl) => (_jsxs("span", { style: {
                                                backgroundColor: 'var(--color-surface-container-low)',
                                                border: '1px solid var(--color-outline-variant)',
                                                color: 'var(--color-on-surface)',
                                                padding: `var(--space-2) var(--space-4)`,
                                                borderRadius: '10px',
                                                fontSize: '13px',
                                                fontWeight: 600,
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 'var(--space-2)',
                                            }, children: [_jsx(Icon, { name: "check_circle", size: 16, color: "var(--color-primary)" }), hl] }, hl))) })] }), _jsxs("div", { className: "fv-browser-frame", children: [_jsxs("div", { className: "fv-browser-header", children: [_jsxs("div", { className: "fv-browser-dots", children: [_jsx("span", { className: "fv-browser-dot" }), _jsx("span", { className: "fv-browser-dot" }), _jsx("span", { className: "fv-browser-dot" })] }), _jsxs("div", { className: "fv-browser-address-bar", children: [_jsx(Icon, { name: "verified", size: 12 }), _jsxs("span", { children: ["app.factoryvision.io/modules/", current.id] })] })] }), _jsx("div", { className: "fv-browser-body", children: _jsx("img", { src: current.screenshot, alt: `${current.title} Screenshot Preview`, className: "fv-browser-img", loading: "lazy" }) })] })] }, current.id) })] }) }));
};
//# sourceMappingURL=ShowcaseSection.js.map