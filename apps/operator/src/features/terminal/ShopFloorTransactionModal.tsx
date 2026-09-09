import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Icon, M3_TRANSITIONS } from '@factory-vision/ui';

/**
 * The improvement's three shop-floor transactions, in one modal
 * (Improvement PRD §38).
 *
 * Material consumption, quality inspection and WIP transfer are three
 * different records and one interaction: pick something from a short list,
 * type a quantity, confirm. Writing three near-identical hundred-line modals
 * would have made them drift, and a terminal is the one screen where two
 * dialogs that behave slightly differently is a training cost.
 *
 * Everything queues offline. The operator is told so on the button, because a
 * terminal that silently accepts work it has not sent is how a shift's output
 * goes missing.
 */

export type TransactionKind = 'CONSUMPTION' | 'INSPECTION' | 'WIP_TRANSFER';

export interface TransactionOption {
  id: string;
  label: string;
  sublabel?: string;
}

export interface TransactionSubmission {
  kind: TransactionKind;
  optionId: string;
  quantity: number;
  /** Inspection only: how many of the inspected quantity failed. */
  failedQuantity?: number;
  notes?: string;
}

const COPY: Record<
  TransactionKind,
  { title: string; icon: string; optionLabel: string; quantityLabel: string; empty: string }
> = {
  CONSUMPTION: {
    title: 'Pakai Material',
    icon: 'inventory_2',
    optionLabel: 'Material',
    quantityLabel: 'Jumlah dipakai',
    empty: 'Belum ada material pada BOM work order ini.',
  },
  INSPECTION: {
    title: 'Inspeksi Mutu',
    icon: 'fact_check',
    optionLabel: 'Rencana Inspeksi',
    quantityLabel: 'Jumlah diperiksa',
    empty: 'Belum ada Inspection Plan. Inspeksi tetap dapat dicatat tanpa rencana.',
  },
  WIP_TRANSFER: {
    title: 'Kirim ke Proses Berikutnya',
    icon: 'swap_horiz',
    optionLabel: 'WIP',
    quantityLabel: 'Jumlah dikirim',
    empty: 'Tidak ada WIP terbuka pada work order ini.',
  },
};

