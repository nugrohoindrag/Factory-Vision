import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { motion } from 'motion/react';
import { Icon } from '@factory-vision/ui';
export const VisibilitySection = () => {
    const pillars = [
        {
            id: 'production',
            title: 'Production Visibility',
            tagline: 'Know exactly what is being produced, where, and how much at every station.',
            image: '/assets/factory/smart-factory-line.jpg',
            icon: 'precision_manufacturing',
            badge: 'Order Tracking',
            statLabel: 'Active Work Orders',
            statValue: '28 Orders in Progress',
            highlight: '100% Real-Time WIP Visibility',
        },
        {
            id: 'machines',
            title: 'Machine Fleet Health',
            tagline: 'See machine status, speed degradation, and andon stoppages in real time.',
            image: '/assets/machines/cnc-milling-machine.jpg',
            icon: 'memory',
            badge: 'Edge Telemetry',
            statLabel: 'Machine Fleet Status',
            statValue: '12 Running · 2 Idle',
            highlight: 'Instant Downtime Root-Cause',
        },
        {
            id: 'operators',
            title: 'Operator Empowerment',
            tagline: 'Connect every production activity to the frontline people executing it.',
            image: '/assets/operators/technician-inspection.jpg',
            icon: 'badge',
            badge: 'Shopfloor Execution',
            statLabel: 'Active Shift Workforce',
            statValue: '46 Operators Logged In',
            highlight: 'Zero-Friction Tablet Entry',
        },
        {
            id: 'performance',
            title: 'Performance & OEE',
            tagline: 'Understand what is driving productivity, efficiency, and capacity losses.',
            image: '/assets/factory/factory-floor.jpg',
            icon: 'insights',
            badge: 'Continuous Improvement',
            statLabel: 'Efficiency Benchmark',
            statValue: '87.4% Plant OEE',
            highlight: 'Continuous Loss Elimination',
        },
    ];
    return (_jsx("section", { id: "overview", className: "fv-section-py", style: { backgroundColor: 'var(--color-primary)', color: 'var(--color-on-primary)' }, children: _jsxs("div", { className: "fv-landing-container", children: [_jsxs("div", { style: { textAlign: 'center', maxWidth: '780px', margin: '0 auto 48px' }, children: [_jsxs("div", { className: "fv-eyebrow-on-blue", children: [_jsx(Icon, { name: "visibility", size: 16 }), "Operational Visibility"] }), _jsxs("h2", { className: "fv-section-title-on-blue", children: ["Your Factory Is Running.", _jsx("br", {}), _jsx("span", { children: "But Do You Really See It?" })] }), _jsx("p", { className: "fv-section-desc-on-blue", style: { margin: '0 auto' }, children: "Traditional spreadsheets and delayed shift reports leave blind spots across the shopfloor. Factory Vision provides a single source of truth connecting every heartbeat of your manufacturing process." })] }), _jsx("div", { className: "fv-grid-2", style: { gap: 'var(--space-8)' }, children: pillars.map((pillar, idx) => (_jsxs(motion.div, { initial: { opacity: 0, y: 24 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: '-60px' }, transition: { duration: 0.5, delay: idx * 0.1 }, className: "fv-card-on-blue", style: {
                            overflow: 'hidden',
                            display: 'flex',
                            flexDirection: 'column',
                            backgroundColor: 'var(--color-surface)',
                        }, children: [_jsxs("div", { style: { position: 'relative', height: '240px', overflow: 'hidden' }, children: [_jsx("img", { src: pillar.image, alt: pillar.title, style: {
                                            width: '100%',
                                            height: '100%',
                                            objectFit: 'cover',
                                            transition: 'transform 0.4s ease',
                                        }, onMouseEnter: (e) => {
                                            e.currentTarget.style.transform = 'scale(1.04)';
                                        }, onMouseLeave: (e) => {
                                            e.currentTarget.style.transform = 'scale(1.0)';
                                        } }), _jsx("div", { style: {
                                            position: 'absolute',
                                            inset: 0,
                                            background: 'linear-gradient(180deg, transparent 35%, var(--color-media-scrim) 100%)',
                                        } }), _jsxs("div", { style: {
                                            position: 'absolute',
                                            top: '16px',
                                            left: '16px',
                                            backgroundColor: 'var(--color-media-scrim)',
                                            backdropFilter: 'blur(6px)',
                                            color: 'var(--color-on-primary)',
                                            padding: `var(--space-2) var(--space-4)`,
                                            borderRadius: '9999px',
                                            fontSize: '12px',
                                            fontWeight: 700,
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 'var(--space-2)',
                                            boxShadow: 'var(--elevation-1)',
                                        }, children: [_jsx(Icon, { name: pillar.icon, size: 15 }), pillar.badge] }), _jsxs("div", { style: {
                                            position: 'absolute',
                                            bottom: '16px',
                                            left: '20px',
                                            right: '20px',
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            color: 'var(--color-on-primary)',
                                        }, children: [_jsx("span", { style: { fontSize: '13px', opacity: 0.9, fontWeight: 500 }, children: pillar.statLabel }), _jsx("span", { style: { fontSize: '15px', fontWeight: 800, color: 'var(--color-on-primary)' }, className: "fv-num", children: pillar.statValue })] })] }), _jsx("div", { style: { padding: 'var(--space-8)', display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'space-between' }, children: _jsxs("div", { children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)', gap: 'var(--space-2)', flexWrap: 'wrap' }, children: [_jsx("h3", { style: { fontSize: '22px', fontWeight: 800, color: 'var(--color-on-surface)' }, children: pillar.title }), _jsx("span", { style: {
                                                        fontSize: '12px',
                                                        fontWeight: 700,
                                                        color: 'var(--color-on-info-container)',
                                                        backgroundColor: 'var(--color-info-container)',
                                                        border: '1px solid var(--color-info-container)',
                                                        padding: `var(--space-1) var(--space-3)`,
                                                        borderRadius: '9999px',
                                                    }, children: pillar.highlight })] }), _jsx("p", { style: { fontSize: '15px', color: 'var(--color-on-surface-variant)', lineHeight: 1.55 }, children: pillar.tagline })] }) })] }, pillar.id))) })] }) }));
};
//# sourceMappingURL=VisibilitySection.js.map