import { DowntimeStatus, MachineState, RecordSource } from '@factory-vision/domain-types';
import type { DowntimeRecord, MachineStateLog, ProductionRecord } from '@factory-vision/domain-types';
import type { SyncBatchResult, SyncCommandResult } from '@factory-vision/domain-types';
import { ApiError } from '../../platform/http/api-error.js';
import { getPool, withTenant } from '../../platform/db/pool.js';
import type { Executor } from '../../platform/db/executor.js';
import { MasterDataService } from '../master-data/master-data.service.js';
import { ProductionService } from '../production/production.service.js';
import { generateHistory, type HistorySeedInput } from './history.seed.js';
import { resolveShiftContext } from './shift-date.js';
import { ProductionRecordRepository } from './production-record.repository.js';
import { DowntimeRepository } from './downtime.repository.js';
import { SyncEventRepository } from './sync-event.repository.js';
import { MachineStateRepository } from './machine-state.repository.js';

/**
 * Shop-floor capture (US-014 … US-020, US-045, US-046).
 *
 * Every method here writes to PostgreSQL before it answers. These records are
 * the MES system of record: good and reject quantity, downtime start and end,
 * and the shift context each belongs to are what every OEE figure and every
 * report is derived from. They previously lived in JavaScript arrays, so
 * `docker compose restart api` erased the plant's production history and the
 * dashboard came back showing different numbers.
 *
 * Each operation runs inside `withTenant`, which is both a transaction and the
 * `app.tenant_id` declaration the row-level security policies read. That gives
 * two things at once: a multi-row write cannot half-commit (persistence fix
 * §7), and a query that forgot its tenant filter returns nothing rather than
 * another factory's production.
 */
