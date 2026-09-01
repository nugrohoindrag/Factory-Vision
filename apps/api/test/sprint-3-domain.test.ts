import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CustomerOrderStatus,
  ProductionBatchStatus,
  WorkOrderStatus,
} from '@factory-vision/domain-types';
import {
  WorkOrderStateMachine,
  WorkOrderTransitionError,
  RETIRED_WORK_ORDER_STATUSES,
} from '../src/modules/production/work-order.state-machine.js';
import {
  BatchStateMachine,
  BatchTransitionError,
} from '../src/modules/production/batch.state-machine.js';
import {
  QuantityFlowService,
  QuantityFlowViolation,
} from '../src/modules/production/quantity-flow.service.js';
import {
  deriveCustomerOrderStatus,
  assertCancellable,
} from '../src/modules/planning/domain/customer-order.status.js';

/**
 * Sprint 3 domain rules, unit-tested without a database (MES-015-5, MES-016-4,
 * MES-017-4, MES-026).
 *
 * Everything under test is pure by design; that is the point of lifting it out
 * of the services, and it is what makes these run in milliseconds.
 */

// === MES-015 Work Order State Machine ======================================

test('MES-015: only the documented transitions exist', () => {
  assert.ok(WorkOrderStateMachine.canTransition(WorkOrderStatus.DRAFT, WorkOrderStatus.SCHEDULED));
  assert.ok(WorkOrderStateMachine.canTransition(WorkOrderStatus.SCHEDULED, WorkOrderStatus.CONFIRMED));
  assert.ok(
    WorkOrderStateMachine.canTransition(WorkOrderStatus.CONFIRMED, WorkOrderStatus.IN_PRODUCTION)
  );
  assert.ok(
    WorkOrderStateMachine.canTransition(WorkOrderStatus.IN_PRODUCTION, WorkOrderStatus.COMPLETED)
  );

  // Skipping a step is not a transition.
  assert.ok(!WorkOrderStateMachine.canTransition(WorkOrderStatus.DRAFT, WorkOrderStatus.IN_PRODUCTION));
  assert.ok(!WorkOrderStateMachine.canTransition(WorkOrderStatus.DRAFT, WorkOrderStatus.COMPLETED));
  assert.ok(
    !WorkOrderStateMachine.canTransition(WorkOrderStatus.SCHEDULED, WorkOrderStatus.IN_PRODUCTION)
  );

  // Terminal states are terminal.
  assert.equal(WorkOrderStateMachine.allowedTargets(WorkOrderStatus.COMPLETED).length, 0);
  assert.equal(WorkOrderStateMachine.allowedTargets(WorkOrderStatus.CANCELLED).length, 0);
});

test('MES-015: RELEASED, IN_PROGRESS and PAUSED do not exist (ADR-18)', () => {
  const statuses = Object.values(WorkOrderStatus) as string[];
  for (const retired of RETIRED_WORK_ORDER_STATUSES) {
    assert.ok(!statuses.includes(retired), `${retired} must not be a Work Order status`);
  }
});

test('MES-015: CANCELLED is reachable from every live status, reason mandatory', () => {
  for (const from of [
    WorkOrderStatus.DRAFT,
    WorkOrderStatus.SCHEDULED,
    WorkOrderStatus.CONFIRMED,
    WorkOrderStatus.IN_PRODUCTION,
  ]) {
    assert.ok(WorkOrderStateMachine.canTransition(from, WorkOrderStatus.CANCELLED));

    const withoutReason = WorkOrderStateMachine.evaluate(from, WorkOrderStatus.CANCELLED, {});
    assert.equal(withoutReason.allowed, false);
    assert.match(withoutReason.reasons.join(' '), /Alasan pembatalan wajib/);

    const withReason = WorkOrderStateMachine.evaluate(from, WorkOrderStatus.CANCELLED, {
      reason: 'Order dibatalkan customer',
    });
    assert.equal(withReason.allowed, true);
    assert.equal(withReason.effects.setStatusReason, true);
  }
});

