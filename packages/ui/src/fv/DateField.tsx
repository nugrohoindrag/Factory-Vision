import React, { useState } from 'react';

/**
 * Factory Vision, a date input whose label does not collide with the browser's
 * own placeholder.
 *
 * `FilledTextField` floats its label only when the field is focused or holds a
 * value, which is right for text. A `type="date"` input is different: the
 * browser always paints `dd/mm/yyyy` inside it, so an empty one showed the
 * resting label written over that placeholder — two overlapping strings in
 * every date filter on the planning screens.
 *
 * The label here is therefore always floated. Everything else follows the same
 * recipe as the filled text field — 56px, `surface-container-highest`, the
 * hairline that thickens to the accent on focus — so the two sit side by side
 * in a filter row without looking like different controls.
 *
 * It lives in `fv/` rather than being fixed in place because
 * `packages/ui/src/components` is a byte-for-byte mirror of the upstream design
 * system and must not be edited.
 */
export interface DateFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
  error?: string;
  supportingText?: string;
  /** `date` by default; `month` and `datetime-local` share the problem. */
  type?: 'date' | 'month' | 'time' | 'datetime-local';
}

export const DateField: React.FC<DateFieldProps> = ({
  label,
  error,
  supportingText,
  type = 'date',
  disabled,
  className = '',
  style,
  onFocus,
  onBlur,
  ...props
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const isError = Boolean(error);
  const accent = isError
    ? 'var(--color-error)'
    : isFocused
      ? 'var(--color-primary)'
      : 'var(--color-on-surface-variant)';

  return (
    <div
      className={`fv-date-field ${className}`}
      style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%', ...style }}
    >
      <div
        style={{
          position: 'relative',
          height: '56px',
          borderRadius: 'var(--radius-xs) var(--radius-xs) 0 0',
          backgroundColor: 'var(--color-surface-container-highest)',
          borderBottom: `${isFocused || isError ? '2px' : '1px'} solid ${accent}`,
          display: 'flex',
          alignItems: 'flex-end',
          opacity: disabled ? 0.38 : 1,
        }}
      >
        <label
          style={{
            position: 'absolute',
            left: '16px',
            top: '8px',
            fontSize: '12px',
            lineHeight: 1,
            color: accent,
            pointerEvents: 'none',
            fontFamily: 'var(--font-family)',
          }}
        >
          {label}
        </label>
        <input
          {...props}
          type={type}
          disabled={disabled}
          onFocus={(e) => {
            setIsFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setIsFocused(false);
            onBlur?.(e);
          }}
          style={{
            width: '100%',
            border: 'none',
            outline: 'none',
            background: 'transparent',
            padding: '0 16px 8px',
            fontSize: '14px',
            fontFamily: 'var(--font-family)',
            color: 'var(--color-on-surface)',
            colorScheme: 'light dark',
          }}
        />
      </div>
      {(error || supportingText) && (
        <span
          style={{
            fontSize: '12px',
            paddingLeft: '16px',
            color: isError ? 'var(--color-error)' : 'var(--color-on-surface-variant)',
            fontFamily: 'var(--font-family)',
          }}
        >
          {error || supportingText}
        </span>
      )}
    </div>
  );
};
