import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FactoryVisionApiClient } from '@factory-vision/api-client';
import { Button, ColumnDef, FilledTextField, Icon, Select } from '@factory-vision/ui';
import { DataTable, Page, Section, SurfaceCard, Dialog } from '@factory-vision/ui/fv';
import type {
  LaborUtilization,
  OperatorAvailability,
  OperatorQualification,
  OperatorShiftAssignment,
  QualificationRequirement,
  Skill,
} from '@factory-vision/domain-types';
import { useSession } from '../../app/SessionContext.js';
import {
  EmptyState,
  KpiRow,
  KpiTile,
  PageHeading,
  StatusPill,
  TabStrip,
  fmt,
  fmtDate,
} from './shared.js';

const api = new FactoryVisionApiClient({ baseUrl: '' });

type Tab = 'availability' | 'qualifications' | 'skills' | 'requirements' | 'shifts' | 'utilization';

/**
 * Workforce (Improvement PRD §6, §21's Workforce group, §22.4).
 *
 * Availability leads because it is the question asked most often and answered
 * fastest: who can I put on this machine right now. Qualification, skill and
 * requirement sit behind it in the order somebody sets them up.
 */
export const WorkforcePage: React.FC = () => {
  const queryClient = useQueryClient();
  const { can } = useSession();
  const [tab, setTab] = useState<Tab>('availability');
  const [qualifying, setQualifying] = useState(false);
  const [addingSkill, setAddingSkill] = useState(false);
  const [changingState, setChangingState] = useState<OperatorAvailability | null>(null);

  const { data: dashboard } = useQuery({
    queryKey: ['workforce-dashboard'],
    queryFn: () => api.workforce.getDashboard(),
    refetchInterval: 60_000,
  });
  const { data: availability, isLoading } = useQuery({
    queryKey: ['workforce-availability'],
    queryFn: () => api.workforce.getAvailability(),
    refetchInterval: 30_000,
  });
  const { data: qualifications } = useQuery({
    queryKey: ['workforce-qualifications'],
    queryFn: () => api.workforce.getQualifications(),
  });
  const { data: skills } = useQuery({ queryKey: ['workforce-skills'], queryFn: () => api.workforce.getSkills() });
  const { data: requirements } = useQuery({
    queryKey: ['workforce-requirements'],
    queryFn: () => api.workforce.getRequirements(),
    enabled: tab === 'requirements',
  });
  const { data: shiftAssignments } = useQuery({
    queryKey: ['workforce-shift-assignments'],
    queryFn: () => api.workforce.getShiftAssignments(),
    enabled: tab === 'shifts',
  });
  const { data: utilization } = useQuery({
    queryKey: ['workforce-utilization'],
    queryFn: () => api.workforce.getUtilization({ scope: 'OPERATOR' }),
    enabled: tab === 'utilization',
  });
  const { data: operators } = useQuery({
    queryKey: ['operators'],
    queryFn: () => api.master.getOperators(),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['workforce-availability'] });
    queryClient.invalidateQueries({ queryKey: ['workforce-qualifications'] });
    queryClient.invalidateQueries({ queryKey: ['workforce-skills'] });
    queryClient.invalidateQueries({ queryKey: ['workforce-dashboard'] });
  };

  const availabilityColumns: ColumnDef<OperatorAvailability>[] = [
    { key: 'operatorName', header: 'Operator', sortable: true },
    { key: 'state', header: 'Status', sortable: true, render: (row) => <StatusPill status={row.state} /> },
    { key: 'shiftName', header: 'Shift', sortable: true, render: (row) => row.shiftName ?? '—' },
    { key: 'reason', header: 'Keterangan', sortable: false, render: (row) => row.reason ?? '—' },
    {
      key: 'qualifications',
      header: 'Kualifikasi Aktif',
      sortable: false,
      render: (row) =>
        (qualifications ?? []).filter((q) => q.operatorId === row.operatorId && q.status === 'ACTIVE').length,
    },
  ];

  const qualificationColumns: ColumnDef<OperatorQualification>[] = [
    { key: 'operatorName', header: 'Operator', sortable: true },
    {
      key: 'skillCode',
      header: 'Skill',
      sortable: true,
      render: (row) => (
        <div>
          <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--color-on-surface)' }}>
            {row.skillCode}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>{row.skillName}</div>
        </div>
      ),
    },
    { key: 'level', header: 'Level', sortable: true, render: (row) => `Level ${row.level}` },
    { key: 'certifiedDate', header: 'Sertifikasi', sortable: true, render: (row) => fmtDate(row.certifiedDate) },
    {
      key: 'expiryDate',
      header: 'Kedaluwarsa',
      sortable: true,
      render: (row) => (row.expiryDate ? fmtDate(row.expiryDate) : 'Tidak kedaluwarsa'),
    },
    { key: 'issuer', header: 'Penerbit', sortable: true, render: (row) => row.issuer ?? '—' },
    { key: 'status', header: 'Status', sortable: true, render: (row) => <StatusPill status={row.status} /> },
  ];

  const skillColumns: ColumnDef<Skill>[] = [
    { key: 'code', header: 'Kode', sortable: true },
    { key: 'name', header: 'Nama Skill', sortable: true },
    { key: 'category', header: 'Kategori', sortable: true, render: (row) => row.category ?? '—' },
    { key: 'maxLevel', header: 'Level Maks', sortable: true },
    {
      key: 'holders',
      header: 'Pemegang Aktif',
      sortable: false,
      render: (row) =>
        (qualifications ?? []).filter((q) => q.skillId === row.id && q.status === 'ACTIVE').length,
    },
  ];

  const requirementColumns: ColumnDef<QualificationRequirement>[] = [
    { key: 'targetType', header: 'Target', sortable: true },
    { key: 'targetName', header: 'Nama', sortable: true },
    { key: 'skillCode', header: 'Skill', sortable: true },
    { key: 'minimumLevel', header: 'Level Minimum', sortable: true, render: (row) => `Level ${row.minimumLevel}` },
    {
      key: 'mandatory',
      header: 'Sifat',
      sortable: true,
      render: (row) =>
        row.mandatory ? (
          <StatusPill status="WAJIB" tone="warning" />
        ) : (
          <StatusPill status="Anjuran" tone="neutral" />
        ),
    },
  ];

  const shiftColumns: ColumnDef<OperatorShiftAssignment>[] = [
    { key: 'operatorName', header: 'Operator', sortable: true },
    { key: 'shiftName', header: 'Shift', sortable: true },
    { key: 'effectiveFrom', header: 'Berlaku Dari', sortable: true, render: (row) => fmtDate(row.effectiveFrom) },
    {
      key: 'effectiveTo',
      header: 'Sampai',
      sortable: true,
      render: (row) => (row.effectiveTo ? fmtDate(row.effectiveTo) : 'Tanpa batas'),
    },
    {
      key: 'isDefault',
      header: 'Default',
      sortable: true,
      render: (row) => (row.isDefault ? <StatusPill status="Default" tone="info" /> : '—'),
    },
  ];

  const utilizationColumns: ColumnDef<LaborUtilization & { id: string }>[] = [
    { key: 'scopeName', header: 'Operator', sortable: true },
    {
      key: 'productiveMinutes',
      header: 'Menit Produktif',
      sortable: true,
      render: (row) => fmt(row.productiveMinutes, 1),
    },
    {
      key: 'availableMinutes',
      header: 'Menit Tersedia',
      sortable: true,
      render: (row) => fmt(row.availableMinutes, 1),
    },
    {
      key: 'utilizationPercentage',
      header: 'Utilisasi',
      sortable: true,
      render: (row) => (
        <span
          style={{
            fontWeight: 800,
            color:
              row.utilizationPercentage >= 80
                ? 'var(--color-success)'
                : row.utilizationPercentage >= 60
                  ? 'var(--color-warning)'
                  : 'var(--color-error)',
          }}
        >
          {row.utilizationPercentage.toFixed(1)}%
        </span>
      ),
    },
  ];

  return (
    <Page>
      <Section>
        <PageHeading
          title="Workforce & Labor"
          subtitle="Siapa yang qualified, siapa yang available, dan berapa utilisasi tenaga kerja. Operator tanpa kualifikasi yang berlaku tidak dapat ditugaskan."
          actions={
            <>
              {can('workforce:manage') ? (
                <Button variant="outlined" onClick={() => setAddingSkill(true)}>
                  <Icon name="workspace_premium" size={18} />
                  Skill Baru
                </Button>
              ) : null}
              {can('workforce:qualification') ? (
                <Button variant="filled" onClick={() => setQualifying(true)}>
                  <Icon name="add" size={18} />
                  Catat Kualifikasi
                </Button>
              ) : null}
            </>
          }
        />
      </Section>

      <Section>
        <KpiRow>
          <KpiTile
            label="Operator Available"
            value={dashboard ? fmt(dashboard.operatorsAvailable) : '—'}
            caption={dashboard ? `dari ${fmt(dashboard.operatorsTotal)} operator aktif` : ''}
            tone="success"
            icon="how_to_reg"
          />
          <KpiTile
            label="Sedang Ditugaskan"
            value={dashboard ? fmt(dashboard.operatorsAssigned) : '—'}
            caption="Terikat pada work order"
            tone="info"
            icon="engineering"
          />
          <KpiTile
            label="Tidak Tersedia"
            value={dashboard ? fmt(dashboard.operatorsUnavailable) : '—'}
            caption="Absen, cuti, sakit, atau offline"
            tone={dashboard && dashboard.operatorsUnavailable > 0 ? 'warning' : 'neutral'}
            icon="person_off"
          />
          <KpiTile
            label="Kualifikasi Kedaluwarsa"
            value={dashboard ? fmt(dashboard.qualificationsExpired) : '—'}
            caption={dashboard ? `${fmt(dashboard.qualificationsExpiringSoon)} kedaluwarsa < 30 hari` : ''}
            tone={dashboard && dashboard.qualificationsExpired > 0 ? 'error' : 'success'}
            icon="event_busy"
          />
          <KpiTile
            label="Labor Utilization"
            value={dashboard ? `${dashboard.utilizationPercentage.toFixed(1)}%` : '—'}
            caption="Waktu produktif ÷ waktu tersedia"
            tone="chart-2"
            icon="timelapse"
          />
        </KpiRow>
      </Section>

      <Section>
        <TabStrip
          active={tab}
          onChange={(key) => setTab(key as Tab)}
          tabs={[
            { key: 'availability', label: 'Ketersediaan', icon: 'how_to_reg' },
            { key: 'qualifications', label: 'Kualifikasi', icon: 'workspace_premium' },
            { key: 'skills', label: 'Skill', icon: 'school' },
            { key: 'requirements', label: 'Syarat Mesin & Proses', icon: 'rule' },
            { key: 'shifts', label: 'Penugasan Shift', icon: 'schedule' },
            { key: 'utilization', label: 'Utilisasi', icon: 'timelapse' },
          ]}
        />
      </Section>

      <Section>
        {tab === 'availability' &&
          (!isLoading && (availability ?? []).length === 0 ? (
            <SurfaceCard padding="lg">
              <EmptyState
                icon="how_to_reg"
                title="Belum ada operator aktif"
                description="Tambahkan operator pada master data terlebih dahulu; status ketersediaan akan muncul di sini dan dapat diubah per operator."
              />
            </SurfaceCard>
          ) : (
            <DataTable
              columns={availabilityColumns}
              data={availability ?? []}
              title="Ketersediaan Operator"
              subtitle="Operator yang tidak AVAILABLE atau ASSIGNED tidak dapat ditugaskan ke work order baru."
              searchable
              expandable
              renderExpandedRow={(row) =>
                can('workforce:availability') ? (
                  <Button variant="tonal" size="sm" onClick={() => setChangingState(row)}>
                    <Icon name="edit" size={16} />
                    Ubah Status
                  </Button>
                ) : (
                  <span style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
                    Berlaku sejak {fmtDate(row.effectiveFrom)}.
                  </span>
                )
              }
            />
          ))}

        {tab === 'qualifications' && (
          <DataTable
            columns={qualificationColumns}
            data={qualifications ?? []}
            title="Kualifikasi Operator"
            subtitle="Status dihitung saat dibaca: sertifikat yang tanggal kedaluwarsanya lewat otomatis menjadi EXPIRED."
            searchable
          />
        )}

        {tab === 'skills' && (
          <DataTable
            columns={skillColumns}
            data={skills ?? []}
            title="Master Skill"
            subtitle="Skill adalah satuan kualifikasi: operator memilikinya pada suatu level, mesin dan proses mensyaratkannya pada level minimum."
            searchable
          />
        )}

        {tab === 'requirements' && (
          <DataTable
            columns={requirementColumns}
            data={requirements ?? []}
            title="Syarat Kualifikasi"
            subtitle="Syarat wajib memblokir penugasan; syarat anjuran hanya ditampilkan sebagai peringatan."
            searchable
          />
        )}

        {tab === 'shifts' && (
          <DataTable
            columns={shiftColumns}
            data={shiftAssignments ?? []}
            title="Penugasan Shift"
            subtitle="Penugasan berlaku pada rentang tanggal; shift default dipakai ketika tidak ada penugasan khusus."
            searchable
          />
        )}

        {tab === 'utilization' && (
          <DataTable
            columns={utilizationColumns}
            data={(utilization ?? []).map((row) => ({ ...row, id: row.scopeId }))}
            title="Utilisasi Tenaga Kerja"
            subtitle="Utilisasi = Waktu Produktif ÷ Waktu Tersedia × 100, dihitung dari labor time record."
            searchable
          />
        )}
      </Section>

      {qualifying ? (
        <QualificationDialog
          operators={(operators ?? []).map((operator) => ({ value: operator.id, label: operator.name }))}
          skills={skills ?? []}
          onClose={() => setQualifying(false)}
          onDone={() => {
            setQualifying(false);
            invalidate();
          }}
        />
      ) : null}

      {addingSkill ? (
        <SkillDialog
          onClose={() => setAddingSkill(false)}
          onDone={() => {
            setAddingSkill(false);
            invalidate();
          }}
        />
      ) : null}

      {changingState ? (
        <AvailabilityDialog
          availability={changingState}
          onClose={() => setChangingState(null)}
          onDone={() => {
            setChangingState(null);
            invalidate();
          }}
        />
      ) : null}
    </Page>
  );
};

