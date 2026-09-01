import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FactoryVisionApiClient } from '@factory-vision/api-client';
import {
  AdvancedDataTable,
  ColumnDef,
  Button,
  Icon,
  FilledTextField,
  EmptyState,
  ErrorState,
} from '@factory-vision/ui';
import {
  Page,
  Section,
  SurfaceCard,
  Dialog,
  FilterChip,
  toneContainer,
  toneOnContainer,
  type Tone,
  DateField,
} from '@factory-vision/ui/fv';
import {
  CapacityStatus,
  ProductionPlanStatus,
  PRODUCTION_PLAN_STATUS_LABEL,
  CAPACITY_STATUS_LABEL,
} from '@factory-vision/domain-types';
import type { ProductionPlan, ProductionPlanLine } from '@factory-vision/domain-types';

const api = new FactoryVisionApiClient({ baseUrl: '' });

/**
 * Production Plan list (MES-043).
 *
 * A plan is a commitment, so the list leads with the two things that decide
 * whether it can become one: how much it plans to produce, and whether capacity
 * allows it. A Draft that has been sitting for more than a week is flagged —
 * an abandoned plan is demand nobody is producing.
 */

const AGEING_DAYS = 7;

const PLAN_TONE: Record<string, Tone> = {
  DRAFT: 'neutral',
  PLANNING: 'info',
  READY: 'info',
  CONFIRMED: 'success',
  IN_EXECUTION: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
};

const CAPACITY_TONE: Record<CapacityStatus, Tone> = {
  [CapacityStatus.WITHIN_PLAN]: 'success',
  [CapacityStatus.ADDITIONAL_DEMAND]: 'warning',
  [CapacityStatus.CAPACITY_UP_REQUIRED]: 'error',
};

function daysOld(iso?: string): number {
  if (!iso) return 0;
  const created = Date.parse(iso);
  if (!Number.isFinite(created)) return 0;
  return Math.floor((Date.now() - created) / 86_400_000);
}

/** The worst capacity status among a plan's lines is the plan's own. */
function planCapacityStatus(lines: ProductionPlanLine[]): CapacityStatus | undefined {
  if (lines.length === 0) return undefined;
  if (lines.some((l) => l.capacityStatus === CapacityStatus.CAPACITY_UP_REQUIRED)) {
    return CapacityStatus.CAPACITY_UP_REQUIRED;
  }
  if (lines.some((l) => l.capacityStatus === CapacityStatus.ADDITIONAL_DEMAND)) {
    return CapacityStatus.ADDITIONAL_DEMAND;
  }
  return CapacityStatus.WITHIN_PLAN;
}

const Pill: React.FC<{ label: string; tone: Tone; title?: string }> = ({ label, tone, title }) => (
  <span
    title={title}
    style={{
      display: 'inline-flex',
      padding: `var(--space-1) var(--space-3)`,
      borderRadius: 'var(--radius-pill)',
      fontSize: '11px',
      fontWeight: 700,
      backgroundColor: toneContainer[tone],
      color: toneOnContainer[tone],
    }}
  >
    {label}
  </span>
);

interface PlanRow extends ProductionPlan {
  id: string;
  lineCount: number;
  plannedTotal: number;
  capacityStatus?: CapacityStatus;
  relatedOrders: string[];
}

