import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { FactoryVisionLogo } from '@factory-vision/ui/fv';
export const Footer = () => {
    return (_jsxs("footer", { style: {
            backgroundColor: '#0B0B0D',
            color: '#FFFFFF',
            paddingTop: '64px',
            paddingBottom: '40px',
            borderTop: '1px solid #232730',
        }, children: [_jsxs("div", { className: "fv-landing-container", children: [_jsxs("div", { style: {
                            display: 'grid',
                            gridTemplateColumns: '1.5fr 1fr 1fr 1fr',
                            gap: '36px',
                            marginBottom: '48px',
                        }, className: "fv-footer-grid", children: [_jsxs("div", { children: [_jsx("div", { style: { marginBottom: '16px' }, children: _jsx(FactoryVisionLogo, { size: "md", variant: "full" }) }), _jsx("p", { style: { fontSize: '14px', color: '#BDD8E9', lineHeight: 1.6, maxWidth: '320px', marginBottom: '20px' }, children: "The modern Manufacturing Execution System empowering discrete and batch industrial factories with real-time operational intelligence." }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: '8px' }, children: [_jsx("span", { className: "fv-status-dot running" }), _jsx("span", { style: { fontSize: '12px', color: '#7BBDE8', fontWeight: 700 }, children: "Systems Operational \u00B7 Cloud & Edge Live" })] })] }), _jsxs("div", { children: [_jsx("h4", { style: { fontSize: '14px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#7BBDE8', marginBottom: '16px' }, children: "Product Modules" }), _jsx("ul", { style: { listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '10px' }, children: ['Production Orders & WIP', 'Shopfloor & Operator Terminal', 'Machine Fleet & Andon', 'OEE & Loss Analytics', 'Quality & Lot Traceability', 'Master Data & Administration'].map((m) => (_jsx("li", { children: _jsx("a", { href: "#modules", style: { fontSize: '13px', color: '#8E9BAE', textDecoration: 'none', transition: 'color 0.15s ease' }, onMouseEnter: (e) => {
                                                    e.currentTarget.style.color = '#FFFFFF';
                                                }, onMouseLeave: (e) => {
                                                    e.currentTarget.style.color = '#8E9BAE';
                                                }, children: m }) }, m))) })] }), _jsxs("div", { children: [_jsx("h4", { style: { fontSize: '14px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#7BBDE8', marginBottom: '16px' }, children: "Architecture" }), _jsx("ul", { style: { listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '10px' }, children: ['Cloud & Hybrid Hosting', 'On-Premise / Air-Gapped', 'Edge Gateway Protocols (OPC-UA)', 'Enterprise RBAC & Security', 'Tamper-Proof Audit Trail', 'REST APIs & Webhooks'].map((s) => (_jsx("li", { children: _jsx("a", { href: "#deployment", style: { fontSize: '13px', color: '#8E9BAE', textDecoration: 'none', transition: 'color 0.15s ease' }, onMouseEnter: (e) => {
                                                    e.currentTarget.style.color = '#FFFFFF';
                                                }, onMouseLeave: (e) => {
                                                    e.currentTarget.style.color = '#8E9BAE';
                                                }, children: s }) }, s))) })] }), _jsxs("div", { children: [_jsx("h4", { style: { fontSize: '14px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#7BBDE8', marginBottom: '16px' }, children: "Platform" }), _jsx("ul", { style: { listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '10px' }, children: ['Operator Terminal', 'Management Console', 'Documentation', 'Release Notes v1.0', 'Contact Technical Sales', 'Schedule Plant Walkthrough'].map((item) => (_jsx("li", { children: _jsx("a", { href: "#", style: { fontSize: '13px', color: '#8E9BAE', textDecoration: 'none', transition: 'color 0.15s ease' }, onMouseEnter: (e) => {
                                                    e.currentTarget.style.color = '#FFFFFF';
                                                }, onMouseLeave: (e) => {
                                                    e.currentTarget.style.color = '#8E9BAE';
                                                }, children: item }) }, item))) })] })] }), _jsxs("div", { style: {
                            borderTop: '1px solid #232730',
                            paddingTop: '24px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            fontSize: '12px',
                            color: '#8E9BAE',
                            flexWrap: 'wrap',
                            gap: '12px',
                        }, children: [_jsxs("div", { children: ["\u00A9 ", new Date().getFullYear(), " Factory Vision Inc. All rights reserved. Enterprise Manufacturing Execution System."] }), _jsxs("div", { style: { display: 'flex', gap: '20px' }, children: [_jsx("span", { style: { cursor: 'pointer' }, children: "Privacy Policy" }), _jsx("span", { style: { cursor: 'pointer' }, children: "Terms of Service" }), _jsx("span", { style: { cursor: 'pointer' }, children: "Security Whitepaper" })] })] })] }), _jsx("style", { children: `
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