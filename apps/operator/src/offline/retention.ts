import { getOperatorDb, hasStore } from './db.js';

/**
 * Local data retention on the shop-floor terminal (§9).
 *
 * A tablet on a bench holds cached Work Orders, batches and master data so a
 * shift survives a network outage. That cache is confidential production data
 * sitting outside the server, on hardware that is shared, unlocked, and
 * occasionally walks off. So it is kept for as long as the work needs it and
 * not a day longer.
 *
 * Two rules, and the order matters:
 *
 *   1. **Never delete unsynced work.** A queued command is production that
 *      happened. Everything here refuses to run while the queue holds
 *      anything pending, and clears reference data only.
 *   2. Anything older than the retention window goes, whether or not anyone
 *      logged out — a terminal that was simply left on is the normal case.
 */

/** Cached reference data older than this is dropped: one shift plus a day. */
const RETENTION_MS = 32 * 60 * 60 * 1000;

const CACHE_STORES = ['workOrders', 'batches', 'masters'] as const;

async function pendingCommandCount(): Promise<number> {
  if (!(await hasStore('commands'))) return 0;
  const db = await getOperatorDb();
  const all = await db.getAll('commands');
  return all.filter((command) => command.status !== 'SYNCED').length;
}

/**
 * Drops cached rows older than the retention window.
 *
 * Returns how many were removed, so the caller can log it rather than guess
 * whether anything happened.
 */
export async function purgeExpiredCache(now: number = Date.now()): Promise<number> {
  const cutoff = now - RETENTION_MS;
  let removed = 0;

  for (const store of CACHE_STORES) {
    if (!(await hasStore(store))) continue;
    const db = await getOperatorDb();
    const rows = await db.getAll(store);
    for (const row of rows as Array<{ cachedAt?: number }>) {
      if (typeof row.cachedAt === 'number' && row.cachedAt < cutoff) {
        const key = (row as unknown as { id?: string }).id ?? (row as unknown as { kind?: string }).kind;
        if (key) {
          await db.delete(store, key as never);
          removed += 1;
        }
      }
    }
  }

  return removed;
}

/**
 * Clears the cache at logout.
 *
 * The queue is deliberately untouched, and the clear is skipped entirely while
 * anything is still unsynced: the next operator's login flushes it. Losing a
 * shift's counts to a tidy-up would be a far worse bug than a cache that
 * lingers until the terminal is back online.
 */
export async function clearCacheOnLogout(): Promise<{ cleared: boolean; pending: number }> {
  const pending = await pendingCommandCount();
  if (pending > 0) return { cleared: false, pending };

  for (const store of CACHE_STORES) {
    if (!(await hasStore(store))) continue;
    const db = await getOperatorDb();
    await db.clear(store);
  }

  return { cleared: true, pending: 0 };
}
