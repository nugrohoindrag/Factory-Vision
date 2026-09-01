import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FactoryVisionApiClient, ApiRequestError } from '@factory-vision/api-client';
import {
  AdvancedDataTable,
  ColumnDef,
  Button,
  Icon,
  FilledTextField,
  EmptyState,
  ErrorState,
} from '@factory-vision/ui';
import { Page, Section, SurfaceCard, Dialog, toneContainer, toneOnContainer } from '@factory-vision/ui/fv';
import type { Customer, ApiFieldError } from '@factory-vision/domain-types';

const api = new FactoryVisionApiClient({ baseUrl: '' });

/**
 * Customer master (MES-029-2).
 *
 * Customers are deactivated, never deleted: an order references its customer by
 * foreign key, and last quarter's history stops making sense if the row
 * disappears. An inactive customer keeps showing on the orders that name it and
 * simply stops appearing in the picker for a new one.
 */

const emptyForm = {
  code: '',
  name: '',
  picName: '',
  picContact: '',
  deliveryAddress: '',
  dockNumber: '',
  status: 'ACTIVE' as Customer['status'],
};

export const CustomerMasterPage: React.FC = () => {
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState<Customer | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [fieldErrors, setFieldErrors] = useState<ApiFieldError[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  const customersQuery = useQuery({
    queryKey: ['planning', 'customers'],
    queryFn: () => api.planning.getCustomers(),
  });

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm });
    setFieldErrors([]);
    setFormError(null);
    setShowForm(true);
  };

  const openEdit = (customer: Customer) => {
    setEditing(customer);
    setForm({
      code: customer.code,
      name: customer.name,
      picName: customer.picName ?? '',
      picContact: customer.picContact ?? '',
      deliveryAddress: customer.deliveryAddress ?? '',
      dockNumber: customer.dockNumber ?? '',
      status: customer.status,
    });
    setFieldErrors([]);
    setFormError(null);
    setShowForm(true);
  };

  const onError = (error: unknown) => {
    if (error instanceof ApiRequestError) {
      setFieldErrors(error.fields);
      setFormError(error.message);
    } else {
      setFormError(error instanceof Error ? error.message : 'Gagal menyimpan customer.');
    }
  };

  const save = useMutation({
    mutationFn: () => {
      const body = {
        code: form.code,
        name: form.name,
        picName: form.picName || undefined,
        picContact: form.picContact || undefined,
        deliveryAddress: form.deliveryAddress || undefined,
        dockNumber: form.dockNumber || undefined,
        status: form.status,
      };
      return editing ? api.planning.updateCustomer(editing.id, body) : api.planning.createCustomer(body);
    },
    onSuccess: () => {
      setShowForm(false);
      void queryClient.invalidateQueries({ queryKey: ['planning', 'customers'] });
    },
    onError,
  });

  const toggleStatus = useMutation({
    mutationFn: (customer: Customer) =>
      api.planning.updateCustomer(customer.id, {
        status: customer.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['planning', 'customers'] }),
  });

  const errorFor = (field: string) => fieldErrors.find((e) => e.field === field)?.message;

  const customers = customersQuery.data ?? [];

  const columns: ColumnDef<Customer & { id: string }>[] = [
    { key: 'code', header: 'Kode', sortable: true, render: (row) => <strong>{row.code}</strong> },
    { key: 'name', header: 'Nama', sortable: true },
    { key: 'picName', header: 'PIC', render: (row) => row.picName ?? '—' },
    { key: 'picContact', header: 'Kontak', render: (row) => row.picContact ?? '—' },
    { key: 'dockNumber', header: 'Dock', render: (row) => row.dockNumber ?? '—' },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <span
          style={{
            display: 'inline-flex',
            padding: '2px 10px',
            borderRadius: 'var(--radius-pill)',
            fontSize: '11px',
            fontWeight: 700,
            backgroundColor: toneContainer[row.status === 'ACTIVE' ? 'success' : 'neutral'],
            color: toneOnContainer[row.status === 'ACTIVE' ? 'success' : 'neutral'],
          }}
        >
          {row.status === 'ACTIVE' ? 'Aktif' : 'Nonaktif'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <div style={{ display: 'flex', gap: '4px' }}>
          <Button variant="text" size="sm" onClick={() => openEdit(row)}>
            Ubah
          </Button>
          <Button variant="text" size="sm" onClick={() => toggleStatus.mutate(row)}>
            {row.status === 'ACTIVE' ? 'Nonaktifkan' : 'Aktifkan'}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <Page>
      <Section>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
              Master Customer
            </h1>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--color-on-surface-variant)' }}>
              Kode unik per tenant. Customer nonaktif tidak muncul saat membuat order baru, tetapi tetap
              terbaca pada order lama.
            </p>
          </div>
          <Button variant="filled" onClick={openCreate}>
            <Icon name="add" size={16} /> Customer Baru
          </Button>
        </div>
      </Section>

      <Section>
        {customersQuery.isLoading ? (
          <SurfaceCard padding="lg">
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-on-surface-variant)' }}>
              Memuat customer…
            </p>
          </SurfaceCard>
        ) : customersQuery.isError ? (
          <ErrorState
            title="Gagal memuat customer"
            description="Periksa koneksi ke API lalu coba lagi."
            onRetry={() => void customersQuery.refetch()}
          />
        ) : customers.length === 0 ? (
          <EmptyState
            icon="apartment"
            title="Belum ada customer"
            description="Daftarkan customer beserta PIC, kontak, alamat, dan nomor dock agar order dapat dikaitkan dengan benar."
            actionLabel="Customer Baru"
            onAction={openCreate}
          />
        ) : (
          <AdvancedDataTable
            columns={columns}
            data={customers as (Customer & { id: string })[]}
            title="Customer"
            subtitle={`${customers.length} customer`}
            selectable={false}
          />
        )}
      </Section>

      <Dialog
        isOpen={showForm}
        onClose={() => setShowForm(false)}
        title={editing ? `Ubah ${editing.code}` : 'Customer Baru'}
        maxWidth="620px"
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
          <FilledTextField
            label="Kode"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            error={errorFor('code')}
            supportingText="Unik per tenant."
          />
          <FilledTextField
            label="Nama"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            error={errorFor('name')}
          />
          <FilledTextField
            label="PIC"
            value={form.picName}
            onChange={(e) => setForm({ ...form, picName: e.target.value })}
            error={errorFor('picName')}
          />
          <FilledTextField
            label="Kontak PIC"
            value={form.picContact}
            onChange={(e) => setForm({ ...form, picContact: e.target.value })}
            error={errorFor('picContact')}
          />
          <FilledTextField
            label="Alamat Pengiriman"
            value={form.deliveryAddress}
            onChange={(e) => setForm({ ...form, deliveryAddress: e.target.value })}
            error={errorFor('deliveryAddress')}
          />
          <FilledTextField
            label="Nomor Dock"
            value={form.dockNumber}
            onChange={(e) => setForm({ ...form, dockNumber: e.target.value })}
            error={errorFor('dockNumber')}
          />
        </div>

        {formError && (
          <p style={{ margin: '12px 0 0', fontSize: '12px', color: 'var(--color-error)' }}>{formError}</p>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
          <Button variant="text" onClick={() => setShowForm(false)}>
            Batal
          </Button>
          <Button
            variant="filled"
            disabled={save.isPending || !form.code.trim() || !form.name.trim()}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Menyimpan…' : 'Simpan'}
          </Button>
        </div>
      </Dialog>
    </Page>
  );
};
