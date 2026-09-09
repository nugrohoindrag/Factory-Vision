import React from 'react';
import { Icon } from '@factory-vision/ui';
import { SurfaceCard, toneContainer, toneOnContainer, type Tone } from '@factory-vision/ui/fv';

/**
 * The states every report shares (Improvement PRD §24).
 *
 * Nine reports arrived at once. Written separately they would have disagreed
 * about what "no data" looks like, and about whether a failed fetch shows an
 * empty table or an error — which is the difference between a user who knows
 * to widen the date range and a user who thinks the plant produced nothing.
 */

/** A resolved date window. `to` is exclusive of nothing; both are inclusive. */
export interface DateRange {
  from: string;
  to: string;
  label: string;
}

export type RangeKey = 'TODAY' | 'THIS_WEEK' | 'THIS_MONTH' | 'LAST_30' | 'LAST_90';

const startOfDay = (date: Date) => {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

/**
 * Resolves a range key to two ISO instants.
 *
 * Computed locally rather than on the server: the plant's day boundary is the
 * one on the wall clock in front of the person reading the report, and a
 * server in UTC would shift "hari ini" by seven hours for every Indonesian
 * site.
 */
export function resolveRange(key: RangeKey): DateRange {
  const now = new Date();
  const end = new Date(now);
  const start = startOfDay(now);

  switch (key) {
    case 'THIS_WEEK': {
      // Monday-first, which is how a production week is counted here.
      const weekday = (start.getDay() + 6) % 7;
      start.setDate(start.getDate() - weekday);
      return { from: start.toISOString(), to: end.toISOString(), label: 'Minggu Ini' };
    }
    case 'THIS_MONTH':
      start.setDate(1);
      return { from: start.toISOString(), to: end.toISOString(), label: 'Bulan Ini' };
    case 'LAST_30':
      start.setDate(start.getDate() - 29);
      return { from: start.toISOString(), to: end.toISOString(), label: '30 Hari' };
    case 'LAST_90':
      start.setDate(start.getDate() - 89);
      return { from: start.toISOString(), to: end.toISOString(), label: '90 Hari' };
    default:
      return { from: start.toISOString(), to: end.toISOString(), label: 'Hari Ini' };
  }
}

export const RANGE_KEYS: RangeKey[] = ['TODAY', 'THIS_WEEK', 'THIS_MONTH', 'LAST_30', 'LAST_90'];

/** One figure on a report's summary row. */
export interface ReportKpi {
  label: string;
  value: string;
  caption?: string;
  tone?: Tone;
  icon?: string;
}

export const ReportKpiRow: React.FC<{ kpis: ReportKpi[] }> = ({ kpis }) => (
  <div
    style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
      gap: 'var(--space-3)',
    }}
  >
    {kpis.map((kpi) => {
      const tone = kpi.tone ?? 'primary';
      return (
        <SurfaceCard key={kpi.label} padding="md" railTone={tone}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            {kpi.icon ? (
              <span
                style={{
                  display: 'grid',
                  placeItems: 'center',
                  width: '26px',
                  height: '26px',
                  borderRadius: 'var(--radius-sm, 6px)',
                  backgroundColor: toneContainer[tone],
                  color: toneOnContainer[tone],
                }}
              >
                <Icon name={kpi.icon} size={15} />
              </span>
            ) : null}
            <span
              style={{
                fontSize: '10.5px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'var(--color-on-surface-variant)',
              }}
            >
              {kpi.label}
            </span>
          </div>
          <div
            style={{
              marginTop: 'var(--space-2)',
              fontSize: '22px',
              fontWeight: 800,
              color: 'var(--color-on-surface)',
              letterSpacing: '-0.02em',
            }}
          >
            {kpi.value}
          </div>
          {kpi.caption ? (
            <div
              style={{ marginTop: '2px', fontSize: '11px', color: 'var(--color-on-surface-variant)' }}
            >
              {kpi.caption}
            </div>
          ) : null}
        </SurfaceCard>
      );
    })}
  </div>
);

