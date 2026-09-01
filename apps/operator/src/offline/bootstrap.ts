import { OfflineCommandStatus } from '@factory-vision/domain-types';
import { FactoryVisionApiClient } from '@factory-vision/api-client';
import {
  DB_NAME,
  TARGET_SCHEMA_VERSION,
  closeOperatorDb,
  detectSchemaVersion,
  getOperatorDb,
  hasStore,
  readMeta,
  setUpgradeDeferred,
  writeMeta,
  type CachedBatch,
  type CachedMasterCollection,
  type CachedWorkOrder,
} from './db.js';
import { countUnsyncedCommands, syncQueue } from './queue.js';

const api = new FactoryVisionApiClient({ baseUrl: '' });

/**
 * Schema upgrade and offline bootstrap (MES-077, MES-078).
 *
 * The order matters and is the whole point of this file: **flush, then
 * upgrade**. An unsynced command is production that happened on the shop floor
 * and exists nowhere else, so the upgrade waits for the queue to be empty. If
 * it cannot be emptied — the tablet is offline, or the server rejected
 * something — the upgrade is deferred, the terminal keeps running on the old
 * schema, and the operator is told why. A terminal a version behind still
 * records production; a terminal that lost its queue has thrown a shift away.
 */

export type UpgradeOutcome =
  | { kind: 'not-needed'; version: number }
  | { kind: 'created'; version: number }
  | { kind: 'upgraded'; from: number; to: number }
  | { kind: 'deferred'; from: number; to: number; unsynced: number; reason: string };

export interface BootstrapResult {
  upgrade: UpgradeOutcome;
  cached: { workOrders: number; batches: number; masterCollections: number };
  lastBootstrapAt: string | null;
  /** Set when the caches could not be filled — offline, most likely. */
  error?: string;
}

/**
 * Brings the local database to `TARGET_SCHEMA_VERSION`, or explains why not.
 *
 * `notify` is how the operator hears about a deferral. It is a parameter rather
 * than a toast call so this stays testable without a DOM.
 */
export async function prepareOperatorDb(
  notify?: (message: string) => void
): Promise<UpgradeOutcome> {
  const onDisk = await detectSchemaVersion();

  if (onDisk === 0) {
    setUpgradeDeferred(false);
    await getOperatorDb();
    await writeMeta('schemaVersion', TARGET_SCHEMA_VERSION);
    return { kind: 'created', version: TARGET_SCHEMA_VERSION };
  }

  if (onDisk >= TARGET_SCHEMA_VERSION) {
    setUpgradeDeferred(false);
    await getOperatorDb();
    // Checked at every bootstrap, per MES-077: a stored version that disagrees
    // with the database's own is a corrupted upgrade, and it is better to
    // notice it here than to read a store that is not shaped as expected.
    const stored = await readMeta<number>('schemaVersion');
    if (stored !== TARGET_SCHEMA_VERSION) await writeMeta('schemaVersion', TARGET_SCHEMA_VERSION);
    return { kind: 'not-needed', version: onDisk };
  }

  // An upgrade is due. Open at the *old* version so counting the queue cannot
  // itself trigger the version change.
  setUpgradeDeferred(true);
  let unsynced = await countUnsyncedCommands();

  if (unsynced > 0) {
    try {
      await syncQueue();
    } catch {
      // Swallowed deliberately: the count below is the real answer, and a
      // network error here is an ordinary offline tablet, not a fault.
    }
    unsynced = await countUnsyncedCommands();
  }

  if (unsynced > 0) {
    const reason =
      `Masih ada ${unsynced} catatan produksi yang belum terkirim ke server. ` +
      'Pembaruan penyimpanan ditunda sampai antrian terkirim agar tidak ada data yang hilang.';
    notify?.(reason);
    return { kind: 'deferred', from: onDisk, to: TARGET_SCHEMA_VERSION, unsynced, reason };
  }

  // The queue is empty: nothing can be lost, so the upgrade may run.
  await closeOperatorDb();
  setUpgradeDeferred(false);
  await getOperatorDb();
  await writeMeta('schemaVersion', TARGET_SCHEMA_VERSION);
  return { kind: 'upgraded', from: onDisk, to: TARGET_SCHEMA_VERSION };
}

