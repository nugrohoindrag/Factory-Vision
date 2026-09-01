import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { OfflineCommand } from '@factory-vision/domain-types';

/**
 * The terminal's local database (MES-077).
 *
 * Schema v2 adds the stores a full offline shift needs — the confirmed Work
 * Orders, their batches, the master data an operator picks from, and a `meta`
 * store holding the schema version and the last sync time.
 *
 * **The upgrade must never be destructive to the queue.** A queued command is
 * production that happened; dropping it during an upgrade would lose a shift's
 * counts with nothing to show for it. Two things enforce that here:
 *
 *  1. the version-change handler only ever *creates* stores, and never touches
 *     `commands`; and
 *  2. `prepareOperatorDb` in `bootstrap.ts` refuses to run the upgrade at all
 *     while anything is unsynced — it flushes first, and if the flush fails it
 *     defers the upgrade and keeps the terminal on v1 rather than risking the
 *     queue.
 */

export const DB_NAME = 'factory-vision-operator-db';

/** The schema this build wants. Bumping it means writing an upgrade path. */
export const TARGET_SCHEMA_VERSION = 2;

/** A Work Order as the terminal caches it, flattened for offline reads. */
export interface CachedWorkOrder {
  id: string;
  workOrderNumber?: string;
  productId?: string;
  productName?: string;
  machineId?: string;
  status: string;
  plannedQuantity?: number;
  inputQuantity?: number;
  outputQuantity?: number;
  rejectQuantity?: number;
  scrapQuantity?: number;
  reworkQuantity?: number;
  transferredQuantity?: number;
  moldId?: string;
  isBatchManaged?: boolean;
  cachedAt: number;
}

export interface CachedBatch {
  id: string;
  workOrderId: string;
  batchNumber?: string;
  status?: string;
  plannedQuantity?: number;
  outputQuantity?: number;
  cachedAt: number;
}

/**
 * One row per master-data collection, keyed by kind.
 *
 * A single store rather than one per entity: the terminal only ever reads a
 * whole collection at once, and a store per kind would mean a schema change
 * every time a new picker appears.
 */
export interface CachedMasterCollection {
  kind:
    | 'processes'
    | 'downtimeReasons'
    | 'rejectReasons'
    | 'molds'
    | 'moldCompatibility'
    | 'products';
  items: unknown[];
  cachedAt: number;
}

/** Bootstrap bookkeeping: schema version, clock offset, last sync. */
export interface MetaEntry {
  key: 'schemaVersion' | 'lastBootstrapAt' | 'serverClockOffsetMs' | 'tenantConfig';
  value: unknown;
  updatedAt: number;
}

interface OperatorDB extends DBSchema {
  commands: {
    key: number;
    value: OfflineCommand;
    indexes: {
      'by-clientEventId': string;
      'by-status': string;
      'by-workOrder': string;
    };
  };
  workOrders: {
    key: string;
    value: CachedWorkOrder;
    indexes: { 'by-status': string; 'by-machine': string };
  };
  batches: {
    key: string;
    value: CachedBatch;
    indexes: { 'by-workOrder': string };
  };
  masters: {
    key: string;
    value: CachedMasterCollection;
  };
  meta: {
    key: string;
    value: MetaEntry;
  };
}

export type OperatorDatabase = IDBPDatabase<OperatorDB>;

/**
 * Whether the database must be opened *without* a version.
 *
 * Opening with no version tells IndexedDB to use whatever is on disk and never
 * trigger `upgradeneeded` — which is what keeps a terminal with an unsynced
 * queue on v1 until it can flush.
 *
 * It starts **true**, and only `prepareOperatorDb` may clear it. That default
 * is the whole safety property: the sync engine starts before the bootstrap
 * finishes, and its first `refreshCounts` opens the database. With the default
 * the other way round, that read alone performed the upgrade — before anything
 * had checked whether the queue was empty, and regardless of what the bootstrap
 * decided a moment later.
 */
let deferred = true;

let handle: Promise<OperatorDatabase> | null = null;

export function isUpgradeDeferred(): boolean {
  return deferred;
}

export function setUpgradeDeferred(value: boolean): void {
  if (deferred !== value) {
    deferred = value;
    handle = null;
  }
}

/**
 * Creates the v2 stores. Only ever additive.
 *
 * `oldVersion` is checked per store rather than as a range, so a terminal that
 * skipped a version and one that upgraded step by step end up identical.
 */
