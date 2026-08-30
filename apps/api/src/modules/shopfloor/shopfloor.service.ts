import {
  ProductionRecord,
  DowntimeRecord,
  DowntimeStatus,
  RecordSource,
  MachineStateLog,
  MachineState,
} from '@factory-vision/domain-types';
import type { SyncBatchResult, SyncCommandResult } from '@factory-vision/domain-types';
import { ApiError } from '../../platform/http/api-error.js';
import { MasterDataService } from '../master-data/master-data.service.js';
import { ProductionService } from '../production/production.service.js';
import { generateHistory, type HistorySeedInput } from './history.seed.js';
import { resolveShiftContext } from './shift-date.js';
import { demoRows } from '../../platform/config/demo-seed.js';

export class ShopFloorService {
  private productionRecords: ProductionRecord[] = demoRows<ProductionRecord>(() => [
    {
      id: 'pr-init-01',
      tenantId: 'tenant-pilot-factory-01',
      workOrderId: 'wo-101',
      machineId: 'mc-mix-01',
      operatorId: 'op-001',
      shiftId: 'shift-1',
      shiftDate: '2026-08-28',
      goodQuantity: 242,
      rejectQuantity: 4,
      rejectReasonId: 'rej-dimension',
      recordedAt: '2026-08-28T09:15:00.000Z',
      source: RecordSource.OPERATOR_MANUAL,
      clientEventId: 'evt-init-01',
      notes: 'Akumulasi batch kompon per jam',
    },
    {
      id: 'pr-init-02',
      tenantId: 'tenant-pilot-factory-01',
      workOrderId: 'wo-102',
      machineId: 'mc-tbm-01',
      operatorId: 'op-002',
      shiftId: 'shift-1',
      shiftDate: '2026-08-28',
      goodQuantity: 141,
      rejectQuantity: 3,
      rejectReasonId: 'rej-scratch',
      recordedAt: '2026-08-28T09:15:00.000Z',
      source: RecordSource.OPERATOR_MANUAL,
      clientEventId: 'evt-init-02',
      notes: 'Green tire build accumulation',
    },
  ]);

  private downtimeRecords: DowntimeRecord[] = demoRows<DowntimeRecord>(() => [
    {
      id: 'dt-rec-001',
      tenantId: 'tenant-pilot-factory-01',
      workOrderId: 'wo-101',
      machineId: 'mc-mix-01',
      lineId: 'line-01',
      shiftId: 'shift-1',
      shiftDate: '2026-08-28',
      reasonId: 'dt-setup',
      startTime: '2026-08-28T07:15:00.000Z',
      endTime: '2026-08-28T07:35:00.000Z',
      durationSeconds: 1200,
      isPlanned: true,
      notes: 'Initial die setup for batch',
      clientEventId: 'evt-dt-init-01',
      status: DowntimeStatus.RESOLVED,
    },
    {
      id: 'dt-rec-002',
      tenantId: 'tenant-pilot-factory-01',
      workOrderId: 'wo-101',
      machineId: 'mc-mix-01',
      lineId: 'line-01',
      shiftId: 'shift-1',
      shiftDate: '2026-08-28',
      reasonId: 'dt-breakdown',
      startTime: '2026-08-28T08:10:00.000Z',
      endTime: '2026-08-28T08:25:00.000Z',
      durationSeconds: 900,
      isPlanned: false,
      notes: 'Hydraulic sensor glitch',
      clientEventId: 'evt-dt-init-02',
      status: DowntimeStatus.RESOLVED,
    },
    {
      id: 'dt-rec-003',
      tenantId: 'tenant-pilot-factory-01',
      workOrderId: 'wo-102',
      machineId: 'mc-tbm-01',
      lineId: 'line-01',
      shiftId: 'shift-1',
      shiftDate: '2026-08-28',
      reasonId: 'dt-material',
      startTime: '2026-08-28T08:40:00.000Z',
      endTime: '2026-08-28T08:55:00.000Z',
      durationSeconds: 900,
      isPlanned: false,
      notes: 'Menunggu kompon dari area mixing',
      clientEventId: 'evt-dt-init-03',
      status: DowntimeStatus.RESOLVED,
    },
  ]);

