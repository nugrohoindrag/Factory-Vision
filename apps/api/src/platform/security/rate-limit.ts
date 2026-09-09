import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ApiError } from '../http/api-error.js';
import { recordRefusal } from './security-events.js';

/**
 * Rate limiting and brute-force lockout (§7, §8, §30).
 *
 * Two different jobs live here because they answer two different questions:
 *
 *   RequestLimiter    how often may this caller ask at all
 *   CredentialGuard   how many times may this identity be wrong
 *
 * Both are keyed on more than the client address. A plant reaches the API
 * through one egress IP, so an IP-only limit either locks the whole shop floor
 * out or protects nothing at all — the operator terminal is the case that
 * makes this concrete, since a four-key PIN pad is the smallest keyspace in
 * the product.
 *
 * State is in-process. That is honest for a single API container and is what
 * the pilot runs; a second replica needs a shared store, and until then two
 * replicas mean two independent counters.
 */

interface Attempt {
  hits: number[];
  lockedUntil?: number;
}

const now = (): number => Date.now();

function prune(attempt: Attempt, windowMs: number): void {
  const cutoff = now() - windowMs;
  attempt.hits = attempt.hits.filter((hit) => hit > cutoff);
}

export class RequestLimiter {
  private readonly attempts = new Map<string, Attempt>();

  constructor(
    private readonly options: { limit: number; windowMs: number; sweepEvery?: number }
  ) {}

  /** Returns the seconds to wait, or 0 when the call is allowed. */
  consume(key: string): number {
    const attempt = this.attempts.get(key) ?? { hits: [] };
    prune(attempt, this.options.windowMs);

    if (attempt.hits.length >= this.options.limit) {
      const oldest = attempt.hits[0];
      this.attempts.set(key, attempt);
      return Math.max(1, Math.ceil((oldest + this.options.windowMs - now()) / 1000));
    }

    attempt.hits.push(now());
    this.attempts.set(key, attempt);
    if (this.attempts.size > (this.options.sweepEvery ?? 5000)) this.sweep();
    return 0;
  }

  private sweep(): void {
    for (const [key, attempt] of this.attempts) {
      prune(attempt, this.options.windowMs);
      if (attempt.hits.length === 0) this.attempts.delete(key);
    }
  }

  reset(key?: string): void {
    if (key) this.attempts.delete(key);
    else this.attempts.clear();
  }
}

/**
 * Failed-credential counter with a temporary lock (§7).
 *
 * The lock is temporary by design: a permanent lock keyed on something an
 * attacker controls is a denial-of-service tool pointed at the factory that
 * has to make product tonight.
 */
export class CredentialGuard {
  private readonly attempts = new Map<string, Attempt>();

  constructor(
    private readonly options: { limit: number; windowMs: number; lockMs: number }
  ) {}

  /** Seconds remaining on an active lock, or 0 when the identity may try. */
  secondsLocked(key: string): number {
    const attempt = this.attempts.get(key);
    if (!attempt?.lockedUntil) return 0;
    if (attempt.lockedUntil <= now()) {
      attempt.lockedUntil = undefined;
      attempt.hits = [];
      return 0;
    }
    return Math.max(1, Math.ceil((attempt.lockedUntil - now()) / 1000));
  }

  assertAvailable(key: string, message: string): void {
    const seconds = this.secondsLocked(key);
    if (seconds > 0) throw ApiError.rateLimited(message, seconds);
  }

  /** Records one failure. Returns true when this failure caused the lock. */
  recordFailure(key: string): boolean {
    const attempt = this.attempts.get(key) ?? { hits: [] };
    prune(attempt, this.options.windowMs);
    attempt.hits.push(now());

    const locked = attempt.hits.length >= this.options.limit;
    if (locked) {
      attempt.lockedUntil = now() + this.options.lockMs;
      attempt.hits = [];
    }
    this.attempts.set(key, attempt);
    return locked;
  }

  recordSuccess(key: string): void {
    this.attempts.delete(key);
  }

  reset(): void {
    this.attempts.clear();
  }
}

/**
 * Client identity for limiting, in the order it can be trusted: an
 * authenticated session first, then the forwarded address, then the socket.
 */
export function clientKey(req: Request): string {
  const principal = req.principal;
  if (principal) return `session:${principal.sessionId}`;
  const forwarded = req.headers['x-forwarded-for'];
  const address =
    (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]?.trim()) || req.ip || 'unknown';
  return `ip:${address}`;
}

/** Lower-cased identity from the request body, used to key credential limits. */
export function bodyKey(req: Request, ...fields: string[]): string {
  const body = (req.body ?? {}) as Record<string, unknown>;
  for (const field of fields) {
    const value = body[field];
    if (typeof value === 'string' && value.trim()) return value.trim().toLowerCase();
  }
  return 'unknown';
}

/**
 * Express middleware form. `key` receives the request so a route can limit per
 * account, per terminal, or per session rather than only per address.
 */
export function rateLimit(options: {
  limit: number;
  windowMs: number;
  message: string;
  key?: (req: Request) => string;
}): RequestHandler {
  const limiter = new RequestLimiter({ limit: options.limit, windowMs: options.windowMs });
  return (req: Request, _res: Response, next: NextFunction) => {
    const key = options.key ? options.key(req) : clientKey(req);
    const retryAfter = limiter.consume(key);
    if (retryAfter > 0) {
      recordRefusal('RATE_LIMIT_HIT', `Rate limit reached on ${req.method} ${req.path}`, {
        ip: req.ip,
        detail: { key, retryAfter },
      });
      return next(ApiError.rateLimited(options.message, retryAfter));
    }
    next();
  };
}

/**
 * The shared guards. Login and PIN are separate instances so that a locked
 * office account never blocks a shop-floor terminal, and the other way round.
 */
export const loginGuard = new CredentialGuard({ limit: 8, windowMs: 15 * 60_000, lockMs: 15 * 60_000 });
export const pinGuard = new CredentialGuard({ limit: 6, windowMs: 10 * 60_000, lockMs: 10 * 60_000 });
export const internalLoginGuard = new CredentialGuard({
  limit: 5,
  windowMs: 15 * 60_000,
  lockMs: 30 * 60_000,
});
