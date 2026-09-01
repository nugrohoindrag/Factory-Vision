import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Icon } from '@factory-vision/ui';
import { SurfaceCard, toneContainer, toneOnContainer } from '@factory-vision/ui/fv';
import { api, InternalApiError } from '../../app/api.js';
import { useSession } from '../../app/SessionContext.js';

/**
 * Time-boxed access into one customer's console.
 *
 * The form asks for a reason and a duration because this is someone else's
 * production data. Nothing here is a standing permission: a grant expires on
 * its own, and using it is recorded separately from issuing it, so "who looked
 * at this factory's numbers" stays answerable.
 */
export const SupportAccessPanel: React.FC<{ clientId: string }> = ({ clientId }) => {
  const queryClient = useQueryClient();
  const { can, principal } = useSession();

  const [reason, setReason] = useState('');
  const [hours, setHours] = useState('4');
  const [accessLevel, setAccessLevel] = useState<'READ_ONLY' | 'READ_WRITE'>('READ_ONLY');
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);

  const grants = useQuery({
    queryKey: ['support-access', clientId],
    queryFn: () => api.support.forClient(clientId),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['support-access', clientId] });

  const grant = useMutation({
    mutationFn: () =>
      api.support.grant(clientId, {
        grantedTo: principal!.email,
        reason,
        accessLevel,
        hours: Number(hours),
      }),
    onSuccess: () => {
      setReason('');
      setError(null);
      refresh();
    },
    onError: (err) => setError(err instanceof InternalApiError ? err.message : 'Gagal memberi akses.'),
  });

  const revoke = useMutation({
    mutationFn: (grantId: string) => api.support.revoke(grantId),
    onSuccess: refresh,
    onError: (err) => setError(err instanceof InternalApiError ? err.message : 'Gagal mencabut akses.'),
  });

  const use = useMutation({
    mutationFn: (grantId: string) => api.support.use(grantId),
    onSuccess: (result) => {
      setOpened(result.tenantId);
      refresh();
    },
    onError: (err) => setError(err instanceof InternalApiError ? err.message : 'Gagal memakai akses.'),
  });

  return (
    <SurfaceCard padding="md">
      <div style={{ fontSize: '12px', fontWeight: 800, color: 'var(--color-on-surface)', marginBottom: 'var(--space-1)' }}>
        Akses Dukungan
      </div>
      <p
        style={{
          margin: `0 0 var(--space-3)`,
          fontSize: '11.5px',
          color: 'var(--color-on-surface-variant)',
          lineHeight: 1.6,
        }}
      >
        Akses ke data pelanggan bersifat sementara dan tercatat. Maksimal 72 jam, dan dapat dicabut kapan saja.
      </p>

      {error && (
        <div
          role="alert"
          style={{
            marginBottom: 'var(--space-3)',
            padding: `var(--space-3) var(--space-3)`,
            borderRadius: 'var(--radius-sm, 8px)',
            backgroundColor: 'var(--color-error-container)',
            color: 'var(--color-on-error-container)',
            fontSize: '11.5px',
            fontWeight: 600,
          }}
        >
          {error}
        </div>
      )}

      {opened && (
        <div
          style={{
            marginBottom: 'var(--space-3)',
            padding: `var(--space-3) var(--space-3)`,
            borderRadius: 'var(--radius-sm, 8px)',
            backgroundColor: toneContainer.success,
            color: toneOnContainer.success,
            fontSize: '11.5px',
            fontWeight: 600,
          }}
        >
          Akses dibuka untuk tenant <code>{opened}</code>. Pemakaian ini sudah dicatat di audit.
        </div>
      )}

      {can('support:grant') && (
        <div
          style={{
            display: 'flex',
            gap: 'var(--space-2)',
            flexWrap: 'wrap',
            alignItems: 'flex-end',
            marginBottom: 'var(--space-4)',
          }}
        >
          <div style={{ flex: '1 1 260px' }}>
            <label style={labelStyle}>Alasan akses</label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Contoh: menelusuri laporan OEE yang tidak sesuai perhitungan pabrik"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Durasi</label>
            <select value={hours} onChange={(e) => setHours(e.target.value)} style={inputStyle}>
              <option value="1">1 jam</option>
              <option value="4">4 jam</option>
              <option value="8">8 jam</option>
              <option value="24">24 jam</option>
              <option value="72">72 jam</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Tingkat</label>
            <select
              value={accessLevel}
              onChange={(e) => setAccessLevel(e.target.value as 'READ_ONLY' | 'READ_WRITE')}
              style={inputStyle}
            >
              <option value="READ_ONLY">Hanya baca</option>
              <option value="READ_WRITE">Baca dan tulis</option>
            </select>
          </div>
          <Button
            variant="filled"
            onClick={() => grant.mutate()}
            disabled={grant.isPending || reason.trim().length < 10}
            icon={<Icon name="key" size={15} />}
          >
            Beri Akses
          </Button>
        </div>
      )}

      {grants.data?.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {grants.data.map((g) => (
            <div
              key={g.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 'var(--space-3)',
                flexWrap: 'wrap',
                alignItems: 'center',
                padding: `var(--space-3) var(--space-3)`,
                borderRadius: 'var(--radius-sm, 8px)',
                backgroundColor: 'var(--color-surface-container)',
                border: '1px solid var(--color-outline-variant)',
              }}
            >
              <div style={{ minWidth: '220px' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-on-surface)' }}>
                  {g.grantedTo}
                  <span
                    style={{
                      marginLeft: 'var(--space-2)',
                      padding: `var(--space-1) var(--space-2)`,
                      borderRadius: 'var(--radius-full, 999px)',
                      fontSize: '10px',
                      backgroundColor: g.active ? toneContainer.success : toneContainer.neutral,
                      color: g.active ? toneOnContainer.success : toneOnContainer.neutral,
                    }}
                  >
                    {g.revokedAt ? 'Dicabut' : g.active ? 'Aktif' : 'Kedaluwarsa'}
                  </span>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)', marginTop: 'var(--space-1)' }}>
                  {g.reason}
                </div>
                <div style={{ fontSize: '10.5px', color: 'var(--color-on-surface-variant)', marginTop: 'var(--space-1)' }}>
                  {g.accessLevel === 'READ_ONLY' ? 'Hanya baca' : 'Baca dan tulis'} · berakhir{' '}
                  {new Date(g.expiresAt).toLocaleString('id-ID')} · dipakai {g.useCount}x
                </div>
              </div>

              {g.active && can('support:grant') && (
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  {g.grantedTo.toLowerCase() === principal?.email.toLowerCase() && (
                    <Button variant="outlined" onClick={() => use.mutate(g.id)} disabled={use.isPending}>
                      Buka
                    </Button>
                  )}
                  <Button variant="text" onClick={() => revoke.mutate(g.id)} disabled={revoke.isPending}>
                    Cabut
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
          Belum pernah ada akses dukungan ke klien ini.
        </div>
      )}
    </SurfaceCard>
  );
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: `var(--space-2) var(--space-3)`,
  fontSize: '12px',
  fontFamily: 'var(--font-family)',
  color: 'var(--color-on-surface)',
  backgroundColor: 'var(--color-surface-container)',
  border: '1px solid var(--color-outline-variant)',
  borderRadius: 'var(--radius-sm, 8px)',
  outline: 'none',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '10.5px',
  fontWeight: 700,
  color: 'var(--color-on-surface-variant)',
  marginBottom: 'var(--space-1)',
};
