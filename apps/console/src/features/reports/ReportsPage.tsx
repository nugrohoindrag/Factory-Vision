import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  FactoryVisionApiClient,
  ProductionReportItem,
  DowntimeReportItem,
  ShiftReportItem,
} from '@factory-vision/api-client';
import type {
  Inspection,
  LaborUtilization,
  MaintenanceRecord,
  MaterialConsumption,
  OeeReportItem,
  WipRecord,
} from '@factory-vision/domain-types';
import { AdvancedDataTable, ColumnDef, Button, Icon } from '@factory-vision/ui';
import { Page, Section, FilterChip } from '@factory-vision/ui/fv';
import { useSession } from '../../app/SessionContext.js';
import { StatusPill, fmt, fmtDate, fmtDateTime } from '../mes/shared.js';
import { downloadCsv, reportFilename, toCsv, type CsvColumn } from './csv.js';
import {
  RANGE_KEYS,
  ReportEmpty,
  ReportError,
  ReportForbidden,
  ReportKpiRow,
  ReportLoading,
  resolveRange,
  type RangeKey,
  type ReportKpi,
} from './ReportShell.js';

const api = new FactoryVisionApiClient({ baseUrl: '' });

/**
 * Reports (PRD v1.7 §24 and Improvement PRD §24).
 *
 * Nine reports, one shell. Each entry below declares its rows, its columns,
 * its summary figures and the permission it needs; the shell owns the date
 * range, the export, and the loading / empty / error / forbidden states. That
 * split is the point: the states are where reports usually diverge, and a user
 * who learns one report has learned all nine.
 *
 * The queries are all declared unconditionally — hooks cannot be called inside
 * a branch — and gated with `enabled`, so only the visible report is fetched.
 */

type ReportKey =
  | 'production'
  | 'downtime'
  | 'shift'
  | 'oee'
  | 'material'
  | 'quality'
  | 'maintenance'
  | 'workforce'
  | 'wip';

interface ReportMeta {
  key: ReportKey;
  label: string;
  title: string;
  subtitle: string;
  /** The API enforces the same id; this only decides what is rendered. */
  permission: string;
  emptyIcon: string;
  emptyTitle: string;
  emptyDescription: string;
  /** Reports about current state rather than a window hide the range chips. */
  usesRange: boolean;
}

const REPORTS: ReportMeta[] = [
  {
    key: 'production',
    label: 'Produksi',
    title: 'Laporan Produksi',
    subtitle: 'Target, produksi aktual, dan pencapaian per Work Order.',
    permission: 'report:export',
    emptyIcon: 'assignment',
    emptyTitle: 'Belum ada produksi tercatat',
    emptyDescription: 'Belum ada work order dengan output pada periode ini.',
    usesRange: false,
  },
  {
    key: 'downtime',
    label: 'Downtime',
    title: 'Laporan Downtime',
    subtitle: 'Riwayat downtime beserta durasi dan alasannya.',
    permission: 'report:export',
    emptyIcon: 'timer',
    emptyTitle: 'Tidak ada downtime',
    emptyDescription: 'Tidak ada kejadian downtime yang tercatat pada periode ini.',
    usesRange: false,
  },
  {
    key: 'shift',
    label: 'Shift',
    title: 'Laporan Shift',
    subtitle: 'Rekap produksi aktual, pencapaian, dan downtime per shift.',
    permission: 'report:export',
    emptyIcon: 'schedule',
    emptyTitle: 'Belum ada rekap shift',
    emptyDescription: 'Rekap shift muncul setelah ada produksi yang tercatat pada shift tersebut.',
    usesRange: false,
  },
  {
    key: 'oee',
    label: 'OEE',
    title: 'Laporan OEE',
    subtitle: 'Availability, Performance, Quality, dan OEE per mesin, proses, dan shift.',
    permission: 'analytics:view',
    emptyIcon: 'speed',
    emptyTitle: 'Belum ada perhitungan OEE',
    emptyDescription: 'OEE dihitung dari produksi dan downtime yang tercatat; belum ada data pada rentang ini.',
    usesRange: false,
  },
  {
    key: 'material',
    label: 'Material',
    title: 'Laporan Material',
    subtitle: 'Konsumsi material terhadap rencana BOM, beserta variance-nya (Improvement PRD §24).',
    permission: 'material:view',
    emptyIcon: 'inventory_2',
    emptyTitle: 'Belum ada konsumsi material',
    emptyDescription: 'Catat konsumsi material dari terminal operator atau layar Material untuk mengisi laporan ini.',
    usesRange: true,
  },
  {
    key: 'quality',
    label: 'Quality',
    title: 'Laporan Quality',
    subtitle: 'Inspeksi, pass/fail, dan hasil disposition pada periode terpilih.',
    permission: 'quality:view',
    emptyIcon: 'fact_check',
    emptyTitle: 'Belum ada inspeksi',
    emptyDescription: 'Laporan ini terisi setelah inspeksi kualitas dijalankan pada periode terpilih.',
    usesRange: true,
  },
  {
    key: 'maintenance',
    label: 'Maintenance',
    title: 'Laporan Maintenance',
    subtitle: 'Preventive, corrective, dan emergency beserta MTBF dan MTTR.',
    permission: 'maintenance:view',
    emptyIcon: 'build',
    emptyTitle: 'Belum ada pekerjaan maintenance',
    emptyDescription: 'Belum ada pekerjaan maintenance yang dimulai pada periode ini.',
    usesRange: true,
  },
  {
    key: 'workforce',
    label: 'Workforce',
    title: 'Laporan Workforce',
    subtitle: 'Utilisasi tenaga kerja per operator: waktu produktif terhadap waktu tersedia.',
    permission: 'workforce:view',
    emptyIcon: 'engineering',
    emptyTitle: 'Belum ada labor time record',
    emptyDescription: 'Utilisasi dihitung dari labor time record; belum ada yang tercatat pada periode ini.',
    usesRange: true,
  },
  {
    key: 'wip',
    label: 'WIP',
    title: 'Laporan WIP',
    subtitle: 'Kuantitas WIP terbuka, proses tempatnya berada, umur, dan statusnya.',
    permission: 'wip:view',
    emptyIcon: 'inventory',
    emptyTitle: 'Tidak ada WIP terbuka',
    emptyDescription: 'Seluruh kuantitas sudah diteruskan ke proses berikutnya atau selesai.',
    // WIP is a statement of what is on the floor now, not of a past window.
    usesRange: false,
  },
];