  private machineStateLogs: MachineStateLog[] = [];

  // Idempotency event store
  private processedEvents = new Set<string>();

  constructor(
    private productionService: ProductionService,
    private masterData: MasterDataService
  ) {}

  /**
   * The production context a shop-floor event inherits from its work order
   * (US-014: "Operator tidak perlu memasukkan ulang inherited context").
   *
   * Process, batch/lot and machine are properties of the planned work, not of
   * the button the operator pressed, so the server resolves them rather than
   * trusting a terminal that may have been offline when the plan changed.
   */
  private contextFor(tenantId: string, workOrderId: string | undefined) {
    const workOrder = workOrderId ? this.productionService.getWorkOrderById(tenantId, workOrderId) : undefined;
    return {
      workOrder,
      processId: workOrder?.processId,
      batchId: workOrder?.batchId,
      productId: workOrder?.productId,
      lineId: workOrder?.lineId,
      machineId: workOrder?.machineId,
    };
  }

  /** `shift_date`, derived from configured shifts. */
  private shiftContext(tenantId: string, occurredAt: string, shiftId?: string) {
    return resolveShiftContext(this.masterData.getShifts(tenantId), occurredAt, shiftId);
  }

  /** True when this client event has already been applied (US-046). */
  hasProcessed(tenantId: string, clientEventId: string): boolean {
    return this.processedEvents.has(`${tenantId}:${clientEventId}`);
  }

