import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Icon } from '@factory-vision/ui';
export const QualityTraceabilitySection = () => {
    const steps = [
        { title: 'Work Order Bound', desc: 'Inspection criteria automatically loaded from SKU specs' },
        { title: 'Batch / Lot Assignment', desc: 'Raw material heat number & supplier lot verification' },
        { title: 'In-Line Quality Check', desc: 'Dimensional sampling & digital checksheets' },
        { title: 'Defect Tagging & Quarantine', desc: 'Instant defect categorization & hold trigger' },
        { title: 'End-to-End Genealogy', desc: 'Forward & backward trace report for audit compliance' },
    ];
    return (_jsxs("section", { className: "fv-section-py", style: { backgroundColor: 'var(--color-primary)', color: 'var(--color-on-primary)' }, children: [_jsxs("div", { className: "fv-landing-container", children: [_jsxs("div", { style: { textAlign: 'center', maxWidth: '800px', margin: '0 auto 48px' }, children: [_jsxs("div", { className: "fv-eyebrow-on-blue", children: [_jsx(Icon, { name: "verified", size: 16 }), "Built-In Quality & Traceability"] }), _jsx("h2", { className: "fv-section-title-on-blue", children: "Quality Is Part of Production" }), _jsx("p", { className: "fv-section-desc-on-blue", style: { margin: '0 auto' }, children: "Never rely on disconnected paper checksheets. Factory Vision enforces quality checkpoints directly inside the operator workflow and preserves complete lot genealogy from raw coils to finished pallets." })] }), _jsxs("div", { className: "fv-card-on-blue", style: {
                            padding: 'var(--space-10)',
                            backgroundColor: 'var(--color-surface)',
                            display: 'grid',
                            gridTemplateColumns: '1fr 1.1fr',
                            gap: 'var(--space-10)',
                            alignItems: 'center',
                        }, children: [_jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }, children: [_jsxs("div", { children: [_jsx("h3", { style: { fontSize: '26px', fontWeight: 800, color: 'var(--color-on-surface)', marginBottom: 'var(--space-2)' }, children: "Complete Batch Genealogy Trace" }), _jsx("p", { style: { fontSize: '15px', color: 'var(--color-on-surface-variant)', lineHeight: 1.55 }, children: "Track exactly which operator, machine, tool, and raw batch went into every serial number." })] }), _jsxs("div", { style: {
                                            backgroundColor: 'var(--color-surface-container-low)',
                                            border: '1px solid var(--color-outline-variant)',
                                            borderRadius: '16px',
                                            padding: 'var(--space-6)',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: 'var(--space-4)',
                                        }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [_jsxs("div", { children: [_jsx("span", { style: { fontSize: '11px', color: 'var(--color-on-surface-variant)', fontWeight: 700, textTransform: 'uppercase' }, children: "INSPECTED BATCH" }), _jsx("div", { style: { fontSize: '18px', fontWeight: 800, color: 'var(--color-on-surface)' }, children: "#LOT-2026-0881 (Aluminium 6061-T6)" })] }), _jsx("span", { style: {
                                                            backgroundColor: 'var(--color-success-container)',
                                                            color: 'var(--color-success)',
                                                            border: '1px solid var(--color-success-container)',
                                                            padding: `var(--space-1) var(--space-3)`,
                                                            borderRadius: '9999px',
                                                            fontSize: '12px',
                                                            fontWeight: 800,
                                                        }, children: "PASSED QC" })] }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-3)' }, children: [_jsxs("div", { style: { backgroundColor: 'var(--color-surface)', padding: 'var(--space-3)', borderRadius: '10px', border: '1px solid var(--color-outline-variant)' }, children: [_jsx("div", { style: { fontSize: '11px', color: 'var(--color-on-surface-variant)', fontWeight: 600 }, children: "Inspected" }), _jsx("div", { style: { fontSize: '16px', fontWeight: 800, color: 'var(--color-on-surface)' }, children: "150 pcs" })] }), _jsxs("div", { style: { backgroundColor: 'var(--color-surface)', padding: 'var(--space-3)', borderRadius: '10px', border: '1px solid var(--color-outline-variant)' }, children: [_jsx("div", { style: { fontSize: '11px', color: 'var(--color-on-surface-variant)', fontWeight: 600 }, children: "Defect Rate" }), _jsx("div", { style: { fontSize: '16px', fontWeight: 800, color: 'var(--color-success)' }, children: "0.00%" })] }), _jsxs("div", { style: { backgroundColor: 'var(--color-surface)', padding: 'var(--space-3)', borderRadius: '10px', border: '1px solid var(--color-outline-variant)' }, children: [_jsx("div", { style: { fontSize: '11px', color: 'var(--color-on-surface-variant)', fontWeight: 600 }, children: "Inspector" }), _jsx("div", { style: { fontSize: '16px', fontWeight: 800, color: 'var(--color-primary)' }, children: "QC Station 1" })] })] })] }), _jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }, children: steps.map((st, i) => (_jsxs("div", { style: { display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)' }, children: [_jsx("div", { style: {
                                                        width: '24px',
                                                        height: '24px',
                                                        borderRadius: '50%',
                                                        backgroundColor: 'var(--color-info-container)',
                                                        color: 'var(--color-on-info-container)',
                                                        border: '1px solid var(--color-info-container)',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        fontSize: '12px',
                                                        fontWeight: 800,
                                                        flexShrink: 0,
                                                        marginTop: 'var(--space-1)',
                                                    }, children: i + 1 }), _jsxs("div", { children: [_jsx("div", { style: { fontSize: '14px', fontWeight: 700, color: 'var(--color-on-surface)' }, children: st.title }), _jsx("div", { style: { fontSize: '12px', color: 'var(--color-on-surface-variant)' }, children: st.desc })] })] }, st.title))) })] }), _jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }, children: [_jsxs("div", { style: { position: 'relative', borderRadius: '16px', overflow: 'hidden', height: '220px' }, children: [_jsx("img", { src: "/assets/quality/quality-control-lab.jpg", alt: "Quality Inspection Lab", style: { width: '100%', height: '100%', objectFit: 'cover' } }), _jsx("div", { style: {
                                                    position: 'absolute',
                                                    inset: 0,
                                                    background: 'linear-gradient(180deg, transparent 40%, var(--color-media-scrim) 100%)',
                                                } }), _jsxs("div", { style: { position: 'absolute', bottom: '16px', left: '16px', color: 'var(--color-on-primary)' }, children: [_jsx("span", { style: { fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.9 }, children: "In-Line Metrology Station" }), _jsx("div", { style: { fontSize: '16px', fontWeight: 800 }, children: "Zero-Defect Manufacturing Protocol" })] })] }), _jsxs("div", { className: "fv-browser-frame", children: [_jsxs("div", { className: "fv-browser-header", children: [_jsxs("div", { className: "fv-browser-dots", children: [_jsx("span", { className: "fv-browser-dot" }), _jsx("span", { className: "fv-browser-dot" }), _jsx("span", { className: "fv-browser-dot" })] }), _jsxs("div", { className: "fv-browser-address-bar", children: [_jsx(Icon, { name: "verified", size: 12 }), _jsx("span", { children: "app.factoryvision.io/quality-traceability" })] })] }), _jsx("div", { className: "fv-browser-body", children: _jsx("img", { src: "/screenshots/08-bottlenecks.png", alt: "Quality Analysis Screenshot", className: "fv-browser-img", loading: "lazy" }) })] })] })] })] }), _jsx("style", { children: `
        @media (max-width: 960px) {
          .fv-quality-grid {
            grid-template-columns: 1fr !important;
          }
        }
      ` })] }));
};
//# sourceMappingURL=QualityTraceabilitySection.js.map