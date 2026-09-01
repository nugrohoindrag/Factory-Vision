import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FactoryVisionApiClient,
  ApiRequestError,
  type SyncExceptionRecord,
} from '@factory-vision/api-client';
import { Button, Icon } from '@factory-vision/ui';
import { SurfaceCard, FilterChip } from '@factory-vision/ui/fv';
import { useSession } from '../../app/SessionContext.js';

const api = new FactoryVisionApiClient({ baseUrl: '' });

const inputStyle: React.CSSProperties = {
  padding: `var(--space-3) var(--space-3)`,
  borderRadius: 'var(--radius-md, 8px)',
  backgroundColor: 'var(--color-surface-container-high)',
  border: '1px solid var(--color-outline-variant)',
  color: 'var(--color-on-surface)',
  fontSize: '13px',
  boxSizing: 'border-box',
};

const COMMAND_LABEL: Record<string, string> = {
  RECORD_OUTPUT: 'Catat output',
  RECORD_DOWNTIME: 'Mulai downtime',
  RESOLVE_DOWNTIME: 'Selesaikan downtime',
  START_WO: 'Mulai work order',
  CONFIRM_WO: 'Konfirmasi work order',
  PAUSE_WO: 'Jeda work order',
  RESUME_WO: 'Lanjutkan work order',
  COMPLETE_WO: 'Selesaikan work order',
};

const STATUS_FILTERS = [
  { key: 'OPEN', label: 'Belum ditangani' },
  { key: 'RESOLVED', label: 'Sudah ditangani' },
  { key: 'IGNORED', label: 'Diabaikan' },
] as const;

/**
 * MES-082 — the records the shop floor captured and the server would not take.
 *
 * This screen exists because "ditolak" used to mean "gone": the rejection lived
 * only in the tablet's IndexedDB, so a supervisor had no way to see that an
 * operator's count had not landed. Every row here is production that physically
 * happened, kept so somebody can decide what to do about it.
 *
 * A variance in available quantity appears here too, and it is not a rejection:
 * the record *was* accepted, and the row is telling the supervisor that more was
 * produced than the previous process handed over — a handover to check, not a
 * count to re-enter.
 */
