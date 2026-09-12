import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FactoryVisionApiClient, ApiRequestError } from '@factory-vision/api-client';
import type { CreateCustomerOrderLineBody, CustomerOrderDetailView } from '@factory-vision/api-client';
import { Button, Icon, FilledTextField, Select, EmptyState } from '@factory-vision/ui';
import { DateField, Dialog, toneContainer, toneOnContainer } from '@factory-vision/ui/fv';
import {
  OrderChannel,
  ORDER_CHANNEL_LABEL,
  ORDER_REFERENCE_FIELD,
  ORDER_SOURCE_OPTIONS,
} from '@factory-vision/domain-types';
import type { ApiFieldError, Product } from '@factory-vision/domain-types';
import { useNewlyCreated } from '../common/useNewlyCreated.js';

const api = new FactoryVisionApiClient({ baseUrl: '' });

/**
 * Buat Order (MES-023), as a three-step wizard over the Customer Order list.
 *
 *   ① Detail Order → ② Produk → ③ Review → Order dibuat
 *
 * The one-pass form put the order header and every line on one screen, which
 * was fast for a planner who knew it and opaque for anyone else: "Order
 * Channel", "Order Line", "Tambah Baris" and two delivery dates with no stated
 * relationship. The wizard asks the questions in the order a planner thinks
 * them — whose order is this and where did it come from, what did they order,
 * is it right — in the product's language. The backend keeps its own: an
 * `order_line` is still an order line in the API, and "Sumber Order" is still
 * `orderChannel`. None of that reaches the screen.
 *
 * Scope, deliberately (Improvement: Add Order Wizard, §24): no new API field,
 * no migration, no new statuses. The reference is `poNumber` under a label
 * that follows the source; the dock number is left to a delivery process that
 * does not exist yet; planning alerts are the two the client can compute.
 */

type Step = 1 | 2 | 3;
const STEPS: Array<{ id: Step; label: string }> = [
  { id: 1, label: 'Detail Order' },
  { id: 2, label: 'Produk' },
  { id: 3, label: 'Review' },
];

interface DraftProduct extends CreateCustomerOrderLineBody {
  key: string;
}

const today = () => new Date().toISOString().slice(0, 10);
const newKey = () => `p-${Math.random().toString(36).slice(2, 9)}`;
const fmtQty = (n: number) => n.toLocaleString('id-ID');
const fmtDate = (iso: string) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';
const daysBetween = (fromIso: string, toIso: string) =>
  Math.round((new Date(`${toIso}T00:00:00`).getTime() - new Date(`${fromIso}T00:00:00`).getTime()) / 86_400_000);

// --- small pieces ----------------------------------------------------------

/** Lightweight step indicator: the current step in primary, done steps ticked. */
const StepIndicator: React.FC<{ current: Step; onJump: (step: Step) => void; reachable: Step }> = ({
  current,
  onJump,
  reachable,
}) => (
  <ol style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', margin: 0, padding: 0, listStyle: 'none' }}>
    {STEPS.map((step, index) => {
      const done = step.id < current;
      const active = step.id === current;
      const canJump = step.id <= reachable && !active;
      return (
        <React.Fragment key={step.id}>
          {index > 0 && (
            <span
              aria-hidden="true"
              style={{ flex: '0 0 32px', height: '2px', borderRadius: 'var(--radius-pill)', backgroundColor: done || active ? 'var(--color-primary)' : 'var(--color-border)' }}
            />
          )}
          <li>
            <button
              type="button"
              onClick={canJump ? () => onJump(step.id) : undefined}
              aria-current={active ? 'step' : undefined}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                border: 'none',
                background: 'none',
                padding: 0,
                cursor: canJump ? 'pointer' : 'default',
                fontSize: '12.5px',
                fontWeight: active ? 800 : 600,
                color: active ? 'var(--color-primary)' : done ? 'var(--color-on-surface)' : 'var(--color-on-surface-variant)',
              }}
            >
              <span
                style={{
                  width: '22px',
                  height: '22px',
                  borderRadius: '50%',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '11px',
                  fontWeight: 800,
                  backgroundColor: active || done ? 'var(--color-primary)' : 'var(--color-surface-container-high)',
                  color: active || done ? 'var(--color-on-primary)' : 'var(--color-on-surface-variant)',
                }}
              >
                {done ? <Icon name="check" size={14} /> : step.id}
              </span>
              {step.label}
            </button>
          </li>
        </React.Fragment>
      );
    })}
  </ol>
);

