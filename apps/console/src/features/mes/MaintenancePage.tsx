import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FactoryVisionApiClient } from '@factory-vision/api-client';
import { AdvancedDataTable, Button, ColumnDef, FilledTextField, Icon, Select } from '@factory-vision/ui';
import { Page, Section, SurfaceCard, Dialog } from '@factory-vision/ui/fv';
import type {
  MaintenancePlan,
  MaintenanceRecord,
  MaintenanceRequest,
} from '@factory-vision/domain-types';
import { useSession } from '../../app/SessionContext.js';
import {
  EmptyState,
  Field,
  KpiRow,
  KpiTile,
  PageHeading,
  StatusPill,
  TabStrip,
  fmt,
  fmtDate,
  fmtDateTime,
} from './shared.js';

const api = new FactoryVisionApiClient({ baseUrl: '' });

type Tab = 'records' | 'plans' | 'requests';

/**
 * Maintenance (Improvement PRD §5, §21's Maintenance group, §22.3).
 *
 * Three kinds of work in one list, because MTBF and MTTR are computed across
 * all of them and a technician's day contains all three. The type is a column,
 * not a tab.
 *
 * The emergency button is deliberately prominent and deliberately confirmed:
 * pressing it takes a machine out of production and opens a downtime record on
 * the spot (BR-MT03).
 */
