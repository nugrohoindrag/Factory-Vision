import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../src/platform/http/api-error.js';
import {
  QuantityFlowService,
  QuantityFlowViolation,
} from '../src/modules/production/quantity-flow.service.js';

/**
 * Offline sync: retryable versus permanent.
 *
 * The terminal keeps a command in its queue while the server calls the failure
 * retryable, and moves it to the exception list when it does not. Getting the
 * classification wrong is not cosmetic: a command that can never succeed and is
 * marked retryable is retried until `MAX_RETRIES`, delaying every command
 * behind it and hiding the real problem from the supervisor.
 *
 * This locks in the rule the shop-floor service applies: a quantity that breaks
 * an invariant is permanent, because it will break it identically for ever.
 */

/** The classification `syncOfflineBatch` applies to a thrown error. */
function isRetryable(error: unknown): boolean {
  const apiError = error instanceof ApiError ? error : undefined;
  return !apiError || !['VALIDATION_ERROR', 'FORBIDDEN', 'NOT_FOUND'].includes(apiError.code);
}

test('a quantity invariant breach is permanent, not retryable', () => {
  // What the domain throws.
  let violation: unknown;
  try {
    QuantityFlowService.assertDelta(
      'WORK_ORDER',
      'WO-1',
      {
        inputQuantity: 0,
        outputQuantity: 0,
        rejectQuantity: 0,
        scrapQuantity: 0,
        reworkQuantity: 0,
        transferredQuantity: 0,
      },
      { outputQuantity: 100 }
    );
  } catch (error) {
    violation = error;
  }
  assert.ok(violation instanceof QuantityFlowViolation);

  // Raw, the domain error would be classified as transient — the trap this
  // guards against.
  assert.equal(isRetryable(violation), true, 'a bare domain error looks retryable');

  // Mapped to the HTTP contract the way the service does it, it is permanent.
  const mapped = ApiError.validation(
    (violation as QuantityFlowViolation).message,
    (violation as QuantityFlowViolation).violations.map((v) => ({
      field: 'goodQuantity',
      code: v.invariant,
      message: v.message,
    }))
  );
  assert.equal(isRetryable(mapped), false, 'a mapped violation must not be retried');
  assert.equal(mapped.status, 422);
  assert.ok(mapped.fields && mapped.fields.length > 0, 'the cause travels with it');
  assert.match(mapped.message, /Input 0 lebih kecil dari output 100/);
});

test('a missing work order is permanent; a transient fault is retryable', () => {
  assert.equal(isRetryable(ApiError.notFound('Work order tidak ditemukan.')), false);
  assert.equal(isRetryable(ApiError.forbidden()), false);
  assert.equal(isRetryable(ApiError.validation('Reject reason wajib diisi.')), false);

  // A database blip or an unexpected fault: the terminal should try again.
  assert.equal(isRetryable(new Error('connection terminated unexpectedly')), true);
  assert.equal(isRetryable(ApiError.internal()), true);
  assert.equal(isRetryable(ApiError.conflict('Sudah diubah orang lain.')), true);
});