const Notice: React.FC<{ tone: 'error' | 'warning' | 'success' | 'info'; icon: string; title?: string; children: React.ReactNode; action?: React.ReactNode }> = ({
  tone,
  icon,
  title,
  children,
  action,
}) => (
  <div
    role={tone === 'error' ? 'alert' : 'status'}
    style={{
      display: 'flex',
      gap: 'var(--space-3)',
      alignItems: 'flex-start',
      padding: 'var(--space-3) var(--space-4)',
      borderRadius: 'var(--radius-md)',
      backgroundColor: toneContainer[tone],
      color: toneOnContainer[tone],
      fontSize: '13px',
    }}
  >
    <Icon name={icon} size={20} />
    <div style={{ flex: 1, minWidth: 0 }}>
      {title && <div style={{ fontWeight: 800, marginBottom: '2px' }}>{title}</div>}
      <div>{children}</div>
    </div>
    {action}
  </div>
);

const SectionTitle: React.FC<{ title: string; hint?: string; action?: React.ReactNode }> = ({ title, hint, action }) => (
  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
    <div>
      <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: 'var(--color-on-surface)' }}>{title}</h2>
      {hint && <p style={{ margin: `var(--space-1) 0 0`, fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>{hint}</p>}
    </div>
    {action}
  </div>
);

const ReviewField: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div>
    <div style={{ fontSize: '10.5px', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-on-surface-variant)' }}>{label}</div>
    <div style={{ marginTop: '2px', fontSize: '13.5px', fontWeight: 600, color: 'var(--color-on-surface)' }}>{value || '—'}</div>
  </div>
);

// --- the wizard -------------------------------------------------------------

export interface AddOrderWizardProps {
  isOpen: boolean;
  onClose: () => void;
  /** "Lihat Order" on the success screen: open this order in the list's detail view. */
  onView: (orderId: string) => void;
}

export const AddOrderWizard: React.FC<AddOrderWizardProps> = ({ isOpen, onClose, onView }) => {
  const queryClient = useQueryClient();
  const { markNewlyCreated } = useNewlyCreated('fv_new_customer_order');

  const [step, setStep] = useState<Step>(1);
  const [reachable, setReachable] = useState<Step>(1);

  // Step 1 — Detail Order
  const [customerId, setCustomerId] = useState('');
  const [source, setSource] = useState<OrderChannel | ''>('');
  const [reference, setReference] = useState('');
  const [orderDate, setOrderDate] = useState(today());
  const [customerPic, setCustomerPic] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [requestedDeliveryDate, setRequestedDeliveryDate] = useState('');

  // Step 2 — Produk
  const [products, setProducts] = useState<DraftProduct[]>([]);
  const [panel, setPanel] = useState<DraftProduct | null>(null); // the inline Tambah/Edit Produk panel
  const [panelErrors, setPanelErrors] = useState<ApiFieldError[]>([]);

  const [fieldErrors, setFieldErrors] = useState<ApiFieldError[]>([]);
  const [banner, setBanner] = useState<string | null>(null);
  const [created, setCreated] = useState<CustomerOrderDetailView | null>(null);

  const customersQuery = useQuery({
    queryKey: ['planning', 'customers', 'active'],
    queryFn: () => api.planning.getCustomers({ activeOnly: true }),
    enabled: isOpen,
  });
  const productsQuery = useQuery({
    queryKey: ['master', 'products'],
    queryFn: () => api.master.getProducts(),
    enabled: isOpen,
  });
  const activeProducts = useMemo(() => (productsQuery.data ?? []).filter((p) => p.status === 'ACTIVE'), [productsQuery.data]);
  const productById = (id: string): Product | undefined => productsQuery.data?.find((p) => p.id === id);
  const customer = customersQuery.data?.find((c) => c.id === customerId);

  // Phase-1 planning alerts (§18): a PO reference already on another order,
  // and a delivery asked for within a day. Both are warnings, never blocks —
  // the API has no rule that refuses either.
  const duplicateQuery = useQuery({
    queryKey: ['planning', 'orders', 'by-reference', reference.trim()],
    queryFn: () => api.planning.getOrders({ search: reference.trim() }),
    enabled: isOpen && step === 3 && reference.trim().length > 0,
  });
  const duplicate = (duplicateQuery.data ?? []).find(
    (o) => (o.poNumber ?? '').trim().toLowerCase() === reference.trim().toLowerCase()
  );
  const deliveryWithinDay = Boolean(orderDate && requestedDeliveryDate) && daysBetween(orderDate, requestedDeliveryDate) <= 1;

  const errorFor = (field: string) => fieldErrors.find((e) => e.field === field)?.message;
  const panelErrorFor = (field: string) => panelErrors.find((e) => e.field === field)?.message;
  const referenceField = source ? ORDER_REFERENCE_FIELD[source] : { label: 'Nomor PO / Referensi', required: true };

  const reset = () => {
    setStep(1);
    setReachable(1);
    setCustomerId('');
    setSource('');
    setReference('');
    setOrderDate(today());
    setCustomerPic('');
    setDeliveryAddress('');
    setRequestedDeliveryDate('');
    setProducts([]);
    setPanel(null);
    setPanelErrors([]);
    setFieldErrors([]);
    setBanner(null);
    setCreated(null);
  };

  const close = () => {
    if (createOrder.isPending) return;
    reset();
    onClose();
  };

  // --- validation, per step, mirroring the API's rules (MES-023-3) ---------

  const validateDetail = (): boolean => {
    const errors: ApiFieldError[] = [];
    if (!customerId) errors.push({ field: 'customerId', code: 'REQUIRED', message: 'Pilih customer.' });
    if (!source) errors.push({ field: 'orderChannel', code: 'REQUIRED', message: 'Pilih bagaimana order ini diterima.' });
    if (source && ORDER_REFERENCE_FIELD[source].required && !reference.trim()) {
      errors.push({ field: 'poNumber', code: 'REQUIRED', message: `${ORDER_REFERENCE_FIELD[source].label} wajib diisi.` });
    }
    if (!orderDate) errors.push({ field: 'orderDate', code: 'REQUIRED', message: 'Tanggal order wajib diisi.' });
    if (!requestedDeliveryDate) {
      errors.push({ field: 'requestedDeliveryDate', code: 'REQUIRED', message: 'Tanggal pengiriman yang diminta wajib diisi.' });
    } else if (orderDate && requestedDeliveryDate < orderDate) {
      errors.push({ field: 'requestedDeliveryDate', code: 'OUT_OF_RANGE', message: 'Tanggal pengiriman tidak boleh sebelum tanggal order.' });
    }
    setFieldErrors(errors);
    return errors.length === 0;
  };

  const validateProducts = (): boolean => {
    const errors: ApiFieldError[] = [];
    if (products.length === 0) errors.push({ field: 'lines', code: 'REQUIRED', message: 'Tambahkan minimal satu produk.' });
    setFieldErrors(errors);
    return errors.length === 0;
  };

  const validatePanel = (draft: DraftProduct): boolean => {
    const errors: ApiFieldError[] = [];
    if (!draft.productId) errors.push({ field: 'productId', code: 'REQUIRED', message: 'Pilih produk terlebih dahulu.' });
    if (!draft.orderedQuantity || draft.orderedQuantity <= 0) {
      errors.push({ field: 'orderedQuantity', code: 'OUT_OF_RANGE', message: 'Quantity harus lebih dari nol.' });
    }
    if (draft.requestedDeliveryDate && orderDate && draft.requestedDeliveryDate < orderDate) {
      errors.push({ field: 'requestedDeliveryDate', code: 'OUT_OF_RANGE', message: 'Tanggal pengiriman tidak boleh sebelum tanggal order.' });
    }
    const twin = products.find((p) => p.key !== draft.key && p.productId === draft.productId);
    if (twin) errors.push({ field: 'productId', code: 'CONFLICT', message: 'Produk ini sudah ada di order. Ubah quantity pada produk yang sudah ada.' });
    setPanelErrors(errors);
    return errors.length === 0;
  };

  const next = () => {
    setBanner(null);
    if (step === 1 && validateDetail()) {
      setStep(2);
      setReachable((r) => (r < 2 ? 2 : r));
    } else if (step === 2 && validateProducts()) {
      setStep(3);
      setReachable(3);
    }
  };
  const back = () => {
    setBanner(null);
    setFieldErrors([]);
    setStep((s) => (s > 1 ? ((s - 1) as Step) : s));
  };

  // --- products -------------------------------------------------------------

  const openPanel = (existing?: DraftProduct) => {
    setPanelErrors([]);
    setFieldErrors([]);
    setPanel(existing ? { ...existing } : { key: newKey(), productId: '', orderedQuantity: 0, modelType: '', requestedDeliveryDate: '' });
  };
  const commitPanel = () => {
    if (!panel || !validatePanel(panel)) return;
    const unit = productById(panel.productId)?.unit;
    const entry: DraftProduct = { ...panel, unit, modelType: panel.modelType?.trim() || undefined, requestedDeliveryDate: panel.requestedDeliveryDate || undefined };
    setProducts((current) => (current.some((p) => p.key === entry.key) ? current.map((p) => (p.key === entry.key ? entry : p)) : [...current, entry]));
    setPanel(null);
  };
  const removeProduct = (key: string) => setProducts((current) => current.filter((p) => p.key !== key));

  const totals = useMemo(() => {
    const byUnit = new Map<string, number>();
    for (const p of products) {
      const unit = (productById(p.productId)?.unit ?? p.unit ?? 'pcs').toLowerCase();
      byUnit.set(unit, (byUnit.get(unit) ?? 0) + p.orderedQuantity);
    }
    return [...byUnit.entries()].map(([unit, qty]) => `${fmtQty(qty)} ${unit}`).join(' · ');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, productsQuery.data]);

  // --- create ---------------------------------------------------------------

  const createOrder = useMutation({
    mutationFn: () =>
      api.planning.createOrder({
        customerId,
        orderChannel: source as OrderChannel,
        requestedDeliveryDate,
        orderDate,
        poNumber: reference.trim() || undefined,
        customerPic: customerPic || undefined,
        deliveryAddress: deliveryAddress || undefined,
        lines: products.map(({ key: _key, ...line }) => ({
          ...line,
          requestedDeliveryDate: line.requestedDeliveryDate || undefined,
        })),
      }),
    onSuccess: (order) => {
      markNewlyCreated(order.id);
      void queryClient.invalidateQueries({ queryKey: ['planning', 'orders'] });
      setCreated(order);
    },
    onError: (error: unknown) => {
      if (error instanceof ApiRequestError) {
        setFieldErrors(error.fields ?? []);
        setBanner(error.message);
        // A field the server refused lives on step 1 or 2; take the planner there.
        if ((error.fields ?? []).some((f) => f.field.startsWith('lines'))) setStep(2);
        else if ((error.fields ?? []).length > 0) setStep(1);
      } else {
        setBanner('Gagal membuat order. Coba lagi.');
      }
    },
  });

  const loading = customersQuery.isLoading || productsQuery.isLoading;
  const loadFailed = customersQuery.isError || productsQuery.isError;

  // --- render ---------------------------------------------------------------

  const productOptions = activeProducts.map((p) => ({ value: p.id, label: `${p.sku} — ${p.name}` }));
  const productLabel = (id: string) => {
    const p = productById(id);
    return p ? `${p.sku} — ${p.name}` : id;
  };

  const renderDetail = () => (
    <section>
      <SectionTitle title="Detail Order" hint="Order ini milik siapa dan datang dari mana?" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--space-4)' }}>
        <Select
          label="Customer *"
          searchable
          options={(customersQuery.data ?? []).map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` }))}
          value={customerId}
          onChange={(value) => {
            setCustomerId(value);
            const picked = customersQuery.data?.find((c) => c.id === value);
            // Prefilled from the customer master so the common case needs no
            // retyping; a one-off delivery can still be overridden here.
            if (picked) {
              setCustomerPic(picked.picName ?? '');
              setDeliveryAddress(picked.deliveryAddress ?? '');
            }
          }}
          placeholder={loading ? 'Memuat customer…' : 'Pilih customer'}
          error={errorFor('customerId')}
        />
        <Select
          label="Sumber Order *"
          options={ORDER_SOURCE_OPTIONS.map((value) => ({ value, label: ORDER_CHANNEL_LABEL[value] }))}
          value={source}
          onChange={(value) => setSource(value as OrderChannel)}
          placeholder="Pilih sumber"
          supportingText="Bagaimana order ini diterima?"
          error={errorFor('orderChannel')}
        />
        <FilledTextField
          label={`${referenceField.label}${referenceField.required ? ' *' : ''}`}
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          error={errorFor('poNumber')}
          supportingText={source === OrderChannel.MANUAL ? 'Opsional untuk order manual.' : undefined}
        />
        <DateField label="Tanggal Order *" type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} error={errorFor('orderDate')} />
        <FilledTextField
          label="PIC Customer"
          value={customerPic}
          onChange={(e) => setCustomerPic(e.target.value)}
          supportingText={customer?.picName ? 'Terisi dari master customer, dapat diubah.' : undefined}
        />
        <FilledTextField
          label="Alamat Pengiriman"
          value={deliveryAddress}
          onChange={(e) => setDeliveryAddress(e.target.value)}
          supportingText={customer?.deliveryAddress ? 'Terisi dari master customer, dapat diubah.' : 'Terisi otomatis saat customer dipilih.'}
        />
        <DateField
          label="Tanggal Pengiriman Diminta *"
          type="date"
          value={requestedDeliveryDate}
          onChange={(e) => setRequestedDeliveryDate(e.target.value)}
          error={errorFor('requestedDeliveryDate')}
          supportingText="Tanggal ini digunakan sebagai default untuk seluruh produk."
        />
      </div>
    </section>
  );

  const renderPanel = () =>
    panel && (
      <div
        style={{
          padding: 'var(--space-4)',
          borderRadius: 'var(--radius-lg)',
          backgroundColor: 'var(--color-surface-container-low)',
          display: 'grid',
          gap: 'var(--space-4)',
        }}
      >
        <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: 'var(--color-on-surface)' }}>
          {products.some((p) => p.key === panel.key) ? 'Ubah Produk' : 'Tambah Produk'}
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--space-4)' }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <Select
              label="Produk *"
              searchable
              options={productOptions}
              value={panel.productId}
              onChange={(value) => setPanel({ ...panel, productId: value })}
              placeholder="Cari part number / nama produk"
              error={panelErrorFor('productId')}
            />
          </div>
          <FilledTextField
            label="Model / Tipe (opsional)"
            value={panel.modelType ?? ''}
            onChange={(e) => setPanel({ ...panel, modelType: e.target.value })}
          />
          <FilledTextField
            label="Quantity *"
            type="number"
            min={1}
            value={panel.orderedQuantity || ''}
            onChange={(e) => setPanel({ ...panel, orderedQuantity: Number(e.target.value) })}
            error={panelErrorFor('orderedQuantity')}
            trailingIcon={
              <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-on-surface-variant)' }}>
                {productById(panel.productId)?.unit ?? 'UoM'}
              </span>
            }
          />
          <DateField
            label="Tanggal Pengiriman"
            type="date"
            value={panel.requestedDeliveryDate ?? ''}
            onChange={(e) => setPanel({ ...panel, requestedDeliveryDate: e.target.value })}
            error={panelErrorFor('requestedDeliveryDate')}
            supportingText={panel.requestedDeliveryDate ? 'Berbeda dari tanggal order.' : `Mengikuti tanggal order (${fmtDate(requestedDeliveryDate)}).`}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
          <Button variant="text" onClick={() => setPanel(null)}>
            Batal
          </Button>
          <Button variant="filled" onClick={commitPanel}>
            {products.some((p) => p.key === panel.key) ? 'Simpan Perubahan' : 'Tambah Produk'}
          </Button>
        </div>
      </div>
    );

  const renderProducts = () => (
    <section>
      <SectionTitle
        title="Produk yang Dipesan"
        hint="Tambahkan produk, quantity, dan tanggal pengiriman yang diminta."
        action={
          products.length > 0 && !panel ? (
            <Button variant="outlined" size="sm" icon={<Icon name="add" size={16} />} onClick={() => openPanel()}>
              Tambah Produk
            </Button>
          ) : undefined
        }
      />
      {errorFor('lines') && (
        <p style={{ margin: `0 0 var(--space-3)`, fontSize: '12px', color: 'var(--color-error)' }}>{errorFor('lines')}</p>
      )}
      <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
        {products.length > 0 && (
          <div className="fv-table-scroll">
            <table className="fv-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Produk</th>
                  <th>Model</th>
                  <th className="fv-num">Quantity</th>
                  <th>Tanggal Pengiriman</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {products.map((p, index) => (
                  <tr key={p.key}>
                    <td style={{ color: 'var(--color-on-surface-variant)' }}>{index + 1}</td>
                    <td style={{ fontWeight: 600 }}>{productLabel(p.productId)}</td>
                    <td>{p.modelType || '—'}</td>
                    <td className="fv-num">
                      {fmtQty(p.orderedQuantity)} {productById(p.productId)?.unit ?? p.unit ?? ''}
                    </td>
                    <td>
                      {p.requestedDeliveryDate ? (
                        fmtDate(p.requestedDeliveryDate)
                      ) : (
                        <span style={{ color: 'var(--color-on-surface-variant)' }}>Mengikuti tanggal order</span>
                      )}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <Button variant="text" size="sm" onClick={() => openPanel(p)} aria-label={`Ubah produk ${index + 1}`}>
                        <Icon name="edit" size={16} />
                      </Button>
                      <Button variant="text" size="sm" onClick={() => removeProduct(p.key)} aria-label={`Hapus produk ${index + 1}`}>
                        <Icon name="delete" size={16} />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ padding: `var(--space-2) var(--space-4)`, fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
              {products.length} produk · {totals}
            </div>
          </div>
        )}
        {renderPanel()}
        {products.length === 0 && !panel && (
          <EmptyState
            icon="inventory_2"
            title="Belum ada produk"
            description="Tambahkan produk yang dipesan customer ke dalam order."
            actionLabel="Tambah Produk"
            onAction={() => openPanel()}
          />
        )}
      </div>
    </section>
  );

  const renderReview = () => (
    <section style={{ display: 'grid', gap: 'var(--space-5)' }}>
      <SectionTitle title="Review Order" hint="Periksa kembali sebelum order dibuat. Klik langkah di atas untuk mengubah." />

      {duplicate && (
        <Notice
          tone="warning"
          icon="warning"
          title={`${referenceField.label} sudah digunakan`}
          action={
            <Button variant="text" size="sm" onClick={() => onView(duplicate.id)}>
              Periksa Order
            </Button>
          }
        >
          {reference.trim()} ditemukan pada order <strong>{duplicate.orderNumber}</strong>. Order tetap dapat dibuat.
        </Notice>
      )}
      {deliveryWithinDay && (
        <Notice tone="warning" icon="schedule" title="Pengiriman sangat dekat">
          Tanggal pengiriman yang diminta kurang dari 1 hari dari tanggal order. Pastikan order dapat dipenuhi sesuai target.
        </Notice>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-4)' }}>
        <ReviewField label="Customer" value={customer ? `${customer.code} — ${customer.name}` : ''} />
        <ReviewField label="Sumber Order" value={source ? ORDER_CHANNEL_LABEL[source] : ''} />
        <ReviewField label={referenceField.label} value={reference.trim()} />
        <ReviewField label="Tanggal Order" value={fmtDate(orderDate)} />
        <ReviewField label="Tanggal Pengiriman Diminta" value={fmtDate(requestedDeliveryDate)} />
        <ReviewField label="PIC Customer" value={customerPic} />
        <div style={{ gridColumn: '1 / -1' }}>
          <ReviewField label="Alamat Pengiriman" value={deliveryAddress} />
        </div>
      </div>

      <div>
        <div style={{ fontSize: '10.5px', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-on-surface-variant)', marginBottom: 'var(--space-2)' }}>
          Produk
        </div>
        <div className="fv-table-scroll">
          <table className="fv-table">
            <thead>
              <tr>
                <th>Produk</th>
                <th>Model</th>
                <th className="fv-num">Quantity</th>
                <th>Tanggal Pengiriman</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.key}>
                  <td style={{ fontWeight: 600 }}>{productLabel(p.productId)}</td>
                  <td>{p.modelType || '—'}</td>
                  <td className="fv-num">
                    {fmtQty(p.orderedQuantity)} {productById(p.productId)?.unit ?? ''}
                  </td>
                  <td>{fmtDate(p.requestedDeliveryDate || requestedDeliveryDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ padding: `var(--space-2) var(--space-4)`, fontSize: '12px', fontWeight: 700, color: 'var(--color-on-surface)' }}>
          Total: {products.length} produk · {totals}
        </div>
      </div>
    </section>
  );

  const renderCreated = (order: CustomerOrderDetailView) => (
    <div style={{ display: 'grid', gap: 'var(--space-4)', justifyItems: 'center', textAlign: 'center', padding: `var(--space-4) 0` }}>
      <span
        style={{
          width: '56px',
          height: '56px',
          borderRadius: '50%',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'var(--color-success)',
          color: 'var(--color-on-success)',
        }}
      >
        <Icon name="check" size={30} />
      </span>
      <div>
        <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--color-on-surface)' }}>Order Berhasil Dibuat</div>
        <div style={{ marginTop: 'var(--space-1)', fontSize: '22px', fontWeight: 800, color: 'var(--color-primary)' }}>{order.orderNumber}</div>
      </div>
      <div style={{ fontSize: '13px', color: 'var(--color-on-surface)' }}>
        <div style={{ fontWeight: 700 }}>{customer?.name}</div>
        <div style={{ color: 'var(--color-on-surface-variant)' }}>
          {order.lines.length} produk · {totals}
        </div>
      </div>
      <div>
        <div style={{ fontSize: '10.5px', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-on-surface-variant)' }}>Status</div>
        <span
          style={{
            display: 'inline-block',
            marginTop: 'var(--space-1)',
            padding: `2px var(--space-3)`,
            borderRadius: 'var(--radius-pill)',
            fontSize: '12px',
            fontWeight: 800,
            backgroundColor: toneContainer.info,
            color: toneOnContainer.info,
          }}
        >
          {order.status}
        </span>
      </div>
      <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-on-surface-variant)' }}>Order ini sudah masuk ke Demand Planning.</p>
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
        <Button
          variant="outlined"
          onClick={() => {
            const id = order.id;
            reset();
            onClose();
            onView(id);
          }}
        >
          Lihat Order
        </Button>
        <Button variant="filled" onClick={reset}>
          Buat Order Baru
        </Button>
      </div>
    </div>
  );

  return (
    <Dialog
      isOpen={isOpen}
      onClose={close}
      title="Buat Order"
      supportingText={created ? undefined : 'Catat order customer dan produk yang dipesan.'}
      maxWidth="1080px"
    >
      {created ? (
        renderCreated(created)
      ) : (
        <div style={{ display: 'grid', gap: 'var(--space-5)' }}>
          <StepIndicator current={step} reachable={reachable} onJump={(s) => { setBanner(null); setFieldErrors([]); setStep(s); }} />

          {/* The frame has no height cap of its own; the step scrolls, the
              indicator and the navigation stay put. */}
          <div style={{ display: 'grid', gap: 'var(--space-4)', maxHeight: 'calc(100vh - 340px)', overflowY: 'auto', paddingRight: 'var(--space-1)' }}>
            {banner && (
              <Notice tone="error" icon="error">
                {banner}
              </Notice>
            )}
            {loadFailed && (
              <Notice
                tone="error"
                icon="error"
                action={
                  <Button
                    variant="text"
                    size="sm"
                    onClick={() => {
                      void customersQuery.refetch();
                      void productsQuery.refetch();
                    }}
                  >
                    Muat ulang
                  </Button>
                }
              >
                Master data customer atau produk gagal dimuat, sehingga order belum dapat dibuat.
              </Notice>
            )}
            {step === 1 && renderDetail()}
            {step === 2 && renderProducts()}
            {step === 3 && renderReview()}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Button variant="text" onClick={close}>
              Batal
            </Button>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              {step > 1 && (
                <Button variant="outlined" icon={<Icon name="arrow_back" size={16} />} onClick={back}>
                  Kembali
                </Button>
              )}
              {step < 3 ? (
                <Button variant="filled" onClick={next} disabled={loading || loadFailed || Boolean(panel)}>
                  Lanjut
                  <Icon name="arrow_forward" size={16} />
                </Button>
              ) : (
                <Button variant="filled" onClick={() => createOrder.mutate()} disabled={createOrder.isPending}>
                  {createOrder.isPending ? 'Membuat order…' : 'Buat Order'}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
};
