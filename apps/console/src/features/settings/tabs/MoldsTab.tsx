import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FactoryVisionApiClient, ApiRequestError } from '@factory-vision/api-client';
import type { Mold } from '@factory-vision/domain-types';
import { Button, Icon, Modal } from '@factory-vision/ui';
import { SurfaceCard, FilterChip, Dialog } from '@factory-vision/ui/fv';
import { useSession } from '../../../app/SessionContext.js';

const api = new FactoryVisionApiClient({ baseUrl: '' });

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 'var(--radius-md, 8px)',
  backgroundColor: 'var(--color-surface-container-high)',
  border: '1px solid var(--color-outline-variant)',
  color: 'var(--color-on-surface)',
  fontSize: '13px',
  boxSizing: 'border-box',
};

const STATUS_LABEL: Record<string, string> = {
  AVAILABLE: 'Tersedia',
  IN_USE: 'Dipakai',
  MAINTENANCE: 'Perawatan',
  RETIRED: 'Tidak dipakai',
};

const STATUSES = ['AVAILABLE', 'IN_USE', 'MAINTENANCE', 'RETIRED'] as const;

interface FormState {
  id?: string;
  code: string;
  name: string;
  cavityCount: number;
  status: string;
  currentMachineId: string;
}

const emptyForm: FormState = {
  code: '',
  name: '',
  cavityCount: 1,
  status: 'AVAILABLE',
  currentMachineId: '',
};

/**
 * MES-006, the mould register — and the screen ADR-36 depends on.
 *
 * The compatibility list is not decoration. A Work Order may only be confirmed
 * without a mould while its product has no active compatibility, so what a
 * planner ticks here decides whether the confirmation checklist demands one.
 * That is why deactivating a link is offered beside deleting it: deactivating
 * changes the rule from today onwards and leaves the record of why past
 * confirmations were allowed; deleting erases both.
 */
