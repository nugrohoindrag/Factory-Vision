import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  DowntimeRecord,
  Machine,
  MachineState,
  Operator,
  OperationalAlert,
  ProductionBatch,
  ProductionProcess,
  Product,
  Shift,
  WorkOrder,
  WorkOrderStatus,
  statusLabel,
} from '@factory-vision/domain-types';
import { Icon } from '@factory-vision/ui';
import {
  SurfaceCard,
  toneColor,
  toneContainer,
  toneOnColor,
  toneOnContainer,
  type Tone,
} from '@factory-vision/ui/fv';
import { SyncStatusBar } from './SyncStatusBar.js';
import { ThemeToggle } from '../../app/ThemeToggle.js';
import type { ThemeMode } from '../../app/theme.js';

/**
 * The operator terminal board.
 *
 * Layout only: every action here is a callback the container already owned, so
 * the flow an operator runs — pick a work order, start it, count good and
 * reject, open and close a downtime — is the one that was there before. What
 * changed is that the terminal now answers "is my machine healthy, am I on
 * pace, and what is stopping me" without the operator having to read a number
 * out of a four-cell strip.
 *
 * The board is a single non-scrolling screen at terminal size and degrades to a
 * scrolling column on a smaller tablet, rather than crushing rows that are
 * meant to be legible across a bay.
 */

const fmt = (n: number | undefined | null): string =>
  n == null ? '—' : Math.round(n).toLocaleString('id-ID');

const pad2 = (n: number): string => String(Math.floor(n)).padStart(2, '0');

/** mm:ss, the only shape a downtime timer is read in on the floor. */
export const formatElapsed = (seconds: number): string =>
  `${pad2(seconds / 60)}:${pad2(seconds % 60)}`;

/** Minutes since midnight for an "HH:mm" shift boundary. */
const minutesOfDay = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map((part) => Number.parseInt(part, 10));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
};

/** How long a machine has held its current state, in words an operator uses. */
const sinceLabel = (iso: string | undefined, now: number): string => {
  if (!iso) return '—';
  const started = Date.parse(iso);
  if (Number.isNaN(started)) return '—';
  const minutes = Math.max(0, Math.round((now - started) / 60000));
  if (minutes < 60) return `${minutes} menit`;
  return `${Math.floor(minutes / 60)}j ${pad2(minutes % 60)}m`;
};

/**
 * Machine state → tone and Indonesian label.
 *
 * The tone is the andon signal: a green board means keep going, an amber one
 * means the line is up but not producing, red means someone has to act.
 */
const MACHINE_STATE: Record<MachineState, { label: string; tone: Tone; icon: string }> = {
  [MachineState.RUNNING]: { label: 'BERJALAN', tone: 'success', icon: 'play_arrow' },
  [MachineState.IDLE]: { label: 'IDLE', tone: 'warning', icon: 'pause' },
  [MachineState.DOWNTIME]: { label: 'BERHENTI', tone: 'error', icon: 'stop_circle' },
  [MachineState.SETUP]: { label: 'SETUP', tone: 'warning', icon: 'build' },
  [MachineState.OFFLINE]: { label: 'OFFLINE', tone: 'neutral', icon: 'cloud_off' },
};

const STATE_NOTE: Record<MachineState, string> = {
  [MachineState.RUNNING]: 'Mesin memproduksi sesuai work order aktif.',
  [MachineState.IDLE]: 'Mesin menyala tetapi tidak menghasilkan output.',
  [MachineState.DOWNTIME]: 'Mesin berhenti. Alasan berhenti wajib dicatat.',
  [MachineState.SETUP]: 'Persiapan atau penggantian tooling sedang berlangsung.',
  [MachineState.OFFLINE]: 'Terminal tidak menerima sinyal dari mesin ini.',
};

const ALERT_TONE: Record<OperationalAlert['severity'], Tone> = {
  CRITICAL: 'error',
  WARNING: 'warning',
  INFORMATIONAL: 'info',
};

/* ------------------------------------------------------------------ */
/* Shared panel furniture                                              */
/* ------------------------------------------------------------------ */

const PanelLabel: React.FC<{ children: React.ReactNode; tone?: Tone }> = ({ children, tone }) => (
  <div
    style={{
      fontSize: '11px',
      fontWeight: 800,
      letterSpacing: '0.08em',
      color: tone ? toneColor[tone] : 'var(--color-on-surface-variant)',
      textTransform: 'uppercase',
      flexShrink: 0,
    }}
  >
    {children}
  </div>
);

