import type { OperationalAlert } from '@factory-vision/domain-types';
import type { MaterialService } from '../material/material.service.js';
import type { QualityService } from '../quality/quality.service.js';
import type { MaintenanceService } from '../maintenance/maintenance.service.js';
import type { WorkforceService } from '../workforce/workforce.service.js';
import type { WipService } from '../wip/wip.service.js';

/**
 * The improvement's exception layer (Improvement PRD §26).
 *
 * Kept apart from `PerformanceService.getOperationalAlerts` rather than added
 * to it: that method is built from OEE aggregates and would have to import
 * five more services to compute these, which is the wrong shape. The API
 * concatenates both lists, so the console still sees one feed.
 *
 * Every alert carries the console route that answers it — the drill-down
 * principle the v1.7 alerts already follow. An alert a supervisor cannot act
 * on from the alert itself is a notification, not an alert.
 *
 * Rules are evaluated against live figures on each request. None of them is
 * stored: an alert that outlived the condition it describes is the failure
 * mode that teaches people to ignore the feed.
 */
export class ImprovementAlertsService {
  constructor(
    private readonly material: MaterialService,
    private readonly quality: QualityService,
    private readonly maintenance: MaintenanceService,
    private readonly workforce: WorkforceService,
    private readonly wip: WipService
  ) {}

  async getAlerts(tenantId: string): Promise<OperationalAlert[]> {
    const raisedAt = new Date().toISOString();

    // Each block is independent, so one failing module leaves the rest of the
    // feed intact — a material query that times out must not blank the
    // maintenance alerts a technician is waiting on.
    const groups = await Promise.all([
      this.materialAlerts(tenantId, raisedAt).catch(() => []),
      this.qualityAlerts(tenantId, raisedAt).catch(() => []),
      this.maintenanceAlerts(tenantId, raisedAt).catch(() => []),
      this.workforceAlerts(tenantId, raisedAt).catch(() => []),
      this.wipAlerts(tenantId, raisedAt).catch(() => []),
    ]);

    const severityRank = { CRITICAL: 0, WARNING: 1, INFORMATIONAL: 2 };
    return groups
      .flat()
      .sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
  }

  /** §26 Material: shortage, critical material, readiness, consumption variance. */
  private async materialAlerts(tenantId: string, raisedAt: string): Promise<OperationalAlert[]> {
    const alerts: OperationalAlert[] = [];
    const inventory = await this.material.listInventory(tenantId);

    for (const stock of inventory) {
      if (stock.reorderPoint === undefined) continue;
      if (stock.availableQuantity > stock.reorderPoint) continue;

      // Out of stock is critical; at or below the reorder point is a warning,
      // because the reorder point exists precisely to warn before zero.
      alerts.push({
        id: `alert-material-reorder-${stock.materialId}-${stock.warehouseId}`,
        severity: stock.availableQuantity <= 0 ? 'CRITICAL' : 'WARNING',
        rule: 'MATERIAL_BELOW_REORDER_POINT',
        title: `${stock.materialSku} di bawah reorder point`,
        detail: `Tersedia ${stock.availableQuantity} ${stock.uom} terhadap reorder point ${stock.reorderPoint} di ${stock.warehouseName}.`,
        drillDownPath: `/material-inventory?materialId=${stock.materialId}`,
        entityType: 'TENANT',
        entityId: stock.materialId,
        observedValue: stock.availableQuantity,
        thresholdValue: stock.reorderPoint,
        raisedAt,
      });
    }

    const requirements = await this.material.storedRequirements(tenantId, { status: 'SHORTAGE' });
    for (const requirement of requirements.slice(0, 20)) {
      alerts.push({
        id: `alert-material-shortage-${requirement.sourceId}-${requirement.materialId}`,
        severity: 'CRITICAL',
        rule: 'MATERIAL_SHORTAGE',
        title: `Material kurang untuk ${requirement.sourceLabel}`,
        detail: `${requirement.materialSku} kurang ${requirement.shortageQuantity} ${requirement.uom} dari kebutuhan ${requirement.requiredQuantity}.`,
        drillDownPath: '/material-readiness',
        entityType: requirement.sourceType === 'WORK_ORDER' ? 'WORK_ORDER' : 'TENANT',
        entityId: requirement.sourceId,
        observedValue: requirement.availableQuantity,
        thresholdValue: requirement.requiredQuantity,
        raisedAt,
      });
    }

    return alerts;
  }

