import { DowntimeCategory, RejectCategory } from '@factory-vision/domain-types';
import type {
  CsvColumnSpec,
  CsvEntity,
  CsvImportResult,
  CsvRowError,
  CsvTemplate,
} from '@factory-vision/domain-types';
import { ApiError } from '../../platform/http/api-error.js';
import { MasterDataService } from '../master-data/master-data.service.js';

/**
 * CSV onboarding for master data (US-008).
 *
 * The pilot factory's product, machine and reason-code lists already exist in
 * spreadsheets. Re-keying them into forms is the single largest barrier to a
 * two-week onboarding, so import is validated row by row and reported in full:
 * a file with one bad line imports the other 199 and says exactly which line
 * failed and why, rather than rejecting the lot or, worse, silently skipping.
 */

type Row = Record<string, string>;

interface EntitySpec {
  label: string;
  columns: CsvColumnSpec[];
  /** Natural key used to decide create-vs-update and to detect duplicates. */
  keyOf: (row: Row) => string;
  /** Validates one row against master data; returns errors for that row. */
  validate: (tenantId: string, row: Row, master: MasterDataService) => Omit<CsvRowError, 'row'>[];
  /** Applies one validated row. Returns whether it created or updated. */
  apply: (tenantId: string, row: Row, master: MasterDataService) => 'created' | 'updated';
  /** Serialises the current collection for export. */
  export: (tenantId: string, master: MasterDataService, allowedLineIds?: string[]) => Row[];
}

function col(
  name: string,
  required: boolean,
  description: string,
  example: string,
  references?: CsvEntity
): CsvColumnSpec {
  return { name, required, description, example, references };
}

export class CsvService {
  constructor(private masterData: MasterDataService) {}

