import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FactoryVisionApiClient, ApiRequestError } from '@factory-vision/api-client';
import type { OeeCalculationConfig } from '@factory-vision/domain-types';
import { Button, Icon } from '@factory-vision/ui';
import { SurfaceCard } from '@factory-vision/ui/fv';
import { useSession } from '../../../app/SessionContext.js';

const api = new FactoryVisionApiClient({ baseUrl: '' });

type Draft = Pick<
  OeeCalculationConfig,
  'pptExcludesPlannedDowntime' | 'idealCycleSource' | 'allowIdealCycleFallback'
>;

/**
 * US-032-US-036, the tenant's OEE operational definitions.
 *
 * fixes the *formulas*; what a factory actually argues about is the
 * definitions underneath them. Making those settings, and showing that a
 * change bumps `calc_version`, is what lets a pilot gap be closed by
 * configuration and recompute instead of an ad-hoc patch.
 */
export const OeeConfigTab: React.FC<{ onToast: (message: string) => void }> = ({ onToast }) => {
  const queryClient = useQueryClient();
  const { can } = useSession();
  const editable = can('configuration:manage');

  const [draft, setDraft] = useState<Partial<Draft>>({});
  const [error, setError] = useState<string | null>(null);

  const { data: config, isLoading } = useQuery({
    queryKey: ['oee-config'],
    queryFn: () => api.oee.getConfig(),
  });

  const save = useMutation({
    mutationFn: () => api.oee.updateConfig(draft),
    onSuccess: (updated) => {
      onToast(`Definisi OEE tersimpan, calc_version sekarang v${updated.calcVersion}.`);
      setDraft({});
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['oee-config'] });
      // Every OEE surface is derived on read, so the recompute is immediate.
      queryClient.invalidateQueries({ queryKey: ['oee-machine-performance'] });
      queryClient.invalidateQueries({ queryKey: ['bottlenecks'] });
      queryClient.invalidateQueries({ queryKey: ['oee-validation'] });
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : 'Gagal menyimpan konfigurasi.'),
  });

  if (isLoading || !config) return <Empty label="Memuat konfigurasi OEE…" />;

  const current: Draft = {
    pptExcludesPlannedDowntime: draft.pptExcludesPlannedDowntime ?? config.pptExcludesPlannedDowntime,
    idealCycleSource: draft.idealCycleSource ?? config.idealCycleSource,
    allowIdealCycleFallback: draft.allowIdealCycleFallback ?? config.allowIdealCycleFallback,
  };

  const dirty =
    current.pptExcludesPlannedDowntime !== config.pptExcludesPlannedDowntime ||
    current.idealCycleSource !== config.idealCycleSource ||
    current.allowIdealCycleFallback !== config.allowIdealCycleFallback;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <SurfaceCard padding="md">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
              Versi Perhitungan Aktif
            </div>
            <p style={{ margin: `var(--space-1) 0 0`, fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
              Setiap hasil OEE menyimpan <code>calc_version</code>, sehingga angka historis selalu dapat
              ditelusuri ke definisi yang menghasilkannya.
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--color-primary)' }}>
              v{config.calcVersion}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
              Diubah {new Date(config.updatedAt).toLocaleString('id-ID')}
            </div>
          </div>
        </div>
      </SurfaceCard>

      {error && (
        <div
          role="alert"
          style={{
            padding: `var(--space-3) var(--space-3)`,
            borderRadius: 'var(--radius-sm, 8px)',
            backgroundColor: 'var(--color-error-container)',
            color: 'var(--color-on-error-container)',
            fontSize: '12px',
            fontWeight: 600,
          }}
        >
          {error}
        </div>
      )}

      <SurfaceCard padding="md" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <Setting
          title="Planned downtime dikeluarkan dari Planned Production Time"
          description={
            'Baseline MVP adalah nonaktif: setup, changeover, dan cleaning tetap masuk PPT ' +
            'sehingga menurunkan Availability. Ini pilihan yang disengaja dan menjadi item validasi V1/V5.'
          }
        >
          <Toggle
            checked={current.pptExcludesPlannedDowntime}
            disabled={!editable}
            onChange={(value) => setDraft((d) => ({ ...d, pptExcludesPlannedDowntime: value }))}
          />
        </Setting>

        <Setting
          title="Sumber Ideal Cycle Time"
          description="Urutan resolusi rate yang dipakai Performance. Product × Machine adalah sumber paling spesifik."
        >
          <select
            value={current.idealCycleSource}
            disabled={!editable}
            onChange={(e) =>
              setDraft((d) => ({ ...d, idealCycleSource: e.target.value as Draft['idealCycleSource'] }))
            }
            style={{
              padding: `var(--space-2) var(--space-3)`,
              fontSize: '12px',
              fontFamily: 'var(--font-family)',
              borderRadius: 'var(--radius-sm, 8px)',
              border: '1px solid var(--color-outline-variant)',
              backgroundColor: 'var(--color-surface-container-high)',
              color: 'var(--color-on-surface)',
            }}
          >
            <option value="PRODUCT_MACHINE">Product × Machine (disarankan)</option>
            <option value="ROUTING">Product Routing</option>
            <option value="PRODUCT">Produk</option>
          </select>
        </Setting>

        <Setting
          title="Izinkan fallback ketika rate tidak ditemukan"
          description={
            'Nonaktif: bila rate belum dikonfigurasi, Performance dan OEE tidak dihitung ' +
            'dan mesin ditandai pada layar investigasi. Mengaktifkan ini akan menghasilkan angka yang tidak dapat direproduksi pabrik.'
          }
          warn={current.allowIdealCycleFallback}
        >
          <Toggle
            checked={current.allowIdealCycleFallback}
            disabled={!editable}
            onChange={(value) => setDraft((d) => ({ ...d, allowIdealCycleFallback: value }))}
          />
        </Setting>

        {editable && (
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            <Button variant="filled" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? 'Menyimpan…' : 'Simpan & Recompute'}
            </Button>
            {dirty && (
              <span
                style={{
                  fontSize: '11px',
                  color: 'var(--color-warning)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-1)',
                }}
              >
                <Icon name="info" size={14} />
                Menyimpan akan menaikkan calc_version menjadi v{config.calcVersion + 1}.
              </span>
            )}
          </div>
        )}

        {!editable && (
          <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
            Peran Anda tidak memiliki izin <code>configuration:manage</code> untuk mengubah definisi ini.
          </div>
        )}
      </SurfaceCard>
    </div>
  );
};

