import type {
  QualityState,
  WipAgingStatus,
  WipDashboard,
  WipReceipt,
  WipRecord,
  WipState,
  WipStatusHistory,
  WipTransfer,
} from '@factory-vision/domain-types';
import { withTenant } from '../../platform/db/pool.js';
import { ApiError } from '../../platform/http/api-error.js';
import type { MasterDataService } from '../master-data/master-data.service.js';
import type { ProductionService } from '../production/production.service.js';
import type { QualityService } from '../quality/quality.service.js';
import type { EventService } from '../event/event.service.js';
import { WipRepository, type WipRecordWithLine } from './wip.repository.js';

/**
 * WIP and transactional process handoff (Improvement PRD §7, §8).
 *
 * The handoff is the point of the module. A transfer and a receipt are separate
 * records with separate quantities (BR-H03), so "1,000 sent, 950 arrived" is a
 * fact the system holds rather than a discrepancy somebody notices at
 * month-end; the 50 has a reason attached to it (BR-WIP04).
 *
 * Quality gates the transfer (BR-H04): a work order with an open hold, or with
 * a mandatory inspection that has not passed, cannot hand its output on.
 */

/** §7.4 — configurable, with defaults that suit a one-shift mid-market plant. */
const AGING_THRESHOLD_HOURS = Number(process.env.WIP_AGING_HOURS ?? 24);
const CRITICAL_THRESHOLD_HOURS = Number(process.env.WIP_CRITICAL_HOURS ?? 72);

export class WipService {
  private readonly repo = new WipRepository();

  constructor(
    private readonly masterData: MasterDataService,
    private readonly production: ProductionService,
    private readonly quality: QualityService,
    private readonly events: EventService
  ) {}

  /** §7.4 — `now - created`, and where that puts the record. */
  private static age(record: WipRecord): { ageHours: number; agingStatus: WipAgingStatus } {
    const ageHours = (Date.now() - new Date(record.createdAt).getTime()) / 3_600_000;
    const agingStatus: WipAgingStatus =
      ageHours >= CRITICAL_THRESHOLD_HOURS ? 'CRITICAL' : ageHours >= AGING_THRESHOLD_HOURS ? 'AGING' : 'NORMAL';
    return { ageHours: Number(ageHours.toFixed(1)), agingStatus };
  }

  private static decorate<T extends WipRecord>(record: T): T {
    return { ...record, ...WipService.age(record) };
  }

  // ==========================================================
  // §7 WIP records (US-WIP001)
  // ==========================================================

