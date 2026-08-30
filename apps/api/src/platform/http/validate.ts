import type { ApiFieldError } from '@factory-vision/domain-types';
import { ApiError } from './api-error.js';

/**
 * A deliberately small request validator (US-054).
 *
 * It exists so every endpoint reports a bad request the same way: collect all
 * field failures, then throw one `VALIDATION_ERROR` carrying the complete list.
 * Failing on the first bad field would make CSV-scale payloads and multi-field
 * forms need several round trips to get right.
 */
export class Validator {
  private readonly errors: ApiFieldError[] = [];

  constructor(private readonly body: Record<string, unknown>) {}

  private fail(field: string, code: string, message: string): void {
    this.errors.push({ field, code, message });
  }

  /** Required, non-empty string. */
  string(field: string, opts: { min?: number; max?: number; optional?: boolean } = {}): string | undefined {
    const raw = this.body[field];
    if (raw === undefined || raw === null || raw === '') {
      if (!opts.optional) this.fail(field, 'REQUIRED', `${field} wajib diisi.`);
      return undefined;
    }
    if (typeof raw !== 'string') {
      this.fail(field, 'INVALID_TYPE', `${field} harus berupa teks.`);
      return undefined;
    }
    const value = raw.trim();
    if (opts.min !== undefined && value.length < opts.min) {
      this.fail(field, 'TOO_SHORT', `${field} minimal ${opts.min} karakter.`);
    }
    if (opts.max !== undefined && value.length > opts.max) {
      this.fail(field, 'TOO_LONG', `${field} maksimal ${opts.max} karakter.`);
    }
    return value;
  }

  number(
    field: string,
    opts: { min?: number; max?: number; integer?: boolean; optional?: boolean } = {}
  ): number | undefined {
    const raw = this.body[field];
    if (raw === undefined || raw === null || raw === '') {
      if (!opts.optional) this.fail(field, 'REQUIRED', `${field} wajib diisi.`);
      return undefined;
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      this.fail(field, 'INVALID_TYPE', `${field} harus berupa angka.`);
      return undefined;
    }
    if (opts.integer && !Number.isInteger(value)) {
      this.fail(field, 'INVALID_FORMAT', `${field} harus berupa bilangan bulat.`);
    }
    if (opts.min !== undefined && value < opts.min) {
      this.fail(field, 'OUT_OF_RANGE', `${field} minimal ${opts.min}.`);
    }
    if (opts.max !== undefined && value > opts.max) {
      this.fail(field, 'OUT_OF_RANGE', `${field} maksimal ${opts.max}.`);
    }
    return value;
  }

  boolean(field: string, opts: { optional?: boolean } = {}): boolean | undefined {
    const raw = this.body[field];
    if (raw === undefined || raw === null) {
      if (!opts.optional) this.fail(field, 'REQUIRED', `${field} wajib diisi.`);
      return undefined;
    }
    if (typeof raw === 'boolean') return raw;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    this.fail(field, 'INVALID_TYPE', `${field} harus berupa true/false.`);
    return undefined;
  }

  oneOf<T extends string>(
    field: string,
    allowed: readonly T[],
    opts: { optional?: boolean } = {}
  ): T | undefined {
    const raw = this.body[field];
    if (raw === undefined || raw === null || raw === '') {
      if (!opts.optional) this.fail(field, 'REQUIRED', `${field} wajib diisi.`);
      return undefined;
    }
    if (typeof raw !== 'string' || !allowed.includes(raw as T)) {
      this.fail(field, 'INVALID_VALUE', `${field} harus salah satu dari: ${allowed.join(', ')}.`);
      return undefined;
    }
    return raw as T;
  }

  /** ISO-8601 timestamp or `YYYY-MM-DD` date. */
  isoDate(field: string, opts: { optional?: boolean } = {}): string | undefined {
    const raw = this.body[field];
    if (raw === undefined || raw === null || raw === '') {
      if (!opts.optional) this.fail(field, 'REQUIRED', `${field} wajib diisi.`);
      return undefined;
    }
    if (typeof raw !== 'string' || Number.isNaN(Date.parse(raw))) {
      this.fail(field, 'INVALID_FORMAT', `${field} harus berupa tanggal ISO yang valid.`);
      return undefined;
    }
    return raw;
  }

  /** `HH:mm`, used by shift configuration (US-021). */
  clockTime(field: string, opts: { optional?: boolean } = {}): string | undefined {
    const raw = this.body[field];
    if (raw === undefined || raw === null || raw === '') {
      if (!opts.optional) this.fail(field, 'REQUIRED', `${field} wajib diisi.`);
      return undefined;
    }
    if (typeof raw !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) {
      this.fail(field, 'INVALID_FORMAT', `${field} harus dalam format HH:mm.`);
      return undefined;
    }
    return raw;
  }

  email(field: string, opts: { optional?: boolean } = {}): string | undefined {
    const value = this.string(field, opts);
    if (value === undefined) return undefined;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      this.fail(field, 'INVALID_FORMAT', `${field} harus berupa alamat email yang valid.`);
      return undefined;
    }
    return value.toLowerCase();
  }

  stringArray(field: string, opts: { optional?: boolean } = {}): string[] | undefined {
    const raw = this.body[field];
    if (raw === undefined || raw === null) {
      if (!opts.optional) this.fail(field, 'REQUIRED', `${field} wajib diisi.`);
      return undefined;
    }
    if (!Array.isArray(raw) || raw.some((v) => typeof v !== 'string')) {
      this.fail(field, 'INVALID_TYPE', `${field} harus berupa daftar teks.`);
      return undefined;
    }
    return raw as string[];
  }

  /** Record an error a type check cannot express (a cross-field rule). */
  reject(field: string, code: string, message: string): void {
    this.fail(field, code, message);
  }

  /** Throws when anything failed. Call once, at the end of parsing. */
  done(message = 'Data yang dikirim tidak valid.'): void {
    if (this.errors.length > 0) throw ApiError.validation(message, this.errors);
  }
}

export function validate(body: unknown): Validator {
  return new Validator((body ?? {}) as Record<string, unknown>);
}
