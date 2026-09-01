import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CustomerOrderStatus,
  ProductionBatchStatus,
  WorkOrderStatus,
} from '@factory-vision/domain-types';
import {
  QuantityFlowService,
  QuantityFlowViolation,
} from '../src/modules/production/quantity-flow.service.js';
import { WorkOrderStateMachine } from '../src/modules/production/work-order.state-machine.js';
import { BatchStateMachine } from '../src/modules/production/batch.state-machine.js';
import { validateRouting } from '../src/modules/production/routing-validation.js';
import {
  computeForecast,
  lookbackMonths,
  currentMonth,
} from '../src/modules/planning/domain/demand-forecast.engine.js';
import {
  assessCapacity,
  calculateCapacity,
  determineCapacityStatus,
  shiftMinutes,
  daysInPeriod,
} from '../src/modules/planning/domain/capacity.engine.js';
import { CapacityStatus } from '@factory-vision/domain-types';
import {
  stepAvailability,
  furthestReachableStep,
  assertStepReachable,
} from '../src/modules/planning/domain/production-plan.wizard.js';
import { deriveCustomerOrderStatus } from '../src/modules/planning/domain/customer-order.status.js';

/**
 * Final QA — business rules verified against the source of truth.
 *
 * These test the *rules*, not the plumbing: each case is traceable to a clause
 * in the Technical Design or the PRD, and several are the worked examples those
 * documents give. Where a document states a number, the number is asserted.
 */

// ===========================================================================
// §10 Production Quantity Flow — the worked example
// ===========================================================================

test('§10 worked example: four processes yield 9.600 finished, not 38.750', () => {
  // The exact figures from Technical Design §10 "Contoh".
  const injection = {
    inputQuantity: 10_000,
    outputQuantity: 9_800,
    rejectQuantity: 100,
    scrapQuantity: 100,
    reworkQuantity: 0,
    transferredQuantity: 9_800,
  };
  const painting = {
    inputQuantity: 9_800,
    outputQuantity: 9_700,
    rejectQuantity: 50,
    scrapQuantity: 0,
    reworkQuantity: 50,
    transferredQuantity: 9_700,
  };
  const subAssy = {
    inputQuantity: 9_700,
    outputQuantity: 9_650,
    rejectQuantity: 50,
    scrapQuantity: 0,
    reworkQuantity: 0,
    transferredQuantity: 9_650,
  };
  const mainAssy = {
    inputQuantity: 9_650,
    outputQuantity: 9_600,
    rejectQuantity: 50,
    scrapQuantity: 0,
    reworkQuantity: 0,
    transferredQuantity: 9_600,
  };

  for (const [name, flow] of Object.entries({ injection, painting, subAssy, mainAssy })) {
    assert.deepEqual(QuantityFlowService.check(flow), [], `${name} must satisfy every invariant`);
    assert.equal(QuantityFlowService.workInProgress(flow), 0, `${name} WIP must be zero`);
  }

  // Finished goods = the LAST process's output. Summing across processes is the
  // double-counting §8 A2 forbids.
  assert.equal(mainAssy.outputQuantity, 9_600);
  const wrong = injection.outputQuantity + painting.outputQuantity + subAssy.outputQuantity + mainAssy.outputQuantity;
  assert.equal(wrong, 38_750, 'the documented wrong answer, kept as a guard against regressing to it');
  assert.notEqual(mainAssy.outputQuantity, wrong);
});

test('§10: available quantity to the successor is transferred minus own input', () => {
  // §13: available = Σ predecessor.transferred − Σ successor.input
  assert.equal(QuantityFlowService.availableQuantity(9_800, 0), 9_800);
  assert.equal(QuantityFlowService.availableQuantity(9_800, 9_800), 0);
  // Never negative: a successor that took more than was handed over is a data
  // problem to report, not a negative recommendation to render.
  assert.equal(QuantityFlowService.availableQuantity(9_800, 10_000), 0);
});

