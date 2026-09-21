import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Icon } from '@factory-vision/ui';
import { SurfaceCard } from '@factory-vision/ui/fv';
import type { SiteSettings } from '@factory-vision/domain-types';
import { api, InternalApiError } from '../../app/api.js';
import { useSession } from '../../app/SessionContext.js';

type Form = Pick<
  SiteSettings,
  | 'siteName'
  | 'siteUrl'
  | 'siteDescription'
  | 'gaMeasurementId'
  | 'searchConsoleToken'
  | 'searchConsoleFile'
  | 'whatsappNumber'
  | 'whatsappLabel'
>;

const EMPTY: Form = {
  siteName: '',
  siteUrl: '',
  siteDescription: '',
  gaMeasurementId: '',
  searchConsoleToken: '',
  searchConsoleFile: '',
  whatsappNumber: '',
  whatsappLabel: '',
};

/**
 * Settings the public landing page reads at load: Google Analytics, Search
 * Console verification, and the site identity used by the article pages and
 * the sitemap. Saved here, live on the next page load; no release needed.
 */
export const SiteSettingsPage: React.FC = () => {
  const { can } = useSession();
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['site-settings'], queryFn: () => api.cms.settings() });

  const [form, setForm] = useState<Form>(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings.data) {
      const { siteName, siteUrl, siteDescription, gaMeasurementId, searchConsoleToken, searchConsoleFile, whatsappNumber, whatsappLabel } = settings.data;
      setForm({ siteName, siteUrl, siteDescription, gaMeasurementId, searchConsoleToken, searchConsoleFile, whatsappNumber, whatsappLabel });
    }
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () => api.cms.saveSettings(form),
    onSuccess: () => {
      setError(null);
      setFieldErrors({});
      setSaved(true);
      window.setTimeout(() => setSaved(false), 3000);
      void queryClient.invalidateQueries({ queryKey: ['site-settings'] });
    },
    onError: (err) => {
      if (err instanceof InternalApiError) {
        setError(err.message);
        setFieldErrors(Object.fromEntries(err.fields.map((f) => [f.field, f.message])));
      } else {
        setError('Gagal menyimpan pengaturan.');
      }
    },
  });

  const set = (key: keyof Form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));
  const readOnly = !can('cms:manage');
  const siteUrl = form.siteUrl || 'https://factoryvision.id';

  return (
    <div style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', maxWidth: '960px' }}>
      <div>
        <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--color-on-surface)' }}>
          Pengaturan Situs
        </h1>
        <p style={{ margin: `var(--space-1) 0 0`, fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
          Google Analytics, Google Search Console, dan identitas situs untuk landing page serta halaman artikel
        </p>
      </div>

      <SurfaceCard padding="lg">
        <SectionTitle icon="language">Identitas situs</SectionTitle>
        <div style={grid}>
          <Field label="Nama situs" required value={form.siteName} onChange={set('siteName')} error={fieldErrors.siteName} disabled={readOnly} />
          <Field label="URL situs" value={form.siteUrl} onChange={set('siteUrl')} error={fieldErrors.siteUrl} placeholder="https://factoryvision.id" disabled={readOnly} />
        </div>
        <Field
          label="Deskripsi situs"
          value={form.siteDescription}
          onChange={set('siteDescription')}
          error={fieldErrors.siteDescription}
          placeholder="Dipakai sebagai meta description halaman artikel"
          disabled={readOnly}
          multiline
        />
      </SurfaceCard>

      <SurfaceCard padding="lg">
        <SectionTitle icon="insights">Google Analytics</SectionTitle>
        <p style={help}>
          Buat properti GA4 di analytics.google.com, lalu salin <strong>Measurement ID</strong> dari Admin → Data
          Streams → Web. Tag dimuat di landing page dan halaman artikel begitu tersimpan; kosongkan untuk mematikannya.
        </p>
        <div style={grid}>
          <Field
            label="Measurement ID (GA4)"
            value={form.gaMeasurementId}
            onChange={set('gaMeasurementId')}
            error={fieldErrors.gaMeasurementId}
            placeholder="G-XXXXXXXXXX"
            mono
            disabled={readOnly}
          />
        </div>
      </SurfaceCard>

      <SurfaceCard padding="lg">
        <SectionTitle icon="travel_explore">Google Search Console</SectionTitle>
        <p style={help}>
          Di search.google.com/search-console tambahkan properti <strong>URL prefix</strong> {siteUrl}/ dan pilih salah
          satu cara verifikasi. Cara <em>HTML tag</em>: salin nilai <code>content</code> dari meta tag yang
          diberikan. Cara <em>HTML file</em>: salin nama filenya; file itu akan dilayani di {siteUrl}/&lt;nama file&gt;.
          Setelah terverifikasi, kirim sitemap <code>{siteUrl}/sitemap.xml</code>.
        </p>
        <div style={grid}>
          <Field
            label="Token meta tag (content)"
            value={form.searchConsoleToken}
            onChange={set('searchConsoleToken')}
            error={fieldErrors.searchConsoleToken}
            placeholder="nilai content dari <meta name=&quot;google-site-verification&quot;>"
            mono
            disabled={readOnly}
          />
          <Field
            label="Nama file verifikasi HTML"
            value={form.searchConsoleFile}
            onChange={set('searchConsoleFile')}
            error={fieldErrors.searchConsoleFile}
            placeholder="google1234567890abcdef.html"
            mono
            disabled={readOnly}
          />
        </div>
      </SurfaceCard>

      <SurfaceCard padding="lg">
        <SectionTitle icon="chat">Tombol WhatsApp</SectionTitle>
        <p style={help}>
          Tombol mengambang di pojok kanan bawah landing page dan halaman artikel yang membuka chat WhatsApp ke nomor
          ini. Tulis dengan kode negara (0813… otomatis menjadi 62813…); kosongkan nomor untuk menyembunyikan tombol.
        </p>
        <div style={grid}>
          <Field label="Nomor WhatsApp" value={form.whatsappNumber} onChange={set('whatsappNumber')} error={fieldErrors.whatsappNumber} placeholder="6281382258620" mono disabled={readOnly} />
          <Field label="Label tombol" value={form.whatsappLabel} onChange={set('whatsappLabel')} error={fieldErrors.whatsappLabel} placeholder="Ask our Team" disabled={readOnly} />
        </div>
      </SurfaceCard>

      {error && <p style={{ margin: 0, fontSize: '12px', color: 'var(--color-error)' }}>{error}</p>}

      {!readOnly && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <Button variant="filled" icon={<Icon name="save" size={16} />} disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Menyimpan…' : 'Simpan pengaturan'}
          </Button>
          {saved && <span style={{ fontSize: '12px', color: 'var(--color-success)', fontWeight: 700 }}>Tersimpan.</span>}
          {settings.data?.updatedAt && (
            <span style={{ fontSize: '11.5px', color: 'var(--color-on-surface-variant)' }}>
              Terakhir diubah {new Date(settings.data.updatedAt).toLocaleString('id-ID')}
              {settings.data.updatedBy ? ` oleh ${settings.data.updatedBy}` : ''}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

const SectionTitle: React.FC<{ icon: string; children: React.ReactNode }> = ({ icon, children }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
    <Icon name={icon} size={18} style={{ color: 'var(--color-primary)' }} />
    <span style={{ fontSize: '13px', fontWeight: 800, color: 'var(--color-on-surface)' }}>{children}</span>
  </div>
);

const grid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
  gap: 'var(--space-3)',
  marginBottom: 'var(--space-3)',
};

const help: React.CSSProperties = {
  margin: `0 0 var(--space-3)`,
  fontSize: '12.5px',
  lineHeight: 1.6,
  color: 'var(--color-on-surface-variant)',
};

const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: `var(--space-3) var(--space-3)`,
  fontSize: '13px',
  fontFamily: 'var(--font-family)',
  color: 'var(--color-on-surface)',
  backgroundColor: 'var(--color-surface-container)',
  border: '1px solid var(--color-border)',
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
  placeholder?: string;
  error?: string;
  mono?: boolean;
  disabled?: boolean;
  multiline?: boolean;
}> = ({ label, value, onChange, required, placeholder, error, mono, disabled, multiline }) => {
  const style = {
    ...fieldStyle,
    borderColor: error ? 'var(--color-error)' : 'var(--color-border)',
    fontFamily: mono ? 'var(--font-family-mono, monospace)' : fieldStyle.fontFamily,
  };
  return (
    <div>
      <label style={labelStyle}>
        {label}
        {required && <span style={{ color: 'var(--color-error)' }}> *</span>}
      </label>
      {multiline ? (
        <textarea value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} disabled={disabled} rows={2} style={{ ...style, resize: 'vertical' }} />
      ) : (
        <input type="text" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} disabled={disabled} spellCheck={false} style={style} />
      )}
      {error && <span style={{ fontSize: '10.5px', color: 'var(--color-error)' }}>{error}</span>}
    </div>
  );
};
