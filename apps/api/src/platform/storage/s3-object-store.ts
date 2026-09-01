import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { assertSafeKey, type ObjectStore } from './object-store.js';

/**
 * S3-compatible object storage — MinIO on a self-hosted install, or a managed
 * bucket where one is available.
 *
 * This is the implementation ADR-09 asks for: the same interface, chosen by
 * configuration, so scaling the API past one container does not mean rewriting
 * the document code. MinIO is the self-hosted target, which is why
 * `forcePathStyle` is on — MinIO addresses buckets by path, not by
 * `bucket.host` subdomain, and virtual-host addressing fails against it in a
 * way that looks like a DNS problem rather than a configuration one.
 */

export interface S3ObjectStoreOptions {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Path-style addressing. Required by MinIO; harmless on AWS. */
  forcePathStyle?: boolean;
}

/** Reads a streamed body into a Buffer. */
async function collect(body: unknown): Promise<Buffer> {
  const stream = body as AsyncIterable<Uint8Array>;
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function isMissing(error: unknown): boolean {
  const name = (error as { name?: string })?.name;
  const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
  return name === 'NoSuchKey' || name === 'NotFound' || status === 404;
}

export class S3ObjectStore implements ObjectStore {
  readonly kind = 's3' as const;

  private readonly client: S3Client;

  constructor(private readonly options: S3ObjectStoreOptions) {
    this.client = new S3Client({
      region: options.region,
      endpoint: options.endpoint,
      forcePathStyle: options.forcePathStyle ?? Boolean(options.endpoint),
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<{ sizeBytes: number }> {
    assertSafeKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentLength: body.length,
      })
    );
    return { sizeBytes: body.length };
  }

  async get(key: string): Promise<Buffer | undefined> {
    assertSafeKey(key);
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.options.bucket, Key: key })
      );
      if (!result.Body) return undefined;
      return await collect(result.Body);
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
  }

  async remove(key: string): Promise<void> {
    assertSafeKey(key);
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key })
      );
    } catch (error) {
      // S3 delete is already idempotent; MinIO agrees. Swallowing 404 keeps the
      // two backends behaving identically for the caller.
      if (!isMissing(error)) throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    assertSafeKey(key);
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.options.bucket, Key: key }));
      return true;
    } catch (error) {
      if (isMissing(error)) return false;
      throw error;
    }
  }

  async check(): Promise<{ ok: boolean; detail: string }> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.options.bucket }));
      return {
        ok: true,
        detail: `s3: ${this.options.endpoint ?? this.options.region}/${this.options.bucket}`,
      };
    } catch (error) {
      return {
        ok: false,
        detail: `bucket ${this.options.bucket} tidak dapat diakses: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  destroy(): void {
    this.client.destroy();
  }
}
