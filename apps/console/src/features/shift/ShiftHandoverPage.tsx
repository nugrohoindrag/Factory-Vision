import { statusLabel } from '@factory-vision/domain-types';
import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FactoryVisionApiClient, ApiRequestError } from '@factory-vision/api-client';
import { Button, Icon } from '@factory-vision/ui';
import { MetricCard, SurfaceCard, Page, Section } from '@factory-vision/ui/fv';
import { useSession } from '../../app/SessionContext.js';

const api = new FactoryVisionApiClient({ baseUrl: '' });

const number = (value: number) => value.toLocaleString('id-ID');

/**
 * US-022 & US-023, Shift performance and handover.
 *
 * These are one screen because they are one conversation: a supervisor reviews
 * what the shift produced and, in the same breath, tells the next shift what
 * to watch. Splitting them would mean re-reading the numbers on a second page
 * before writing the note.
 */
export const ShiftHandoverPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { can, principal } = useSession();

  const [lineId, setLineId] = useState<string>('');
  const [shiftId, setShiftId] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [issueDraft, setIssueDraft] = useState<string>('');
  const [openIssues, setOpenIssues] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; message: string } | null>(null);

  const { data: lines = [] } = useQuery({ queryKey: ['lines'], queryFn: () => api.master.getLines() });
  const { data: shifts = [] } = useQuery({ queryKey: ['shifts'], queryFn: () => api.shifts.list() });

  // Default to the first line the session may actually see.
  useEffect(() => {
    if (lineId || lines.length === 0) return;
    const scoped = principal && principal.scope.level !== 'TENANT' ? principal.scope.lineIds : null;
    const first = scoped ? lines.find((l) => scoped.includes(l.id)) : lines[0];
    if (first) setLineId(first.id);
  }, [lines, lineId, principal]);

  const {
    data: context,
    isLoading,
    isError,
    error: contextError,
  } = useQuery({
    queryKey: ['handover-context', lineId, shiftId],
    queryFn: () => api.shifts.handoverContext({ lineId, shiftId: shiftId || undefined }),
    enabled: Boolean(lineId),
  });

  const { data: history = [] } = useQuery({
    queryKey: ['handover-history', lineId],
    queryFn: () => api.shifts.listHandovers({ lineId }),
    enabled: Boolean(lineId),
  });

  const submit = useMutation({
    mutationFn: () =>
      api.shifts.createHandover({
        lineId,
        shiftId: context!.shiftId,
        shiftDate: context!.shiftDate,
        notes,
        openIssues,
      }),
    onSuccess: () => {
      setFeedback({ tone: 'ok', message: 'Catatan serah terima tersimpan.' });
      setNotes('');
      setOpenIssues([]);
      queryClient.invalidateQueries({ queryKey: ['handover-history', lineId] });
      queryClient.invalidateQueries({ queryKey: ['handover-context', lineId, shiftId] });
    },
    onError: (error) => {
      setFeedback({
        tone: 'error',
        message: error instanceof ApiRequestError ? error.message : 'Gagal menyimpan catatan serah terima.',
      });
    },
  });

  const addIssue = () => {
    const value = issueDraft.trim();
    if (!value) return;
    setOpenIssues((list) => [...list, value]);
    setIssueDraft('');
  };

  const canHandover = can('shift:handover');

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
          Performa & Serah Terima Shift
        </h1>
        <p style={{ margin: '4px 0 0', color: 'var(--color-on-surface-variant)', fontSize: '12px' }}>
          Hasil Shift berjalan dan catatan untuk Shift berikutnya
        </p>
      </Section>

      <Section style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <SelectField label="Production Line" value={lineId} onChange={setLineId}>
          {lines.map((line) => (
            <option key={line.id} value={line.id}>
              {line.name}
            </option>
          ))}
        </SelectField>

        <SelectField label="Shift" value={shiftId} onChange={setShiftId}>
          <option value="">Shift berjalan</option>
          {shifts.map((shift) => (
            <option key={shift.id} value={shift.id}>
              {shift.name} ({shift.startTime}-{shift.endTime})
            </option>
          ))}
        </SelectField>
      </Section>

      {!lineId ? (
        <Placeholder label="Pilih production line untuk melihat konteks shift." />
      ) : isLoading ? (
        <Placeholder label="Memuat konteks shift…" />
      ) : isError ? (
        <Placeholder
          tone="error"
          label={contextError instanceof Error ? contextError.message : 'Gagal memuat konteks shift.'}
        />
      ) : null}

      {context && (
        <>
          <Section
            stagger
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '12px',
            }}
          >
            <MetricCard
              label="Jumlah Good"
              value={number(context.goodQuantity)}
              delta={`Target ${number(context.targetQuantity)}`}
              deltaType={context.achievementPct >= 95 ? 'positive' : 'negative'}
              tone="primary"
              icon={<Icon name="inventory" size={18} />}
            />
            <MetricCard
              label="Pencapaian"
              value={`${context.achievementPct.toFixed(1)}%`}
              delta={`Sisa Target Produksi ${number(context.remainingTarget)} unit`}
              deltaType={context.achievementPct >= 95 ? 'positive' : 'negative'}
              tone="info"
              icon={<Icon name="percent" size={18} />}
            />
            <MetricCard
              label="Jumlah Reject"
              value={number(context.rejectQuantity)}
              delta={`${context.rejectRatePct.toFixed(2)}% dari total · ${context.topRejectReason ?? 'tanpa penyebab dominan'}`}
              deltaType={context.rejectRatePct <= 1.5 ? 'positive' : 'negative'}
              tone="error"
              icon={<Icon name="cancel" size={18} />}
            />
            <MetricCard
              label="Downtime"
              value={`${context.downtimeMinutes} menit`}
              delta={`${context.unplannedDowntimeMinutes} menit tidak terencana · ${context.topDowntimeReason ?? 'tanpa penyebab dominan'}`}
              deltaType={context.unplannedDowntimeMinutes === 0 ? 'positive' : 'negative'}
              tone="warning"
              icon={<Icon name="timer_off" size={18} />}
            />
          </Section>

          <Section
            style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 1fr)', gap: '14px' }}
          >
            <SurfaceCard padding="md">
              <div style={{ marginBottom: '10px' }}>
                <span style={{ fontSize: '14px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
                  Work Order Terbuka
                </span>
                <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                  {context.lineName} · {context.shiftName} · shift_date {context.shiftDate}
                  {context.activeDowntimeCount > 0 && (
                    <strong style={{ color: 'var(--color-error)' }}>
                      {' '}
                      · {context.activeDowntimeCount} downtime masih aktif
                    </strong>
                  )}
                </div>
              </div>

              {context.openWorkOrders.length === 0 ? (
                <Placeholder label="Tidak ada work order terbuka pada shift ini." />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {context.openWorkOrders.map((wo) => (
                    <div
                      key={wo.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '10px 12px',
                        borderRadius: 'var(--radius-sm, 8px)',
                        border: '1px solid var(--color-outline-variant)',
                        backgroundColor: 'var(--color-surface-container)',
                      }}
                    >
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
                          {wo.woNumber}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                          {wo.productName} · {statusLabel(wo.status)}
                        </div>
                      </div>
                      <span style={{ fontSize: '15px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
                        {wo.achievementPct.toFixed(1)}%
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {context.previousHandover && (
                <div
                  style={{
                    marginTop: '12px',
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-sm, 8px)',
                    backgroundColor: 'var(--color-surface-container-high)',
                  }}
                >
                  <div style={{ fontSize: '11px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
                    Catatan dari shift sebelumnya ({context.previousHandover.shiftDate})
                  </div>
                  <p
                    style={{
                      margin: '4px 0 0',
                      fontSize: '12px',
                      color: 'var(--color-on-surface-variant)',
                      lineHeight: 1.6,
                    }}
                  >
                    {context.previousHandover.notes}
                  </p>
                </div>
              )}
            </SurfaceCard>

            <SurfaceCard padding="md">
              <div style={{ marginBottom: '10px' }}>
                <span style={{ fontSize: '14px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
                  Catatan Serah Terima
                </span>
                <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                  Disimpan bersama hasil shift dan terlihat oleh supervisor berikutnya
                </div>
              </div>

              {!canHandover ? (
                <Placeholder label="Peran Anda tidak memiliki izin shift:handover." />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <textarea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    rows={5}
                    placeholder="Kondisi mesin, pekerjaan tertunda, instruksi khusus untuk shift berikutnya…"
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      fontSize: '13px',
                      fontFamily: 'var(--font-family)',
                      color: 'var(--color-on-surface)',
                      backgroundColor: 'var(--color-surface-container)',
                      border: '1px solid var(--color-outline-variant)',
                      borderRadius: 'var(--radius-sm, 8px)',
                      resize: 'vertical',
                    }}
                  />

                  <div style={{ display: 'flex', gap: '6px' }}>
                    <input
                      value={issueDraft}
                      onChange={(event) => setIssueDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          addIssue();
                        }
                      }}
                      placeholder="Tambah isu terbuka…"
                      style={{
                        flex: 1,
                        padding: '9px 12px',
                        fontSize: '12px',
                        fontFamily: 'var(--font-family)',
                        color: 'var(--color-on-surface)',
                        backgroundColor: 'var(--color-surface-container)',
                        border: '1px solid var(--color-outline-variant)',
                        borderRadius: 'var(--radius-sm, 8px)',
                      }}
                    />
                    <Button variant="tonal" onClick={addIssue}>
                      Tambah
                    </Button>
                  </div>

                  {openIssues.length > 0 && (
                    <ul
                      style={{
                        margin: 0,
                        paddingLeft: '18px',
                        fontSize: '12px',
                        color: 'var(--color-on-surface-variant)',
                      }}
                    >
                      {openIssues.map((issue, index) => (
                        <li key={`${issue}-${index}`} style={{ marginBottom: '4px' }}>
                          {issue}{' '}
                          <button
                            type="button"
                            onClick={() => setOpenIssues((list) => list.filter((_, i) => i !== index))}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: 'var(--color-error)',
                              cursor: 'pointer',
                              fontSize: '11px',
                              padding: 0,
                            }}
                          >
                            hapus
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  {feedback && (
                    <div
                      role="status"
                      style={{
                        padding: '8px 10px',
                        borderRadius: 'var(--radius-sm, 8px)',
                        fontSize: '12px',
                        fontWeight: 600,
                        backgroundColor:
                          feedback.tone === 'ok'
                            ? 'var(--color-success-container)'
                            : 'var(--color-error-container)',
                        color:
                          feedback.tone === 'ok'
                            ? 'var(--color-on-success-container)'
                            : 'var(--color-on-error-container)',
                      }}
                    >
                      {feedback.message}
                    </div>
                  )}

                  <Button
                    variant="filled"
                    disabled={submit.isPending || notes.trim().length === 0}
                    onClick={() => submit.mutate()}
                  >
                    {submit.isPending ? 'Menyimpan…' : 'Simpan Serah Terima'}
                  </Button>
                </div>
              )}
            </SurfaceCard>
          </Section>

          <Section>
            <SurfaceCard padding="md">
              <span style={{ fontSize: '14px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
                Riwayat Serah Terima
              </span>
              {history.length === 0 ? (
                <Placeholder label="Belum ada catatan serah terima untuk line ini." />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
                  {history.map((record) => (
                    <div
                      key={record.id}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 'var(--radius-sm, 8px)',
                        border: '1px solid var(--color-outline-variant)',
                        backgroundColor: 'var(--color-surface-container)',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: '10px',
                          flexWrap: 'wrap',
                        }}
                      >
                        <span style={{ fontSize: '12px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
                          {record.shiftDate} · {record.outgoingSupervisorName}
                        </span>
                        <span style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                          {new Date(record.createdAt).toLocaleString('id-ID')}
                        </span>
                      </div>
                      <p
                        style={{
                          margin: '6px 0 0',
                          fontSize: '12px',
                          color: 'var(--color-on-surface-variant)',
                          lineHeight: 1.6,
                        }}
                      >
                        {record.notes}
                      </p>
                      {record.openIssues.length > 0 && (
                        <ul
                          style={{
                            margin: '6px 0 0',
                            paddingLeft: '18px',
                            fontSize: '11px',
                            color: 'var(--color-on-surface-variant)',
                          }}
                        >
                          {record.openIssues.map((issue, index) => (
                            <li key={index}>{issue}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </SurfaceCard>
          </Section>
        </>
      )}
    </Page>
  );
};

const SelectField: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}> = ({ label, value, onChange, children }) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
    <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-on-surface-variant)' }}>{label}</span>
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      style={{
        padding: '8px 10px',
        fontSize: '12px',
        fontFamily: 'var(--font-family)',
        borderRadius: 'var(--radius-sm, 8px)',
        border: '1px solid var(--color-outline-variant)',
        backgroundColor: 'var(--color-surface-container)',
        color: 'var(--color-on-surface)',
        minWidth: '220px',
      }}
    >
      {children}
    </select>
  </label>
);

const Placeholder: React.FC<{ label: string; tone?: 'error' }> = ({ label, tone }) => (
  <div
    style={{
      padding: '24px',
      textAlign: 'center',
      fontSize: '12px',
      fontWeight: tone === 'error' ? 600 : 400,
      color: tone === 'error' ? 'var(--color-error)' : 'var(--color-on-surface-variant)',
    }}
  >
    {label}
  </div>
);
