import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Icon } from '@factory-vision/ui';
export const DeploymentSection = () => {
    return (_jsxs("section", { id: "deployment", className: "fv-section-py", style: { backgroundColor: '#0B0B0D', color: '#FFFFFF' }, children: [_jsxs("div", { className: "fv-landing-container", children: [_jsxs("div", { style: { textAlign: 'center', maxWidth: '800px', margin: '0 auto 48px' }, children: [_jsxs("div", { className: "fv-eyebrow", children: [_jsx(Icon, { name: "cloud", size: 16 }), "Flexible Architecture"] }), _jsx("h2", { className: "fv-section-title", children: "Fits the Way Your Factory Operates" }), _jsx("p", { className: "fv-section-desc", style: { margin: '0 auto' }, children: "Whether you operate in a high-security isolated factory network or require cloud-native multi-plant visibility, Factory Vision provides flexible deployment models without compromise." })] }), _jsxs("div", { className: "fv-grid-2", style: { gap: '28px', marginBottom: '36px' }, children: [_jsxs("div", { className: "fv-card", style: {
                                    padding: '36px',
                                    backgroundColor: '#15171C',
                                    border: '1px solid #232730',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    justifyContent: 'space-between',
                                }, children: [_jsxs("div", { children: [_jsx("div", { style: {
                                                    width: '52px',
                                                    height: '52px',
                                                    borderRadius: '14px',
                                                    backgroundColor: 'rgba(56, 189, 248, 0.15)',
                                                    color: '#38BDF8',
                                                    border: '1px solid rgba(56, 189, 248, 0.35)',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    marginBottom: '20px',
                                                }, children: _jsx(Icon, { name: "cloud", size: 28 }) }), _jsx("h3", { style: { fontSize: '24px', fontWeight: 800, color: '#FFFFFF', marginBottom: '8px' }, children: "Cloud / Hybrid Deployment" }), _jsx("p", { style: { fontSize: '15px', color: '#BDD8E9', lineHeight: 1.55, marginBottom: '24px' }, children: "Access plant dashboards from any device or corporate headquarters with zero server maintenance and automatic updates." }), _jsx("ul", { style: { listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '12px' }, children: [
                                                    'Multi-tenant and multi-plant global visibility',
                                                    'Instant scalability without local server provisioning',
                                                    'Automated encrypted backups and disaster recovery',
                                                    '99.9% SLA with modern microservice architecture',
                                                ].map((item) => (_jsxs("li", { style: { display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', color: '#FFFFFF' }, children: [_jsx(Icon, { name: "check_circle", size: 18, color: "#38BDF8" }), item] }, item))) })] }), _jsxs("div", { style: {
                                            marginTop: '28px',
                                            padding: '14px 18px',
                                            backgroundColor: '#121418',
                                            border: '1px solid #282C37',
                                            borderRadius: '12px',
                                            fontSize: '13px',
                                            color: '#BDD8E9',
                                        }, children: [_jsx("strong", { style: { color: '#38BDF8' }, children: "Ideal for:" }), " Multi-site manufacturers, fast-growing mid-market plants, and distributed operations."] })] }), _jsxs("div", { className: "fv-card", style: {
                                    padding: '36px',
                                    backgroundColor: '#15171C',
                                    border: '1px solid #232730',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    justifyContent: 'space-between',
                                }, children: [_jsxs("div", { children: [_jsx("div", { style: {
                                                    width: '52px',
                                                    height: '52px',
                                                    borderRadius: '14px',
                                                    backgroundColor: 'rgba(16, 185, 129, 0.15)',
                                                    color: '#10B981',
                                                    border: '1px solid rgba(16, 185, 129, 0.35)',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    marginBottom: '20px',
                                                }, children: _jsx(Icon, { name: "dns", size: 28 }) }), _jsx("h3", { style: { fontSize: '24px', fontWeight: 800, color: '#FFFFFF', marginBottom: '8px' }, children: "On-Premise / Air-Gapped" }), _jsx("p", { style: { fontSize: '15px', color: '#BDD8E9', lineHeight: 1.55, marginBottom: '24px' }, children: "Keep 100% of your manufacturing telemetry and recipe data strictly inside your local plant network and firewalls." }), _jsx("ul", { style: { listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '12px' }, children: [
                                                    'Full operational continuity during internet outages',
                                                    'Strict data residency compliance within factory perimeter',
                                                    'Local edge gateway connection to PLC & SCADA protocols',
                                                    'Docker & Kubernetes containerized infrastructure',
                                                ].map((item) => (_jsxs("li", { style: { display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', color: '#FFFFFF' }, children: [_jsx(Icon, { name: "check_circle", size: 18, color: "#10B981" }), item] }, item))) })] }), _jsxs("div", { style: {
                                            marginTop: '28px',
                                            padding: '14px 18px',
                                            backgroundColor: '#121418',
                                            border: '1px solid #282C37',
                                            borderRadius: '12px',
                                            fontSize: '13px',
                                            color: '#BDD8E9',
                                        }, children: [_jsx("strong", { style: { color: '#10B981' }, children: "Ideal for:" }), " Defense, automotive tier-1, and mission-critical production with strict OT security policies."] })] })] }), _jsx("div", { style: {
                            display: 'grid',
                            gridTemplateColumns: 'repeat(4, 1fr)',
                            gap: '16px',
                        }, className: "fv-security-grid", children: [
                            { icon: 'lock', title: 'Enterprise RBAC', desc: 'Granular role permissions for operators, leads & admins' },
                            { icon: 'history', title: 'Audit Trail', desc: 'Tamper-proof logs for all recipe overrides & approvals' },
                            { icon: 'devices', title: 'Edge Ingestion', desc: 'Native OPC-UA, MQTT, Modbus & REST API bridges' },
                            { icon: 'admin_panel_settings', title: 'OT Isolation', desc: 'Separated shopfloor network traffic and DMZ zones' },
                        ].map((sec) => (_jsxs("div", { style: {
                                padding: '20px',
                                backgroundColor: '#15171C',
                                border: '1px solid #232730',
                                borderRadius: '16px',
                                boxShadow: 'var(--fv-card-shadow)',
                            }, children: [_jsx("div", { style: {
                                        width: '38px',
                                        height: '38px',
                                        borderRadius: '10px',
                                        backgroundColor: 'rgba(56, 189, 248, 0.15)',
                                        color: '#38BDF8',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        marginBottom: '12px',
                                    }, children: _jsx(Icon, { name: sec.icon, size: 20 }) }), _jsx("div", { style: { fontSize: '15px', fontWeight: 800, color: '#FFFFFF', marginBottom: '4px' }, children: sec.title }), _jsx("div", { style: { fontSize: '12px', color: '#8E9BAE', lineHeight: 1.4 }, children: sec.desc })] }, sec.title))) })] }), _jsx("style", { children: `
        @media (max-width: 900px) {
          .fv-security-grid {
            grid-template-columns: repeat(2, 1fr) !important;
          }
        }
      ` })] }));
};
//# sourceMappingURL=DeploymentSection.js.map