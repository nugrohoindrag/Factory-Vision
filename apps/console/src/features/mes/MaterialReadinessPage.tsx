import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FactoryVisionApiClient } from '@factory-vision/api-client';
import { ColumnDef } from '@factory-vision/ui';
import { DataTable, Page, Section, SurfaceCard, FilterChip } from '@factory-vision/ui/fv';
import type { MaterialReadiness, MaterialRequirement } from '@factory-vision/domain-types';
import { EmptyState, KpiRow, KpiTile, PageHeading, StatusPill, fmt, fmtDate } from './shared.js';

const api = new FactoryVisionApiClient({ baseUrl: '' });

/**
 * Material Readiness (Improvement PRD §3.1, US-M001).
 *
 * BR-M03 — "material shortage harus terlihat sebelum WO execution" — is the
 * whole point of the screen, so the plan list leads with its readiness and the
 * drill-down goes straight to the requirement rows the status came from.
 *
 * Recomputed on open rather than read from the last check: a PPIC asking
 * whether material is ready is asking about stock now.
 */
export const MaterialReadinessPage: React.FC = () => {
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [onlyProblems, setOnlyProblems] = useState(false);

  const { data: readiness, isLoading } = useQuery({
    queryKey: ['material-readiness'],
    queryFn: () => api.materials.getReadiness(),
    refetchInterval: 60_000,
  });

  const plans = readiness ?? [];
  const visible = onlyProblems ? plans.filter((plan) => plan.status !== 'READY') : plans;
  // The first plan is shown by default: opening a readiness screen and being
  // asked to pick something before seeing anything is a wasted click.
  const selected = plans.find((plan) => plan.sourceId === selectedPlanId) ?? visible[0];

  const totalRequirements = plans.reduce((sum, plan) => sum + plan.totalRequirements, 0);
  const readyRequirements = plans.reduce((sum, plan) => sum + plan.readyRequirements, 0);
  const shortagePlans = plans.filter((plan) => plan.status === 'SHORTAGE').length;

  const planColumns: ColumnDef<MaterialReadiness & { id: string }>[] = [
    {
      key: 'sourceLabel',
      header: 'Production Plan',
      sortable: true,
      width: '28%',
      render: (plan) => (
        <div>
          <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--color-on-surface)' }}>
            {plan.sourceLabel}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
            {plan.totalRequirements} material dari BOM
          </div>
        </div>
      ),
    },
    {
      key: 'readinessPercentage',
      header: 'Readiness',
      sortable: true,
      render: (plan) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <div
            style={{
              flex: 1,
              minWidth: '80px',
              height: '6px',
              borderRadius: 'var(--radius-pill)',
              backgroundColor: 'var(--color-surface-container-high)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${Math.min(plan.readinessPercentage, 100)}%`,
                height: '100%',
                backgroundColor:
                  plan.status === 'READY'
                    ? 'var(--color-success)'
                    : plan.status === 'PARTIAL'
                      ? 'var(--color-warning)'
                      : 'var(--color-error)',
              }}
            />
          </div>
          <span style={{ fontSize: '12px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
            {plan.readinessPercentage.toFixed(0)}%
          </span>
        </div>
      ),
    },
    {
      key: 'readyRequirements',
      header: 'Ready',
      sortable: true,
      render: (plan) => fmt(plan.readyRequirements),
    },
    {
      key: 'shortageRequirements',
      header: 'Kurang',
      sortable: true,
      render: (plan) => (
        <span
          style={{
            fontWeight: 800,
            color: plan.shortageRequirements > 0 ? 'var(--color-error)' : 'var(--color-on-surface-variant)',
          }}
        >
          {fmt(plan.shortageRequirements)}
        </span>
      ),
    },
    { key: 'status', header: 'Status', sortable: true, render: (plan) => <StatusPill status={plan.status} /> },
  ];

  const requirementColumns: ColumnDef<MaterialRequirement>[] = [
    {
      key: 'materialSku',
      header: 'Material',
      sortable: true,
      width: '24%',
      render: (row) => (
        <div>
          <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--color-on-surface)' }}>
            {row.materialSku}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
            {row.materialName} · level {row.level}
          </div>
        </div>
      ),
    },
    {
      key: 'requiredQuantity',
      header: 'Dibutuhkan',
      sortable: true,
      render: (row) => `${fmt(row.requiredQuantity, 2)} ${row.uom}`,
    },
    { key: 'onHandQuantity', header: 'On Hand', sortable: true, render: (row) => fmt(row.onHandQuantity, 2) },
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
      key: 'availableQuantity',
      header: 'Available',
      sortable: true,
      render: (row) => (
        <span style={{ fontWeight: 700, color: 'var(--color-on-surface)' }}>
          {fmt(row.availableQuantity, 2)}
        </span>
      ),
    },
    {
      key: 'shortageQuantity',
      header: 'Shortage',
      sortable: true,
      render: (row) => (
        <span
          style={{
            fontWeight: 800,
            color: row.shortageQuantity > 0 ? 'var(--color-error)' : 'var(--color-on-surface-variant)',
          }}
        >
          {fmt(row.shortageQuantity, 2)}
        </span>
      ),
    },
    {
      key: 'requirementDate',
      header: 'Dibutuhkan',
      sortable: true,
      render: (row) => fmtDate(row.requirementDate),
    },
    { key: 'status', header: 'Status', sortable: true, render: (row) => <StatusPill status={row.status} /> },
  ];

  return (
    <Page>
      <Section>
        <PageHeading
          title="Material Readiness"
          subtitle="Kesiapan material setiap production plan, dihitung dari BOM aktif terhadap stok saat ini. Shortage terlihat sebelum work order dieksekusi."
        />
      </Section>

      <Section>
        <KpiRow>
          <KpiTile
            label="Material Readiness"
            value={
              totalRequirements > 0 ? `${((readyRequirements / totalRequirements) * 100).toFixed(0)}%` : '—'
            }
            caption={`${fmt(readyRequirements)} dari ${fmt(totalRequirements)} kebutuhan siap`}
            tone={readyRequirements === totalRequirements ? 'success' : 'warning'}
            icon="inventory"
          />
          <KpiTile
            label="Plan Dipantau"
            value={fmt(plans.length)}
            caption="Production plan dalam horizon"
            tone="info"
            icon="event_note"
          />
          <KpiTile
            label="Plan Shortage"
            value={fmt(shortagePlans)}
            caption="Tidak dapat dieksekusi penuh"
            tone={shortagePlans > 0 ? 'error' : 'success'}
            icon="warning"
          />
          <KpiTile
            label="Kebutuhan Kurang"
            value={fmt(totalRequirements - readyRequirements)}
            caption="Baris material yang belum tercukupi"
            tone={totalRequirements - readyRequirements > 0 ? 'error' : 'success'}
            icon="production_quantity_limits"
          />
        </KpiRow>
      </Section>

      <Section style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
        <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-on-surface-variant)' }}>
          Tampilkan:
        </span>
        <FilterChip selected={!onlyProblems} onClick={() => setOnlyProblems(false)}>
          Semua Plan
        </FilterChip>
        <FilterChip selected={onlyProblems} onClick={() => setOnlyProblems(true)}>
          Hanya Bermasalah
        </FilterChip>
      </Section>

      <Section>
        {!isLoading && plans.length === 0 ? (
          <SurfaceCard padding="lg">
            <EmptyState
              icon="inventory"
              title="Belum ada production plan untuk diperiksa"
              description="Buat dan konfirmasi production plan, lalu pastikan produknya memiliki BOM aktif agar kebutuhan material dapat dihitung."
            />
          </SurfaceCard>
        ) : (
          <DataTable
            columns={planColumns}
            data={visible.map((plan) => ({ ...plan, id: plan.sourceId }))}
            title="Kesiapan Material per Production Plan"
            subtitle="Pilih satu baris untuk melihat rincian kebutuhan materialnya."
            searchable
            renderExpandedRow={(plan) => (
              <button
                type="button"
                onClick={() => setSelectedPlanId(plan.sourceId)}
                style={{
                  border: 'none',
                  background: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  fontFamily: 'var(--font-family)',
                  fontSize: '12px',
                  fontWeight: 700,
                  color: 'var(--color-primary)',
                }}
              >
                Lihat {plan.totalRequirements} baris kebutuhan material →
              </button>
            )}
          />
        )}
      </Section>

      {selected ? (
        <Section>
          <DataTable
            columns={requirementColumns}
            data={selected.requirements}
            title={`Kebutuhan Material · ${selected.sourceLabel}`}
            subtitle="Available = On Hand − Reserved + Incoming. Shortage = Dibutuhkan − Available."
            searchable
          />
        </Section>
      ) : null}
    </Page>
  );
};
