import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FactoryVisionApiClient, ApiRequestError } from '@factory-vision/api-client';
import type { OeeValidationEntry, OeeValidationGapClass } from '@factory-vision/domain-types';
import { Button, Icon } from '@factory-vision/ui';
import { MetricCard, SurfaceCard, Page, Section } from '@factory-vision/ui/fv';
import { useSession } from '../../app/SessionContext.js';

const api = new FactoryVisionApiClient({ baseUrl: '' });

const GAP_CLASS_LABEL: Record<OeeValidationGapClass, string> = {
  NONE: 'Belum diklasifikasi',
  DEFINITION: 'Definisi',
  DATA_CAPTURE: 'Penangkapan data',
  MASTER_DATA: 'Master data',
};

const STATUS_TONE: Record<OeeValidationEntry['status'], { bg: string; fg: string; label: string }> = {
  OPEN: { bg: 'var(--color-error-container)', fg: 'var(--color-on-error-container)', label: 'Terbuka' },
  IN_REVIEW: {
    bg: 'var(--color-warning-container)',
    fg: 'var(--color-on-warning-container)',
    label: 'Ditinjau',
  },
  RESOLVED: { bg: 'var(--color-success-container)', fg: 'var(--color-on-success-container)', label: 'Selesai' },
};

/**
 * US-036, Validate OEE Against Pilot.
 *
 * makes this a gate, not a report: the six items V1-V6 must be closed
 * before scale-up, and a *definition* gap may only be closed by changing the
 * tenant's OEE configuration and recomputing. The form enforces that, it will
 * not let an item be marked resolved as a definition gap without the
 * configuration change being asserted, which is precisely the ad-hoc patch the
 * PRD forbids during the pilot.
 */