/** US-W001 — one operator holds one skill at one level, until it expires. */
const QualificationDialog: React.FC<{
  operators: Array<{ value: string; label: string }>;
  skills: Skill[];
  onClose: () => void;
  onDone: () => void;
}> = ({ operators, skills, onClose, onDone }) => {
  const [operatorId, setOperatorId] = useState(operators[0]?.value ?? '');
  const [skillId, setSkillId] = useState(skills[0]?.id ?? '');
  const [level, setLevel] = useState('1');
  const [expiryDate, setExpiryDate] = useState('');
  const [issuer, setIssuer] = useState('');

  const save = useMutation({
    mutationFn: () =>
      api.workforce.setQualification({
        operatorId,
        skillId,
        level: Number(level),
        expiryDate: expiryDate || undefined,
        issuer: issuer || undefined,
      }),
    onSuccess: onDone,
  });

  const skill = skills.find((item) => item.id === skillId);

  return (
    <Dialog
      isOpen
      onClose={onClose}
      title="Catat Kualifikasi Operator"
      supportingText="Kualifikasi tanpa tanggal kedaluwarsa berlaku selamanya. Yang kedaluwarsa otomatis tidak berlaku untuk penugasan."
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <Select label="Operator" value={operatorId} onChange={setOperatorId} options={operators} searchable />
        <Select
          label="Skill"
          value={skillId}
          onChange={setSkillId}
          options={skills.map((item) => ({ value: item.id, label: `${item.code} — ${item.name}` }))}
          searchable
        />
        <FilledTextField
          label="Level"
          type="number"
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          supportingText={skill ? `Antara 1 dan ${skill.maxLevel}.` : undefined}
        />
        <FilledTextField
          label="Tanggal Kedaluwarsa (opsional)"
          type="date"
          value={expiryDate}
          onChange={(e) => setExpiryDate(e.target.value)}
        />
        <FilledTextField label="Penerbit" value={issuer} onChange={(e) => setIssuer(e.target.value)} />
        {save.isError ? (
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--color-error)' }}>
            {(save.error as Error).message}
          </p>
        ) : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
          <Button variant="text" onClick={onClose}>
            Batal
          </Button>
          <Button
            variant="filled"
            onClick={() => save.mutate()}
            disabled={save.isPending || !operatorId || !skillId}
          >
            Simpan Kualifikasi
          </Button>
        </div>
      </div>
    </Dialog>
  );
};

