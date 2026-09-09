import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FactoryVisionApiClient } from '@factory-vision/api-client';
import { Icon } from '@factory-vision/ui';
import { Page, Section, SurfaceCard, FilterChip, toneContainer, toneOnContainer } from '@factory-vision/ui/fv';
import type { EventEntityType, OperationalEvent, OperationalEventType } from '@factory-vision/domain-types';
import { EmptyState, KpiRow, KpiTile, PageHeading, fmt } from './shared.js';

const api = new FactoryVisionApiClient({ baseUrl: '' });

/**
 * Event History (Improvement PRD §10, US-E001).
 *
 * A timeline, not a table. §10.3 shows the answer to "apa yang terjadi pada WO
 * ini" as a chronological list a supervisor reads top to bottom, and a sortable
 * grid would let somebody destroy the one property that makes it readable.
 *
 * Read-only: BR-E02 says no normal application user may change an event, and
 * there is nothing on this screen that could.
 */

/** Event type → icon and tone. The vocabulary of §10.2, given a face. */
function look(eventType: string): { icon: string; tone: keyof typeof toneContainer } {
  if (eventType.startsWith('WO_')) {
    return {
      icon: eventType === 'WO_COMPLETED' ? 'task_alt' : eventType === 'WO_CANCELLED' ? 'cancel' : 'assignment',
      tone: eventType === 'WO_CANCELLED' ? 'error' : eventType === 'WO_COMPLETED' ? 'success' : 'primary',
    };
  }
  if (eventType.startsWith('MATERIAL_')) return { icon: 'inventory_2', tone: 'chart-2' };
  if (eventType.startsWith('QUALITY_') || eventType.startsWith('NCR_')) {
    return {
      icon: eventType === 'QUALITY_HOLD' || eventType === 'NCR_OPENED' ? 'pan_tool' : 'verified',
      tone: eventType === 'QUALITY_HOLD' || eventType === 'NCR_OPENED' ? 'error' : 'success',
    };
  }
  if (eventType.startsWith('MAINTENANCE_')) {
    return { icon: 'build', tone: eventType === 'MAINTENANCE_COMPLETED' ? 'success' : 'warning' };
  }
  if (eventType.startsWith('WIP_')) return { icon: 'swap_horiz', tone: 'info' };
  if (eventType.startsWith('DOWNTIME_')) return { icon: 'timer_off', tone: 'error' };
  if (eventType.startsWith('OPERATOR_')) return { icon: 'engineering', tone: 'info' };
  if (eventType === 'PRODUCTION_RECORDED') return { icon: 'add_circle', tone: 'success' };
  if (eventType === 'REJECT_RECORDED' || eventType === 'SCRAP_RECORDED') {
    return { icon: 'report', tone: 'error' };
  }
  if (eventType === 'REWORK_STARTED') return { icon: 'recycling', tone: 'warning' };
  if (eventType === 'MRP_RUN') return { icon: 'calculate', tone: 'chart-3' };
  if (eventType === 'SCHEDULE_CHANGED') return { icon: 'event_repeat', tone: 'warning' };
  if (eventType.startsWith('BATCH_')) return { icon: 'inventory', tone: 'chart-4' };
  return { icon: 'history', tone: 'neutral' };
}

/** The entity filters §33 asks for: work order, batch, machine. */
const ENTITY_FILTERS: Array<{ key: EventEntityType | 'ALL'; label: string }> = [
  { key: 'ALL', label: 'Semua' },
  { key: 'WORK_ORDER', label: 'Work Order' },
  { key: 'BATCH', label: 'Batch' },
  { key: 'MACHINE', label: 'Mesin' },
  { key: 'INSPECTION', label: 'Inspeksi' },
  { key: 'NCR', label: 'NCR' },
  { key: 'WIP', label: 'WIP' },
];

