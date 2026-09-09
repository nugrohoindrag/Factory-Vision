import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FactoryVisionApiClient } from '@factory-vision/api-client';
import { AdvancedDataTable, Button, ColumnDef, FilledTextField, Icon, Select } from '@factory-vision/ui';
import { Page, Section, SurfaceCard, Dialog, FilterChip } from '@factory-vision/ui/fv';
import type {
  Inspection,
  InspectionPlan,
  NonConformanceRecord,
  QualityDisposition,
  QualityHold,
} from '@factory-vision/domain-types';
import { useSession } from '../../app/SessionContext.js';
import {
  EmptyState,
  Field,
  KpiRow,
  KpiTile,
  PageHeading,
  StatusPill,
  TabStrip,
  fmt,
  fmtDate,
  fmtDateTime,
} from './shared.js';

const api = new FactoryVisionApiClient({ baseUrl: '' });

type Tab = 'inspections' | 'holds' | 'dispositions' | 'ncr' | 'plans';

/**
 * Quality (Improvement PRD §4, §21's Quality group, §22.2).
 *
 * The tab order is the lifecycle order — inspection, hold, disposition, NCR —
 * because that is the order the work happens in and because a screen that lets
 * you reach a disposition before an inspection invites dispositions with
 * nothing behind them (BR-Q03).
 */
