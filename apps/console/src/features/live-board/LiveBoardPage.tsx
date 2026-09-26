import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { FactoryVisionApiClient } from '@factory-vision/api-client';
import { StatusBadge, Icon } from '@factory-vision/ui';
import {
  MetricCard,
  SurfaceCard,
  Page,
  Section,
  toneColor,
  toneContainer,
  toneOnContainer,
  type Tone,
  FilterChip,
  Gauge,
} from '@factory-vision/ui/fv';
import { WorkOrderStatus, statusLabel } from '@factory-vision/domain-types';

const api = new FactoryVisionApiClient({ baseUrl: '' });

export const LiveBoardPage: React.FC = () => {
  const [selectedArea, setSelectedArea] = useState<string>('ALL');

  const { data: liveBoard, isLoading } = useQuery({
    queryKey: ['live-board'],
    queryFn: () => api.analytics.getLiveProductionBoard(),
    refetchInterval: 3000,
  });
  // The board carries ids only; names come from the master data other screens
  // already cache under the same keys.
  const { data: lines = [] } = useQuery({ queryKey: ['lines'], queryFn: () => api.master.getLines() });
  const { data: machines = [] } = useQuery({ queryKey: ['machines'], queryFn: () => api.master.getMachines() });

  const filteredBoard = (liveBoard || []).filter((item) => {
    if (selectedArea === 'ALL') return true;
    return item.lineId.toUpperCase().includes(selectedArea);
  });

  const totalLines = liveBoard?.length || 0;
  const runningLines =
    liveBoard?.filter((l) => l.workOrder.status === WorkOrderStatus.IN_PRODUCTION && !l.hasActiveDowntime)
      .length || 0;
  const downtimeLines = liveBoard?.filter((l) => l.hasActiveDowntime).length || 0;

  return (
    <Page>
      <Section style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
            Live Shop Floor Board (Andon Telemetry)
          </h1>
          <p style={{ margin: `var(--space-1) 0 0`, color: 'var(--color-on-surface-variant)', fontSize: '12px' }}>
            Real-time machine status and assembly line telemetry monitoring
          </p>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          <StatusBadge status="online" label="Socket Stream Active" />
        </div>
      </Section>

      <Section
        stagger
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-3)' }}
      >
        <MetricCard
          label="Total Monitored Lines"
          value={`${totalLines} Lines`}
          delta="Cikarang Plant 01"
          deltaType="neutral"
          tone="info"
          icon={<Icon name="precision_manufacturing" size={18} />}
        />

        <MetricCard
          label="Operating Normally"
          value={`${runningLines} Lines`}
          delta="No stop alarms"
          deltaType="positive"
          tone="success"
          icon={<Icon name="check_circle" size={18} />}
        />

        <MetricCard
          label="Active Downtime"
          value={`${downtimeLines} Machines`}
          delta={downtimeLines > 0 ? 'Requires tech dispatch' : 'Optimal condition'}
          deltaType={downtimeLines > 0 ? 'negative' : 'positive'}
          tone="error"
          icon={<Icon name="warning" size={18} />}
        />
      </Section>

      <Section style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
        <span
          style={{
            fontSize: '11px',
            fontWeight: 700,
            color: 'var(--color-on-surface-variant)',
            marginRight: 'var(--space-1)',
          }}
        >
          Filter Area:
        </span>
        {['ALL', '01', '02', '03'].map((area) => (
          <FilterChip key={area} selected={selectedArea === area} onClick={() => setSelectedArea(area)}>
            {area === 'ALL' ? 'All Lines' : `Line ${area}`}
          </FilterChip>
        ))}
      </Section>

      <Section
        stagger
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'var(--space-4)' }}
      >
        {isLoading ? (
          <div style={{ color: 'var(--color-on-surface-variant)', fontSize: '13px' }}>
            Loading live shop floor telemetry, ...
          </div>
        ) : (
          filteredBoard.map((item) => {
            const isDowntime = item.hasActiveDowntime;
            const isLowOee = item.oee < 50;
            const isNormal = item.workOrder.status === WorkOrderStatus.IN_PRODUCTION && !isLowOee && !isDowntime;

            // The line's state picks a semantic tone, never a colour. Tone
            // rides the rail, the strokes, the gauge and the figures; the
            // status pill uses the solid container/on-container pair.
            const tone: Tone = isDowntime ? 'error' : isLowOee ? 'warning' : isNormal ? 'success' : 'primary';

            const accentColor = toneColor[tone];

            const line = lines.find((l) => l.id === item.lineId);
            const machine = machines.find((m) => m.id === item.workOrder.machineId);

            return (
              <SurfaceCard key={item.workOrder.id} padding="md" railTone={tone}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: 'var(--space-2)',
                    marginBottom: 'var(--space-3)',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                      <h2 style={{ fontSize: '13px', fontWeight: 700, margin: 0, color: 'var(--color-on-surface)' }}>
                        {line?.name ?? item.lineId}
                      </h2>
                      {isNormal && (
                        <motion.span
                          animate={{ scale: [1, 1.4, 1], opacity: [0.8, 1, 0.8] }}
                          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                          style={{
                            width: '6px',
                            height: '6px',
                            borderRadius: '50%',
                            backgroundColor: toneColor.success,
                            display: 'inline-block',
                            flexShrink: 0,
                          }}
                        />
                      )}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)', marginTop: '2px' }}>
                      {machine
                        ? `${machine.code} · ${machine.name}`
                        : item.workOrder.machineId || 'Mesin belum ditetapkan'}
                    </div>
                  </div>

                  <span
                    style={{
                      padding: `2px var(--space-2)`,
                      borderRadius: 'var(--radius-pill)',
                      fontSize: '10px',
                      fontWeight: 800,
                      letterSpacing: '0.03em',
                      whiteSpace: 'nowrap',
                      backgroundColor: toneContainer[tone],
                      color: toneOnContainer[tone],
                    }}
                  >
                    {isDowntime ? 'Downtime' : statusLabel(item.workOrder.status)}
                  </span>
                </div>

                <div
                  style={{ display: 'grid', gridTemplateColumns: '96px 1fr', gap: 'var(--space-4)', alignItems: 'center' }}
                >
                  <Gauge value={item.oee} title="" subtitle="OEE" size={96} strokeWidth={9} color={accentColor} />

                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '10.5px', color: 'var(--color-on-surface-variant)' }}>Work Order</div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-on-surface)' }}>
                      {item.workOrder.woNumber}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '11px',
                        margin: `var(--space-2) 0 var(--space-1)`,
                        color: 'var(--color-on-surface-variant)',
                        fontFeatureSettings: '"tnum" 1',
                      }}
                    >
                      <span>
                        {item.workOrder.outputQuantity.toLocaleString('id-ID')} /{' '}
                        {item.workOrder.plannedQuantity.toLocaleString('id-ID')}
                      </span>
                      <strong style={{ color: 'var(--color-on-surface)' }}>{item.achievementPct}%</strong>
                    </div>
                    <div
                      style={{
                        height: '6px',
                        borderRadius: 'var(--radius-pill)',
                        backgroundColor: 'var(--color-surface-container-high)',
                        overflow: 'hidden',
                      }}
                    >
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min(100, item.achievementPct)}%` }}
                        transition={{ duration: 0.8, ease: 'easeOut' }}
                        style={{
                          height: '100%',
                          backgroundColor: item.achievementPct >= 80 ? toneColor.success : toneColor.warning,
                          borderRadius: 'var(--radius-pill)',
                        }}
                      />
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    marginTop: 'var(--space-3)',
                    paddingTop: 'var(--space-3)',
                    borderTop: '1px solid var(--color-border)',
                  }}
                >
                  {[
                    { label: 'Availability', value: item.availability, color: 'var(--color-on-surface)' },
                    { label: 'Performance', value: item.performance, color: 'var(--color-on-surface)' },
                    {
                      label: 'Quality',
                      value: item.quality,
                      color: item.quality >= 98 ? 'var(--color-on-surface)' : toneColor.error,
                    },
                  ].map((figure) => (
                    <div key={figure.label}>
                      <div style={{ fontSize: '10.5px', color: 'var(--color-on-surface-variant)' }}>{figure.label}</div>
                      <div
                        style={{
                          fontSize: '14px',
                          fontWeight: 700,
                          color: figure.color,
                          fontFeatureSettings: '"tnum" 1',
                        }}
                      >
                        {figure.value}%
                      </div>
                    </div>
                  ))}
                </div>
              </SurfaceCard>
            );
          })
        )}
      </Section>
    </Page>
  );
};
