/**
 * Sprint 7 — the outbox is actually drained.
 *
 * Planning has written `outbox_event` rows since Sprint 3 and nothing ever read
 * them, so "published via the outbox" was half a pattern: durable, and unheard.
 * This proves the other half — that a confirmed plan reaches a subscriber, that
 * a subscriber which throws does not lose the event, and that a permanently
 * broken event stops retrying instead of spinning.
 *
 *   node --import tsx scripts/qa-outbox-relay.mjs
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../../.env') });

const { query, closePool } = await import('../src/platform/db/pool.ts');
const { OutboxRelay } = await import('../src/platform/outbox/outbox.relay.ts');

const TENANT = 'tenant-pilot-factory-01';
const MARK = `qa-outbox-${Date.now()}`;

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

async function seed(id, eventType, payload = {}) {
  await query(
    `INSERT INTO outbox_event (id, tenant_id, event_type, aggregate_type, aggregate_id, payload)
     VALUES ($1, $2, $3, 'production_plan', $4, $5::jsonb)`,
    [id, TENANT, eventType, MARK, JSON.stringify(payload)]
  );
  return id;
}

async function row(id) {
  const rows = await query(
    'SELECT status, attempts, last_error, published_at FROM outbox_event WHERE id = $1',
    [id]
  );
  return rows[0];
}

console.log('\n=== Sprint 7 — outbox relay ===\n');

try {
  // --- 1. Delivery ----------------------------------------------------------
  console.log('1. Event pending sampai ke subscriber');

  const delivered = await seed(`${MARK}-a`, 'ProductionPlanConfirmed', {
    planNumber: 'PP-QA-001',
    plannedQuantityTotal: 120,
  });

  const seen = [];
  const relay = new OutboxRelay();
  relay.subscribe((event) => {
    if (event.aggregateId === MARK) seen.push(event);
  });

  const first = await relay.relayTenant(TENANT);

  const deliveredEvent = seen.find((e) => e.id === delivered);
  check('subscriber menerima event', Boolean(deliveredEvent), `seen=${seen.length}`);
  check(
    'payload sampai utuh, bukan hanya id',
    deliveredEvent && deliveredEvent.payload.planNumber === 'PP-QA-001',
    deliveredEvent ? JSON.stringify(deliveredEvent.payload) : ''
  );
  check(
    'event type dan aggregate ikut serta',
    deliveredEvent &&
      deliveredEvent.eventType === 'ProductionPlanConfirmed' &&
      deliveredEvent.aggregateType === 'production_plan',
    deliveredEvent ? `${deliveredEvent.eventType}/${deliveredEvent.aggregateType}` : ''
  );
  check('relay melaporkan jumlah terkirim', first.delivered >= 1, JSON.stringify(first));

  const afterDelivery = await row(delivered);
  check('baris ditandai PUBLISHED', afterDelivery.status === 'PUBLISHED', afterDelivery.status);
  check('published_at terisi', Boolean(afterDelivery.published_at), String(afterDelivery.published_at));

  // --- 2. No redelivery -----------------------------------------------------
  console.log('\n2. Event yang sudah terbit tidak dikirim ulang');

  const before = seen.length;
  await relay.relayTenant(TENANT);
  check('polling kedua tidak mengulang event yang sama', seen.length === before, `${before} -> ${seen.length}`);

  // --- 3. A failing subscriber does not lose the event ---------------------
  console.log('\n3. Subscriber gagal tidak menghilangkan event');

  const poison = await seed(`${MARK}-b`, 'WorkOrdersGenerated', { planNumber: 'PP-QA-002' });

  let attemptCount = 0;
  const failingRelay = new OutboxRelay();
  failingRelay.subscribe((event) => {
    if (event.id !== poison) return;
    attemptCount += 1;
    throw new Error('subscriber sengaja gagal');
  });

  const failedPass = await failingRelay.relayTenant(TENANT);
  check('relay melaporkan kegagalan', failedPass.failed === 1, JSON.stringify(failedPass));

  const afterFailure = await row(poison);
  check('event tidak hilang', Boolean(afterFailure), 'baris hilang');
  check('event kembali PENDING untuk dicoba lagi', afterFailure.status === 'PENDING', afterFailure.status);
  check('attempts bertambah', Number(afterFailure.attempts) === 1, `attempts=${afterFailure.attempts}`);
  check(
    'alasan gagal tersimpan, bukan dibuang',
    String(afterFailure.last_error || '').includes('sengaja gagal'),
    afterFailure.last_error
  );

  // --- 4. A permanently broken event stops retrying ------------------------
  console.log('\n4. Event yang rusak permanen berhenti mencoba');

  for (let i = 0; i < 5; i += 1) {
    await failingRelay.relayTenant(TENANT);
  }
  const exhausted = await row(poison);
  check('status akhir FAILED', exhausted.status === 'FAILED', exhausted.status);
  check('berhenti pada batas percobaan', Number(exhausted.attempts) === 5, `attempts=${exhausted.attempts}`);

  const attemptsBeforeIdle = attemptCount;
  await failingRelay.relayTenant(TENANT);
  check(
    'tidak dipungut lagi setelah FAILED',
    attemptCount === attemptsBeforeIdle,
    `${attemptsBeforeIdle} -> ${attemptCount}`
  );

  // --- 5. One bad event does not block the queue ---------------------------
  console.log('\n5. Satu event rusak tidak memblokir sisanya');

  const good = await seed(`${MARK}-c`, 'CustomerOrderReceived', { orderNumber: 'SO-QA-003' });
  const bad = await seed(`${MARK}-d`, 'CustomerOrderCancelled', { orderNumber: 'SO-QA-004' });

  const mixedRelay = new OutboxRelay();
  const mixedSeen = [];
  mixedRelay.subscribe((event) => {
    if (event.id === bad) throw new Error('event ini gagal');
    if (event.aggregateId === MARK) mixedSeen.push(event.id);
  });

  const mixed = await mixedRelay.relayTenant(TENANT);
  check('event sehat tetap terkirim', mixedSeen.includes(good), mixedSeen.join(','));
  check('relay menghitung keduanya', mixed.delivered === 1 && mixed.failed === 1, JSON.stringify(mixed));
  check('event sehat PUBLISHED', (await row(good)).status === 'PUBLISHED');
  check('event rusak PENDING untuk dicoba lagi', (await row(bad)).status === 'PENDING');

  // --- 6. The loop actually runs -------------------------------------------
  console.log('\n6. Loop relay berjalan sendiri');

  const looped = await seed(`${MARK}-e`, 'DemandForecastGenerated', { forecastNumber: 'DF-QA-005' });
  const loopSeen = [];
  const loopRelay = new OutboxRelay();
  loopRelay.subscribe((event) => {
    if (event.id === looped) loopSeen.push(event.id);
  });

  loopRelay.start(200);
  check('relay melaporkan dirinya aktif', loopRelay.isRunning);

  const deadline = Date.now() + 5000;
  while (loopSeen.length === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  loopRelay.stop();

  check('loop menemukan dan mengirim event tanpa dipanggil manual', loopSeen.length === 1, `seen=${loopSeen.length}`);
  check('relay berhenti saat diminta', loopRelay.isRunning === false);
  check('event terkirim oleh loop PUBLISHED', (await row(looped)).status === 'PUBLISHED');
} finally {
  await query('DELETE FROM outbox_event WHERE aggregate_id = $1', [MARK]).catch(() => undefined);
  await closePool();
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.error('Gagal:', failures.join(', '));
  process.exit(1);
}
