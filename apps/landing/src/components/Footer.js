import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { FactoryVisionLogo } from '@factory-vision/ui/fv';
export const Footer = () => {
    return (_jsxs("footer", { style: {
            backgroundColor: 'var(--color-primary)',
            color: 'var(--color-on-primary)',
            paddingTop: 'calc(var(--space-8) * 2)',
            paddingBottom: 'var(--space-10)',
            borderTop: '1px solid color-mix(in srgb, var(--color-on-primary) 18%, transparent)',
        }, children: [_jsxs("div", { className: "fv-landing-container", children: [_jsxs("div", { style: {
                            display: 'grid',
                            gridTemplateColumns: '1.5fr 1fr 1fr 1fr',
                            gap: 'var(--space-10)',
                            marginBottom: 'var(--space-12)',
                        }, className: "fv-footer-grid", children: [_jsxs("div", { children: [_jsx("div", { style: { marginBottom: 'var(--space-4)' }, children: _jsx(FactoryVisionLogo, { size: "md", variant: "full" }) }), _jsx("p", { style: { fontSize: '14px', color: 'var(--color-on-primary)', lineHeight: 1.6, maxWidth: '320px', marginBottom: 'var(--space-5)' }, children: "The modern Manufacturing Execution System empowering discrete and batch industrial factories with real-time operational intelligence." }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }, children: [_jsx("span", { className: "fv-status-dot running" }), _jsx("span", { style: { fontSize: '12px', color: 'var(--color-primary-soft)', fontWeight: 700 }, children: "Systems Operational \u00B7 Cloud & Edge Live" })] })] }), _jsxs("div", { children: [_jsx("h4", { style: { fontSize: '14px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-primary-soft)', marginBottom: 'var(--space-4)' }, children: "Product Modules" }), _jsx("ul", { style: { listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }, children: ['Production Orders & WIP', 'Shopfloor & Operator Terminal', 'Machine Fleet & Andon', 'OEE & Loss Analytics', 'Quality & Lot Traceability', 'Master Data & Administration'].map((m) => (_jsx("li", { children: _jsx("a", { href: "#modules", style: { fontSize: '13px', color: 'var(--color-primary-soft)', textDecoration: 'none', transition: 'color 0.15s ease' }, onMouseEnter: (e) => {
                                                    e.currentTarget.style.color = 'var(--color-on-primary)';
                                                }, onMouseLeave: (e) => {
                                                    e.currentTarget.style.color = 'var(--color-primary-soft)';
                                                }, children: m }) }, m))) })] }), _jsxs("div", { children: [_jsx("h4", { style: { fontSize: '14px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-primary-soft)', marginBottom: 'var(--space-4)' }, children: "Architecture" }), _jsx("ul", { style: { listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }, children: ['Cloud & Hybrid Hosting', 'On-Premise / Air-Gapped', 'Edge Gateway Protocols (OPC-UA)', 'Enterprise RBAC & Security', 'Tamper-Proof Audit Trail', 'REST APIs & Webhooks'].map((s) => (_jsx("li", { children: _jsx("a", { href: "#deployment", style: { fontSize: '13px', color: 'var(--color-primary-soft)', textDecoration: 'none', transition: 'color 0.15s ease' }, onMouseEnter: (e) => {
                                                    e.currentTarget.style.color = 'var(--color-on-primary)';
                                                }, onMouseLeave: (e) => {
                                                    e.currentTarget.style.color = 'var(--color-primary-soft)';
                                                }, children: s }) }, s))) })] }), _jsxs("div", { children: [_jsx("h4", { style: { fontSize: '14px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-primary-soft)', marginBottom: 'var(--space-4)' }, children: "Platform" }), _jsx("ul", { style: { listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }, children: ['Operator Terminal', 'Management Console', 'Documentation', 'Release Notes v1.0', 'Contact Technical Sales', 'Schedule Plant Walkthrough'].map((item) => (_jsx("li", { children: _jsx("a", { href: "#", style: { fontSize: '13px', color: 'var(--color-primary-soft)', textDecoration: 'none', transition: 'color 0.15s ease' }, onMouseEnter: (e) => {
                                                    e.currentTarget.style.color = 'var(--color-on-primary)';
                                                }, onMouseLeave: (e) => {
                                                    e.currentTarget.style.color = 'var(--color-primary-soft)';
                                                }, children: item }) }, item))) })] })] }), _jsxs("div", { style: {
                            borderTop: '1px solid color-mix(in srgb, var(--color-on-primary) 18%, transparent)',
                            paddingTop: 'var(--space-6)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            fontSize: '12px',
                            color: 'var(--color-primary-soft)',
                            flexWrap: 'wrap',
                            gap: 'var(--space-3)',
                        }, children: [_jsxs("div", { children: ["\u00A9 ", new Date().getFullYear(), " Factory Vision Inc. All rights reserved. Enterprise Manufacturing Execution System."] }), _jsxs("div", { style: { display: 'flex', gap: 'var(--space-5)' }, children: [_jsx("span", { style: { cursor: 'pointer' }, children: "Privacy Policy" }), _jsx("span", { style: { cursor: 'pointer' }, children: "Terms of Service" }), _jsx("span", { style: { cursor: 'pointer' }, children: "Security Whitepaper" })] })] })] }), _jsx("style", { children: `
        @media (max-width: 900px) {
          .fv-footer-grid {
            grid-template-columns: 1fr 1fr !important;
          }
        }
        @media (max-width: 500px) {
          .fv-footer-grid {
            grid-template-columns: 1fr !important;
          }
        }
      ` })] }));
};
//# sourceMappingURL=Footer.js.map