  async createWip(
    tenantId: string,
    input: {
      workOrderId: string;
      quantity: number;
      productId?: string;
      batchId?: string;
      sourceProcessId?: string;
      destinationProcessId?: string;
      uom?: string;
      locationId?: string;
      locationName?: string;
      qualityStatus?: QualityState;
      notes?: string;
    },
    actor: { id: string; name?: string; type?: 'USER' | 'OPERATOR' }
  ): Promise<WipRecord> {
    if (input.quantity <= 0) throw ApiError.validation('Kuantitas WIP harus lebih besar dari nol.');

    const workOrder = await this.production.getWorkOrderById(tenantId, input.workOrderId);
    if (!workOrder) throw ApiError.notFound('Work Order tidak ditemukan.');

    const product = this.masterData.getProductById(tenantId, input.productId ?? workOrder.productId);
    if (!product) throw ApiError.notFound('Produk tidak ditemukan.');

    const record = await withTenant(tenantId, async (client) => {
      const now = new Date().toISOString();
      const wip: WipRecord = {
        id: `wip-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        tenantId,
        wipNumber: await this.repo.nextNumber(client, tenantId, 'wip_record', 'WIP'),
        productId: product.id,
        productSku: product.sku,
        productName: product.name,
        workOrderId: input.workOrderId,
        workOrderNumber: workOrder.woNumber,
        batchId: input.batchId,
        sourceProcessId: input.sourceProcessId ?? workOrder.processId,
        destinationProcessId: input.destinationProcessId,
        quantity: input.quantity,
        uom: input.uom ?? product.unit ?? 'PCS',
        status: 'AT_PROCESS',
        locationId: input.locationId,
        locationName: input.locationName,
        qualityStatus: input.qualityStatus ?? 'PENDING_INSPECTION',
        createdBy: actor.id,
        createdAt: now,
        updatedAt: now,
        notes: input.notes,
      };

      await this.repo.insertWip(client, wip);
      await this.repo.setWipStatus(client, tenantId, wip.id, {
        status: 'AT_PROCESS',
        fromStatus: 'CREATED',
        changedBy: actor.id,
        reason: 'WIP dibuat dari output proses.',
      });
      return wip;
    });

    this.events.recordDetached({
      tenantId,
      eventType: 'WIP_CREATED',
      entityType: 'WIP',
      entityId: record.id,
      actorType: actor.type ?? 'USER',
      actorId: actor.id,
      actorName: actor.name,
      workOrderId: record.workOrderId,
      batchId: record.batchId,
      processId: record.sourceProcessId,
      machineId: workOrder.machineId,
      lineId: workOrder.lineId,
      summary: `${record.wipNumber}: ${record.quantity} ${record.uom} ${record.productName} di proses.`,
      afterValue: { quantity: record.quantity, status: record.status },
    });

    return WipService.decorate(record);
  }

  async listWip(
    tenantId: string,
    filter: {
      workOrderId?: string;
      status?: string;
      openOnly?: boolean;
      destinationProcessId?: string;
      productId?: string;
      agingOnly?: boolean;
      limit?: number;
    } = {}
  ): Promise<WipRecord[]> {
    const records = await withTenant(tenantId, (client) => this.repo.listWip(client, tenantId, filter));
    const decorated = records.map((record) => WipService.decorate(record));
    return filter.agingOnly ? decorated.filter((record) => record.agingStatus !== 'NORMAL') : decorated;
  }

  async statusHistory(tenantId: string, wipId: string): Promise<WipStatusHistory[]> {
    return withTenant(tenantId, (client) => this.repo.statusHistory(client, tenantId, wipId));
  }

  /** BR-WIP05 — held WIP is out of circulation until somebody releases it. */
  async holdWip(
    tenantId: string,
    id: string,
    input: { reason: string },
    actor: { id: string; name?: string }
  ): Promise<WipRecord> {
    return this.changeStatus(tenantId, id, 'ON_HOLD', input.reason, actor, 'HOLD');
  }

  async releaseWip(
    tenantId: string,
    id: string,
    input: { reason: string },
    actor: { id: string; name?: string }
  ): Promise<WipRecord> {
    return this.changeStatus(tenantId, id, 'AT_PROCESS', input.reason, actor, 'RELEASED');
  }

  private async changeStatus(
    tenantId: string,
    id: string,
    status: WipState,
    reason: string,
    actor: { id: string; name?: string },
    qualityStatus?: QualityState
  ): Promise<WipRecord> {
    const record = await withTenant(tenantId, async (client) => {
      const [existing] = await this.repo.listWip(client, tenantId, { id });
      if (!existing) throw ApiError.notFound('Catatan WIP tidak ditemukan.');

      await this.repo.setWipStatus(client, tenantId, id, {
        status,
        qualityStatus,
        fromStatus: existing.status,
        changedBy: actor.id,
        reason,
      });
      const [updated] = await this.repo.listWip(client, tenantId, { id });
      return updated!;
    });
    return WipService.decorate(record);
  }

  // ==========================================================
  // §8 Transfer (US-WIP002)
  // ==========================================================

  /**
   * Creates a transfer, consulting the quality gate first.
   *
   * The WIP moves to IN_TRANSIT rather than being consumed: until the
   * destination receives it, the quantity is nobody's input (BR-WIP03).
   */
  async createTransfer(
    tenantId: string,
    input: {
      wipId: string;
      quantity: number;
      destinationWorkOrderId?: string;
      destinationProcessId?: string;
      notes?: string;
      idempotencyKey?: string;
    },
    actor: { id: string; name?: string; type?: 'USER' | 'OPERATOR' }
  ): Promise<WipTransfer> {
    const [wip] = await withTenant(tenantId, (client) =>
      this.repo.listWip(client, tenantId, { id: input.wipId })
    );
    if (!wip) throw ApiError.notFound('Catatan WIP tidak ditemukan.');
    if (input.quantity <= 0) throw ApiError.validation('Kuantitas transfer harus lebih besar dari nol.');
    if (input.quantity > wip.quantity) {
      throw ApiError.validation(
        `Kuantitas transfer (${input.quantity}) melebihi WIP yang tersedia (${wip.quantity} ${wip.uom}).`
      );
    }
    if (wip.status === 'ON_HOLD') {
      throw ApiError.conflict('WIP berstatus ON_HOLD tidak dapat ditransfer tanpa pelepasan resmi.');
    }

    // BR-H04 / BR-Q02.
    const gate = await this.quality.transferBlock(tenantId, wip.workOrderId, {
      productId: wip.productId,
      processId: wip.sourceProcessId,
    });
    if (gate.blocked) {
      throw ApiError.conflict(`Transfer diblokir oleh quality gate: ${gate.reason}`);
    }

    const transfer = await withTenant(tenantId, async (client) => {
      if (input.idempotencyKey) {
        const [existing] = await this.repo.listTransfers(client, tenantId, {
          idempotencyKey: input.idempotencyKey,
        });
        if (existing) return existing;
      }

      const record: WipTransfer = {
        id: `wtr-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        tenantId,
        transferNumber: await this.repo.nextNumber(client, tenantId, 'wip_transfer', 'TRF'),
        wipId: wip.id,
        productId: wip.productId,
        productName: wip.productName,
        batchId: wip.batchId,
        sourceWorkOrderId: wip.workOrderId,
        sourceWorkOrderNumber: wip.workOrderNumber,
        sourceProcessId: wip.sourceProcessId,
        sourceProcessName: wip.sourceProcessName,
        destinationWorkOrderId: input.destinationWorkOrderId,
        destinationProcessId: input.destinationProcessId ?? wip.destinationProcessId,
        quantity: input.quantity,
        uom: wip.uom,
        status: 'IN_TRANSIT',
        createdBy: actor.id,
        createdByName: actor.name,
        transferredAt: new Date().toISOString(),
        idempotencyKey: input.idempotencyKey,
        notes: input.notes,
      };

      await this.repo.insertTransfer(client, record);

      // A full transfer empties the WIP; a partial one leaves the remainder
      // at the source, which is why the quantity is rewritten either way.
      const remaining = wip.quantity - input.quantity;
      await this.repo.setWipStatus(client, tenantId, wip.id, {
        status: remaining > 0 ? 'AT_PROCESS' : 'IN_TRANSIT',
        quantity: remaining,
        fromStatus: wip.status,
        changedBy: actor.id,
        reason: `Transfer ${record.transferNumber}: ${input.quantity} ${wip.uom}`,
      });

      return record;
    });

    this.events.recordDetached({
      tenantId,
      eventType: 'WIP_TRANSFERRED',
      entityType: 'WIP',
      entityId: wip.id,
      actorType: actor.type ?? 'USER',
      actorId: actor.id,
      actorName: actor.name,
      workOrderId: wip.workOrderId,
      batchId: wip.batchId,
      processId: wip.sourceProcessId,
      lineId: wip.lineId,
      summary: `${transfer.transferNumber}: ${transfer.quantity} ${transfer.uom} dikirim dari ${wip.workOrderNumber}.`,
      afterValue: {
        quantity: transfer.quantity,
        destinationWorkOrderId: transfer.destinationWorkOrderId,
        destinationProcessId: transfer.destinationProcessId,
      },
    });

    return transfer;
  }

