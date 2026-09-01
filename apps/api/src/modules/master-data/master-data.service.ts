import {
  Plant,
  ProductionLine,
  WorkCenter,
  ProductionProcess,
  Machine,
  Product,
  ProductRouting,
  ProductMachineRate,
  ProductionBatch,
  ProductionBatchStatus,
  Operator,
  Shift,
  DowntimeReason,
  RejectReason,
  MachineState,
  DowntimeCategory,
  RejectCategory,
  AppUser,
  DeviceTerminal,
  UserRole,
  KpiTarget,
  KpiMetric,
} from '@factory-vision/domain-types';
import { demoRows } from '../../platform/config/demo-seed.js';

import { withTenant } from '../../platform/db/pool.js';
import { AppUserRepository, OperatorRepository, ShiftRepository } from './reference.repository.js';
import { MasterReferenceRepository } from './master-reference.repository.js';
import type { Executor } from '../../platform/db/executor.js';

export class MasterDataService {
  /**
   * Shifts, operators and users are read synchronously all over the service
   * and on the shop floor's hot path, so they stay in these arrays — but the
   * arrays are a cache, not the record. `hydrate()` rebuilds them from
   * PostgreSQL at boot and every mutation below writes there first, so a
   * restart changes nothing about what the plant sees.
   */
  private readonly referenceRepo = new MasterReferenceRepository();
  private readonly shiftRepo = new ShiftRepository();
  private readonly operatorRepo = new OperatorRepository();
  private readonly userRepo = new AppUserRepository();

  /** Password hashes, keyed by user id, as loaded from `app_user`. */
  private readonly userPasswordHashes = new Map<string, string>();

  private plants: Plant[] = demoRows<Plant>(() => [
    {
      id: 'plant-cikarang-01',
      tenantId: 'tenant-pilot-factory-01',
      name: 'Main Plant Cikarang',
      location: 'Kawasan Industri GIIC Cikarang Blok C-12, Jawa Barat',
      timezone: 'Asia/Jakarta',
      status: 'ACTIVE',
    },
  ]);

  private lines: ProductionLine[] = demoRows<ProductionLine>(() => [
    {
      id: 'line-01',
      tenantId: 'tenant-pilot-factory-01',
      plantId: 'plant-cikarang-01',
      code: 'LINE-ALPHA',
      name: 'Line Tire Production Alpha (Passenger Car)',
      status: 'ACTIVE',
      plannedProductionTimeMinutes: 480,
    },
    {
      id: 'line-02',
      tenantId: 'tenant-pilot-factory-01',
      plantId: 'plant-cikarang-01',
      code: 'LINE-BETA',
      name: 'Line Tire Production Beta (SUV & Light Truck)',
      status: 'ACTIVE',
      plannedProductionTimeMinutes: 480,
    },
    {
      id: 'line-03',
      tenantId: 'tenant-pilot-factory-01',
      plantId: 'plant-cikarang-01',
      code: 'LINE-GAMMA',
      name: 'Line Tire Production Gamma (Light Truck)',
      status: 'ACTIVE',
      plannedProductionTimeMinutes: 480,
    },
  ]);

  /**
   * Work centres are what tie a machine to a production line, so the
   * pilot's three lines each own theirs. Line Gamma holds TBM-002 and CPR-002
   * because names those two machines as the pilot validation area.
   */
  private workCenters: WorkCenter[] = demoRows<WorkCenter>(() => [
    {
      id: 'wc-mixing',
      tenantId: 'tenant-pilot-factory-01',
      productionLineId: 'line-01',
      code: 'WC-MIX',
      name: 'Mixing Area Banbury',
      sequence: 1,
    },
    {
      id: 'wc-extrusion',
      tenantId: 'tenant-pilot-factory-01',
      productionLineId: 'line-01',
      code: 'WC-EXT',
      name: 'Extruder Tread Area',
      sequence: 2,
    },
    {
      id: 'wc-building',
      tenantId: 'tenant-pilot-factory-01',
      productionLineId: 'line-01',
      code: 'WC-TBM',
      name: 'Tire Building Machine Bay',
      sequence: 3,
    },
    {
      id: 'wc-curing',
      tenantId: 'tenant-pilot-factory-01',
      productionLineId: 'line-01',
      code: 'WC-CPR',
      name: 'Curing Press Vulcanizing Area',
      sequence: 4,
    },
    {
      id: 'wc-inspection',
      tenantId: 'tenant-pilot-factory-01',
      productionLineId: 'line-01',
      code: 'WC-INS',
      name: 'Final Inspection Station',
      sequence: 5,
    },
    {
      id: 'wc-mixing-02',
      tenantId: 'tenant-pilot-factory-01',
      productionLineId: 'line-02',
      code: 'WC-MIX-B',
      name: 'Mixing Area Banbury Beta',
      sequence: 1,
    },
    {
      id: 'wc-calendering',
      tenantId: 'tenant-pilot-factory-01',
      productionLineId: 'line-02',
      code: 'WC-CAL',
      name: 'Calender Steel Area',
      sequence: 2,
    },
    {
      id: 'wc-building-02',
      tenantId: 'tenant-pilot-factory-01',
      productionLineId: 'line-03',
      code: 'WC-TBM-G',
      name: 'Tire Building Bay Gamma',
      sequence: 1,
    },
    {
      id: 'wc-curing-02',
      tenantId: 'tenant-pilot-factory-01',
      productionLineId: 'line-03',
      code: 'WC-CPR-G',
      name: 'Curing Press Area Gamma',
      sequence: 2,
    },
  ]);

  private processes: ProductionProcess[] = demoRows<ProductionProcess>(() => [
    {
      id: 'proc-mixing',
      tenantId: 'tenant-pilot-factory-01',
      code: 'MIX',
      name: 'Mixing & Compounding',
      description: 'Pencampuran karet alam, sintetis, dan bahan kimia Banbury',
      sequenceDefault: 1,
      status: 'ACTIVE',
    },
    {
      id: 'proc-calendering',
      tenantId: 'tenant-pilot-factory-01',
      code: 'CAL',
      name: 'Fabric & Steel Calendering',
      description: 'Pelapisan kawat baja dan serat nilon dengan kompon karet',
      sequenceDefault: 2,
      status: 'ACTIVE',
    },
    {
      id: 'proc-extrusion',
      tenantId: 'tenant-pilot-factory-01',
      code: 'EXT',
      name: 'Extrusion (Tread & Sidewall)',
      description: 'Ekstrusi profil tapak dan dinding samping ban',
      sequenceDefault: 3,
      status: 'ACTIVE',
    },
    {
      id: 'proc-cutting',
      tenantId: 'tenant-pilot-factory-01',
      code: 'CUT',
      name: 'Component Cutting',
      description: 'Pemotongan ply cord dan steel belt sesuai spesifikasi',
      sequenceDefault: 4,
      status: 'ACTIVE',
    },
    {
      id: 'proc-bead',
      tenantId: 'tenant-pilot-factory-01',
      code: 'BWD',
      name: 'Bead Manufacturing',
      description: 'Pembuatan kawat ring pengunci velg (bead core)',
      sequenceDefault: 5,
      status: 'ACTIVE',
    },
    {
      id: 'proc-building',
      tenantId: 'tenant-pilot-factory-01',
      code: 'TBM',
      name: 'Tire Building (TBM)',
      description: 'Perakitan komponen menjadi ban mentah (Green Tire)',
      sequenceDefault: 6,
      status: 'ACTIVE',
    },
    {
      id: 'proc-curing',
      tenantId: 'tenant-pilot-factory-01',
      code: 'CPR',
      name: 'Curing / Vulcanizing',
      description: 'Pemasakan ban dengan panas dan tekanan dalam cetakan (Curing Press)',
      sequenceDefault: 7,
      status: 'ACTIVE',
    },
    {
      id: 'proc-finishing',
      tenantId: 'tenant-pilot-factory-01',
      code: 'FIN',
      name: 'Finishing & Trimming',
      description: 'Pembersihan flash dan sisa cetakan vulkanisasi',
      sequenceDefault: 8,
      status: 'ACTIVE',
    },
    {
      id: 'proc-inspection',
      tenantId: 'tenant-pilot-factory-01',
      code: 'INS',
      name: 'Quality & Uniformity Inspection',
      description: 'Pemeriksaan visual, X-ray, dan balance test ban jadi',
      sequenceDefault: 9,
      status: 'ACTIVE',
    },
  ]);

