/**
 * Pilot acceptance — the Operator PWA offline → reconnect → sync cycle.
 *
 * This is the one thing no unit test can answer: does a tablet on a plant
 * network that drops actually keep the shift's work, and does that work reach
 * PostgreSQL when the network comes back?
 *
 * The run is deliberately end-to-end and destructive-free:
 *
 *   1. Load the terminal, sign in, record output online — the baseline.
 *   2. Cut the network at the browser (`context.setOffline(true)`), which is
 *      what a lost access point looks like to the page.
 *   3. Record output while offline. The command must land in IndexedDB, and the
 *      UI must say so rather than silently failing.
 *   4. Reconnect and let the queue drain.
 *   5. Assert against **PostgreSQL**, not against the UI: the record is the
 *      claim, the database is the evidence.
 *
 *   node scripts/qa-pwa-offline-sync.mjs
 *
 * Requires the operator app on :3200 and the API on :4000 (pnpm dev), or set
 * OPERATOR_URL / API_URL.
 */
import { chromium } from 'playwright-core';
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '..', '.env') });

const OPERATOR_URL = process.env.OPERATOR_URL || 'http://localhost:3200';
const CHROME =
  process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = process.env.OUT_DIR || path.resolve(here, '..', 'qa-evidence');
const TENANT = 'tenant-pilot-factory-01';

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

import fs from 'fs';
fs.mkdirSync(OUT, { recursive: true });

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const browser = await chromium.launch({ executablePath: CHROME });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();

const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

/** Reads the operator app's IndexedDB queue from inside the page. */
async function queueSnapshot() {
  return page.evaluate(async () => {
    const dbs = await indexedDB.databases?.();
    const name = dbs?.find((d) => /factory|operator|fv/i.test(d.name ?? ''))?.name;
    if (!name) return { db: null, commands: [] };
    return new Promise((resolve) => {
      const req = indexedDB.open(name);
      req.onerror = () => resolve({ db: name, commands: [], error: 'open failed' });
      req.onsuccess = () => {
        const idb = req.result;
        if (!idb.objectStoreNames.contains('commands')) {
          idb.close();
          return resolve({ db: name, commands: [], error: 'no commands store' });
        }
        const tx = idb.transaction('commands', 'readonly');
        const all = tx.objectStore('commands').getAll();
        all.onsuccess = () => {
          const commands = all.result.map((c) => ({
            id: c.id,
            type: c.type,
            status: c.status,
            retryCount: c.retryCount,
            clientEventId: c.clientEventId,
          }));
          idb.close();
          resolve({ db: name, commands });
        };
        all.onerror = () => {
          idb.close();
          resolve({ db: name, commands: [], error: 'read failed' });
        };
      };
    });
  });
}