test('MES-015: DRAFT → SCHEDULED names every unmet guard', () => {
  const decision = WorkOrderStateMachine.evaluate(
    WorkOrderStatus.DRAFT,
    WorkOrderStatus.SCHEDULED,
    { plannedQuantity: 0 }
  );
  assert.equal(decision.allowed, false);
  const joined = decision.reasons.join(' ');
  assert.match(joined, /Planned quantity/);
  assert.match(joined, /Planned start/);
  assert.match(joined, /Planned end/);
  assert.match(joined, /Sequence/);

  const ok = WorkOrderStateMachine.evaluate(WorkOrderStatus.DRAFT, WorkOrderStatus.SCHEDULED, {
    plannedQuantity: 10_000,
    plannedStart: '2026-09-01T00:00:00.000Z',
    plannedEnd: '2026-09-02T00:00:00.000Z',
    sequence: 1,
    openScheduleConflicts: [],
  });
  assert.equal(ok.allowed, true);
});

test('MES-015: SCHEDULED → CONFIRMED requires the full checklist', () => {
  const decision = WorkOrderStateMachine.evaluate(
    WorkOrderStatus.SCHEDULED,
    WorkOrderStatus.CONFIRMED,
    // `moldRequired` because this fixture stands for a moulding product; the
    // conditional itself is covered in final-qa-business-rules.
    {
      plannedQuantity: 100,
      plannedStart: 'x',
      plannedEnd: 'y',
      assignedOperatorIds: [],
      moldRequired: true,
    }
  );
  assert.equal(decision.allowed, false);
  const joined = decision.reasons.join(' ');
  assert.match(joined, /Mesin belum ditetapkan/);
  assert.match(joined, /Mold belum ditetapkan/);
  assert.match(joined, /Shift belum ditetapkan/);
  assert.match(joined, /Operator belum ditugaskan/);

  const complete = WorkOrderStateMachine.evaluate(
    WorkOrderStatus.SCHEDULED,
    WorkOrderStatus.CONFIRMED,
    {
      plannedQuantity: 100,
      plannedStart: '2026-09-01T00:00:00.000Z',
      plannedEnd: '2026-09-02T00:00:00.000Z',
      machineId: 'mc-01',
      moldId: 'mold-01',
      shiftId: 'shift-1',
      assignedOperatorIds: ['op-001'],
      incompatibleResources: [],
      openScheduleConflicts: [],
    }
  );
  assert.equal(complete.allowed, true);
  assert.equal(complete.effects.setConfirmed, true);
});

test('MES-015: an open schedule conflict blocks confirmation', () => {
  const decision = WorkOrderStateMachine.evaluate(
    WorkOrderStatus.SCHEDULED,
    WorkOrderStatus.CONFIRMED,
    {
      plannedQuantity: 100,
      plannedStart: '2026-09-01T00:00:00.000Z',
      plannedEnd: '2026-09-02T00:00:00.000Z',
      machineId: 'mc-01',
      moldId: 'mold-01',
      shiftId: 'shift-1',
      assignedOperatorIds: ['op-001'],
      openScheduleConflicts: ['MC-01 dipakai WO-INJ-002'],
    }
  );
  assert.equal(decision.allowed, false);
  assert.match(decision.reasons.join(' '), /MC-01 dipakai WO-INJ-002/);
});

test('MES-015-4: the soft predecessor guard accepts a running predecessor', () => {
  const soft = WorkOrderStateMachine.evaluate(
    WorkOrderStatus.CONFIRMED,
    WorkOrderStatus.IN_PRODUCTION,
    {
      assignedOperatorIds: ['op-001'],
      shiftActive: true,
      predecessor: {
        workOrderId: 'WO-INJ-001',
        status: WorkOrderStatus.IN_PRODUCTION,
        availableQuantity: 500,
      },
    }
  );
  assert.equal(soft.allowed, true);
  assert.equal(soft.effects.setActualStart, true);
  assert.equal(soft.effects.machineState, 'RUNNING');

  // Nothing handed over yet: starting would mean working on nothing.
  const nothingAvailable = WorkOrderStateMachine.evaluate(
    WorkOrderStatus.CONFIRMED,
    WorkOrderStatus.IN_PRODUCTION,
    {
      assignedOperatorIds: ['op-001'],
      predecessor: {
        workOrderId: 'WO-INJ-001',
        status: WorkOrderStatus.IN_PRODUCTION,
        availableQuantity: 0,
      },
    }
  );
  assert.equal(nothingAvailable.allowed, false);
  assert.match(nothingAvailable.reasons.join(' '), /Belum ada quantity yang diserahkan/);
});