  private specs: Record<CsvEntity, EntitySpec> = {
    products: {
      label: 'Produk / SKU',
      columns: [
        col('sku', true, 'Kode produk unik', 'TIRE-185-65-R15'),
        col('name', true, 'Nama produk', 'Passenger Tire 185/65 R15'),
        col('unit', false, 'Satuan (default PCS)', 'PCS'),
        col('idealCycleTimeSeconds', true, 'Ideal cycle time default (detik)', '750'),
        col('status', false, 'ACTIVE atau INACTIVE', 'ACTIVE'),
      ],
      keyOf: (row) => row.sku,
      validate: (_t, row) => {
        const errors: Omit<CsvRowError, 'row'>[] = [];
        if (!isPositiveNumber(row.idealCycleTimeSeconds)) {
          errors.push(numberError('idealCycleTimeSeconds'));
        }
        if (row.status && !['ACTIVE', 'INACTIVE'].includes(row.status)) {
          errors.push({
            column: 'status',
            code: 'INVALID_FORMAT',
            message: 'status harus ACTIVE atau INACTIVE.',
          });
        }
        return errors;
      },
      apply: (tenantId, row, master) => {
        const existing = master.getProducts(tenantId).find((p) => p.sku === row.sku);
        const payload = {
          sku: row.sku,
          name: row.name,
          unit: row.unit || 'PCS',
          idealCycleTimeSeconds: Number(row.idealCycleTimeSeconds),
          status: (row.status || 'ACTIVE') as 'ACTIVE' | 'INACTIVE',
        };
        if (existing) {
          master.updateProduct(tenantId, existing.id, payload);
          return 'updated';
        }
        master.createProduct(tenantId, payload);
        return 'created';
      },
      export: (tenantId, master) =>
        master.getProducts(tenantId).map((p) => ({
          sku: p.sku,
          name: p.name,
          unit: p.unit,
          idealCycleTimeSeconds: String(p.idealCycleTimeSeconds),
          status: p.status,
        })),
    },

    machines: {
      label: 'Mesin',
      columns: [
        col('code', true, 'Kode mesin unik', 'CPR-003'),
        col('name', true, 'Nama mesin', 'Dual Cavity Curing Press 03'),
        col('workCenterCode', true, 'Kode work center', 'WC-CURING'),
        col('idealCycleTimeSeconds', true, 'Ideal cycle time mesin (detik)', '750'),
        col('status', false, 'ACTIVE atau INACTIVE', 'ACTIVE'),
      ],
      keyOf: (row) => row.code,
      validate: (tenantId, row, master) => {
        const errors: Omit<CsvRowError, 'row'>[] = [];
        const workCenter = master
          .getWorkCenters(tenantId)
          .find((w) => w.code === row.workCenterCode || w.id === row.workCenterCode);
        if (!workCenter) {
          errors.push({
            column: 'workCenterCode',
            code: 'UNKNOWN_REFERENCE',
            message: `Work center ${row.workCenterCode} tidak ditemukan.`,
          });
        }
        if (!isPositiveNumber(row.idealCycleTimeSeconds)) errors.push(numberError('idealCycleTimeSeconds'));
        return errors;
      },
      apply: (tenantId, row, master) => {
        const workCenter = master
          .getWorkCenters(tenantId)
          .find((w) => w.code === row.workCenterCode || w.id === row.workCenterCode)!;
        const existing = master.getMachines(tenantId).find((m) => m.code === row.code);
        const payload = {
          workCenterId: workCenter.id,
          code: row.code,
          name: row.name,
          idealCycleTimeSeconds: Number(row.idealCycleTimeSeconds),
          status: (row.status || 'ACTIVE') as 'ACTIVE' | 'INACTIVE',
        };
        if (existing) {
          master.updateMachine(tenantId, existing.id, payload);
          return 'updated';
        }
        master.createMachine(tenantId, payload as never);
        return 'created';
      },
      export: (tenantId, master) => {
        const workCenters = master.getWorkCenters(tenantId);
        return master.getMachines(tenantId).map((m) => ({
          code: m.code,
          name: m.name,
          workCenterCode: workCenters.find((w) => w.id === m.workCenterId)?.code ?? m.workCenterId,
          idealCycleTimeSeconds: String(m.idealCycleTimeSeconds),
          status: m.status,
        }));
      },
    },

    lines: {
      label: 'Production Line',
      columns: [
        col('code', true, 'Kode line unik', 'LINE-04'),
        col('name', true, 'Nama line', 'Curing Line 04'),
        col('plantCode', true, 'Kode/ID plant', 'plant-cikarang-01'),
        col('plannedProductionTimeMinutes', true, 'Planned production time per shift (menit)', '480'),
        col('status', false, 'ACTIVE atau INACTIVE', 'ACTIVE'),
      ],
      keyOf: (row) => row.code,
      validate: (tenantId, row, master) => {
        const errors: Omit<CsvRowError, 'row'>[] = [];
        const plant = master
          .getPlants(tenantId)
          .find((p) => p.id === row.plantCode || p.name === row.plantCode);
        if (!plant) {
          errors.push({
            column: 'plantCode',
            code: 'UNKNOWN_REFERENCE',
            message: `Plant ${row.plantCode} tidak ditemukan.`,
          });
        }
        if (!isPositiveNumber(row.plannedProductionTimeMinutes)) {
          errors.push(numberError('plannedProductionTimeMinutes'));
        }
        return errors;
      },
      apply: (tenantId, row, master) => {
        const plant = master
          .getPlants(tenantId)
          .find((p) => p.id === row.plantCode || p.name === row.plantCode)!;
        const existing = master.getLines(tenantId).find((l) => l.code === row.code);
        const payload = {
          plantId: plant.id,
          code: row.code,
          name: row.name,
          plannedProductionTimeMinutes: Number(row.plannedProductionTimeMinutes),
          status: (row.status || 'ACTIVE') as 'ACTIVE' | 'INACTIVE',
        };
        if (existing) {
          master.updateLine(tenantId, existing.id, payload);
          return 'updated';
        }
        master.createLine(tenantId, payload);
        return 'created';
      },
      export: (tenantId, master, allowedLineIds) =>
        master
          .getLines(tenantId)
          .filter((l) => !allowedLineIds || allowedLineIds.includes(l.id))
          .map((l) => ({
            code: l.code,
            name: l.name,
            plantCode: l.plantId,
            plannedProductionTimeMinutes: String(l.plannedProductionTimeMinutes),
            status: l.status,
          })),
    },

    operators: {
      label: 'Operator',
      columns: [
        col('employeeNumber', true, 'Nomor karyawan unik', 'OP-1004'),
        col('name', true, 'Nama operator', 'Dedi Kurniawan'),
        col('defaultLineCode', false, 'Kode line default', 'LINE-01', 'lines'),
        col('status', false, 'ACTIVE atau INACTIVE', 'ACTIVE'),
      ],
      keyOf: (row) => row.employeeNumber,
      validate: (tenantId, row, master) => {
        const errors: Omit<CsvRowError, 'row'>[] = [];
        if (row.defaultLineCode) {
          const line = master
            .getLines(tenantId)
            .find((l) => l.code === row.defaultLineCode || l.id === row.defaultLineCode);
          if (!line) {
            errors.push({
              column: 'defaultLineCode',
              code: 'UNKNOWN_REFERENCE',
              message: `Line ${row.defaultLineCode} tidak ditemukan.`,
            });
          }
        }
        return errors;
      },
      apply: (tenantId, row, master) => {
        const line = row.defaultLineCode
          ? master
              .getLines(tenantId)
              .find((l) => l.code === row.defaultLineCode || l.id === row.defaultLineCode)
          : undefined;
        const existing = master.getOperators(tenantId).find((o) => o.employeeNumber === row.employeeNumber);
        const payload = {
          employeeNumber: row.employeeNumber,
          name: row.name,
          defaultLineId: line?.id,
          status: (row.status || 'ACTIVE') as 'ACTIVE' | 'INACTIVE',
        };
        if (existing) {
          master.updateOperator(tenantId, existing.id, payload);
          return 'updated';
        }
        master.createOperator(tenantId, payload);
        return 'created';
      },
      export: (tenantId, master) => {
        const lines = master.getLines(tenantId);
        return master.getOperators(tenantId).map((o) => ({
          employeeNumber: o.employeeNumber,
          name: o.name,
          defaultLineCode: lines.find((l) => l.id === o.defaultLineId)?.code ?? '',
          status: o.status,
        }));
      },
    },

    processes: {
      label: 'Production Process',
      columns: [
        col('code', true, 'Kode proses unik', 'FIN'),
        col('name', true, 'Nama proses', 'Finishing'),
        col('sequenceDefault', true, 'Urutan default', '8'),
        col('description', false, 'Deskripsi operasi', 'Trimming dan buffing'),
        col('status', false, 'ACTIVE atau INACTIVE', 'ACTIVE'),
      ],
      keyOf: (row) => row.code,
      validate: (_t, row) => (isPositiveNumber(row.sequenceDefault) ? [] : [numberError('sequenceDefault')]),
      apply: (tenantId, row, master) => {
        const existing = master.getProcesses(tenantId).find((p) => p.code === row.code);
        const payload = {
          code: row.code,
          name: row.name,
          description: row.description || '',
          sequenceDefault: Number(row.sequenceDefault),
          status: (row.status || 'ACTIVE') as 'ACTIVE' | 'INACTIVE',
        };
        if (existing) {
          master.updateProcess(tenantId, existing.id, payload);
          return 'updated';
        }
        master.createProcess(tenantId, payload);
        return 'created';
      },
      export: (tenantId, master) =>
        master.getProcesses(tenantId).map((p) => ({
          code: p.code,
          name: p.name,
          sequenceDefault: String(p.sequenceDefault),
          description: p.description ?? '',
          status: p.status,
        })),
    },

    routings: {
      label: 'Product Routing',
      columns: [
        col('productSku', true, 'SKU produk', 'TIRE-185-65-R15', 'products'),
        col('processCode', true, 'Kode proses', 'CUR', 'processes'),
        col('sequence', true, 'Urutan langkah', '4'),
        col('machineCode', false, 'Kode mesin', 'CPR-001', 'machines'),
        col('standardCycleTimeSeconds', false, 'Cycle time standar (detik)', '750'),
        col('active', false, 'true atau false', 'true'),
      ],
      keyOf: (row) => `${row.productSku}|${row.processCode}|${row.sequence}`,
      validate: (tenantId, row, master) => {
        const errors: Omit<CsvRowError, 'row'>[] = [];
        if (!master.getProducts(tenantId).some((p) => p.sku === row.productSku)) {
          errors.push({
            column: 'productSku',
            code: 'UNKNOWN_REFERENCE',
            message: `Produk ${row.productSku} tidak ditemukan.`,
          });
        }
        if (!master.getProcesses(tenantId).some((p) => p.code === row.processCode)) {
          errors.push({
            column: 'processCode',
            code: 'UNKNOWN_REFERENCE',
            message: `Proses ${row.processCode} tidak ditemukan.`,
          });
        }
        if (row.machineCode && !master.getMachines(tenantId).some((m) => m.code === row.machineCode)) {
          errors.push({
            column: 'machineCode',
            code: 'UNKNOWN_REFERENCE',
            message: `Mesin ${row.machineCode} tidak ditemukan.`,
          });
        }
        if (!isPositiveNumber(row.sequence)) errors.push(numberError('sequence'));
        return errors;
      },
      apply: (tenantId, row, master) => {
        const product = master.getProducts(tenantId).find((p) => p.sku === row.productSku)!;
        const process = master.getProcesses(tenantId).find((p) => p.code === row.processCode)!;
        const machine = row.machineCode
          ? master.getMachines(tenantId).find((m) => m.code === row.machineCode)
          : undefined;
        const existing = master
          .getProductRoutings(tenantId, product.id)
          .find((r) => r.processId === process.id && r.sequence === Number(row.sequence));

        const payload = {
          productId: product.id,
          processId: process.id,
          sequence: Number(row.sequence),
          machineId: machine?.id,
          workCenterId: machine?.workCenterId,
          standardCycleTimeSeconds: row.standardCycleTimeSeconds
            ? Number(row.standardCycleTimeSeconds)
            : undefined,
          active: row.active ? row.active === 'true' : true,
        };

        if (existing) {
          master.updateRouting(tenantId, existing.id, payload);
          return 'updated';
        }
        master.createRouting(tenantId, payload);
        return 'created';
      },
      export: (tenantId, master) => {
        const products = master.getProducts(tenantId);
        const processes = master.getProcesses(tenantId);
        const machines = master.getMachines(tenantId);
        return master.getProductRoutings(tenantId).map((r) => ({
          productSku: products.find((p) => p.id === r.productId)?.sku ?? r.productId,
          processCode: processes.find((p) => p.id === r.processId)?.code ?? r.processId,
          sequence: String(r.sequence),
          machineCode: machines.find((m) => m.id === r.machineId)?.code ?? '',
          standardCycleTimeSeconds: r.standardCycleTimeSeconds ? String(r.standardCycleTimeSeconds) : '',
          active: String(r.active),
        }));
      },
    },

    'machine-rates': {
      label: 'Ideal Cycle Time (Product × Machine)',
      columns: [
        col('productSku', true, 'SKU produk', 'TIRE-185-65-R15', 'products'),
        col('machineCode', true, 'Kode mesin', 'CPR-001', 'machines'),
        col('idealCycleTimeSeconds', true, 'Ideal cycle time (detik)', '750'),
      ],
      keyOf: (row) => `${row.productSku}|${row.machineCode}`,
      validate: (tenantId, row, master) => {
        const errors: Omit<CsvRowError, 'row'>[] = [];
        if (!master.getProducts(tenantId).some((p) => p.sku === row.productSku)) {
          errors.push({
            column: 'productSku',
            code: 'UNKNOWN_REFERENCE',
            message: `Produk ${row.productSku} tidak ditemukan.`,
          });
        }
        if (!master.getMachines(tenantId).some((m) => m.code === row.machineCode)) {
          errors.push({
            column: 'machineCode',
            code: 'UNKNOWN_REFERENCE',
            message: `Mesin ${row.machineCode} tidak ditemukan.`,
          });
        }
        if (!isPositiveNumber(row.idealCycleTimeSeconds)) errors.push(numberError('idealCycleTimeSeconds'));
        return errors;
      },
      apply: (tenantId, row, master) => {
        const product = master.getProducts(tenantId).find((p) => p.sku === row.productSku)!;
        const machine = master.getMachines(tenantId).find((m) => m.code === row.machineCode)!;
        const before = master.getProductMachineRates(tenantId, product.id, machine.id).length;
        master.upsertProductMachineRate(tenantId, {
          productId: product.id,
          machineId: machine.id,
          idealCycleTimeSeconds: Number(row.idealCycleTimeSeconds),
        });
        return before > 0 ? 'updated' : 'created';
      },
      export: (tenantId, master) => {
        const products = master.getProducts(tenantId);
        const machines = master.getMachines(tenantId);
        return master.getProductMachineRates(tenantId).map((r) => ({
          productSku: products.find((p) => p.id === r.productId)?.sku ?? r.productId,
          machineCode: machines.find((m) => m.id === r.machineId)?.code ?? r.machineId,
          idealCycleTimeSeconds: String(r.idealCycleTimeSeconds),
        }));
      },
    },

    shifts: {
      label: 'Shift',
      columns: [
        col('name', true, 'Nama shift', 'Shift 1 (Pagi)'),
        col('plantCode', true, 'Kode/ID plant', 'plant-cikarang-01'),
        col('startTime', true, 'Jam mulai HH:mm', '06:00'),
        col('endTime', true, 'Jam selesai HH:mm', '14:00'),
        col('breakMinutes', false, 'Total istirahat (menit)', '60'),
        col('active', false, 'true atau false', 'true'),
      ],
      keyOf: (row) => `${row.plantCode}|${row.name}`,
      validate: (tenantId, row, master) => {
        const errors: Omit<CsvRowError, 'row'>[] = [];
        if (!master.getPlants(tenantId).some((p) => p.id === row.plantCode || p.name === row.plantCode)) {
          errors.push({
            column: 'plantCode',
            code: 'UNKNOWN_REFERENCE',
            message: `Plant ${row.plantCode} tidak ditemukan.`,
          });
        }
        for (const column of ['startTime', 'endTime'] as const) {
          if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(row[column] ?? '')) {
            errors.push({ column, code: 'INVALID_FORMAT', message: `${column} harus dalam format HH:mm.` });
          }
        }
        return errors;
      },
      apply: (tenantId, row, master) => {
        const plant = master
          .getPlants(tenantId)
          .find((p) => p.id === row.plantCode || p.name === row.plantCode)!;
        const existing = master.getShifts(tenantId).find((s) => s.name === row.name && s.plantId === plant.id);
        const payload = {
          plantId: plant.id,
          name: row.name,
          startTime: row.startTime,
          endTime: row.endTime,
          breakMinutes: row.breakMinutes ? Number(row.breakMinutes) : 0,
          active: row.active ? row.active === 'true' : true,
        };
        if (existing) {
          master.updateShift(tenantId, existing.id, payload);
          return 'updated';
        }
        master.createShift(tenantId, payload);
        return 'created';
      },
      export: (tenantId, master) =>
        master.getShifts(tenantId).map((s) => ({
          name: s.name,
          plantCode: s.plantId,
          startTime: s.startTime,
          endTime: s.endTime,
          breakMinutes: String(s.breakMinutes),
          active: String(s.active),
        })),
    },

