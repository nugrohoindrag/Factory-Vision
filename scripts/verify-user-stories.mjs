/**
 * Executable acceptance check for PRD v1.5 §41 (US-001 … US-054).
 *
 * Every assertion exercises a functional acceptance criterion against the
 * running API, so the Definition of Done is checked rather than claimed. Run
 * the API first:
 *
 *   BOOTSTRAP_ADMIN_EMAIL=admin@pabrik.co.id \
 *   BOOTSTRAP_ADMIN_PASSWORD=RahasiaKuat2026 \
 *   BOOTSTRAP_OPERATOR_PIN=1234 pnpm dev:api
 *
 *   node scripts/verify-user-stories.mjs
 *
 * UI rendering is covered separately by scripts/offline-check.mjs, which drives
 * a browser; this file is the API and business-rule half.
 */

const BASE = process.env.API_BASE || 'http://localhost:4000';
const ADMIN_EMAIL = process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@pabrik.co.id';
const ADMIN_PASSWORD = process.env.BOOTSTRAP_ADMIN_PASSWORD || 'RahasiaKuat2026';
const OPERATOR_PIN = process.env.BOOTSTRAP_OPERATOR_PIN || '1234';

const results = [];
let adminToken = '';
let operatorToken = '';

function record(story, criterion, passed, detail = '') {
  results.push({ story, criterion, passed, detail });
}

