import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  FactoryVisionApiClient,
  setAuthToken,
  clearAuth,
  getAuthToken,
  onAuthExpired,
} from '@factory-vision/api-client';
import { Operator, SessionPrincipal } from '@factory-vision/domain-types';
import { OperatorAuth } from '../features/auth/OperatorAuth.js';
import { OperatorTerminal } from '../features/terminal/OperatorTerminal.js';
import { startSyncEngine, syncQueue, syncServerClock } from '../offline/queue.js';

const api = new FactoryVisionApiClient({ baseUrl: '' });

/** Activity that keeps a terminal session alive. */
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart'] as const;

export const App: React.FC = () => {
  const [operator, setOperator] = useState<Operator | null>(null);
  const [principal, setPrincipal] = useState<SessionPrincipal | null>(null);
  const [idleSeconds, setIdleSeconds] = useState<number>(15 * 60);
  const [restoring, setRestoring] = useState<boolean>(Boolean(getAuthToken()));

  const lastActivity = useRef<number>(Date.now());

  // The roster is a convenience for the picker, not a prerequisite for signing
  // in: reading it needs a session, and the operator does not have one yet. The
  // query is allowed to fail, and the login screen falls back to typing an
  // employee number.
  const { data: operators } = useQuery({
    queryKey: ['master-operators'],
    queryFn: () => api.master.getOperators(),
    retry: false,
    enabled: Boolean(getAuthToken()),
  });

  const endSession = useCallback(() => {
    clearAuth();
    setOperator(null);
    setPrincipal(null);
  }, []);

  // Restore a session across a tablet reload, a dropped browser must not cost
  // the operator their place mid-shift.
  useEffect(() => {
    if (!getAuthToken()) {
      setRestoring(false);
      return;
    }
    let cancelled = false;
    api.auth
      .session()
      .then((result) => {
        if (cancelled) return;
        if (result.operator) {
          setOperator(result.operator);
          setPrincipal(result.principal);
        } else {
          clearAuth();
        }
      })
      .catch(() => clearAuth())
      .finally(() => !cancelled && setRestoring(false));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => onAuthExpired(() => endSession()), [endSession]);

  // The queue runs regardless of who is signed in: commands captured before a
  // logout still belong to the server.
  useEffect(() => startSyncEngine(), []);

  /**
   * US-002, auto logout after inactivity.
   *
   * A terminal is shared hardware left unlocked on a bench between operators,
   * so an abandoned session is a real risk, not a theoretical one.
   */
  useEffect(() => {
    if (!principal) return;

    const markActive = () => {
      lastActivity.current = Date.now();
    };
    for (const event of ACTIVITY_EVENTS) window.addEventListener(event, markActive, { passive: true });

    const timer = window.setInterval(() => {
      const idleFor = (Date.now() - lastActivity.current) / 1000;
      if (idleFor >= idleSeconds) {
        void api.auth.logout().catch(() => undefined);
        endSession();
      }
    }, 10_000);

    return () => {
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, markActive);
      window.clearInterval(timer);
    };
  }, [principal, idleSeconds, endSession]);

  const handleAuthenticate = useCallback(async (employeeNumber: string, pin: string) => {
    const result = await api.auth.operatorLogin(employeeNumber, pin);
    setAuthToken(result.token);
    setOperator(result.operator ?? null);
    setPrincipal(result.principal);
    setIdleSeconds(result.idleTimeoutSeconds);
    lastActivity.current = Date.now();
    // Align the tablet's clock with the server before anything is queued.
    syncServerClock(result.principal.issuedAt);
    void syncQueue();
  }, []);

  const handleLogout = useCallback(() => {
    void api.auth.logout().catch(() => undefined);
    endSession();
  }, [endSession]);

  if (restoring) {
    return (
      <div
        style={{
          height: '100vh',
          backgroundColor: 'var(--color-background)',
          color: 'var(--color-on-background)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'var(--font-family)',
        }}
      >
        Memuat terminal operator…
      </div>
    );
  }

  if (!operator) {
    return <OperatorAuth operators={operators || []} onAuthenticate={handleAuthenticate} />;
  }

  return <OperatorTerminal operator={operator} onLogout={handleLogout} />;
};

export default App;
