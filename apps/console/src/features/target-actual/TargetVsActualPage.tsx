import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FactoryVisionApiClient } from '@factory-vision/api-client';
import type { KpiStatus, TargetVsActualDimension } from '@factory-vision/domain-types';
import { Button, Icon } from '@factory-vision/ui';
import { MetricCard, SurfaceCard, Page, Section, FilterChip } from '@factory-vision/ui/fv';

const api = new FactoryVisionApiClient({ baseUrl: '' });

const DIMENSIONS: Array<{ key: TargetVsActualDimension; label: string }> = [
  { key: 'LINE', label: 'Per Line' },
  { key: 'PROCESS', label: 'Per Proses' },
  { key: 'PRODUCT', label: 'Per Produk' },
  { key: 'SHIFT', label: 'Per Shift' },
  { key: 'DATE', label: 'Per Tanggal' },
];

const WINDOWS = [7, 14, 30] as const;

const STATUS_COLOR: Record<KpiStatus, string> = {
  GOOD: 'var(--color-success)',
  WATCH: 'var(--color-warning)',
  CRITICAL: 'var(--color-error)',
};

const STATUS_LABEL: Record<KpiStatus, string> = {
  GOOD: 'Tercapai',
  WATCH: 'Waspada',
  CRITICAL: 'Kritis',
};

const number = (value: number) => value.toLocaleString('id-ID');

/**
 * US-025, Compare Target vs Actual.
 *
 * Target, actual, variance and achievement sit on one row per dimension so a
 * gap can be found without arithmetic, and each row links into the drill-down
 * that explains it, a shortfall is only actionable once you know which
 * machine or which day caused it.
 */
