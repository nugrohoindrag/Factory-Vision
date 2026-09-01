/**
 * Sprint 7 — document storage runs through an adapter, and MinIO really works.
 *
 * ADR-09 asks for the self-hosted implementation to be exercised, not just
 * written. So this runs the *same* assertions against both backends: the
 * filesystem store the single-VPS stack uses, and a real MinIO server. A
 * difference between the two — a 404 that throws on one and returns undefined
 * on the other, a key layout that only matches on POSIX — shows up as a failing
 * row rather than as a support ticket after the migration.
 *
 * MinIO is skipped, loudly, when `OBJECT_STORAGE_TEST_ENDPOINT` is not set:
 *
 *   docker run -d --name fv-minio-qa -p 9100:9000 \
 *     -e MINIO_ROOT_USER=fvqa -e MINIO_ROOT_PASSWORD=fvqasecret123 \
 *     minio/minio:latest server /data
 *   OBJECT_STORAGE_TEST_ENDPOINT=http://127.0.0.1:9100 \
 *     node --import tsx scripts/qa-object-storage.mjs
 */
import dotenv from 'dotenv';
import os from 'os';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../../.env') });

const storage = await import('../src/platform/storage/index.ts');
const { FilesystemObjectStore, S3ObjectStore, getObjectStore, setObjectStore } = storage;

let passed = 0;
let failed = 0;
let skipped = 0;
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

/** The contract every backend must satisfy identically. */
async function exerciseStore(name, store) {
  console.log(`\n--- ${name} ---`);

  const health = await store.check();
  check(`[${name}] check() melaporkan backend sehat`, health.ok, health.detail);

  const key = `tenant-qa/doc-${Date.now()}.pdf`;
  const body = Buffer.from('%PDF-1.4 factory vision qa document', 'utf8');

  const written = await store.put(key, body, 'application/pdf');
  check(`[${name}] put() melaporkan ukuran sebenarnya`, written.sizeBytes === body.length, `${written.sizeBytes} != ${body.length}`);

  const read = await store.get(key);
  check(`[${name}] get() mengembalikan byte yang sama persis`, read !== undefined && read.equals(body), read ? `len=${read.length}` : 'undefined');

  check(`[${name}] exists() true untuk objek yang ada`, (await store.exists(key)) === true);
  check(`[${name}] exists() false untuk objek yang tidak ada`, (await store.exists(`${key}.missing`)) === false);

  const absent = await store.get(`${key}.missing`);
  check(`[${name}] get() objek hilang mengembalikan undefined, bukan melempar`, absent === undefined, String(absent));

  // Overwrite: the same key must end up holding the new bytes, not both.
  const replacement = Buffer.from('%PDF-1.4 revisi kedua', 'utf8');
  await store.put(key, replacement, 'application/pdf');
  const reread = await store.get(key);
  check(`[${name}] put() pada key sama menimpa, bukan menggandakan`, reread !== undefined && reread.equals(replacement), reread ? reread.toString() : '');

  await store.remove(key);
  check(`[${name}] remove() benar-benar menghapus`, (await store.exists(key)) === false);

  let removeThrew = false;
  try {
    await store.remove(key);
  } catch {
    removeThrew = true;
  }
  check(`[${name}] remove() objek yang sudah hilang tetap sukses`, removeThrew === false);

  // Binary safety: a JPEG is not UTF-8, and a store that round-trips through a
  // string would corrupt it in a way text fixtures never reveal.
  const binaryKey = `tenant-qa/binary-${Date.now()}.png`;
  const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe, 0x7f]);
  await store.put(binaryKey, binary, 'image/png');
  const binaryBack = await store.get(binaryKey);
  check(`[${name}] byte biner tidak rusak`, binaryBack !== undefined && binaryBack.equals(binary), binaryBack ? binaryBack.toString('hex') : '');
  await store.remove(binaryKey);

  // Traversal is refused, not sanitised, on every backend.
  for (const bad of ['../escape.pdf', 'tenant/../../escape.pdf', '/absolute.pdf']) {
    let refused = false;
    try {
      await store.put(bad, body, 'application/pdf');
    } catch {
      refused = true;
    }
    check(`[${name}] key traversal ditolak: ${bad}`, refused);
  }
}

console.log('\n=== Sprint 7 — object storage adapter ===');

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'fv-storage-qa-'));