export const MoldsTab: React.FC<{ onToast: (message: string) => void }> = ({ onToast }) => {
  const queryClient = useQueryClient();
  const { can } = useSession();
  const editable = can('master_data:manage');

  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [addProductFor, setAddProductFor] = useState<string | null>(null);
  const [productToAdd, setProductToAdd] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Mold | null>(null);

  const { data: molds = [], isLoading } = useQuery({
    queryKey: ['molds'],
    queryFn: () => api.molds.list(),
  });
  const { data: machines = [] } = useQuery({
    queryKey: ['machines'],
    queryFn: () => api.master.getMachines(),
  });
  const { data: products = [] } = useQuery({
    queryKey: ['products'],
    queryFn: () => api.master.getProducts(),
  });

  const { data: detail } = useQuery({
    queryKey: ['mold', expandedId],
    queryFn: () => api.molds.get(expandedId!),
    enabled: expandedId !== null,
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['molds'] });
    void queryClient.invalidateQueries({ queryKey: ['mold'] });
  };

  const fail = (fallback: string) => (err: unknown) =>
    setError(err instanceof ApiRequestError ? err.message : fallback);

  const save = useMutation({
    mutationFn: (payload: FormState) => {
      const body = {
        code: payload.code,
        name: payload.name,
        cavityCount: payload.cavityCount,
        status: payload.status,
        currentMachineId: payload.currentMachineId || null,
      };
      return payload.id ? api.molds.update(payload.id, body) : api.molds.create(body);
    },
    onSuccess: () => {
      onToast('Mold tersimpan.');
      setForm(null);
      setError(null);
      invalidate();
    },
    onError: fail('Gagal menyimpan mold.'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.molds.delete(id),
    onSuccess: () => {
      onToast('Mold dihapus.');
      setPendingDelete(null);
      setError(null);
      invalidate();
    },
    // The API refuses to delete a mould production has referenced and says so;
    // showing its message is more useful than a generic failure, because it
    // names the alternative (set the status to "Tidak dipakai").
    onError: (err) => {
      setPendingDelete(null);
      fail('Gagal menghapus mold.')(err);
    },
  });

  const addCompatibility = useMutation({
    mutationFn: ({ moldId, productId }: { moldId: string; productId: string }) =>
      api.molds.addCompatibility(moldId, productId),
    onSuccess: () => {
      onToast('Produk ditambahkan ke daftar kompatibilitas.');
      setAddProductFor(null);
      setProductToAdd('');
      setError(null);
      invalidate();
    },
    onError: fail('Gagal menambahkan kompatibilitas.'),
  });

  const toggleCompatibility = useMutation({
    mutationFn: ({
      moldId,
      compatibilityId,
      active,
    }: {
      moldId: string;
      compatibilityId: string;
      active: boolean;
    }) => api.molds.setCompatibilityActive(moldId, compatibilityId, active),
    onSuccess: (_data, variables) => {
      onToast(
        variables.active
          ? 'Kompatibilitas diaktifkan. Work Order produk ini kini wajib memilih mold.'
          : 'Kompatibilitas dinonaktifkan.'
      );
      setError(null);
      invalidate();
    },
    onError: fail('Gagal mengubah kompatibilitas.'),
  });

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return molds.filter((mold) => {
      if (statusFilter && mold.status !== statusFilter) return false;
      if (!needle) return true;
      return (
        mold.code.toLowerCase().includes(needle) || mold.name.toLowerCase().includes(needle)
      );
    });
  }, [molds, statusFilter, search]);

  const machineName = (id?: string): string =>
    machines.find((m) => m.id === id)?.code ?? 'belum terpasang';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari kode atau nama mold…"
          style={{ ...inputStyle, width: '260px' }}
        />
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {STATUSES.map((status) => (
            <FilterChip
              key={status}
              selected={statusFilter === status}
              onClick={() => setStatusFilter(statusFilter === status ? null : status)}
            >
              {STATUS_LABEL[status]}
            </FilterChip>
          ))}
        </div>
        <div style={{ marginLeft: 'auto' }}>
          {editable && (
            <Button
              variant="filled"
              icon={<Icon name="add" size={16} />}
              onClick={() => {
                setForm({ ...emptyForm });
                setError(null);
              }}
            >
              Tambah Mold
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            padding: '10px 12px',
            borderRadius: 'var(--radius-sm, 8px)',
            backgroundColor: 'var(--color-error-container)',
            color: 'var(--color-on-error-container)',
            fontSize: '12px',
            fontWeight: 600,
          }}
        >
          {error}
        </div>
      )}

      {isLoading ? (
        <Empty label="Memuat mold…" />
      ) : visible.length === 0 ? (
        <Empty
          label={
            molds.length === 0
              ? 'Belum ada mold terdaftar. Tambahkan mold agar dapat dipilih pada Work Order.'
              : 'Tidak ada mold yang cocok dengan filter ini.'
          }
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {visible.map((mold) => {
            const open = expandedId === mold.id;
            const compatibilities = open ? (detail?.compatibilities ?? []) : [];
            const activeCount = compatibilities.filter((c) => c.active).length;

            return (
              <SurfaceCard key={mold.id} padding="md">
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: '10px',
                  }}
                >
                  <div>
                    <div
                      style={{ fontSize: '14px', fontWeight: 800, color: 'var(--color-on-surface)' }}
                    >
                      {mold.code} · {mold.name}
                    </div>
                    <div
                      style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)', marginTop: '2px' }}
                    >
                      {mold.cavityCount} cavity · mesin {machineName(mold.currentMachineId)}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <StatusPill status={mold.status} />
                    <Button
                      variant="text"
                      onClick={() => setExpandedId(open ? null : mold.id)}
                      icon={<Icon name={open ? 'expand_less' : 'expand_more'} size={16} />}
                    >
                      Produk
                    </Button>
                    {editable && (
                      <>
                        <Button
                          variant="text"
                          onClick={() => {
                            setError(null);
                            setForm({
                              id: mold.id,
                              code: mold.code,
                              name: mold.name,
                              cavityCount: mold.cavityCount,
                              status: mold.status,
                              currentMachineId: mold.currentMachineId ?? '',
                            });
                          }}
                        >
                          Ubah
                        </Button>
                        <Button variant="text" onClick={() => setPendingDelete(mold)}>
                          Hapus
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {open && (
                  <div
                    style={{
                      marginTop: '12px',
                      paddingTop: '12px',
                      borderTop: '1px solid var(--color-outline-variant)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: '8px',
                      }}
                    >
                      <div
                        style={{
                          fontSize: '12px',
                          fontWeight: 700,
                          color: 'var(--color-on-surface)',
                        }}
                      >
                        Produk yang dapat dicetak mold ini
                      </div>
                      {editable && (
                        <Button
                          variant="text"
                          icon={<Icon name="add" size={14} />}
                          onClick={() => {
                            setAddProductFor(mold.id);
                            setProductToAdd(products[0]?.id ?? '');
                          }}
                        >
                          Tambah Produk
                        </Button>
                      )}
                    </div>

                    <p
                      style={{
                        margin: '0 0 10px',
                        fontSize: '11px',
                        color: 'var(--color-on-surface-variant)',
                      }}
                    >
                      {activeCount === 0
                        ? 'Tidak ada kompatibilitas aktif, sehingga Work Order untuk produk manapun tidak diwajibkan memilih mold.'
                        : `${activeCount} kompatibilitas aktif. Work Order untuk produk tersebut wajib memilih mold sebelum dapat dikonfirmasi.`}
                    </p>

                    {compatibilities.length === 0 ? (
                      <Empty label="Belum ada produk yang dikaitkan." />
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {compatibilities.map((compatibility) => (
                          <div
                            key={compatibility.id}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              gap: '10px',
                              padding: '8px 10px',
                              borderRadius: 'var(--radius-sm, 8px)',
                              border: '1px solid var(--color-outline-variant)',
                              backgroundColor: 'var(--color-surface-container)',
                            }}
                          >
                            <div>
                              <div
                                style={{
                                  fontSize: '12px',
                                  fontWeight: 700,
                                  color: 'var(--color-on-surface)',
                                }}
                              >
                                {compatibility.productSku ?? compatibility.productId}
                              </div>
                              <div
                                style={{
                                  fontSize: '11px',
                                  color: 'var(--color-on-surface-variant)',
                                }}
                              >
                                {compatibility.productName ?? '—'}
                              </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span
                                style={{
                                  fontSize: '10px',
                                  fontWeight: 700,
                                  padding: '3px 8px',
                                  borderRadius: '999px',
                                  backgroundColor: compatibility.active
                                    ? 'var(--color-primary-container)'
                                    : 'var(--color-surface-container-highest)',
                                  color: compatibility.active
                                    ? 'var(--color-on-primary-container)'
                                    : 'var(--color-on-surface-variant)',
                                }}
                              >
                                {compatibility.active ? 'AKTIF' : 'NONAKTIF'}
                              </span>
                              {editable && (
                                <Button
                                  variant="text"
                                  onClick={() =>
                                    toggleCompatibility.mutate({
                                      moldId: mold.id,
                                      compatibilityId: compatibility.id,
                                      active: !compatibility.active,
                                    })
                                  }
                                >
                                  {compatibility.active ? 'Nonaktifkan' : 'Aktifkan'}
                                </Button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </SurfaceCard>
            );
          })}
        </div>
      )}

      {/* --- Create / edit --- */}
      <Modal
        isOpen={form !== null}
        onClose={() => setForm(null)}
        title={form?.id ? 'Ubah Mold' : 'Tambah Mold'}
      >
        {form && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <Field label="Kode">
              <input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="MLD-001"
                style={inputStyle}
              />
            </Field>

            <Field label="Nama">
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Mold Tapak Ban 195/65"
                style={inputStyle}
              />
            </Field>

            <Field label="Jumlah cavity">
              <input
                type="number"
                min={1}
                value={form.cavityCount}
                onChange={(e) => setForm({ ...form, cavityCount: Number(e.target.value) })}
                style={inputStyle}
              />
            </Field>

            <Field label="Status">
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                style={inputStyle}
              >
                {STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABEL[status]}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Terpasang pada mesin">
              <select
                value={form.currentMachineId}
                onChange={(e) => setForm({ ...form, currentMachineId: e.target.value })}
                style={inputStyle}
              >
                <option value="">Belum terpasang</option>
                {machines.map((machine) => (
                  <option key={machine.id} value={machine.id}>
                    {machine.code} · {machine.name}
                  </option>
                ))}
              </select>
            </Field>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <Button variant="text" onClick={() => setForm(null)}>
                Batal
              </Button>
              <Button
                variant="filled"
                disabled={
                  save.isPending ||
                  form.code.trim().length < 2 ||
                  form.name.trim().length < 2 ||
                  form.cavityCount < 1
                }
                onClick={() => save.mutate(form)}
              >
                {save.isPending ? 'Menyimpan…' : 'Simpan'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* --- Add compatibility --- */}
      <Modal
        isOpen={addProductFor !== null}
        onClose={() => setAddProductFor(null)}
        title="Tambah Produk Kompatibel"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
            Setelah ditambahkan, Work Order untuk produk ini wajib memilih mold sebelum dapat
            dikonfirmasi.
          </p>
          <Field label="Produk">
            <select
              value={productToAdd}
              onChange={(e) => setProductToAdd(e.target.value)}
              style={inputStyle}
            >
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.sku} · {product.name}
                </option>
              ))}
            </select>
          </Field>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <Button variant="text" onClick={() => setAddProductFor(null)}>
              Batal
            </Button>
            <Button
              variant="filled"
              disabled={!productToAdd || addCompatibility.isPending}
              onClick={() =>
                addCompatibility.mutate({ moldId: addProductFor!, productId: productToAdd })
              }
            >
              {addCompatibility.isPending ? 'Menyimpan…' : 'Tambah'}
            </Button>
          </div>
        </div>
      </Modal>

      <Dialog
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Hapus Mold"
        supportingText={
          pendingDelete
            ? `Hapus mold "${pendingDelete.code}" (${pendingDelete.name})? Mold yang pernah dipakai work order tidak dapat dihapus, ubah statusnya menjadi "Tidak dipakai".`
            : ''
        }
        confirmLabel={remove.isPending ? 'Menghapus…' : 'Hapus Mold'}
        cancelLabel="Batal"
        destructive
        onConfirm={() => pendingDelete && remove.mutate(pendingDelete.id)}
      />
    </div>
  );
};

const StatusPill: React.FC<{ status: string }> = ({ status }) => {
  const retired = status === 'RETIRED';
  const maintenance = status === 'MAINTENANCE';
  return (
    <span
      style={{
        fontSize: '10px',
        fontWeight: 800,
        padding: '4px 10px',
        borderRadius: '999px',
        backgroundColor: retired
          ? 'var(--color-surface-container-highest)'
          : maintenance
            ? 'var(--color-warning-container)'
            : 'var(--color-secondary-container)',
        color: retired
          ? 'var(--color-on-surface-variant)'
          : maintenance
            ? 'var(--color-on-warning-container)'
            : 'var(--color-on-secondary-container)',
      }}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
    <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-on-surface-variant)' }}>
      {label}
    </span>
    {children}
  </label>
);

const Empty: React.FC<{ label: string }> = ({ label }) => (
  <div
    style={{
      padding: '20px',
      textAlign: 'center',
      color: 'var(--color-on-surface-variant)',
      fontSize: '12px',
    }}
  >
    {label}
  </div>
);