export const TargetVsActualPage: React.FC = () => {
  const navigate = useNavigate();
  const [dimension, setDimension] = useState<TargetVsActualDimension>('LINE');
  const [days, setDays] = useState<number>(7);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['target-vs-actual', dimension, days],
    queryFn: () => api.oee.targetVsActual({ dimension, days }),
  });

  const rows = data?.rows ?? [];
  const maxValue = Math.max(1, ...rows.map((row) => Math.max(row.targetQuantity, row.actualQuantity)));

  /** Where a row leads when you want to know why it missed. */
  const drillDown = (key: string) => {
    switch (dimension) {
      case 'LINE':
        return `/oee?lineId=${encodeURIComponent(key)}`;
      case 'PROCESS':
        return `/oee?processId=${encodeURIComponent(key)}`;
      default:
        return '/oee';
    }
  };

  return (
    <Page style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <Section>
        <h1
          style={{
            fontSize: '22px',
            fontWeight: 800,
            margin: 0,
            color: 'var(--color-on-surface)',
            letterSpacing: '-0.02em',
          }}
        >
          Target vs Produksi Aktual
        </h1>
        <p style={{ margin: '4px 0 0', color: 'var(--color-on-surface-variant)', fontSize: '12px' }}>
          Perbandingan Target Produksi dan Produksi Aktual beserta variance dan proyeksi
        </p>
      </Section>

      <Section style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {DIMENSIONS.map((option) => (
            <FilterChip
              key={option.key}
              selected={dimension === option.key}
              onClick={() => setDimension(option.key)}
            >
              {option.label}
            </FilterChip>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          {WINDOWS.map((option) => (
            <FilterChip key={option} selected={days === option} onClick={() => setDays(option)}>
              {option} hari
            </FilterChip>
          ))}
        </div>
      </Section>

      <Section
        stagger
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}
      >
        <MetricCard
          label="Total Target Produksi"
          value={number(data?.totalTarget ?? 0)}
          delta={`Periode ${days} hari`}
          deltaType="neutral"
          tone="info"
          icon={<Icon name="flag" size={18} />}
        />
        <MetricCard
          label="Total Produksi Aktual"
          value={number(data?.totalActual ?? 0)}
          delta="Good quantity tercatat"
          deltaType={(data?.totalVariance ?? 0) >= 0 ? 'positive' : 'negative'}
          tone="primary"
          icon={<Icon name="inventory" size={18} />}
        />
        <MetricCard
          label="Variance"
          value={`${(data?.totalVariance ?? 0) >= 0 ? '+' : ''}${number(data?.totalVariance ?? 0)}`}
          delta={(data?.totalVariance ?? 0) >= 0 ? 'Di atas rencana' : 'Di bawah rencana'}
          deltaType={(data?.totalVariance ?? 0) >= 0 ? 'positive' : 'negative'}
          tone={(data?.totalVariance ?? 0) >= 0 ? 'success' : 'error'}
          icon={<Icon name="compare_arrows" size={18} />}
        />
        <MetricCard
          label="Pencapaian"
          value={`${(data?.achievementPct ?? 0).toFixed(1)}%`}
          delta={data ? STATUS_LABEL[data.status] : ''}
          deltaType={(data?.achievementPct ?? 0) >= 95 ? 'positive' : 'negative'}
          tone="warning"
          icon={<Icon name="percent" size={18} />}
        />
      </Section>

      <Section>
        <SurfaceCard padding="md">
          <div style={{ marginBottom: '12px' }}>
            <span style={{ fontSize: '14px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
              Rincian {DIMENSIONS.find((d) => d.key === dimension)?.label}
            </span>
            <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
              Diurutkan dari pencapaian terendah, yang paling tertinggal muncul lebih dulu
            </div>
          </div>

          {isLoading ? (
            <Placeholder label="Memuat data…" />
          ) : isError ? (
            <Placeholder label={error instanceof Error ? error.message : 'Gagal memuat data.'} tone="error" />
          ) : rows.length === 0 ? (
            <Placeholder label="Belum ada data produksi pada periode ini." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {rows.map((row) => {
                const drillable = dimension === 'LINE' || dimension === 'PROCESS';
                return (
                  <div
                    key={row.key}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.6fr) auto',
                      gap: '14px',
                      alignItems: 'center',
                      padding: '12px 14px',
                      borderRadius: 'var(--radius-sm, 8px)',
                      border: '1px solid var(--color-outline-variant)',
                      backgroundColor: 'var(--color-surface)',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
                        {row.label}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                        {number(row.rejectQuantity)} reject dicatat
                      </div>
                    </div>

                    {/* Target as the track, actual as the fill: the shortfall is
 the gap you can see rather than a number to subtract. */}
                    <div>
                      <div
                        style={{
                          position: 'relative',
                          height: '18px',
                          borderRadius: 'var(--radius-xs, 4px)',
                          backgroundColor: 'var(--color-surface-container-highest)',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            width: `${(row.targetQuantity / maxValue) * 100}%`,
                            height: '100%',
                            backgroundColor: 'var(--color-outline-variant)',
                          }}
                        />
                        <div
                          style={{
                            position: 'absolute',
                            inset: 0,
                            width: `${(row.actualQuantity / maxValue) * 100}%`,
                            height: '100%',
                            backgroundColor: STATUS_COLOR[row.status],
                          }}
                        />
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          fontSize: '11px',
                          color: 'var(--color-on-surface-variant)',
                          marginTop: '4px',
                        }}
                      >
                        <span>
                          Produksi Aktual{' '}
                          <strong style={{ color: 'var(--color-on-surface)' }}>
                            {number(row.actualQuantity)}
                          </strong>{' '}
                          / Target Produksi{' '}
                          <strong style={{ color: 'var(--color-on-surface)' }}>
                            {number(row.targetQuantity)}
                          </strong>
                        </span>
                        {row.forecastQuantity !== null && (
                          <span>
                            Proyeksi akhir periode: {number(row.forecastQuantity)} (
                            {row.forecastAchievementPct?.toFixed(1)}%)
                          </span>
                        )}
                      </div>
                    </div>

                    <div style={{ textAlign: 'right', minWidth: '110px' }}>
                      <div style={{ fontSize: '18px', fontWeight: 800, color: STATUS_COLOR[row.status] }}>
                        {row.achievementPct.toFixed(1)}%
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                        {row.variance >= 0 ? '+' : ''}
                        {number(row.variance)} unit
                      </div>
                      {drillable && (
                        <Button
                          variant="text"
                          size="sm"
                          icon={<Icon name="arrow_forward" size={15} />}
                          iconPosition="end"
                          onClick={() => navigate(drillDown(row.key))}
                          style={{ marginTop: '2px', marginRight: '-12px' }}
                        >
                          Telusuri
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </SurfaceCard>
      </Section>
    </Page>
  );
};

const Placeholder: React.FC<{ label: string; tone?: 'error' }> = ({ label, tone }) => (
  <div
    style={{
      padding: '28px',
      textAlign: 'center',
      fontSize: '12px',
      color: tone === 'error' ? 'var(--color-error)' : 'var(--color-on-surface-variant)',
    }}
  >
    {label}
  </div>
);
