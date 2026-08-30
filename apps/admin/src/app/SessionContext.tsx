import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, clearToken, getToken, setExpiryHandler, setToken, type InternalPrincipal } from './api.js';

/**
 * The vendor staff session.
 *
 * Short by design: an internal console can reach every customer's commercial
 * record, so it drops after 30 minutes of inactivity and does not survive
 * closing the tab.
 */

interface SessionValue {
  principal: InternalPrincipal | null;
  restoring: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  can: (right: string) => boolean;
}

const ROLE_RIGHTS: Record<InternalPrincipal['role'], string[]> = {
  OWNER: ['client:view', 'client:manage', 'subscription:manage', 'support:grant', 'audit:view', 'staff:manage'],
  ACCOUNT_MANAGER: ['client:view', 'client:manage', 'subscription:manage', 'support:grant', 'audit:view'],
  SUPPORT: ['client:view', 'support:grant', 'audit:view'],
};

const SessionContext = createContext<SessionValue | null>(null);

export const SessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [principal, setPrincipal] = useState<InternalPrincipal | null>(null);
  const [restoring, setRestoring] = useState<boolean>(Boolean(getToken()));

  const logout = useCallback(() => {
    void api.auth.logout().catch(() => undefined);
    clearToken();
    setPrincipal(null);
  }, []);

  // The API is the authority on whether a stored token is still good, so ask
  // it rather than trusting what is in storage.
  useEffect(() => {
    if (!getToken()) {
      setRestoring(false);
      return;
    }
    let cancelled = false;
    api.auth
      .session()
      .then((result) => {
        if (!cancelled) setPrincipal(result.principal);
      })
      .catch(() => clearToken())
      .finally(() => {
        if (!cancelled) setRestoring(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // A 401 from any call means the session went; drop it here rather than
  // letting each screen discover it separately.
  useEffect(() => {
    setExpiryHandler(() => setPrincipal(null));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.auth.login(email, password);
    setToken(result.token);
    setPrincipal(result.principal);
  }, []);

  const can = useCallback(
    (right: string) => (principal ? ROLE_RIGHTS[principal.role].includes(right) : false),
    [principal]
  );

  const value = useMemo(
    () => ({ principal, restoring, login, logout, can }),
    [principal, restoring, login, logout, can]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
};

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}
