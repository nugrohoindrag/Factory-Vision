import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FactoryVisionApiClient, ApiRequestError } from '@factory-vision/api-client';
import type { CustomerOrderDetailView } from '@factory-vision/api-client';
import {
  AdvancedDataTable,
  ColumnDef,
  Button,
  Icon,
  Select,
  FilledTextField,
  EmptyState,
  ErrorState,
} from '@factory-vision/ui';
import { DateField, Page, Section, SurfaceCard, Dialog, toneContainer, toneOnContainer, type Tone } from '@factory-vision/ui/fv';
import { useSession } from '../../app/SessionContext.js';
import {
  CustomerOrderStatus,
  CUSTOMER_ORDER_STATUS_LABEL,
  ORDER_CHANNEL_LABEL,
  statusLabel,
} from '@factory-vision/domain-types';

const api = new FactoryVisionApiClient({ baseUrl: '' });

/**
 * Customer Order list and detail (MES-024), with source documents (MES-025).
 *
 * The question this screen exists to answer is "kapan order ini siap?", so the
 * detail leads with quantity progress per line and the Work Orders producing it
 * — reached through the plan line, because a Work Order stores no customer
 * (ADR-22).
 *
 * An order at risk of being late is flagged: delivery is due within a week and
 * production has not finished. It is a warning, never a block (§25.6).
 */

const STATUS_TONE: Record<string, Tone> = {
  RECEIVED: 'info',
  PLANNED: 'info',
  IN_PRODUCTION: 'warning',
  PRODUCED: 'success',
  READY_TO_SHIP: 'success',
  SHIPPED: 'success',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
};

const DELIVERED_STATUSES = new Set<string>([
  CustomerOrderStatus.PRODUCED,
  CustomerOrderStatus.READY_TO_SHIP,
  CustomerOrderStatus.SHIPPED,
  CustomerOrderStatus.COMPLETED,
  CustomerOrderStatus.CANCELLED,
]);

/** Due inside a week and not yet produced. A warning, not a block. */
function isAtRisk(order: CustomerOrderDetailView): boolean {
  if (DELIVERED_STATUSES.has(order.status)) return false;
  const due = Date.parse(`${order.requestedDeliveryDate}T00:00:00Z`);
  if (!Number.isFinite(due)) return false;
  return due - Date.now() < 7 * 86_400_000;
}

const StatusPill: React.FC<{ status: string }> = ({ status }) => {
  const tone = STATUS_TONE[status] ?? 'neutral';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 10px',
        borderRadius: 'var(--radius-pill)',
        fontSize: '11px',
        fontWeight: 700,
        backgroundColor: toneContainer[tone],
        color: toneOnContainer[tone],
      }}
    >
      {CUSTOMER_ORDER_STATUS_LABEL[status as CustomerOrderStatus] ?? statusLabel(status)}
    </span>
  );
};

/** Reads a file as base64, without the `data:` prefix the API does not want. */
function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('File tidak dapat dibaca.'));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });
}

