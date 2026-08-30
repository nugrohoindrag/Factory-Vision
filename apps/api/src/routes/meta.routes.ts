import { Router } from 'express';
import type { DeploymentInfo } from '@factory-vision/domain-types';
import { route } from '../platform/http/envelope.js';
import { PERMISSION_CATALOG } from '../modules/rbac/permissions.js';
import { permissionForRoute } from '../platform/auth/route-permissions.js';

const API_VERSION = 'v1';
const PRODUCT_VERSION = '1.5.0';

/**
 * The documented endpoint inventory (US-054).
 *
 * Generated from the same route→permission table the authorization middleware
 * enforces, so the documentation cannot drift from the policy: if a route's
 * guard changes, the published contract changes with it.
 */
interface EndpointDoc {
  method: string;
  path: string;
  summary: string;
}

const ENDPOINTS: EndpointDoc[] = [
  { method: 'POST', path: '/api/v1/auth/login', summary: 'Login pengguna aplikasi (email + password)' },
  { method: 'POST', path: '/api/v1/auth/operator-login', summary: 'Login operator (employee number + PIN)' },
  { method: 'GET', path: '/api/v1/auth/session', summary: 'Detail sesi aktif' },
  { method: 'POST', path: '/api/v1/auth/logout', summary: 'Akhiri sesi' },
  { method: 'GET', path: '/api/v1/sessions', summary: 'Daftar sesi aktif tenant' },
  { method: 'DELETE', path: '/api/v1/sessions/:sessionId', summary: 'Cabut satu sesi' },
  { method: 'GET', path: '/api/v1/permissions', summary: 'Katalog permission module:action' },
  { method: 'GET', path: '/api/v1/roles', summary: 'Daftar peran sistem dan custom' },
  { method: 'POST', path: '/api/v1/roles', summary: 'Buat peran custom tenant' },
  { method: 'PUT', path: '/api/v1/roles/:id', summary: 'Ubah permission peran custom' },
  { method: 'DELETE', path: '/api/v1/roles/:id', summary: 'Hapus peran custom' },
  { method: 'GET', path: '/api/v1/master/plants', summary: 'Master plant' },
  { method: 'GET', path: '/api/v1/master/lines', summary: 'Master production line' },
  { method: 'GET', path: '/api/v1/master/work-centers', summary: 'Master work center' },
  { method: 'GET', path: '/api/v1/master/machines', summary: 'Master mesin' },
  { method: 'GET', path: '/api/v1/master/products', summary: 'Master produk' },
  { method: 'GET', path: '/api/v1/master/processes', summary: 'Master production process' },
  { method: 'GET', path: '/api/v1/master/routings', summary: 'Product routing' },
  { method: 'GET', path: '/api/v1/master/machine-rates', summary: 'Ideal cycle time Product x Machine' },
  { method: 'GET', path: '/api/v1/master/batches', summary: 'Batch / lot produksi' },
  { method: 'GET', path: '/api/v1/master/operators', summary: 'Master operator' },
  { method: 'GET', path: '/api/v1/master/users', summary: 'Daftar pengguna aplikasi' },
  { method: 'GET', path: '/api/v1/shifts', summary: 'Konfigurasi shift' },
  { method: 'POST', path: '/api/v1/shifts', summary: 'Buat shift' },
  { method: 'PUT', path: '/api/v1/shifts/:id', summary: 'Ubah shift' },
  { method: 'GET', path: '/api/v1/shifts/handover/context', summary: 'Konteks serah terima shift' },
  { method: 'POST', path: '/api/v1/shifts/handover', summary: 'Catat serah terima shift' },
  { method: 'GET', path: '/api/v1/production-orders', summary: 'Daftar production order' },
  { method: 'POST', path: '/api/v1/production-orders', summary: 'Buat production order' },
  { method: 'GET', path: '/api/v1/work-orders', summary: 'Daftar work order' },
  { method: 'POST', path: '/api/v1/work-orders', summary: 'Buat work order' },
  { method: 'POST', path: '/api/v1/work-orders/:id/release', summary: 'Rilis work order' },
  { method: 'POST', path: '/api/v1/work-orders/:id/batch', summary: 'Lampirkan batch/lot ke work order' },
  { method: 'POST', path: '/api/v1/work-orders/:id/start', summary: 'Mulai produksi' },
  { method: 'POST', path: '/api/v1/work-orders/:id/complete', summary: 'Selesaikan work order' },
  { method: 'POST', path: '/api/v1/shop-floor/output', summary: 'Catat output good/reject' },
  { method: 'POST', path: '/api/v1/shop-floor/downtime/start', summary: 'Mulai downtime' },
  { method: 'POST', path: '/api/v1/shop-floor/downtime/:id/resolve', summary: 'Selesaikan downtime' },
  {
    method: 'POST',
    path: '/api/v1/shop-floor/sync-batch',
    summary: 'Sinkronisasi antrian offline (idempoten)',
  },
  { method: 'GET', path: '/api/v1/analytics/executive-kpi', summary: 'KPI eksekutif' },
  { method: 'GET', path: '/api/v1/analytics/live-board', summary: 'Papan produksi real-time' },
  { method: 'GET', path: '/api/v1/analytics/downtime-pareto', summary: 'Pareto downtime' },
  { method: 'GET', path: '/api/v1/analytics/reject-pareto', summary: 'Pareto reject' },
  { method: 'GET', path: '/api/v1/analytics/order-status', summary: 'Risiko production order' },
  { method: 'GET', path: '/api/v1/analytics/alerts', summary: 'Alert operasional' },
  { method: 'GET', path: '/api/v1/oee/config', summary: 'Konfigurasi perhitungan OEE' },
  { method: 'PUT', path: '/api/v1/oee/config', summary: 'Ubah definisi OEE (menaikkan calc_version)' },
  { method: 'GET', path: '/api/v1/oee/machine-performance', summary: 'Drill-down OEE per mesin' },
  { method: 'GET', path: '/api/v1/oee/bottlenecks', summary: 'Ranking bottleneck' },
  { method: 'GET', path: '/api/v1/oee/target-vs-actual', summary: 'Target vs actual' },
  { method: 'GET', path: '/api/v1/oee/report', summary: 'Laporan OEE (JSON/CSV)' },
  { method: 'GET', path: '/api/v1/oee/validation', summary: 'Log validasi OEE pilot V1-V6' },
  { method: 'GET', path: '/api/v1/reports/production', summary: 'Laporan produksi' },
  { method: 'GET', path: '/api/v1/reports/downtime', summary: 'Laporan downtime' },
  { method: 'GET', path: '/api/v1/reports/shift', summary: 'Laporan shift' },
  { method: 'GET', path: '/api/v1/csv/entities', summary: 'Entitas master data yang mendukung CSV' },
  { method: 'GET', path: '/api/v1/csv/:entity/template', summary: 'Unduh template CSV' },
  { method: 'GET', path: '/api/v1/csv/:entity/export', summary: 'Ekspor master data ke CSV' },
  { method: 'POST', path: '/api/v1/csv/:entity/import', summary: 'Impor CSV dengan validasi per baris' },
  { method: 'GET', path: '/api/v1/corrections', summary: 'Permintaan koreksi data' },
  { method: 'POST', path: '/api/v1/corrections', summary: 'Ajukan koreksi' },
  { method: 'POST', path: '/api/v1/corrections/:id/approve', summary: 'Setujui koreksi dan recompute' },
  { method: 'GET', path: '/api/v1/audit-logs', summary: 'Audit trail' },
];

