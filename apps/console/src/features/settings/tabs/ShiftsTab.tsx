import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FactoryVisionApiClient, ApiRequestError } from '@factory-vision/api-client';
import type { Shift } from '@factory-vision/domain-types';
import { Button, Icon, Modal } from '@factory-vision/ui';
import { SurfaceCard } from '@factory-vision/ui/fv';
import { useSession } from '../../../app/SessionContext.js';

const api = new FactoryVisionApiClient({ baseUrl: '' });

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: `var(--space-3) var(--space-3)`,
  borderRadius: 'var(--radius-md, 8px)',
  backgroundColor: 'var(--color-surface-container-high)',
  border: '1px solid var(--color-outline-variant)',
  color: 'var(--color-on-surface)',
  fontSize: '13px',
  boxSizing: 'border-box',
};

/** Net production minutes a shift contributes, after breaks. */
function netMinutes(startTime: string, endTime: string, breakMinutes: number): number {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  let minutes = eh * 60 + em - (sh * 60 + sm);
  if (minutes <= 0) minutes += 24 * 60;
  return Math.max(0, minutes - breakMinutes);
}

interface FormState {
  id?: string;
  plantId: string;
  name: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  active: boolean;
}

const EMPTY: FormState = {
  plantId: '',
  name: '',
  startTime: '06:00',
  endTime: '14:00',
  breakMinutes: 60,
  active: true,
};

/**
 * US-021, Configure Shift.
 *
 * The `shift_date` rule is the reason this screen exists rather
 * than a static config file: a shift crossing midnight files its records under
 * the day it *started* and the form shows that consequence as the times are
 * typed, so nobody discovers it after a month of misfiled night-shift output.
 */
