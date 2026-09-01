import { v4 as uuidv4 } from 'uuid';
import { OfflineCommand, OfflineCommandStatus } from '@factory-vision/domain-types';
import { getOperatorDb, hasCommandsStore } from './db.js';
import { FactoryVisionApiClient, ApiRequestError } from '@factory-vision/api-client';

const api = new FactoryVisionApiClient({ baseUrl: '' });

/**
 * Offline command queue (US-045, US-046).
 *
 * Every shop-floor action is written to IndexedDB *first* and only then sent.
 * That ordering is the whole point: an operator on a factory floor with patchy
 * Wi-Fi must never lose a count because the network chose that moment to drop,
 * and the record must be identical whether it synced immediately or six hours
 * later.
 *
 * Sync goes through the batch endpoint, which reports each command
 * individually. `client_event_id` is generated once at enqueue and never
 * regenerated, so a replay after a failed response is recognised by the server
 * as a duplicate rather than being written twice.
 */

/** Server clock offset in milliseconds. */
let serverClockOffsetMs = 0;

export function syncServerClock(serverIsoTime: string) {
  const serverMs = new Date(serverIsoTime).getTime();
  const localMs = Date.now();
  serverClockOffsetMs = serverMs - localMs;
}

/**
 * Timestamps use the server's clock, not the tablet's.
 *
 * Shop-floor tablets drift, and a wrong `occurredAt` files production under the
 * wrong shift date, a data problem nobody notices until a report
 * is questioned weeks later.
 */
export function getAdjustedServerTime(): string {
  return new Date(Date.now() + serverClockOffsetMs).toISOString();
}

// --- Status observation -------------------------------------------

export interface SyncStatus {
  online: boolean;
  syncing: boolean;
  pending: number;
  failed: number;
  lastSyncedAt: string | null;
  lastError: string | null;
  /**
   * A rejection the operator has not yet seen (MES-082-4).
   *
   * Separate from `failed`, which is a standing count: this is the *event*, and
   * it is what raises a banner the operator has to dismiss. A count in a chip
   * they never tap is not being told.
   */
  rejectionNotice: { count: number; at: string; message: string } | null;
}

let status: SyncStatus = {
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  syncing: false,
  pending: 0,
  failed: 0,
  lastSyncedAt: null,
  lastError: null,
  rejectionNotice: null,
};

const listeners = new Set<(next: SyncStatus) => void>();

/** US-046: "Sync status dapat diketahui operator." */
export function subscribeSyncStatus(listener: (next: SyncStatus) => void): () => void {
  listeners.add(listener);
  listener(status);
  return () => listeners.delete(listener);
}

export function getSyncStatus(): SyncStatus {
  return status;
}

function publish(patch: Partial<SyncStatus>): void {
  status = { ...status, ...patch };
  for (const listener of listeners) listener(status);
}

async function refreshCounts(): Promise<void> {
  // The store may not exist yet: the sync engine starts before the schema
  // bootstrap finishes, and a terminal mid-deferral is a legitimate state.
  if (!(await hasCommandsStore())) return;
  const db = await getOperatorDb();
  const pending = await db.getAllFromIndex('commands', 'by-status', OfflineCommandStatus.PENDING);
  const failed = await db.getAllFromIndex('commands', 'by-status', OfflineCommandStatus.FAILED);
  publish({ pending: pending.length, failed: failed.length });
}

// --- Enqueue ------------------------------------------------------

export async function enqueueCommand(cmd: {
  tenantId: string;
  workOrderId: string;
  type: OfflineCommand['type'];
  payload: Record<string, unknown>;
}): Promise<OfflineCommand> {
  const db = await getOperatorDb();

  const entry: OfflineCommand = {
    // Generated once, here, and carried through every retry, this is what
    // makes reconnecting idempotent (US-046).
    clientEventId: uuidv4(),
    tenantId: cmd.tenantId,
    workOrderId: cmd.workOrderId,
    type: cmd.type,
    payload: cmd.payload,
    queuedAt: Date.now(),
    occurredAt: getAdjustedServerTime(),
    status: OfflineCommandStatus.PENDING,
    retryCount: 0,
  };

  const id = await db.add('commands', entry);
  entry.id = id as number;

  await refreshCounts();
  void syncQueue();

  return entry;
}

