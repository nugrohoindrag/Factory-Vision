import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { motion } from 'motion/react';
import { Icon } from '@factory-vision/ui';
export const JourneySection = () => {
    const steps = [
        { title: 'Customer Order', status: 'completed', desc: '#SO-10294 (4,500 pcs) ingested from ERP' },
        { title: 'PPIC Planning', status: 'completed', desc: 'Auto-scheduled to Line A across 3 shifts' },
        { title: 'Work Order Dispatch', status: 'completed', desc: 'BOM & tooling parameters released to CNC-01 & 02' },
        { title: 'Shopfloor Execution', status: 'active', desc: '3,820 / 4,500 pcs produced (84.7%)' },
        { title: 'Quality Verification', status: 'active', desc: '3,760 pcs accepted (0.3% scrap rate)' },
        { title: 'Packing & Dispatch', status: 'pending', desc: 'Pallet barcode generation & ERP closeout' },
    ];
    return (_jsx("section", { className: "fv-section-py", style: { backgroundColor: '#FFFFFF' }, children: _jsxs("div", { className: "fv-landing-container", children: [_jsxs("div", { style: { textAlign: 'center', maxWidth: '800px', margin: '0 auto 48px' }, children: [_jsxs("div", { className: "fv-eyebrow", children: [_jsx(Icon, { name: "trending_up", size: 16 }), "Lifecycle Journey"] }), _jsx("h2", { className: "fv-section-title", children: "Follow Every Order Through the Factory" }), _jsx("p", { className: "fv-section-desc", style: { margin: '0 auto', color: '#334155' }, children: "Get complete visibility from customer sales order intake down to machine execution, quality inspection, and final warehouse dispatch." })] }), _jsxs("div", { className: "fv-card", style: {
                        padding: '36px',
                        backgroundColor: '#FFFFFF',
                        maxWidth: '1000px',
                        margin: '0 auto',
                    }, children: [_jsxs("div", { style: {
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                paddingBottom: '24px',
                                borderBottom: '1px solid #E2E8F0',
                                marginBottom: '28px',
                                flexWrap: 'wrap',
                                gap: '12px',
                            }, children: [_jsxs("div", { children: [_jsx("span", { style: { fontSize: '11px', color: '#64748B', fontWeight: 700, textTransform: 'uppercase' }, children: "TRACKING ACTIVE SALES ORDER" }), _jsx("div", { style: { fontSize: '22px', fontWeight: 800, color: '#001D39' }, children: "#SO-10294 \u00B7 Precision Flange Assembly" })] }), _jsx("div", { style: { display: 'flex', alignItems: 'center', gap: '10px' }, children: _jsx("span", { style: {
                                            backgroundColor: '#F0F9FF',
                                            color: '#0A4174',
                                            border: '1px solid #BAE6FD',
                                            padding: '6px 14px',
                                            borderRadius: '9999px',
                                            fontSize: '13px',
                                            fontWeight: 800,
                                        }, children: "In Production (84.7%)" }) })] }), _jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: '16px' }, children: steps.map((st, idx) => {
                                const isCompleted = st.status === 'completed';
                                const isActive = st.status === 'active';
                                const badgeColor = isCompleted
                                    ? '#059669'
                                    : isActive
                                        ? '#0A4174'
                                        : '#64748B';
                                const badgeBg = isCompleted
                                    ? '#ECFDF5'
                                    : isActive
                                        ? '#F0F9FF'
                                        : '#F8FAFC';
                                const badgeBorder = isCompleted
                                    ? '#A7F3D0'
                                    : isActive
                                        ? '#BAE6FD'
                                        : '#E2E8F0';
                                return (_jsxs(motion.div, { initial: { opacity: 0, x: -16 }, whileInView: { opacity: 1, x: 0 }, viewport: { once: true }, transition: { delay: idx * 0.08 }, style: {
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        padding: '16px 20px',
                                        backgroundColor: '#F8FAFC',
                                        border: '1px solid #E2E8F0',
                                        borderRadius: '14px',
                                        gap: '16px',
                                    }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: '14px' }, children: [_jsx("div", { style: {
                                                        width: '32px',
                                                        height: '32px',
                                                        borderRadius: '50%',
                                                        backgroundColor: badgeBg,
                                                        color: badgeColor,
                                                        border: `1px solid ${badgeBorder}`,
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        fontSize: '13px',
                                                        fontWeight: 800,
                                                        flexShrink: 0,
                                                    }, children: isCompleted ? _jsx(Icon, { name: "check", size: 16 }) : idx + 1 }), _jsxs("div", { children: [_jsx("div", { style: { fontSize: '15px', fontWeight: 800, color: '#001D39' }, children: st.title }), _jsx("div", { style: { fontSize: '13px', color: '#334155' }, children: st.desc })] })] }), _jsx("span", { style: {
                                                fontSize: '11px',
                                                fontWeight: 800,
                                                textTransform: 'uppercase',
                                                padding: '4px 10px',
                                                borderRadius: '9999px',
                                                backgroundColor: badgeBg,
                                                color: badgeColor,
                                                border: `1px solid ${badgeBorder}`,
                                                whiteSpace: 'nowrap',
                                            }, children: st.status })] }, st.title));
                            }) })] })] }) }));
};
//# sourceMappingURL=JourneySection.js.map