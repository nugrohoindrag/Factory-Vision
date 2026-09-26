import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Icon } from '@factory-vision/ui';
import { SurfaceCard, toneContainer, toneOnContainer, type Tone } from '@factory-vision/ui/fv';
import type { ReferralCode } from '@factory-vision/domain-types';
import { api, InternalApiError } from '../../app/api.js';
import { useSession } from '../../app/SessionContext.js';

/**
 * Referral codes: the gate on the public trial form.
 *
 * A code is issued to a person the team has actually spoken to. The form
 * refuses to create a workspace without one, so the codes listed here are the
 * complete answer to "who did we let in, and who let them in?".
 */
export const ReferralCodesPage: React.FC = () => {
  const { can } = useSession();
  const queryClient = useQueryClient();
  const codes = useQuery({ queryKey: ['referral-codes'], queryFn: () => api.referrals.list() });

  const [label, setLabel] = useState('');
  const [maxUses, setMaxUses] = useState('1');
  const [expiryDays, setExpiryDays] = useState('30');
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<ReferralCode | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['referral-codes'] });

  const create = useMutation({
    mutationFn: () =>
      api.referrals.create({ label, maxUses: Number(maxUses) || 1, expiryDays: Number(expiryDays) || 0 }),
    onSuccess: (code) => {
      setIssued(code);
      setLabel('');
      setError(null);
      refresh();
    },
    onError: (err) => setError(err instanceof InternalApiError ? err.message : 'Gagal membuat kode.'),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.referrals.revoke(id),
    onSuccess: refresh,
    onError: (err) => setError(err instanceof InternalApiError ? err.message : 'Gagal mencabut kode.'),
  });

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      /* clipboard blocked; the code is still readable on screen */
    }
  };

  return (
    <div style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
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
          Kode Referral
        </h1>
        <p style={{ margin: `var(--space-1) 0 0`, fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
          Formulir uji coba gratis hanya menerima pendaftaran yang membawa kode dari sini
        </p>
      </div>

      {can('client:manage') && (
        <SurfaceCard padding="lg">
          <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--color-on-surface)', marginBottom: 'var(--space-3)' }}>
            Buat kode baru
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(240px, 2fr) minmax(120px, 1fr) minmax(120px, 1fr) auto',
              gap: 'var(--space-3)',
              alignItems: 'end',
            }}
          >
            <div>
              <label style={labelStyle}>Untuk siapa</label>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="PT Sinar Presisi — Pak Hendro, demo 24 Sep"
                style={fieldStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Maks. pendaftaran</label>
              <input
                type="number"
                min={1}
                max={100}
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
                style={fieldStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Berlaku (hari, 0 = tanpa batas)</label>
              <input
                type="number"
                min={0}
                max={365}
                value={expiryDays}
                onChange={(e) => setExpiryDays(e.target.value)}
                style={fieldStyle}
              />
            </div>
            <Button
              variant="filled"
              icon={<Icon name="add" size={16} />}
              disabled={create.isPending || label.trim().length < 3}
              onClick={() => create.mutate()}
            >
              {create.isPending ? 'Membuat…' : 'Buat kode'}
            </Button>
          </div>
          {error && (
            <p style={{ margin: `var(--space-3) 0 0`, fontSize: '12px', color: 'var(--color-error)' }}>{error}</p>
          )}
          {issued && (
            <div
              style={{
                marginTop: 'var(--space-4)',
                padding: 'var(--space-4)',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--color-primary)',
                color: 'var(--color-on-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 'var(--space-4)',
                flexWrap: 'wrap',
              }}
            >
              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, opacity: 0.85 }}>KODE UNTUK {issued.label.toUpperCase()}</div>
                <div style={{ fontSize: '26px', fontWeight: 800, letterSpacing: '0.08em', fontFamily: 'var(--font-family-mono, monospace)' }}>
                  {issued.code}
                </div>
                <div style={{ fontSize: '11.5px', opacity: 0.85 }}>
                  {issued.maxUses} pendaftaran ·{' '}
                  {issued.expiresAt ? `berlaku sampai ${new Date(issued.expiresAt).toLocaleDateString('id-ID')}` : 'tanpa batas waktu'}
                </div>
              </div>
              <Button
                variant="outlined"
                icon={<Icon name="content_copy" size={16} />}
                onClick={() => void copy(issued.code)}
              >
                {copied === issued.code ? 'Tersalin' : 'Salin kode'}
              </Button>
            </div>
          )}
        </SurfaceCard>
      )}

      <SurfaceCard padding="none">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-on-primary)', textAlign: 'left' }}>
                <th style={cell}>Kode</th>
                <th style={cell}>Untuk</th>
                <th style={cell}>Status</th>
                <th style={cell}>Dipakai</th>
                <th style={cell}>Berlaku sampai</th>
                <th style={cell}>Dibuat oleh</th>
                <th style={cell}>Dibuat</th>
                <th style={cell} />
              </tr>
            </thead>
            <tbody>
              {codes.data?.map((c) => {
                const state = stateOf(c);
                return (
                  <tr key={c.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                    <td style={cell}>
                      <button
                        type="button"
                        onClick={() => void copy(c.code)}
                        title="Salin kode"
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          cursor: 'pointer',
                          fontFamily: 'var(--font-family-mono, monospace)',
                          fontWeight: 700,
                          fontSize: '12.5px',
                          letterSpacing: '0.06em',
                          color: 'var(--color-on-surface)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 'var(--space-1)',
                        }}
                      >
                        {c.code}
                        <Icon name={copied === c.code ? 'check' : 'content_copy'} size={14} />
                      </button>
                    </td>
                    <td style={{ ...cell, whiteSpace: 'normal', minWidth: '220px' }}>{c.label}</td>
                    <td style={cell}>
                      <span
                        style={{
                          padding: `var(--space-1) var(--space-2)`,
                          borderRadius: 'var(--radius-full, 999px)',
                          fontSize: '11px',
                          fontWeight: 700,
                          backgroundColor: toneContainer[state.tone],
                          color: toneOnContainer[state.tone],
                        }}
                      >
                        {state.label}
                      </span>
                    </td>
                    <td style={cell}>
                      {c.useCount} / {c.maxUses}
                    </td>
                    <td style={cell}>{c.expiresAt ? new Date(c.expiresAt).toLocaleDateString('id-ID') : '—'}</td>
                    <td style={cell}>{c.createdBy}</td>
                    <td style={cell}>{new Date(c.createdAt).toLocaleString('id-ID')}</td>
                    <td style={cell}>
                      {can('client:manage') && !c.revokedAt && (
                        <Button
                          variant="text"
                          size="sm"
                          style={{ color: 'var(--color-error)' }}
                          disabled={revoke.isPending}
                          onClick={() => revoke.mutate(c.id)}
                        >
                          Cabut
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {codes.data?.length === 0 && (
          <div style={{ padding: 'var(--space-6)', textAlign: 'center', fontSize: '13px', color: 'var(--color-on-surface-variant)' }}>
            Belum ada kode. Buat satu untuk prospek yang akan mencoba Factory Vision.
          </div>
        )}
      </SurfaceCard>
    </div>
  );
};

function stateOf(c: ReferralCode): { label: string; tone: Tone } {
  if (c.revokedAt) return { label: 'Dicabut', tone: 'neutral' };
  if (c.expiresAt && new Date(c.expiresAt).getTime() <= Date.now()) return { label: 'Kedaluwarsa', tone: 'warning' };
  if (c.useCount >= c.maxUses) return { label: 'Terpakai', tone: 'info' };
  return { label: 'Aktif', tone: 'success' };
}

const cell: React.CSSProperties = { padding: `var(--space-3) var(--space-3)`, whiteSpace: 'nowrap' };

const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: `var(--space-3) var(--space-3)`,
  fontSize: '13px',
  fontFamily: 'var(--font-family)',
  color: 'var(--color-on-surface)',
  backgroundColor: 'var(--color-surface-container)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  outline: 'none',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '11px',
  fontWeight: 700,
  color: 'var(--color-on-surface-variant)',
  marginBottom: 'var(--space-2)',
};
