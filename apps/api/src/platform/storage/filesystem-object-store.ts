import fs from 'fs/promises';
import path from 'path';
import { assertSafeKey, type ObjectStore } from './object-store.js';

/**
 * The self-hosted default: a mounted directory.
 *
 * Correct for the single-VPS stack `deploy/docker-compose.yml` describes, where
 * one API container owns one volume. It stops being correct the moment there is
 * a second API container — two replicas would each hold half the documents —
 * which is exactly why the S3 implementation exists beside it rather than
 * instead of it.
 *
 * Traversal is refused rather than sanitised: a key that escapes the root is a
 * bug or an attack, and quietly rewriting it would hide both.
 */
export class FilesystemObjectStore implements ObjectStore {
  readonly kind = 'filesystem' as const;

  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    assertSafeKey(key);
    const base = path.resolve(this.root);
    const resolved = path.resolve(base, key);
    if (resolved !== base && !resolved.startsWith(base + path.sep)) {
      throw new Error(`Object key keluar dari root penyimpanan: ${key}`);
    }
    return resolved;
  }

  async put(key: string, body: Buffer): Promise<{ sizeBytes: number }> {
    const target = this.resolve(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, body);
    return { sizeBytes: body.length };
  }

  async get(key: string): Promise<Buffer | undefined> {
    try {
      return await fs.readFile(this.resolve(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await fs.unlink(this.resolve(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.stat(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async check(): Promise<{ ok: boolean; detail: string }> {
    try {
      await fs.mkdir(this.root, { recursive: true });
      // Writability is the thing that actually fails in production — a
      // read-only mount, or a volume owned by another uid — and `mkdir` on an
      // existing directory would not catch it.
      const probe = path.join(this.root, '.write-probe');
      await fs.writeFile(probe, 'ok');
      await fs.unlink(probe);
      return { ok: true, detail: `filesystem: ${this.root}` };
    } catch (error) {
      return {
        ok: false,
        detail: `filesystem ${this.root} tidak dapat ditulis: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }
}