  recordOutput(
    tenantId: string,
    cmd: {
      workOrderId: string;
      machineId?: string;
      operatorId: string;
      shiftId?: string;
      goodQuantity: number;
      rejectQuantity: number;
      rejectReasonId?: string;
      clientEventId: string;
      occurredAt: string;
      notes?: string;
    }
  ): ProductionRecord {
    const eventKey = `${tenantId}:${cmd.clientEventId}`;
    if (this.processedEvents.has(eventKey)) {
      const existing = this.productionRecords.find((r) => r.clientEventId === cmd.clientEventId);
      if (existing) return existing;
    }

    const context = this.contextFor(tenantId, cmd.workOrderId);
    if (!context.workOrder) throw ApiError.notFound('Work order tidak ditemukan.');

    if (cmd.goodQuantity < 0 || cmd.rejectQuantity < 0) {
      throw ApiError.validation('Quantity tidak boleh negatif.', [
        { field: 'goodQuantity', code: 'OUT_OF_RANGE', message: 'Quantity tidak boleh negatif.' },
      ]);
    }
    // US-019: a reject without a reason is a number nobody can act on.
    if (cmd.rejectQuantity > 0 && !cmd.rejectReasonId) {
      throw ApiError.validation('Reject reason wajib diisi ketika mencatat reject.', [
        { field: 'rejectReasonId', code: 'REQUIRED', message: 'Pilih alasan reject.' },
      ]);
    }
    if (cmd.rejectReasonId) {
      const reason = this.masterData.getRejectReasons(tenantId).find((r) => r.id === cmd.rejectReasonId);
      if (!reason || !reason.active) {
        throw ApiError.validation('Reject reason tidak valid.', [
          {
            field: 'rejectReasonId',
            code: 'UNKNOWN_REFERENCE',
            message: 'Alasan reject tidak dikenal atau nonaktif.',
          },
        ]);
      }
    }

    const shift = this.shiftContext(tenantId, cmd.occurredAt, cmd.shiftId);
    this.processedEvents.add(eventKey);

    const record: ProductionRecord = {
      id: `pr-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      tenantId,
      workOrderId: cmd.workOrderId,
      processId: context.processId,
      batchId: context.batchId,
      machineId: cmd.machineId ?? context.machineId ?? '',
      operatorId: cmd.operatorId,
      shiftId: shift.shiftId,
      shiftDate: shift.shiftDate,
      goodQuantity: cmd.goodQuantity,
      rejectQuantity: cmd.rejectQuantity,
      rejectReasonId: cmd.rejectReasonId,
      recordedAt: cmd.occurredAt,
      source: RecordSource.OPERATOR_MANUAL,
      clientEventId: cmd.clientEventId,
      notes: cmd.notes,
    };

    this.productionRecords.push(record);

    // Update running total in Work Order
    this.productionService.incrementQuantities(tenantId, cmd.workOrderId, cmd.goodQuantity, cmd.rejectQuantity);

    return record;
  }

  startDowntime(
    tenantId: string,
    cmd: {
      machineId: string;
      lineId?: string;
      workOrderId?: string;
      operatorId?: string;
      shiftId?: string;
      reasonId: string;
      notes?: string;
      clientEventId: string;
      occurredAt: string;
      isPlanned?: boolean;
    }
  ): DowntimeRecord {
    const eventKey = `${tenantId}:${cmd.clientEventId}`;
    if (this.processedEvents.has(eventKey)) {
      const existing = this.downtimeRecords.find((r) => r.clientEventId === cmd.clientEventId);
      if (existing) return existing;
    }

    // US-016 makes the reason mandatory and scoped: an unknown or retired code
    // would produce a Pareto bar nobody can trace back to a cause.
    const reason = this.masterData.getDowntimeReasons(tenantId).find((r) => r.id === cmd.reasonId);
    if (!reason) {
      throw ApiError.validation('Downtime reason tidak valid.', [
        { field: 'reasonId', code: 'UNKNOWN_REFERENCE', message: 'Alasan downtime tidak dikenal.' },
      ]);
    }
    if (!reason.active) {
      throw ApiError.validation('Downtime reason sudah nonaktif.', [
        { field: 'reasonId', code: 'UNKNOWN_REFERENCE', message: 'Alasan downtime tidak lagi berlaku.' },
      ]);
    }

    const context = this.contextFor(tenantId, cmd.workOrderId);
    const lineId = cmd.lineId ?? context.lineId ?? this.masterData.getLineIdForMachine(tenantId, cmd.machineId);
    if (!lineId) {
      throw ApiError.validation('Production line tidak dapat ditentukan untuk downtime ini.', [
        {
          field: 'lineId',
          code: 'REQUIRED',
          message: 'Line wajib diisi bila tidak dapat diturunkan dari mesin.',
        },
      ]);
    }

    // US-016 stores process_id on *every* downtime record. It comes from the
    // work order when one is running, and from the machine's work centre
    // routing otherwise, so a standalone machine stop is still attributable.
    const processId = context.processId ?? this.processIdForMachine(tenantId, cmd.machineId);

    const shift = this.shiftContext(tenantId, cmd.occurredAt, cmd.shiftId);
    this.processedEvents.add(eventKey);

    const record: DowntimeRecord = {
      id: `dt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      tenantId,
      machineId: cmd.machineId,
      processId,
      lineId,
      operatorId: cmd.operatorId,
      workOrderId: cmd.workOrderId,
      shiftId: shift.shiftId,
      shiftDate: shift.shiftDate,
      reasonId: cmd.reasonId,
      startTime: cmd.occurredAt,
      // `is_planned` follows the configured reason code, never the client
      //: the same stoppage must classify identically every time.
      isPlanned: reason.isPlanned,
      notes: cmd.notes,
      clientEventId: cmd.clientEventId,
      status: DowntimeStatus.ACTIVE,
    };

    this.downtimeRecords.push(record);
    return record;
  }

  /** The process a machine normally runs, via its work centre routing. */
  private processIdForMachine(tenantId: string, machineId: string): string | undefined {
    const routing = this.masterData
      .getProductRoutings(tenantId)
      .find((r) => r.machineId === machineId && r.active);
    return routing?.processId;
  }