try {
  console.log('\n1. Terminal termuat dan operator masuk');

  await page.goto(OPERATOR_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/pwa-01-login.png` });

  const title = await page.title();
  check('halaman terminal termuat', Boolean(title), title);

  // The operator signs in with an employee number and a PIN.
  const operator = await db.query(
    `SELECT o.id, o.employee_number FROM operator o
      JOIN operator_credential c ON c.operator_id = o.id
     WHERE o.tenant_id = $1 LIMIT 1`,
    [TENANT]
  );
  check(
    'ada operator dengan PIN tersimpan untuk login',
    operator.rows.length === 1,
    `${operator.rows.length}`
  );

  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 400));
  console.log(`     [layar] ${bodyText.replace(/\n+/g, ' | ').slice(0, 200)}`);

  // The terminal wants an employee number and then a 4-digit PIN on the keypad.
  const pinButtons = await page.locator('button', { hasText: /^[0-9]$/ }).count();
  check('keypad PIN tersedia di layar login', pinButtons >= 10, `${pinButtons} tombol angka`);

  const employeeNumber = process.env.OPERATOR_EMPLOYEE_NUMBER || operator.rows[0]?.employee_number;
  const pin = process.env.OPERATOR_PIN || '2468';

  // Prefer the operator card if the roster rendered; fall back to typing the
  // number, which is what the screen offers when the roster is empty.
  const card = page.locator('button').filter({ hasText: employeeNumber }).first();
  if (await card.count()) {
    await card.click();
  } else {
    const field = page.locator('input').first();
    await field.fill(employeeNumber);
  }
  await page.waitForTimeout(400);

  for (const digit of pin.split('')) {
    await page.locator('button', { hasText: new RegExp(`^${digit}$`) }).first().click();
    await page.waitForTimeout(140);
  }

  await page.getByRole('button', { name: /Masuk Terminal/i }).click();
  await page.waitForTimeout(4000);

  await page.screenshot({ path: `${OUT}/pwa-02-after-login.png` });
  const afterLogin = await page.evaluate(() => document.body.innerText.slice(0, 300));
  const signedIn = !/PIN|Masuk Terminal/i.test(afterLogin) || /Work Order|WO-/i.test(afterLogin);
  check('operator masuk ke terminal', signedIn, afterLogin.replace(/\n+/g, ' | ').slice(0, 160));

  console.log('\n2. Jaringan diputus');

  await context.setOffline(true);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/pwa-03-offline.png` });

  const offlineText = await page.evaluate(() => document.body.innerText);
  check(
    'UI memberitahu operator bahwa koneksi terputus',
    /offline|terputus|tidak ada koneksi|luring/i.test(offlineText),
    'tidak ada indikator offline pada layar'
  );

  const beforeCount = await db.query(
    'SELECT count(*)::int AS n FROM production_record WHERE tenant_id = $1',
    [TENANT]
  );

  console.log('\n3. Operator mencatat output selagi offline');

  // The terminal is built for one to three taps: output is a quick-add button,
  // not a form. `+10 GOOD` is the control an operator actually uses.
  const workOrderCard = page
    .locator('button')
    .filter({ hasText: /WO-.*In Production/ })
    .first();
  if (await workOrderCard.count()) {
    await workOrderCard.click().catch(() => undefined);
    await page.waitForTimeout(900);
  }

  const beforeQueue = await queueSnapshot();
  const addGood = page.getByRole('button', { name: /\+10\s*GOOD/i }).first();
  let recorded = false;
  if (await addGood.count()) {
    await addGood.click();
    await page.waitForTimeout(1800);
    recorded = true;
  }
  await page.screenshot({ path: `${OUT}/pwa-03b-capture-offline.png` });
  check(
    'operator dapat mencatat output tanpa koneksi',
    recorded,
    'tombol "+10 GOOD" tidak ditemukan pada layar'
  );

  const rejectButton = page.getByRole('button', { name: /\+1\s*REJECT/i }).first();
  if (await rejectButton.count()) {
    await rejectButton.click().catch(() => undefined);
    await page.waitForTimeout(1500);
  }

  const offlineScreen = await page.evaluate(() => document.body.innerText);
  check(
    'UI memberi tahu bahwa pencatatan tertahan di antrean, bukan gagal diam-diam',
    /antre|queue|tersimpan|menunggu|pending|belum tersinkron/i.test(offlineScreen),
    'tidak ada indikasi antrean pada layar'
  );

  console.log('\n4. Antrean IndexedDB saat offline');

  const queueOffline = await queueSnapshot();
  console.log(`     [idb] database: ${queueOffline.db ?? '(tidak ditemukan)'}`);
  check(
    'IndexedDB terbuka dan menyimpan antrean perintah',
    queueOffline.db !== null,
    queueOffline.error ?? 'tidak ada database'
  );
  console.log(
    `     [idb] ${queueOffline.commands.length} perintah tersimpan: ` +
      queueOffline.commands.map((c) => `${c.type}/${c.status}`).join(', ')
  );
  if (recorded) {
    check(
      'perintah tersimpan di IndexedDB selagi offline (tidak hilang)',
      queueOffline.commands.length > beforeQueue.commands.length,
      `${beforeQueue.commands.length} → ${queueOffline.commands.length} perintah`
    );
  }

  console.log('\n5. Jaringan tersambung kembali');

  await context.setOffline(false);
  // The queue drains on reconnect; give it room, then let any retry land.
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${OUT}/pwa-04-reconnected.png` });

  const onlineText = await page.evaluate(() => document.body.innerText);
  check(
    'UI kembali menandakan koneksi tersambung',
    !/sedang offline|koneksi terputus/i.test(onlineText),
    'masih menampilkan status offline'
  );

  const queueAfter = await queueSnapshot();
  const pending = queueAfter.commands.filter((c) => c.status === 'PENDING' || c.status === 'SYNCING');
  const failedCmds = queueAfter.commands.filter((c) => c.status === 'FAILED');
  console.log(
    `     [idb] ${queueAfter.commands.length} perintah, pending ${pending.length}, failed ${failedCmds.length}`
  );
  check(
    'tidak ada perintah tertinggal PENDING setelah reconnect',
    pending.length === 0,
    `${pending.length} pending`
  );

  console.log('\n6. Bukti di PostgreSQL');

  const afterCount = await db.query(
    'SELECT count(*)::int AS n FROM production_record WHERE tenant_id = $1',
    [TENANT]
  );
  check(
    'jumlah production record tidak berkurang setelah siklus offline',
    afterCount.rows[0].n >= beforeCount.rows[0].n,
    `${beforeCount.rows[0].n} → ${afterCount.rows[0].n}`
  );

  if (recorded) {
    // The whole point: what the operator captured with no network is now in
    // PostgreSQL. Asserted against the database, not against the screen.
    check(
      'output yang dicatat offline sampai ke PostgreSQL setelah reconnect',
      afterCount.rows[0].n > beforeCount.rows[0].n,
      `${beforeCount.rows[0].n} → ${afterCount.rows[0].n}`
    );

    const recent = await db.query(
      `SELECT good_quantity, reject_quantity, input_quantity, source
         FROM production_record WHERE tenant_id = $1
        ORDER BY recorded_at DESC LIMIT 1`,
      [TENANT]
    );
    const row = recent.rows[0];
    console.log(`     [db] record terbaru: ${JSON.stringify(row)}`);
    check(
      'record hasil sync membawa input quantity yang benar',
      row &&
        Number(row.input_quantity) ===
          Number(row.good_quantity) + Number(row.reject_quantity),
      JSON.stringify(row)
    );
  }

  // Whatever the UI did, nothing may have violated the quantity invariants.
  const violations = await db.query(`
    SELECT count(*)::int AS n FROM work_order
     WHERE input_quantity < output_quantity + reject_quantity + scrap_quantity + rework_quantity
        OR transferred_quantity > output_quantity`);
  check(
    'invarian quantity tetap utuh setelah siklus offline',
    violations.rows[0].n === 0,
    `${violations.rows[0].n} pelanggaran`
  );

  const duplicates = await db.query(`
    SELECT client_event_id, count(*)::int AS n FROM production_record
     WHERE tenant_id = $1 GROUP BY client_event_id HAVING count(*) > 1`,
    [TENANT]
  );
  check(
    'tidak ada production record ganda dari satu client_event_id',
    duplicates.rows.length === 0,
    `${duplicates.rows.length} duplikat`
  );

  console.log('\n7. Kesehatan halaman');

  const fatal = consoleErrors.filter(
    (e) => !/favicon|Failed to load resource.*40[34]|net::ERR_INTERNET_DISCONNECTED|Failed to fetch/i.test(e)
  );
  check(
    'tidak ada error JavaScript fatal sepanjang siklus',
    fatal.length === 0,
    fatal.slice(0, 3).join(' | ')
  );

  console.log(`\n${passed} pemeriksaan lulus, ${failed} gagal.`);
  console.log(`Tangkapan layar: ${OUT}`);
  if (failures.length) console.error('\nGagal:\n' + failures.map((f) => `  - ${f}`).join('\n'));
} catch (error) {
  failed += 1;
  console.error('\nException:', error.message);
  await page.screenshot({ path: `${OUT}/pwa-error.png` }).catch(() => undefined);
} finally {
  await browser.close();
  await db.end();
}

process.exit(failed > 0 ? 1 : 0);
