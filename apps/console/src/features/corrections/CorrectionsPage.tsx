import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FactoryVisionApiClient } from '@factory-vision/api-client';
import {
  AdvancedDataTable,
  ColumnDef,
  Button,
  Modal,
  WarningBanner,
  Timeline,
  TimelineEvent,
} from '@factory-vision/ui';
import { toneContainer, toneOnContainer, type Tone, Page, Section } from '@factory-vision/ui/fv';
import { CorrectionRequest } from '@factory-vision/domain-types';

const api = new FactoryVisionApiClient({ baseUrl: '' });

interface CorrectionsPageProps {
  userRole?: string;
  userName?: string;
}

export const CorrectionsPage: React.FC<CorrectionsPageProps> = ({
  userRole = 'SUPERVISOR',
  userName = 'Agung Wicaksono',
}) => {
  const queryClient = useQueryClient();
  const [selectedCorrection, setSelectedCorrection] = useState<CorrectionRequest | null>(null);
  const [actionType, setActionType] = useState<'APPROVE' | 'REJECT' | null>(null);
  const [reviewNotes, setReviewNotes] = useState<string>('');

  const { data: corrections, isLoading } = useQuery({
    queryKey: ['corrections'],
    queryFn: () => api.corrections.list(),
    refetchInterval: 4000,
  });

  const approveMutation = useMutation({
    mutationFn: ({ id }: { id: string; notes: string }) =>
      api.corrections.approve(id, { approvedBy: userName }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['corrections'] });
      setSelectedCorrection(null);
      setActionType(null);
      setReviewNotes('');
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id }: { id: string; notes: string }) => api.corrections.reject(id, { rejectedBy: userName }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['corrections'] });
      setSelectedCorrection(null);
      setActionType(null);
      setReviewNotes('');
    },
  });

  const handleActionSubmit = () => {
    if (!selectedCorrection) return;
    if (actionType === 'APPROVE') {
      approveMutation.mutate({
        id: selectedCorrection.id,
        notes: reviewNotes || 'Approved with physical verification evidence',
      });
    } else if (actionType === 'REJECT') {
      rejectMutation.mutate({
        id: selectedCorrection.id,
        notes: reviewNotes || 'Rejected: mismatch with telemetry data',
      });
    }
  };

  // Convert approved/rejected corrections to Timeline Events
  const timelineEvents: TimelineEvent[] = (corrections || []).slice(0, 5).map((c) => ({
    id: c.id,
    title: `${c.entityType} Correction (${c.status})`,
    description: `Submitted by ${c.requestedBy}: "${c.reason}". ${c.approvedBy ? `Approved by ${c.approvedBy}` : c.rejectedBy ? `Rejected by ${c.rejectedBy}` : ''}`,
    timestamp: new Date(c.requestedAt).toLocaleString('en-US'),
    icon: c.status === 'APPROVED' ? 'check_circle' : c.status === 'REJECTED' ? 'cancel' : 'pending',
    type: c.status === 'APPROVED' ? 'success' : c.status === 'REJECTED' ? 'error' : 'warning',
  }));

  const columns: ColumnDef<CorrectionRequest>[] = [
    {
      key: 'entityType',
      header: 'Target Entity',
      sortable: true,
      render: (c) => (
        <div>
          <div style={{ fontWeight: 800, fontSize: '13px', color: 'var(--color-on-surface)' }}>
            {c.entityType}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>ID: {c.entityId}</div>
        </div>
      ),
    },
    {
      key: 'requestedBy',
      header: 'Submitted By',
      sortable: true,
      render: (c) => (
        <div>
          <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--color-on-surface)' }}>
            {c.requestedBy}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
            {new Date(c.requestedAt).toLocaleString('en-US')}
          </div>
        </div>
      ),
    },
    {
      key: 'reason',
      header: 'Correction Reason',
      render: (c) => (
        <span style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>{c.reason}</span>
      ),
    },
    {
      key: 'status',
      header: 'Approval Status',
      sortable: true,
      render: (c) => {
        const tone: Tone = c.status === 'APPROVED' ? 'success' : c.status === 'REJECTED' ? 'error' : 'warning';
        return (
          <span
            style={{
              padding: `var(--space-1) var(--space-2)`,
              borderRadius: 'var(--radius-pill)',
              fontSize: '11px',
              fontWeight: 800,
              backgroundColor: toneContainer[tone],
              color: toneOnContainer[tone],
            }}
          >
            {c.status}
          </span>
        );
      },
    },
    {
      key: 'actions',
      header: 'Review Action',
      render: (c) => {
        if (c.status !== 'PENDING') {
          return (
            <span style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
              Reviewed: {c.approvedBy || c.rejectedBy || '-'}
            </span>
          );
        }

        return (
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <Button
              variant="filled"
              size="sm"
              style={{ backgroundColor: 'var(--color-success)', color: 'var(--color-on-success)' }}
              onClick={() => {
                setSelectedCorrection(c);
                setActionType('APPROVE');
              }}
            >
              Approve
            </Button>
            <Button
              variant="outlined"
              size="sm"
              style={{ color: 'var(--color-error)', borderColor: 'var(--color-error)' }}
              onClick={() => {
                setSelectedCorrection(c);
                setActionType('REJECT');
              }}
            >
              Reject
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <Page style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
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
          Governance & Data Correction Approvals
        </h1>
        <p style={{ margin: `var(--space-1) 0 0`, color: 'var(--color-on-surface-variant)', fontSize: '12px' }}>
          Verification workflow for production and downtime revisions with 24-hour audit window
        </p>
      </Section>

      {/* 24-Hour SLA Window Policy */}
      <WarningBanner
        title="24-Hour Correction Policy (Immutable Event Ledger)"
        description="Data corrections for output or downtime must be submitted within 24 hours of occurrence and require Supervisor or Production Manager sign-off before being committed to the ledger."
      />

      {/* Table first at full width, then the timeline underneath it. */}
      <Section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <AdvancedDataTable
          columns={columns}
          data={corrections || []}
          title="Data Correction Request Queue"
          subtitle="Review justification and execute tiered governance approvals"
          searchable={true}
          selectable={false}
        />

        {/* Timeline Stream */}
        <div
          style={{
            backgroundColor: 'var(--color-surface)',
            borderRadius: 'var(--radius-lg, 16px)',
            border: '1px solid var(--color-outline-variant)',
            padding: 'var(--space-5)',
            height: 'fit-content',
          }}
        >
          <h3
            style={{ margin: `0 0 var(--space-3)`, fontSize: '14px', fontWeight: 800, color: 'var(--color-on-surface)' }}
          >
            Recent Approval Audit Trail
          </h3>
          <Timeline events={timelineEvents} />
        </div>
      </Section>

      {/* Review Modal Dialog */}
      {selectedCorrection && (
        <Modal
          isOpen={!!selectedCorrection}
          onClose={() => setSelectedCorrection(null)}
          title={`CONFIRM CORRECTION ${actionType === 'APPROVE' ? 'APPROVAL' : 'REJECTION'}`}
        >
          <Section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div
              style={{
                backgroundColor: 'var(--color-surface-container-high)',
                padding: `var(--space-3) var(--space-4)`,
                borderRadius: 'var(--radius-md, 8px)',
                fontSize: '12px',
              }}
            >
              <div>
                <strong>Target Entity:</strong> {selectedCorrection.entityType} ({selectedCorrection.entityId})
              </div>
              <div style={{ marginTop: 'var(--space-1)' }}>
                <strong>Submitted By:</strong> {selectedCorrection.requestedBy}
              </div>
              <div style={{ marginTop: 'var(--space-1)' }}>
                <strong>Reason:</strong> {selectedCorrection.reason}
              </div>
            </div>

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '11px',
                  fontWeight: 700,
                  color: 'var(--color-on-surface-variant)',
                  marginBottom: 'var(--space-1)',
                }}
              >
                REVIEW NOTES & COMMENTS ({userRole})
              </label>
              <textarea
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                placeholder="Write log notes or evidence verification comments, ..."
                rows={3}
                style={{
                  width: '100%',
                  padding: `var(--space-3) var(--space-3)`,
                  borderRadius: 'var(--radius-md, 8px)',
                  backgroundColor: 'var(--color-surface-container-high)',
                  border: '1px solid var(--color-outline-variant)',
                  color: 'var(--color-on-surface)',
                  fontSize: '12px',
                  fontFamily: 'inherit',
                  resize: 'none',
                }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
              <Button variant="outlined" onClick={() => setSelectedCorrection(null)}>
                Cancel
              </Button>
              <Button
                variant="filled"
                style={{
                  backgroundColor: actionType === 'APPROVE' ? 'var(--color-success)' : 'var(--color-error)',
                  color: actionType === 'APPROVE' ? 'var(--color-on-success)' : 'var(--color-on-error)',
                }}
                onClick={handleActionSubmit}
              >
                Confirm {actionType === 'APPROVE' ? 'Approval' : 'Rejection'}
              </Button>
            </div>
          </Section>
        </Modal>
      )}
    </Page>
  );
};