test('MES-015-4: strict mode demands a COMPLETED predecessor', () => {
  const strict = WorkOrderStateMachine.evaluate(
    WorkOrderStatus.CONFIRMED,
    WorkOrderStatus.IN_PRODUCTION,
    {
      assignedOperatorIds: ['op-001'],
      strictProcessSequence: true,
      predecessor: {
        workOrderId: 'WO-INJ-001',
        status: WorkOrderStatus.IN_PRODUCTION,
        availableQuantity: 500,
      },
    }
  );
  assert.equal(strict.allowed, false);
  assert.match(strict.reasons.join(' '), /harus COMPLETED/);

  const done = WorkOrderStateMachine.evaluate(
    WorkOrderStatus.CONFIRMED,
    WorkOrderStatus.IN_PRODUCTION,
    {
      assignedOperatorIds: ['op-001'],
      strictProcessSequence: true,
      predecessor: {
        workOrderId: 'WO-INJ-001',
        status: WorkOrderStatus.COMPLETED,
        availableQuantity: 500,
      },
    }
  );
  assert.equal(done.allowed, true);
});

test('MES-015: COMPLETED is refused while a downtime is still ACTIVE', () => {
  const blocked = WorkOrderStateMachine.evaluate(
    WorkOrderStatus.IN_PRODUCTION,
    WorkOrderStatus.COMPLETED,
    { activeDowntimeCount: 2 }
  );
  assert.equal(blocked.allowed, false);
  assert.match(blocked.reasons.join(' '), /2 downtime record berstatus ACTIVE/);

  const ok = WorkOrderStateMachine.evaluate(
    WorkOrderStatus.IN_PRODUCTION,
    WorkOrderStatus.COMPLETED,
    { activeDowntimeCount: 0 }
  );
  assert.equal(ok.allowed, true);
  assert.equal(ok.effects.setActualEnd, true);
  assert.equal(ok.effects.machineState, 'IDLE');
});

test('MES-015: validateTransition throws with the guard failures attached', () => {
  assert.throws(
    () =>
      WorkOrderStateMachine.validateTransition(
        WorkOrderStatus.DRAFT,
        WorkOrderStatus.COMPLETED,
        {}
      ),
    (error: unknown) => {
      assert.ok(error instanceof WorkOrderTransitionError);
      assert.equal(error.from, WorkOrderStatus.DRAFT);
      assert.equal(error.to, WorkOrderStatus.COMPLETED);
      assert.ok(error.reasons.length > 0);
      return true;
    }
  );
});

// === MES-016 Batch State Machine ===========================================

test('MES-016: batch lifecycle is PLANNED → IN_PRODUCTION → COMPLETED only', () => {
  assert.ok(
    BatchStateMachine.canTransition(
      ProductionBatchStatus.PLANNED,
      ProductionBatchStatus.IN_PRODUCTION
    )
  );
  assert.ok(
    BatchStateMachine.canTransition(
      ProductionBatchStatus.IN_PRODUCTION,
      ProductionBatchStatus.COMPLETED
    )
  );
  assert.ok(
    !BatchStateMachine.canTransition(ProductionBatchStatus.PLANNED, ProductionBatchStatus.COMPLETED)
  );
  assert.equal(BatchStateMachine.allowedTargets(ProductionBatchStatus.COMPLETED).length, 0);
});

