import React, { useMemo, useState } from 'react';
import { Button, Icon, Modal } from '@factory-vision/ui';
import { SurfaceCard, toneColor, toneContainer, toneOnContainer } from '@factory-vision/ui/fv';
import { WorkOrder, WorkOrderStatus, Machine, Shift } from '@factory-vision/domain-types';

/**
 * Dynamic Work Order Split (§25.7), the supervisor's side of it.
 *
 * The whole dialog exists to make one rule impossible to get wrong: the parts
 * must add up to exactly what the Work Order planned. The remainder is shown
 * live and the confirm stays disabled until it reaches zero, so a supervisor
 * finds out at the moment of typing rather than from a rejected request.
 *
 * Nothing is decided here that the API does not re-check — the sum, the status,
 * whether production has already been recorded — because a console is a
 * convenience and the invariant belongs to the server.
 */

export interface SplitPart {
  key: string;
  plannedQuantity: string;
  machineId: string;
  shiftId: string;
}

const newPart = (quantity = ''): SplitPart => ({
  key: `part-${Math.random().toString(36).slice(2, 9)}`,
  plannedQuantity: quantity,
  machineId: '',
  shiftId: '',
});

/** A Work Order the API would accept a split for. Mirrors the service's guards. */
export const isSplittable = (wo: WorkOrder): boolean => {
  if (wo.hasChildWorkOrder) return false;
  if (
    wo.status !== WorkOrderStatus.SCHEDULED &&
    wo.status !== WorkOrderStatus.CONFIRMED &&
    wo.status !== WorkOrderStatus.IN_PRODUCTION
  ) {
    return false;
  }
  const recorded =
    (wo.inputQuantity ?? 0) +
    (wo.outputQuantity ?? 0) +
    (wo.rejectQuantity ?? 0) +
    (wo.scrapQuantity ?? 0) +
    (wo.reworkQuantity ?? 0) +
    (wo.transferredQuantity ?? 0);
  return recorded === 0;
};

export interface SplitWorkOrderDialogProps {
  workOrder: WorkOrder;
  machines: Machine[];
  shifts: Shift[];
  submitting?: boolean;
  errorMessage?: string;
  onClose: () => void;
  onSubmit: (parts: Array<{ plannedQuantity: number; machineId?: string; shiftId?: string }>) => void;
}