  /** §26 Quality: fail, hold, reject threshold, NCR overdue. */
  private async qualityAlerts(tenantId: string, raisedAt: string): Promise<OperationalAlert[]> {
    const alerts: OperationalAlert[] = [];
    const dashboard = await this.quality.dashboard(tenantId);

    if (dashboard.openHolds > 0) {
      alerts.push({
        id: 'alert-quality-hold',
        severity: 'WARNING',
        rule: 'QUALITY_HOLD_OPEN',
        title: `${dashboard.openHolds} Quality Hold menunggu keputusan`,
        detail: `${dashboard.heldQuantity} unit ditahan dan belum memiliki disposition.`,
        drillDownPath: '/quality',
        entityType: 'TENANT',
        entityId: tenantId,
        observedValue: dashboard.openHolds,
        thresholdValue: 0,
        raisedAt,
      });
    }

    // 5% is the reject ceiling the v1.7 dashboards already treat as the line
    // between normal variation and something to look at.
    if (dashboard.inspectedQuantity > 0 && dashboard.failRate > 5) {
      alerts.push({
        id: 'alert-quality-reject-rate',
        severity: dashboard.failRate > 10 ? 'CRITICAL' : 'WARNING',
        rule: 'QUALITY_FAIL_RATE_ABOVE_THRESHOLD',
        title: 'Tingkat kegagalan inspeksi melewati ambang',
        detail: `${dashboard.failRate}% dari ${dashboard.inspectedQuantity} unit yang diperiksa gagal.`,
        drillDownPath: '/quality',
        entityType: 'TENANT',
        entityId: tenantId,
        observedValue: dashboard.failRate,
        thresholdValue: 5,
        raisedAt,
      });
    }

    if (dashboard.overdueNcr > 0) {
      alerts.push({
        id: 'alert-quality-ncr-overdue',
        severity: 'CRITICAL',
        rule: 'NCR_OVERDUE',
        title: `${dashboard.overdueNcr} NCR melewati jatuh tempo`,
        detail: 'Non-conformance yang lewat jatuh tempo dan belum ditutup.',
        drillDownPath: '/quality',
        entityType: 'TENANT',
        entityId: tenantId,
        observedValue: dashboard.overdueNcr,
        thresholdValue: 0,
        raisedAt,
      });
    }

    return alerts;
  }

  /** §26 Maintenance: PM due, PM overdue, breakdown, emergency. */
  private async maintenanceAlerts(tenantId: string, raisedAt: string): Promise<OperationalAlert[]> {
    const alerts: OperationalAlert[] = [];
    const plans = await this.maintenance.listPlans(tenantId, { status: 'ACTIVE' });

    for (const plan of plans) {
      if (plan.dueStatus !== 'DUE' && plan.dueStatus !== 'OVERDUE') continue;
      alerts.push({
        id: `alert-pm-${plan.id}`,
        severity: plan.dueStatus === 'OVERDUE' ? 'CRITICAL' : 'WARNING',
        rule: plan.dueStatus === 'OVERDUE' ? 'PM_OVERDUE' : 'PM_DUE',
        title: `${plan.name} ${plan.dueStatus === 'OVERDUE' ? 'terlambat' : 'jatuh tempo'}`,
        detail: `${plan.machineName}: perawatan setiap ${plan.intervalValue} ${plan.intervalUnit}.`,
        drillDownPath: '/maintenance',
        entityType: 'MACHINE',
        entityId: plan.machineId,
        observedValue: plan.dueStatus === 'OVERDUE' ? 1 : 0,
        thresholdValue: 0,
        raisedAt,
      });
    }

    const open = await this.maintenance.listRecords(tenantId, { limit: 200 });
    for (const record of open.filter((row) => row.maintenanceType === 'EMERGENCY' && row.status !== 'COMPLETED')) {
      alerts.push({
        id: `alert-emergency-${record.id}`,
        severity: 'CRITICAL',
        rule: 'EMERGENCY_MAINTENANCE_OPEN',
        title: `${record.machineName} dalam emergency maintenance`,
        detail: record.problem ?? 'Perbaikan darurat sedang berjalan; mesin tidak dapat berproduksi.',
        drillDownPath: '/maintenance',
        entityType: 'MACHINE',
        entityId: record.machineId,
        observedValue: 1,
        thresholdValue: 0,
        raisedAt,
      });
    }

    return alerts;
  }

