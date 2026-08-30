import React, { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { FactoryVisionApiClient, ApiRequestError } from '@factory-vision/api-client';
import type { CsvEntity, CsvImportResult } from '@factory-vision/domain-types';
import { Button, Icon } from '@factory-vision/ui';
import { SurfaceCard, FilterChip } from '@factory-vision/ui/fv';
import { useSession } from '../../../app/SessionContext.js';

const api = new FactoryVisionApiClient({ baseUrl: '' });

/** Triggers a browser download for text the console already holds. */
function downloadText(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * US-008, Import / Export CSV.
 *
 * Validation runs before anything is written and reports every bad row at once,
 * because an admin onboarding 200 machines needs the full list of problems, not
 * the first one. "Validasi" is a dry run against the same rules the real import
 * uses, so a clean dry run genuinely means a clean import.
 */
export const ImportExportTab: React.FC<{ onToast: (message: string) => void }> = ({ onToast }) => {
  const queryClient = useQueryClient();
  const { can } = useSession();
  const canImport = can('master_data:import');

  const fileInput = useRef<HTMLInputElement>(null);
  const [entity, setEntity] = useState<CsvEntity>('products');
  const [fileName, setFileName] = useState<string | null>(null);
  const [content, setContent] = useState<string>('');
  const [result, setResult] = useState<CsvImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: entities = [] } = useQuery({ queryKey: ['csv-entities'], queryFn: () => api.csv.entities() });
  const { data: template } = useQuery({
    queryKey: ['csv-template', entity],
    queryFn: () => api.csv.template(entity),
  });

  const runImport = useMutation({
    mutationFn: (dryRun: boolean) => api.csv.import(entity, content, { dryRun }),
    onSuccess: (data, dryRun) => {
      setResult(data);
      setError(null);
      if (!dryRun) {
        onToast(`Import selesai: ${data.created} dibuat, ${data.updated} diperbarui, ${data.failed} gagal.`);
        // Every master-data list on the console may now be stale.
        queryClient.invalidateQueries();
      }
    },
    onError: (err) => {
      setResult(null);
      setError(err instanceof ApiRequestError ? err.message : 'Gagal memproses file CSV.');
    },
  });

  const exportCsv = useMutation({
    mutationFn: () => api.csv.exportCsv(entity),
    onSuccess: (csv) => {
      downloadText(`${entity}.csv`, csv);
      onToast('Ekspor berhasil diunduh.');
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : 'Gagal mengekspor data.'),
  });

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    setError(null);
    const reader = new FileReader();
    reader.onload = () => setContent(String(reader.result ?? ''));
    reader.onerror = () => setError('Tidak dapat membaca berkas.');
    reader.readAsText(file);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {entities.map((option) => (
          <FilterChip
            key={option.entity}
            selected={entity === option.entity}
            onClick={() => {
              setEntity(option.entity);
              setResult(null);
              setError(null);
            }}
          >
            {option.label}
          </FilterChip>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '14px' }}>
        <SurfaceCard padding="md">
          <div style={{ marginBottom: '10px' }}>
            <span style={{ fontSize: '14px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
              Import CSV
            </span>
            <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
              Unduh template, isi, lalu validasi sebelum menyimpan
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <Button
              variant="tonal"
              icon={<Icon name="download" size={16} />}
              onClick={() => template && downloadText(`template-${entity}.csv`, template.csv)}
            >
              Unduh Template CSV
            </Button>

            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => handleFile(event.target.files?.[0])}
              style={{ display: 'none' }}
            />

            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={!canImport}
              style={{
                padding: '20px',
                borderRadius: 'var(--radius-md, 8px)',
                border: '1px dashed var(--color-outline)',
                backgroundColor: 'var(--color-surface-container)',
                color: 'var(--color-on-surface-variant)',
                cursor: canImport ? 'pointer' : 'not-allowed',
                fontFamily: 'var(--font-family)',
                fontSize: '12px',
                width: '100%',
                opacity: canImport ? 1 : 0.6,
              }}
            >
              <Icon name="upload_file" size={22} />
              <div style={{ marginTop: '6px' }}>
                {fileName ? `Berkas dipilih: ${fileName}` : 'Klik untuk memilih berkas CSV'}
              </div>
              {!canImport && (
                <div style={{ marginTop: '4px' }}>Peran Anda tidak memiliki izin master_data:import.</div>
              )}
            </button>

            <div style={{ display: 'flex', gap: '8px' }}>
              <Button
                variant="tonal"
                disabled={!content || runImport.isPending || !canImport}
                onClick={() => runImport.mutate(true)}
              >
                Validasi
              </Button>
              <Button
                variant="filled"
                disabled={!content || runImport.isPending || !canImport}
                onClick={() => runImport.mutate(false)}
              >
                {runImport.isPending ? 'Memproses…' : 'Import'}
              </Button>
            </div>
          </div>

          {template && (
            <div style={{ marginTop: '14px' }}>
              <div
                style={{
                  fontSize: '11px',
                  fontWeight: 800,
                  color: 'var(--color-on-surface)',
                  marginBottom: '6px',
                }}
              >
                Kolom yang diharapkan
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--color-on-surface-variant)' }}>
                      <th style={{ padding: '4px 6px' }}>Kolom</th>
                      <th style={{ padding: '4px 6px' }}>Wajib</th>
                      <th style={{ padding: '4px 6px' }}>Keterangan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {template.columns.map((column) => (
                      <tr key={column.name} style={{ borderTop: '1px solid var(--color-outline-variant)' }}>
                        <td style={{ padding: '4px 6px', fontWeight: 700 }}>
                          <code>{column.name}</code>
                        </td>
                        <td style={{ padding: '4px 6px' }}>{column.required ? 'Ya' : 'Tidak'}</td>
                        <td style={{ padding: '4px 6px', color: 'var(--color-on-surface-variant)' }}>
                          {column.description}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </SurfaceCard>

        <SurfaceCard padding="md">
          <div style={{ marginBottom: '10px' }}>
            <span style={{ fontSize: '14px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
              Export CSV
            </span>
            <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
              Ekspor mengikuti cakupan akses (scope) pengguna
            </div>
          </div>

          <Button
            variant="filled"
            icon={<Icon name="file_download" size={16} />}
            disabled={exportCsv.isPending}
            onClick={() => exportCsv.mutate()}
          >
            {exportCsv.isPending ? 'Menyiapkan…' : 'Ekspor Data Saat Ini'}
          </Button>

          {error && (
            <div
              role="alert"
              style={{
                marginTop: '12px',
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
          )}

          {result && (
            <div style={{ marginTop: '14px' }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: '8px',
                  marginBottom: '10px',
                }}
              >
                <Stat label="Total baris" value={result.totalRows} />
                <Stat label="Dibuat" value={result.created} tone="success" />
                <Stat label="Diperbarui" value={result.updated} tone="info" />
                <Stat label="Gagal" value={result.failed} tone={result.failed > 0 ? 'error' : undefined} />
              </div>

              {result.rejectedWholeFile && (
                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-sm, 8px)',
                    backgroundColor: 'var(--color-error-container)',
                    color: 'var(--color-on-error-container)',
                    fontSize: '12px',
                    fontWeight: 600,
                    marginBottom: '10px',
                  }}
                >
                  Seluruh berkas ditolak, struktur kolom tidak sesuai. Tidak ada data yang disimpan.
                </div>
              )}

              {result.errors.length > 0 && (
                <div
                  style={{
                    maxHeight: '260px',
                    overflowY: 'auto',
                    border: '1px solid var(--color-outline-variant)',
                    borderRadius: 'var(--radius-sm, 8px)',
                  }}
                >
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                    <thead>
                      <tr style={{ textAlign: 'left', backgroundColor: 'var(--color-surface-container)' }}>
                        <th style={{ padding: '6px 8px' }}>Baris</th>
                        <th style={{ padding: '6px 8px' }}>Kolom</th>
                        <th style={{ padding: '6px 8px' }}>Masalah</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.errors.map((rowError, index) => (
                        <tr key={index} style={{ borderTop: '1px solid var(--color-outline-variant)' }}>
                          <td style={{ padding: '6px 8px', fontWeight: 700 }}>{rowError.row || ', '}</td>
                          <td style={{ padding: '6px 8px' }}>
                            <code>{rowError.column ?? ', '}</code>
                          </td>
                          <td style={{ padding: '6px 8px', color: 'var(--color-error)' }}>
                            {rowError.message}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {result.errors.length === 0 && !result.rejectedWholeFile && (
                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-sm, 8px)',
                    backgroundColor: 'var(--color-success-container)',
                    color: 'var(--color-on-success-container)',
                    fontSize: '12px',
                    fontWeight: 600,
                  }}
                >
                  Semua baris lolos validasi.
                </div>
              )}
            </div>
          )}
        </SurfaceCard>
      </div>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: number; tone?: 'success' | 'error' | 'info' }> = ({
  label,
  value,
  tone,
}) => {
  const color =
    tone === 'success'
      ? 'var(--color-success)'
      : tone === 'error'
        ? 'var(--color-error)'
        : tone === 'info'
          ? 'var(--color-info)'
          : 'var(--color-on-surface)';
  return (
    <div
      style={{
        padding: '8px 10px',
        borderRadius: 'var(--radius-sm, 8px)',
        backgroundColor: 'var(--color-surface-container)',
      }}
    >
      <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--color-on-surface-variant)' }}>{label}</div>
      <div style={{ fontSize: '16px', fontWeight: 800, color }}>{value}</div>
    </div>
  );
};