  async listTransfers(
    tenantId: string,
    filter: {
      wipId?: string;
      sourceWorkOrderId?: string;
      destinationWorkOrderId?: string;
      status?: string;
      limit?: number;
    } = {}
  ): Promise<WipTransfer[]> {
    return withTenant(tenantId, (client) => this.repo.listTransfers(client, tenantId, filter));
  }

  // ==========================================================
  // §8.3 Receive (US-WIP003)
  // ==========================================================

  /**
   * Records what actually arrived.
   *
   * A shortfall demands a reason (BR-WIP04) and produces a PARTIAL result; the
   * missing quantity is not quietly written off. On a successful receipt a new
   * WIP record is created at the destination, which is what makes the quantity
   * available as input there (BR-WIP03).
   */
  async receiveTransfer(
    tenantId: string,
    transferId: string,
    input: {
      receivedQuantity: number;
      varianceReason?: string;
      destinationWorkOrderId?: string;
      destinationProcessId?: string;
      notes?: string;
      idempotencyKey?: string;
    },
    actor: { id: string; name?: string; type?: 'USER' | 'OPERATOR' }
  ): Promise<{ receipt: WipReceipt; wip?: WipRecord }> {
    const [transfer] = await withTenant(tenantId, (client) =>
      this.repo.listTransfers(client, tenantId, { id: transferId })
    );
    if (!transfer) throw ApiError.notFound('Transfer WIP tidak ditemukan.');
    if (transfer.status === 'RECEIVED') {
      throw ApiError.invalidState('Transfer ini sudah diterima.');
    }
    if (input.receivedQuantity < 0) {
      throw ApiError.validation('Kuantitas diterima tidak boleh negatif.');
    }
    if (input.receivedQuantity > transfer.quantity) {
      throw ApiError.validation(
        `Kuantitas diterima (${input.receivedQuantity}) melebihi yang dikirim (${transfer.quantity}).`
      );
    }

    const variance = Number((transfer.quantity - input.receivedQuantity).toFixed(4));
    if (variance !== 0 && !input.varianceReason?.trim()) {
      throw ApiError.validation(
        'Selisih penerimaan wajib disertai alasan (BR-WIP04).'
      );
    }

    const result: WipReceipt['result'] =
      input.receivedQuantity === 0 ? 'REJECTED' : variance === 0 ? 'FULL' : 'PARTIAL';

    const destinationWorkOrderId = input.destinationWorkOrderId ?? transfer.destinationWorkOrderId;

    const outcome = await withTenant(tenantId, async (client) => {
      if (input.idempotencyKey) {
        const [existing] = await this.repo.listReceipts(client, tenantId, {
          idempotencyKey: input.idempotencyKey,
        });
        if (existing) return { receipt: existing, wip: undefined as WipRecordWithLine | undefined };
      }

      const receipt: WipReceipt = {
        id: `wrc-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        tenantId,
        wipTransferId: transfer.id,
        transferNumber: transfer.transferNumber,
        receivedQuantity: input.receivedQuantity,
        transferredQuantity: transfer.quantity,
        varianceQuantity: variance,
        varianceReason: input.varianceReason,
        result,
        uom: transfer.uom,
        receivedBy: actor.id,
        receivedByName: actor.name,
        receivedAt: new Date().toISOString(),
        idempotencyKey: input.idempotencyKey,
        notes: input.notes,
      };

      await this.repo.insertReceipt(client, receipt);
      await this.repo.setTransferStatus(
        client,
        tenantId,
        transfer.id,
        result === 'REJECTED' ? 'REJECTED' : result === 'PARTIAL' ? 'PARTIAL' : 'RECEIVED',
        receipt.id
      );

      let created: WipRecordWithLine | undefined;
      if (input.receivedQuantity > 0 && destinationWorkOrderId) {
        const now = new Date().toISOString();
        const wip: WipRecord = {
          id: `wip-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          tenantId,
          wipNumber: await this.repo.nextNumber(client, tenantId, 'wip_record', 'WIP'),
          productId: transfer.productId,
          productName: transfer.productName,
          workOrderId: destinationWorkOrderId,
          workOrderNumber: transfer.destinationWorkOrderNumber ?? destinationWorkOrderId,
          batchId: transfer.batchId,
          sourceProcessId: input.destinationProcessId ?? transfer.destinationProcessId,
          quantity: input.receivedQuantity,
          uom: transfer.uom,
          status: 'RECEIVED',
          qualityStatus: 'PENDING_INSPECTION',
          createdBy: actor.id,
          createdAt: now,
          updatedAt: now,
          notes: `Diterima dari ${transfer.transferNumber}`,
        };
        await this.repo.insertWip(client, wip);
        await this.repo.setWipStatus(client, tenantId, wip.id, {
          status: 'AT_PROCESS',
          fromStatus: 'RECEIVED',
          changedBy: actor.id,
          reason: `Penerimaan ${transfer.transferNumber}`,
        });
        created = { ...wip, status: 'AT_PROCESS' };
      }

      return { receipt, wip: created };
    });

