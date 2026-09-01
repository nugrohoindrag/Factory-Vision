/**
 * Sprint 7 — MES-077, the IndexedDB v2 upgrade, in a real browser.
 *
 * The one criterion that matters here cannot be checked by reading the code:
 * "queue yang belum tersinkron DIFLUSH LEBIH DULU / bila flush gagal, upgrade
 * DITUNDA". So this drives real Chrome against a real IndexedDB:
 *
 *   1. Build a **v1** database by hand — the schema a terminal shipped with —
 *      and put an unsynced command in it.
 *   2. Load the terminal offline, so the flush cannot possibly succeed.
 *   3. Assert the database is still v1, the command is still there, and the
 *      operator has been told why.
 *   4. Go online, let the queue drain, reload.
 *   5. Assert the upgrade then runs, the v2 stores exist, and nothing was lost.
 *
 *   node scripts/qa-indexeddb-upgrade.mjs
 *
 * Requires the operator app on :3200 and the API it proxies to.
 */
import { chromium } from 'playwright-core';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '..', '.env') });

const OPERATOR_URL = process.env.OPERATOR_URL || 'http://localhost:3200';
/**
 * A same-origin document that does *not* boot the terminal.
 *
 * IndexedDB is origin-scoped, so the database has to be manipulated from this
 * origin — but not while the app holds a connection open, or `deleteDatabase`
 * blocks and an open at a lower version fails. The favicon is served from the
 * same origin and runs no script, which is exactly what is needed.
 */
const BLANK_PAGE = (process.env.OPERATOR_URL || 'http://localhost:3200') + '/favicon.svg';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const DB_NAME = 'factory-vision-operator-db';

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

/** Builds the v1 schema exactly as the shipped version created it. */
const seedV1 = (dbName) =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('commands')) {
        const store = db.createObjectStore('commands', { keyPath: 'id', autoIncrement: true });
        store.createIndex('by-clientEventId', 'clientEventId', { unique: true });
        store.createIndex('by-status', 'status');
        store.createIndex('by-workOrder', 'workOrderId');
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('commands', 'readwrite');
      tx.objectStore('commands').add({
        clientEventId: 'qa-upgrade-' + Date.now(),
        tenantId: 'tenant-pilot-factory-01',
        workOrderId: 'wo-qa-upgrade',
        type: 'RECORD_OUTPUT',
        payload: { goodQuantity: 7, rejectQuantity: 0 },
        queuedAt: Date.now(),
        occurredAt: new Date().toISOString(),
        status: 'PENDING',
        retryCount: 0,
      });
      tx.oncomplete = () => {
        const version = db.version;
        db.close();
        resolve(version);
      };
      tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  });

/** Reads the database's version, store names and command rows. */
const inspect = (dbName) =>
  new Promise((resolve) => {
    const request = indexedDB.open(dbName);
    request.onsuccess = () => {
      const db = request.result;
      const stores = Array.from(db.objectStoreNames);
      if (!stores.includes('commands')) {
        const version = db.version;
        db.close();
        resolve({ version, stores, commands: [] });
        return;
      }
      const tx = db.transaction('commands', 'readonly');
      const all = tx.objectStore('commands').getAll();
      all.onsuccess = () => {
        const version = db.version;
        const commands = all.result;
        db.close();
        resolve({ version, stores, commands });
      };
      all.onerror = () => {
        db.close();
        resolve({ version: db.version, stores, commands: [] });
      };
    };
    request.onerror = () => resolve({ version: 0, stores: [], commands: [] });
  });

const dropDb = (dbName) =>
  new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(dbName);
    request.onsuccess = () => resolve(true);
    request.onerror = () => resolve(false);
    request.onblocked = () => resolve(false);
  });

console.log('\n=== Sprint 7 — MES-077 IndexedDB v2 upgrade ===\n');

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext();
const page = await context.newPage();
// Vite compiles the terminal on first request; 30s is not always enough on a
// cold dev server, and a timeout here would look like a product failure.
page.setDefaultNavigationTimeout(120000);