export const MaintenancePage: React.FC = () => {
  const queryClient = useQueryClient();
  const { can } = useSession();
  const [tab, setTab] = useState<Tab>('records');
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [completing, setCompleting] = useState<MaintenanceRecord | null>(null);
  const [planOpen, setPlanOpen] = useState(false);

  const { data: kpi } = useQuery({
    queryKey: ['maintenance-kpi'],
    queryFn: () => api.maintenance.getKpi(),
    refetchInterval: 60_000,
  });
  const { data: records, isLoading } = useQuery({
    queryKey: ['maintenance-records'],
    queryFn: () => api.maintenance.getRecords({ limit: 300 }),
    refetchInterval: 30_000,
  });
  const { data: plans } = useQuery({
    queryKey: ['maintenance-plans'],
    queryFn: () => api.maintenance.getPlans(),
    refetchInterval: 120_000,
  });
  const { data: requests } = useQuery({
    queryKey: ['maintenance-requests'],
    queryFn: () => api.maintenance.getRequests({ limit: 200 }),
    enabled: tab === 'requests',
  });
  const { data: machines } = useQuery({
    queryKey: ['machines'],
    queryFn: () => api.master.getMachines(),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['maintenance-records'] });
    queryClient.invalidateQueries({ queryKey: ['maintenance-plans'] });
    queryClient.invalidateQueries({ queryKey: ['maintenance-requests'] });
    queryClient.invalidateQueries({ queryKey: ['maintenance-kpi'] });
  };

  const startWork = useMutation({ mutationFn: (id: string) => api.maintenance.startWork(id), onSuccess: invalidate });
  const generate = useMutation({ mutationFn: () => api.maintenance.generateDueWork(), onSuccess: invalidate });
  const acceptRequest = useMutation({
    mutationFn: (id: string) => api.maintenance.acceptRequest(id),
    onSuccess: invalidate,
  });

  const recordColumns: ColumnDef<MaintenanceRecord>[] = [
    { key: 'maintenanceNumber', header: 'No.', sortable: true },
    {
      key: 'maintenanceType',
      header: 'Jenis',
      sortable: true,
      render: (row) => <StatusPill status={row.maintenanceType} />,
    },
    { key: 'machineName', header: 'Mesin', sortable: true },
    { key: 'problem', header: 'Masalah', sortable: false, render: (row) => row.problem ?? '—' },
    {
      key: 'technicianName',
      header: 'Teknisi',
      sortable: true,
      render: (row) => row.technicianName ?? 'Belum ditugaskan',
    },
    {
      key: 'startedAt',
      header: 'Mulai',
      sortable: true,
      render: (row) => fmtDateTime(row.startedAt ?? row.scheduledFor),
    },
    {
      key: 'durationMinutes',
      header: 'Durasi',
      sortable: true,
      render: (row) => (row.durationMinutes === undefined ? '—' : `${fmt(row.durationMinutes)} menit`),
    },
    { key: 'status', header: 'Status', sortable: true, render: (row) => <StatusPill status={row.status} /> },
  ];

  const planColumns: ColumnDef<MaintenancePlan>[] = [
    { key: 'planNumber', header: 'No.', sortable: true },
    { key: 'name', header: 'Rencana', sortable: true },
    { key: 'machineName', header: 'Mesin', sortable: true },
    {
      key: 'triggerType',
      header: 'Pemicu',
      sortable: true,
      render: (row) => `${row.triggerType} · setiap ${fmt(row.intervalValue)} ${row.intervalUnit}`,
    },
    {
      key: 'lastPerformedAt',
      header: 'Terakhir',
      sortable: true,
      render: (row) => fmtDate(row.lastPerformedAt),
    },
    {
      key: 'nextDueAt',
      header: 'Jatuh Tempo',
      sortable: true,
      render: (row) =>
        row.triggerType === 'CALENDAR' ? fmtDate(row.nextDueAt) : `${fmt(row.nextDueMeter)} ${row.intervalUnit}`,
    },
    {
      key: 'dueStatus',
      header: 'Status',
      sortable: true,
      render: (row) => <StatusPill status={row.dueStatus ?? row.status} />,
    },
  ];

  const requestColumns: ColumnDef<MaintenanceRequest>[] = [
    { key: 'requestNumber', header: 'No.', sortable: true },
    { key: 'requestedAt', header: 'Dilaporkan', sortable: true, render: (row) => fmtDateTime(row.requestedAt) },
    { key: 'machineName', header: 'Mesin', sortable: true },
    { key: 'problemDescription', header: 'Masalah', sortable: false },
    {
      key: 'priority',
      header: 'Prioritas',
      sortable: true,
      render: (row) => <StatusPill status={row.priority} />,
    },
    {
      key: 'requestedByName',
      header: 'Pelapor',
      sortable: true,
      render: (row) => row.requestedByName ?? row.requestedBy,
    },
    { key: 'status', header: 'Status', sortable: true, render: (row) => <StatusPill status={row.status} /> },
  ];

  const overduePlans = (plans ?? []).filter((plan) => plan.dueStatus === 'OVERDUE').length;
  const duePlans = (plans ?? []).filter((plan) => plan.dueStatus === 'DUE').length;

  return (
    <Page>
      <Section>
        <PageHeading
          title="Maintenance"
          subtitle="Preventive, corrective, dan emergency dalam satu riwayat. Emergency maintenance otomatis membuka downtime dan menonaktifkan mesin."
          actions={
            <>
              {can('maintenance:create') ? (
                <Button variant="outlined" onClick={() => generate.mutate()} disabled={generate.isPending}>
                  <Icon name="event_repeat" size={18} />
                  Terbitkan PM Jatuh Tempo
                </Button>
              ) : null}
              {can('maintenance:execute') ? (
                <Button variant="filled" onClick={() => setEmergencyOpen(true)}>
                  <Icon name="e911_emergency" size={18} />
                  Emergency
                </Button>
              ) : null}
            </>
          }
        />
      </Section>

      <Section>
        <KpiRow>
          <KpiTile
            label="Machine Availability"
            value={kpi ? `${kpi.machineAvailabilityPercentage.toFixed(1)}%` : '—'}
            caption="Jam operasi ÷ jam tersedia"
            tone={kpi && kpi.machineAvailabilityPercentage < 90 ? 'warning' : 'success'}
            icon="precision_manufacturing"
          />
          <KpiTile
            label="PM Compliance"
            value={kpi ? `${kpi.pmCompliancePercentage.toFixed(0)}%` : '—'}
            caption={`${duePlans} due · ${overduePlans} overdue`}
            tone={overduePlans > 0 ? 'error' : 'success'}
            icon="event_available"
          />
          <KpiTile
            label="MTBF"
            value={kpi ? `${fmt(kpi.mtbfHours, 1)} jam` : '—'}
            caption="Jam operasi ÷ jumlah kegagalan"
            tone="info"
            icon="timeline"
          />
          <KpiTile
            label="MTTR"
            value={kpi ? `${fmt(kpi.mttrHours, 2)} jam` : '—'}
            caption="Waktu perbaikan ÷ jumlah kegagalan"
            tone="chart-2"
            icon="build"
          />
          <KpiTile
            label="Breakdown"
            value={kpi ? fmt(kpi.breakdownCount) : '—'}
            caption={kpi ? `${fmt(kpi.emergencyCount)} emergency` : ''}
            tone={kpi && kpi.emergencyCount > 0 ? 'error' : 'success'}
            icon="warning"
          />
        </KpiRow>
      </Section>

      <Section>
        <TabStrip
          active={tab}
          onChange={(key) => setTab(key as Tab)}
          tabs={[
            { key: 'records', label: 'Pekerjaan Maintenance', icon: 'build' },
            { key: 'plans', label: 'Preventive Plan', icon: 'event_repeat' },
            { key: 'requests', label: 'Permintaan', icon: 'assignment' },
          ]}
        />
      </Section>

      <Section>
        {tab === 'records' &&
          (!isLoading && (records ?? []).length === 0 ? (
            <SurfaceCard padding="lg">
              <EmptyState
                icon="build"
                title="Belum ada pekerjaan maintenance"
                description="Buat Preventive Plan lalu terbitkan pekerjaan yang jatuh tempo, atau catat permintaan maintenance dari shop floor."
              />
            </SurfaceCard>
          ) : (
            <AdvancedDataTable
              columns={recordColumns}
              data={records ?? []}
              title="Riwayat Pekerjaan Maintenance"
              subtitle="Penyelesaian wajib mencantumkan hasil; durasi dihitung dari waktu mulai sampai selesai."
              searchable
              selectable={false}
              expandable
              renderExpandedRow={(row) => (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                      gap: 'var(--space-3)',
                    }}
                  >
                    <Field label="Root Cause">{row.rootCause ?? '—'}</Field>
                    <Field label="Tindakan">{row.actionTaken ?? '—'}</Field>
                    <Field label="Hasil">{row.result ?? '—'}</Field>
                    <Field label="Downtime Terkait">{row.downtimeId ?? '—'}</Field>
                    <Field label="Spare Part">
                      {row.parts.length === 0
                        ? '—'
                        : row.parts.map((part) => `${part.partName} ×${fmt(part.quantity, 2)}`).join(', ')}
                    </Field>
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                    {row.status !== 'COMPLETED' && row.status !== 'IN_PROGRESS' && can('maintenance:execute') ? (
                      <Button
                        variant="tonal"
                        size="sm"
                        onClick={() => startWork.mutate(row.id)}
                        disabled={startWork.isPending}
                      >
                        <Icon name="play_arrow" size={16} />
                        Mulai Pekerjaan
                      </Button>
                    ) : null}
                    {row.status !== 'COMPLETED' && can('maintenance:complete') ? (
                      <Button variant="filled" size="sm" onClick={() => setCompleting(row)}>
                        <Icon name="task_alt" size={16} />
                        Selesaikan
                      </Button>
                    ) : null}
                  </div>
                </div>
              )}
            />
          ))}

        {tab === 'plans' && (
          <>
            {can('maintenance:create') ? (
              <div style={{ marginBottom: 'var(--space-3)' }}>
                <Button variant="tonal" onClick={() => setPlanOpen(true)}>
                  <Icon name="add" size={18} />
                  Preventive Plan Baru
                </Button>
              </div>
            ) : null}
            <AdvancedDataTable
              columns={planColumns}
              data={plans ?? []}
              title="Preventive Maintenance Plan"
              subtitle="Status dihitung saat dibaca: sebuah rencana menjadi OVERDUE karena waktu berjalan, bukan karena ada yang mengubahnya."
              searchable
              selectable={false}
              expandable
              renderExpandedRow={(row) => (
                <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
                  Tugas: {row.tasks.length > 0 ? row.tasks.join(', ') : '—'}
                  {row.estimatedDurationMinutes ? ` · estimasi ${row.estimatedDurationMinutes} menit` : ''}
                </div>
              )}
            />
          </>
        )}

        {tab === 'requests' && (
          <AdvancedDataTable
            columns={requestColumns}
            data={requests ?? []}
            title="Permintaan Maintenance"
            subtitle="Permintaan yang diterima menjadi pekerjaan maintenance dengan nomor tersendiri."
            searchable
            selectable={false}
            expandable
            renderExpandedRow={(row) =>
              row.status === 'REQUESTED' && can('maintenance:assign') ? (
                <Button
                  variant="filled"
                  size="sm"
                  onClick={() => acceptRequest.mutate(row.id)}
                  disabled={acceptRequest.isPending}
                >
                  <Icon name="check" size={16} />
                  Terima & Buat Pekerjaan
                </Button>
              ) : (
                <span style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
                  {row.reportedSymptom ?? 'Tidak ada gejala tambahan yang dilaporkan.'}
                </span>
              )
            }
          />
        )}
      </Section>

      {emergencyOpen ? (
        <EmergencyDialog
          machines={(machines ?? []).map((machine) => ({ value: machine.id, label: machine.name }))}
          onClose={() => setEmergencyOpen(false)}
          onDone={() => {
            setEmergencyOpen(false);
            invalidate();
          }}
        />
      ) : null}

      {completing ? (
        <CompleteDialog
          record={completing}
          onClose={() => setCompleting(null)}
          onDone={() => {
            setCompleting(null);
            invalidate();
          }}
        />
      ) : null}

      {planOpen ? (
        <PlanDialog
          machines={(machines ?? []).map((machine) => ({ value: machine.id, label: machine.name }))}
          onClose={() => setPlanOpen(false)}
          onDone={() => {
            setPlanOpen(false);
            invalidate();
          }}
        />
      ) : null}
    </Page>
  );
};