export class ShopFloorService {
  private readonly productionRecords = new ProductionRecordRepository();
  private readonly downtimes = new DowntimeRepository();
  private readonly syncEvents = new SyncEventRepository();
  private readonly machineStates = new MachineStateRepository();

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
  private async contextFor(exec: Executor, tenantId: string, workOrderId: string | undefined) {
    const workOrder = workOrderId
      ? await this.productionService.getWorkOrderByIdWith(exec, tenantId, workOrderId)
      : undefined;
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
  async hasProcessed(tenantId: string, clientEventId: string): Promise<boolean> {
    return withTenant(tenantId, (client) => this.syncEvents.has(client, tenantId, clientEventId));
  }

  // --- Production output (US-018, US-019) ----------------------------

  async recordOutput(
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
  ): Promise<ProductionRecord> {
    this.validateOutput(tenantId, cmd);

    return withTenant(tenantId, async (client) => {
      // A replay returns the record the first attempt produced rather than
      // writing a second one. The unique constraint underneath makes this hold
      // even when two replays arrive at the same instant.
      const existing = await this.productionRecords.findByClientEventId(
        client,
        tenantId,
        cmd.clientEventId
      );
      if (existing) return existing;

      const context = await this.contextFor(client, tenantId, cmd.workOrderId);
      if (!context.workOrder) throw ApiError.notFound('Work order tidak ditemukan.');

      const shift = this.shiftContext(tenantId, cmd.occurredAt, cmd.shiftId);

      const draft: ProductionRecord = {
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

      const { record, created } = await this.productionRecords.create(client, draft);

      // The work order's running totals and the record that justifies them are
      // one fact, so they commit together. Incrementing only when the insert
      // actually created a row keeps a replay from counting twice.
      if (created) {
        await this.productionService.incrementQuantitiesWith(
          client,
          tenantId,
          cmd.workOrderId,
          cmd.goodQuantity,
          cmd.rejectQuantity
        );
        await this.syncEvents.claim(
          client,
          tenantId,
          cmd.clientEventId,
          'RECORD_OUTPUT',
          cmd.workOrderId,
          record.id
        );
        // Output means the machine was running when it happened (§11). The
        // repository ignores a repeat of the state already open, so a shift of
        // steady production is one row, not one per tap.
        if (record.machineId) {
          await this.machineStates.transition(client, {
            tenantId,
            machineId: record.machineId,
            processId: record.processId,
            state: MachineState.RUNNING,
            startedAt: record.recordedAt,
            workOrderId: record.workOrderId,
            shiftDate: record.shiftDate,
          });
        }
      }

      return record;
    });
  }

  /** Everything that can be judged without touching the database. */
  private validateOutput(
    tenantId: string,
    cmd: { goodQuantity: number; rejectQuantity: number; rejectReasonId?: string }
  ): void {
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
  }

  // --- Downtime (US-016, US-017, US-020) -----------------------------

  async startDowntime(
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
  ): Promise<DowntimeRecord> {
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

    return withTenant(tenantId, async (client) => {
      const existing = await this.downtimes.findByClientEventId(client, tenantId, cmd.clientEventId);
      if (existing) return existing;

      const context = await this.contextFor(client, tenantId, cmd.workOrderId);
      const lineId =
        cmd.lineId ?? context.lineId ?? this.masterData.getLineIdForMachine(tenantId, cmd.machineId);
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

      const draft: DowntimeRecord = {
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

      const { record, created } = await this.downtimes.create(client, draft);
      if (created) {
        await this.syncEvents.claim(
          client,
          tenantId,
          cmd.clientEventId,
          'RECORD_DOWNTIME',
          cmd.workOrderId,
          record.id
        );
        await this.machineStates.transition(client, {
          tenantId,
          machineId: record.machineId,
          processId: record.processId,
          state: MachineState.DOWNTIME,
          reasonId: record.reasonId,
          startedAt: record.startTime,
          workOrderId: record.workOrderId,
          shiftDate: record.shiftDate,
        });
      }
      return record;
    });
  }

  /** The process a machine normally runs, via its work centre routing. */
  private processIdForMachine(tenantId: string, machineId: string): string | undefined {
    const routing = this.masterData
      .getProductRoutings(tenantId)
      .find((r) => r.machineId === machineId && r.active);
    return routing?.processId;
  }

  async resolveDowntime(
    tenantId: string,
    downtimeId: string,
    cmd: { clientEventId: string; occurredAt: string }
  ): Promise<DowntimeRecord> {
    return withTenant(tenantId, async (client) => {
      const record = await this.downtimes.findById(client, tenantId, downtimeId);
      if (!record) throw ApiError.notFound('Downtime record tidak ditemukan.');

      // Replaying a resolve after a flaky reconnect must not stretch the
      // duration to the retry's clock (US-046). The repository's UPDATE is
      // guarded on status = ACTIVE for the same reason.
      if (record.status === DowntimeStatus.RESOLVED) return record;

      const startMs = new Date(record.startTime).getTime();
      const endMs = new Date(cmd.occurredAt).getTime();
      const durationSeconds = Math.max(0, Math.floor((endMs - startMs) / 1000));

      const resolved = await this.downtimes.resolve(
        client,
        tenantId,
        downtimeId,
        cmd.occurredAt,
        durationSeconds
      );
      if (!resolved) throw ApiError.notFound('Downtime record tidak ditemukan.');

      await this.syncEvents.claim(
        client,
        tenantId,
        cmd.clientEventId,
        'RESOLVE_DOWNTIME',
        resolved.workOrderId,
        resolved.id
      );
      // The stop is over, so the machine is idle until output proves it is
      // running again. Claiming RUNNING here would inflate Availability with
      // time nobody has evidence for.
      await this.machineStates.transition(client, {
        tenantId,
        machineId: resolved.machineId,
        processId: resolved.processId,
        state: MachineState.IDLE,
        startedAt: cmd.occurredAt,
        workOrderId: resolved.workOrderId,
        shiftDate: resolved.shiftDate,
      });
      return resolved;
    });
  }

  /** The still-open downtime on a machine, if any (US-017, US-020). */
  async getActiveDowntimeForMachine(
    tenantId: string,
    machineId: string
  ): Promise<DowntimeRecord | undefined> {
    return withTenant(tenantId, (client) =>
      this.downtimes.findActiveForMachine(client, tenantId, machineId)
    );
  }

  /** The still-open downtime attached to a work order, if any. */
  async getActiveDowntimeForWorkOrder(
    tenantId: string,
    workOrderId: string
  ): Promise<DowntimeRecord | undefined> {
    return withTenant(tenantId, (client) =>
      this.downtimes.findActiveForWorkOrder(client, tenantId, workOrderId)
    );
  }

  async getActiveDowntimes(tenantId: string): Promise<DowntimeRecord[]> {
    return withTenant(tenantId, (client) => this.downtimes.listActive(client, tenantId));
  }

  async getDowntimeRecords(tenantId: string, lineId?: string): Promise<DowntimeRecord[]> {
    return withTenant(tenantId, (client) => this.downtimes.list(client, tenantId, { lineId }));
  }

  async getProductionRecords(tenantId: string, workOrderId?: string): Promise<ProductionRecord[]> {
    return withTenant(tenantId, (client) =>
      this.productionRecords.list(client, tenantId, { workOrderId })
    );
  }

  /** What each machine is doing right now, read from the log (§11). */
  async getMachineStates(tenantId: string): Promise<MachineStateLog[]> {
    return withTenant(tenantId, (client) => this.machineStates.listOpen(client, tenantId));
  }

  async getMachineStateHistory(
    tenantId: string,
    machineId?: string
  ): Promise<MachineStateLog[]> {
    return withTenant(tenantId, (client) => this.machineStates.list(client, tenantId, { machineId }));
  }

  /** Row counts, for the boot log and the persistence acceptance checks. */
  async counts(
    tenantId: string
  ): Promise<{ production: number; downtime: number; machineStates: number }> {
    return withTenant(tenantId, async (client) => ({
      production: await this.productionRecords.count(client, tenantId),
      downtime: await this.downtimes.count(client, tenantId),
      machineStates: await this.machineStates.count(client, tenantId),
    }));
  }

  /**
   * Load a deterministic back-catalogue of shift records so the Executive
   * Dashboard's trend and previous-period requirements are answered from real
   * aggregation rather than invented in the UI.
   *
   * Called once at boot from main.ts, after master data is available. Every
   * row carries a stable `client_event_id`, so a second boot inserts nothing
   * instead of doubling the demo history.
   */
  async seedHistory(input: HistorySeedInput): Promise<{ productionCount: number; downtimeCount: number }> {
    const { production, downtime } = generateHistory(input);
    return withTenant(input.tenantId, async (client) => ({
      productionCount: await this.productionRecords.createMany(client, production),
      downtimeCount: await this.downtimes.createMany(client, downtime),
    }));
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
  async syncBatch(
    tenantId: string,
    commands: Array<{
      type: string;
      clientEventId: string;
      payload: any;
      occurredAt: string;
      workOrderId: string;
    }>
  ): Promise<SyncBatchResult> {
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

      if (await this.hasProcessed(tenantId, cmd.clientEventId)) {
        results.push({ clientEventId: cmd.clientEventId, status: 'DUPLICATE', retryable: false });
        continue;
      }

      try {
        const entityId = await this.applyCommand(tenantId, cmd);
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

  private async applyCommand(
    tenantId: string,
    cmd: { type: string; clientEventId: string; payload: any; occurredAt: string; workOrderId: string }
  ): Promise<string | undefined> {
    const payload = cmd.payload ?? {};

    switch (cmd.type) {
      case 'RECORD_OUTPUT': {
        const record = await this.recordOutput(tenantId, {
          ...payload,
          workOrderId: cmd.workOrderId,
          clientEventId: cmd.clientEventId,
          occurredAt: cmd.occurredAt,
        });
        return record.id;
      }

      case 'RECORD_DOWNTIME': {
        const record = await this.startDowntime(tenantId, {
          ...payload,
          workOrderId: cmd.workOrderId,
          clientEventId: cmd.clientEventId,
          occurredAt: cmd.occurredAt,
        });
        return record.id;
      }

      case 'RESOLVE_DOWNTIME': {
        const active = await this.getActiveDowntimeForWorkOrder(tenantId, cmd.workOrderId);
        const target = payload.downtimeId ?? active?.id;
        if (!target) throw ApiError.notFound('Tidak ada downtime aktif untuk diselesaikan.');
        const record = await this.resolveDowntime(tenantId, target, {
          clientEventId: cmd.clientEventId,
          occurredAt: cmd.occurredAt,
        });
        return record.id;
      }

      case 'START_WO': {
        const wo = await this.productionService.startWorkOrder(tenantId, cmd.workOrderId, {
          operatorId: payload.operatorId,
          occurredAt: cmd.occurredAt,
        });
        await this.markProcessed(tenantId, cmd.clientEventId, cmd.type, cmd.workOrderId, wo.id);
        return wo.id;
      }

      case 'PAUSE_WO': {
        const wo = await this.productionService.pauseWorkOrder(tenantId, cmd.workOrderId);
        await this.markProcessed(tenantId, cmd.clientEventId, cmd.type, cmd.workOrderId, wo.id);
        return wo.id;
      }

      case 'RESUME_WO': {
        const wo = await this.productionService.resumeWorkOrder(tenantId, cmd.workOrderId);
        await this.markProcessed(tenantId, cmd.clientEventId, cmd.type, cmd.workOrderId, wo.id);
        return wo.id;
      }

      case 'COMPLETE_WO': {
        const wo = await this.productionService.completeWorkOrder(tenantId, cmd.workOrderId, {
          occurredAt: cmd.occurredAt,
        });
        await this.markProcessed(tenantId, cmd.clientEventId, cmd.type, cmd.workOrderId, wo.id);
        return wo.id;
      }

      default:
        throw ApiError.validation(`Tipe perintah offline tidak dikenal: ${cmd.type}.`);
    }
  }

  /**
   * Records a client event as applied for commands whose handler writes no row
   * of its own: the work-order state transitions live in ProductionService,
   * which has no idempotency key to conflict on.
   */
  async markProcessed(
    tenantId: string,
    clientEventId: string,
    commandType = 'UNKNOWN',
    workOrderId?: string,
    entityId?: string
  ): Promise<void> {
    await withTenant(tenantId, (client) =>
      this.syncEvents.claim(client, tenantId, clientEventId, commandType, workOrderId, entityId)
    );
  }

  /** Escape hatch for callers that already hold a transaction. */
  poolExecutor(): Executor {
    return getPool();
  }
}
