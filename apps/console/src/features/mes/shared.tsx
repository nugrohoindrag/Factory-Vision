import React from 'react';
import { Icon } from '@factory-vision/ui';
import { SurfaceCard, toneContainer, toneOnContainer, type Tone } from '@factory-vision/ui/fv';

/**
 * The vocabulary the MES Improvement screens share (Improvement PRD §3–§10).
 *
 * Nine screens arrived at once, all of them showing a status as a pill, a
 * headline figure as a tile, and an empty result as a sentence. Written once
 * here so the ninth screen looks like the first, and so the tone attached to
 * READY, SHORTAGE or OVERDUE is decided in one place rather than re-argued in
 * every table cell.
 */

/**
 * Status → tone, across every state vocabulary the improvement introduced
 * (§15–§19).
 *
 * One map rather than one per module: a supervisor reading the board sees a
 * material status beside a labour status beside a maintenance status, and
 * "green means fine" has to mean the same thing in all three. Unknown values
 * fall through to neutral, which is the honest colour for "no opinion".
 */
const STATUS_TONE: Record<string, Tone> = {
  // Material readiness and consumption (§3)
  READY: 'success',
  PARTIAL: 'warning',
  SHORTAGE: 'error',
  NOT_CHECKED: 'neutral',
  NORMAL: 'success',
  OVER_CONSUMPTION: 'error',
  UNDER_CONSUMPTION: 'warning',

  // Material state (§15)
  AVAILABLE: 'success',
  RESERVED: 'info',
  ALLOCATED: 'info',
  ISSUED: 'info',
  IN_PROCESS: 'info',
  CONSUMED: 'neutral',
  RETURNED: 'neutral',
  QUARANTINED: 'warning',
  BLOCKED: 'error',

  // Quality (§16)
  PENDING_INSPECTION: 'warning',
  PASS: 'success',
  FAIL: 'error',
  HOLD: 'error',
  REWORK: 'warning',
  SCRAP: 'error',
  RELEASED: 'success',
  RELEASE: 'success',
  RETURN: 'neutral',
  DISPOSITIONED: 'info',
  OPEN: 'warning',
  INVESTIGATION: 'info',
  ACTION: 'info',
  VERIFICATION: 'info',
  CLOSED: 'success',
  VERIFIED: 'success',

  // Maintenance (§17)
  PLANNED: 'info',
  UPCOMING: 'info',
  DUE: 'warning',
  OVERDUE: 'error',
  REQUESTED: 'warning',
  ACCEPTED: 'info',
  IN_PROGRESS: 'info',
  WAITING_PART: 'warning',
  TESTING: 'info',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
  SKIPPED: 'neutral',
  REJECTED: 'error',
  CONVERTED: 'success',
  PREVENTIVE: 'info',
  CORRECTIVE: 'warning',
  EMERGENCY: 'error',

  // Workforce (§19)
  ASSIGNED: 'info',
  WORKING: 'success',
  BREAK: 'warning',
  ABSENT: 'error',
  LEAVE: 'neutral',
  SICK: 'error',
  OFFLINE: 'neutral',
  ACTIVE: 'success',
  EXPIRED: 'error',
  SUSPENDED: 'warning',
  SUFFICIENT: 'success',
  OVERSTAFFED: 'info',

  // WIP and handoff (§18)
  CREATED: 'info',
  AT_PROCESS: 'info',
  WAITING_TRANSFER: 'warning',
  IN_TRANSIT: 'info',
  RECEIVED: 'success',
  ON_HOLD: 'error',
  SCRAPPED: 'error',
  FULL: 'success',
  AGING: 'warning',
  CRITICAL: 'error',

  // Board (§9.4)
  SCHEDULED: 'neutral',
  CONFIRMED: 'info',
  RUNNING: 'success',
  DELAYED: 'error',
  AT_RISK: 'warning',
  MAINTENANCE: 'warning',
  DOWNTIME: 'error',

  // Severity and priority
  LOW: 'neutral',
  MEDIUM: 'info',
  HIGH: 'warning',
  DRAFT: 'neutral',
  INACTIVE: 'neutral',
};

export function statusTone(status?: string): Tone {
  return STATUS_TONE[(status ?? '').toUpperCase()] ?? 'neutral';
}

/**
 * A solid status pill.
 *
 * `toneContainer` + `toneOnContainer` as the guideline's §2.3 requires — never
 * a wash, and never a colour named at the call site.
 */
export const StatusPill: React.FC<{ status?: string; label?: string; tone?: Tone }> = ({
  status,
  label,
  tone,
}) => {
  const resolved = tone ?? statusTone(status);
  return (
    <span
      style={{
        display: 'inline-block',
        padding: `var(--space-1) var(--space-2)`,
        borderRadius: 'var(--radius-pill)',
        fontSize: '11px',
        fontWeight: 800,
        whiteSpace: 'nowrap',
        backgroundColor: toneContainer[resolved],
        color: toneOnContainer[resolved],
      }}
    >
      {label ?? status ?? '—'}
    </span>
  );
};