    'downtime-reasons': {
      label: 'Downtime Reason',
      columns: [
        col('code', true, 'Kode alasan unik', 'MC-BRK'),
        col('name', true, 'Nama alasan', 'Kerusakan Mekanikal'),
        col('category', true, `Kategori: ${Object.values(DowntimeCategory).join('/')}`, 'MACHINE'),
        col('isPlanned', true, 'true bila planned downtime', 'false'),
        col('sortOrder', false, 'Urutan tampil', '1'),
        col('active', false, 'true atau false', 'true'),
      ],
      keyOf: (row) => row.code,
      validate: (_t, row) => {
        const errors: Omit<CsvRowError, 'row'>[] = [];
        if (!Object.values(DowntimeCategory).includes(row.category as DowntimeCategory)) {
          errors.push({
            column: 'category',
            code: 'INVALID_FORMAT',
            message: `category harus salah satu dari ${Object.values(DowntimeCategory).join(', ')}.`,
          });
        }
        if (!['true', 'false'].includes(row.isPlanned)) {
          errors.push({
            column: 'isPlanned',
            code: 'INVALID_FORMAT',
            message: 'isPlanned harus true atau false.',
          });
        }
        return errors;
      },
      apply: (tenantId, row, master) => {
        const existing = master.getDowntimeReasons(tenantId).find((r) => r.code === row.code);
        const payload = {
          code: row.code,
          name: row.name,
          category: row.category as DowntimeCategory,
          isPlanned: row.isPlanned === 'true',
          sortOrder: row.sortOrder ? Number(row.sortOrder) : 99,
          active: row.active ? row.active === 'true' : true,
          description: row.description || '',
        };
        if (existing) {
          master.updateDowntimeReason(tenantId, existing.id, payload);
          return 'updated';
        }
        master.createDowntimeReason(tenantId, payload);
        return 'created';
      },
      export: (tenantId, master) =>
        master.getDowntimeReasons(tenantId).map((r) => ({
          code: r.code,
          name: r.name,
          category: r.category,
          isPlanned: String(r.isPlanned),
          sortOrder: String(r.sortOrder),
          active: String(r.active),
        })),
    },