test('§10: rework is a terminal bucket, counted once and never re-looped', () => {
  // 50 units reworked leave the flow; they are not added back to output.
  const flow = {
    inputQuantity: 100,
    outputQuantity: 40,
    rejectQuantity: 5,
    scrapQuantity: 5,
    reworkQuantity: 50,
    transferredQuantity: 40,
  };
  assert.deepEqual(QuantityFlowService.check(flow, { completed: true }), []);
  assert.equal(QuantityFlowService.workInProgress(flow), 0);
});

// ===========================================================================
// §9 Batch `<=` vs Split `=` — the deliberate asymmetry
// ===========================================================================

test('§9: batch total may be less than the WO, split must divide it exactly', () => {
  // §9's worked example: 3 × 25.000 against a WO of 100.000 leaves 25.000 of
  // remaining batch capacity, which is valid.
  QuantityFlowService.assertBatchPlannedWithinWorkOrder('wo-1', 100_000, 75_000);
  QuantityFlowService.assertBatchPlannedWithinWorkOrder('wo-1', 100_000, 100_000);
  assert.throws(
    () => QuantityFlowService.assertBatchPlannedWithinWorkOrder('wo-1', 100_000, 125_000),
    QuantityFlowViolation
  );

  // Split divides the work exhaustively: less means work has gone missing.
  QuantityFlowService.assertSplitPlannedExact('wo-1', 100_000, 100_000);
  assert.throws(
    () => QuantityFlowService.assertSplitPlannedExact('wo-1', 100_000, 75_000),
    QuantityFlowViolation
  );
  assert.throws(
    () => QuantityFlowService.assertSplitPlannedExact('wo-1', 100_000, 125_000),
    QuantityFlowViolation
  );
});

test('§9 Q4: actual batch quantity is not bounded by planned', () => {
  // 24.800 + 25.000 + 24.900 against 25.000 planned each — over and under are
  // both legal, because actual is what happened.
  const overproduced = {
    plannedQuantity: 25_000,
    inputQuantity: 25_200,
    outputQuantity: 25_100,
    rejectQuantity: 100,
    scrapQuantity: 0,
    reworkQuantity: 0,
    transferredQuantity: 25_100,
  };
  assert.deepEqual(QuantityFlowService.check(overproduced), []);
});

// ===========================================================================
// §11 / §12 State machines
// ===========================================================================

test('§11: stopping production does not move the Work Order', () => {
  // There is no status to stop into: the WO stays IN_PRODUCTION and the stop is
  // a downtime record plus a machine state change.
  const targets = WorkOrderStateMachine.allowedTargets(WorkOrderStatus.IN_PRODUCTION);
  assert.deepEqual(targets.sort(), [WorkOrderStatus.CANCELLED, WorkOrderStatus.COMPLETED].sort());
});

test('§11: COMPLETED sets actual_end and drives the machine to IDLE', () => {
  const decision = WorkOrderStateMachine.evaluate(
    WorkOrderStatus.IN_PRODUCTION,
    WorkOrderStatus.COMPLETED,
    { activeDowntimeCount: 0 }
  );
  assert.ok(decision.allowed);
  assert.equal(decision.effects.setActualEnd, true);
  assert.equal(decision.effects.machineState, 'IDLE');
  assert.equal(decision.effects.aggregateOnCompletion, true);
});

test('§12: a batch cancelled does not cancel its Work Order', () => {
  const decision = BatchStateMachine.evaluate(
    ProductionBatchStatus.IN_PRODUCTION,
    ProductionBatchStatus.CANCELLED,
    { reason: 'Material habis' }
  );
  assert.ok(decision.allowed);
  assert.equal(decision.effects.releaseRemainingPlanned, true);
  // Recorded quantity still counts; only the untouched remainder is released.
  assert.equal(decision.effects.aggregateToWorkOrder, undefined);
});

