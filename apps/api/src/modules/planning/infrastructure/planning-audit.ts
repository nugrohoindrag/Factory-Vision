import { randomUUID } from 'crypto';
import type { AuditLog } from '@factory-vision/domain-types';
import type { Executor } from '../../../platform/db/executor.js';
import { AuditRepository } from '../../audit/audit.repository.js';

/**
 * Transactional audit for planning entities (MES-020-1).
 *
 * `AuditService.record` opens its own transaction, which is right for an action
 * that has already committed. It is wrong here: MES-020 requires the audit row
 * to be written *in the same transaction as the change*, so a Customer Order
 * cannot exist without the entry that says who created it, and a rolled-back
 * edit cannot leave an entry claiming it happened.
 *
 * So this takes the caller's `Executor` and writes through the same repository
 * the audit module owns — one table, one row shape, two entry points differing
 * only in transaction scope.
 */

export interface PlanningAuditEntry {
  tenantId: string;
  actorId: string;
  actorType?: AuditLog['actorType'];
  entityType: string;
  entityId: string;
  action: string;
  previousValue?: unknown;
  newValue?: unknown;
  ip?: string;
  userAgent?: string;
}

export class PlanningAudit {
  private readonly repo = new AuditRepository();

  async record(exec: Executor, entry: PlanningAuditEntry): Promise<void> {
    await this.repo.insert(exec, {
      id: `audit-${randomUUID()}`,
      tenantId: entry.tenantId,
      actorType: entry.actorType ?? 'USER',
      actorId: entry.actorId,
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      previousValue: entry.previousValue,
      newValue: entry.newValue,
      ip: entry.ip,
      userAgent: entry.userAgent,
      occurredAt: new Date().toISOString(),
    });
  }
}
