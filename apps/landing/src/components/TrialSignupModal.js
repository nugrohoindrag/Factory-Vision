import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
import { Icon } from '@factory-vision/ui';
const INDUSTRIES = [
    { value: 'automotive', label: 'Otomotif & Presisi', icon: 'directions_car', desc: 'Stamping, Machining, Sub-assembly' },
    { value: 'electronics', label: 'Elektronik & High-Tech', icon: 'memory', desc: 'SMT, PCB, Final Assembly & Testing' },
    { value: 'fnb', label: 'Makanan & Minuman (F&B)', icon: 'restaurant', desc: 'Mixing, Batching, Bottling, Packaging' },
    { value: 'pharmaceutical', label: 'Farmasi & Medis', icon: 'medication', desc: 'Formulasi, Tableting, Clean Room' },
    { value: 'chemical', label: 'Kimia & Material', icon: 'science', desc: 'Reaction, Blending, Granulation' },
    { value: 'general', label: 'Manufaktur Umum', icon: 'precision_manufacturing', desc: 'Fabrikasi, Assembling, Finishing' },
];
export const TrialSignupModal = ({ isOpen, onClose }) => {
    const [formData, setFormData] = useState({
        fullName: '',
        companyName: '',
        email: '',
        password: '',
        industry: 'automotive',
        plantScale: '1-3 Lini Produksi',
    });
    const [submitting, setSubmitting] = useState(false);
    const [errorMsg, setErrorMsg] = useState(null);
    const [success, setSuccess] = useState(false);
    if (!isOpen)
        return null;
    const handleSubmit = async (e) => {
        e.preventDefault();
        setErrorMsg(null);
        setSubmitting(true);
        try {
            const res = await fetch('/api/v1/auth/trial-register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData),
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.message || 'Gagal mendaftarkan akun uji coba. Silakan coba lagi.');
            }
            setSuccess(true);
            // Redirect to console with trial token and onboarding trigger
            setTimeout(() => {
                const consoleUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
                    ? 'http://localhost:3100'
                    : '/console';
                window.location.href = `${consoleUrl}/?token=${encodeURIComponent(data.token)}&trial=1`;
            }, 1200);
        }
        catch (err) {
            setErrorMsg(err instanceof Error ? err.message : 'Terjadi kesalahan sistem');
            setSubmitting(false);
        }
    };
    return (_jsx("div", { className: "fv-modal-overlay", onClick: onClose, children: _jsxs("div", { className: "fv-modal-content", onClick: (e) => e.stopPropagation(), style: {
                maxWidth: '620px',
                maxHeight: '92vh',
                overflowY: 'auto',
                padding: 'var(--space-6)',
                borderRadius: 'var(--radius-xl)',
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-outline-variant)',
                boxShadow: 'var(--elevation-4)',
                position: 'relative',
            }, children: [_jsx("button", { onClick: onClose, disabled: submitting, style: {
                        position: 'absolute',
                        top: '20px',
                        right: '20px',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--color-on-surface-variant)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: 'var(--space-1)',
                        borderRadius: '50%',
                    }, title: "Tutup", children: _jsx(Icon, { name: "close", size: 24 }) }), success ? (_jsxs("div", { style: { textAlign: 'center', padding: 'var(--space-6) var(--space-2)' }, children: [_jsx("div", { style: {
                                width: '64px',
                                height: '64px',
                                borderRadius: '50%',
                                backgroundColor: 'var(--color-success)',
                                color: 'var(--color-on-success)',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                marginBottom: 'var(--space-4)',
                            }, children: _jsx(Icon, { name: "check", size: 36 }) }), _jsx("h3", { style: { fontSize: '22px', fontWeight: 800, color: 'var(--color-on-surface)', marginBottom: 'var(--space-2)' }, children: "Akun Trial Siap Digunakan!" }), _jsx("p", { style: { fontSize: '14px', color: 'var(--color-on-surface-variant)', marginBottom: 'var(--space-4)' }, children: "Mengalihkan Anda ke Konsol MES Factory Vision untuk memulai setup pabrik..." }), _jsxs("div", { style: { display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 'var(--space-2)' }, children: [_jsx(Icon, { name: "sync", size: 20, className: "fv-spin" }), _jsx("span", { style: { fontSize: '13px', fontWeight: 600, color: 'var(--color-primary)' }, children: "Membuka Konsol Pabrik..." })] })] })) : (_jsxs("div", { children: [_jsxs("div", { style: { marginBottom: 'var(--space-5)' }, children: [_jsxs("div", { style: {
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 'var(--space-2)',
                                        padding: `var(--space-1) var(--space-3)`,
                                        borderRadius: '9999px',
                                        backgroundColor: 'var(--color-primary)',
                                        color: 'var(--color-on-primary)',
                                        fontSize: '11px',
                                        fontWeight: 800,
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.04em',
                                        marginBottom: 'var(--space-2)',
                                    }, children: [_jsx(Icon, { name: "rocket_launch", size: 14 }), "Coba Gratis 14 Hari Penuh"] }), _jsx("h3", { style: { fontSize: '22px', fontWeight: 800, color: 'var(--color-on-surface)', margin: '0 0 var(--space-1) 0' }, children: "Mulai Digitalisasi Pabrik Anda Sekarang" }), _jsx("p", { style: { fontSize: '13.5px', color: 'var(--color-on-surface-variant)', margin: 0, lineHeight: 1.5 }, children: "Akses instan ke semua fitur MES tanpa kartu kredit. Dilengkapi template industri siap pakai." })] }), errorMsg && (_jsxs("div", { style: {
                                padding: 'var(--space-3) var(--space-4)',
                                borderRadius: 'var(--radius-md)',
                                backgroundColor: 'var(--color-error-container)',
                                color: 'var(--color-on-error-container)',
                                fontSize: '13px',
                                fontWeight: 600,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 'var(--space-2)',
                                marginBottom: 'var(--space-4)',
                            }, children: [_jsx(Icon, { name: "error", size: 18 }), _jsx("span", { children: errorMsg })] })), _jsxs("form", { onSubmit: handleSubmit, style: { display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }, children: [_jsxs("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }, children: [_jsxs("div", { children: [_jsx("label", { style: { display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: 'var(--space-1)', color: 'var(--color-on-surface)' }, children: "Nama Lengkap *" }), _jsx("input", { type: "text", required: true, placeholder: "e.g. Hendro Pratama", value: formData.fullName, onChange: (e) => setFormData({ ...formData, fullName: e.target.value }), style: {
                                                        width: '100%',
                                                        padding: '10px 12px',
                                                        borderRadius: 'var(--radius-md)',
                                                        border: '1px solid var(--color-outline-variant)',
                                                        backgroundColor: 'var(--color-surface-container-low)',
                                                        color: 'var(--color-on-surface)',
                                                        fontSize: '13px',
                                                        boxSizing: 'border-box',
                                                    } })] }), _jsxs("div", { children: [_jsx("label", { style: { display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: 'var(--space-1)', color: 'var(--color-on-surface)' }, children: "Nama Perusahaan / Pabrik *" }), _jsx("input", { type: "text", required: true, placeholder: "e.g. PT Sinar Presisi Indonesia", value: formData.companyName, onChange: (e) => setFormData({ ...formData, companyName: e.target.value }), style: {
                                                        width: '100%',
                                                        padding: '10px 12px',
                                                        borderRadius: 'var(--radius-md)',
                                                        border: '1px solid var(--color-outline-variant)',
                                                        backgroundColor: 'var(--color-surface-container-low)',
                                                        color: 'var(--color-on-surface)',
                                                        fontSize: '13px',
                                                        boxSizing: 'border-box',
                                                    } })] })] }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }, children: [_jsxs("div", { children: [_jsx("label", { style: { display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: 'var(--space-1)', color: 'var(--color-on-surface)' }, children: "Email Perusahaan *" }), _jsx("input", { type: "email", required: true, placeholder: "hendro@sinarpresisi.co.id", value: formData.email, onChange: (e) => setFormData({ ...formData, email: e.target.value }), style: {
                                                        width: '100%',
                                                        padding: '10px 12px',
                                                        borderRadius: 'var(--radius-md)',
                                                        border: '1px solid var(--color-outline-variant)',
                                                        backgroundColor: 'var(--color-surface-container-low)',
                                                        color: 'var(--color-on-surface)',
                                                        fontSize: '13px',
                                                        boxSizing: 'border-box',
                                                    } })] }), _jsxs("div", { children: [_jsx("label", { style: { display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: 'var(--space-1)', color: 'var(--color-on-surface)' }, children: "Kata Sandi (min 8 karakter) *" }), _jsx("input", { type: "password", required: true, minLength: 8, placeholder: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022", value: formData.password, onChange: (e) => setFormData({ ...formData, password: e.target.value }), style: {
                                                        width: '100%',
                                                        padding: '10px 12px',
                                                        borderRadius: 'var(--radius-md)',
                                                        border: '1px solid var(--color-outline-variant)',
                                                        backgroundColor: 'var(--color-surface-container-low)',
                                                        color: 'var(--color-on-surface)',
                                                        fontSize: '13px',
                                                        boxSizing: 'border-box',
                                                    } })] })] }), _jsxs("div", { children: [_jsx("label", { style: { display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: 'var(--space-2)', color: 'var(--color-on-surface)' }, children: "Pilih Industri Pabrik Anda (Untuk template starter data) *" }), _jsx("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }, children: INDUSTRIES.map((ind) => {
                                                const isSelected = formData.industry === ind.value;
                                                return (_jsxs("div", { onClick: () => setFormData({ ...formData, industry: ind.value }), style: {
                                                        display: 'flex',
                                                        alignItems: 'flex-start',
                                                        gap: 'var(--space-2)',
                                                        padding: 'var(--space-2) var(--space-3)',
                                                        borderRadius: 'var(--radius-md)',
                                                        border: `1.5px solid ${isSelected ? 'var(--color-primary)' : 'var(--color-outline-variant)'}`,
                                                        backgroundColor: isSelected ? 'var(--color-surface-container-high)' : 'var(--color-surface-container-low)',
                                                        cursor: 'pointer',
                                                        transition: 'all 0.15s ease',
                                                    }, children: [_jsx("div", { style: { marginTop: '2px', color: isSelected ? 'var(--color-primary)' : 'var(--color-on-surface-variant)' }, children: _jsx(Icon, { name: ind.icon, size: 18 }) }), _jsxs("div", { children: [_jsx("div", { style: { fontSize: '12px', fontWeight: 700, color: isSelected ? 'var(--color-primary)' : 'var(--color-on-surface)' }, children: ind.label }), _jsx("div", { style: { fontSize: '11px', color: 'var(--color-on-surface-variant)', lineHeight: 1.2 }, children: ind.desc })] })] }, ind.value));
                                            }) })] }), _jsxs("div", { children: [_jsx("label", { style: { display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: 'var(--space-1)', color: 'var(--color-on-surface)' }, children: "Perkiraan Jumlah Lini / Mesin" }), _jsxs("select", { value: formData.plantScale, onChange: (e) => setFormData({ ...formData, plantScale: e.target.value }), style: {
                                                width: '100%',
                                                padding: '10px 12px',
                                                borderRadius: 'var(--radius-md)',
                                                border: '1px solid var(--color-outline-variant)',
                                                backgroundColor: 'var(--color-surface-container-low)',
                                                color: 'var(--color-on-surface)',
                                                fontSize: '13px',
                                                boxSizing: 'border-box',
                                            }, children: [_jsx("option", { value: "1-3 Lini Produksi", children: "1 - 3 Lini Produksi (Pabrik Skala Kecil / Percontohan)" }), _jsx("option", { value: "4-10 Lini Produksi", children: "4 - 10 Lini Produksi (Pabrik Skala Menengah)" }), _jsx("option", { value: ">10 Lini Produksi", children: "> 10 Lini Produksi (Pabrik Skala Besar / Enterprise)" })] })] }), _jsxs("div", { style: { marginTop: 'var(--space-2)' }, children: [_jsx("button", { type: "submit", disabled: submitting, style: {
                                                width: '100%',
                                                padding: '12px var(--space-4)',
                                                borderRadius: 'var(--radius-md)',
                                                border: 'none',
                                                backgroundColor: 'var(--color-primary)',
                                                color: 'var(--color-on-primary)',
                                                fontSize: '14px',
                                                fontWeight: 700,
                                                cursor: submitting ? 'not-allowed' : 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                gap: 'var(--space-2)',
                                                boxShadow: 'var(--elevation-2)',
                                                opacity: submitting ? 0.7 : 1,
                                            }, children: submitting ? (_jsxs(_Fragment, { children: [_jsx(Icon, { name: "sync", size: 18, className: "fv-spin" }), _jsx("span", { children: "Mempersiapkan Workspace Pabrik..." })] })) : (_jsxs(_Fragment, { children: [_jsx(Icon, { name: "arrow_forward", size: 18 }), _jsx("span", { children: "Buat Akun & Buka Konsol MES" })] })) }), _jsx("div", { style: { textAlign: 'center', marginTop: 'var(--space-2)', fontSize: '11px', color: 'var(--color-on-surface-variant)' }, children: "14 hari trial penuh \u2022 Tanpa komitmen \u2022 Tidak perlu kartu kredit" })] })] })] }))] }) }));
};
//# sourceMappingURL=TrialSignupModal.js.map