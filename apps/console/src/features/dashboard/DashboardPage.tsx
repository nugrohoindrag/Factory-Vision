import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { FactoryVisionApiClient } from '@factory-vision/api-client';
import { Button, Icon } from '@factory-vision/ui';
import { PlantOverviewHero, Page, Section, FilterChip } from '@factory-vision/ui/fv';
import { SectionHeading } from './components/SectionHeading.js';
import { ExecutiveKpiGrid } from './components/ExecutiveKpiGrid.js';
import { ProductionPerformanceCard } from './components/ProductionPerformanceCard.js';
import { OeePerformanceCard } from './components/OeePerformanceCard.js';
import { LinePerformanceTable } from './components/LinePerformanceTable.js';
import { ProcessPerformanceTable } from './components/ProcessPerformanceTable.js';
import { DowntimeAnalysisCard } from './components/DowntimeAnalysisCard.js';
import { QualityPerformanceCard } from './components/QualityPerformanceCard.js';
import { OrderStatusCard } from './components/OrderStatusCard.js';
import { OperationalAlertsCard } from './components/OperationalAlertsCard.js';

const api = new FactoryVisionApiClient({ baseUrl: '' });

/**
 * Period options. `days` is what every analytics endpoint is scoped by, so the
 * whole page moves together when the selection changes.
 *
 * "Current Shift" maps to a single day: the API's grain is the shift date, so a
 * narrower window than that would not change the answer.
 */
const PERIODS = [
  { label: 'Current Shift', days: 1 },
  { label: 'Today', days: 1 },
  { label: 'Last 7 Days', days: 7 },
  { label: 'Last 30 Days', days: 30 },
] as const;

/**
 * Executive Dashboard
 *
 * The page follows the information architecture top to bottom:
 * Executive KPI → Production Performance → OEE → Plant/Line → Downtime →
 * Quality → Order Status → Alerts. Every figure is served by
 * `/api/v1/analytics/*`; nothing on this page is computed from an assumed
 * split or a placeholder series ( forbids presenting invented numbers as
 * decision input, and requires the dashboard to reconcile with the
 * transaction data behind it).
 */
