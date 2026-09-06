import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Operator } from '@factory-vision/domain-types';
import { ApiRequestError } from '@factory-vision/api-client';
import { Button, Icon, M3_TRANSITIONS } from '@factory-vision/ui';
import { FactoryVisionLogo } from '@factory-vision/ui/fv';
import { ThemeToggle } from '../../app/ThemeToggle.js';
import type { ThemeMode } from '../../app/theme.js';

interface OperatorAuthProps {
  operators: Operator[];
  /** Resolves the employee number + PIN against the API (US-002). */
  onAuthenticate: (employeeNumber: string, pin: string) => Promise<void>;
  themeMode: ThemeMode;
  onToggleTheme: () => void;
}

/**
 * US-002, Operator Login.
 *
 * Employee number + PIN on a numeric pad, because the operator is wearing
 * gloves at a machine, not sitting at a keyboard. Verification is a real
 * server call: an inactive operator is refused by the API, which is the only
 * place that can know it.
 */
export const OperatorAuth: React.FC<OperatorAuthProps> = ({
  operators,
  onAuthenticate,
  themeMode,
  onToggleTheme,
}) => {
  const [pin, setPin] = useState<string>('');
  /*
   * Deliberately empty, not `operators[0]`.
   *
   * BOOTSTRAP_OPERATOR_PIN issues one starting PIN to every operator who has
   * none, so a pre-filled name plus a shared PIN signs somebody in as the
   * wrong person and records their shift's production under that name.
   */
  const [selectedOperator, setSelectedOperator] = useState<Operator | null>(null);
  // Used when the roster is not readable, which is the normal case before a
  // session exists.
  const [typedEmployeeNumber, setTypedEmployeeNumber] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);

  const handleDigit = (digit: string) => {
    if (pin.length < 4) {
      setPin((prev) => prev + digit);
      setError('');
    }
  };

  const handleBackspace = () => {
    setPin((prev) => prev.slice(0, -1));
    setError('');
  };

  const handleClear = () => {
    setPin('');
    setError('');
  };

  const handleSubmit = async () => {
    const employeeNumber = selectedOperator?.employeeNumber ?? typedEmployeeNumber.trim();
    if (!employeeNumber) {
      setError('Masukkan nomor karyawan terlebih dahulu');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await onAuthenticate(employeeNumber, pin);
    } catch (err) {
      setPin('');
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

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={M3_TRANSITIONS.enter}
        style={{
          backgroundColor: 'var(--color-surface)',
          borderRadius: 'var(--radius-xl, 18px)',
          border: '1px solid var(--color-outline-variant)',
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
              Pilih nomor karyawan lalu masukkan PIN 4 digit
            </p>
          </div>
        </div>

        {/* Operator Selector */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <label
            style={{
              fontSize: '11px',
              fontWeight: 700,
              color: 'var(--color-on-surface-variant)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            Nomor Karyawan
          </label>
          {operators.length === 0 ? (
            <input
              value={typedEmployeeNumber}
              onChange={(e) => {
                setTypedEmployeeNumber(e.target.value);
                setError('');
              }}
              placeholder="Contoh: OP-1001"
              autoComplete="off"
              style={{
                width: '100%',
                padding: `var(--space-3) var(--space-4)`,
                fontSize: '16px',
                fontWeight: 700,
                letterSpacing: '0.04em',
                fontFamily: 'var(--font-family)',
                color: 'var(--color-on-surface)',
                backgroundColor: 'var(--color-surface-container)',
                border: '1px solid var(--color-outline-variant)',
                borderRadius: 'var(--radius-sm, 8px)',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          ) : (
            /*
             * A dropdown, not a grid of faces.
             *
             * The roster grows with the plant: a dozen buttons stopped fitting
             * the card long before a real shift's worth of operators would.
             * The native control also opens the platform's own picker, which
             * is already sized for a gloved finger on a tablet.
             */
            <div style={{ position: 'relative' }}>
              <select
                value={selectedOperator?.id ?? ''}
                onChange={(e) => {
                  setSelectedOperator(operators.find((op) => op.id === e.target.value) ?? null);
                  setError('');
                }}
                style={{
                  width: '100%',
                  minHeight: '52px',
                  padding: `var(--space-3) var(--space-7, 44px) var(--space-3) var(--space-4)`,
                  fontSize: '16px',
                  fontWeight: 700,
                  fontFamily: 'var(--font-family)',
                  color: selectedOperator ? 'var(--color-on-surface)' : 'var(--color-on-surface-variant)',
                  backgroundColor: 'var(--color-surface-container)',
                  border: '1px solid var(--color-outline-variant)',
                  borderRadius: 'var(--radius-sm, 8px)',
                  outline: 'none',
                  boxSizing: 'border-box',
                  appearance: 'none',
                  WebkitAppearance: 'none',
                  cursor: 'pointer',
                }}
              >
                <option value="">Pilih nomor karyawan…</option>
                {operators.map((op) => (
                  <option key={op.id} value={op.id}>
                    {op.employeeNumber} · {op.name}
                  </option>
                ))}
              </select>
              <Icon
                name="expand_more"
                size={22}
                style={{
                  position: 'absolute',
                  right: 'var(--space-3)',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--color-on-surface-variant)',
                  pointerEvents: 'none',
                }}
              />
            </div>
          )}
        </div>

        {/* PIN field — a labelled box, matching the employee-number field above */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <label
            style={{
              fontSize: '11px',
              fontWeight: 700,
              color: 'var(--color-on-surface-variant)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            Masukkan PIN Anda
          </label>
          <div
            style={{
              minHeight: '52px',
              padding: 'var(--space-3) var(--space-4)',
              backgroundColor: 'var(--color-surface-container)',
              border: `1px solid ${error ? 'var(--color-error)' : 'var(--color-outline-variant)'}`,
              borderRadius: 'var(--radius-sm, 8px)',
              boxSizing: 'border-box',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 'var(--space-4)',
            }}
          >
            {/* Four slots, not a free-text box: the field has to say how many
                digits are expected, and how many are already in. */}
            {[0, 1, 2, 3].map((idx) => (
              <motion.div
                key={idx}
                animate={{
                  scale: pin.length > idx ? [1, 1.2, 1] : 1,
                  backgroundColor:
                    pin.length > idx ? 'var(--color-primary)' : 'var(--color-surface-container-highest)',
                }}
                transition={{ duration: 0.15 }}
                style={{ width: '14px', height: '14px', borderRadius: '50%' }}
              />
            ))}
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

        {/* Touch Numpad */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-2)' }}>
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map((btn) => (
            <motion.button
              key={btn}
              whileHover={{ scale: 1.04, y: -1 }}
              whileTap={{ scale: 0.94 }}
              onClick={() => {
                // These two were written without their call parentheses, so
                // the keys rendered, animated, and did nothing at all.
                if (btn === 'C') handleClear();
                else if (btn === '⌫') handleBackspace();
                else handleDigit(btn);
              }}
              style={{
                minHeight: '52px',
                borderRadius: 'var(--radius-md, 8px)',
                // The lightest surface step: white under the light theme, and
                // its near-black counterpart under the dark one, so a night
                // shift is not staring at twelve white tiles.
                backgroundColor: 'var(--color-surface-container-lowest)',
                border: '1px solid var(--color-outline-variant)',
                color: 'var(--color-on-surface)',
                fontWeight: 800,
                fontSize: '18px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: 'var(--elevation-1)',
              }}
            >
              {btn}
            </motion.button>
          ))}
        </div>

        {/* Submit Button */}
        <motion.div
          whileHover={{ scale: pin.length === 4 ? 1.02 : 1 }}
          whileTap={{ scale: pin.length === 4 ? 0.98 : 1 }}
        >
          <Button
            variant="filled"
            onClick={() => void handleSubmit()}
            disabled={pin.length !== 4 || submitting}
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
      </motion.div>
    </div>
  );
};
