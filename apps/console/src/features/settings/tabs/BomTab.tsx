import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FactoryVisionApiClient, ApiRequestError } from '@factory-vision/api-client';
import type {
  BillOfMaterial,
  BillOfMaterialItem,
  BillOfMaterialStatus,
  BomComponentType,
  CreateBomInput,
  Product,
} from '@factory-vision/domain-types';
import { Button, Icon, Modal } from '@factory-vision/ui';
import { SurfaceCard, FilterChip, Dialog } from '@factory-vision/ui/fv';
import { useSession } from '../../../app/SessionContext.js';
import { useNewlyCreated } from '../../common/useNewlyCreated.js';

const api = new FactoryVisionApiClient({ baseUrl: '' });

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: 'var(--space-3)',
  borderRadius: 'var(--radius-md, 8px)',
  backgroundColor: 'var(--color-surface-container-high)',
  border: '1px solid var(--color-outline-variant)',
  color: 'var(--color-on-surface)',
  fontSize: '13px',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '11.5px',
  fontWeight: 700,
  color: 'var(--color-on-surface-variant)',
  marginBottom: 'var(--space-1)',
};

const COMPONENT_TYPE_LABELS: Record<BomComponentType, string> = {
  RAW_MATERIAL: 'Bahan Baku (Raw Material)',
  COMPONENT: 'Komponen (Component)',
  SUB_ASSEMBLY: 'Sub-Assembly',
  PACKAGING: 'Kemasan (Packaging)',
};

interface FormItem {
  id?: string;
  componentPartId: string;
  componentPartSku: string;
  componentPartName: string;
  componentType: BomComponentType;
  quantity: number;
  uom: string;
  scrapPercentage: number;
  sequence: number;
  reference?: string;
  notes?: string;
}

interface FormState {
  id?: string;
  productId: string;
  bomName: string;
  version: string;
  productRevision?: string;
  status: BillOfMaterialStatus;
  effectiveDate: string;
  endDate?: string;
  description?: string;
  components: FormItem[];
}

const emptyItem: FormItem = {
  componentPartId: '',
  componentPartSku: '',
  componentPartName: '',
  componentType: 'RAW_MATERIAL',
  quantity: 1,
  uom: 'PCS',
  scrapPercentage: 0,
  sequence: 1,
  notes: '',
};