try {
  // --- 1. Filesystem backend ------------------------------------------------
  await exerciseStore('filesystem', new FilesystemObjectStore(tempRoot));

  // --- 2. MinIO backend -----------------------------------------------------
  const endpoint = process.env.OBJECT_STORAGE_TEST_ENDPOINT;
  if (!endpoint) {
    skipped += 1;
    console.log('\n--- minio ---');
    console.log('  SKIP  OBJECT_STORAGE_TEST_ENDPOINT belum diset; backend S3 tidak diuji.');
  } else {
    const bucket = process.env.OBJECT_STORAGE_TEST_BUCKET ?? 'factory-vision-qa';
    const accessKeyId = process.env.OBJECT_STORAGE_TEST_ACCESS_KEY ?? 'fvqa';
    const secretAccessKey = process.env.OBJECT_STORAGE_TEST_SECRET_KEY ?? 'fvqasecret123';

    const { CreateBucketCommand, S3Client } = await import('@aws-sdk/client-s3');
    const admin = new S3Client({
      region: 'us-east-1',
      endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    });
    await admin
      .send(new CreateBucketCommand({ Bucket: bucket }))
      .catch((error) => {
        if (!String(error?.name).includes('BucketAlreadyOwnedByYou') && !String(error?.name).includes('BucketAlreadyExists')) {
          throw error;
        }
      });
    admin.destroy();

    const s3 = new S3ObjectStore({
      bucket,
      region: 'us-east-1',
      endpoint,
      accessKeyId,
      secretAccessKey,
      forcePathStyle: true,
    });
    await exerciseStore('minio', s3);

    // A bucket that does not exist must fail the health check, not the first
    // upload of the day.
    const wrong = new S3ObjectStore({
      bucket: 'bucket-yang-tidak-ada-fv-qa',
      region: 'us-east-1',
      endpoint,
      accessKeyId,
      secretAccessKey,
      forcePathStyle: true,
    });
    const wrongHealth = await wrong.check();
    check('[minio] bucket salah gagal pada check(), bukan pada upload pertama', wrongHealth.ok === false, wrongHealth.detail);
    wrong.destroy();
    s3.destroy();
  }

  // --- 3. Backend selection -------------------------------------------------
  console.log('\n--- pemilihan backend ---');

  setObjectStore(undefined);
  const previousDriver = process.env.OBJECT_STORAGE_DRIVER;
  delete process.env.OBJECT_STORAGE_DRIVER;
  check('default adalah filesystem', getObjectStore().kind === 'filesystem', getObjectStore().kind);

  setObjectStore(undefined);
  process.env.OBJECT_STORAGE_DRIVER = 's3';
  const savedBucket = process.env.OBJECT_STORAGE_BUCKET;
  delete process.env.OBJECT_STORAGE_BUCKET;
  let refusedHalfConfig = false;
  let refusalMessage = '';
  try {
    getObjectStore();
  } catch (error) {
    refusedHalfConfig = true;
    refusalMessage = error.message;
  }
  check('driver s3 tanpa kredensial ditolak saat bootstrap', refusedHalfConfig, refusalMessage);
  check('pesan menyebut variabel yang kurang', refusalMessage.includes('OBJECT_STORAGE_BUCKET'), refusalMessage);

  setObjectStore(undefined);
  process.env.OBJECT_STORAGE_DRIVER = 'nonsense';
  let refusedUnknown = false;
  try {
    getObjectStore();
  } catch {
    refusedUnknown = true;
  }
  check('driver tidak dikenal ditolak, tidak diam-diam jadi filesystem', refusedUnknown);

  // --- 4. The document path really goes through the adapter -----------------
  console.log('\n--- dokumen Customer Order lewat adapter ---');

  const { DocumentStorage } = await import('../src/modules/planning/infrastructure/document-storage.ts');

  const recording = new FilesystemObjectStore(path.join(tempRoot, 'documents'));
  const keysWritten = [];
  const spy = {
    kind: recording.kind,
    put: (key, body, contentType) => {
      keysWritten.push(key);
      return recording.put(key, body, contentType);
    },
    get: (key) => recording.get(key),
    remove: (key) => recording.remove(key),
    exists: (key) => recording.exists(key),
    check: () => recording.check(),
  };
  setObjectStore(spy);

  const documents = new DocumentStorage();
  const pdf = Buffer.from('%PDF-1.4 purchase order scan', 'utf8');
  const stored = await documents.put('tenant-qa-doc', 'codoc-001', 'application/pdf', pdf.toString('base64'));

  check('dokumen ditulis lewat ObjectStore, bukan fs langsung', keysWritten.length === 1, JSON.stringify(keysWritten));
  check('key diawali tenant, sehingga dapat dibatasi per pabrik', keysWritten[0] === 'tenant-qa-doc/codoc-001.pdf', keysWritten[0]);
  check('ukuran dilaporkan dari byte hasil decode', stored.sizeBytes === pdf.length, `${stored.sizeBytes}`);
  check(
    'storageUrl adalah URL API, bukan lokasi penyimpanan',
    stored.storageUrl === '/api/v1/customer-orders/documents/codoc-001.pdf/content',
    stored.storageUrl
  );

  const fetched = await documents.get('tenant-qa-doc', 'codoc-001.pdf');
  check('dokumen dapat dibaca kembali utuh', fetched.equals(pdf), `len=${fetched.length}`);

  let notFoundStatus;
  try {
    await documents.get('tenant-qa-doc', 'codoc-tidak-ada.pdf');
  } catch (error) {
    notFoundStatus = error.status ?? error.statusCode;
  }
  check('dokumen hilang menjadi 404, bukan 500', notFoundStatus === 404, String(notFoundStatus));

  let crossTenant;
  try {
    crossTenant = await documents.get('tenant-qa-lain', 'codoc-001.pdf');
  } catch {
    crossTenant = undefined;
  }
  check('tenant lain tidak dapat membaca dokumen dengan objectId yang sama', crossTenant === undefined);

  let typeRefused = false;
  try {
    await documents.put('tenant-qa-doc', 'codoc-002', 'application/x-msdownload', pdf.toString('base64'));
  } catch {
    typeRefused = true;
  }
  check('tipe file di luar allowlist ditolak', typeRefused);

  await documents.remove('tenant-qa-doc', 'codoc-001.pdf');
  check('remove() menghapus lewat adapter', (await spy.exists('tenant-qa-doc/codoc-001.pdf')) === false);

  if (previousDriver === undefined) delete process.env.OBJECT_STORAGE_DRIVER;
  else process.env.OBJECT_STORAGE_DRIVER = previousDriver;
  if (savedBucket !== undefined) process.env.OBJECT_STORAGE_BUCKET = savedBucket;
  setObjectStore(undefined);
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
}

console.log(`\n=== ${passed} passed, ${failed} failed, ${skipped} skipped ===`);
if (failed > 0) {
  console.error('Gagal:', failures.join(', '));
  process.exit(1);
}
