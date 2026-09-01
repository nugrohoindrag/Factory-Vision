import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FactoryVisionApiClient, ApiRequestError } from '@factory-vision/api-client';
import { Button, Icon, FilledTextField, Select, EmptyState, ErrorState } from '@factory-vision/ui';
import {
  Page,
  Section,
  SurfaceCard,
  toneContainer,
  toneOnContainer,
  type Tone,
} from '@factory-vision/ui/fv';
import {
  CapacityStatus,
  CAPACITY_STATUS_LABEL,
  PRODUCTION_PLAN_STATUS_LABEL,
  ProductionPlanStatus,
  statusLabel,
} from '@factory-vision/domain-types';
import type { WorkOrder } from '@factory-vision/domain-types';

const api = new FactoryVisionApiClient({ baseUrl: '' });

/**
 * The six-step Production Plan wizard (MES-037, MES-038, MES-039, MES-040).
 *
 * ```text
 * 1 Demand → 2 Production Plan → 3 Work Order → 4 Scheduling → 5 Resource → 6 Confirmation
 * ```
 *
 * Three behaviours the tickets are specific about:
 *
 * - **Nothing is retyped.** Every step prefills from what is already recorded:
 *   the order lines, the forecast, the capacity assessment, the generated work
 *   orders.
 * - **A step is locked until its prerequisite exists**, and the lock says what
 *   is missing. Going *back* is always allowed — planning is iterative.
 * - **The wizard resumes where it was left.** The server decides the resume
 *   point from the plan's data, so an abandoned session picks up correctly on a
 *   different machine.
 *
 * Steps 4 and 5 are review-and-progress here: scheduling and resource
 * assignment themselves are Sprint 7–8 (MES-047…MES-053). What this screen owns
 * is the wizard frame, the gating, and the confirmation.
 */

const CAPACITY_TONE: Record<CapacityStatus, Tone> = {
  [CapacityStatus.WITHIN_PLAN]: 'success',
  [CapacityStatus.ADDITIONAL_DEMAND]: 'warning',
  [CapacityStatus.CAPACITY_UP_REQUIRED]: 'error',
};

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

