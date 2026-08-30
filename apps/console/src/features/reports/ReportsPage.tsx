import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  FactoryVisionApiClient,
  ProductionReportItem,
  DowntimeReportItem,
  ShiftReportItem,
} from '@factory-vision/api-client';
import type { OeeReportItem } from '@factory-vision/domain-types';
import { AdvancedDataTable, ColumnDef, Button, Icon } from '@factory-vision/ui';
import { MetricCard, Page, Section, FilterChip } from '@factory-vision/ui/fv';

const api = new FactoryVisionApiClient({ baseUrl: '' });

export const ReportsPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'production';
  const [dateRange, setDateRange] = useState<string>('TODAY');
  const [oeeDays, setOeeDays] = useState<number>(7);

  const { data: productionReport } = useQuery({
    queryKey: ['report-production', dateRange],
    queryFn: () => api.reports.getProduction(),
  });

  const { data: downtimeReport } = useQuery({
    queryKey: ['report-downtime', dateRange],
    queryFn: () => api.reports.getDowntime(),
  });

  const { data: shiftReport } = useQuery({
    queryKey: ['report-shift', dateRange],
    queryFn: () => api.reports.getShift(),
  });

  // US-041, the OEE report, with its own window so a historical review is not
  // limited to the day filter the other three reports share.
  const { data: oeeReport } = useQuery({
    queryKey: ['report-oee', oeeDays],
    queryFn: () => api.oee.report({ days: oeeDays }),
  });

  const handleExportCsv = async (type: string) => {
    if (type === 'oee') {
      // The OEE report is served through the authenticated client, so it is
      // fetched and saved rather than opened in a tab without a bearer token.
      const csv = await api.oee.reportCsv({ days: oeeDays });
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'oee-report.csv';
      anchor.click();
      URL.revokeObjectURL(url);
      return;
    }
    const url = api.reports.getCsvUrl(type as any);
    window.open(url, '_blank');
  };

  // Totals calculations
  const totalGood = productionReport?.reduce((acc, r) => acc + (r.goodQuantity || 0), 0) || 0;
  const totalReject = productionReport?.reduce((acc, r) => acc + (r.rejectQuantity || 0), 0) || 0;
  const totalDowntime = downtimeReport?.reduce((acc, r) => acc + (r.durationMinutes || 0), 0) || 0;

  // Columns for Production Report
  const prodColumns: ColumnDef<ProductionReportItem & { id: string }>[] = [
    {
      key: 'woNumber',
      header: 'Work Order',
      sortable: true,
      render: (r) => <strong>{r.woNumber}</strong>,
    },
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
    {
      key: 'targetQuantity',
      header: 'Target Produksi',
      sortable: true,
      render: (r) => r.targetQuantity.toLocaleString('en-US'),
    },
    {
      key: 'goodQuantity',
      header: 'Jumlah Good',
      sortable: true,
      render: (r) => (
        <span style={{ color: 'var(--color-success)', fontWeight: 800 }}>
          {r.goodQuantity.toLocaleString('en-US')}
        </span>
      ),
    },
    {
      key: 'rejectQuantity',
      header: 'Jumlah Reject',
      sortable: true,
      render: (r) => (
        <span style={{ color: r.rejectQuantity > 0 ? 'var(--color-error)' : 'inherit', fontWeight: 700 }}>
          {r.rejectQuantity.toLocaleString('en-US')}
        </span>
      ),
    },
    {
      key: 'achievementPct',
      header: 'Pencapaian',
      sortable: true,
      render: (r) => (
        <span
          style={{
            padding: '2px 8px',
            borderRadius: 'var(--radius-pill)',
            fontSize: '11px',
            fontWeight: 800,
            backgroundColor:
              r.achievementPct >= 80 ? 'var(--color-success-container)' : 'var(--color-warning-container)',
            color:
              r.achievementPct >= 80
                ? 'var(--color-on-success-container)'
                : 'var(--color-on-warning-container)',
          }}
        >
          {r.achievementPct}%
        </span>
      ),
    },
  ];

  // Columns for Downtime Report
  const dtColumns: ColumnDef<DowntimeReportItem>[] = [
    { key: 'lineName', header: 'Production Line', sortable: true },
    {
      key: 'machineName',
      header: 'Nama Mesin',
      sortable: true,
      render: (r) => <strong>{r.machineName}</strong>,
    },
    {
      key: 'reasonCategory',
      header: 'Kategori',
      render: (r) => (
        <span
          style={{
            padding: '2px 8px',
            borderRadius: 'var(--radius-pill)',
            fontSize: '10.5px',
            fontWeight: 700,
            backgroundColor: 'var(--color-surface-container)',
          }}
        >
          {r.reasonCategory}
        </span>
      ),
    },
    { key: 'reasonName', header: 'Downtime Reason', sortable: true },
    {
      key: 'durationMinutes',
      header: 'Durasi',
      sortable: true,
      render: (r) => <strong style={{ color: 'var(--color-error)' }}>{r.durationMinutes} mins</strong>,
    },
    { key: 'status', header: 'Status', render: (r) => r.status },
    { key: 'notes', header: 'Catatan Operator', render: (r) => r.notes || '-' },
  ];

  // Columns for Shift Report
  const shiftColumns: ColumnDef<ShiftReportItem & { id: string }>[] = [
    { key: 'lineName', header: 'Production Line', sortable: true },
    {
      key: 'shiftName',
      header: 'Shift',
      sortable: true,
      render: (r) => <strong>{r.shiftName}</strong>,
    },
    { key: 'totalTarget', header: 'Target Produksi', render: (r) => r.totalTarget.toLocaleString('en-US') },
    {
      key: 'totalGood',
      header: 'Jumlah Good',
      render: (r) => (
        <span style={{ color: 'var(--color-success)', fontWeight: 700 }}>
          {r.totalGood.toLocaleString('en-US')}
        </span>
      ),
    },
    {
      key: 'totalReject',
      header: 'Jumlah Reject',
      render: (r) => (
        <span style={{ color: r.totalReject > 0 ? 'var(--color-error)' : 'inherit' }}>
          {r.totalReject.toLocaleString('en-US')}
        </span>
      ),
    },
    { key: 'totalDowntimeMinutes', header: 'Downtime', render: (r) => `${r.totalDowntimeMinutes} mins` },
    {
      key: 'achievementPct',
      header: 'Pencapaian',
      render: (r) => (
        <span
          style={{
            padding: '2px 8px',
            borderRadius: 'var(--radius-pill)',
            fontSize: '11px',
            fontWeight: 800,
            backgroundColor:
              r.achievementPct >= 80 ? 'var(--color-success-container)' : 'var(--color-warning-container)',
            color:
              r.achievementPct >= 80
                ? 'var(--color-on-success-container)'
                : 'var(--color-on-warning-container)',
          }}
        >
          {r.achievementPct}%
        </span>
      ),
    },
  ];

  /**
   * US-041, OEE report columns.
   *
   * `calcVersion` is on the row deliberately: a historical OEE figure is only
   * meaningful next to the definition that produced it, and a row
   * whose Ideal Cycle Time is missing says so rather than showing a zero that
   * reads like genuinely terrible performance.
   */
  const oeeColumns: ColumnDef<OeeReportItem & { id: string }>[] = [
    {
      key: 'shiftDate',
      header: 'Tanggal Shift',
      sortable: true,
      render: (r) => <strong>{r.shiftDate}</strong>,
    },
    { key: 'shiftName', header: 'Shift', sortable: true },
    { key: 'lineName', header: 'Production Line', sortable: true },
    { key: 'machineName', header: 'Mesin', sortable: true, render: (r) => <strong>{r.machineName}</strong> },
    { key: 'processName', header: 'Proses', render: (r) => r.processName || '-' },
    { key: 'productName', header: 'Produk', render: (r) => r.productName || '-' },
    {
      key: 'availability',
      header: 'Availability',
      sortable: true,
      render: (r) => `${r.availability.toFixed(1)}%`,
    },
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
      render: (r) => (
        <span
          style={{
            padding: '2px 8px',
            borderRadius: 'var(--radius-pill)',
            fontSize: '11px',
            fontWeight: 800,
            backgroundColor: r.idealCycleMissing
              ? 'var(--color-surface-container-highest)'
              : r.oee >= 80
                ? 'var(--color-success-container)'
                : r.oee >= 70
                  ? 'var(--color-warning-container)'
                  : 'var(--color-error-container)',
            color: r.idealCycleMissing
              ? 'var(--color-on-surface-variant)'
              : r.oee >= 80
                ? 'var(--color-on-success-container)'
                : r.oee >= 70
                  ? 'var(--color-on-warning-container)'
                  : 'var(--color-on-error-container)',
          }}
        >
          {r.idealCycleMissing ? ', ' : `${r.oee.toFixed(1)}%`}
        </span>
      ),
    },
    {
      key: 'goodQuantity',
      header: 'Good',
      sortable: true,
      render: (r) => r.goodQuantity.toLocaleString('id-ID'),
    },
    {
      key: 'rejectQuantity',
      header: 'Reject',
      sortable: true,
      render: (r) => r.rejectQuantity.toLocaleString('id-ID'),
    },
    { key: 'downtimeMinutes', header: 'Downtime', render: (r) => `${r.downtimeMinutes} mnt` },
    { key: 'calcVersion', header: 'Calc Ver.', render: (r) => `v${r.calcVersion}` },
  ];

  return (
    <Page style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Header with Date Range and CSV Export */}
      <Section style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '11.5px',
              color: 'var(--color-on-surface-variant)',
              fontWeight: 600,
            }}
          >
            <span>Analitik & Laporan</span>
            <span>/</span>
            <span style={{ color: 'var(--color-primary)', fontWeight: 800 }}>
              {activeTab === 'production'
                ? 'Laporan Produksi'
                : activeTab === 'downtime'
                  ? 'Laporan Downtime'
                  : activeTab === 'oee'
                    ? 'OEE Report'
                    : 'Laporan Shift'}
            </span>
          </div>
          <h1
            style={{
              fontSize: '20px',
              fontWeight: 800,
              margin: '4px 0 0',
              color: 'var(--color-on-surface)',
              letterSpacing: '-0.02em',
            }}
          >
            {activeTab === 'production'
              ? 'Laporan Produksi'
              : activeTab === 'downtime'
                ? 'Laporan Downtime'
                : activeTab === 'oee'
                  ? 'Laporan OEE'
                  : 'Laporan Shift'}
          </h1>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          {/* Date Filter Chips */}
          <div
            style={{
              display: 'flex',
              gap: '4px',
              backgroundColor: 'var(--color-surface-container)',
              padding: '3px',
              borderRadius: 'var(--radius-pill)',
            }}
          >
            {activeTab === 'oee'
              ? [7, 14, 30].map((option) => (
                  <FilterChip key={option} selected={oeeDays === option} onClick={() => setOeeDays(option)}>
                    {option} hari
                  </FilterChip>
                ))
              : ['TODAY', 'THIS_WEEK', 'THIS_MONTH'].map((range) => (
                  <FilterChip key={range} selected={dateRange === range} onClick={() => setDateRange(range)}>
                    {range === 'TODAY' ? 'Today' : range === 'THIS_WEEK' ? 'This Week' : 'This Month'}
                  </FilterChip>
                ))}
          </div>

          <Button
            variant="filled"
            icon={<Icon name="download" size={16} />}
            onClick={() => handleExportCsv(activeTab)}
          >
            Export CSV
          </Button>
        </div>
      </Section>

      {/* KPI Cards Summary */}
      <Section
        stagger
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}
      >
        <MetricCard
          label="Jumlah Good"
          value={`${totalGood.toLocaleString('en-US')} PCS`}
          delta="Total actual output"
          deltaType="positive"
          tone="success"
          icon={<Icon name="check_circle" size={18} />}
        />

        <MetricCard
          label="Jumlah Reject"
          value={`${totalReject.toLocaleString('en-US')} PCS`}
          delta={`${((totalReject / (totalGood + totalReject || 1)) * 100).toFixed(1)}% Defect rate`}
          deltaType="negative"
          tone="error"
          icon={<Icon name="cancel" size={18} />}
        />

        <MetricCard
          label="Downtime"
          value={`${totalDowntime} Minutes`}
          delta="Machine stop losses"
          deltaType="negative"
          tone="warning"
          icon={<Icon name="timer" size={18} />}
        />
      </Section>

      {/* Direct Content Rendered without Nested Tab Stacking */}
      {activeTab === 'production' && (
        <AdvancedDataTable
          columns={prodColumns}
          data={(productionReport || []).map((r) => ({ ...r, id: r.workOrderId }))}
          title="Produksi per Work Order"
          subtitle="Target Produksi, Produksi Aktual, dan Pencapaian per Work Order"
          searchable={true}
          selectable={true}
        />
      )}

      {activeTab === 'downtime' && (
        <AdvancedDataTable
          columns={dtColumns}
          data={downtimeReport || []}
          title="Kejadian Downtime"
          subtitle="Riwayat Downtime beserta durasi dan Alasan Downtime"
          searchable={true}
          selectable={true}
        />
      )}

      {activeTab === 'oee' && (
        <AdvancedDataTable
          columns={oeeColumns}
          data={(oeeReport || []).map((r, i) => ({ ...r, id: `oee-${r.shiftDate}-${r.machineId}-${i}` }))}
          title="Laporan OEE"
          subtitle="Availability, Performance, Quality, dan OEE per Mesin, Proses Produksi, dan Shift"
          searchable={true}
          selectable={true}
          expandable={false}
        />
      )}

      {activeTab === 'shift' && (
        <AdvancedDataTable
          columns={shiftColumns}
          data={(shiftReport || []).map((r, i) => ({ ...r, id: `shift-${i}` }))}
          title="Ringkasan Shift"
          subtitle="Rekap Produksi Aktual, Pencapaian, dan Downtime per Shift"
          searchable={true}
          selectable={true}
        />
      )}
    </Page>
  );
};
