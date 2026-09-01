/**
 * The object store interface (Architecture §22.5, ADR-09).
 *
 * ADR-09 requires every external dependency to sit behind an interface chosen
 * at bootstrap, with a self-hosted implementation exercised in CI. Documents
 * were the one place that rule was only half honoured: `DocumentStorage` had
 * the right shape but wrote straight to a mounted directory, so an install
 * that wanted MinIO — or two API containers behind a load balancer, where a
 * local volume is simply wrong — had nowhere to plug it in.
 *
 * This is the interface. `filesystem-object-store.ts` is the single-VPS
 * implementation, `s3-object-store.ts` the S3/MinIO one, and `index.ts` is the
 * only file that decides which is in use.
 *
 * Keys are opaque: `put` is told a key and stores exactly that, so the naming
 * scheme belongs to the caller and the store never parses meaning out of it.
 */

export interface ObjectStore {
  /** The backend in use, for the health endpoint and for tests. */
  readonly kind: 'filesystem' | 's3';

  put(key: string, body: Buffer, contentType: string): Promise<{ sizeBytes: number }>;

  /** Reads an object back. Returns `undefined` when it is not there. */
  get(key: string): Promise<Buffer | undefined>;

  /** Removes an object. Already-absent is success: the end state is the same. */
  remove(key: string): Promise<void>;

  exists(key: string): Promise<boolean>;

  /**
   * Confirms the backend is usable — the bucket exists and is writable, the
   * directory can be created. Called at bootstrap so a misconfigured store is
   * a startup complaint rather than a failed upload three days later.
   */
  check(): Promise<{ ok: boolean; detail: string }>;
}

/** Rejects a key that could escape its prefix, whatever the backend. */
export function assertSafeKey(key: string): void {
  if (
    !key ||
    key.startsWith('/') ||
    key.includes('..') ||
    key.includes('\\') ||
    key.includes('\0')
  ) {
    throw new Error(`Object key tidak valid: ${JSON.stringify(key)}`);
  }
}
