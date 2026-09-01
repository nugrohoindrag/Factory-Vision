import { DowntimeStatus, MachineState, RecordSource } from '@factory-vision/domain-types';
import type { DowntimeRecord, MachineStateLog, ProductionRecord } from '@factory-vision/domain-types';
import type { SyncBatchResult, SyncCommandResult } from '@factory-vision/domain-types';
import { ApiError } from '../../platform/http/api-error.js';
import {
  QuantityFlowService,
  QuantityFlowViolation,
} from '../production/quantity-flow.service.js';
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
import {
  SyncExceptionRepository,
  type SyncException,
  type SyncExceptionFilter,
} from './sync-exception.repository.js';
import { ProcessChainService } from '../production/process-chain.service.js';

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
  private readonly syncExceptions = new SyncExceptionRepository();
  private readonly processChain = new ProcessChainService();

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
      // Batch context is resolved from production_batch.work_order_id once
      // operator batch selection lands (MES-075, Sprint 11). A work order that
      // is not batch-managed never carries one (E1).
      batchId: undefined,
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

      // The units this record accounts for. `good + reject` today; scrap and
      // rework join it when the terminal captures them (MES-067).
      const inputQuantity = cmd.goodQuantity + cmd.rejectQuantity;

      // MES-017 exists so an impossible number is never stored, which is only
      // true if the write path consults it. Judged against the totals the work
      // order already holds, before the increment is applied.
      //
      // The domain throws its own violation type; the service is where that
      // becomes the HTTP contract. It matters beyond tidiness: the offline sync
      // classifies a non-ApiError as transient and would retry an impossible
      // quantity for ever, instead of reporting it once as an exception a
      // supervisor can act on.
      try {
        QuantityFlowService.assertDelta(
          'WORK_ORDER',
          context.workOrder.woNumber,
          {
            plannedQuantity: context.workOrder.plannedQuantity,
            inputQuantity: context.workOrder.inputQuantity,
            outputQuantity: context.workOrder.outputQuantity,
            rejectQuantity: context.workOrder.rejectQuantity,
            scrapQuantity: context.workOrder.scrapQuantity,
            reworkQuantity: context.workOrder.reworkQuantity,
            transferredQuantity: context.workOrder.transferredQuantity,
          },
          {
            inputQuantity,
            outputQuantity: cmd.goodQuantity,
            rejectQuantity: cmd.rejectQuantity,
          }
        );
      } catch (error) {
        if (error instanceof QuantityFlowViolation) {
          throw ApiError.validation(
            error.message,
            error.violations.map((violation) => ({
              field: 'goodQuantity',
              code: violation.invariant,
              message: violation.message,
            }))
          );
        }
        throw error;
      }

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
        // §10: input is what actually entered the process. Every unit this
        // record accounts for entered it, so unless the operator states a
        // different figure the input is the sum of the dispositions. Leaving it
        // at zero is what produced work orders with negative WIP.
        inputQuantity: inputQuantity,
        // §7: the composite FK requires these to match the work order exactly.
        // Copying them from the row we just read is what makes the exclusivity
        // constraint verifiable rather than merely declared.
        isBatchManaged: context.workOrder.isBatchManaged ?? false,
        hasChildWorkOrder: context.workOrder.hasChildWorkOrder ?? false,
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
          cmd.rejectQuantity,
          { input: inputQuantity }
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

        // A command that finally lands closes the exception it raised earlier;
        // otherwise a transient failure would sit in the supervisor's list for
        // ever and train them to ignore it.
        await this.closeExceptionFor(tenantId, cmd.clientEventId);

        // Section 13 / MES-082: a quantity beyond what the predecessor handed
        // over is *reported*, not refused. The shop floor legitimately knows
        // about material the counters do not, and refusing the record would
        // push the count onto paper where nobody can see it at all.
        await this.reportAvailableQuantityVariance(tenantId, cmd);
      } catch (error) {
        const apiError = error instanceof ApiError ? error : undefined;
        // A validation failure will fail identically forever; anything else
        // may be transient, so the terminal is told it can retry.
        const retryable = !apiError || !['VALIDATION_ERROR', 'FORBIDDEN', 'NOT_FOUND'].includes(apiError.code);
        const errorCode = apiError?.code ?? 'INTERNAL_ERROR';
        const errorMessage = error instanceof Error ? error.message : 'Gagal memproses perintah.';

        results.push({
          clientEventId: cmd.clientEventId,
          status: 'FAILED',
          errorCode,
          errorMessage,
          retryable,
        });

        // The whole point of MES-082: the rejection is filed where a supervisor
        // can see it, instead of living only in the tablet that was refused.
        await this.recordSyncException(tenantId, cmd, errorCode, errorMessage, retryable);
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

  // --- Sync exceptions (MES-082) --------------------------------------

  /**
   * Files a rejected command as an exception.
   *
   * Deliberately never throws: a failure to *record* the failure must not turn
   * a reported rejection into a 500 that loses the whole batch. The command's
   * own outcome has already been decided by the time this runs.
   */
  private async recordSyncException(
    tenantId: string,
    cmd: { type: string; clientEventId: string; payload: any; occurredAt: string; workOrderId: string },
    errorCode: string,
    reason: string,
    retryable: boolean
  ): Promise<void> {
    try {
      const context = await withTenant(tenantId, (client) =>
        this.contextFor(client, tenantId, cmd.workOrderId)
      );

      await withTenant(tenantId, (client) =>
        this.syncExceptions.record(client, {
          tenantId,
          clientEventId: cmd.clientEventId,
          commandType: cmd.type,
          workOrderId: cmd.workOrderId || undefined,
          operatorId: cmd.payload?.operatorId,
          payload: cmd.payload ?? {},
          occurredAt: cmd.occurredAt,
          errorCode,
          reason,
          retryable,
          lineId: context.lineId,
          shiftDate: cmd.occurredAt ? cmd.occurredAt.slice(0, 10) : undefined,
        })
      );
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(
        '[sync-exception] gagal mencatat exception:',
        error instanceof Error ? error.message : error
      );
    }
  }

  private async closeExceptionFor(tenantId: string, clientEventId: string): Promise<void> {
    try {
      await withTenant(tenantId, (client) =>
        this.syncExceptions.resolveByEvent(
          client,
          tenantId,
          clientEventId,
          'Perintah berhasil diterapkan pada percobaan berikutnya.'
        )
      );
    } catch {
      // Non-fatal: an exception left open is visible, which is the safe side.
    }
  }

  /**
   * Files an available-quantity difference as an exception, not a rejection.
   *
   * ADR-25 and ADR-26 already make the successor's available quantity a
   * recommendation. MES-082 adds the other half: when the recommendation is
   * exceeded, somebody should be told. Reporting it here means the count is
   * kept *and* the discrepancy is visible.
   */
  private async reportAvailableQuantityVariance(
    tenantId: string,
    cmd: { type: string; clientEventId: string; payload: any; occurredAt: string; workOrderId: string }
  ): Promise<void> {
    if (cmd.type !== 'RECORD_OUTPUT' || !cmd.workOrderId) return;

    try {
      const recorded =
        Number(cmd.payload?.goodQuantity ?? 0) + Number(cmd.payload?.rejectQuantity ?? 0);
      if (recorded <= 0) return;

      const detail = await withTenant(tenantId, async (client) => {
        const workOrder = await this.productionService.getWorkOrderByIdWith(
          client,
          tenantId,
          cmd.workOrderId
        );
        if (!workOrder || !workOrder.predecessorWorkOrderId) return undefined;
        // `inputQuantity` already includes this command's contribution, so the
        // available figure is measured *before* it, to answer "was enough
        // handed over for what was just recorded?".
        const available = await this.processChain.availableQuantity(client, tenantId, {
          ...workOrder,
          inputQuantity: Math.max(Number(workOrder.inputQuantity ?? 0) - recorded, 0),
        });
        return { workOrder, available };
      });

      if (!detail || detail.available >= recorded) return;

      const shortfall = recorded - detail.available;

      await withTenant(tenantId, (client) =>
        this.syncExceptions.record(client, {
          tenantId,
          clientEventId: cmd.clientEventId + ':available-qty',
          commandType: cmd.type,
          workOrderId: cmd.workOrderId,
          operatorId: cmd.payload?.operatorId,
          payload: { recorded, available: detail.available, shortfall },
          occurredAt: cmd.occurredAt,
          errorCode: 'AVAILABLE_QUANTITY_VARIANCE',
          reason:
            'Tercatat ' + recorded + ' unit sementara process sebelumnya baru menyerahkan ' +
            detail.available + ' unit; selisih ' + shortfall + ' unit. Catatan tetap diterima, ' +
            'mohon periksa serah terima antar process.',
          retryable: false,
          lineId: detail.workOrder.lineId,
          shiftDate: cmd.occurredAt ? cmd.occurredAt.slice(0, 10) : undefined,
        })
      );
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(
        '[sync-exception] gagal memeriksa selisih available quantity:',
        error instanceof Error ? error.message : error
      );
    }
  }

  async listSyncExceptions(
    tenantId: string,
    filter: SyncExceptionFilter = {}
  ): Promise<SyncException[]> {
    return withTenant(tenantId, (client) => this.syncExceptions.list(client, tenantId, filter));
  }

  async syncExceptionSummary(
    tenantId: string
  ): Promise<Array<{ lineId?: string; lineName?: string; count: number }>> {
    return withTenant(tenantId, (client) => this.syncExceptions.openSummary(client, tenantId));
  }

  async setSyncExceptionStatus(
    tenantId: string,
    id: string,
    status: 'RESOLVED' | 'IGNORED' | 'OPEN',
    actorId: string,
    note?: string
  ): Promise<SyncException> {
    const updated = await withTenant(tenantId, (client) =>
      this.syncExceptions.setStatus(client, tenantId, id, status, actorId, note)
    );
    if (!updated) throw ApiError.notFound('Sync exception tidak ditemukan.');
    return updated;
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

      case 'CONFIRM_WO': {
        const wo = await this.productionService.confirmWorkOrder(tenantId, cmd.workOrderId, {
          confirmedBy: payload?.operatorId,
        });
        await this.markProcessed(tenantId, cmd.clientEventId, cmd.type, cmd.workOrderId, wo.id);
        return wo.id;
      }

      case 'PAUSE_WO':
      case 'RESUME_WO': {
        // Pauses and resumptions on shop floor are handled via Machine Downtime events (ADR-18, ADR-24)
        await this.markProcessed(tenantId, cmd.clientEventId, cmd.type, cmd.workOrderId, cmd.workOrderId);
        return cmd.workOrderId;
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
