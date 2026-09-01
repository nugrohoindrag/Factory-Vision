import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { Icon } from '@factory-vision/ui';
export const BookDemoModal = ({ isOpen, onClose }) => {
    const [submitted, setSubmitted] = useState(false);
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        company: '',
        role: '',
        plantScale: '1-3 Lines',
        industry: 'Discrete Machining & Assembly',
        notes: '',
    });
    if (!isOpen)
        return null;
    const handleSubmit = (e) => {
        e.preventDefault();
        setSubmitted(true);
    };
    return (_jsx("div", { className: "fv-modal-overlay", onClick: onClose, children: _jsxs("div", { className: "fv-modal-content", onClick: (e) => e.stopPropagation(), children: [_jsx("button", { onClick: onClose, style: {
                        position: 'absolute',
                        top: '24px',
                        right: '24px',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--color-on-surface-variant)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: 'var(--space-1)',
                        borderRadius: '50%',
                    }, children: _jsx(Icon, { name: "close", size: 24 }) }), !submitted ? (_jsxs("div", { children: [_jsxs("div", { style: { marginBottom: 'var(--space-6)' }, children: [_jsxs("div", { style: {
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 'var(--space-2)',
                                        padding: `var(--space-1) var(--space-3)`,
                                        borderRadius: '9999px',
                                        backgroundColor: 'var(--color-info-container)',
                                        color: 'var(--color-on-info-container)',
                                        border: '1px solid var(--color-info-container)',
                                        fontSize: '12px',
                                        fontWeight: 700,
                                        textTransform: 'uppercase',
                                        marginBottom: 'var(--space-3)',
                                    }, children: [_jsx(Icon, { name: "calendar_today", size: 14 }), "Live Demo"] }), _jsx("h3", { style: { fontSize: '26px', fontWeight: 800, color: 'var(--color-primary)', marginBottom: 'var(--space-2)' }, children: "Schedule a Guided Plant Walkthrough" }), _jsx("p", { style: { fontSize: '14px', color: 'var(--color-on-surface)', lineHeight: 1.5 }, children: "See how Factory Vision can digitize your specific manufacturing workflow, work orders, and OEE tracking." })] }), _jsxs("form", { onSubmit: handleSubmit, style: { display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }, children: [_jsxs("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }, children: [_jsxs("div", { children: [_jsx("label", { style: { display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: 'var(--space-2)', color: 'var(--color-on-surface)' }, children: "Your Name *" }), _jsx("input", { type: "text", required: true, placeholder: "e.g. Budi Pratama", value: formData.name, onChange: (e) => setFormData({ ...formData, name: e.target.value }), style: {
                                                        width: '100%',
                                                        padding: `var(--space-3) var(--space-4)`,
                                                        borderRadius: '10px',
                                                        border: '1px solid var(--color-outline-variant)',
                                                        backgroundColor: 'var(--color-surface-container-low)',
                                                        color: 'var(--color-on-surface)',
                                                        fontSize: '14px',
                                                        outline: 'none',
                                                    } })] }), _jsxs("div", { children: [_jsx("label", { style: { display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: 'var(--space-2)', color: 'var(--color-on-surface)' }, children: "Work Email *" }), _jsx("input", { type: "email", required: true, placeholder: "budi@company.com", value: formData.email, onChange: (e) => setFormData({ ...formData, email: e.target.value }), style: {
                                                        width: '100%',
                                                        padding: `var(--space-3) var(--space-4)`,
                                                        borderRadius: '10px',
                                                        border: '1px solid var(--color-outline-variant)',
                                                        backgroundColor: 'var(--color-surface-container-low)',
                                                        color: 'var(--color-on-surface)',
                                                        fontSize: '14px',
                                                        outline: 'none',
                                                    } })] })] }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }, children: [_jsxs("div", { children: [_jsx("label", { style: { display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: 'var(--space-2)', color: 'var(--color-on-surface)' }, children: "Company / Factory *" }), _jsx("input", { type: "text", required: true, placeholder: "PT Precision Parts", value: formData.company, onChange: (e) => setFormData({ ...formData, company: e.target.value }), style: {
                                                        width: '100%',
                                                        padding: `var(--space-3) var(--space-4)`,
                                                        borderRadius: '10px',
                                                        border: '1px solid var(--color-outline-variant)',
                                                        backgroundColor: 'var(--color-surface-container-low)',
                                                        color: 'var(--color-on-surface)',
                                                        fontSize: '14px',
                                                        outline: 'none',
                                                    } })] }), _jsxs("div", { children: [_jsx("label", { style: { display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: 'var(--space-2)', color: 'var(--color-on-surface)' }, children: "Job Role" }), _jsx("input", { type: "text", placeholder: "Plant Manager / PPIC Lead", value: formData.role, onChange: (e) => setFormData({ ...formData, role: e.target.value }), style: {
                                                        width: '100%',
                                                        padding: `var(--space-3) var(--space-4)`,
                                                        borderRadius: '10px',
                                                        border: '1px solid var(--color-outline-variant)',
                                                        backgroundColor: 'var(--color-surface-container-low)',
                                                        color: 'var(--color-on-surface)',
                                                        fontSize: '14px',
                                                        outline: 'none',
                                                    } })] })] }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }, children: [_jsxs("div", { children: [_jsx("label", { style: { display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: 'var(--space-2)', color: 'var(--color-on-surface)' }, children: "Plant Scale" }), _jsxs("select", { value: formData.plantScale, onChange: (e) => setFormData({ ...formData, plantScale: e.target.value }), style: {
                                                        width: '100%',
                                                        padding: `var(--space-3) var(--space-4)`,
                                                        borderRadius: '10px',
                                                        border: '1px solid var(--color-outline-variant)',
                                                        backgroundColor: 'var(--color-surface-container-low)',
                                                        color: 'var(--color-on-surface)',
                                                        fontSize: '14px',
                                                        outline: 'none',
                                                    }, children: [_jsx("option", { value: "1-3 Lines", children: "1 to 3 Production Lines" }), _jsx("option", { value: "4-10 Lines", children: "4 to 10 Production Lines" }), _jsx("option", { value: "10+ Lines", children: "10+ Lines (Multi-Plant Enterprise)" })] })] }), _jsxs("div", { children: [_jsx("label", { style: { display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: 'var(--space-2)', color: 'var(--color-on-surface)' }, children: "Industry Sector" }), _jsxs("select", { value: formData.industry, onChange: (e) => setFormData({ ...formData, industry: e.target.value }), style: {
                                                        width: '100%',
                                                        padding: `var(--space-3) var(--space-4)`,
                                                        borderRadius: '10px',
                                                        border: '1px solid var(--color-outline-variant)',
                                                        backgroundColor: 'var(--color-surface-container-low)',
                                                        color: 'var(--color-on-surface)',
                                                        fontSize: '14px',
                                                        outline: 'none',
                                                    }, children: [_jsx("option", { value: "Discrete Machining & Assembly", children: "Discrete Machining & Assembly" }), _jsx("option", { value: "Automotive & Tier-1 Components", children: "Automotive & Tier-1 Components" }), _jsx("option", { value: "Electronics & PCB Manufacturing", children: "Electronics & PCB Manufacturing" }), _jsx("option", { value: "FMCG & Packaging", children: "FMCG & Packaging" }), _jsx("option", { value: "Plastic Injection & Stamping", children: "Plastic Injection & Stamping" }), _jsx("option", { value: "Other Manufacturing", children: "Other Manufacturing" })] })] })] }), _jsxs("button", { type: "submit", className: "fv-btn-primary", style: {
                                        width: '100%',
                                        padding: 'var(--space-4)',
                                        fontSize: '16px',
                                        marginTop: 'var(--space-2)',
                                    }, children: ["Confirm Demo Request", _jsx(Icon, { name: "arrow_forward", size: 18 })] })] })] })) : (_jsxs("div", { style: { textAlign: 'center', padding: `var(--space-6) var(--space-3)` }, children: [_jsx("div", { style: {
                                width: '64px',
                                height: '64px',
                                borderRadius: '50%',
                                backgroundColor: 'var(--color-success-container)',
                                color: 'var(--color-on-success-container)',
                                border: '1px solid var(--color-success-container)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                margin: '0 auto 20px',
                            }, children: _jsx(Icon, { name: "check_circle", size: 36 }) }), _jsx("h3", { style: { fontSize: '24px', fontWeight: 800, color: 'var(--color-primary)', marginBottom: 'var(--space-2)' }, children: "Demo Request Received!" }), _jsxs("p", { style: { fontSize: '15px', color: 'var(--color-on-surface)', maxWidth: '420px', margin: '0 auto 24px', lineHeight: 1.55 }, children: ["Thank you, ", _jsx("strong", { style: { color: 'var(--color-on-surface)' }, children: formData.name }), ". Our solutions engineering team will reach out to ", _jsx("strong", { style: { color: 'var(--color-info)' }, children: formData.email }), " within 24 hours to coordinate your custom plant walkthrough."] }), _jsx("button", { onClick: () => {
                                setSubmitted(false);
                                onClose();
                            }, className: "fv-btn-secondary", style: { padding: `var(--space-3) var(--space-8)` }, children: "Close Window" })] }))] }) }));
};
//# sourceMappingURL=BookDemoModal.js.map