  private machines: Machine[] = demoRows<Machine>(() => [
    {
      id: 'mc-mix-01',
      tenantId: 'tenant-pilot-factory-01',
      workCenterId: 'wc-mixing',
      code: 'MIX-001',
      name: 'Banbury Internal Mixer 01',
      status: 'ACTIVE',
      idealCycleTimeSeconds: 90,
      currentState: MachineState.RUNNING,
      currentStateSince: new Date().toISOString(),
    },
    {
      id: 'mc-mix-02',
      tenantId: 'tenant-pilot-factory-01',
      workCenterId: 'wc-mixing-02',
      code: 'MIX-002',
      name: 'Banbury Internal Mixer 02',
      status: 'ACTIVE',
      idealCycleTimeSeconds: 90,
      currentState: MachineState.IDLE,
      currentStateSince: new Date().toISOString(),
    },
    {
      id: 'mc-ext-01',
      tenantId: 'tenant-pilot-factory-01',
      workCenterId: 'wc-extrusion',
      code: 'EXT-001',
      name: 'Triplex Tread Extruder 01',
      status: 'ACTIVE',
      idealCycleTimeSeconds: 45,
      currentState: MachineState.RUNNING,
      currentStateSince: new Date().toISOString(),
    },
    {
      id: 'mc-cal-01',
      tenantId: 'tenant-pilot-factory-01',
      workCenterId: 'wc-calendering',
      code: 'CAL-001',
      name: '4-Roll Steel Cord Calender 01',
      status: 'ACTIVE',
      idealCycleTimeSeconds: 60,
      currentState: MachineState.RUNNING,
      currentStateSince: new Date().toISOString(),
    },
    {
      id: 'mc-tbm-01',
      tenantId: 'tenant-pilot-factory-01',
      workCenterId: 'wc-building',
      code: 'TBM-001',
      name: 'Tire Building Machine Alpha 01',
      status: 'ACTIVE',
      idealCycleTimeSeconds: 150,
      currentState: MachineState.RUNNING,
      currentStateSince: new Date().toISOString(),
    },
    {
      id: 'mc-tbm-02',
      tenantId: 'tenant-pilot-factory-01',
      workCenterId: 'wc-building-02',
      code: 'TBM-002',
      name: 'Tire Building Machine Alpha 02',
      status: 'ACTIVE',
      idealCycleTimeSeconds: 180,
      currentState: MachineState.RUNNING,
      currentStateSince: new Date().toISOString(),
    },
    {
      id: 'mc-cpr-01',
      tenantId: 'tenant-pilot-factory-01',
      workCenterId: 'wc-curing',
      code: 'CPR-001',
      name: 'Dual Cavity Curing Press 01',
      status: 'ACTIVE',
      idealCycleTimeSeconds: 750,
      currentState: MachineState.RUNNING,
      currentStateSince: new Date().toISOString(),
    },
    {
      id: 'mc-cpr-02',
      tenantId: 'tenant-pilot-factory-01',
      workCenterId: 'wc-curing-02',
      code: 'CPR-002',
      name: 'Dual Cavity Curing Press 02',
      status: 'ACTIVE',
      idealCycleTimeSeconds: 900,
      currentState: MachineState.DOWNTIME,
      currentStateSince: new Date().toISOString(),
    },
    {
      id: 'mc-ins-01',
      tenantId: 'tenant-pilot-factory-01',
      workCenterId: 'wc-inspection',
      code: 'INS-001',
      name: 'X-Ray & Uniformity Tester 01',
      status: 'ACTIVE',
      idealCycleTimeSeconds: 30,
      currentState: MachineState.RUNNING,
      currentStateSince: new Date().toISOString(),
    },
  ]);

  private products: Product[] = demoRows<Product>(() => [
    {
      id: 'prod-tire-a',
      tenantId: 'tenant-pilot-factory-01',
      sku: 'TIRE-PCR-185',
      name: 'Tire A: Passenger Car Radial 185/65 R15',
      unit: 'PCS',
      idealCycleTimeSeconds: 150,
      status: 'ACTIVE',
    },
    {
      id: 'prod-tire-b',
      tenantId: 'tenant-pilot-factory-01',
      sku: 'TIRE-SUV-235',
      name: 'Tire B: SUV All-Terrain 235/70 R16',
      unit: 'PCS',
      idealCycleTimeSeconds: 180,
      status: 'ACTIVE',
    },
    {
      id: 'prod-tire-c',
      tenantId: 'tenant-pilot-factory-01',
      sku: 'TIRE-LTR-195',
      name: 'Tire C: Light Truck Commercial 195 R14C',
      unit: 'PCS',
      idealCycleTimeSeconds: 210,
      status: 'ACTIVE',
    },
  ]);

  private productMachineRates: ProductMachineRate[] = demoRows<ProductMachineRate>(() => [
    {
      id: 'pmr-a-tbm1',
      tenantId: 'tenant-pilot-factory-01',
      productId: 'prod-tire-a',
      machineId: 'mc-tbm-01',
      idealCycleTimeSeconds: 150,
    },
    {
      id: 'pmr-a-cpr1',
      tenantId: 'tenant-pilot-factory-01',
      productId: 'prod-tire-a',
      machineId: 'mc-cpr-01',
      idealCycleTimeSeconds: 750,
    },
    {
      id: 'pmr-b-tbm1',
      tenantId: 'tenant-pilot-factory-01',
      productId: 'prod-tire-b',
      machineId: 'mc-tbm-01',
      idealCycleTimeSeconds: 180,
    },
    {
      id: 'pmr-b-cpr1',
      tenantId: 'tenant-pilot-factory-01',
      productId: 'prod-tire-b',
      machineId: 'mc-cpr-01',
      idealCycleTimeSeconds: 900,
    },
    {
      id: 'pmr-c-tbm2',
      tenantId: 'tenant-pilot-factory-01',
      productId: 'prod-tire-c',
      machineId: 'mc-tbm-02',
      idealCycleTimeSeconds: 210,
    },
    {
      id: 'pmr-c-cpr2',
      tenantId: 'tenant-pilot-factory-01',
      productId: 'prod-tire-c',
      machineId: 'mc-cpr-02',
      idealCycleTimeSeconds: 1050,
    },
    // Upstream rates, so every machine that carries a work order has a
    // configured Product × Machine cycle time and OEE Performance is never
    // computed against a fallback (, US-049).
    {
      id: 'pmr-a-mix1',
      tenantId: 'tenant-pilot-factory-01',
      productId: 'prod-tire-a',
      machineId: 'mc-mix-01',
      idealCycleTimeSeconds: 90,
    },
    {
      id: 'pmr-a-ext1',
      tenantId: 'tenant-pilot-factory-01',
      productId: 'prod-tire-a',
      machineId: 'mc-ext-01',
      idealCycleTimeSeconds: 45,
    },
    {
      id: 'pmr-a-ins1',
      tenantId: 'tenant-pilot-factory-01',
      productId: 'prod-tire-a',
      machineId: 'mc-ins-01',
      idealCycleTimeSeconds: 30,
    },
    {
      id: 'pmr-b-mix2',
      tenantId: 'tenant-pilot-factory-01',
      productId: 'prod-tire-b',
      machineId: 'mc-mix-02',
      idealCycleTimeSeconds: 100,
    },
    {
      id: 'pmr-b-cal1',
      tenantId: 'tenant-pilot-factory-01',
      productId: 'prod-tire-b',
      machineId: 'mc-cal-01',
      idealCycleTimeSeconds: 60,
    },
  ]);

