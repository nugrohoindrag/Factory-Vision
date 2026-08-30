import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { FactoryVisionApiClient } from '@factory-vision/api-client';
import { Icon, HorizontalBarChart } from '@factory-vision/ui';
import { MetricCard, SurfaceCard, Page, Section } from '@factory-vision/ui/fv';

const api = new FactoryVisionApiClient({ baseUrl: '' });

const INTENSITY = {
  idle: { bg: 'var(--color-surface-container)', fg: 'var(--color-on-surface-variant)' },
  low: { bg: 'var(--color-warning-container)', fg: 'var(--color-on-warning-container)' },
  mid: { bg: 'var(--color-warning)', fg: 'var(--color-on-warning)' },
  high: { bg: 'var(--color-error)', fg: 'var(--color-on-error)' },
} as const;

const intensity = (minutes: number) =>
  minutes === 0 ? INTENSITY.idle : minutes < 20 ? INTENSITY.low : minutes < 40 ? INTENSITY.mid : INTENSITY.high;

export const DowntimeAnalyticsPage: React.FC = () => {
  const { data: paretoData, isLoading } = useQuery({
    queryKey: ['downtime-pareto'],
    queryFn: () => api.analytics.getDowntimePareto(),
    refetchInterval: 5000,
  });

  const totalDowntimeMinutes = paretoData?.reduce((acc, item) => acc + item.totalDurationMinutes, 0) || 0;
  const totalOccurrences = paretoData?.reduce((acc, item) => acc + item.occurrenceCount, 0) || 0;
  const topReason = paretoData?.[0]?.reasonName || 'None';

  // Format data for HorizontalBarChart
  const barChartData = (paretoData || []).map((item) => ({
    label: `${item.reasonName} [${item.category}]`,
    value: item.percentageOfTotal,
    formattedValue: `${item.totalDurationMinutes} Mins (${item.percentageOfTotal}%)`,
  }));

  // Heatmap activity matrix (7 days x 6 shift hour buckets)
  const heatmapData = [
    { day: 'Mon', hours: [0, 15, 45, 10, 0, 30] },
    { day: 'Tue', hours: [20, 0, 10, 60, 15, 0] },
    { day: 'Wed', hours: [0, 0, 25, 10, 0, 40] },
    { day: 'Thu', hours: [10, 30, 0, 15, 45, 10] },
    { day: 'Fri', hours: [40, 10, 20, 0, 30, 0] },
    { day: 'Sat', hours: [0, 0, 50, 20, 10, 0] },
    { day: 'Sun', hours: [0, 0, 0, 0, 0, 0] },
  ];

  return (
    <Page style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Header */}
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
          Pareto Alasan Downtime
        </h1>
        <p style={{ margin: '4px 0 0', color: 'var(--color-on-surface-variant)', fontSize: '12px' }}>
          Prioritas akar masalah dan kehilangan kapasitas produksi
        </p>
      </Section>

      {/* KPI Filled Cards */}
      <Section
        stagger
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}
      >
        <MetricCard
          label="Downtime"
          value={`${totalDowntimeMinutes} Mins`}
          delta="Shift 1 Operations"
          deltaType={totalDowntimeMinutes > 60 ? 'negative' : 'positive'}
          tone="warning"
          sparklineData={[15, 20, 10, 35, 25, 40, totalDowntimeMinutes]}
          icon={<Icon name="timer" size={18} />}
        />

        <MetricCard
          label="Jumlah Kejadian Downtime"
          value={`${totalOccurrences} Events`}
          delta="Total machine stoppages"
          deltaType="neutral"
          tone="info"
          sparklineData={[1, 2, 1, 3, 2, 4, totalOccurrences]}
          icon={<Icon name="warning" size={18} />}
        />

        <MetricCard
          label="Alasan Downtime Teratas"
          value={topReason}
          delta={`${paretoData?.[0]?.percentageOfTotal || 0}% total duration`}
          deltaType="negative"
          tone="error"
          sparklineData={[80, 75, 70, 65, 60, 55, 50]}
          icon={<Icon name="crisis_alert" size={18} />}
        />
      </Section>

      {/* Visual Analytics Grid */}
      <Section stagger style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '14px' }}>
        {/* Horizontal Pareto Chart */}
        <div>
          <HorizontalBarChart
            title="Peringkat Pareto Alasan Downtime"
            subtitle="Fokuskan perbaikan pada sedikit alasan yang menyumbang sebagian besar Downtime"
            data={barChartData}
            maxValue={Math.max(...(paretoData || []).map((d) => d.percentageOfTotal), 50)}
          />
        </div>

        {/* Heatmap Grid Analysis */}
        <SurfaceCard padding="md">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '12px',
            }}
          >
            <div>
              <span style={{ fontSize: '14px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
                Intensitas Downtime per Mesin
              </span>
              <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                Pola intensitas Downtime 7 hari per blok 2 jam
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {heatmapData.map((row, rIdx) => (
              <div
                key={rIdx}
                style={{ display: 'grid', gridTemplateColumns: '50px 1fr', alignItems: 'center', gap: '6px' }}
              >
                <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-on-surface-variant)' }}>
                  {row.day}
                </span>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '4px' }}>
                  {row.hours.map((val, hIdx) => {
                    const step = intensity(val);
                    return (
                      <div
                        key={hIdx}
                        title={`${row.day} Block ${hIdx + 1}: ${val} mins`}
                        style={{
                          height: '22px',
                          borderRadius: 'var(--radius-xs, 4px)',
                          backgroundColor: step.bg,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '10px',
                          fontWeight: 700,
                          color: step.fg,
                        }}
                      >
                        {val > 0 ? `${val}m` : '-'}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '10px',
              marginTop: '12px',
              fontSize: '10px',
              color: 'var(--color-on-surface-variant)',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span
                style={{ width: '8px', height: '8px', backgroundColor: INTENSITY.idle.bg, borderRadius: '2px' }}
              />{' '}
              0 min
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span
                style={{ width: '8px', height: '8px', backgroundColor: INTENSITY.low.bg, borderRadius: '2px' }}
              />{' '}
              &lt;20 min
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span
                style={{ width: '8px', height: '8px', backgroundColor: INTENSITY.high.bg, borderRadius: '2px' }}
              />{' '}
              &gt;40 min
            </span>
          </div>
        </SurfaceCard>
      </Section>
    </Page>
  );
};
