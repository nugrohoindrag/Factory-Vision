import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FactoryVisionApiClient } from '@factory-vision/api-client';
import type { BottleneckRow } from '@factory-vision/domain-types';
import { Button, Icon } from '@factory-vision/ui';
import { MetricCard, SurfaceCard, Page, Section, FilterChip } from '@factory-vision/ui/fv';

const api = new FactoryVisionApiClient({ baseUrl: '' });

const WINDOWS = [7, 14, 30] as const;

const LOSS_LABEL: Record<BottleneckRow['dominantLoss'], { label: string; tone: string; hint: string }> = {
  AVAILABILITY: {
    label: 'Availability',
    tone: 'var(--color-info)',
    hint: 'Mesin terlalu sering berhenti, periksa Pareto downtime.',
  },
  PERFORMANCE: {
    label: 'Performance',
    tone: 'var(--color-warning)',
    hint: 'Mesin berjalan di bawah cycle time standar, periksa kecepatan dan minor stop.',
  },
  QUALITY: {
    label: 'Quality',
    tone: 'var(--color-error)',
    hint: 'Terlalu banyak reject, periksa Pareto defect.',
  },
};

/**
 * US-037, Analyze Production Bottleneck.
 *
 * Ranked by output lost against target rather than by OEE, because the
 * constraint worth fixing is the one costing the most units: a rarely-used
 * machine with a poor score is not the plant's problem, and sorting by OEE
 * would put it at the top anyway.
 */
