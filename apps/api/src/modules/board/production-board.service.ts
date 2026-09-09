import { WorkOrderStatus } from '@factory-vision/domain-types';
import type {
  BoardConflict,
  BoardItem,
  BoardItemStatus,
  BoardLane,
  DispatchAction,
  ProductionBoard,
  ProductionBoardQuery,
  WorkOrder,
} from '@factory-vision/domain-types';
import { ApiError } from '../../platform/http/api-error.js';
import type { MasterDataService } from '../master-data/master-data.service.js';
import type { ProductionService } from '../production/production.service.js';
import type { MaintenanceService } from '../maintenance/maintenance.service.js';
import type { MaterialService } from '../material/material.service.js';
import type { WorkforceService } from '../workforce/workforce.service.js';
import type { EventService } from '../event/event.service.js';

/**
 * Visual Production Board (Improvement PRD §9, §23).
 *
 * The board is a projection, not a store: every bar on it is a work order or a
 * maintenance window that already exists elsewhere, arranged into lanes and
 * annotated with what would stop it from running. Giving the board its own
 * tables would mean two versions of the schedule that drift apart the first
 * time somebody reschedules from the work order screen.
 *
 * Conflicts are computed on read for the same reason (§9.5). A stored conflict
 * is a claim about a schedule that has since changed.
 */
export class ProductionBoardService {
  constructor(
    private readonly masterData: MasterDataService,
    private readonly production: ProductionService,
    private readonly maintenance: MaintenanceService,
    private readonly material: MaterialService,
    private readonly workforce: WorkforceService,
    private readonly events: EventService
  ) {}

  /**
   * §9.4 — what a bar looks like at a glance.
   *
   * DELAYED and AT_RISK are the two the schedule itself decides: a work order
   * whose planned end has passed without completing is late, and one that is
   * running with less time left than its remaining quantity needs is at risk.
   */
  private static statusOf(
    workOrder: WorkOrder,
    context: { machineBlocked: boolean; now: number }
  ): BoardItemStatus {
    if (workOrder.status === WorkOrderStatus.COMPLETED) return 'COMPLETED';
    if (workOrder.status === WorkOrderStatus.CANCELLED) return 'BLOCKED';
    if (context.machineBlocked) return 'MAINTENANCE';

    const plannedEnd = new Date(workOrder.plannedEnd).getTime();
    const running = workOrder.status === WorkOrderStatus.IN_PRODUCTION;

    if (running) {
      if (context.now > plannedEnd) return 'DELAYED';
      const progress =
        workOrder.plannedQuantity > 0 ? workOrder.outputQuantity / workOrder.plannedQuantity : 0;
      const plannedStart = new Date(workOrder.plannedStart).getTime();
      const elapsed = (context.now - plannedStart) / Math.max(plannedEnd - plannedStart, 1);
      // Ten points behind the clock is the point at which a supervisor can
      // still do something about it; further behind and it is simply late.
      return elapsed - progress > 0.1 ? 'AT_RISK' : 'RUNNING';
    }

    if (context.now > plannedEnd) return 'DELAYED';
    return workOrder.status === WorkOrderStatus.CONFIRMED ? 'CONFIRMED' : 'SCHEDULED';
  }

