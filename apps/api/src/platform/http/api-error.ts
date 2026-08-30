import type { ApiErrorCode, ApiFieldError } from '@factory-vision/domain-types';

/**
 * The one error type every module throws (US-054).
 *
 * Route handlers never build a response body by hand: they throw an `ApiError`
 * and the error middleware turns it into the single documented envelope, so a
 * validation failure in Master Data reads exactly like one in Shop Floor.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly fields?: ApiFieldError[];

  constructor(code: ApiErrorCode, message: string, status: number, fields?: ApiFieldError[]) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.fields = fields;
  }

  static validation(message: string, fields?: ApiFieldError[]): ApiError {
    return new ApiError('VALIDATION_ERROR', message, 422, fields);
  }

  static unauthenticated(message = 'Sesi tidak valid atau telah berakhir.'): ApiError {
    return new ApiError('UNAUTHENTICATED', message, 401);
  }

  static forbidden(message = 'Anda tidak memiliki izin untuk tindakan ini.'): ApiError {
    return new ApiError('FORBIDDEN', message, 403);
  }

  static outOfScope(message = 'Data berada di luar cakupan akses Anda.'): ApiError {
    return new ApiError('OUT_OF_SCOPE', message, 403);
  }

  static notFound(message = 'Data tidak ditemukan.'): ApiError {
    return new ApiError('NOT_FOUND', message, 404);
  }

  static conflict(message: string): ApiError {
    return new ApiError('CONFLICT', message, 409);
  }

  /** A legal request against an entity whose state does not allow it. */
  static invalidState(message: string): ApiError {
    return new ApiError('INVALID_STATE', message, 409);
  }

  static internal(message = 'Terjadi kesalahan internal.'): ApiError {
    return new ApiError('INTERNAL_ERROR', message, 500);
  }
}
