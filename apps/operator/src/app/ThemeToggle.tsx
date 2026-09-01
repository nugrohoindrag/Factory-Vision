import React from 'react';
import { Icon } from '@factory-vision/ui';
import type { ThemeMode } from './theme.js';

interface ThemeToggleProps {
  mode: ThemeMode;
  onToggle: () => void;
}

/**
 * Terang / gelap, sized for a gloved hand.
 *
 * 44px is the smallest target that survives a work glove on a wall-mounted
 * tablet, so this stays square at that size rather than matching the denser
 * controls the console uses with a mouse.
 */
export const ThemeToggle: React.FC<ThemeToggleProps> = ({ mode, onToggle }) => (
  <button
    type="button"
    onClick={onToggle}
    aria-label={mode === 'dark' ? 'Beralih ke tampilan terang' : 'Beralih ke tampilan gelap'}
    title={mode === 'dark' ? 'Tampilan terang' : 'Tampilan gelap'}
    style={{
      width: '44px',
      height: '44px',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 'var(--radius-md)',
      backgroundColor: 'var(--color-surface-container-high)',
      border: '1px solid var(--color-outline-variant)',
      color: 'var(--color-on-surface-variant)',
      cursor: 'pointer',
    }}
  >
    <Icon name={mode === 'dark' ? 'light_mode' : 'dark_mode'} size={20} />
  </button>
);
