import React from 'react';
import { SurfaceCard, toneContainer, toneOnContainer, toneColor, type Tone } from '@factory-vision/ui/fv';
import type { OrderStatusSummary } from '@factory-vision/api-client';

export interface OrderStatusCardProps {
  summary?: OrderStatusSummary;
  isLoading?: boolean;
  onSelectStatus?: (status: string) => void;
  onSelectOrder?: (orderId: string) => void;
}

const CLASSIFICATION_TONE: Record<string, Tone> = {
  OVERDUE: 'error',
  DELAYED: 'error',
  AT_RISK: 'warning',
};

/**
 * Production Order / Schedule Status, "Is the schedule safe?"
 *
 * At Risk, Delayed and Overdue carry higher visual priority than the healthy
 * counts, as requires: they get a toned, filled tile while Planned /
 * Running / Completed stay on the neutral surface.
 */
export const OrderStatusCard: React.FC<OrderStatusCardProps> = ({
  summary,
  isLoading,
  onSelectStatus,
  onSelectOrder,
}) => {
  const tiles: Array<{ key: string; label: string; value: number; tone?: Tone }> = summary
    ? [
        { key: 'PLANNED', label: 'Planned', value: summary.planned },
        { key: 'IN_PRODUCTION', label: 'Running', value: summary.running },
        { key: 'COMPLETED', label: 'Completed', value: summary.completed },
        { key: 'AT_RISK', label: 'At Risk', value: summary.atRisk, tone: 'warning' },
        { key: 'DELAYED', label: 'Delayed', value: summary.delayed, tone: 'error' },
        { key: 'OVERDUE', label: 'Overdue', value: summary.overdue, tone: 'error' },
      ]
    : [];

  return (
    <SurfaceCard padding="md" style={{ display: 'flex', flexDirection: 'column', gap: '11px' }}>
      <div>
        <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 700 }}>Production Order Status</h3>
        <div style={{ fontSize: '10.5px', color: 'var(--color-on-surface-variant)', marginTop: '2px' }}>
          {summary ? `${summary.total} order dalam pantauan` : 'Kesehatan jadwal produksi'}
        </div>
      </div>

      {isLoading || !summary ? (
        <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>Memuat status order…</div>
      ) : (
        <>
          <div
            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(78px, 1fr))', gap: '7px' }}
          >
            {tiles.map((tile) => {
              const isPriority = Boolean(tile.tone) && tile.value > 0;
              return (
                <button
                  key={tile.key}
                  type="button"
                  onClick={onSelectStatus ? () => onSelectStatus(tile.key) : undefined}
                  style={{
                    textAlign: 'left',
                    padding: '8px',
                    borderRadius: 'var(--radius-sm)',
                    border: 'none',
                    cursor: onSelectStatus ? 'pointer' : 'default',
                    backgroundColor: isPriority
                      ? toneContainer[tile.tone as Tone]
                      : 'var(--color-surface-container)',
                    color: isPriority ? toneOnContainer[tile.tone as Tone] : 'var(--color-on-surface)',
                  }}
                >
                  <div style={{ fontSize: '10px', fontWeight: 600, opacity: 0.85 }}>{tile.label}</div>
                  <div
                    style={{
                      fontSize: '17px',
                      fontWeight: 800,
                      marginTop: '2px',
                      fontFeatureSettings: '"tnum" 1',
                      letterSpacing: '-0.02em',
                    }}
                  >
                    {tile.value}
                  </div>
                </button>
              );
            })}
          </div>

          {summary.attentionOrders.length > 0 && (
            <div>
              <div
                style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  color: 'var(--color-on-surface-variant)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  marginBottom: '6px',
                }}
              >
                Butuh perhatian
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {summary.attentionOrders.map((order) => {
                  const tone = CLASSIFICATION_TONE[order.classification] ?? 'warning';
                  return (
                    <div
                      key={order.id}
                      onClick={onSelectOrder ? () => onSelectOrder(order.id) : undefined}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '10px',
                        padding: '7px 9px',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'var(--color-surface-container)',
                        borderLeft: `3px solid ${toneColor[tone]}`,
                        cursor: onSelectOrder ? 'pointer' : 'default',
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '12px', fontWeight: 700 }}>{order.orderNumber}</div>
                        <div style={{ fontSize: '10.5px', color: 'var(--color-on-surface-variant)' }}>
                          {order.daysToDue < 0
                            ? `Lewat ${Math.abs(order.daysToDue)} hari`
                            : `Jatuh tempo ${order.daysToDue} hari lagi`}{' '}
                          · {order.achievementPct}% selesai
                        </div>
                      </div>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: 'var(--radius-pill)',
                          fontSize: '10px',
                          fontWeight: 800,
                          whiteSpace: 'nowrap',
                          backgroundColor: toneContainer[tone],
                          color: toneOnContainer[tone],
                        }}
                      >
                        {order.classification.replace('_', ' ')}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </SurfaceCard>
  );
};