test('§11/§15: mold is on the checklist only where the product declares one', () => {
  const base = {
    plannedQuantity: 100,
    plannedStart: '2026-09-01T00:00:00.000Z',
    plannedEnd: '2026-09-02T00:00:00.000Z',
    machineId: 'mc-01',
    shiftId: 'shift-1',
    assignedOperatorIds: ['op-001'],
    incompatibleResources: [],
    openScheduleConflicts: [],
  };

  // A moulding product: no mold assigned means the checklist is incomplete.
  const moulded = WorkOrderStateMachine.evaluate(
    WorkOrderStatus.SCHEDULED,
    WorkOrderStatus.CONFIRMED,
    { ...base, moldRequired: true }
  );
  assert.equal(moulded.allowed, false);
  assert.match(moulded.reasons.join(' '), /Mold belum ditetapkan/);

  // Assign one and it passes.
  assert.equal(
    WorkOrderStateMachine.evaluate(WorkOrderStatus.SCHEDULED, WorkOrderStatus.CONFIRMED, {
      ...base,
      moldRequired: true,
      moldId: 'mold-01',
    }).allowed,
    true
  );

  // A product with no declared mold compatibility has no mold to assign, so the
  // item does not apply — otherwise confirmation would be impossible, not
  // careful.
  assert.equal(
    WorkOrderStateMachine.evaluate(WorkOrderStatus.SCHEDULED, WorkOrderStatus.CONFIRMED, {
      ...base,
      moldRequired: false,
    }).allowed,
    true
  );
});

// ===========================================================================
// MES-042 Routing validation
// ===========================================================================

const step = (over: Partial<Parameters<typeof validateRouting>[1][number]> = {}) => ({
  routingId: 'r1',
  processId: 'p1',
  processCode: 'INJ',
  processName: 'Injection',
  processStatus: 'ACTIVE',
  sequence: 1,
  active: true,
  eligibleMachineCount: 2,
  ...over,
});

test('MES-042: a discontinuous sequence is refused, naming the gap', () => {
  const problems = validateRouting('prod-1', [
    step({ sequence: 1, processCode: 'INJ', processId: 'p1' }),
    step({ sequence: 2, processCode: 'PNT', processId: 'p2' }),
    step({ sequence: 4, processCode: 'ASM', processId: 'p3' }),
  ]);
  const gap = problems.find((p) => p.code === 'SEQUENCE_NOT_CONTINUOUS');
  assert.ok(gap);
  assert.match(gap.message, /melompat dari 2 \(PNT\) ke 4 \(ASM\)/);
});

test('MES-042: an inactive process is refused by name, not generically', () => {
  const problems = validateRouting('prod-1', [
    step({ processStatus: 'INACTIVE', processCode: 'PNT' }),
  ]);
  const inactive = problems.find((p) => p.code === 'PROCESS_INACTIVE');
  assert.ok(inactive);
  assert.match(inactive.message, /PNT/);
  assert.match(inactive.message, /INACTIVE/);
});

test('MES-042: a process with nothing that can run it is refused', () => {
  const problems = validateRouting('prod-1', [
    step({ eligibleMachineCount: 0, machineId: undefined, workCenterId: undefined }),
  ]);
  assert.ok(problems.some((p) => p.code === 'NO_MAPPABLE_RESOURCE'));
});

test('MES-042: a routing that starts at 2 is refused', () => {
  const problems = validateRouting('prod-1', [step({ sequence: 2 })]);
  assert.ok(problems.some((p) => p.code === 'SEQUENCE_NOT_CONTINUOUS'));
});

test('MES-042: a product with no routing is refused with a usable message', () => {
  const problems = validateRouting('prod-1', []);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].code, 'NO_ROUTING');
  assert.match(problems[0].message, /belum memiliki process routing/);
});

test('MES-042: a valid routing produces no problems', () => {
  assert.deepEqual(
    validateRouting('prod-1', [
      step({ sequence: 1, processId: 'p1', processCode: 'INJ' }),
      step({ sequence: 2, processId: 'p2', processCode: 'PNT' }),
      step({ sequence: 3, processId: 'p3', processCode: 'ASM' }),
    ]),
    []
  );
});

// ===========================================================================
// §45.5 Demand Forecast rules
// ===========================================================================

test('§45.5: the current month is excluded from every lookback', () => {
  const asOf = new Date('2026-08-31T00:00:00Z');
  for (const lookback of [3, 6, 12] as const) {
    const months = lookbackMonths(asOf, lookback);
    assert.equal(months.length, lookback);
    assert.ok(!months.includes(currentMonth(asOf)), `${lookback}-month window must exclude 2026-08`);
    assert.equal(months[months.length - 1], '2026-07', 'window ends at the last complete month');
  }
  assert.deepEqual(lookbackMonths(asOf, 3), ['2026-05', '2026-06', '2026-07']);
});

