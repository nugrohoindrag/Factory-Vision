/**
 * Security events and alerting (§42, §43).
 *
 * The audit trail already records what happened; it answers questions after
 * somebody thinks to ask. This is the other half: the small set of events that
 * should reach a person on the day they occur — an administrator role handed
 * out, a lockout, a large export, a backup that stopped running.
 *
 * Two sinks, both deliberately dull:
 *
 *   * a structured line on stdout, which is what a factory's own log shipper
 *     or `docker logs` can pick up without any agreement with us;
 *   * an optional webhook, so a customer who has Slack, Teams, or a SIEM can
 *     receive the same events without us integrating with each one.
 *
 * Delivery is best effort and never blocks the request that produced it. An
 * alert that can fail a production capture is worse than a missed alert.
 */

export type SecuritySeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface SecurityEvent {
  type: string;
  severity: SecuritySeverity;
  message: string;
  tenantId?: string;
  actor?: string;
  ip?: string;
  detail?: Record<string, unknown>;
}

/** The events that are worth waking somebody for, per §43. */
export const ALERTABLE: ReadonlySet<string> = new Set([
  'LOGIN_LOCKED',
  'OPERATOR_LOGIN_LOCKED',
  'INTERNAL_LOGIN_LOCKED',
  'ADMIN_ROLE_ASSIGNED',
  'PERMISSION_CHANGED',
  'LARGE_EXPORT',
  'CROSS_TENANT_ATTEMPT',
  'REALTIME_HANDSHAKE_REJECTED',
  'AUDIT_WRITE_FAILED',
  'BACKUP_STALE',
  'MFA_DISABLED',
  'MFA_RECOVERY_CODE_USED',
]);

const WEBHOOK_TIMEOUT_MS = 5_000;

function webhookUrl(): string | undefined {
  const configured = process.env.SECURITY_ALERT_WEBHOOK?.trim();
  return configured || undefined;
}

/** Counters, exposed on the health surface so "is anything happening" is answerable. */
const counters = new Map<string, number>();

export function securityCounters(): Record<string, number> {
  return Object.fromEntries(counters);
}

export function recordSecurityEvent(event: SecurityEvent): void {
  counters.set(event.type, (counters.get(event.type) ?? 0) + 1);

  const line = JSON.stringify({
    kind: 'security',
    at: new Date().toISOString(),
    ...event,
  });

  // eslint-disable-next-line no-console
  if (event.severity === 'CRITICAL') console.error(line);
  else if (event.severity === 'WARNING') console.warn(line);
  // eslint-disable-next-line no-console
  else console.log(line);

  const url = webhookUrl();
  if (!url || !ALERTABLE.has(event.type)) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

  void fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: controller.signal,
    body: JSON.stringify({
      // `text` is what Slack and Teams read; the structured fields are for
      // anything that parses rather than displays.
      text: `[Factory Vision] ${event.severity}: ${event.message}`,
      event: { ...event, at: new Date().toISOString() },
    }),
  })
    .catch((error) => {
      // eslint-disable-next-line no-console
      console.warn('[security] alert webhook failed:', error instanceof Error ? error.message : error);
    })
    .finally(() => clearTimeout(timer));
}

/** Convenience for the most common shape: something was refused. */
export function recordRefusal(
  type: string,
  message: string,
  context: { tenantId?: string; actor?: string; ip?: string; detail?: Record<string, unknown> } = {}
): void {
  recordSecurityEvent({ type, severity: 'WARNING', message, ...context });
}