/** A page title and one line saying what the screen answers. */
export const PageHeading: React.FC<{ title: string; subtitle: string; actions?: React.ReactNode }> = ({
  title,
  subtitle,
  actions,
}) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 'var(--space-4)',
      flexWrap: 'wrap',
    }}
  >
    <div>
      <h1
        style={{
          fontSize: '22px',
          fontWeight: 800,
          margin: 0,
          color: 'var(--color-on-surface)',
          letterSpacing: '-0.02em',
        }}
      >
        {title}
      </h1>
      <p style={{ margin: `var(--space-1) 0 0`, color: 'var(--color-on-surface-variant)', fontSize: '12px' }}>
        {subtitle}
      </p>
    </div>
    {actions ? <div style={{ display: 'flex', gap: 'var(--space-2)' }}>{actions}</div> : null}
  </div>
);

/**
 * A KPI tile.
 *
 * Deliberately not `MetricCard`: these tiles carry a figure and a caption with
 * no sparkline, and MetricCard's default fabricated series would be a chart of
 * nothing.
 */
export const KpiTile: React.FC<{
  label: string;
  value: string;
  caption?: string;
  tone?: Tone;
  icon?: string;
}> = ({ label, value, caption, tone = 'primary', icon }) => (
  <SurfaceCard padding="md" railTone={tone}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
      {icon ? (
        <span
          style={{
            display: 'grid',
            placeItems: 'center',
            width: '28px',
            height: '28px',
            borderRadius: 'var(--radius-sm, 6px)',
            backgroundColor: toneContainer[tone],
            color: toneOnContainer[tone],
          }}
        >
          <Icon name={icon} size={16} />
        </span>
      ) : null}
      <span
        style={{
          fontSize: '11px',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--color-on-surface-variant)',
        }}
      >
        {label}
      </span>
    </div>
    <div
      style={{
        marginTop: 'var(--space-2)',
        fontSize: '24px',
        fontWeight: 800,
        color: 'var(--color-on-surface)',
        letterSpacing: '-0.02em',
      }}
    >
      {value}
    </div>
    {caption ? (
      <div style={{ marginTop: 'var(--space-1)', fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
        {caption}
      </div>
    ) : null}
  </SurfaceCard>
);

/** A responsive row of KPI tiles. */
export const KpiRow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
      gap: 'var(--space-3)',
    }}
  >
    {children}
  </div>
);

/**
 * What a screen shows before it has anything to show.
 *
 * An empty MES screen is usually not an error but a step not taken yet — no
 * MRP run, no inspection plan — so the copy says which step, in Indonesian.
 */
export const EmptyState: React.FC<{ icon: string; title: string; description: string }> = ({
  icon,
  title,
  description,
}) => (
  <div
    style={{
      display: 'grid',
      placeItems: 'center',
      padding: 'var(--space-7, 32px)',
      textAlign: 'center',
      color: 'var(--color-on-surface-variant)',
    }}
  >
    <div style={{ maxWidth: '380px' }}>
      <Icon name={icon} size={32} />
      <h3
        style={{
          margin: `var(--space-3) 0 var(--space-1)`,
          fontSize: '15px',
          fontWeight: 800,
          color: 'var(--color-on-surface)',
        }}
      >
        {title}
      </h3>
      <p style={{ margin: 0, fontSize: '12px' }}>{description}</p>
    </div>
  </div>
);

/** A labelled figure inside a card, for detail panes. */
export const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
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
    <div style={{ marginTop: '2px', fontSize: '13px', fontWeight: 600, color: 'var(--color-on-surface)' }}>
      {children}
    </div>
  </div>
);

/** Indonesian number formatting, used for every quantity on these screens. */
export function fmt(value: number | undefined, digits = 0): string {
  if (value === undefined || Number.isNaN(value)) return '—';
  return value.toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

export function fmtDateTime(iso?: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return `${date.toLocaleDateString('id-ID')} ${date.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

export function fmtDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * A tab strip.
 *
 * The improvement adds six modules with four to five sub-screens each; giving
 * every one its own route would put thirty entries in a sidebar nobody reads.
 * The selected tab fills solid `--color-primary`, the one selected state the
 * guideline allows.
 */
export const TabStrip: React.FC<{
  tabs: Array<{ key: string; label: string; icon?: string }>;
  active: string;
  onChange: (key: string) => void;
}> = ({ tabs, active, onChange }) => (
  <div
    style={{
      display: 'flex',
      gap: 'var(--space-1)',
      flexWrap: 'wrap',
      borderBottom: '1px solid var(--color-border)',
      paddingBottom: 'var(--space-2)',
    }}
  >
    {tabs.map((tab) => {
      const selected = tab.key === active;
      return (
        <button
          key={tab.key}
          type="button"
          onClick={() => onChange(tab.key)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--space-1)',
            padding: `var(--space-2) var(--space-3)`,
            border: 'none',
            borderRadius: 'var(--radius-pill)',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: 700,
            fontFamily: 'var(--font-family)',
            backgroundColor: selected ? 'var(--color-primary)' : 'transparent',
            color: selected ? 'var(--color-on-primary)' : 'var(--color-on-surface-variant)',
          }}
        >
          {tab.icon ? <Icon name={tab.icon} size={16} /> : null}
          {tab.label}
        </button>
      );
    })}
  </div>
);