const Setting: React.FC<{
  title: string;
  description: string;
  warn?: boolean;
  children: React.ReactNode;
}> = ({ title, description, warn, children }) => (
  <div
    style={{
      display: 'flex',
      justifyContent: 'space-between',
      gap: 'var(--space-4)',
      alignItems: 'flex-start',
      paddingBottom: 'var(--space-3)',
      borderBottom: '1px solid var(--color-outline-variant)',
    }}
  >
    <div style={{ maxWidth: '560px' }}>
      <div
        style={{
          fontSize: '13px',
          fontWeight: 700,
          color: warn ? 'var(--color-warning)' : 'var(--color-on-surface)',
        }}
      >
        {title}
      </div>
      <p
        style={{
          margin: `var(--space-1) 0 0`,
          fontSize: '12px',
          color: 'var(--color-on-surface-variant)',
          lineHeight: 1.6,
        }}
      >
        {description}
      </p>
    </div>
    <div style={{ flexShrink: 0 }}>{children}</div>
  </div>
);

const Toggle: React.FC<{ checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }> = ({
  checked,
  disabled,
  onChange,
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    style={{
      width: '46px',
      height: '26px',
      borderRadius: 'var(--radius-full, 999px)',
      border: '1px solid var(--color-outline)',
      backgroundColor: checked ? 'var(--color-primary)' : 'var(--color-surface-container-highest)',
      position: 'relative',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.6 : 1,
      transition: 'background-color 150ms ease',
    }}
  >
    <span
      style={{
        position: 'absolute',
        top: '3px',
        left: checked ? '23px' : '3px',
        width: '18px',
        height: '18px',
        borderRadius: 'var(--radius-full, 999px)',
        backgroundColor: checked ? 'var(--color-on-primary)' : 'var(--color-outline)',
        transition: 'left 150ms ease',
      }}
    />
  </button>
);

const Empty: React.FC<{ label: string }> = ({ label }) => (
  <div
    style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--color-on-surface-variant)', fontSize: '12px' }}
  >
    {label}
  </div>
);
