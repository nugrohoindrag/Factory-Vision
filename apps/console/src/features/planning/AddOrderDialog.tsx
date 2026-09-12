import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FactoryVisionApiClient, ApiRequestError } from '@factory-vision/api-client';
import type { CreateCustomerOrderLineBody } from '@factory-vision/api-client';
import { Button, Icon, FilledTextField, Select, EmptyState } from '@factory-vision/ui';
import { DateField, Dialog, toneContainer, toneOnContainer } from '@factory-vision/ui/fv';
import { OrderChannel, ORDER_CHANNEL_LABEL } from '@factory-vision/domain-types';
import type { ApiFieldError } from '@factory-vision/domain-types';
import { useNewlyCreated } from '../common/useNewlyCreated.js';

const api = new FactoryVisionApiClient({ baseUrl: '' });

/**
 * Add Order (MES-023), as a dialog over the Customer Order list.
 *
 * One form, one pass: the order header and every order line are filled in and
 * saved together, because an order arriving by phone is read out once and a
 * form that made Sales navigate away to add the second item would lose the
 * third. It opens over the list rather than replacing it, so the planner never
 * leaves the place the order is about to appear.
 *
 * Validation is rendered **per field**, not as one banner. The API returns a
 * `fields` array on every 422 for exactly this: a planner who mistyped a
 * quantity on line 3 should see it on line 3.
 */

interface DraftLine extends CreateCustomerOrderLineBody {
  key: string;
}

const emptyLine = (): DraftLine => ({
  key: `line-${Math.random().toString(36).slice(2, 9)}`,
  productId: '',
  orderedQuantity: 0,
  requestedDeliveryDate: '',
});

const today = () => new Date().toISOString().slice(0, 10);

