import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Operator } from '@factory-vision/domain-types';
import { ApiRequestError } from '@factory-vision/api-client';
import { Button, M3_TRANSITIONS } from '@factory-vision/ui';
import { FullCircleLogo } from '@factory-vision/ui/fv';

interface OperatorAuthProps {
  operators: Operator[];
  /** Resolves the employee number + PIN against the API (US-002). */
  onAuthenticate: (employeeNumber: string, pin: string) => Promise<void>;
}

/**
 * US-002, Operator Login.
 *
 * Employee number + PIN on a numeric pad, because the operator is wearing
 * gloves at a machine, not sitting at a keyboard. Verification is a real
 * server call: an inactive operator is refused by the API, which is the only
 * place that can know it.
 */
export const OperatorAuth: React.FC<OperatorAuthProps> = ({ operators, onAuthenticate }) => {
  const [pin, setPin] = useState<string>('');
  const [selectedOperator, setSelectedOperator] = useState<Operator | null>(operators[0] || null);
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
        padding: '16px',
        fontFamily: 'var(--font-family)',
      }}
    >
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
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
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
            gap: '6px',
          }}
        >
          <FullCircleLogo size="lg" variant="full" />
          <div style={{ marginTop: '8px' }}>
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
            <p style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)', margin: '3px 0 0' }}>
              Pilih nomor karyawan lalu masukkan PIN 4 digit
            </p>
          </div>
        </div>

        {/* Operator Selector */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
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
                padding: '12px 14px',
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
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {operators.map((op) => {
                const isSelected = selectedOperator?.id === op.id;
                return (
                  <motion.button
                    key={op.id}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setSelectedOperator(op)}
                    style={{
                      minHeight: '48px',
                      padding: '6px 10px',
                      borderRadius: 'var(--radius-md, 8px)',
                      backgroundColor: isSelected
                        ? 'var(--color-primary)'
                        : 'var(--color-surface-container-low)',
                      border: isSelected ? 'none' : '1px solid var(--color-outline-variant)',
                      color: isSelected ? 'var(--color-on-primary)' : 'var(--color-on-surface)',
                      fontWeight: 700,
                      fontSize: '13px',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'border-color 0.15s ease, background-color 0.15s ease',
                    }}
                  >
                    <span>{op.name}</span>
                    <span
                      style={{
                        fontSize: '10px',
                        color: isSelected ? 'var(--color-on-primary)' : 'var(--color-on-surface-variant)',
                        opacity: isSelected ? 0.85 : 1,
                        fontWeight: 500,
                      }}
                    >
                      {op.employeeNumber}
                    </span>
                  </motion.button>
                );
              })}
            </div>
          )}
        </div>

        {/* PIN Indicator */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            gap: '14px',
            padding: '6px 0',
          }}
        >
          {[0, 1, 2, 3].map((idx) => (
            <motion.div
              key={idx}
              animate={{
                scale: pin.length > idx ? [1, 1.2, 1] : 1,
                backgroundColor:
                  pin.length > idx ? 'var(--color-primary)' : 'var(--color-surface-container-high)',
              }}
              transition={{ duration: 0.15 }}
              style={{
                width: '14px',
                height: '14px',
                borderRadius: '50%',
                boxShadow: pin.length > idx ? '0 0 8px var(--color-primary)' : 'none',
              }}
            />
          ))}
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map((btn) => (
            <motion.button
              key={btn}
              whileHover={{ scale: 1.04, y: -1 }}
              whileTap={{ scale: 0.94 }}
              onClick={() => {
                if (btn === 'C') handleClear;
                else if (btn === '⌫') handleBackspace;
                else handleDigit(btn);
              }}
              style={{
                minHeight: '50px',
                borderRadius: 'var(--radius-md, 8px)',
                backgroundColor: 'var(--color-surface-container-high)',
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