export const QualityPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { can, principal } = useSession();
  const [tab, setTab] = useState<Tab>('inspections');
  const [resultFilter, setResultFilter] = useState<'ALL' | 'PASS' | 'FAIL'>('ALL');
  const [holdingFor, setHoldingFor] = useState<Inspection | null>(null);
  const [dispositioning, setDispositioning] = useState<{ hold?: QualityHold; inspection?: Inspection } | null>(
    null
  );

  const { data: dashboard } = useQuery({
    queryKey: ['quality-dashboard'],
    queryFn: () => api.quality.getDashboard(),
    refetchInterval: 60_000,
  });
  const { data: inspections, isLoading } = useQuery({
    queryKey: ['quality-inspections'],
    queryFn: () => api.quality.getInspections({ limit: 200 }),
    refetchInterval: 30_000,
  });
  const { data: holds } = useQuery({
    queryKey: ['quality-holds'],
    queryFn: () => api.quality.getHolds(),
    refetchInterval: 30_000,
  });
  const { data: dispositions } = useQuery({
    queryKey: ['quality-dispositions'],
    queryFn: () => api.quality.getDispositions(),
    enabled: tab === 'dispositions',
  });
  const { data: ncrs } = useQuery({
    queryKey: ['quality-ncrs'],
    queryFn: () => api.quality.getNcrs({ limit: 200 }),
    enabled: tab === 'ncr',
  });
  const { data: plans } = useQuery({
    queryKey: ['quality-plans'],
    queryFn: () => api.quality.getPlans(),
    enabled: tab === 'plans',
  });

  const releaseHold = useMutation({
    mutationFn: (input: { id: string; reason: string }) => api.quality.releaseHold(input.id, input.reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quality-holds'] });
      queryClient.invalidateQueries({ queryKey: ['quality-dashboard'] });
    },
  });

  const visibleInspections = (inspections ?? []).filter(
    (row) => resultFilter === 'ALL' || row.result === resultFilter
  );

  const inspectionColumns: ColumnDef<Inspection>[] = [
    { key: 'inspectionNumber', header: 'No. Inspeksi', sortable: true },
    { key: 'inspectedAt', header: 'Waktu', sortable: true, render: (row) => fmtDateTime(row.inspectedAt) },
    {
      key: 'workOrderNumber',
      header: 'Work Order',
      sortable: true,
      render: (row) => row.workOrderNumber ?? '—',
    },
    { key: 'productName', header: 'Produk', sortable: true, render: (row) => row.productName ?? '—' },
    {
      key: 'inspectedQuantity',
      header: 'Diperiksa',
      sortable: true,
      render: (row) => fmt(row.inspectedQuantity, 2),
    },
    {
      key: 'failedQuantity',
      header: 'Gagal',
      sortable: true,
      render: (row) => (
        <span
          style={{
            fontWeight: 800,
            color: row.failedQuantity > 0 ? 'var(--color-error)' : 'var(--color-on-surface-variant)',
          }}
        >
          {fmt(row.failedQuantity, 2)}
        </span>
      ),
    },
    { key: 'inspectorName', header: 'Inspektor', sortable: true },
    { key: 'result', header: 'Hasil', sortable: true, render: (row) => <StatusPill status={row.result} /> },
  ];

  const holdColumns: ColumnDef<QualityHold>[] = [
    { key: 'holdNumber', header: 'No. Hold', sortable: true },
    { key: 'heldAt', header: 'Ditahan', sortable: true, render: (row) => fmtDateTime(row.heldAt) },
    {
      key: 'workOrderNumber',
      header: 'Work Order',
      sortable: true,
      render: (row) => row.workOrderNumber ?? '—',
    },
    { key: 'productName', header: 'Produk', sortable: true, render: (row) => row.productName ?? '—' },
    { key: 'quantity', header: 'Kuantitas', sortable: true, render: (row) => fmt(row.quantity, 2) },
    { key: 'reason', header: 'Alasan', sortable: false },
    { key: 'ownerName', header: 'Owner', sortable: true },
    { key: 'status', header: 'Status', sortable: true, render: (row) => <StatusPill status={row.status} /> },
  ];

  const dispositionColumns: ColumnDef<QualityDisposition>[] = [
    { key: 'decidedAt', header: 'Waktu', sortable: true, render: (row) => fmtDateTime(row.decidedAt) },
    {
      key: 'decision',
      header: 'Keputusan',
      sortable: true,
      render: (row) => <StatusPill status={row.decision} />,
    },
    { key: 'quantity', header: 'Kuantitas', sortable: true, render: (row) => fmt(row.quantity, 2) },
    {
      key: 'workOrderNumber',
      header: 'Work Order',
      sortable: true,
      render: (row) => row.workOrderNumber ?? '—',
    },
    { key: 'reason', header: 'Alasan', sortable: false },
    {
      key: 'decidedByName',
      header: 'Diputuskan Oleh',
      sortable: true,
      render: (row) => row.decidedByName ?? row.decidedBy,
    },
  ];

  const ncrColumns: ColumnDef<NonConformanceRecord>[] = [
    { key: 'ncrNumber', header: 'No. NCR', sortable: true },
    { key: 'title', header: 'Judul', sortable: true },
    {
      key: 'severity',
      header: 'Severity',
      sortable: true,
      render: (row) => <StatusPill status={row.severity} />,
    },
    { key: 'ownerName', header: 'Owner', sortable: true },
    { key: 'raisedAt', header: 'Dibuka', sortable: true, render: (row) => fmtDate(row.raisedAt) },
    {
      key: 'dueDate',
      header: 'Jatuh Tempo',
      sortable: true,
      render: (row) => {
        const overdue =
          row.dueDate && row.status !== 'CLOSED' && row.dueDate < new Date().toISOString().slice(0, 10);
        return (
          <span style={{ color: overdue ? 'var(--color-error)' : 'inherit', fontWeight: overdue ? 800 : 400 }}>
            {fmtDate(row.dueDate)}
          </span>
        );
      },
    },
    {
      key: 'actions',
      header: 'Corrective Action',
      sortable: false,
      render: (row) =>
        `${row.actions.filter((action) => action.status === 'VERIFIED').length}/${row.actions.length} terverifikasi`,
    },
    { key: 'status', header: 'Status', sortable: true, render: (row) => <StatusPill status={row.status} /> },
  ];

  const planColumns: ColumnDef<InspectionPlan>[] = [
    { key: 'planNumber', header: 'No.', sortable: true },
    { key: 'name', header: 'Nama Rencana', sortable: true },
    { key: 'inspectionType', header: 'Tipe', sortable: true },
    { key: 'productName', header: 'Produk', sortable: true, render: (row) => row.productName ?? 'Semua' },
    { key: 'processName', header: 'Proses', sortable: true, render: (row) => row.processName ?? 'Semua' },
    {
      key: 'samplingMethod',
      header: 'Sampling',
      sortable: true,
      render: (row) =>
        `${row.samplingMethod}${row.samplingQuantity ? ` · ${fmt(row.samplingQuantity)}` : ''}`,
    },
    {
      key: 'mandatory',
      header: 'Wajib',
      sortable: true,
      render: (row) =>
        row.mandatory ? <StatusPill status="WAJIB" tone="warning" /> : <StatusPill status="Opsional" tone="neutral" />,
    },
    { key: 'status', header: 'Status', sortable: true, render: (row) => <StatusPill status={row.status} /> },
  ];

  return (
    <Page>
      <Section>
        <PageHeading
          title="Quality Execution"
          subtitle="Inspeksi → hold → disposition → NCR. Kuantitas gagal wajib memiliki disposition, dan hold wajib memiliki owner serta alasan."
        />
      </Section>

      <Section>
        <KpiRow>
          <KpiTile
            label="First Pass Yield"
            value={dashboard ? `${dashboard.firstPassYield.toFixed(1)}%` : '—'}
            caption="First Pass Good ÷ Input × 100"
            tone={
              !dashboard ? 'neutral' : dashboard.firstPassYield >= 95 ? 'success' : dashboard.firstPassYield >= 85 ? 'warning' : 'error'
            }
            icon="verified"
          />
          <KpiTile
            label="Reject Rate"
            value={dashboard ? `${dashboard.failRate.toFixed(1)}%` : '—'}
            caption={dashboard ? `${fmt(dashboard.failedQuantity)} dari ${fmt(dashboard.inspectedQuantity)}` : ''}
            tone={dashboard && dashboard.failRate > 5 ? 'error' : 'success'}
            icon="report"
          />
          <KpiTile
            label="Quality Hold"
            value={dashboard ? fmt(dashboard.openHolds) : '—'}
            caption={dashboard ? `${fmt(dashboard.heldQuantity)} unit ditahan` : ''}
            tone={dashboard && dashboard.openHolds > 0 ? 'warning' : 'success'}
            icon="pan_tool"
          />
          <KpiTile
            label="Rework / Scrap"
            value={dashboard ? `${fmt(dashboard.reworkQuantity)} / ${fmt(dashboard.scrapQuantity)}` : '—'}
            caption="Hasil disposition"
            tone="chart-3"
            icon="recycling"
          />
          <KpiTile
            label="NCR Terbuka"
            value={dashboard ? fmt(dashboard.openNcr) : '—'}
            caption={dashboard ? `${fmt(dashboard.overdueNcr)} lewat jatuh tempo` : ''}
            tone={dashboard && dashboard.overdueNcr > 0 ? 'error' : 'info'}
            icon="assignment_late"
          />
        </KpiRow>
      </Section>

      <Section>
        <TabStrip
          active={tab}
          onChange={(key) => setTab(key as Tab)}
          tabs={[
            { key: 'inspections', label: 'Inspeksi', icon: 'fact_check' },
            { key: 'holds', label: 'Quality Hold', icon: 'pan_tool' },
            { key: 'dispositions', label: 'Disposition', icon: 'rule' },
            { key: 'ncr', label: 'NCR', icon: 'assignment_late' },
            { key: 'plans', label: 'Inspection Plan', icon: 'checklist' },
          ]}
        />
      </Section>

      {tab === 'inspections' ? (
        <Section style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-on-surface-variant)' }}>
            Hasil:
          </span>
          {(['ALL', 'PASS', 'FAIL'] as const).map((key) => (
            <FilterChip key={key} selected={resultFilter === key} onClick={() => setResultFilter(key)}>
              {key === 'ALL' ? 'Semua' : key}
            </FilterChip>
          ))}
        </Section>
      ) : null}

      <Section>
        {tab === 'inspections' &&
          (!isLoading && visibleInspections.length === 0 ? (
            <SurfaceCard padding="lg">
              <EmptyState
                icon="fact_check"
                title="Belum ada inspeksi"
                description="Inspeksi dicatat dari terminal operator atau dari layar ini setelah Inspection Plan dibuat pada tab Inspection Plan."
              />
            </SurfaceCard>
          ) : (
            <AdvancedDataTable
              columns={inspectionColumns}
              data={visibleInspections}
              title="Hasil Inspeksi"
              subtitle="Hasil keseluruhan diturunkan dari pengukuran: satu karakteristik di luar batas membuat inspeksi FAIL."
              searchable
              selectable={false}
              expandable
              renderExpandedRow={(row) => (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                      gap: 'var(--space-3)',
                    }}
                  >
                    <Field label="Rencana">{row.inspectionPlanName ?? '—'}</Field>
                    <Field label="Batch">{row.batchNumber ?? '—'}</Field>
                    <Field label="Lolos">{fmt(row.passedQuantity, 2)}</Field>
                    <Field label="Catatan">{row.notes ?? '—'}</Field>
                  </div>

                  {row.lines.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                      {row.lines.map((line) => (
                        <div
                          key={line.id}
                          style={{
                            display: 'flex',
                            gap: 'var(--space-3)',
                            alignItems: 'center',
                            fontSize: '12px',
                            color: 'var(--color-on-surface-variant)',
                          }}
                        >
                          <StatusPill status={line.result} />
                          <strong style={{ color: 'var(--color-on-surface)' }}>{line.characteristicName}</strong>
                          <span>
                            spesifikasi {line.expectedValue ?? '—'} · terukur{' '}
                            {line.actualValue ?? (line.numericValue !== undefined ? line.numericValue : '—')}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {row.result === 'FAIL' && !row.dispositionId ? (
                    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                      {can('quality:hold') ? (
                        <Button variant="tonal" size="sm" onClick={() => setHoldingFor(row)}>
                          <Icon name="pan_tool" size={16} />
                          Tahan Kuantitas
                        </Button>
                      ) : null}
                      {can('quality:disposition') ? (
                        <Button
                          variant="filled"
                          size="sm"
                          onClick={() => setDispositioning({ inspection: row })}
                        >
                          <Icon name="rule" size={16} />
                          Tetapkan Disposition
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )}
            />
          ))}

        {tab === 'holds' && (
          <AdvancedDataTable
            columns={holdColumns}
            data={holds ?? []}
            title="Quality Hold"
            subtitle="Kuantitas yang ditahan tidak dapat ditransfer ke proses berikutnya sampai dilepas atau memiliki disposition."
            searchable
            selectable={false}
            expandable
            renderExpandedRow={(row) =>
              row.status !== 'OPEN' ? (
                <span style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
                  Ditutup {fmtDateTime(row.releasedAt)} oleh {row.releasedBy ?? '—'}.
                </span>
              ) : (
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  {can('quality:release') ? (
                    <Button
                      variant="tonal"
                      size="sm"
                      onClick={() =>
                        releaseHold.mutate({ id: row.id, reason: 'Dilepas setelah verifikasi kualitas.' })
                      }
                      disabled={releaseHold.isPending}
                    >
                      <Icon name="lock_open" size={16} />
                      Lepas Hold
                    </Button>
                  ) : null}
                  {can('quality:disposition') ? (
                    <Button variant="filled" size="sm" onClick={() => setDispositioning({ hold: row })}>
                      <Icon name="rule" size={16} />
                      Tetapkan Disposition
                    </Button>
                  ) : null}
                </div>
              )
            }
          />
        )}

        {tab === 'dispositions' && (
          <AdvancedDataTable
            columns={dispositionColumns}
            data={dispositions ?? []}
            title="Quality Disposition"
            subtitle="SCRAP dan REWORK mengurangi kuantitas baik pada work order terkait; setiap keputusan tercatat di audit trail."
            searchable
            selectable={false}
          />
        )}

        {tab === 'ncr' && (
          <AdvancedDataTable
            columns={ncrColumns}
            data={ncrs ?? []}
            title="Non-Conformance Record"
            subtitle="NCR hanya dapat ditutup setelah seluruh corrective action terverifikasi."
            searchable
            selectable={false}
            expandable
            renderExpandedRow={(row) => (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
                  {row.description}
                </div>
                <Field label="Root Cause">{row.rootCause ?? 'Belum ditetapkan'}</Field>
                {row.actions.length === 0 ? (
                  <span style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
                    Belum ada corrective action.
                  </span>
                ) : (
                  row.actions.map((action) => (
                    <div
                      key={action.id}
                      style={{
                        display: 'flex',
                        gap: 'var(--space-2)',
                        alignItems: 'center',
                        fontSize: '12px',
                      }}
                    >
                      <StatusPill status={action.status} />
                      <span style={{ color: 'var(--color-on-surface)' }}>{action.action}</span>
                      <span style={{ color: 'var(--color-on-surface-variant)' }}>
                        {action.ownerName} · {fmtDate(action.dueDate)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}
          />
        )}

        {tab === 'plans' && (
          <AdvancedDataTable
            columns={planColumns}
            data={plans ?? []}
            title="Inspection Plan"
            subtitle="Rencana yang ditandai wajib memblokir handoff ke proses berikutnya sampai inspeksinya PASS."
            searchable
            selectable={false}
            expandable
            renderExpandedRow={(row) => (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                {row.characteristics.map((characteristic) => (
                  <div
                    key={characteristic.id}
                    style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)' }}
                  >
                    <strong style={{ color: 'var(--color-on-surface)' }}>{characteristic.name}</strong>{' '}
                    {characteristic.dataType === 'NUMERIC'
                      ? `· ${characteristic.lowerLimit ?? '−∞'} – ${characteristic.upperLimit ?? '∞'} ${characteristic.uom ?? ''}`
                      : `· ${characteristic.specification ?? 'Atribut'}`}
                    {characteristic.required ? ' · wajib' : ''}
                  </div>
                ))}
              </div>
            )}
          />
        )}
      </Section>

      {holdingFor ? (
        <HoldDialog
          inspection={holdingFor}
          ownerId={principal?.subjectId ?? ''}
          ownerName={principal?.name ?? ''}
          onClose={() => setHoldingFor(null)}
          onDone={() => {
            setHoldingFor(null);
            queryClient.invalidateQueries({ queryKey: ['quality-holds'] });
            queryClient.invalidateQueries({ queryKey: ['quality-dashboard'] });
          }}
        />
      ) : null}

      {dispositioning ? (
        <DispositionDialog
          hold={dispositioning.hold}
          inspection={dispositioning.inspection}
          onClose={() => setDispositioning(null)}
          onDone={() => {
            setDispositioning(null);
            queryClient.invalidateQueries({ queryKey: ['quality-holds'] });
            queryClient.invalidateQueries({ queryKey: ['quality-dispositions'] });
            queryClient.invalidateQueries({ queryKey: ['quality-inspections'] });
            queryClient.invalidateQueries({ queryKey: ['quality-dashboard'] });
          }}
        />
      ) : null}
    </Page>
  );
};

/** §4.4 — a hold needs an owner and a reason, and the form insists on both. */
const HoldDialog: React.FC<{
  inspection: Inspection;
  ownerId: string;
  ownerName: string;
  onClose: () => void;
  onDone: () => void;
}> = ({ inspection, ownerId, ownerName, onClose, onDone }) => {
  const [quantity, setQuantity] = useState(String(inspection.failedQuantity));
  const [reason, setReason] = useState('');

  const create = useMutation({
    mutationFn: () =>
      api.quality.createHold({
        quantity: Number(quantity),
        reason,
        ownerId,
        ownerName,
        workOrderId: inspection.workOrderId,
        batchId: inspection.batchId,
        productId: inspection.productId,
        inspectionId: inspection.id,
        uom: inspection.uom,
      }),
    onSuccess: onDone,
  });

  return (
    <Dialog
      isOpen
      onClose={onClose}
      title={`Tahan Kuantitas · ${inspection.inspectionNumber}`}
      supportingText="Kuantitas yang ditahan tidak dapat digunakan pada proses berikutnya sampai dilepas atau memiliki disposition."
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <FilledTextField
          label="Kuantitas Ditahan"
          type="number"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
        <FilledTextField
          label="Alasan"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          supportingText="Wajib diisi."
        />
        <FilledTextField label="Owner" value={ownerName} disabled onChange={() => undefined} />
        {create.isError ? (
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--color-error)' }}>
            {(create.error as Error).message}
          </p>
        ) : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
          <Button variant="text" onClick={onClose}>
            Batal
          </Button>
          <Button
            variant="filled"
            onClick={() => create.mutate()}
            disabled={create.isPending || reason.trim().length < 3 || Number(quantity) <= 0}
          >
            Tahan Kuantitas
          </Button>
        </div>
      </div>
    </Dialog>
  );
};

/** §4.5 / US-Q002 — decision, quantity and reason, all three mandatory. */
const DispositionDialog: React.FC<{
  hold?: QualityHold;
  inspection?: Inspection;
  onClose: () => void;
  onDone: () => void;
}> = ({ hold, inspection, onClose, onDone }) => {
  const [decision, setDecision] = useState<'RELEASE' | 'REWORK' | 'SCRAP' | 'HOLD' | 'RETURN'>('REWORK');
  const [quantity, setQuantity] = useState(String(hold?.quantity ?? inspection?.failedQuantity ?? 0));
  const [reason, setReason] = useState('');

  const create = useMutation({
    mutationFn: () =>
      api.quality.createDisposition({
        decision,
        quantity: Number(quantity),
        reason,
        qualityHoldId: hold?.id,
        inspectionId: inspection?.id ?? hold?.inspectionId,
        workOrderId: hold?.workOrderId ?? inspection?.workOrderId,
        batchId: hold?.batchId ?? inspection?.batchId,
        productId: hold?.productId ?? inspection?.productId,
        uom: hold?.uom ?? inspection?.uom,
      }),
    onSuccess: onDone,
  });

  return (
    <Dialog
      isOpen
      onClose={onClose}
      title={`Disposition · ${hold?.holdNumber ?? inspection?.inspectionNumber ?? ''}`}
      supportingText="SCRAP dan REWORK memindahkan kuantitas pada work order terkait. Setiap keputusan tercatat di audit trail."
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <Select
          label="Keputusan"
          value={decision}
          onChange={(value) => setDecision(value as typeof decision)}
          options={[
            { value: 'RELEASE', label: 'Release — dilepas untuk digunakan' },
            { value: 'REWORK', label: 'Rework — dikerjakan ulang' },
            { value: 'SCRAP', label: 'Scrap — dibuang' },
            { value: 'HOLD', label: 'Hold — ditahan lebih lanjut' },
            { value: 'RETURN', label: 'Return — dikembalikan' },
          ]}
        />
        <FilledTextField
          label="Kuantitas"
          type="number"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
        <FilledTextField
          label="Alasan"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          supportingText="Wajib diisi."
        />
        {create.isError ? (
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--color-error)' }}>
            {(create.error as Error).message}
          </p>
        ) : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
          <Button variant="text" onClick={onClose}>
            Batal
          </Button>
          <Button
            variant="filled"
            onClick={() => create.mutate()}
            disabled={create.isPending || reason.trim().length < 3 || Number(quantity) <= 0}
          >
            Simpan Disposition
          </Button>
        </div>
      </div>
    </Dialog>
  );
};
