import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  FactoryVisionApiClient,
  ApiRequestError,
  setAuthToken,
  clearAuth,
  getAuthToken,
  onAuthExpired,
} from '@factory-vision/api-client';
import type { AppUser, SessionPrincipal } from '@factory-vision/domain-types';

const api = new FactoryVisionApiClient({ baseUrl: '' });

interface SessionState {
  principal: SessionPrincipal | null;
  user: AppUser | null;
  /** True while the stored token is being validated on first paint. */
  restoring: boolean;
}

interface SessionContextValue extends SessionState {
  login: (email: string, password: string) => Promise<SessionPrincipal>;
  logout: () => Promise<void>;
  /**
   * US-003, the console renders from the very permission ids the API enforces,
   * so a hidden button and a rejected request can never disagree.
   */
  can: (permission: string) => boolean;
  canAny: (...permissions: string[]) => boolean;
  /** True when the session is limited to specific plants/lines. */
  isScoped: boolean;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export const SessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<SessionState>({
    principal: null,
    user: null,
    restoring: Boolean(getAuthToken()),
  });

  // A token in localStorage is a claim, not proof. Validate it before showing
  // the app, so an expired session lands on the login screen rather than on a
  // dashboard that fails every request behind it.
  useEffect(() => {
    let cancelled = false;
    if (!getAuthToken()) {
      setState((s) => ({ ...s, restoring: false }));
      return;
    }
    api.auth
      .session()
      .then((result) => {
        if (cancelled) return;
        setState({ principal: result.principal, user: result.user ?? null, restoring: false });
      })
      .catch(() => {
        if (cancelled) return;
        clearAuth();
        setState({ principal: null, user: null, restoring: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The API client raises this when any request comes back 401, an idle
  // timeout, or an admin revoking the session (US-005).
  useEffect(
    () =>
      onAuthExpired(() => {
        setState({ principal: null, user: null, restoring: false });
      }),
    []
  );

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.auth.login(email, password);
    setAuthToken(result.token);
    setState({ principal: result.principal, user: result.user ?? null, restoring: false });
    return result.principal;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
    } catch (error) {
      // A failed logout call must still clear the client; the server session
      // expires on its own.
      if (!(error instanceof ApiRequestError)) throw error;
    } finally {
      clearAuth();
      setState({ principal: null, user: null, restoring: false });
    }
  }, []);

  const value = useMemo<SessionContextValue>(() => {
    const permissions = new Set(state.principal?.permissions ?? []);
    return {
      ...state,
      login,
      logout,
      can: (permission: string) => permissions.has(permission),
      canAny: (...list: string[]) => list.some((p) => permissions.has(p)),
      isScoped: (state.principal?.scope.level ?? 'TENANT') !== 'TENANT',
    };
  }, [state, login, logout]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
};

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside a SessionProvider');
  return context;
}

/**
 * Hides a subtree unless the session holds one of the permissions.
 *
 * Used for actions inside a page; whole routes are gated in App.tsx so an
 * unauthorised deep link redirects instead of rendering an empty shell.
 */
export const RequirePermission: React.FC<{
  anyOf: string[];
  children: React.ReactNode;
  fallback?: React.ReactNode;
}> = ({ anyOf, children, fallback = null }) => {
  const { canAny } = useSession();
  return <>{canAny(...anyOf) ? children : fallback}</>;
};