export const BottleneckPage: React.FC = () => {
  const navigate = useNavigate();
  const [days, setDays] = useState<number>(7);
  const [kind, setKind] = useState<'MACHINE' | 'PROCESS'>('MACHINE');
  const [lineId, setLineId] = useState<string>('');

  const { data: lines = [] } = useQuery({ queryKey: ['lines'], queryFn: () => api.master.getLines() });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['bottlenecks', days, kind, lineId],
    queryFn: () => api.oee.bottlenecks({ days, kind, lineId: lineId || undefined }),
  });

  const totalLost = rows.reduce((acc, row) => acc + row.lostUnits, 0);
  const worst = rows[0];
  const maxLost = Math.max(1, ...rows.map((r) => r.lostUnits));

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
          Analisis Bottleneck
        </h1>
        <p style={{ margin: '4px 0 0', color: 'var(--color-on-surface-variant)', fontSize: '12px' }}>
          Peringkat kendala berdasarkan kehilangan produksi terhadap Target Produksi
        </p>
      </Section>

      <Section style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '6px' }}>
          <FilterChip selected={kind === 'MACHINE'} onClick={() => setKind('MACHINE')}>
            Per Mesin
          </FilterChip>
          <FilterChip selected={kind === 'PROCESS'} onClick={() => setKind('PROCESS')}>
            Per Proses Produksi
          </FilterChip>
        </div>

        <div style={{ display: 'flex', gap: '6px' }}>
          {WINDOWS.map((option) => (
            <FilterChip key={option} selected={days === option} onClick={() => setDays(option)}>
              {option} hari
            </FilterChip>
          ))}
        </div>

        <select
          value={lineId}
          onChange={(event) => setLineId(event.target.value)}
          aria-label="Filter production line"
          style={{
            padding: '7px 10px',
            fontSize: '12px',
            fontFamily: 'var(--font-family)',
            borderRadius: 'var(--radius-full, 999px)',
            border: '1px solid var(--color-outline-variant)',
            backgroundColor: 'var(--color-surface-container)',
            color: 'var(--color-on-surface)',
          }}
        >
          <option value="">Semua Production Line</option>
          {lines.map((line) => (
            <option key={line.id} value={line.id}>
              {line.name}
            </option>
          ))}
        </select>
      </Section>

      <Section
        stagger
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}
      >
        <MetricCard
          label="Kendala Utama"
          value={worst?.entityName ?? ', '}
          delta={worst ? `${worst.lostUnits.toLocaleString('id-ID')} unit hilang` : 'Tidak ada data'}
          deltaType="negative"
          tone="error"
          icon={<Icon name="compress" size={18} />}
        />
        <MetricCard
          label="Total Kehilangan Produksi"
          value={`${totalLost.toLocaleString('id-ID')} unit`}
          delta={`Periode ${days} hari`}
          deltaType="negative"
          tone="warning"
          icon={<Icon name="trending_down" size={18} />}
        />
        <MetricCard
          label="Faktor Dominan"
          value={worst ? LOSS_LABEL[worst.dominantLoss].label : ', '}
          delta={worst ? `${worst.dominantLossPct.toFixed(1)}% kehilangan` : ''}
          deltaType="negative"
          tone="info"
          icon={<Icon name="troubleshoot" size={18} />}
        />
      </Section>

      <Section>
        <SurfaceCard padding="md">
          <div style={{ marginBottom: '12px' }}>
            <span style={{ fontSize: '14px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
              Peringkat Bottleneck
            </span>
            <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
              Pilih Telusuri untuk membuka detail OEE pada {kind === 'MACHINE' ? 'mesin' : 'proses'} tersebut
            </div>
          </div>

          {isLoading ? (
            <Placeholder label="Memuat analisis…" />
          ) : rows.length === 0 ? (
            <Placeholder label="Belum ada data produksi pada filter ini." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {rows.map((row) => {
                const loss = LOSS_LABEL[row.dominantLoss];
                return (
                  <div
                    key={`${row.kind}-${row.entityId}`}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '36px minmax(0, 1.3fr) minmax(0, 1.4fr) auto',
                      gap: '12px',
                      alignItems: 'center',
                      padding: '12px 14px',
                      borderRadius: 'var(--radius-sm, 8px)',
                      border: '1px solid var(--color-outline-variant)',
                      backgroundColor: 'var(--color-surface)',
                    }}
                  >
                    <span
                      style={{
                        width: '28px',
                        height: '28px',
                        display: 'grid',
                        placeItems: 'center',
                        borderRadius: 'var(--radius-full, 999px)',
                        backgroundColor:
                          row.rank === 1 ? 'var(--color-error)' : 'var(--color-surface-container-highest)',
                        color: row.rank === 1 ? 'var(--color-on-error)' : 'var(--color-on-surface)',
                        fontSize: '12px',
                        fontWeight: 800,
                      }}
                    >
                      {row.rank}
                    </span>

                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
                        {row.entityName}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                        {row.contextLabel}
                      </div>
                      <div
                        style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)', marginTop: '2px' }}
                      >
                        OEE {row.oee.toFixed(1)}% · {row.downtimeMinutes} menit henti ·{' '}
                        {row.rejectQuantity.toLocaleString('id-ID')} reject
                      </div>
                    </div>

                    {/* The bar makes the ranking's basis visible: the length is
 the loss, so the "vital few" separate themselves. */}
                    <div>
                      <div
                        style={{
                          height: '10px',
                          borderRadius: 'var(--radius-full, 999px)',
                          backgroundColor: 'var(--color-surface-container-highest)',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            width: `${(row.lostUnits / maxLost) * 100}%`,
                            height: '100%',
                            backgroundColor: loss.tone,
                          }}
                        />
                      </div>
                      <div
                        style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)', marginTop: '4px' }}
                      >
                        Faktor dominan: <strong style={{ color: loss.tone }}>{loss.label}</strong>, {loss.hint}
                      </div>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
                        {row.lostUnits.toLocaleString('id-ID')}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                        unit ({row.lostUnitsPct.toFixed(1)}%)
                      </div>
                      <Button
                        variant="text"
                        size="sm"
                        icon={<Icon name="arrow_forward" size={15} />}
                        iconPosition="end"
                        onClick={() => navigate(row.drillDownPath)}
                        style={{ marginTop: '2px', marginRight: '-12px' }}
                      >
                        Telusuri
                      </Button>
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

const Placeholder: React.FC<{ label: string }> = ({ label }) => (
  <div
    style={{ padding: '28px', textAlign: 'center', color: 'var(--color-on-surface-variant)', fontSize: '12px' }}
  >
    {label}
  </div>
);