test('MES-016: a batch may only start once its Work Order is IN_PRODUCTION', () => {
  const early = BatchStateMachine.evaluate(
    ProductionBatchStatus.PLANNED,
    ProductionBatchStatus.IN_PRODUCTION,
    { workOrderStatus: WorkOrderStatus.CONFIRMED, plannedQuantity: 25_000 }
  );
  assert.equal(early.allowed, false);
  assert.match(early.reasons.join(' '), /IN_PRODUCTION sebelum batch dimulai/);

  const ok = BatchStateMachine.evaluate(
    ProductionBatchStatus.PLANNED,
    ProductionBatchStatus.IN_PRODUCTION,
    { workOrderStatus: WorkOrderStatus.IN_PRODUCTION, plannedQuantity: 25_000 }
  );
  assert.equal(ok.allowed, true);
  assert.equal(ok.effects.setActualStart, true);
});

test('MES-016: CANCELLED requires a status_reason and spares the Work Order', () => {
  const noReason = BatchStateMachine.evaluate(
    ProductionBatchStatus.IN_PRODUCTION,
    ProductionBatchStatus.CANCELLED,
    {}
  );
  assert.equal(noReason.allowed, false);

  const withReason = BatchStateMachine.evaluate(
    ProductionBatchStatus.IN_PRODUCTION,
    ProductionBatchStatus.CANCELLED,
    { reason: 'Material tidak tersedia' }
  );
  assert.equal(withReason.allowed, true);
  assert.equal(withReason.effects.releaseRemainingPlanned, true);
  // Nothing in the effects touches the Work Order: cancelling a batch does not
  // cancel its parent (§12).
  assert.equal('cancelWorkOrder' in withReason.effects, false);

  assert.throws(
    () =>
      BatchStateMachine.validateTransition(
        ProductionBatchStatus.PLANNED,
        ProductionBatchStatus.CANCELLED,
        {}
      ),
    BatchTransitionError
  );
});

test('MES-016: COMPLETED is refused while the batch has an ACTIVE downtime', () => {
  const blocked = BatchStateMachine.evaluate(
    ProductionBatchStatus.IN_PRODUCTION,
    ProductionBatchStatus.COMPLETED,
    { activeDowntimeCount: 1 }
  );
  assert.equal(blocked.allowed, false);

  const ok = BatchStateMachine.evaluate(
    ProductionBatchStatus.IN_PRODUCTION,
    ProductionBatchStatus.COMPLETED,
    { activeDowntimeCount: 0 }
  );
  assert.equal(ok.allowed, true);
  assert.equal(ok.effects.aggregateToWorkOrder, true);
});

test('MES-016: legacy ACTIVE reads as IN_PRODUCTION', () => {
  assert.equal(
    BatchStateMachine.normalize(ProductionBatchStatus.ACTIVE),
    ProductionBatchStatus.IN_PRODUCTION
  );
  assert.ok(
    BatchStateMachine.canTransition(ProductionBatchStatus.ACTIVE, ProductionBatchStatus.COMPLETED)
  );
});

// === MES-017 Quantity Flow =================================================

const balanced = {
  inputQuantity: 10_000,
  outputQuantity: 9_800,
  rejectQuantity: 100,
  scrapQuantity: 100,
  reworkQuantity: 0,
  transferredQuantity: 9_800,
};

test('MES-017: a balanced flow passes and WIP is zero', () => {
  assert.deepEqual(QuantityFlowService.check(balanced), []);
  assert.equal(QuantityFlowService.workInProgress(balanced), 0);
  QuantityFlowService.assert('WORK_ORDER', 'wo-1', balanced, { completed: true });
});

test('MES-017: input must cover every disposition bucket, message names the figures', () => {
  const violations = QuantityFlowService.check({
    inputQuantity: 100,
    outputQuantity: 90,
    rejectQuantity: 20,
    scrapQuantity: 0,
    reworkQuantity: 0,
    transferredQuantity: 0,
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0].invariant, 'INPUT_COVERS_DISPOSITION');
  assert.match(violations[0].message, /Input 100/);
  assert.match(violations[0].message, /output 90/);
  assert.match(violations[0].message, /reject 20/);
  assert.match(violations[0].message, /selisih 10/);
});

