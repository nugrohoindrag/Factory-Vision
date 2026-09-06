import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  Machine,
  Operator,
  Product,
  WorkOrder,
  WorkOrderStatus,
  statusLabel,
} from '@factory-vision/domain-types';
import { Icon } from '@factory-vision/ui';
import { SurfaceCard, toneColor, toneContainer, toneOnContainer, type Tone } from '@factory-vision/ui/fv';
import { ThemeToggle } from '../../app/ThemeToggle.js';
import type { ThemeMode } from '../../app/theme.js';

/**
 * The gate between signing in and the board.
 *
 * A terminal used to bind itself to whichever work order happened to come back
 * first from the server, which is a guess: on a line running four orders the
 * operator's counts could land on the wrong one, and nothing on screen would
 * say so. Choosing is now a deliberate act with its own screen, and the choice
 * is what the board is bound to.
 *
 * Selecting does not start production. Starting is still the explicit act it
 * always was, on the board, so nobody starts an order by walking past a
 * tablet.
 */

const fmt = (n: number | undefined | null): string =>
  n == null ? '—' : Math.round(n).toLocaleString('id-ID');

/** Which orders an operator can actually take, most urgent first. */
const PICKABLE: WorkOrderStatus[] = [
  WorkOrderStatus.IN_PRODUCTION,
  WorkOrderStatus.CONFIRMED,
  WorkOrderStatus.SCHEDULED,
  WorkOrderStatus.DRAFT,
];

const STATUS_TONE: Partial<Record<WorkOrderStatus, Tone>> = {
  [WorkOrderStatus.IN_PRODUCTION]: 'success',
  [WorkOrderStatus.CONFIRMED]: 'primary',
  [WorkOrderStatus.SCHEDULED]: 'info',
  [WorkOrderStatus.DRAFT]: 'neutral',
};

export interface WorkOrderPickerProps {
  operator: Operator;
  workOrders: WorkOrder[];
  products: Product[];
  machines: Machine[];
  /** Set once a work order has already been chosen, so the screen can be left. */
  currentWoId?: string | null;
  onConfirm: (workOrderId: string) => void;
  onCancel?: () => void;
  onLogout: () => void;
  themeMode: ThemeMode;
  onToggleTheme: () => void;
  loading?: boolean;
}

