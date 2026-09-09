import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FactoryVisionApiClient } from '@factory-vision/api-client';
import { AdvancedDataTable, Button, ColumnDef, FilledTextField, Icon, Select } from '@factory-vision/ui';
import { Page, Section, SurfaceCard, Dialog, FilterChip } from '@factory-vision/ui/fv';
import type { WipReceipt, WipRecord, WipTransfer } from '@factory-vision/domain-types';
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
  fmtDateTime,
} from './shared.js';

const api = new FactoryVisionApiClient({ baseUrl: '' });

type Tab = 'records' | 'transfers' | 'receipts';

/**
 * WIP and process handoff (Improvement PRD §7, §8, §21).
 *
 * The screen answers §45's WIP questions in order: how much WIP, at which
 * process, which of it is ageing, and where the bottleneck is. Aging is the
 * column that earns its place — a quantity sitting at a process for three days
 * is the thing nobody notices without a screen that says so.
 */
export const WipPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { can } = useSession();
  const [tab, setTab] = useState<Tab>('records');
  const [agingOnly, setAgingOnly] = useState(false);
  const [transferring, setTransferring] = useState<WipRecord | null>(null);
  const [receiving, setReceiving] = useState<WipTransfer | null>(null);

  const { data: dashboard } = useQuery({
    queryKey: ['wip-dashboard'],
    queryFn: () => api.wip.getDashboard(),
    refetchInterval: 30_000,
  });
  const { data: records, isLoading } = useQuery({
    queryKey: ['wip-records', agingOnly],
    queryFn: () => api.wip.getRecords({ agingOnly, limit: 500 }),
    refetchInterval: 30_000,
  });
  const { data: transfers } = useQuery({
    queryKey: ['wip-transfers'],
    queryFn: () => api.wip.getTransfers({ limit: 300 }),
    refetchInterval: 30_000,
  });
  const { data: receipts } = useQuery({
    queryKey: ['wip-receipts'],
    queryFn: () => api.wip.getReceipts(),
    enabled: tab === 'receipts',
  });
  const { data: workOrders } = useQuery({
    queryKey: ['work-orders-for-wip'],
    queryFn: () => api.workOrders.list(),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['wip-records'] });
    queryClient.invalidateQueries({ queryKey: ['wip-transfers'] });
    queryClient.invalidateQueries({ queryKey: ['wip-receipts'] });
    queryClient.invalidateQueries({ queryKey: ['wip-dashboard'] });
  };

  const hold = useMutation({
    mutationFn: (input: { id: string; reason: string }) => api.wip.holdRecord(input.id, input.reason),
    onSuccess: invalidate,
  });
  const release = useMutation({
    mutationFn: (input: { id: string; reason: string }) => api.wip.releaseRecord(input.id, input.reason),
    onSuccess: invalidate,
  });

  const recordColumns: ColumnDef<WipRecord>[] = [
    { key: 'wipNumber', header: 'No. WIP', sortable: true },
    {
      key: 'productName',
      header: 'Produk',
      sortable: true,
      render: (row) => (
        <div>
          <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--color-on-surface)' }}>
            {row.productSku ?? row.productName}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>{row.productName}</div>
        </div>
      ),
    },
    { key: 'workOrderNumber', header: 'Work Order', sortable: true },
    {
      key: 'sourceProcessName',
      header: 'Proses',
      sortable: true,
      render: (row) => row.sourceProcessName ?? '—',
    },
    {
      key: 'quantity',
      header: 'Kuantitas',
      sortable: true,
      render: (row) => `${fmt(row.quantity, 2)} ${row.uom}`,
    },
    {
      key: 'ageHours',
      header: 'Umur',
      sortable: true,
      render: (row) => (
        <span
          style={{
            fontWeight: row.agingStatus === 'NORMAL' ? 400 : 800,
            color:
              row.agingStatus === 'CRITICAL'
                ? 'var(--color-error)'
                : row.agingStatus === 'AGING'
                  ? 'var(--color-warning)'
                  : 'var(--color-on-surface-variant)',
          }}
        >
          {fmt(row.ageHours, 1)} jam
        </span>
      ),
    },
    {
      key: 'qualityStatus',
      header: 'Kualitas',
      sortable: true,
      render: (row) => <StatusPill status={row.qualityStatus} />,
    },
    { key: 'status', header: 'Status', sortable: true, render: (row) => <StatusPill status={row.status} /> },
  ];

  const transferColumns: ColumnDef<WipTransfer>[] = [
    { key: 'transferNumber', header: 'No. Transfer', sortable: true },
    { key: 'transferredAt', header: 'Dikirim', sortable: true, render: (row) => fmtDateTime(row.transferredAt) },
    { key: 'productName', header: 'Produk', sortable: true },
    { key: 'sourceWorkOrderNumber', header: 'Dari WO', sortable: true },
    {
      key: 'destinationWorkOrderNumber',
      header: 'Ke WO',
      sortable: true,
      render: (row) => row.destinationWorkOrderNumber ?? 'Belum ditentukan',
    },
    {
      key: 'quantity',
      header: 'Dikirim',
      sortable: true,
      render: (row) => `${fmt(row.quantity, 2)} ${row.uom}`,
    },
    { key: 'createdByName', header: 'Oleh', sortable: true, render: (row) => row.createdByName ?? row.createdBy },
    { key: 'status', header: 'Status', sortable: true, render: (row) => <StatusPill status={row.status} /> },
  ];

  const receiptColumns: ColumnDef<WipReceipt>[] = [
    { key: 'transferNumber', header: 'Transfer', sortable: true },
    { key: 'receivedAt', header: 'Diterima', sortable: true, render: (row) => fmtDateTime(row.receivedAt) },
    {
      key: 'transferredQuantity',
      header: 'Dikirim',
      sortable: true,
      render: (row) => `${fmt(row.transferredQuantity, 2)} ${row.uom}`,
    },
    {
      key: 'receivedQuantity',
      header: 'Diterima',
      sortable: true,
      render: (row) => fmt(row.receivedQuantity, 2),
    },
    {
      key: 'varianceQuantity',
      header: 'Selisih',
      sortable: true,
      render: (row) => (
        <span
          style={{
            fontWeight: 800,
            color: row.varianceQuantity === 0 ? 'var(--color-on-surface-variant)' : 'var(--color-error)',
          }}
        >
          {fmt(row.varianceQuantity, 2)}
        </span>
      ),
    },
    {
      key: 'varianceReason',
      header: 'Alasan Selisih',
      sortable: false,
      render: (row) => row.varianceReason ?? '—',
    },
    { key: 'result', header: 'Hasil', sortable: true, render: (row) => <StatusPill status={row.result} /> },
  ];

  const pendingTransfers = (transfers ?? []).filter((row) => row.status === 'IN_TRANSIT');

  return (
    <Page>
      <Section>
        <PageHeading
          title="WIP & Process Handoff"
          subtitle="Kuantitas yang sudah masuk proses tetapi belum menjadi output akhir. Transfer dan penerimaan dicatat terpisah, sehingga selisihnya memiliki alasan."
        />
      </Section>

      <Section>
        <KpiRow>
          <KpiTile
            label="Total WIP"
            value={dashboard ? `${fmt(dashboard.totalWip, 1)} ${dashboard.uom}` : '—'}
            caption="Belum menjadi finished goods"
            tone="primary"
            icon="inventory"
          />
          <KpiTile
            label="WIP Aging"
            value={dashboard ? fmt(dashboard.aging.aging + dashboard.aging.critical) : '—'}
            caption={
              dashboard
                ? `≥ ${dashboard.agingThresholdHours} jam · ${fmt(dashboard.aging.critical)} kritis`
                : ''
            }
            tone={dashboard && dashboard.aging.critical > 0 ? 'error' : 'warning'}
            icon="hourglass_bottom"
          />
          <KpiTile
            label="Stuck"
            value={dashboard ? fmt(dashboard.stuckRecords) : '—'}
            caption={dashboard ? `≥ ${dashboard.criticalThresholdHours} jam tanpa bergerak` : ''}
            tone={dashboard && dashboard.stuckRecords > 0 ? 'error' : 'success'}
            icon="block"
          />
          <KpiTile
            label="Menunggu Transfer"
            value={dashboard ? fmt(dashboard.waitingTransferQuantity, 1) : '—'}
            caption={`${pendingTransfers.length} transfer dalam perjalanan`}
            tone="info"
            icon="local_shipping"
          />
          <KpiTile
            label="WIP On Hold"
            value={dashboard ? fmt(dashboard.onHoldQuantity, 1) : '—'}
            caption="Tidak boleh dipakai tanpa pelepasan"
            tone={dashboard && dashboard.onHoldQuantity > 0 ? 'error' : 'success'}
            icon="pan_tool"
          />
        </KpiRow>
      </Section>

      {dashboard && dashboard.byProcess.length > 0 ? (
        <Section>
          <SurfaceCard padding="md">
            <h3
              style={{
                margin: `0 0 var(--space-3)`,
                fontSize: '13px',
                fontWeight: 800,
                color: 'var(--color-on-surface)',
              }}
            >
              WIP per Proses
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {dashboard.byProcess.slice(0, 8).map((entry) => {
                const max = Math.max(...dashboard.byProcess.map((item) => item.quantity), 1);
                return (
                  <div
                    key={entry.processId}
                    style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}
                  >
                    <span
                      style={{
                        minWidth: '140px',
                        fontSize: '12px',
                        fontWeight: 700,
                        color: 'var(--color-on-surface)',
                      }}
                    >
                      {entry.processName}
                    </span>
                    <div
                      style={{
                        flex: 1,
                        height: '10px',
                        borderRadius: 'var(--radius-pill)',
                        backgroundColor: 'var(--color-surface-container-high)',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${(entry.quantity / max) * 100}%`,
                          height: '100%',
                          backgroundColor: 'var(--color-chart-primary)',
                        }}
                      />
                    </div>
                    <span
                      style={{
                        minWidth: '110px',
                        textAlign: 'right',
                        fontSize: '12px',
                        fontWeight: 800,
                        color: 'var(--color-on-surface)',
                      }}
                    >
                      {fmt(entry.quantity, 1)} · {entry.records} baris
                    </span>
                  </div>
                );
              })}
            </div>
          </SurfaceCard>
        </Section>
      ) : null}

      <Section>
        <TabStrip
          active={tab}
          onChange={(key) => setTab(key as Tab)}
          tabs={[
            { key: 'records', label: 'WIP', icon: 'inventory' },
            { key: 'transfers', label: 'Transfer', icon: 'swap_horiz' },
            { key: 'receipts', label: 'Penerimaan', icon: 'inbox' },
          ]}
        />
      </Section>

      {tab === 'records' ? (
        <Section style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-on-surface-variant)' }}>
            Tampilkan:
          </span>
          <FilterChip selected={!agingOnly} onClick={() => setAgingOnly(false)}>
            Semua WIP
          </FilterChip>
          <FilterChip selected={agingOnly} onClick={() => setAgingOnly(true)}>
            Hanya Aging
          </FilterChip>
        </Section>
      ) : null}

      <Section>
        {tab === 'records' &&
          (!isLoading && (records ?? []).length === 0 ? (
            <SurfaceCard padding="lg">
              <EmptyState
                icon="inventory"
                title="Tidak ada WIP terbuka"
                description="WIP dibuat ketika output sebuah proses dicatat dan belum diteruskan ke proses berikutnya."
              />
            </SurfaceCard>
          ) : (
            <AdvancedDataTable
              columns={recordColumns}
              data={records ?? []}
              title="Catatan WIP"
              subtitle="Umur dihitung sejak WIP dibuat. WIP berstatus ON_HOLD tidak dapat ditransfer tanpa pelepasan resmi."
              searchable
              selectable={false}
              expandable
              renderExpandedRow={(row) => (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                      gap: 'var(--space-3)',
                    }}
                  >
                    <Field label="Batch">{row.batchNumber ?? '—'}</Field>
                    <Field label="Proses Tujuan">{row.destinationProcessName ?? 'Belum ditentukan'}</Field>
                    <Field label="Lokasi">{row.locationName ?? '—'}</Field>
                    <Field label="Dibuat">{fmtDateTime(row.createdAt)}</Field>
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                    {row.status !== 'ON_HOLD' && can('wip:transfer') ? (
                      <Button variant="filled" size="sm" onClick={() => setTransferring(row)}>
                        <Icon name="swap_horiz" size={16} />
                        Transfer ke Proses Berikutnya
                      </Button>
                    ) : null}
                    {row.status !== 'ON_HOLD' && can('wip:hold') ? (
                      <Button
                        variant="tonal"
                        size="sm"
                        onClick={() =>
                          hold.mutate({ id: row.id, reason: 'Ditahan menunggu keputusan kualitas.' })
                        }
                        disabled={hold.isPending}
                      >
                        <Icon name="pan_tool" size={16} />
                        Tahan
                      </Button>
                    ) : null}
                    {row.status === 'ON_HOLD' && can('wip:release') ? (
                      <Button
                        variant="tonal"
                        size="sm"
                        onClick={() =>
                          release.mutate({ id: row.id, reason: 'Dilepas setelah verifikasi kualitas.' })
                        }
                        disabled={release.isPending}
                      >
                        <Icon name="lock_open" size={16} />
                        Lepas
                      </Button>
                    ) : null}
                  </div>
                </div>
              )}
            />
          ))}

        {tab === 'transfers' && (
          <AdvancedDataTable
            columns={transferColumns}
            data={transfers ?? []}
            title="Transfer WIP"
            subtitle="Transfer diblokir bila quality gate aktif dan inspeksi wajib belum PASS."
            searchable
            selectable={false}
            expandable
            renderExpandedRow={(row) =>
              row.status === 'IN_TRANSIT' && can('wip:receive') ? (
                <Button variant="filled" size="sm" onClick={() => setReceiving(row)}>
                  <Icon name="inbox" size={16} />
                  Terima di Proses Tujuan
                </Button>
              ) : (
                <span style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
                  {row.notes ?? 'Tidak ada catatan tambahan.'}
                </span>
              )
            }
          />
        )}

        {tab === 'receipts' && (
          <AdvancedDataTable
            columns={receiptColumns}
            data={receipts ?? []}
            title="Penerimaan WIP"
            subtitle="Selisih antara yang dikirim dan yang diterima wajib memiliki alasan, dan tercatat di audit trail."
            searchable
            selectable={false}
          />
        )}
      </Section>

      {transferring ? (
        <TransferDialog
          wip={transferring}
          workOrders={(workOrders ?? []).map((workOrder) => ({
            value: workOrder.id,
            label: `${workOrder.woNumber} — ${workOrder.status}`,
          }))}
          onClose={() => setTransferring(null)}
          onDone={() => {
            setTransferring(null);
            invalidate();
          }}
        />
      ) : null}

      {receiving ? (
        <ReceiveDialog
          transfer={receiving}
          onClose={() => setReceiving(null)}
          onDone={() => {
            setReceiving(null);
            invalidate();
          }}
        />
      ) : null}
    </Page>
  );
};

/** §8.2 — a transfer names its destination and its quantity, and nothing else. */
const TransferDialog: React.FC<{
  wip: WipRecord;
  workOrders: Array<{ value: string; label: string }>;
  onClose: () => void;
  onDone: () => void;
}> = ({ wip, workOrders, onClose, onDone }) => {
  const [quantity, setQuantity] = useState(String(wip.quantity));
  const [destinationWorkOrderId, setDestinationWorkOrderId] = useState('');
  const [notes, setNotes] = useState('');

  const create = useMutation({
    mutationFn: () =>
      api.wip.createTransfer({
        wipId: wip.id,
        quantity: Number(quantity),
        destinationWorkOrderId: destinationWorkOrderId || undefined,
        notes: notes || undefined,
      }),
    onSuccess: onDone,
  });

  return (
    <Dialog
      isOpen
      onClose={onClose}
      title={`Transfer ${wip.wipNumber}`}
      supportingText={`${wip.productName} dari ${wip.workOrderNumber}. Kuantitas menjadi IN_TRANSIT sampai proses tujuan menerimanya.`}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <FilledTextField
          label={`Kuantitas (maks ${fmt(wip.quantity, 2)} ${wip.uom})`}
          type="number"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
        <Select
          label="Work Order Tujuan"
          value={destinationWorkOrderId}
          onChange={setDestinationWorkOrderId}
          options={workOrders}
          placeholder="Pilih work order proses berikutnya"
          searchable
        />
        <FilledTextField label="Catatan" value={notes} onChange={(e) => setNotes(e.target.value)} />
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
            disabled={create.isPending || Number(quantity) <= 0 || Number(quantity) > wip.quantity}
          >
            Kirim Transfer
          </Button>
        </div>
      </div>
    </Dialog>
  );
};

/** §8.3 / BR-WIP04 — a shortfall cannot be saved without a reason. */
const ReceiveDialog: React.FC<{ transfer: WipTransfer; onClose: () => void; onDone: () => void }> = ({
  transfer,
  onClose,
  onDone,
}) => {
  const [receivedQuantity, setReceivedQuantity] = useState(String(transfer.quantity));
  const [varianceReason, setVarianceReason] = useState('');

  const receive = useMutation({
    mutationFn: () =>
      api.wip.receiveTransfer(transfer.id, {
        receivedQuantity: Number(receivedQuantity),
        varianceReason: varianceReason || undefined,
      }),
    onSuccess: onDone,
  });

  const variance = transfer.quantity - Number(receivedQuantity || 0);
  const needsReason = variance !== 0;

  return (
    <Dialog
      isOpen
      onClose={onClose}
      title={`Terima ${transfer.transferNumber}`}
      supportingText={`Dikirim ${fmt(transfer.quantity, 2)} ${transfer.uom} dari ${transfer.sourceWorkOrderNumber}. Kuantitas yang diterima menjadi input proses tujuan.`}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <FilledTextField
          label={`Kuantitas Diterima (${transfer.uom})`}
          type="number"
          value={receivedQuantity}
          onChange={(e) => setReceivedQuantity(e.target.value)}
          supportingText={
            variance === 0
              ? 'Sesuai dengan yang dikirim.'
              : `Selisih ${fmt(variance, 2)} ${transfer.uom} — alasan wajib diisi.`
          }
        />
        {needsReason ? (
          <FilledTextField
            label="Alasan Selisih"
            value={varianceReason}
            onChange={(e) => setVarianceReason(e.target.value)}
            supportingText="Misalnya: rusak dalam perjalanan, salah hitung di sumber, tertahan inspeksi."
          />
        ) : null}
        {receive.isError ? (
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--color-error)' }}>
            {(receive.error as Error).message}
          </p>
        ) : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
          <Button variant="text" onClick={onClose}>
            Batal
          </Button>
          <Button
            variant="filled"
            onClick={() => receive.mutate()}
            disabled={receive.isPending || (needsReason && varianceReason.trim().length < 3)}
          >
            Catat Penerimaan
          </Button>
        </div>
      </div>
    </Dialog>
  );
};
