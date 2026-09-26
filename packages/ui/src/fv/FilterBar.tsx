import React from 'react';
import { SurfaceCard } from './SurfaceCard.js';

export interface FilterBarProps {
  children: React.ReactNode;
  /** Buttons that act on the filtered view, pinned to the right of the row. */
  actions?: React.ReactNode;
  /** A line under the row: a validation message, a job's progress. */
  footer?: React.ReactNode;
  style?: React.CSSProperties;
}

/**
 * Factory Vision, the filter toolbar above a list or a board.
 *
 * One card, one row: fields, chip groups and the page's actions side by side,
 * wrapping only when the viewport runs out. `DateField`, `Select` and
 * `FilledTextField` all fill their container (`width: 100%`), so a bare field
 * dropped into a flex row takes the whole row, and two period fields stacked
 * into a card half a screen tall. Put each field in a `FilterField`, which
 * gives it a fixed width, and the row stays one line.
 */
export const FilterBar: React.FC<FilterBarProps> = ({ children, actions, footer, style }) => (
  <SurfaceCard padding="md" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', ...style }}>
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-3)' }}>
      {children}
      {actions ? (
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginLeft: 'auto', whiteSpace: 'nowrap' }}>{actions}</div>
      ) : null}
    </div>
    {footer}
  </SurfaceCard>
);

export interface FilterFieldProps {
  children: React.ReactNode;
  /** Width of the field. 180px fits a date; a line or product picker wants more. */
  width?: string;
}

/** One field of a `FilterBar`, held at a fixed width. */
export const FilterField: React.FC<FilterFieldProps> = ({ children, width = '180px' }) => (
  <div style={{ width, flex: '0 0 auto' }}>{children}</div>
);

/** A run of `FilterChip`s inside a `FilterBar`, kept together on one line. */
export const FilterChipGroup: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>{children}</div>
);