export const ReportsPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { can, principal } = useSession();

  const requested = (searchParams.get('tab') ?? 'production') as ReportKey;
  const meta = REPORTS.find((report) => report.key === requested) ?? REPORTS[0];
  const active = meta.key;

  const [rangeKey, setRangeKey] = useState<RangeKey>('THIS_MONTH');
  const [oeeDays, setOeeDays] = useState<number>(7);
  const range = useMemo(() => resolveRange(rangeKey), [rangeKey]);

  const allowed = can(meta.permission);
  const on = (key: ReportKey) => allowed && active === key;

  // --- v1.7 reports -------------------------------------------------

  const production = useQuery({
    queryKey: ['report-production'],
    queryFn: () => api.reports.getProduction(),
    enabled: on('production'),
  });
  const downtime = useQuery({
    queryKey: ['report-downtime'],
    queryFn: () => api.reports.getDowntime(),
    enabled: on('downtime'),
  });
  const shift = useQuery({
    queryKey: ['report-shift'],
    queryFn: () => api.reports.getShift(),
    enabled: on('shift'),
  });
  const oee = useQuery({
    queryKey: ['report-oee', oeeDays],
    queryFn: () => api.oee.report({ days: oeeDays }),
    enabled: on('oee'),
  });

  // --- Improvement reports (§24) ------------------------------------

  const material = useQuery({
    queryKey: ['report-material', range.from, range.to],
    queryFn: () => api.materials.getConsumption({ from: range.from, to: range.to, limit: 1000 }),
    enabled: on('material'),
  });
  const quality = useQuery({
    queryKey: ['report-quality', range.from, range.to],
    queryFn: () => api.quality.getInspections({ from: range.from, to: range.to, limit: 1000 }),
    enabled: on('quality'),
  });
  const qualitySummary = useQuery({
    queryKey: ['report-quality-summary', range.from, range.to],
    queryFn: () => api.quality.getDashboard({ from: range.from, to: range.to }),
    enabled: on('quality'),
  });
  const maintenance = useQuery({
    queryKey: ['report-maintenance', range.from, range.to],
    queryFn: () => api.maintenance.getRecords({ from: range.from, to: range.to, limit: 1000 }),
    enabled: on('maintenance'),
  });
  const maintenanceKpi = useQuery({
    queryKey: ['report-maintenance-kpi', range.from, range.to],
    queryFn: () => api.maintenance.getKpi({ from: range.from, to: range.to }),
    enabled: on('maintenance'),
  });
  const workforce = useQuery({
    queryKey: ['report-workforce', range.from, range.to],
    queryFn: () =>
      api.workforce.getUtilization({
        scope: 'OPERATOR',
        from: range.from.slice(0, 10),
        to: range.to.slice(0, 10),
      }),
    enabled: on('workforce'),
  });
  const wip = useQuery({
    queryKey: ['report-wip'],
    queryFn: () => api.wip.getRecords({ openOnly: true, limit: 1000 }),
    enabled: on('wip'),
  });

  // ==================================================================
  // Columns
  // ==================================================================

  const prodColumns: ColumnDef<ProductionReportItem & { id: string }>[] = [
    { key: 'woNumber', header: 'Work Order', sortable: true, render: (r) => <strong>{r.woNumber}</strong> },
    { key: 'lineName', header: 'Production Line', sortable: true },
    {
      key: 'productName',
      header: 'Nama Produk',
      render: (r) => (
        <div>
          <div style={{ fontWeight: 600 }}>{r.productName}</div>
          <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>{r.productSku}</div>
        </div>
      ),
    },
    { key: 'targetQuantity', header: 'Target Produksi', sortable: true, render: (r) => fmt(r.targetQuantity) },
    {
      key: 'goodQuantity',
      header: 'Jumlah Good',
      sortable: true,
      render: (r) => (
        <span style={{ color: 'var(--color-success)', fontWeight: 800 }}>{fmt(r.goodQuantity)}</span>
      ),
    },
    {
      key: 'rejectQuantity',
      header: 'Jumlah Reject',
      sortable: true,
      render: (r) => (
        <span style={{ color: r.rejectQuantity > 0 ? 'var(--color-error)' : 'inherit', fontWeight: 700 }}>
          {fmt(r.rejectQuantity)}
        </span>
      ),
    },
    {
      key: 'achievementPct',
      header: 'Pencapaian',
      sortable: true,
      render: (r) => (
        <StatusPill
          status={`${r.achievementPct}%`}
          tone={r.achievementPct >= 80 ? 'success' : 'warning'}
        />
      ),
    },
  ];

  const dtColumns: ColumnDef<DowntimeReportItem>[] = [
    { key: 'lineName', header: 'Production Line', sortable: true },
    { key: 'machineName', header: 'Nama Mesin', sortable: true, render: (r) => <strong>{r.machineName}</strong> },
    {
      key: 'reasonCategory',
      header: 'Kategori',
      render: (r) => <StatusPill status={r.reasonCategory} tone="neutral" />,
    },
    { key: 'reasonName', header: 'Downtime Reason', sortable: true },
    {
      key: 'durationMinutes',
      header: 'Durasi',
      sortable: true,
      render: (r) => <strong style={{ color: 'var(--color-error)' }}>{r.durationMinutes} menit</strong>,
    },
    { key: 'status', header: 'Status', render: (r) => <StatusPill status={r.status} /> },
    { key: 'notes', header: 'Catatan Operator', render: (r) => r.notes || '—' },
  ];

  const shiftColumns: ColumnDef<ShiftReportItem & { id: string }>[] = [
    { key: 'lineName', header: 'Production Line', sortable: true },
    { key: 'shiftName', header: 'Shift', sortable: true, render: (r) => <strong>{r.shiftName}</strong> },
    { key: 'totalTarget', header: 'Target Produksi', render: (r) => fmt(r.totalTarget) },
    {
      key: 'totalGood',
      header: 'Jumlah Good',
      render: (r) => (
        <span style={{ color: 'var(--color-success)', fontWeight: 700 }}>{fmt(r.totalGood)}</span>
      ),
    },
    {
      key: 'totalReject',
      header: 'Jumlah Reject',
      render: (r) => (
        <span style={{ color: r.totalReject > 0 ? 'var(--color-error)' : 'inherit' }}>
          {fmt(r.totalReject)}
        </span>
      ),
    },
    { key: 'totalDowntimeMinutes', header: 'Downtime', render: (r) => `${r.totalDowntimeMinutes} menit` },
    {
      key: 'achievementPct',
      header: 'Pencapaian',
      render: (r) => (
        <StatusPill status={`${r.achievementPct}%`} tone={r.achievementPct >= 80 ? 'success' : 'warning'} />
      ),
    },
  ];

  /**
   * `calcVersion` is on the row deliberately: a historical OEE figure is only
   * meaningful next to the definition that produced it, and a row whose Ideal
   * Cycle Time is missing says so rather than showing a zero that reads like
   * genuinely terrible performance.
   */
  const oeeColumns: ColumnDef<OeeReportItem & { id: string }>[] = [
    { key: 'shiftDate', header: 'Tanggal Shift', sortable: true, render: (r) => <strong>{r.shiftDate}</strong> },
    { key: 'shiftName', header: 'Shift', sortable: true },
    { key: 'lineName', header: 'Production Line', sortable: true },
    { key: 'machineName', header: 'Mesin', sortable: true, render: (r) => <strong>{r.machineName}</strong> },
    { key: 'processName', header: 'Proses', render: (r) => r.processName || '—' },
    { key: 'productName', header: 'Produk', render: (r) => r.productName || '—' },
    { key: 'availability', header: 'Availability', sortable: true, render: (r) => `${r.availability.toFixed(1)}%` },
    {
      key: 'performance',
      header: 'Performance',
      sortable: true,
      render: (r) =>
        r.idealCycleMissing ? (
          <span
            style={{ color: 'var(--color-error)', fontWeight: 700 }}
            title="Rate Product x Machine belum dikonfigurasi"
          >
            rate belum diatur
          </span>
        ) : (
          `${r.performance.toFixed(1)}%`
        ),
    },
    { key: 'quality', header: 'Quality', sortable: true, render: (r) => `${r.quality.toFixed(1)}%` },
    {
      key: 'oee',
      header: 'OEE',
      sortable: true,
      render: (r) =>
        r.idealCycleMissing ? (
          <StatusPill status="—" tone="neutral" />
        ) : (
          <StatusPill
            status={`${r.oee.toFixed(1)}%`}
            tone={r.oee >= 80 ? 'success' : r.oee >= 70 ? 'warning' : 'error'}
          />
        ),
    },
    { key: 'goodQuantity', header: 'Good', sortable: true, render: (r) => fmt(r.goodQuantity) },
    { key: 'rejectQuantity', header: 'Reject', sortable: true, render: (r) => fmt(r.rejectQuantity) },
    { key: 'downtimeMinutes', header: 'Downtime', render: (r) => `${r.downtimeMinutes} mnt` },
    { key: 'calcVersion', header: 'Calc Ver.', render: (r) => `v${r.calcVersion}` },
  ];

  const materialColumns: ColumnDef<MaterialConsumption>[] = [
    { key: 'consumedAt', header: 'Waktu', sortable: true, render: (r) => fmtDateTime(r.consumedAt) },
    { key: 'workOrderNumber', header: 'Work Order', sortable: true },
    {
      key: 'materialSku',
      header: 'Material',
      sortable: true,
      render: (r) => (
        <div>
          <div style={{ fontWeight: 700 }}>{r.materialSku}</div>
          <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>{r.materialName}</div>
        </div>
      ),
    },
    { key: 'plannedQuantity', header: 'Rencana', sortable: true, render: (r) => `${fmt(r.plannedQuantity, 2)} ${r.uom}` },
    { key: 'actualQuantity', header: 'Aktual', sortable: true, render: (r) => fmt(r.actualQuantity, 2) },
    {
      key: 'varianceQuantity',
      header: 'Variance',
      sortable: true,
      render: (r) => (
        <span
          style={{
            fontWeight: 800,
            color: r.status === 'NORMAL' ? 'var(--color-on-surface-variant)' : 'var(--color-error)',
          }}
        >
          {r.varianceQuantity > 0 ? '+' : ''}
          {fmt(r.varianceQuantity, 2)}
        </span>
      ),
    },
    { key: 'consumptionType', header: 'Jenis', sortable: true },
    { key: 'status', header: 'Status', sortable: true, render: (r) => <StatusPill status={r.status} /> },
  ];

  const qualityColumns: ColumnDef<Inspection>[] = [
    { key: 'inspectionNumber', header: 'No. Inspeksi', sortable: true },
    { key: 'inspectedAt', header: 'Waktu', sortable: true, render: (r) => fmtDateTime(r.inspectedAt) },
    { key: 'workOrderNumber', header: 'Work Order', sortable: true, render: (r) => r.workOrderNumber ?? '—' },
    { key: 'productName', header: 'Produk', sortable: true, render: (r) => r.productName ?? '—' },
    { key: 'inspectionType', header: 'Tipe', sortable: true },
    { key: 'inspectedQuantity', header: 'Diperiksa', sortable: true, render: (r) => fmt(r.inspectedQuantity, 2) },
    { key: 'passedQuantity', header: 'Lolos', sortable: true, render: (r) => fmt(r.passedQuantity, 2) },
    {
      key: 'failedQuantity',
      header: 'Gagal',
      sortable: true,
      render: (r) => (
        <span style={{ fontWeight: 800, color: r.failedQuantity > 0 ? 'var(--color-error)' : 'inherit' }}>
          {fmt(r.failedQuantity, 2)}
        </span>
      ),
    },
    { key: 'inspectorName', header: 'Inspektor', sortable: true },
    { key: 'result', header: 'Hasil', sortable: true, render: (r) => <StatusPill status={r.result} /> },
  ];

  const maintenanceColumns: ColumnDef<MaintenanceRecord>[] = [
    { key: 'maintenanceNumber', header: 'No.', sortable: true },
    {
      key: 'maintenanceType',
      header: 'Jenis',
      sortable: true,
      render: (r) => <StatusPill status={r.maintenanceType} />,
    },
    { key: 'machineName', header: 'Mesin', sortable: true },
    { key: 'startedAt', header: 'Mulai', sortable: true, render: (r) => fmtDateTime(r.startedAt) },
    { key: 'completedAt', header: 'Selesai', sortable: true, render: (r) => fmtDateTime(r.completedAt) },
    {
      key: 'durationMinutes',
      header: 'Durasi',
      sortable: true,
      render: (r) => (r.durationMinutes === undefined ? '—' : `${fmt(r.durationMinutes)} menit`),
    },
    { key: 'technicianName', header: 'Teknisi', sortable: true, render: (r) => r.technicianName ?? '—' },
    { key: 'rootCause', header: 'Root Cause', render: (r) => r.rootCause ?? '—' },
    { key: 'result', header: 'Hasil', sortable: true, render: (r) => (r.result ? <StatusPill status={r.result} /> : '—') },
    { key: 'status', header: 'Status', sortable: true, render: (r) => <StatusPill status={r.status} /> },
  ];

  const workforceColumns: ColumnDef<LaborUtilization & { id: string }>[] = [
    { key: 'scopeName', header: 'Operator', sortable: true, render: (r) => <strong>{r.scopeName}</strong> },
    { key: 'productiveMinutes', header: 'Menit Produktif', sortable: true, render: (r) => fmt(r.productiveMinutes, 1) },
    { key: 'availableMinutes', header: 'Menit Tersedia', sortable: true, render: (r) => fmt(r.availableMinutes, 1) },
    {
      key: 'utilizationPercentage',
      header: 'Utilisasi',
      sortable: true,
      render: (r) => (
        <StatusPill
          status={`${r.utilizationPercentage.toFixed(1)}%`}
          tone={r.utilizationPercentage >= 80 ? 'success' : r.utilizationPercentage >= 60 ? 'warning' : 'error'}
        />
      ),
    },
  ];

  const wipColumns: ColumnDef<WipRecord>[] = [
    { key: 'wipNumber', header: 'No. WIP', sortable: true },
    { key: 'productName', header: 'Produk', sortable: true },
    { key: 'workOrderNumber', header: 'Work Order', sortable: true },
    { key: 'sourceProcessName', header: 'Proses', sortable: true, render: (r) => r.sourceProcessName ?? '—' },
    { key: 'quantity', header: 'Kuantitas', sortable: true, render: (r) => `${fmt(r.quantity, 2)} ${r.uom}` },
    {
      key: 'ageHours',
      header: 'Umur',
      sortable: true,
      render: (r) => (
        <span
          style={{
            fontWeight: r.agingStatus === 'NORMAL' ? 400 : 800,
            color:
              r.agingStatus === 'CRITICAL'
                ? 'var(--color-error)'
                : r.agingStatus === 'AGING'
                  ? 'var(--color-warning)'
                  : 'inherit',
          }}
        >
          {fmt(r.ageHours, 1)} jam
        </span>
      ),
    },
    { key: 'agingStatus', header: 'Aging', sortable: true, render: (r) => <StatusPill status={r.agingStatus} /> },
    { key: 'qualityStatus', header: 'Kualitas', sortable: true, render: (r) => <StatusPill status={r.qualityStatus} /> },
    { key: 'status', header: 'Status', sortable: true, render: (r) => <StatusPill status={r.status} /> },
  ];

  // ==================================================================
  // What the active report resolves to
  // ==================================================================

  const view = {
    production: {
      query: production,
      rows: (production.data ?? []).map((r) => ({ ...r, id: r.workOrderId })),
      columns: prodColumns,
      csv: [
        { header: 'Work Order', value: (r: ProductionReportItem) => r.woNumber },
        { header: 'Line', value: (r: ProductionReportItem) => r.lineName },
        { header: 'SKU', value: (r: ProductionReportItem) => r.productSku },
        { header: 'Produk', value: (r: ProductionReportItem) => r.productName },
        { header: 'Target', value: (r: ProductionReportItem) => r.targetQuantity },
        { header: 'Good', value: (r: ProductionReportItem) => r.goodQuantity },
        { header: 'Reject', value: (r: ProductionReportItem) => r.rejectQuantity },
        { header: 'Pencapaian (%)', value: (r: ProductionReportItem) => r.achievementPct },
      ] as CsvColumn<any>[],
    },
    downtime: {
      query: downtime,
      rows: downtime.data ?? [],
      columns: dtColumns,
      csv: [
        { header: 'Line', value: (r: DowntimeReportItem) => r.lineName },
        { header: 'Mesin', value: (r: DowntimeReportItem) => r.machineName },
        { header: 'Kategori', value: (r: DowntimeReportItem) => r.reasonCategory },
        { header: 'Alasan', value: (r: DowntimeReportItem) => r.reasonName },
        { header: 'Durasi (menit)', value: (r: DowntimeReportItem) => r.durationMinutes },
        { header: 'Status', value: (r: DowntimeReportItem) => r.status },
        { header: 'Catatan', value: (r: DowntimeReportItem) => r.notes },
      ] as CsvColumn<any>[],
    },
    shift: {
      query: shift,
      rows: (shift.data ?? []).map((r, i) => ({ ...r, id: `shift-${i}` })),
      columns: shiftColumns,
      csv: [
        { header: 'Line', value: (r: ShiftReportItem) => r.lineName },
        { header: 'Shift', value: (r: ShiftReportItem) => r.shiftName },
        { header: 'Target', value: (r: ShiftReportItem) => r.totalTarget },
        { header: 'Good', value: (r: ShiftReportItem) => r.totalGood },
        { header: 'Reject', value: (r: ShiftReportItem) => r.totalReject },
        { header: 'Downtime (menit)', value: (r: ShiftReportItem) => r.totalDowntimeMinutes },
        { header: 'Pencapaian (%)', value: (r: ShiftReportItem) => r.achievementPct },
      ] as CsvColumn<any>[],
    },
    oee: {
      query: oee,
      rows: (oee.data ?? []).map((r, i) => ({ ...r, id: `oee-${r.shiftDate}-${r.machineId}-${i}` })),
      columns: oeeColumns,
      csv: [] as CsvColumn<any>[], // exported by the server, see handleExport
    },
    material: {
      query: material,
      rows: material.data ?? [],
      columns: materialColumns,
      csv: [
        { header: 'Waktu', value: (r: MaterialConsumption) => r.consumedAt },
        { header: 'Work Order', value: (r: MaterialConsumption) => r.workOrderNumber },
        { header: 'SKU', value: (r: MaterialConsumption) => r.materialSku },
        { header: 'Material', value: (r: MaterialConsumption) => r.materialName },
        { header: 'Rencana', value: (r: MaterialConsumption) => r.plannedQuantity },
        { header: 'Aktual', value: (r: MaterialConsumption) => r.actualQuantity },
        { header: 'Variance', value: (r: MaterialConsumption) => r.varianceQuantity },
        { header: 'Variance (%)', value: (r: MaterialConsumption) => r.variancePercentage },
        { header: 'UOM', value: (r: MaterialConsumption) => r.uom },
        { header: 'Jenis', value: (r: MaterialConsumption) => r.consumptionType },
        { header: 'Status', value: (r: MaterialConsumption) => r.status },
      ] as CsvColumn<any>[],
    },
    quality: {
      query: quality,
      rows: quality.data ?? [],
      columns: qualityColumns,
      csv: [
        { header: 'No. Inspeksi', value: (r: Inspection) => r.inspectionNumber },
        { header: 'Waktu', value: (r: Inspection) => r.inspectedAt },
        { header: 'Work Order', value: (r: Inspection) => r.workOrderNumber },
        { header: 'Produk', value: (r: Inspection) => r.productName },
        { header: 'Tipe', value: (r: Inspection) => r.inspectionType },
        { header: 'Diperiksa', value: (r: Inspection) => r.inspectedQuantity },
        { header: 'Lolos', value: (r: Inspection) => r.passedQuantity },
        { header: 'Gagal', value: (r: Inspection) => r.failedQuantity },
        { header: 'Inspektor', value: (r: Inspection) => r.inspectorName },
        { header: 'Hasil', value: (r: Inspection) => r.result },
      ] as CsvColumn<any>[],
    },
    maintenance: {
      query: maintenance,
      rows: maintenance.data ?? [],
      columns: maintenanceColumns,
      csv: [
        { header: 'No.', value: (r: MaintenanceRecord) => r.maintenanceNumber },
        { header: 'Jenis', value: (r: MaintenanceRecord) => r.maintenanceType },
        { header: 'Mesin', value: (r: MaintenanceRecord) => r.machineName },
        { header: 'Mulai', value: (r: MaintenanceRecord) => r.startedAt },
        { header: 'Selesai', value: (r: MaintenanceRecord) => r.completedAt },
        { header: 'Durasi (menit)', value: (r: MaintenanceRecord) => r.durationMinutes },
        { header: 'Teknisi', value: (r: MaintenanceRecord) => r.technicianName },
        { header: 'Root Cause', value: (r: MaintenanceRecord) => r.rootCause },
        { header: 'Tindakan', value: (r: MaintenanceRecord) => r.actionTaken },
        { header: 'Hasil', value: (r: MaintenanceRecord) => r.result },
        { header: 'Status', value: (r: MaintenanceRecord) => r.status },
      ] as CsvColumn<any>[],
    },
    workforce: {
      query: workforce,
      rows: (workforce.data ?? []).map((r) => ({ ...r, id: r.scopeId })),
      columns: workforceColumns,
      csv: [
        { header: 'Operator', value: (r: LaborUtilization) => r.scopeName },
        { header: 'Menit Produktif', value: (r: LaborUtilization) => r.productiveMinutes },
        { header: 'Menit Tersedia', value: (r: LaborUtilization) => r.availableMinutes },
        { header: 'Utilisasi (%)', value: (r: LaborUtilization) => r.utilizationPercentage },
      ] as CsvColumn<any>[],
    },
    wip: {
      query: wip,
      rows: wip.data ?? [],
      columns: wipColumns,
      csv: [
        { header: 'No. WIP', value: (r: WipRecord) => r.wipNumber },
        { header: 'Produk', value: (r: WipRecord) => r.productName },
        { header: 'Work Order', value: (r: WipRecord) => r.workOrderNumber },
        { header: 'Proses', value: (r: WipRecord) => r.sourceProcessName },
        { header: 'Kuantitas', value: (r: WipRecord) => r.quantity },
        { header: 'UOM', value: (r: WipRecord) => r.uom },
        { header: 'Umur (jam)', value: (r: WipRecord) => r.ageHours },
        { header: 'Aging', value: (r: WipRecord) => r.agingStatus },
        { header: 'Kualitas', value: (r: WipRecord) => r.qualityStatus },
        { header: 'Status', value: (r: WipRecord) => r.status },
      ] as CsvColumn<any>[],
    },
  }[active];

  // ==================================================================
  // Summary figures, per report
  // ==================================================================

  const kpis: ReportKpi[] = useMemo(() => {
    switch (active) {
      case 'production': {
        const rows = production.data ?? [];
        const good = rows.reduce((sum, r) => sum + (r.goodQuantity || 0), 0);
        const reject = rows.reduce((sum, r) => sum + (r.rejectQuantity || 0), 0);
        const target = rows.reduce((sum, r) => sum + (r.targetQuantity || 0), 0);
        return [
          { label: 'Work Order', value: fmt(rows.length), tone: 'primary', icon: 'assignment' },
          { label: 'Jumlah Good', value: fmt(good), tone: 'success', icon: 'check_circle' },
          {
            label: 'Jumlah Reject',
            value: fmt(reject),
            caption: `${((reject / (good + reject || 1)) * 100).toFixed(1)}% defect rate`,
            tone: 'error',
            icon: 'cancel',
          },
          {
            label: 'Pencapaian',
            value: target > 0 ? `${((good / target) * 100).toFixed(1)}%` : '—',
            caption: `terhadap target ${fmt(target)}`,
            tone: 'info',
            icon: 'flag',
          },
        ];
      }
      case 'downtime': {
        const rows = downtime.data ?? [];
        const minutes = rows.reduce((sum, r) => sum + (r.durationMinutes || 0), 0);
        return [
          { label: 'Kejadian', value: fmt(rows.length), tone: 'primary', icon: 'timer' },
          { label: 'Total Durasi', value: `${fmt(minutes)} menit`, tone: 'error', icon: 'hourglass_bottom' },
          {
            label: 'Rata-rata',
            value: rows.length > 0 ? `${fmt(Math.round(minutes / rows.length))} menit` : '—',
            tone: 'warning',
            icon: 'timeline',
          },
          {
            label: 'Belum Selesai',
            value: fmt(rows.filter((r) => r.status !== 'RESOLVED').length),
            tone: 'error',
            icon: 'pending',
          },
        ];
      }
      case 'shift': {
        const rows = shift.data ?? [];
        const good = rows.reduce((sum, r) => sum + (r.totalGood || 0), 0);
        const reject = rows.reduce((sum, r) => sum + (r.totalReject || 0), 0);
        const dt = rows.reduce((sum, r) => sum + (r.totalDowntimeMinutes || 0), 0);
        return [
          { label: 'Shift Tercatat', value: fmt(rows.length), tone: 'primary', icon: 'schedule' },
          { label: 'Jumlah Good', value: fmt(good), tone: 'success', icon: 'check_circle' },
          { label: 'Jumlah Reject', value: fmt(reject), tone: 'error', icon: 'cancel' },
          { label: 'Downtime', value: `${fmt(dt)} menit`, tone: 'warning', icon: 'timer' },
        ];
      }
      case 'oee': {
        const rows = oee.data ?? [];
        const valid = rows.filter((r) => !r.idealCycleMissing);
        const avg = (pick: (r: OeeReportItem) => number) =>
          valid.length > 0 ? valid.reduce((sum, r) => sum + pick(r), 0) / valid.length : 0;
        return [
          {
            label: 'OEE Rata-rata',
            value: valid.length > 0 ? `${avg((r) => r.oee).toFixed(1)}%` : '—',
            caption: `${valid.length} dari ${rows.length} baris terhitung`,
            tone: avg((r) => r.oee) >= 80 ? 'success' : 'warning',
            icon: 'speed',
          },
          { label: 'Availability', value: valid.length > 0 ? `${avg((r) => r.availability).toFixed(1)}%` : '—', tone: 'info', icon: 'schedule' },
          { label: 'Performance', value: valid.length > 0 ? `${avg((r) => r.performance).toFixed(1)}%` : '—', tone: 'chart-2', icon: 'trending_up' },
          { label: 'Quality', value: valid.length > 0 ? `${avg((r) => r.quality).toFixed(1)}%` : '—', tone: 'chart-3', icon: 'verified' },
        ];
      }
      case 'material': {
        const rows = material.data ?? [];
        const planned = rows.reduce((sum, r) => sum + r.plannedQuantity, 0);
        const actual = rows.reduce((sum, r) => sum + r.actualQuantity, 0);
        const variance = actual - planned;
        return [
          { label: 'Transaksi', value: fmt(rows.length), tone: 'primary', icon: 'receipt_long' },
          { label: 'Rencana (BOM)', value: fmt(planned, 1), tone: 'info', icon: 'checklist' },
          { label: 'Aktual', value: fmt(actual, 1), tone: 'chart-2', icon: 'inventory_2' },
          {
            label: 'Consumption Variance',
            value: `${variance > 0 ? '+' : ''}${fmt(variance, 1)}`,
            caption: planned > 0 ? `${((variance / planned) * 100).toFixed(1)}% dari rencana` : undefined,
            tone: Math.abs(variance) < 0.001 ? 'success' : variance > 0 ? 'error' : 'warning',
            icon: 'balance',
          },
        ];
      }
      case 'quality': {
        const summary = qualitySummary.data;
        return [
          {
            label: 'First Pass Yield',
            value: summary ? `${summary.firstPassYield.toFixed(1)}%` : '—',
            caption: 'First Pass Good ÷ Input × 100',
            tone: !summary ? 'neutral' : summary.firstPassYield >= 95 ? 'success' : 'warning',
            icon: 'verified',
          },
          {
            label: 'Inspeksi',
            value: summary ? fmt(summary.inspections) : '—',
            caption: summary ? `${fmt(summary.failedInspections)} gagal` : undefined,
            tone: 'primary',
            icon: 'fact_check',
          },
          {
            label: 'Reject Rate',
            value: summary ? `${summary.failRate.toFixed(1)}%` : '—',
            tone: summary && summary.failRate > 5 ? 'error' : 'success',
            icon: 'report',
          },
          {
            label: 'Rework / Scrap',
            value: summary ? `${fmt(summary.reworkQuantity)} / ${fmt(summary.scrapQuantity)}` : '—',
            tone: 'chart-3',
            icon: 'recycling',
          },
          {
            label: 'NCR Terbuka',
            value: summary ? fmt(summary.openNcr) : '—',
            caption: summary ? `${fmt(summary.overdueNcr)} lewat jatuh tempo` : undefined,
            tone: summary && summary.overdueNcr > 0 ? 'error' : 'info',
            icon: 'assignment_late',
          },
        ];
      }
      case 'maintenance': {
        const kpi = maintenanceKpi.data;
        const rows = maintenance.data ?? [];
        return [
          { label: 'Pekerjaan', value: fmt(rows.length), tone: 'primary', icon: 'build' },
          {
            label: 'PM Compliance',
            value: kpi ? `${kpi.pmCompliancePercentage.toFixed(0)}%` : '—',
            caption: kpi ? `${fmt(kpi.overdueCount)} overdue` : undefined,
            tone: kpi && kpi.overdueCount > 0 ? 'error' : 'success',
            icon: 'event_available',
          },
          { label: 'MTBF', value: kpi ? `${fmt(kpi.mtbfHours, 1)} jam` : '—', tone: 'info', icon: 'timeline' },
          { label: 'MTTR', value: kpi ? `${fmt(kpi.mttrHours, 2)} jam` : '—', tone: 'chart-2', icon: 'handyman' },
          {
            label: 'Downtime Maintenance',
            value: kpi ? `${fmt(kpi.maintenanceDowntimeMinutes)} menit` : '—',
            caption: kpi ? `${fmt(kpi.emergencyCount)} emergency` : undefined,
            tone: 'warning',
            icon: 'timer',
          },
        ];
      }
      case 'workforce': {
        const rows = workforce.data ?? [];
        const productive = rows.reduce((sum, r) => sum + r.productiveMinutes, 0);
        const available = rows.reduce((sum, r) => sum + r.availableMinutes, 0);
        return [
          { label: 'Operator', value: fmt(rows.length), tone: 'primary', icon: 'engineering' },
          {
            label: 'Labor Utilization',
            value: available > 0 ? `${((productive / available) * 100).toFixed(1)}%` : '—',
            caption: 'Produktif ÷ Tersedia × 100',
            tone: available > 0 && productive / available >= 0.8 ? 'success' : 'warning',
            icon: 'timelapse',
          },
          { label: 'Menit Produktif', value: fmt(productive, 1), tone: 'chart-2', icon: 'trending_up' },
          { label: 'Menit Tersedia', value: fmt(available, 1), tone: 'info', icon: 'schedule' },
        ];
      }
      default: {
        const rows = wip.data ?? [];
        const total = rows.reduce((sum, r) => sum + r.quantity, 0);
        const aging = rows.filter((r) => r.agingStatus !== 'NORMAL').length;
        const held = rows.filter((r) => r.status === 'ON_HOLD').length;
        return [
          { label: 'Total WIP', value: fmt(total, 1), tone: 'primary', icon: 'inventory' },
          { label: 'Baris WIP', value: fmt(rows.length), tone: 'info', icon: 'list_alt' },
          {
            label: 'Aging',
            value: fmt(aging),
            caption: `${fmt(rows.filter((r) => r.agingStatus === 'CRITICAL').length)} kritis`,
            tone: aging > 0 ? 'warning' : 'success',
            icon: 'hourglass_bottom',
          },
          { label: 'On Hold', value: fmt(held), tone: held > 0 ? 'error' : 'success', icon: 'pan_tool' },
        ];
      }
    }
  }, [active, production.data, downtime.data, shift.data, oee.data, material.data, quality.data, qualitySummary.data, maintenance.data, maintenanceKpi.data, workforce.data, wip.data]);

  // ==================================================================
  // Export
  // ==================================================================

  const [exportError, setExportError] = useState<string | null>(null);

  const handleExport = async () => {
    setExportError(null);
    try {
      // OEE keeps its server-rendered CSV: it carries the calculation version
      // and the missing-rate flags, which the server is the authority on.
      if (active === 'oee') {
        downloadCsv(reportFilename('oee'), await api.oee.reportCsv({ days: oeeDays }));
        return;
      }
      downloadCsv(reportFilename(active), toCsv(view.csv, view.rows as never[]));
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Ekspor gagal.');
    }
  };

  // ==================================================================
  // Render
  // ==================================================================

  const { query } = view;
  const rows = view.rows;

  return (
    <Page>
      <Section style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              fontSize: '11.5px',
              color: 'var(--color-on-surface-variant)',
              fontWeight: 600,
            }}
          >
            <span>Analitik & Laporan</span>
            <span>/</span>
            <span style={{ color: 'var(--color-primary)', fontWeight: 800 }}>{meta.title}</span>
          </div>
          <h1
            style={{
              fontSize: '20px',
              fontWeight: 800,
              margin: `var(--space-1) 0 0`,
              color: 'var(--color-on-surface)',
              letterSpacing: '-0.02em',
            }}
          >
            {meta.title}
          </h1>
          <p style={{ margin: `var(--space-1) 0 0`, fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
            {meta.subtitle}
          </p>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
          {allowed && meta.usesRange ? (
            <div
              style={{
                display: 'flex',
                gap: 'var(--space-1)',
                backgroundColor: 'var(--color-surface-container)',
                padding: 'var(--space-1)',
                borderRadius: 'var(--radius-pill)',
              }}
            >
              {RANGE_KEYS.map((key) => (
                <FilterChip key={key} selected={rangeKey === key} onClick={() => setRangeKey(key)}>
                  {resolveRange(key).label}
                </FilterChip>
              ))}
            </div>
          ) : null}

          {allowed && active === 'oee' ? (
            <div
              style={{
                display: 'flex',
                gap: 'var(--space-1)',
                backgroundColor: 'var(--color-surface-container)',
                padding: 'var(--space-1)',
                borderRadius: 'var(--radius-pill)',
              }}
            >
              {[7, 14, 30].map((option) => (
                <FilterChip key={option} selected={oeeDays === option} onClick={() => setOeeDays(option)}>
                  {option} hari
                </FilterChip>
              ))}
            </div>
          ) : null}

          <Button
            variant="filled"
            icon={<Icon name="download" size={16} />}
            onClick={handleExport}
            disabled={!allowed || query.isLoading || (active !== 'oee' && rows.length === 0)}
          >
            Export CSV
          </Button>
        </div>
      </Section>

      {/* Report selector. Only the reports this role may read are offered — the
          same permission the API enforces, so the tab strip and the server
          agree about what exists. */}
      <Section style={{ display: 'flex', gap: 'var(--space-1)', flexWrap: 'wrap' }}>
        {REPORTS.filter((report) => can(report.permission)).map((report) => (
          <FilterChip
            key={report.key}
            selected={report.key === active}
            onClick={() => setSearchParams({ tab: report.key })}
          >
            {report.label}
          </FilterChip>
        ))}
      </Section>

      {meta.usesRange && allowed ? (
        <Section>
          <p style={{ margin: 0, fontSize: '11.5px', color: 'var(--color-on-surface-variant)' }}>
            Periode: <strong>{fmtDate(range.from)}</strong> – <strong>{fmtDate(range.to)}</strong>
          </p>
        </Section>
      ) : null}

      {!allowed ? (
        <Section>
          <ReportForbidden permission={meta.permission} role={principal?.role} />
        </Section>
      ) : query.isLoading ? (
        <Section>
          <ReportLoading label={meta.title} />
        </Section>
      ) : query.isError ? (
        <Section>
          <ReportError
            message={(query.error as Error)?.message ?? 'Terjadi kesalahan saat memuat laporan.'}
            onRetry={() => query.refetch()}
          />
        </Section>
      ) : (
        <>
          <Section>
            <ReportKpiRow kpis={kpis} />
          </Section>

          {exportError ? (
            <Section>
              <p style={{ margin: 0, fontSize: '12px', color: 'var(--color-error)' }}>{exportError}</p>
            </Section>
          ) : null}

          <Section>
            {rows.length === 0 ? (
              <ReportEmpty
                icon={meta.emptyIcon}
                title={meta.emptyTitle}
                description={meta.emptyDescription}
              />
            ) : (
              <AdvancedDataTable
                columns={view.columns as ColumnDef<{ id: string }>[]}
                data={rows as { id: string }[]}
                title={meta.title}
                subtitle={meta.subtitle}
                searchable
                selectable={false}
              />
            )}
          </Section>
        </>
      )}
    </Page>
  );
};