  private productRoutings: ProductRouting[] = demoRows<ProductRouting>(() => [
    {
      id: 'rt-a-1',
      tenantId: 'tenant-pilot-factory-01',
      productId: 'prod-tire-a',
      processId: 'proc-mixing',
      sequence: 1,
      workCenterId: 'wc-mixing',
      machineId: 'mc-mix-01',
      standardCycleTimeSeconds: 90,
      active: true,
    },
    {
      id: 'rt-a-2',
      tenantId: 'tenant-pilot-factory-01',
      productId: 'prod-tire-a',
      processId: 'proc-extrusion',
      sequence: 2,
      workCenterId: 'wc-extrusion',
      machineId: 'mc-ext-01',
      standardCycleTimeSeconds: 45,
      active: true,
    },
    {
      id: 'rt-a-3',
      tenantId: 'tenant-pilot-factory-01',
      productId: 'prod-tire-a',
      processId: 'proc-building',
      sequence: 3,
      workCenterId: 'wc-building',
      machineId: 'mc-tbm-01',
      standardCycleTimeSeconds: 150,
      active: true,
    },
    {
      id: 'rt-a-4',
      tenantId: 'tenant-pilot-factory-01',
      productId: 'prod-tire-a',
      processId: 'proc-curing',
      sequence: 4,
      workCenterId: 'wc-curing',
      machineId: 'mc-cpr-01',
      standardCycleTimeSeconds: 750,
      active: true,
    },
    {
      id: 'rt-a-5',
      tenantId: 'tenant-pilot-factory-01',
      productId: 'prod-tire-a',
      processId: 'proc-inspection',
      sequence: 5,
      workCenterId: 'wc-inspection',
      machineId: 'mc-ins-01',
      standardCycleTimeSeconds: 30,
      active: true,
    },

    {
      id: 'rt-b-1',
      tenantId: 'tenant-pilot-factory-01',
      productId: 'prod-tire-b',
      processId: 'proc-mixing',
      sequence: 1,
      workCenterId: 'wc-mixing',
      machineId: 'mc-mix-01',
      standardCycleTimeSeconds: 100,
      active: true,
    },
    {
      id: 'rt-b-2',
      tenantId: 'tenant-pilot-factory-01',
      productId: 'prod-tire-b',
      processId: 'proc-calendering',
      sequence: 2,
      workCenterId: 'wc-calendering',
      machineId: 'mc-cal-01',
      standardCycleTimeSeconds: 60,
      active: true,
    },
    {
      id: 'rt-b-3',
      tenantId: 'tenant-pilot-factory-01',
      productId: 'prod-tire-b',
      processId: 'proc-building',
      sequence: 3,
      workCenterId: 'wc-building',
      machineId: 'mc-tbm-01',
      standardCycleTimeSeconds: 180,
      active: true,
    },
    {
      id: 'rt-b-4',
      tenantId: 'tenant-pilot-factory-01',
      productId: 'prod-tire-b',
      processId: 'proc-curing',
      sequence: 4,
      workCenterId: 'wc-curing',
      machineId: 'mc-cpr-01',
      standardCycleTimeSeconds: 900,
      active: true,
    },
    {
      id: 'rt-b-5',
      tenantId: 'tenant-pilot-factory-01',
      productId: 'prod-tire-b',
      processId: 'proc-inspection',
      sequence: 5,
      workCenterId: 'wc-inspection',
      machineId: 'mc-ins-01',
      standardCycleTimeSeconds: 35,
      active: true,
    },

    {
      id: 'rt-c-1',
      tenantId: 'tenant-pilot-factory-01',
      productId: 'prod-tire-c',
      processId: 'proc-mixing',
      sequence: 1,
      workCenterId: 'wc-mixing',
      machineId: 'mc-mix-01',
      standardCycleTimeSeconds: 110,
      active: true,
    },
    {
      id: 'rt-c-2',
      tenantId: 'tenant-pilot-factory-01',
      productId: 'prod-tire-c',
      processId: 'proc-extrusion',
      sequence: 2,
      workCenterId: 'wc-extrusion',
      machineId: 'mc-ext-01',
      standardCycleTimeSeconds: 50,
      active: true,
    },
    {
      id: 'rt-c-3',
      tenantId: 'tenant-pilot-factory-01',
      productId: 'prod-tire-c',
      processId: 'proc-building',
      sequence: 3,
      workCenterId: 'wc-building',
      machineId: 'mc-tbm-02',
      standardCycleTimeSeconds: 210,
      active: true,
    },
    {
      id: 'rt-c-4',
      tenantId: 'tenant-pilot-factory-01',
      productId: 'prod-tire-c',
      processId: 'proc-curing',
      sequence: 4,
      workCenterId: 'wc-curing',
      machineId: 'mc-cpr-02',
      standardCycleTimeSeconds: 1050,
      active: true,
    },
    {
      id: 'rt-c-5',
      tenantId: 'tenant-pilot-factory-01',
      productId: 'prod-tire-c',
      processId: 'proc-inspection',
      sequence: 5,
      workCenterId: 'wc-inspection',
      machineId: 'mc-ins-01',
      standardCycleTimeSeconds: 40,
      active: true,
    },
  ]);

  private batches: ProductionBatch[] = demoRows<ProductionBatch>(() => [
    {
      id: 'batch-260829-01',
      tenantId: 'tenant-pilot-factory-01',
      batchNumber: 'B260829-01',
      productId: 'prod-tire-a',
      productionOrderId: 'po-260829-001',
      productionDate: new Date().toISOString().slice(0, 10),
      status: ProductionBatchStatus.ACTIVE,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'batch-260829-02',
      tenantId: 'tenant-pilot-factory-01',
      batchNumber: 'B260829-02',
      productId: 'prod-tire-b',
      productionOrderId: 'po-260829-002',
      productionDate: new Date().toISOString().slice(0, 10),
      status: ProductionBatchStatus.ACTIVE,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'batch-260829-03',
      tenantId: 'tenant-pilot-factory-01',
      batchNumber: 'B260829-03',
      productId: 'prod-tire-c',
      productionOrderId: 'po-260829-003',
      productionDate: new Date().toISOString().slice(0, 10),
      status: ProductionBatchStatus.ACTIVE,
      createdAt: new Date().toISOString(),
    },
    // A closed and a scrapped lot, so the attach-validation path in US-013 has
    // something real to reject.
    {
      id: 'batch-260828-09',
      tenantId: 'tenant-pilot-factory-01',
      batchNumber: 'B260828-09',
      productId: 'prod-tire-a',
      productionOrderId: 'po-260829-001',
      productionDate: '2026-08-28',
      status: ProductionBatchStatus.COMPLETED,
      createdAt: '2026-08-28T05:00:00.000Z',
    },
    {
      id: 'batch-260828-10',
      tenantId: 'tenant-pilot-factory-01',
      batchNumber: 'B260828-10',
      productId: 'prod-tire-c',
      productionOrderId: 'po-260829-003',
      productionDate: '2026-08-28',
      status: ProductionBatchStatus.SCRAPPED,
      createdAt: '2026-08-28T05:00:00.000Z',
    },
  ]);

  private operators: Operator[] = demoRows<Operator>(() => [
    {
      id: 'op-001',
      tenantId: 'tenant-pilot-factory-01',
      employeeNumber: 'OP-1001',
      name: 'Budi Santoso',
      defaultLineId: 'line-01',
      status: 'ACTIVE',
    },
    {
      id: 'op-002',
      tenantId: 'tenant-pilot-factory-01',
      employeeNumber: 'OP-1002',
      name: 'Siti Rahmawati',
      defaultLineId: 'line-01',
      status: 'ACTIVE',
    },
    {
      id: 'op-003',
      tenantId: 'tenant-pilot-factory-01',
      employeeNumber: 'OP-1003',
      name: 'Agus Prasetyo',
      defaultLineId: 'line-02',
      status: 'ACTIVE',
    },
    {
      id: 'op-004',
      tenantId: 'tenant-pilot-factory-01',
      employeeNumber: 'OP-1004',
      name: 'Dedi Kurniawan',
      defaultLineId: 'line-03',
      status: 'ACTIVE',
    },
    {
      id: 'op-005',
      tenantId: 'tenant-pilot-factory-01',
      employeeNumber: 'OP-1005',
      name: 'Rina Kartika',
      defaultLineId: 'line-03',
      status: 'INACTIVE',
    },
  ]);

  private shifts: Shift[] = demoRows<Shift>(() => [
    {
      id: 'shift-1',
      tenantId: 'tenant-pilot-factory-01',
      plantId: 'plant-cikarang-01',
      name: 'Shift 1 (Pagi)',
      startTime: '06:00',
      endTime: '14:00',
      breakMinutes: 60,
      crossesMidnight: false,
      active: true,
    },
    {
      id: 'shift-2',
      tenantId: 'tenant-pilot-factory-01',
      plantId: 'plant-cikarang-01',
      name: 'Shift 2 (Sore)',
      startTime: '14:00',
      endTime: '22:00',
      breakMinutes: 60,
      crossesMidnight: false,
      active: true,
    },
    {
      id: 'shift-3',
      tenantId: 'tenant-pilot-factory-01',
      plantId: 'plant-cikarang-01',
      name: 'Shift 3 (Malam)',
      startTime: '22:00',
      endTime: '06:00',
      breakMinutes: 60,
      crossesMidnight: true,
      active: true,
    },
  ]);

