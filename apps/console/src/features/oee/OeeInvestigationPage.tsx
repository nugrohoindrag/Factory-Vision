import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FactoryVisionApiClient } from '@factory-vision/api-client';
import type { KpiStatus, MachinePerformanceRow, ProcessPerformanceRow } from '@factory-vision/domain-types';
import { Button, Icon } from '@factory-vision/ui';
import { MetricCard, SurfaceCard, Page, Section, FilterChip } from '@factory-vision/ui/fv';

const api = new FactoryVisionApiClient({ baseUrl: '' });

const WINDOWS = [7, 14, 30] as const;

const STATUS_TONE: Record<KpiStatus, { bg: string; fg: string; label: string }> = {
  GOOD: { bg: 'var(--color-success-container)', fg: 'var(--color-on-success-container)', label: 'Baik' },
  WATCH: { bg: 'var(--color-warning-container)', fg: 'var(--color-on-warning-container)', label: 'Waspada' },
  CRITICAL: { bg: 'var(--color-error-container)', fg: 'var(--color-on-error-container)', label: 'Kritis' },
};

const StatusPill: React.FC<{ status: KpiStatus }> = ({ status }) => {
  const tone = STATUS_TONE[status];
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 10px',
        borderRadius: 'var(--radius-full, 999px)',
        backgroundColor: tone.bg,
        color: tone.fg,
        fontSize: '11px',
        fontWeight: 700,
      }}
    >
      {tone.label}
    </span>
  );
};

/** A single OEE factor rendered as a labelled bar, so losses read at a glance. */
const FactorBar: React.FC<{ label: string; value: number; tone: string }> = ({ label, value, tone }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
    <span
      style={{ fontSize: '11px', width: '26px', color: 'var(--color-on-surface-variant)', fontWeight: 700 }}
    >
      {label}
    </span>
    <div
      style={{
        flex: 1,
        height: '6px',
        borderRadius: 'var(--radius-full, 999px)',
        backgroundColor: 'var(--color-surface-container-highest)',
        overflow: 'hidden',
      }}
    >
      <div style={{ width: `${Math.min(100, value)}%`, height: '100%', backgroundColor: tone }} />
    </div>
    <span
      style={{
        fontSize: '11px',
        fontWeight: 700,
        width: '44px',
        textAlign: 'right',
        color: 'var(--color-on-surface)',
      }}
    >
      {value.toFixed(1)}%
    </span>
  </div>
);

/**
 * US-027, Investigate OEE.
 *
 * The screen answers one question in two steps: which process is losing us
 * output, and which machine inside it is responsible. Process rows are the
 * entry point and expand into their machines, because a manager who already
 * knows the answer should not have to traverse a tree to confirm it, and one
 * who does not should never see a machine list without its process context.
 */