// --- Sync ---------------------------------------------------------

/** How many commands to send in one request. */
const BATCH_SIZE = 25;

/** Stop retrying after this many attempts and surface the command instead. */
const MAX_RETRIES = 5;

let syncInFlight: Promise<void> | null = null;

/**
 * Drains the queue. Concurrent callers share one run, so the button, the
 * interval and the `online` event cannot start three overlapping syncs.
 */
export function syncQueue(): Promise<void> {
  if (syncInFlight) return syncInFlight;
  syncInFlight = runSync().finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}

async function runSync(): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    publish({ online: false });
    return;
  }

  if (!(await hasCommandsStore())) return;

  const db = await getOperatorDb();
  const pending = (await db.getAllFromIndex('commands', 'by-status', OfflineCommandStatus.PENDING))
    // FIFO: a start must reach the server before the output it produced.
    .sort((a, b) => a.queuedAt - b.queuedAt)
    .slice(0, BATCH_SIZE);

  if (pending.length === 0) {
    publish({ syncing: false, online: true });
    await refreshCounts();
    return;
  }

  publish({ syncing: true, lastError: null });

  // Collected per run so the banner reports what just happened rather than the
  // standing total, which may include rejections the operator already saw.
  const rejectedThisRun: OfflineCommand[] = [];

  // Mark in-flight so a second pass cannot pick the same rows up again.
  for (const cmd of pending) {
    cmd.status = OfflineCommandStatus.SYNCING;
    if (cmd.id !== undefined) await db.put('commands', cmd);
  }

  try {
    const result = await api.syncOfflineBatch(
      pending.map((cmd) => ({
        type: cmd.type,
        clientEventId: cmd.clientEventId,
        workOrderId: cmd.workOrderId,
        occurredAt: cmd.occurredAt,
        payload: cmd.payload,
      }))
    );

    syncServerClock(result.serverTime);

    const byEventId = new Map(result.results.map((r) => [r.clientEventId, r]));

    for (const cmd of pending) {
      const outcome = byEventId.get(cmd.clientEventId);

      // APPLIED and DUPLICATE are both success from the terminal's side: the
      // server holds the event either way, so the row can be cleared.
      if (!outcome || outcome.status === 'APPLIED' || outcome.status === 'DUPLICATE') {
        cmd.status = OfflineCommandStatus.SYNCED;
        cmd.errorMessage = undefined;
      } else if (outcome.retryable && cmd.retryCount + 1 < MAX_RETRIES) {
        cmd.retryCount += 1;
        cmd.status = OfflineCommandStatus.PENDING;
        cmd.errorMessage = outcome.errorMessage;
      } else {
        // Permanently rejected, kept, never dropped, so a supervisor can see
        // exactly what the shop floor tried to record (US-046: no silent loss).
        cmd.status = OfflineCommandStatus.FAILED;
        cmd.errorMessage = outcome.errorMessage;
        rejectedThisRun.push(cmd);
      }

      if (cmd.id !== undefined) await db.put('commands', cmd);
    }

    publish({
      syncing: false,
      online: true,
      lastSyncedAt: result.serverTime,
      // MES-082-4: the operator is told, rather than left to notice a chip.
      ...(rejectedThisRun.length > 0
        ? {
            rejectionNotice: {
              count: rejectedThisRun.length,
              at: result.serverTime,
              message:
                rejectedThisRun[0].errorMessage ??
                'Server tidak menerima catatan ini. Catatan tetap tersimpan di terminal.',
            },
          }
        : {}),
    });
    await refreshCounts();

    // More waiting than one batch holds: keep going.
    const remaining = await db.getAllFromIndex('commands', 'by-status', OfflineCommandStatus.PENDING);
    if (remaining.length > 0) void syncQueue();
  } catch (error) {
    // A transport failure is not the commands' fault: return them to PENDING
    // so the next attempt retries them rather than losing them.
    for (const cmd of pending) {
      cmd.retryCount += 1;
      cmd.status = cmd.retryCount >= MAX_RETRIES ? OfflineCommandStatus.FAILED : OfflineCommandStatus.PENDING;
      cmd.errorMessage = error instanceof Error ? error.message : 'Gagal menghubungi server.';
      if (cmd.id !== undefined) await db.put('commands', cmd);
    }

    const offline = typeof navigator !== 'undefined' && !navigator.onLine;
    publish({
      syncing: false,
      online: !offline,
      lastError:
        error instanceof ApiRequestError
          ? error.message
          : offline
            ? 'Perangkat offline, antrian akan dikirim saat koneksi kembali.'
            : 'Gagal menghubungi server.',
    });
    await refreshCounts();
  }
}

