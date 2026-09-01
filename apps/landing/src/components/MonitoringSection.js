import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { Icon } from '@factory-vision/ui';
export const MonitoringSection = () => {
    const [filter, setFilter] = useState('all');
    const machines = [
        {
            id: 'CNC-01',
            name: '5-Axis CNC Milling 01',
            line: 'Line A (Precision Machining)',
            status: 'running',
            order: '#WO-2026-0841',
            product: 'Engine Housing Aluminium 6061',
            operator: 'Budi Santoso',
            target: 450,
            actual: 398,
            speed: '98.5%',
            uptime: '6h 42m',
        },
        {
            id: 'CNC-02',
            name: '5-Axis CNC Milling 02',
            line: 'Line A (Precision Machining)',
            status: 'running',
            order: '#WO-2026-0842',
            product: 'Connecting Rod Forged Steel',
            operator: 'Agus Pratama',
            target: 600,
            actual: 540,
            speed: '96.2%',
            uptime: '7h 10m',
        },
        {
            id: 'STAMP-01',
            name: 'Hydraulic Press 400T',
            line: 'Line B (Stamping & Press)',
            status: 'idle',
            order: '#WO-2026-0850',
            product: 'Chassis Bracket Reinforcement',
            operator: 'Dewi Lestari',
            target: 1200,
            actual: 890,
            speed: 'Waiting Coil Feed',
            uptime: '42m Idle',
        },
        {
            id: 'ROBOT-01',
            name: 'Robotic Weld Cell 01',
            line: 'Line C (Automated Assembly)',
            status: 'downtime',
            order: '#WO-2026-0865',
            product: 'Exhaust Manifold Sub-Assembly',
            operator: 'Rian Hidayat',
            target: 350,
            actual: 180,
            speed: 'Tip Replacement',
            uptime: '18m Down',
        },
    ];
    const filteredMachines = filter === 'all' ? machines : machines.filter((m) => m.status === filter);
    return (_jsxs("section", { className: "fv-section-py", style: { backgroundColor: '#001D39', color: '#FFFFFF' }, children: [_jsxs("div", { className: "fv-landing-container", children: [_jsxs("div", { style: { textAlign: 'center', maxWidth: '800px', margin: '0 auto 48px' }, children: [_jsxs("div", { className: "fv-eyebrow-on-blue", children: [_jsx(Icon, { name: "precision_manufacturing", size: 16 }), "Live Machine Monitoring"] }), _jsx("h2", { className: "fv-section-title-on-blue", children: "Know What's Happening on the Shopfloor \u2014 Now" }), _jsx("p", { className: "fv-section-desc-on-blue", style: { margin: '0 auto' }, children: "Instant machine fleet telemetry. Get direct visibility into active jobs, cycle speed, operator assignments, and andon stoppage events." })] }), _jsxs("div", { style: {
                            display: 'grid',
                            gridTemplateColumns: 'repeat(4, 1fr)',
                            gap: '16px',
                            marginBottom: '36px',
                        }, className: "fv-status-summary-grid", children: [_jsxs("div", { onClick: () => setFilter('all'), style: {
                                    padding: '20px',
                                    backgroundColor: '#FFFFFF',
                                    border: filter === 'all' ? '2px solid #0A4174' : '1px solid #E2E8F0',
                                    borderRadius: '16px',
                                    cursor: 'pointer',
                                    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.2)',
                                    transition: 'all 0.15s ease',
                                }, children: [_jsx("div", { style: { fontSize: '11px', color: '#64748B', fontWeight: 700, textTransform: 'uppercase', marginBottom: '4px' }, children: "ALL MACHINES" }), _jsxs("div", { style: { fontSize: '28px', fontWeight: 800, color: '#001D39' }, className: "fv-num", children: ["18 ", _jsx("span", { style: { fontSize: '13px', color: '#64748B', fontWeight: 600 }, children: "Total Units" })] })] }), _jsxs("div", { onClick: () => setFilter('running'), style: {
                                    padding: '20px',
                                    backgroundColor: '#FFFFFF',
                                    border: filter === 'running' ? '2px solid #059669' : '1px solid #E2E8F0',
                                    borderRadius: '16px',
                                    cursor: 'pointer',
                                    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.2)',
                                    transition: 'all 0.15s ease',
                                }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#059669', fontWeight: 800, marginBottom: '4px' }, children: [_jsx("span", { className: "fv-status-dot running" }), "RUNNING"] }), _jsxs("div", { style: { fontSize: '28px', fontWeight: 800, color: '#059669' }, className: "fv-num", children: ["12 ", _jsx("span", { style: { fontSize: '13px', color: '#64748B', fontWeight: 600 }, children: "Operating" })] })] }), _jsxs("div", { onClick: () => setFilter('idle'), style: {
                                    padding: '20px',
                                    backgroundColor: '#FFFFFF',
                                    border: filter === 'idle' ? '2px solid #D97706' : '1px solid #E2E8F0',
                                    borderRadius: '16px',
                                    cursor: 'pointer',
                                    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.2)',
                                    transition: 'all 0.15s ease',
                                }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#D97706', fontWeight: 800, marginBottom: '4px' }, children: [_jsx("span", { className: "fv-status-dot idle" }), "IDLE / CHANGEOVER"] }), _jsxs("div", { style: { fontSize: '28px', fontWeight: 800, color: '#D97706' }, className: "fv-num", children: ["3 ", _jsx("span", { style: { fontSize: '13px', color: '#64748B', fontWeight: 600 }, children: "Standby" })] })] }), _jsxs("div", { onClick: () => setFilter('downtime'), style: {
                                    padding: '20px',
                                    backgroundColor: '#FFFFFF',
                                    border: filter === 'downtime' ? '2px solid #DC2626' : '1px solid #E2E8F0',
                                    borderRadius: '16px',
                                    cursor: 'pointer',
                                    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.2)',
                                    transition: 'all 0.15s ease',
                                }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#DC2626', fontWeight: 800, marginBottom: '4px' }, children: [_jsx("span", { className: "fv-status-dot downtime" }), "DOWNTIME"] }), _jsxs("div", { style: { fontSize: '28px', fontWeight: 800, color: '#DC2626' }, className: "fv-num", children: ["2 ", _jsx("span", { style: { fontSize: '13px', color: '#64748B', fontWeight: 600 }, children: "Alerts" })] })] })] }), _jsx("div", { className: "fv-grid-2", style: { gap: '24px' }, children: filteredMachines.map((m) => {
                            const progress = Math.min(100, Math.round((m.actual / m.target) * 100));
                            const statusColor = m.status === 'running'
                                ? '#059669'
                                : m.status === 'idle'
                                    ? '#D97706'
                                    : '#DC2626';
                            const statusBg = m.status === 'running'
                                ? '#ECFDF5'
                                : m.status === 'idle'
                                    ? '#FFFBEB'
                                    : '#FEF2F2';
                            return (_jsxs("div", { className: "fv-card-on-blue", style: {
                                    padding: '28px',
                                    backgroundColor: '#FFFFFF',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '16px',
                                }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }, children: [_jsxs("div", { children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }, children: [_jsx("span", { className: `fv-status-dot ${m.status}` }), _jsxs("span", { style: {
                                                                    fontSize: '11px',
                                                                    fontWeight: 800,
                                                                    color: statusColor,
                                                                    backgroundColor: statusBg,
                                                                    padding: '2px 8px',
                                                                    borderRadius: '9999px',
                                                                    textTransform: 'uppercase',
                                                                }, children: [m.status, " \u00B7 ", m.uptime] })] }), _jsxs("h4", { style: { fontSize: '20px', fontWeight: 800, color: '#001D39' }, children: [m.id, " \u2014 ", m.name] }), _jsx("span", { style: { fontSize: '13px', color: '#334155', fontWeight: 500 }, children: m.line })] }), _jsx("span", { style: {
                                                    fontSize: '12px',
                                                    fontWeight: 700,
                                                    backgroundColor: '#F0F9FF',
                                                    color: '#0A4174',
                                                    border: '1px solid #BAE6FD',
                                                    padding: '4px 10px',
                                                    borderRadius: '8px',
                                                    fontFamily: 'monospace',
                                                }, children: m.order })] }), _jsxs("div", { style: {
                                            backgroundColor: '#F8FAFC',
                                            border: '1px solid #E2E8F0',
                                            padding: '12px 16px',
                                            borderRadius: '12px',
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            fontSize: '13px',
                                        }, children: [_jsxs("div", { children: [_jsx("span", { style: { color: '#64748B', fontSize: '11px', display: 'block', fontWeight: 600 }, children: "RUNNING PART" }), _jsx("strong", { style: { color: '#001D39', fontSize: '14px' }, children: m.product })] }), _jsxs("div", { style: { textAlign: 'right' }, children: [_jsx("span", { style: { color: '#64748B', fontSize: '11px', display: 'block', fontWeight: 600 }, children: "OPERATOR" }), _jsx("strong", { style: { color: '#0A4174', fontSize: '14px' }, children: m.operator })] })] }), _jsxs("div", { children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '8px' }, children: [_jsxs("span", { style: { color: '#334155' }, children: ["Progress: ", _jsxs("strong", { style: { color: '#001D39' }, children: [m.actual, " / ", m.target, " pcs"] })] }), _jsxs("span", { style: { fontWeight: 800, color: '#0A4174' }, children: [progress, "%"] })] }), _jsx("div", { style: {
                                                    height: '8px',
                                                    backgroundColor: '#E2E8F0',
                                                    borderRadius: '9999px',
                                                    overflow: 'hidden',
                                                }, children: _jsx("div", { style: {
                                                        height: '100%',
                                                        width: `${progress}%`,
                                                        backgroundColor: statusColor,
                                                        borderRadius: '9999px',
                                                        transition: 'width 0.5s ease',
                                                    } }) })] })] }, m.id));
                        }) })] }), _jsx("style", { children: `
        @media (max-width: 768px) {
          .fv-status-summary-grid {
            grid-template-columns: repeat(2, 1fr) !important;
          }
        }
      ` })] }));
};
//# sourceMappingURL=MonitoringSection.js.map