export const OeeValidationPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { can } = useSession();
  const editable = can('configuration:manage');

  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<OeeValidationEntry>>({});
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['oee-validation'], queryFn: () => api.oee.validation() });

  const save = useMutation({
    mutationFn: (entry: OeeValidationEntry) =>
      api.oee.updateValidation(entry.item, {
        scopeLabel: draft.scopeLabel ?? entry.scopeLabel,
        shiftDate: draft.shiftDate ?? entry.shiftDate,
        mesValue: draft.mesValue ?? entry.mesValue ?? undefined,
        factoryValue: draft.factoryValue ?? entry.factoryValue ?? undefined,
        gapClass: draft.gapClass ?? entry.gapClass,
        status: draft.status ?? entry.status,
        resolution: draft.resolution ?? entry.resolution,
        resolvedByConfigChange: draft.resolvedByConfigChange ?? entry.resolvedByConfigChange,
        notes: draft.notes ?? entry.notes,
      }),
    onSuccess: () => {
      setEditing(null);
      setDraft({});
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['oee-validation'] });
    },
    onError: (err) => {
      setError(err instanceof ApiRequestError ? err.message : 'Gagal menyimpan item validasi.');
    },
  });

  const entries = data?.entries ?? [];
  const gate = data?.gate;
  const config = data?.config;

  return (
    <Page style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <Section>
        <h1
          style={{
            fontSize: '22px',
            fontWeight: 800,
            margin: 0,
            color: 'var(--color-on-surface)',
            letterSpacing: '-0.02em',
          }}
        >
          Validasi Definisi OEE (V1-V6)
        </h1>
        <p style={{ margin: '4px 0 0', color: 'var(--color-on-surface-variant)', fontSize: '12px' }}>
          Perbandingan perhitungan MES dengan perhitungan pabrik dan log gap definisi
        </p>
      </Section>

      <Section
        stagger
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}
      >
        <MetricCard
          label="Status Gate"
          value={gate?.passed ? 'Lulus' : 'Belum Lulus'}
          delta={gate?.passed ? 'Semua item terselesaikan' : `${gate?.open.length ?? 0} item masih terbuka`}
          deltaType={gate?.passed ? 'positive' : 'negative'}
          tone={gate?.passed ? 'success' : 'error'}
          icon={<Icon name="fact_check" size={18} />}
        />
        <MetricCard
          label="Calc Version Aktif"
          value={`v${config?.calcVersion ?? ', '}`}
          delta={
            config?.pptExcludesPlannedDowntime
              ? 'Planned downtime dikeluarkan dari PPT'
              : 'Planned downtime termasuk dalam PPT'
          }
          deltaType="neutral"
          tone="info"
          icon={<Icon name="calculate" size={18} />}
        />
        <MetricCard
          label="Sumber Ideal Cycle Time"
          value={config?.idealCycleSource ?? ', '}
          delta={config?.allowIdealCycleFallback ? 'Fallback diizinkan' : 'Tanpa fallback (sesuai)'}
          deltaType={config?.allowIdealCycleFallback ? 'negative' : 'positive'}
          tone="warning"
          icon={<Icon name="speed" size={18} />}
        />
      </Section>

      {error && (
        <Section>
          <div
            role="alert"
            style={{
              padding: '10px 12px',
              borderRadius: 'var(--radius-sm, 8px)',
              backgroundColor: 'var(--color-error-container)',
              color: 'var(--color-on-error-container)',
              fontSize: '12px',
              fontWeight: 600,
            }}
          >
            {error}
          </div>
        </Section>
      )}

      <Section style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {isLoading && <Placeholder label="Memuat log validasi…" />}

        {entries.map((entry) => {
          const isEditing = editing === entry.item;
          const tone = STATUS_TONE[entry.status];
          const current = { ...entry, ...draft };

          return (
            <SurfaceCard key={entry.id} padding="md">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                  <span
                    style={{
                      display: 'grid',
                      placeItems: 'center',
                      width: '32px',
                      height: '32px',
                      borderRadius: 'var(--radius-sm, 8px)',
                      backgroundColor: 'var(--color-primary)',
                      color: 'var(--color-on-primary)',
                      fontSize: '12px',
                      fontWeight: 800,
                    }}
                  >
                    {entry.item}
                  </span>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
                      {entry.title}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                      {entry.scopeLabel}
                      {entry.shiftDate ? ` · ${entry.shiftDate}` : ''} · calc_version v{entry.calcVersion}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span
                    style={{
                      padding: '2px 10px',
                      borderRadius: 'var(--radius-full, 999px)',
                      backgroundColor: tone.bg,
                      color: tone.fg,
                      fontSize: '11px',
                      fontWeight: 700,
                    }}
                  >
                    {tone.label}
                  </span>
                  {editable && (
                    <Button
                      variant="text"
                      onClick={() => {
                        setEditing(isEditing ? null : entry.item);
                        setDraft({});
                        setError(null);
                      }}
                    >
                      {isEditing ? 'Batal' : 'Catat Hasil'}
                    </Button>
                  )}
                </div>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                  gap: '10px',
                  marginTop: '12px',
                  fontSize: '12px',
                }}
              >
                <Readout label="Nilai MES" value={entry.mesValue === null ? ', ' : `${entry.mesValue}`} />
                <Readout
                  label="Nilai Pabrik"
                  value={entry.factoryValue === null ? ', ' : `${entry.factoryValue}`}
                />
                <Readout
                  label="Gap"
                  value={entry.gap === null ? ', ' : `${entry.gap > 0 ? '+' : ''}${entry.gap}`}
                  tone={entry.gap !== null && Math.abs(entry.gap) > 5 ? 'error' : undefined}
                />
                <Readout label="Klasifikasi" value={GAP_CLASS_LABEL[entry.gapClass]} />
              </div>

              {entry.resolution && (
                <p
                  style={{
                    margin: '10px 0 0',
                    fontSize: '12px',
                    color: 'var(--color-on-surface-variant)',
                    lineHeight: 1.6,
                  }}
                >
                  <strong style={{ color: 'var(--color-on-surface)' }}>Penyelesaian:</strong> {entry.resolution}
                  {entry.resolvedByConfigChange && ' (melalui perubahan konfigurasi + recompute)'}
                </p>
              )}

              {isEditing && (
                <div
                  style={{
                    marginTop: '14px',
                    paddingTop: '14px',
                    borderTop: '1px solid var(--color-outline-variant)',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                    gap: '10px',
                  }}
                >
                  <Field label="Area validasi">
                    <input
                      defaultValue={entry.scopeLabel}
                      onChange={(e) => setDraft((d) => ({ ...d, scopeLabel: e.target.value }))}
                      style={inputStyle}
                    />
                  </Field>
                  <Field label="Tanggal shift">
                    <input
                      type="date"
                      defaultValue={entry.shiftDate}
                      onChange={(e) => setDraft((d) => ({ ...d, shiftDate: e.target.value }))}
                      style={inputStyle}
                    />
                  </Field>
                  <Field label="Nilai MES">
                    <input
                      type="number"
                      step="0.1"
                      defaultValue={entry.mesValue ?? ''}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          mesValue: e.target.value === '' ? null : Number(e.target.value),
                        }))
                      }
                      style={inputStyle}
                    />
                  </Field>
                  <Field label="Nilai perhitungan pabrik">
                    <input
                      type="number"
                      step="0.1"
                      defaultValue={entry.factoryValue ?? ''}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          factoryValue: e.target.value === '' ? null : Number(e.target.value),
                        }))
                      }
                      style={inputStyle}
                    />
                  </Field>
                  <Field label="Klasifikasi gap">
                    <select
                      defaultValue={entry.gapClass}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, gapClass: e.target.value as OeeValidationGapClass }))
                      }
                      style={inputStyle}
                    >
                      {(Object.keys(GAP_CLASS_LABEL) as OeeValidationGapClass[]).map((key) => (
                        <option key={key} value={key}>
                          {GAP_CLASS_LABEL[key]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Status">
                    <select
                      defaultValue={entry.status}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, status: e.target.value as OeeValidationEntry['status'] }))
                      }
                      style={inputStyle}
                    >
                      <option value="OPEN">Terbuka</option>
                      <option value="IN_REVIEW">Ditinjau</option>
                      <option value="RESOLVED">Selesai</option>
                    </select>
                  </Field>

                  <Field label="Catatan penyelesaian" span>
                    <textarea
                      defaultValue={entry.resolution}
                      rows={2}
                      onChange={(e) => setDraft((d) => ({ ...d, resolution: e.target.value }))}
                      style={{ ...inputStyle, resize: 'vertical' }}
                    />
                  </Field>

                  <label
                    style={{
                      gridColumn: '1 / -1',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '8px',
                      fontSize: '12px',
                      color: 'var(--color-on-surface-variant)',
                    }}
                  >
                    <input
                      type="checkbox"
                      defaultChecked={entry.resolvedByConfigChange}
                      onChange={(e) => setDraft((d) => ({ ...d, resolvedByConfigChange: e.target.checked }))}
                    />
                    <span>
                      Diselesaikan melalui perubahan konfigurasi OEE + recompute (wajib untuk gap definisi,
                      penyelesaian gap definisi tidak boleh lewat patch ad-hoc)
                    </span>
                  </label>

                  <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '8px' }}>
                    <Button
                      variant="filled"
                      disabled={save.isPending}
                      onClick={() => save.mutate(current as OeeValidationEntry)}
                    >
                      {save.isPending ? 'Menyimpan…' : 'Simpan'}
                    </Button>
                  </div>
                </div>
              )}
            </SurfaceCard>
          );
        })}
      </Section>
    </Page>
  );
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  fontSize: '12px',
  fontFamily: 'var(--font-family)',
  color: 'var(--color-on-surface)',
  backgroundColor: 'var(--color-surface-container)',
  border: '1px solid var(--color-outline-variant)',
  borderRadius: 'var(--radius-sm, 8px)',
};

const Field: React.FC<{ label: string; children: React.ReactNode; span?: boolean }> = ({
  label,
  children,
  span,
}) => (
  <label
    style={{ display: 'flex', flexDirection: 'column', gap: '4px', gridColumn: span ? '1 / -1' : undefined }}
  >
    <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-on-surface-variant)' }}>{label}</span>
    {children}
  </label>
);

const Readout: React.FC<{ label: string; value: string; tone?: 'error' }> = ({ label, value, tone }) => (
  <div
    style={{
      padding: '8px 10px',
      borderRadius: 'var(--radius-sm, 8px)',
      backgroundColor: 'var(--color-surface-container)',
    }}
  >
    <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--color-on-surface-variant)' }}>{label}</div>
    <div
      style={{
        fontSize: '14px',
        fontWeight: 800,
        color: tone === 'error' ? 'var(--color-error)' : 'var(--color-on-surface)',
      }}
    >
      {value}
    </div>
  </div>
);

const Placeholder: React.FC<{ label: string }> = ({ label }) => (
  <div
    style={{ padding: '24px', textAlign: 'center', color: 'var(--color-on-surface-variant)', fontSize: '12px' }}
  >
    {label}
  </div>
);
