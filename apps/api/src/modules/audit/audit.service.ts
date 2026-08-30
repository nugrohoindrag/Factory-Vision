import type { AuditLog } from '@factory-vision/domain-types';
import { withTenant } from '../../platform/db/pool.js';
import { AuditRepository } from './audit.repository.js';

/**
 * The audit trail (US-054).
 *
 * Every entry is written to PostgreSQL before `record` resolves. It used to be
 * an array on the process, which meant the evidence an ISO or BPOM auditor
 * asks for, and the record of who approved a data correction, lasted exactly
 * as long as the container did.
 *
 * Append-only by construction: there is no update and no delete here. A
 * correction is a new entry, never an edit to an old one, which is the whole
 * point of keeping the trail.
 */
export class AuditService {
  private readonly repo = new AuditRepository();

  async record(log: Omit<AuditLog, 'id' | 'occurredAt'>): Promise<AuditLog> {
    const entry: AuditLog = {
      ...log,
      id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      occurredAt: new Date().toISOString(),
    };
    return withTenant(entry.tenantId, (client) => this.repo.insert(client, entry));
  }

  /**
   * Records without making the caller wait, and without letting a failure take
   * the request down with it.
   *
   * Used only where the audited action has already been committed and the
   * caller has nothing left to decide — the entry is still written, but a
   * database hiccup surfaces as a logged error rather than a 500 on an
   * operation that actually succeeded.
   */
  recordDetached(log: Omit<AuditLog, 'id' | 'occurredAt'>): void {
    this.record(log).catch((error) => {
      // eslint-disable-next-line no-console
      console.error('[audit] failed to record entry:', error instanceof Error ? error.message : error);
    });
  }

  async getAuditLogs(
    tenantId: string,
    filter?: { entityType?: string; action?: string; limit?: number; offset?: number }
  ): Promise<AuditLog[]> {
    return withTenant(tenantId, (client) => this.repo.list(client, tenantId, filter));
  }

  async count(tenantId: string): Promise<number> {
    return withTenant(tenantId, (client) => this.repo.count(client, tenantId));
  }
}