export const ShiftsTab: React.FC<{ onToast: (message: string) => void }> = ({ onToast }) => {
  const queryClient = useQueryClient();
  const { can } = useSession();
  const editable = can('shift:manage');

  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: shifts = [], isLoading } = useQuery({ queryKey: ['shifts'], queryFn: () => api.shifts.list() });
  const { data: plants = [] } = useQuery({ queryKey: ['plants'], queryFn: () => api.master.getPlants() });

  const save = useMutation({
    mutationFn: (payload: FormState) =>
      payload.id
        ? api.shifts.update(payload.id, {
            name: payload.name,
            startTime: payload.startTime,
            endTime: payload.endTime,
            breakMinutes: payload.breakMinutes,
            active: payload.active,
          })
        : api.shifts.create({
            plantId: payload.plantId,
            name: payload.name,
            startTime: payload.startTime,
            endTime: payload.endTime,
            breakMinutes: payload.breakMinutes,
            active: payload.active,
          }),
    onSuccess: () => {
      onToast('Konfigurasi shift tersimpan.');
      setForm(null);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : 'Gagal menyimpan shift.'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.shifts.delete(id),
    onSuccess: () => {
      onToast('Shift dihapus.');
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : 'Gagal menghapus shift.'),
  });

  const openCreate = () => {
    setError(null);
    setForm({ ...EMPTY, plantId: plants[0]?.id ?? '' });
  };

  const openEdit = (shift: Shift) => {
    setError(null);
    setForm({
      id: shift.id,
      plantId: shift.plantId,
      name: shift.name,
      startTime: shift.startTime,
      endTime: shift.endTime,
      breakMinutes: shift.breakMinutes,
      active: shift.active,
    });
  };

  const crosses = form ? form.endTime <= form.startTime : false;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {editable && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="filled" icon={<Icon name="add" size={16} />} onClick={openCreate}>
            Tambah Shift
          </Button>
        </div>
      )}

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

      {isLoading ? (
        <Empty label="Memuat konfigurasi shift…" />
      ) : shifts.length === 0 ? (
        <Empty label="Belum ada shift yang dikonfigurasi." />
      ) : (
        <div
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 'var(--space-3)' }}
        >
          {shifts.map((shift) => (
            <SurfaceCard key={shift.id} padding="md">
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: 'var(--space-3)',
                }}
              >
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
                    {shift.name}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)', marginTop: 'var(--space-1)' }}>
                    {shift.startTime}, {shift.endTime} · istirahat {shift.breakMinutes} menit
                  </div>
                </div>
                <span
                  style={{
                    padding: `var(--space-1) var(--space-3)`,
                    borderRadius: 'var(--radius-full, 999px)',
                    fontSize: '11px',
                    fontWeight: 700,
                    backgroundColor: shift.active
                      ? 'var(--color-success-container)'
                      : 'var(--color-surface-container-highest)',
                    color: shift.active
                      ? 'var(--color-on-success-container)'
                      : 'var(--color-on-surface-variant)',
                  }}
                >
                  {shift.active ? 'Aktif' : 'Nonaktif'}
                </span>
              </div>

              <div
                style={{
                  marginTop: 'var(--space-3)',
                  padding: `var(--space-2) var(--space-3)`,
                  borderRadius: 'var(--radius-sm, 8px)',
                  backgroundColor: 'var(--color-surface-container)',
                  fontSize: '11px',
                  color: 'var(--color-on-surface-variant)',
                  lineHeight: 1.6,
                }}
              >
                Waktu produksi bersih:{' '}
                <strong style={{ color: 'var(--color-on-surface)' }}>
                  {netMinutes(shift.startTime, shift.endTime, shift.breakMinutes)} menit
                </strong>
                <br />
                {shift.crossesMidnight
                  ? 'Melewati tengah malam, transaksi memakai shift_date tanggal mulai shift.'
                  : 'Tidak melewati tengah malam.'}
              </div>

              {editable && (
                <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
                  <Button variant="tonal" onClick={() => openEdit(shift)}>
                    Ubah
                  </Button>
                  <Button variant="text" onClick={() => remove.mutate(shift.id)}>
                    Hapus
                  </Button>
                </div>
              )}
            </SurfaceCard>
          ))}
        </div>
      )}

      <Modal
        isOpen={form !== null}
        onClose={() => setForm(null)}
        title={form?.id ? 'Ubah Shift' : 'Tambah Shift'}
      >
        {form && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <Field label="Nama Shift">
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Shift 1 (Pagi)"
                style={inputStyle}
              />
            </Field>

            {!form.id && (
              <Field label="Plant">
                <select
                  value={form.plantId}
                  onChange={(e) => setForm({ ...form, plantId: e.target.value })}
                  style={inputStyle}
                >
                  {plants.map((plant) => (
                    <option key={plant.id} value={plant.id}>
                      {plant.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-3)' }}>
              <Field label="Jam Mulai">
                <input
                  type="time"
                  value={form.startTime}
                  onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                  style={inputStyle}
                />
              </Field>
              <Field label="Jam Selesai">
                <input
                  type="time"
                  value={form.endTime}
                  onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                  style={inputStyle}
                />
              </Field>
              <Field label="Istirahat (menit)">
                <input
                  type="number"
                  min={0}
                  value={form.breakMinutes}
                  onChange={(e) => setForm({ ...form, breakMinutes: Number(e.target.value) })}
                  style={inputStyle}
                />
              </Field>
            </div>

            <div
              style={{
                padding: `var(--space-3) var(--space-3)`,
                borderRadius: 'var(--radius-sm, 8px)',
                backgroundColor: 'var(--color-surface-container-high)',
                fontSize: '12px',
                color: 'var(--color-on-surface-variant)',
                lineHeight: 1.6,
              }}
            >
              Planned production time:{' '}
              <strong>{netMinutes(form.startTime, form.endTime, form.breakMinutes)} menit</strong>
              {crosses && (
                <>
                  <br />
                  <Icon name="info" size={14} /> Shift ini melewati tengah malam. Seluruh transaksi akan
                  menggunakan <strong>shift_date tanggal shift dimulai</strong>
                </>
              )}
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: '12px' }}>
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
              />
              Shift aktif dan dapat dipilih pada transaksi shop floor
            </label>

            <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
              <Button variant="text" onClick={() => setForm(null)}>
                Batal
              </Button>
              <Button
                variant="filled"
                disabled={save.isPending || form.name.trim().length < 2}
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
  <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
    <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-on-surface-variant)' }}>{label}</span>
    {children}
  </label>
);

const Empty: React.FC<{ label: string }> = ({ label }) => (
  <div
    style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--color-on-surface-variant)', fontSize: '12px' }}
  >
    {label}
  </div>
);