test('§45.5: an empty month counts as zero, it is not skipped', () => {
  const asOf = new Date('2026-08-15T00:00:00Z');
  const [line] = computeForecast(
    [
      { productId: 'p1', month: '2026-06', quantity: 300 },
      { productId: 'p1', month: '2026-07', quantity: 300 },
    ],
    { lookback: 3, asOf }
  );

  // Three months in the window, one of them empty. Average is 600/3 = 200 —
  // NOT 600/2 = 300, which is what skipping the empty month would give.
  assert.equal(Object.keys(line.historicalDemand).length, 3);
  assert.equal(line.historicalDemand['2026-05'], 0);
  assert.equal(line.averageDemand, 200);
  assert.equal(line.forecastQuantity, 200);
});

test('§45.5: insufficient history is flagged, and still produces a number', () => {
  const asOf = new Date('2026-08-15T00:00:00Z');
  const [line] = computeForecast([{ productId: 'p1', month: '2026-07', quantity: 600 }], {
    lookback: 6,
    asOf,
  });
  assert.equal(line.insufficientHistory, true, 'one month of six must be flagged');
  assert.equal(line.monthsWithHistory, 1);
  assert.equal(line.forecastQuantity, 100, 'the number is still produced: 600 / 6');
});

test('§45.5: a month outside the window never leaks into the average', () => {
  const asOf = new Date('2026-08-15T00:00:00Z');
  const [line] = computeForecast(
    [
      { productId: 'p1', month: '2026-01', quantity: 99_999 },
      { productId: 'p1', month: '2026-07', quantity: 300 },
      { productId: 'p1', month: '2026-08', quantity: 99_999 },
    ],
    { lookback: 3, asOf }
  );
  assert.equal(line.averageDemand, 100, '300 / 3, with January and August excluded');
});

test('§45.5: forecast rounds up, so planning is never a piece short', () => {
  const asOf = new Date('2026-08-15T00:00:00Z');
  const [line] = computeForecast([{ productId: 'p1', month: '2026-07', quantity: 100 }], {
    lookback: 3,
    asOf,
  });
  assert.equal(line.averageDemand, 33.33);
  assert.equal(line.forecastQuantity, 34);
});

// ===========================================================================
// §45.6 Capacity — the worked example and the three statuses
// ===========================================================================

test('§45.6 worked example: 12.500 total, 10.000 planning, 2.500 buffer', () => {
  // One machine, a cycle time and an availability that produce the documented
  // 12.500. 12.500 units × 60 s = 750.000 s = 12.500 minutes.
  const calculation = calculateCapacity(
    [
      {
        machineId: 'mc-1',
        machineCode: 'MC-01',
        machineName: 'Injection 1',
        lineId: 'line-1',
        plantId: 'plant-1',
        machineStatus: 'ACTIVE',
        idealCycleTimeSeconds: 60,
        availableMinutes: 12_500,
      },
    ],
    80
  );

  assert.equal(calculation.totalCapacity, 12_500);
  assert.equal(calculation.planningCapacity, 10_000);
  assert.equal(calculation.capacityBuffer, 2_500);
  // Buffer and planning capacity must always reconstruct the total.
  assert.equal(calculation.planningCapacity + calculation.capacityBuffer, calculation.totalCapacity);
});

test('§45.6 worked example: demand 13.000 against 12.500 gives a gap of 500', () => {
  const assessment = assessCapacity(
    [
      {
        machineId: 'mc-1',
        machineCode: 'MC-01',
        machineName: 'Injection 1',
        lineId: 'line-1',
        plantId: 'plant-1',
        machineStatus: 'ACTIVE',
        idealCycleTimeSeconds: 60,
        availableMinutes: 12_500,
      },
    ],
    80,
    13_000
  );
  assert.equal(assessment.capacityGap, 500);
  assert.equal(assessment.capacityStatus, CapacityStatus.CAPACITY_UP_REQUIRED);
});

