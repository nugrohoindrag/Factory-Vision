/**
 * Routing validation, run before any Work Order is generated (MES-042).
 *
 * The reason this is a separate, pure step rather than checks scattered through
 * the generator: **no partial Work Orders may be stored**. A routing that fails
 * halfway through generation leaves some processes with a work order and others
 * without, and the gap shows up months later as an OEE figure nobody can
 * explain. So the whole routing is judged first, and generation either runs on a
 * valid routing or does not run at all.
 *
 * Every failure names the specific cause. "Routing tidak valid" tells a planner
 * to call IT; "sequence melompat dari 2 ke 4" tells them to open the routing
 * master and fix it.
 */

export interface RoutingStepInput {
  routingId: string;
  processId: string;
  processCode: string;
  processName: string;
  processStatus: string;
  sequence: number;
  workCenterId?: string;
  machineId?: string;
  active: boolean;
  /** Machines that can run this process for this product, if any are declared. */
  eligibleMachineCount: number;
}

export type RoutingProblemCode =
  | 'NO_ROUTING'
  | 'SEQUENCE_NOT_CONTINUOUS'
  | 'SEQUENCE_DUPLICATE'
  | 'PROCESS_INACTIVE'
  | 'ROUTING_STEP_INACTIVE'
  | 'NO_MAPPABLE_RESOURCE';

export interface RoutingProblem {
  code: RoutingProblemCode;
  processId?: string;
  processCode?: string;
  sequence?: number;
  /** Indonesian, names the specific cause. */
  message: string;
}

export class RoutingValidationError extends Error {
  readonly productId: string;
  readonly problems: RoutingProblem[];

  constructor(productId: string, problems: RoutingProblem[]) {
    super(
      `Routing product ${productId} tidak valid: ${problems.map((p) => p.message).join(' ')}`
    );
    this.name = 'RoutingValidationError';
    this.productId = productId;
    this.problems = problems;
  }
}

/**
 * Every problem with a routing, in the order they would be met.
 *
 * Continuity is checked against the *active* steps only. A deactivated step in
 * the middle of a routing leaves a hole — 1, 2, 4 — and that hole is reported as
 * the deactivation it is rather than as a mysterious numbering fault.
 */
export function validateRouting(
  productId: string,
  steps: RoutingStepInput[]
): RoutingProblem[] {
  const problems: RoutingProblem[] = [];

  if (steps.length === 0) {
    return [
      {
        code: 'NO_ROUTING',
        message:
          `Product ${productId} belum memiliki process routing. ` +
          'Tetapkan routing pada master data sebelum generate Work Order.',
      },
    ];
  }

  const inactiveSteps = steps.filter((step) => !step.active);
  for (const step of inactiveSteps) {
    problems.push({
      code: 'ROUTING_STEP_INACTIVE',
      processId: step.processId,
      processCode: step.processCode,
      sequence: step.sequence,
      message:
        `Baris routing sequence ${step.sequence} (${step.processCode}) berstatus non-aktif, ` +
        'sehingga rantai process terputus.',
    });
  }

  for (const step of steps) {
    if (step.processStatus !== 'ACTIVE') {
      problems.push({
        code: 'PROCESS_INACTIVE',
        processId: step.processId,
        processCode: step.processCode,
        sequence: step.sequence,
        message:
          `Process ${step.processCode} (${step.processName}) berstatus ${step.processStatus}. ` +
          'Aktifkan kembali process tersebut atau ubah routing product.',
      });
    }
  }

  const active = steps.filter((step) => step.active).sort((a, b) => a.sequence - b.sequence);

  const seen = new Set<number>();
  for (const step of active) {
    if (seen.has(step.sequence)) {
      problems.push({
        code: 'SEQUENCE_DUPLICATE',
        processId: step.processId,
        processCode: step.processCode,
        sequence: step.sequence,
        message:
          `Sequence ${step.sequence} dipakai lebih dari satu process (${step.processCode}); ` +
          'urutan process menjadi ambigu.',
      });
    }
    seen.add(step.sequence);
  }

  // Continuity: 1, 2, 3, … with no gaps. A routing that starts at 2 is as broken
  // as one that skips 3, because the first process is what receives the plan
  // line's planned quantity.
  if (active.length > 0) {
    if (active[0].sequence !== 1) {
      problems.push({
        code: 'SEQUENCE_NOT_CONTINUOUS',
        processId: active[0].processId,
        processCode: active[0].processCode,
        sequence: active[0].sequence,
        message:
          `Routing dimulai dari sequence ${active[0].sequence}, bukan 1. ` +
          'Process pertama harus bersequence 1.',
      });
    }
    for (let i = 1; i < active.length; i += 1) {
      const previous = active[i - 1];
      const current = active[i];
      if (current.sequence !== previous.sequence + 1) {
        problems.push({
          code: 'SEQUENCE_NOT_CONTINUOUS',
          processId: current.processId,
          processCode: current.processCode,
          sequence: current.sequence,
          message:
            `Sequence melompat dari ${previous.sequence} (${previous.processCode}) ke ` +
            `${current.sequence} (${current.processCode}); tidak ada process di antaranya.`,
        });
      }
    }
  }

  // A process with nothing that can run it cannot become a schedulable Work
  // Order, and finding that out at scheduling time means the plan is already
  // wrong.
  for (const step of active) {
    if (!step.machineId && !step.workCenterId && step.eligibleMachineCount === 0) {
      problems.push({
        code: 'NO_MAPPABLE_RESOURCE',
        processId: step.processId,
        processCode: step.processCode,
        sequence: step.sequence,
        message:
          `Process ${step.processCode} tidak memiliki mesin atau work center yang dapat dipetakan. ` +
          'Tetapkan machine/work center pada routing, atau product machine rate pada master data.',
      });
    }
  }

  return problems;
}

/** Validates and throws `RoutingValidationError` on the first invalid routing. */
export function assertRoutingValid(productId: string, steps: RoutingStepInput[]): void {
  const problems = validateRouting(productId, steps);
  if (problems.length > 0) throw new RoutingValidationError(productId, problems);
}
