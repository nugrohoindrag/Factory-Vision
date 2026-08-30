import type { ApiErrorCode, ApiFieldError } from '@factory-vision/domain-types';
import { notifyAuthExpired } from './auth-store.js';

/**
 * The client-side view of the API's error envelope (US-054).
 *
 * Screens need more than a message: a form wants `fields` so it can mark the
 * offending input, and a queued offline command needs to know whether the
 * failure is worth retrying. Keeping that on the thrown error means every
 * caller gets it without re-parsing the response.
 */
export class ApiRequestError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly fields: ApiFieldError[];
  readonly requestId?: string;
  readonly endpoint: string;

  constructor(init: {
    code: ApiErrorCode;
    message: string;
    status: number;
    fields?: ApiFieldError[];
    requestId?: string;
    endpoint: string;
  }) {
    super(init.message);
    this.name = 'ApiRequestError';
    this.code = init.code;
    this.status = init.status;
    this.fields = init.fields ?? [];
    this.requestId = init.requestId;
    this.endpoint = init.endpoint;
  }

  static from(response: Response, body: unknown, endpoint: string): ApiRequestError {
    const envelope = (
      body as {
        error?: { code?: ApiErrorCode; message?: string; fields?: ApiFieldError[]; requestId?: string };
      }
    )?.error;
    // Endpoints written before the envelope still answer `{ message }`.
    const legacyMessage = (body as { message?: string })?.message;

    const error = new ApiRequestError({
      code: envelope?.code ?? statusToCode(response.status),
      message: envelope?.message ?? legacyMessage ?? `HTTP ${response.status}: ${response.statusText}`,
      status: response.status,
      fields: envelope?.fields,
      requestId: envelope?.requestId ?? response.headers.get('X-Request-Id') ?? undefined,
      endpoint,
    });

    // A dead session must not leave the user staring at empty tables; the app
    // shell listens for this and returns them to the login screen.
    if (error.status === 401) notifyAuthExpired;

    return error;
  }

  /** True when retrying the same request could plausibly succeed. */
  get retryable(): boolean {
    return this.status >= 500 || this.status === 429;
  }

  /** Message for a specific form field, if the server reported one. */
  fieldMessage(field: string): string | undefined {
    return this.fields.find((f) => f.field === field)?.message;
  }
}

function statusToCode(status: number): ApiErrorCode {
  switch (status) {
    case 401:
      return 'UNAUTHENTICATED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 422:
      return 'VALIDATION_ERROR';
    case 429:
      return 'RATE_LIMITED';
    default:
      return status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_ERROR';
  }
}
