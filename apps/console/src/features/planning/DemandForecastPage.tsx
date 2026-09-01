import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FactoryVisionApiClient } from '@factory-vision/api-client';
import { Button, Icon, Select, FilledTextField, EmptyState, ErrorState } from '@factory-vision/ui';
import { DateField, Page, Section, SurfaceCard, MetricCard, FilterChip } from '@factory-vision/ui/fv';
import {
  DemandForecastStatus,
  DEMAND_FORECAST_STATUS_LABEL,
} from '@factory-vision/domain-types';

const api = new FactoryVisionApiClient({ baseUrl: '' });

/**
 * Demand Forecast (MES-030).
 *
 * The point of this screen is **the numbers behind the number**. A forecast is
 * a historical average and nothing more (ADR-20), so a planner can only judge
 * whether to trust it by seeing the months it averaged — including the empty
 * ones, which count as zero and are shown as zero rather than omitted.
 *
 * `insufficient_history` is marked visually rather than hidden: a product with
 * two months of orders behind a twelve-month lookback still gets a number, and
 * the planner has to know that is what they are looking at.
 */

const LOOKBACKS = [3, 6, 12] as const;

function monthLabel(month: string): string {
  const [year, m] = month.split('-');
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Ags', 'Sep', 'Okt', 'Nov', 'Des'];
  return `${names[Number(m) - 1] ?? m} ${year.slice(2)}`;
}

/**
 * A bar per month, drawn from tokens.
 *
 * Deliberately not a chart library: twelve bars whose only job is to show
 * relative size, in an area where the exact figure is printed beside them
 * anyway.
 */
const MonthlyBars: React.FC<{ demand: Record<string, number> }> = ({ demand }) => {
  const months = Object.keys(demand).sort();
  const max = Math.max(1, ...months.map((m) => demand[m]));

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '6px', height: '64px' }}>
      {months.map((month) => {
        const value = demand[month];
        const height = Math.max(2, Math.round((value / max) * 56));
        return (
          <div key={month} style={{ display: 'grid', justifyItems: 'center', gap: '4px', flex: 1 }}>
            <span style={{ fontSize: '10px', color: 'var(--color-on-surface-variant)' }}>
              {value.toLocaleString('id-ID')}
            </span>
            <div
              title={`${monthLabel(month)}: ${value.toLocaleString('id-ID')}`}
              style={{
                width: '100%',
                height: `${height}px`,
                borderRadius: 'var(--radius-xs)',
                // An empty month still draws a sliver, so "zero" is visible as a
                // measured zero rather than as a missing bar.
                backgroundColor:
                  value > 0 ? 'var(--color-primary)' : 'var(--color-surface-container-highest)',
              }}
            />
            <span style={{ fontSize: '10px', color: 'var(--color-on-surface-variant)' }}>
              {monthLabel(month)}
            </span>
          </div>
        );
      })}
    </div>
  );
};

