import React, { useState } from 'react';
import { Button, Icon } from '@factory-vision/ui';
import { SurfaceCard, toneContainer, toneOnContainer } from '@factory-vision/ui/fv';
import { InternalApiError } from '../../app/api.js';
import { useSession } from '../../app/SessionContext.js';

/**
 * Sign-in for vendor staff.
 *
 * Deliberately plain. This console is reached by a handful of people who
 * already know what it is, so it carries no marketing panel and no hint about
 * what lies behind it, and it says plainly that it is not the customer console
 * in case someone arrives here by mistake.
 */
export const AdminLogin: React.FC = () => {
  const { login } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(
        err instanceof InternalApiError ? err.message : 'Tidak dapat menghubungi server. Periksa koneksi.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '12px 14px',
    fontSize: '14px',
    fontFamily: 'var(--font-family)',
    color: 'var(--color-on-surface)',
    backgroundColor: 'var(--color-surface-container)',
    border: '1px solid var(--color-outline-variant)',
    borderRadius: 'var(--radius-sm, 8px)',
    outline: 'none',
    boxSizing: 'border-box',
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: '24px',
        backgroundColor: 'var(--color-background)',
        color: 'var(--color-on-background)',
        fontFamily: 'var(--font-family)',
      }}
    >
      <SurfaceCard padding="lg" style={{ width: '100%', maxWidth: '400px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 10px',
                borderRadius: 'var(--radius-full, 999px)',
                backgroundColor: toneContainer.warning,
                color: toneOnContainer.warning,
                fontSize: '11px',
                fontWeight: 800,
                letterSpacing: '0.04em',
              }}
            >
              <Icon name="lock" size={13} />
              INTERNAL
            </span>
            <h1
              style={{
                margin: '12px 0 4px',
                fontSize: '24px',
                fontWeight: 800,
                letterSpacing: '-0.02em',
                color: 'var(--color-on-surface)',
              }}
            >
              Admin Manajemen Klien
            </h1>
            <p
              style={{
                margin: 0,
                fontSize: '12.5px',
                color: 'var(--color-on-surface-variant)',
                lineHeight: 1.6,
              }}
            >
              Konsol internal untuk mengelola akun pelanggan. Ini bukan konsol pabrik, pengguna pabrik masuk
              melalui alamat konsol mereka sendiri.
            </p>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label
                htmlFor="admin-email"
                style={{
                  display: 'block',
                  fontSize: '12px',
                  fontWeight: 700,
                  color: 'var(--color-on-surface-variant)',
                  marginBottom: '6px',
                }}
              >
                Email Internal
              </label>
              <input
                id="admin-email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nama@stechoq.com"
                style={inputStyle}
              />
            </div>

            <div>
              <label
                htmlFor="admin-password"
                style={{
                  display: 'block',
                  fontSize: '12px',
                  fontWeight: 700,
                  color: 'var(--color-on-surface-variant)',
                  marginBottom: '6px',
                }}
              >
                Kata Sandi
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  id="admin-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  style={{ ...inputStyle, paddingRight: '44px' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
                  style={{
                    position: 'absolute',
                    right: '6px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '6px',
                    color: 'var(--color-on-surface-variant)',
                    display: 'flex',
                  }}
                >
                  <Icon name={showPassword ? 'visibility_off' : 'visibility'} size={18} />
                </button>
              </div>
            </div>

            {error && (
              <div
                role="alert"
                style={{
                  display: 'flex',
                  gap: '8px',
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-sm, 8px)',
                  backgroundColor: 'var(--color-error-container)',
                  color: 'var(--color-on-error-container)',
                  fontSize: '12px',
                  fontWeight: 600,
                }}
              >
                <Icon name="error" size={16} />
                <span>{error}</span>
              </div>
            )}

            <Button
              type="submit"
              variant="filled"
              disabled={submitting}
              icon={<Icon name="login" size={16} />}
              style={{ width: '100%', height: '44px' }}
            >
              {submitting ? 'Memverifikasi…' : 'Masuk'}
            </Button>
          </form>

          <p
            style={{ margin: 0, fontSize: '11.5px', color: 'var(--color-on-surface-variant)', lineHeight: 1.6 }}
          >
            Setiap tindakan di konsol ini tercatat dalam audit internal, termasuk akses ke data pelanggan.
          </p>
        </div>
      </SurfaceCard>
    </div>
  );
};
