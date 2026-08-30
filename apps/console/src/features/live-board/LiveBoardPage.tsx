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
import { WorkOrderStatus } from '@factory-vision/domain-types';

const api = new FactoryVisionApiClient({ baseUrl: '' });

export const LiveBoardPage: React.FC = () => {
  const [selectedArea, setSelectedArea] = useState<string>('ALL');

  const { data: liveBoard, isLoading } = useQuery({
    queryKey: ['live-board'],
    queryFn: () => api.analytics.getLiveProductionBoard(),
    refetchInterval: 3000,
  });

  const filteredBoard = (liveBoard || []).filter((item) => {
    if (selectedArea === 'ALL') return true;
    return item.lineId.toUpperCase().includes(selectedArea);
  });

  const totalLines = liveBoard?.length || 0;
  const runningLines =
    liveBoard?.filter((l) => l.workOrder.status === WorkOrderStatus.IN_PROGRESS && !l.hasActiveDowntime)
      .length || 0;
  const downtimeLines = liveBoard?.filter((l) => l.hasActiveDowntime).length || 0;

  return (
    <Page style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Header */}
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
          <p style={{ margin: '4px 0 0', color: 'var(--color-on-surface-variant)', fontSize: '12px' }}>
            Real-time machine status and assembly line telemetry monitoring
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <StatusBadge status="online" label="Socket Stream Active" />
        </div>
      </Section>

      {/* Top Status Cards */}
      <Section
        stagger
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}
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

      {/* Filter Chips Bar */}
      <Section style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        <span
          style={{
            fontSize: '11px',
            fontWeight: 700,
            color: 'var(--color-on-surface-variant)',
            marginRight: '4px',
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

      {/* Production Lines Grid */}
      <Section
        stagger
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '14px' }}
      >
        {isLoading ? (
          <div style={{ color: 'var(--color-on-surface-variant)', fontSize: '13px' }}>
            Loading live shop floor telemetry, ...
          </div>
        ) : (
          filteredBoard.map((item) => {
            const isDowntime = item.hasActiveDowntime;
            const isLowOee = item.oee < 50;
            const isNormal = item.workOrder.status === WorkOrderStatus.IN_PROGRESS && !isLowOee && !isDowntime;

            // The line's state picks a semantic tone, never a colour. Tone
            // rides the rail, the strokes, the gauge and the figures; the
            // status pill uses the solid container/on-container pair.
            const tone: Tone = isDowntime ? 'error' : isLowOee ? 'warning' : isNormal ? 'success' : 'primary';

            const accentColor = toneColor[tone];

            return (
              <SurfaceCard
                key={item.workOrder.id}
                style={{
                  borderLeft: `4px solid ${accentColor}`,
                  boxShadow: 'var(--elevation-1)',
                  padding: '16px 18px',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                {/* Decorative Living Conveyor Motion Vectors in Top Corner */}
                <svg
                  style={{
                    position: 'absolute',
                    top: 0,
                    right: 0,
                    width: '140px',
                    height: '50px',
                    pointerEvents: 'none',
                    opacity: 0.15,
                  }}
                  viewBox="0 0 140 50"
                  fill="none"
                >
                  <motion.line
                    x1="0"
                    y1="15"
                    x2="140"
                    y2="15"
                    stroke={accentColor}
                    strokeWidth="2"
                    strokeDasharray="6 6"
                    animate={{ strokeDashoffset: isNormal ? [0, -24] : [0, 0] }}
                    transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
                  />
                  <motion.line
                    x1="20"
                    y1="35"
                    x2="140"
                    y2="35"
                    stroke={accentColor}
                    strokeWidth="1.5"
                    strokeDasharray="4 4"
                    animate={{ strokeDashoffset: isNormal ? [0, -16] : [0, 0] }}
                    transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
                  />
                </svg>

                {/* Line & Machine Title */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    marginBottom: '12px',
                    position: 'relative',
                    zIndex: 1,
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <h2 style={{ fontSize: '15px', fontWeight: 800, margin: 0, color: accentColor }}>
                        {item.lineId.toUpperCase()}
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
                          }}
                        />
                      )}
                    </div>
                    <div
                      style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)', marginTop: '2px' }}
                    >
                      Machine: {item.workOrder.machineId || 'Mechanical Press'}
                    </div>
                  </div>

                  <span
                    style={{
                      padding: '3px 10px',
                      borderRadius: 'var(--radius-pill)',
                      fontSize: '10px',
                      fontWeight: 800,
                      backgroundColor: toneContainer[tone],
                      color: toneOnContainer[tone],
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                    }}
                  >
                    <span
                      style={{
                        width: '5px',
                        height: '5px',
                        borderRadius: '50%',
                        backgroundColor: 'currentColor',
                      }}
                    />
                    {isDowntime ? 'DOWNTIME ACTIVE' : item.workOrder.status}
                  </span>
                </div>

                {/* Gauge Chart & Output Summary Split */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '110px 1fr',
                    gap: '12px',
                    alignItems: 'center',
                    marginBottom: '12px',
                    position: 'relative',
                    zIndex: 1,
                  }}
                >
                  <div>
                    <Gauge
                      value={item.oee}
                      title={`${item.oee}%`}
                      subtitle="OEE Score"
                      size={105}
                      strokeWidth={10}
                      color={accentColor}
                    />
                  </div>

                  {/* Active Work Order Telemetry */}
                  <div
                    style={{
                      backgroundColor: 'var(--color-surface-container)',
                      borderRadius: 'var(--radius-md, 8px)',
                      padding: '10px 12px',
                      border: '1px solid var(--color-outline-variant)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '11px',
                        marginBottom: '4px',
                      }}
                    >
                      <span style={{ color: 'var(--color-on-surface-variant)' }}>WO:</span>
                      <strong style={{ color: 'var(--color-on-surface)' }}>{item.workOrder.woNumber}</strong>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '11px',
                        marginBottom: '4px',
                      }}
                    >
                      <span style={{ color: 'var(--color-on-surface-variant)' }}>Target Progress</span>
                      <strong style={{ color: 'var(--color-on-surface)', fontFeatureSettings: '"tnum" 1' }}>
                        {item.workOrder.goodQuantity.toLocaleString('en-US')} /{' '}
                        {item.workOrder.targetQuantity.toLocaleString('en-US')} ({item.achievementPct}%)
                      </strong>
                    </div>

                    {/* Progress Bar with Motion Light Tip */}
                    <div
                      style={{
                        height: '5px',
                        borderRadius: 'var(--radius-pill)',
                        backgroundColor: 'var(--color-surface-container-high)',
                        overflow: 'hidden',
                        position: 'relative',
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

                {/* OEE Score Breakdown */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr)',
                    gap: '6px',
                    textAlign: 'center',
                    position: 'relative',
                    zIndex: 1,
                  }}
                >
                  <div
                    style={{
                      backgroundColor: 'var(--color-surface-container)',
                      padding: '6px 4px',
                      borderRadius: 'var(--radius-sm, 6px)',
                      border: '1px solid var(--color-outline-variant)',
                    }}
                  >
                    <div style={{ fontSize: '10px', color: 'var(--color-on-surface-variant)' }}>OEE</div>
                    <div
                      style={{
                        fontSize: '13px',
                        fontWeight: 800,
                        color: accentColor,
                        fontFeatureSettings: '"tnum" 1',
                      }}
                    >
                      {item.oee}%
                    </div>
                  </div>
                  <div
                    style={{
                      backgroundColor: 'var(--color-surface-container)',
                      padding: '6px 4px',
                      borderRadius: 'var(--radius-sm, 6px)',
                      border: '1px solid var(--color-outline-variant)',
                    }}
                  >
                    <div style={{ fontSize: '10px', color: 'var(--color-on-surface-variant)' }}>Avail</div>
                    <div
                      style={{
                        fontSize: '13px',
                        fontWeight: 800,
                        color: 'var(--color-on-surface)',
                        fontFeatureSettings: '"tnum" 1',
                      }}
                    >
                      {item.availability}%
                    </div>
                  </div>
                  <div
                    style={{
                      backgroundColor: 'var(--color-surface-container)',
                      padding: '6px 4px',
                      borderRadius: 'var(--radius-sm, 6px)',
                      border: '1px solid var(--color-outline-variant)',
                    }}
                  >
                    <div style={{ fontSize: '10px', color: 'var(--color-on-surface-variant)' }}>Perf</div>
                    <div
                      style={{
                        fontSize: '13px',
                        fontWeight: 800,
                        color: 'var(--color-on-surface)',
                        fontFeatureSettings: '"tnum" 1',
                      }}
                    >
                      {item.performance}%
                    </div>
                  </div>
                  <div
                    style={{
                      backgroundColor: 'var(--color-surface-container)',
                      padding: '6px 4px',
                      borderRadius: 'var(--radius-sm, 6px)',
                      border: '1px solid var(--color-outline-variant)',
                    }}
                  >
                    <div style={{ fontSize: '10px', color: 'var(--color-on-surface-variant)' }}>Qual</div>
                    <div
                      style={{
                        fontSize: '13px',
                        fontWeight: 800,
                        color: item.quality >= 98 ? toneColor.success : toneColor.error,
                        fontFeatureSettings: '"tnum" 1',
                      }}
                    >
                      {item.quality}%
                    </div>
                  </div>
                </div>
              </SurfaceCard>
            );
          })
        )}
      </Section>
    </Page>
  );
};