export function metaRoutes(): Router {
  const router = Router();

  router.get(
    '/meta/deployment',
    route((req, res) => {
      const mode =
        process.env.DEPLOYMENT_MODE === 'ON_PREMISE_SINGLE_TENANT'
          ? 'ON_PREMISE_SINGLE_TENANT'
          : 'CLOUD_MULTI_TENANT';

      const info: DeploymentInfo = {
        mode,
        version: PRODUCT_VERSION,
        apiVersion: API_VERSION,
        // On-premise pins one tenant; cloud resolves it per request.
        tenantId: mode === 'ON_PREMISE_SINGLE_TENANT' ? (process.env.DEFAULT_TENANT_ID ?? null) : null,
        features: {
          multiTenant: mode === 'CLOUD_MULTI_TENANT',
          offlineTerminal: true,
          realtime: true,
        },
        serverTime: new Date().toISOString(),
      };
      res.json(info);
    })
  );

  /** Machine-readable contract: endpoints, their guard, and the error shape. */
  router.get(
    '/meta/openapi.json',
    route((_req, res) => {
      res.json({
        openapi: '3.0.3',
        info: {
          title: 'Factory Vision MES API',
          version: PRODUCT_VERSION,
          description:
            'MES untuk manufaktur mid-market Indonesia. Semua endpoint berada di bawah /api/v1 ' +
            'dan menggunakan struktur error yang seragam.',
        },
        servers: [{ url: '/', description: 'Current deployment' }],
        components: {
          securitySchemes: {
            bearerAuth: { type: 'http', scheme: 'bearer' },
          },
          schemas: {
            ApiError: {
              type: 'object',
              properties: {
                error: {
                  type: 'object',
                  required: ['code', 'message', 'requestId'],
                  properties: {
                    code: {
                      type: 'string',
                      enum: [
                        'VALIDATION_ERROR',
                        'UNAUTHENTICATED',
                        'FORBIDDEN',
                        'OUT_OF_SCOPE',
                        'NOT_FOUND',
                        'CONFLICT',
                        'INVALID_STATE',
                        'RATE_LIMITED',
                        'INTERNAL_ERROR',
                      ],
                    },
                    message: { type: 'string' },
                    requestId: { type: 'string' },
                    fields: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          field: { type: 'string' },
                          code: { type: 'string' },
                          message: { type: 'string' },
                        },
                      },
                    },
                  },
                },
              },
            },
            Pagination: {
              type: 'object',
              properties: {
                data: { type: 'array', items: {} },
                page: {
                  type: 'object',
                  properties: {
                    number: { type: 'integer' },
                    size: { type: 'integer' },
                    totalItems: { type: 'integer' },
                    totalPages: { type: 'integer' },
                  },
                },
              },
            },
          },
          parameters: {
            page: { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
            pageSize: { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500 } },
            sort: { name: 'sort', in: 'query', schema: { type: 'string' } },
            order: { name: 'order', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'] } },
          },
        },
        security: [{ bearerAuth: [] }],
        paths: buildPaths(),
        'x-permissions': PERMISSION_CATALOG,
      });
    })
  );

  /** A readable index for people, kept in step with the JSON contract. */
  router.get(
    '/docs',
    route((_req, res) => {
      const rows = ENDPOINTS.map((endpoint) => {
        const permission = permissionForRoute(endpoint.method, endpoint.path.replace(/:[^/]+/g, 'x')) ?? '-';
        return `<tr><td>${endpoint.method}</td><td><code>${endpoint.path}</code></td><td>${endpoint.summary}</td><td><code>${permission}</code></td></tr>`;
      }).join('\n');

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(
        `<!doctype html><meta charset="utf-8"><title>Factory Vision MES API ${API_VERSION}</title>` +
          '<style>body{font-family:system-ui,sans-serif;margin:2rem;line-height:1.5}' +
          'table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:.4rem.6rem;text-align:left;font-size:14px}' +
          'th{background:#f3f4f6}code{font-family:ui-monospace,monospace}</style>' +
          `<h1>Factory Vision MES API</h1><p>Versi ${PRODUCT_VERSION}, kontrak mesin: <a href="/api/v1/meta/openapi.json">openapi.json</a></p>` +
          '<p>Semua endpoint memerlukan header <code>Authorization: Bearer &lt;token&gt;</code> kecuali endpoint login. ' +
          'Kesalahan selalu memakai struktur <code>{ "error": { "code", "message", "fields?", "requestId" } }</code>. ' +
          'Endpoint list yang mendukung paginasi menerima <code>page</code>, <code>pageSize</code>, <code>sort</code>, <code>order</code>.</p>' +
          `<table><thead><tr><th>Method</th><th>Path</th><th>Ringkasan</th><th>Permission</th></tr></thead><tbody>${rows}</tbody></table>`
      );
    })
  );

  return router;
}

function buildPaths(): Record<string, Record<string, unknown>> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const endpoint of ENDPOINTS) {
    const openApiPath = endpoint.path.replace(/:([^/]+)/g, '{$1}');
    paths[openApiPath] = paths[openApiPath] ?? {};
    paths[openApiPath][endpoint.method.toLowerCase()] = {
      summary: endpoint.summary,
      'x-permission': permissionForRoute(endpoint.method, endpoint.path.replace(/:[^/]+/g, 'x')) ?? null,
      responses: {
        '200': { description: 'OK' },
        '401': {
          description: 'Unauthenticated',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
        },
        '403': {
          description: 'Forbidden / out of scope',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
        },
        '422': {
          description: 'Validation error',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
        },
      },
    };
  }
  return paths;
}