export const AddOrderDialog: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const queryClient = useQueryClient();
  const { markNewlyCreated } = useNewlyCreated('fv_new_customer_order');

  const [customerId, setCustomerId] = useState('');
  const [orderChannel, setOrderChannel] = useState<OrderChannel | ''>('');
  const [poNumber, setPoNumber] = useState('');
  const [orderDate, setOrderDate] = useState(today());
  const [requestedDeliveryDate, setRequestedDeliveryDate] = useState('');
  const [customerPic, setCustomerPic] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [dockNumber, setDockNumber] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const [fieldErrors, setFieldErrors] = useState<ApiFieldError[]>([]);
  const [banner, setBanner] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);

  // Only active customers may be chosen for a new order (MES-029). The list is
  // asked for that way rather than filtered here, so the rule lives in one place.
  const customersQuery = useQuery({
    queryKey: ['planning', 'customers', 'active'],
    queryFn: () => api.planning.getCustomers({ activeOnly: true }),
  });

  const productsQuery = useQuery({
    queryKey: ['master', 'products'],
    queryFn: () => api.master.getProducts(),
  });

  const activeProducts = useMemo(
    () => (productsQuery.data ?? []).filter((p) => p.status === 'ACTIVE'),
    [productsQuery.data]
  );

  const selectedCustomer = customersQuery.data?.find((c) => c.id === customerId);

  const errorFor = (field: string) => fieldErrors.find((e) => e.field === field)?.message;

  const resetForm = () => {
    setCustomerId('');
    setOrderChannel('');
    setPoNumber('');
    setOrderDate(today());
    setRequestedDeliveryDate('');
    setCustomerPic('');
    setDeliveryAddress('');
    setDockNumber('');
    setLines([emptyLine()]);
    setFieldErrors([]);
  };

  const createOrder = useMutation({
    mutationFn: () =>
      api.planning.createOrder({
        customerId,
        orderChannel: orderChannel as OrderChannel,
        requestedDeliveryDate,
        orderDate,
        poNumber: poNumber || undefined,
        customerPic: customerPic || undefined,
        deliveryAddress: deliveryAddress || undefined,
        dockNumber: dockNumber || undefined,
        lines: lines.map(({ key: _key, ...line }) => ({
          ...line,
          requestedDeliveryDate: line.requestedDeliveryDate || undefined,
        })),
      }),
    onSuccess: (order) => {
      // The list underneath is where the order lives; it refreshes with this
      // one marked as new, which is the receipt. The dialog just goes away.
      markNewlyCreated(order.id);
      resetForm();
      setBanner(null);
      void queryClient.invalidateQueries({ queryKey: ['planning', 'orders'] });
      onClose();
    },
    onError: (error: unknown) => {
      if (error instanceof ApiRequestError) {
        setFieldErrors(error.fields ?? []);
        setBanner({ text: error.message, tone: 'error' });
      } else {
        setBanner({ text: 'Gagal menyimpan order. Coba lagi.', tone: 'error' });
      }
    },
  });

  /**
   * Client-side validation, mirroring the API's rules (MES-023-3).
   *
   * It exists to keep the round trip out of the obvious cases, not to replace
   * the server: the API validates the same things and is the authority.
   */
  const validate = (): boolean => {
    const errors: ApiFieldError[] = [];
    if (!customerId) errors.push({ field: 'customerId', code: 'REQUIRED', message: 'Pilih customer.' });
    if (!orderChannel) {
      errors.push({
        field: 'orderChannel',
        code: 'REQUIRED',
        message: 'Order Channel wajib dipilih sebelum simpan.',
      });
    }
    if (!requestedDeliveryDate) {
      errors.push({
        field: 'requestedDeliveryDate',
        code: 'REQUIRED',
        message: 'Tanggal pengiriman diminta wajib diisi.',
      });
    }
    if (lines.length === 0) {
      errors.push({ field: 'lines', code: 'REQUIRED', message: 'Tambahkan minimal satu order line.' });
    }
    lines.forEach((line, index) => {
      if (!line.productId) {
        errors.push({
          field: `lines[${index}].productId`,
          code: 'REQUIRED',
          message: 'Pilih product untuk baris ini.',
        });
      }
      if (!line.orderedQuantity || line.orderedQuantity <= 0) {
        errors.push({
          field: `lines[${index}].orderedQuantity`,
          code: 'OUT_OF_RANGE',
          message: 'Quantity harus lebih dari nol.',
        });
      }
    });
    setFieldErrors(errors);
    return errors.length === 0;
  };

  const submit = () => {
    if (createOrder.isPending || loading) return;
    setBanner(null);
    if (!validate()) {
      setBanner({ text: 'Periksa kembali kolom yang ditandai.', tone: 'error' });
      return;
    }
    createOrder.mutate();
  };

  const updateLine = (key: string, patch: Partial<DraftLine>) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };

  const loading = customersQuery.isLoading || productsQuery.isLoading;
  const loadFailed = customersQuery.isError || productsQuery.isError;

  const close = () => {
    if (createOrder.isPending) return;
    resetForm();
    setBanner(null);
    onClose();
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={close}
      title="Add Order"
      supportingText="Catat order customer beserta seluruh order line-nya dalam satu form. Order tersimpan dengan status Received dan langsung menjadi input demand."
      maxWidth="1080px"
      confirmLabel={createOrder.isPending ? 'Menyimpan…' : 'Simpan Order'}
      cancelLabel="Batal"
      onConfirm={submit}
    >
      {/* The frame has no height cap of its own: a long order would push the
          footer below the viewport with nothing to scroll. The body scrolls;
          the title and the Batal / Simpan footer stay put. */}
      <div
        style={{
          display: 'grid',
          gap: 'var(--space-4)',
          maxHeight: 'calc(100vh - 300px)',
          overflowY: 'auto',
          paddingRight: 'var(--space-1)',
        }}
      >
        {banner && (
          <div
            role="alert"
            style={{
              display: 'flex',
              gap: 'var(--space-3)',
              alignItems: 'center',
              padding: 'var(--space-3) var(--space-4)',
              borderRadius: 'var(--radius-md)',
              backgroundColor: toneContainer[banner.tone],
              color: toneOnContainer[banner.tone],
              fontSize: '13px',
            }}
          >
            <Icon name={banner.tone === 'success' ? 'check_circle' : 'error'} size={20} />
            <span>{banner.text}</span>
          </div>
        )}

        {loadFailed && (
          <div
            style={{
              padding: 'var(--space-4)',
              borderRadius: 'var(--radius-md)',
              backgroundColor: toneContainer.error,
              color: toneOnContainer.error,
            }}
          >
          <p style={{ margin: 0, fontSize: '13px' }}>
            Master data customer atau product gagal dimuat, sehingga order belum dapat dibuat.
          </p>
          <div style={{ marginTop: 'var(--space-3)' }}>
            <Button
              variant="outlined"
              size="sm"
              onClick={() => {
                void customersQuery.refetch();
                void productsQuery.refetch();
              }}
            >
              Muat ulang
            </Button>
          </div>
          </div>
        )}

      <section>
        <h2 style={{ margin: `0 0 var(--space-4)`, fontSize: '15px', fontWeight: 700, color: 'var(--color-on-surface)' }}>
          Informasi Order
        </h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 'var(--space-4)',
          }}
        >
          <Select
            label="Customer"
            searchable
            options={(customersQuery.data ?? []).map((c) => ({
              value: c.id,
              label: `${c.code} — ${c.name}`,
            }))}
            value={customerId}
            onChange={(value) => {
              setCustomerId(value);
              const customer = customersQuery.data?.find((c) => c.id === value);
              // Prefill from the customer master so the common case needs no
              // retyping; a one-off delivery can still be overridden below.
              if (customer) {
                setCustomerPic(customer.picName ?? '');
                setDeliveryAddress(customer.deliveryAddress ?? '');
                setDockNumber(customer.dockNumber ?? '');
              }
            }}
            placeholder={loading ? 'Memuat customer…' : 'Pilih customer aktif'}
            error={errorFor('customerId')}
          />

          <Select
            label="Order Channel"
            options={Object.values(OrderChannel).map((channel) => ({
              value: channel,
              label: ORDER_CHANNEL_LABEL[channel],
            }))}
            value={orderChannel}
            onChange={(value) => setOrderChannel(value as OrderChannel)}
            placeholder="Wajib dipilih"
            error={errorFor('orderChannel')}
            supportingText="Asal demand, wajib diisi agar order dapat ditelusuri."
          />

          <FilledTextField
            label="Nomor PO Customer"
            value={poNumber}
            onChange={(e) => setPoNumber(e.target.value)}
            error={errorFor('poNumber')}
          />

          <DateField
            label="Tanggal Order"
            type="date"
            value={orderDate}
            onChange={(e) => setOrderDate(e.target.value)}
            error={errorFor('orderDate')}
          />

          <DateField
            label="Tanggal Pengiriman Diminta"
            type="date"
            value={requestedDeliveryDate}
            onChange={(e) => setRequestedDeliveryDate(e.target.value)}
            error={errorFor('requestedDeliveryDate')}
          />

          <FilledTextField
            label="PIC Customer"
            value={customerPic}
            onChange={(e) => setCustomerPic(e.target.value)}
            error={errorFor('customerPic')}
          />

          <FilledTextField
            label="Alamat Pengiriman"
            value={deliveryAddress}
            onChange={(e) => setDeliveryAddress(e.target.value)}
            error={errorFor('deliveryAddress')}
            supportingText={selectedCustomer ? 'Terisi dari master customer, dapat diubah.' : undefined}
          />

          <FilledTextField
            label="Nomor Dock"
            value={dockNumber}
            onChange={(e) => setDockNumber(e.target.value)}
            error={errorFor('dockNumber')}
          />
        </div>
      </section>

      <section>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 'var(--space-4)',
          }}
        >
          <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: 'var(--color-on-surface)' }}>
            Order Line
          </h2>
          <Button variant="outlined" size="sm" onClick={() => setLines((c) => [...c, emptyLine()])}>
            <Icon name="add" size={16} /> Tambah Baris
          </Button>
        </div>

        {errorFor('lines') && (
          <p style={{ margin: `0 0 var(--space-3)`, fontSize: '12px', color: 'var(--color-error)' }}>
            {errorFor('lines')}
          </p>
        )}

        {lines.length === 0 ? (
          <EmptyState
            icon="playlist_add"
            title="Belum ada order line"
            description="Satu order dapat memuat beberapa product. Tambahkan baris pertama untuk memulai."
            actionLabel="Tambah Baris"
            onAction={() => setLines([emptyLine()])}
          />
        ) : (
          <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
            {lines.map((line, index) => (
              <div
                key={line.key}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(200px, 2fr) minmax(120px, 1fr) minmax(120px, 1fr) minmax(160px, 1fr) auto',
                  gap: 'var(--space-3)',
                  alignItems: 'start',
                  padding: 'var(--space-3)',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--color-surface-container)',
                }}
              >
                <Select
                  label={`Product baris ${index + 1}`}
                  searchable
                  options={activeProducts.map((p) => ({ value: p.id, label: `${p.sku} — ${p.name}` }))}
                  value={line.productId}
                  onChange={(value) => updateLine(line.key, { productId: value })}
                  placeholder="Pilih product aktif"
                  error={errorFor(`lines[${index}].productId`)}
                />
                <FilledTextField
                  label="Quantity"
                  type="number"
                  min={1}
                  value={line.orderedQuantity || ''}
                  onChange={(e) => updateLine(line.key, { orderedQuantity: Number(e.target.value) })}
                  error={errorFor(`lines[${index}].orderedQuantity`)}
                />
                <FilledTextField
                  label="Model / Tipe"
                  value={line.modelType ?? ''}
                  onChange={(e) => updateLine(line.key, { modelType: e.target.value })}
                />
                <DateField
                  label="Kirim (opsional)"
                  type="date"
                  value={line.requestedDeliveryDate ?? ''}
                  onChange={(e) => updateLine(line.key, { requestedDeliveryDate: e.target.value })}
                  supportingText="Kosongkan untuk mengikuti tanggal order."
                />
                <div style={{ paddingTop: 'var(--space-5)' }}>
                  <Button
                    variant="text"
                    size="sm"
                    onClick={() => setLines((c) => c.filter((l) => l.key !== line.key))}
                    aria-label={`Hapus baris ${index + 1}`}
                  >
                    <Icon name="delete" size={18} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      </div>
    </Dialog>
  );
};
