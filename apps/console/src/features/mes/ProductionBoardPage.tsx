import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FactoryVisionApiClient } from '@factory-vision/api-client';
import { Button, FilledTextField, Icon, Select } from '@factory-vision/ui';
import { Page, Section, SurfaceCard, Dialog, FilterChip, toneContainer, toneOnContainer } from '@factory-vision/ui/fv';
import type { BoardItem, BoardViewMode, ProductionBoard } from '@factory-vision/domain-types';
import { useSession } from '../../app/SessionContext.js';
import { EmptyState, Field, KpiRow, KpiTile, PageHeading, StatusPill, fmt, fmtDateTime, statusTone } from './shared.js';

const api = new FactoryVisionApiClient({ baseUrl: '' });

/** Hour marks across the top of the timeline. */
const HOUR_STEP = 2;

/**
 * Visual Production Board (Improvement PRD §9, §23, US-PB001..005).
 *
 * A lane per machine (or line, process, shift), a bar per work order, drawn on
 * one shared time axis — the §9.2 sketch, made real. The bar's position is
 * computed from the window rather than from a grid of fixed columns, so a
 * fifteen-minute job is fifteen minutes wide and a schedule that starts at
 * 08:07 is not silently rounded to 08:00.
 *
 * Conflicts are drawn on the bar that has them (§9.5) and listed above the
 * board, because a blocking conflict is something a dispatcher must see before
 * they scroll to find it.
 */
export const ProductionBoardPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { can } = useSession();
  const [viewMode, setViewMode] = useState<BoardViewMode>('MACHINE');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [days, setDays] = useState(1);
  const [selected, setSelected] = useState<BoardItem | null>(null);

  const { data: board, isLoading } = useQuery({
    queryKey: ['production-board', viewMode, date, days],
    queryFn: () => api.productionBoard.get({ viewMode, date, days }),
    refetchInterval: 30_000,
  });

  const dispatch = useMutation({
    mutationFn: api.productionBoard.dispatch,
    onSuccess: () => {
      setSelected(null);
      queryClient.invalidateQueries({ queryKey: ['production-board'] });
    },
  });

  const blocking = (board?.conflicts ?? []).filter((conflict) => conflict.blocking);
  const warnings = (board?.conflicts ?? []).filter((conflict) => !conflict.blocking);
  const allItems = useMemo(() => (board?.lanes ?? []).flatMap((lane) => lane.items), [board]);

  return (
    <Page>
      <Section>
        <PageHeading
          title="Visual Production Board"
          subtitle="Apa yang diproduksi, kapan, di mesin mana, dan oleh siapa. Konflik yang membuat eksekusi tidak sah ditandai sebagai pemblokir."
        />
      </Section>

      <Section>
        <SurfaceCard padding="md">
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ minWidth: '160px' }}>
              <Select
                label="Tampilan"
                value={viewMode}
                onChange={(value) => setViewMode(value as BoardViewMode)}
                options={[
                  { value: 'MACHINE', label: 'Machine View' },
                  { value: 'LINE', label: 'Line View' },
                  { value: 'PROCESS', label: 'Process View' },
                  { value: 'SHIFT', label: 'Shift View' },
                  { value: 'CALENDAR', label: 'Calendar View' },
                  { value: 'TIMELINE', label: 'Timeline View' },
                ]}
              />
            </div>
            <FilledTextField
              label="Tanggal"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            <div style={{ display: 'flex', gap: 'var(--space-1)', alignItems: 'center' }}>
              {[1, 3, 7].map((option) => (
                <FilterChip key={option} selected={days === option} onClick={() => setDays(option)}>
                  {option} hari
                </FilterChip>
              ))}
            </div>
          </div>
        </SurfaceCard>
      </Section>

      <Section>
        <KpiRow>
          <KpiTile
            label="Work Order Terjadwal"
            value={fmt(allItems.filter((item) => item.kind === 'WORK_ORDER').length)}
            caption="Dalam jendela waktu yang dipilih"
            tone="primary"
            icon="event_note"
          />
          <KpiTile
            label="Berjalan"
            value={fmt(allItems.filter((item) => item.status === 'RUNNING').length)}
            caption="Sedang diproduksi"
            tone="success"
            icon="play_circle"
          />
          <KpiTile
            label="Terlambat / Berisiko"
            value={fmt(
              allItems.filter((item) => item.status === 'DELAYED' || item.status === 'AT_RISK').length
            )}
            caption="Perlu tindakan dispatcher"
            tone={
              allItems.some((item) => item.status === 'DELAYED') ? 'error' : 'warning'
            }
            icon="schedule"
          />
          <KpiTile
            label="Konflik Pemblokir"
            value={fmt(blocking.length)}
            caption={`${warnings.length} peringatan lain`}
            tone={blocking.length > 0 ? 'error' : 'success'}
            icon="report_problem"
          />
        </KpiRow>
      </Section>

      {board && board.conflicts.length > 0 ? (
        <Section>
          <SurfaceCard padding="md" railTone={blocking.length > 0 ? 'error' : 'warning'}>
            <h3
              style={{
                margin: `0 0 var(--space-2)`,
                fontSize: '13px',
                fontWeight: 800,
                color: 'var(--color-on-surface)',
              }}
            >
              Konflik Jadwal
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              {board.conflicts.slice(0, 8).map((conflict, index) => (
                <div
                  key={`${conflict.type}-${index}`}
                  style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', fontSize: '12px' }}
                >
                  <StatusPill
                    status={conflict.blocking ? 'BLOKIR' : 'Peringatan'}
                    tone={conflict.blocking ? 'error' : 'warning'}
                  />
                  <span style={{ color: 'var(--color-on-surface)' }}>{conflict.message}</span>
                </div>
              ))}
            </div>
          </SurfaceCard>
        </Section>
      ) : null}

      <Section>
        {!isLoading && (board?.lanes.length ?? 0) === 0 ? (
          <SurfaceCard padding="lg">
            <EmptyState
              icon="calendar_view_week"
              title="Tidak ada yang terjadwal"
              description="Belum ada work order atau pekerjaan maintenance pada jendela waktu ini. Ubah tanggal, perluas rentang, atau jadwalkan work order dari layar Work Order."
            />
          </SurfaceCard>
        ) : board ? (
          <BoardTimeline board={board} onSelect={setSelected} />
        ) : null}
      </Section>

      {selected ? (
        <DispatchDialog
          item={selected}
          canReschedule={can('production_board:reschedule')}
          canDispatch={can('production_board:dispatch')}
          pending={dispatch.isPending}
          error={dispatch.isError ? (dispatch.error as Error).message : undefined}
          onClose={() => setSelected(null)}
          onSubmit={(action) => dispatch.mutate(action)}
        />
      ) : null}
    </Page>
  );
};