export const ProductionPlansPage: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const now = new Date();
  const [newStart, setNewStart] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  );
  const [newEnd, setNewEnd] = useState(
    new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10)
  );

  const plansQuery = useQuery({
    queryKey: ['planning', 'plans', statusFilter, periodStart, periodEnd],
    queryFn: () =>
      api.planning.getPlans({
        status: statusFilter === 'ALL' ? undefined : statusFilter,
        periodStart: periodStart || undefined,
        periodEnd: periodEnd || undefined,
      }),
  });

  /**
   * Lines and demand per plan, for the planned quantity, capacity badge and
   * related-order links the list has to show.
   */
  const detailsQuery = useQuery({
    queryKey: ['planning', 'plan-summaries', (plansQuery.data ?? []).map((p) => p.id).join(',')],
    enabled: (plansQuery.data ?? []).length > 0,
    queryFn: async () => {
      const summaries = new Map<
        string,
        { lines: ProductionPlanLine[]; orders: string[] }
      >();
      for (const plan of plansQuery.data ?? []) {
        const [lines, demand] = await Promise.all([
          api.planning.getPlanLines(plan.id),
          api.planning.getPlanDemand(plan.id),
        ]);
        const orders = [
          ...new Set(demand.flatMap((line) => line.sources.map((s) => s.orderNumber))),
        ];
        summaries.set(plan.id, { lines, orders });
      }
      return summaries;
    },
  });

  const createPlan = useMutation({
    mutationFn: () => api.planning.createPlan({ periodStart: newStart, periodEnd: newEnd }),
    onSuccess: (plan) => {
      setShowCreate(false);
      void queryClient.invalidateQueries({ queryKey: ['planning', 'plans'] });
      navigate(`/production-plans/${plan.id}`);
    },
  });

  const rows: PlanRow[] = useMemo(() => {
    return (plansQuery.data ?? []).map((plan) => {
      const summary = detailsQuery.data?.get(plan.id);
      const lines = summary?.lines ?? [];
      return {
        ...plan,
        id: plan.id,
        lineCount: lines.length,
        plannedTotal: lines.reduce((sum, l) => sum + l.plannedQuantity, 0),
        capacityStatus: planCapacityStatus(lines),
        relatedOrders: summary?.orders ?? [],
      };
    });
  }, [plansQuery.data, detailsQuery.data]);

  const columns: ColumnDef<PlanRow>[] = [
    {
      key: 'planNumber',
      header: 'Nomor Plan',
      sortable: true,
      render: (row) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span style={{ fontWeight: 700 }}>{row.planNumber}</span>
          {row.status === ProductionPlanStatus.DRAFT && daysOld(row.createdAt) >= AGEING_DAYS && (
            <span title={`Draft sudah ${daysOld(row.createdAt)} hari; demand ini belum menjadi komitmen.`}>
              <Icon name="hourglass_bottom" size={16} />
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'periodStart',
      header: 'Periode',
      sortable: true,
      render: (row) => `${row.periodStart} → ${row.periodEnd}`,
    },
    {
      key: 'plannedTotal',
      header: 'Planned Qty',
      sortable: true,
      render: (row) =>
        detailsQuery.isLoading ? '…' : `${row.plannedTotal.toLocaleString('id-ID')} (${row.lineCount} line)`,
    },
    {
      key: 'capacityStatus',
      header: 'Capacity',
      render: (row) =>
        row.capacityStatus ? (
          <Pill label={CAPACITY_STATUS_LABEL[row.capacityStatus]} tone={CAPACITY_TONE[row.capacityStatus]} />
        ) : (
          <span style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>—</span>
        ),
    },
    {
      key: 'relatedOrders',
      header: 'Order Terkait',
      render: (row) =>
        row.relatedOrders.length === 0 ? (
          <span style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>—</span>
        ) : (
          <span style={{ fontSize: '11px' }}>{row.relatedOrders.slice(0, 3).join(', ')}
            {row.relatedOrders.length > 3 ? ` +${row.relatedOrders.length - 3}` : ''}
          </span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <Pill
          label={PRODUCTION_PLAN_STATUS_LABEL[row.status] ?? row.status}
          tone={PLAN_TONE[row.status] ?? 'neutral'}
        />
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <Button variant="text" size="sm" onClick={() => navigate(`/production-plans/${row.id}`)}>
          Buka Wizard
        </Button>
      ),
    },
  ];

  return (
    <Page>
      <Section>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
              Production Plan
            </h1>
            <p style={{ margin: `var(--space-1) 0 0`, fontSize: '13px', color: 'var(--color-on-surface-variant)' }}>
              Rencana produksi per periode. Plan yang dikonfirmasi menjadi komitmen dan memindahkan
              Customer Order terkait ke status Planned.
            </p>
          </div>
          <Button variant="filled" onClick={() => setShowCreate(true)}>
            <Icon name="add" size={16} /> Plan Baru
          </Button>
        </div>
      </Section>

      <Section>
        <SurfaceCard padding="md">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', alignItems: 'end' }}>
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <FilterChip selected={statusFilter === 'ALL'} onClick={() => setStatusFilter('ALL')}>
                Semua
              </FilterChip>
              {Object.values(ProductionPlanStatus).map((status) => (
                <FilterChip
                  key={status}
                  selected={statusFilter === status}
                  onClick={() => setStatusFilter(status)}
                >
                  {PRODUCTION_PLAN_STATUS_LABEL[status]}
                </FilterChip>
              ))}
            </div>
            <DateField
              label="Periode dari"
              type="date"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
            />
            <DateField
              label="Periode sampai"
              type="date"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
            />
          </div>
        </SurfaceCard>
      </Section>

      <Section>
        {plansQuery.isLoading ? (
          <SurfaceCard padding="lg">
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-on-surface-variant)' }}>
              Memuat production plan…
            </p>
          </SurfaceCard>
        ) : plansQuery.isError ? (
          <ErrorState
            title="Gagal memuat production plan"
            description="Periksa koneksi ke API lalu coba lagi."
            onRetry={() => void plansQuery.refetch()}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="calendar_month"
            title="Belum ada production plan"
            description="Buat plan untuk satu periode, lalu jalankan wizard enam step untuk menentukan demand, quantity, Work Order, jadwal, dan resource."
            actionLabel="Plan Baru"
            onAction={() => setShowCreate(true)}
          />
        ) : (
          <AdvancedDataTable
            columns={columns}
            data={rows}
            title="Production Plan"
            subtitle={`${rows.length} plan`}
            selectable={false}
          />
        )}
      </Section>

      <Dialog isOpen={showCreate} onClose={() => setShowCreate(false)} title="Production Plan Baru">
        <p style={{ margin: `0 0 var(--space-3)`, fontSize: '13px', color: 'var(--color-on-surface-variant)' }}>
          Plan dibuat dengan status Draft dan nomor PLAN-YYYYMM-NNN. Wizard dapat ditinggalkan dan
          dilanjutkan kapan saja.
        </p>
        <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
          <DateField
            label="Periode mulai"
            type="date"
            value={newStart}
            onChange={(e) => setNewStart(e.target.value)}
          />
          <DateField
            label="Periode selesai"
            type="date"
            value={newEnd}
            onChange={(e) => setNewEnd(e.target.value)}
          />
        </div>
        {createPlan.isError && (
          <p style={{ margin: `var(--space-3) 0 0`, fontSize: '12px', color: 'var(--color-error)' }}>
            {(createPlan.error as Error).message}
          </p>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
          <Button variant="text" onClick={() => setShowCreate(false)}>
            Batal
          </Button>
          <Button variant="filled" onClick={() => createPlan.mutate()} disabled={createPlan.isPending}>
            {createPlan.isPending ? 'Membuat…' : 'Buat & Buka Wizard'}
          </Button>
        </div>
      </Dialog>
    </Page>
  );
};
