import { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'dark' | 'light';

const STORAGE_KEY = 'fv_operator_theme';

/**
 * Dark by default. A terminal lives on the shop floor, often in a bay lit for
 * machines rather than for reading, and a full-brightness white screen at 02:00
 * is the complaint that follows a light default onto every night shift.
 */
const DEFAULT_MODE: ThemeMode = 'dark';

function readStored(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : DEFAULT_MODE;
  } catch {
    // A tablet with site data blocked still has to boot. Falling back to the
    // default is correct here: the preference is a convenience, not state the
    // terminal depends on.
    return DEFAULT_MODE;
  }
}

/**
 * The terminal's theme, remembered per device.
 *
 * Per device and not per operator on purpose: the preference belongs to the
 * bay the tablet is bolted to, not to whoever is signed in, so it must survive
 * a shift handover — and it has to apply before anyone signs in at all, which
 * is why this sits above the session in `App`.
 */
export function useOperatorTheme(): { mode: ThemeMode; toggle: () => void } {
  const [mode, setMode] = useState<ThemeMode>(readStored);

  useEffect(() => {
    // `data-theme` is what fv/palette.css keys both palettes off; the body
    // classes are what the mirror's own components read. Console sets the same
    // pair, and a screen that sets only one ends up half-themed.
    document.documentElement.setAttribute('data-theme', mode);
    document.body.classList.toggle('morphic-theme-dark', mode === 'dark');
    document.body.classList.toggle('morphic-theme-light', mode === 'light');
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Not being able to remember the choice is not a reason to refuse it.
    }
  }, [mode]);

  const toggle = useCallback(() => {
    setMode((current) => (current === 'dark' ? 'light' : 'dark'));
  }, []);

  return { mode, toggle };
}