export const DemandForecastPage: React.FC = () => {
  const queryClient = useQueryClient();

  const now = new Date();
  const firstOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const lastOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

  const [periodStart, setPeriodStart] = useState(firstOfMonth);
  const [periodEnd, setPeriodEnd] = useState(lastOfMonth);
  const [lookback, setLookback] = useState<3 | 6 | 12>(6);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const forecastsQuery = useQuery({
    queryKey: ['planning', 'forecasts'],
    queryFn: () => api.planning.getForecasts(),
  });

  const productsQuery = useQuery({
    queryKey: ['master', 'products'],
    queryFn: () => api.master.getProducts(),
  });

  const detailQuery = useQuery({
    queryKey: ['planning', 'forecast', selectedId],
    queryFn: () => api.planning.getForecast(selectedId as string),
    enabled: Boolean(selectedId),
  });

  const comparisonQuery = useQuery({
    queryKey: ['planning', 'forecast-comparison', selectedId],
    queryFn: () => api.planning.getForecastComparison(selectedId as string),
    enabled: Boolean(selectedId),
  });

  /**
   * Polls the job the generate request enqueued.
   *
   * The computation runs on the worker (MES-027), so the screen watches a job
   * rather than awaiting a response — which is also what keeps a twelve-month
   * aggregation from timing out a browser.
   */
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
    if (jobQuery.data?.status === 'SUCCEEDED') {
      setNotice('Forecast selesai dihitung.');
      setJobId(null);
      void queryClient.invalidateQueries({ queryKey: ['planning', 'forecasts'] });
    }
    if (jobQuery.data?.status === 'FAILED') {
      setNotice(`Perhitungan forecast gagal: ${jobQuery.data.lastError ?? 'penyebab tidak diketahui'}`);
      setJobId(null);
    }
  }, [jobQuery.data?.status, jobQuery.data?.lastError, queryClient]);

  const generate = useMutation({
    mutationFn: () => api.planning.generateForecast({ periodStart, periodEnd, lookbackMonths: lookback }),
    onSuccess: (response) => {
      setJobId(response.jobId);
      setNotice('Perhitungan forecast berjalan sebagai job di worker…');
    },
    onError: (error: unknown) => {
      setNotice(error instanceof Error ? error.message : 'Gagal menjalankan forecast.');
    },
  });

  const forecasts = forecastsQuery.data ?? [];
  const detail = detailQuery.data;

  // Open the newest generated forecast by default, so the screen is never a
  // blank page when there is something to look at.
  useEffect(() => {
    if (!selectedId && forecasts.length > 0) setSelectedId(forecasts[0].id);
  }, [forecasts, selectedId]);

  const productName = (productId: string) => {
    const product = productsQuery.data?.find((p) => p.id === productId);
    return product ? `${product.sku} — ${product.name}` : productId;
  };

  const actualByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of comparisonQuery.data?.rows ?? []) {
      map.set(row.productId, row.actualOrderedQuantity);
    }
    return map;
  }, [comparisonQuery.data]);

  const insufficientCount = (detail?.lines ?? []).filter((l) => l.insufficientHistory).length;

  return (
    <Page>
      <Section>
        <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
          Demand Forecast
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--color-on-surface-variant)' }}>
          Rata-rata historis dari Customer Order. Bulan berjalan tidak dihitung, bulan tanpa order
          dihitung sebagai nol, dan order Cancelled tidak ikut.
        </p>
      </Section>

      <Section>
        <SurfaceCard padding="md">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr)) auto',
              gap: '12px',
              alignItems: 'end',
            }}
          >
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
            <div>
              <div
                style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)', marginBottom: '6px' }}
              >
                Lookback
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                {LOOKBACKS.map((months) => (
                  <FilterChip
                    key={months}
                    selected={lookback === months}
                    onClick={() => setLookback(months)}
                  >
                    {months} bulan
                  </FilterChip>
                ))}
              </div>
            </div>
            <Button
              variant="filled"
              onClick={() => generate.mutate()}
              disabled={generate.isPending || Boolean(jobId)}
            >
              {jobId ? 'Menghitung…' : 'Hasilkan Forecast'}
            </Button>
          </div>
          {notice && (
            <p style={{ margin: '12px 0 0', fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
              {notice}
            </p>
          )}
        </SurfaceCard>
      </Section>

      {forecastsQuery.isError && (
        <Section>
          <ErrorState
            title="Gagal memuat forecast"
            description="Periksa koneksi ke API lalu coba lagi."
            onRetry={() => void forecastsQuery.refetch()}
          />
        </Section>
      )}

      {!forecastsQuery.isLoading && forecasts.length === 0 && (
        <Section>
          <EmptyState
            icon="query_stats"
            title="Belum ada forecast"
            description="Pilih periode dan lookback, lalu jalankan perhitungan. Hasilnya tersimpan sebagai snapshot yang dapat ditelusuri dari Production Plan."
            actionLabel="Hasilkan Forecast"
            onAction={() => generate.mutate()}
          />
        </Section>
      )}

      {forecasts.length > 0 && (
        <Section>
          <SurfaceCard padding="md">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {forecasts.map((forecast) => (
                <FilterChip
                  key={forecast.id}
                  selected={selectedId === forecast.id}
                  onClick={() => setSelectedId(forecast.id)}
                >
                  {forecast.forecastNumber} ·{' '}
                  {DEMAND_FORECAST_STATUS_LABEL[forecast.status] ?? forecast.status}
                </FilterChip>
              ))}
            </div>
          </SurfaceCard>
        </Section>
      )}

      {detail && (
        <>
          <Section stagger>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '16px',
              }}
            >
              <MetricCard
                label="Periode"
                value={`${detail.periodStart} → ${detail.periodEnd}`}
                subValue={`Lookback ${detail.lookbackMonths} bulan`}
              />
              <MetricCard
                label="Product ter-forecast"
                value={String(detail.lines.length)}
                subValue="Baris forecast pada snapshot ini"
              />
              <MetricCard
                label="Histori tidak cukup"
                value={String(insufficientCount)}
                tone={insufficientCount > 0 ? 'warning' : 'success'}
                subValue="Angka tetap dihasilkan, tetapi ditandai"
              />
              <MetricCard
                label="Status snapshot"
                value={DEMAND_FORECAST_STATUS_LABEL[detail.status] ?? detail.status}
                subValue={
                  detail.status === DemandForecastStatus.SUPERSEDED
                    ? 'Digantikan snapshot yang lebih baru; angkanya tidak diubah'
                    : 'Snapshot berlaku'
                }
                tone={detail.status === DemandForecastStatus.SUPERSEDED ? 'neutral' : 'info'}
              />
            </div>
          </Section>

          {detail.usedByPlans.length > 0 && (
            <Section>
              <SurfaceCard padding="md" railTone="info">
                <div style={{ fontSize: '12px', color: 'var(--color-on-surface)' }}>
                  Dipakai oleh Production Plan:{' '}
                  <strong>{detail.usedByPlans.map((p) => p.planNumber).join(', ')}</strong>. Snapshot
                  ini tidak akan berubah walaupun forecast di-generate ulang.
                </div>
              </SurfaceCard>
            </Section>
          )}

          <Section>
            <div style={{ display: 'grid', gap: '16px' }}>
              {detail.lines.map((line) => {
                const actual = actualByProduct.get(line.productId);
                return (
                  <SurfaceCard
                    key={line.id}
                    padding="lg"
                    railTone={line.insufficientHistory ? 'warning' : undefined}
                  >
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        justifyContent: 'space-between',
                        gap: '12px',
                        marginBottom: '12px',
                      }}
                    >
                      <div>
                        <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--color-on-surface)' }}>
                          {productName(line.productId)}
                        </div>
                        {line.insufficientHistory && (
                          <div
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              marginTop: '4px',
                              fontSize: '11px',
                              fontWeight: 700,
                              color: 'var(--color-on-warning-container)',
                              backgroundColor: 'var(--color-warning-container)',
                              padding: '2px 8px',
                              borderRadius: 'var(--radius-pill)',
                            }}
                          >
                            <Icon name="info" size={14} />
                            Histori tidak cukup — hanya {line.monthsWithHistory ?? 0} dari{' '}
                            {detail.lookbackMonths} bulan berisi order
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: '24px' }}>
                        <Figure label="Rata-rata / bulan" value={line.averageDemand.toLocaleString('id-ID')} />
                        <Figure
                          label="Forecast"
                          value={line.forecastQuantity.toLocaleString('id-ID')}
                          strong
                        />
                        <Figure
                          label="Order aktual periode ini"
                          value={actual === undefined ? '—' : actual.toLocaleString('id-ID')}
                        />
                      </div>
                    </div>
                    <MonthlyBars demand={line.historicalDemand} />
                    <p
                      style={{
                        margin: '10px 0 0',
                        fontSize: '11px',
                        color: 'var(--color-on-surface-variant)',
                      }}
                    >
                      Forecast = total {detail.lookbackMonths} bulan di atas ÷ {detail.lookbackMonths}.
                      Bulan berjalan tidak termasuk.
                    </p>
                  </SurfaceCard>
                );
              })}
            </div>
          </Section>
        </>
      )}
    </Page>
  );
};

const Figure: React.FC<{ label: string; value: string; strong?: boolean }> = ({
  label,
  value,
  strong,
}) => (
  <div style={{ textAlign: 'right' }}>
    <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>{label}</div>
    <div
      style={{
        fontSize: strong ? '18px' : '14px',
        fontWeight: strong ? 800 : 600,
        color: strong ? 'var(--color-primary)' : 'var(--color-on-surface)',
      }}
    >
      {value}
    </div>
  </div>
);
