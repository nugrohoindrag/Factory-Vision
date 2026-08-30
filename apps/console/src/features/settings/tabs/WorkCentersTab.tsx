import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FactoryVisionApiClient, ApiRequestError } from '@factory-vision/api-client';
import type { WorkCenter } from '@factory-vision/domain-types';
import { Button, Icon, Modal } from '@factory-vision/ui';
import { SurfaceCard } from '@factory-vision/ui/fv';
import { useSession } from '../../../app/SessionContext.js';

const api = new FactoryVisionApiClient({ baseUrl: '' });

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 'var(--radius-md, 8px)',
  backgroundColor: 'var(--color-surface-container-high)',
  border: '1px solid var(--color-outline-variant)',
  color: 'var(--color-on-surface)',
  fontSize: '13px',
  boxSizing: 'border-box',
};

interface FormState {
  id?: string;
  productionLineId: string;
  code: string;
  name: string;
  sequence: number;
}

/**
 * US-007, Work centre master data.
 *
 * The work centre is what binds a machine to a line, so OEE, downtime and
 * scope filtering all resolve through it. Showing each centre with the
 * machines it holds makes an orphaned machine, one whose OEE would never roll
 * up to a line, visible instead of silently missing from the dashboard.
 */
export const WorkCentersTab: React.FC<{ onToast: (message: string) => void }> = ({ onToast }) => {
  const queryClient = useQueryClient();
  const { can } = useSession();
  const editable = can('master_data:manage');

  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: workCenters = [], isLoading } = useQuery({
    queryKey: ['work-centers'],
    queryFn: () => api.workCenters.list(),
  });
  const { data: lines = [] } = useQuery({ queryKey: ['lines'], queryFn: () => api.master.getLines() });
  const { data: machines = [] } = useQuery({ queryKey: ['machines'], queryFn: () => api.master.getMachines() });

  const save = useMutation({
    mutationFn: (payload: FormState) =>
      payload.id
        ? api.workCenters.update(payload.id, {
            code: payload.code,
            name: payload.name,
            sequence: payload.sequence,
            productionLineId: payload.productionLineId,
          })
        : api.workCenters.create({
            productionLineId: payload.productionLineId,
            code: payload.code,
            name: payload.name,
            sequence: payload.sequence,
          }),
    onSuccess: () => {
      onToast('Work center tersimpan.');
      setForm(null);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['work-centers'] });
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : 'Gagal menyimpan work center.'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.workCenters.delete(id),
    onSuccess: () => {
      onToast('Work center dihapus.');
      queryClient.invalidateQueries({ queryKey: ['work-centers'] });
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : 'Gagal menghapus work center.'),
  });

  const byLine = lines.map((line) => ({
    line,
    centers: workCenters
      .filter((wc) => wc.productionLineId === line.id)
      .sort((a, b) => a.sequence - b.sequence),
  }));

  const orphaned = machines.filter((m) => !workCenters.some((wc) => wc.id === m.workCenterId));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {editable && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            variant="filled"
            icon={<Icon name="add" size={16} />}
            onClick={() => setForm({ productionLineId: lines[0]?.id ?? '', code: '', name: '', sequence: 1 })}
          >
            Tambah Work Center
          </Button>
        </div>
      )}

      {error && (
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
      )}

      {orphaned.length > 0 && (
        <SurfaceCard padding="md" style={{ borderLeft: '3px solid var(--color-warning)' }}>
          <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
            {orphaned.length} mesin tanpa work center valid
          </div>
          <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
            {orphaned.map((m) => m.code).join(', ')}, mesin ini tidak akan muncul pada analitik per line karena
            tidak terhubung ke production line manapun.
          </p>
        </SurfaceCard>
      )}

      {isLoading ? (
        <Empty label="Memuat work center…" />
      ) : (
        byLine.map(({ line, centers }) => (
          <SurfaceCard key={line.id} padding="md">
            <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
              {line.name}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)', marginBottom: '10px' }}>
              {line.code} · {centers.length} work center
            </div>

            {centers.length === 0 ? (
              <Empty label="Belum ada work center pada line ini." />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {centers.map((center) => {
                  const centerMachines = machines.filter((m) => m.workCenterId === center.id);
                  return (
                    <div
                      key={center.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        gap: '10px',
                        padding: '10px 12px',
                        borderRadius: 'var(--radius-sm, 8px)',
                        border: '1px solid var(--color-outline-variant)',
                        backgroundColor: 'var(--color-surface-container)',
                      }}
                    >
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-on-surface)' }}>
                          #{center.sequence} · {center.name}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                          {center.code} ·{' '}
                          {centerMachines.length > 0
                            ? centerMachines.map((m) => m.code).join(', ')
                            : 'belum ada mesin'}
                        </div>
                      </div>

                      {editable && (
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <Button
                            variant="text"
                            onClick={() =>
                              setForm({
                                id: center.id,
                                productionLineId: center.productionLineId,
                                code: center.code,
                                name: center.name,
                                sequence: center.sequence,
                              })
                            }
                          >
                            Ubah
                          </Button>
                          <Button variant="text" onClick={() => remove.mutate(center.id)}>
                            Hapus
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </SurfaceCard>
        ))
      )}

      <Modal
        isOpen={form !== null}
        onClose={() => setForm(null)}
        title={form?.id ? 'Ubah Work Center' : 'Tambah Work Center'}
      >
        {form && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <Field label="Production Line">
              <select
                value={form.productionLineId}
                onChange={(e) => setForm({ ...form, productionLineId: e.target.value })}
                style={inputStyle}
              >
                {lines.map((line) => (
                  <option key={line.id} value={line.id}>
                    {line.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Kode">
              <input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="WC-CUT"
                style={inputStyle}
              />
            </Field>

            <Field label="Nama">
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Component Cutting Area"
                style={inputStyle}
              />
            </Field>

            <Field label="Urutan dalam line">
              <input
                type="number"
                min={1}
                value={form.sequence}
                onChange={(e) => setForm({ ...form, sequence: Number(e.target.value) })}
                style={inputStyle}
              />
            </Field>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <Button variant="text" onClick={() => setForm(null)}>
                Batal
              </Button>
              <Button
                variant="filled"
                disabled={save.isPending || form.code.trim().length < 2 || form.name.trim().length < 2}
                onClick={() => save.mutate(form)}
              >
                {save.isPending ? 'Menyimpan…' : 'Simpan'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
    <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-on-surface-variant)' }}>{label}</span>
    {children}
  </label>
);

const Empty: React.FC<{ label: string }> = ({ label }) => (
  <div
    style={{ padding: '20px', textAlign: 'center', color: 'var(--color-on-surface-variant)', fontSize: '12px' }}
  >
    {label}
  </div>
);
