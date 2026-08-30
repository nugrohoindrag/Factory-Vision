import { Router } from 'express';
import type { Request } from 'express';
import type { OeeValidationItem, TargetVsActualDimension } from '@factory-vision/domain-types';
import { route } from '../platform/http/envelope.js';
import { validate } from '../platform/http/validate.js';
import { AuditService } from '../modules/audit/audit.service.js';
import { OeeService, type OeeFilter } from '../modules/oee/oee.service.js';

/**
 * OEE investigation, bottleneck analysis and the pilot validation log
 * (US-027, US-032-US-037, US-041, US-025).
 */
export function oeeRoutes(oee: OeeService, audit: AuditService): Router {
  const router = Router();

  /** Reads the shared filter contract, narrowed to the caller's scope. */
  const filterFrom = (req: Request): OeeFilter => {
    const str = (key: string): string | undefined =>
      typeof req.query[key] === 'string' && req.query[key] !== '' ? (req.query[key] as string) : undefined;

    return {
      days: req.query.days ? Number(req.query.days) : undefined,
      from: str('from'),
      to: str('to'),
      lineId: str('lineId'),
      processId: str('processId'),
      machineId: str('machineId'),
      shiftId: str('shiftId'),
      productId: str('productId'),
      // Scope is applied server-side so a hand-crafted query string cannot
      // widen what a line supervisor sees.
      allowedLineIds:
        req.principal && req.principal.scope.level !== 'TENANT' ? req.principal.scope.lineIds : undefined,
    };
  };

  // --- US-032-US-035: configuration and a reproducible calculation ---

  router.get(
    '/oee/config',
    route((req, res) => res.json(oee.getConfig(req.context!.tenantId)))
  );

  router.put(
    '/oee/config',
    route((req, res) => {
      const tenantId = req.context!.tenantId;
      const before = { ...oee.getConfig(tenantId) };

      const v = validate(req.body);
      const pptExcludesPlannedDowntime = v.boolean('pptExcludesPlannedDowntime', { optional: true });
      const idealCycleSource = v.oneOf('idealCycleSource', ['PRODUCT_MACHINE', 'ROUTING', 'PRODUCT'] as const, {
        optional: true,
      });
      const allowIdealCycleFallback = v.boolean('allowIdealCycleFallback', { optional: true });
      v.done();

      const config = oee.updateConfig(
        tenantId,
        { pptExcludesPlannedDowntime, idealCycleSource, allowIdealCycleFallback },
        req.principal?.subjectId ?? 'system'
      );

      audit.record({
        tenantId,
        actorType: 'USER',
        actorId: req.principal?.subjectId ?? 'system',
        entityType: 'oee_config',
        entityId: tenantId,
        action: 'OEE_CONFIG_CHANGED',
        previousValue: before,
        newValue: { ...config },
        ip: req.ip,
      });

      res.json(config);
    })
  );

  /**
   * Recomputes an arbitrary window and returns the inputs alongside the result
   * (US-032-US-035: "Calculation dapat direproduksi").
   */
  router.get(
    '/oee/calculate',
    route((req, res) => {
      const tenantId = req.context!.tenantId;
      const num = (key: string, fallback = 0) => (req.query[key] ? Number(req.query[key]) : fallback);
      res.json(
        oee.calculate(tenantId, {
          plannedProductionSeconds: num('plannedProductionSeconds'),
          plannedDowntimeSeconds: num('plannedDowntimeSeconds'),
          unplannedDowntimeSeconds: num('unplannedDowntimeSeconds'),
          goodCount: num('goodCount'),
          rejectCount: num('rejectCount'),
          idealCycleSeconds: req.query.idealCycleSeconds ? Number(req.query.idealCycleSeconds) : undefined,
        })
      );
    })
  );

  // --- US-027: Process to Machine drill-down ---
  router.get(
    '/oee/machine-performance',
    route((req, res) => res.json(oee.getMachinePerformance(req.context!.tenantId, filterFrom(req))))
  );

  // --- US-037: bottleneck ranking ---
  router.get(
    '/oee/bottlenecks',
    route((req, res) => {
      const kind = req.query.kind === 'PROCESS' ? 'PROCESS' : 'MACHINE';
      res.json(oee.getBottlenecks(req.context!.tenantId, { ...filterFrom(req), kind }));
    })
  );

  // --- US-025: Target vs Actual ---
  router.get(
    '/oee/target-vs-actual',
    route((req, res) => {
      const allowed: TargetVsActualDimension[] = ['LINE', 'PROCESS', 'PRODUCT', 'SHIFT', 'DATE'];
      const requested = String(req.query.dimension ?? 'LINE').toUpperCase() as TargetVsActualDimension;
      const dimension = allowed.includes(requested) ? requested : 'LINE';
      res.json(oee.getTargetVsActual(req.context!.tenantId, dimension, filterFrom(req)));
    })
  );

  // --- US-041: OEE report, JSON or CSV ---
  router.get(
    '/oee/report',
    route((req, res) => {
      const rows = oee.getOeeReport(req.context!.tenantId, filterFrom(req));
      if (req.query.format === 'csv') {
        const header = [
          'shiftDate',
          'shiftName',
          'lineName',
          'machineName',
          'processName',
          'productName',
          'availability',
          'performance',
          'quality',
          'oee',
          'plannedMinutes',
          'runMinutes',
          'downtimeMinutes',
          'goodQuantity',
          'rejectQuantity',
          'totalQuantity',
          'calcVersion',
        ];
        const body = rows.map((row) =>
          header.map((key) => String((row as unknown as Record<string, unknown>)[key] ?? '')).join(',')
        );
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="oee-report.csv"');
        res.send([header.join(','), ...body].join('\n'));
        return;
      }
      res.json(rows);
    })
  );

  // --- US-036: pilot validation log ---
  router.get(
    '/oee/validation',
    route((req, res) =>
      res.json({
        entries: oee.getValidationEntries(req.context!.tenantId),
        gate: oee.getValidationGateStatus(req.context!.tenantId),
        config: oee.getConfig(req.context!.tenantId),
      })
    )
  );

  router.put(
    '/oee/validation/:item',
    route((req, res) => {
      const tenantId = req.context!.tenantId;
      const item = req.params.item.toUpperCase() as OeeValidationItem;

      const v = validate(req.body);
      const scopeLabel = v.string('scopeLabel', { optional: true, max: 160 });
      const shiftDate = v.string('shiftDate', { optional: true });
      const gapClass = v.oneOf('gapClass', ['DEFINITION', 'DATA_CAPTURE', 'MASTER_DATA', 'NONE'] as const, {
        optional: true,
      });
      const status = v.oneOf('status', ['OPEN', 'IN_REVIEW', 'RESOLVED'] as const, { optional: true });
      const resolution = v.string('resolution', { optional: true, max: 1000 });
      const notes = v.string('notes', { optional: true, max: 2000 });
      const resolvedByConfigChange = v.boolean('resolvedByConfigChange', { optional: true });
      const mesValue = v.number('mesValue', { optional: true });
      const factoryValue = v.number('factoryValue', { optional: true });
      v.done();

      const entry = oee.upsertValidationEntry(
        tenantId,
        item,
        {
          scopeLabel,
          shiftDate,
          gapClass,
          status,
          resolution,
          notes,
          resolvedByConfigChange,
          mesValue: mesValue ?? undefined,
          factoryValue: factoryValue ?? undefined,
        },
        req.principal?.subjectId ?? 'system'
      );

      audit.record({
        tenantId,
        actorType: 'USER',
        actorId: req.principal?.subjectId ?? 'system',
        entityType: 'oee_validation',
        entityId: entry.id,
        action: 'OEE_VALIDATION_UPDATED',
        newValue: { item: entry.item, status: entry.status, gapClass: entry.gapClass, gap: entry.gap },
        ip: req.ip,
      });

      res.json(entry);
    })
  );

  return router;
}