/** Shown while a report's rows are on their way. */
export const ReportLoading: React.FC<{ label: string }> = ({ label }) => (
  <SurfaceCard padding="lg">
    <div
      style={{
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--space-6)',
        textAlign: 'center',
        color: 'var(--color-on-surface-variant)',
      }}
    >
      <div>
        <Icon name="hourglass_top" size={28} />
        <p style={{ margin: `var(--space-2) 0 0`, fontSize: '13px', fontWeight: 700 }}>
          Menyiapkan {label}…
        </p>
      </div>
    </div>
  </SurfaceCard>
);

/**
 * Shown when the fetch failed.
 *
 * Deliberately distinct from the empty state: "no rows" and "we could not ask"
 * lead to different actions, and showing an empty table for a failed request
 * is how a plant concludes it produced nothing all week.
 */
export const ReportError: React.FC<{ message: string; onRetry: () => void }> = ({ message, onRetry }) => (
  <SurfaceCard padding="lg" railTone="error">
    <div
      style={{
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--space-5)',
        textAlign: 'center',
      }}
    >
      <div style={{ maxWidth: '420px' }}>
        <span style={{ color: 'var(--color-error)' }}>
          <Icon name="error" size={30} />
        </span>
        <h3
          style={{
            margin: `var(--space-2) 0 var(--space-1)`,
            fontSize: '14px',
            fontWeight: 800,
            color: 'var(--color-on-surface)',
          }}
        >
          Laporan gagal dimuat
        </h3>
        <p style={{ margin: 0, fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>{message}</p>
        <button
          type="button"
          onClick={onRetry}
          style={{
            marginTop: 'var(--space-3)',
            padding: `var(--space-2) var(--space-4)`,
            border: 'none',
            borderRadius: 'var(--radius-pill)',
            cursor: 'pointer',
            fontFamily: 'var(--font-family)',
            fontSize: '12px',
            fontWeight: 800,
            backgroundColor: 'var(--color-primary)',
            color: 'var(--color-on-primary)',
          }}
        >
          Coba Lagi
        </button>
      </div>
    </div>
  </SurfaceCard>
);

/** Shown when the report ran and there was genuinely nothing in the window. */
export const ReportEmpty: React.FC<{ icon: string; title: string; description: string }> = ({
  icon,
  title,
  description,
}) => (
  <SurfaceCard padding="lg">
    <div
      style={{
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--space-6)',
        textAlign: 'center',
        color: 'var(--color-on-surface-variant)',
      }}
    >
      <div style={{ maxWidth: '400px' }}>
        <Icon name={icon} size={30} />
        <h3
          style={{
            margin: `var(--space-2) 0 var(--space-1)`,
            fontSize: '14px',
            fontWeight: 800,
            color: 'var(--color-on-surface)',
          }}
        >
          {title}
        </h3>
        <p style={{ margin: 0, fontSize: '12px' }}>{description}</p>
      </div>
    </div>
  </SurfaceCard>
);

/** Shown when the signed-in role may not read this report. */
export const ReportForbidden: React.FC<{ permission: string; role?: string }> = ({ permission, role }) => (
  <SurfaceCard padding="lg">
    <div
      style={{
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--space-6)',
        textAlign: 'center',
        color: 'var(--color-on-surface-variant)',
      }}
    >
      <div style={{ maxWidth: '400px' }}>
        <Icon name="lock" size={30} />
        <h3
          style={{
            margin: `var(--space-2) 0 var(--space-1)`,
            fontSize: '14px',
            fontWeight: 800,
            color: 'var(--color-on-surface)',
          }}
        >
          Laporan ini tidak tersedia untuk peran Anda
        </h3>
        <p style={{ margin: 0, fontSize: '12px' }}>
          Peran <strong>{role ?? '—'}</strong> tidak memiliki izin <code>{permission}</code>. Hubungi
          administrator bila Anda memerlukan akses.
        </p>
      </div>
    </div>
  </SurfaceCard>
);