    'reject-reasons': {
      label: 'Reject Reason',
      columns: [
        col('code', true, 'Kode defect unik', 'DIM-OOS'),
        col('name', true, 'Nama defect', 'Dimensi di luar toleransi'),
        col('category', true, `Kategori: ${Object.values(RejectCategory).join('/')}`, 'DIMENSION'),
        col('sortOrder', false, 'Urutan tampil', '1'),
        col('active', false, 'true atau false', 'true'),
      ],
      keyOf: (row) => row.code,
      validate: (_t, row) =>
        Object.values(RejectCategory).includes(row.category as RejectCategory)
          ? []
          : [
              {
                column: 'category',
                code: 'INVALID_FORMAT' as const,
                message: `category harus salah satu dari ${Object.values(RejectCategory).join(', ')}.`,
              },
            ],
      apply: (tenantId, row, master) => {
        const existing = master.getRejectReasons(tenantId).find((r) => r.code === row.code);
        const payload = {
          code: row.code,
          name: row.name,
          category: row.category as RejectCategory,
          sortOrder: row.sortOrder ? Number(row.sortOrder) : 99,
          active: row.active ? row.active === 'true' : true,
          description: row.description || '',
        };
        if (existing) {
          master.updateRejectReason(tenantId, existing.id, payload);
          return 'updated';
        }
        master.createRejectReason(tenantId, payload);
        return 'created';
      },
      export: (tenantId, master) =>
        master.getRejectReasons(tenantId).map((r) => ({
          code: r.code,
          name: r.name,
          category: r.category,
          sortOrder: String(r.sortOrder),
          active: String(r.active),
        })),
    },
  };

  listEntities(): Array<{ entity: CsvEntity; label: string }> {
    return (Object.keys(this.specs) as CsvEntity[]).map((entity) => ({
      entity,
      label: this.specs[entity].label,
    }));
  }

  private spec(entity: string): EntitySpec {
    const spec = this.specs[entity as CsvEntity];
    if (!spec) throw ApiError.notFound(`Entitas CSV ${entity} tidak didukung.`);
    return spec;
  }

  /** Header row plus a filled example, so the first import is a copy-paste. */
  getTemplate(entity: string): CsvTemplate {
    const spec = this.spec(entity);
    const header = spec.columns.map((c) => c.name).join(',');
    const example = spec.columns.map((c) => escapeCsv(c.example)).join(',');
    return {
      entity: entity as CsvEntity,
      label: spec.label,
      columns: spec.columns,
      csv: `${header}\n${example}\n`,
    };
  }

  export(entity: string, tenantId: string, allowedLineIds?: string[]): string {
    const spec = this.spec(entity);
    const rows = spec.export(tenantId, this.masterData, allowedLineIds);
    const header = spec.columns.map((c) => c.name);
    const lines = [header.join(',')];
    for (const row of rows) {
      lines.push(header.map((name) => escapeCsv(row[name] ?? '')).join(','));
    }
    return `${lines.join('\n')}\n`;
  }

  /**
   * Validates and applies a CSV upload.
   *
   * `dryRun` runs every check and reports the outcome without writing, which is
   * what the console's "Validasi" button calls before an admin commits.
   */
  import(entity: string, tenantId: string, csv: string, opts: { dryRun?: boolean } = {}): CsvImportResult {
    const spec = this.spec(entity);
    const parsed = parseCsv(csv);

    const result: CsvImportResult = {
      entity: entity as CsvEntity,
      totalRows: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      errors: [],
      rejectedWholeFile: false,
    };

    if (parsed.header.length === 0) {
      result.rejectedWholeFile = true;
      result.errors.push({ row: 0, code: 'INVALID_FORMAT', message: 'File CSV kosong atau tanpa header.' });
      return result;
    }

    // A missing required column is a file-level problem: importing the rows
    // that happen to parse would leave a half-configured factory behind.
    const missing = spec.columns
      .filter((c) => c.required)
      .map((c) => c.name)
      .filter((name) => !parsed.header.includes(name));
    if (missing.length > 0) {
      result.rejectedWholeFile = true;
      result.errors.push({
        row: 0,
        code: 'REQUIRED',
        message: `Kolom wajib tidak ditemukan: ${missing.join(', ')}.`,
      });
      return result;
    }

    result.totalRows = parsed.rows.length;
    const seenKeys = new Set<string>();

    for (let index = 0; index < parsed.rows.length; index += 1) {
      const row = parsed.rows[index];
      const rowNumber = index + 1;
      const rowErrors: CsvRowError[] = [];

      for (const column of spec.columns) {
        if (column.required && !row[column.name]) {
          rowErrors.push({
            row: rowNumber,
            column: column.name,
            code: 'REQUIRED',
            message: `${column.name} wajib diisi.`,
          });
        }
      }

      if (rowErrors.length === 0) {
        const key = spec.keyOf(row);
        if (seenKeys.has(key)) {
          rowErrors.push({
            row: rowNumber,
            code: 'DUPLICATE',
            message: `Baris duplikat untuk kunci ${key} di dalam file yang sama.`,
          });
        } else {
          seenKeys.add(key);
        }

        for (const error of spec.validate(tenantId, row, this.masterData)) {
          rowErrors.push({ ...error, row: rowNumber });
        }
      }

      if (rowErrors.length > 0) {
        result.failed += 1;
        result.errors.push(...rowErrors);
        continue;
      }

      if (opts.dryRun) {
        result.skipped += 1;
        continue;
      }

      try {
        const outcome = spec.apply(tenantId, row, this.masterData);
        if (outcome === 'created') result.created += 1;
        else result.updated += 1;
      } catch (error) {
        result.failed += 1;
        result.errors.push({
          row: rowNumber,
          code: 'INVALID_FORMAT',
          message: error instanceof Error ? error.message : 'Gagal menyimpan baris.',
        });
      }
    }

    return result;
  }
}