export const BomTab: React.FC<{ onToast: (message: string) => void }> = ({ onToast }) => {
  const queryClient = useQueryClient();
  const { can } = useSession();
  const editable = can('master_data:manage');

  const { isNewlyCreated, markNewlyCreated, sortWithNewlyCreated, NewlyCreatedBadge } =
    useNewlyCreated<BillOfMaterial>();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<BillOfMaterialStatus | 'ALL'>('ALL');
  const [productFilter, setProductFilter] = useState<string>('ALL');
  const [expandedBomId, setExpandedBomId] = useState<string | null>(null);

  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BillOfMaterial | null>(null);
  const [pendingStatusChange, setPendingStatusChange] = useState<{
    bom: BillOfMaterial;
    newStatus: BillOfMaterialStatus;
  } | null>(null);

  // Queries
  const { data: boms = [], isLoading: isLoadingBoms } = useQuery({
    queryKey: ['boms'],
    queryFn: () => api.master.getBoms(),
  });

  const { data: products = [] } = useQuery({
    queryKey: ['products'],
    queryFn: () => api.master.getProducts(),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['boms'] });
  };

  // Mutations
  const saveMutation = useMutation({
    mutationFn: (payload: FormState) => {
      const input: CreateBomInput = {
        productId: payload.productId,
        bomName: payload.bomName.trim(),
        version: payload.version.trim() || 'v1.0',
        productRevision: payload.productRevision?.trim(),
        status: payload.status,
        effectiveDate: payload.effectiveDate || new Date().toISOString().slice(0, 10),
        endDate: payload.endDate || undefined,
        description: payload.description?.trim(),
        components: payload.components.map((c, idx) => ({
          componentPartId: c.componentPartId || c.componentPartSku,
          componentType: c.componentType,
          quantity: Number(c.quantity),
          uom: c.uom.trim() || 'PCS',
          scrapPercentage: Number(c.scrapPercentage || 0),
          sequence: c.sequence || idx + 1,
          reference: c.reference?.trim(),
          notes: c.notes?.trim(),
        })),
      };

      return payload.id
        ? api.master.updateBom(payload.id, input)
        : api.master.createBom(input);
    },
    onSuccess: (saved) => {
      invalidate();
      markNewlyCreated(saved.id);
      onToast(form?.id ? 'Bill of Material berhasil diperbarui.' : 'Bill of Material baru berhasil dibuat.');
      setForm(null);
      setError(null);
    },
    onError: (err) => {
      setError(err instanceof ApiRequestError ? err.message : 'Gagal menyimpan Bill of Material.');
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: BillOfMaterialStatus }) =>
      api.master.setBomStatus(id, status),
    onSuccess: (updated) => {
      invalidate();
      onToast(`Status BOM diubah menjadi ${updated.status}.`);
      setPendingStatusChange(null);
    },
    onError: (err) => {
      onToast(err instanceof ApiRequestError ? err.message : 'Gagal mengubah status BOM.');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.master.deleteBom(id),
    onSuccess: () => {
      invalidate();
      onToast('Bill of Material berhasil dihapus.');
      setPendingDelete(null);
    },
    onError: (err) => {
      onToast(err instanceof ApiRequestError ? err.message : 'Gagal menghapus Bill of Material.');
    },
  });

  // Filtered & Newly Created Sorted BOMs
  const filteredBoms = useMemo(() => {
    let result = [...boms];
    if (statusFilter !== 'ALL') {
      result = result.filter((b) => b.status === statusFilter);
    }
    if (productFilter !== 'ALL') {
      result = result.filter((b) => b.productId === productFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (b) =>
          b.bomNumber.toLowerCase().includes(q) ||
          b.bomName.toLowerCase().includes(q) ||
          b.productSku.toLowerCase().includes(q) ||
          b.productName.toLowerCase().includes(q)
      );
    }
    return sortWithNewlyCreated(result);
  }, [boms, statusFilter, productFilter, search, sortWithNewlyCreated]);

  const openCreateModal = () => {
    const firstProduct = products[0];
    setForm({
      productId: firstProduct?.id || '',
      bomName: '',
      version: 'v1.0',
      productRevision: '',
      status: 'ACTIVE',
      effectiveDate: new Date().toISOString().slice(0, 10),
      description: '',
      components: [{ ...emptyItem }],
    });
    setError(null);
  };

  const openEditModal = (bom: BillOfMaterial) => {
    setForm({
      id: bom.id,
      productId: bom.productId,
      bomName: bom.bomName,
      version: bom.version,
      productRevision: bom.productRevision || '',
      status: bom.status,
      effectiveDate: bom.effectiveDate,
      endDate: bom.endDate,
      description: bom.description || '',
      components: bom.components.map((c, i) => ({
        id: c.id,
        componentPartId: c.componentPartId,
        componentPartSku: c.componentPartSku,
        componentPartName: c.componentPartName,
        componentType: c.componentType,
        quantity: c.quantity,
        uom: c.uom,
        scrapPercentage: c.scrapPercentage || 0,
        sequence: c.sequence || i + 1,
        reference: c.reference,
        notes: c.notes,
      })),
    });
    setError(null);
  };

  const addComponentRow = () => {
    if (!form) return;
    setForm({
      ...form,
      components: [
        ...form.components,
        { ...emptyItem, sequence: form.components.length + 1 },
      ],
    });
  };

  const removeComponentRow = (index: number) => {
    if (!form) return;
    const updated = form.components.filter((_, i) => i !== index);
    setForm({ ...form, components: updated });
  };

  const updateComponentField = <K extends keyof FormItem>(
    index: number,
    field: K,
    value: FormItem[K]
  ) => {
    if (!form) return;
    const updated = [...form.components];
    updated[index] = { ...updated[index], [field]: value };
    // If componentPartId changed to a product, auto-fill SKU & Name
    if (field === 'componentPartId') {
      const found = products.find((p) => p.id === value);
      if (found) {
        updated[index].componentPartSku = found.sku;
        updated[index].componentPartName = found.name;
        updated[index].uom = found.unit || 'PCS';
      }
    }
    setForm({ ...form, components: updated });
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    if (!form.productId) {
      setError('Pilih produk target untuk Bill of Material.');
      return;
    }
    if (!form.bomName.trim()) {
      setError('Nama BOM tidak boleh kosong.');
      return;
    }
    if (form.components.length === 0) {
      setError('Tambahkan minimal 1 komponen pada Bill of Material.');
      return;
    }
    for (let i = 0; i < form.components.length; i++) {
      const c = form.components[i];
      if (!c.componentPartId && !c.componentPartSku.trim()) {
        setError(`Komponen pada baris #${i + 1} belum memiliki part/SKU.`);
        return;
      }
      if (!c.quantity || Number(c.quantity) <= 0) {
        setError(`Kuantitas pada baris #${i + 1} harus lebih besar dari 0.`);
        return;
      }
    }
    saveMutation.mutate(form);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {/* Header & Control Bar */}
      <SurfaceCard padding="md">
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--space-3)',
          }}
        >
          <div>
            <div style={{ fontSize: '16px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
              Bill of Material (BOM)
            </div>
            <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)', marginTop: '2px' }}>
              Kelola struktur resep produksi, daftar material/komponen, rasio scrap, dan multi-versi perakitan
            </div>
          </div>

          {editable && (
            <Button
              variant="filled"
              icon={<Icon name="add" size={16} />}
              onClick={openCreateModal}
            >
              Buat BOM Baru
            </Button>
          )}
        </div>

        {/* Filters Bar */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 'var(--space-3)',
            marginTop: 'var(--space-4)',
            paddingTop: 'var(--space-3)',
            borderTop: '1px solid var(--color-outline-variant)',
          }}
        >
          {/* Search */}
          <div style={{ position: 'relative', minWidth: '240px', flex: 1 }}>
            <span
              style={{
                position: 'absolute',
                left: '10px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--color-on-surface-variant)',
                pointerEvents: 'none',
              }}
            >
              <Icon name="search" size={16} />
            </span>
            <input
              type="text"
              placeholder="Cari nomor BOM, nama, SKU..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                ...inputStyle,
                paddingLeft: '32px',
                height: '38px',
              }}
            />
          </div>

          {/* Product Filter */}
          <div style={{ minWidth: '200px' }}>
            <select
              value={productFilter}
              onChange={(e) => setProductFilter(e.target.value)}
              style={{
                ...inputStyle,
                height: '38px',
                cursor: 'pointer',
              }}
            >
              <option value="ALL">Semua Produk ({products.length})</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.sku} - {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Status Filter Chips */}
          <div style={{ display: 'flex', gap: 'var(--space-1)', alignItems: 'center' }}>
            {(['ALL', 'ACTIVE', 'DRAFT', 'INACTIVE'] as const).map((st) => (
              <FilterChip
                key={st}
                selected={statusFilter === st}
                onClick={() => setStatusFilter(st)}
              >
                {st === 'ALL'
                  ? 'Semua'
                  : st === 'ACTIVE'
                    ? 'Aktif'
                    : st === 'DRAFT'
                      ? 'Draf'
                      : 'Nonaktif'}
              </FilterChip>
            ))}
          </div>
        </div>
      </SurfaceCard>

      {/* List of BOMs */}
      {isLoadingBoms ? (
        <SurfaceCard padding="lg">
          <div style={{ textAlign: 'center', padding: 'var(--space-6)', color: 'var(--color-on-surface-variant)' }}>
            Memuat data Bill of Material…
          </div>
        </SurfaceCard>
      ) : filteredBoms.length === 0 ? (
        <SurfaceCard padding="lg">
          <div
            style={{
              textAlign: 'center',
              padding: 'var(--space-8)',
              color: 'var(--color-on-surface-variant)',
            }}
          >
            <Icon name="schema" size={40} />
            <div style={{ fontSize: '14px', fontWeight: 700, marginTop: 'var(--space-2)' }}>
              Belum ada Bill of Material yang sesuai kriteria.
            </div>
            {editable && (
              <div style={{ marginTop: 'var(--space-3)' }}>
                <Button variant="outlined" onClick={openCreateModal}>
                  Buat BOM Sekarang
                </Button>
              </div>
            )}
          </div>
        </SurfaceCard>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {filteredBoms.map((bom) => {
            const isHighlighted = isNewlyCreated(bom.id);
            const isExpanded = expandedBomId === bom.id;

            return (
              <SurfaceCard
                key={bom.id}
                padding="md"
                style={{
                  border: isHighlighted
                    ? '1.5px solid var(--color-success)'
                    : '1px solid var(--color-outline-variant)',
                  backgroundColor: isHighlighted
                    ? 'color-mix(in srgb, var(--color-success) 4%, var(--color-surface))'
                    : undefined,
                  transition: 'all 0.2s ease',
                }}
              >
                {/* Main BOM Row Header */}
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 'var(--space-3)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    <div
                      style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: 'var(--radius-md, 8px)',
                        backgroundColor:
                          bom.status === 'ACTIVE'
                            ? 'color-mix(in srgb, var(--color-success) 14%, transparent)'
                            : 'var(--color-surface-container-high)',
                        color:
                          bom.status === 'ACTIVE'
                            ? 'var(--color-success)'
                            : 'var(--color-on-surface-variant)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Icon name="schema" size={20} />
                    </div>

                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                        <span style={{ fontSize: '14px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
                          {bom.bomNumber}
                        </span>
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            padding: '1px 6px',
                            borderRadius: 'var(--radius-xs, 4px)',
                            backgroundColor: 'var(--color-surface-container-high)',
                            color: 'var(--color-on-surface-variant)',
                          }}
                        >
                          {bom.version}
                        </span>
                        {bom.productRevision && (
                          <span
                            style={{
                              fontSize: '10.5px',
                              padding: '1px 5px',
                              borderRadius: 'var(--radius-xs, 4px)',
                              backgroundColor: 'var(--color-surface-container)',
                              color: 'var(--color-on-surface-variant)',
                            }}
                          >
                            Rev {bom.productRevision}
                          </span>
                        )}
                        {/* Visual Highlight Badge */}
                        {isHighlighted && <NewlyCreatedBadge />}
                      </div>

                      <div
                        style={{
                          fontSize: '13px',
                          fontWeight: 600,
                          color: 'var(--color-on-surface)',
                          marginTop: '2px',
                        }}
                      >
                        {bom.bomName}
                      </div>

                      <div
                        style={{
                          fontSize: '11.5px',
                          color: 'var(--color-on-surface-variant)',
                          marginTop: '2px',
                        }}
                      >
                        Produk: <strong>{bom.productSku}</strong> - {bom.productName}
                      </div>
                    </div>
                  </div>

                  {/* Status & Actions */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    {/* Status Badge */}
                    <span
                      style={{
                        padding: '3px 10px',
                        borderRadius: 'var(--radius-pill, 9999px)',
                        fontSize: '11px',
                        fontWeight: 800,
                        backgroundColor:
                          bom.status === 'ACTIVE'
                            ? 'color-mix(in srgb, var(--color-success) 14%, transparent)'
                            : bom.status === 'DRAFT'
                              ? 'color-mix(in srgb, var(--color-warning) 14%, transparent)'
                              : 'var(--color-surface-container-high)',
                        color:
                          bom.status === 'ACTIVE'
                            ? 'var(--color-success)'
                            : bom.status === 'DRAFT'
                              ? 'var(--color-warning)'
                              : 'var(--color-on-surface-variant)',
                        border:
                          bom.status === 'ACTIVE'
                            ? '1px solid color-mix(in srgb, var(--color-success) 30%, transparent)'
                            : bom.status === 'DRAFT'
                              ? '1px solid color-mix(in srgb, var(--color-warning) 30%, transparent)'
                              : '1px solid var(--color-outline-variant)',
                      }}
                    >
                      {bom.status === 'ACTIVE'
                        ? 'AKTIF'
                        : bom.status === 'DRAFT'
                          ? 'DRAF'
                          : 'NONAKTIF'}
                    </span>

                    {/* Toggle Breakdown Items */}
                    <Button
                      variant="text"
                      icon={<Icon name={isExpanded ? 'expand_less' : 'expand_more'} size={18} />}
                      onClick={() => setExpandedBomId(isExpanded ? null : bom.id)}
                    >
                      {bom.components.length} Komponen
                    </Button>

                    {editable && (
                      <>
                        {/* Status Switcher Button */}
                        {bom.status === 'ACTIVE' ? (
                          <Button
                            variant="outlined"
                            onClick={() =>
                              setPendingStatusChange({ bom, newStatus: 'INACTIVE' })
                            }
                          >
                            Nonaktifkan
                          </Button>
                        ) : (
                          <Button
                            variant="filled"
                            onClick={() =>
                              setPendingStatusChange({ bom, newStatus: 'ACTIVE' })
                            }
                          >
                            Aktifkan
                          </Button>
                        )}

                        {/* Edit Button */}
                        <Button
                          variant="tonal"
                          icon={<Icon name="edit" size={16} />}
                          onClick={() => openEditModal(bom)}
                        >
                          Ubah
                        </Button>

                        {/* Delete Button */}
                        <Button
                          variant="text"
                          icon={<Icon name="delete" size={16} />}
                          onClick={() => setPendingDelete(bom)}
                          style={{ color: 'var(--color-error)' }}
                        >
                          Hapus
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {/* Description if present */}
                {bom.description && (
                  <div
                    style={{
                      marginTop: 'var(--space-2)',
                      padding: 'var(--space-2) var(--space-3)',
                      backgroundColor: 'var(--color-surface-container-low)',
                      borderRadius: 'var(--radius-sm, 6px)',
                      fontSize: '12px',
                      color: 'var(--color-on-surface-variant)',
                    }}
                  >
                    {bom.description}
                  </div>
                )}

                {/* Expanded Components Table */}
                {isExpanded && (
                  <div
                    style={{
                      marginTop: 'var(--space-3)',
                      paddingTop: 'var(--space-3)',
                      borderTop: '1px solid var(--color-outline-variant)',
                    }}
                  >
                    <div
                      style={{
                        fontSize: '12px',
                        fontWeight: 700,
                        color: 'var(--color-on-surface)',
                        marginBottom: 'var(--space-2)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-2)',
                      }}
                    >
                      <Icon name="list" size={16} />
                      <span>Rincian Struktur Komponen (Bill of Material Items)</span>
                    </div>

                    <div style={{ overflowX: 'auto' }}>
                      <table
                        style={{
                          width: '100%',
                          borderCollapse: 'collapse',
                          fontSize: '12px',
                          textAlign: 'left',
                        }}
                      >
                        <thead>
                          <tr
                            style={{
                              borderBottom: '1px solid var(--color-outline-variant)',
                              color: 'var(--color-on-surface-variant)',
                              backgroundColor: 'var(--color-surface-container)',
                            }}
                          >
                            <th style={{ padding: '8px' }}>Line</th>
                            <th style={{ padding: '8px' }}>Part SKU</th>
                            <th style={{ padding: '8px' }}>Nama Part / Material</th>
                            <th style={{ padding: '8px' }}>Tipe</th>
                            <th style={{ padding: '8px', textAlign: 'right' }}>Kuantitas</th>
                            <th style={{ padding: '8px' }}>Satuan</th>
                            <th style={{ padding: '8px', textAlign: 'right' }}>Scrap (%)</th>
                            <th style={{ padding: '8px' }}>Keterangan</th>
                          </tr>
                        </thead>
                        <tbody>
                          {bom.components.map((c) => (
                            <tr
                              key={c.id}
                              style={{
                                borderBottom: '1px solid var(--color-outline-variant)',
                              }}
                            >
                              <td style={{ padding: '8px', fontWeight: 700 }}>
                                #{c.lineNumber || c.sequence}
                              </td>
                              <td style={{ padding: '8px', fontWeight: 600 }}>
                                <code>{c.componentPartSku}</code>
                              </td>
                              <td style={{ padding: '8px' }}>{c.componentPartName}</td>
                              <td style={{ padding: '8px' }}>
                                <span
                                  style={{
                                    fontSize: '10.5px',
                                    padding: '2px 6px',
                                    borderRadius: 'var(--radius-xs, 4px)',
                                    backgroundColor: 'var(--color-surface-container-high)',
                                  }}
                                >
                                  {c.componentType}
                                </span>
                              </td>
                              <td style={{ padding: '8px', textAlign: 'right', fontWeight: 700 }}>
                                {c.quantity}
                              </td>
                              <td style={{ padding: '8px' }}>{c.uom}</td>
                              <td style={{ padding: '8px', textAlign: 'right' }}>
                                {c.scrapPercentage ? `${c.scrapPercentage}%` : '0%'}
                              </td>
                              <td
                                style={{
                                  padding: '8px',
                                  color: 'var(--color-on-surface-variant)',
                                  fontSize: '11.5px',
                                }}
                              >
                                {c.notes || '-'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </SurfaceCard>
            );
          })}
        </div>
      )}

      {/* Modal: Buat / Ubah BOM */}
      {form && (
        <Modal
          isOpen={true}
          onClose={() => setForm(null)}
          title={form.id ? 'Ubah Bill of Material (BOM)' : 'Buat Bill of Material (BOM) Baru'}
        >
          <form
            onSubmit={handleFormSubmit}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-4)',
              maxHeight: '80vh',
              overflowY: 'auto',
              paddingRight: 'var(--space-2)',
            }}
          >
            {error && (
              <div
                style={{
                  padding: 'var(--space-3)',
                  borderRadius: 'var(--radius-sm, 6px)',
                  backgroundColor: 'var(--color-error-container)',
                  color: 'var(--color-on-error-container)',
                  fontSize: '12.5px',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                }}
              >
                <Icon name="error" size={18} />
                <span>{error}</span>
              </div>
            )}

            {/* Target Product */}
            <div>
              <label style={labelStyle}>Produk Hasil Produksi *</label>
              <select
                disabled={Boolean(form.id)}
                value={form.productId}
                onChange={(e) => setForm({ ...form, productId: e.target.value })}
                style={{ ...inputStyle, cursor: form.id ? 'not-allowed' : 'pointer' }}
                required
              >
                <option value="">-- Pilih Produk Target --</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.sku} - {p.name} ({p.unit})
                  </option>
                ))}
              </select>
            </div>

            {/* BOM Name & Version */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 'var(--space-3)' }}>
              <div>
                <label style={labelStyle}>Nama BOM *</label>
                <input
                  type="text"
                  placeholder="Contoh: BOM Perakitan Utama"
                  value={form.bomName}
                  onChange={(e) => setForm({ ...form, bomName: e.target.value })}
                  style={inputStyle}
                  required
                />
              </div>

              <div>
                <label style={labelStyle}>Versi</label>
                <input
                  type="text"
                  placeholder="v1.0"
                  value={form.version}
                  onChange={(e) => setForm({ ...form, version: e.target.value })}
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle}>Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value as BillOfMaterialStatus })}
                  style={inputStyle}
                >
                  <option value="ACTIVE">Aktif (ACTIVE)</option>
                  <option value="DRAFT">Draf (DRAFT)</option>
                  <option value="INACTIVE">Nonaktif (INACTIVE)</option>
                </select>
              </div>
            </div>

            {/* Revision & Effective Date */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
              <div>
                <label style={labelStyle}>Revisi Produk (Opsional)</label>
                <input
                  type="text"
                  placeholder="Contoh: Rev A"
                  value={form.productRevision || ''}
                  onChange={(e) => setForm({ ...form, productRevision: e.target.value })}
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle}>Tanggal Berlaku Efektif</label>
                <input
                  type="date"
                  value={form.effectiveDate}
                  onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })}
                  style={inputStyle}
                />
              </div>
            </div>

            {/* Description */}
            <div>
              <label style={labelStyle}>Catatan / Deskripsi</label>
              <textarea
                rows={2}
                placeholder="Catatan formulasi atau spesifikasi teknis komponen..."
                value={form.description || ''}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                style={{ ...inputStyle, resize: 'vertical' }}
              />
            </div>

            {/* Components Editor Sub-Table */}
            <div
              style={{
                marginTop: 'var(--space-2)',
                padding: 'var(--space-3)',
                borderRadius: 'var(--radius-md, 8px)',
                backgroundColor: 'var(--color-surface-container-low)',
                border: '1px solid var(--color-outline-variant)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 'var(--space-3)',
                }}
              >
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
                    Daftar Komponen & Material ({form.components.length})
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                    Tentukan part, tipe material, kuantitas per unit produk, dan rasio scrap
                  </div>
                </div>

                <Button
                  type="button"
                  variant="outlined"
                  icon={<Icon name="add" size={16} />}
                  onClick={addComponentRow}
                >
                  Tambah Komponen
                </Button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {form.components.map((item, index) => (
                  <div
                    key={index}
                    style={{
                      padding: 'var(--space-3)',
                      borderRadius: 'var(--radius-sm, 6px)',
                      backgroundColor: 'var(--color-surface-container-high)',
                      border: '1px solid var(--color-outline-variant)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 'var(--space-2)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-primary)' }}>
                        Baris #{index + 1}
                      </span>
                      {form.components.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeComponentRow(index)}
                          style={{
                            border: 'none',
                            background: 'transparent',
                            color: 'var(--color-error)',
                            cursor: 'pointer',
                            padding: '4px',
                          }}
                          title="Hapus baris ini"
                        >
                          <Icon name="delete" size={16} />
                        </button>
                      )}
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '2fr 1.5fr 1fr 1fr 1fr',
                        gap: 'var(--space-2)',
                      }}
                    >
                      {/* Part Selector / SKU */}
                      <div>
                        <label style={{ ...labelStyle, fontSize: '10.5px' }}>Pilih Part / SKU *</label>
                        <select
                          value={item.componentPartId}
                          onChange={(e) => updateComponentField(index, 'componentPartId', e.target.value)}
                          style={inputStyle}
                        >
                          <option value="">-- Pilih Part Terdaftar --</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.sku} - {p.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Component Type */}
                      <div>
                        <label style={{ ...labelStyle, fontSize: '10.5px' }}>Tipe Komponen *</label>
                        <select
                          value={item.componentType}
                          onChange={(e) =>
                            updateComponentField(
                              index,
                              'componentType',
                              e.target.value as BomComponentType
                            )
                          }
                          style={inputStyle}
                        >
                          <option value="RAW_MATERIAL">Bahan Baku</option>
                          <option value="COMPONENT">Komponen</option>
                          <option value="SUB_ASSEMBLY">Sub-Assembly</option>
                          <option value="PACKAGING">Kemasan</option>
                        </select>
                      </div>

                      {/* Quantity */}
                      <div>
                        <label style={{ ...labelStyle, fontSize: '10.5px' }}>Kuantitas *</label>
                        <input
                          type="number"
                          step="any"
                          min="0.0001"
                          value={item.quantity}
                          onChange={(e) =>
                            updateComponentField(index, 'quantity', parseFloat(e.target.value) || 0)
                          }
                          style={inputStyle}
                          required
                        />
                      </div>

                      {/* UOM */}
                      <div>
                        <label style={{ ...labelStyle, fontSize: '10.5px' }}>Satuan (UOM) *</label>
                        <input
                          type="text"
                          placeholder="PCS / KG"
                          value={item.uom}
                          onChange={(e) => updateComponentField(index, 'uom', e.target.value)}
                          style={inputStyle}
                          required
                        />
                      </div>

                      {/* Scrap % */}
                      <div>
                        <label style={{ ...labelStyle, fontSize: '10.5px' }}>Scrap (%)</label>
                        <input
                          type="number"
                          step="any"
                          min="0"
                          max="100"
                          value={item.scrapPercentage}
                          onChange={(e) =>
                            updateComponentField(
                              index,
                              'scrapPercentage',
                              parseFloat(e.target.value) || 0
                            )
                          }
                          style={inputStyle}
                        />
                      </div>
                    </div>

                    {/* Part Name Override & Notes */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
                      <div>
                        <label style={{ ...labelStyle, fontSize: '10.5px' }}>
                          Nama Komponen (jika bukan dari master produk)
                        </label>
                        <input
                          type="text"
                          placeholder="Contoh: Baut M8x25 Galvanized"
                          value={item.componentPartName}
                          onChange={(e) => updateComponentField(index, 'componentPartName', e.target.value)}
                          style={inputStyle}
                        />
                      </div>

                      <div>
                        <label style={{ ...labelStyle, fontSize: '10.5px' }}>Keterangan / Posisi Perakitan</label>
                        <input
                          type="text"
                          placeholder="Contoh: Pasang pada housing depan"
                          value={item.notes || ''}
                          onChange={(e) => updateComponentField(index, 'notes', e.target.value)}
                          style={inputStyle}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Modal Actions */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 'var(--space-2)',
                marginTop: 'var(--space-3)',
                paddingTop: 'var(--space-3)',
                borderTop: '1px solid var(--color-outline-variant)',
              }}
            >
              <Button type="button" variant="outlined" onClick={() => setForm(null)}>
                Batal
              </Button>
              <Button type="submit" variant="filled" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? 'Menyimpan…' : 'Simpan Bill of Material'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Dialog: Konfirmasi Hapus BOM */}
      {pendingDelete && (
        <Dialog
          isOpen={true}
          onClose={() => setPendingDelete(null)}
          title="Hapus Bill of Material"
          supportingText={`Apakah Anda yakin ingin menghapus "${pendingDelete.bomNumber}" (${pendingDelete.bomName})? Tindakan ini tidak dapat dibatalkan.`}
          confirmLabel={deleteMutation.isPending ? 'Menghapus…' : 'Hapus BOM'}
          cancelLabel="Batal"
          destructive={true}
          onConfirm={() => deleteMutation.mutate(pendingDelete.id)}
        />
      )}

      {/* Dialog: Konfirmasi Ubah Status */}
      {pendingStatusChange && (
        <Dialog
          isOpen={true}
          onClose={() => setPendingStatusChange(null)}
          title={
            pendingStatusChange.newStatus === 'ACTIVE'
              ? 'Aktifkan Bill of Material'
              : 'Nonaktifkan Bill of Material'
          }
          supportingText={
            pendingStatusChange.newStatus === 'ACTIVE'
              ? `Mengaktifkan "${pendingStatusChange.bom.bomNumber}" akan otomatis menonaktifkan BOM lain yang sedang aktif untuk produk ${pendingStatusChange.bom.productSku}. Lanjutkan?`
              : `Apakah Anda yakin ingin menonaktifkan "${pendingStatusChange.bom.bomNumber}"?`
          }
          confirmLabel={statusMutation.isPending ? 'Memproses…' : 'Konfirmasi'}
          cancelLabel="Batal"
          onConfirm={() =>
            statusMutation.mutate({
              id: pendingStatusChange.bom.id,
              status: pendingStatusChange.newStatus,
            })
          }
        />
      )}
    </div>
  );
};
