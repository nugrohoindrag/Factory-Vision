import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FactoryVisionApiClient } from '@factory-vision/api-client';
import { AdvancedDataTable, ColumnDef, Button, Icon, Modal } from '@factory-vision/ui';
import { MetricCard, Page, Section, Dialog, FilterChip } from '@factory-vision/ui/fv';
import {
  WorkOrder,
  WorkOrderStatus,
  ProductionOrder,
  ProductionOrderStatus,
  statusLabel,
} from '@factory-vision/domain-types';

const api = new FactoryVisionApiClient({ baseUrl: '' });

export const WorkOrdersPage: React.FC = () => {
  const queryClient = useQueryClient();

  // Navigation & Filter states
  const [activeTab, setActiveTab] = useState<'WO' | 'PO'>('WO');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [selectedLineFilter, setSelectedLineFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Modal States
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [showEditModal, setShowEditModal] = useState<boolean>(false);
  const [showDetailModal, setShowDetailModal] = useState<boolean>(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState<boolean>(false);

  // Production Order Modal States
  const [showCreatePoModal, setShowCreatePoModal] = useState<boolean>(false);
  const [showEditPoModal, setShowEditPoModal] = useState<boolean>(false);
  const [showDeletePoDialog, setShowDeletePoDialog] = useState<boolean>(false);

  // Selected Records for Edit / Detail / Delete
  const [selectedWo, setSelectedWo] = useState<WorkOrder | null>(null);
  const [selectedPo, setSelectedPo] = useState<ProductionOrder | null>(null);

  // Toast notification state
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(
    null
  );

  const showToast = (text: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 3000);
  };

  // WO Form state
  const [formData, setFormData] = useState({
    productionOrderId: 'po-2026-08-001',
    productId: 'prod-bracket-heavy',
    lineId: 'line-01',
    machineId: 'mc-stamping-01',
    targetQuantity: 2000,
    unit: 'PCS',
    priority: 1,
    plannedStart: new Date().toISOString().slice(0, 16),
    plannedEnd: new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 16),
  });

  // PO Form state
  const [poFormData, setPoFormData] = useState({
    orderNumber: `PO-${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-003`,
    productId: 'prod-bracket-heavy',
    quantity: 5000,
    dueDate: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10),
    createdBy: 'PPIC Supervisor',
  });

  // Data Queries
  const { data: workOrders, isLoading: isLoadingWos } = useQuery({
    queryKey: ['work-orders'],
    queryFn: () => api.workOrders.list(),
    refetchInterval: 3000,
  });

  const { data: productionOrders, isLoading: isLoadingPos } = useQuery({
    queryKey: ['production-orders'],
    queryFn: () => api.productionOrders.list(),
    refetchInterval: 4000,
  });

  const { data: products } = useQuery({
    queryKey: ['master-products'],
    queryFn: () => api.master.getProducts(),
  });

  const { data: lines } = useQuery({
    queryKey: ['master-lines'],
    queryFn: () => api.master.getLines(),
  });

  const { data: machines } = useQuery({
    queryKey: ['master-machines'],
    queryFn: () => api.master.getMachines(),
  });

  const { data: processes } = useQuery({
    queryKey: ['master-processes'],
    queryFn: () => api.master.getProcesses(),
  });

  const { data: routings } = useQuery({
    queryKey: ['master-routings'],
    queryFn: () => api.master.getRoutings(),
  });

  const { data: batches } = useQuery({
    queryKey: ['master-batches'],
    queryFn: () => api.master.getBatches(),
  });

  // Work Order Mutations
  const createWoMutation = useMutation({
    mutationFn: (payload: typeof formData) =>
      api.workOrders.create({
        productionOrderId: payload.productionOrderId,
        productId: payload.productId,
        lineId: payload.lineId,
        machineId: payload.machineId,
        targetQuantity: Number(payload.targetQuantity),
        unit: payload.unit,
        priority: Number(payload.priority),
        plannedStart: new Date(payload.plannedStart).toISOString(),
        plannedEnd: new Date(payload.plannedEnd).toISOString(),
      }),
    onSuccess: (newWo) => {
      queryClient.invalidateQueries({ queryKey: ['work-orders'] });
      setShowCreateModal(false);
      showToast(`Work Order ${newWo.woNumber} berhasil dibuat!`);
    },
    onError: (err: any) => {
      showToast(err.message || 'Gagal membuat Work Order', 'error');
    },
  });

  const updateWoMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<WorkOrder> }) =>
      api.workOrders.update(id, payload),
    onSuccess: (updatedWo) => {
      queryClient.invalidateQueries({ queryKey: ['work-orders'] });
      setShowEditModal(false);
      if (selectedWo?.id === updatedWo.id) setSelectedWo(updatedWo);
      showToast(`Work Order ${updatedWo.woNumber} berhasil diperbarui!`);
    },
    onError: (err: any) => {
      showToast(err.message || 'Gagal memperbarui Work Order', 'error');
    },
  });

  const deleteWoMutation = useMutation({
    mutationFn: (id: string) => api.workOrders.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-orders'] });
      setShowDeleteDialog(false);
      setShowDetailModal(false);
      showToast(`Work Order berhasil dihapus!`);
    },
    onError: (err: any) => {
      showToast(err.message || 'Gagal menghapus Work Order', 'error');
    },
  });

  // Action State Transitions
  const releaseMutation = useMutation({
    mutationFn: (id: string) => api.workOrders.release(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-orders'] });
      showToast('Work Order dirilis dan siap dieksekusi di shop floor');
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.workOrders.cancel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-orders'] });
      showToast('Work Order dibatalkan', 'info');
    },
  });

  // Production Order Mutations
  const releasePoMutation = useMutation({
    mutationFn: (id: string) => api.productionOrders.release(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production-orders'] });
      queryClient.invalidateQueries({ queryKey: ['work-orders'] });
      showToast('Production Order dirilis & Work Orders tahapan proses berhasil di-generate secara otomatis!');
    },
    onError: (err: any) => {
      showToast(err.message || 'Gagal merilis Production Order', 'error');
    },
  });

  const createPoMutation = useMutation({
    mutationFn: (payload: typeof poFormData) => api.productionOrders.create(payload),
    onSuccess: (newPo) => {
      queryClient.invalidateQueries({ queryKey: ['production-orders'] });
      setShowCreatePoModal(false);
      showToast(`Production Order ${newPo.orderNumber} berhasil dibuat!`);
    },
  });

  const deletePoMutation = useMutation({
    mutationFn: (id: string) => api.productionOrders.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production-orders'] });
      setShowDeletePoDialog(false);
      showToast(`Production Order berhasil dihapus!`);
    },
  });

  // Open Edit Modal helper
  const handleOpenEditWo = (wo: WorkOrder) => {
    setSelectedWo(wo);
    setFormData({
      productionOrderId: wo.productionOrderId || '',
      productId: wo.productId,
      lineId: wo.lineId,
      machineId: wo.machineId || 'mc-stamping-01',
      targetQuantity: wo.plannedQuantity,
      unit: wo.unit || 'PCS',
      priority: wo.priority || 1,
      plannedStart: wo.plannedStart
        ? new Date(wo.plannedStart).toISOString().slice(0, 16)
        : new Date().toISOString().slice(0, 16),
      plannedEnd: wo.plannedEnd
        ? new Date(wo.plannedEnd).toISOString().slice(0, 16)
        : new Date().toISOString().slice(0, 16),
    });
    setShowEditModal(true);
  };

  // Open Detail Modal helper
  const handleOpenDetailWo = (wo: WorkOrder) => {
    setSelectedWo(wo);
    setShowDetailModal(true);
  };

  // Open Delete Dialog helper
  const handleOpenDeleteWo = (wo: WorkOrder) => {
    setSelectedWo(wo);
    setShowDeleteDialog(true);
  };

  // Filtered dataset
  const filteredWos = (workOrders || []).filter((wo) => {
    const matchesStatus = selectedStatus === 'ALL' || wo.status === selectedStatus;
    const matchesLine = selectedLineFilter === 'ALL' || wo.lineId === selectedLineFilter;
    const matchesSearch =
      searchQuery === '' ||
      wo.woNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      wo.productId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      wo.lineId.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesStatus && matchesLine && matchesSearch;
  });

  const totalWos = workOrders?.length || 0;
  const inProductionWos = workOrders?.filter((w) => w.status === WorkOrderStatus.IN_PRODUCTION).length || 0;
  const confirmedWos =
    workOrders?.filter((w) => w.status === WorkOrderStatus.CONFIRMED || w.status === WorkOrderStatus.SCHEDULED)
      .length || 0;
  const completedWos = workOrders?.filter((w) => w.status === WorkOrderStatus.COMPLETED).length || 0;

  // Status Chip Colors
  const getStatusColor = (status: WorkOrderStatus | string) => {
    switch (status) {
      case WorkOrderStatus.IN_PRODUCTION:
        return 'var(--color-success)';
      case WorkOrderStatus.CONFIRMED:
      case WorkOrderStatus.SCHEDULED:
        return 'var(--color-primary)';
      case WorkOrderStatus.COMPLETED:
        return 'var(--color-info)';
      case WorkOrderStatus.CANCELLED:
        return 'var(--color-error)';
      default:
        return 'var(--color-on-surface-variant)';
    }
  };

  // Advanced Table Columns for Work Orders
  const woColumns: ColumnDef<WorkOrder>[] = [
    {
      key: 'woNumber',
      header: 'Work Order',
      sortable: true,
      render: (wo) => {
        const prod = products?.find((p) => p.id === wo.productId);
        return (
          <div>
            <div style={{ fontWeight: 800, fontSize: '13.5px', color: 'var(--color-on-surface)' }}>
              {wo.woNumber}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)', marginTop: 'var(--space-1)' }}>
              {prod ? `${prod.sku}, ${prod.name}` : wo.productId}
            </div>
          </div>
        );
      },
    },
    {
      key: 'processId',
      header: 'Proses Produksi',
      sortable: true,
      render: (wo) => {
        const proc = processes?.find((p) => p.id === wo.processId);
        // ADR-29: the batch names its work order, not the reverse.
        const batch = batches?.find((b) => b.workOrderId === wo.id);
        return (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <span
                style={{
                  padding: `var(--space-1) var(--space-2)`,
                  borderRadius: 'var(--radius-pill)',
                  fontSize: '11px',
                  fontWeight: 800,
                  backgroundColor: 'var(--color-primary-container)',
                  color: 'var(--color-on-primary-container)',
                }}
              >
                {wo.sequence ? `Seq ${wo.sequence}: ` : ''}
                {proc ? proc.code : wo.processId || 'Tahap Umum'}
              </span>
            </div>
            <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)', marginTop: 'var(--space-1)' }}>
              {proc ? proc.name : ''} {batch ? `• Lot: ${batch.batchNumber}` : ''}
            </div>
          </div>
        );
      },
    },
    {
      key: 'lineId',
      header: 'Production Line & Mesin',
      sortable: true,
      render: (wo) => {
        const line = lines?.find((l) => l.id === wo.lineId);
        const mc = machines?.find((m) => m.id === wo.machineId);
        return (
          <div>
            <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--color-on-surface)' }}>
              {line ? line.name : wo.lineId.toUpperCase()}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)', marginTop: 'var(--space-1)' }}>
              {mc ? mc.name : wo.machineId || 'Semua Mesin'}
            </div>
          </div>
        );
      },
    },
    {
      key: 'targetQuantity',
      header: 'Target Produksi & Produksi Aktual',
      sortable: true,
      render: (wo) => {
        const pct = wo.plannedQuantity > 0 ? Math.round((wo.outputQuantity / wo.plannedQuantity) * 100) : 0;
        return (
          <div style={{ minWidth: '160px' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '11.5px',
                marginBottom: 'var(--space-1)',
              }}
            >
              <span style={{ fontWeight: 800, color: 'var(--color-success)' }}>
                {wo.outputQuantity.toLocaleString('id-ID')} Good
              </span>
              <span style={{ color: 'var(--color-on-surface-variant)' }}>
                / {wo.plannedQuantity.toLocaleString('en-US')} {wo.unit}
              </span>
            </div>
            <div
              style={{
                height: '6px',
                borderRadius: 'var(--radius-pill)',
                backgroundColor: 'var(--color-surface-container-high)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${Math.min(100, pct)}%`,
                  backgroundColor:
                    pct >= 90
                      ? 'var(--color-success)'
                      : pct >= 50
                        ? 'var(--color-primary)'
                        : 'var(--color-warning)',
                  borderRadius: 'var(--radius-pill)',
                  transition: 'width 0.4s ease',
                }}
              />
            </div>
            <div
              style={{
                fontSize: '10px',
                color: 'var(--color-on-surface-variant)',
                marginTop: 'var(--space-1)',
                textAlign: 'right',
              }}
            >
              {pct}% Pencapaian
            </div>
          </div>
        );
      },
    },
    {
      key: 'rejectQuantity',
      header: 'Jumlah Reject',
      sortable: true,
      render: (wo) => (
        <span
          style={{
            fontWeight: 800,
            fontSize: '13px',
            color: wo.rejectQuantity > 0 ? 'var(--color-error)' : 'var(--color-on-surface-variant)',
            fontFeatureSettings: '"tnum" 1',
          }}
        >
          {wo.rejectQuantity.toLocaleString('en-US')} PCS
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (wo) => {
        const color = getStatusColor(wo.status);
        return (
          <span
            style={{
              padding: `var(--space-1) var(--space-3)`,
              borderRadius: 'var(--radius-pill)',
              fontSize: '11px',
              fontWeight: 800,
              backgroundColor: `${color}18`,
              color: color,
              border: `1px solid ${color}35`,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--space-1)',
            }}
          >
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: color }} />
            {statusLabel(wo.status)}
          </span>
        );
      },
    },
    {
      key: 'actions',
      header: 'Aksi',
      render: (wo) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          {/* Detail Button */}
          <Button
            variant="tonal"
            size="sm"
            onClick={() => handleOpenDetailWo(wo)}
            title="Lihat Detail Work Order"
            style={{ padding: `0 var(--space-2)` }}
          >
            <Icon name="visibility" size={16} />
          </Button>

          {/* Edit Button */}
          <Button
            variant="tonal"
            size="sm"
            onClick={() => handleOpenEditWo(wo)}
            title="Edit Work Order"
            style={{ padding: `0 var(--space-2)` }}
          >
            <Icon name="edit" size={16} />
          </Button>

          {/* State Transition Actions */}
          {(wo.status === WorkOrderStatus.DRAFT || wo.status === WorkOrderStatus.SCHEDULED) && (
            <Button
              variant="filled"
              size="sm"
              onClick={() => releaseMutation.mutate(wo.id)}
              style={{ fontSize: '11.5px', padding: `0 var(--space-3)` }}
            >
              Release
            </Button>
          )}

          {/* Delete / Cancel Button */}
          <Button
            variant="text"
            size="sm"
            style={{ color: 'var(--color-error)', padding: `0 var(--space-2)` }}
            onClick={() => handleOpenDeleteWo(wo)}
            title="Hapus Work Order"
          >
            <Icon name="delete" size={16} />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <Page style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {/* Toast Notification Alert */}
      {toastMessage && (
        <div
          style={{
            position: 'fixed',
            top: '20px',
            right: '20px',
            zIndex: 9999,
            backgroundColor:
              toastMessage.type === 'success'
                ? 'var(--color-success)'
                : toastMessage.type === 'error'
                  ? 'var(--color-error)'
                  : 'var(--color-primary)',
            // The toast fills with a tone container, so its text takes the
            // matching on-container token. A hardcoded white was legible on the
            // dark theme and washed out on the light one.
            color: 'var(--color-on-primary)',
            padding: `var(--space-3) var(--space-5)`,
            borderRadius: 'var(--radius-md)',
            fontWeight: 700,
            fontSize: '13px',
            boxShadow: 'var(--elevation-3)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
          }}
        >
          <Icon name={toastMessage.type === 'success' ? 'check_circle' : 'info'} size={18} />
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* Top Header */}
      <Section
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 'var(--space-3)',
        }}
      >
        <div>
          <h1
            style={{
              fontSize: '22px',
              fontWeight: 800,
              margin: 0,
              color: 'var(--color-on-surface)',
              letterSpacing: '-0.02em',
            }}
          >
            Work Order
          </h1>
          <p style={{ margin: `var(--space-1) 0 0`, color: 'var(--color-on-surface-variant)', fontSize: '12px' }}>
            Manajemen lengkap pembuatan, penjadwalan, rilis, pengeditan, dan pelacakan Work Order produksi.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          {activeTab === 'WO' ? (
            <Button
              variant="filled"
              icon={<Icon name="add" size={18} />}
              onClick={() => {
                setFormData({
                  productionOrderId: productionOrders?.[0]?.id || 'po-2026-08-001',
                  productId: products?.[0]?.id || 'prod-bracket-heavy',
                  lineId: lines?.[0]?.id || 'line-01',
                  machineId: machines?.[0]?.id || 'mc-stamping-01',
                  targetQuantity: 2000,
                  unit: 'PCS',
                  priority: 1,
                  plannedStart: new Date().toISOString().slice(0, 16),
                  plannedEnd: new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 16),
                });
                setShowCreateModal(true);
              }}
            >
              Buat Work Order Baru
            </Button>
          ) : (
            <Button
              variant="filled"
              icon={<Icon name="add" size={18} />}
              onClick={() => setShowCreatePoModal(true)}
            >
              Buat Production Order (PO)
            </Button>
          )}
        </div>
      </Section>

      {/* KPI Metric Summary Cards */}
      <Section
        stagger
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-3)' }}
      >
        <MetricCard
          label="Total Work Orders"
          value={`${totalWos} WO`}
          delta="Semua status shift"
          deltaType="neutral"
          tone="info"
          icon={<Icon name="assignment" size={18} />}
        />
        <MetricCard
          label="In Production"
          value={`${inProductionWos} WO`}
          delta="Aktif di lantai produksi"
          deltaType="positive"
          tone="success"
          icon={<Icon name="play_arrow" size={18} />}
        />
        <MetricCard
          label="Confirmed & Scheduled"
          value={`${confirmedWos} WO`}
          delta="Menunggu eksekusi operator"
          deltaType="neutral"
          tone="primary"
          icon={<Icon name="schedule" size={18} />}
        />
        <MetricCard
          label="Completed"
          value={`${completedWos} WO`}
          delta="Target terpenuhi"
          deltaType="positive"
          tone="success"
          icon={<Icon name="task_alt" size={18} />}
        />
      </Section>

      {/* Navigation Tabs (WO vs PO) */}
      <Section style={{ display: 'flex', borderBottom: '1px solid var(--color-outline-variant)', gap: 'var(--space-4)' }}>
        <button
          onClick={() => setActiveTab('WO')}
          style={{
            padding: `var(--space-3) var(--space-4)`,
            fontWeight: 800,
            fontSize: '13px',
            backgroundColor: 'transparent',
            border: 'none',
            borderBottom: activeTab === 'WO' ? '2px solid var(--color-primary)' : '2px solid transparent',
            color: activeTab === 'WO' ? 'var(--color-primary)' : 'var(--color-on-surface-variant)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
          }}
        >
          <Icon name="precision_manufacturing" size={18} />
          <span>Work Orders (Eksekusi Operasional)</span>
          <span
            style={{
              fontSize: '11px',
              padding: `var(--space-1) var(--space-2)`,
              borderRadius: 'var(--radius-pill)',
              backgroundColor: 'var(--color-surface-container-high)',
            }}
          >
            {totalWos}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('PO')}
          style={{
            padding: `var(--space-3) var(--space-4)`,
            fontWeight: 800,
            fontSize: '13px',
            backgroundColor: 'transparent',
            border: 'none',
            borderBottom: activeTab === 'PO' ? '2px solid var(--color-primary)' : '2px solid transparent',
            color: activeTab === 'PO' ? 'var(--color-primary)' : 'var(--color-on-surface-variant)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
          }}
        >
          <Icon name="inventory" size={18} />
          <span>Production Orders (Master Planning)</span>
          <span
            style={{
              fontSize: '11px',
              padding: `var(--space-1) var(--space-2)`,
              borderRadius: 'var(--radius-pill)',
              backgroundColor: 'var(--color-surface-container-high)',
            }}
          >
            {productionOrders?.length || 0}
          </span>
        </button>
      </Section>

      {activeTab === 'WO' ? (
        <>
          {/* Filter Toolbar: Status Chips, Line Selector, and Search */}
          <Section
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 'var(--space-3)',
            }}
          >
            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  color: 'var(--color-on-surface-variant)',
                  marginRight: 'var(--space-1)',
                }}
              >
                Status:
              </span>
              {['ALL', 'DRAFT', 'SCHEDULED', 'CONFIRMED', 'IN_PRODUCTION', 'COMPLETED', 'CANCELLED'].map((st) => (
                <FilterChip key={st} selected={selectedStatus === st} onClick={() => setSelectedStatus(st)}>
                  {st === 'ALL' ? 'Semua' : statusLabel(st)}
                </FilterChip>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
              <select
                value={selectedLineFilter}
                onChange={(e) => setSelectedLineFilter(e.target.value)}
                style={{
                  padding: `var(--space-2) var(--space-3)`,
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--color-surface-container-high)',
                  border: '1px solid var(--color-outline-variant)',
                  color: 'var(--color-on-surface)',
                  fontSize: '12px',
                  fontWeight: 600,
                  outline: 'none',
                }}
              >
                <option value="ALL">Semua Production Line</option>
                {lines?.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.code} ({l.name})
                  </option>
                ))}
              </select>

              <input
                type="text"
                placeholder="Cari Work Order, Produk, atau Production Line…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  padding: `var(--space-2) var(--space-3)`,
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--color-surface-container-high)',
                  border: '1px solid var(--color-outline-variant)',
                  color: 'var(--color-on-surface)',
                  fontSize: '12px',
                  outline: 'none',
                  minWidth: '200px',
                }}
              />
            </div>
          </Section>

          {/* Advanced Data Table, header fill comes from the app-wide
 @factory-vision/ui/fv/table-header.css override (all tables). */}
          <AdvancedDataTable
            columns={woColumns}
            data={filteredWos}
            title="Daftar Work Order (WO)"
            subtitle="Kelola status rilis, edit parameter target, dan pantau output aktual per Production Line"
            searchable={false}
            selectable={true}
            expandable={true}
            renderExpandedRow={(wo) => (
              <Section
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: 'var(--space-4)',
                  fontSize: '11.5px',
                  padding: `var(--space-3) 0`,
                }}
              >
                <div>
                  <span style={{ color: 'var(--color-on-surface-variant)' }}>ID Sistem:</span>
                  <div style={{ fontWeight: 700, color: 'var(--color-on-surface)' }}>{wo.id}</div>
                </div>
                <div>
                  <span style={{ color: 'var(--color-on-surface-variant)' }}>Rencana Mulai:</span>
                  <div style={{ fontWeight: 700, color: 'var(--color-on-surface)' }}>
                    {wo.plannedStart ? new Date(wo.plannedStart).toLocaleString('id-ID') : '-'}
                  </div>
                </div>
                <div>
                  <span style={{ color: 'var(--color-on-surface-variant)' }}>Rencana Selesai:</span>
                  <div style={{ fontWeight: 700, color: 'var(--color-on-surface)' }}>
                    {wo.plannedEnd ? new Date(wo.plannedEnd).toLocaleString('id-ID') : '-'}
                  </div>
                </div>
                <div>
                  <span style={{ color: 'var(--color-on-surface-variant)' }}>Prioritas / Versi:</span>
                  <div style={{ fontWeight: 700, color: 'var(--color-primary)' }}>
                    Prioritas {wo.priority || 1} • Lock v{wo.version}
                  </div>
                </div>
              </Section>
            )}
          />
        </>
      ) : (
        /* Production Orders Registry Table */
        <Section>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 'var(--space-3)',
            }}
          >
            <h2 style={{ fontSize: '16px', fontWeight: 800, margin: 0, color: 'var(--color-on-surface)' }}>
              Master Production Orders (PO / SPK)
            </h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 'var(--space-3)' }}>
            {productionOrders?.map((po) => {
              const prod = products?.find((p) => p.id === po.productId);
              const relatedWos = workOrders?.filter((w) => w.productionOrderId === po.id) || [];
              const totalOutput = relatedWos.reduce((acc, curr) => acc + curr.outputQuantity, 0);
              const pct = po.quantity > 0 ? Math.round((totalOutput / po.quantity) * 100) : 0;
              const poRoutings = (routings || [])
                .filter((r) => r.productId === po.productId)
                .sort((a, b) => a.sequence - b.sequence);

              return (
                <div
                  key={po.id}
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    border: '1px solid var(--color-outline-variant)',
                    borderRadius: 'var(--radius-lg)',
                    padding: `var(--space-5) var(--space-5)`,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--space-4)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: 'var(--space-3)',
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                        <span style={{ fontWeight: 800, fontSize: '15px', color: 'var(--color-on-surface)' }}>
                          {po.orderNumber}
                        </span>
                        <span
                          style={{
                            padding: `var(--space-1) var(--space-2)`,
                            borderRadius: 'var(--radius-pill)',
                            fontSize: '10.5px',
                            fontWeight: 800,
                            backgroundColor:
                              po.status === 'RELEASED'
                                ? 'var(--color-success-container)'
                                : 'var(--color-primary-container)',
                            color:
                              po.status === 'RELEASED'
                                ? 'var(--color-on-success-container)'
                                : 'var(--color-on-primary-container)',
                          }}
                        >
                          {statusLabel(po.status)}
                        </span>
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
                        Produk: <strong>{prod?.name || po.productId}</strong> ({prod?.sku}) • Due Date:{' '}
                        {po.dueDate}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                        Dibuat oleh: {po.createdBy} pada {new Date(po.createdAt).toLocaleDateString('id-ID')}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-5)' }}>
                      <div style={{ textAlign: 'right', minWidth: '140px' }}>
                        <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                          Progress Eksekusi WO:
                        </div>
                        <div style={{ fontWeight: 800, fontSize: '14px', color: 'var(--color-primary)' }}>
                          {totalOutput.toLocaleString('en-US')} / {po.quantity.toLocaleString('en-US')} PCS (
                          {pct}%)
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                        {po.status !== 'RELEASED' && po.status !== 'COMPLETED' && (
                          <Button
                            variant="filled"
                            size="sm"
                            icon={<Icon name="play_arrow" size={15} />}
                            onClick={() => releasePoMutation.mutate(po.id)}
                            disabled={releasePoMutation.isPending}
                          >
                            Rilis & Generate Routing
                          </Button>
                        )}

                        <Button
                          variant="tonal"
                          size="sm"
                          icon={<Icon name="add" size={14} />}
                          onClick={() => {
                            setFormData({
                              productionOrderId: po.id,
                              productId: po.productId,
                              lineId: lines?.[0]?.id || 'line-01',
                              machineId: machines?.[0]?.id || 'mc-stamping-01',
                              targetQuantity: Math.max(0, po.quantity - totalOutput) || 1000,
                              unit: 'PCS',
                              priority: 1,
                              plannedStart: new Date().toISOString().slice(0, 16),
                              plannedEnd: new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 16),
                            });
                            setShowCreateModal(true);
                          }}
                        >
                          + WO Manual
                        </Button>

                        <Button
                          variant="text"
                          size="sm"
                          style={{ color: 'var(--color-error)' }}
                          onClick={() => {
                            setSelectedPo(po);
                            setShowDeletePoDialog(true);
                          }}
                        >
                          <Icon name="delete" size={16} />
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Multi-Process Routing Pipeline Visualization */}
                  <div
                    style={{
                      backgroundColor: 'var(--color-surface-container)',
                      borderRadius: 'var(--radius-md)',
                      padding: `var(--space-3) var(--space-4)`,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 'var(--space-2)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span
                        style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-on-surface-variant)' }}
                      >
                        ALUR PROSES ROUTING (MULTI-STAGE EXECUTION)
                      </span>
                      <span style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                        {relatedWos.length} Work Orders Terdaftar
                      </span>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-2)',
                        overflowX: 'auto',
                        paddingBottom: 'var(--space-1)',
                      }}
                    >
                      {poRoutings.length > 0 ? (
                        poRoutings.map((rt, idx) => {
                          const proc = processes?.find((p) => p.id === rt.processId);
                          const stepWo = relatedWos.find(
                            (w) => w.processId === rt.processId || w.sequence === rt.sequence
                          );
                          return (
                            <React.Fragment key={rt.id}>
                              <div
                                style={{
                                  padding: `var(--space-2) var(--space-3)`,
                                  borderRadius: 'var(--radius-md)',
                                  backgroundColor: stepWo
                                    ? 'var(--color-surface)'
                                    : 'var(--color-surface-container-high)',
                                  border: `1px solid ${stepWo ? 'var(--color-primary)' : 'var(--color-outline-variant)'}`,
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: 'var(--space-1)',
                                  minWidth: '120px',
                                }}
                              >
                                <div
                                  style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                  }}
                                >
                                  <span
                                    style={{ fontSize: '10px', fontWeight: 800, color: 'var(--color-primary)' }}
                                  >
                                    Seq #{rt.sequence}
                                  </span>
                                  {stepWo && (
                                    <span
                                      style={{
                                        fontSize: '9.5px',
                                        fontWeight: 700,
                                        color: getStatusColor(stepWo.status),
                                      }}
                                    >
                                      {stepWo.status}
                                    </span>
                                  )}
                                </div>
                                <div
                                  style={{
                                    fontSize: '11.5px',
                                    fontWeight: 700,
                                    color: 'var(--color-on-surface)',
                                  }}
                                >
                                  {proc?.name || rt.processId}
                                </div>
                                <div style={{ fontSize: '10px', color: 'var(--color-on-surface-variant)' }}>
                                  {stepWo
                                    ? `${stepWo.goodQuantity}/${stepWo.targetQuantity} PCS`
                                    : 'Belum di-generate'}
                                </div>
                              </div>
                              {idx < poRoutings.length - 1 && (
                                <Icon
                                  name="arrow_forward"
                                  size={14}
                                  style={{ color: 'var(--color-on-surface-variant)', flexShrink: 0 }}
                                />
                              )}
                            </React.Fragment>
                          );
                        })
                      ) : (
                        <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                          Belum ada Routing Produk untuk Produk ini. Konfigurasikan di menu Master Data.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* CREATE WORK ORDER MODAL */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="BUAT WORK ORDER BARU"
        maxWidth="560px"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createWoMutation.mutate(formData);
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
        >
          {/* Linked PO */}
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
              REFERENSI PRODUCTION ORDER (PO / SPK)
            </label>
            <select
              value={formData.productionOrderId}
              onChange={(e) => {
                const poId = e.target.value;
                const po = productionOrders?.find((p) => p.id === poId);
                setFormData({
                  ...formData,
                  productionOrderId: poId,
                  productId: po?.productId || formData.productId,
                });
              }}
              style={{
                width: '100%',
                padding: `var(--space-3) var(--space-3)`,
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--color-surface-container-high)',
                border: '1px solid var(--color-outline-variant)',
                color: 'var(--color-on-surface)',
                fontSize: '13px',
              }}
            >
              {productionOrders?.map((po) => (
                <option key={po.id} value={po.id}>
                  {po.orderNumber}, Target: {po.quantity.toLocaleString('en-US')} PCS (Due: {po.dueDate})
                </option>
              ))}
            </select>
          </div>

          {/* Product Selector */}
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
              PRODUK
            </label>
            <select
              value={formData.productId}
              onChange={(e) => setFormData({ ...formData, productId: e.target.value })}
              style={{
                width: '100%',
                padding: `var(--space-3) var(--space-3)`,
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--color-surface-container-high)',
                border: '1px solid var(--color-outline-variant)',
                color: 'var(--color-on-surface)',
                fontSize: '13px',
              }}
            >
              {products?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.sku}, {p.name} ({p.unit})
                </option>
              ))}
            </select>
          </div>

          {/* Line and Machine Selectors in 2 Columns */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
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
                LINI PRODUKSI
              </label>
              <select
                value={formData.lineId}
                onChange={(e) => setFormData({ ...formData, lineId: e.target.value })}
                style={{
                  width: '100%',
                  padding: `var(--space-3) var(--space-3)`,
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--color-surface-container-high)',
                  border: '1px solid var(--color-outline-variant)',
                  color: 'var(--color-on-surface)',
                  fontSize: '13px',
                }}
              >
                {lines?.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.code}, {l.name}
                  </option>
                ))}
              </select>
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
                MESIN UTAMA
              </label>
              <select
                value={formData.machineId}
                onChange={(e) => setFormData({ ...formData, machineId: e.target.value })}
                style={{
                  width: '100%',
                  padding: `var(--space-3) var(--space-3)`,
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--color-surface-container-high)',
                  border: '1px solid var(--color-outline-variant)',
                  color: 'var(--color-on-surface)',
                  fontSize: '13px',
                }}
              >
                {machines?.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.code}, {m.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Target Quantity & Unit */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--space-3)' }}>
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
                TARGET KUANTITAS
              </label>
              <input
                type="number"
                value={formData.targetQuantity}
                onChange={(e) => setFormData({ ...formData, targetQuantity: Number(e.target.value) })}
                min={1}
                required
                style={{
                  width: '100%',
                  padding: `var(--space-3) var(--space-3)`,
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--color-surface-container-high)',
                  border: '1px solid var(--color-outline-variant)',
                  color: 'var(--color-on-surface)',
                  fontSize: '13px',
                  fontWeight: 700,
                  outline: 'none',
                }}
              />
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
                SATUAN
              </label>
              <select
                value={formData.unit}
                onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                style={{
                  width: '100%',
                  padding: `var(--space-3) var(--space-3)`,
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--color-surface-container-high)',
                  border: '1px solid var(--color-outline-variant)',
                  color: 'var(--color-on-surface)',
                  fontSize: '13px',
                }}
              >
                <option value="PCS">PCS</option>
                <option value="BOX">BOX</option>
                <option value="SET">SET</option>
                <option value="KG">KG</option>
              </select>
            </div>
          </div>

          {/* Planned Schedule (Start & End) */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
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
                RENCANA MULAI (START)
              </label>
              <input
                type="datetime-local"
                value={formData.plannedStart}
                onChange={(e) => setFormData({ ...formData, plannedStart: e.target.value })}
                required
                style={{
                  width: '100%',
                  padding: `var(--space-3) var(--space-3)`,
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--color-surface-container-high)',
                  border: '1px solid var(--color-outline-variant)',
                  color: 'var(--color-on-surface)',
                  fontSize: '12.5px',
                  outline: 'none',
                }}
              />
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
                RENCANA SELESAI (END)
              </label>
              <input
                type="datetime-local"
                value={formData.plannedEnd}
                onChange={(e) => setFormData({ ...formData, plannedEnd: e.target.value })}
                required
                style={{
                  width: '100%',
                  padding: `var(--space-3) var(--space-3)`,
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--color-surface-container-high)',
                  border: '1px solid var(--color-outline-variant)',
                  color: 'var(--color-on-surface)',
                  fontSize: '12.5px',
                  outline: 'none',
                }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
            <Button variant="outlined" type="button" onClick={() => setShowCreateModal(false)}>
              Batal
            </Button>
            <Button variant="filled" type="submit" disabled={createWoMutation.isPending}>
              {createWoMutation.isPending ? 'Menyimpan, ...' : 'Simpan & Jadwalkan WO'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* EDIT WORK ORDER MODAL */}
      <Modal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        title={`EDIT WORK ORDER: ${selectedWo?.woNumber || ''}`}
        maxWidth="560px"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (selectedWo) {
              updateWoMutation.mutate({
                id: selectedWo.id,
                payload: {
                  productId: formData.productId,
                  lineId: formData.lineId,
                  machineId: formData.machineId,
                  targetQuantity: Number(formData.targetQuantity),
                  unit: formData.unit,
                  priority: Number(formData.priority),
                  plannedStart: new Date(formData.plannedStart).toISOString(),
                  plannedEnd: new Date(formData.plannedEnd).toISOString(),
                },
              });
            }
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
        >
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
              PRODUK
            </label>
            <select
              value={formData.productId}
              onChange={(e) => setFormData({ ...formData, productId: e.target.value })}
              style={{
                width: '100%',
                padding: `var(--space-3) var(--space-3)`,
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--color-surface-container-high)',
                border: '1px solid var(--color-outline-variant)',
                color: 'var(--color-on-surface)',
                fontSize: '13px',
              }}
            >
              {products?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.sku}, {p.name}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
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
                LINI PRODUKSI
              </label>
              <select
                value={formData.lineId}
                onChange={(e) => setFormData({ ...formData, lineId: e.target.value })}
                style={{
                  width: '100%',
                  padding: `var(--space-3) var(--space-3)`,
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--color-surface-container-high)',
                  border: '1px solid var(--color-outline-variant)',
                  color: 'var(--color-on-surface)',
                  fontSize: '13px',
                }}
              >
                {lines?.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.code}, {l.name}
                  </option>
                ))}
              </select>
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
                MESIN UTAMA
              </label>
              <select
                value={formData.machineId}
                onChange={(e) => setFormData({ ...formData, machineId: e.target.value })}
                style={{
                  width: '100%',
                  padding: `var(--space-3) var(--space-3)`,
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--color-surface-container-high)',
                  border: '1px solid var(--color-outline-variant)',
                  color: 'var(--color-on-surface)',
                  fontSize: '13px',
                }}
              >
                {machines?.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.code}, {m.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--space-3)' }}>
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
                TARGET KUANTITAS
              </label>
              <input
                type="number"
                value={formData.targetQuantity}
                onChange={(e) => setFormData({ ...formData, targetQuantity: Number(e.target.value) })}
                min={1}
                required
                style={{
                  width: '100%',
                  padding: `var(--space-3) var(--space-3)`,
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--color-surface-container-high)',
                  border: '1px solid var(--color-outline-variant)',
                  color: 'var(--color-on-surface)',
                  fontSize: '13px',
                  fontWeight: 700,
                  outline: 'none',
                }}
              />
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
                SATUAN
              </label>
              <input
                type="text"
                value={formData.unit}
                onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                style={{
                  width: '100%',
                  padding: `var(--space-3) var(--space-3)`,
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--color-surface-container-high)',
                  border: '1px solid var(--color-outline-variant)',
                  color: 'var(--color-on-surface)',
                  fontSize: '13px',
                }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
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
                RENCANA MULAI
              </label>
              <input
                type="datetime-local"
                value={formData.plannedStart}
                onChange={(e) => setFormData({ ...formData, plannedStart: e.target.value })}
                required
                style={{
                  width: '100%',
                  padding: `var(--space-3) var(--space-3)`,
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--color-surface-container-high)',
                  border: '1px solid var(--color-outline-variant)',
                  color: 'var(--color-on-surface)',
                  fontSize: '12.5px',
                  outline: 'none',
                }}
              />
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
                RENCANA SELESAI
              </label>
              <input
                type="datetime-local"
                value={formData.plannedEnd}
                onChange={(e) => setFormData({ ...formData, plannedEnd: e.target.value })}
                required
                style={{
                  width: '100%',
                  padding: `var(--space-3) var(--space-3)`,
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--color-surface-container-high)',
                  border: '1px solid var(--color-outline-variant)',
                  color: 'var(--color-on-surface)',
                  fontSize: '12.5px',
                  outline: 'none',
                }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
            <Button variant="outlined" type="button" onClick={() => setShowEditModal(false)}>
              Batal
            </Button>
            <Button variant="filled" type="submit" disabled={updateWoMutation.isPending}>
              {updateWoMutation.isPending ? 'Menyimpan, ...' : 'Simpan Perubahan'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* DETAIL WORK ORDER MODAL */}
      {selectedWo && (
        <Modal
          isOpen={showDetailModal}
          onClose={() => setShowDetailModal(false)}
          title={`DETAIL WORK ORDER: ${selectedWo.woNumber}`}
          maxWidth="640px"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            {/* Status and Summary Header */}
            <div
              style={{
                backgroundColor: 'var(--color-surface-container-high)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-4)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)', fontWeight: 600 }}>
                  STATUS OPERASIONAL
                </div>
                <div
                  style={{
                    fontSize: '18px',
                    fontWeight: 900,
                    color: getStatusColor(selectedWo.status),
                    marginTop: 'var(--space-1)',
                  }}
                >
                  {selectedWo.status}
                </div>
              </div>

              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)', fontWeight: 600 }}>
                  PENCAPAIAN TARGET
                </div>
                <div
                  style={{
                    fontSize: '18px',
                    fontWeight: 900,
                    color: 'var(--color-on-surface)',
                    marginTop: 'var(--space-1)',
                  }}
                >
                  {selectedWo.plannedQuantity > 0
                    ? Math.round((selectedWo.outputQuantity / selectedWo.plannedQuantity) * 100)
                    : 0}
                  %
                </div>
              </div>
            </div>

            {/* Grid of Key Attributes */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: 'var(--space-3)',
                fontSize: '12.5px',
              }}
            >
              <div>
                <span style={{ color: 'var(--color-on-surface-variant)' }}>Produk:</span>
                <div style={{ fontWeight: 700, color: 'var(--color-on-surface)' }}>
                  {products?.find((p) => p.id === selectedWo.productId)?.name || selectedWo.productId}
                </div>
              </div>

              <div>
                <span style={{ color: 'var(--color-on-surface-variant)' }}>Production Line & Mesin:</span>
                <div style={{ fontWeight: 700, color: 'var(--color-on-surface)' }}>
                  {lines?.find((l) => l.id === selectedWo.lineId)?.name || selectedWo.lineId} (
                  {machines?.find((m) => m.id === selectedWo.machineId)?.name ||
                    selectedWo.machineId ||
                    'Semua'}
                  )
                </div>
              </div>

              <div>
                <span style={{ color: 'var(--color-on-surface-variant)' }}>Jumlah Good:</span>
                <div style={{ fontWeight: 800, color: 'var(--color-success)', fontSize: '15px' }}>
                  {selectedWo.outputQuantity.toLocaleString('en-US')} {selectedWo.unit}
                </div>
              </div>

              <div>
                <span style={{ color: 'var(--color-on-surface-variant)' }}>Jumlah Reject:</span>
                <div
                  style={{
                    fontWeight: 800,
                    color: selectedWo.rejectQuantity > 0 ? 'var(--color-error)' : 'var(--color-on-surface)',
                    fontSize: '15px',
                  }}
                >
                  {selectedWo.rejectQuantity.toLocaleString('en-US')} PCS
                </div>
              </div>

              <div>
                <span style={{ color: 'var(--color-on-surface-variant)' }}>Rencana Jadwal:</span>
                <div style={{ fontWeight: 600, color: 'var(--color-on-surface)', fontSize: '11.5px' }}>
                  {selectedWo.plannedStart ? new Date(selectedWo.plannedStart).toLocaleString('id-ID') : '-'}{' '}
                  s/d {selectedWo.plannedEnd ? new Date(selectedWo.plannedEnd).toLocaleString('id-ID') : '-'}
                </div>
              </div>

              <div>
                <span style={{ color: 'var(--color-on-surface-variant)' }}>Waktu Aktual Eksekusi:</span>
                <div style={{ fontWeight: 600, color: 'var(--color-on-surface)', fontSize: '11.5px' }}>
                  Mulai:{' '}
                  {selectedWo.actualStart
                    ? new Date(selectedWo.actualStart).toLocaleTimeString('id-ID')
                    : 'Belum'}{' '}
                  • Selesai:{' '}
                  {selectedWo.actualEnd ? new Date(selectedWo.actualEnd).toLocaleTimeString('id-ID') : '-'}
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: 'var(--space-3)',
                paddingTop: 'var(--space-4)',
                borderTop: '1px solid var(--color-outline-variant)',
              }}
            >
              <Button
                variant="outlined"
                style={{ color: 'var(--color-error)' }}
                onClick={() => {
                  setShowDetailModal(false);
                  handleOpenDeleteWo(selectedWo);
                }}
              >
                Hapus WO
              </Button>

              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <Button
                  variant="tonal"
                  onClick={() => {
                    setShowDetailModal(false);
                    handleOpenEditWo(selectedWo);
                  }}
                >
                  Edit Parameter
                </Button>

                {(selectedWo.status === WorkOrderStatus.DRAFT || selectedWo.status === WorkOrderStatus.SCHEDULED) && (
                  <Button
                    variant="filled"
                    onClick={() => {
                      releaseMutation.mutate(selectedWo.id);
                      setShowDetailModal(false);
                    }}
                  >
                    Konfirmasi ke Shop Floor
                  </Button>
                )}

                {selectedWo.status === WorkOrderStatus.IN_PRODUCTION && (
                  <Button
                    variant="tonal"
                    style={{ color: 'var(--color-warning)' }}
                    onClick={() => {
                      cancelMutation.mutate(selectedWo.id);
                      setShowDetailModal(false);
                    }}
                  >
                    Batalkan WO
                  </Button>
                )}
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* DELETE WO CONFIRMATION DIALOG */}
      <Dialog
        isOpen={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        headline="Konfirmasi Hapus Work Order"
        supportingText={`Apakah Anda yakin ingin menghapus Work Order ${selectedWo?.woNumber}? Tindakan ini akan menghapus data Work Order dari antrean produksi.`}
        confirmLabel="Hapus Permanen"
        cancelLabel="Batal"
        destructive={true}
        onConfirm={() => {
          if (selectedWo) deleteWoMutation.mutate(selectedWo.id);
        }}
      />

      {/* CREATE PO MODAL */}
      <Modal
        isOpen={showCreatePoModal}
        onClose={() => setShowCreatePoModal(false)}
        title="BUAT PRODUCTION ORDER BARU (PO MASTER)"
        maxWidth="500px"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createPoMutation.mutate(poFormData);
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
        >
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
              NOMOR PO / SPK
            </label>
            <input
              type="text"
              value={poFormData.orderNumber}
              onChange={(e) => setPoFormData({ ...poFormData, orderNumber: e.target.value })}
              required
              style={{
                width: '100%',
                padding: `var(--space-3) var(--space-3)`,
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--color-surface-container-high)',
                border: '1px solid var(--color-outline-variant)',
                color: 'var(--color-on-surface)',
                fontSize: '13px',
                fontWeight: 700,
                outline: 'none',
              }}
            />
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
              PRODUK
            </label>
            <select
              value={poFormData.productId}
              onChange={(e) => setPoFormData({ ...poFormData, productId: e.target.value })}
              style={{
                width: '100%',
                padding: `var(--space-3) var(--space-3)`,
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--color-surface-container-high)',
                border: '1px solid var(--color-outline-variant)',
                color: 'var(--color-on-surface)',
                fontSize: '13px',
              }}
            >
              {products?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.sku}, {p.name}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
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
                TOTAL TARGET (PCS)
              </label>
              <input
                type="number"
                value={poFormData.quantity}
                onChange={(e) => setPoFormData({ ...poFormData, quantity: Number(e.target.value) })}
                min={1}
                required
                style={{
                  width: '100%',
                  padding: `var(--space-3) var(--space-3)`,
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--color-surface-container-high)',
                  border: '1px solid var(--color-outline-variant)',
                  color: 'var(--color-on-surface)',
                  fontSize: '13px',
                  fontWeight: 700,
                  outline: 'none',
                }}
              />
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
                TENGGAT WAKTU (DUE DATE)
              </label>
              <input
                type="date"
                value={poFormData.dueDate}
                onChange={(e) => setPoFormData({ ...poFormData, dueDate: e.target.value })}
                required
                style={{
                  width: '100%',
                  padding: `var(--space-3) var(--space-3)`,
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--color-surface-container-high)',
                  border: '1px solid var(--color-outline-variant)',
                  color: 'var(--color-on-surface)',
                  fontSize: '13px',
                  outline: 'none',
                }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
            <Button variant="outlined" type="button" onClick={() => setShowCreatePoModal(false)}>
              Batal
            </Button>
            <Button variant="filled" type="submit" disabled={createPoMutation.isPending}>
              Simpan PO
            </Button>
          </div>
        </form>
      </Modal>

      {/* DELETE PO CONFIRMATION DIALOG */}
      <Dialog
        isOpen={showDeletePoDialog}
        onClose={() => setShowDeletePoDialog(false)}
        headline="Konfirmasi Hapus Production Order"
        supportingText={`Apakah Anda yakin ingin menghapus Production Order ${selectedPo?.orderNumber}?`}
        confirmLabel="Hapus PO"
        cancelLabel="Batal"
        destructive={true}
        onConfirm={() => {
          if (selectedPo) deletePoMutation.mutate(selectedPo.id);
        }}
      />
    </Page>
  );
};
