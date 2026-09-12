import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FactoryVisionApiClient } from '@factory-vision/api-client';
import { Button, ColumnDef, FilledTextField, Icon } from '@factory-vision/ui';
import { DataTable, Page, Section, SurfaceCard, Dialog } from '@factory-vision/ui/fv';
import type {
  MaterialConsumption,
  MaterialInventory,
  MaterialReservation,
  MaterialTransaction,
} from '@factory-vision/domain-types';
import { useSession } from '../../app/SessionContext.js';
import {
  EmptyState,
  KpiRow,
  KpiTile,
  PageHeading,
  StatusPill,
  TabStrip,
  fmt,
  fmtDateTime,
} from './shared.js';

const api = new FactoryVisionApiClient({ baseUrl: '' });

type Tab = 'inventory' | 'reservations' | 'consumption' | 'transactions';

/**
 * Materials (Improvement PRD §3, §21's Materials group).
 *
 * Four views of the same stock, in the order the material moves: what is on
 * hand, what is promised, what was used, and the ledger that explains all
 * three. Kept on one screen with tabs rather than four sidebar entries because
 * a warehouse controller answering "why is stock 7.000" moves between them in
 * one sitting.
 */
export const MaterialsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { can } = useSession();
  const [tab, setTab] = useState<Tab>('inventory');
  const [adjusting, setAdjusting] = useState<MaterialInventory | null>(null);

  const { data: inventory, isLoading: inventoryLoading } = useQuery({
    queryKey: ['material-inventory'],
    queryFn: () => api.materials.getInventory(),
    refetchInterval: 30_000,
  });
  const { data: reservations } = useQuery({
    queryKey: ['material-reservations'],
    queryFn: () => api.materials.getReservations(),
    enabled: tab === 'reservations',
  });
  const { data: consumption } = useQuery({
    queryKey: ['material-consumption'],
    queryFn: () => api.materials.getConsumption({ limit: 300 }),
    enabled: tab === 'consumption',
  });
  const { data: transactions } = useQuery({
    queryKey: ['material-transactions'],
    queryFn: () => api.materials.getTransactions({ limit: 300 }),
    enabled: tab === 'transactions',
  });

  const rows = inventory ?? [];
  const belowReorder = rows.filter(
    (row) => row.reorderPoint !== undefined && row.availableQuantity <= row.reorderPoint
  );
  const totalReserved = rows.reduce((sum, row) => sum + row.reservedQuantity, 0);
  const totalIncoming = rows.reduce((sum, row) => sum + row.incomingQuantity, 0);

  const inventoryColumns: ColumnDef<MaterialInventory>[] = [
    {
      key: 'materialSku',
      header: 'Material',
      sortable: true,
      width: '24%',
      render: (row) => (
        <div>
          <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--color-on-surface)' }}>
            {row.materialSku}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>{row.materialName}</div>
        </div>
      ),
    },
    { key: 'warehouseName', header: 'Gudang', sortable: true },
    {
      key: 'onHandQuantity',
      header: 'On Hand',
      sortable: true,
      render: (row) => `${fmt(row.onHandQuantity, 2)} ${row.uom}`,
    },
    { key: 'reservedQuantity', header: 'Reserved', sortable: true, render: (row) => fmt(row.reservedQuantity, 2) },
    { key: 'incomingQuantity', header: 'Incoming', sortable: true, render: (row) => fmt(row.incomingQuantity, 2) },
    {
      key: 'availableQuantity',
      header: 'Available',
      sortable: true,
      render: (row) => {
        const low = row.reorderPoint !== undefined && row.availableQuantity <= row.reorderPoint;
        return (
          <span
            style={{
              fontWeight: 800,
              color: low ? 'var(--color-error)' : 'var(--color-on-surface)',
            }}
          >
            {fmt(row.availableQuantity, 2)}
          </span>
        );
      },
    },
    {
      key: 'reorderPoint',
      header: 'Reorder',
      sortable: true,
      render: (row) => (row.reorderPoint === undefined ? '—' : fmt(row.reorderPoint, 2)),
    },
    { key: 'state', header: 'Status', sortable: true, render: (row) => <StatusPill status={row.state} /> },
  ];

  const reservationColumns: ColumnDef<MaterialReservation>[] = [
    { key: 'materialSku', header: 'Material', sortable: true },
    { key: 'materialName', header: 'Nama', sortable: true },
    { key: 'workOrderNumber', header: 'Work Order', sortable: true, render: (row) => row.workOrderNumber ?? '—' },
    { key: 'quantity', header: 'Kuantitas', sortable: true, render: (row) => `${fmt(row.quantity, 2)} ${row.uom}` },
    { key: 'reservedAt', header: 'Direservasi', sortable: true, render: (row) => fmtDateTime(row.reservedAt) },
    { key: 'status', header: 'Status', sortable: true, render: (row) => <StatusPill status={row.status} /> },
  ];

  const consumptionColumns: ColumnDef<MaterialConsumption>[] = [
    { key: 'consumedAt', header: 'Waktu', sortable: true, render: (row) => fmtDateTime(row.consumedAt) },
    { key: 'workOrderNumber', header: 'Work Order', sortable: true },
    {
      key: 'materialSku',
      header: 'Material',
      sortable: true,
      render: (row) => (
        <div>
          <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--color-on-surface)' }}>
            {row.materialSku}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>{row.materialName}</div>
        </div>
      ),
    },
    {
      key: 'plannedQuantity',
      header: 'Rencana',
      sortable: true,
      render: (row) => `${fmt(row.plannedQuantity, 2)} ${row.uom}`,
    },
    { key: 'actualQuantity', header: 'Aktual', sortable: true, render: (row) => fmt(row.actualQuantity, 2) },
    {
      key: 'varianceQuantity',
      header: 'Variance',
      sortable: true,
      render: (row) => (
        <span
          style={{
            fontWeight: 800,
            color:
              row.status === 'NORMAL'
                ? 'var(--color-on-surface-variant)'
                : row.status === 'OVER_CONSUMPTION'
                  ? 'var(--color-error)'
                  : 'var(--color-warning)',
          }}
        >
          {row.varianceQuantity > 0 ? '+' : ''}
          {fmt(row.varianceQuantity, 2)}
          {row.plannedQuantity > 0 ? ` (${row.variancePercentage.toFixed(1)}%)` : ''}
        </span>
      ),
    },
    { key: 'consumptionType', header: 'Jenis', sortable: true },
    { key: 'status', header: 'Status', sortable: true, render: (row) => <StatusPill status={row.status} /> },
  ];

  const transactionColumns: ColumnDef<MaterialTransaction>[] = [
    { key: 'occurredAt', header: 'Waktu', sortable: true, render: (row) => fmtDateTime(row.occurredAt) },
    { key: 'materialSku', header: 'Material', sortable: true },
    {
      key: 'transactionType',
      header: 'Transaksi',
      sortable: true,
      render: (row) => <StatusPill status={row.transactionType} tone="info" />,
    },
    {
      key: 'quantity',
      header: 'Kuantitas',
      sortable: true,
      render: (row) => (
        <span
          style={{
            fontWeight: 700,
            color: row.quantity < 0 ? 'var(--color-error)' : 'var(--color-success)',
          }}
        >
          {row.quantity > 0 ? '+' : ''}
          {fmt(row.quantity, 2)} {row.uom}
        </span>
      ),
    },
    { key: 'balanceAfter', header: 'Saldo', sortable: true, render: (row) => fmt(row.balanceAfter, 2) },
    { key: 'reason', header: 'Alasan', sortable: false, render: (row) => row.reason ?? '—' },
    { key: 'actorName', header: 'Oleh', sortable: true, render: (row) => row.actorName ?? row.actorId },
  ];

  return (
    <Page>
      <Section>
        <PageHeading
          title="Material & Inventory"
          subtitle="Stok, reservasi, konsumsi, dan ledger transaksi material. Setiap perubahan stok memiliki satu baris ledger yang menjelaskannya."
        />
      </Section>

      <Section>
        <KpiRow>
          <KpiTile
            label="Material Dipantau"
            value={fmt(rows.length)}
            caption="Baris stok aktif"
            tone="primary"
            icon="inventory_2"
          />
          <KpiTile
            label="Di Bawah Reorder"
            value={fmt(belowReorder.length)}
            caption="Perlu pengadaan"
            tone={belowReorder.length > 0 ? 'error' : 'success'}
            icon="production_quantity_limits"
          />
          <KpiTile
            label="Reserved"
            value={fmt(totalReserved, 1)}
            caption="Dialokasikan ke work order"
            tone="info"
            icon="bookmark"
          />
          <KpiTile
            label="Incoming"
            value={fmt(totalIncoming, 1)}
            caption="Supply terjadwal"
            tone="chart-2"
            icon="local_shipping"
          />
        </KpiRow>
      </Section>

      <Section>
        <TabStrip
          active={tab}
          onChange={(key) => setTab(key as Tab)}
          tabs={[
            { key: 'inventory', label: 'Inventory', icon: 'inventory_2' },
            { key: 'reservations', label: 'Reservasi', icon: 'bookmark' },
            { key: 'consumption', label: 'Konsumsi', icon: 'trending_down' },
            { key: 'transactions', label: 'Ledger Transaksi', icon: 'receipt_long' },
          ]}
        />
      </Section>

      <Section>
        {tab === 'inventory' &&
          (!inventoryLoading && rows.length === 0 ? (
            <SurfaceCard padding="lg">
              <EmptyState
                icon="inventory_2"
                title="Belum ada stok material"
                description="Catat penerimaan material atau lakukan penyesuaian stok untuk memulai. Stok dihitung sebagai On Hand − Reserved + Incoming."
              />
            </SurfaceCard>
          ) : (
            <DataTable
              columns={inventoryColumns}
              data={rows}
              title="Stok Material"
              subtitle="Available = On Hand − Reserved + Incoming. Baris merah berada pada atau di bawah reorder point."
              searchable
              expandable
              renderExpandedRow={(row) => (
                <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
                  <span style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
                    Safety stock: {row.safetyStock === undefined ? '—' : fmt(row.safetyStock, 2)} · Diperbarui{' '}
                    {fmtDateTime(row.updatedAt)}
                  </span>
                  {can('material:adjust') ? (
                    <Button variant="tonal" size="sm" onClick={() => setAdjusting(row)}>
                      <Icon name="tune" size={16} />
                      Sesuaikan Stok
                    </Button>
                  ) : null}
                </div>
              )}
            />
          ))}

        {tab === 'reservations' && (
          <DataTable
            columns={reservationColumns}
            data={reservations ?? []}
            title="Reservasi Material"
            subtitle="Reservasi tidak memindahkan stok fisik; ia mengurangi Available agar work order lain tidak menghitungnya dua kali."
            searchable
          />
        )}

        {tab === 'consumption' && (
          <DataTable
            columns={consumptionColumns}
            data={consumption ?? []}
            title="Konsumsi Material"
            subtitle="Variance = Aktual − Rencana. Rencana diambil dari kebutuhan BOM work order terkait."
            searchable
          />
        )}

        {tab === 'transactions' && (
          <DataTable
            columns={transactionColumns}
            data={transactions ?? []}
            title="Ledger Transaksi Material"
            subtitle="Append-only. Setiap baris mencatat saldo setelah pergerakan, sehingga riwayat stok terbaca tanpa memutar ulang seluruh histori."
            searchable
          />
        )}
      </Section>

      {adjusting ? (
        <StockAdjustDialog
          inventory={adjusting}
          onClose={() => setAdjusting(null)}
          onDone={() => {
            setAdjusting(null);
            queryClient.invalidateQueries({ queryKey: ['material-inventory'] });
            queryClient.invalidateQueries({ queryKey: ['material-transactions'] });
          }}
        />
      ) : null}
    </Page>
  );
};

