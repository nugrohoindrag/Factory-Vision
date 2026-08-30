import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { randomUUID } from 'crypto';
import type { Paginated } from '@factory-vision/domain-types';
import { ApiError } from './api-error.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Correlates a request with its log line and audit entries (US-054). */
      requestId?: string;
    }
  }
}

/**
 * Stamps every request with an id and echoes it back on the response, so a
 * console error report, a server log line and an audit row can be lined up.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-request-id'];
  req.requestId = (typeof incoming === 'string' && incoming) || randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

/**
 * Wraps a route handler so a thrown `ApiError` (or any other throw) reaches the
 * error middleware instead of crashing the process. Express 4 does not forward
 * rejections from async handlers on its own.
 */
export function route(
  handler: (req: Request<Record<string, string>>, res: Response) => unknown | Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    try {
      const result = handler(req as Request<Record<string, string>>, res);
      if (result instanceof Promise) result.catch(next);
    } catch (error) {
      next(error);
    }
  };
}

/** Reads the shared `page`/`pageSize`/`sort`/`order` query convention. */
export function readPagination(
  req: Request,
  defaults: { pageSize?: number } = {}
): {
  page: number;
  pageSize: number;
  sort?: string;
  order: 'asc' | 'desc';
} {
  const page = Math.max(1, Number(req.query.page ?? 1) || 1);
  const rawSize = Number(req.query.pageSize ?? defaults.pageSize ?? 50) || defaults.pageSize || 50;
  const pageSize = Math.min(500, Math.max(1, rawSize));
  const sort = typeof req.query.sort === 'string' ? req.query.sort : undefined;
  const order = req.query.order === 'asc' ? 'asc' : 'desc';
  return { page, pageSize, sort, order };
}

/**
 * Applies sort + slice and returns the documented pagination envelope.
 *
 * Only endpoints that declare pagination use this; the pre-existing list
 * endpoints keep returning bare arrays so the console's current callers are
 * untouched.
 */
export function paginate<T extends Record<string, unknown>>(
  rows: T[],
  opts: { page: number; pageSize: number; sort?: string; order: 'asc' | 'desc' }
): Paginated<T> {
  let sorted = rows;
  if (opts.sort) {
    const key = opts.sort;
    const direction = opts.order === 'asc' ? 1 : -1;
    sorted = [...rows].sort((a, b) => {
      const left = a[key];
      const right = b[key];
      if (left === right) return 0;
      if (left === undefined || left === null) return 1;
      if (right === undefined || right === null) return -1;
      if (typeof left === 'number' && typeof right === 'number') return (left - right) * direction;
      return String(left).localeCompare(String(right)) * direction;
    });
  }

  const totalItems = sorted.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / opts.pageSize));
  const start = (opts.page - 1) * opts.pageSize;

  return {
    data: sorted.slice(start, start + opts.pageSize),
    page: { number: opts.page, size: opts.pageSize, totalItems, totalPages },
  };
}

/** Terminal error middleware, the only place an error body is constructed. */
export function errorMiddleware(error: unknown, req: Request, res: Response, _next: NextFunction): void {
  const requestId = req.requestId ?? 'unknown';

  if (error instanceof ApiError) {
    res.status(error.status).json({
      error: { code: error.code, message: error.message, fields: error.fields, requestId },
    });
    return;
  }

  // Services written before the ApiError convention still throw plain Errors.
  // Map their message rather than losing it behind a generic 500.
  const message = error instanceof Error ? error.message : 'Terjadi kesalahan internal.';
  const looksNotFound = /not found|tidak ditemukan/i.test(message);
  const looksConflict = /cannot|invalid|already|sudah|tidak dapat/i.test(message);
  const status = looksNotFound ? 404 : looksConflict ? 409 : 500;
  const code = looksNotFound ? 'NOT_FOUND' : looksConflict ? 'INVALID_STATE' : 'INTERNAL_ERROR';

  if (status === 500) {
    // eslint-disable-next-line no-console
    console.error(`[${requestId}] Unhandled error:`, error);
  }

  res.status(status).json({ error: { code, message, requestId } });
}