/** §5.4 — one call opens the downtime, the record, and takes the machine off. */
const EmergencyDialog: React.FC<{
  machines: Array<{ value: string; label: string }>;
  onClose: () => void;
  onDone: () => void;
}> = ({ machines, onClose, onDone }) => {
  const [machineId, setMachineId] = useState(machines[0]?.value ?? '');
  const [problem, setProblem] = useState('');

  const raise = useMutation({
    mutationFn: () => api.maintenance.raiseEmergency({ machineId, problem }),
    onSuccess: onDone,
  });

  return (
    <Dialog
      isOpen
      onClose={onClose}
      title="Emergency Maintenance"
      supportingText="Mesin akan berstatus OFFLINE dan sebuah downtime record dibuka otomatis. Downtime ditutup ketika pekerjaan diselesaikan."
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <Select label="Mesin" value={machineId} onChange={setMachineId} options={machines} searchable />
        <FilledTextField
          label="Masalah"
          value={problem}
          onChange={(e) => setProblem(e.target.value)}
          supportingText="Jelaskan kerusakan yang menghentikan produksi."
        />
        {raise.isError ? (
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--color-error)' }}>
            {(raise.error as Error).message}
          </p>
        ) : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
          <Button variant="text" onClick={onClose}>
            Batal
          </Button>
          <Button
            variant="filled"
            onClick={() => raise.mutate()}
            disabled={raise.isPending || !machineId || problem.trim().length < 3}
          >
            Buka Emergency
          </Button>
        </div>
      </div>
    </Dialog>
  );
};