export const SyncExceptionsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { can } = useSession();
  const canResolve = can('production_record:correct');

  const [status, setStatus] = useState<string>('OPEN');
  const [lineId, setLineId] = useState<string>('');
  const [shiftDate, setShiftDate] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: lines = [] } = useQuery({
    queryKey: ['lines'],
    queryFn: () => api.master.getLines(),
  });

  const { data: exceptions = [], isLoading } = useQuery({
    queryKey: ['sync-exceptions', status, lineId, shiftDate],
    queryFn: () =>
      api.syncExceptions.list({
        status,
        lineId: lineId || undefined,
        shiftDate: shiftDate || undefined,
      }),
    refetchInterval: 30_000,
  });

  const { data: summary = [] } = useQuery({
    queryKey: ['sync-exceptions-summary'],
    queryFn: () => api.syncExceptions.summary(),
    refetchInterval: 30_000,
  });

  const setStatusMutation = useMutation({
    mutationFn: ({
      id,
      next,
      note,
    }: {
      id: string;
      next: 'RESOLVED' | 'IGNORED' | 'OPEN';
      note?: string;
    }) => api.syncExceptions.setStatus(id, next, note),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['sync-exceptions'] });
      void queryClient.invalidateQueries({ queryKey: ['sync-exceptions-summary'] });
    },
    onError: (err) =>
      setError(err instanceof ApiRequestError ? err.message : 'Gagal memperbarui exception.'),
  });

  const totalOpen = useMemo(
    () => summary.reduce((total, row) => total + row.count, 0),
    [summary]
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', padding: 'var(--space-1)' }}>
      <div>
        <h1
          style={{
            margin: 0,
            fontSize: '20px',
            fontWeight: 800,
            color: 'var(--color-on-surface)',
          }}
        >
          Exception Sinkronisasi
        </h1>
        <p
          style={{
            margin: `var(--space-1) 0 0`,
            fontSize: '13px',
            color: 'var(--color-on-surface-variant)',
          }}
        >
          Catatan produksi dari terminal yang tidak diterima server. Catatan tidak dibuang, setiap
          baris di bawah menunggu keputusan Anda.
        </p>
      </div>

      {totalOpen > 0 && (
        <SurfaceCard padding="md">
          <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
            {totalOpen} exception belum ditangani
          </div>
          <div
            style={{
              display: 'flex',
              gap: 'var(--space-2)',
              flexWrap: 'wrap',
              marginTop: 'var(--space-2)',
            }}
          >
            {summary.map((row) => (
              <button
                key={row.lineId ?? 'tanpa-line'}
                type="button"
                onClick={() => {
                  setLineId(row.lineId ?? '');
                  setStatus('OPEN');
                }}
                style={{
                  ...inputStyle,
                  cursor: 'pointer',
                  fontWeight: 700,
                  backgroundColor: 'var(--color-surface-container)',
                }}
              >
                {row.lineName ?? 'Tanpa line'} · {row.count}
              </button>
            ))}
          </div>
        </SurfaceCard>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          {STATUS_FILTERS.map((option) => (
            <FilterChip
              key={option.key}
              selected={status === option.key}
              onClick={() => setStatus(option.key)}
            >
              {option.label}
            </FilterChip>
          ))}
        </div>

        <select value={lineId} onChange={(e) => setLineId(e.target.value)} style={inputStyle}>
          <option value="">Semua line</option>
          {lines.map((line) => (
            <option key={line.id} value={line.id}>
              {line.name}
            </option>
          ))}
        </select>

        <input
          type="date"
          value={shiftDate}
          onChange={(e) => setShiftDate(e.target.value)}
          style={inputStyle}
          aria-label="Tanggal shift"
        />

        {(lineId || shiftDate) && (
          <Button
            variant="text"
            onClick={() => {
              setLineId('');
              setShiftDate('');
            }}
          >
            Bersihkan filter
          </Button>
        )}
      </div>

      {error && (
        <div
          role="alert"
          style={{
            padding: `var(--space-3) var(--space-3)`,
            borderRadius: 'var(--radius-sm, 8px)',
            backgroundColor: 'var(--color-error-container)',
            color: 'var(--color-on-error-container)',
            fontSize: '12px',
            fontWeight: 600,
          }}
        >
          {error}
        </div>
      )}

      {isLoading ? (
        <Empty label="Memuat exception…" />
      ) : exceptions.length === 0 ? (
        <Empty
          label={
            status === 'OPEN'
              ? 'Tidak ada exception yang belum ditangani. Seluruh catatan terminal diterima server.'
              : 'Tidak ada exception pada filter ini.'
          }
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {exceptions.map((exception) => (
            <ExceptionRow
              key={exception.id}
              exception={exception}
              expanded={expanded === exception.id}
              onToggle={() => setExpanded(expanded === exception.id ? null : exception.id)}
              canResolve={canResolve}
              busy={setStatusMutation.isPending}
              onSetStatus={(next) => setStatusMutation.mutate({ id: exception.id, next })}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const ExceptionRow: React.FC<{
  exception: SyncExceptionRecord;
  expanded: boolean;
  canResolve: boolean;
  busy: boolean;
  onToggle: () => void;
  onSetStatus: (next: 'RESOLVED' | 'IGNORED' | 'OPEN') => void;
}> = ({ exception, expanded, canResolve, busy, onToggle, onSetStatus }) => {
  // A variance is not a refusal — the record was kept — so it reads differently
  // from a rejection and must not be presented as lost data.
  const isVariance = exception.errorCode === 'AVAILABLE_QUANTITY_VARIANCE';

  return (
    <SurfaceCard padding="md">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 'var(--space-3)',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <span
              style={{
                fontSize: '10px',
                fontWeight: 800,
                padding: `var(--space-1) var(--space-2)`,
                borderRadius: '999px',
                backgroundColor: isVariance
                  ? 'var(--color-warning-container)'
                  : 'var(--color-error-container)',
                color: isVariance
                  ? 'var(--color-on-warning-container)'
                  : 'var(--color-on-error-container)',
              }}
            >
              {isVariance ? 'SELISIH QUANTITY' : 'DITOLAK'}
            </span>
            <span style={{ fontSize: '13px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
              {COMMAND_LABEL[exception.commandType] ?? exception.commandType}
            </span>
            {exception.workOrderNumber && (
              <span style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
                · {exception.workOrderNumber}
              </span>
            )}
          </div>

          <p
            style={{
              margin: `var(--space-2) 0 0`,
              fontSize: '12px',
              color: 'var(--color-on-surface)',
              lineHeight: 1.5,
            }}
          >
            {exception.reason}
          </p>

          <div
            style={{
              marginTop: 'var(--space-2)',
              fontSize: '11px',
              color: 'var(--color-on-surface-variant)',
            }}
          >
            {exception.lineName ?? 'Tanpa line'}
            {exception.shiftDate ? ` · shift ${exception.shiftDate}` : ''}
            {exception.operatorId ? ` · operator ${exception.operatorId}` : ''}
            {exception.retryable ? ' · terminal akan mencoba lagi' : ''}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-1)', alignItems: 'center', flexShrink: 0 }}>
          <Button
            variant="text"
            icon={<Icon name={expanded ? 'expand_less' : 'expand_more'} size={16} />}
            onClick={onToggle}
          >
            Detail
          </Button>
          {canResolve && exception.status === 'OPEN' && (
            <>
              <Button variant="text" disabled={busy} onClick={() => onSetStatus('RESOLVED')}>
                Tandai selesai
              </Button>
              <Button variant="text" disabled={busy} onClick={() => onSetStatus('IGNORED')}>
                Abaikan
              </Button>
            </>
          )}
          {canResolve && exception.status !== 'OPEN' && (
            <Button variant="text" disabled={busy} onClick={() => onSetStatus('OPEN')}>
              Buka lagi
            </Button>
          )}
        </div>
      </div>

      {expanded && (
        <div
          style={{
            marginTop: 'var(--space-3)',
            paddingTop: 'var(--space-3)',
            borderTop: '1px solid var(--color-outline-variant)',
            fontSize: '11px',
            color: 'var(--color-on-surface-variant)',
          }}
        >
          <Detail label="Kode kesalahan" value={exception.errorCode} />
          <Detail label="Client event id" value={exception.clientEventId} />
          <Detail label="Terjadi pada" value={exception.occurredAt ?? '—'} />
          <Detail label="Dicatat pada" value={exception.createdAt ?? '—'} />
          {exception.resolvedAt && (
            <Detail
              label="Ditangani"
              value={`${exception.resolvedAt} oleh ${exception.resolvedBy ?? '—'}`}
            />
          )}
          <div style={{ marginTop: 'var(--space-2)', fontWeight: 700, color: 'var(--color-on-surface)' }}>
            Isi catatan operator
          </div>
          <pre
            style={{
              margin: `var(--space-1) 0 0`,
              padding: `var(--space-2) var(--space-3)`,
              borderRadius: 'var(--radius-sm, 8px)',
              backgroundColor: 'var(--color-surface-container-high)',
              color: 'var(--color-on-surface)',
              fontSize: '11px',
              overflowX: 'auto',
            }}
          >
            {JSON.stringify(exception.payload, null, 2)}
          </pre>
        </div>
      )}
    </SurfaceCard>
  );
};

const Detail: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div style={{ display: 'flex', gap: 'var(--space-2)', padding: `var(--space-1) 0` }}>
    <span style={{ minWidth: '120px', fontWeight: 700 }}>{label}</span>
    <span style={{ color: 'var(--color-on-surface)', wordBreak: 'break-all' }}>{value}</span>
  </div>
);

const Empty: React.FC<{ label: string }> = ({ label }) => (
  <div
    style={{
      padding: 'var(--space-8)',
      textAlign: 'center',
      color: 'var(--color-on-surface-variant)',
      fontSize: '13px',
    }}
  >
    {label}
  </div>
);