function applyUpgrade(db: IDBPDatabase<OperatorDB>): void {
  if (!db.objectStoreNames.contains('commands')) {
    const store = db.createObjectStore('commands', { keyPath: 'id', autoIncrement: true });
    store.createIndex('by-clientEventId', 'clientEventId', { unique: true });
    store.createIndex('by-status', 'status');
    store.createIndex('by-workOrder', 'workOrderId');
  }
  if (!db.objectStoreNames.contains('workOrders')) {
    const store = db.createObjectStore('workOrders', { keyPath: 'id' });
    store.createIndex('by-status', 'status');
    store.createIndex('by-machine', 'machineId');
  }
  if (!db.objectStoreNames.contains('batches')) {
    const store = db.createObjectStore('batches', { keyPath: 'id' });
    store.createIndex('by-workOrder', 'workOrderId');
  }
  if (!db.objectStoreNames.contains('masters')) {
    db.createObjectStore('masters', { keyPath: 'kind' });
  }
  if (!db.objectStoreNames.contains('meta')) {
    db.createObjectStore('meta', { keyPath: 'key' });
  }
}

/**
 * The version currently on disk, or 0 when the database does not exist.
 *
 * `indexedDB.databases()` is the direct answer but is not available in every
 * browser the shop floor may run; opening without a version and reading
 * `db.version` is the fallback, and is safe because an open with no version
 * never triggers an upgrade.
 */
export async function detectSchemaVersion(): Promise<number> {
  if (typeof indexedDB === 'undefined') return 0;

  if (typeof indexedDB.databases === 'function') {
    try {
      const found = (await indexedDB.databases()).find((d) => d.name === DB_NAME);
      return found?.version ?? 0;
    } catch {
      /* fall through to the open-and-read path */
    }
  }

  return new Promise<number>((resolve) => {
    const request = indexedDB.open(DB_NAME);
    request.onsuccess = () => {
      const db = request.result;
      // A database that did not exist is created empty by this open, and an
      // empty one is indistinguishable from "absent" for our purposes.
      const version = db.objectStoreNames.length === 0 ? 0 : db.version;
      db.close();
      resolve(version);
    };
    request.onerror = () => resolve(0);
    request.onblocked = () => resolve(0);
  });
}

/**
 * Whether the open database has the command queue.
 *
 * A database opened before `prepareOperatorDb` has run — or one created empty
 * by a version probe — has no stores at all. The queue asks this before
 * touching itself, so a read during bootstrap reports "nothing queued" instead
 * of throwing `NotFoundError`.
 */
export async function hasCommandsStore(): Promise<boolean> {
  return hasStore('commands');
}

export async function getOperatorDb(): Promise<OperatorDatabase> {
  if (!handle) {
    handle = deferred
      ? // No version argument: open whatever exists, upgrade nothing.
        openDB<OperatorDB>(DB_NAME)
      : openDB<OperatorDB>(DB_NAME, TARGET_SCHEMA_VERSION, {
          upgrade(db) {
            applyUpgrade(db);
          },
          blocked() {
            // Another tab holds the old version open. Logged rather than
            // thrown: the open resolves once that tab closes, and the operator
            // has nothing to do about it in the meantime.
            // eslint-disable-next-line no-console
            console.warn('[offline-db] upgrade menunggu tab lain menutup database.');
          },
        });
  }
  return handle;
}

/** Whether a store exists on the open database — a v1 handle lacks the v2 ones. */
export async function hasStore(name: string): Promise<boolean> {
  const db = await getOperatorDb();
  return db.objectStoreNames.contains(name as never);
}

export async function closeOperatorDb(): Promise<void> {
  if (handle) {
    const db = await handle;
    db.close();
    handle = null;
  }
}

// --- meta -----------------------------------------------------------

export async function readMeta<T>(key: MetaEntry['key']): Promise<T | undefined> {
  if (!(await hasStore('meta'))) return undefined;
  const db = await getOperatorDb();
  const row = await db.get('meta', key);
  return row?.value as T | undefined;
}

export async function writeMeta(key: MetaEntry['key'], value: unknown): Promise<void> {
  if (!(await hasStore('meta'))) return;
  const db = await getOperatorDb();
  await db.put('meta', { key, value, updatedAt: Date.now() });
}
