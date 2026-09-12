/**
 * Executable acceptance check for the MES Improvement release
 * (Improvement PRD §50 — End-to-End Definition of Done).
 *
 * Seven scenarios, run against a live API and a live PostgreSQL, in the order
 * the PRD lists them:
 *
 *   1. Material     Order → Plan → BOM → MRP → Availability → Consumption
 *   2. Quality      Production → Inspection → Fail → Hold → NCR → Disposition
 *   3. Maintenance  Breakdown → Emergency → Repair → Available
 *   4. Workforce    Required → Qualification → Availability → Assignment
 *   5. WIP          Output → WIP → Transfer → Receive → Next process
 *   6. Board        Schedule → Dispatch → Reschedule → Event History
 *   7. Events       Every step above traceable on one timeline
 *
 * The script asserts through HTTP, then reads the rows back with the owner
 * connection — "it is in PostgreSQL" checked against PostgreSQL rather than
 * against the API that claims to have written it, the same discipline
 * `verify-persistence.mjs` uses.
 *
 *   DATABASE_URL=postgresql://factory_app:...@host/db \
 *   OWNER_DATABASE_URL=postgresql://factory:...@host/db \
 *   pnpm verify:improvement
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const API_ENTRY = fileURLToPath(new URL('../dist/main.js', import.meta.url));

const APP_URL = process.env.DATABASE_URL;
const OWNER_URL = process.env.OWNER_DATABASE_URL || APP_URL;
const PORT = Number(process.env.IMPROVEMENT_PORT || 4097);
const BASE = `http://127.0.0.1:${PORT}`;
const TENANT = process.env.DEFAULT_TENANT_ID || 'tenant-pilot-factory-01';

const ADMIN_EMAIL = process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@pabrik.co.id';
const ADMIN_PASSWORD = process.env.BOOTSTRAP_ADMIN_PASSWORD || 'ChangeMe-Local-Only';

if (!APP_URL) {
  console.error('Set DATABASE_URL (and ideally OWNER_DATABASE_URL) before running.');
  process.exit(2);
}

const results = [];
function check(scenario, criterion, passed, detail = '') {
  results.push({ scenario, criterion, passed, detail });
}

// --- API lifecycle ---------------------------------------------------

let child = null;

async function startApi() {
  child = spawn(process.execPath, [API_ENTRY], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DATABASE_URL: APP_URL,
      AUTH_REQUIRED: 'true',
      SEED_DEMO_DATA: 'true',
      BOOTSTRAP_ADMIN_EMAIL: ADMIN_EMAIL,
      BOOTSTRAP_ADMIN_PASSWORD: ADMIN_PASSWORD,
      BOOTSTRAP_OPERATOR_PIN: process.env.BOOTSTRAP_OPERATOR_PIN || '284617',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));

  for (let i = 0; i < 90; i += 1) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    if (child.exitCode !== null) throw new Error(`API exited at startup:\n${log}`);
    await sleep(1000);
  }
  throw new Error(`API did not become healthy:\n${log}`);
}

async function stopApi() {
  if (!child) return;
  const dead = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGKILL');
  await dead;
  child = null;
}

// --- HTTP helpers ----------------------------------------------------

let token = '';

async function login() {
  const res = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': TENANT },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status} ${await res.text()}`);
  token = (await res.json()).token;
}

async function api(path, init = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Tenant-Id': TENANT,
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
const get = (path) => api(path);

// --- main ------------------------------------------------------------

const owner = new pg.Client({ connectionString: OWNER_URL });

/** Reads rows back as the owner, so the check does not trust the API. */
async function rows(sql, params = []) {
  const result = await owner.query(sql, params);
  return result.rows;
}

