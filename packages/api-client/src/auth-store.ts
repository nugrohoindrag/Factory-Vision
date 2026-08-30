/**
 * Shared bearer-token store.
 *
 * Every screen in the console builds its own `FactoryVisionApiClient`, so the
 * token cannot live on one instance. Keeping it in one module means a single
 * `setAuthToken` at login authorises every client, and a single `clear` at
 * logout revokes them all, including the ones created before login.
 *
 * `localStorage` keeps the session across a reload; the server still decides
 * whether the token is valid, and a rejected token is cleared on the next 401.
 */
const TOKEN_KEY = 'fv_auth_token';
const TENANT_KEY = 'fv_tenant_id';

let token: string | null = read(TOKEN_KEY);
let tenantId: string | null = read(TENANT_KEY);

type Listener = (event: { reason: 'UNAUTHENTICATED' }) => void;
const listeners = new Set<Listener>();

function read(key: string): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  } catch {
    // Private browsing and embedded webviews can throw on access.
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* non-fatal: the session simply will not survive a reload */
  }
}

export function setAuthToken(next: string | null): void {
  token = next;
  write(TOKEN_KEY, next);
}

export function getAuthToken(): string | null {
  return token;
}

export function setTenantId(next: string | null): void {
  tenantId = next;
  write(TENANT_KEY, next);
}

export function getTenantId(): string | null {
  return tenantId;
}

export function clearAuth(): void {
  setAuthToken(null);
}

/**
 * Notified when the server rejects the session, so the app can return the user
 * to the login screen instead of leaving them on a page of empty tables.
 */
export function onAuthExpired(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyAuthExpired(): void {
  clearAuth();
  for (const listener of listeners) listener({ reason: 'UNAUTHENTICATED' });
}