test('§45.6: the three statuses at their exact boundaries', () => {
  const total = 12_500;
  const planning = 10_000;

  // Demand == Planning Capacity is Within Plan (the rule is ≤, not <).
  assert.equal(determineCapacityStatus(10_000, total, planning), CapacityStatus.WITHIN_PLAN);
  assert.equal(determineCapacityStatus(10_001, total, planning), CapacityStatus.ADDITIONAL_DEMAND);
  // Demand == Total Capacity is still Additional Demand.
  assert.equal(determineCapacityStatus(12_500, total, planning), CapacityStatus.ADDITIONAL_DEMAND);
  assert.equal(determineCapacityStatus(12_501, total, planning), CapacityStatus.CAPACITY_UP_REQUIRED);
  assert.equal(determineCapacityStatus(0, total, planning), CapacityStatus.WITHIN_PLAN);
});

test('§45.6: a machine with no cycle time is reported, never counted as zero', () => {
  const calculation = calculateCapacity(
    [
      {
        machineId: 'mc-1',
        machineCode: 'MC-01',
        machineName: 'Injection 1',
        lineId: 'line-1',
        plantId: 'plant-1',
        machineStatus: 'ACTIVE',
        idealCycleTimeSeconds: 60,
        availableMinutes: 6_000,
      },
      {
        machineId: 'mc-2',
        machineCode: 'MC-02',
        machineName: 'Injection 2',
        lineId: 'line-1',
        plantId: 'plant-1',
        machineStatus: 'ACTIVE',
        // No rate for this product/machine pair.
        availableMinutes: 6_000,
      },
    ],
    80
  );

  assert.equal(calculation.totalCapacity, 6_000, 'only the machine with a rate contributes');
  assert.equal(calculation.uncomputedMachines.length, 1);
  assert.equal(calculation.uncomputedMachines[0].reason, 'NO_IDEAL_CYCLE_TIME');
  assert.match(calculation.uncomputedMachines[0].message, /bukan berarti kapasitasnya nol/);
  // And it must not appear as a zero-capacity contribution either.
  assert.equal(calculation.contributions.length, 1);
});

test('§45.6: an inactive machine is excluded and reported', () => {
  const calculation = calculateCapacity(
    [
      {
        machineId: 'mc-1',
        machineCode: 'MC-01',
        machineName: 'Injection 1',
        lineId: 'line-1',
        plantId: 'plant-1',
        machineStatus: 'MAINTENANCE',
        idealCycleTimeSeconds: 60,
        availableMinutes: 6_000,
      },
    ],
    80
  );
  assert.equal(calculation.totalCapacity, 0);
  assert.equal(calculation.uncomputedMachines[0].reason, 'MACHINE_INACTIVE');
});

test('§45.6: planned downtime comes off available time before capacity', () => {
  const withoutDowntime = calculateCapacity(
    [
      {
        machineId: 'mc-1',
        machineCode: 'MC-01',
        machineName: 'M',
        lineId: 'l',
        plantId: 'p',
        machineStatus: 'ACTIVE',
        idealCycleTimeSeconds: 60,
        availableMinutes: 1_000,
      },
    ],
    80
  ).totalCapacity;

  const withDowntime = calculateCapacity(
    [
      {
        machineId: 'mc-1',
        machineCode: 'MC-01',
        machineName: 'M',
        lineId: 'l',
        plantId: 'p',
        machineStatus: 'ACTIVE',
        idealCycleTimeSeconds: 60,
        availableMinutes: 1_000,
        plannedDowntimeMinutes: 200,
      },
    ],
    80
  ).totalCapacity;

  assert.equal(withoutDowntime, 1_000);
  assert.equal(withDowntime, 800);
});

test('shift minutes handle a shift crossing midnight', () => {
  // 22:00 → 06:00 is eight hours of work, less the break — not a negative.
  assert.equal(shiftMinutes('22:00', '06:00', 60), 8 * 60 - 60);
  assert.equal(shiftMinutes('08:00', '16:00', 60), 7 * 60);
  assert.equal(shiftMinutes('08:00', '16:00', 0), 8 * 60);
});

