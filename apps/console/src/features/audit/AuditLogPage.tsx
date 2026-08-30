import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FactoryVisionApiClient } from '@factory-vision/api-client';
import { AdvancedDataTable, ColumnDef, Timeline, TimelineEvent } from '@factory-vision/ui';
import { toneContainer, toneOnContainer, type Tone, Page, Section, FilterChip } from '@factory-vision/ui/fv';
import { AuditLog } from '@factory-vision/domain-types';

const api = new FactoryVisionApiClient({ baseUrl: '' });

export const AuditLogPage: React.FC = () => {
  const [selectedAction, setSelectedAction] = useState<string>('ALL');

  const { data: auditLogs, isLoading } = useQuery({
    queryKey: ['audit-logs'],
    queryFn: () => api.audit.list(),
    refetchInterval: 4000,
  });

  const filteredLogs = (auditLogs || []).filter((log) => {
    if (selectedAction === 'ALL') return true;
    return log.action.toUpperCase().includes(selectedAction);
  });

  // Convert latest logs to Timeline Events
  const timelineEvents: TimelineEvent[] = (auditLogs || []).slice(0, 6).map((l) => ({
    id: l.id,
    title: `${l.action}, ${l.entityType}`,
    description: `Actor: ${l.actorId} (${l.actorType}). Target: ${l.entityId}`,
    timestamp: new Date(l.occurredAt).toLocaleString('en-US'),
    icon: l.action.includes('CREATE')
      ? 'add_circle'
      : l.action.includes('UPDATE')
        ? 'edit'
        : l.action.includes('APPROVE')
          ? 'verified'
          : 'history',
    type: l.action.includes('APPROVE') ? 'success' : l.action.includes('CANCEL') ? 'error' : 'primary',
  }));

  const columns: ColumnDef<AuditLog>[] = [
    {
      key: 'occurredAt',
      header: 'Timestamp',
      sortable: true,
      render: (log) => (
        <div>
          <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--color-on-surface)' }}>
            {new Date(log.occurredAt).toLocaleDateString('en-US')}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
            {new Date(log.occurredAt).toLocaleTimeString('en-US')} UTC+7
          </div>
        </div>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      sortable: true,
      render: (log) => {
        const isCreate = log.action.includes('CREATE');
        const isUpdate = log.action.includes('UPDATE') || log.action.includes('STATUS');
        const isApprove = log.action.includes('APPROVE');
        const tone: Tone = isApprove ? 'success' : isCreate ? 'info' : isUpdate ? 'warning' : 'primary';

        return (
          <span
            style={{
              padding: '3px 8px',
              borderRadius: 'var(--radius-pill)',
              fontSize: '11px',
              fontWeight: 800,
              backgroundColor: toneContainer[tone],
              color: toneOnContainer[tone],
            }}
          >
            {log.action}
          </span>
        );
      },
    },
    {
      key: 'entityType',
      header: 'Target Entity',
      sortable: true,
      render: (log) => (
        <div>
          <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--color-on-surface)' }}>
            {log.entityType}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>ID: {log.entityId}</div>
        </div>
      ),
    },
    {
      key: 'actorId',
      header: 'Performed By',
      sortable: true,
      render: (log) => (
        <div>
          <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--color-on-surface)' }}>
            {log.actorId}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--color-primary)', fontWeight: 600 }}>
            {log.actorType}
          </div>
        </div>
      ),
    },
  ];

  return (
    <Page style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Header */}
      <Section>
        <h1
          style={{
            fontSize: '22px',
            fontWeight: 800,
            margin: 0,
            color: 'var(--color-on-surface)',
            letterSpacing: '-0.02em',
          }}
        >
          Immutable Audit Trail Logs
        </h1>
        <p style={{ margin: '4px 0 0', color: 'var(--color-on-surface-variant)', fontSize: '12px' }}>
          Append-only audit trail that cannot be modified or deleted for compliance and transparency
        </p>
      </Section>

      {/* Filter Chips Toolbar */}
      <Section style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        <span
          style={{
            fontSize: '11px',
            fontWeight: 700,
            color: 'var(--color-on-surface-variant)',
            marginRight: '4px',
          }}
        >
          Category Filter:
        </span>
        {['ALL', 'CREATE', 'STATUS', 'APPROVE', 'REJECT'].map((act) => (
          <FilterChip key={act} selected={selectedAction === act} onClick={() => setSelectedAction(act)}>
            {act === 'ALL' ? 'All Logs' : act}
          </FilterChip>
        ))}
      </Section>

      {/* Table first at full width, then the timeline underneath it. */}
      <Section style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <AdvancedDataTable
          columns={columns}
          data={filteredLogs}
          title="Audit Log Transaction Registry"
          subtitle="Click row arrow to inspect payload JSON diff between previous and new state"
          searchable={true}
          selectable={false}
          expandable={true}
          renderExpandedRow={(log) => (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '11px' }}>
              <div
                style={{
                  backgroundColor: 'var(--color-surface-container-low)',
                  padding: '10px',
                  borderRadius: 'var(--radius-md, 8px)',
                }}
              >
                <span
                  style={{
                    color: 'var(--color-error)',
                    fontWeight: 700,
                    display: 'block',
                    marginBottom: '3px',
                  }}
                >
                  - Previous State (Before):
                </span>
                <pre
                  style={{
                    margin: 0,
                    fontSize: '10px',
                    color: 'var(--color-on-surface-variant)',
                    overflowX: 'auto',
                  }}
                >
                  {JSON.stringify(log.previousValue || {}, null, 2)}
                </pre>
              </div>
              <div
                style={{
                  backgroundColor: 'var(--color-surface-container-low)',
                  padding: '10px',
                  borderRadius: 'var(--radius-md, 8px)',
                }}
              >
                <span
                  style={{
                    color: 'var(--color-success)',
                    fontWeight: 700,
                    display: 'block',
                    marginBottom: '3px',
                  }}
                >
                  + Updated State (After):
                </span>
                <pre
                  style={{ margin: 0, fontSize: '10px', color: 'var(--color-on-surface)', overflowX: 'auto' }}
                >
                  {JSON.stringify(log.newValue || {}, null, 2)}
                </pre>
              </div>
            </div>
          )}
        />

        {/* Timeline Component */}
        <div
          style={{
            backgroundColor: 'var(--color-surface)',
            borderRadius: 'var(--radius-lg, 16px)',
            border: '1px solid var(--color-outline-variant)',
            padding: '18px',
            height: 'fit-content',
          }}
        >
          <h3
            style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 800, color: 'var(--color-on-surface)' }}
          >
            Real-time Event Stream
          </h3>
          <Timeline events={timelineEvents} />
        </div>
      </Section>
    </Page>
  );
};
