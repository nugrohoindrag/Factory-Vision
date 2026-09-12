import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FactoryVisionApiClient } from '@factory-vision/api-client';
import type { PlanningJobView } from '@factory-vision/domain-types';
import { Button, Icon, FilledTextField, EmptyState, ErrorState } from '@factory-vision/ui';
import {
  Page,
  Section,
  SurfaceCard,
  MetricCard,
  JobProgress,
  toneContainer,
  toneOnContainer,
  type Tone,
  DateField,
} from '@factory-vision/ui/fv';
import {
  CapacityStatus,
  CAPACITY_STATUS_LABEL,
  CAPACITY_STATUS_DESCRIPTION,
} from '@factory-vision/domain-types';

const api = new FactoryVisionApiClient({ baseUrl: '' });

/**
 * Capacity Planning (MES-034).
 *
 * One screen answers one question: **can this period's demand be met?**
 *
 * Every figure carries its formula (§45.6, §18.3), because a planner who cannot
 * check a number will not act on it. And the machines that could not be
 * computed are given a panel of their own — a machine without an ideal cycle
 * time is a master-data gap, not zero capacity, and conflating the two is what
 * produces a Capacity Up request against a machine that works fine.
 */

const STATUS_TONE: Record<CapacityStatus, Tone> = {
  [CapacityStatus.WITHIN_PLAN]: 'success',
  [CapacityStatus.ADDITIONAL_DEMAND]: 'warning',
  [CapacityStatus.CAPACITY_UP_REQUIRED]: 'error',
};

const CapacityBadge: React.FC<{ status: CapacityStatus }> = ({ status }) => (
  <span
    title={CAPACITY_STATUS_DESCRIPTION[status]}
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 'var(--space-1)',
      padding: `var(--space-1) var(--space-3)`,
      borderRadius: 'var(--radius-pill)',
      fontSize: '11px',
      fontWeight: 700,
      backgroundColor: toneContainer[STATUS_TONE[status]],
      color: toneOnContainer[STATUS_TONE[status]],
    }}
  >
    {CAPACITY_STATUS_LABEL[status]}
  </span>
);

