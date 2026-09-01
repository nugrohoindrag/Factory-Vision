import React from 'react';
import { Icon } from '@factory-vision/ui';
import { SurfaceCard, toneContainer, toneOnContainer, toneColor, type Tone } from '@factory-vision/ui/fv';
import type { OperationalAlert } from '@factory-vision/api-client';

export interface OperationalAlertsCardProps {
  alerts: OperationalAlert[];
  isLoading?: boolean;
  /** Navigates to the alert's own `drillDownPath` ( "View Detail"). */
  onViewDetail?: (path: string) => void;
  maxVisible?: number;
}

const SEVERITY_TONE: Record<OperationalAlert['severity'], Tone> = {
  CRITICAL: 'error',
  WARNING: 'warning',
  INFORMATIONAL: 'info',
};

const SEVERITY_ICON: Record<OperationalAlert['severity'], string> = {
  CRITICAL: 'error',
  WARNING: 'warning',
  INFORMATIONAL: 'info',
};

/**
 * Operational Alerts / Exceptions, "What needs attention now?"
 *
 * Rules are evaluated server-side against the same aggregates the KPI cards
 * use, and each alert carries the route that answers it, so "View Detail"
 * lands on real operational context rather than a generic page.
 */
export const OperationalAlertsCard: React.FC<OperationalAlertsCardProps> = ({
  alerts,
  isLoading,
  onViewDetail,
  maxVisible = 6,
}) => {
  const critical = alerts.filter((a) => a.severity === 'CRITICAL').length;
  const warning = alerts.filter((a) => a.severity === 'WARNING').length;
  const visible = alerts.slice(0, maxVisible);

  return (
    <SurfaceCard padding="md" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 700 }}>Operational Alerts</h3>
          <div style={{ fontSize: '10.5px', color: 'var(--color-on-surface-variant)', marginTop: 'var(--space-1)' }}>
            Kondisi yang membutuhkan perhatian sekarang
          </div>
        </div>
        {!isLoading && alerts.length > 0 && (
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0 }}>
            {critical > 0 && (
              <span
                style={{
                  padding: `var(--space-1) var(--space-2)`,
                  borderRadius: 'var(--radius-pill)',
                  fontSize: '10px',
                  fontWeight: 800,
                  backgroundColor: toneContainer.error,
                  color: toneOnContainer.error,
                }}
              >
                {critical} CRITICAL
              </span>
            )}
            {warning > 0 && (
              <span
                style={{
                  padding: `var(--space-1) var(--space-2)`,
                  borderRadius: 'var(--radius-pill)',
                  fontSize: '10px',
                  fontWeight: 800,
                  backgroundColor: toneContainer.warning,
                  color: toneOnContainer.warning,
                }}
              >
                {warning} WARNING
              </span>
            )}
          </div>
        )}
      </div>

      {isLoading ? (
        <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>Memuat exception…</div>
      ) : alerts.length === 0 ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            padding: `var(--space-3) var(--space-3)`,
            borderRadius: 'var(--radius-sm, 6px)',
            backgroundColor: 'var(--color-surface-container)',
            fontSize: '12px',
            color: 'var(--color-on-surface-variant)',
          }}
        >
          <Icon name="check_circle" size={16} color="var(--color-success)" />
          Tidak ada exception. Seluruh KPI berada dalam ambang batas.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {visible.map((alert) => {
              const tone = SEVERITY_TONE[alert.severity];
              return (
                <div
                  key={alert.id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 'var(--space-3)',
                    padding: `var(--space-2) var(--space-3)`,
                    borderRadius: 'var(--radius-sm, 6px)',
                    backgroundColor: 'var(--color-surface-container)',
                    borderLeft: `3px solid ${toneColor[tone]}`,
                  }}
                >
                  <Icon name={SEVERITY_ICON[alert.severity]} size={14} color={toneColor[tone]} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '12px', fontWeight: 700 }}>{alert.title}</div>
                    <div
                      style={{
                        fontSize: '11px',
                        color: 'var(--color-on-surface-variant)',
                        marginTop: 'var(--space-1)',
                      }}
                    >
                      {alert.detail}
                    </div>
                  </div>
                  {onViewDetail && (
                    <button
                      type="button"
                      onClick={() => onViewDetail(alert.drillDownPath)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 'var(--space-1)',
                        border: 'none',
                        backgroundColor: 'transparent',
                        color: 'var(--color-primary)',
                        fontSize: '11px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                        padding: `var(--space-1) 0`,
                      }}
                    >
                      Detail
                      <Icon name="chevron_right" size={14} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {alerts.length > maxVisible && (
            <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
              +{alerts.length - maxVisible} exception lainnya
            </div>
          )}
        </>
      )}
    </SurfaceCard>
  );
};