  resolveDowntime(
    tenantId: string,
    downtimeId: string,
    cmd: {
      clientEventId: string;
      occurredAt: string;
    }
  ): DowntimeRecord {
    const record = this.downtimeRecords.find((d) => d.tenantId === tenantId && d.id === downtimeId);
    if (!record) throw ApiError.notFound('Downtime record tidak ditemukan.');

    // Replaying a resolve after a flaky reconnect must not stretch the
    // duration to the retry's clock (US-046).
    if (record.status === DowntimeStatus.RESOLVED) return record;

    const eventKey = `${tenantId}:${cmd.clientEventId}`;
    this.processedEvents.add(eventKey);

    record.endTime = cmd.occurredAt;
    record.status = DowntimeStatus.RESOLVED;
    const startMs = new Date(record.startTime).getTime();
    const endMs = new Date(cmd.occurredAt).getTime();
    record.durationSeconds = Math.max(0, Math.floor((endMs - startMs) / 1000));

    return record;
  }

  /** The still-open downtime on a machine, if any (US-017, US-020). */
  getActiveDowntimeForMachine(tenantId: string, machineId: string): DowntimeRecord | undefined {
    return this.downtimeRecords.find(
      (d) => d.tenantId === tenantId && d.machineId === machineId && d.status === DowntimeStatus.ACTIVE
    );
  }

  /** The still-open downtime attached to a work order, if any. */
  getActiveDowntimeForWorkOrder(tenantId: string, workOrderId: string): DowntimeRecord | undefined {
    return this.downtimeRecords.find(
      (d) => d.tenantId === tenantId && d.workOrderId === workOrderId && d.status === DowntimeStatus.ACTIVE
    );
  }

  getActiveDowntimes(tenantId: string) {
    return this.downtimeRecords.filter((d) => d.tenantId === tenantId && d.status === DowntimeStatus.ACTIVE);
  }

  getDowntimeRecords(tenantId: string, lineId?: string) {
    return this.downtimeRecords.filter((d) => d.tenantId === tenantId && (!lineId || d.lineId === lineId));
  }

  getProductionRecords(tenantId: string, workOrderId?: string) {
    return this.productionRecords.filter(
      (p) => p.tenantId === tenantId && (!workOrderId || p.workOrderId === workOrderId)
    );
  }

  /**
   * Load a deterministic back-catalogue of shift records so the Executive
   * Dashboard's trend and previous-period requirements are
   * answered from real aggregation rather than invented in the UI.
   *
   * Called once at boot from main.ts, after master data is available. Records
   * are prepended so the hand-written "today" seed stays last in the array.
   */
  seedHistory(input: HistorySeedInput): { productionCount: number; downtimeCount: number } {
    const { production, downtime } = generateHistory(input);

    const existingProduction = new Set(this.productionRecords.map((p) => p.id));
    const existingDowntime = new Set(this.downtimeRecords.map((d) => d.id));

    const newProduction = production.filter((p) => !existingProduction.has(p.id));
    const newDowntime = downtime.filter((d) => !existingDowntime.has(d.id));

    this.productionRecords.unshift(...newProduction);
    this.downtimeRecords.unshift(...newDowntime);

    return { productionCount: newProduction.length, downtimeCount: newDowntime.length };
  }