test('MES-017: output is never good + reject', () => {
  // 90 good + 20 reject out of 100 input is legal only because output excludes
  // reject. Folding them together (110) is what the invariant catches.
  const legal = QuantityFlowService.check({
    inputQuantity: 110,
    outputQuantity: 90,
    rejectQuantity: 20,
    scrapQuantity: 0,
    reworkQuantity: 0,
    transferredQuantity: 90,
  });
  assert.deepEqual(legal, []);

  const folded = QuantityFlowService.check({
    inputQuantity: 110,
    outputQuantity: 110,
    rejectQuantity: 20,
    scrapQuantity: 0,
    reworkQuantity: 0,
    transferredQuantity: 110,
  });
  assert.equal(folded[0].invariant, 'INPUT_COVERS_DISPOSITION');
});

test('MES-017: transferred cannot exceed output', () => {
  const violations = QuantityFlowService.check({
    inputQuantity: 100,
    outputQuantity: 90,
    rejectQuantity: 5,
    scrapQuantity: 5,
    reworkQuantity: 0,
    transferredQuantity: 95,
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0].invariant, 'TRANSFERRED_WITHIN_OUTPUT');
  assert.match(violations[0].message, /Transferred 95 melebihi output 90/);
});

test('MES-017: WIP must be zero at completion', () => {
  const flow = {
    inputQuantity: 100,
    outputQuantity: 80,
    rejectQuantity: 5,
    scrapQuantity: 0,
    reworkQuantity: 0,
    transferredQuantity: 80,
  };
  assert.equal(QuantityFlowService.workInProgress(flow), 15);
  assert.deepEqual(QuantityFlowService.check(flow), []);

  const atCompletion = QuantityFlowService.check(flow, { completed: true });
  assert.equal(atCompletion[0].invariant, 'WIP_ZERO_ON_COMPLETION');
  assert.match(atCompletion[0].message, /WIP harus nol saat COMPLETED, saat ini 15/);
});

test('MES-017: negative quantities are refused by name', () => {
  const violations = QuantityFlowService.check({
    inputQuantity: 100,
    outputQuantity: -1,
    rejectQuantity: 0,
    scrapQuantity: 0,
    reworkQuantity: 0,
    transferredQuantity: 0,
  });
  assert.equal(violations[0].invariant, 'NON_NEGATIVE');
  assert.match(violations[0].message, /output tidak boleh negatif/);
});

test('MES-017: the invariants are identical for Work Order and Batch', () => {
  const broken = {
    inputQuantity: 10,
    outputQuantity: 20,
    rejectQuantity: 0,
    scrapQuantity: 0,
    reworkQuantity: 0,
    transferredQuantity: 0,
  };
  const asWorkOrder = QuantityFlowService.check(broken);
  const asBatch = QuantityFlowService.check(broken);
  assert.deepEqual(asWorkOrder, asBatch);

  assert.throws(() => QuantityFlowService.assert('BATCH', 'batch-1', broken), QuantityFlowViolation);
});

test('MES-017: a delta is judged before it is applied', () => {
  const current = {
    inputQuantity: 100,
    outputQuantity: 50,
    rejectQuantity: 0,
    scrapQuantity: 0,
    reworkQuantity: 0,
    transferredQuantity: 0,
  };
  const next = QuantityFlowService.assertDelta('WORK_ORDER', 'wo-1', current, {
    outputQuantity: 40,
    rejectQuantity: 10,
  });
  assert.equal(next.outputQuantity, 90);
  assert.equal(next.rejectQuantity, 10);

  assert.throws(
    () => QuantityFlowService.assertDelta('WORK_ORDER', 'wo-1', current, { outputQuantity: 60 }),
    QuantityFlowViolation
  );
});