export const ShopFloorTransactionModal: React.FC<{
  kind: TransactionKind;
  options: TransactionOption[];
  /** Shown under the title, e.g. the work order the record will hang off. */
  context?: string;
  onClose: () => void;
  onSubmit: (submission: TransactionSubmission) => void;
}> = ({ kind, options, context, onClose, onSubmit }) => {
  const copy = COPY[kind];
  const [optionId, setOptionId] = useState(options[0]?.id ?? '');
  const [quantity, setQuantity] = useState('');
  const [failedQuantity, setFailedQuantity] = useState('0');
  const [notes, setNotes] = useState('');

  // An inspection may be recorded without a plan; the other two need a subject.
  const optionRequired = kind !== 'INSPECTION';
  const ready = Number(quantity) > 0 && (!optionRequired || Boolean(optionId));

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'var(--color-scrim)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-4)',
        zIndex: 1000,
        backdropFilter: 'blur(4px)',
      }}
    >
      <motion.div
        initial={{ scale: 0.92, opacity: 0, y: 10 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.92, opacity: 0, y: 10 }}
        transition={M3_TRANSITIONS.enter}
        style={{
          backgroundColor: 'var(--color-surface)',
          borderRadius: 'var(--radius-xl, 18px)',
          border: '1px solid var(--color-outline-variant)',
          width: '100%',
          maxWidth: '460px',
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: 'var(--space-6)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-3)',
          boxShadow: 'var(--elevation-3)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <Icon name={copy.icon} size={22} />
          <div>
            <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
              {copy.title}
            </h2>
            {context ? (
              <p style={{ margin: 0, fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                {context}
              </p>
            ) : null}
          </div>
        </div>

        {/* The subject. A tap target list rather than a dropdown: the terminal
            is used with gloves on. */}
        <div>
          <div
            style={{
              fontSize: '10px',
              fontWeight: 800,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--color-on-surface-variant)',
              marginBottom: 'var(--space-1)',
            }}
          >
            {copy.optionLabel}
          </div>

          {options.length === 0 ? (
            <p style={{ margin: 0, fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
              {copy.empty}
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              {options.map((option) => {
                const selected = option.id === optionId;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setOptionId(selected && !optionRequired ? '' : option.id)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      gap: '2px',
                      minHeight: '44px',
                      padding: `var(--space-2) var(--space-3)`,
                      borderRadius: 'var(--radius-md, 8px)',
                      border: 'none',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontFamily: 'var(--font-family)',
                      backgroundColor: selected ? 'var(--color-primary)' : 'var(--color-surface-container)',
                      color: selected ? 'var(--color-on-primary)' : 'var(--color-on-surface)',
                    }}
                  >
                    <span style={{ fontSize: '13px', fontWeight: 800 }}>{option.label}</span>
                    {option.sublabel ? (
                      <span style={{ fontSize: '11px', opacity: 0.85 }}>{option.sublabel}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <NumberField label={copy.quantityLabel} value={quantity} onChange={setQuantity} autoFocus />

        {kind === 'INSPECTION' ? (
          <NumberField label="Jumlah gagal" value={failedQuantity} onChange={setFailedQuantity} />
        ) : null}

        <div>
          <div
            style={{
              fontSize: '10px',
              fontWeight: 800,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--color-on-surface-variant)',
              marginBottom: 'var(--space-1)',
            }}
          >
            Catatan
          </div>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={{
              width: '100%',
              height: '44px',
              padding: `0 var(--space-3)`,
              borderRadius: 'var(--radius-md, 8px)',
              border: '1px solid var(--color-outline-variant)',
              backgroundColor: 'var(--color-surface-container)',
              color: 'var(--color-on-surface)',
              fontSize: '14px',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <p style={{ margin: 0, fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
          Tercatat di antrean terminal dan dikirim otomatis saat koneksi kembali.
        </p>

        <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-1)' }}>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onClose}
            style={{
              flex: 1,
              minHeight: '48px',
              borderRadius: 'var(--radius-md, 8px)',
              backgroundColor: 'var(--color-surface-container)',
              color: 'var(--color-on-surface)',
              fontWeight: 700,
              fontSize: '14px',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Batal
          </motion.button>
          <motion.button
            whileHover={{ scale: ready ? 1.02 : 1 }}
            whileTap={{ scale: ready ? 0.98 : 1 }}
            disabled={!ready}
            onClick={() =>
              onSubmit({
                kind,
                optionId,
                quantity: Number(quantity),
                failedQuantity: kind === 'INSPECTION' ? Number(failedQuantity || 0) : undefined,
                notes: notes || undefined,
              })
            }
            style={{
              flex: 1,
              minHeight: '48px',
              borderRadius: 'var(--radius-md, 8px)',
              backgroundColor: ready ? 'var(--color-primary)' : 'var(--color-surface-container-high)',
              color: ready ? 'var(--color-on-primary)' : 'var(--color-on-surface-variant)',
              fontWeight: 800,
              fontSize: '14px',
              border: 'none',
              cursor: ready ? 'pointer' : 'not-allowed',
            }}
          >
            Simpan
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
};

/** A numeric field sized for a gloved thumb. */
const NumberField: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}> = ({ label, value, onChange, autoFocus }) => (
  <div>
    <div
      style={{
        fontSize: '10px',
        fontWeight: 800,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: 'var(--color-on-surface-variant)',
        marginBottom: 'var(--space-1)',
      }}
    >
      {label}
    </div>
    <input
      type="number"
      inputMode="decimal"
      autoFocus={autoFocus}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: '100%',
        height: '52px',
        padding: `0 var(--space-4)`,
        borderRadius: 'var(--radius-md, 8px)',
        border: '2px solid var(--color-primary)',
        backgroundColor: 'var(--color-surface-container)',
        color: 'var(--color-on-surface)',
        fontSize: '20px',
        fontWeight: 800,
        outline: 'none',
        boxSizing: 'border-box',
      }}
    />
  </div>
);
