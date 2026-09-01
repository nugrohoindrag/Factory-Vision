import { CustomerOrderStatus } from '@factory-vision/domain-types';
import { ApiError } from '../../../platform/http/api-error.js';

/**
 * Customer Order status derivation (MES-026).
 *
 * ```text
 * Received ──► Planned ──► In Production ──► Produced ──► (manual) Ready to Ship
 *                                                                  Shipped
 *                                                                  Completed
 * ```
 *
 * The first four are **derived from production facts, never typed**: a status a
 * planner has to remember to update is a status that is wrong by the afternoon,
 * and "when will my order be ready" is the question the whole system exists to
 * answer honestly. The last three stay manual because the MVP does not execute
 * shipping, so there is no fact to derive them from.
 *
 * Pure and side-effect free, so every rule and boundary is unit-testable.
 */

export interface OrderDerivationFacts {
  lineCount: number;
  /** Lines whose `planned_quantity >= ordered_quantity`. */
  fullyPlannedLines: number;
  /** Lines whose `produced_quantity >= ordered_quantity`. */
  fullyProducedLines: number;
  /** Work Orders serving this order that are IN_PRODUCTION or COMPLETED. */
  workOrdersInProduction: number;
  /** Work Orders serving this order at all. */
  workOrderCount: number;
}

/**
 * The derived statuses in order of progress. Derivation only ever moves an
 * order to the right along this line.
 */
const DERIVED_ORDER: CustomerOrderStatus[] = [
  CustomerOrderStatus.RECEIVED,
  CustomerOrderStatus.PLANNED,
  CustomerOrderStatus.IN_PRODUCTION,
  CustomerOrderStatus.PRODUCED,
];

/** Statuses a human sets, because no production fact implies them. */
export const MANUAL_LOGISTICS_STATUSES = [
  CustomerOrderStatus.READY_TO_SHIP,
  CustomerOrderStatus.SHIPPED,
  CustomerOrderStatus.COMPLETED,
] as const;

/**
 * The status the facts imply.
 *
 * Monotonic: derivation moves an order forward, never back. An order that
 * reached In Production does not fall back to Planned because a Work Order was
 * rescheduled — that would make the status flicker on the very screen a sales
 * person is reading to answer a customer. Cancellation and the manual logistics
 * statuses are left exactly as they are.
 */
export function deriveCustomerOrderStatus(
  current: CustomerOrderStatus,
  facts: OrderDerivationFacts
): CustomerOrderStatus {
  if (current === CustomerOrderStatus.CANCELLED) return current;
  if ((MANUAL_LOGISTICS_STATUSES as readonly CustomerOrderStatus[]).includes(current)) {
    return current;
  }

  const allLinesPlanned = facts.lineCount > 0 && facts.fullyPlannedLines >= facts.lineCount;
  const allLinesProduced = facts.lineCount > 0 && facts.fullyProducedLines >= facts.lineCount;

  let candidate = CustomerOrderStatus.RECEIVED;
  if (allLinesPlanned) candidate = CustomerOrderStatus.PLANNED;
  if (facts.workOrdersInProduction > 0) candidate = CustomerOrderStatus.IN_PRODUCTION;
  if (allLinesProduced) candidate = CustomerOrderStatus.PRODUCED;

  // Monotonic: take whichever is further along. Deriving `PLANNED` for an order
  // already In Production — which happens the moment a Work Order is
  // rescheduled out of production — would make the status flicker on the very
  // screen a sales person reads to answer the customer.
  return DERIVED_ORDER.indexOf(candidate) > DERIVED_ORDER.indexOf(current) ? candidate : current;
}

/**
 * The cancellation guard (MES-026-3).
 *
 * An order whose Work Orders have started cannot be cancelled: material has
 * been consumed and machine time spent, and pretending otherwise would leave
 * production running against demand the system says does not exist.
 */
export function assertCancellable(
  current: CustomerOrderStatus,
  facts: OrderDerivationFacts
): void {
  if (current === CustomerOrderStatus.CANCELLED) {
    throw ApiError.invalidState('Customer Order sudah dibatalkan.');
  }
  if (current === CustomerOrderStatus.COMPLETED || current === CustomerOrderStatus.SHIPPED) {
    throw ApiError.invalidState(
      `Customer Order berstatus ${current} tidak dapat dibatalkan.`
    );
  }
  if (facts.workOrdersInProduction > 0) {
    throw ApiError.invalidState(
      `Customer Order tidak dapat dibatalkan: ${facts.workOrdersInProduction} Work Order yang ` +
        'melayaninya sudah masuk produksi. Batalkan Work Order tersebut lebih dahulu.'
    );
  }
}
