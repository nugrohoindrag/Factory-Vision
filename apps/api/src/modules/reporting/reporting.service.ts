import { ProductionService } from '../production/production.service.js';
import { ShopFloorService } from '../shopfloor/shopfloor.service.js';
import { MasterDataService } from '../master-data/master-data.service.js';

export class ReportingService {
  constructor(
    private productionService: ProductionService,
    private shopFloorService: ShopFloorService,
    private masterDataService: MasterDataService
  ) {}

  async getProductionReport(tenantId: string, filter?: { lineId?: string; shiftDate?: string }) {
    const workOrders = await this.productionService.getWorkOrders(tenantId, filter);
    const products = this.masterDataService.getProducts(tenantId);
    const lines = this.masterDataService.getLines(tenantId);

    return workOrders.map((wo) => {
      const prod = products.find((p) => p.id === wo.productId);
      const line = lines.find((l) => l.id === wo.lineId);
      const achievement =
        wo.plannedQuantity > 0 ? Math.round((wo.outputQuantity / wo.plannedQuantity) * 100) : 0;
      const variance = wo.outputQuantity - wo.plannedQuantity;

      return {
        workOrderId: wo.id,
        woNumber: wo.woNumber,
        productSku: prod?.sku || 'N/A',
        productName: prod?.name || 'N/A',
        // The id travels alongside the name so the row can be scope-filtered
        // and drilled into; the name alone is a label, not an identity.
        lineId: wo.lineId,
        lineName: line?.name || wo.lineId,
        targetQuantity: wo.targetQuantity,
        goodQuantity: wo.goodQuantity,
        rejectQuantity: wo.rejectQuantity,
        achievementPct: achievement,
        variance,
        status: wo.status,
        plannedStart: wo.plannedStart,
        actualStart: wo.actualStart || '-',
        actualEnd: wo.actualEnd || '-',
      };
    });
  }

  async getDowntimeReport(tenantId: string, filter?: { lineId?: string }) {
    const records = await this.shopFloorService.getDowntimeRecords(tenantId, filter?.lineId);
    const reasons = this.masterDataService.getDowntimeReasons(tenantId);
    const machines = this.masterDataService.getMachines(tenantId);
    const lines = this.masterDataService.getLines(tenantId);

    return records.map((r) => {
      const reason = reasons.find((rs) => rs.id === r.reasonId);
      const machine = machines.find((m) => m.id === r.machineId);
      const line = lines.find((l) => l.id === r.lineId);

      return {
        id: r.id,
        shiftDate: r.shiftDate,
        shiftId: r.shiftId,
        lineId: r.lineId,
        lineName: line?.name || r.lineId,
        machineId: r.machineId,
        machineName: machine?.name || r.machineId,
        reasonCategory: reason?.category || 'MACHINE',
        reasonName: reason?.name || 'Unspecified',
        isPlanned: r.isPlanned ? 'Ya (Planned)' : 'Tidak (Unplanned)',
        startTime: r.startTime,
        endTime: r.endTime || '-',
        durationMinutes: r.durationSeconds ? Math.round(r.durationSeconds / 60) : 0,
        status: r.status,
        notes: r.notes || '-',
      };
    });
  }

  async getShiftReport(tenantId: string, shiftDate: string = '2026-08-28', shiftId?: string) {
    const lines = this.masterDataService.getLines(tenantId);
    const shifts = this.masterDataService.getShifts(tenantId);
    const shift = shifts.find((s) => s.id === shiftId) ?? shifts.find((s) => s.active) ?? shifts[0];
    const workOrders = await this.productionService.getWorkOrders(tenantId);
    // Scope downtime to the requested shift date. Without this the report sums
    // the entire downtime history into a single shift's total.
    const allDowntimes = await this.shopFloorService.getDowntimeRecords(tenantId);
    const downtimes = allDowntimes.filter((d) => d.shiftDate === shiftDate);

    return lines.map((line) => {
      const lineWos = workOrders.filter((w) => w.lineId === line.id);
      const lineDts = downtimes.filter((d) => d.lineId === line.id);

      const targetSum = lineWos.reduce((acc, w) => acc + w.plannedQuantity, 0);
      const goodSum = lineWos.reduce((acc, w) => acc + w.outputQuantity, 0);
      const rejectSum = lineWos.reduce((acc, w) => acc + w.rejectQuantity, 0);
      const downtimeMinutes = lineDts.reduce((acc, d) => acc + Math.round((d.durationSeconds || 0) / 60), 0);
      const achievement = targetSum > 0 ? Math.round((goodSum / targetSum) * 100) : 0;

      return {
        lineId: line.id,
        lineName: line.name,
        shiftId: shift?.id ?? '-',
        shiftName: shift?.name ?? '-',
        shiftDate,
        totalTarget: targetSum,
        totalGood: goodSum,
        totalReject: rejectSum,
        totalDowntimeMinutes: downtimeMinutes,
        achievementPct: achievement,
        activeWorkOrdersCount: lineWos.length,
        notes: 'Operasional shift berjalan lancar sesuai rencana.',
      };
    });
  }

  // Export to CSV String helper
  exportToCsv(data: Record<string, any>[]): string {
    if (!data || data.length === 0) return '';
    const headers = Object.keys(data[0]);
    const headerRow = headers.join(',');

    const rows = data.map((row) =>
      headers
        .map((header) => {
          const val = row[header] ?? '';
          const escaped = String(val).replace(/"/g, '""');
          return `"${escaped}"`;
        })
        .join(',')
    );

    return [headerRow, ...rows].join('\r\n');
  }
}
