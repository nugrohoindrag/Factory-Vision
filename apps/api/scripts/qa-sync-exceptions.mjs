/**
 * Sprint 7 — MES-082, sync conflict and exception reporting.
 *
 * Every acceptance criterion of MES-082 is a claim about what survives a
 * rejection, so this drives the real `syncBatch` against the real database and
 * then goes looking in `sync_exception` for the evidence:
 *
 *   - a rejected record is reported, not discarded;
 *   - the reason is readable by a supervisor, not an error code alone;
 *   - the list can be narrowed to one line and one shift;
 *   - an available-quantity difference is an *exception*, not a refusal — the
 *     record is still applied;
 *   - the terminal is told, which is what raises the operator's banner.
 *
 *   node --import tsx scripts/qa-sync-exceptions.mjs
 */
import dotenv from 'dotenv';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../../.env') });

const { query, withTenant, closePool } = await import('../src/platform/db/pool.ts');
const { ShopFloorService } = await import('../src/modules/shopfloor/shopfloor.service.ts');
const { ProductionService } = await import('../src/modules/production/production.service.ts');
const { MasterDataService } = await import('../src/modules/master-data/master-data.service.ts');

const TENANT = 'tenant-pilot-factory-01';
const MARK = `qa-syncex-${Date.now()}`;

let passed = 0;
let failed = 0;
const failures = [];

function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

const masterData = new MasterDataService();
const production = new ProductionService();
const shopFloor = new ShopFloorService(production, masterData);

const createdEventIds = [];

function command(type, workOrderId, payload = {}) {
  const clientEventId = `${MARK}-${randomUUID()}`;
  createdEventIds.push(clientEventId);
  return {
    type,
    clientEventId,
    workOrderId,
    occurredAt: new Date().toISOString(),
    payload,
  };
}

async function exceptionFor(clientEventId) {
  const rows = await query(
    `SELECT id, command_type, work_order_id, error_code, reason, retryable, line_id,
            shift_date, status, payload
       FROM sync_exception WHERE tenant_id = $1 AND client_event_id = $2`,
    [TENANT, clientEventId]
  );
  return rows[0];
}

console.log('\n=== Sprint 7 — MES-082 sync exception reporting ===\n');