export const WorkOrderPicker: React.FC<WorkOrderPickerProps> = ({
  operator,
  workOrders,
  products,
  machines,
  currentWoId,
  onConfirm,
  onCancel,
  onLogout,
  themeMode,
  onToggleTheme,
  loading,
}) => {
  const [picked, setPicked] = useState<string | null>(currentWoId ?? null);

  const candidates = useMemo(() => {
    const rank = (wo: WorkOrder) => {
      const index = PICKABLE.indexOf(wo.status);
      return index === -1 ? PICKABLE.length : index;
    };
    return workOrders
      .filter((wo) => PICKABLE.includes(wo.status))
      .sort((a, b) => rank(a) - rank(b) || a.plannedStart.localeCompare(b.plannedStart));
  }, [workOrders]);

  const pickedWo = candidates.find((wo) => wo.id === picked);

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--color-background)',
        color: 'var(--color-on-background)',
        fontFamily: 'var(--font-family)',
        overflow: 'hidden',
      }}
    >
      {/* header */}
      <header
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          padding: 'var(--space-4) var(--space-5)',
          backgroundColor: 'var(--color-surface)',
          borderBottom: '1px solid var(--color-outline-variant)',
        }}
      >
        {onCancel && (
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={onCancel}
            style={{
              minHeight: '48px',
              padding: '0 var(--space-4)',
              borderRadius: 'var(--radius-md, 12px)',
              border: '1px solid var(--color-outline-variant)',
              backgroundColor: 'var(--color-surface-container-low)',
              color: 'var(--color-on-surface-variant)',
              fontSize: '13px',
              fontWeight: 800,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              flexShrink: 0,
            }}
          >
            <Icon name="arrow_back" size={18} />
            Kembali
          </motion.button>
        )}

        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
            Pilih Work Order
          </div>
          <div style={{ fontSize: '13px', color: 'var(--color-on-surface-variant)', fontWeight: 600 }}>
            Terminal akan mencatat produksi pada work order yang Anda pilih.
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            border: '1px solid var(--color-outline-variant)',
            borderRadius: 'var(--radius-md, 12px)',
            backgroundColor: 'var(--color-surface-container-low)',
            padding: 'var(--space-2) var(--space-3)',
            flexShrink: 0,
          }}
        >
          <Icon name="badge" size={20} style={{ color: toneColor.primary }} />
          <div style={{ lineHeight: 1.2 }}>
            <div
              style={{
                fontSize: '9px',
                fontWeight: 800,
                letterSpacing: '0.06em',
                color: 'var(--color-on-surface-variant)',
              }}
            >
              OPERATOR
            </div>
            <div style={{ fontSize: '13px', fontWeight: 800 }}>{operator.name}</div>
          </div>
        </div>

        <ThemeToggle mode={themeMode} onToggle={onToggleTheme} />

        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={onLogout}
          style={{
            minHeight: '48px',
            padding: '0 var(--space-4)',
            borderRadius: 'var(--radius-md, 12px)',
            border: '1px solid var(--color-outline-variant)',
            backgroundColor: 'var(--color-surface-container-low)',
            color: 'var(--color-on-surface-variant)',
            fontSize: '13px',
            fontWeight: 800,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            flexShrink: 0,
          }}
        >
          <Icon name="logout" size={18} />
          Keluar
        </motion.button>
      </header>

      {/* list */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: 'var(--space-4) var(--space-5)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-3)',
        }}
      >
        {loading && candidates.length === 0 && (
          <Placeholder icon="hourglass_top" text="Memuat daftar work order…" />
        )}

        {!loading && candidates.length === 0 && (
          <Placeholder
            icon="assignment_late"
            text="Tidak ada work order yang siap dikerjakan."
            hint="Hubungi supervisor untuk merilis work order ke lini ini."
          />
        )}

        {candidates.map((wo) => {
          const product = products.find((p) => p.id === wo.productId);
          const machine = machines.find((m) => m.id === wo.machineId);
          const selected = wo.id === picked;
          const done = wo.plannedQuantity > 0 ? Math.min(100, (wo.outputQuantity / wo.plannedQuantity) * 100) : 0;
          const tone = STATUS_TONE[wo.status] || 'neutral';

          return (
            <SurfaceCard
              key={wo.id}
              padding="none"
              interactive
              onClick={() => setPicked(wo.id)}
              style={{
                flexShrink: 0,
                padding: 'var(--space-4) var(--space-5)',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-4)',
                cursor: 'pointer',
                // The selected row is the one fill the design system allows:
                // solid primary, the same one every selected state uses.
                borderColor: selected ? 'var(--color-primary)' : undefined,
                outline: selected ? '2px solid var(--color-primary)' : 'none',
                outlineOffset: '-2px',
              }}
            >
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  flexShrink: 0,
                  borderRadius: 'var(--radius-pill)',
                  border: selected ? 'none' : '2px solid var(--color-outline)',
                  backgroundColor: selected ? 'var(--color-primary)' : 'transparent',
                  color: 'var(--color-on-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {selected && <Icon name="check" size={20} />}
              </div>

              <div style={{ width: '170px', flexShrink: 0, minWidth: 0 }}>
                <div style={{ fontSize: '19px', fontWeight: 800, color: 'var(--color-primary)' }}>
                  {wo.woNumber}
                </div>
                <div
                  style={{
                    fontSize: '12px',
                    fontWeight: 700,
                    color: 'var(--color-on-surface-variant)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {product?.sku || wo.productId}
                </div>
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: '16px',
                    fontWeight: 800,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {product?.name || wo.productId}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginTop: '6px' }}>
                  <div
                    style={{
                      flex: 1,
                      maxWidth: '280px',
                      height: '10px',
                      borderRadius: 'var(--radius-pill)',
                      backgroundColor: 'var(--color-surface-container-highest)',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${done}%`,
                        borderRadius: 'var(--radius-pill)',
                        backgroundColor: toneColor[done >= 100 ? 'success' : 'primary'],
                      }}
                    />
                  </div>
                  <span
                    style={{
                      fontSize: '12px',
                      fontWeight: 800,
                      color: 'var(--color-on-surface-variant)',
                      fontFeatureSettings: '"tnum" 1',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {fmt(wo.outputQuantity)} / {fmt(wo.plannedQuantity)} {wo.unit}
                  </span>
                </div>
              </div>

              <Fact label="Mesin" value={machine?.code || wo.machineId || '—'} width="120px" />
              <Fact label="Line" value={wo.lineId} width="110px" />
              <Fact
                label="Rencana selesai"
                value={new Date(wo.plannedEnd).toLocaleString('id-ID', {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                width="140px"
              />

              <span
                style={{
                  width: '130px',
                  flexShrink: 0,
                  textAlign: 'center',
                  backgroundColor: toneContainer[tone],
                  color: toneOnContainer[tone],
                  borderRadius: 'var(--radius-pill)',
                  padding: '6px 0',
                  fontSize: '11px',
                  fontWeight: 800,
                }}
              >
                {statusLabel(wo.status)}
              </span>
            </SurfaceCard>
          );
        })}
      </div>

      {/* confirm bar */}
      <footer
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-4)',
          padding: 'var(--space-3) var(--space-5)',
          backgroundColor: 'var(--color-surface)',
          borderTop: '1px solid var(--color-outline-variant)',
        }}
      >
        <div style={{ flex: 1, minWidth: 0, fontSize: '14px', fontWeight: 700, color: 'var(--color-on-surface-variant)' }}>
          {pickedWo
            ? `${pickedWo.woNumber} dipilih · ${candidates.length} work order tersedia`
            : `${candidates.length} work order tersedia — pilih satu untuk melanjutkan`}
        </div>
        <motion.button
          whileTap={pickedWo ? { scale: 0.97 } : undefined}
          onClick={() => pickedWo && onConfirm(pickedWo.id)}
          disabled={!pickedWo}
          style={{
            minHeight: '62px',
            padding: '0 var(--space-7, 32px)',
            borderRadius: 'var(--radius-md, 14px)',
            border: 'none',
            backgroundColor: pickedWo ? 'var(--color-primary)' : 'var(--color-surface-container-high)',
            color: pickedWo ? 'var(--color-on-primary)' : 'var(--color-on-surface-variant)',
            fontSize: '17px',
            fontWeight: 800,
            cursor: pickedWo ? 'pointer' : 'not-allowed',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
          }}
        >
          <Icon name="login" size={22} />
          Buka Terminal
        </motion.button>
      </footer>
    </div>
  );
};

const Fact: React.FC<{ label: string; value: string; width: string }> = ({ label, value, width }) => (
  <div style={{ width, flexShrink: 0, minWidth: 0 }}>
    <div
      style={{
        fontSize: '10px',
        fontWeight: 800,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: 'var(--color-on-surface-variant)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {label}
    </div>
    <div
      style={{
        fontSize: '14px',
        fontWeight: 800,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {value}
    </div>
  </div>
);

const Placeholder: React.FC<{ icon: string; text: string; hint?: string }> = ({ icon, text, hint }) => (
  <div
    style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 'var(--space-2)',
      padding: 'var(--space-7, 48px)',
      color: 'var(--color-on-surface-variant)',
    }}
  >
    <Icon name={icon} size={40} />
    <div style={{ fontSize: '16px', fontWeight: 800 }}>{text}</div>
    {hint && <div style={{ fontSize: '13px', fontWeight: 600 }}>{hint}</div>}
  </div>
);

export default WorkOrderPicker;
