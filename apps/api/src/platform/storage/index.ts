import path from 'path';
import { FilesystemObjectStore } from './filesystem-object-store.js';
import { S3ObjectStore } from './s3-object-store.js';
import type { ObjectStore } from './object-store.js';

export type { ObjectStore } from './object-store.js';
export { assertSafeKey } from './object-store.js';
export { FilesystemObjectStore } from './filesystem-object-store.js';
export { S3ObjectStore } from './s3-object-store.js';

/**
 * The one place the storage backend is chosen (ADR-09, §22.5).
 *
 * `OBJECT_STORAGE_DRIVER` decides; everything else in the codebase talks to the
 * interface. The default is `filesystem`, which is right for the single-VPS
 * stack and wrong the moment there is a second API replica — so the failure
 * mode of forgetting to configure S3 is a documented default, not a silent one.
 */

let store: ObjectStore | undefined;

function fromEnvironment(): ObjectStore {
  const driver = (process.env.OBJECT_STORAGE_DRIVER ?? 'filesystem').toLowerCase();

  if (driver === 's3' || driver === 'minio') {
    const bucket = process.env.OBJECT_STORAGE_BUCKET;
    const accessKeyId = process.env.OBJECT_STORAGE_ACCESS_KEY;
    const secretAccessKey = process.env.OBJECT_STORAGE_SECRET_KEY;

    // Refused at construction rather than at the first upload: a half-configured
    // object store that boots is a document loss waiting for a user.
    const missing = [
      !bucket && 'OBJECT_STORAGE_BUCKET',
      !accessKeyId && 'OBJECT_STORAGE_ACCESS_KEY',
      !secretAccessKey && 'OBJECT_STORAGE_SECRET_KEY',
    ].filter(Boolean);
    if (missing.length > 0) {
      throw new Error(
        `OBJECT_STORAGE_DRIVER=${driver} tetapi ${missing.join(', ')} belum diset.`
      );
    }

    return new S3ObjectStore({
      bucket: bucket!,
      region: process.env.OBJECT_STORAGE_REGION ?? 'us-east-1',
      endpoint: process.env.OBJECT_STORAGE_ENDPOINT || undefined,
      accessKeyId: accessKeyId!,
      secretAccessKey: secretAccessKey!,
      forcePathStyle: process.env.OBJECT_STORAGE_FORCE_PATH_STYLE !== 'false',
    });
  }

  if (driver !== 'filesystem') {
    throw new Error(
      `OBJECT_STORAGE_DRIVER=${driver} tidak dikenal. Gunakan 'filesystem' atau 's3'.`
    );
  }

  const root = process.env.DOCUMENT_STORAGE_DIR
    ? path.resolve(process.env.DOCUMENT_STORAGE_DIR)
    : path.resolve(process.cwd(), 'var', 'documents');
  return new FilesystemObjectStore(root);
}

export function getObjectStore(): ObjectStore {
  if (!store) store = fromEnvironment();
  return store;
}

/** Replaces the store. For tests and for a bootstrap that builds its own. */
export function setObjectStore(next: ObjectStore | undefined): void {
  store = next;
}