    // The destination's input quantity is what the routing chain measures
    // progress against, so the received figure has to reach the work order.
    if (input.receivedQuantity > 0 && destinationWorkOrderId) {
      await this.production.incrementQuantities(tenantId, destinationWorkOrderId, 0, 0, {
        input: input.receivedQuantity,
      });
    }

    this.events.recordDetached({
      tenantId,
      eventType: 'WIP_RECEIVED',
      entityType: 'WIP',
      entityId: transfer.wipId,
      actorType: actor.type ?? 'USER',
      actorId: actor.id,
      actorName: actor.name,
      workOrderId: destinationWorkOrderId ?? transfer.sourceWorkOrderId,
      batchId: transfer.batchId,
      processId: transfer.destinationProcessId,
      summary:
        variance === 0
          ? `${transfer.transferNumber} diterima penuh: ${input.receivedQuantity} ${transfer.uom}.`
          : `${transfer.transferNumber} diterima ${input.receivedQuantity} dari ${transfer.quantity} ${transfer.uom}; selisih ${variance} — ${input.varianceReason}.`,
      afterValue: {
        receivedQuantity: input.receivedQuantity,
        varianceQuantity: variance,
        result,
      },
    });

    return {
      receipt: outcome.receipt,
      wip: outcome.wip ? WipService.decorate(outcome.wip) : undefined,
    };
  }

  async listReceipts(tenantId: string, wipTransferId?: string): Promise<WipReceipt[]> {
    return withTenant(tenantId, (client) => this.repo.listReceipts(client, tenantId, { wipTransferId }));
  }

  // ==========================================================
  // §7.5 WIP dashboard
  // ==========================================================

  async dashboard(tenantId: string): Promise<WipDashboard> {
    const records = await withTenant(tenantId, (client) =>
      this.repo.listWip(client, tenantId, { openOnly: true, limit: 5000 })
    );
    const decorated = records.map((record) => ({ ...record, ...WipService.age(record) }));
    const transfers = await this.listTransfers(tenantId, { status: 'IN_TRANSIT', limit: 1000 });

    /** Sums quantity and record count by whatever key the caller names. */
    const group = (
      keyOf: (record: (typeof decorated)[number]) => { id: string; name: string } | undefined
    ): Array<{ id: string; name: string; quantity: number; records: number }> => {
      const buckets = new Map<string, { id: string; name: string; quantity: number; records: number }>();
      for (const record of decorated) {
        const key = keyOf(record);
        if (!key) continue;
        const bucket = buckets.get(key.id) ?? { id: key.id, name: key.name, quantity: 0, records: 0 };
        bucket.quantity += record.quantity;
        bucket.records += 1;
        buckets.set(key.id, bucket);
      }
      return [...buckets.values()].sort((a, b) => b.quantity - a.quantity);
    };

    const lines = this.masterData.getLines(tenantId);

    return {
      totalWip: Number(decorated.reduce((sum, record) => sum + record.quantity, 0).toFixed(2)),
      uom: decorated[0]?.uom ?? 'PCS',
      byProcess: group((record) =>
        record.sourceProcessId
          ? { id: record.sourceProcessId, name: record.sourceProcessName ?? record.sourceProcessId }
          : undefined
      ).map(({ id, name, quantity, records }) => ({ processId: id, processName: name, quantity, records })),
      byLine: group((record) =>
        record.lineId
          ? { id: record.lineId, name: lines.find((line) => line.id === record.lineId)?.name ?? record.lineId }
          : undefined
      ).map(({ id, name, quantity, records }) => ({ lineId: id, lineName: name, quantity, records })),
      byProduct: group((record) => ({ id: record.productId, name: record.productName })).map(
        ({ id, name, quantity, records }) => ({ productId: id, productName: name, quantity, records })
      ),
      aging: {
        normal: decorated.filter((record) => record.agingStatus === 'NORMAL').length,
        aging: decorated.filter((record) => record.agingStatus === 'AGING').length,
        critical: decorated.filter((record) => record.agingStatus === 'CRITICAL').length,
      },
      // "Stuck" is the operational reading of CRITICAL: old, and still not
      // moved on — the queue a bottleneck analysis starts from.
      stuckRecords: decorated.filter(
        (record) => record.agingStatus === 'CRITICAL' && record.status !== 'IN_TRANSIT'
      ).length,
      onHoldQuantity: Number(
        decorated
          .filter((record) => record.status === 'ON_HOLD')
          .reduce((sum, record) => sum + record.quantity, 0)
          .toFixed(2)
      ),
      waitingTransferQuantity: Number(
        transfers.reduce((sum, transfer) => sum + transfer.quantity, 0).toFixed(2)
      ),
      agingThresholdHours: AGING_THRESHOLD_HOURS,
      criticalThresholdHours: CRITICAL_THRESHOLD_HOURS,
    };
  }
}