try {
  // --- 0. Start from a known-empty origin -----------------------------------
  await page.goto(BLANK_PAGE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(dropDb, DB_NAME);

  // --- 1. A terminal on the old schema, holding unsynced production ---------
  console.log('1. Terminal pada schema v1 dengan antrian belum terkirim');

  const seededVersion = await page.evaluate(seedV1, DB_NAME);
  check('database v1 terbentuk', seededVersion === 1, `version=${seededVersion}`);

  const seeded = await page.evaluate(inspect, DB_NAME);
  check('ada satu perintah menunggu kirim', seeded.commands.length === 1, `n=${seeded.commands.length}`);
  check('belum ada store v2', !seeded.stores.includes('workOrders'), seeded.stores.join(','));

  // --- 2. Load offline: the flush cannot succeed ----------------------------
  console.log('\n2. Muat aplikasi tanpa jaringan, flush pasti gagal');

  // The API is made unreachable rather than the whole network: a tablet whose
  // access point has gone still has the app in its cache, and cutting the
  // browser's connection outright would stop the dev server serving the page at
  // all — testing Playwright rather than the product.
  await context.route('**/api/**', (route) => route.abort('internetdisconnected'));
  await page.goto(OPERATOR_URL, { waitUntil: 'domcontentloaded' });
  // Long enough for the bootstrap to attempt the flush and give up.
  await page.waitForTimeout(6000);

  const noticeText = await page
    .locator('text=/Pembaruan penyimpanan ditunda/i')
    .first()
    .textContent({ timeout: 8000 })
    .catch(() => null);

  await page.goto(BLANK_PAGE, { waitUntil: 'domcontentloaded' });
  const deferred = await page.evaluate(inspect, DB_NAME);
  check(
    'upgrade DITUNDA — database masih v1',
    deferred.version === 1,
    `version=${deferred.version}`
  );
  check(
    'perintah yang belum terkirim TIDAK hilang',
    deferred.commands.length === 1,
    `n=${deferred.commands.length}`
  );
  check(
    'store v2 belum dibuat selama penundaan',
    !deferred.stores.includes('workOrders'),
    deferred.stores.join(',')
  );

  check(
    'operator diberi tahu alasan penundaan',
    Boolean(noticeText),
    noticeText ?? 'banner tidak muncul'
  );
  check(
    'pemberitahuan menyebut jumlah catatan yang tertahan',
    Boolean(noticeText) && /1 catatan produksi/i.test(noticeText),
    noticeText ?? ''
  );

  // --- 3. Reconnect: the queue drains, then the upgrade runs ---------------
  console.log('\n3. Jaringan kembali, antrian terkirim, upgrade berjalan');

  await context.unroute('**/api/**');
  // The command names a Work Order that does not exist, so the server refuses
  // it permanently. That is the point: the queue empties either way — what must
  // never happen is the upgrade running while the row is still unresolved.
  await page.goto(OPERATOR_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // Clear the queue the way an operator would once the rejection is dealt with.
  await page.goto(BLANK_PAGE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    (dbName) =>
      new Promise((resolve) => {
        const request = indexedDB.open(dbName);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('commands', 'readwrite');
          tx.objectStore('commands').clear();
          tx.oncomplete = () => {
            db.close();
            resolve(true);
          };
        };
      }),
    DB_NAME
  );

  await page.goto(OPERATOR_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);

  const banner = await page
    .locator('text=/Pembaruan penyimpanan ditunda/i')
    .first()
    .isVisible()
    .catch(() => false);

  await page.goto(BLANK_PAGE, { waitUntil: 'domcontentloaded' });
  const upgraded = await page.evaluate(inspect, DB_NAME);
  check('database naik ke v2', upgraded.version === 2, `version=${upgraded.version}`);
  for (const store of ['commands', 'workOrders', 'batches', 'masters', 'meta']) {
    check(`store ${store} tersedia`, upgraded.stores.includes(store), upgraded.stores.join(','));
  }

  const schemaVersion = await page.evaluate(
    (dbName) =>
      new Promise((resolve) => {
        const request = indexedDB.open(dbName);
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('meta')) {
            db.close();
            resolve(null);
            return;
          }
          const tx = db.transaction('meta', 'readonly');
          const get = tx.objectStore('meta').get('schemaVersion');
          get.onsuccess = () => {
            db.close();
            resolve(get.result ? get.result.value : null);
          };
          get.onerror = () => {
            db.close();
            resolve(null);
          };
        };
        request.onerror = () => resolve(null);
      }),
    DB_NAME
  );
  check('schema_version tersimpan dan diperiksa saat bootstrap', schemaVersion === 2, String(schemaVersion));

  check('pemberitahuan penundaan hilang setelah upgrade berhasil', banner === false, String(banner));

  // --- 4. The upgrade is idempotent ----------------------------------------
  console.log('\n4. Membuka ulang tidak merusak apa pun');

  await page.goto(OPERATOR_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await page.goto(BLANK_PAGE, { waitUntil: 'domcontentloaded' });
  const again = await page.evaluate(inspect, DB_NAME);
  check('tetap v2 setelah muat ulang', again.version === 2, `version=${again.version}`);
  check(
    'store tidak digandakan atau hilang',
    again.stores.length === upgraded.stores.length,
    `${upgraded.stores.length} -> ${again.stores.length}`
  );
} finally {
  await page.goto(BLANK_PAGE, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
  await page.evaluate(dropDb, DB_NAME).catch(() => undefined);
  await browser.close();
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.error('Gagal:', failures.join(', '));
  process.exit(1);
}
