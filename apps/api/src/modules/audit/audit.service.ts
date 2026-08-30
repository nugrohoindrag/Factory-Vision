import { AuditLog } from '@factory-vision/domain-types';
import { demoRows } from '../../platform/config/demo-seed.js';

export class AuditService {
  private auditLogs: AuditLog[] = demoRows<AuditLog>(() => [
    {
      id: 'audit-001',
      tenantId: 'tenant-pilot-factory-01',
      actorType: 'USER',
      actorId: 'Agung Wicaksono (Supervisor)',
      entityType: 'work_order',
      entityId: 'wo-101',
      action: 'RELEASE',
      previousValue: { status: 'SCHEDULED' },
      newValue: { status: 'RELEASED' },
      ip: '192.168.1.102',
      userAgent: 'FactoryVision-Console/1.0',
      occurredAt: '2026-08-28T06:30:00.000Z',
    },
    {
      id: 'audit-002',
      tenantId: 'tenant-pilot-factory-01',
      actorType: 'OPERATOR',
      actorId: 'Budi Santoso (OP-2024-089)',
      entityType: 'work_order',
      entityId: 'wo-101',
      action: 'START',
      previousValue: { status: 'RELEASED' },
      newValue: { status: 'IN_PROGRESS' },
      ip: '192.168.1.205',
      userAgent: 'FactoryVision-OperatorPWA/1.0',
      occurredAt: '2026-08-28T07:15:00.000Z',
    },
    {
      id: 'audit-003',
      tenantId: 'tenant-pilot-factory-01',
      actorType: 'OPERATOR',
      actorId: 'Budi Santoso (OP-2024-089)',
      entityType: 'downtime_record',
      entityId: 'dt-rec-002',
      action: 'DOWNTIME_START',
      previousValue: undefined,
      newValue: { reason: 'dt-breakdown', startTime: '2026-08-28T08:10:00.000Z' },
      ip: '192.168.1.205',
      userAgent: 'FactoryVision-OperatorPWA/1.0',
      occurredAt: '2026-08-28T08:10:00.000Z',
    },
    {
      id: 'audit-004',
      tenantId: 'tenant-pilot-factory-01',
      actorType: 'USER',
      actorId: 'Agung Wicaksono (Supervisor)',
      entityType: 'correction_request',
      entityId: 'corr-001',
      action: 'APPROVE_CORRECTION',
      previousValue: { status: 'PENDING' },
      newValue: { status: 'APPLIED', changes: { goodQuantity: { from: 1800, to: 1840 } } },
      ip: '192.168.1.102',
      userAgent: 'FactoryVision-Console/1.0',
      occurredAt: '2026-08-28T09:35:00.000Z',
    },
  ]);

  record(log: Omit<AuditLog, 'id' | 'occurredAt'>) {
    const entry: AuditLog = { ...log, id: `audit-${Date.now()}`, occurredAt: new Date().toISOString() };
    this.auditLogs.unshift(entry);
    return entry;
  }

  getAuditLogs(tenantId: string, filter?: { entityType?: string; action?: string }) {
    let result = this.auditLogs.filter((l) => l.tenantId === tenantId);
    if (filter?.entityType) {
      result = result.filter((l) => l.entityType === filter.entityType);
    }
    if (filter?.action) {
      result = result.filter((l) => l.action === filter.action);
    }
    return result;
  }
}
