import { Router } from 'express';
import { route } from '../platform/http/envelope.js';
import { validate } from '../platform/http/validate.js';
import { recordSecurityEvent } from '../platform/security/security-events.js';
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

/** Above this, an export is worth telling somebody about (§43). */
const LARGE_EXPORT_ROWS = Number(process.env.LARGE_EXPORT_ROWS ?? 5000);

export function csvRoutes(csv: CsvService, audit: AuditService): Router {
  const router = Router();

  router.get(
    '/csv/entities',
    route(async (_req, res) => res.json(csv.listEntities))
  );

  router.get(
    '/csv/:entity/template',
    route(async (req, res) => {
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
    route(async (req, res) => {
      const tenantId = req.context!.tenantId;
      // US-008: "Export respects user's access scope."
      const allowedLineIds =
        req.principal && req.principal.scope.level !== 'TENANT' ? req.principal.scope.lineIds : undefined;
      const body = csv.export(req.params.entity, tenantId, allowedLineIds);
      // Header line excluded: what an auditor asks is how many records left.
      const rowCount = Math.max(0, body.split('\n').filter((line) => line.trim()).length - 1);

      await audit.record({
        tenantId,
        actorType: 'USER',
        actorId: req.principal?.subjectId ?? 'system',
        entityType: 'csv_export',
        entityId: req.params.entity,
        action: 'EXPORT',
        newValue: {
          entity: req.params.entity,
          scope: req.principal?.scope.level ?? 'TENANT',
          rowCount,
          bytes: Buffer.byteLength(body),
        },
        ip: req.ip,
      });

      // §43: a bulk export is the shape data leaves in, so it is alertable
      // rather than merely audited.
      if (rowCount >= LARGE_EXPORT_ROWS) {
        recordSecurityEvent({
          type: 'LARGE_EXPORT',
          severity: 'WARNING',
          message: `Export ${req.params.entity} berisi ${rowCount} baris.`,
          tenantId,
          actor: req.principal?.subjectId,
          ip: req.ip,
          detail: { entity: req.params.entity, rowCount },
        });
      }

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${req.params.entity}.csv"`);
      res.send(body);
    })
  );

  router.post(
    '/csv/:entity/import',
    route(async (req, res) => {
      const v = validate(req.body);
      const content = v.string('content', { min: 1, max: MAX_CSV_BYTES });
      const dryRun = v.boolean('dryRun', { optional: true });
      v.done('Isi file CSV wajib dikirim.');

      const tenantId = req.context!.tenantId;
      const result = await csv.import(req.params.entity, tenantId, content!, { dryRun: dryRun ?? false });

      // A dry run changes nothing, so it is not an auditable event; a real
      // import is ( / US-008 "Record import activity in audit log").
      if (!dryRun) {
        await audit.record({
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