export const CustomerOrdersPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { can } = useSession();

  // The traceability panel reads Production Plans. Sales owns the order but not
  // planning (Improvement PRD §5), so for them the panel is simply absent —
  // the order's own derived status already answers "kapan order ini siap".
  // Rendering it and letting the request 403 would show a broken panel to a
  // user who is behaving correctly.
  const canSeePlans = can('production_plan:view');

  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [customerFilter, setCustomerFilter] = useState<string>('ALL');
  const [deliveryFrom, setDeliveryFrom] = useState('');
  const [deliveryTo, setDeliveryTo] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [showCancel, setShowCancel] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const ordersQuery = useQuery({
    queryKey: ['planning', 'orders', statusFilter, customerFilter, deliveryFrom, deliveryTo],
    queryFn: () =>
      api.planning.getOrders({
        status: statusFilter === 'ALL' ? undefined : statusFilter,
        customerId: customerFilter === 'ALL' ? undefined : customerFilter,
        deliveryFrom: deliveryFrom || undefined,
        deliveryTo: deliveryTo || undefined,
      }),
  });

  const customersQuery = useQuery({
    queryKey: ['planning', 'customers'],
    queryFn: () => api.planning.getCustomers(),
  });

  const productsQuery = useQuery({
    queryKey: ['master', 'products'],
    queryFn: () => api.master.getProducts(),
  });

  const detailQuery = useQuery({
    queryKey: ['planning', 'order', selectedId],
    queryFn: () => api.planning.getOrder(selectedId as string),
    enabled: Boolean(selectedId),
  });

  const productName = (productId: string) => {
    const product = productsQuery.data?.find((p) => p.id === productId);
    return product ? `${product.sku} — ${product.name}` : productId;
  };

  const customerName = (customerId: string) =>
    customersQuery.data?.find((c) => c.id === customerId)?.name ?? customerId;

  const cancelOrder = useMutation({
    mutationFn: () => api.planning.cancelOrder(selectedId as string, cancelReason),
    onSuccess: () => {
      setShowCancel(false);
      setCancelReason('');
      void queryClient.invalidateQueries({ queryKey: ['planning', 'orders'] });
      void queryClient.invalidateQueries({ queryKey: ['planning', 'order', selectedId] });
    },
  });

  const uploadDocument = useMutation({
    mutationFn: async (file: File) => {
      const content = await readAsBase64(file);
      return api.planning.attachOrderDocument(selectedId as string, {
        fileName: file.name,
        contentType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        content,
      });
    },
    onSuccess: () => {
      setUploadError(null);
      void queryClient.invalidateQueries({ queryKey: ['planning', 'order', selectedId] });
    },
    onError: (error: unknown) => {
      // The cause is a per-field error; showing the envelope headline alone
      // would tell the user the upload failed without saying why.
      if (error instanceof ApiRequestError) {
        setUploadError(error.fields[0]?.message ?? error.message);
      } else {
        setUploadError(error instanceof Error ? error.message : 'Unggahan gagal.');
      }
    },
  });

  const orders = ordersQuery.data ?? [];
  const detail = detailQuery.data;

  const columns: ColumnDef<CustomerOrderDetailView & { id: string }>[] = useMemo(
    () => [
      {
        key: 'orderNumber',
        header: 'Nomor Order',
        sortable: true,
        render: (row) => (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontWeight: 700 }}>{row.orderNumber}</span>
            {isAtRisk(row) && (
              <span title="Berisiko terlambat: pengiriman kurang dari 7 hari dan produksi belum selesai.">
                <Icon name="schedule" size={16} />
              </span>
            )}
          </div>
        ),
      },
      { key: 'customerId', header: 'Customer', sortable: true, render: (row) => customerName(row.customerId) },
      {
        key: 'orderChannel',
        header: 'Channel',
        render: (row) => ORDER_CHANNEL_LABEL[row.orderChannel] ?? row.orderChannel,
      },
      { key: 'requestedDeliveryDate', header: 'Kirim', sortable: true },
      {
        key: 'lines',
        header: 'Line',
        render: (row) => `${row.lines.length} baris`,
      },
      {
        key: 'progress',
        header: 'Progress',
        render: (row) => {
          const ordered = row.lines.reduce((sum, l) => sum + l.orderedQuantity, 0);
          const produced = row.lines.reduce((sum, l) => sum + l.producedQuantity, 0);
          const pct = ordered > 0 ? Math.round((produced / ordered) * 100) : 0;
          return `${produced.toLocaleString('id-ID')} / ${ordered.toLocaleString('id-ID')} (${pct}%)`;
        },
      },
      { key: 'status', header: 'Status', render: (row) => <StatusPill status={row.status} /> },
      {
        key: 'actions',
        header: '',
        render: (row) => (
          <Button variant="text" size="sm" onClick={() => setSelectedId(row.id)}>
            Detail
          </Button>
        ),
      },
    ],
    [customersQuery.data]
  );

  return (
    <Page>
      <Section>
        <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
          Customer Order
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--color-on-surface-variant)' }}>
          Daftar order beserta status produksinya. Status Received sampai Produced diturunkan sistem
          dari fakta produksi, bukan diketik.
        </p>
      </Section>

      <Section>
        <SurfaceCard padding="md">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '12px',
            }}
          >
            <Select
              label="Status"
              options={[
                { value: 'ALL', label: 'Semua status' },
                ...Object.values(CustomerOrderStatus).map((s) => ({
                  value: s,
                  label: CUSTOMER_ORDER_STATUS_LABEL[s],
                })),
              ]}
              value={statusFilter}
              onChange={setStatusFilter}
            />
            <Select
              label="Customer"
              searchable
              options={[
                { value: 'ALL', label: 'Semua customer' },
                ...(customersQuery.data ?? []).map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` })),
              ]}
              value={customerFilter}
              onChange={setCustomerFilter}
            />
            <DateField
              label="Kirim dari"
              type="date"
              value={deliveryFrom}
              onChange={(e) => setDeliveryFrom(e.target.value)}
            />
            <DateField
              label="Kirim sampai"
              type="date"
              value={deliveryTo}
              onChange={(e) => setDeliveryTo(e.target.value)}
            />
          </div>
        </SurfaceCard>
      </Section>

      <Section>
        {ordersQuery.isLoading ? (
          <SurfaceCard padding="lg">
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-on-surface-variant)' }}>
              Memuat customer order…
            </p>
          </SurfaceCard>
        ) : ordersQuery.isError ? (
          <ErrorState
            title="Gagal memuat customer order"
            description="Periksa koneksi ke API lalu coba lagi."
            onRetry={() => void ordersQuery.refetch()}
          />
        ) : orders.length === 0 ? (
          <EmptyState
            icon="description"
            title="Belum ada customer order"
            description="Order yang dicatat lewat Penerimaan Order akan muncul di sini beserta status produksinya."
            actionLabel=""
          />
        ) : (
          <AdvancedDataTable
            columns={columns}
            data={orders as (CustomerOrderDetailView & { id: string })[]}
            title="Customer Order"
            subtitle={`${orders.length} order`}
            selectable={false}
          />
        )}
      </Section>

      <Dialog
        isOpen={Boolean(selectedId)}
        onClose={() => {
          setSelectedId(null);
          setUploadError(null);
        }}
        title={detail ? `Order ${detail.orderNumber}` : 'Detail order'}
        maxWidth="860px"
      >
        {detailQuery.isLoading && (
          <p style={{ fontSize: '13px', color: 'var(--color-on-surface-variant)' }}>Memuat detail…</p>
        )}
        {detail && (
          <div style={{ display: 'grid', gap: '20px' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                gap: '12px',
              }}
            >
              <Field label="Customer" value={customerName(detail.customerId)} />
              <Field label="Channel" value={ORDER_CHANNEL_LABEL[detail.orderChannel] ?? detail.orderChannel} />
              <Field label="PO Customer" value={detail.poNumber ?? '—'} />
              <Field label="Tanggal Order" value={detail.orderDate} />
              <Field label="Kirim" value={detail.requestedDeliveryDate} />
              <Field label="Dock" value={detail.dockNumber ?? '—'} />
              <Field label="PIC" value={detail.customerPic ?? '—'} />
              <div>
                <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>Status</div>
                <div style={{ marginTop: '4px' }}>
                  <StatusPill status={detail.status} />
                </div>
              </div>
            </div>

            {detail.statusReason && (
              <SurfaceCard padding="sm" railTone="warning">
                <span style={{ fontSize: '12px', color: 'var(--color-on-surface)' }}>
                  Alasan: {detail.statusReason}
                </span>
              </SurfaceCard>
            )}

            <div>
              <h3 style={{ margin: '0 0 8px', fontSize: '14px', fontWeight: 700 }}>Order Line</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--color-on-surface-variant)' }}>
                    <th style={{ padding: '6px 4px' }}>Product</th>
                    <th style={{ padding: '6px 4px' }}>Ordered</th>
                    <th style={{ padding: '6px 4px' }}>Planned</th>
                    <th style={{ padding: '6px 4px' }}>Produced</th>
                    <th style={{ padding: '6px 4px' }}>Kirim</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.lines.map((line) => (
                    <tr key={line.id} style={{ borderTop: '1px solid var(--color-outline-variant)' }}>
                      <td style={{ padding: '6px 4px' }}>{productName(line.productId)}</td>
                      <td style={{ padding: '6px 4px' }}>{line.orderedQuantity.toLocaleString('id-ID')}</td>
                      <td style={{ padding: '6px 4px' }}>{line.plannedQuantity.toLocaleString('id-ID')}</td>
                      <td style={{ padding: '6px 4px' }}>{line.producedQuantity.toLocaleString('id-ID')}</td>
                      <td style={{ padding: '6px 4px' }}>
                        {line.requestedDeliveryDate ?? detail.requestedDeliveryDate}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {canSeePlans && <OrderTraceability orderId={detail.id} />}

            <div>
              <h3 style={{ margin: '0 0 8px', fontSize: '14px', fontWeight: 700 }}>Dokumen Sumber</h3>
              {detail.documents.length === 0 ? (
                <p style={{ margin: '0 0 8px', fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
                  Belum ada dokumen. Lampirkan PO, kartu kanban, atau email agar asal demand dapat
                  diverifikasi kemudian.
                </p>
              ) : (
                <ul style={{ margin: '0 0 8px', paddingLeft: '18px', fontSize: '12px' }}>
                  {detail.documents.map((doc) => (
                    <li key={doc.id} style={{ marginBottom: '4px' }}>
                      <a
                        href={doc.storageUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: 'var(--color-primary)' }}
                      >
                        {doc.fileName}
                      </a>{' '}
                      <span style={{ color: 'var(--color-on-surface-variant)' }}>
                        ({Math.max(1, Math.round(doc.sizeBytes / 1024))} KB)
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '12px',
                  cursor: 'pointer',
                  color: 'var(--color-primary)',
                }}
              >
                <Icon name="upload_file" size={16} />
                {uploadDocument.isPending ? 'Mengunggah…' : 'Unggah dokumen'}
                <input
                  type="file"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) uploadDocument.mutate(file);
                    e.target.value = '';
                  }}
                />
              </label>
              {uploadError && (
                <p style={{ margin: '6px 0 0', fontSize: '12px', color: 'var(--color-error)' }}>
                  {uploadError}
                </p>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <Button variant="outlined" onClick={() => setShowCancel(true)}>
                Batalkan Order
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      <Dialog isOpen={showCancel} onClose={() => setShowCancel(false)} title="Batalkan Customer Order">
        <p style={{ margin: '0 0 12px', fontSize: '13px', color: 'var(--color-on-surface-variant)' }}>
          Pembatalan ditolak bila ada Work Order yang sudah masuk produksi. Alasan wajib diisi dan
          tercatat di audit log.
        </p>
        <FilledTextField
          label="Alasan pembatalan"
          value={cancelReason}
          onChange={(e) => setCancelReason(e.target.value)}
          error={cancelOrder.isError ? (cancelOrder.error as Error).message : undefined}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
          <Button variant="text" onClick={() => setShowCancel(false)}>
            Batal
          </Button>
          <Button
            variant="filled"
            disabled={cancelReason.trim().length < 3 || cancelOrder.isPending}
            onClick={() => cancelOrder.mutate()}
          >
            Konfirmasi Pembatalan
          </Button>
        </div>
      </Dialog>
    </Page>
  );
};

const Field: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>{label}</div>
    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-on-surface)' }}>{value}</div>
  </div>
);

/**
 * The Production Plans and Work Orders serving an order (MES-024-3).
 *
 * Resolved through the plan demand rows: a Work Order carries no customer, so
 * the trail runs order line → plan demand → plan line → work order.
 */
const OrderTraceability: React.FC<{ orderId: string }> = ({ orderId }) => {
  const plansQuery = useQuery({
    queryKey: ['planning', 'order-trace', orderId],
    queryFn: async () => {
      const plans = await api.planning.getPlans();
      const matches: { planNumber: string; planId: string; status: string; lineCount: number }[] = [];
      for (const plan of plans) {
        const demand = await api.planning.getPlanDemand(plan.id);
        const serving = demand.filter((line) =>
          line.sources.some((source) => source.customerOrderId === orderId)
        );
        if (serving.length > 0) {
          matches.push({
            planNumber: plan.planNumber,
            planId: plan.id,
            status: plan.status,
            lineCount: serving.length,
          });
        }
      }
      return matches;
    },
  });

  return (
    <div>
      <h3 style={{ margin: '0 0 8px', fontSize: '14px', fontWeight: 700 }}>
        Production Plan &amp; Work Order yang memenuhi
      </h3>
      {plansQuery.isLoading ? (
        <p style={{ margin: 0, fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>Memuat…</p>
      ) : (plansQuery.data ?? []).length === 0 ? (
        <p style={{ margin: 0, fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
          Order ini belum masuk Production Plan mana pun.
        </p>
      ) : (
        <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12px' }}>
          {(plansQuery.data ?? []).map((match) => (
            <li key={match.planId} style={{ marginBottom: '4px' }}>
              <strong>{match.planNumber}</strong> — {statusLabel(match.status)} ({match.lineCount} plan
              line)
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