export const SplitWorkOrderDialog: React.FC<SplitWorkOrderDialogProps> = ({
  workOrder,
  machines,
  shifts,
  submitting,
  errorMessage,
  onClose,
  onSubmit,
}) => {
  const planned = workOrder.plannedQuantity ?? 0;
  // Opens on the split a supervisor asks for most: two equal halves.
  const [parts, setParts] = useState<SplitPart[]>(() => {
    const half = Math.floor(planned / 2);
    return [newPart(String(half)), newPart(String(planned - half))];
  });

  const total = useMemo(
    () => parts.reduce((sum, part) => sum + (Number(part.plannedQuantity) || 0), 0),
    [parts]
  );
  const remainder = planned - total;
  const balanced = remainder === 0 && parts.every((p) => Number(p.plannedQuantity) > 0);

  const update = (key: string, patch: Partial<SplitPart>) =>
    setParts((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  const addPart = () => setParts((prev) => [...prev, newPart(remainder > 0 ? String(remainder) : '')]);

  const removePart = (key: string) =>
    setParts((prev) => (prev.length <= 2 ? prev : prev.filter((p) => p.key !== key)));

  /** Splits the remainder evenly, which is what "bagi rata" means to a planner. */
  const distributeEvenly = () => {
    const each = Math.floor(planned / parts.length);
    setParts((prev) =>
      prev.map((p, i) => ({
        ...p,
        plannedQuantity: String(i === prev.length - 1 ? planned - each * (prev.length - 1) : each),
      }))
    );
  };

  const label: React.CSSProperties = {
    fontSize: '10px',
    fontWeight: 800,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--color-on-surface-variant)',
  };
  const field: React.CSSProperties = {
    width: '100%',
    minHeight: '40px',
    padding: `var(--space-2) var(--space-3)`,
    borderRadius: 'var(--radius-sm, 8px)',
    border: '1px solid var(--color-outline-variant)',
    backgroundColor: 'var(--color-surface-container)',
    color: 'var(--color-on-surface)',
    fontFamily: 'var(--font-family)',
    fontSize: '14px',
    fontWeight: 700,
    boxSizing: 'border-box',
  };

  return (
    <Modal isOpen onClose={onClose} title={`Split Work Order ${workOrder.woNumber}`}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', minWidth: '640px' }}>
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-on-surface-variant)', lineHeight: 1.5 }}>
          Membagi work order ini menjadi beberapa child yang dapat berjalan paralel pada mesin, shift,
          atau operator berbeda. Hasilnya tetap terhubung ke work order ini, dan produksinya dijumlahkan
          kembali ke sini setelah semua child selesai.
        </p>

        {/* The one number that decides whether the split is legal. */}
        <SurfaceCard padding="md" railTone={balanced ? 'success' : 'warning'}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-5)', flexWrap: 'wrap' }}>
            <Figure label="Planned WO" value={planned.toLocaleString('id-ID')} />
            <Figure label="Total dibagi" value={total.toLocaleString('id-ID')} />
            <Figure
              label="Sisa"
              value={remainder.toLocaleString('id-ID')}
              tone={remainder === 0 ? 'success' : 'error'}
            />
            <div style={{ flex: 1 }} />
            <Button variant="tonal" size="sm" onClick={distributeEvenly}>
              Bagi rata
            </Button>
          </div>
          {!balanced && (
            <div style={{ marginTop: 'var(--space-2)', fontSize: '12px', color: toneColor.warning, fontWeight: 700 }}>
              {remainder > 0
                ? `Masih ada ${remainder.toLocaleString('id-ID')} ${workOrder.unit} yang belum dibagi.`
                : `Pembagian melebihi planned sebanyak ${Math.abs(remainder).toLocaleString('id-ID')} ${workOrder.unit}.`}
            </div>
          )}
        </SurfaceCard>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {parts.map((part, index) => (
            <div
              key={part.key}
              style={{
                display: 'grid',
                gridTemplateColumns: '40px 1fr 1.4fr 1.2fr 40px',
                gap: 'var(--space-3)',
                alignItems: 'end',
              }}
            >
              <div
                style={{
                  height: '40px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 'var(--radius-sm, 8px)',
                  backgroundColor: toneContainer.primary,
                  color: toneOnContainer.primary,
                  fontWeight: 800,
                  fontSize: '14px',
                }}
              >
                {String.fromCharCode(65 + index)}
              </div>

              <div>
                <div style={label}>Quantity</div>
                <input
                  type="number"
                  min={1}
                  value={part.plannedQuantity}
                  onChange={(e) => update(part.key, { plannedQuantity: e.target.value })}
                  style={field}
                />
              </div>

              <div>
                <div style={label}>Mesin</div>
                <select
                  value={part.machineId}
                  onChange={(e) => update(part.key, { machineId: e.target.value })}
                  style={field}
                >
                  <option value="">— pilih mesin —</option>
                  {machines.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.code} · {m.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div style={label}>Shift</div>
                <select
                  value={part.shiftId}
                  onChange={(e) => update(part.key, { shiftId: e.target.value })}
                  style={field}
                >
                  <option value="">— ikut WO induk —</option>
                  {shifts.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <Button
                variant="text"
                size="sm"
                disabled={parts.length <= 2}
                onClick={() => removePart(part.key)}
                title={parts.length <= 2 ? 'Split minimal 2 bagian' : 'Hapus bagian ini'}
                style={{ color: parts.length <= 2 ? 'var(--color-outline)' : 'var(--color-error)' }}
              >
                <Icon name="close" size={18} />
              </Button>
            </div>
          ))}
        </div>

        <Button variant="tonal" size="sm" onClick={addPart} style={{ alignSelf: 'flex-start' }}>
          <Icon name="add" size={16} /> Tambah bagian
        </Button>

        <p style={{ margin: 0, fontSize: '12px', color: 'var(--color-on-surface-variant)', lineHeight: 1.5 }}>
          Dua child tidak dapat berjalan bersamaan pada mesin yang sama — satu mesin hanya menjalankan satu
          work order pada satu waktu. Pilih mesin berbeda agar keduanya benar-benar paralel.
        </p>

        {errorMessage && (
          <div
            style={{
              padding: `var(--space-3) var(--space-4)`,
              borderRadius: 'var(--radius-sm, 8px)',
              backgroundColor: toneContainer.error,
              color: toneOnContainer.error,
              fontSize: '13px',
              fontWeight: 700,
            }}
          >
            {errorMessage}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
          <Button variant="text" onClick={onClose}>
            Batal
          </Button>
          <Button
            variant="filled"
            disabled={!balanced || submitting}
            onClick={() =>
              onSubmit(
                parts.map((p) => ({
                  plannedQuantity: Number(p.plannedQuantity),
                  machineId: p.machineId || undefined,
                  shiftId: p.shiftId || undefined,
                }))
              )
            }
          >
            {submitting ? 'Memproses…' : `Split menjadi ${parts.length} child WO`}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

const Figure: React.FC<{ label: string; value: string; tone?: 'success' | 'error' }> = ({
  label,
  value,
  tone,
}) => (
  <div>
    <div
      style={{
        fontSize: '10px',
        fontWeight: 800,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: 'var(--color-on-surface-variant)',
      }}
    >
      {label}
    </div>
    <div
      style={{
        fontSize: '22px',
        fontWeight: 800,
        fontFeatureSettings: '"tnum" 1',
        color: tone ? toneColor[tone] : 'var(--color-on-surface)',
      }}
    >
      {value}
    </div>
  </div>
);
