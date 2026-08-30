import type {
  ClientAccount,
  ClientOverview,
  ClientPortfolioSummary,
  ClientSubscription,
  ClientUsageSnapshot,
  InternalAuditEntry,
  InternalUser,
  SubscriptionPlan,
  SupportAccessGrant,
} from '@factory-vision/domain-types';

/**
 * Client for the vendor's own API.
 *
 * Separate from `@factory-vision/api-client` on purpose: that package is
 * shipped inside the customer console, and the internal endpoints have no
 * business being described there. Nothing here is reachable with a customer
 * token, and nothing there is reachable with an internal one.
 */

const BASE = '/api/internal/v1';
const TOKEN_KEY = 'fv_internal_token';

export interface InternalPrincipal {
  sessionId: string;
  email: string;
  name: string;
  role: 'OWNER' | 'ACCOUNT_MANAGER' | 'SUPPORT';
  issuedAt: string;
  expiresAt: string;
  idleExpiresAt: string;
}

export class InternalApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly fields: Array<{ field: string; message: string }>;

  constructor(
    status: number,
    code: string,
    message: string,
    fields: Array<{ field: string; message: string }> = []
  ) {
    super(message);
    this.name = 'InternalApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export const getToken = (): string | null => {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};

export const setToken = (token: string): void => {
  try {
    // sessionStorage, not localStorage: a vendor session should not outlive
    // the browser tab it was opened in.
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* private browsing; the session simply will not be restored */
  }
};

export const clearToken = (): void => {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* nothing to clear */
  }
};

let onExpired: (() => void) | null = null;
export const setExpiryHandler = (fn: () => void): void => {
  onExpired = fn;
};

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers as Record<string, string> | undefined),
    },
  });

  if (response.status === 401) {
    clearToken();
    onExpired?.();
  }

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const error = body?.error;
    throw new InternalApiError(
      response.status,
      error?.code ?? 'INTERNAL_ERROR',
      error?.message ?? `HTTP ${response.status}`,
      error?.fields ?? []
    );
  }

  return body as T;
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  auth: {
    login: (email: string, password: string) =>
      post<{ token: string; principal: InternalPrincipal }>('/auth/login', { email, password }),
    session: () => request<{ principal: InternalPrincipal }>('/auth/session'),
    logout: () => post<{ success: boolean }>('/auth/logout'),
  },

  summary: () => request<ClientPortfolioSummary>('/summary'),
  plans: () => request<SubscriptionPlan[]>('/plans'),

  clients: {
    list: (params: { status?: string; search?: string } = {}) => {
      const query = new URLSearchParams();
      if (params.status) query.set('status', params.status);
      if (params.search) query.set('search', params.search);
      const suffix = query.toString();
      return request<ClientOverview[]>(`/clients${suffix ? `?${suffix}` : ''}`);
    },
    get: (id: string) => request<ClientOverview>(`/clients/${id}`),
    create: (body: Record<string, unknown>) =>
      post<{ client: ClientAccount; subscription: ClientSubscription }>('/clients', body),
    update: (id: string, body: Record<string, unknown>) =>
      request<ClientAccount>(`/clients/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    setStatus: (id: string, status: string) =>
      request<ClientAccount>(`/clients/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    subscriptions: (id: string) => request<ClientSubscription[]>(`/clients/${id}/subscriptions`),
    changePlan: (id: string, body: Record<string, unknown>) =>
      post<ClientSubscription>(`/clients/${id}/subscription`, body),
    usage: (id: string, days = 30) => request<ClientUsageSnapshot[]>(`/clients/${id}/usage?days=${days}`),
  },

  usage: {
    capture: () => post<ClientUsageSnapshot[]>('/usage/capture'),
  },

  support: {
    active: () => request<SupportAccessGrant[]>('/support-access'),
    forClient: (id: string) => request<SupportAccessGrant[]>(`/clients/${id}/support-access`),
    grant: (id: string, body: Record<string, unknown>) =>
      post<SupportAccessGrant>(`/clients/${id}/support-access`, body),
    revoke: (grantId: string) =>
      request<SupportAccessGrant>(`/support-access/${grantId}`, { method: 'DELETE' }),
    use: (grantId: string) =>
      post<{ tenantId: string; accessLevel: string; expiresAt: string }>(`/support-access/${grantId}/use`),
  },

  audit: (params: { clientId?: string; limit?: number } = {}) => {
    const query = new URLSearchParams();
    if (params.clientId) query.set('clientId', params.clientId);
    if (params.limit) query.set('limit', String(params.limit));
    const suffix = query.toString();
    return request<InternalAuditEntry[]>(`/audit${suffix ? `?${suffix}` : ''}`);
  },

  staff: () => request<InternalUser[]>('/staff'),
};

/** Rupiah, written the way an Indonesian invoice writes it. */
export const idr = (value: number | null | undefined): string =>
  value === null || value === undefined ? '-' : `Rp ${value.toLocaleString('id-ID')}`;

export const num = (value: number | null | undefined): string =>
  value === null || value === undefined ? '-' : value.toLocaleString('id-ID');