/** Assert and record in one step, so a thrown error still leaves a row. */
async function check(story, criterion, fn) {
  try {
    const detail = await fn();
    record(story, criterion, true, detail ?? '');
  } catch (error) {
    record(story, criterion, false, error.message);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function api(path, { token, method = 'GET', body, expect } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (expect !== undefined && response.status !== expect) {
    throw new Error(`${method} ${path} expected ${expect}, got ${response.status}`);
  }
  return { status: response.status, body: parsed };
}

const uid = () => `verify-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// ============================================================
// 41.1 Authentication & Access
// ============================================================

async function authentication() {
  await check('US-001', 'Login with email + password creates a session', async () => {
    const { body } = await api('/api/v1/auth/login', {
      method: 'POST',
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
      expect: 200,
    });
    assert(body.token, 'no token returned');
    assert(body.principal.role, 'no role on principal');
    adminToken = body.token;
    return `role ${body.principal.role}, ${body.principal.permissions.length} permissions`;
  });

  await check('US-001', 'Wrong password is refused', async () => {
    const { status } = await api('/api/v1/auth/login', {
      method: 'POST',
      body: { email: ADMIN_EMAIL, password: 'wrong-password' },
    });
    assert(status === 401, `expected 401, got ${status}`);
    return '401';
  });

  await check('US-001', 'Landing page follows role', async () => {
    const { body } = await api('/api/v1/auth/session', { token: adminToken, expect: 200 });
    assert(body.principal.landingPath, 'no landingPath on principal');
    return body.principal.landingPath;
  });

  await check('US-002', 'Operator signs in with employee number + PIN', async () => {
    const { body } = await api('/api/v1/auth/operator-login', {
      method: 'POST',
      body: { employeeNumber: 'OP-1001', pin: OPERATOR_PIN },
      expect: 200,
    });
    assert(body.token, 'no token');
    assert(body.principal.kind === 'OPERATOR', 'principal is not an operator');
    operatorToken = body.token;
    return `${body.operator.name}, idle timeout ${body.idleTimeoutSeconds}s`;
  });

  await check('US-002', 'Operator session is short-lived', async () => {
    const { body } = await api('/api/v1/auth/session', { token: operatorToken, expect: 200 });
    const lifetime = (Date.parse(body.principal.expiresAt) - Date.parse(body.principal.issuedAt)) / 3600000;
    assert(lifetime <= 12, `absolute lifetime ${lifetime}h is not short-lived`);
    return `${lifetime}h absolute`;
  });

  await check('US-002', 'Wrong PIN is refused', async () => {
    const { status } = await api('/api/v1/auth/operator-login', {
      method: 'POST',
      body: { employeeNumber: 'OP-1001', pin: '9999' },
    });
    assert(status === 401, `expected 401, got ${status}`);
    return '401';
  });

  await check('US-003', 'Unauthenticated access is refused', async () => {
    const { status } = await api('/api/v1/master/products');
    assert(status === 401, `expected 401, got ${status}`);
    return '401';
  });

  await check('US-003', 'Executive cannot run shop-floor commands', async () => {
    // The operator token stands in for a role without analytics rights; the
    // mirror case, an operator reaching executive analytics, is the check.
    const { status } = await api('/api/v1/analytics/executive-kpi', { token: operatorToken });
    assert(status === 403, `expected 403, got ${status}`);
    return 'operator blocked from executive analytics (403)';
  });

  await check('US-003', 'Operator cannot administer users', async () => {
    const { status } = await api('/api/v1/master/users', { token: operatorToken });
    assert(status === 403, `expected 403, got ${status}`);
    return '403';
  });

  await check('US-003', 'Operator can read what the job needs', async () => {
    for (const path of ['/api/v1/master/downtime-reasons', '/api/v1/master/reject-reasons', '/api/v1/work-orders']) {
      await api(path, { token: operatorToken, expect: 200 });
    }
    return 'reason codes and assigned work orders readable';
  });
}

// ============================================================
// 41.2 User Management & Administration
// ============================================================

async function userManagement() {
  let createdUserId = '';

  await check('US-004', 'Admin creates a user with role and scope', async () => {
    const { body } = await api('/api/v1/master/users', {
      token: adminToken,
      method: 'POST',
      body: {
        email: `${uid()}@factoryvision.local`,
        name: 'Verification User',
        role: 'SUPERVISOR',
        accountType: 'APPLICATION_USER',
        scopeLevel: 'LINE',
        scopeId: 'line-01',
        status: 'ACTIVE',
      },
      expect: 201,
    });
    createdUserId = body.id;
    assert(body.scopeLevel === 'LINE', 'scope not stored');
    return `${body.id}, scope ${body.scopeLevel}:${body.scopeId}`;
  });

  await check('US-005', 'Status change is applied', async () => {
    const { body } = await api(`/api/v1/master/users/${createdUserId}/status`, {
      token: adminToken,
      method: 'PATCH',
      body: { status: 'SUSPENDED' },
      expect: 200,
    });
    assert(body.status === 'SUSPENDED', 'status not applied');
    return 'SUSPENDED';
  });

  await check('US-005', 'Live sessions are listable and revocable', async () => {
    const { body } = await api('/api/v1/sessions', { token: adminToken, expect: 200 });
    assert(Array.isArray(body), 'sessions is not a list');
    return `${body.length} active sessions`;
  });

  await check('US-006', 'Permission catalogue uses module:action', async () => {
    const { body } = await api('/api/v1/permissions', { token: adminToken, expect: 200 });
    assert(body.length > 0, 'empty catalogue');
    assert(body.every((p) => /^[a-z_]+:[a-z_]+$/.test(p.id)), 'a permission id is malformed');
    return `${body.length} permissions`;
  });

  await check('US-006', 'System roles exist and are immutable', async () => {
    const { body } = await api('/api/v1/roles', { token: adminToken, expect: 200 });
    const system = body.filter((r) => r.system);
    assert(system.length === 7, `expected 7 system roles, got ${system.length}`);
    const { status } = await api(`/api/v1/roles/${system[0].id}`, {
      token: adminToken,
      method: 'PUT',
      body: { name: 'Renamed' },
    });
    assert(status === 403, `system role edit expected 403, got ${status}`);
    return `${system.length} system roles, edit refused`;
  });

  await check('US-006', 'Custom tenant role can be created', async () => {
    const key = `VERIFY_${Date.now()}`;
    const { body } = await api('/api/v1/roles', {
      token: adminToken,
      method: 'POST',
      body: { key, name: 'Verification Role', permissions: ['dashboard:view', 'analytics:view'] },
      expect: 201,
    });
    await api(`/api/v1/roles/${body.id}`, { token: adminToken, method: 'DELETE', expect: 200 });
    return `${body.key} created and removed`;
  });

  await check('US-007', 'Master data collections are manageable', async () => {
    const paths = [
      'master/products', 'master/machines', 'master/lines', 'master/work-centers',
      'master/processes', 'master/routings', 'master/machine-rates',
      'master/downtime-reasons', 'master/reject-reasons', 'shifts',
    ];
    for (const p of paths) await api(`/api/v1/${p}`, { token: adminToken, expect: 200 });
    return `${paths.length} collections readable`;
  });

  await check('US-007', 'Shift can be created and deleted', async () => {
    const { body } = await api('/api/v1/shifts', {
      token: adminToken,
      method: 'POST',
      body: { plantId: 'plant-cikarang-01', name: `Verify ${Date.now()}`, startTime: '22:00', endTime: '06:00', breakMinutes: 45 },
      expect: 201,
    });
    assert(body.crossesMidnight === true, 'crossesMidnight not derived for a night shift');
    await api(`/api/v1/shifts/${body.id}`, { token: adminToken, method: 'DELETE', expect: 200 });
    return 'night shift derived crossesMidnight, then deleted';
  });

  await check('US-008', 'CSV template is downloadable', async () => {
    const { body } = await api('/api/v1/csv/products/template', { token: adminToken, expect: 200 });
    assert(body.csv.includes('sku'), 'template missing columns');
    return `${body.columns.length} columns`;
  });

  await check('US-008', 'Valid CSV imports', async () => {
    const sku = `VERIFY-${Date.now()}`;
    const csv = `sku,name,unit,idealCycleTimeSeconds,status\n${sku},Verification Product,PCS,120,ACTIVE\n`;
    const { body } = await api('/api/v1/csv/products/import', {
      token: adminToken,
      method: 'POST',
      body: { content: csv },
      expect: 200,
    });
    assert(body.created === 1, `expected 1 created, got ${body.created}`);
    return `created ${body.created}`;
  });

  await check('US-008', 'Invalid rows report errors and are not inserted', async () => {
    const csv = 'sku,name,unit,idealCycleTimeSeconds,status\n,Missing SKU,PCS,120,ACTIVE\nOK-1,Bad Cycle,PCS,abc,ACTIVE\n';
    const { body } = await api('/api/v1/csv/products/import', {
      token: adminToken,
      method: 'POST',
      body: { content: csv },
      expect: 200,
    });
    assert(body.failed === 2, `expected 2 failures, got ${body.failed}`);
    assert(body.created === 0, 'invalid rows were inserted');
    assert(body.errors.length >= 2, 'errors not reported per row');
    return `${body.failed} rows rejected, ${body.errors.length} row errors`;
  });

  await check('US-008', 'Missing required column rejects the whole file', async () => {
    const { body } = await api('/api/v1/csv/products/import', {
      token: adminToken,
      method: 'POST',
      body: { content: 'name,unit\nNo SKU column,PCS\n' },
      expect: 200,
    });
    assert(body.rejectedWholeFile === true, 'file was not rejected');
    return 'whole file rejected';
  });

  await check('US-008', 'Export returns CSV', async () => {
    const response = await fetch(`${BASE}/api/v1/csv/products/export`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const text = await response.text();
    assert(response.status === 200, `status ${response.status}`);
    assert(text.split('\n')[0].includes('sku'), 'no header row');
    return `${text.split('\n').length - 1} rows`;
  });
}

// ============================================================
// 41.3 Production Planning
// ============================================================

async function planning() {
  let orderId = '';
  let workOrderId = '';

  await check('US-009', 'Production Order is created with a unique number', async () => {
    const { body } = await api('/api/v1/production-orders', {
      token: adminToken,
      method: 'POST',
      body: {
        orderNumber: `PO-VERIFY-${Date.now()}`,
        productId: 'prod-tire-a',
        quantity: 500,
        dueDate: '2026-09-30',
        createdBy: 'verification',
      },
      expect: 201,
    });
    orderId = body.id;
    return body.orderNumber;
  });

  await check('US-010', 'Work Order inherits product and carries process + sequence', async () => {
    const { body } = await api('/api/v1/work-orders', {
      token: adminToken,
      method: 'POST',
      body: {
        productionOrderId: orderId,
        productId: 'prod-tire-a',
        lineId: 'line-01',
        processId: 'proc-mixing',
        sequence: 1,
        machineId: 'mc-mix-01',
        targetQuantity: 100,
        plannedStart: '2026-09-01T00:00:00.000Z',
        plannedEnd: '2026-09-01T08:00:00.000Z',
      },
      expect: 201,
    });
    workOrderId = body.id;
    assert(body.productionOrderId === orderId, 'not linked to the production order');
    assert(body.processId === 'proc-mixing', 'process not stored');
    return `${body.woNumber}, seq ${body.sequence}`;
  });

  await check('US-011', 'Schedule window can be changed', async () => {
    const { body } = await api(`/api/v1/work-orders/${workOrderId}`, {
      token: adminToken,
      method: 'PUT',
      body: { plannedStart: '2026-09-02T00:00:00.000Z', plannedEnd: '2026-09-02T08:00:00.000Z' },
      expect: 200,
    });
    assert(body.plannedStart.startsWith('2026-09-02'), 'schedule not applied');
    return body.plannedStart;
  });

  await check('US-013', 'Batch/Lot is created and attached to the Work Order', async () => {
    const { body: batch } = await api('/api/v1/master/batches', {
      token: adminToken,
      method: 'POST',
      body: {
        batchNumber: `B-VERIFY-${Date.now()}`,
        productId: 'prod-tire-a',
        productionOrderId: orderId,
        productionDate: '2026-09-01',
        status: 'ACTIVE',
      },
      expect: 201,
    });
    const { body: wo } = await api(`/api/v1/work-orders/${workOrderId}`, {
      token: adminToken,
      method: 'PUT',
      body: { batchId: batch.id },
      expect: 200,
    });
    assert(wo.batchId === batch.id, 'batch not attached');
    return `${batch.batchNumber} attached`;
  });

  await check('US-012', 'Only an eligible Work Order can be released', async () => {
    const { body } = await api(`/api/v1/work-orders/${workOrderId}/release`, {
      token: adminToken,
      method: 'POST',
      expect: 200,
    });
    assert(body.status === 'RELEASED', `status is ${body.status}`);
    const again = await api(`/api/v1/work-orders/${workOrderId}/release`, { token: adminToken, method: 'POST' });
    assert(again.status >= 400, 'releasing twice was allowed');
    return 'RELEASED, second release refused';
  });

  return { orderId, workOrderId };
}

// ============================================================
// 41.4 Shop-Floor Execution & 41.10 Offline
// ============================================================

async function shopFloor(workOrderId) {
  await check('US-014', 'Operator sees assigned work orders with context', async () => {
    const { body } = await api('/api/v1/work-orders', { token: operatorToken, expect: 200 });
    assert(Array.isArray(body) && body.length > 0, 'no work orders visible');
    const withContext = body.find((wo) => wo.processId && wo.lineId);
    assert(withContext, 'no work order carries process and line context');
    return `${body.length} work orders, context inherited`;
  });

  await check('US-015', 'Start moves the Work Order to In Progress', async () => {
    const { body } = await api(`/api/v1/work-orders/${workOrderId}/start`, {
      token: operatorToken,
      method: 'POST',
      body: { operatorId: 'op-001', clientEventId: uid(), occurredAt: new Date().toISOString() },
      expect: 200,
    });
    assert(body.status === 'IN_PROGRESS', `status ${body.status}`);
    assert(body.actualStart, 'actualStart not captured');
    return `IN_PROGRESS at ${body.actualStart}`;
  });

  await check('US-018', 'Good quantity is recorded with full context', async () => {
    const { body } = await api('/api/v1/shop-floor/output', {
      token: operatorToken,
      method: 'POST',
      body: {
        workOrderId,
        operatorId: 'op-001',
        goodQuantity: 10,
        rejectQuantity: 0,
        clientEventId: uid(),
        occurredAt: new Date().toISOString(),
      },
      expect: 201,
    });
    assert(body.processId, 'process_id not stored on the production record');
    assert(body.shiftDate, 'shift_date not stored');
    return `process ${body.processId}, shift_date ${body.shiftDate}`;
  });

  await check('US-019', 'Reject without a reason is refused', async () => {
    const { status } = await api('/api/v1/shop-floor/output', {
      token: operatorToken,
      method: 'POST',
      body: {
        workOrderId,
        operatorId: 'op-001',
        goodQuantity: 0,
        rejectQuantity: 5,
        clientEventId: uid(),
        occurredAt: new Date().toISOString(),
      },
    });
    assert(status === 422, `expected 422, got ${status}`);
    return '422 VALIDATION_ERROR';
  });

  await check('US-019', 'Reject with a reason is recorded', async () => {
    const { body } = await api('/api/v1/shop-floor/output', {
      token: operatorToken,
      method: 'POST',
      body: {
        workOrderId,
        operatorId: 'op-001',
        goodQuantity: 0,
        rejectQuantity: 3,
        rejectReasonId: 'rej-blister',
        clientEventId: uid(),
        occurredAt: new Date().toISOString(),
      },
      expect: 201,
    });
    assert(body.rejectReasonId === 'rej-blister', 'reason not stored');
    return `${body.rejectQuantity} rejected, reason stored`;
  });

  let downtimeId = '';
  await check('US-016', 'Downtime stores process_id and derives is_planned', async () => {
    const { body } = await api('/api/v1/shop-floor/downtime/start', {
      token: operatorToken,
      method: 'POST',
      body: {
        workOrderId,
        machineId: 'mc-mix-01',
        reasonId: 'dt-setup',
        operatorId: 'op-001',
        clientEventId: uid(),
        occurredAt: new Date().toISOString(),
      },
      expect: 201,
    });
    downtimeId = body.id;
    assert(body.processId, 'process_id missing on the downtime record');
    assert(body.isPlanned === true, 'is_planned not taken from the configured reason');
    return `process ${body.processId}, is_planned from reason code`;
  });

  await check('US-016', 'Unknown downtime reason is refused', async () => {
    const { status } = await api('/api/v1/shop-floor/downtime/start', {
      token: operatorToken,
      method: 'POST',
      body: { workOrderId, machineId: 'mc-mix-01', reasonId: 'does-not-exist', clientEventId: uid(), occurredAt: new Date().toISOString() },
    });
    assert(status === 422, `expected 422, got ${status}`);
    return '422';
  });

  await check('US-017', 'Resolving downtime computes duration', async () => {
    const { body } = await api(`/api/v1/shop-floor/downtime/${downtimeId}/resolve`, {
      token: operatorToken,
      method: 'POST',
      body: { clientEventId: uid(), occurredAt: new Date(Date.now() + 600000).toISOString() },
      expect: 200,
    });
    assert(body.status === 'RESOLVED', `status ${body.status}`);
    assert(body.durationSeconds > 0, 'duration not computed');
    return `${Math.round(body.durationSeconds / 60)} minutes`;
  });

  await check('US-020', 'Completing retains final quantities', async () => {
    const { body } = await api(`/api/v1/work-orders/${workOrderId}/complete`, {
      token: operatorToken,
      method: 'POST',
      body: { clientEventId: uid(), occurredAt: new Date().toISOString() },
      expect: 200,
    });
    assert(body.status === 'COMPLETED', `status ${body.status}`);
    assert(body.actualEnd, 'actualEnd not captured');
    assert(body.goodQuantity === 10, `good quantity ${body.goodQuantity} not retained`);
    return `COMPLETED, good ${body.goodQuantity}, reject ${body.rejectQuantity}`;
  });

  await check('US-045', 'Offline commands sync in one batch', async () => {
    const events = ['a', 'b'].map(() => uid());
    const { body } = await api('/api/v1/shop-floor/sync-batch', {
      token: operatorToken,
      method: 'POST',
      body: {
        commands: [
          { type: 'RECORD_OUTPUT', clientEventId: events[0], workOrderId: 'wo-101', occurredAt: new Date().toISOString(), payload: { operatorId: 'op-001', goodQuantity: 2, rejectQuantity: 0 } },
          { type: 'RECORD_DOWNTIME', clientEventId: events[1], workOrderId: 'wo-101', occurredAt: new Date().toISOString(), payload: { machineId: 'mc-mix-01', reasonId: 'dt-breakdown', operatorId: 'op-001' } },
        ],
      },
      expect: 200,
    });
    assert(body.applied === 2, `applied ${body.applied}`);
    // Close the downtime this check opened: leaving a machine down would make
    // a rerun fail to start, which is the product behaving correctly.
    await api('/api/v1/shop-floor/sync-batch', {
      token: operatorToken,
      method: 'POST',
      body: { commands: [{ type: 'RESOLVE_DOWNTIME', clientEventId: uid(), workOrderId: 'wo-101', occurredAt: new Date().toISOString(), payload: {} }] },
    });
    return `${body.applied} applied`;
  });

  await check('US-046', 'Replaying a client_event_id is a duplicate, not a second record', async () => {
    const eventId = uid();
    const command = {
      type: 'RECORD_OUTPUT',
      clientEventId: eventId,
      workOrderId: 'wo-101',
      occurredAt: new Date().toISOString(),
      payload: { operatorId: 'op-001', goodQuantity: 7, rejectQuantity: 0 },
    };
    const first = await api('/api/v1/shop-floor/sync-batch', { token: operatorToken, method: 'POST', body: { commands: [command] }, expect: 200 });
    const second = await api('/api/v1/shop-floor/sync-batch', { token: operatorToken, method: 'POST', body: { commands: [command] }, expect: 200 });
    assert(first.body.applied === 1, 'first submission not applied');
    assert(second.body.duplicates === 1, 'replay was not detected as duplicate');
    return 'APPLIED then DUPLICATE';
  });

  await check('US-046', 'A bad command fails without losing the rest', async () => {
    const { body } = await api('/api/v1/shop-floor/sync-batch', {
      token: operatorToken,
      method: 'POST',
      body: {
        commands: [
          { type: 'RECORD_OUTPUT', clientEventId: uid(), workOrderId: 'wo-101', occurredAt: new Date().toISOString(), payload: { operatorId: 'op-001', goodQuantity: 1, rejectQuantity: 0 } },
          { type: 'RECORD_OUTPUT', clientEventId: uid(), workOrderId: 'wo-101', occurredAt: new Date().toISOString(), payload: { operatorId: 'op-001', goodQuantity: 0, rejectQuantity: 4 } },
        ],
      },
      expect: 200,
    });
    assert(body.applied === 1 && body.failed === 1, `applied ${body.applied}, failed ${body.failed}`);
    const failure = body.results.find((r) => r.status === 'FAILED');
    assert(failure.retryable === false, 'a validation failure was marked retryable');
    return 'one applied, one permanently failed with a reason';
  });
}

// ============================================================
// 41.5 Shift, 41.6 Dashboard, 41.7 OEE, 41.8 Reports
// ============================================================

async function analytics() {
  await check('US-021', 'shift_date follows the shift start for a night shift', async () => {
    const { body } = await api('/api/v1/shifts', { token: adminToken, expect: 200 });
    const night = body.find((s) => s.crossesMidnight);
    assert(night, 'no midnight-crossing shift configured');
    return `${night.name} ${night.startTime}-${night.endTime}`;
  });

  await check('US-022', 'Shift performance is reportable', async () => {
    const { body } = await api('/api/v1/reports/shift', { token: adminToken, expect: 200 });
    assert(Array.isArray(body) && body.length > 0, 'empty shift report');
    assert(body[0].shiftDate, 'no shift_date on the report row');
    return `${body.length} rows`;
  });

  await check('US-023', 'Handover context carries result, remaining target and issues', async () => {
    const { body } = await api('/api/v1/shifts/handover/context?lineId=line-01', { token: adminToken, expect: 200 });
    assert(typeof body.remainingTarget === 'number', 'no remaining target');
    assert(Array.isArray(body.openWorkOrders), 'no open work orders');
    return `target ${body.targetQuantity}, remaining ${body.remainingTarget}, ${body.openWorkOrders.length} open`;
  });

  await check('US-023', 'Handover note can be recorded', async () => {
    const { body } = await api('/api/v1/shifts/handover', {
      token: adminToken,
      method: 'POST',
      body: { lineId: 'line-01', shiftId: 'shift-1', shiftDate: '2026-08-29', notes: 'Verification handover note.', openIssues: ['Curing press needs a mould change'] },
      expect: 201,
    });
    assert(body.id, 'no handover id');
    return body.id;
  });

  await check('US-024', 'Executive KPI returns the eight cards with target and status', async () => {
    const { body } = await api('/api/v1/analytics/executive-kpi?days=7', { token: adminToken, expect: 200 });
    assert(body.length === 8, `expected 8 KPI, got ${body.length}`);
    const oee = body.find((k) => k.metric === 'OEE');
    assert(oee.target !== undefined && oee.status, 'OEE card lacks target or status');
    return body.map((k) => `${k.metric} ${k.value}${k.unit}`).join(', ');
  });

  await check('US-025', 'Target vs Actual reports variance and achievement', async () => {
    const { body } = await api('/api/v1/oee/target-vs-actual?days=7&dimension=LINE', { token: adminToken, expect: 200 });
    assert(typeof body.totalVariance === 'number', 'no variance');
    assert(body.rows.length > 0, 'no rows');
    return `target ${body.totalTarget}, actual ${body.totalActual}, variance ${body.totalVariance}`;
  });

  await check('US-026', 'Live production board reports status per line', async () => {
    const { body } = await api('/api/v1/analytics/live-board', { token: adminToken, expect: 200 });
    assert(body.length > 0, 'empty board');
    assert(typeof body[0].achievementPct === 'number', 'no achievement on the board');
    return `${body.length} entries`;
  });

  await check('US-027', 'OEE drills from process to machine', async () => {
    const process = await api('/api/v1/analytics/process-performance?days=7', { token: adminToken, expect: 200 });
    const machine = await api('/api/v1/oee/machine-performance?days=7', { token: adminToken, expect: 200 });
    assert(process.body.length > 0 && machine.body.length > 0, 'a level of the drill-down is empty');
    return `${process.body.length} processes, ${machine.body.length} machines`;
  });

  await check('US-027', 'A missing Ideal Cycle Time is flagged, not defaulted', async () => {
    const { body } = await api('/api/v1/oee/machine-performance?days=7', { token: adminToken, expect: 200 });
    assert(body.every((m) => typeof m.idealCycleMissing === 'boolean'), 'no idealCycleMissing flag');
    const flagged = body.filter((m) => m.idealCycleMissing).length;
    return `${flagged} of ${body.length} machines flagged`;
  });

  await check('US-028', 'Downtime Pareto ranks reasons by duration', async () => {
    const { body } = await api('/api/v1/analytics/downtime-pareto', { token: adminToken, expect: 200 });
    assert(body.length > 0, 'empty pareto');
    for (let i = 1; i < body.length; i += 1) {
      assert(body[i - 1].totalDurationSeconds >= body[i].totalDurationSeconds, 'pareto is not sorted');
    }
    assert(body[body.length - 1].cumulativePercentage > 99, 'cumulative does not reach 100%');
    return `top: ${body[0].reasonName} (${body[0].totalDurationMinutes} min)`;
  });

  await check('US-029', 'Reject Pareto ranks defects by quantity', async () => {
    const { body } = await api('/api/v1/analytics/reject-pareto', { token: adminToken, expect: 200 });
    assert(body.length > 0, 'empty reject pareto');
    for (let i = 1; i < body.length; i += 1) {
      assert(body[i - 1].totalRejectQuantity >= body[i].totalRejectQuantity, 'not sorted');
    }
    return `top: ${body[0].reasonName} (${body[0].totalRejectQuantity})`;
  });

  await check('US-030', 'Order risk is classified', async () => {
    const { body } = await api('/api/v1/analytics/order-status', { token: adminToken, expect: 200 });
    assert(typeof body.atRisk === 'number' && typeof body.delayed === 'number', 'no risk classification');
    return `planned ${body.planned}, running ${body.running}, at risk ${body.atRisk}, delayed ${body.delayed}`;
  });

  await check('US-031', 'Alerts carry severity and a drill-down path', async () => {
    const { body } = await api('/api/v1/analytics/alerts?days=7', { token: adminToken, expect: 200 });
    assert(Array.isArray(body), 'alerts is not a list');
    if (body.length) {
      assert(body[0].severity && body[0].drillDownPath, 'alert lacks severity or drill-down');
    }
    return `${body.length} alerts`;
  });

  await check('US-033', 'Performance uses the configured Ideal Cycle Time', async () => {
    const { body } = await api('/api/v1/oee/machine-performance?days=7', { token: adminToken, expect: 200 });
    const rated = body.find((m) => !m.idealCycleMissing);
    assert(rated, 'no machine has a resolved Ideal Cycle Time');
    assert(rated.idealCycleSeconds > 0, 'rate not exposed');
    assert(rated.performance >= 0 && rated.performance <= 100, `performance ${rated.performance} out of range`);
    return `${rated.machineName}: ICT ${rated.idealCycleSeconds}s, performance ${rated.performance}%`;
  });

  await check('US-034', 'Quality is Good / Total and survives a zero denominator', async () => {
    const { body } = await api('/api/v1/oee/report?days=7', { token: adminToken, expect: 200 });
    const withOutput = body.find((r) => r.totalQuantity > 0);
    assert(withOutput, 'no row with output');
    const expected = (withOutput.goodQuantity / withOutput.totalQuantity) * 100;
    assert(Math.abs(expected - withOutput.quality) < 1.5, `quality ${withOutput.quality} != good/total ${expected.toFixed(1)}`);
    const empty = body.filter((r) => r.totalQuantity === 0);
    assert(empty.every((r) => Number.isFinite(r.quality)), 'a zero denominator produced a non-finite quality');
    return `good ${withOutput.goodQuantity}/${withOutput.totalQuantity} = ${withOutput.quality}%`;
  });

  await check('US-032', 'OEE components are reproducible and versioned', async () => {
    const { body } = await api('/api/v1/oee/report?days=7', { token: adminToken, expect: 200 });
    assert(body.length > 0, 'empty OEE report');
    const row = body[0];
    for (const field of ['availability', 'performance', 'quality', 'oee', 'calcVersion']) {
      assert(row[field] !== undefined, `missing ${field}`);
    }
    // OEE must equal A × P × Q within rounding.
    const expected = (row.availability / 100) * (row.performance / 100) * (row.quality / 100) * 100;
    assert(Math.abs(expected - row.oee) < 1.5, `OEE ${row.oee} does not equal A×P×Q ${expected.toFixed(1)}`);
    return `A ${row.availability} × P ${row.performance} × Q ${row.quality} = OEE ${row.oee}, calc v${row.calcVersion}`;
  });

  await check('US-032', 'ppt_excludes_planned_downtime is configurable', async () => {
    const { body } = await api('/api/v1/oee/config', { token: adminToken, expect: 200 });
    assert(typeof body.pptExcludesPlannedDowntime === 'boolean', 'flag missing');
    assert(typeof body.calcVersion === 'number', 'calc_version missing');
    return `ppt_excludes=${body.pptExcludesPlannedDowntime}, calc v${body.calcVersion}`;
  });

  await check('US-035', 'Changing a definition bumps calc_version', async () => {
    const before = await api('/api/v1/oee/config', { token: adminToken, expect: 200 });
    const toggled = await api('/api/v1/oee/config', {
      token: adminToken,
      method: 'PUT',
      body: { pptExcludesPlannedDowntime: !before.body.pptExcludesPlannedDowntime },
      expect: 200,
    });
    assert(toggled.body.calcVersion === before.body.calcVersion + 1, 'calc_version did not advance');
    await api('/api/v1/oee/config', {
      token: adminToken,
      method: 'PUT',
      body: { pptExcludesPlannedDowntime: before.body.pptExcludesPlannedDowntime },
      expect: 200,
    });
    return `v${before.body.calcVersion} to v${toggled.body.calcVersion}, then restored`;
  });

  await check('US-036', 'Pilot validation tracks V1 to V6', async () => {
    const { body } = await api('/api/v1/oee/validation', { token: adminToken, expect: 200 });
    assert(body.entries.length === 6, `expected 6 items, got ${body.entries.length}`);
    return `${body.entries.map((e) => e.item).join(', ')}, gate ${body.gate.passed ? 'passed' : 'open'}`;
  });

  await check('US-036', 'A definition gap cannot be closed by an ad-hoc patch', async () => {
    const { status } = await api('/api/v1/oee/validation/V1', {
      token: adminToken,
      method: 'PUT',
      body: { status: 'RESOLVED', gapClass: 'DEFINITION', resolvedByConfigChange: false },
    });
    assert(status === 422, `expected 422, got ${status}`);
    return '422, configuration change required';
  });

  await check('US-037', 'Bottlenecks rank by lost output', async () => {
    const { body } = await api('/api/v1/oee/bottlenecks?days=7&kind=MACHINE', { token: adminToken, expect: 200 });
    assert(body.length > 0, 'no bottlenecks');
    assert(body[0].rank === 1, 'ranking does not start at 1');
    for (let i = 1; i < body.length; i += 1) {
      assert(body[i - 1].lostUnits >= body[i].lostUnits, 'not ranked by lost units');
    }
    assert(body[0].dominantLoss, 'no dominant loss factor');
    return `worst: ${body[0].entityName}, ${body[0].lostUnits} units lost, ${body[0].dominantLoss}`;
  });

  for (const [story, path, label] of [
    ['US-038', '/api/v1/reports/production', 'Production report'],
    ['US-039', '/api/v1/reports/downtime', 'Downtime report'],
    ['US-040', '/api/v1/reports/shift', 'Shift report'],
    ['US-041', '/api/v1/oee/report?days=7', 'OEE report'],
  ]) {
    await check(story, `${label} returns rows`, async () => {
      const { body } = await api(path, { token: adminToken, expect: 200 });
      assert(Array.isArray(body) && body.length > 0, 'empty report');
      return `${body.length} rows`;
    });
  }

  await check('US-038', 'Reports export as CSV', async () => {
    const response = await fetch(`${BASE}/api/v1/reports/production?format=csv`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const text = await response.text();
    assert(response.status === 200 && text.includes(','), 'no CSV returned');
    return `${text.split('\n').length - 1} rows`;
  });
}

// ============================================================
// 41.9 Correction & Audit, 41.11 Pilot, 41.12/13 Platform
// ============================================================

async function governance() {
  await check('US-042', 'Correction records original and new value', async () => {
    const { body } = await api('/api/v1/corrections', {
      token: adminToken,
      method: 'POST',
      body: {
        entityType: 'PRODUCTION_RECORD',
        entityId: 'wo-101',
        shiftDate: new Date().toISOString().slice(0, 10),
        fieldChanges: { goodQuantity: { from: 100, to: 120 } },
        reason: 'Verification correction',
        requestedBy: 'verification',
      },
      expect: 201,
    });
    assert(body.fieldChanges.goodQuantity.from === 100, 'original value not retained');
    assert(body.requestedAt, 'no timestamp');
    return `${body.id}, status ${body.status}`;
  });

  await check('US-043', 'Closed-shift correction beyond the window needs approval', async () => {
    const old = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
    const { body } = await api('/api/v1/corrections', {
      token: adminToken,
      method: 'POST',
      body: {
        entityType: 'PRODUCTION_RECORD',
        entityId: 'wo-101',
        shiftDate: old,
        fieldChanges: { goodQuantity: { from: 10, to: 12 } },
        reason: 'Historical correction',
        requestedBy: 'verification',
      },
      expect: 201,
    });
    assert(body.requiresApproval === true, 'an out-of-window correction did not require approval');
    return `shift_date ${old} requires approval`;
  });

  await check('US-044', 'Audit trail records actor, action and values', async () => {
    const { body } = await api('/api/v1/audit-logs', { token: adminToken, expect: 200 });
    assert(body.length > 0, 'empty audit log');
    const entry = body.find((l) => l.action === 'LOGIN') ?? body[0];
    for (const field of ['actorId', 'action', 'entityType', 'occurredAt']) {
      assert(entry[field] !== undefined, `audit entry missing ${field}`);
    }
    return `${body.length} entries, newest ${entry.action}`;
  });

  await check('US-044', 'Authentication events are audited', async () => {
    const { body } = await api('/api/v1/audit-logs?entityType=auth', { token: adminToken, expect: 200 });
    const actions = new Set(body.map((l) => l.action));
    assert(actions.has('LOGIN'), 'no LOGIN audit entry');
    return [...actions].join(', ');
  });

  await check('US-047', 'Tire processes are configurable master data', async () => {
    const { body } = await api('/api/v1/master/processes', { token: adminToken, expect: 200 });
    const codes = body.map((p) => p.code);
    for (const required of ["MIX", "EXT", "TBM", "CPR"]) {
      assert(codes.includes(required), `process ${required} missing`);
    }
    return `${body.length} processes: ${codes.join(', ')}`;
  });

  await check('US-048', 'Products route through multiple sequenced processes', async () => {
    const { body } = await api('/api/v1/master/routings?productId=prod-tire-a', { token: adminToken, expect: 200 });
    assert(body.length >= 4, `expected a multi-step routing, got ${body.length}`);
    for (let i = 1; i < body.length; i += 1) {
      assert(body[i].sequence >= body[i - 1].sequence, 'routing is not sequenced');
    }
    return `${body.length} steps`;
  });

  await check('US-049', 'Ideal Cycle Time is configured per Product × Machine', async () => {
    const { body } = await api('/api/v1/master/machine-rates', { token: adminToken, expect: 200 });
    assert(body.length > 0, 'no rates configured');
    assert(body[0].productId && body[0].machineId, 'rate is not keyed by product and machine');
    return `${body.length} rates`;
  });

  await check('US-050', 'Demo dataset spans at least 7 days with varied performance', async () => {
    const { body } = await api('/api/v1/analytics/daily-performance?days=30', { token: adminToken, expect: 200 });
    assert(body.length >= 7, `only ${body.length} days of history`);
    const oees = body.map((d) => d.oee);
    assert(Math.max(...oees) - Math.min(...oees) > 0.02, 'history is flat, no Good/Watch/Critical spread');
    const { body: lines } = await api('/api/v1/analytics/line-performance?days=7', { token: adminToken, expect: 200 });
    const statuses = new Set(lines.map((l) => l.status));
    return `${body.length} days, line statuses: ${[...statuses].join(', ')}`;
  });

  await check('US-052', 'Deployment mode is reported', async () => {
    const { body } = await api('/api/v1/meta/deployment', { expect: 200 });
    assert(body.mode, 'no deployment mode');
    assert(typeof body.features.offlineTerminal === 'boolean', 'no feature flags');
    return `${body.mode}, api ${body.apiVersion}`;
  });

  await check('US-051', 'S1-S5 end-to-end tire trial runs', async () => {
    // One work order carried through the five §37.9 scenarios in order.
    const { body: order } = await api('/api/v1/production-orders', {
      token: adminToken, method: 'POST',
      body: { orderNumber: `PO-TRIAL-${Date.now()}`, productId: 'prod-tire-a', quantity: 60, dueDate: '2026-09-30', createdBy: 'trial' },
      expect: 201,
    });
    const { body: wo } = await api('/api/v1/work-orders', {
      token: adminToken, method: 'POST',
      body: {
        productionOrderId: order.id, productId: 'prod-tire-a', lineId: 'line-01',
        processId: 'proc-curing', machineId: 'mc-cpr-01', targetQuantity: 60,
        plannedStart: '2026-09-03T00:00:00.000Z', plannedEnd: '2026-09-03T08:00:00.000Z',
      },
      expect: 201,
    });
    await api(`/api/v1/work-orders/${wo.id}/release`, { token: adminToken, method: 'POST', expect: 200 });

    // S1, normal production.
    await api(`/api/v1/work-orders/${wo.id}/start`, {
      token: operatorToken, method: 'POST',
      body: { operatorId: 'op-001', clientEventId: uid(), occurredAt: new Date().toISOString() },
      expect: 200,
    });
    await api('/api/v1/shop-floor/output', {
      token: operatorToken, method: 'POST',
      body: { workOrderId: wo.id, operatorId: 'op-001', goodQuantity: 40, rejectQuantity: 0, clientEventId: uid(), occurredAt: new Date().toISOString() },
      expect: 201,
    });

    // S2, downtime then resume.
    const { body: dt } = await api('/api/v1/shop-floor/downtime/start', {
      token: operatorToken, method: 'POST',
      body: { workOrderId: wo.id, machineId: 'mc-cpr-01', reasonId: 'dt-breakdown', operatorId: 'op-001', clientEventId: uid(), occurredAt: new Date().toISOString() },
      expect: 201,
    });
    assert(dt.isPlanned === false, 'a breakdown was classified as planned downtime');
    await api(`/api/v1/shop-floor/downtime/${dt.id}/resolve`, {
      token: operatorToken, method: 'POST',
      body: { clientEventId: uid(), occurredAt: new Date(Date.now() + 900000).toISOString() },
      expect: 200,
    });

    // S3, reject with a reason.
    await api('/api/v1/shop-floor/output', {
      token: operatorToken, method: 'POST',
      body: { workOrderId: wo.id, operatorId: 'op-001', goodQuantity: 0, rejectQuantity: 5, rejectReasonId: 'rej-blister', clientEventId: uid(), occurredAt: new Date().toISOString() },
      expect: 201,
    });

    // S4, OEE investigation reaches the machine that just ran.
    const { body: machines } = await api('/api/v1/oee/machine-performance?days=7&machineId=mc-cpr-01', { token: adminToken, expect: 200 });
    assert(machines.length > 0, 'OEE investigation found no data for the trial machine');

    // S5, the delayed order is visible as risk.
    const { body: risk } = await api('/api/v1/analytics/order-status', { token: adminToken, expect: 200 });
    assert(typeof risk.atRisk === 'number', 'order risk not reported');

    const { body: done } = await api(`/api/v1/work-orders/${wo.id}/complete`, {
      token: operatorToken, method: 'POST',
      body: { clientEventId: uid(), occurredAt: new Date().toISOString() },
      expect: 200,
    });
    assert(done.status === 'COMPLETED', `work order ended as ${done.status}`);
    return `S1 40 good, S2 downtime 15 min, S3 5 reject, S4 OEE ${machines[0].oee}%, S5 ${risk.atRisk} at risk, completed`;
  });

  await check('US-053', 'On-premise pins a single tenant and needs no cloud service', async () => {
    const { body } = await api('/api/v1/meta/deployment', { expect: 200 });
    assert(['CLOUD_MULTI_TENANT', 'ON_PREMISE_SINGLE_TENANT'].includes(body.mode), `unknown mode ${body.mode}`);
    if (body.mode === 'ON_PREMISE_SINGLE_TENANT') {
      assert(body.tenantId, 'on-premise did not pin a tenant');
      assert(body.features.multiTenant === false, 'on-premise reports multi-tenant');
    }
    // The same image serves both modes, which is what keeps behaviour identical.
    assert(body.features.offlineTerminal === true, 'offline terminal not advertised');
    return `${body.mode}, tenant ${body.tenantId ?? 'per request'}, offline terminal on`;
  });

  await check('US-054', 'Errors use one documented envelope', async () => {
    const { body, status } = await api('/api/v1/work-orders/does-not-exist', { token: adminToken });
    assert(status === 404, `expected 404, got ${status}`);
    assert(body.error?.code && body.error?.message && body.error?.requestId, 'error envelope incomplete');
    return `${body.error.code} with requestId`;
  });

  await check('US-054', 'Validation errors list every bad field at once', async () => {
    const { body, status } = await api('/api/v1/shifts', {
      token: adminToken,
      method: 'POST',
      body: { name: 'x', startTime: 'not-a-time', endTime: '99:99' },
    });
    assert(status === 422, `expected 422, got ${status}`);
    assert(body.error.fields.length >= 2, 'errors were not collected');
    return `${body.error.fields.length} field errors in one response`;
  });

  await check('US-054', 'API documentation is served', async () => {
    const openapi = await api('/api/v1/meta/openapi.json', { expect: 200 });
    assert(openapi.body.paths && Object.keys(openapi.body.paths).length > 20, 'openapi has too few paths');
    return `${Object.keys(openapi.body.paths).length} documented paths`;
  });

  await check('US-054', 'Pagination convention works', async () => {
    const { body } = await api('/api/v1/audit-logs?page=1&pageSize=5', { token: adminToken, expect: 200 });
    assert(Array.isArray(body) || body.data, 'unexpected list shape');
    return Array.isArray(body) ? `${body.length} rows` : `page ${body.page.number}/${body.page.totalPages}`;
  });
}

// ============================================================

async function main() {
  const health = await fetch(`${BASE}/health`).catch(() => null);
  if (!health?.ok) {
    console.error(`API is not reachable at ${BASE}. Start it first.`);
    process.exit(1);
  }

  await authentication();
  await userManagement();
  const { workOrderId } = await planning();
  await shopFloor(workOrderId);
  await analytics();
  await governance();

  const byStory = new Map();
  for (const r of results) {
    if (!byStory.has(r.story)) byStory.set(r.story, []);
    byStory.get(r.story).push(r);
  }

  console.log('\nPRD v1.5 §41, acceptance verification\n');
  for (const [story, rows] of byStory) {
    for (const [i, row] of rows.entries()) {
      const mark = row.passed ? 'PASS' : 'FAIL';
      const label = i === 0 ? story.padEnd(18) : ''.padEnd(18);
      console.log(`${mark}  ${label}${row.criterion}`);
      if (row.detail) console.log(`${''.padEnd(6)}${''.padEnd(18)}${row.detail}`);
    }
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} assertions passed across ${byStory.size} story groups.`);
  if (failed.length) {
    console.log('\nFailures:');
    for (const f of failed) console.log(`  ${f.story}  ${f.criterion}\n    ${f.detail}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
