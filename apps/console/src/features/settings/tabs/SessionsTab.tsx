import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FactoryVisionApiClient, ApiRequestError } from '@factory-vision/api-client';
import { Button, Icon } from '@factory-vision/ui';
import { SurfaceCard } from '@factory-vision/ui/fv';
import { useSession } from '../../../app/SessionContext.js';

const api = new FactoryVisionApiClient({ baseUrl: '' });

/**
 * US-005, Manage user status: the revoke half.
 *
 * Changing a user's status stops the *next* login; an already-issued session
 * keeps working until it expires. lists "Session revoked" as an
 * audited action for exactly that reason, so this screen exists to end a
 * session now rather than eventually.
 */
export const SessionsTab: React.FC<{ onToast: (message: string) => void }> = ({ onToast }) => {
  const queryClient = useQueryClient();
  const { can, principal } = useSession();
  const canRevoke = can('user:deactivate');

  const [error, setError] = useState<string | null>(null);

  const { data: sessions = [], isLoading } = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api.auth.listSessions(),
    refetchInterval: 15_000,
  });

  const revoke = useMutation({
    mutationFn: (sessionId: string) => api.auth.revokeSession(sessionId),
    onSuccess: () => {
      onToast('Sesi dicabut dan tercatat pada audit trail.');
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : 'Gagal mencabut sesi.'),
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <p style={{ margin: 0, fontSize: '12px', color: 'var(--color-on-surface-variant)', lineHeight: 1.6 }}>
        Sesi aplikasi berakhir setelah 12 jam atau 60 menit tanpa aktivitas. Sesi operator jauh lebih pendek, 8
        jam absolut dan 15 menit idle, karena terminal shop floor dipakai bergantian.
      </p>

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
        <Empty label="Memuat sesi aktif…" />
      ) : sessions.length === 0 ? (
        <Empty label="Tidak ada sesi aktif." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {sessions.map((entry) => {
            const isSelf = entry.sessionId === principal?.sessionId;
            return (
              <SurfaceCard key={entry.sessionId} padding="md">
                <div
                  style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}
                >
                  <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start' }}>
                    <Icon name={entry.kind === 'OPERATOR' ? 'tablet_android' : 'computer'} size={20} />
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
                        {entry.name}
                        {isSelf && (
                          <span
                            style={{
                              fontSize: '10px',
                              fontWeight: 700,
                              color: 'var(--color-primary)',
                              marginLeft: 'var(--space-2)',
                            }}
                          >
                            SESI ANDA
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                        {entry.role} · {entry.kind === 'OPERATOR' ? 'Terminal operator' : 'Konsol'} ·{' '}
                        {entry.ip ?? 'IP tidak diketahui'}
                      </div>
                      <div
                        style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)', marginTop: 'var(--space-1)' }}
                      >
                        Masuk {new Date(entry.issuedAt).toLocaleString('id-ID')} · aktivitas terakhir{' '}
                        {new Date(entry.lastSeenAt).toLocaleTimeString('id-ID')} · berakhir{' '}
                        {new Date(entry.expiresAt).toLocaleTimeString('id-ID')}
                      </div>
                    </div>
                  </div>

                  {canRevoke && !isSelf && (
                    <Button
                      variant="text"
                      disabled={revoke.isPending}
                      onClick={() => revoke.mutate(entry.sessionId)}
                    >
                      Cabut Sesi
                    </Button>
                  )}
                </div>
              </SurfaceCard>
            );
          })}
        </div>
      )}
    </div>
  );
};

const Empty: React.FC<{ label: string }> = ({ label }) => (
  <div
    style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--color-on-surface-variant)', fontSize: '12px' }}
  >
    {label}
  </div>
);