const Panel: React.FC<{
  label: React.ReactNode;
  trailing?: React.ReactNode;
  labelTone?: Tone;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ label, trailing, labelTone, children, style }) => (
  <SurfaceCard
    padding="none"
    style={{
      padding: 'var(--space-4) var(--space-5)',
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
      minWidth: 0,
      overflow: 'hidden',
      ...style,
    }}
  >
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--space-2)',
        marginBottom: 'var(--space-2)',
      }}
    >
      <PanelLabel tone={labelTone}>{label}</PanelLabel>
      {trailing}
    </div>
    {children}
  </SurfaceCard>
);

/** A solid status pill. Container + on-container, never a wash. */
const TonePill: React.FC<{ tone: Tone; children: React.ReactNode; style?: React.CSSProperties }> = ({
  tone,
  children,
  style,
}) => (
  <span
    style={{
      backgroundColor: toneContainer[tone],
      color: toneOnContainer[tone],
      borderRadius: 'var(--radius-pill)',
      padding: '4px 12px',
      fontSize: '11px',
      fontWeight: 800,
      whiteSpace: 'nowrap',
      ...style,
    }}
  >
    {children}
  </span>
);

/** The small bordered read-outs that fill the status and header rows. */
const MiniStat: React.FC<{
  label: string;
  value: React.ReactNode;
  tone?: Tone;
  dot?: boolean;
  /** Caps a long value so it truncates rather than widening the header row. */
  maxWidth?: string;
  /** Overrides the default 18px, for values that are words rather than figures. */
  valueSize?: string;
}> = ({ label, value, tone, dot, maxWidth, valueSize }) => (
  <div
    style={{
      backgroundColor: 'var(--color-surface-container-low)',
      border: '1px solid var(--color-outline-variant)',
      borderRadius: 'var(--radius-md, 12px)',
      padding: 'var(--space-2) var(--space-3)',
      minWidth: 0,
      maxWidth,
    }}
  >
    <div
      style={{
        fontSize: '10px',
        fontWeight: 800,
        letterSpacing: '0.06em',
        color: 'var(--color-on-surface-variant)',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {label}
    </div>
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        fontSize: valueSize || '18px',
        fontWeight: 800,
        lineHeight: 1.25,
        color: tone ? toneColor[tone] : 'var(--color-on-surface)',
        fontFeatureSettings: '"tnum" 1',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {dot && tone && (
        <span
          style={{
            width: '10px',
            height: '10px',
            flexShrink: 0,
            borderRadius: 'var(--radius-pill)',
            backgroundColor: toneColor[tone],
          }}
        />
      )}
      {value}
    </div>
  </div>
);

/** Key/value line used by the job panel. */
const DetailRow: React.FC<{ label: string; value: React.ReactNode; tone?: Tone }> = ({
  label,
  value,
  tone,
}) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: 'var(--space-3)',
      borderBottom: '1px solid var(--color-outline-variant)',
      paddingBottom: '4px',
    }}
  >
    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-on-surface-variant)' }}>
      {label}
    </span>
    <span
      style={{
        fontSize: '14px',
        fontWeight: 800,
        color: tone ? toneColor[tone] : 'var(--color-on-surface)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {value}
    </span>
  </div>
);

/* ------------------------------------------------------------------ */
/* Board                                                               */
/* ------------------------------------------------------------------ */

export interface LiveBoardRow {
  lineId: string;
  workOrder: WorkOrder;
  achievementPct: number;
  hasActiveDowntime: boolean;
  oee: number;
  availability: number;
  performance: number;
  quality: number;
}

export interface TerminalDashboardProps {
  operator: Operator;
  activeWo?: WorkOrder;
  onChangeWo: () => void;
  machine?: Machine;
  shift?: Shift;
  product?: Product;
  process?: ProductionProcess;
  batch?: ProductionBatch;
  board?: LiveBoardRow;
  downtimes: DowntimeRecord[];
  downtimeReasonName?: string;
  alerts: OperationalAlert[];
  activeDowntimeId: string | null;
  downtimeSeconds: number;
  onQuickGood: (qty: number) => void;
  onOpenReject: () => void;
  onOpenCustomQty: (type: 'GOOD' | 'REJECT') => void;
  onOpenDowntime: () => void;
  onResolveDowntime: () => void;
  onStartWo: () => void;
  onPauseWo: () => void;
  onCompleteWo: () => void;
  onLogout: () => void;
  themeMode: ThemeMode;
  onToggleTheme: () => void;
}

export const TerminalDashboard: React.FC<TerminalDashboardProps> = ({
  operator,
  activeWo,
  onChangeWo,
  machine,
  shift,
  product,
  process,
  batch,
  board,
  downtimes,
  downtimeReasonName,
  alerts,
  activeDowntimeId,
  downtimeSeconds,
  onQuickGood,
  onOpenReject,
  onOpenCustomQty,
  onOpenDowntime,
  onResolveDowntime,
  onStartWo,
  onPauseWo,
  onCompleteWo,
  onLogout,
  themeMode,
  onToggleTheme,
}) => {
  // The clock is the terminal's proof of life: a frozen clock on a wall-mounted
  // screen is the first thing that tells an operator the board is stale.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const clock = new Date(now).toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  // Short form on purpose: the header is a single row, and "Minggu, 6 September
  // 2026" costs more width than the date is worth next to a clock this size.
  const dateStr = new Date(now).toLocaleDateString('id-ID', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  const state = machine?.currentState ?? MachineState.OFFLINE;
  const stateStyle = MACHINE_STATE[state] ?? MACHINE_STATE[MachineState.OFFLINE];

  const running = activeWo?.status === WorkOrderStatus.IN_PRODUCTION;
  const planned = activeWo?.plannedQuantity ?? 0;
  const good = activeWo?.outputQuantity ?? 0;
  const reject = activeWo?.rejectQuantity ?? 0;
  const produced = good + reject;
  const rejectPct = produced > 0 ? (reject / produced) * 100 : 0;
  const attainment = planned > 0 ? Math.min(100, (good / planned) * 100) : 0;
  const remaining = Math.max(0, planned - good);

  // Actual rate over the run so far, against the machine's ideal cycle. Both
  // sides are real: no rate is shown when the work order has not started.
  const runMinutes = activeWo?.actualStart
    ? Math.max(1, (now - Date.parse(activeWo.actualStart)) / 60000)
    : 0;
  const actualPerHour = runMinutes > 0 ? (good / runMinutes) * 60 : null;
  const idealCycle = machine?.idealCycleTimeSeconds;
  const idealPerHour = idealCycle && idealCycle > 0 ? 3600 / idealCycle : null;
  const currentCycle = actualPerHour && actualPerHour > 0 ? 3600 / actualPerHour : null;
  const onPace = actualPerHour != null && idealPerHour != null && actualPerHour >= idealPerHour * 0.95;

  /* Shift timeline, built from the downtime records this line actually has. */
  const timeline = useMemo(() => {
    if (!shift) return null;
    const start = minutesOfDay(shift.startTime);
    const rawEnd = minutesOfDay(shift.endTime);
    const end = shift.crossesMidnight || rawEnd <= start ? rawEnd + 1440 : rawEnd;
    const span = end - start;
    if (span <= 0) return null;

    const current = new Date(now);
    const nowMinutes = current.getHours() * 60 + current.getMinutes();
    const elapsed = Math.max(0, Math.min(span, (nowMinutes < start ? nowMinutes + 1440 : nowMinutes) - start));

    const stops = downtimes
      .map((record) => {
        const from = new Date(record.startTime);
        const fromMinutes = from.getHours() * 60 + from.getMinutes();
        const offset = (fromMinutes < start ? fromMinutes + 1440 : fromMinutes) - start;
        const durationMinutes = record.durationSeconds
          ? record.durationSeconds / 60
          : Math.max(1, (now - from.getTime()) / 60000);
        return {
          id: record.id,
          left: Math.max(0, Math.min(100, (offset / span) * 100)),
          width: Math.max(0.6, Math.min(100, (durationMinutes / span) * 100)),
          planned: record.isPlanned,
          title: `${from.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} · ${
            record.durationSeconds ? `${Math.round(record.durationSeconds / 60)} menit` : 'berlangsung'
          }`,
        };
      })
      .filter((segment) => segment.left < 100);

    const ticks: string[] = [];
    for (let minute = start; minute <= end; minute += 60) {
      ticks.push(`${pad2((minute % 1440) / 60)}:00`);
    }

    const stoppedMinutes = downtimes.reduce(
      (total, record) =>
        total + (record.durationSeconds ? record.durationSeconds / 60 : (now - Date.parse(record.startTime)) / 60000),
      0,
    );

    return { elapsedPct: (elapsed / span) * 100, stops, ticks, stoppedMinutes, runMinutes: elapsed - stoppedMinutes };
  }, [shift, downtimes, now]);

  /* Quick actions. Every tile is an existing handler — nothing new to learn. */
  const quickActions: Array<{
    label: string;
    icon: string;
    tone: Tone;
    onClick: () => void;
    disabled?: boolean;
  }> = [
    {
      label: 'Catat Downtime',
      icon: 'timer',
      tone: 'warning',
      onClick: onOpenDowntime,
      disabled: Boolean(activeDowntimeId) || !activeWo,
    },
    {
      label: 'Selesai Downtime',
      icon: 'task_alt',
      tone: 'success',
      onClick: onResolveDowntime,
      disabled: !activeDowntimeId,
    },
    { label: 'Submit Reject', icon: 'report', tone: 'error', onClick: onOpenReject, disabled: !running },
    {
      label: 'Jumlah Lain',
      icon: 'dialpad',
      tone: 'primary',
      onClick: () => onOpenCustomQty('GOOD'),
      disabled: !running,
    },
    {
      label: 'Mulai Produksi',
      icon: 'play_arrow',
      tone: 'primary',
      onClick: onStartWo,
      disabled: activeWo?.status !== WorkOrderStatus.CONFIRMED,
    },
    { label: 'Jeda Produksi', icon: 'pause', tone: 'warning', onClick: onPauseWo, disabled: !running },
    { label: 'Selesaikan WO', icon: 'done_all', tone: 'success', onClick: onCompleteWo, disabled: !running },
  ];

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/*
        ============ HEADER ============

        Identity, time and controls. Nothing else.

        Which machine, line, process, shift and operator this terminal is bound
        to used to sit here as well as in the status bar along the bottom —
        the same five facts, twice on one screen. They belong to the footer,
        which is where a terminal's binding is conventionally read and where it
        costs no room the board could use.
      */}
      <header
        style={{
          flexShrink: 0,
          backgroundColor: 'var(--color-surface)',
          borderBottom: '1px solid var(--color-outline-variant)',
          display: 'flex',
          flexWrap: 'nowrap',
          alignItems: 'center',
          gap: 'var(--space-3)',
          padding: 'var(--space-2) var(--space-4)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            minWidth: 0,
            flexShrink: 1,
          }}
        >
          <div
            style={{
              width: '40px',
              height: '40px',
              flexShrink: 0,
              borderRadius: 'var(--radius-md, 12px)',
              backgroundColor: 'var(--color-primary)',
              color: 'var(--color-on-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="precision_manufacturing" size={24} />
          </div>
          <div
            style={{
              fontSize: '14px',
              fontWeight: 800,
              lineHeight: 1.15,
              color: 'var(--color-on-surface)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            FACTORY
            <br />
            VISION
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 'var(--space-2)' }} />

        {/* Clock and controls never shrink: they are read, not scanned. */}
        <div style={{ textAlign: 'right', lineHeight: 1.1, flexShrink: 0 }}>
          <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--color-on-surface-variant)' }}>
            {dateStr}
          </div>
          <div
            style={{
              fontSize: '26px',
              fontWeight: 800,
              fontFeatureSettings: '"tnum" 1',
              letterSpacing: '0.01em',
            }}
          >
            {clock}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0 }}>
          <SyncStatusBar />
          <ThemeToggle mode={themeMode} onToggle={onToggleTheme} />
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={onLogout}
            title="Keluar"
            style={{
              minHeight: '40px',
              padding: '0 var(--space-3)',
              borderRadius: 'var(--radius-md, 12px)',
              border: '1px solid var(--color-outline-variant)',
              backgroundColor: 'var(--color-surface-container-low)',
              color: 'var(--color-on-surface-variant)',
              fontSize: '12px',
              fontWeight: 800,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-1)',
              whiteSpace: 'nowrap',
            }}
          >
            <Icon name="logout" size={17} />
            Keluar
          </motion.button>
        </div>
      </header>

      {/* ============ BOARD ============ */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-3)',
          padding: 'var(--space-3) var(--space-4)',
        }}
      >
        {/* ---------- top row ---------- */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(380px, 1.5fr) minmax(320px, 1.15fr) minmax(280px, 1fr)',
            gap: 'var(--space-3)',
            minHeight: '288px',
          }}
        >
          {/* status */}
          <Panel label="Status Mesin">
            <div style={{ flex: 1, display: 'flex', gap: 'var(--space-4)', alignItems: 'center', minHeight: 0 }}>
              <div
                style={{
                  width: '186px',
                  height: '186px',
                  flexShrink: 0,
                  borderRadius: 'var(--radius-xl)',
                  /*
                   * Solid, not the pale container: this block is the andon
                   * light of the whole terminal and has to read across a bay.
                   *
                   * OFFLINE is the exception. Its tone is `neutral`, whose
                   * colour is a mid grey meant for text, and near-black text
                   * on it clears barely 2.7:1. The inverse-surface pair is the
                   * token system's answer for a solid neutral block, and it
                   * holds its contrast in both themes.
                   */
                  backgroundColor:
                    stateStyle.tone === 'neutral'
                      ? 'var(--color-inverse-surface)'
                      : toneColor[stateStyle.tone],
                  color:
                    stateStyle.tone === 'neutral'
                      ? 'var(--color-inverse-on-surface)'
                      : toneOnColor[stateStyle.tone],
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 'var(--space-1)',
                  padding: 'var(--space-3)',
                  textAlign: 'center',
                }}
              >
                <Icon name={stateStyle.icon} size={40} />
                <span style={{ fontSize: '30px', fontWeight: 800, lineHeight: 1.05 }}>
                  {stateStyle.label}
                </span>
                <span style={{ fontSize: '13px', fontWeight: 600 }}>
                  {sinceLabel(machine?.currentStateSince, now)}
                </span>
              </div>

              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                <div style={{ fontSize: '14px', lineHeight: 1.45, color: 'var(--color-on-surface-variant)' }}>
                  {machine ? (
                    <>
                      <span style={{ color: 'var(--color-primary)', fontWeight: 800 }}>{machine.name}</span>.{' '}
                      {STATE_NOTE[state]}
                    </>
                  ) : (
                    'Mesin untuk work order ini belum terdata.'
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
                  <MiniStat
                    label="Cycle sekarang"
                    value={currentCycle ? `${currentCycle.toFixed(1)}s` : '—'}
                    tone={currentCycle && idealCycle && currentCycle > idealCycle * 1.05 ? 'error' : undefined}
                  />
                  <MiniStat label="Cycle ideal" value={idealCycle ? `${idealCycle.toFixed(1)}s` : '—'} />
                  <MiniStat
                    label="Status WO"
                    value={activeWo ? statusLabel(activeWo.status) : '—'}
                    tone={running ? 'success' : 'neutral'}
                    valueSize="14px"
                    dot
                  />
                  <MiniStat
                    label="Downtime aktif"
                    value={activeDowntimeId ? formatElapsed(downtimeSeconds) : 'Tidak ada'}
                    tone={activeDowntimeId ? 'error' : 'success'}
                    valueSize="14px"
                    dot
                  />
                </div>
              </div>
            </div>
          </Panel>

          {/* live counters */}
          <Panel
            label="Hitungan Live"
            trailing={<TonePill tone={running ? 'success' : 'neutral'}>{running ? 'RECORD' : 'IDLE'}</TonePill>}
          >
            <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
              <div style={{ flex: 1.3, minWidth: 0 }}>
                <div style={{ fontSize: '12px', fontWeight: 800, letterSpacing: '0.08em', color: toneColor.success }}>
                  GOOD
                </div>
                <div
                  style={{
                    fontSize: 'clamp(32px, 3.4vw, 48px)',
                    fontWeight: 800,
                    lineHeight: 0.95,
                    color: toneColor.success,
                    fontFeatureSettings: '"tnum" 1',
                    letterSpacing: '-0.03em',
                  }}
                >
                  {fmt(good)}
                </div>
                <div
                  style={{
                    fontSize: '13px',
                    fontWeight: 600,
                    marginTop: '4px',
                    color: 'var(--color-on-surface-variant)',
                  }}
                >
                  Diproduksi {fmt(produced)} {activeWo?.unit || 'pcs'}
                </div>
              </div>

              <div style={{ width: '1px', alignSelf: 'stretch', backgroundColor: 'var(--color-outline-variant)' }} />

              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 800, letterSpacing: '0.06em', color: toneColor.error }}>
                    REJECT
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)' }}>
                    <span
                      style={{
                        fontSize: '28px',
                        fontWeight: 800,
                        lineHeight: 1,
                        color: toneColor.error,
                        fontFeatureSettings: '"tnum" 1',
                      }}
                    >
                      {fmt(reject)}
                    </span>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-on-surface-variant)' }}>
                      {rejectPct.toFixed(1)}%
                    </span>
                  </div>
                </div>
                <div>
                  <div
                    style={{
                      fontSize: '11px',
                      fontWeight: 800,
                      letterSpacing: '0.06em',
                      color: 'var(--color-on-surface-variant)',
                    }}
                  >
                    LAJU / JAM
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)' }}>
                    <span
                      style={{
                        fontSize: '28px',
                        fontWeight: 800,
                        lineHeight: 1,
                        color: actualPerHour == null ? 'var(--color-on-surface-variant)' : toneColor[onPace ? 'success' : 'warning'],
                        fontFeatureSettings: '"tnum" 1',
                      }}
                    >
                      {actualPerHour == null ? '—' : fmt(actualPerHour)}
                    </span>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-on-surface-variant)' }}>
                      / {idealPerHour ? fmt(idealPerHour) : '—'} ideal
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* one-touch entry — the same handlers the old quick pad used */}
            <div
              style={{
                flexShrink: 0,
                borderTop: '1px solid var(--color-outline-variant)',
                paddingTop: 'var(--space-3)',
                marginTop: 'var(--space-2)',
                display: 'flex',
                gap: 'var(--space-2)',
              }}
            >
              {[1, 5, 10].map((qty) => (
                <motion.button
                  key={qty}
                  whileTap={running ? { scale: 0.96 } : undefined}
                  onClick={() => onQuickGood(qty)}
                  disabled={!running}
                  style={{
                    flex: 1,
                    minHeight: '56px',
                    borderRadius: 'var(--radius-md, 12px)',
                    border: 'none',
                    backgroundColor: running ? 'var(--color-primary)' : 'var(--color-surface-container-high)',
                    color: running ? 'var(--color-on-primary)' : 'var(--color-on-surface-variant)',
                    fontSize: '20px',
                    fontWeight: 800,
                    cursor: running ? 'pointer' : 'not-allowed',
                  }}
                >
                  +{qty}
                </motion.button>
              ))}
              <motion.button
                whileTap={running ? { scale: 0.96 } : undefined}
                onClick={onOpenReject}
                disabled={!running}
                style={{
                  flex: 1.2,
                  minHeight: '56px',
                  borderRadius: 'var(--radius-md, 12px)',
                  border: 'none',
                  backgroundColor: running ? toneContainer.error : 'var(--color-surface-container-high)',
                  color: running ? toneOnContainer.error : 'var(--color-on-surface-variant)',
                  fontSize: '15px',
                  fontWeight: 800,
                  cursor: running ? 'pointer' : 'not-allowed',
                }}
              >
                +1 REJECT
              </motion.button>
            </div>
          </Panel>

          {/* current job */}
          <Panel
            label="Work Order Aktif"
            trailing={
              activeWo ? (
                <TonePill tone={running ? 'success' : 'neutral'}>{statusLabel(activeWo.status)}</TonePill>
              ) : undefined
            }
          >
            {activeWo ? (
              <>
                <div style={{ fontSize: '26px', fontWeight: 800, color: 'var(--color-primary)', letterSpacing: '-0.02em' }}>
                  {activeWo.woNumber}
                </div>
                <div
                  style={{
                    fontSize: '16px',
                    fontWeight: 800,
                    marginTop: '2px',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {product?.name || activeWo.productId}
                </div>
                <div
                  style={{
                    flex: 1,
                    minHeight: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    marginTop: 'var(--space-3)',
                    overflowY: 'auto',
                  }}
                >
                  <DetailRow label="SKU" value={product?.sku || '—'} />
                  <DetailRow label="Batch" value={batch?.batchNumber || '—'} />
                  <DetailRow label="Target" value={`${fmt(planned)} ${activeWo.unit}`} />
                  <DetailRow label="Sisa" value={`${fmt(remaining)} ${activeWo.unit}`} tone={remaining > 0 ? 'warning' : 'success'} />
                  <DetailRow
                    label="Rencana selesai"
                    value={new Date(activeWo.plannedEnd).toLocaleTimeString('id-ID', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  />
                </div>

                {/*
                  Switching is a return to the picker, not a chip you can brush
                  past: rebinding the terminal mid-shift decides where the next
                  hour of counts land, so it gets the same deliberate screen
                  the first choice got.
                */}
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={onChangeWo}
                  style={{
                    flexShrink: 0,
                    marginTop: 'var(--space-3)',
                    minHeight: '44px',
                    borderRadius: 'var(--radius-md, 12px)',
                    border: '1px solid var(--color-outline-variant)',
                    backgroundColor: 'var(--color-surface-container-low)',
                    color: 'var(--color-on-surface)',
                    fontSize: '13px',
                    fontWeight: 800,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 'var(--space-2)',
                  }}
                >
                  <Icon name="swap_horiz" size={19} />
                  Ganti Work Order
                </motion.button>
              </>
            ) : (
              <EmptyPanel icon="assignment" text="Belum ada work order dipilih." />
            )}
          </Panel>
        </div>

        {/* ---------- mid row ---------- */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(340px, 1.3fr) minmax(300px, 1fr) minmax(300px, 1fr)',
            gap: 'var(--space-3)',
            minHeight: '250px',
          }}
        >
          {/* progress + OEE */}
          <Panel
            label="Progres & OEE"
            trailing={
              <TonePill tone={attainment >= 95 ? 'success' : attainment >= 80 ? 'warning' : 'error'}>
                {attainment.toFixed(0)}% dari target
              </TonePill>
            }
          >
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <span
                style={{
                  fontSize: '40px',
                  fontWeight: 800,
                  lineHeight: 1,
                  fontFeatureSettings: '"tnum" 1',
                  color: 'var(--color-on-surface)',
                }}
              >
                {attainment.toFixed(0)}%
              </span>
              <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-on-surface-variant)' }}>
                {fmt(good)} / {fmt(planned)} {activeWo?.unit || 'pcs'}
              </span>
            </div>

            <div
              style={{
                height: '16px',
                borderRadius: 'var(--radius-pill)',
                backgroundColor: 'var(--color-surface-container-highest)',
                overflow: 'hidden',
                marginTop: 'var(--space-2)',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${attainment}%`,
                  borderRadius: 'var(--radius-pill)',
                  backgroundColor: toneColor[attainment >= 95 ? 'success' : attainment >= 80 ? 'warning' : 'error'],
                  transition: 'width 0.3s ease',
                }}
              />
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 'var(--space-2)',
                marginTop: 'var(--space-3)',
                flex: 1,
                alignContent: 'end',
              }}
            >
              <div
                style={{
                  borderRadius: 'var(--radius-md, 12px)',
                  backgroundColor: toneContainer.primary,
                  color: toneOnContainer.primary,
                  padding: 'var(--space-2) var(--space-3)',
                }}
              >
                <div style={{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.06em' }}>OEE</div>
                <div style={{ fontSize: '26px', fontWeight: 800, fontFeatureSettings: '"tnum" 1' }}>
                  {board ? `${board.oee.toFixed(0)}%` : '—'}
                </div>
              </div>
              <MiniStat label="Availability" value={board ? `${board.availability.toFixed(0)}%` : '—'} />
              <MiniStat label="Performance" value={board ? `${board.performance.toFixed(0)}%` : '—'} />
              <MiniStat label="Quality" value={board ? `${board.quality.toFixed(0)}%` : '—'} />
            </div>
          </Panel>

          {/* downtime */}
          <Panel
            label="Downtime"
            labelTone={activeDowntimeId ? 'error' : undefined}
            style={
              activeDowntimeId
                ? { backgroundColor: toneContainer.error, color: toneOnContainer.error, borderColor: toneColor.error }
                : undefined
            }
          >
            {activeDowntimeId ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 'var(--space-3)' }}>
                <div
                  style={{
                    fontSize: 'clamp(48px, 6vw, 72px)',
                    fontWeight: 800,
                    lineHeight: 1,
                    fontFeatureSettings: '"tnum" 1',
                    textAlign: 'center',
                  }}
                >
                  {formatElapsed(downtimeSeconds)}
                </div>
                <div style={{ fontSize: '14px', fontWeight: 700, textAlign: 'center' }}>
                  {downtimeReasonName || 'Alasan berhenti tercatat'}
                </div>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={onResolveDowntime}
                  style={{
                    minHeight: '56px',
                    borderRadius: 'var(--radius-md, 12px)',
                    border: 'none',
                    backgroundColor: 'var(--color-error)',
                    color: 'var(--color-on-error)',
                    fontSize: '15px',
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  SELESAIKAN DOWNTIME
                </motion.button>
              </div>
            ) : (
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 'var(--space-2)',
                }}
              >
                <Icon name="check_circle" size={38} style={{ color: toneColor.success }} />
                <div style={{ fontSize: '16px', fontWeight: 800 }}>Tidak ada downtime</div>
                <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
                  Mesin berjalan tanpa berhenti saat ini.
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: 'var(--space-2)',
                    width: '100%',
                    marginTop: 'var(--space-2)',
                  }}
                >
                  <MiniStat
                    label="Run shift"
                    value={timeline ? `${Math.max(0, Math.round(timeline.runMinutes))}m` : '—'}
                  />
                  <MiniStat
                    label="Berhenti"
                    value={timeline ? `${Math.round(timeline.stoppedMinutes)}m` : '—'}
                    tone={timeline && timeline.stoppedMinutes > 0 ? 'warning' : undefined}
                  />
                  <MiniStat label="Kejadian" value={`${downtimes.length}×`} />
                </div>
              </div>
            )}
          </Panel>

          {/* alerts */}
          <Panel
            label="Peringatan"
            trailing={<TonePill tone={alerts.length ? 'warning' : 'neutral'}>{alerts.length} aktif</TonePill>}
          >
            {alerts.length === 0 ? (
              <EmptyPanel icon="notifications_off" text="Tidak ada peringatan aktif." />
            ) : (
              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-2)',
                }}
              >
                {alerts.slice(0, 6).map((alert) => (
                  <div
                    key={alert.id}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 'var(--space-2)',
                      borderRadius: 'var(--radius-md, 12px)',
                      backgroundColor: toneContainer[ALERT_TONE[alert.severity]],
                      color: toneOnContainer[ALERT_TONE[alert.severity]],
                      padding: 'var(--space-2) var(--space-3)',
                    }}
                  >
                    <Icon name="warning" size={18} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: 800 }}>{alert.title}</div>
                      <div style={{ fontSize: '11px', fontWeight: 600 }}>{alert.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>

        {/* ---------- shift timeline ---------- */}
        <Panel
          label="Linimasa Shift"
          trailing={
            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
              <LegendDot tone="success" label="Berjalan" />
              <LegendDot tone="error" label="Berhenti" />
              <LegendDot tone="warning" label="Terencana" />
            </div>
          }
          style={{ flexShrink: 0 }}
        >
          {timeline ? (
            <>
              <div
                style={{
                  position: 'relative',
                  height: '44px',
                  borderRadius: 'var(--radius-md, 10px)',
                  backgroundColor: 'var(--color-surface-container-highest)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: `${timeline.elapsedPct}%`,
                    backgroundColor: toneColor.success,
                  }}
                />
                {timeline.stops.map((stop) => (
                  <div
                    key={stop.id}
                    title={stop.title}
                    style={{
                      position: 'absolute',
                      top: 0,
                      bottom: 0,
                      left: `${stop.left}%`,
                      width: `${stop.width}%`,
                      backgroundColor: toneColor[stop.planned ? 'warning' : 'error'],
                    }}
                  />
                ))}
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginTop: 'var(--space-1)',
                  fontSize: '11px',
                  fontWeight: 700,
                  color: 'var(--color-on-surface-variant)',
                  fontFeatureSettings: '"tnum" 1',
                }}
              >
                {timeline.ticks.map((tick) => (
                  <span key={tick}>{tick}</span>
                ))}
              </div>
            </>
          ) : (
            <EmptyPanel icon="schedule" text="Jadwal shift belum tersedia." />
          )}
        </Panel>

        {/* ---------- quick actions ---------- */}
        <div
          style={{
            flexShrink: 0,
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gap: 'var(--space-2)',
          }}
        >
          {quickActions.map((action) => (
            <motion.button
              key={action.label}
              whileTap={action.disabled ? undefined : { scale: 0.97 }}
              onClick={action.onClick}
              disabled={action.disabled}
              style={{
                minHeight: '78px',
                borderRadius: 'var(--radius-lg, 16px)',
                border: '1px solid var(--color-outline-variant)',
                backgroundColor: action.disabled ? 'var(--color-surface-container)' : toneContainer[action.tone],
                color: action.disabled ? 'var(--color-on-surface-variant)' : toneOnContainer[action.tone],
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 'var(--space-1)',
                padding: 'var(--space-2)',
                fontSize: '12px',
                fontWeight: 800,
                textAlign: 'center',
                cursor: action.disabled ? 'not-allowed' : 'pointer',
                opacity: action.disabled ? 0.55 : 1,
              }}
            >
              <Icon name={action.icon} size={26} />
              <span>{action.label}</span>
            </motion.button>
          ))}
        </div>
      </div>

      {/*
        ============ FOOTER ============

        What this terminal is bound to. It is the only place these five facts
        appear: an operator checks them when they sit down and then stops
        seeing them, which is exactly what a status bar is for and exactly what
        a header is not.
      */}
      <footer
        style={{
          flexShrink: 0,
          height: '38px',
          backgroundColor: 'var(--color-surface)',
          borderTop: '1px solid var(--color-outline-variant)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-5)',
          padding: '0 var(--space-5)',
          fontSize: '11px',
          fontWeight: 700,
          color: 'var(--color-on-surface-variant)',
          overflowX: 'auto',
          whiteSpace: 'nowrap',
        }}
      >
        <FooterFact label="Mesin" value={machine?.code || activeWo?.machineId || '—'} />
        <FooterFact label="Line" value={activeWo?.lineId || '—'} />
        <FooterFact label="Proses" value={process?.name || 'Umum'} />
        <FooterFact
          label="Shift"
          value={shift ? `${shift.name} · ${shift.startTime}–${shift.endTime}` : '—'}
        />
        <FooterFact label="Operator" value={`${operator.name} · ${operator.employeeNumber}`} />
      </footer>
    </div>
  );
};

const FooterFact: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <span>
    {label} <strong style={{ color: 'var(--color-on-surface)' }}>{value}</strong>
  </span>
);

const LegendDot: React.FC<{ tone: Tone; label: string }> = ({ tone, label }) => (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      fontSize: '11px',
      fontWeight: 700,
      color: 'var(--color-on-surface-variant)',
    }}
  >
    <span
      style={{
        width: '10px',
        height: '10px',
        borderRadius: '3px',
        backgroundColor: toneColor[tone],
      }}
    />
    {label}
  </span>
);

const EmptyPanel: React.FC<{ icon: string; text: string }> = ({ icon, text }) => (
  <div
    style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 'var(--space-2)',
      color: 'var(--color-on-surface-variant)',
      fontSize: '13px',
      fontWeight: 600,
    }}
  >
    <Icon name={icon} size={30} />
    <span>{text}</span>
  </div>
);

export default TerminalDashboard;
