import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FactoryVisionApiClient, ApiRequestError } from '@factory-vision/api-client';
import { Button, Icon } from '@factory-vision/ui';
import { SurfaceCard } from '@factory-vision/ui/fv';

const api = new FactoryVisionApiClient({ baseUrl: '' });

/**
 * Multi-factor authentication for the signed-in account (§5).
 *
 * Enrolment is deliberately two steps with the secret shown as text: a QR
 * image would be friendlier, but a manufacturing console is often opened on a
 * desktop next to the phone that will hold the code, and typing a secret once
 * beats shipping a QR renderer that has to be kept patched. The code proves
 * the app and the server agree before anything is enforced, so a mistyped
 * secret costs one retry rather than an account.
 */
export const MfaCard: React.FC<{ onToast: (message: string) => void }> = ({ onToast }) => {
  const queryClient = useQueryClient();

  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [disabling, setDisabling] = useState(false);

  const { data: status, isLoading } = useQuery({
    queryKey: ['mfa-status'],
    queryFn: () => api.auth.mfaStatus(),
  });

  const describe = (err: unknown) =>
    setError(err instanceof ApiRequestError ? err.message : 'Terjadi kesalahan. Coba lagi.');

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['mfa-status'] });

  const enroll = useMutation({
    mutationFn: () => api.auth.enrollMfa(),
    onSuccess: (result) => {
      setError(null);
      setSecret(result.secret);
      setRecoveryCodes(null);
    },
    onError: describe,
  });

  const confirm = useMutation({
    mutationFn: () => api.auth.confirmMfa(code.trim()),
    onSuccess: (result) => {
      setError(null);
      setSecret(null);
      setCode('');
      setRecoveryCodes(result.recoveryCodes);
      onToast('MFA aktif. Simpan recovery code di tempat aman.');
      void refresh();
    },
    onError: describe,
  });

  const disable = useMutation({
    mutationFn: () => api.auth.disableMfa(code.trim()),
    onSuccess: () => {
      setError(null);
      setCode('');
      setDisabling(false);
      onToast('MFA dinonaktifkan.');
      void refresh();
    },
    onError: describe,
  });

  const labelStyle: React.CSSProperties = {
    display: 'block',
    marginBottom: 'var(--space-2)',
    fontSize: '12px',
    fontWeight: 700,
    color: 'var(--color-on-surface-variant)',
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    height: '40px',
    padding: '0 var(--space-3)',
    borderRadius: 'var(--radius-sm, 8px)',
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-on-surface)',
    fontFamily: 'var(--font-family)',
    fontSize: '13px',
    boxSizing: 'border-box',
  };

  const monospace: React.CSSProperties = {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '13px',
    letterSpacing: '0.08em',
    wordBreak: 'break-all',
  };

  return (
    <SurfaceCard style={{ padding: 'var(--space-4)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-3)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <Icon name="encrypted" size={18} />
          <strong style={{ fontSize: '14px' }}>Verifikasi Dua Langkah (MFA)</strong>
        </div>
        {status?.enrolled ? (
          <span
            style={{
              padding: '2px var(--space-2)',
              borderRadius: 'var(--radius-xs, 4px)',
              backgroundColor: 'var(--color-primary-container)',
              color: 'var(--color-on-primary-container)',
              fontSize: '11px',
              fontWeight: 700,
            }}
          >
            AKTIF
          </span>
        ) : status?.required ? (
          <span
            style={{
              padding: '2px var(--space-2)',
              borderRadius: 'var(--radius-xs, 4px)',
              backgroundColor: 'var(--color-error-container)',
              color: 'var(--color-on-error-container)',
              fontSize: '11px',
              fontWeight: 700,
            }}
          >
            WAJIB, BELUM AKTIF
          </span>
        ) : null}
      </div>

      <p style={{ margin: `0 0 var(--space-3)`, fontSize: '12px', color: 'var(--color-on-surface-variant)', lineHeight: 1.6 }}>
        Kata sandi saja tidak cukup untuk akun dengan hak tinggi. Dengan MFA aktif, login meminta kode
        enam digit dari aplikasi authenticator di ponsel Anda.
      </p>

      {isLoading && <span style={{ fontSize: '12px' }}>Memuat status…</span>}

      {status && !status.available && (
        <div
          style={{
            padding: 'var(--space-3)',
            borderRadius: 'var(--radius-sm, 8px)',
            backgroundColor: 'var(--color-surface-container)',
            fontSize: '12px',
            color: 'var(--color-on-surface-variant)',
          }}
        >
          MFA belum dapat diaktifkan: administrator server belum mengatur <code>MFA_ENCRYPTION_KEY</code>.
        </div>
      )}

      {error && (
        <div
          role="alert"
          style={{
            marginBottom: 'var(--space-3)',
            padding: 'var(--space-3)',
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

      {/* Recovery codes are shown exactly once, immediately after enrolment. */}
      {recoveryCodes && (
        <div
          style={{
            marginBottom: 'var(--space-3)',
            padding: 'var(--space-3)',
            borderRadius: 'var(--radius-sm, 8px)',
            border: '1px solid var(--color-border)',
            backgroundColor: 'var(--color-surface-container)',
          }}
        >
          <strong style={{ fontSize: '12px' }}>Recovery code — disalin sekarang, tidak ditampilkan lagi</strong>
          <div
            style={{
              marginTop: 'var(--space-2)',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
              gap: 'var(--space-2)',
              ...monospace,
            }}
          >
            {recoveryCodes.map((value) => (
              <span key={value}>{value}</span>
            ))}
          </div>
        </div>
      )}

      {status?.available && !status.enrolled && !secret && (
        <Button variant="filled" onClick={() => enroll.mutate()} disabled={enroll.isPending}>
          {enroll.isPending ? 'Menyiapkan…' : 'Aktifkan MFA'}
        </Button>
      )}

      {secret && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div>
            <span style={labelStyle}>1. Masukkan kunci ini ke aplikasi authenticator</span>
            <div
              style={{
                padding: 'var(--space-3)',
                borderRadius: 'var(--radius-sm, 8px)',
                backgroundColor: 'var(--color-surface-container)',
                ...monospace,
              }}
            >
              {secret}
            </div>
          </div>
          <div>
            <label htmlFor="fv-mfa-confirm" style={labelStyle}>
              2. Masukkan kode enam digit yang muncul
            </label>
            <input
              id="fv-mfa-confirm"
              inputMode="numeric"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="123456"
              style={inputStyle}
            />
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <Button
              variant="filled"
              onClick={() => confirm.mutate()}
              disabled={confirm.isPending || code.trim().length < 6}
            >
              {confirm.isPending ? 'Memverifikasi…' : 'Konfirmasi'}
            </Button>
            <Button
              variant="text"
              onClick={() => {
                setSecret(null);
                setCode('');
                setError(null);
              }}
            >
              Batal
            </Button>
          </div>
        </div>
      )}

      {status?.enrolled && !disabling && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <span style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
            {status.recoveryCodesRemaining} recovery code tersisa.
          </span>
          <Button variant="text" onClick={() => setDisabling(true)}>
            Nonaktifkan
          </Button>
        </div>
      )}

      {status?.enrolled && disabling && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div>
            <label htmlFor="fv-mfa-disable" style={labelStyle}>
              Masukkan kode berjalan untuk menonaktifkan
            </label>
            <input
              id="fv-mfa-disable"
              inputMode="numeric"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="123456"
              style={inputStyle}
            />
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <Button
              variant="filled"
              onClick={() => disable.mutate()}
              disabled={disable.isPending || code.trim().length < 6}
            >
              {disable.isPending ? 'Memproses…' : 'Nonaktifkan MFA'}
            </Button>
            <Button
              variant="text"
              onClick={() => {
                setDisabling(false);
                setCode('');
                setError(null);
              }}
            >
              Batal
            </Button>
          </div>
        </div>
      )}
    </SurfaceCard>
  );
};
