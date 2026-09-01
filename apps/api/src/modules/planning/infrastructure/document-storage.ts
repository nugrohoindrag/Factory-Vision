import path from 'path';
import { ApiError } from '../../../platform/http/api-error.js';
import { getObjectStore } from '../../../platform/storage/index.js';

/**
 * Where an order's source document actually goes (MES-025-3).
 *
 * The bytes now go to `platform/storage` — a filesystem directory on the
 * single-VPS stack, MinIO or S3 where one is configured — instead of straight
 * to a mounted path. That was the last piece of ADR-09 this module had not
 * honoured: the shape was object-store-like, but the implementation was welded
 * in, so a second API replica would have split the documents between two
 * volumes with no error to show for it.
 *
 * This class keeps what is genuinely planning's: which content types an order
 * document may have, how a document id becomes a key, and what URL the row
 * carries. The store below it knows none of that.
 *
 * The database never holds the bytes. A scanned PO is a megabyte of JPEG, and a
 * table row that size makes every query that touches it slower for no benefit.
 */

/** Extensions that may be written, keyed by the content types we accept. */
const EXTENSION_BY_TYPE: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-excel': '.xls',
  'text/csv': '.csv',
};

export interface StoredDocument {
  storageUrl: string;
  sizeBytes: number;
}

/**
 * The key an object gets.
 *
 * Tenant first, so a bucket policy or a directory listing can be scoped to one
 * factory, and so the two backends lay the documents out the same way.
 */
function objectKey(tenantId: string, objectId: string): string {
  if (!tenantId || tenantId.includes('/') || tenantId.includes('..')) {
    throw ApiError.validation('Lokasi dokumen tidak valid.');
  }
  if (!objectId || objectId.includes('/') || objectId.includes('..')) {
    throw ApiError.validation('Lokasi dokumen tidak valid.');
  }
  return `${tenantId}/${objectId}`;
}

export class DocumentStorage {
  private readonly store = getObjectStore();

  /** Writes a base64 payload and returns the URL the document row will carry. */
  async put(
    tenantId: string,
    documentId: string,
    contentType: string,
    base64: string
  ): Promise<StoredDocument> {
    const extension = EXTENSION_BY_TYPE[contentType];
    if (!extension) {
      throw ApiError.validation(`Tipe file ${contentType} tidak didukung.`, [
        {
          field: 'contentType',
          code: 'UNSUPPORTED_TYPE',
          message: `Gunakan salah satu dari: ${Object.keys(EXTENSION_BY_TYPE).join(', ')}.`,
        },
      ]);
    }

    // `from(..., 'base64')` never throws on bad input; it silently truncates,
    // so an empty result is the only signal that the payload was not base64.
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length === 0) {
      throw ApiError.validation('Isi dokumen tidak dapat dibaca.', [
        { field: 'content', code: 'INVALID_FORMAT', message: 'Konten harus base64 yang valid.' },
      ]);
    }

    const objectId = `${documentId}${extension}`;
    const written = await this.store.put(objectKey(tenantId, objectId), buffer, contentType);

    return {
      // A URL the API serves, not a storage location: the console must never
      // learn where the bytes live, so the backend can change under it.
      storageUrl: `/api/v1/customer-orders/documents/${objectId}/content`,
      sizeBytes: written.sizeBytes,
    };
  }

  /** Reads a stored object back. */
  async get(tenantId: string, objectId: string): Promise<Buffer> {
    const found = await this.store.get(objectKey(tenantId, objectId));
    if (!found) throw ApiError.notFound('Dokumen tidak ditemukan pada penyimpanan.');
    return found;
  }

  async remove(tenantId: string, objectId: string): Promise<void> {
    // Already gone is the desired end state; a missing object must not stop the
    // row being deleted.
    await this.store.remove(objectKey(tenantId, objectId));
  }

  /** The content type an object id implies, for the download response. */
  contentTypeOf(objectId: string): string {
    const extension = path.extname(objectId).toLowerCase();
    const found = Object.entries(EXTENSION_BY_TYPE).find(([, ext]) => ext === extension);
    return found?.[0] ?? 'application/octet-stream';
  }
}