const SkillDialog: React.FC<{ onClose: () => void; onDone: () => void }> = ({ onClose, onDone }) => {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [maxLevel, setMaxLevel] = useState('3');

  const create = useMutation({
    mutationFn: () =>
      api.workforce.createSkill({
        code,
        name,
        category: category || undefined,
        maxLevel: Number(maxLevel),
      }),
    onSuccess: onDone,
  });

  return (
    <Dialog
      isOpen
      onClose={onClose}
      title="Skill Baru"
      supportingText="Skill menjadi satuan kualifikasi: operator memilikinya pada suatu level, mesin dan proses mensyaratkannya."
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <FilledTextField
          label="Kode"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          supportingText="Unik per tenant, misalnya WELD atau MC-OP."
        />
        <FilledTextField label="Nama" value={name} onChange={(e) => setName(e.target.value)} />
        <FilledTextField
          label="Kategori (opsional)"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        />
        <FilledTextField
          label="Level Maksimum"
          type="number"
          value={maxLevel}
          onChange={(e) => setMaxLevel(e.target.value)}
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
            disabled={create.isPending || code.trim().length < 2 || name.trim().length < 2}
          >
            Simpan Skill
          </Button>
        </div>
      </div>
    </Dialog>
  );
};

/** §6.5 — availability is a history; a change closes one window and opens the next. */
const AvailabilityDialog: React.FC<{
  availability: OperatorAvailability;
  onClose: () => void;
  onDone: () => void;
}> = ({ availability, onClose, onDone }) => {
  const [state, setState] = useState(availability.state);
  const [reason, setReason] = useState('');

  const save = useMutation({
    mutationFn: () =>
      api.workforce.setAvailability({
        operatorId: availability.operatorId,
        state,
        reason: reason || undefined,
      }),
    onSuccess: onDone,
  });

  return (
    <Dialog
      isOpen
      onClose={onClose}
      title={`Ketersediaan · ${availability.operatorName}`}
      supportingText="Perubahan menutup periode status sebelumnya dan membuka yang baru, sehingga riwayat ketersediaan tetap utuh."
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <Select
          label="Status"
          value={state}
          onChange={(value) => setState(value as typeof state)}
          options={[
            { value: 'AVAILABLE', label: 'Available — siap ditugaskan' },
            { value: 'ASSIGNED', label: 'Assigned — sudah ditugaskan' },
            { value: 'WORKING', label: 'Working — sedang bekerja' },
            { value: 'BREAK', label: 'Break — istirahat' },
            { value: 'ABSENT', label: 'Absent — tidak hadir' },
            { value: 'LEAVE', label: 'Leave — cuti' },
            { value: 'SICK', label: 'Sick — sakit' },
            { value: 'OFFLINE', label: 'Offline — di luar shift' },
          ]}
        />
        <FilledTextField
          label="Keterangan (opsional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        {save.isError ? (
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--color-error)' }}>
            {(save.error as Error).message}
          </p>
        ) : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
          <Button variant="text" onClick={onClose}>
            Batal
          </Button>
          <Button variant="filled" onClick={() => save.mutate()} disabled={save.isPending}>
            Simpan Status
          </Button>
        </div>
      </div>
    </Dialog>
  );
};