/**
 * The timeline itself.
 *
 * Everything is positioned as a percentage of the window, which is what lets
 * the same component draw one day and seven without a second layout.
 */
const BoardTimeline: React.FC<{ board: ProductionBoard; onSelect: (item: BoardItem) => void }> = ({
  board,
  onSelect,
}) => {
  const start = new Date(board.windowStart).getTime();
  const end = new Date(board.windowEnd).getTime();
  const span = Math.max(end - start, 1);
  const hours = (end - start) / 3_600_000;

  const marks: Array<{ left: number; label: string }> = [];
  for (let hour = 0; hour <= hours; hour += hours > 24 ? 24 : HOUR_STEP) {
    const at = new Date(start + hour * 3_600_000);
    marks.push({
      left: ((hour * 3_600_000) / span) * 100,
      label:
        hours > 24
          ? at.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })
          : at.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
    });
  }

  const nowLeft = ((Date.now() - start) / span) * 100;

  return (
    <SurfaceCard padding="none">
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: '900px' }}>
          {/* Time axis */}
          <div
            style={{
              display: 'flex',
              borderBottom: '1px solid var(--color-outline-variant)',
              backgroundColor: 'var(--color-surface-container-low)',
            }}
          >
            <div
              style={{
                width: '180px',
                flexShrink: 0,
                padding: 'var(--space-3)',
                fontSize: '11px',
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'var(--color-on-surface-variant)',
              }}
            >
              {board.viewMode === 'MACHINE'
                ? 'Mesin'
                : board.viewMode === 'LINE'
                  ? 'Line'
                  : board.viewMode === 'PROCESS'
                    ? 'Proses'
                    : board.viewMode === 'SHIFT'
                      ? 'Shift'
                      : 'Jadwal'}
            </div>
            <div style={{ flex: 1, position: 'relative', height: '40px' }}>
              {marks.map((mark) => (
                <span
                  key={mark.left}
                  style={{
                    position: 'absolute',
                    left: `${mark.left}%`,
                    top: '50%',
                    transform: 'translate(-50%, -50%)',
                    fontSize: '10px',
                    fontWeight: 700,
                    color: 'var(--color-on-surface-variant)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {mark.label}
                </span>
              ))}
            </div>
          </div>

          {/* Lanes */}
          {board.lanes.map((lane) => (
            <div
              key={lane.id}
              style={{ display: 'flex', borderBottom: '1px solid var(--color-outline-variant)' }}
            >
              <div
                style={{
                  width: '180px',
                  flexShrink: 0,
                  padding: 'var(--space-3)',
                  borderRight: '1px solid var(--color-outline-variant)',
                }}
              >
                <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-on-surface)' }}>
                  {lane.name}
                </div>
                {lane.subtitle ? (
                  <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                    {lane.subtitle}
                  </div>
                ) : null}
              </div>

              <div style={{ flex: 1, position: 'relative', minHeight: '56px', padding: 'var(--space-2) 0' }}>
                {/* Hour gridlines */}
                {marks.map((mark) => (
                  <div
                    key={`grid-${mark.left}`}
                    style={{
                      position: 'absolute',
                      left: `${mark.left}%`,
                      top: 0,
                      bottom: 0,
                      width: '1px',
                      backgroundColor: 'var(--color-outline-variant)',
                      opacity: 0.5,
                    }}
                  />
                ))}

                {/* Now marker, only when the window contains it */}
                {nowLeft >= 0 && nowLeft <= 100 ? (
                  <div
                    style={{
                      position: 'absolute',
                      left: `${nowLeft}%`,
                      top: 0,
                      bottom: 0,
                      width: '2px',
                      backgroundColor: 'var(--color-primary)',
                    }}
                  />
                ) : null}

                {lane.items.map((item) => {
                  const itemStart = new Date(item.plannedStart).getTime();
                  const itemEnd = new Date(item.plannedEnd).getTime();
                  const left = Math.max(((itemStart - start) / span) * 100, 0);
                  const width = Math.min(((itemEnd - itemStart) / span) * 100, 100 - left);
                  const tone = statusTone(item.status);
                  const hasBlocking = item.conflicts.some((conflict) => conflict.blocking);

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelect(item)}
                      title={`${item.label} · ${item.status}`}
                      style={{
                        position: 'absolute',
                        left: `${left}%`,
                        width: `${Math.max(width, 1.5)}%`,
                        top: 'var(--space-2)',
                        height: '40px',
                        padding: `0 var(--space-2)`,
                        border: hasBlocking ? '2px solid var(--color-error)' : 'none',
                        borderRadius: 'var(--radius-sm, 6px)',
                        cursor: 'pointer',
                        overflow: 'hidden',
                        textAlign: 'left',
                        fontFamily: 'var(--font-family)',
                        backgroundColor: toneContainer[tone],
                        color: toneOnContainer[tone],
                      }}
                    >
                      <div
                        style={{
                          fontSize: '11px',
                          fontWeight: 800,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {item.label}
                      </div>
                      <div
                        style={{
                          fontSize: '10px',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {item.kind === 'MAINTENANCE'
                          ? item.machineName
                          : `${item.productName ?? ''} · ${item.progressPercentage.toFixed(0)}%`}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </SurfaceCard>
  );
};

/** §9.6 — the dispatcher's actions, each of them audited on the server. */
const DispatchDialog: React.FC<{
  item: BoardItem;
  canReschedule: boolean;
  canDispatch: boolean;
  pending: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (action: {
    action: 'RESCHEDULE' | 'REPRIORITISE' | 'CONFIRM' | 'CANCEL';
    workOrderId: string;
    plannedStart?: string;
    plannedEnd?: string;
    priority?: number;
    reason?: string;
  }) => void;
}> = ({ item, canReschedule, canDispatch, pending, error, onClose, onSubmit }) => {
  const toLocal = (iso: string) => new Date(iso).toISOString().slice(0, 16);
  const [plannedStart, setPlannedStart] = useState(toLocal(item.plannedStart));
  const [plannedEnd, setPlannedEnd] = useState(toLocal(item.plannedEnd));
  const [priority, setPriority] = useState(String(item.priority));
  const [reason, setReason] = useState('');

  const isWorkOrder = item.kind === 'WORK_ORDER' && Boolean(item.workOrderId);

  return (
    <Dialog
      isOpen
      onClose={onClose}
      title={item.label}
      supportingText={
        item.kind === 'MAINTENANCE'
          ? 'Pekerjaan maintenance. Jadwalnya diubah dari layar Maintenance.'
          : 'Perubahan jadwal, prioritas, konfirmasi, dan pembatalan dari board tercatat pada audit trail.'
      }
      maxWidth="560px"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: 'var(--space-3)',
          }}
        >
          <Field label="Status">
            <StatusPill status={item.status} />
          </Field>
          <Field label="Mesin">{item.machineName ?? '—'}</Field>
          <Field label="Proses">{item.processName ?? '—'}</Field>
          <Field label="Operator">
            {item.operatorNames.length > 0 ? item.operatorNames.join(', ') : 'Belum ditugaskan'}
          </Field>
          <Field label="Kuantitas">
            {fmt(item.producedQuantity)} / {fmt(item.quantity)}
          </Field>
          <Field label="Material">
            {item.materialStatus ? <StatusPill status={item.materialStatus} /> : '—'}
          </Field>
          <Field label="Tenaga Kerja">
            {item.laborStatus ? <StatusPill status={item.laborStatus} /> : '—'}
          </Field>
          <Field label="Jadwal">{`${fmtDateTime(item.plannedStart)} – ${fmtDateTime(item.plannedEnd)}`}</Field>
        </div>

        {item.conflicts.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {item.conflicts.map((conflict, index) => (
              <div
                key={`${conflict.type}-${index}`}
                style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', fontSize: '12px' }}
              >
                <StatusPill
                  status={conflict.blocking ? 'BLOKIR' : 'Peringatan'}
                  tone={conflict.blocking ? 'error' : 'warning'}
                />
                <span style={{ color: 'var(--color-on-surface-variant)' }}>{conflict.message}</span>
              </div>
            ))}
          </div>
        ) : null}

        {isWorkOrder && canReschedule ? (
          <>
            <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <FilledTextField
                label="Mulai"
                type="datetime-local"
                value={plannedStart}
                onChange={(e) => setPlannedStart(e.target.value)}
              />
              <FilledTextField
                label="Selesai"
                type="datetime-local"
                value={plannedEnd}
                onChange={(e) => setPlannedEnd(e.target.value)}
              />
              <FilledTextField
                label="Prioritas"
                type="number"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              />
            </div>
            <FilledTextField
              label="Alasan (wajib untuk pembatalan)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </>
        ) : null}

        {error ? <p style={{ margin: 0, fontSize: '12px', color: 'var(--color-error)' }}>{error}</p> : null}

        {isWorkOrder ? (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <Button variant="text" onClick={onClose}>
              Tutup
            </Button>
            {canDispatch ? (
              <Button
                variant="outlined"
                onClick={() =>
                  onSubmit({ action: 'CANCEL', workOrderId: item.workOrderId!, reason })
                }
                disabled={pending || reason.trim().length < 3}
              >
                Batalkan WO
              </Button>
            ) : null}
            {canDispatch ? (
              <Button
                variant="tonal"
                onClick={() => onSubmit({ action: 'CONFIRM', workOrderId: item.workOrderId! })}
                disabled={pending || item.status !== 'SCHEDULED'}
              >
                <Icon name="check" size={16} />
                Konfirmasi
              </Button>
            ) : null}
            {canReschedule ? (
              <Button
                variant="tonal"
                onClick={() =>
                  onSubmit({
                    action: 'REPRIORITISE',
                    workOrderId: item.workOrderId!,
                    priority: Number(priority),
                  })
                }
                disabled={pending}
              >
                Simpan Prioritas
              </Button>
            ) : null}
            {canReschedule ? (
              <Button
                variant="filled"
                onClick={() =>
                  onSubmit({
                    action: 'RESCHEDULE',
                    workOrderId: item.workOrderId!,
                    plannedStart: new Date(plannedStart).toISOString(),
                    plannedEnd: new Date(plannedEnd).toISOString(),
                    reason,
                  })
                }
                disabled={pending}
              >
                <Icon name="event_repeat" size={16} />
                Jadwalkan Ulang
              </Button>
            ) : null}
          </div>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button variant="text" onClick={onClose}>
              Tutup
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  );
};