  /**
   * Drains an operator terminal's offline queue (US-045, US-046).
   *
   * Every command is reported individually. The terminal needs three distinct
   * outcomes, not a count: `APPLIED` clears the row, `DUPLICATE` clears it too
   * (the server already has it, this is what makes reconnecting safe), and
   * `FAILED` keeps it, with `retryable` deciding whether the terminal tries
   * again or surfaces it to the operator. Nothing is ever dropped silently.
   */
  syncBatch(
    tenantId: string,
    commands: Array<{
      type: string;
      clientEventId: string;
      payload: any;
      occurredAt: string;
      workOrderId: string;
    }>
  ): SyncBatchResult {
    const results: SyncCommandResult[] = [];

    for (const cmd of commands) {
      if (!cmd.clientEventId) {
        results.push({
          clientEventId: '',
          status: 'FAILED',
          errorCode: 'VALIDATION_ERROR',
          errorMessage: 'client_event_id wajib ada pada setiap perintah offline.',
          retryable: false,
        });
        continue;
      }

      if (this.hasProcessed(tenantId, cmd.clientEventId)) {
        results.push({ clientEventId: cmd.clientEventId, status: 'DUPLICATE', retryable: false });
        continue;
      }

      try {
        const entityId = this.applyCommand(tenantId, cmd);
        results.push({ clientEventId: cmd.clientEventId, status: 'APPLIED', entityId, retryable: false });
      } catch (error) {
        const apiError = error instanceof ApiError ? error : undefined;
        // A validation failure will fail identically forever; anything else
        // may be transient, so the terminal is told it can retry.
        const retryable = !apiError || !['VALIDATION_ERROR', 'FORBIDDEN', 'NOT_FOUND'].includes(apiError.code);
        results.push({
          clientEventId: cmd.clientEventId,
          status: 'FAILED',
          errorCode: apiError?.code ?? 'INTERNAL_ERROR',
          errorMessage: error instanceof Error ? error.message : 'Gagal memproses perintah.',
          retryable,
        });
      }
    }

    return {
      processed: results.length,
      applied: results.filter((r) => r.status === 'APPLIED').length,
      duplicates: results.filter((r) => r.status === 'DUPLICATE').length,
      failed: results.filter((r) => r.status === 'FAILED').length,
      results,
      serverTime: new Date().toISOString(),
    };
  }

  private applyCommand(
    tenantId: string,
    cmd: { type: string; clientEventId: string; payload: any; occurredAt: string; workOrderId: string }
  ): string | undefined {
    const payload = cmd.payload ?? {};

    switch (cmd.type) {
      case 'RECORD_OUTPUT':
        return this.recordOutput(tenantId, {
          ...payload,
          workOrderId: cmd.workOrderId,
          clientEventId: cmd.clientEventId,
          occurredAt: cmd.occurredAt,
        }).id;

      case 'RECORD_DOWNTIME':
        return this.startDowntime(tenantId, {
          ...payload,
          workOrderId: cmd.workOrderId,
          clientEventId: cmd.clientEventId,
          occurredAt: cmd.occurredAt,
        }).id;

      case 'RESOLVE_DOWNTIME': {
        const target = payload.downtimeId ?? this.getActiveDowntimeForWorkOrder(tenantId, cmd.workOrderId)?.id;
        if (!target) throw ApiError.notFound('Tidak ada downtime aktif untuk diselesaikan.');
        return this.resolveDowntime(tenantId, target, {
          clientEventId: cmd.clientEventId,
          occurredAt: cmd.occurredAt,
        }).id;
      }

      case 'START_WO':
        this.markProcessed(tenantId, cmd.clientEventId);
        return this.productionService.startWorkOrder(tenantId, cmd.workOrderId, {
          operatorId: payload.operatorId,
          occurredAt: cmd.occurredAt,
        }).id;

      case 'PAUSE_WO':
        this.markProcessed(tenantId, cmd.clientEventId);
        return this.productionService.pauseWorkOrder(tenantId, cmd.workOrderId).id;

      case 'RESUME_WO':
        this.markProcessed(tenantId, cmd.clientEventId);
        return this.productionService.resumeWorkOrder(tenantId, cmd.workOrderId).id;

      case 'COMPLETE_WO':
        this.markProcessed(tenantId, cmd.clientEventId);
        return this.productionService.completeWorkOrder(tenantId, cmd.workOrderId, {
          occurredAt: cmd.occurredAt,
        }).id;

      default:
        throw ApiError.validation(`Tipe perintah offline tidak dikenal: ${cmd.type}.`);
    }
  }

  /**
   * Marks a client event as applied for commands whose handler does not do it
   * itself, the work-order state transitions live in ProductionService, which
   * has no idempotency store of its own.
   */
  markProcessed(tenantId: string, clientEventId: string): void {
    this.processedEvents.add(`${tenantId}:${clientEventId}`);
  }
}
