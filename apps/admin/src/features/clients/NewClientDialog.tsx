import React, { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button, Icon } from '@factory-vision/ui';
import { SurfaceCard } from '@factory-vision/ui/fv';
import { api, idr, InternalApiError } from '../../app/api.js';

/**
 * Onboards a customer.
 *
 * Creating a client also creates the tenant their MES data will live under and
 * their first subscription, in one transaction, so a half-registered customer
 * cannot exist.
 */
export const NewClientDialog: React.FC<{ onClose: () => void; onCreated: () => void }> = ({
  onClose,
  onCreated,
}) => {
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => api.plans() });

  const today = new Date().toISOString().slice(0, 10);
  const inOneYear = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);

  const [form, setForm] = useState({
    legalName: '',
    displayName: '',
    industry: '',
    city: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    accountManager: '',
    planId: '',
    lifecycleStatus: 'TRIAL',
    deploymentMode: 'CLOUD_MULTI_TENANT',
    startedAt: today,
    renewsAt: inOneYear,
    notes: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const create = useMutation({
    mutationFn: () =>
      api.clients.create({
        ...form,
        // Empty optional fields should be absent, not empty strings.
        industry: form.industry || undefined,
        city: form.city || undefined,
        contactName: form.contactName || undefined,
        contactEmail: form.contactEmail || undefined,
        contactPhone: form.contactPhone || undefined,
        accountManager: form.accountManager || undefined,
        notes: form.notes || undefined,
        renewsAt: form.renewsAt || undefined,
      }),
    onSuccess: onCreated,
    onError: (err) => {
      if (err instanceof InternalApiError) {
        setError(err.message);
        setFieldErrors(Object.fromEntries(err.fields.map((f) => [f.field, f.message])));
      } else {
        setError('Gagal membuat klien.');
      }
    },
  });

  const selectedPlan = plans.data?.find((p) => p.id === form.planId);

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'color-mix(in srgb, var(--color-scrim) 55%, transparent)',
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--space-6)',
        zIndex: 50,
        overflowY: 'auto',
      }}
      onClick={onClose}
    >
      <SurfaceCard
        padding="lg"
        style={{ width: '100%', maxWidth: '640px' }}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 'var(--space-4)',
          }}
        >
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
            Klien Baru
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-on-surface-variant)',
              display: 'flex',
            }}
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        <div
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--space-3)' }}
        >
          <Field
            label="Nama Legal"
            required
            value={form.legalName}
            onChange={set('legalName')}
            error={fieldErrors.legalName}
            placeholder="PT Contoh Manufaktur Indonesia"
          />
          <Field
            label="Nama Tampilan"
            required
            value={form.displayName}
            onChange={set('displayName')}
            error={fieldErrors.displayName}
            placeholder="Contoh Manufaktur"
          />
          <Field
            label="Industri"
            value={form.industry}
            onChange={set('industry')}
            placeholder="Tire Manufacturing"
          />
          <Field label="Kota" value={form.city} onChange={set('city')} placeholder="Cikarang" />
          <Field label="Nama Kontak" value={form.contactName} onChange={set('contactName')} />
          <Field
            label="Email Kontak"
            value={form.contactEmail}
            onChange={set('contactEmail')}
            error={fieldErrors.contactEmail}
            placeholder="nama@perusahaan.co.id"
          />
          <Field label="Telepon" value={form.contactPhone} onChange={set('contactPhone')} />
          <Field label="Account Manager" value={form.accountManager} onChange={set('accountManager')} />

          <Select
            label="Paket"
            required
            value={form.planId}
            onChange={set('planId')}
            error={fieldErrors.planId}
            options={[
              { value: '', label: 'Pilih paket…' },
              ...(plans.data ?? []).map((p) => ({
                value: p.id,
                label: `${p.name} — ${idr(p.monthlyPriceIdr)}/bulan`,
              })),
            ]}
          />
          <Select
            label="Status"
            value={form.lifecycleStatus}
            onChange={set('lifecycleStatus')}
            options={[
              { value: 'PROSPECT', label: 'Prospek' },
              { value: 'TRIAL', label: 'Trial' },
              { value: 'ACTIVE', label: 'Aktif' },
            ]}
          />
          <Select
            label="Mode Deployment"
            value={form.deploymentMode}
            onChange={set('deploymentMode')}
            options={[
              { value: 'CLOUD_MULTI_TENANT', label: 'Cloud SaaS' },
              { value: 'ON_PREMISE_SINGLE_TENANT', label: 'On-Premise' },
            ]}
          />
          <Field
            label="Mulai"
            required
            type="date"
            value={form.startedAt}
            onChange={set('startedAt')}
            error={fieldErrors.startedAt}
          />
          <Field label="Perpanjangan" type="date" value={form.renewsAt} onChange={set('renewsAt')} />
        </div>

        {selectedPlan && (
          <div
            style={{
              marginTop: 'var(--space-3)',
              padding: `var(--space-3) var(--space-3)`,
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--color-surface-container)',
              fontSize: '11.5px',
              color: 'var(--color-on-surface-variant)',
              lineHeight: 1.6,
            }}
          >
            Batas paket {selectedPlan.name}: {selectedPlan.maxPlants ?? '∞'} plant ·{' '}
            {selectedPlan.maxProductionLines ?? '∞'} production line · {selectedPlan.maxMachines ?? '∞'} mesin ·{' '}
            {selectedPlan.maxUsers ?? '∞'} pengguna · {selectedPlan.maxOperators ?? '∞'} operator.
          </div>
        )}

        {error && (
          <div
            role="alert"
            style={{
              marginTop: 'var(--space-3)',
              padding: `var(--space-3) var(--space-3)`,
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--color-error-container)',
              color: 'var(--color-on-error-container)',
              fontSize: '12px',
              fontWeight: 600,
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
          <Button variant="text" onClick={onClose}>
            Batal
          </Button>
          <Button variant="filled" disabled={create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? 'Menyimpan…' : 'Buat Klien'}
          </Button>
        </div>
      </SurfaceCard>
    </div>
  );
};

const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: `var(--space-3) var(--space-3)`,
  fontSize: '13px',
  fontFamily: 'var(--font-family)',
  color: 'var(--color-on-surface)',
  backgroundColor: 'var(--color-surface-container)',
  border: '1px solid var(--color-outline-variant)',
  borderRadius: 'var(--radius-sm)',
  outline: 'none',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '11px',
  fontWeight: 700,
  color: 'var(--color-on-surface-variant)',
  marginBottom: 'var(--space-2)',
};

const Field: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  type?: string;
  placeholder?: string;
  error?: string;
}> = ({ label, value, onChange, required, type = 'text', placeholder, error }) => (
  <div>
    <label style={labelStyle}>
      {label}
      {required && <span style={{ color: 'var(--color-error)' }}> *</span>}
    </label>
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={{ ...fieldStyle, borderColor: error ? 'var(--color-error)' : 'var(--color-outline-variant)' }}
    />
    {error && <span style={{ fontSize: '10.5px', color: 'var(--color-error)' }}>{error}</span>}
  </div>
);

const Select: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  required?: boolean;
  error?: string;
}> = ({ label, value, onChange, options, required, error }) => (
  <div>
    <label style={labelStyle}>
      {label}
      {required && <span style={{ color: 'var(--color-error)' }}> *</span>}
    </label>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ ...fieldStyle, borderColor: error ? 'var(--color-error)' : 'var(--color-outline-variant)' }}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
    {error && <span style={{ fontSize: '10.5px', color: 'var(--color-error)' }}>{error}</span>}
  </div>
);