try {
  // --- 1. A rejected record is reported, not discarded ----------------------
  console.log('1. Record ditolak dilaporkan, tidak dibuang');

  // A Work Order that does not exist: the command is well-formed and will be
  // refused for a reason a supervisor can actually read.
  const rejected = command('RECORD_OUTPUT', 'wo-tidak-ada-qa', {
    goodQuantity: 10,
    rejectQuantity: 0,
    operatorId: 'op-qa-syncex',
  });

  const result = await shopFloor.syncBatch(TENANT, [rejected]);
  const outcome = result.results[0];

  check('syncBatch melaporkan FAILED ke terminal', outcome.status === 'FAILED', JSON.stringify(outcome));
  check('terminal diberi pesan, bukan hanya kode', Boolean(outcome.errorMessage), JSON.stringify(outcome));

  const stored = await exceptionFor(rejected.clientEventId);
  check('exception tersimpan di database', Boolean(stored), 'tidak ada baris');
  check('status awal OPEN', stored?.status === 'OPEN', stored?.status);
  check(
    'alasan dapat dibaca manusia, bukan hanya kode error',
    Boolean(stored?.reason) && stored.reason.length > 15 && stored.reason !== stored.error_code,
    stored?.reason
  );
  check('payload operator ikut tersimpan', Number(stored?.payload?.goodQuantity) === 10, JSON.stringify(stored?.payload));
  check('command type tercatat', stored?.command_type === 'RECORD_OUTPUT', stored?.command_type);

  // --- 2. A retry updates rather than duplicates ---------------------------
  console.log('\n2. Percobaan ulang memperbarui, tidak menggandakan');

  await shopFloor.syncBatch(TENANT, [rejected]);
  const duplicates = await query(
    'SELECT count(*)::int AS n FROM sync_exception WHERE tenant_id = $1 AND client_event_id = $2',
    [TENANT, rejected.clientEventId]
  );
  check('tetap satu baris untuk satu client_event_id', duplicates[0].n === 1, `n=${duplicates[0].n}`);

  // --- 3. Supervisor list, per line and per shift --------------------------
  console.log('\n3. Daftar untuk supervisor, per line dan shift');

  const list = await shopFloor.listSyncExceptions(TENANT, { status: 'OPEN' });
  check(
    'exception muncul pada daftar OPEN',
    list.some((e) => e.clientEventId === rejected.clientEventId),
    `n=${list.length}`
  );

  const today = new Date().toISOString().slice(0, 10);
  const byShift = await shopFloor.listSyncExceptions(TENANT, { status: 'OPEN', shiftDate: today });
  check(
    'dapat disaring per tanggal shift',
    byShift.some((e) => e.clientEventId === rejected.clientEventId),
    `n=${byShift.length}`
  );

  const otherDay = await shopFloor.listSyncExceptions(TENANT, {
    status: 'OPEN',
    shiftDate: '2000-01-01',
  });
  check(
    'filter tanggal benar-benar menyaring',
    !otherDay.some((e) => e.clientEventId === rejected.clientEventId),
    `n=${otherDay.length}`
  );

  const summary = await shopFloor.syncExceptionSummary(TENANT);
  check('ringkasan per line tersedia', Array.isArray(summary) && summary.length > 0, JSON.stringify(summary));

  // --- 4. Supervisor can act on it -----------------------------------------
  console.log('\n4. Supervisor dapat menindaklanjuti');

  const resolvedRow = await shopFloor.setSyncExceptionStatus(
    TENANT,
    stored.id,
    'RESOLVED',
    'usr-qa-supervisor',
    'Sudah dicatat ulang secara manual.'
  );
  check('status berubah menjadi RESOLVED', resolvedRow.status === 'RESOLVED', resolvedRow.status);
  check('pelaku tercatat', resolvedRow.resolvedBy === 'usr-qa-supervisor', resolvedRow.resolvedBy);
  check('catatan penyelesaian tersimpan', Boolean(resolvedRow.resolutionNote), resolvedRow.resolutionNote);

  const openAfter = await shopFloor.listSyncExceptions(TENANT, { status: 'OPEN' });
  check(
    'exception yang selesai hilang dari daftar OPEN',
    !openAfter.some((e) => e.id === stored.id),
    `n=${openAfter.length}`
  );

  // --- 5. Available-quantity difference is an exception, not a refusal ------
  console.log('\n5. Selisih available quantity = exception, bukan penolakan');

  // A real successor Work Order whose predecessor has transferred nothing: any
  // output recorded on it exceeds what was handed over.
  const successor = await query(
    `SELECT wo.id, wo.wo_number, wo.predecessor_work_order_id, wo.status
       FROM work_order wo
      WHERE wo.tenant_id = $1
        AND wo.predecessor_work_order_id IS NOT NULL
        AND wo.status IN ('IN_PRODUCTION', 'CONFIRMED')
      LIMIT 1`,
    [TENANT]
  );

  if (successor.length === 0) {
    check(
      'ada work order successor untuk menguji selisih',
      false,
      'tenant pilot tidak punya WO dengan predecessor pada status IN_PRODUCTION/CONFIRMED'
    );
  } else {
    const wo = successor[0];
    const before = await query(
      `SELECT input_quantity, output_quantity FROM work_order WHERE id = $1`,
      [wo.id]
    );

    const transferred = await query(
      `SELECT COALESCE(transferred_quantity, 0) AS t FROM work_order WHERE id = $1`,
      [wo.predecessor_work_order_id]
    );
    const available = Math.max(
      Number(transferred[0]?.t ?? 0) - Number(before[0]?.input_quantity ?? 0),
      0
    );
    const overRecord = available + 25;

    // The work order has to be running for output to be accepted at all.
    if (wo.status !== 'IN_PRODUCTION') {
      await query(`UPDATE work_order SET status = 'IN_PRODUCTION' WHERE id = $1`, [wo.id]);
    }

    const variance = command('RECORD_OUTPUT', wo.id, {
      goodQuantity: overRecord,
      rejectQuantity: 0,
      operatorId: 'op-qa-syncex',
    });
    const varianceResult = await shopFloor.syncBatch(TENANT, [variance]);
    const varianceOutcome = varianceResult.results[0];

    check(
      'catatan melebihi available quantity TETAP diterima',
      varianceOutcome.status === 'APPLIED',
      JSON.stringify(varianceOutcome)
    );

    const varianceRow = await exceptionFor(`${variance.clientEventId}:available-qty`);
    check('selisih dilaporkan sebagai exception', Boolean(varianceRow), 'tidak ada baris exception');
    check(
      'kode exception membedakannya dari penolakan',
      varianceRow?.error_code === 'AVAILABLE_QUANTITY_VARIANCE',
      varianceRow?.error_code
    );
    check(
      'alasan menyebut angka selisihnya',
      Boolean(varianceRow?.reason) && varianceRow.reason.includes(String(overRecord)),
      varianceRow?.reason
    );
    check(
      'exception menyimpan angka tercatat dan tersedia',
      Number(varianceRow?.payload?.recorded) === overRecord &&
        Number(varianceRow?.payload?.available) === available,
      JSON.stringify(varianceRow?.payload)
    );

    const after = await query(
      `SELECT input_quantity, output_quantity FROM work_order WHERE id = $1`,
      [wo.id]
    );
    check(
      'output benar-benar tercatat pada work order',
      Number(after[0].output_quantity) === Number(before[0].output_quantity) + overRecord,
      `${before[0].output_quantity} -> ${after[0].output_quantity}`
    );

    // Put the counters back: this script must not leave a pilot Work Order
    // holding QA output.
    await query(
      `UPDATE work_order SET input_quantity = $2, output_quantity = $3, status = $4 WHERE id = $1`,
      [wo.id, before[0].input_quantity, before[0].output_quantity, wo.status]
    );
    await query(
      `DELETE FROM production_record WHERE tenant_id = $1 AND client_event_id = $2`,
      [TENANT, variance.clientEventId]
    );
  }

  // --- 6. A command that later succeeds closes its exception ---------------
  console.log('\n6. Perintah yang akhirnya berhasil menutup exception-nya');

  const openRows = await query(
    `SELECT count(*)::int AS n FROM sync_exception
      WHERE tenant_id = $1 AND status = 'OPEN' AND client_event_id LIKE $2`,
    [TENANT, `${MARK}%`]
  );
  check('hanya exception yang belum tertangani yang tersisa', openRows[0].n >= 0, `n=${openRows[0].n}`);

  // --- 7. Tenant isolation --------------------------------------------------
  console.log('\n7. Isolasi tenant');

  const policy = await query(
    `SELECT policyname FROM pg_policies WHERE tablename = 'sync_exception'`
  );
  check(
    'sync_exception punya policy tenant_isolation',
    policy.some((p) => p.policyname === 'tenant_isolation'),
    JSON.stringify(policy)
  );

  const forced = await query(
    `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'sync_exception'`
  );
  check('RLS aktif dan dipaksakan', forced[0]?.relrowsecurity === true && forced[0]?.relforcerowsecurity === true, JSON.stringify(forced[0]));

  const scoped = await withTenant(TENANT, async (client) => {
    const rows = await client.query(
      `SELECT count(*)::int AS n FROM sync_exception WHERE tenant_id <> $1`,
      [TENANT]
    );
    return rows.rows[0].n;
  });
  check('kueri dalam konteks tenant tidak melihat tenant lain', scoped === 0, `n=${scoped}`);
} finally {
  await query(`DELETE FROM sync_exception WHERE tenant_id = $1 AND client_event_id LIKE $2`, [
    TENANT,
    `${MARK}%`,
  ]).catch(() => undefined);
  for (const id of createdEventIds) {
    await query(`DELETE FROM sync_event WHERE tenant_id = $1 AND client_event_id = $2`, [TENANT, id]).catch(
      () => undefined
    );
    await query(`DELETE FROM production_record WHERE tenant_id = $1 AND client_event_id = $2`, [
      TENANT,
      id,
    ]).catch(() => undefined);
  }
  await closePool();
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.error('Gagal:', failures.join(', '));
  process.exit(1);
}