export const ProductionPlanWizardPage: React.FC = () => {
  const { planId = '' } = useParams<{ planId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<number>(1);
  const [notice, setNotice] = useState<{ text: string; tone: 'info' | 'error' | 'success' } | null>(null);
  const [restored, setRestored] = useState(false);

  const planQuery = useQuery({
    queryKey: ['planning', 'plan', planId],
    queryFn: () => api.planning.getPlan(planId),
    enabled: Boolean(planId),
  });

  const wizardQuery = useQuery({
    queryKey: ['planning', 'plan-wizard', planId],
    queryFn: () => api.planning.getPlanWizard(planId),
    enabled: Boolean(planId),
  });

  const demandQuery = useQuery({
    queryKey: ['planning', 'plan-demand', planId],
    queryFn: () => api.planning.getPlanDemand(planId),
    enabled: Boolean(planId),
  });

  const productsQuery = useQuery({
    queryKey: ['master', 'products'],
    queryFn: () => api.master.getProducts(),
  });

  const customersQuery = useQuery({
    queryKey: ['planning', 'customers'],
    queryFn: () => api.planning.getCustomers(),
  });

  // Candidate demand: order lines that still have quantity nobody has planned.
  const openOrdersQuery = useQuery({
    queryKey: ['planning', 'open-orders'],
    queryFn: () => api.planning.getOrders({ status: 'RECEIVED,PLANNED,IN_PRODUCTION' }),
  });

  const workOrdersQuery = useQuery({
    queryKey: ['planning', 'plan-work-orders', planId],
    queryFn: () => api.workOrders.list(),
    enabled: Boolean(planId),
  });

  const plan = planQuery.data;
  const wizard = wizardQuery.data;

  /**
   * Restores the step the server says the plan reached (MES-039-2), once.
   *
   * Only once: after that the planner is navigating, and re-applying the server
   * value on every refetch would yank them back.
   */
  useEffect(() => {
    if (!restored && wizard) {
      setStep(Math.max(1, wizard.resumeStep));
      setRestored(true);
    }
  }, [wizard, restored]);

  const persistStep = useMutation({
    mutationFn: (target: number) =>
      api.planning.updatePlan(planId, plan?.version ?? 1, { wizardStep: target }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['planning', 'plan', planId] });
      void queryClient.invalidateQueries({ queryKey: ['planning', 'plan-wizard', planId] });
    },
    onError: (error: unknown) => {
      // A 409 here is the optimistic lock: someone else edited the plan
      // (MES-039-3). Say so plainly and reload rather than overwriting them.
      if (error instanceof ApiRequestError && error.status === 409) {
        setNotice({ text: error.message, tone: 'error' });
        void queryClient.invalidateQueries({ queryKey: ['planning', 'plan', planId] });
      } else {
        setNotice({
          text: error instanceof Error ? error.message : 'Gagal berpindah step.',
          tone: 'error',
        });
      }
    },
  });

  const goTo = (target: number) => {
    const availability = wizard?.steps.find((s) => s.step === target);
    if (target > step && availability && !availability.reachable) {
      setNotice({ text: availability.blockedBy ?? `Step ${target} belum dapat dibuka.`, tone: 'error' });
      return;
    }
    setNotice(null);
    setStep(target);
    // Only forward progress is persisted: the stored step is "how far this plan
    // got", not "where the browser happens to be looking".
    if (target > (plan?.wizardStep ?? 1)) persistStep.mutate(target);
  };

  const addDemand = useMutation({
    mutationFn: (customerOrderLineId: string) =>
      api.planning.addPlanDemand(planId, { customerOrderLineId }),
    onSuccess: () => {
      setNotice({ text: 'Demand ditambahkan ke plan.', tone: 'success' });
      void queryClient.invalidateQueries({ queryKey: ['planning'] });
    },
    onError: (error: unknown) =>
      setNotice({
        text: error instanceof Error ? error.message : 'Gagal menambahkan demand.',
        tone: 'error',
      }),
  });

  const removeDemand = useMutation({
    mutationFn: (demandId: string) => api.planning.removePlanDemand(planId, demandId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['planning'] }),
  });

  const updateLine = useMutation({
    mutationFn: (input: { lineId: string; plannedQuantity?: number; priority?: number }) =>
      api.planning.updatePlanLine(planId, input.lineId, {
        plannedQuantity: input.plannedQuantity,
        priority: input.priority,
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['planning'] }),
  });

  const generateWorkOrders = useMutation({
    mutationFn: () => api.planning.generateWorkOrders(planId),
    onSuccess: (result) => {
      setNotice({ text: result.message, tone: 'success' });
      void queryClient.invalidateQueries({ queryKey: ['planning'] });
      void queryClient.invalidateQueries({ queryKey: ['workOrders'] });
    },
    onError: (error: unknown) => {
      if (error instanceof ApiRequestError && error.fields.length > 0) {
        // MES-042: the rejection names each specific cause, and no partial work
        // orders were stored.
        setNotice({
          text: `${error.message} ${error.fields.map((f) => f.message).join(' ')}`,
          tone: 'error',
        });
      } else {
        setNotice({
          text: error instanceof Error ? error.message : 'Generate Work Order gagal.',
          tone: 'error',
        });
      }
    },
  });

  const confirmPlan = useMutation({
    mutationFn: () => api.planning.confirmPlan(planId),
    onSuccess: () => {
      setNotice({ text: 'Production Plan dikonfirmasi.', tone: 'success' });
      void queryClient.invalidateQueries({ queryKey: ['planning'] });
    },
    onError: (error: unknown) =>
      setNotice({
        text: error instanceof Error ? error.message : 'Konfirmasi plan gagal.',
        tone: 'error',
      }),
  });

  const productName = (productId: string) => {
    const product = productsQuery.data?.find((p) => p.id === productId);
    return product ? `${product.sku} — ${product.name}` : productId;
  };

  const customerName = (customerId: string) =>
    customersQuery.data?.find((c) => c.id === customerId)?.name ?? customerId;

  /** Order lines with quantity nobody has planned yet, for Step 1. */
  const candidateLines = useMemo(() => {
    const alreadyInPlan = new Set(
      (demandQuery.data ?? []).flatMap((line) => line.sources.map((s) => s.customerOrderLineId))
    );
    return (openOrdersQuery.data ?? []).flatMap((order) =>
      order.lines
        .filter((line) => line.orderedQuantity > line.plannedQuantity && !alreadyInPlan.has(line.id))
        .map((line) => ({ order, line, outstanding: line.orderedQuantity - line.plannedQuantity }))
    );
  }, [openOrdersQuery.data, demandQuery.data]);

  const planWorkOrders: WorkOrder[] = useMemo(() => {
    const lineIds = new Set((plan?.lines ?? []).map((l) => l.id));
    return (workOrdersQuery.data ?? []).filter(
      (wo: WorkOrder) => wo.productionPlanLineId && lineIds.has(wo.productionPlanLineId)
    );
  }, [workOrdersQuery.data, plan?.lines]);

  if (planQuery.isLoading) {
    return (
      <Page>
        <Section>
          <SurfaceCard padding="lg">
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-on-surface-variant)' }}>
              Memuat production plan…
            </p>
          </SurfaceCard>
        </Section>
      </Page>
    );
  }

  if (planQuery.isError || !plan) {
    return (
      <Page>
        <Section>
          <ErrorState
            title="Production Plan tidak dapat dimuat"
            description="Plan mungkin sudah dihapus, atau API tidak dapat dihubungi."
            onRetry={() => void planQuery.refetch()}
          />
        </Section>
      </Page>
    );
  }

  const readOnly =
    plan.status === ProductionPlanStatus.CONFIRMED ||
    plan.status === ProductionPlanStatus.IN_EXECUTION ||
    plan.status === ProductionPlanStatus.COMPLETED ||
    plan.status === ProductionPlanStatus.CANCELLED;

  return (
    <Page>
      <Section>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
          <div>
            <button
              type="button"
              onClick={() => navigate('/production-plans')}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                marginBottom: 'var(--space-2)',
                cursor: 'pointer',
                fontSize: '12px',
                color: 'var(--color-primary)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 'var(--space-1)',
              }}
            >
              <Icon name="arrow_back" size={14} /> Daftar Production Plan
            </button>
            <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
              {plan.planNumber}
            </h1>
            <p style={{ margin: `var(--space-1) 0 0`, fontSize: '13px', color: 'var(--color-on-surface-variant)' }}>
              Periode {plan.periodStart} → {plan.periodEnd} ·{' '}
              {PRODUCTION_PLAN_STATUS_LABEL[plan.status] ?? plan.status} · versi {plan.version}
            </p>
          </div>
        </div>
      </Section>

      {readOnly && (
        <Section>
          <SurfaceCard padding="md" railTone="info">
            <span style={{ fontSize: '12px', color: 'var(--color-on-surface)' }}>
              Plan berstatus {PRODUCTION_PLAN_STATUS_LABEL[plan.status] ?? plan.status} dan tidak dapat
              diubah lagi. Plan yang dikonfirmasi adalah komitmen produksi.
            </span>
          </SurfaceCard>
        </Section>
      )}

      {notice && (
        <Section>
          <SurfaceCard
            padding="md"
            railTone={notice.tone === 'error' ? 'error' : notice.tone === 'success' ? 'success' : 'info'}
          >
            <span style={{ fontSize: '12px', color: 'var(--color-on-surface)' }}>{notice.text}</span>
          </SurfaceCard>
        </Section>
      )}

      <Section>
        <SurfaceCard padding="md">
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            {(wizard?.steps ?? []).map((entry) => {
              const isCurrent = entry.step === step;
              const locked = !entry.reachable && entry.step > step;
              return (
                <button
                  key={entry.step}
                  type="button"
                  onClick={() => goTo(entry.step)}
                  title={locked ? entry.blockedBy : undefined}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                    padding: `var(--space-2) var(--space-4)`,
                    borderRadius: 'var(--radius-pill)',
                    border: '1px solid var(--color-outline-variant)',
                    cursor: locked ? 'not-allowed' : 'pointer',
                    fontSize: '12px',
                    fontWeight: 700,
                    // One fill for every selected state: the active step is
                    // solid primary, like every other selection in the console.
                    backgroundColor: isCurrent ? 'var(--color-primary)' : 'var(--color-surface-container)',
                    color: isCurrent
                      ? 'var(--color-on-primary)'
                      : locked
                        ? 'var(--color-on-surface-variant)'
                        : 'var(--color-on-surface)',
                    opacity: locked ? 0.6 : 1,
                  }}
                >
                  {locked && <Icon name="lock" size={14} />}
                  {entry.step}. {entry.label}
                </button>
              );
            })}
          </div>
          {wizard && (
            <p style={{ margin: `var(--space-3) 0 0`, fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
              {wizard.steps.find((s) => s.step === step + 1)?.blockedBy ??
                'Seluruh prasyarat step berikutnya sudah terpenuhi.'}
            </p>
          )}
        </SurfaceCard>
      </Section>

      {/* --- Step 1: Demand (MES-037) --- */}
      {step === 1 && (
        <Section>
          <SurfaceCard padding="lg">
            <h2 style={{ margin: `0 0 var(--space-1)`, fontSize: '15px', fontWeight: 700 }}>Step 1 — Demand</h2>
            <p style={{ margin: `0 0 var(--space-4)`, fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
              Pilih demand yang masuk ke plan ini. Demand untuk product yang sama digabung menjadi satu
              plan line tanpa kehilangan asal ordernya.
            </p>

            <h3 style={{ margin: `0 0 var(--space-2)`, fontSize: '13px', fontWeight: 700 }}>Sudah masuk plan</h3>
            {(demandQuery.data ?? []).length === 0 ? (
              <p style={{ margin: `0 0 var(--space-4)`, fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
                Belum ada demand yang dipilih.
              </p>
            ) : (
              <div style={{ overflowX: 'auto', marginBottom: 'var(--space-5)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--color-on-surface-variant)' }}>
                      <th style={{ padding: `var(--space-2) var(--space-1)` }}>Customer</th>
                      <th style={{ padding: `var(--space-2) var(--space-1)` }}>Order</th>
                      <th style={{ padding: `var(--space-2) var(--space-1)` }}>Product</th>
                      <th style={{ padding: `var(--space-2) var(--space-1)` }}>Demand</th>
                      <th style={{ padding: `var(--space-2) var(--space-1)` }}>Kirim</th>
                      <th style={{ padding: `var(--space-2) var(--space-1)` }} />
                    </tr>
                  </thead>
                  <tbody>
                    {(demandQuery.data ?? []).flatMap((line) =>
                      line.sources.map((source) => (
                        <tr
                          key={source.customerOrderLineId}
                          style={{ borderTop: '1px solid var(--color-outline-variant)' }}
                        >
                          <td style={{ padding: `var(--space-2) var(--space-1)` }}>{source.customerName}</td>
                          <td style={{ padding: `var(--space-2) var(--space-1)` }}>{source.orderNumber}</td>
                          <td style={{ padding: `var(--space-2) var(--space-1)` }}>{productName(line.productId)}</td>
                          <td style={{ padding: `var(--space-2) var(--space-1)` }}>
                            {source.demandQuantity.toLocaleString('id-ID')}
                          </td>
                          <td style={{ padding: `var(--space-2) var(--space-1)` }}>{source.requestedDeliveryDate ?? '—'}</td>
                          <td style={{ padding: `var(--space-2) var(--space-1)` }}>
                            {!readOnly && (
                              <Button
                                variant="text"
                                size="sm"
                                onClick={() => {
                                  const demand = plan.demands.find(
                                    (d) => d.customerOrderLineId === source.customerOrderLineId
                                  );
                                  if (demand) removeDemand.mutate(demand.id);
                                }}
                              >
                                Lepas
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}

            <h3 style={{ margin: `0 0 var(--space-2)`, fontSize: '13px', fontWeight: 700 }}>
              Demand tersedia ({candidateLines.length})
            </h3>
            {candidateLines.length === 0 ? (
              <EmptyState
                icon="inbox"
                title="Tidak ada demand terbuka"
                description="Seluruh order line yang ada sudah masuk Production Plan, atau belum ada order baru."
                actionLabel=""
              />
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--color-on-surface-variant)' }}>
                      <th style={{ padding: `var(--space-2) var(--space-1)` }}>Customer</th>
                      <th style={{ padding: `var(--space-2) var(--space-1)` }}>Order</th>
                      <th style={{ padding: `var(--space-2) var(--space-1)` }}>Product</th>
                      <th style={{ padding: `var(--space-2) var(--space-1)` }}>Order Qty</th>
                      <th style={{ padding: `var(--space-2) var(--space-1)` }}>Sisa</th>
                      <th style={{ padding: `var(--space-2) var(--space-1)` }}>Kirim</th>
                      <th style={{ padding: `var(--space-2) var(--space-1)` }} />
                    </tr>
                  </thead>
                  <tbody>
                    {candidateLines.map(({ order, line, outstanding }) => (
                      <tr key={line.id} style={{ borderTop: '1px solid var(--color-outline-variant)' }}>
                        <td style={{ padding: `var(--space-2) var(--space-1)` }}>{customerName(order.customerId)}</td>
                        <td style={{ padding: `var(--space-2) var(--space-1)` }}>{order.orderNumber}</td>
                        <td style={{ padding: `var(--space-2) var(--space-1)` }}>{productName(line.productId)}</td>
                        <td style={{ padding: `var(--space-2) var(--space-1)` }}>
                          {line.orderedQuantity.toLocaleString('id-ID')}
                        </td>
                        <td style={{ padding: `var(--space-2) var(--space-1)`, fontWeight: 700 }}>
                          {outstanding.toLocaleString('id-ID')}
                        </td>
                        <td style={{ padding: `var(--space-2) var(--space-1)` }}>
                          {line.requestedDeliveryDate ?? order.requestedDeliveryDate}
                        </td>
                        <td style={{ padding: `var(--space-2) var(--space-1)` }}>
                          <Button
                            variant="outlined"
                            size="sm"
                            disabled={readOnly || addDemand.isPending}
                            onClick={() => addDemand.mutate(line.id)}
                          >
                            Masukkan
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SurfaceCard>
        </Section>
      )}

      {/* --- Step 2: Production Plan (MES-037) --- */}
      {step === 2 && (
        <Section>
          <SurfaceCard padding="lg">
            <h2 style={{ margin: `0 0 var(--space-1)`, fontSize: '15px', fontWeight: 700 }}>
              Step 2 — Production Plan
            </h2>
            <p style={{ margin: `0 0 var(--space-4)`, fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
              Tentukan planned quantity dan prioritas. Demand dan planned dipisah agar keputusan
              memproduksi kurang dari yang dipesan tetap terlihat. Capacity status dihitung sistem.
            </p>
            <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
              {plan.lines.map((line) => (
                <PlanLineEditor
                  key={line.id}
                  productLabel={productName(line.productId)}
                  demandQuantity={line.demandQuantity}
                  plannedQuantity={line.plannedQuantity}
                  priority={line.priority}
                  capacityStatus={line.capacityStatus}
                  requiredDeliveryDate={line.requiredDeliveryDate}
                  disabled={readOnly}
                  onSave={(plannedQuantity, priority) =>
                    updateLine.mutate({ lineId: line.id, plannedQuantity, priority })
                  }
                />
              ))}
            </div>
          </SurfaceCard>
        </Section>
      )}

      {/* --- Step 3: Work Order (MES-038) --- */}
      {step === 3 && (
        <Section>
          <SurfaceCard padding="lg">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <div>
                <h2 style={{ margin: `0 0 var(--space-1)`, fontSize: '15px', fontWeight: 700 }}>Step 3 — Work Order</h2>
                <p style={{ margin: 0, fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
                  Satu Work Order per process routing, dengan sequence dan predecessor terbentuk.
                  Generate ulang tidak membuat duplikat.
                </p>
              </div>
              <Button
                variant="filled"
                disabled={readOnly || generateWorkOrders.isPending}
                onClick={() => generateWorkOrders.mutate()}
              >
                {generateWorkOrders.isPending ? 'Menghasilkan…' : 'Generate Work Order'}
              </Button>
            </div>

            <div style={{ marginTop: 'var(--space-4)' }}>
              {planWorkOrders.length === 0 ? (
                <EmptyState
                  icon="assignment"
                  title="Belum ada Work Order"
                  description="Jalankan generate untuk membuat satu Work Order per process pada routing product."
                  actionLabel=""
                />
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead>
                      <tr style={{ textAlign: 'left', color: 'var(--color-on-surface-variant)' }}>
                        <th style={{ padding: `var(--space-2) var(--space-1)` }}>WO</th>
                        <th style={{ padding: `var(--space-2) var(--space-1)` }}>Product</th>
                        <th style={{ padding: `var(--space-2) var(--space-1)` }}>Seq</th>
                        <th style={{ padding: `var(--space-2) var(--space-1)` }}>Planned</th>
                        <th style={{ padding: `var(--space-2) var(--space-1)` }}>Predecessor</th>
                        <th style={{ padding: `var(--space-2) var(--space-1)` }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {planWorkOrders
                        .slice()
                        .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
                        .map((wo) => (
                          <tr key={wo.id} style={{ borderTop: '1px solid var(--color-outline-variant)' }}>
                            <td style={{ padding: `var(--space-2) var(--space-1)`, fontWeight: 700 }}>{wo.woNumber}</td>
                            <td style={{ padding: `var(--space-2) var(--space-1)` }}>{productName(wo.productId)}</td>
                            <td style={{ padding: `var(--space-2) var(--space-1)` }}>{wo.sequence ?? '—'}</td>
                            <td style={{ padding: `var(--space-2) var(--space-1)` }}>
                              {wo.plannedQuantity.toLocaleString('id-ID')}
                            </td>
                            <td style={{ padding: `var(--space-2) var(--space-1)` }}>
                              {wo.predecessorWorkOrderId
                                ? (planWorkOrders.find((p) => p.id === wo.predecessorWorkOrderId)?.woNumber ??
                                  '—')
                                : 'process pertama'}
                            </td>
                            <td style={{ padding: `var(--space-2) var(--space-1)` }}>{statusLabel(wo.status)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </SurfaceCard>
        </Section>
      )}

      {/* --- Step 4: Scheduling (MES-038) --- */}
      {step === 4 && (
        <Section>
          <SurfaceCard padding="lg">
            <h2 style={{ margin: `0 0 var(--space-1)`, fontSize: '15px', fontWeight: 700 }}>Step 4 — Scheduling</h2>
            <p style={{ margin: `0 0 var(--space-4)`, fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
              Start, estimated finish, shift, dan sequence per Work Order. Nilai awal diisi dari
              periode plan dan tanggal kirim plan line.
            </p>
            <ScheduleReview workOrders={planWorkOrders} productName={productName} />
          </SurfaceCard>
        </Section>
      )}

      {/* --- Step 5: Resource (MES-038) --- */}
      {step === 5 && (
        <Section>
          <SurfaceCard padding="lg">
            <h2 style={{ margin: `0 0 var(--space-1)`, fontSize: '15px', fontWeight: 700 }}>Step 5 — Resource</h2>
            <p style={{ margin: `0 0 var(--space-4)`, fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
              Hanya machine dan mold yang compatible dengan product yang ditampilkan. Assignment yang
              tidak compatible ditolak backend.
            </p>
            <ResourceReview workOrders={planWorkOrders} productName={productName} />
          </SurfaceCard>
        </Section>
      )}

      {/* --- Step 6: Confirmation (MES-038, MES-040) --- */}
      {step === 6 && (
        <Section>
          <SurfaceCard padding="lg">
            <h2 style={{ margin: `0 0 var(--space-1)`, fontSize: '15px', fontWeight: 700 }}>Step 6 — Confirmation</h2>
            <p style={{ margin: `0 0 var(--space-4)`, fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
              Ringkasan lengkap plan. Konfirmasi ditolak bila masih ada plan line Capacity Up Required
              atau Work Order yang belum dikonfirmasi.
            </p>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: 'var(--space-3)',
                marginBottom: 'var(--space-4)',
              }}
            >
              <Summary label="Plan line" value={String(plan.lines.length)} />
              <Summary
                label="Total planned"
                value={plan.lines.reduce((s, l) => s + l.plannedQuantity, 0).toLocaleString('id-ID')}
              />
              <Summary label="Work Order" value={String(planWorkOrders.length)} />
              <Summary
                label="Customer Order terkait"
                value={String(
                  new Set(
                    (demandQuery.data ?? []).flatMap((l) => l.sources.map((s) => s.customerOrderId))
                  ).size
                )}
              />
            </div>

            {(wizard?.capacityUpRequiredLines ?? 0) > 0 && (
              <SurfaceCard padding="md" railTone="error" style={{ marginBottom: 'var(--space-3)' }}>
                <span style={{ fontSize: '12px', color: 'var(--color-on-surface)' }}>
                  {wizard?.capacityUpRequiredLines} plan line berstatus Capacity Up Required. Turunkan
                  planned quantity atau ajukan Capacity Up sebelum konfirmasi.
                </span>
              </SurfaceCard>
            )}

            {planWorkOrders.some((wo) => wo.status === 'DRAFT' || wo.status === 'SCHEDULED') && (
              <SurfaceCard padding="md" railTone="warning" style={{ marginBottom: 'var(--space-3)' }}>
                <span style={{ fontSize: '12px', color: 'var(--color-on-surface)' }}>
                  Masih ada Work Order yang belum dikonfirmasi. Konfirmasi seluruh Work Order sebelum
                  plan dapat dikonfirmasi.
                </span>
              </SurfaceCard>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button
                variant="filled"
                disabled={readOnly || confirmPlan.isPending}
                onClick={() => confirmPlan.mutate()}
              >
                {confirmPlan.isPending ? 'Mengonfirmasi…' : 'Konfirmasi Production Plan'}
              </Button>
            </div>
          </SurfaceCard>
        </Section>
      )}

      <Section>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Button variant="outlined" disabled={step === 1} onClick={() => goTo(step - 1)}>
            <Icon name="arrow_back" size={16} /> Step sebelumnya
          </Button>
          <Button variant="filled" disabled={step === 6} onClick={() => goTo(step + 1)}>
            Step berikutnya <Icon name="arrow_forward" size={16} />
          </Button>
        </div>
      </Section>
    </Page>
  );
};

const Summary: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div
    style={{
      padding: 'var(--space-3)',
      borderRadius: 'var(--radius-md)',
      backgroundColor: 'var(--color-surface-container)',
    }}
  >
    <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>{label}</div>
    <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--color-on-surface)' }}>{value}</div>
  </div>
);

/**
 * One plan line's Step 2 decision.
 *
 * Local state until Save, so a planner can type a quantity without the capacity
 * assessment firing on every keystroke.
 */
const PlanLineEditor: React.FC<{
  productLabel: string;
  demandQuantity: number;
  plannedQuantity: number;
  priority: number;
  capacityStatus: CapacityStatus;
  requiredDeliveryDate?: string;
  disabled?: boolean;
  onSave: (plannedQuantity: number, priority: number) => void;
}> = ({
  productLabel,
  demandQuantity,
  plannedQuantity,
  priority,
  capacityStatus,
  requiredDeliveryDate,
  disabled,
  onSave,
}) => {
  const [planned, setPlanned] = useState(plannedQuantity);
  const [prio, setPrio] = useState(priority);

  useEffect(() => setPlanned(plannedQuantity), [plannedQuantity]);
  useEffect(() => setPrio(priority), [priority]);

  const dirty = planned !== plannedQuantity || prio !== priority;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(200px, 2fr) repeat(3, minmax(110px, 1fr)) auto',
        gap: 'var(--space-3)',
        alignItems: 'center',
        padding: 'var(--space-3)',
        borderRadius: 'var(--radius-md)',
        backgroundColor: 'var(--color-surface-container)',
      }}
    >
      <div>
        <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-on-surface)' }}>
          {productLabel}
        </div>
        <div style={{ marginTop: 'var(--space-1)', display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <Pill
            label={CAPACITY_STATUS_LABEL[capacityStatus]}
            tone={CAPACITY_TONE[capacityStatus]}
            title="Ditentukan sistem dari demand terhadap kapasitas."
          />
          {requiredDeliveryDate && (
            <span style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
              kirim {requiredDeliveryDate}
            </span>
          )}
        </div>
      </div>
      <div>
        <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>Demand</div>
        <div style={{ fontSize: '14px', fontWeight: 600 }}>{demandQuantity.toLocaleString('id-ID')}</div>
      </div>
      <FilledTextField
        label="Planned"
        type="number"
        min={0}
        value={planned}
        disabled={disabled}
        onChange={(e) => setPlanned(Number(e.target.value))}
      />
      <FilledTextField
        label="Prioritas"
        type="number"
        min={1}
        value={prio}
        disabled={disabled}
        onChange={(e) => setPrio(Number(e.target.value))}
      />
      <Button variant="outlined" size="sm" disabled={disabled || !dirty} onClick={() => onSave(planned, prio)}>
        Simpan
      </Button>
    </div>
  );
};

const ScheduleReview: React.FC<{
  workOrders: WorkOrder[];
  productName: (id: string) => string;
}> = ({ workOrders, productName }) => {
  if (workOrders.length === 0) {
    return (
      <EmptyState
        icon="calendar_month"
        title="Belum ada Work Order untuk dijadwalkan"
        description="Kembali ke Step 3 dan generate Work Order lebih dahulu."
        actionLabel=""
      />
    );
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
        <thead>
          <tr style={{ textAlign: 'left', color: 'var(--color-on-surface-variant)' }}>
            <th style={{ padding: `var(--space-2) var(--space-1)` }}>WO</th>
            <th style={{ padding: `var(--space-2) var(--space-1)` }}>Product</th>
            <th style={{ padding: `var(--space-2) var(--space-1)` }}>Seq</th>
            <th style={{ padding: `var(--space-2) var(--space-1)` }}>Planned Start</th>
            <th style={{ padding: `var(--space-2) var(--space-1)` }}>Planned End</th>
            <th style={{ padding: `var(--space-2) var(--space-1)` }}>Shift</th>
          </tr>
        </thead>
        <tbody>
          {workOrders.map((wo) => (
            <tr key={wo.id} style={{ borderTop: '1px solid var(--color-outline-variant)' }}>
              <td style={{ padding: `var(--space-2) var(--space-1)`, fontWeight: 700 }}>{wo.woNumber}</td>
              <td style={{ padding: `var(--space-2) var(--space-1)` }}>{productName(wo.productId)}</td>
              <td style={{ padding: `var(--space-2) var(--space-1)` }}>{wo.sequence ?? '—'}</td>
              <td style={{ padding: `var(--space-2) var(--space-1)` }}>{wo.plannedStart?.slice(0, 16).replace('T', ' ')}</td>
              <td style={{ padding: `var(--space-2) var(--space-1)` }}>{wo.plannedEnd?.slice(0, 16).replace('T', ' ')}</td>
              <td style={{ padding: `var(--space-2) var(--space-1)` }}>{wo.shiftId ?? 'belum ditetapkan'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const ResourceReview: React.FC<{
  workOrders: WorkOrder[];
  productName: (id: string) => string;
}> = ({ workOrders, productName }) => {
  if (workOrders.length === 0) {
    return (
      <EmptyState
        icon="precision_manufacturing"
        title="Belum ada Work Order"
        description="Resource ditetapkan setelah Work Order di-generate dan dijadwalkan."
        actionLabel=""
      />
    );
  }
  const missing = workOrders.filter((wo) => !wo.machineId || !wo.moldId);
  return (
    <>
      {missing.length > 0 && (
        <SurfaceCard padding="md" railTone="warning" style={{ marginBottom: 'var(--space-3)' }}>
          <span style={{ fontSize: '12px', color: 'var(--color-on-surface)' }}>
            {missing.length} Work Order belum memiliki mesin dan/atau mold. Step Confirmation terkunci
            sampai seluruhnya terisi.
          </span>
        </SurfaceCard>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--color-on-surface-variant)' }}>
              <th style={{ padding: `var(--space-2) var(--space-1)` }}>WO</th>
              <th style={{ padding: `var(--space-2) var(--space-1)` }}>Product</th>
              <th style={{ padding: `var(--space-2) var(--space-1)` }}>Machine</th>
              <th style={{ padding: `var(--space-2) var(--space-1)` }}>Mold</th>
            </tr>
          </thead>
          <tbody>
            {workOrders.map((wo) => (
              <tr key={wo.id} style={{ borderTop: '1px solid var(--color-outline-variant)' }}>
                <td style={{ padding: `var(--space-2) var(--space-1)`, fontWeight: 700 }}>{wo.woNumber}</td>
                <td style={{ padding: `var(--space-2) var(--space-1)` }}>{productName(wo.productId)}</td>
                <td style={{ padding: `var(--space-2) var(--space-1)` }}>{wo.machineId ?? 'belum ditetapkan'}</td>
                <td style={{ padding: `var(--space-2) var(--space-1)` }}>{wo.moldId ?? 'belum ditetapkan'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
};