export const CapacityPlanningPage: React.FC = () => {
  const queryClient = useQueryClient();

  const now = new Date();
  const firstOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const lastOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

  const [periodStart, setPeriodStart] = useState(firstOfMonth);
  const [periodEnd, setPeriodEnd] = useState(lastOfMonth);
  const [notice, setNotice] = useState<string | null>(null);
  // The recalculation runs on the worker; the screen watches the job, kept
  // after it finishes so the outcome (and its duration) stays readable.
  const [jobId, setJobId] = useState<string | null>(null);
  const [lastJob, setLastJob] = useState<PlanningJobView | null>(null);

  const currentQuery = useQuery({
    queryKey: ['planning', 'capacity-current', periodStart],
    queryFn: () => api.planning.getCurrentCapacityPlan(periodStart),
  });

  const productsQuery = useQuery({
    queryKey: ['master', 'products'],
    queryFn: () => api.master.getProducts(),
  });

  const configQuery = useQuery({
    queryKey: ['planning', 'config'],
    queryFn: () => api.planning.getConfig(),
  });

  const compute = useMutation({
    mutationFn: () => api.planning.computeCapacityPlan({ periodStart, periodEnd }),
    onSuccess: (plan) => {
      setNotice(`Capacity plan ${plan.planNumber} dihitung.`);
      void queryClient.invalidateQueries({ queryKey: ['planning', 'capacity-current'] });
    },
    onError: (error: unknown) =>
      setNotice(error instanceof Error ? error.message : 'Perhitungan kapasitas gagal.'),
  });

  const recalculate = useMutation({
    mutationFn: (planId: string) => api.planning.recalculateCapacityPlan(planId),
    onSuccess: (response) => {
      setNotice(null);
      setLastJob({
        id: response.jobId,
        tenantId: '',
        jobType: 'CAPACITY_PLAN_RECALCULATE',
        status: 'PENDING',
        attempts: 0,
        enqueuedAt: new Date().toISOString(),
      });
      setJobId(response.jobId);
    },
  });

  // The planning job endpoint reads any job of the tenant by id; a capacity
  // recalculation is one, so the forecast screen's poll serves here too.
  const jobQuery = useQuery({
    queryKey: ['planning', 'forecast-job', jobId],
    queryFn: () => api.planning.getForecastJob(jobId as string),
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'SUCCEEDED' || status === 'FAILED' ? false : 1500;
    },
  });
  useEffect(() => {
    if (jobQuery.data) setLastJob(jobQuery.data);
    if (jobQuery.data?.status === 'SUCCEEDED' || jobQuery.data?.status === 'FAILED') {
      setJobId(null);
      if (jobQuery.data.status === 'SUCCEEDED') {
        void queryClient.invalidateQueries({ queryKey: ['planning', 'capacity-current'] });
      }
    }
  }, [jobQuery.data, queryClient]);

  const productName = (productId?: string) => {
    if (!productId) return 'Seluruh product';
    const product = productsQuery.data?.find((p) => p.id === productId);
    return product ? `${product.sku} — ${product.name}` : productId;
  };

  const plan = currentQuery.data?.plan;
  const lines = currentQuery.data?.lines ?? [];

  const totals = lines.reduce(
    (acc, line) => ({
      total: acc.total + line.totalCapacity,
      planning: acc.planning + line.planningCapacity,
      buffer: acc.buffer + line.capacityBuffer,
      demand: acc.demand + line.demandQuantity,
      gap: acc.gap + line.capacityGap,
    }),
    { total: 0, planning: 0, buffer: 0, demand: 0, gap: 0 }
  );

  const uncomputed = lines.flatMap((line) =>
    (line.uncomputedMachines ?? []).map((machine) => ({ ...machine, productId: line.productId }))
  );

  const utilization = totals.total > 0 ? totals.demand / totals.total : 0;

  return (
    <Page>
      <Section>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
              Capacity Planning
            </h1>
            <p style={{ margin: `var(--space-1) 0 0`, fontSize: '13px', color: 'var(--color-on-surface-variant)' }}>
              Kapasitas diturunkan dari shift, mesin yang compatible, dan ideal cycle time — bukan
              angka yang diketik.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-end' }}>
            <DateField
              label="Periode mulai"
              type="date"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
            />
            <DateField
              label="Periode selesai"
              type="date"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
            />
            <Button variant="filled" onClick={() => compute.mutate()} disabled={compute.isPending}>
              {compute.isPending ? 'Menghitung…' : 'Hitung Kapasitas'}
            </Button>
            {plan && (
              <Button
                variant="outlined"
                onClick={() => recalculate.mutate(plan.id)}
                disabled={recalculate.isPending || Boolean(jobId)}
              >
                {jobId ? 'Menghitung…' : 'Rekalkulasi'}
              </Button>
            )}
          </div>
        </div>
        {lastJob && (
          <div style={{ marginTop: 'var(--space-3)' }}>
            <JobProgress
              status={lastJob.status}
              label="Rekalkulasi capacity plan"
              startedAt={lastJob.enqueuedAt}
              detail={
                lastJob.status === 'FAILED'
                  ? `Rekalkulasi gagal: ${lastJob.lastError ?? 'penyebab tidak diketahui'}`
                  : lastJob.status === 'SUCCEEDED'
                    ? 'Snapshot baru sudah tersedia; angka snapshot lama tidak diubah.'
                    : 'Rekalkulasi berjalan sebagai job di worker; halaman ini memantau statusnya.'
              }
            />
          </div>
        )}
        {notice && (
          <p style={{ margin: `var(--space-3) 0 0`, fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
            {notice}
          </p>
        )}
      </Section>

      {currentQuery.isError && (
        <Section>
          <ErrorState
            title="Gagal memuat capacity plan"
            description="Periksa koneksi ke API lalu coba lagi."
            onRetry={() => void currentQuery.refetch()}
          />
        </Section>
      )}

      {!currentQuery.isLoading && !plan && (
        <Section>
          <EmptyState
            icon="factory"
            title="Kapasitas periode ini belum dihitung"
            description="Hitung kapasitas untuk melihat Total Capacity, Planning Capacity, Buffer, Utilization, dan Gap."
            actionLabel="Hitung Kapasitas"
            onAction={() => compute.mutate()}
          />
        </Section>
      )}

      {plan && (
        <>
          <Section stagger>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: 'var(--space-4)',
              }}
            >
              <MetricCard
                label="Total Capacity"
                value={totals.total.toLocaleString('id-ID')}
                subValue="Σ (waktu tersedia mesin ÷ ideal cycle time)"
              />
              <MetricCard
                label="Planning Capacity"
                value={totals.planning.toLocaleString('id-ID')}
                subValue={`Total × ${plan.planningUtilizationPct}%`}
                tone="info"
              />
              <MetricCard
                label="Capacity Buffer"
                value={totals.buffer.toLocaleString('id-ID')}
                subValue="Total − Planning Capacity"
              />
              <MetricCard
                label="Capacity Utilization"
                value={`${(utilization * 100).toFixed(1)}%`}
                subValue={`Demand ${totals.demand.toLocaleString('id-ID')} ÷ Total ${totals.total.toLocaleString('id-ID')}`}
                tone={utilization > 1 ? 'error' : utilization > 0.8 ? 'warning' : 'success'}
              />
              <MetricCard
                label="Capacity Gap"
                value={totals.gap.toLocaleString('id-ID')}
                subValue="max(Demand − Total Capacity, 0)"
                tone={totals.gap > 0 ? 'error' : 'success'}
              />
            </div>
          </Section>

          <Section>
            <SurfaceCard padding="md">
              <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
                Snapshot <strong>{plan.planNumber}</strong> · periode {plan.periodStart} →{' '}
                {plan.periodEnd} · utilization {plan.planningUtilizationPct}%
                {configQuery.data &&
                  configQuery.data.planningUtilizationPct !== plan.planningUtilizationPct && (
                    <>
                      {' '}
                      · kebijakan tenant saat ini {configQuery.data.planningUtilizationPct}%, snapshot
                      ini menyimpan nilai yang berlaku ketika dihitung
                    </>
                  )}
              </div>
            </SurfaceCard>
          </Section>

          {uncomputed.length > 0 && (
            <Section>
              <SurfaceCard padding="lg" railTone="warning">
                <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
                  <Icon name="report" size={18} />
                  <h2 style={{ margin: 0, fontSize: '14px', fontWeight: 700 }}>
                    Kapasitas belum terhitung ({uncomputed.length} mesin)
                  </h2>
                </div>
                <p
                  style={{
                    margin: `0 0 var(--space-3)`,
                    fontSize: '12px',
                    color: 'var(--color-on-surface-variant)',
                  }}
                >
                  Mesin berikut tidak ikut dihitung dan <strong>tidak</strong> dianggap berkapasitas
                  nol. Lengkapi master data agar kapasitas mencerminkan kemampuan pabrik.
                </p>
                <ul style={{ margin: 0, paddingLeft: 'var(--space-5)', fontSize: '12px' }}>
                  {uncomputed.map((machine, index) => (
                    <li key={`${machine.machineId}-${index}`} style={{ marginBottom: 'var(--space-1)' }}>
                      {machine.message} <em>({productName(machine.productId)})</em>
                    </li>
                  ))}
                </ul>
              </SurfaceCard>
            </Section>
          )}

          <Section>
            <SurfaceCard padding="lg">
              <h2 style={{ margin: `0 0 var(--space-3)`, fontSize: '15px', fontWeight: 700 }}>Kapasitas per Product</h2>
              <div style={{ overflowX: 'auto' }}>
                <table className="fv-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Demand</th>
                      <th>Total</th>
                      <th>Planning</th>
                      <th>Buffer</th>
                      <th>Utilization</th>
                      <th>Gap</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line) => (
                      <tr key={line.id}>
                        <td>{productName(line.productId)}</td>
                        <td>{line.demandQuantity.toLocaleString('id-ID')}</td>
                        <td>{line.totalCapacity.toLocaleString('id-ID')}</td>
                        <td>
                          {line.planningCapacity.toLocaleString('id-ID')}
                        </td>
                        <td>{line.capacityBuffer.toLocaleString('id-ID')}</td>
                        <td>
                          {(line.capacityUtilization * 100).toFixed(1)}%
                        </td>
                        <td
                          style={{
                            fontWeight: line.capacityGap > 0 ? 700 : 400,
                            color: line.capacityGap > 0 ? 'var(--color-error)' : undefined,
                          }}
                        >
                          {line.capacityGap.toLocaleString('id-ID')}
                        </td>
                        <td>
                          <CapacityBadge status={line.capacityStatus} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p
                style={{
                  margin: `var(--space-3) 0 0`,
                  fontSize: '11px',
                  color: 'var(--color-on-surface-variant)',
                }}
              >
                Within Plan: demand ≤ Planning Capacity · Additional Demand: masih tertampung buffer ·
                Capacity Up Required: demand melebihi Total Capacity. Status ditentukan sistem.
              </p>
            </SurfaceCard>
          </Section>
        </>
      )}
    </Page>
  );
};
