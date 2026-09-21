import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ApiRequestError } from '@factory-vision/api-client';
import { Button, Icon, M3_TRANSITIONS } from '@factory-vision/ui';
import { FactoryVisionLogo } from '@factory-vision/ui/fv';
import { ThemeToggle } from '../../app/ThemeToggle.js';
import type { ThemeMode } from '../../app/theme.js';

interface OperatorAuthProps {
  /** Resolves the email + password against the API (US-002). */
  onAuthenticate: (email: string, password: string) => Promise<void>;
  themeMode: ThemeMode;
  onToggleTheme: () => void;
}

const labelStyle: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 700,
  color: 'var(--color-on-surface-variant)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  minHeight: '52px',
  padding: `var(--space-3) var(--space-4)`,
  fontSize: '16px',
  fontWeight: 700,
  fontFamily: 'var(--font-family)',
  color: 'var(--color-on-surface)',
  backgroundColor: 'var(--color-surface-container)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm, 8px)',
  outline: 'none',
  boxSizing: 'border-box',
};

/**
 * US-002, Operator Login.
 *
 * The same email and password as every other account, on a form sized for
 * a tablet. Verification is a real server call: an inactive operator is
 * refused by the API, which is the only place that can know it.
 */
export const OperatorAuth: React.FC<OperatorAuthProps> = ({ onAuthenticate, themeMode, onToggleTheme }) => {
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);

  const canSubmit = email.trim().length > 0 && password.length > 0 && !submitting;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      await onAuthenticate(email.trim(), password);
    } catch (err) {
      setPassword('');
      setError(
        err instanceof ApiRequestError ? err.message : 'Tidak dapat menghubungi server. Periksa koneksi.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        height: '100vh',
        backgroundColor: 'var(--color-background)',
        color: 'var(--color-on-background)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-4)',
        fontFamily: 'var(--font-family)',
        position: 'relative',
      }}
    >
      {/* Outside the card on purpose: the theme belongs to the tablet, not to
          the sign-in form, and it has to be reachable before anyone has a
          session. */}
      <div style={{ position: 'absolute', top: 'var(--space-4)', right: 'var(--space-4)' }}>
        <ThemeToggle mode={themeMode} onToggle={onToggleTheme} />
      </div>

      <motion.form
        onSubmit={(e) => void handleSubmit(e)}
        initial={{ opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={M3_TRANSITIONS.enter}
        style={{
          backgroundColor: 'var(--color-surface)',
          borderRadius: 'var(--radius-xl, 18px)',
          border: '1px solid var(--color-border)',
          width: '100%',
          maxWidth: '400px',
          padding: 'var(--space-6)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-4)',
          boxShadow: 'var(--elevation-3)',
        }}
      >
        {/* Brand Header */}
        <div
          style={{
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 'var(--space-2)',
          }}
        >
          <FactoryVisionLogo size="lg" variant="full" />
          <div style={{ marginTop: 'var(--space-2)' }}>
            <h1
              style={{
                fontSize: '18px',
                fontWeight: 800,
                margin: 0,
                letterSpacing: '-0.02em',
                color: 'var(--color-on-surface)',
              }}
            >
              TERMINAL OPERATOR
            </h1>
            <p style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)', margin: 'var(--space-1) 0 0' }}>
              Masuk dengan email dan kata sandi operator Anda
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <label htmlFor="fv-operator-email" style={labelStyle}>
            Email
          </label>
          <input
            id="fv-operator-email"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError('');
            }}
            placeholder="nama@perusahaan.co.id"
            style={inputStyle}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <label htmlFor="fv-operator-password" style={labelStyle}>
            Kata sandi
          </label>
          <div style={{ position: 'relative' }}>
            <input
              id="fv-operator-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError('');
              }}
              placeholder="••••••••••••"
              style={{
                ...inputStyle,
                paddingRight: 'var(--space-9, 56px)',
                borderColor: error ? 'var(--color-error)' : 'var(--color-border)',
              }}
            />
            {/* A tablet keyboard hides what was typed; a glove hides it
                twice. The toggle is large enough to hit on the first try. */}
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
              style={{
                position: 'absolute',
                right: 'var(--space-2)',
                top: '50%',
                transform: 'translateY(-50%)',
                minWidth: '40px',
                minHeight: '40px',
                border: 'none',
                background: 'transparent',
                color: 'var(--color-on-surface-variant)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name={showPassword ? 'visibility_off' : 'visibility'} size={20} />
            </button>
          </div>
        </div>

        {/* Error Notification */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              style={{ textAlign: 'center', color: 'var(--color-error)', fontSize: '12px', fontWeight: 700 }}
            >
              {error}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Submit Button */}
        <motion.div whileHover={{ scale: canSubmit ? 1.02 : 1 }} whileTap={{ scale: canSubmit ? 0.98 : 1 }}>
          <Button
            type="submit"
            variant="filled"
            disabled={!canSubmit}
            style={{
              width: '100%',
              height: '46px',
              fontSize: '14px',
              fontWeight: 800,
              borderRadius: 'var(--radius-md, 8px)',
            }}
          >
            {submitting ? 'Memverifikasi…' : 'Masuk Terminal'}
          </Button>
        </motion.div>

        <p
          style={{
            margin: 0,
            textAlign: 'center',
            fontSize: '11.5px',
            color: 'var(--color-on-surface-variant)',
            lineHeight: 1.6,
          }}
        >
          Sesi terminal berakhir otomatis setelah 15 menit tanpa aktivitas, karena satu tablet dipakai
          bergantian di lantai produksi.
        </p>
      </motion.form>
    </div>
  );
};