export const OeeInvestigationPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [days, setDays] = useState<number>(7);

  const selectedProcessId = searchParams.get('processId') ?? undefined;
  const selectedMachineId = searchParams.get('machineId') ?? undefined;

  const { data: processes = [], isLoading: processesLoading } = useQuery({
    queryKey: ['oee-process-performance', days],
    queryFn: () => api.analytics.getProcessPerformance({ days }),
  });

  const { data: machines = [], isLoading: machinesLoading } = useQuery({
    queryKey: ['oee-machine-performance', days, selectedProcessId, selectedMachineId],
    queryFn: () =>
      api.oee.machinePerformance({ days, processId: selectedProcessId, machineId: selectedMachineId }),
  });

  const { data: config } = useQuery({ queryKey: ['oee-config'], queryFn: () => api.oee.getConfig() });

  const selectedProcess = processes.find((p) => p.processId === selectedProcessId);

  const rollup = useMemo(() => {
    const source: Array<ProcessPerformanceRow | MachinePerformanceRow> = selectedProcessId
      ? machines
      : processes;
    if (source.length === 0) return { oee: 0, availability: 0, performance: 0, quality: 0 };
    const mean = (pick: (row: ProcessPerformanceRow | MachinePerformanceRow) => number) =>
      source.reduce((acc, row) => acc + pick(row), 0) / source.length;
    return {
      oee: mean((r) => r.oee),
      availability: mean((r) => r.availability),
      performance: mean((r) => r.performance),
      quality: mean((r) => r.quality),
    };
  }, [processes, machines, selectedProcessId]);

  // US-027 /: a machine with no configured Product × Machine rate
  // must be named, not quietly averaged into a plausible-looking figure.
  const missingRateMachines = machines.filter((m) => m.idealCycleMissing);

  const setFilter = (next: { processId?: string; machineId?: string }) => {
    const params = new URLSearchParams(searchParams);
    for (const key of ['processId', 'machineId'] as const) {
      const value = next[key];
      if (value) params.set(key, value);
      else params.delete(key);
    }
    setSearchParams(params, { replace: true });
  };

  return (
    <Page style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <Section>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            gap: '16px',
            flexWrap: 'wrap',
          }}
        >
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
              Investigasi OEE
            </h1>
            <p style={{ margin: '4px 0 0', color: 'var(--color-on-surface-variant)', fontSize: '12px' }}>
              Telusuri dari Proses Produksi ke Mesin untuk menemukan sumber kehilangan OEE
            </p>
          </div>

          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            {WINDOWS.map((option) => (
              <FilterChip key={option} selected={days === option} onClick={() => setDays(option)}>
                {option} hari
              </FilterChip>
            ))}
          </div>
        </div>
      </Section>

      {/* Breadcrumb makes the current drill-down level explicit and reversible. */}
      {(selectedProcessId || selectedMachineId) && (
        <Section>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', flexWrap: 'wrap' }}
          >
            <button
              type="button"
              onClick={() => setFilter({})}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                color: 'var(--color-primary)',
                fontWeight: 700,
                fontFamily: 'var(--font-family)',
                fontSize: '12px',
              }}
            >
              Semua Proses Produksi
            </button>
            {selectedProcess && (
              <>
                <Icon name="chevron_right" size={14} />
                <button
                  type="button"
                  onClick={() => setFilter({ processId: selectedProcessId })}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    color: selectedMachineId ? 'var(--color-primary)' : 'var(--color-on-surface)',
                    fontWeight: 700,
                    fontFamily: 'var(--font-family)',
                    fontSize: '12px',
                  }}
                >
                  {selectedProcess.processName}
                </button>
              </>
            )}
            {selectedMachineId && (
              <>
                <Icon name="chevron_right" size={14} />
                <span style={{ fontWeight: 700, color: 'var(--color-on-surface)' }}>
                  {machines[0]?.machineName ?? selectedMachineId}
                </span>
              </>
            )}
          </div>
        </Section>
      )}

      <Section
        stagger
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}
      >
        <MetricCard
          label="OEE"
          value={`${rollup.oee.toFixed(1)}%`}
          delta={selectedProcess ? selectedProcess.processName : 'Seluruh proses'}
          deltaType={rollup.oee >= 80 ? 'positive' : 'negative'}
          tone="primary"
          icon={<Icon name="speed" size={18} />}
          sparklineData={[70, 74, 72, 78, 76, 80, rollup.oee]}
        />
        <MetricCard
          label="Availability"
          value={`${rollup.availability.toFixed(1)}%`}
          delta="Run time / planned time"
          deltaType={rollup.availability >= 90 ? 'positive' : 'negative'}
          tone="info"
          icon={<Icon name="schedule" size={18} />}
        />
        <MetricCard
          label="Performance"
          value={`${rollup.performance.toFixed(1)}%`}
          delta="Ideal cycle × total count / run time"
          deltaType={rollup.performance >= 90 ? 'positive' : 'negative'}
          tone="warning"
          icon={<Icon name="bolt" size={18} />}
        />
        <MetricCard
          label="Quality"
          value={`${rollup.quality.toFixed(1)}%`}
          delta="Good count / total count"
          deltaType={rollup.quality >= 98 ? 'positive' : 'negative'}
          tone="success"
          icon={<Icon name="verified" size={18} />}
        />
      </Section>

      {missingRateMachines.length > 0 && (
        <Section>
          <SurfaceCard
            padding="md"
            style={{
              borderLeft: '3px solid var(--color-error)',
              display: 'flex',
              gap: '10px',
              alignItems: 'flex-start',
            }}
          >
            <Icon name="report" size={18} />
            <div>
              <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
                Ideal Cycle Time belum dikonfigurasi
              </div>
              <p
                style={{
                  margin: '4px 0 0',
                  fontSize: '12px',
                  color: 'var(--color-on-surface-variant)',
                  lineHeight: 1.6,
                }}
              >
                Performance dan OEE tidak dihitung untuk{' '}
                <strong>{missingRateMachines.map((m) => m.machineName).join(', ')}</strong> karena tidak ada
                rate Product × Machine yang aktif. MES tidak memakai nilai default agar angka tidak menyesatkan.
                Lengkapi pada Master Data → Cycle Rates.
              </p>
            </div>
          </SurfaceCard>
        </Section>
      )}

      {/* Level 1, Process */}
      {!selectedProcessId && (
        <Section>
          <SurfaceCard padding="md">
            <div style={{ marginBottom: '10px' }}>
              <span style={{ fontSize: '14px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
                OEE per Proses Produksi
              </span>
              <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                Pilih Proses Produksi untuk menelusuri ke tingkat Mesin
              </div>
            </div>

            {processesLoading ? (
              <EmptyState label="Memuat data proses…" />
            ) : processes.length === 0 ? (
              <EmptyState label="Belum ada data produksi pada periode ini." />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {processes.map((row) => (
                  <div
                    key={row.processId}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1.6fr) auto',
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
                        {row.processName}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                        {row.goodQuantity.toLocaleString('id-ID')} good ·{' '}
                        {row.rejectQuantity.toLocaleString('id-ID')} reject · {row.downtimeMinutes} menit henti
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <FactorBar label="A" value={row.availability} tone="var(--color-info)" />
                      <FactorBar label="P" value={row.performance} tone="var(--color-warning)" />
                      <FactorBar label="Q" value={row.quality} tone="var(--color-success)" />
                    </div>

                    <div
                      style={{
                        textAlign: 'right',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                        alignItems: 'flex-end',
                      }}
                    >
                      <span style={{ fontSize: '20px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
                        {row.oee.toFixed(1)}%
                      </span>
                      <StatusPill status={row.status} />
                      <Button
                        variant="text"
                        size="sm"
                        icon={<Icon name="arrow_forward" size={15} />}
                        iconPosition="end"
                        onClick={() => setFilter({ processId: row.processId })}
                        style={{ marginRight: '-12px' }}
                      >
                        Telusuri Mesin
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SurfaceCard>
        </Section>
      )}

      {/* Level 2, Machine */}
      {selectedProcessId && (
        <Section>
          <SurfaceCard padding="md">
            <div style={{ marginBottom: '10px' }}>
              <span style={{ fontSize: '14px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
                OEE per Mesin{selectedProcess ? `, ${selectedProcess.processName}` : ''}
              </span>
              <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                Diurutkan dari OEE terendah, sehingga kendala terbesar muncul lebih dulu
              </div>
            </div>

            {machinesLoading ? (
              <EmptyState label="Memuat data mesin…" />
            ) : machines.length === 0 ? (
              <EmptyState label="Tidak ada mesin dengan data pada proses dan periode ini." />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {machines.map((row) => (
                  <div
                    key={row.machineId}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1.6fr) auto',
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
                        {row.machineName}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                        {row.machineCode} · {row.workCenterName} · {row.lineName}
                      </div>
                      <div
                        style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)', marginTop: '2px' }}
                      >
                        {row.goodQuantity.toLocaleString('id-ID')} /{' '}
                        {row.targetQuantity.toLocaleString('id-ID')} unit · {row.runMinutes} menit jalan ·{' '}
                        {row.downtimeMinutes} menit henti
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <FactorBar label="A" value={row.availability} tone="var(--color-info)" />
                      {row.idealCycleMissing ? (
                        <div style={{ fontSize: '11px', color: 'var(--color-error)', fontWeight: 700 }}>
                          P, rate belum dikonfigurasi
                        </div>
                      ) : (
                        <FactorBar label="P" value={row.performance} tone="var(--color-warning)" />
                      )}
                      <FactorBar label="Q" value={row.quality} tone="var(--color-success)" />
                    </div>

                    <div
                      style={{
                        textAlign: 'right',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                        alignItems: 'flex-end',
                      }}
                    >
                      <span style={{ fontSize: '20px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
                        {row.idealCycleMissing ? ', ' : `${row.oee.toFixed(1)}%`}
                      </span>
                      <StatusPill status={row.status} />
                      <span style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                        Ideal cycle: {row.idealCycleSeconds ? `${row.idealCycleSeconds}s` : 'belum diatur'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SurfaceCard>
        </Section>
      )}

      {config && (
        <Section>
          <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
            Definisi perhitungan: calc_version <strong>{config.calcVersion}</strong> · planned downtime{' '}
            {config.pptExcludesPlannedDowntime ? 'dikeluarkan dari' : 'termasuk dalam'} Planned Production Time
            · sumber rate <strong>{config.idealCycleSource}</strong>
          </div>
        </Section>
      )}
    </Page>
  );
};

const EmptyState: React.FC<{ label: string }> = ({ label }) => (
  <div
    style={{
      padding: '28px',
      textAlign: 'center',
      color: 'var(--color-on-surface-variant)',
      fontSize: '12px',
    }}
  >
    {label}
  </div>
);
