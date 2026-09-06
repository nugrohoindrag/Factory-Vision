import React, { useState, useCallback, useMemo } from 'react';
import { Icon } from '@factory-vision/ui';

/**
 * Reusable badge component to visually highlight newly created items.
 * Adheres strictly to Factory Vision design tokens and design system.
 */
export const NewlyCreatedBadge: React.FC<{ label?: string }> = ({ label = 'BARU DIBUAT' }) => (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 'var(--space-1)',
      padding: '2px 8px',
      borderRadius: 'var(--radius-pill)',
      backgroundColor: 'color-mix(in srgb, var(--color-success) 16%, transparent)',
      border: '1px solid color-mix(in srgb, var(--color-success) 35%, transparent)',
      color: 'var(--color-success)',
      fontSize: '10.5px',
      fontWeight: 800,
      letterSpacing: '0.04em',
      lineHeight: '16px',
      whiteSpace: 'nowrap',
      animation: 'fvPulse 2.5s ease-in-out infinite',
    }}
    title="Data baru saja berhasil dibuat pada sesi ini"
  >
    <span
      style={{
        width: '6px',
        height: '6px',
        borderRadius: '50%',
        backgroundColor: 'var(--color-success)',
        display: 'inline-block',
      }}
    />
    <span>{label}</span>
    <style>{`
      @keyframes fvPulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.7; }
      }
    `}</style>
  </span>
);

/**
 * Hook to manage transient "Newly Created" items across data tables / lists.
 * Per PRD v1.1 Requirement:
 * - Temporary in-memory session state (resets on browser refresh).
 * - Floats newly created items to the top position (#1).
 * - Highlights with visual badge.
 */
export function useNewlyCreated<T extends { id: string }>(sessionStorageKey?: string) {
  const [newlyCreatedId, setNewlyCreatedId] = useState<string | null>(() => {
    if (typeof window !== 'undefined' && sessionStorageKey) {
      return sessionStorage.getItem(sessionStorageKey);
    }
    return null;
  });

  const markNewlyCreated = useCallback((id: string) => {
    setNewlyCreatedId(id);
    if (typeof window !== 'undefined' && sessionStorageKey) {
      sessionStorage.setItem(sessionStorageKey, id);
    }
  }, [sessionStorageKey]);

  const clearNewlyCreated = useCallback(() => {
    setNewlyCreatedId(null);
    if (typeof window !== 'undefined' && sessionStorageKey) {
      sessionStorage.removeItem(sessionStorageKey);
    }
  }, [sessionStorageKey]);

  const isNewlyCreated = useCallback(
    (id: string) => newlyCreatedId !== null && newlyCreatedId === id,
    [newlyCreatedId]
  );

  /**
   * Sorts the item list such that the newly created record is guaranteed
   * to sit at index 0 (#1 top position).
   */
  const sortWithNewlyCreated = useCallback(
    (items: T[]): T[] => {
      if (!newlyCreatedId) return items;
      const targetIdx = items.findIndex((it) => it.id === newlyCreatedId);
      if (targetIdx <= 0) return items; // already at top or not found
      const copy = [...items];
      const [item] = copy.splice(targetIdx, 1);
      return [item, ...copy];
    },
    [newlyCreatedId]
  );

  return {
    newlyCreatedId,
    markNewlyCreated,
    clearNewlyCreated,
    isNewlyCreated,
    sortWithNewlyCreated,
    NewlyCreatedBadge,
  };
}
