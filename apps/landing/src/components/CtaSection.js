import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { motion } from 'motion/react';
import { Icon } from '@factory-vision/ui';
export const CtaSection = ({ onOpenDemo }) => {
    return (_jsx("section", { className: "fv-section-py", style: { backgroundColor: '#0B0B0D' }, children: _jsx("div", { className: "fv-landing-container", children: _jsxs(motion.div, { initial: { opacity: 0, scale: 0.98 }, whileInView: { opacity: 1, scale: 1 }, viewport: { once: true }, style: {
                    background: 'linear-gradient(135deg, #15171C 0%, #0E1A2B 50%, #0A4174 100%)',
                    color: '#FFFFFF',
                    borderRadius: '28px',
                    padding: '64px 36px',
                    textAlign: 'center',
                    boxShadow: '0 24px 60px rgba(0, 0, 0, 0.8)',
                    border: '1px solid rgba(123, 189, 232, 0.35)',
                    position: 'relative',
                    overflow: 'hidden',
                }, children: [_jsx("div", { style: {
                            position: 'absolute',
                            top: '-80px',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            width: '600px',
                            height: '300px',
                            background: 'radial-gradient(circle, rgba(56, 189, 248, 0.25) 0%, transparent 70%)',
                            filter: 'blur(60px)',
                            pointerEvents: 'none',
                        } }), _jsxs("div", { style: { position: 'relative', zIndex: 1, maxWidth: '720px', margin: '0 auto' }, children: [_jsxs("div", { style: {
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    padding: '6px 16px',
                                    borderRadius: '9999px',
                                    backgroundColor: 'rgba(56, 189, 248, 0.15)',
                                    backdropFilter: 'blur(8px)',
                                    border: '1px solid rgba(56, 189, 248, 0.35)',
                                    fontSize: '12px',
                                    fontWeight: 700,
                                    letterSpacing: '0.05em',
                                    textTransform: 'uppercase',
                                    marginBottom: '20px',
                                    color: '#38BDF8',
                                }, children: [_jsx(Icon, { name: "verified", size: 16 }), "Production Ready Platform"] }), _jsx("h2", { style: {
                                    fontSize: 'clamp(32px, 4.5vw, 48px)',
                                    fontWeight: 800,
                                    lineHeight: 1.15,
                                    letterSpacing: '-0.025em',
                                    marginBottom: '16px',
                                    color: '#FFFFFF',
                                }, children: "See What Your Factory Can See." }), _jsx("p", { style: {
                                    fontSize: 'clamp(16px, 1.8vw, 19px)',
                                    lineHeight: 1.6,
                                    marginBottom: '36px',
                                    color: '#BDD8E9',
                                }, children: "Join modern manufacturing plants transforming their production execution with real-time shopfloor telemetry, automated OEE, and zero-defect batch traceability." }), _jsxs("div", { style: {
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '16px',
                                    flexWrap: 'wrap',
                                }, children: [_jsxs("button", { onClick: onOpenDemo, className: "fv-btn-primary", style: {
                                            padding: '16px 36px',
                                            fontSize: '16px',
                                        }, children: ["Book a Live Demo", _jsx(Icon, { name: "arrow_forward", size: 18 })] }), _jsxs("a", { href: "#overview", className: "fv-btn-secondary", style: {
                                            padding: '16px 32px',
                                            fontSize: '16px',
                                        }, children: ["Explore Modules", _jsx(Icon, { name: "visibility", size: 18 })] })] })] })] }) }) }));
};
//# sourceMappingURL=CtaSection.js.map