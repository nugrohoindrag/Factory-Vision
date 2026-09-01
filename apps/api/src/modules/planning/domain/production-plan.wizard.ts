import { ApiError } from '../../../platform/http/api-error.js';

/**
 * The six-step Production Plan wizard (MES-037, MES-038, MES-039, §45.7).
 *
 * ```text
 * 1 Demand  →  2 Production Plan  →  3 Work Order
 *                                          ↓
 * 6 Confirmation  ←  5 Resource  ←  4 Scheduling
 * ```
 *
 * Two properties, and they pull in opposite directions on purpose:
 *
 * - **A step is locked until its prerequisite exists.** Not "until the user
 *   clicked next" — until the data is there. Scheduling work orders that have
 *   not been generated is not a thing a planner should be able to attempt.
 * - **Going back is always allowed.** Planning is iterative; a planner who
 *   discovers at Step 5 that a mould is unavailable has to be able to return to
 *   Step 2 and reduce the quantity without starting over.
 *
 * Readiness is computed from the plan's own rows, never from a flag the client
 * sends, so an abandoned wizard resumes at the right place whatever the browser
 * remembers (MES-039).
 */

export const WIZARD_STEPS = {
  DEMAND: 1,
  PRODUCTION_PLAN: 2,
  WORK_ORDER: 3,
  SCHEDULING: 4,
  RESOURCE: 5,
  CONFIRMATION: 6,
} as const;

export const WIZARD_STEP_LABELS: Record<number, string> = {
  1: 'Demand',
  2: 'Production Plan',
  3: 'Work Order',
  4: 'Scheduling',
  5: 'Resource',
  6: 'Confirmation',
};

/** The facts each step's unlock condition is judged against. */
export interface WizardReadiness {
  planId: string;
  currentStep: number;
  demandCount: number;
  lineCount: number;
  linesWithPlannedQuantity: number;
  workOrderCount: number;
  scheduledWorkOrders: number;
  resourcedWorkOrders: number;
  confirmedWorkOrders: number;
  capacityUpRequiredLines: number;
}

export interface StepAvailability {
  step: number;
  label: string;
  reachable: boolean;
  /** Indonesian, says what is missing. Empty when the step is reachable. */
  blockedBy?: string;
}

/** Whether each step can be opened, with the reason when it cannot. */
export function stepAvailability(readiness: WizardReadiness): StepAvailability[] {
  const steps: StepAvailability[] = [];

  const push = (step: number, reachable: boolean, blockedBy?: string) =>
    steps.push({ step, label: WIZARD_STEP_LABELS[step], reachable, blockedBy });

  // Step 1 is always open: it is where a plan begins.
  push(WIZARD_STEPS.DEMAND, true);

  push(
    WIZARD_STEPS.PRODUCTION_PLAN,
    readiness.demandCount > 0,
    readiness.demandCount > 0
      ? undefined
      : 'Pilih minimal satu demand pada Step 1 sebelum menentukan planned quantity.'
  );

  push(
    WIZARD_STEPS.WORK_ORDER,
    readiness.linesWithPlannedQuantity > 0,
    readiness.linesWithPlannedQuantity > 0
      ? undefined
      : 'Tentukan planned quantity minimal satu plan line pada Step 2 sebelum generate Work Order.'
  );

  push(
    WIZARD_STEPS.SCHEDULING,
    readiness.workOrderCount > 0,
    readiness.workOrderCount > 0
      ? undefined
      : 'Generate Work Order pada Step 3 sebelum menjadwalkan.'
  );

  push(
    WIZARD_STEPS.RESOURCE,
    readiness.workOrderCount > 0 && readiness.scheduledWorkOrders > 0,
    readiness.workOrderCount === 0
      ? 'Generate Work Order pada Step 3 sebelum menetapkan resource.'
      : readiness.scheduledWorkOrders > 0
        ? undefined
        : 'Jadwalkan minimal satu Work Order pada Step 4 sebelum menetapkan resource.'
  );

  const resourceComplete =
    readiness.workOrderCount > 0 && readiness.resourcedWorkOrders >= readiness.workOrderCount;
  push(
    WIZARD_STEPS.CONFIRMATION,
    resourceComplete,
    resourceComplete
      ? undefined
      : readiness.workOrderCount === 0
        ? 'Generate Work Order lebih dahulu.'
        : `${readiness.workOrderCount - readiness.resourcedWorkOrders} Work Order belum memiliki mesin dan mold.`
  );

  return steps;
}

/** The furthest step the plan's data currently supports. */
export function furthestReachableStep(readiness: WizardReadiness): number {
  const available = stepAvailability(readiness);
  let furthest: number = WIZARD_STEPS.DEMAND;
  for (const entry of available) {
    if (entry.reachable) furthest = entry.step;
    else break;
  }
  return furthest;
}

/**
 * Refuses a jump to a step whose prerequisite is not met (MES-038-5).
 *
 * Moving **backwards is never refused**: the guard only ever stops a planner
 * running ahead of the data.
 */
export function assertStepReachable(step: number, readiness: WizardReadiness): void {
  if (!Number.isInteger(step) || step < 1 || step > 6) {
    throw ApiError.validation(`Wizard step ${step} tidak valid; step 1–6.`, [
      { field: 'wizardStep', code: 'OUT_OF_RANGE', message: 'Wizard step harus 1 sampai 6.' },
    ]);
  }
  if (step <= readiness.currentStep) return;

  const target = stepAvailability(readiness).find((s) => s.step === step);
  if (target && !target.reachable) {
    throw ApiError.invalidState(
      `Step ${step} (${target.label}) belum dapat dibuka. ${target.blockedBy ?? ''}`.trim()
    );
  }
}
