import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FactoryVisionApiClient } from '@factory-vision/api-client';
import { AdvancedDataTable, Button, ColumnDef, Icon } from '@factory-vision/ui';
import { Page, Section, SurfaceCard, FilterChip, DateField } from '@factory-vision/ui/fv';
import type { MrpResult, MrpRun } from '@factory-vision/domain-types';
import { EmptyState, KpiRow, KpiTile, PageHeading, StatusPill, fmt, fmtDate, fmtDateTime } from './shared.js';

const api = new FactoryVisionApiClient({ baseUrl: '' });

/**
 * MRP (Improvement PRD §3.2, US-M002).
 *
 * The screen is built around the run, not around the material: a net
 * requirement is only meaningful against the inventory and the horizon it was
 * computed from (BR-M08), so the run selector is the first control and the
 * horizon is on the header of every result.
 *
 * The table is the §3.2 output table, column for column, because that is the
 * table a PPIC already knows how to read.
 */
export const MrpPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'SHORTAGE' | 'READY'>('ALL');
  const today = new Date().toISOString().slice(0, 10);
  const [horizonStart, setHorizonStart] = useState(today);
  const [horizonEnd, setHorizonEnd] = useState(
    new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
  );

  const { data: runs } = useQuery({ queryKey: ['mrp-runs'], queryFn: () => api.mrp.getRuns({ limit: 30 }) });

  // No run selected means "the latest", which is what a PPIC opening the
  // screen is asking for.
  const { data: detail, isLoading } = useQuery({
    queryKey: ['mrp-run', selectedRunId ?? 'latest'],
    queryFn: () => (selectedRunId ? api.mrp.getRun(selectedRunId) : api.mrp.getLatest()),
  });

  const runMrp = useMutation({
    mutationFn: () => api.mrp.run({ horizonStart, horizonEnd }),
    onSuccess: (outcome) => {
      setSelectedRunId(outcome.run.id);
      queryClient.invalidateQueries({ queryKey: ['mrp-runs'] });
      queryClient.invalidateQueries({ queryKey: ['mrp-run'] });
    },
  });

  const run: MrpRun | null = detail?.run ?? null;
  const results = detail?.results ?? [];
  const filtered = results.filter((row) => {
    if (statusFilter === 'SHORTAGE') return row.netRequirement > 0;
    if (statusFilter === 'READY') return row.netRequirement <= 0;
    return true;
  });

  const columns: ColumnDef<MrpResult>[] = [
    {
      key: 'materialSku',
      header: 'Material',
      sortable: true,
      width: '22%',
      render: (row) => (
        <div>
          <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--color-on-surface)' }}>
            {row.materialSku}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>{row.materialName}</div>
        </div>
      ),
    },
    {
      key: 'grossRequirement',
      header: 'Gross Req',
      sortable: true,
      render: (row) => `${fmt(row.grossRequirement, 2)} ${row.uom}`,
    },
    {
      key: 'availableQuantity',
      header: 'Available',
      sortable: true,
      render: (row) => fmt(row.availableQuantity, 2),
    },
    {
      key: 'reservedQuantity',
      header: 'Reserved',
      sortable: true,
      render: (row) => fmt(row.reservedQuantity, 2),
    },
    {
      key: 'incomingQuantity',
      header: 'Incoming',
      sortable: true,
      render: (row) => fmt(row.incomingQuantity, 2),
    },
    {
      key: 'netRequirement',
      header: 'Net Req',
      sortable: true,
      render: (row) => (
        <span
          style={{
            fontWeight: 800,
            color: row.netRequirement > 0 ? 'var(--color-error)' : 'var(--color-on-surface-variant)',
          }}
        >
          {fmt(row.netRequirement, 2)}
        </span>
      ),
    },
    {
      key: 'requirementDate',
      header: 'Dibutuhkan',
      sortable: true,
      render: (row) => fmtDate(row.requirementDate),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (row) => <StatusPill status={row.status} />,
    },
  ];

  return (
    <Page>
      <Section>
        <PageHeading
          title="Material Requirements Planning"
          subtitle="Kebutuhan bersih material dari demand di dalam horizon perencanaan. MRP memberi rekomendasi, tidak membuat purchase order."
          actions={
            <Button variant="filled" onClick={() => runMrp.mutate()} disabled={runMrp.isPending}>
              <Icon name={runMrp.isPending ? 'hourglass_top' : 'play_arrow'} size={18} />
              {runMrp.isPending ? 'Menjalankan…' : 'Jalankan MRP'}
            </Button>
          }
        />
      </Section>

      <Section>
        <SurfaceCard padding="md">
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <DateField label="Awal Horizon" value={horizonStart} onChange={(e) => setHorizonStart(e.target.value)} />
            <DateField label="Akhir Horizon" value={horizonEnd} onChange={(e) => setHorizonEnd(e.target.value)} />
            <div style={{ flex: 1, minWidth: '200px' }}>
              <div
                style={{
                  fontSize: '10px',
                  fontWeight: 800,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: 'var(--color-on-surface-variant)',
                  marginBottom: 'var(--space-1)',
                }}
              >
                Riwayat Run
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-1)', flexWrap: 'wrap' }}>
                <FilterChip selected={selectedRunId === null} onClick={() => setSelectedRunId(null)}>
                  Terbaru
                </FilterChip>
                {(runs ?? []).slice(0, 6).map((item) => (
                  <FilterChip
                    key={item.id}
                    selected={selectedRunId === item.id}
                    onClick={() => setSelectedRunId(item.id)}
                  >
                    {item.runNumber}
                  </FilterChip>
                ))}
              </div>
            </div>
          </div>
          {runMrp.isError ? (
            <p style={{ margin: `var(--space-2) 0 0`, fontSize: '12px', color: 'var(--color-error)' }}>
              MRP gagal dijalankan: {(runMrp.error as Error).message}
            </p>
          ) : null}
        </SurfaceCard>
      </Section>

      {run ? (
        <Section>
          <KpiRow>
            <KpiTile
              label="Run"
              value={run.runNumber}
              caption={`Dijalankan ${fmtDateTime(run.startedAt)}`}
              tone="primary"
              icon="calculate"
            />
            <KpiTile
              label="Horizon"
              value={`${fmtDate(run.horizonStart)} – ${fmtDate(run.horizonEnd)}`}
              caption={`${run.planIds.length} production plan`}
              tone="info"
              icon="date_range"
            />
            <KpiTile
              label="Material Dihitung"
              value={fmt(run.totalMaterials)}
              caption="Hasil BOM explosion"
              tone="chart-2"
              icon="inventory_2"
            />
            <KpiTile
              label="Shortage"
              value={fmt(run.shortageMaterials)}
              caption={
                run.totalMaterials > 0
                  ? `${((run.shortageMaterials / run.totalMaterials) * 100).toFixed(0)}% dari kebutuhan`
                  : 'Tidak ada kebutuhan'
              }
              tone={run.shortageMaterials > 0 ? 'error' : 'success'}
              icon="warning"
            />
          </KpiRow>
        </Section>
      ) : null}

      <Section style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
        <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-on-surface-variant)' }}>
          Filter Hasil:
        </span>
        {(['ALL', 'SHORTAGE', 'READY'] as const).map((key) => (
          <FilterChip key={key} selected={statusFilter === key} onClick={() => setStatusFilter(key)}>
            {key === 'ALL' ? 'Semua Material' : key === 'SHORTAGE' ? 'Shortage' : 'Ready'}
          </FilterChip>
        ))}
      </Section>

      <Section>
        {!isLoading && !run ? (
          <SurfaceCard padding="lg">
            <EmptyState
              icon="calculate"
              title="Belum ada MRP run"
              description="Tentukan horizon perencanaan lalu jalankan MRP untuk melihat kebutuhan bersih material dari production plan yang aktif."
            />
          </SurfaceCard>
        ) : (
          <AdvancedDataTable
            columns={columns}
            data={filtered}
            title="Hasil MRP"
            subtitle="Net Requirement = Gross Requirement − (On Hand − Reserved + Incoming). Rekomendasi ada pada baris yang diperluas."
            searchable
            selectable={false}
            expandable
            renderExpandedRow={(row) => (
              <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
                <div style={{ marginBottom: 'var(--space-1)' }}>
                  <strong style={{ color: 'var(--color-on-surface)' }}>Sumber kebutuhan:</strong>{' '}
                  {row.requirementSource || '—'}
                </div>
                <div style={{ marginBottom: 'var(--space-1)' }}>
                  <strong style={{ color: 'var(--color-on-surface)' }}>Level BOM:</strong> {row.level}
                </div>
                <div>
                  <strong style={{ color: 'var(--color-on-surface)' }}>Rekomendasi:</strong>{' '}
                  {row.recommendation ?? 'Stok mencukupi, tidak ada pengadaan yang direkomendasikan.'}
                </div>
              </div>
            )}
          />
        )}
      </Section>
    </Page>
  );
};