test('MES-017: batch planned may be less than the WO, split must be exact (§9 Q6)', () => {
  // Batch: under is fine, over is not.
  QuantityFlowService.assertBatchPlannedWithinWorkOrder('wo-1', 100_000, 75_000);
  assert.throws(
    () => QuantityFlowService.assertBatchPlannedWithinWorkOrder('wo-1', 100_000, 100_001),
    QuantityFlowViolation
  );

  // Split: exactly equal, because a split divides the work exhaustively.
  QuantityFlowService.assertSplitPlannedExact('wo-1', 100_000, 100_000);
  assert.throws(
    () => QuantityFlowService.assertSplitPlannedExact('wo-1', 100_000, 75_000),
    QuantityFlowViolation
  );
});

test('MES-017: yield is derived, and undefined when nothing entered', () => {
  assert.equal(QuantityFlowService.yieldRatio(balanced), 0.98);
  assert.equal(
    QuantityFlowService.yieldRatio({
      inputQuantity: 0,
      outputQuantity: 0,
      rejectQuantity: 0,
      scrapQuantity: 0,
      reworkQuantity: 0,
      transferredQuantity: 0,
    }),
    undefined
  );
});

// === MES-026 Customer Order status derivation ==============================

const noFacts = {
  lineCount: 2,
  fullyPlannedLines: 0,
  fullyProducedLines: 0,
  workOrdersInProduction: 0,
  workOrderCount: 0,
};

test('MES-026: Received → Planned once every line is fully in a plan', () => {
  assert.equal(
    deriveCustomerOrderStatus(CustomerOrderStatus.RECEIVED, noFacts),
    CustomerOrderStatus.RECEIVED
  );
  assert.equal(
    deriveCustomerOrderStatus(CustomerOrderStatus.RECEIVED, { ...noFacts, fullyPlannedLines: 1 }),
    CustomerOrderStatus.RECEIVED,
    'a partially planned order is not yet Planned'
  );
  assert.equal(
    deriveCustomerOrderStatus(CustomerOrderStatus.RECEIVED, { ...noFacts, fullyPlannedLines: 2 }),
    CustomerOrderStatus.PLANNED
  );
});

test('MES-026: Planned → In Production on the first Work Order that starts', () => {
  assert.equal(
    deriveCustomerOrderStatus(CustomerOrderStatus.PLANNED, {
      ...noFacts,
      fullyPlannedLines: 2,
      workOrderCount: 4,
      workOrdersInProduction: 1,
    }),
    CustomerOrderStatus.IN_PRODUCTION
  );
});

test('MES-026: In Production → Produced when every line is satisfied', () => {
  assert.equal(
    deriveCustomerOrderStatus(CustomerOrderStatus.IN_PRODUCTION, {
      lineCount: 2,
      fullyPlannedLines: 2,
      fullyProducedLines: 2,
      workOrderCount: 4,
      workOrdersInProduction: 4,
    }),
    CustomerOrderStatus.PRODUCED
  );
});

test('MES-026: derivation never drags a status backwards', () => {
  // A Work Order rescheduled out of production must not flip the order back to
  // Planned on the screen a sales person is reading.
  assert.equal(
    deriveCustomerOrderStatus(CustomerOrderStatus.IN_PRODUCTION, {
      ...noFacts,
      fullyPlannedLines: 2,
    }),
    CustomerOrderStatus.IN_PRODUCTION
  );
});

test('MES-026: the manual logistics statuses and CANCELLED are left alone', () => {
  for (const status of [
    CustomerOrderStatus.READY_TO_SHIP,
    CustomerOrderStatus.SHIPPED,
    CustomerOrderStatus.COMPLETED,
    CustomerOrderStatus.CANCELLED,
  ]) {
    assert.equal(
      deriveCustomerOrderStatus(status, { ...noFacts, fullyProducedLines: 2, fullyPlannedLines: 2 }),
      status
    );
  }
});

test('MES-026-3: cancelling is refused once a Work Order is in production', () => {
  assert.throws(
    () =>
      assertCancellable(CustomerOrderStatus.IN_PRODUCTION, {
        ...noFacts,
        workOrderCount: 2,
        workOrdersInProduction: 1,
      }),
    /sudah masuk produksi/
  );

  // Planned but not started: cancellable.
  assertCancellable(CustomerOrderStatus.PLANNED, { ...noFacts, fullyPlannedLines: 2 });
});