  private downtimeReasons: DowntimeReason[] = demoRows<DowntimeReason>(() => [
    {
      id: 'dt-breakdown',
      tenantId: 'tenant-pilot-factory-01',
      category: DowntimeCategory.MACHINE,
      code: 'MC-BRK',
      name: 'Kerusakan Mekanikal / Mesin Breakdown',
      description: 'Kerusakan komponen mesin hidrolik/motor',
      isPlanned: false,
      active: true,
      sortOrder: 1,
    },
    {
      id: 'dt-material',
      tenantId: 'tenant-pilot-factory-01',
      category: DowntimeCategory.MATERIAL,
      code: 'MAT-SHT',
      name: 'Kekurangan / Keterlambatan Pasokan Material',
      description: 'Karet kompon atau ply cord belum siap',
      isPlanned: false,
      active: true,
      sortOrder: 2,
    },
    {
      id: 'dt-setup',
      tenantId: 'tenant-pilot-factory-01',
      category: DowntimeCategory.PROCESS,
      code: 'PRC-STP',
      name: 'Setup & Changeover Mold / Cetakan',
      description: 'Penggantian ukuran mold cetakan ban',
      isPlanned: true,
      active: true,
      sortOrder: 3,
    },
    {
      id: 'dt-cleaning',
      tenantId: 'tenant-pilot-factory-01',
      category: DowntimeCategory.PROCESS,
      code: 'PRC-CLN',
      name: 'Pembersihan & Perawatan Harian (Cleaning)',
      description: 'Cleaning sisa karet dan pelumasan mold',
      isPlanned: true,
      active: true,
      sortOrder: 4,
    },
    {
      id: 'dt-qc-wait',
      tenantId: 'tenant-pilot-factory-01',
      category: DowntimeCategory.QUALITY,
      code: 'QLT-WQC',
      name: 'Menunggu Persetujuan / Inspeksi QC',
      description: 'Menunggu first piece inspection approval',
      isPlanned: false,
      active: true,
      sortOrder: 5,
    },
    {
      id: 'dt-operator',
      tenantId: 'tenant-pilot-factory-01',
      category: DowntimeCategory.PEOPLE,
      code: 'PPL-ABS',
      name: 'Operator Tidak Tersedia / Istirahat Bergilir',
      description: 'Kekurangan manpower di pos perakitan',
      isPlanned: false,
      active: true,
      sortOrder: 6,
    },
  ]);

  private rejectReasons: RejectReason[] = demoRows<RejectReason>(() => [
    {
      id: 'rej-dimension',
      tenantId: 'tenant-pilot-factory-01',
      category: RejectCategory.DIMENSION,
      code: 'DIM-OOS',
      name: 'Dimensi / Ketebalan Sidewall Di Luar Toleransi',
      description: 'Toleransi ketebalan dinding samping melebihi limit',
      active: true,
      sortOrder: 1,
    },
    {
      id: 'rej-blister',
      tenantId: 'tenant-pilot-factory-01',
      category: RejectCategory.APPEARANCE,
      code: 'APP-BLS',
      name: 'Blister / Gelembung Udara Terperangkap (Air Trap)',
      description: 'Udara terperangkap di bawah lapisan tapak/sidewall',
      active: true,
      sortOrder: 2,
    },
    {
      id: 'rej-scratch',
      tenantId: 'tenant-pilot-factory-01',
      category: RejectCategory.APPEARANCE,
      code: 'APP-SCR',
      name: 'Goresan / Cacat Permukaan Green Tire',
      description: 'Cacat gores saat transfer atau penyimpanan',
      active: true,
      sortOrder: 3,
    },
    {
      id: 'rej-flash',
      tenantId: 'tenant-pilot-factory-01',
      category: RejectCategory.MATERIAL,
      code: 'MAT-FLS',
      name: 'Excess Flash / Cacat Mold Overflow',
      description: 'Karet meluap pada garis cetakan curing press',
      active: true,
      sortOrder: 4,
    },
    {
      id: 'rej-distortion',
      tenantId: 'tenant-pilot-factory-01',
      category: RejectCategory.FUNCTION,
      code: 'FNC-DST',
      name: 'Tread Distortion / Keselarasan Tapak Miring',
      description: 'Tapak ban tidak simetris terhadap centerline',
      active: true,
      sortOrder: 5,
    },
    {
      id: 'rej-other',
      tenantId: 'tenant-pilot-factory-01',
      category: RejectCategory.OTHER,
      code: 'OTH-GEN',
      name: 'Cacat Kualitas Lainnya',
      description: 'Kondisi reject non-standar lainnya',
      active: true,
      sortOrder: 6,
    },
  ]);

  private kpiTargets: KpiTarget[] = demoRows<KpiTarget>(() => [
    {
      id: 'tgt-oee',
      tenantId: 'tenant-pilot-factory-01',
      metric: 'OEE',
      targetValue: 85.0,
      unit: '%',
      direction: 'HIGHER_IS_BETTER',
      watchThresholdPct: 95.0,
      criticalThresholdPct: 90.0,
    },
    {
      id: 'tgt-avail',
      tenantId: 'tenant-pilot-factory-01',
      metric: 'AVAILABILITY',
      targetValue: 90.0,
      unit: '%',
      direction: 'HIGHER_IS_BETTER',
      watchThresholdPct: 95.0,
      criticalThresholdPct: 90.0,
    },
    {
      id: 'tgt-perf',
      tenantId: 'tenant-pilot-factory-01',
      metric: 'PERFORMANCE',
      targetValue: 95.0,
      unit: '%',
      direction: 'HIGHER_IS_BETTER',
      watchThresholdPct: 95.0,
      criticalThresholdPct: 90.0,
    },
    {
      id: 'tgt-qual',
      tenantId: 'tenant-pilot-factory-01',
      metric: 'QUALITY',
      targetValue: 99.0,
      unit: '%',
      direction: 'HIGHER_IS_BETTER',
      watchThresholdPct: 98.0,
      criticalThresholdPct: 95.0,
    },
    {
      id: 'tgt-achv',
      tenantId: 'tenant-pilot-factory-01',
      metric: 'PRODUCTION_ACHIEVEMENT',
      targetValue: 100.0,
      unit: '%',
      direction: 'HIGHER_IS_BETTER',
      watchThresholdPct: 95.0,
      criticalThresholdPct: 90.0,
    },
    // Attainment is normalised so 100 always means "on target", for both
    // directions. The watch/critical thresholds are therefore read the same way
    // on a lower-is-better metric as on a higher-is-better one, setting them
    // above 100 here would have flagged a reject rate *under* target as
    // CRITICAL.
    {
      id: 'tgt-rej',
      tenantId: 'tenant-pilot-factory-01',
      metric: 'REJECT_RATE',
      targetValue: 1.5,
      unit: '%',
      direction: 'LOWER_IS_BETTER',
      watchThresholdPct: 95.0,
      criticalThresholdPct: 85.0,
    },
    // Plant-wide unplanned + planned stoppage minutes per production day,
    // across every machine that ran.
    {
      id: 'tgt-dt',
      tenantId: 'tenant-pilot-factory-01',
      metric: 'DOWNTIME',
      targetValue: 400.0,
      unit: 'MIN',
      direction: 'LOWER_IS_BETTER',
      watchThresholdPct: 95.0,
      criticalThresholdPct: 85.0,
    },
  ]);