  /** Do two windows overlap at all. */
  private static overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
    return a.start < b.end && b.start < a.end;
  }

  async build(tenantId: string, query: ProductionBoardQuery = {}): Promise<ProductionBoard> {
    const viewMode = query.viewMode ?? 'MACHINE';
    const days = Math.min(Math.max(query.days ?? 1, 1), 31);
    const anchor = query.date ? new Date(`${query.date}T00:00:00`) : new Date();
    const windowStart = new Date(anchor);
    windowStart.setHours(0, 0, 0, 0);
    const windowEnd = new Date(windowStart.getTime() + days * 86_400_000);

    const workOrders = (
      await this.production.getWorkOrders(tenantId, {
        lineId: query.lineId,
        status: query.status === 'RUNNING' ? WorkOrderStatus.IN_PRODUCTION : undefined,
        processId: query.processId,
      })
    ).filter((workOrder) =>
      ProductionBoardService.overlaps(
        { start: new Date(workOrder.plannedStart).getTime(), end: new Date(workOrder.plannedEnd).getTime() },
        { start: windowStart.getTime(), end: windowEnd.getTime() }
      )
    );

    const filtered = workOrders.filter((workOrder) => {
      if (query.machineId && workOrder.machineId !== query.machineId) return false;
      if (query.workCenterId && workOrder.workCenterId !== query.workCenterId) return false;
      if (query.productId && workOrder.productId !== query.productId) return false;
      if (query.shiftId && workOrder.shiftId !== query.shiftId) return false;
      if (query.priority !== undefined && workOrder.priority !== query.priority) return false;
      return true;
    });

    const blockedMachines = await this.maintenance.blockedMachines(tenantId);
    const assignments = await this.workforce.listAssignments(tenantId, { active: true });
    const now = Date.now();

    const items: BoardItem[] = filtered.map((workOrder) => {
      const machine = workOrder.machineId
        ? this.masterData.getMachineById(tenantId, workOrder.machineId)
        : undefined;
      const product = this.masterData.getProductById(tenantId, workOrder.productId);
      const line = this.masterData.getLines(tenantId).find((l) => l.id === workOrder.lineId);
      const process = workOrder.processId
        ? this.masterData.getProcesses(tenantId).find((p) => p.id === workOrder.processId)
        : undefined;
      const operators = assignments.filter((a) => a.workOrderId === workOrder.id);

      return {
        id: workOrder.id,
        kind: 'WORK_ORDER',
        label: workOrder.woNumber,
        workOrderId: workOrder.id,
        workOrderNumber: workOrder.woNumber,
        productId: workOrder.productId,
        productName: product?.name,
        lineId: workOrder.lineId,
        lineName: line?.name,
        workCenterId: workOrder.workCenterId,
        machineId: workOrder.machineId,
        machineName: machine?.name,
        processId: workOrder.processId,
        processName: process?.name,
        moldId: workOrder.moldId,
        shiftId: workOrder.shiftId,
        operatorIds: operators.map((a) => a.operatorId),
        operatorNames: operators.map((a) => a.operatorName),
        plannedStart: workOrder.plannedStart,
        plannedEnd: workOrder.plannedEnd,
        actualStart: workOrder.actualStart,
        actualEnd: workOrder.actualEnd,
        quantity: workOrder.plannedQuantity,
        producedQuantity: workOrder.outputQuantity,
        progressPercentage:
          workOrder.plannedQuantity > 0
            ? Number(((workOrder.outputQuantity / workOrder.plannedQuantity) * 100).toFixed(1))
            : 0,
        priority: workOrder.priority,
        status: ProductionBoardService.statusOf(workOrder, {
          machineBlocked: Boolean(workOrder.machineId && blockedMachines.has(workOrder.machineId)),
          now,
        }),
        conflicts: [],
      };
    });

    // Maintenance windows share the machine lane, because a technician's two
    // hours and a work order's two hours are competing for the same machine.
    const maintenanceRecords = await this.maintenance.listRecords(tenantId, { limit: 500 });
    for (const record of maintenanceRecords) {
      const start = record.startedAt ?? record.scheduledFor;
      if (!start) continue;
      const end =
        record.completedAt ??
        new Date(new Date(start).getTime() + (record.durationMinutes ?? 120) * 60_000).toISOString();
      if (
        !ProductionBoardService.overlaps(
          { start: new Date(start).getTime(), end: new Date(end).getTime() },
          { start: windowStart.getTime(), end: windowEnd.getTime() }
        )
      ) {
        continue;
      }
      if (query.machineId && record.machineId !== query.machineId) continue;

      items.push({
        id: record.id,
        kind: 'MAINTENANCE',
        label: `${record.maintenanceNumber} · ${record.maintenanceType}`,
        maintenanceRecordId: record.id,
        machineId: record.machineId,
        machineName: record.machineName,
        operatorIds: [],
        operatorNames: record.technicianName ? [record.technicianName] : [],
        plannedStart: start,
        plannedEnd: end,
        actualStart: record.startedAt,
        actualEnd: record.completedAt,
        quantity: 0,
        producedQuantity: 0,
        progressPercentage: record.status === 'COMPLETED' ? 100 : 0,
        priority: 0,
        status: 'MAINTENANCE',
        conflicts: [],
      });
    }

    const conflicts = this.detectConflicts(items);
    await this.annotateReadiness(tenantId, items);

    return {
      viewMode,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      lanes: this.buildLanes(tenantId, viewMode, items),
      conflicts,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * §9.5 — machine, operator, mould and maintenance clashes.
   *
   * A conflict is recorded on both items involved, so a user clicking either
   * bar sees the same explanation rather than having to find the other one.
   * Blocking is reserved for what makes execution physically impossible: one
   * machine cannot run two work orders, and it cannot run one while it is
   * being repaired. A delivery risk is a warning, not a barrier.
   */
  private detectConflicts(items: BoardItem[]): BoardConflict[] {
    const conflicts: BoardConflict[] = [];

    const record = (conflict: BoardConflict) => {
      conflicts.push(conflict);
      for (const item of items) {
        if (conflict.relatedItemIds.includes(item.id)) item.conflicts.push(conflict);
      }
    };

    const window = (item: BoardItem) => ({
      start: new Date(item.plannedStart).getTime(),
      end: new Date(item.plannedEnd).getTime(),
    });

    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        const a = items[i];
        const b = items[j];
        if (!ProductionBoardService.overlaps(window(a), window(b))) continue;

        if (a.machineId && a.machineId === b.machineId) {
          const maintenanceInvolved = a.kind === 'MAINTENANCE' || b.kind === 'MAINTENANCE';
          record({
            type: maintenanceInvolved ? 'MAINTENANCE_CONFLICT' : 'MACHINE_CONFLICT',
            blocking: true,
            message: maintenanceInvolved
              ? `${a.machineName ?? a.machineId} dijadwalkan maintenance dan produksi pada waktu yang sama.`
              : `${a.label} dan ${b.label} dijadwalkan pada mesin ${a.machineName ?? a.machineId} secara bersamaan.`,
            relatedItemIds: [a.id, b.id],
          });
        }

        if (a.moldId && a.moldId === b.moldId) {
          record({
            type: 'MOLD_CONFLICT',
            blocking: true,
            message: `${a.label} dan ${b.label} membutuhkan mold yang sama pada waktu yang bertumpang tindih.`,
            relatedItemIds: [a.id, b.id],
          });
        }

        const sharedOperators = a.operatorIds.filter((id) => b.operatorIds.includes(id));
        if (sharedOperators.length > 0) {
          record({
            type: 'OPERATOR_CONFLICT',
            blocking: true,
            message: `Operator yang sama ditugaskan pada ${a.label} dan ${b.label} di waktu yang bertumpang tindih.`,
            relatedItemIds: [a.id, b.id],
          });
        }
      }
    }

    for (const item of items) {
      if (item.status === 'DELAYED' && item.kind === 'WORK_ORDER') {
        record({
          type: 'DELIVERY_RISK',
          blocking: false,
          message: `${item.label} melewati jadwal selesai dan belum selesai.`,
          relatedItemIds: [item.id],
        });
      }
    }

    return conflicts;
  }

  /**
   * Adds material and labour readiness to each work-order bar.
   *
   * These are the two "can this actually start" questions the board is asked
   * (§9.1), and both are cheap enough to answer per bar because each is a
   * couple of indexed reads. A shortage is a non-blocking conflict: the plant
   * may still choose to run a partial quantity, and it is not the board's
   * place to refuse.
   */
  private async annotateReadiness(tenantId: string, items: BoardItem[]): Promise<void> {
    for (const item of items) {
      if (item.kind !== 'WORK_ORDER' || !item.workOrderId) continue;

      try {
        const readiness = await this.material.checkWorkOrder(tenantId, item.workOrderId);
        item.materialStatus = readiness.status;
        if (readiness.status === 'SHORTAGE' || readiness.status === 'PARTIAL') {
          item.conflicts.push({
            type: 'MATERIAL_SHORTAGE',
            blocking: false,
            message: `${readiness.shortageRequirements} material belum mencukupi untuk ${item.label}.`,
            relatedItemIds: [item.id],
          });
        }
      } catch {
        // A work order without a BOM has nothing to check; NOT_CHECKED says so.
        item.materialStatus = 'NOT_CHECKED';
      }

      try {
        const labor = await this.workforce.laborStatus(tenantId, item.workOrderId);
        item.laborStatus = labor.status;
        if (labor.status === 'SHORTAGE') {
          item.conflicts.push({
            type: 'LABOR_SHORTAGE',
            blocking: false,
            message: `${item.label} membutuhkan ${labor.requiredOperators} operator, ${labor.assignedOperators} ditugaskan.`,
            relatedItemIds: [item.id],
          });
        }
      } catch {
        // Labour is optional configuration; its absence is not a conflict.
      }
    }
  }

  /** §23's view modes, all of them the same items grouped differently. */
  private buildLanes(tenantId: string, viewMode: string, items: BoardItem[]): BoardLane[] {
    const lanes = new Map<string, BoardLane>();

    const laneOf = (item: BoardItem): { id: string; name: string; subtitle?: string } => {
      switch (viewMode) {
        case 'LINE':
          return { id: item.lineId ?? 'unassigned', name: item.lineName ?? 'Tanpa Line' };
        case 'PROCESS':
          return { id: item.processId ?? 'unassigned', name: item.processName ?? 'Tanpa Proses' };
        case 'SHIFT': {
          const shift = this.masterData.getShifts(tenantId).find((s) => s.id === item.shiftId);
          return {
            id: item.shiftId ?? 'unassigned',
            name: shift?.name ?? 'Tanpa Shift',
            subtitle: shift ? `${shift.startTime} – ${shift.endTime}` : undefined,
          };
        }
        case 'CALENDAR':
          return { id: item.plannedStart.slice(0, 10), name: item.plannedStart.slice(0, 10) };
        case 'TIMELINE':
          return { id: 'all', name: 'Seluruh Jadwal' };
        default:
          return {
            id: item.machineId ?? 'unassigned',
            name: item.machineName ?? 'Tanpa Mesin',
            subtitle: item.lineName,
          };
      }
    };

    for (const item of items) {
      const key = laneOf(item);
      const lane = lanes.get(key.id) ?? { id: key.id, name: key.name, subtitle: key.subtitle, items: [] };
      lane.items.push(item);
      lanes.set(key.id, lane);
    }

    // Machine view lists every machine, including the idle ones: an empty lane
    // is the most useful thing on a dispatching board.
    if (viewMode === 'MACHINE') {
      for (const machine of this.masterData.getMachines(tenantId)) {
        if (!lanes.has(machine.id)) {
          lanes.set(machine.id, { id: machine.id, name: machine.name, items: [] });
        }
      }
    }

    return [...lanes.values()]
      .map((lane) => ({
        ...lane,
        items: lane.items.sort(
          (a, b) => new Date(a.plannedStart).getTime() - new Date(b.plannedStart).getTime()
        ),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // ==========================================================
  // §9.6 Dispatch actions (US-PB002..004)
  // ==========================================================

  /**
   * Applies one dispatch change and records it (§9.6: "semua perubahan diaudit").
   *
   * Rescheduling and machine reassignment are checked against the same
   * conflicts the board draws, so a dispatcher cannot use this endpoint to
   * create the clash the board would have shown them. BR-MT04 is enforced
   * here too: a machine under maintenance takes no new work.
   */
  async dispatch(
    tenantId: string,
    action: DispatchAction,
    actor: { id: string; name?: string }
  ): Promise<WorkOrder> {
    const workOrder = await this.production.getWorkOrderById(tenantId, action.workOrderId);
    if (!workOrder) throw ApiError.notFound('Work Order tidak ditemukan.');

    const before = {
      plannedStart: workOrder.plannedStart,
      plannedEnd: workOrder.plannedEnd,
      machineId: workOrder.machineId,
      priority: workOrder.priority,
      sequence: workOrder.sequence,
    };

    let updated: WorkOrder;
    switch (action.action) {
      case 'RESCHEDULE': {
        if (!action.plannedStart || !action.plannedEnd) {
          throw ApiError.validation('Jadwal baru memerlukan plannedStart dan plannedEnd.');
        }
        if (new Date(action.plannedEnd) <= new Date(action.plannedStart)) {
          throw ApiError.validation('plannedEnd harus setelah plannedStart.');
        }
        await this.assertNoMachineClash(tenantId, workOrder, {
          machineId: workOrder.machineId,
          start: action.plannedStart,
          end: action.plannedEnd,
        });
        updated = await this.production.updateWorkOrder(tenantId, action.workOrderId, {
          plannedStart: action.plannedStart,
          plannedEnd: action.plannedEnd,
        });
        break;
      }

      case 'REASSIGN_MACHINE': {
        if (!action.machineId) throw ApiError.validation('machineId wajib diisi.');
        if (await this.maintenance.isMachineBlocked(tenantId, action.machineId)) {
          throw ApiError.conflict(
            'Mesin sedang dalam maintenance dan tidak dapat menerima work order baru (BR-MT04).'
          );
        }
        await this.assertNoMachineClash(tenantId, workOrder, {
          machineId: action.machineId,
          start: action.plannedStart ?? workOrder.plannedStart,
          end: action.plannedEnd ?? workOrder.plannedEnd,
        });
        updated = await this.production.updateWorkOrder(tenantId, action.workOrderId, {
          machineId: action.machineId,
        });
        break;
      }

      case 'REASSIGN_OPERATOR': {
        const wanted = action.operatorIds ?? [];
        const current = await this.workforce.listAssignments(tenantId, {
          workOrderId: action.workOrderId,
          active: true,
        });
        for (const assignment of current) {
          if (!wanted.includes(assignment.operatorId)) {
            await this.workforce.unassignOperator(tenantId, assignment.id, actor);
          }
        }
        for (const operatorId of wanted) {
          if (current.some((assignment) => assignment.operatorId === operatorId)) continue;
          await this.workforce.assignOperator(
            tenantId,
            { workOrderId: action.workOrderId, operatorId },
            actor
          );
        }
        updated = (await this.production.getWorkOrderById(tenantId, action.workOrderId))!;
        break;
      }

      case 'RESEQUENCE':
        if (action.sequence === undefined) throw ApiError.validation('sequence wajib diisi.');
        updated = await this.production.updateWorkOrder(tenantId, action.workOrderId, {
          sequence: action.sequence,
        });
        break;

      case 'REPRIORITISE':
        if (action.priority === undefined) throw ApiError.validation('priority wajib diisi.');
        updated = await this.production.updateWorkOrder(tenantId, action.workOrderId, {
          priority: action.priority,
        });
        break;

      case 'CONFIRM':
        updated = await this.production.confirmWorkOrder(tenantId, action.workOrderId, {
          confirmedBy: actor.id,
        });
        break;

      case 'CANCEL':
        if (!action.reason) throw ApiError.validation('Pembatalan memerlukan alasan.');
        updated = await this.production.cancelWorkOrder(tenantId, action.workOrderId, action.reason);
        break;

      default:
        throw ApiError.validation('Aksi dispatch tidak dikenal.');
    }

    this.events.recordDetached({
      tenantId,
      eventType: action.action === 'CANCEL' ? 'WO_CANCELLED' : 'SCHEDULE_CHANGED',
      entityType: 'WORK_ORDER',
      entityId: action.workOrderId,
      actorType: 'USER',
      actorId: actor.id,
      actorName: actor.name,
      workOrderId: action.workOrderId,
      machineId: updated.machineId,
      lineId: updated.lineId,
      summary: `${updated.woNumber}: ${action.action}${action.reason ? ` — ${action.reason}` : ''}`,
      beforeValue: before,
      afterValue: {
        plannedStart: updated.plannedStart,
        plannedEnd: updated.plannedEnd,
        machineId: updated.machineId,
        priority: updated.priority,
        sequence: updated.sequence,
      },
    });

    return updated;
  }

  /** Refuses a change that would double-book a machine (§9.5, blocking). */
  private async assertNoMachineClash(
    tenantId: string,
    workOrder: WorkOrder,
    target: { machineId?: string; start: string; end: string }
  ): Promise<void> {
    if (!target.machineId) return;

    const others = (await this.production.getWorkOrders(tenantId, {})).filter(
      (candidate) =>
        candidate.id !== workOrder.id &&
        candidate.machineId === target.machineId &&
        candidate.status !== WorkOrderStatus.CANCELLED &&
        candidate.status !== WorkOrderStatus.COMPLETED
    );

    const window = { start: new Date(target.start).getTime(), end: new Date(target.end).getTime() };
    const clash = others.find((candidate) =>
      ProductionBoardService.overlaps(window, {
        start: new Date(candidate.plannedStart).getTime(),
        end: new Date(candidate.plannedEnd).getTime(),
      })
    );

    if (clash) {
      throw ApiError.conflict(
        `Jadwal bentrok dengan ${clash.woNumber} pada mesin yang sama (${clash.plannedStart} – ${clash.plannedEnd}).`
      );
    }
  }
}
