import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { SurfaceCard, toneContainer, toneOnContainer, type Tone } from '@factory-vision/ui/fv';
import { api } from '../../app/api.js';

/** Actions that touched a customer's data, rather than only vendor records. */
const SENSITIVE = new Set(['SUPPORT_ACCESS_USED', 'SUPPORT_ACCESS_GRANTED', 'SUPPORT_ACCESS_REVOKED']);

const ACTION_LABEL: Record<string, string> = {
  INTERNAL_LOGIN: 'Login internal',
  INTERNAL_LOGIN_FAILED: 'Login internal gagal',
  CLIENT_CREATED: 'Klien dibuat',
  CLIENT_UPDATED: 'Klien diperbarui',
  CLIENT_STATUS_CHANGED: 'Status klien diubah',
  SUBSCRIPTION_CHANGED: 'Langganan diubah',
  SUPPORT_ACCESS_GRANTED: 'Akses dukungan diberikan',
  SUPPORT_ACCESS_REVOKED: 'Akses dukungan dicabut',
  SUPPORT_ACCESS_USED: 'Akses dukungan dipakai',
  USAGE_CAPTURED: 'Sampel pemakaian diambil',
};

/**
 * The vendor's own audit trail.
 *
 * Kept separate from each customer's audit log: a customer must be able to
 * read their own trail without seeing the vendor's, and the vendor needs one
 * place that answers who reached into which factory.
 */
export const AuditPage: React.FC = () => {
  const entries = useQuery({ queryKey: ['internal-audit'], queryFn: () => api.audit({ limit: 200 }) });

  return (
    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div>
        <h1
          style={{
            margin: 0,
            fontSize: '22px',
            fontWeight: 800,
            letterSpacing: '-0.02em',
            color: 'var(--color-on-surface)',
          }}
        >
          Audit Internal
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
          Setiap tindakan staf internal, termasuk akses ke data pelanggan
        </p>
      </div>

      <SurfaceCard padding="none">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr
                style={{
                  backgroundColor: 'var(--color-primary)',
                  color: 'var(--color-on-primary)',
                  textAlign: 'left',
                }}
              >
                <th style={cell}>Waktu</th>
                <th style={cell}>Aktor</th>
                <th style={cell}>Tindakan</th>
                <th style={cell}>Objek</th>
                <th style={cell}>Klien</th>
                <th style={cell}>IP</th>
              </tr>
            </thead>
            <tbody>
              {entries.data?.map((entry) => (
                <tr key={entry.id} style={{ borderTop: '1px solid var(--color-outline-variant)' }}>
                  <td style={cell}>{new Date(entry.occurredAt).toLocaleString('id-ID')}</td>
                  <td style={cell}>{entry.actorEmail}</td>
                  <td style={cell}>
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: 'var(--radius-full, 999px)',
                        fontSize: '11px',
                        fontWeight: 700,
                        backgroundColor: toneContainer[toneFor(entry.action)],
                        color: toneOnContainer[toneFor(entry.action)],
                      }}
                    >
                      {ACTION_LABEL[entry.action] ?? entry.action}
                    </span>
                  </td>
                  <td style={cell}>
                    {entry.entityType}
                    {entry.entityId ? ` · ${entry.entityId.slice(0, 24)}` : ''}
                  </td>
                  <td style={cell}>{entry.clientId ? entry.clientId.slice(0, 24) : '—'}</td>
                  <td style={cell}>{entry.ip ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {entries.data?.length === 0 && (
          <div
            style={{
              padding: '24px',
              textAlign: 'center',
              fontSize: '13px',
              color: 'var(--color-on-surface-variant)',
            }}
          >
            Belum ada aktivitas tercatat.
          </div>
        )}
      </SurfaceCard>
    </div>
  );
};

function toneFor(action: string): Tone {
  if (SENSITIVE.has(action)) return 'warning';
  if (action.endsWith('_FAILED')) return 'error';
  if (action.startsWith('CLIENT_') || action.startsWith('SUBSCRIPTION_')) return 'primary';
  return 'neutral';
}

const cell: React.CSSProperties = { padding: '9px 12px', whiteSpace: 'nowrap' };