/** BR-MT05 — completion states a result, and the form will not submit without one. */
const CompleteDialog: React.FC<{
  record: MaintenanceRecord;
  onClose: () => void;
  onDone: () => void;
}> = ({ record, onClose, onDone }) => {
  const [result, setResult] = useState<'REPAIRED' | 'REPLACED' | 'ADJUSTED' | 'NO_FAULT_FOUND' | 'DEFERRED'>(
    'REPAIRED'
  );
  const [rootCause, setRootCause] = useState('');
  const [actionTaken, setActionTaken] = useState('');
  const [meterReading, setMeterReading] = useState('');

  const complete = useMutation({
    mutationFn: () =>
      api.maintenance.completeWork(record.id, {
        result,
        rootCause: rootCause || undefined,
        actionTaken: actionTaken || undefined,
        meterReading: meterReading === '' ? undefined : Number(meterReading),
      }),
    onSuccess: onDone,
  });

  return (
    <Dialog
      isOpen
      onClose={onClose}
      title={`Selesaikan ${record.maintenanceNumber}`}
      supportingText={`${record.machineName}. Mesin kembali tersedia dan downtime terkait ditutup setelah pekerjaan diselesaikan.`}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <Select
          label="Hasil"
          value={result}
          onChange={(value) => setResult(value as typeof result)}
          options={[
            { value: 'REPAIRED', label: 'Repaired — diperbaiki' },
            { value: 'REPLACED', label: 'Replaced — komponen diganti' },
            { value: 'ADJUSTED', label: 'Adjusted — disetel ulang' },
            { value: 'NO_FAULT_FOUND', label: 'No Fault Found — tidak ditemukan kerusakan' },
            { value: 'DEFERRED', label: 'Deferred — ditunda' },
          ]}
        />
        <FilledTextField label="Root Cause" value={rootCause} onChange={(e) => setRootCause(e.target.value)} />
        <FilledTextField
          label="Tindakan"
          value={actionTaken}
          onChange={(e) => setActionTaken(e.target.value)}
        />
        <FilledTextField
          label="Pembacaan Meter (opsional)"
          type="number"
          value={meterReading}
          onChange={(e) => setMeterReading(e.target.value)}
          supportingText="Untuk rencana berbasis jam operasi atau siklus produksi, menentukan jatuh tempo berikutnya."
        />
        {complete.isError ? (
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--color-error)' }}>
            {(complete.error as Error).message}
          </p>
        ) : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
          <Button variant="text" onClick={onClose}>
            Batal
          </Button>
          <Button variant="filled" onClick={() => complete.mutate()} disabled={complete.isPending}>
            Selesaikan Pekerjaan
          </Button>
        </div>
      </div>
    </Dialog>
  );
};