/**
 * A stock take (§39: every material adjustment is audited).
 *
 * The reason is mandatory here as well as on the API, because the person who
 * reads it later is a warehouse controller reconciling a count, and "—" is not
 * an explanation.
 */
const StockAdjustDialog: React.FC<{
  inventory: MaterialInventory;
  onClose: () => void;
  onDone: () => void;
}> = ({ inventory, onClose, onDone }) => {
  const [quantity, setQuantity] = useState(String(inventory.onHandQuantity));
  const [reorderPoint, setReorderPoint] = useState(
    inventory.reorderPoint === undefined ? '' : String(inventory.reorderPoint)
  );
  const [reason, setReason] = useState('');

  const adjust = useMutation({
    mutationFn: () =>
      api.materials.adjustInventory({
        materialId: inventory.materialId,
        warehouseId: inventory.warehouseId,
        onHandQuantity: Number(quantity),
        reorderPoint: reorderPoint === '' ? undefined : Number(reorderPoint),
        reason,
      }),
    onSuccess: onDone,
  });

  const delta = Number(quantity) - inventory.onHandQuantity;

  return (
    <Dialog
      isOpen
      onClose={onClose}
      title={`Sesuaikan Stok · ${inventory.materialSku}`}
      supportingText={`${inventory.materialName} di ${inventory.warehouseName}. Selisih akan tercatat sebagai ADJUSTMENT pada ledger transaksi dan pada audit trail.`}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <FilledTextField
          label={`Stok On Hand (${inventory.uom})`}
          type="number"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          supportingText={
            delta === 0
              ? 'Tidak ada perubahan stok.'
              : `Selisih ${delta > 0 ? '+' : ''}${fmt(delta, 2)} ${inventory.uom} akan ditulis ke ledger.`
          }
        />
        <FilledTextField
          label="Reorder Point (opsional)"
          type="number"
          value={reorderPoint}
          onChange={(e) => setReorderPoint(e.target.value)}
        />
        <FilledTextField
          label="Alasan Penyesuaian"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          supportingText="Wajib diisi. Tercatat pada audit trail dan pada ledger transaksi."
        />
        {adjust.isError ? (
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--color-error)' }}>
            {(adjust.error as Error).message}
          </p>
        ) : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
          <Button variant="text" onClick={onClose}>
            Batal
          </Button>
          <Button
            variant="filled"
            onClick={() => adjust.mutate()}
            disabled={adjust.isPending || reason.trim().length < 3}
          >
            Simpan Penyesuaian
          </Button>
        </div>
      </div>
    </Dialog>
  );
};