async function main() {
  await owner.connect();

  /*
   * The read-back connection has to be one RLS does not apply to.
   *
   * `OWNER_DATABASE_URL` falls back to `DATABASE_URL`, which is the
   * application role — and every table this script reads back carries FORCE
   * ROW LEVEL SECURITY, so the fallback would return zero rows and turn every
   * "it is in PostgreSQL" check into a confident false failure. Refusing is
   * the only honest answer: the point of reading back as the owner is not to
   * trust the API, and a read that sees nothing proves nothing either way.
   */
  const whoami = await owner.query(
    'SELECT current_user AS name, rolsuper AS superuser, rolbypassrls AS bypassrls FROM pg_roles WHERE rolname = current_user'
  );
  if (whoami.rows[0] && !whoami.rows[0].superuser && !whoami.rows[0].bypassrls) {
    throw new Error(
      `OWNER_DATABASE_URL resolves to "${whoami.rows[0].name}", which row-level security applies ` +
        'to. Row read-backs would see nothing and report a correct database as broken. Set ' +
        'OWNER_DATABASE_URL to the schema owner; DATABASE_URL stays the application role.'
    );
  }

  await startApi();
  await login();

  // Fixtures the scenarios need: a work order to hang everything off, a
  // material with stock, and a machine.
  const workOrders = (await get('/api/v1/work-orders')).body ?? [];
  const workOrder = Array.isArray(workOrders)
    ? workOrders.find((wo) => wo.status !== 'CANCELLED' && wo.status !== 'COMPLETED')
    : undefined;
  const products = (await get('/api/v1/master/products')).body ?? [];
  const machines = (await get('/api/v1/master/machines')).body ?? [];
  const operators = (await get('/api/v1/master/operators')).body ?? [];

  if (!workOrder || products.length === 0 || machines.length === 0) {
    throw new Error(
      'The demo dataset did not provide a work order, a product and a machine. Run with SEED_DEMO_DATA=true against a seeded database.'
    );
  }

  const material = products[products.length - 1];
  const machine = machines[0];
  const operator = operators[0];
  const stamp = Date.now();

  // ==================================================================
  // Scenario 1 — Material
  // ==================================================================
  {
    const receipt = await post('/api/v1/materials/inventory/receive', {
      materialId: material.id,
      quantity: 5000,
      reference: `verify-${stamp}`,
    });
    check('1 Material', 'Penerimaan material tercatat', receipt.status === 201, JSON.stringify(receipt.body));

    const inventory = await get(`/api/v1/materials/inventory?materialId=${material.id}`);
    const stock = (inventory.body ?? [])[0];
    check(
      '1 Material',
      'Stok bertambah dan Available = OnHand − Reserved + Incoming',
      Boolean(stock) &&
        Number(stock.availableQuantity) ===
          Number(stock.onHandQuantity) - Number(stock.reservedQuantity) + Number(stock.incomingQuantity),
      JSON.stringify(stock)
    );

    const ledger = await rows(
      `SELECT transaction_type, quantity, balance_after FROM material_transaction
        WHERE tenant_id = $1 AND material_id = $2 ORDER BY occurred_at DESC LIMIT 1`,
      [TENANT, material.id]
    );
    check(
      '1 Material',
      'Ledger transaksi menyimpan saldo setelah pergerakan',
      ledger.length === 1 && Number(ledger[0].balance_after) > 0,
      JSON.stringify(ledger[0])
    );

    const mrp = await post('/api/v1/mrp/run', {});
    check(
      '1 Material',
      'MRP menghasilkan run dengan horizon tersimpan (BR-M08)',
      mrp.status === 201 && Boolean(mrp.body?.run?.horizonStart) && Boolean(mrp.body?.run?.horizonEnd),
      JSON.stringify(mrp.body?.run)
    );

    const persistedRun = await rows(
      'SELECT id, horizon_start, horizon_end, total_materials FROM mrp_run WHERE tenant_id = $1 ORDER BY started_at DESC LIMIT 1',
      [TENANT]
    );
    check(
      '1 Material',
      'MRP run tersimpan di PostgreSQL',
      persistedRun.length === 1,
      JSON.stringify(persistedRun[0])
    );

    const availability = await post(`/api/v1/materials/availability/work-order/${workOrder.id}`, {});
    check(
      '1 Material',
      'Material availability check menghasilkan status kesiapan',
      availability.status === 200 &&
        ['READY', 'PARTIAL', 'SHORTAGE', 'NOT_CHECKED'].includes(availability.body?.status),
      JSON.stringify({ status: availability.body?.status, total: availability.body?.totalRequirements })
    );

    const before = (await get(`/api/v1/materials/inventory?materialId=${material.id}`)).body[0];
    const consumption = await post('/api/v1/materials/consumption', {
      workOrderId: workOrder.id,
      materialId: material.id,
      actualQuantity: 25,
      idempotencyKey: `verify-consume-${stamp}`,
    });
    check(
      '1 Material',
      'Konsumsi material tercatat terhadap Work Order (BR-M05)',
      consumption.status === 201 && consumption.body?.workOrderId === workOrder.id,
      JSON.stringify(consumption.body?.id)
    );

    const after = (await get(`/api/v1/materials/inventory?materialId=${material.id}`)).body[0];
    check(
      '1 Material',
      'Konsumsi mengurangi inventory',
      Number(after.onHandQuantity) === Number(before.onHandQuantity) - 25,
      `${before.onHandQuantity} → ${after.onHandQuantity}`
    );

    // §38 — an offline terminal replaying its queue must not issue twice.
    const replay = await post('/api/v1/materials/consumption', {
      workOrderId: workOrder.id,
      materialId: material.id,
      actualQuantity: 25,
      idempotencyKey: `verify-consume-${stamp}`,
    });
    const afterReplay = (await get(`/api/v1/materials/inventory?materialId=${material.id}`)).body[0];
    check(
      '1 Material',
      'Idempotency key membuat replay offline menjadi no-op (§38)',
      replay.status === 201 &&
        replay.body?.id === consumption.body?.id &&
        Number(afterReplay.onHandQuantity) === Number(after.onHandQuantity),
      `${after.onHandQuantity} → ${afterReplay.onHandQuantity}`
    );
  }

  // ==================================================================
  // Scenario 2 — Quality
  // ==================================================================
  let ncrId;
  {
    const inspection = await post('/api/v1/quality/inspections', {
      workOrderId: workOrder.id,
      inspectedQuantity: 100,
      failedQuantity: 12,
      notes: 'Verifikasi end-to-end',
    });
    check(
      '2 Quality',
      'Inspeksi tercatat dan hasilnya diturunkan dari kuantitas gagal',
      inspection.status === 201 && inspection.body?.result === 'FAIL',
      JSON.stringify({ result: inspection.body?.result, failed: inspection.body?.failedQuantity })
    );

    const hold = await post('/api/v1/quality/holds', {
      workOrderId: workOrder.id,
      inspectionId: inspection.body.id,
      quantity: 12,
      reason: 'Dimensi di luar toleransi',
      ownerId: 'verify-owner',
      ownerName: 'QA Verifier',
    });
    check(
      '2 Quality',
      'Quality Hold wajib memiliki owner dan alasan (BR-Q04)',
      hold.status === 201 && hold.body?.ownerId === 'verify-owner' && Boolean(hold.body?.reason),
      JSON.stringify(hold.body?.holdNumber)
    );

    const holdWithoutReason = await post('/api/v1/quality/holds', {
      workOrderId: workOrder.id,
      quantity: 1,
      ownerId: 'verify-owner',
      reason: '',
    });
    check(
      '2 Quality',
      'Hold tanpa alasan ditolak',
      holdWithoutReason.status === 422 || holdWithoutReason.status === 400,
      String(holdWithoutReason.status)
    );

    const ncr = await post('/api/v1/quality/ncr', {
      title: 'Dimensi di luar toleransi',
      description: 'Ditemukan pada verifikasi end-to-end.',
      ownerId: 'verify-owner',
      ownerName: 'QA Verifier',
      workOrderId: workOrder.id,
      inspectionId: inspection.body.id,
      quantity: 12,
    });
    ncrId = ncr.body?.id;
    check('2 Quality', 'NCR dibuat dari kegagalan kualitas', ncr.status === 201, JSON.stringify(ncr.body?.ncrNumber));

    const action = await post(`/api/v1/quality/ncr/${ncrId}/actions`, {
      action: 'Kalibrasi ulang mesin dan periksa 3 sampel pertama',
      ownerId: 'verify-owner',
    });
    check('2 Quality', 'Corrective action dapat ditambahkan', action.status === 201);

    const prematureClose = await api(`/api/v1/quality/ncr/${ncrId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'CLOSED' }),
    });
    check(
      '2 Quality',
      'NCR tidak dapat ditutup selama corrective action belum terverifikasi',
      prematureClose.status === 409 || prematureClose.status === 422,
      String(prematureClose.status)
    );

    const disposition = await post('/api/v1/quality/dispositions', {
      decision: 'REWORK',
      quantity: 12,
      reason: 'Dikerjakan ulang setelah kalibrasi',
      qualityHoldId: hold.body.id,
      inspectionId: inspection.body.id,
      workOrderId: workOrder.id,
    });
    check(
      '2 Quality',
      'Disposition menutup hold dan tercatat',
      disposition.status === 201 && disposition.body?.decision === 'REWORK',
      JSON.stringify(disposition.body?.id)
    );

    const closedHold = await rows('SELECT status FROM quality_hold WHERE tenant_id = $1 AND id = $2', [
      TENANT,
      hold.body.id,
    ]);
    check(
      '2 Quality',
      'Hold berpindah ke DISPOSITIONED di PostgreSQL',
      closedHold[0]?.status === 'DISPOSITIONED',
      JSON.stringify(closedHold[0])
    );

    const woAfter = (await get(`/api/v1/work-orders/${workOrder.id}`)).body;
    check(
      '2 Quality',
      'REWORK menambah kuantitas rework pada Work Order (BR-Q05)',
      Number(woAfter?.reworkQuantity ?? 0) >= 12,
      `rework=${woAfter?.reworkQuantity}`
    );
  }

  // ==================================================================
  // Scenario 3 — Maintenance
  // ==================================================================
  {
    const emergency = await post('/api/v1/maintenance/emergency', {
      machineId: machine.id,
      problem: 'Motor spindle berhenti mendadak',
    });
    check(
      '3 Maintenance',
      'Emergency maintenance membuat record dan downtime (BR-MT03)',
      emergency.status === 201 && Boolean(emergency.body?.record?.id) && Boolean(emergency.body?.downtimeId),
      JSON.stringify({ record: emergency.body?.record?.maintenanceNumber, downtime: emergency.body?.downtimeId })
    );

    const machineAfter = (await get('/api/v1/master/machines')).body.find((m) => m.id === machine.id);
    check(
      '3 Maintenance',
      'Mesin menjadi OFFLINE selama perbaikan',
      machineAfter?.currentState === 'OFFLINE',
      String(machineAfter?.currentState)
    );

    const blockedByMaintenance = await post('/api/v1/production-board/dispatch', {
      action: 'REASSIGN_MACHINE',
      workOrderId: workOrder.id,
      machineId: machine.id,
    });
    check(
      '3 Maintenance',
      'Mesin dalam maintenance menolak assignment WO baru (BR-MT04)',
      blockedByMaintenance.status === 409,
      String(blockedByMaintenance.status)
    );

    const noResult = await post(`/api/v1/maintenance/records/${emergency.body.record.id}/complete`, {});
    check(
      '3 Maintenance',
      'Penyelesaian tanpa hasil ditolak (BR-MT05)',
      noResult.status === 422 || noResult.status === 400,
      String(noResult.status)
    );

    const completed = await post(`/api/v1/maintenance/records/${emergency.body.record.id}/complete`, {
      result: 'REPAIRED',
      rootCause: 'Bearing aus',
      actionTaken: 'Ganti bearing',
    });
    check(
      '3 Maintenance',
      'Penyelesaian mencatat durasi dan hasil',
      completed.status === 200 && completed.body?.result === 'REPAIRED' && completed.body?.durationMinutes >= 0,
      JSON.stringify({ result: completed.body?.result, minutes: completed.body?.durationMinutes })
    );

    const downtime = await rows('SELECT status, end_time FROM downtime_record WHERE tenant_id = $1 AND id = $2', [
      TENANT,
      emergency.body.downtimeId,
    ]);
    check(
      '3 Maintenance',
      'Downtime terkait ditutup ketika perbaikan selesai',
      downtime[0]?.status === 'RESOLVED' && Boolean(downtime[0]?.end_time),
      JSON.stringify(downtime[0])
    );

    const machineBack = (await get('/api/v1/master/machines')).body.find((m) => m.id === machine.id);
    check(
      '3 Maintenance',
      'Mesin kembali tersedia setelah perbaikan',
      machineBack?.currentState === 'IDLE',
      String(machineBack?.currentState)
    );

    const kpi = await get('/api/v1/maintenance/kpi');
    check(
      '3 Maintenance',
      'MTBF dan MTTR dihitung dari record',
      kpi.status === 200 && typeof kpi.body?.mtbfHours === 'number' && typeof kpi.body?.mttrHours === 'number',
      JSON.stringify({ mtbf: kpi.body?.mtbfHours, mttr: kpi.body?.mttrHours })
    );
  }

  // ==================================================================
  // Scenario 4 — Workforce
  // ==================================================================
  if (operator) {
    const skill = await post('/api/v1/workforce/skills', {
      code: `VERIFY-${stamp}`,
      name: 'Verifikasi Operasi Mesin',
      maxLevel: 3,
    });
    check('4 Workforce', 'Skill dapat dibuat', skill.status === 201, JSON.stringify(skill.body?.code));

    // The requirement is attached to the machine the work order is *already*
    // on. Moving the work order onto another machine would be refused by the
    // resource-exclusivity constraint whenever that machine is running
    // something (migration 021), which would make this scenario pass only
    // against a virgin database.
    const targetMachineId = workOrder.machineId ?? machine.id;
    const requirement = await post('/api/v1/workforce/requirements', {
      targetType: 'MACHINE',
      targetId: targetMachineId,
      skillId: skill.body.id,
      minimumLevel: 2,
      mandatory: true,
    });
    check(
      '4 Workforce',
      'Mesin dapat mensyaratkan kualifikasi (BR-W05)',
      requirement.status === 201,
      JSON.stringify(requirement.body?.skillCode)
    );

    // Earlier runs leave assignments behind; the counts below are about this
    // run, so the work order starts unstaffed.
    const existing = (await get(`/api/v1/workforce/assignments?workOrderId=${workOrder.id}&active=true`)).body ?? [];
    for (const previous of existing) {
      await api(`/api/v1/workforce/assignments/${previous.id}`, { method: 'DELETE' });
    }

    const unqualified = await post('/api/v1/workforce/assignments', {
      workOrderId: workOrder.id,
      operatorId: operator.id,
    });
    check(
      '4 Workforce',
      'Operator tanpa kualifikasi ditolak (BR-W01)',
      unqualified.status === 409,
      JSON.stringify(unqualified.body?.error?.message ?? unqualified.status)
    );

    // An expired certificate is not a qualification (BR-W02).
    await post('/api/v1/workforce/qualifications', {
      operatorId: operator.id,
      skillId: skill.body.id,
      level: 3,
      expiryDate: '2020-01-01',
    });
    const expired = await post('/api/v1/workforce/assignments', {
      workOrderId: workOrder.id,
      operatorId: operator.id,
    });
    check(
      '4 Workforce',
      'Kualifikasi kedaluwarsa dianggap tidak berlaku (BR-W02)',
      expired.status === 409,
      String(expired.status)
    );

    await post('/api/v1/workforce/qualifications', {
      operatorId: operator.id,
      skillId: skill.body.id,
      level: 3,
      expiryDate: '2099-12-31',
    });
    const qualifications = await get(`/api/v1/workforce/qualifications?operatorId=${operator.id}`);
    check(
      '4 Workforce',
      'Kualifikasi berlaku berstatus ACTIVE',
      (qualifications.body ?? []).some((q) => q.skillId === skill.body.id && q.status === 'ACTIVE'),
      JSON.stringify((qualifications.body ?? []).map((q) => `${q.skillCode}:${q.status}`))
    );

    await post('/api/v1/workforce/availability', { operatorId: operator.id, state: 'SICK' });
    const unavailable = await post('/api/v1/workforce/assignments', {
      workOrderId: workOrder.id,
      operatorId: operator.id,
    });
    check(
      '4 Workforce',
      'Operator tidak tersedia tidak dapat ditugaskan (BR-W03)',
      unavailable.status === 409,
      String(unavailable.status)
    );

    await post('/api/v1/workforce/availability', { operatorId: operator.id, state: 'AVAILABLE' });
    const assignment = await post('/api/v1/workforce/assignments', {
      workOrderId: workOrder.id,
      operatorId: operator.id,
    });
    check(
      '4 Workforce',
      'Operator qualified dan available dapat ditugaskan',
      assignment.status === 201 && assignment.body?.qualificationCheck?.qualified === true,
      JSON.stringify(assignment.body?.qualificationCheck)
    );

    await api(`/api/v1/workforce/labor-requirements/${workOrder.id}`, {
      method: 'PUT',
      body: JSON.stringify({ requiredOperators: 2 }),
    });
    const labor = await get(`/api/v1/workforce/labor-requirements/${workOrder.id}`);
    check(
      '4 Workforce',
      'Required vs available operator dibandingkan (§6.6)',
      labor.status === 200 &&
        labor.body?.requiredOperators === 2 &&
        labor.body?.assignedOperators === 1 &&
        labor.body?.status === 'SHORTAGE',
      JSON.stringify({ required: labor.body?.requiredOperators, assigned: labor.body?.assignedOperators, status: labor.body?.status })
    );
  } else {
    check('4 Workforce', 'Dataset demo menyediakan operator', false, 'tidak ada operator');
  }

  // ==================================================================
  // Scenario 5 — WIP and handoff
  // ==================================================================
  {
    const wip = await post('/api/v1/wip/records', {
      workOrderId: workOrder.id,
      quantity: 500,
    });
    check('5 WIP', 'WIP dapat dibuat dari output proses', wip.status === 201, JSON.stringify(wip.body?.wipNumber));
    check(
      '5 WIP',
      'WIP aging dihitung saat dibaca (§7.4)',
      typeof wip.body?.ageHours === 'number' && Boolean(wip.body?.agingStatus),
      JSON.stringify({ age: wip.body?.ageHours, status: wip.body?.agingStatus })
    );

    const held = await post(`/api/v1/wip/records/${wip.body.id}/hold`, { reason: 'Menunggu keputusan mutu' });
    const blockedTransfer = await post('/api/v1/wip/transfers', { wipId: wip.body.id, quantity: 100 });
    check(
      '5 WIP',
      'WIP ON_HOLD tidak dapat ditransfer (BR-WIP05)',
      held.status === 200 && blockedTransfer.status === 409,
      String(blockedTransfer.status)
    );

    await post(`/api/v1/wip/records/${wip.body.id}/release`, { reason: 'Lolos verifikasi' });

    const transfer = await post('/api/v1/wip/transfers', {
      wipId: wip.body.id,
      quantity: 500,
      destinationWorkOrderId: workOrder.id,
    });
    check(
      '5 WIP',
      'Transfer dicatat sebagai transaksi tersendiri (BR-H01)',
      transfer.status === 201 && transfer.body?.status === 'IN_TRANSIT',
      JSON.stringify(transfer.body?.transferNumber)
    );

    const missingReason = await post(`/api/v1/wip/transfers/${transfer.body.id}/receive`, {
      receivedQuantity: 450,
    });
    check(
      '5 WIP',
      'Selisih penerimaan tanpa alasan ditolak (BR-WIP04)',
      missingReason.status === 422 || missingReason.status === 400,
      String(missingReason.status)
    );

    const receipt = await post(`/api/v1/wip/transfers/${transfer.body.id}/receive`, {
      receivedQuantity: 450,
      varianceReason: 'Rusak dalam perjalanan',
    });
    check(
      '5 WIP',
      'Dikirim dan diterima dicatat terpisah (BR-H03)',
      receipt.status === 201 &&
        receipt.body?.receipt?.transferredQuantity === 500 &&
        receipt.body?.receipt?.receivedQuantity === 450 &&
        receipt.body?.receipt?.varianceQuantity === 50 &&
        receipt.body?.receipt?.result === 'PARTIAL',
      JSON.stringify(receipt.body?.receipt)
    );

    const persistedReceipt = await rows(
      'SELECT variance_quantity, variance_reason, result FROM wip_receipt WHERE tenant_id = $1 AND wip_transfer_id = $2',
      [TENANT, transfer.body.id]
    );
    check(
      '5 WIP',
      'Penerimaan beserta alasan selisih tersimpan di PostgreSQL',
      persistedReceipt[0]?.variance_reason === 'Rusak dalam perjalanan',
      JSON.stringify(persistedReceipt[0])
    );

    const dashboard = await get('/api/v1/wip/dashboard');
    check(
      '5 WIP',
      'WIP dashboard melaporkan total, per proses, dan aging (§7.5)',
      dashboard.status === 200 &&
        typeof dashboard.body?.totalWip === 'number' &&
        Array.isArray(dashboard.body?.byProcess) &&
        typeof dashboard.body?.aging?.normal === 'number',
      JSON.stringify({ total: dashboard.body?.totalWip, aging: dashboard.body?.aging })
    );
  }

  // ==================================================================
  // Scenario 6 — Production Board
  // ==================================================================
  {
    const board = await get('/api/v1/production-board?viewMode=MACHINE&days=7');
    check(
      '6 Board',
      'Board menampilkan lane dan jadwal aktual',
      board.status === 200 && Array.isArray(board.body?.lanes) && board.body.lanes.length > 0,
      `${board.body?.lanes?.length} lane`
    );

    const items = (board.body?.lanes ?? []).flatMap((lane) => lane.items);
    check(
      '6 Board',
      'Setiap item membawa status visual dan daftar konflik (§9.4, §9.5)',
      items.length === 0 || items.every((item) => Boolean(item.status) && Array.isArray(item.conflicts)),
      JSON.stringify(items.slice(0, 2).map((item) => ({ label: item.label, status: item.status })))
    );

    const start = new Date(Date.now() + 6 * 86_400_000);
    const end = new Date(start.getTime() + 4 * 3_600_000);
    const reschedule = await post('/api/v1/production-board/dispatch', {
      action: 'RESCHEDULE',
      workOrderId: workOrder.id,
      plannedStart: start.toISOString(),
      plannedEnd: end.toISOString(),
      reason: 'Verifikasi end-to-end',
    });
    check(
      '6 Board',
      'Authorized user dapat menjadwalkan ulang (US-PB002)',
      reschedule.status === 200,
      JSON.stringify(reschedule.body?.plannedStart)
    );

    const audited = await rows(
      `SELECT action FROM audit_log WHERE tenant_id = $1 AND entity_id = $2 AND action LIKE 'BOARD_%'
        ORDER BY occurred_at DESC LIMIT 1`,
      [TENANT, workOrder.id]
    );
    check(
      '6 Board',
      'Semua perubahan dispatch diaudit (§9.6)',
      audited[0]?.action === 'BOARD_RESCHEDULE',
      JSON.stringify(audited[0])
    );

    const invalid = await post('/api/v1/production-board/dispatch', {
      action: 'RESCHEDULE',
      workOrderId: workOrder.id,
      plannedStart: end.toISOString(),
      plannedEnd: start.toISOString(),
    });
    check(
      '6 Board',
      'Jadwal terbalik ditolak',
      invalid.status === 422 || invalid.status === 400,
      String(invalid.status)
    );
  }

  // ==================================================================
  // Scenario 7 — Event History
  // ==================================================================
  {
    /*
     * Wait for the timeline to contain what the earlier scenarios caused.
     *
     * Events are written with `recordDetached`, which is deliberate: a failed
     * timeline write must never fail the production record that caused it. The
     * consequence is that the write is in flight when the call that triggered
     * it has already returned, so reading the timeline immediately is a race —
     * and asserting a detached write synchronously is a flaky test, not a
     * strict one. It failed exactly this way on a second consecutive run.
     *
     * Bounded polling keeps the assertion honest: the event still has to
     * arrive, and within a few seconds, or the check fails as it should.
     */
    const expectedTypes = [
      'MATERIAL_CONSUMED',
      'QUALITY_INSPECTION',
      'QUALITY_HOLD',
      'REWORK_STARTED',
      'WIP_CREATED',
      'WIP_TRANSFERRED',
      'WIP_RECEIVED',
      'OPERATOR_ASSIGNED',
      'SCHEDULE_CHANGED',
    ];

    let timeline = { status: 0, body: [] };
    let events = [];
    let types = new Set();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      timeline = await get(`/api/v1/events/timeline/WORK_ORDER/${workOrder.id}`);
      events = timeline.body ?? [];
      types = new Set(events.map((event) => event.eventType));
      if (expectedTypes.every((type) => types.has(type))) break;
      await sleep(250);
    }

    check(
      '7 Events',
      'Timeline Work Order dapat dibuka dan terurut kronologis (US-E001)',
      timeline.status === 200 &&
        events.length > 0 &&
        events.every(
          (event, index) =>
            index === 0 || new Date(events[index - 1].occurredAt) <= new Date(event.occurredAt)
        ),
      `${events.length} event`
    );

    for (const expected of expectedTypes) {
      check('7 Events', `Event ${expected} tercatat`, types.has(expected), [...types].join(', '));
    }

    check(
      '7 Events',
      'Setiap event memiliki timestamp dan actor (BR-E03)',
      events.every((event) => Boolean(event.occurredAt) && Boolean(event.actorType)),
      ''
    );

    const machineTimeline = await get(`/api/v1/events/timeline/MACHINE/${machine.id}`);
    check(
      '7 Events',
      'Timeline mesin memuat event maintenance',
      (machineTimeline.body ?? []).some((event) => event.eventType.startsWith('MAINTENANCE_')),
      `${(machineTimeline.body ?? []).length} event`
    );

    // BR-E01/BR-E02 — the application role may append and read, nothing else.
    const privileges = await rows(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE table_name = 'operational_event' AND grantee = 'factory_app'`
    );
    const granted = privileges.map((row) => row.privilege_type).sort();
    check(
      '7 Events',
      'Event History bersifat append-only pada tingkat privilege (BR-E01, BR-E02)',
      granted.includes('SELECT') &&
        granted.includes('INSERT') &&
        !granted.includes('UPDATE') &&
        !granted.includes('DELETE'),
      granted.join(', ')
    );
  }

  // ==================================================================
  // Scenario 8 — Offline sync (§38)
  // ==================================================================
  {
    const key = `verify-offline-${stamp}`;
    const batch = await post('/api/v1/shop-floor/sync-batch', {
      commands: [
        {
          type: 'RECORD_CONSUMPTION',
          clientEventId: key,
          workOrderId: workOrder.id,
          occurredAt: new Date().toISOString(),
          payload: { materialId: material.id, actualQuantity: 10 },
        },
        {
          type: 'RECORD_INSPECTION',
          clientEventId: `${key}-insp`,
          workOrderId: workOrder.id,
          occurredAt: new Date().toISOString(),
          payload: { inspectedQuantity: 20, failedQuantity: 0 },
        },
        {
          type: 'RECORD_WIP',
          clientEventId: `${key}-wip`,
          workOrderId: workOrder.id,
          occurredAt: new Date().toISOString(),
          payload: { quantity: 20 },
        },
      ],
    });
    check(
      '8 Offline',
      'Antrean offline menerima konsumsi, inspeksi, dan WIP (§38)',
      batch.status === 200 && batch.body?.applied === 3,
      JSON.stringify(batch.body)
    );

    // The same queue replayed after a reconnect must not double anything.
    const replay = await post('/api/v1/shop-floor/sync-batch', {
      commands: [
        {
          type: 'RECORD_CONSUMPTION',
          clientEventId: key,
          workOrderId: workOrder.id,
          occurredAt: new Date().toISOString(),
          payload: { materialId: material.id, actualQuantity: 10 },
        },
      ],
    });
    check(
      '8 Offline',
      'Replay antrean menjadi duplikat, bukan pencatatan kedua',
      replay.status === 200 && replay.body?.duplicates === 1 && replay.body?.applied === 0,
      JSON.stringify(replay.body)
    );

    const consumed = await rows(
      'SELECT count(*)::int AS n FROM material_consumption WHERE tenant_id = $1 AND idempotency_key = $2',
      [TENANT, key]
    );
    check(
      '8 Offline',
      'Hanya satu baris konsumsi tersimpan untuk satu idempotency key',
      consumed[0]?.n === 1,
      JSON.stringify(consumed[0])
    );

    const unknown = await post('/api/v1/shop-floor/sync-batch', {
      commands: [
        {
          type: 'RECORD_NONSENSE',
          clientEventId: `${key}-bad`,
          workOrderId: workOrder.id,
          occurredAt: new Date().toISOString(),
          payload: {},
        },
      ],
    });
    check(
      '8 Offline',
      'Perintah tidak dikenal gagal dan tercatat sebagai sync exception',
      unknown.status === 200 && unknown.body?.failed === 1,
      JSON.stringify(unknown.body)
    );
  }

  // ==================================================================
  // Scenario 9 — Self-serve trial registration (public, no session)
  // ==================================================================
  //
  // The one endpoint a stranger reaches without an account. It shipped twice
  // in a state where a valid form could not succeed against a real database
  // — a subscription on a plan no migration created, then a user written with
  // an accountType the login path does not recognise — and nothing here
  // noticed, because every other scenario starts from a session. This one
  // starts from nothing and follows the token the way the console does.
  {
    const email = `verify-trial-${stamp}@example.invalid`;
    const factoryName = `PT Verifikasi Trial ${stamp}`;
    const res = await fetch(`${BASE}/api/v1/auth/trial-register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Verifikasi Trial',
        email,
        password: 'RahasiaKuat2026',
        factoryName,
        industry: 'general',
        plantScale: '1-3 Lini Produksi',
      }),
    });
    const body = await res.json().catch(() => undefined);
    check(
      '9 Trial',
      'Formulir yang valid menghasilkan 201 dan token sesi',
      res.status === 201 && typeof body?.token === 'string' && body.token.length > 0,
      `${res.status} ${JSON.stringify(body).slice(0, 200)}`
    );

    const trialTenant = body?.tenantId;
    const account = trialTenant
      ? await rows(
          `SELECT c.lifecycle_status, c.notes, s.plan_id, s.status AS sub_status, u.account_type, u.role
             FROM client_account c
             JOIN client_subscription s ON s.client_id = c.id
             JOIN app_user u ON u.tenant_id = c.tenant_id
            WHERE c.tenant_id = $1`,
          [trialTenant]
        )
      : [];
    check(
      '9 Trial',
      'Tenant, akun TRIAL, langganan plan-trial dan admin tersimpan',
      account.length === 1 &&
        account[0].lifecycle_status === 'TRIAL' &&
        account[0].plan_id === 'plan-trial' &&
        account[0].sub_status === 'ACTIVE' &&
        account[0].role === 'ADMIN',
      JSON.stringify(account)
    );
    check(
      '9 Trial',
      'Skala pabrik dari formulir tersimpan di catatan akun',
      account[0]?.notes?.includes('1-3 Lini Produksi') === true,
      JSON.stringify(account[0]?.notes)
    );

    // The console's first two calls with the token it was handed.
    const session = body?.token
      ? await fetch(`${BASE}/api/v1/auth/session`, { headers: { Authorization: `Bearer ${body.token}` } })
      : { status: 0 };
    check('9 Trial', 'Token dari pendaftaran diterima sebagai sesi', session.status === 200, `HTTP ${session.status}`);

    const relogin = body?.token
      ? await fetch(`${BASE}/api/v1/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': trialTenant },
          body: JSON.stringify({ email, password: 'RahasiaKuat2026' }),
        })
      : { status: 0 };
    check(
      '9 Trial',
      'Admin trial dapat login ulang dengan email dan sandi yang didaftarkan',
      relogin.status === 200,
      `HTTP ${relogin.status} ${(await relogin.text?.())?.slice(0, 120) ?? ''}`
    );

    const legacy = await fetch(`${BASE}/api/v1/auth/trial-register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Verifikasi Trial',
        email: `verify-trial-legacy-${stamp}@example.invalid`,
        password: 'RahasiaKuat2026',
        companyName: factoryName,
        industry: 'general',
      }),
    });
    const legacyBody = await legacy.json().catch(() => undefined);
    check(
      '9 Trial',
      'Bentuk lama (companyName) ditolak 422 dengan nama field yang hilang',
      legacy.status === 422 && legacyBody?.error?.fields?.some((f) => f.field === 'factoryName'),
      `${legacy.status} ${JSON.stringify(legacyBody).slice(0, 200)}`
    );
  }

  // ==================================================================
  // Scenario 10 — A planning job actually runs
  // ==================================================================
  //
  // The queue tables carry forced row-level security, and the runner claims
  // without a tenant. Until 034 the tenant policy alone hid every PENDING
  // row from it, and nothing said so: no error, no log line, "Menghitung…"
  // forever. Production sat with jobs pending for twelve days. This enqueues
  // a forecast and insists the job reaches SUCCEEDED — the API's own runner
  // is on in this harness — then reads the row back as the owner.
  {
    const periodStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1))
      .toISOString()
      .slice(0, 10);
    const periodEnd = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 2, 0))
      .toISOString()
      .slice(0, 10);
    const enqueued = await post('/api/v1/demand-forecasts/generate', { periodStart, periodEnd, lookbackMonths: 3 });
    check(
      '10 Job',
      'Forecast dapat diantrekan sebagai job',
      enqueued.status === 202 || enqueued.status === 200,
      `${enqueued.status} ${JSON.stringify(enqueued.body).slice(0, 160)}`
    );

    const jobId = enqueued.body?.jobId;
    let last = null;
    for (let i = 0; i < 40 && jobId; i += 1) {
      const res = await get(`/api/v1/demand-forecasts/jobs/${jobId}`);
      last = res.body;
      if (last?.status === 'SUCCEEDED' || last?.status === 'FAILED') break;
      await sleep(500);
    }
    check(
      '10 Job',
      'Runner mengklaim job dan menyelesaikannya (bukan PENDING selamanya)',
      last?.status === 'SUCCEEDED',
      `status akhir: ${last?.status ?? 'tidak terbaca'} ${last?.lastError ?? ''}`
    );

    const row = jobId
      ? await rows('SELECT status, attempts, started_at IS NOT NULL AS started FROM planning_job WHERE id = $1', [jobId])
      : [];
    check(
      '10 Job',
      'Baris job di PostgreSQL berstatus SUCCEEDED dengan satu percobaan',
      row[0]?.status === 'SUCCEEDED' && row[0]?.attempts === 1 && row[0]?.started === true,
      JSON.stringify(row[0])
    );
  }

  // ==================================================================
  // Report
  // ==================================================================
  await stopApi();
  await owner.end();

  const byScenario = new Map();
  for (const row of results) {
    if (!byScenario.has(row.scenario)) byScenario.set(row.scenario, []);
    byScenario.get(row.scenario).push(row);
  }

  console.log('\nMES Improvement — End-to-End Definition of Done (Improvement PRD §50)\n');
  for (const [scenario, checks] of byScenario) {
    const failed = checks.filter((row) => !row.passed).length;
    console.log(`${failed === 0 ? '✓' : '✗'} Scenario ${scenario} (${checks.length - failed}/${checks.length})`);
    for (const row of checks) {
      console.log(`    ${row.passed ? '✓' : '✗'} ${row.criterion}${row.passed ? '' : `\n        ${row.detail}`}`);
    }
  }

  const failures = results.filter((row) => !row.passed);
  console.log(`\n${results.length - failures.length}/${results.length} kriteria terpenuhi.`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await stopApi().catch(() => undefined);
  await owner.end().catch(() => undefined);
  process.exit(1);
});