  /** §26 Workforce: qualification expired, operator shortage. */
  private async workforceAlerts(tenantId: string, raisedAt: string): Promise<OperationalAlert[]> {
    const alerts: OperationalAlert[] = [];
    const qualifications = await this.workforce.listQualifications(tenantId);

    const expired = qualifications.filter((row) => row.status === 'EXPIRED');
    if (expired.length > 0) {
      alerts.push({
        id: 'alert-qualification-expired',
        severity: 'WARNING',
        rule: 'QUALIFICATION_EXPIRED',
        title: `${expired.length} kualifikasi operator kedaluwarsa`,
        detail: `Operator dengan kualifikasi kedaluwarsa tidak dapat ditugaskan: ${expired
          .slice(0, 3)
          .map((row) => `${row.operatorName} (${row.skillCode})`)
          .join(', ')}${expired.length > 3 ? ', …' : ''}.`,
        drillDownPath: '/workforce',
        entityType: 'TENANT',
        entityId: tenantId,
        observedValue: expired.length,
        thresholdValue: 0,
        raisedAt,
      });
    }

    // Expiring within thirty days is the window in which a certificate can
    // still be renewed without taking the operator off the roster.
    const expiring = (await this.workforce.listQualifications(tenantId, { expiringWithinDays: 30 })).filter(
      (row) => row.status === 'ACTIVE'
    );
    if (expiring.length > 0) {
      alerts.push({
        id: 'alert-qualification-expiring',
        severity: 'INFORMATIONAL',
        rule: 'QUALIFICATION_EXPIRING_SOON',
        title: `${expiring.length} kualifikasi kedaluwarsa dalam 30 hari`,
        detail: 'Perbarui sertifikasi sebelum operator kehilangan izin menjalankan mesin.',
        drillDownPath: '/workforce',
        entityType: 'TENANT',
        entityId: tenantId,
        observedValue: expiring.length,
        thresholdValue: 0,
        raisedAt,
      });
    }

    return alerts;
  }

  /** §26 WIP: aging, stuck, transfer pending. */
  private async wipAlerts(tenantId: string, raisedAt: string): Promise<OperationalAlert[]> {
    const alerts: OperationalAlert[] = [];
    const dashboard = await this.wip.dashboard(tenantId);

    if (dashboard.stuckRecords > 0) {
      alerts.push({
        id: 'alert-wip-stuck',
        severity: 'CRITICAL',
        rule: 'WIP_STUCK',
        title: `${dashboard.stuckRecords} WIP tertahan lebih dari ${dashboard.criticalThresholdHours} jam`,
        detail: 'Kuantitas yang tidak bergerak biasanya menandai bottleneck pada proses tersebut.',
        drillDownPath: '/wip',
        entityType: 'TENANT',
        entityId: tenantId,
        observedValue: dashboard.stuckRecords,
        thresholdValue: 0,
        raisedAt,
      });
    }

    if (dashboard.aging.aging > 0) {
      alerts.push({
        id: 'alert-wip-aging',
        severity: 'WARNING',
        rule: 'WIP_AGING',
        title: `${dashboard.aging.aging} WIP melewati ${dashboard.agingThresholdHours} jam`,
        detail: 'WIP yang menua menahan kapasitas dan menunda proses berikutnya.',
        drillDownPath: '/wip',
        entityType: 'TENANT',
        entityId: tenantId,
        observedValue: dashboard.aging.aging,
        thresholdValue: 0,
        raisedAt,
      });
    }

    if (dashboard.onHoldQuantity > 0) {
      alerts.push({
        id: 'alert-wip-on-hold',
        severity: 'WARNING',
        rule: 'WIP_ON_HOLD',
        title: `${dashboard.onHoldQuantity} unit WIP ditahan`,
        detail: 'WIP berstatus hold tidak dapat digunakan sampai dilepas oleh pihak yang berwenang.',
        drillDownPath: '/wip',
        entityType: 'TENANT',
        entityId: tenantId,
        observedValue: dashboard.onHoldQuantity,
        thresholdValue: 0,
        raisedAt,
      });
    }

    return alerts;
  }
}
