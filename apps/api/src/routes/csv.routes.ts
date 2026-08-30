import { Router } from 'express';
import { route } from '../platform/http/envelope.js';
import { validate } from '../platform/http/validate.js';
import { AuditService } from '../modules/audit/audit.service.js';
import { CsvService } from '../modules/csv/csv.service.js';

/**
 * CSV import / export (US-008).
 *
 * The upload arrives as a JSON string rather than multipart: the console reads
 * the file with `FileReader` anyway, and avoiding a multipart dependency keeps
 * the on-premise bundle smaller. A 5 MB ceiling covers the largest realistic
 * master-data file while keeping a mistyped upload from exhausting memory.
 */
const MAX_CSV_BYTES = 5 * 1024 * 1024;

export function csvRoutes(csv: CsvService, audit: AuditService): Router {
  const router = Router();

  router.get(
    '/csv/entities',
    route((_req, res) => res.json(csv.listEntities))
  );

  router.get(
    '/csv/:entity/template',
    route((req, res) => {
      const template = csv.getTemplate(req.params.entity);
      if (req.query.format === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="template-${req.params.entity}.csv"`);
        res.send(template.csv);
        return;
      }
      res.json(template);
    })
  );

  router.get(
    '/csv/:entity/export',
    route((req, res) => {
      const tenantId = req.context!.tenantId;
      // US-008: "Export respects user's access scope."
      const allowedLineIds =
        req.principal && req.principal.scope.level !== 'TENANT' ? req.principal.scope.lineIds : undefined;
      const body = csv.export(req.params.entity, tenantId, allowedLineIds);

      audit.record({
        tenantId,
        actorType: 'USER',
        actorId: req.principal?.subjectId ?? 'system',
        entityType: 'csv_export',
        entityId: req.params.entity,
        action: 'EXPORT',
        newValue: { entity: req.params.entity, scope: req.principal?.scope.level ?? 'TENANT' },
        ip: req.ip,
      });

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${req.params.entity}.csv"`);
      res.send(body);
    })
  );

  router.post(
    '/csv/:entity/import',
    route((req, res) => {
      const v = validate(req.body);
      const content = v.string('content', { min: 1, max: MAX_CSV_BYTES });
      const dryRun = v.boolean('dryRun', { optional: true });
      v.done('Isi file CSV wajib dikirim.');

      const tenantId = req.context!.tenantId;
      const result = csv.import(req.params.entity, tenantId, content!, { dryRun: dryRun ?? false });

      // A dry run changes nothing, so it is not an auditable event; a real
      // import is ( / US-008 "Record import activity in audit log").
      if (!dryRun) {
        audit.record({
          tenantId,
          actorType: 'USER',
          actorId: req.principal?.subjectId ?? 'system',
          entityType: 'csv_import',
          entityId: req.params.entity,
          action: 'IMPORT',
          newValue: {
            entity: result.entity,
            created: result.created,
            updated: result.updated,
            failed: result.failed,
            rejectedWholeFile: result.rejectedWholeFile,
          },
          ip: req.ip,
        });
      }

      res.json(result);
    })
  );

  return router;
}