/**
 * Dismisses the rejection banner (MES-082-4).
 *
 * Only the notice is cleared; the failed commands stay exactly where they are,
 * because acknowledging that something was refused is not the same as it having
 * been dealt with.
 */
export function acknowledgeRejections(): void {
  publish({ rejectionNotice: null });
}

/** Puts failed commands back in line, the operator's "coba lagi". */
export async function retryFailedCommands(): Promise<void> {
  if (!(await hasCommandsStore())) return;
  const db = await getOperatorDb();
  const failed = await db.getAllFromIndex('commands', 'by-status', OfflineCommandStatus.FAILED);
  for (const cmd of failed) {
    cmd.status = OfflineCommandStatus.PENDING;
    cmd.retryCount = 0;
    cmd.errorMessage = undefined;
    if (cmd.id !== undefined) await db.put('commands', cmd);
  }
  publish({ rejectionNotice: null });
  await refreshCounts();
  await syncQueue();
}

/**
 * How many commands still hold production the server has not acknowledged.
 *
 * PENDING, SYNCING and FAILED all count. This is what the schema upgrade asks
 * before it runs (MES-077): a non-zero answer means an upgrade would be
 * touching a database that still holds the only copy of something, so it is
 * deferred instead.
 */
export async function countUnsyncedCommands(): Promise<number> {
  if (!(await hasCommandsStore())) return 0;
  const db = await getOperatorDb();
  const unsynced = await Promise.all([
    db.getAllFromIndex('commands', 'by-status', OfflineCommandStatus.PENDING),
    db.getAllFromIndex('commands', 'by-status', OfflineCommandStatus.SYNCING),
    db.getAllFromIndex('commands', 'by-status', OfflineCommandStatus.FAILED),
  ]);
  return unsynced.reduce((total, rows) => total + rows.length, 0);
}

/** The commands a supervisor may need to inspect after a bad shift. */
export async function listFailedCommands(): Promise<OfflineCommand[]> {
  if (!(await hasCommandsStore())) return [];
  const db = await getOperatorDb();
  return db.getAllFromIndex('commands', 'by-status', OfflineCommandStatus.FAILED);
}

/** Clears synced rows so IndexedDB does not grow without bound. */
export async function pruneSyncedCommands(olderThanMs = 24 * 60 * 60 * 1000): Promise<number> {
  if (!(await hasCommandsStore())) return 0;
  const db = await getOperatorDb();
  const synced = await db.getAllFromIndex('commands', 'by-status', OfflineCommandStatus.SYNCED);
  const cutoff = Date.now() - olderThanMs;
  let removed = 0;
  for (const cmd of synced) {
    if (cmd.queuedAt < cutoff && cmd.id !== undefined) {
      await db.delete('commands', cmd.id);
      removed += 1;
    }
  }
  return removed;
}

/**
 * Starts the background drain. Called once at app start.
 *
 * A stalled queue is the failure mode that matters here, so there are three
 * independent triggers: reconnection, a periodic sweep, and enqueue itself.
 */
export function startSyncEngine(): () => void {
  const onOnline = () => {
    publish({ online: true });
    void syncQueue();
  };
  const onOffline = () => publish({ online: false });

  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);

  const interval = window.setInterval(() => {
    void syncQueue();
  }, 15_000);

  void refreshCounts();
  void syncQueue();
  void pruneSyncedCommands();

  return () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    window.clearInterval(interval);
  };
}
