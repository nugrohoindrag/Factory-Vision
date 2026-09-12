import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';

/**
 * Progress for a background job the screen is watching (a worker job: forecast
 * generation, capacity recalculation).
 *
 * The worker reports a status, not a percentage — PENDING while it waits in
 * the queue, RUNNING while it computes — so this shows the truth: which phase
 * the job is in, how long it has been at it, and an indeterminate sweep while
 * it runs. A bar that crept to 90% and waited would be a guess dressed as a
 * measurement.
 *
 * Animates with `motion` rather than a CSS keyframe: the mirror's spinner
 * names a `spin` keyframe no stylesheet defines, and a spinner that does not
 * spin reads as a hang.
 */
export type JobProgressStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';

export interface JobProgressProps {
  status: JobProgressStatus;
  /** What is being computed, e.g. "Menghitung forecast". */
  label: string;
  /** ISO time the job was enqueued; drives the elapsed counter. */
  startedAt?: string;
  /** Extra line under the label: the error on FAILED, a summary on SUCCEEDED. */
  detail?: string;
}

const PHASE: Record<JobProgressStatus, { text: string; tone: string; onTone: string }> = {
  PENDING: { text: 'Menunggu giliran di worker', tone: 'var(--color-primary)', onTone: 'var(--color-on-primary)' },
  RUNNING: { text: 'Sedang dihitung', tone: 'var(--color-primary)', onTone: 'var(--color-on-primary)' },
  SUCCEEDED: { text: 'Selesai', tone: 'var(--color-success)', onTone: 'var(--color-on-success)' },
  FAILED: { text: 'Gagal', tone: 'var(--color-error)', onTone: 'var(--color-on-error)' },
};

const formatElapsed = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s} dtk` : `${Math.floor(s / 60)} mnt ${s % 60} dtk`;
};

const Spinner: React.FC<{ color: string }> = ({ color }) => (
  <motion.svg
    width={22}
    height={22}
    viewBox="0 0 24 24"
    aria-hidden="true"
    animate={{ rotate: 360 }}
    transition={{ repeat: Infinity, duration: 0.9, ease: 'linear' }}
    style={{ flexShrink: 0 }}
  >
    <circle cx="12" cy="12" r="9" stroke="var(--color-border)" strokeWidth="3" fill="none" />
    <path d="M 12 3 A 9 9 0 0 1 21 12" stroke={color} strokeWidth="3" strokeLinecap="round" fill="none" />
  </motion.svg>
);

const Check: React.FC<{ color: string; icon: 'check' | 'close' }> = ({ color, icon }) => (
  <motion.svg
    width={22}
    height={22}
    viewBox="0 0 24 24"
    aria-hidden="true"
    initial={{ scale: 0.6, opacity: 0 }}
    animate={{ scale: 1, opacity: 1 }}
    transition={{ type: 'spring', stiffness: 400, damping: 20 }}
    style={{ flexShrink: 0 }}
  >
    <circle cx="12" cy="12" r="11" fill={color} />
    {icon === 'check' ? (
      <path d="M7 12.5l3 3 7-7" stroke="var(--color-on-primary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    ) : (
      <path d="M8 8l8 8M16 8l-8 8" stroke="var(--color-on-primary)" strokeWidth="2.5" strokeLinecap="round" fill="none" />
    )}
  </motion.svg>
);

export const JobProgress: React.FC<JobProgressProps> = ({ status, label, startedAt, detail }) => {
  const phase = PHASE[status];
  const live = status === 'PENDING' || status === 'RUNNING';

  // Elapsed time ticks only while the job is live; a finished job keeps the
  // figure it ended on.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [live]);
  const elapsed = startedAt ? formatElapsed(now - new Date(startedAt).getTime()) : undefined;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'grid',
        gap: 'var(--space-2)',
        padding: 'var(--space-3) var(--space-4)',
        borderRadius: 'var(--radius-md)',
        backgroundColor: 'var(--color-surface-container-low)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        {live ? <Spinner color={phase.tone} /> : <Check color={phase.tone} icon={status === 'SUCCEEDED' ? 'check' : 'close'} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-on-surface)' }}>{label}</div>
          <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
            {phase.text}
            {elapsed && ` · ${elapsed}`}
          </div>
        </div>
        <span
          style={{
            fontSize: '10.5px',
            fontWeight: 800,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            padding: `2px var(--space-2)`,
            borderRadius: 'var(--radius-pill)',
            backgroundColor: phase.tone,
            color: phase.onTone,
          }}
        >
          {status}
        </span>
      </div>

      {/* Two phases the worker actually reports, drawn as two segments: the
          first fills when the job leaves the queue, the second sweeps while
          it runs and fills when it finishes. */}
      <div
        aria-hidden="true"
        style={{
          position: 'relative',
          height: '6px',
          borderRadius: 'var(--radius-pill)',
          backgroundColor: 'var(--color-surface-container-highest)',
          overflow: 'hidden',
        }}
      >
        <motion.div
          initial={false}
          animate={{
            width: status === 'PENDING' ? '18%' : '100%',
            opacity: status === 'PENDING' ? [0.5, 1, 0.5] : status === 'RUNNING' ? 0.3 : 1,
          }}
          transition={{
            width: { duration: 0.5, ease: 'easeOut' },
            opacity: status === 'PENDING' ? { repeat: Infinity, duration: 1.6, ease: 'easeInOut' } : { duration: 0.3 },
          }}
          style={{ position: 'absolute', inset: '0 auto 0 0', borderRadius: 'var(--radius-pill)', backgroundColor: phase.tone }}
        />
        {status === 'RUNNING' && (
          <motion.div
            animate={{ left: ['-30%', '100%'] }}
            transition={{ repeat: Infinity, duration: 1.4, ease: 'easeInOut' }}
            style={{ position: 'absolute', top: 0, bottom: 0, width: '30%', borderRadius: 'var(--radius-pill)', backgroundColor: phase.tone }}
          />
        )}
      </div>

      {detail && (
        <div style={{ fontSize: '12px', color: status === 'FAILED' ? 'var(--color-error)' : 'var(--color-on-surface-variant)' }}>{detail}</div>
      )}
    </div>
  );
};
