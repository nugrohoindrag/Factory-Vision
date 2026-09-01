import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { motion } from 'motion/react';
import { Icon } from '@factory-vision/ui';
export const HeroSection = ({ onOpenDemo }) => {
    return (_jsxs("section", { style: {
            position: 'relative',
            paddingTop: 'var(--space-12)',
            paddingBottom: 'calc(var(--space-12) * 2)',
            backgroundColor: 'var(--color-surface)',
            overflow: 'hidden',
        }, children: [_jsxs("div", { className: "fv-landing-container", style: { position: 'relative', zIndex: 1 }, children: [_jsxs("div", { style: { textAlign: 'center', maxWidth: '880px', margin: '0 auto 48px' }, children: [_jsxs(motion.div, { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.4, ease: [0.2, 0, 0, 1] }, className: "fv-eyebrow", children: [_jsx(Icon, { name: "precision_manufacturing", size: 16 }), "Next-Gen Manufacturing Execution System"] }), _jsxs(motion.h1, { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.5, delay: 0.08, ease: [0.2, 0, 0, 1] }, style: {
                                    fontSize: 'clamp(38px, 5.8vw, 68px)',
                                    fontWeight: 800,
                                    lineHeight: 1.08,
                                    letterSpacing: '-0.03em',
                                    color: 'var(--color-on-surface)',
                                    marginBottom: 'var(--space-5)',
                                }, children: ["See Your Factory.", _jsx("br", {}), _jsx("span", { style: { color: 'var(--color-primary)' }, children: "Control Your Production." })] }), _jsx(motion.p, { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.5, delay: 0.16, ease: [0.2, 0, 0, 1] }, className: "fv-section-desc", style: { margin: '0 auto 36px', color: 'var(--color-on-surface-variant)', fontSize: 'clamp(17px, 2vw, 20px)' }, children: "Factory Vision is a modern Manufacturing Execution System that connects production orders, machines, operators, quality, and performance in one real-time operational platform." }), _jsxs(motion.div, { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.5, delay: 0.24, ease: [0.2, 0, 0, 1] }, style: {
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: 'var(--space-4)',
                                    flexWrap: 'wrap',
                                }, children: [_jsxs("button", { onClick: onOpenDemo, className: "fv-btn-primary", style: { padding: `var(--space-4) var(--space-8)`, fontSize: '16px' }, children: ["Book a Demo", _jsx(Icon, { name: "calendar_today", size: 18 })] }), _jsxs("a", { href: "#showcase", className: "fv-btn-secondary", style: { padding: `var(--space-4) var(--space-8)`, fontSize: '16px' }, children: ["Explore the Platform", _jsx(Icon, { name: "visibility", size: 18 })] })] })] }), _jsxs(motion.div, { initial: { opacity: 0, y: 32 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.7, delay: 0.32, ease: [0.2, 0, 0, 1] }, style: { position: 'relative', marginTop: 'var(--space-8)' }, children: [_jsxs("div", { className: "fv-browser-frame", children: [_jsxs("div", { className: "fv-browser-header", children: [_jsxs("div", { className: "fv-browser-dots", children: [_jsx("span", { className: "fv-browser-dot", style: { backgroundColor: 'var(--color-error)' } }), _jsx("span", { className: "fv-browser-dot", style: { backgroundColor: 'var(--color-warning)' } }), _jsx("span", { className: "fv-browser-dot", style: { backgroundColor: 'var(--color-success)' } })] }), _jsxs("div", { className: "fv-browser-address-bar", children: [_jsx(Icon, { name: "lock", size: 12 }), _jsx("span", { children: "app.factoryvision.io/executive-dashboard" })] }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }, children: [_jsx("span", { className: "fv-status-dot running" }), _jsx("span", { style: { fontSize: '11px', fontWeight: 700, color: 'var(--color-success)' }, children: "LIVE SHOPFLOOR STREAM" })] })] }), _jsx("div", { className: "fv-browser-body", children: _jsx("img", { src: "/screenshots/01-executive-dashboard.png", alt: "Factory Vision Executive Dashboard", className: "fv-browser-img", loading: "eager" }) })] }), _jsxs(motion.div, { initial: { opacity: 0, x: -20 }, animate: { opacity: 1, x: 0 }, transition: { duration: 0.6, delay: 0.6 }, className: "fv-floating-card fv-floating-top-left", style: {
                                    position: 'absolute',
                                    top: '-24px',
                                    left: '-20px',
                                    background: 'var(--color-surface)',
                                    border: '1px solid var(--color-success-container)',
                                    borderRadius: '16px',
                                    padding: `var(--space-4) var(--space-5)`,
                                    boxShadow: 'var(--elevation-3)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 'var(--space-4)',
                                    zIndex: 2,
                                }, children: [_jsx("div", { style: {
                                            width: '44px',
                                            height: '44px',
                                            borderRadius: '12px',
                                            backgroundColor: 'var(--color-success-container)',
                                            color: 'var(--color-on-success-container)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                        }, children: _jsx(Icon, { name: "speed", size: 24 }) }), _jsxs("div", { children: [_jsx("div", { style: { fontSize: '11px', color: 'var(--color-on-surface-variant)', fontWeight: 700, letterSpacing: '0.04em' }, children: "PLANT OEE TODAY" }), _jsxs("div", { style: { fontSize: '22px', fontWeight: 800, color: 'var(--color-on-surface)' }, className: "fv-num", children: ["87.4% ", _jsx("span", { style: { fontSize: '13px', color: 'var(--color-success)', fontWeight: 700 }, children: "+4.2%" })] })] })] }), _jsxs(motion.div, { initial: { opacity: 0, x: 20 }, animate: { opacity: 1, x: 0 }, transition: { duration: 0.6, delay: 0.7 }, className: "fv-floating-card fv-floating-top-right", style: {
                                    position: 'absolute',
                                    top: '40px',
                                    right: '-20px',
                                    background: 'var(--color-surface)',
                                    border: '1px solid var(--color-info-container)',
                                    borderRadius: '16px',
                                    padding: `var(--space-4) var(--space-5)`,
                                    boxShadow: 'var(--elevation-3)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 'var(--space-4)',
                                    zIndex: 2,
                                }, children: [_jsx("div", { style: {
                                            width: '44px',
                                            height: '44px',
                                            borderRadius: '12px',
                                            backgroundColor: 'var(--color-info-container)',
                                            color: 'var(--color-on-info-container)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                        }, children: _jsx(Icon, { name: "precision_manufacturing", size: 24 }) }), _jsxs("div", { children: [_jsx("div", { style: { fontSize: '11px', color: 'var(--color-on-surface-variant)', fontWeight: 700, letterSpacing: '0.04em' }, children: "RUNNING LINES" }), _jsx("div", { style: { fontSize: '20px', fontWeight: 800, color: 'var(--color-on-surface)' }, className: "fv-num", children: "12 / 12 Active" })] })] }), _jsxs(motion.div, { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.6, delay: 0.8 }, className: "fv-floating-card fv-floating-bottom-left", style: {
                                    position: 'absolute',
                                    bottom: '-24px',
                                    right: '48px',
                                    background: 'var(--color-surface)',
                                    border: '1px solid var(--color-outline-variant)',
                                    borderRadius: '16px',
                                    padding: `var(--space-4) var(--space-5)`,
                                    boxShadow: 'var(--elevation-3)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 'var(--space-4)',
                                    zIndex: 2,
                                }, children: [_jsx("div", { style: {
                                            width: '44px',
                                            height: '44px',
                                            borderRadius: '12px',
                                            backgroundColor: 'var(--color-info-container)',
                                            color: 'var(--color-on-info-container)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                        }, children: _jsx(Icon, { name: "verified", size: 24 }) }), _jsxs("div", { children: [_jsx("div", { style: { fontSize: '11px', color: 'var(--color-on-surface-variant)', fontWeight: 700, letterSpacing: '0.04em' }, children: "FIRST-PASS YIELD" }), _jsxs("div", { style: { fontSize: '20px', fontWeight: 800, color: 'var(--color-on-surface)' }, className: "fv-num", children: ["99.62% ", _jsx("span", { style: { fontSize: '12px', color: 'var(--color-on-surface-variant)', fontWeight: 600 }, children: "(Defect: 0.38%)" })] })] })] })] })] }), _jsx("style", { children: `
        @media (max-width: 900px) {
          .fv-floating-card {
            display: none !important;
          }
        }
      ` })] }));
};
//# sourceMappingURL=HeroSection.js.map