export const EventHistoryPage: React.FC = () => {
  const [entityType, setEntityType] = useState<EventEntityType | 'ALL'>('ALL');
  const [entityId, setEntityId] = useState('');
  const [eventType, setEventType] = useState<OperationalEventType | 'ALL'>('ALL');

  const { data: events, isLoading } = useQuery({
    queryKey: ['events', entityType, entityId, eventType],
    queryFn: () =>
      api.events.list({
        entityType: entityType === 'ALL' ? undefined : entityType,
        entityId: entityId || undefined,
        eventType: eventType === 'ALL' ? undefined : eventType,
        limit: 300,
      }),
    refetchInterval: 20_000,
  });

  const { data: summary } = useQuery({
    queryKey: ['events-summary'],
    queryFn: () => api.events.summary(7),
  });

  const rows = events ?? [];
  const topTypes = (summary ?? []).slice(0, 4);

  // Grouped by calendar day, so the timeline reads as "hari ini, kemarin"
  // rather than as one undifferentiated column of timestamps.
  const byDay = rows.reduce<Record<string, OperationalEvent[]>>((groups, event) => {
    const day = event.occurredAt.slice(0, 10);
    (groups[day] ??= []).push(event);
    return groups;
  }, {});

  return (
    <Page>
      <Section>
        <PageHeading
          title="Event History"
          subtitle="Riwayat operasional yang bersifat append-only: apa yang terjadi, kapan, oleh siapa, pada resource apa. Tidak dapat diubah oleh pengguna aplikasi."
        />
      </Section>

      <Section>
        <KpiRow>
          <KpiTile
            label="Event Ditampilkan"
            value={fmt(rows.length)}
            caption="Sesuai filter saat ini"
            tone="primary"
            icon="history"
          />
          {topTypes.map((entry, index) => (
            <KpiTile
              key={entry.eventType}
              label={entry.eventType.replace(/_/g, ' ')}
              value={fmt(entry.count)}
              caption="7 hari terakhir"
              tone={(['info', 'chart-2', 'chart-3', 'chart-4'] as const)[index] ?? 'neutral'}
              icon={look(entry.eventType).icon}
            />
          ))}
        </KpiRow>
      </Section>

      <Section>
        <SurfaceCard padding="md">
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-on-surface-variant)' }}>
              Entitas:
            </span>
            {ENTITY_FILTERS.map((filter) => (
              <FilterChip
                key={filter.key}
                selected={entityType === filter.key}
                onClick={() => setEntityType(filter.key)}
              >
                {filter.label}
              </FilterChip>
            ))}
            <input
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
              placeholder="ID entitas (opsional)"
              style={{
                marginLeft: 'auto',
                padding: `var(--space-2) var(--space-3)`,
                borderRadius: 'var(--radius-pill)',
                border: '1px solid var(--color-outline-variant)',
                backgroundColor: 'var(--color-surface-container-low)',
                color: 'var(--color-on-surface)',
                fontFamily: 'var(--font-family)',
                fontSize: '12px',
                minWidth: '220px',
              }}
            />
          </div>
        </SurfaceCard>
      </Section>

      <Section>
        {!isLoading && rows.length === 0 ? (
          <SurfaceCard padding="lg">
            <EmptyState
              icon="history"
              title="Belum ada event"
              description="Event operasional tercatat otomatis ketika work order berjalan, material dikonsumsi, inspeksi dilakukan, WIP ditransfer, dan maintenance dikerjakan."
            />
          </SurfaceCard>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {Object.entries(byDay).map(([day, dayEvents]) => (
              <SurfaceCard key={day} padding="md">
                <h3
                  style={{
                    margin: `0 0 var(--space-3)`,
                    fontSize: '12px',
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    color: 'var(--color-on-surface-variant)',
                  }}
                >
                  {new Date(day).toLocaleDateString('id-ID', {
                    weekday: 'long',
                    day: '2-digit',
                    month: 'long',
                    year: 'numeric',
                  })}
                </h3>

                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {dayEvents.map((event, index) => {
                    const face = look(event.eventType);
                    const last = index === dayEvents.length - 1;
                    return (
                      <div key={event.id} style={{ display: 'flex', gap: 'var(--space-3)' }}>
                        {/* Rail: the icon, and the line joining it to the next event. */}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                          <span
                            style={{
                              display: 'grid',
                              placeItems: 'center',
                              width: '28px',
                              height: '28px',
                              flexShrink: 0,
                              borderRadius: 'var(--radius-pill)',
                              backgroundColor: toneContainer[face.tone],
                              color: toneOnContainer[face.tone],
                            }}
                          >
                            <Icon name={face.icon} size={16} />
                          </span>
                          {!last ? (
                            <span
                              style={{
                                flex: 1,
                                width: '2px',
                                minHeight: '16px',
                                backgroundColor: 'var(--color-outline-variant)',
                              }}
                            />
                          ) : null}
                        </div>

                        <div style={{ flex: 1, paddingBottom: last ? 0 : 'var(--space-4)' }}>
                          <div
                            style={{
                              display: 'flex',
                              gap: 'var(--space-2)',
                              alignItems: 'baseline',
                              flexWrap: 'wrap',
                            }}
                          >
                            <span
                              style={{ fontSize: '12px', fontWeight: 800, color: 'var(--color-on-surface)' }}
                            >
                              {new Date(event.occurredAt).toLocaleTimeString('id-ID', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                            <span style={{ fontSize: '13px', color: 'var(--color-on-surface)' }}>
                              {event.summary}
                            </span>
                          </div>
                          <div
                            style={{
                              marginTop: '2px',
                              fontSize: '11px',
                              color: 'var(--color-on-surface-variant)',
                            }}
                          >
                            {event.eventType.replace(/_/g, ' ')} ·{' '}
                            {event.actorName ?? event.actorId ?? 'Sistem'} ({event.actorType})
                            {event.workOrderId ? ` · WO ${event.workOrderId}` : ''}
                            {event.machineId ? ` · Mesin ${event.machineId}` : ''}
                          </div>

                          {event.afterValue ? (
                            <details style={{ marginTop: 'var(--space-1)' }}>
                              <summary
                                style={{
                                  cursor: 'pointer',
                                  fontSize: '11px',
                                  fontWeight: 700,
                                  color: 'var(--color-primary)',
                                }}
                              >
                                Detail
                              </summary>
                              <pre
                                style={{
                                  margin: `var(--space-1) 0 0`,
                                  padding: 'var(--space-2)',
                                  borderRadius: 'var(--radius-sm, 6px)',
                                  backgroundColor: 'var(--color-surface-container-low)',
                                  fontSize: '10px',
                                  color: 'var(--color-on-surface-variant)',
                                  overflowX: 'auto',
                                }}
                              >
                                {JSON.stringify(event.afterValue, null, 2)}
                              </pre>
                            </details>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </SurfaceCard>
            ))}
          </div>
        )}
      </Section>
    </Page>
  );
};