  private users: AppUser[] = demoRows<AppUser>(() => [
    {
      id: 'usr-001',
      tenantId: 'tenant-pilot-factory-01',
      email: 'agung.wicaksono@factoryvision.local',
      name: 'Agung Wicaksono',
      role: UserRole.SUPERVISOR,
      accountType: 'APPLICATION_USER',
      scopeLevel: 'PLANT',
      scopeId: 'plant-cikarang-01',
      status: 'ACTIVE',
      lastLoginAt: new Date().toISOString(),
      createdAt: '2026-01-10T08:00:00.000Z',
    },
    {
      id: 'usr-002',
      tenantId: 'tenant-pilot-factory-01',
      email: 'bambang.ppic@factoryvision.local',
      name: 'Bambang Sudarsono',
      role: UserRole.PPIC,
      accountType: 'APPLICATION_USER',
      scopeLevel: 'TENANT',
      status: 'ACTIVE',
      lastLoginAt: new Date().toISOString(),
      createdAt: '2026-01-10T08:00:00.000Z',
    },
    {
      id: 'usr-003',
      tenantId: 'tenant-pilot-factory-01',
      email: 'hendra.manager@factoryvision.local',
      name: 'Hendra Gunawan',
      role: UserRole.PRODUCTION_MANAGER,
      accountType: 'APPLICATION_USER',
      scopeLevel: 'TENANT',
      status: 'ACTIVE',
      lastLoginAt: new Date().toISOString(),
      createdAt: '2026-01-05T08:00:00.000Z',
    },
    // The remaining system roles, so every ACL row in can actually
    // be demonstrated during the pilot rather than only described.
    {
      id: 'usr-004',
      tenantId: 'tenant-pilot-factory-01',
      email: 'rian.admin@factoryvision.local',
      name: 'Rian Pratama',
      role: UserRole.ADMIN,
      accountType: 'APPLICATION_USER',
      scopeLevel: 'TENANT',
      status: 'ACTIVE',
      createdAt: '2026-01-02T08:00:00.000Z',
    },
    {
      id: 'usr-005',
      tenantId: 'tenant-pilot-factory-01',
      email: 'dharmawan.gm@factoryvision.local',
      name: 'Dharmawan Wijaya',
      role: UserRole.EXECUTIVE,
      accountType: 'APPLICATION_USER',
      scopeLevel: 'TENANT',
      status: 'ACTIVE',
      createdAt: '2026-01-02T08:00:00.000Z',
    },
    {
      id: 'usr-006',
      tenantId: 'tenant-pilot-factory-01',
      email: 'maya.qc@factoryvision.local',
      name: 'Maya Puspita',
      role: UserRole.QUALITY,
      accountType: 'APPLICATION_USER',
      scopeLevel: 'PLANT',
      scopeId: 'plant-cikarang-01',
      status: 'ACTIVE',
      createdAt: '2026-01-08T08:00:00.000Z',
    },
    {
      // Order Receiving is Sales' decision (Improvement PRD §5, §8.1), so the
      // pilot needs an account that can actually demonstrate the boundary:
      // full on Customer Order, nothing on Planning or the shop floor.
      id: 'usr-007',
      tenantId: 'tenant-pilot-factory-01',
      email: 'sinta.sales@factoryvision.local',
      name: 'Sinta Rahmawati',
      role: UserRole.SALES,
      accountType: 'APPLICATION_USER',
      scopeLevel: 'TENANT',
      status: 'ACTIVE',
      createdAt: '2026-01-08T08:00:00.000Z',
    },
  ]);

  private devices: DeviceTerminal[] = demoRows<DeviceTerminal>(() => [
    {
      id: 'dev-001',
      tenantId: 'tenant-pilot-factory-01',
      deviceCode: 'TAB-ALPHA-TBM',
      name: 'Tablet Terminal TBM Alpha 01',
      assignedLineId: 'line-01',
      assignedWorkCenterId: 'wc-building',
      status: 'ONLINE',
      ipAddress: '192.168.10.21',
      lastHeartbeatAt: new Date().toISOString(),
      registeredAt: '2026-02-01T08:00:00.000Z',
    },
    {
      id: 'dev-002',
      tenantId: 'tenant-pilot-factory-01',
      deviceCode: 'TAB-ALPHA-CPR',
      name: 'Tablet Terminal Curing Press 01',
      assignedLineId: 'line-01',
      assignedWorkCenterId: 'wc-curing',
      status: 'ONLINE',
      ipAddress: '192.168.10.22',
      lastHeartbeatAt: new Date().toISOString(),
      registeredAt: '2026-02-01T08:00:00.000Z',
    },
  ]);

  // Queries
  getPlants(tenantId: string): Plant[] {
    return this.plants.filter((p) => p.tenantId === tenantId);
  }

  getLines(tenantId: string): ProductionLine[] {
    return this.lines.filter((l) => l.tenantId === tenantId);
  }

  getWorkCenters(tenantId: string): WorkCenter[] {
    return this.workCenters.filter((wc) => wc.tenantId === tenantId);
  }

  getProcesses(tenantId: string): ProductionProcess[] {
    return this.processes
      .filter((p) => p.tenantId === tenantId)
      .sort((a, b) => a.sequenceDefault - b.sequenceDefault);
  }

  getMachines(tenantId: string): Machine[] {
    return this.machines.filter((m) => m.tenantId === tenantId);
  }

  getProducts(tenantId: string): Product[] {
    return this.products.filter((p) => p.tenantId === tenantId);
  }

  getProductRoutings(tenantId: string, productId?: string): ProductRouting[] {
    return this.productRoutings
      .filter((r) => r.tenantId === tenantId && (!productId || r.productId === productId))
      .sort((a, b) => a.sequence - b.sequence);
  }

  getProductMachineRates(tenantId: string, productId?: string, machineId?: string): ProductMachineRate[] {
    return this.productMachineRates.filter(
      (r) =>
        r.tenantId === tenantId &&
        (!productId || r.productId === productId) &&
        (!machineId || r.machineId === machineId)
    );
  }

  getBatches(tenantId: string, productId?: string, status?: string): ProductionBatch[] {
    return this.batches.filter(
      (b) =>
        b.tenantId === tenantId && (!productId || b.productId === productId) && (!status || b.status === status)
    );
  }

  getOperators(tenantId: string): Operator[] {
    return this.operators.filter((o) => o.tenantId === tenantId);
  }

  getShifts(tenantId: string): Shift[] {
    return this.shifts.filter((s) => s.tenantId === tenantId);
  }