// --- CSV plumbing -------------------------------------------------

function isPositiveNumber(value: string | undefined): boolean {
  const parsed = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(parsed) && parsed > 0;
}

function numberError(column: string): Omit<CsvRowError, 'row'> {
  return { column, code: 'INVALID_FORMAT', message: `${column} harus berupa angka lebih besar dari 0.` };
}

function escapeCsv(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/**
 * A minimal RFC-4180 reader, quoted fields, escaped quotes, CRLF.
 *
 * Exported spreadsheets routinely contain commas inside product names, so a
 * naive `split(',')` would corrupt exactly the data an admin is most likely
 * to upload.
 */
export function parseCsv(text: string): { header: string[]; rows: Record<string, string>[] } {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;

  const clean = text.replace(/^﻿/, '');

  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i];

    if (inQuotes) {
      if (char === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      record.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && clean[i + 1] === '\n') i += 1;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  const nonEmpty = records.filter((r) => r.some((cell) => cell.trim() !== ''));
  if (nonEmpty.length === 0) return { header: [], rows: [] };

  const header = nonEmpty[0].map((h) => h.trim());
  const rows = nonEmpty.slice(1).map((cells) => {
    const row: Record<string, string> = {};
    header.forEach((name, index) => {
      row[name] = (cells[index] ?? '').trim();
    });
    return row;
  });

  return { header, rows };
}
