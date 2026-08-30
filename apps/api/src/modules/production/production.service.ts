import {
  WorkOrder,
  ProductionOrder,
  WorkOrderStatus,
  ProductionOrderStatus,
} from '@factory-vision/domain-types';
import { WorkOrderStateMachine } from './work-order.state-machine.js';
import { demoRows } from '../../platform/config/demo-seed.js';

export class ProductionService {
  private productionOrders: ProductionOrder[] = demoRows<ProductionOrder>(() => [
    {
      id: 'po-260829-001',
      tenantId: 'tenant-pilot-factory-01',
      orderNumber: 'PO-260829-001',
      productId: 'prod-tire-a',
      quantity: 2000,
      dueDate: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
      status: ProductionOrderStatus.RELEASED,
      createdBy: 'PPIC Supervisor',
      createdAt: '2026-08-28T00:00:00.000Z',
    },
    {
      id: 'po-260829-002',
      tenantId: 'tenant-pilot-factory-01',
      orderNumber: 'PO-260829-002',
      productId: 'prod-tire-b',
      quantity: 1500,
      dueDate: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
      status: ProductionOrderStatus.RELEASED,
      createdBy: 'PPIC Supervisor',
      createdAt: '2026-08-28T02:00:00.000Z',
    },
    {
      id: 'po-260829-003',
      tenantId: 'tenant-pilot-factory-01',
      orderNumber: 'PO-260829-003',
      productId: 'prod-tire-c',
      quantity: 800,
      dueDate: new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10),
      status: ProductionOrderStatus.DRAFT,
      createdBy: 'PPIC Supervisor',
      createdAt: '2026-08-28T04:00:00.000Z',
    },
  ]);

  /**
   * Pilot tyre-factory work orders (, US-050).
   *
   * Targets are set from what each machine can physically make in one shift at
   * its configured Ideal Cycle Time, not from a round number: a curing press at
   * 12.5 min/tyre cannot make 2,000 tyres in 480 minutes, and a plan that says
   * otherwise renders every achievement figure meaningless.
   *
   * asks the dataset to show a good, an average and an under-performer,
   * so the targets deliberately differ in ambition:
   * - TBM-001 / CPR-001 (Tire A) are planned just inside capacity → Good
   * - MIX-001 / INS-001 sit comfortably inside capacity → Good/Watch
   * - TBM-002 / CPR-002 (Tire C) are planned slightly above it → Critical
   */
  private workOrders: WorkOrder[] = demoRows<WorkOrder>(() => [
    {
      id: 'wo-101',
      tenantId: 'tenant-pilot-factory-01',
      productionOrderId: 'po-260829-001',
      woNumber: 'WO-260829-01-MIX',
      productId: 'prod-tire-a',
      processId: 'proc-mixing',
      sequence: 1,
      batchId: 'batch-260829-01',
      lineId: 'line-01',
      workCenterId: 'wc-mixing',
      machineId: 'mc-mix-01',
      // 90 s/unit over 480 min ≈ 320 units; planned at 82% of capacity.
      targetQuantity: 260,
      unit: 'PCS',
      plannedStart: '2026-08-28T06:00:00.000Z',
      plannedEnd: '2026-08-28T14:00:00.000Z',
      actualStart: '2026-08-28T06:10:00.000Z',
      goodQuantity: 242,
      rejectQuantity: 4,
      status: WorkOrderStatus.IN_PROGRESS,
      priority: 1,
      version: 1,
      createdAt: '2026-08-28T05:00:00.000Z',
      updatedAt: '2026-08-28T10:30:00.000Z',
    },
    {
      id: 'wo-102',
      tenantId: 'tenant-pilot-factory-01',
      productionOrderId: 'po-260829-001',
      woNumber: 'WO-260829-01-TBM',
      productId: 'prod-tire-a',
      processId: 'proc-building',
      sequence: 3,
      batchId: 'batch-260829-01',
      lineId: 'line-01',
      workCenterId: 'wc-building',
      machineId: 'mc-tbm-01',
      // 150 s/unit ≈ 192 units per shift; planned at 81% of capacity.
      targetQuantity: 155,
      unit: 'PCS',
      plannedStart: '2026-08-28T07:00:00.000Z',
      plannedEnd: '2026-08-28T15:00:00.000Z',
      actualStart: '2026-08-28T07:15:00.000Z',
      goodQuantity: 141,
      rejectQuantity: 3,
      status: WorkOrderStatus.IN_PROGRESS,
      priority: 1,
      version: 1,
      createdAt: '2026-08-28T05:00:00.000Z',
      updatedAt: '2026-08-28T10:30:00.000Z',
    },
    {
      id: 'wo-103',
      tenantId: 'tenant-pilot-factory-01',
      productionOrderId: 'po-260829-001',
      woNumber: 'WO-260829-01-CPR',
      productId: 'prod-tire-a',
      processId: 'proc-curing',
      sequence: 4,
      batchId: 'batch-260829-01',
      lineId: 'line-01',
      workCenterId: 'wc-curing',
      machineId: 'mc-cpr-01',
      // 750 s/unit ≈ 38 units per shift; the pilot validation area.
      targetQuantity: 32,
      unit: 'PCS',
      plannedStart: '2026-08-28T08:00:00.000Z',
      plannedEnd: '2026-08-28T16:00:00.000Z',
      actualStart: '2026-08-28T08:05:00.000Z',
      goodQuantity: 28,
      rejectQuantity: 1,
      status: WorkOrderStatus.IN_PROGRESS,
      priority: 1,
      version: 1,
      createdAt: '2026-08-28T05:00:00.000Z',
      updatedAt: '2026-08-28T10:30:00.000Z',
    },
    {
      id: 'wo-104',
      tenantId: 'tenant-pilot-factory-01',
      productionOrderId: 'po-260829-001',
      woNumber: 'WO-260829-01-INS',
      productId: 'prod-tire-a',
      processId: 'proc-inspection',
      sequence: 5,
      batchId: 'batch-260829-01',
      lineId: 'line-01',
      workCenterId: 'wc-inspection',
      machineId: 'mc-ins-01',
      // 30 s/unit ≈ 960 units per shift; inspection is never the constraint.
      targetQuantity: 850,
      unit: 'PCS',
      plannedStart: '2026-08-28T10:00:00.000Z',
      plannedEnd: '2026-08-28T18:00:00.000Z',
      goodQuantity: 0,
      rejectQuantity: 0,
      status: WorkOrderStatus.RELEASED,
      priority: 2,
      version: 1,
      createdAt: '2026-08-28T05:00:00.000Z',
      updatedAt: '2026-08-28T05:00:00.000Z',
    },
    {
      id: 'wo-105',
      tenantId: 'tenant-pilot-factory-01',
      productionOrderId: 'po-260829-002',
      woNumber: 'WO-260829-02-CAL',
      productId: 'prod-tire-b',
      processId: 'proc-calendering',
      sequence: 2,
      batchId: 'batch-260829-02',
      lineId: 'line-02',
      workCenterId: 'wc-calendering',
      machineId: 'mc-cal-01',
      // 60 s/unit ≈ 480 units per shift.
      targetQuantity: 400,
      unit: 'PCS',
      plannedStart: '2026-08-28T06:00:00.000Z',
      plannedEnd: '2026-08-28T14:00:00.000Z',
      actualStart: '2026-08-28T06:20:00.000Z',
      goodQuantity: 356,
      rejectQuantity: 9,
      status: WorkOrderStatus.IN_PROGRESS,
      priority: 2,
      version: 1,
      createdAt: '2026-08-28T05:00:00.000Z',
      updatedAt: '2026-08-28T10:30:00.000Z',
    },
    {
      id: 'wo-106',
      tenantId: 'tenant-pilot-factory-01',
      productionOrderId: 'po-260829-001',
      woNumber: 'WO-260829-01-EXT',
      productId: 'prod-tire-a',
      processId: 'proc-extrusion',
      sequence: 2,
      batchId: 'batch-260829-01',
      lineId: 'line-01',
      workCenterId: 'wc-extrusion',
      machineId: 'mc-ext-01',
      // 45 s/unit ≈ 640 units per shift.
      targetQuantity: 520,
      unit: 'PCS',
      plannedStart: '2026-08-28T06:30:00.000Z',
      plannedEnd: '2026-08-28T14:30:00.000Z',
      actualStart: '2026-08-28T06:45:00.000Z',
      goodQuantity: 468,
      rejectQuantity: 11,
      status: WorkOrderStatus.IN_PROGRESS,
      priority: 2,
      version: 1,
      createdAt: '2026-08-28T05:00:00.000Z',
      updatedAt: '2026-08-28T10:30:00.000Z',
    },
    {
      id: 'wo-107',
      tenantId: 'tenant-pilot-factory-01',
      productionOrderId: 'po-260829-003',
      woNumber: 'WO-260829-03-TBM',
      productId: 'prod-tire-c',
      processId: 'proc-building',
      sequence: 3,
      batchId: 'batch-260829-03',
      lineId: 'line-03',
      workCenterId: 'wc-building',
      machineId: 'mc-tbm-02',
      // 210 s/unit ≈ 137 units per shift, planned above what the machine can
      // deliver once normal downtime is taken out, so this order runs late by
      // design and drives the "at risk" and alert paths.
      targetQuantity: 145,
      unit: 'PCS',
      plannedStart: '2026-08-28T06:00:00.000Z',
      plannedEnd: '2026-08-28T14:00:00.000Z',
      actualStart: '2026-08-28T06:30:00.000Z',
      goodQuantity: 98,
      rejectQuantity: 7,
      status: WorkOrderStatus.IN_PROGRESS,
      priority: 3,
      version: 1,
      createdAt: '2026-08-28T05:00:00.000Z',
      updatedAt: '2026-08-28T10:30:00.000Z',
    },
    {
      id: 'wo-108',
      tenantId: 'tenant-pilot-factory-01',
      productionOrderId: 'po-260829-003',
      woNumber: 'WO-260829-03-CPR',
      productId: 'prod-tire-c',
      processId: 'proc-curing',
      sequence: 4,
      batchId: 'batch-260829-03',
      lineId: 'line-03',
      workCenterId: 'wc-curing',
      machineId: 'mc-cpr-02',
      // 1050 s/unit ≈ 27 units per shift; planned above capacity. CPR-002 is
      // the dataset's under-performer and the bottleneck US-037 ranks.
      targetQuantity: 30,
      unit: 'PCS',
      plannedStart: '2026-08-28T08:00:00.000Z',
      plannedEnd: '2026-08-28T16:00:00.000Z',
      actualStart: '2026-08-28T08:40:00.000Z',
      goodQuantity: 17,
      rejectQuantity: 2,
      status: WorkOrderStatus.PAUSED,
      priority: 3,
      version: 1,
      createdAt: '2026-08-28T05:00:00.000Z',
      updatedAt: '2026-08-28T10:30:00.000Z',
    },
    {
      id: 'wo-109',
      tenantId: 'tenant-pilot-factory-01',
      productionOrderId: 'po-260829-002',
      woNumber: 'WO-260829-02-MIX',
      productId: 'prod-tire-b',
      processId: 'proc-mixing',
      sequence: 1,
      batchId: 'batch-260829-02',
      lineId: 'line-02',
      workCenterId: 'wc-mixing-02',
      machineId: 'mc-mix-02',
      // 100 s/unit ≈ 288 units per shift; Line Beta's average performer.
      targetQuantity: 240,
      unit: 'PCS',
      plannedStart: '2026-08-28T06:00:00.000Z',
      plannedEnd: '2026-08-28T14:00:00.000Z',
      actualStart: '2026-08-28T06:15:00.000Z',
      goodQuantity: 205,
      rejectQuantity: 6,
      status: WorkOrderStatus.IN_PROGRESS,
      priority: 2,
      version: 1,
      createdAt: '2026-08-28T05:00:00.000Z',
      updatedAt: '2026-08-28T10:30:00.000Z',
    },
  ]);

  // Production Orders
  getProductionOrders(tenantId: string) {
    return this.productionOrders.filter((po) => po.tenantId === tenantId);
  }

  createProductionOrder(
    tenantId: string,
    payload: {
      orderNumber: string;
      productId: string;
      quantity: number;
      dueDate: string;
      createdBy: string;
    }
  ): ProductionOrder {
    const po: ProductionOrder = {
      id: `po-${Date.now()}`,
      tenantId,
      orderNumber: payload.orderNumber,
      productId: payload.productId,
      quantity: payload.quantity,
      dueDate: payload.dueDate,
      status: ProductionOrderStatus.PLANNED,
      createdBy: payload.createdBy,
      createdAt: new Date().toISOString(),
    };
    this.productionOrders.push(po);
    return po;
  }

  getProductionOrderById(tenantId: string, id: string): ProductionOrder | undefined {
    return this.productionOrders.find((po) => po.tenantId === tenantId && po.id === id);
  }

  updateProductionOrder(
    tenantId: string,
    id: string,
    payload: Partial<Omit<ProductionOrder, 'id' | 'tenantId'>>
  ): ProductionOrder {
    const po = this.getProductionOrderById(tenantId, id);
    if (!po) throw new Error('Production order not found');

    if (payload.orderNumber !== undefined) po.orderNumber = payload.orderNumber;
    if (payload.productId !== undefined) po.productId = payload.productId;
    if (payload.quantity !== undefined) po.quantity = payload.quantity;
    if (payload.dueDate !== undefined) po.dueDate = payload.dueDate;
    if (payload.status !== undefined) po.status = payload.status;

    return po;
  }

  deleteProductionOrder(tenantId: string, id: string): boolean {
    const index = this.productionOrders.findIndex((p) => p.tenantId === tenantId && p.id === id);
    if (index === -1) throw new Error('Production order not found');
    this.productionOrders.splice(index, 1);
    return true;
  }

  releaseProductionOrder(tenantId: string, id: string, routings?: any[]): ProductionOrder {
    const po = this.getProductionOrderById(tenantId, id);
    if (!po) throw new Error('Production order not found');
    po.status = ProductionOrderStatus.RELEASED;

    // If product routings are available and no work orders exist for this PO, auto-generate them
    const existingWos = this.workOrders.filter((w) => w.tenantId === tenantId && w.productionOrderId === id);
    if (existingWos.length === 0 && routings && routings.length > 0) {
      const productRoutings = routings.filter((r) => r.productId === po.productId && r.active);
      const batchNumber = `B${new Date().toISOString().substring(2, 10).replace(/-/g, '')}-01`;

      productRoutings.forEach((route) => {
        const woNumber = `${po.orderNumber}-SEQ${route.sequence}`;
        const wo: WorkOrder = {
          id: `wo-${Date.now()}-${route.sequence}`,
          tenantId,
          productionOrderId: po.id,
          woNumber,
          productId: po.productId,
          processId: route.processId,
          sequence: route.sequence,
          batchId: `batch-${po.id}`,
          lineId: 'line-01',
          workCenterId: route.workCenterId,
          machineId: route.machineId,
          targetQuantity: po.quantity,
          unit: 'PCS',
          plannedStart: new Date().toISOString(),
          plannedEnd: new Date(Date.now() + 8 * 3600 * 1000).toISOString(),
          goodQuantity: 0,
          rejectQuantity: 0,
          status: route.sequence === 1 ? WorkOrderStatus.RELEASED : WorkOrderStatus.SCHEDULED,
          priority: 1,
          version: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        this.workOrders.push(wo);
      });
    }

    return po;
  }

  // Work Orders
  getWorkOrders(tenantId: string, filter?: { lineId?: string; status?: string; processId?: string }) {
    let result = this.workOrders.filter((wo) => wo.tenantId === tenantId);
    if (filter?.lineId && filter.lineId !== 'ALL') {
      result = result.filter((wo) => wo.lineId === filter.lineId);
    }
    if (filter?.status && filter.status !== 'ALL') {
      result = result.filter((wo) => wo.status === filter.status);
    }
    if (filter?.processId && filter.processId !== 'ALL') {
      result = result.filter((wo) => wo.processId === filter.processId);
    }
    return result;
  }

  getWorkOrderById(tenantId: string, id: string): WorkOrder | undefined {
    return this.workOrders.find((wo) => wo.tenantId === tenantId && wo.id === id);
  }

  createWorkOrder(
    tenantId: string,
    payload: {
      productionOrderId: string;
      productId: string;
      lineId: string;
      processId?: string;
      sequence?: number;
      batchId?: string;
      workCenterId?: string;
      machineId?: string;
      targetQuantity: number;
      unit?: string;
      priority?: number;
      plannedStart: string;
      plannedEnd: string;
    }
  ): WorkOrder {
    const count = this.workOrders.length + 1;
    const woNumber = `WO-${new Date().toISOString().substring(0, 10).replace(/-/g, '')}-${String(count).padStart(3, '0')}`;

    const wo: WorkOrder = {
      id: `wo-${Date.now()}`,
      tenantId,
      productionOrderId: payload.productionOrderId,
      woNumber,
      productId: payload.productId,
      processId: payload.processId,
      sequence: payload.sequence || 1,
      batchId: payload.batchId,
      lineId: payload.lineId,
      workCenterId: payload.workCenterId,
      machineId: payload.machineId,
      targetQuantity: payload.targetQuantity,
      unit: payload.unit || 'PCS',
      plannedStart: payload.plannedStart,
      plannedEnd: payload.plannedEnd,
      goodQuantity: 0,
      rejectQuantity: 0,
      status: WorkOrderStatus.SCHEDULED,
      priority: payload.priority || 1,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.workOrders.push(wo);
    return wo;
  }

  updateWorkOrder(
    tenantId: string,
    id: string,
    payload: Partial<Omit<WorkOrder, 'id' | 'tenantId' | 'woNumber'>>
  ): WorkOrder {
    const wo = this.getWorkOrderById(tenantId, id);
    if (!wo) throw new Error('Work order not found');

    if (payload.productId !== undefined) wo.productId = payload.productId;
    if (payload.processId !== undefined) wo.processId = payload.processId;
    if (payload.sequence !== undefined) wo.sequence = payload.sequence;
    if (payload.batchId !== undefined) wo.batchId = payload.batchId;
    if (payload.lineId !== undefined) wo.lineId = payload.lineId;
    if (payload.workCenterId !== undefined) wo.workCenterId = payload.workCenterId;
    if (payload.machineId !== undefined) wo.machineId = payload.machineId;
    if (payload.targetQuantity !== undefined) wo.targetQuantity = payload.targetQuantity;
    if (payload.unit !== undefined) wo.unit = payload.unit;
    if (payload.plannedStart !== undefined) wo.plannedStart = payload.plannedStart;
    if (payload.plannedEnd !== undefined) wo.plannedEnd = payload.plannedEnd;
    if (payload.priority !== undefined) wo.priority = payload.priority;
    if (payload.status !== undefined) wo.status = payload.status;

    wo.updatedAt = new Date().toISOString();
    wo.version += 1;
    return wo;
  }

  deleteWorkOrder(tenantId: string, id: string): boolean {
    const index = this.workOrders.findIndex((w) => w.tenantId === tenantId && w.id === id);
    if (index === -1) throw new Error('Work order not found');
    this.workOrders.splice(index, 1);
    return true;
  }

  releaseWorkOrder(tenantId: string, id: string): WorkOrder {
    const wo = this.getWorkOrderById(tenantId, id);
    if (!wo) throw new Error('Work order not found');

    WorkOrderStateMachine.validateTransition(wo.status, WorkOrderStatus.RELEASED);

    wo.status = WorkOrderStatus.RELEASED;
    wo.updatedAt = new Date().toISOString();
    wo.version += 1;
    return wo;
  }

  startWorkOrder(
    tenantId: string,
    id: string,
    payload: { operatorId: string; occurredAt?: string }
  ): WorkOrder {
    const wo = this.getWorkOrderById(tenantId, id);
    if (!wo) throw new Error('Work order not found');

    WorkOrderStateMachine.validateTransition(wo.status, WorkOrderStatus.IN_PROGRESS);

    wo.status = WorkOrderStatus.IN_PROGRESS;
    wo.actualStart = wo.actualStart || payload.occurredAt || new Date().toISOString();
    wo.updatedAt = new Date().toISOString();
    wo.version += 1;

    return wo;
  }

  pauseWorkOrder(tenantId: string, id: string): WorkOrder {
    const wo = this.getWorkOrderById(tenantId, id);
    if (!wo) throw new Error('Work order not found');

    WorkOrderStateMachine.validateTransition(wo.status, WorkOrderStatus.PAUSED);

    wo.status = WorkOrderStatus.PAUSED;
    wo.updatedAt = new Date().toISOString();
    wo.version += 1;

    return wo;
  }

  resumeWorkOrder(tenantId: string, id: string): WorkOrder {
    const wo = this.getWorkOrderById(tenantId, id);
    if (!wo) throw new Error('Work order not found');

    WorkOrderStateMachine.validateTransition(wo.status, WorkOrderStatus.IN_PROGRESS);

    wo.status = WorkOrderStatus.IN_PROGRESS;
    wo.updatedAt = new Date().toISOString();
    wo.version += 1;

    return wo;
  }

  completeWorkOrder(tenantId: string, id: string, payload?: { occurredAt?: string }): WorkOrder {
    const wo = this.getWorkOrderById(tenantId, id);
    if (!wo) throw new Error('Work order not found');

    WorkOrderStateMachine.validateTransition(wo.status, WorkOrderStatus.COMPLETED);

    wo.status = WorkOrderStatus.COMPLETED;
    wo.actualEnd = payload?.occurredAt || new Date().toISOString();
    wo.updatedAt = new Date().toISOString();
    wo.version += 1;

    return wo;
  }

  cancelWorkOrder(tenantId: string, id: string): WorkOrder {
    const wo = this.getWorkOrderById(tenantId, id);
    if (!wo) throw new Error('Work order not found');

    WorkOrderStateMachine.validateTransition(wo.status, WorkOrderStatus.CANCELLED);

    wo.status = WorkOrderStatus.CANCELLED;
    wo.updatedAt = new Date().toISOString();
    wo.version += 1;

    return wo;
  }

  incrementQuantities(tenantId: string, id: string, good: number, reject: number) {
    const wo = this.getWorkOrderById(tenantId, id);
    if (wo) {
      wo.goodQuantity += good;
      wo.rejectQuantity += reject;
      wo.updatedAt = new Date().toISOString();
      wo.version += 1;
    }
  }
}