  getDowntimeReasons(tenantId: string): DowntimeReason[] {
    return this.downtimeReasons
      .filter((d) => d.tenantId === tenantId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  getRejectReasons(tenantId: string): RejectReason[] {
    return this.rejectReasons.filter((r) => r.tenantId === tenantId).sort((a, b) => a.sortOrder - b.sortOrder);
  }

  getUsers(tenantId: string): AppUser[] {
    return this.users.filter((u) => u.tenantId === tenantId);
  }

  getDevices(tenantId: string): DeviceTerminal[] {
    return this.devices.filter((d) => d.tenantId === tenantId);
  }

  getKpiTargets(tenantId: string): KpiTarget[] {
    return this.kpiTargets.filter((t) => t.tenantId === tenantId);
  }

  getKpiTarget(tenantId: string, metric: KpiMetric | string): KpiTarget | undefined {
    return this.kpiTargets.find((t) => t.tenantId === tenantId && t.metric === metric);
  }

  // --- CRUD Operations ---
  // Processes
  getProcessById(tenantId: string, id: string): ProductionProcess | undefined {
    return this.processes.find((p) => p.id === id && p.tenantId === tenantId);
  }

  createProcess(
    tenantId: string,
    payload: Omit<ProductionProcess, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>
  ): ProductionProcess {
    const process: ProductionProcess = {
      id: `proc-${Date.now()}`,
      tenantId,
      ...payload,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.processes.push(process);
    this.persist(tenantId, (repo, exec) => repo.upsertProcess(exec, process));
    return process;
  }

  updateProcess(
    tenantId: string,
    id: string,
    payload: Partial<Omit<ProductionProcess, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>>
  ): ProductionProcess {
    const process = this.getProcessById(tenantId, id);
    if (!process) throw new Error('Production process not found');
    Object.assign(process, payload, { updatedAt: new Date().toISOString() });
    this.persist(tenantId, (repo, exec) => repo.upsertProcess(exec, process));
    return process;
  }

  deleteProcess(tenantId: string, id: string): boolean {
    const index = this.processes.findIndex((p) => p.id === id && p.tenantId === tenantId);
    if (index === -1) throw new Error('Production process not found');
    this.processes.splice(index, 1);
    this.persist(tenantId, (repo, exec) => repo.remove(exec, 'production_process', tenantId, id));
    return true;
  }

  // Routings
  getRoutingById(tenantId: string, id: string): ProductRouting | undefined {
    return this.productRoutings.find((r) => r.id === id && r.tenantId === tenantId);
  }

  createRouting(tenantId: string, payload: Omit<ProductRouting, 'id' | 'tenantId'>): ProductRouting {
    const routing: ProductRouting = {
      id: `rt-${Date.now()}`,
      tenantId,
      ...payload,
    };
    this.productRoutings.push(routing);
    this.persist(tenantId, (repo, exec) => repo.upsertRouting(exec, routing));
    return routing;
  }

  updateRouting(
    tenantId: string,
    id: string,
    payload: Partial<Omit<ProductRouting, 'id' | 'tenantId'>>
  ): ProductRouting {
    const routing = this.getRoutingById(tenantId, id);
    if (!routing) throw new Error('Product routing not found');
    Object.assign(routing, payload);
    this.persist(tenantId, (repo, exec) => repo.upsertRouting(exec, routing));
    return routing;
  }

  deleteRouting(tenantId: string, id: string): boolean {
    const index = this.productRoutings.findIndex((r) => r.id === id && r.tenantId === tenantId);
    if (index === -1) throw new Error('Product routing not found');
    this.productRoutings.splice(index, 1);
    this.persist(tenantId, (repo, exec) => repo.remove(exec, 'product_routing', tenantId, id));
    return true;
  }

  // Product Machine Rates
  upsertProductMachineRate(
    tenantId: string,
    payload: Omit<ProductMachineRate, 'id' | 'tenantId'>
  ): ProductMachineRate {
    const existing = this.productMachineRates.find(
      (r) => r.tenantId === tenantId && r.productId === payload.productId && r.machineId === payload.machineId
    );
    if (existing) {
      existing.idealCycleTimeSeconds = payload.idealCycleTimeSeconds;
      return existing;
    }
    const rate: ProductMachineRate = {
      id: `pmr-${Date.now()}`,
      tenantId,
      ...payload,
    };
    this.productMachineRates.push(rate);
    this.persist(tenantId, (repo, exec) => repo.upsertRate(exec, rate));
    return rate;
  }

  deleteProductMachineRate(tenantId: string, id: string): boolean {
    const index = this.productMachineRates.findIndex((r) => r.id === id && r.tenantId === tenantId);
    if (index === -1) throw new Error('Product machine rate not found');
    this.productMachineRates.splice(index, 1);
    this.persist(tenantId, (repo, exec) => repo.remove(exec, 'product_machine_rate', tenantId, id));
    return true;
  }

  // Batches
  getBatchById(tenantId: string, id: string): ProductionBatch | undefined {
    return this.batches.find((b) => b.id === id && b.tenantId === tenantId);
  }

  createBatch(
    tenantId: string,
    payload: Omit<ProductionBatch, 'id' | 'tenantId' | 'createdAt'>
  ): ProductionBatch {
    const batch: ProductionBatch = {
      id: `batch-${Date.now()}`,
      tenantId,
      ...payload,
      createdAt: new Date().toISOString(),
    };
    this.batches.push(batch);
    return batch;
  }

  updateBatch(
    tenantId: string,
    id: string,
    payload: Partial<Omit<ProductionBatch, 'id' | 'tenantId' | 'createdAt'>>
  ): ProductionBatch {
    const batch = this.getBatchById(tenantId, id);
    if (!batch) throw new Error('Production batch not found');
    Object.assign(batch, payload);
    return batch;
  }

  // Lines
  getLineById(tenantId: string, id: string): ProductionLine | undefined {
    return this.lines.find((l) => l.id === id && l.tenantId === tenantId);
  }

  createLine(tenantId: string, payload: Omit<ProductionLine, 'id' | 'tenantId'>): ProductionLine {
    const line: ProductionLine = {
      id: `line-${Date.now()}`,
      tenantId,
      ...payload,
    };
    this.lines.push(line);
    this.persist(tenantId, (repo, exec) => repo.upsertLine(exec, line));
    return line;
  }

  updateLine(
    tenantId: string,
    id: string,
    payload: Partial<Omit<ProductionLine, 'id' | 'tenantId'>>
  ): ProductionLine {
    const line = this.getLineById(tenantId, id);
    if (!line) throw new Error('Line not found');
    Object.assign(line, payload);
    this.persist(tenantId, (repo, exec) => repo.upsertLine(exec, line));
    return line;
  }

  deleteLine(tenantId: string, id: string): boolean {
    const index = this.lines.findIndex((l) => l.id === id && l.tenantId === tenantId);
    if (index === -1) throw new Error('Line not found');
    this.lines.splice(index, 1);
    this.persist(tenantId, (repo, exec) => repo.remove(exec, 'production_line', tenantId, id));
    return true;
  }

  // Machines
  getMachineById(tenantId: string, id: string): Machine | undefined {
    return this.machines.find((m) => m.id === id && m.tenantId === tenantId);
  }

  createMachine(
    tenantId: string,
    payload: Omit<Machine, 'id' | 'tenantId' | 'currentState' | 'currentStateSince'>
  ): Machine {
    const machine: Machine = {
      id: `mc-${Date.now()}`,
      tenantId,
      ...payload,
      currentState: MachineState.IDLE,
      currentStateSince: new Date().toISOString(),
    };
    this.machines.push(machine);
    this.persist(tenantId, (repo, exec) => repo.upsertMachine(exec, machine));
    return machine;
  }

  updateMachine(tenantId: string, id: string, payload: Partial<Omit<Machine, 'id' | 'tenantId'>>): Machine {
    const machine = this.getMachineById(tenantId, id);
    if (!machine) throw new Error('Machine not found');
    Object.assign(machine, payload);
    this.persist(tenantId, (repo, exec) => repo.upsertMachine(exec, machine));
    return machine;
  }

  deleteMachine(tenantId: string, id: string): boolean {
    const index = this.machines.findIndex((m) => m.id === id && m.tenantId === tenantId);
    if (index === -1) throw new Error('Machine not found');
    this.machines.splice(index, 1);
    this.persist(tenantId, (repo, exec) => repo.remove(exec, 'machine', tenantId, id));
    return true;
  }

  // Products
  getProductById(tenantId: string, id: string): Product | undefined {
    return this.products.find((p) => p.id === id && p.tenantId === tenantId);
  }

  createProduct(tenantId: string, payload: Omit<Product, 'id' | 'tenantId'>): Product {
    const product: Product = {
      id: `prod-${Date.now()}`,
      tenantId,
      ...payload,
    };
    this.products.push(product);
    this.persist(tenantId, (repo, exec) => repo.upsertProduct(exec, product));
    return product;
  }

  updateProduct(tenantId: string, id: string, payload: Partial<Omit<Product, 'id' | 'tenantId'>>): Product {
    const product = this.getProductById(tenantId, id);
    if (!product) throw new Error('Product not found');
    Object.assign(product, payload);
    this.persist(tenantId, (repo, exec) => repo.upsertProduct(exec, product));
    return product;
  }

  deleteProduct(tenantId: string, id: string): boolean {
    const index = this.products.findIndex((p) => p.id === id && p.tenantId === tenantId);
    if (index === -1) throw new Error('Product not found');
    this.products.splice(index, 1);
    this.persist(tenantId, (repo, exec) => repo.remove(exec, 'product', tenantId, id));
    return true;
  }

  // Operators
  getOperatorById(tenantId: string, id: string): Operator | undefined {
    return this.operators.find((o) => o.id === id && o.tenantId === tenantId);
  }

  async createOperator(tenantId: string, payload: Omit<Operator, 'id' | 'tenantId'>): Promise<Operator> {
    const operator: Operator = { id: `op-${Date.now()}`, tenantId, ...payload };
    const stored = await withTenant(tenantId, (c) => this.operatorRepo.upsert(c, operator));
    this.operators.push(stored);
    return stored;
  }

  async updateOperator(
    tenantId: string,
    id: string,
    payload: Partial<Omit<Operator, 'id' | 'tenantId'>>
  ): Promise<Operator> {
    const operator = this.getOperatorById(tenantId, id);
    if (!operator) throw new Error('Operator not found');
    const stored = await withTenant(tenantId, (c) =>
      this.operatorRepo.upsert(c, { ...operator, ...payload })
    );
    Object.assign(operator, stored);
    return operator;
  }

  async deleteOperator(tenantId: string, id: string): Promise<boolean> {
    const index = this.operators.findIndex((o) => o.id === id && o.tenantId === tenantId);
    if (index === -1) throw new Error('Operator not found');
    await withTenant(tenantId, (c) => this.operatorRepo.delete(c, tenantId, id));
    this.operators.splice(index, 1);
    return true;
  }

  /** Stores an operator's PIN hash, which is the shop floor's only credential. */
  async saveOperatorPin(
    tenantId: string,
    operatorId: string,
    pinHash: string,
    updatedBy?: string
  ): Promise<void> {
    await withTenant(tenantId, (c) =>
      this.operatorRepo.setPin(c, tenantId, operatorId, pinHash, updatedBy)
    );
    const operator = this.getOperatorById(tenantId, operatorId);
    if (operator) operator.pinHash = pinHash;
  }

  // Downtime Reasons
  getDowntimeReasonById(tenantId: string, id: string): DowntimeReason | undefined {
    return this.downtimeReasons.find((r) => r.id === id && r.tenantId === tenantId);
  }

  createDowntimeReason(tenantId: string, payload: Omit<DowntimeReason, 'id' | 'tenantId'>): DowntimeReason {
    const reason: DowntimeReason = {
      id: `dt-${Date.now()}`,
      tenantId,
      ...payload,
    };
    this.downtimeReasons.push(reason);
    this.persist(tenantId, (repo, exec) => repo.upsertDowntimeReason(exec, reason));
    return reason;
  }

  updateDowntimeReason(
    tenantId: string,
    id: string,
    payload: Partial<Omit<DowntimeReason, 'id' | 'tenantId'>>
  ): DowntimeReason {
    const reason = this.getDowntimeReasonById(tenantId, id);
    if (!reason) throw new Error('Downtime reason not found');
    this.persist(tenantId, (repo, exec) => repo.upsertDowntimeReason(exec, reason));
    return reason;
  }

  deleteDowntimeReason(tenantId: string, id: string): boolean {
    const index = this.downtimeReasons.findIndex((r) => r.id === id && r.tenantId === tenantId);
    if (index === -1) throw new Error('Downtime reason not found');
    this.downtimeReasons.splice(index, 1);
    this.persist(tenantId, (repo, exec) => repo.remove(exec, 'downtime_reason', tenantId, id));
    return true;
  }

  // Reject Reasons
  getRejectReasonById(tenantId: string, id: string): RejectReason | undefined {
    return this.rejectReasons.find((r) => r.id === id && r.tenantId === tenantId);
  }

  createRejectReason(tenantId: string, payload: Omit<RejectReason, 'id' | 'tenantId'>): RejectReason {
    const reason: RejectReason = {
      id: `rej-${Date.now()}`,
      tenantId,
      ...payload,
    };
    this.rejectReasons.push(reason);
    this.persist(tenantId, (repo, exec) => repo.upsertRejectReason(exec, reason));
    return reason;
  }

  updateRejectReason(
    tenantId: string,
    id: string,
    payload: Partial<Omit<RejectReason, 'id' | 'tenantId'>>
  ): RejectReason {
    const reason = this.getRejectReasonById(tenantId, id);
    if (!reason) throw new Error('Reject reason not found');
    this.persist(tenantId, (repo, exec) => repo.upsertRejectReason(exec, reason));
    return reason;
  }

  deleteRejectReason(tenantId: string, id: string): boolean {
    const index = this.rejectReasons.findIndex((r) => r.id === id && r.tenantId === tenantId);
    if (index === -1) throw new Error('Reject reason not found');
    this.rejectReasons.splice(index, 1);
    this.persist(tenantId, (repo, exec) => repo.remove(exec, 'reject_reason', tenantId, id));
    return true;
  }

  // Users
  async createUser(
    tenantId: string,
    payload: Omit<AppUser, 'id' | 'tenantId' | 'createdAt'>
  ): Promise<AppUser> {
    const user: AppUser = {
      id: `usr-${Date.now()}`,
      tenantId,
      ...payload,
      createdAt: new Date().toISOString(),
    };
    const stored = await withTenant(tenantId, (c) => this.userRepo.upsert(c, user));
    this.users.push(stored.user);
    return stored.user;
  }

  getUserById(tenantId: string, userId: string): AppUser | undefined {
    return this.users.find((u) => u.id === userId && u.tenantId === tenantId);
  }

  async updateUser(
    tenantId: string,
    userId: string,
    payload: Partial<Omit<AppUser, 'id' | 'tenantId' | 'createdAt'>>
  ): Promise<AppUser> {
    const user = this.getUserById(tenantId, userId);
    if (!user) throw new Error('User not found');

    const next: AppUser = { ...user };
    if (payload.name !== undefined) next.name = payload.name;
    if (payload.email !== undefined) next.email = payload.email;
    if (payload.role !== undefined) next.role = payload.role;
    if (payload.accountType !== undefined) next.accountType = payload.accountType;
    if (payload.scopeLevel !== undefined) next.scopeLevel = payload.scopeLevel;
    if (payload.scopeId !== undefined) next.scopeId = payload.scopeId;
    if (payload.status !== undefined) next.status = payload.status;

    const stored = await withTenant(tenantId, (c) => this.userRepo.upsert(c, next));
    Object.assign(user, stored.user);
    return user;
  }

  async deleteUser(tenantId: string, userId: string): Promise<boolean> {
    const index = this.users.findIndex((u) => u.id === userId && u.tenantId === tenantId);
    if (index === -1) throw new Error('User not found');
    await withTenant(tenantId, (c) => this.userRepo.delete(c, tenantId, userId));
    this.users.splice(index, 1);
    this.userPasswordHashes.delete(userId);
    return true;
  }

  async updateUserStatus(
    tenantId: string,
    userId: string,
    status: AppUser['status']
  ): Promise<AppUser> {
    return this.updateUser(tenantId, userId, { status });
  }

  // --- credentials and hydration ---------------------------------------------

  /** The stored password hash for a user, as loaded from `app_user`. */
  getUserPasswordHash(userId: string): string | undefined {
    return this.userPasswordHashes.get(userId);
  }

  async saveUserPassword(tenantId: string, userId: string, hash: string): Promise<void> {
    await withTenant(tenantId, (c) => this.userRepo.setPassword(c, tenantId, userId, hash));
    this.userPasswordHashes.set(userId, hash);
  }

  async touchUserLogin(tenantId: string, userId: string, at: string): Promise<void> {
    await withTenant(tenantId, (c) => this.userRepo.touchLogin(c, tenantId, userId, at));
    const user = this.getUserById(tenantId, userId);
    if (user) user.lastLoginAt = at;
  }

  /**
   * Rebuilds the shift, operator and user caches from PostgreSQL.
   *
   * On a first run the tables are empty and whatever the demo seed put in
   * memory is pushed down instead, so a demo install converges to the same
   * place a real one starts from: the database holding the record.
   */

  /**
   * Writes one reference row through to PostgreSQL.
   *
   * The mutators stay synchronous because the read model is in memory and the
   * shop floor reads it on the hot path; the durable write happens behind them.
   * A failure is logged loudly rather than swallowed — losing a Product the
   * administrator believes they created is exactly the defect this closes, and
   * a silent catch would recreate it in a new form.
   */
  private persist(tenantId: string, write: (repo: MasterReferenceRepository, exec: Executor) => Promise<void>): void {
    withTenant(tenantId, (client) => write(this.referenceRepo, client)).catch((error) => {
      // eslint-disable-next-line no-console
      console.error(
        '[master-data] gagal menyimpan reference data ke PostgreSQL:',
        error instanceof Error ? error.message : error
      );
    });
  }

  /**
   * Rebuilds the reference caches from PostgreSQL.
   *
   * Only replaces a cache when the database actually holds rows for the tenant:
   * a fresh install boots with the demo defaults in memory and writes them down
   * on first use, exactly as shifts and operators already do.
   */
  private async hydrateReference(exec: Executor, tenantId: string): Promise<number> {
    let loaded = 0;
    const swap = <T extends { tenantId: string }>(current: T[], stored: T[]): T[] => {
      if (stored.length === 0) return current;
      loaded += stored.length;
      return current.filter((row) => row.tenantId !== tenantId).concat(stored);
    };

    this.plants = swap(this.plants, await this.referenceRepo.listPlants(exec, tenantId));
    this.lines = swap(this.lines, await this.referenceRepo.listLines(exec, tenantId));
    this.workCenters = swap(this.workCenters, await this.referenceRepo.listWorkCenters(exec, tenantId));
    this.machines = swap(this.machines, await this.referenceRepo.listMachines(exec, tenantId));
    this.products = swap(this.products, await this.referenceRepo.listProducts(exec, tenantId));
    this.processes = swap(this.processes, await this.referenceRepo.listProcesses(exec, tenantId));
    this.productRoutings = swap(this.productRoutings, await this.referenceRepo.listRoutings(exec, tenantId));
    this.productMachineRates = swap(
      this.productMachineRates,
      await this.referenceRepo.listRates(exec, tenantId)
    );
    this.downtimeReasons = swap(
      this.downtimeReasons,
      await this.referenceRepo.listDowntimeReasons(exec, tenantId)
    );
    this.rejectReasons = swap(
      this.rejectReasons,
      await this.referenceRepo.listRejectReasons(exec, tenantId)
    );
    return loaded;
  }

  async hydrate(tenantId: string): Promise<{ shifts: number; operators: number; users: number }> {
    return withTenant(tenantId, async (client) => {
      // Plants, lines, machines, products, processes, routings and reason codes
      // were written to the database and never read back, so every restart
      // erased whatever an administrator had created. They are a projection now.
      await this.hydrateReference(client, tenantId);

      const storedShifts = await this.shiftRepo.list(client, tenantId);
      if (storedShifts.length === 0) {
        for (const shift of this.shifts.filter((s) => s.tenantId === tenantId)) {
          await this.shiftRepo.upsert(client, shift);
        }
      } else {
        this.shifts = this.shifts.filter((s) => s.tenantId !== tenantId).concat(storedShifts);
      }

      const storedOperators = await this.operatorRepo.list(client, tenantId);
      if (storedOperators.length === 0) {
        for (const operator of this.operators.filter((o) => o.tenantId === tenantId)) {
          await this.operatorRepo.upsert(client, operator);
        }
      } else {
        this.operators = this.operators
          .filter((o) => o.tenantId !== tenantId)
          .concat(storedOperators);
      }

      const storedUsers = await this.userRepo.list(client, tenantId);
      if (storedUsers.length === 0) {
        for (const user of this.users.filter((u) => u.tenantId === tenantId)) {
          await this.userRepo.upsert(client, user, this.userPasswordHashes.get(user.id));
        }
      } else {
        this.users = this.users
          .filter((u) => u.tenantId !== tenantId)
          .concat(storedUsers.map((s) => s.user));
        for (const stored of storedUsers) {
          if (stored.passwordHash) this.userPasswordHashes.set(stored.user.id, stored.passwordHash);
        }
      }

      return {
        shifts: this.shifts.filter((s) => s.tenantId === tenantId).length,
        operators: this.operators.filter((o) => o.tenantId === tenantId).length,
        users: this.users.filter((u) => u.tenantId === tenantId).length,
      };
    });
  }

  /** Writes a user straight through, for the bootstrap administrator. */
  async persistUser(tenantId: string, user: AppUser, passwordHash?: string): Promise<void> {
    await withTenant(tenantId, (c) => this.userRepo.upsert(c, user, passwordHash));
    if (passwordHash) this.userPasswordHashes.set(user.id, passwordHash);
  }

  // Devices
  getDeviceById(tenantId: string, id: string): DeviceTerminal | undefined {
    return this.devices.find((d) => d.id === id && d.tenantId === tenantId);
  }

  createDevice(
    tenantId: string,
    payload: Omit<DeviceTerminal, 'id' | 'tenantId' | 'registeredAt'>
  ): DeviceTerminal {
    const device: DeviceTerminal = {
      id: `dev-${Date.now()}`,
      tenantId,
      ...payload,
      registeredAt: new Date().toISOString(),
    };
    this.devices.push(device);
    return device;
  }

  updateDevice(
    tenantId: string,
    id: string,
    payload: Partial<Omit<DeviceTerminal, 'id' | 'tenantId'>>
  ): DeviceTerminal {
    const device = this.getDeviceById(tenantId, id);
    if (!device) throw new Error('Device not found');
    Object.assign(device, payload);
    return device;
  }

  deleteDevice(tenantId: string, id: string): boolean {
    const index = this.devices.findIndex((d) => d.id === id && d.tenantId === tenantId);
    if (index === -1) throw new Error('Device not found');
    this.devices.splice(index, 1);
    return true;
  }

  // KPI Targets
  upsertKpiTarget(
    tenantId: string,
    metric: KpiMetric,
    payload: Partial<Omit<KpiTarget, 'id' | 'tenantId' | 'metric'>>
  ): KpiTarget {
    const target = this.kpiTargets.find((t) => t.tenantId === tenantId && t.metric === metric);
    if (target) {
      Object.assign(target, payload);
      return target;
    }
    const newTarget: KpiTarget = {
      id: `tgt-${Date.now()}`,
      tenantId,
      metric,
      targetValue: payload.targetValue ?? 85,
      unit: payload.unit ?? '%',
      direction: payload.direction ?? 'HIGHER_IS_BETTER',
      watchThresholdPct: payload.watchThresholdPct ?? 95,
      criticalThresholdPct: payload.criticalThresholdPct ?? 90,
    };
    this.kpiTargets.push(newTarget);
    return newTarget;
  }

  // --- Shifts (, US-021) ---

  getShiftById(tenantId: string, id: string): Shift | undefined {
    return this.shifts.find((s) => s.id === id && s.tenantId === tenantId);
  }

  /**
   * A shift that ends at or before it starts runs through midnight. The flag is
   * derived rather than trusted from the client, because `shift_date` accounting
   * depends on it being right.
   */
  private static crossesMidnight(startTime: string, endTime: string): boolean {
    return endTime <= startTime;
  }

  async createShift(
    tenantId: string,
    payload: Omit<Shift, 'id' | 'tenantId' | 'crossesMidnight'>
  ): Promise<Shift> {
    const shift: Shift = {
      id: `shift-${Date.now()}`,
      tenantId,
      ...payload,
      crossesMidnight: MasterDataService.crossesMidnight(payload.startTime, payload.endTime),
    };
    // The database first: if the write fails the caller gets an error rather
    // than a shift that exists until the next restart.
    const stored = await withTenant(tenantId, (c) => this.shiftRepo.upsert(c, shift));
    this.shifts.push(stored);
    return stored;
  }

  async updateShift(
    tenantId: string,
    id: string,
    payload: Partial<Omit<Shift, 'id' | 'tenantId'>>
  ): Promise<Shift> {
    const shift = this.getShiftById(tenantId, id);
    if (!shift) throw new Error('Shift not found');
    const next: Shift = { ...shift, ...payload };
    next.crossesMidnight = MasterDataService.crossesMidnight(next.startTime, next.endTime);
    const stored = await withTenant(tenantId, (c) => this.shiftRepo.upsert(c, next));
    Object.assign(shift, stored);
    return shift;
  }

  async deleteShift(tenantId: string, id: string): Promise<boolean> {
    const index = this.shifts.findIndex((s) => s.id === id && s.tenantId === tenantId);
    if (index === -1) throw new Error('Shift not found');
    await withTenant(tenantId, (c) => this.shiftRepo.delete(c, tenantId, id));
    this.shifts.splice(index, 1);
    return true;
  }

  // --- Work Centers (, US-007) ---

  getWorkCenterById(tenantId: string, id: string): WorkCenter | undefined {
    return this.workCenters.find((w) => w.id === id && w.tenantId === tenantId);
  }

  createWorkCenter(tenantId: string, payload: Omit<WorkCenter, 'id' | 'tenantId'>): WorkCenter {
    const workCenter: WorkCenter = { id: `wc-${Date.now()}`, tenantId, ...payload };
    this.workCenters.push(workCenter);
    this.persist(tenantId, (repo, exec) => repo.upsertWorkCenter(exec, workCenter));
    return workCenter;
  }

  updateWorkCenter(
    tenantId: string,
    id: string,
    payload: Partial<Omit<WorkCenter, 'id' | 'tenantId'>>
  ): WorkCenter {
    const workCenter = this.getWorkCenterById(tenantId, id);
    if (!workCenter) throw new Error('Work center not found');
    Object.assign(workCenter, payload);
    return workCenter;
  }

  deleteWorkCenter(tenantId: string, id: string): boolean {
    const index = this.workCenters.findIndex((w) => w.id === id && w.tenantId === tenantId);
    if (index === -1) throw new Error('Work center not found');
    if (this.machines.some((m) => m.tenantId === tenantId && m.workCenterId === id)) {
      throw new Error('Cannot delete a work center that still has machines assigned');
    }
    this.workCenters.splice(index, 1);
    return true;
  }

  // --- Lookups shared by analytics, reporting and CSV import ---

  /** The production line a machine sits on, resolved through its work center. */
  getLineIdForMachine(tenantId: string, machineId: string): string | undefined {
    const machine = this.getMachineById(tenantId, machineId);
    if (!machine) return undefined;
    return this.getWorkCenterById(tenantId, machine.workCenterId)?.productionLineId;
  }

  /**
   * Ideal Cycle Time for a Product × Machine pair (, US-049).
   *
   * Returns `undefined` when no rate is configured. Callers must surface that
   * rather than substituting a default, a guessed cycle time silently
   * invents a Performance number the factory cannot reproduce.
   */
  resolveIdealCycleSeconds(
    tenantId: string,
    productId: string | undefined,
    machineId: string | undefined,
    source: 'PRODUCT_MACHINE' | 'ROUTING' | 'PRODUCT' = 'PRODUCT_MACHINE'
  ): number | undefined {
    if (source === 'PRODUCT_MACHINE' && productId && machineId) {
      const rate = this.productMachineRates.find(
        (r) => r.tenantId === tenantId && r.productId === productId && r.machineId === machineId
      );
      if (rate) return rate.idealCycleTimeSeconds;
    }

    if (source !== 'PRODUCT' && productId) {
      const routing = this.productRoutings.find(
        (r) =>
          r.tenantId === tenantId &&
          r.productId === productId &&
          r.active &&
          (!machineId || r.machineId === machineId)
      );
      if (routing?.standardCycleTimeSeconds) return routing.standardCycleTimeSeconds;
    }

    if (productId) {
      const product = this.getProductById(tenantId, productId);
      if (product?.idealCycleTimeSeconds) return product.idealCycleTimeSeconds;
    }

    return undefined;
  }
}