export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const [periodLabel, setPeriodLabel] = useState<string>('Last 7 Days');
  const days = PERIODS.find((p) => p.label === periodLabel)?.days ?? 7;

  const scoped = { days };

  const { data: kpis, isLoading: kpisLoading } = useQuery({
    queryKey: ['executive-kpi', days],
    queryFn: () => api.analytics.getExecutiveKpi(scoped),
    refetchInterval: 30_000,
  });

  const { data: daily } = useQuery({
    queryKey: ['daily-performance', days],
    queryFn: () => api.analytics.getDailyPerformance(scoped),
  });

  const { data: productionTrend, isLoading: productionLoading } = useQuery({
    queryKey: ['production-trend', days],
    queryFn: () => api.analytics.getProductionTrend(scoped),
  });

  const { data: oeeTrend, isLoading: oeeLoading } = useQuery({
    queryKey: ['oee-trend', days],
    queryFn: () => api.analytics.getOeeTrend(scoped),
  });

  const { data: lines, isLoading: linesLoading } = useQuery({
    queryKey: ['line-performance', days],
    queryFn: () => api.analytics.getLinePerformance(scoped),
    refetchInterval: 30_000,
  });

  const { data: plants } = useQuery({
    queryKey: ['plant-performance', days],
    queryFn: () => api.analytics.getPlantPerformance(scoped),
  });

  const { data: downtime, isLoading: downtimeLoading } = useQuery({
    queryKey: ['downtime-summary', days],
    queryFn: () => api.analytics.getDowntimeSummary(scoped),
  });

  const { data: quality, isLoading: qualityLoading } = useQuery({
    queryKey: ['quality-summary', days],
    queryFn: () => api.analytics.getQualitySummary(scoped),
  });

  const { data: orders, isLoading: ordersLoading } = useQuery({
    queryKey: ['order-status'],
    queryFn: () => api.analytics.getOrderStatus(),
    refetchInterval: 60_000,
  });

  const { data: alerts, isLoading: alertsLoading } = useQuery({
    queryKey: ['operational-alerts', days],
    queryFn: () => api.analytics.getAlerts(scoped),
    refetchInterval: 30_000,
  });

  const { data: processPerformance, isLoading: processLoading } = useQuery({
    queryKey: ['process-performance', days],
    queryFn: () => api.analytics.getProcessPerformance(scoped),
    refetchInterval: 30_000,
  });

  // Hero headline figures come from the same KPI payload as the cards.
  const oeeKpi = kpis?.find((k) => k.metric === 'OEE');
  const outputKpi = kpis?.find((k) => k.metric === 'PRODUCTION_OUTPUT');
  const achievementKpi = kpis?.find((k) => k.metric === 'PRODUCTION_ACHIEVEMENT');
  const targetTotal = productionTrend?.reduce((acc, p) => acc + p.targetQuantity, 0) ?? 0;
  const activeLines = lines?.filter((l) => !l.hasActiveDowntime).length ?? 0;

  const periodFilter = (
    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
      <span
        style={{
          fontSize: '12px',
          fontWeight: 600,
          color: 'var(--color-on-surface-variant)',
          marginRight: '4px',
        }}
      >
        Data Period:
      </span>
      {PERIODS.map((period) => (
        <FilterChip
          key={period.label}
          selected={periodLabel === period.label}
          onClick={() => setPeriodLabel(period.label)}
        >
          {period.label}
        </FilterChip>
      ))}
    </div>
  );

  return (
    <Page style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Period selector & live sync */}
      <Section
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        {periodFilter}

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 12px',
              borderRadius: 'var(--radius-pill)',
              backgroundColor: 'var(--color-surface-container)',
              fontSize: '11px',
              fontWeight: 600,
              color: 'var(--color-primary)',
              border: '1px solid var(--color-border)',
            }}
          >
            <span
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                backgroundColor: 'var(--color-primary)',
                display: 'inline-block',
              }}
            />
            <span>Live Sync 30s</span>
          </div>

          <Button
            variant="tonal"
            size="sm"
            icon={<Icon name="refresh" size={14} />}
            onClick={() => window.location.reload()}
          >
            Refresh
          </Button>
        </div>
      </Section>

      {/* Flagship hero */}
      <PlantOverviewHero
        plantName="Factory Vision, Smart Plant #01 Cikarang"
        activeShift="Shift 1 (Morning) • 07:00 - 15:00 UTC+7"
        oeeScore={oeeKpi ? `${oeeKpi.value}%` : '…'}
        currentOutput={outputKpi ? `${Math.round(outputKpi.value).toLocaleString('en-US')} PCS` : '…'}
        targetOutput={`${targetTotal.toLocaleString('en-US')} Target`}
        completionRate={achievementKpi ? `${achievementKpi.value}% Achieved` : '…'}
        activeLinesCount={`${activeLines} of ${lines?.length ?? 0} Lines Active`}
        onNewWorkOrder={() => navigate('/work-orders')}
        onQualityAudit={() => navigate('/reports')}
        onReportIncident={() => navigate('/downtime-analytics')}
      />

      {/* Executive KPI */}
      <SectionHeading icon="monitoring" title="Executive KPI" question="Bagaimana kondisi produksi saat ini?" />
      <ExecutiveKpiGrid kpis={kpis ?? []} daily={daily ?? []} isLoading={kpisLoading} />

      {/* Production Performance · OEE Performance */}
      <SectionHeading
        icon="insights"
        title="Production & OEE Performance"
        question="Apakah produksi sesuai target, dan seberapa efisien operasinya?"
      />
      <Section
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '11px' }}
      >
        <ProductionPerformanceCard
          trend={productionTrend ?? []}
          plants={plants ?? []}
          isLoading={productionLoading}
        />
        <OeePerformanceCard
          trend={oeeTrend ?? []}
          kpis={kpis ?? []}
          isLoading={oeeLoading}
          onDrillDown={() => navigate('/downtime-analytics')}
        />
      </Section>

      {/* Plant / Line Performance */}
      <SectionHeading
        icon="precision_manufacturing"
        title="Plant / Line Performance"
        question="Di lini atau plant mana masalah terbesar terjadi?"
      />
      <Section>
        <LinePerformanceTable
          lines={lines ?? []}
          plants={plants ?? []}
          isLoading={linesLoading}
          onSelectLine={(lineId) => navigate(`/live-board?lineId=${lineId}`)}
        />
      </Section>

      {/*b Multi-Process Performance Breakdown */}
      <SectionHeading
        icon="hub"
        title="Multi-Process Performance ( &)"
        question="Bagaimana performa OEE terisolasi pada setiap stasiun proses (Mixing, Extrusion, Building, Curing, Inspection)?"
      />
      <Section>
        <ProcessPerformanceTable processes={processPerformance ?? []} isLoading={processLoading} />
      </Section>

      {/* Downtime Analysis · Quality Performance */}
      <SectionHeading
        icon="query_stats"
        title="Loss Analysis"
        question="Apa penyebab utama production loss dan quality loss?"
      />
      <Section
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '11px' }}
      >
        <DowntimeAnalysisCard
          summary={downtime}
          isLoading={downtimeLoading}
          onDrillDown={(reasonId) =>
            navigate(reasonId ? `/downtime-analytics?reasonId=${reasonId}` : '/downtime-analytics')
          }
        />
        <QualityPerformanceCard
          summary={quality}
          isLoading={qualityLoading}
          onDrillDown={(reasonId) =>
            navigate(
              reasonId ? `/reports?tab=production&rejectReasonId=${reasonId}` : '/reports?tab=production'
            )
          }
        />
      </Section>

      {/* Order Status · Operational Alerts */}
      <SectionHeading
        icon="fact_check"
        title="Schedule & Exceptions"
        question="Apakah jadwal aman, dan apa yang butuh perhatian sekarang?"
      />
      <Section
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '11px' }}
      >
        <OrderStatusCard
          summary={orders}
          isLoading={ordersLoading}
          onSelectStatus={(status) => navigate(`/work-orders?tab=PO&status=${status}`)}
          onSelectOrder={(orderId) => navigate(`/work-orders?tab=PO&orderId=${orderId}`)}
        />
        <OperationalAlertsCard
          alerts={alerts ?? []}
          isLoading={alertsLoading}
          onViewDetail={(path) => navigate(path)}
        />
      </Section>
    </Page>
  );
};