/** §5.2 — a plan is a machine, a trigger, an interval and a task list. */
const PlanDialog: React.FC<{
  machines: Array<{ value: string; label: string }>;
  onClose: () => void;
  onDone: () => void;
}> = ({ machines, onClose, onDone }) => {
  const [name, setName] = useState('');
  const [machineId, setMachineId] = useState(machines[0]?.value ?? '');
  const [triggerType, setTriggerType] = useState<'CALENDAR' | 'OPERATING_HOURS' | 'PRODUCTION_CYCLES'>(
    'CALENDAR'
  );
  const [intervalValue, setIntervalValue] = useState('30');
  const [tasks, setTasks] = useState('');

  const create = useMutation({
    mutationFn: () =>
      api.maintenance.createPlan({
        name,
        machineId,
        triggerType,
        intervalValue: Number(intervalValue),
        intervalUnit: triggerType === 'CALENDAR' ? 'DAY' : triggerType === 'OPERATING_HOURS' ? 'HOUR' : 'CYCLE',
        tasks: tasks
          .split(',')
          .map((task) => task.trim())
          .filter(Boolean),
      }),
    onSuccess: onDone,
  });

  return (
    <Dialog
      isOpen
      onClose={onClose}
      title="Preventive Maintenance Plan"
      supportingText="Rencana kalender jatuh tempo setiap sekian hari; rencana berbasis meter jatuh tempo setiap sekian jam operasi atau siklus produksi."
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <FilledTextField label="Nama Rencana" value={name} onChange={(e) => setName(e.target.value)} />
        <Select label="Mesin" value={machineId} onChange={setMachineId} options={machines} searchable />
        <Select
          label="Pemicu"
          value={triggerType}
          onChange={(value) => setTriggerType(value as typeof triggerType)}
          options={[
            { value: 'CALENDAR', label: 'Kalender (hari)' },
            { value: 'OPERATING_HOURS', label: 'Jam operasi' },
            { value: 'PRODUCTION_CYCLES', label: 'Siklus produksi' },
          ]}
        />
        <FilledTextField
          label="Interval"
          type="number"
          value={intervalValue}
          onChange={(e) => setIntervalValue(e.target.value)}
          supportingText={
            triggerType === 'CALENDAR'
              ? 'Jumlah hari antar perawatan.'
              : triggerType === 'OPERATING_HOURS'
                ? 'Jumlah jam operasi antar perawatan.'
                : 'Jumlah siklus produksi antar perawatan.'
          }
        />
        <FilledTextField
          label="Tugas"
          value={tasks}
          onChange={(e) => setTasks(e.target.value)}
          supportingText="Pisahkan dengan koma, misalnya: Lubrikasi, Inspeksi, Pembersihan."
        />
        {create.isError ? (
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--color-error)' }}>
            {(create.error as Error).message}
          </p>
        ) : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
          <Button variant="text" onClick={onClose}>
            Batal
          </Button>
          <Button
            variant="filled"
            onClick={() => create.mutate()}
            disabled={create.isPending || name.trim().length < 2 || !machineId || Number(intervalValue) <= 0}
          >
            Simpan Rencana
          </Button>
        </div>
      </div>
    </Dialog>
  );
};