test('period length is inclusive of both ends', () => {
  assert.equal(daysInPeriod('2026-09-01', '2026-09-30'), 30);
  assert.equal(daysInPeriod('2026-09-01', '2026-09-01'), 1);
  assert.equal(daysInPeriod('2026-09-30', '2026-09-01'), 0, 'a reversed period is zero, not negative');
});

// ===========================================================================
// §25.4 Wizard gating
// ===========================================================================

const readiness = (over: Record<string, number> = {}) => ({
  planId: 'plan-1',
  currentStep: 1,
  demandCount: 0,
  lineCount: 0,
  linesWithPlannedQuantity: 0,
  workOrderCount: 0,
  scheduledWorkOrders: 0,
  resourcedWorkOrders: 0,
  confirmedWorkOrders: 0,
  capacityUpRequiredLines: 0,
  ...over,
});

test('§25.4: step 1 is always open, and each later step names what blocks it', () => {
  const steps = stepAvailability(readiness());
  assert.equal(steps[0].reachable, true);
  for (const entry of steps.slice(1)) {
    assert.equal(entry.reachable, false);
    assert.ok(entry.blockedBy && entry.blockedBy.length > 10, `step ${entry.step} must say why`);
  }
});

test('§25.4: steps unlock as the data they need appears', () => {
  assert.equal(furthestReachableStep(readiness()), 1);
  assert.equal(furthestReachableStep(readiness({ demandCount: 2 })), 2);
  assert.equal(
    furthestReachableStep(readiness({ demandCount: 2, linesWithPlannedQuantity: 1 })),
    3
  );
  assert.equal(
    furthestReachableStep(
      readiness({ demandCount: 2, linesWithPlannedQuantity: 1, workOrderCount: 4 })
    ),
    4
  );
  assert.equal(
    furthestReachableStep(
      readiness({
        demandCount: 2,
        linesWithPlannedQuantity: 1,
        workOrderCount: 4,
        scheduledWorkOrders: 4,
      })
    ),
    5
  );
  assert.equal(
    furthestReachableStep(
      readiness({
        demandCount: 2,
        linesWithPlannedQuantity: 1,
        workOrderCount: 4,
        scheduledWorkOrders: 4,
        resourcedWorkOrders: 4,
      })
    ),
    6
  );
});

test('§25.4: going back is never refused', () => {
  const state = readiness({ currentStep: 5, demandCount: 2, linesWithPlannedQuantity: 1 });
  // Backwards, always fine — planning is iterative.
  for (const target of [1, 2, 3, 4, 5]) {
    assertStepReachable(target, state);
  }
});

test('§25.4: jumping ahead of the data is refused with the reason', () => {
  assert.throws(
    () => assertStepReachable(4, readiness({ currentStep: 1, demandCount: 2 })),
    /Generate Work Order pada Step 3/
  );
  assert.throws(() => assertStepReachable(7, readiness()), /Wizard step 7 tidak valid/);
  assert.throws(() => assertStepReachable(0, readiness()), /Wizard step 0 tidak valid/);
});

// ===========================================================================
// MES-026 Customer Order status, end to end
// ===========================================================================

test('MES-026: the full derived progression, in order', () => {
  const facts = {
    lineCount: 2,
    fullyPlannedLines: 0,
    fullyProducedLines: 0,
    workOrdersInProduction: 0,
    workOrderCount: 0,
  };

  let status = CustomerOrderStatus.RECEIVED;
  status = deriveCustomerOrderStatus(status, facts);
  assert.equal(status, CustomerOrderStatus.RECEIVED);

  status = deriveCustomerOrderStatus(status, { ...facts, fullyPlannedLines: 2 });
  assert.equal(status, CustomerOrderStatus.PLANNED);

  status = deriveCustomerOrderStatus(status, {
    ...facts,
    fullyPlannedLines: 2,
    workOrderCount: 8,
    workOrdersInProduction: 1,
  });
  assert.equal(status, CustomerOrderStatus.IN_PRODUCTION);

  status = deriveCustomerOrderStatus(status, {
    ...facts,
    fullyPlannedLines: 2,
    fullyProducedLines: 2,
    workOrderCount: 8,
    workOrdersInProduction: 8,
  });
  assert.equal(status, CustomerOrderStatus.PRODUCED);
});