/**
 * Fills the offline caches from the API (MES-078).
 *
 * Everything an operator needs for a shift: the Work Orders they may run, the
 * batches beneath them, and the master data behind every picker — including
 * moulds and their compatibility, which is what ADR-36 reads to decide whether
 * a Work Order may be confirmed without one.
 *
 * A failure here is not fatal. The terminal keeps whatever it cached last time,
 * which is exactly the situation this cache exists for.
 */
export async function cacheOfflineData(): Promise<BootstrapResult['cached'] & { error?: string }> {
  if (!(await hasStore('workOrders'))) {
    // Running on the deferred v1 schema: there is nowhere to put any of this.
    return { workOrders: 0, batches: 0, masterCollections: 0 };
  }

  const db = await getOperatorDb();
  const now = Date.now();

  try {
    const [workOrders, batches, processes, downtimeReasons, rejectReasons, products, molds] =
      await Promise.all([
        api.workOrders.list(),
        api.master.getBatches(),
        api.master.getProcesses(),
        api.master.getDowntimeReasons(),
        api.master.getRejectReasons(),
        api.master.getProducts(),
        api.molds.list(),
      ]);

    // Compatibility is fetched per mould rather than in one call, because the
    // rule is per mould and a terminal typically holds a handful of them.
    const compatibility = (
      await Promise.all(
        molds.map((mold) =>
          api.molds
            .listCompatibilities(mold.id, { activeOnly: true })
            .catch(() => [])
        )
      )
    ).flat();

    const woTx = db.transaction('workOrders', 'readwrite');
    await woTx.store.clear();
    for (const wo of workOrders as unknown as Array<Record<string, unknown>>) {
      await woTx.store.put({ ...(wo as object), cachedAt: now } as CachedWorkOrder);
    }
    await woTx.done;

    const batchTx = db.transaction('batches', 'readwrite');
    await batchTx.store.clear();
    for (const batch of batches as unknown as Array<Record<string, unknown>>) {
      await batchTx.store.put({ ...(batch as object), cachedAt: now } as CachedBatch);
    }
    await batchTx.done;

    const collections: CachedMasterCollection[] = [
      { kind: 'processes', items: processes, cachedAt: now },
      { kind: 'downtimeReasons', items: downtimeReasons, cachedAt: now },
      { kind: 'rejectReasons', items: rejectReasons, cachedAt: now },
      { kind: 'products', items: products, cachedAt: now },
      { kind: 'molds', items: molds, cachedAt: now },
      { kind: 'moldCompatibility', items: compatibility, cachedAt: now },
    ];
    const masterTx = db.transaction('masters', 'readwrite');
    for (const collection of collections) await masterTx.store.put(collection);
    await masterTx.done;

    await writeMeta('lastBootstrapAt', new Date(now).toISOString());

    return {
      workOrders: workOrders.length,
      batches: batches.length,
      masterCollections: collections.length,
    };
  } catch (error) {
    return {
      workOrders: 0,
      batches: 0,
      masterCollections: 0,
      error: error instanceof Error ? error.message : 'Gagal memuat data offline.',
    };
  }
}

/** Reads a cached master collection, for a terminal with no network. */
export async function readCachedMasters<T>(
  kind: CachedMasterCollection['kind']
): Promise<T[] | undefined> {
  if (!(await hasStore('masters'))) return undefined;
  const db = await getOperatorDb();
  const row = await db.get('masters', kind);
  return row?.items as T[] | undefined;
}

export async function readCachedWorkOrders(): Promise<CachedWorkOrder[]> {
  if (!(await hasStore('workOrders'))) return [];
  const db = await getOperatorDb();
  return db.getAll('workOrders');
}

export async function readCachedBatches(workOrderId?: string): Promise<CachedBatch[]> {
  if (!(await hasStore('batches'))) return [];
  const db = await getOperatorDb();
  return workOrderId
    ? db.getAllFromIndex('batches', 'by-workOrder', workOrderId)
    : db.getAll('batches');
}

/** The whole bootstrap: bring the schema up to date, then fill the caches. */
export async function bootstrapOffline(
  notify?: (message: string) => void
): Promise<BootstrapResult> {
  const upgrade = await prepareOperatorDb(notify);
  const cached = await cacheOfflineData();
  const lastBootstrapAt = (await readMeta<string>('lastBootstrapAt')) ?? null;
  return { upgrade, cached, lastBootstrapAt, error: cached.error };
}

export { DB_NAME, TARGET_SCHEMA_VERSION, OfflineCommandStatus };
