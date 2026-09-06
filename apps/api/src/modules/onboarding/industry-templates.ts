import {
  DowntimeCategory,
  MachineState,
  RejectCategory,
  type DowntimeReason,
  type IndustryTemplateInfo,
  type IndustryType,
  type Machine,
  type Product,
  type ProductionLine,
  type ProductionProcess,
  type RejectReason,
  type Shift,
  type WorkCenter,
} from '@factory-vision/domain-types';

export interface RawTemplateData {
  info: IndustryTemplateInfo;
  defaultPlantName: string;
  lines: Array<Omit<ProductionLine, 'id' | 'tenantId' | 'plantId'>>;
  workCenters: Array<Omit<WorkCenter, 'id' | 'tenantId' | 'productionLineId'> & { lineIndex: number }>;
  processes: Array<Omit<ProductionProcess, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>>;
  machines: Array<Omit<Machine, 'id' | 'tenantId' | 'workCenterId'> & { workCenterIndex: number }>;
  products: Array<Omit<Product, 'id' | 'tenantId'>>;
  routings: Array<{
    productIndex: number;
    processIndex: number;
    workCenterIndex: number;
    machineIndex: number;
    sequence: number;
    standardCycleTimeSeconds: number;
  }>;
  shifts: Array<Omit<Shift, 'id' | 'tenantId' | 'plantId'>>;
  downtimeReasons: Array<Omit<DowntimeReason, 'id' | 'tenantId'>>;
  rejectReasons: Array<Omit<RejectReason, 'id' | 'tenantId'>>;
  sampleOrder: {
    productIndex: number;
    quantity: number;
    orderNumberPrefix: string;
    goodQty: number;
    rejectQty: number;
  };
}

export const INDUSTRY_TEMPLATES: Record<IndustryType, RawTemplateData> = {
  // 1. AUTOMOTIVE
  automotive: {
    info: {
      id: 'template-automotive-v1',
      name: 'Automotive Components Manufacturing',
      industry: 'automotive',
      version: '1.0',
      description:
        'Template pabrik komponen otomotif dengan alur pemesinan CNC, grinding presisi, perakitan sub-assembly, dan inspeksi dimensi ketat.',
      status: 'active',
      icon: 'directions_car',
      productsCount: 3,
      machinesCount: 4,
      workCentersCount: 4,
      processesCount: 4,
      sampleProducts: ['Brake Disc Ventilated 280mm', 'Ceramic Brake Pad Set', 'Wheel Hub Flange Alloy'],
      sampleProcesses: ['Machining Bubut & Milling', 'Precision Surface Grinding', 'Sub-Assembly & Riveting', 'Quality Dimensional QA'],
      highlights: [
        'Tolerance checking (runout & hardness)',
        'Standard cycle times untuk part presisi',
        'Alur routing lengkap dari bahan mentah ke finished goods',
      ],
    },
    defaultPlantName: 'Pabrik Komponen Otomotif',
    lines: [
      {
        code: 'LINE-AUTO-01',
        name: 'Lini Produksi Brake System & Hub',
        status: 'ACTIVE',
        plannedProductionTimeMinutes: 480,
      },
    ],
    workCenters: [
      { lineIndex: 0, code: 'WC-MACH', name: 'Work Center CNC Machining', sequence: 1 },
      { lineIndex: 0, code: 'WC-GRIND', name: 'Work Center Precision Grinding', sequence: 2 },
      { lineIndex: 0, code: 'WC-ASSY', name: 'Work Center Sub-Assembly', sequence: 3 },
      { lineIndex: 0, code: 'WC-QC', name: 'Work Center Quality Inspection', sequence: 4 },
    ],
    processes: [
      { code: 'PROC-MACH', name: 'Machining Bubut & Milling', sequenceDefault: 1, status: 'ACTIVE' },
      { code: 'PROC-GRIND', name: 'Precision Surface Grinding', sequenceDefault: 2, status: 'ACTIVE' },
      { code: 'PROC-ASSY', name: 'Sub-Assembly & Riveting', sequenceDefault: 3, status: 'ACTIVE' },
      { code: 'PROC-QC', name: 'Final Quality Inspection', sequenceDefault: 4, status: 'ACTIVE' },
    ],
    machines: [
      {
        workCenterIndex: 0,
        code: 'CNC-LATHE-01',
        name: 'CNC Lathe Doosan Lynx 220',
        status: 'ACTIVE',
        idealCycleTimeSeconds: 45,
        currentState: MachineState.RUNNING,
        currentStateSince: '2026-01-01T00:00:00.000Z',
      },
      {
        workCenterIndex: 1,
        code: 'GRIND-01',
        name: 'Surface Grinder Okamoto 350',
        status: 'ACTIVE',
        idealCycleTimeSeconds: 30,
        currentState: MachineState.IDLE,
        currentStateSince: '2026-01-01T00:00:00.000Z',
      },
      {
        workCenterIndex: 2,
        code: 'PRESS-ASSY-01',
        name: 'Hydraulic Press Assembly 50T',
        status: 'ACTIVE',
        idealCycleTimeSeconds: 25,
        currentState: MachineState.IDLE,
        currentStateSince: '2026-01-01T00:00:00.000Z',
      },
      {
        workCenterIndex: 3,
        code: 'CMM-INSPECT-01',
        name: 'Mitutoyo CMM Inspection Station',
        status: 'ACTIVE',
        idealCycleTimeSeconds: 15,
        currentState: MachineState.IDLE,
        currentStateSince: '2026-01-01T00:00:00.000Z',
      },
    ],
    products: [
      {
        sku: 'AUTO-BRK-280',
        name: 'Brake Disc Ventilated 280mm',
        unit: 'PCS',
        idealCycleTimeSeconds: 45,
        status: 'ACTIVE',
      },
      {
        sku: 'AUTO-PAD-CER',
        name: 'Ceramic Brake Pad Set',
        unit: 'SET',
        idealCycleTimeSeconds: 30,
        status: 'ACTIVE',
      },
      {
        sku: 'AUTO-HUB-05',
        name: 'Wheel Hub Flange Alloy',
        unit: 'PCS',
        idealCycleTimeSeconds: 50,
        status: 'ACTIVE',
      },
    ],
    routings: [
      { productIndex: 0, processIndex: 0, workCenterIndex: 0, machineIndex: 0, sequence: 1, standardCycleTimeSeconds: 45 },
      { productIndex: 0, processIndex: 1, workCenterIndex: 1, machineIndex: 1, sequence: 2, standardCycleTimeSeconds: 30 },
      { productIndex: 0, processIndex: 2, workCenterIndex: 2, machineIndex: 2, sequence: 3, standardCycleTimeSeconds: 25 },
      { productIndex: 0, processIndex: 3, workCenterIndex: 3, machineIndex: 3, sequence: 4, standardCycleTimeSeconds: 15 },
    ],
    shifts: [
      { name: 'Shift 1 Pagi', startTime: '07:00', endTime: '15:00', breakMinutes: 60, crossesMidnight: false, active: true },
      { name: 'Shift 2 Siang', startTime: '15:00', endTime: '23:00', breakMinutes: 60, crossesMidnight: false, active: true },
      { name: 'Shift 3 Malam', startTime: '23:00', endTime: '07:00', breakMinutes: 60, crossesMidnight: true, active: true },
    ],
    downtimeReasons: [
      { category: DowntimeCategory.MACHINE, code: 'DT-SPINDLE', name: 'Overheat Spindle CNC', isPlanned: false, active: true, sortOrder: 1 },
      { category: DowntimeCategory.MACHINE, code: 'DT-TOOL-BROKEN', name: 'Tooling Patah / Aus', isPlanned: false, active: true, sortOrder: 2 },
      { category: DowntimeCategory.PROCESS, code: 'DT-JIG-CHANGE', name: 'Ganti Jig & Kalibrasi', isPlanned: true, active: true, sortOrder: 3 },
    ],
    rejectReasons: [
      { category: RejectCategory.DIMENSION, code: 'RJ-OUT-TOL', name: 'Ketebalan Luar Toleransi', active: true, sortOrder: 1 },
      { category: RejectCategory.DIMENSION, code: 'RJ-RUNOUT', name: 'Runout Melebihi 0.02mm', active: true, sortOrder: 2 },
      { category: RejectCategory.APPEARANCE, code: 'RJ-BURR', name: 'Burr Kasar pada Flange', active: true, sortOrder: 3 },
    ],
    sampleOrder: {
      productIndex: 0,
      quantity: 500,
      orderNumberPrefix: 'PO-AUTO-DEMO',
      goodQty: 480,
      rejectQty: 20,
    },
  },

  // 2. ELECTRONICS
  electronics: {
    info: {
      id: 'template-electronics-v1',
      name: 'Electronics & SMT Assembly',
      industry: 'electronics',
      version: '1.0',
      description:
        'Template perakitan papan elektronik dengan alur SMT Pick & Place, Reflow Soldering, AOI otomatis, dan In-Circuit Testing.',
      status: 'active',
      icon: 'memory',
      productsCount: 3,
      machinesCount: 4,
      workCentersCount: 4,
      processesCount: 4,
      sampleProducts: ['Main Control Board V2', 'Switching Power Supply 24V', 'Smart Sensor Controller'],
      sampleProcesses: ['SMT Component Placement', 'Reflow Soldering Oven', 'Automated Optical Inspection', 'ICT Functional Test'],
      highlights: [
        'Kompatibilitas multi-komponen & reel tracking',
        'Inspeksi cacat solder bridge & tombstone',
        'Yield rate tinggi dan pelacakan batch komponen',
      ],
    },
    defaultPlantName: 'Pabrik Manufaktur Elektronik',
    lines: [
      {
        code: 'LINE-SMT-01',
        name: 'Lini SMT & Box-Build Electronics',
        status: 'ACTIVE',
        plannedProductionTimeMinutes: 480,
      },
    ],
    workCenters: [
      { lineIndex: 0, code: 'WC-SMT', name: 'Work Center SMT Pick & Place', sequence: 1 },
      { lineIndex: 0, code: 'WC-REFLOW', name: 'Work Center Reflow Oven', sequence: 2 },
      { lineIndex: 0, code: 'WC-AOI', name: 'Work Center Optical Inspection', sequence: 3 },
      { lineIndex: 0, code: 'WC-ICT', name: 'Work Center In-Circuit Testing', sequence: 4 },
    ],
    processes: [
      { code: 'PROC-SMT', name: 'SMT Component Placement', sequenceDefault: 1, status: 'ACTIVE' },
      { code: 'PROC-REFLOW', name: 'Reflow Soldering', sequenceDefault: 2, status: 'ACTIVE' },
      { code: 'PROC-AOI', name: 'AOI Inspection', sequenceDefault: 3, status: 'ACTIVE' },
      { code: 'PROC-ICT', name: 'ICT Functional Test', sequenceDefault: 4, status: 'ACTIVE' },
    ],
    machines: [
      {
        workCenterIndex: 0,
        code: 'SMT-YAMAHA-01',
        name: 'Yamaha YSM20R Pick & Place',
        status: 'ACTIVE',
        idealCycleTimeSeconds: 20,
        currentState: MachineState.RUNNING,
        currentStateSince: '2026-01-01T00:00:00.000Z',
      },
      {
        workCenterIndex: 1,
        code: 'OVEN-HELLER-01',
        name: 'Heller 1809 MK5 Reflow Oven',
        status: 'ACTIVE',
        idealCycleTimeSeconds: 25,
        currentState: MachineState.IDLE,
        currentStateSince: '2026-01-01T00:00:00.000Z',
      },
      {
        workCenterIndex: 2,
        code: 'AOI-KOHYOUNG-01',
        name: 'Koh Young 3D AOI Zenith',
        status: 'ACTIVE',
        idealCycleTimeSeconds: 15,
        currentState: MachineState.IDLE,
        currentStateSince: '2026-01-01T00:00:00.000Z',
      },
      {
        workCenterIndex: 3,
        code: 'ICT-SPEA-01',
        name: 'Spea 4060 Flying Probe Tester',
        status: 'ACTIVE',
        idealCycleTimeSeconds: 20,
        currentState: MachineState.IDLE,
        currentStateSince: '2026-01-01T00:00:00.000Z',
      },
    ],
    products: [
      {
        sku: 'ELEC-CTRL-V2',
        name: 'Main Control Board V2',
        unit: 'PCS',
        idealCycleTimeSeconds: 20,
        status: 'ACTIVE',
      },
      {
        sku: 'ELEC-PSU-24V',
        name: 'Switching Power Supply 24V',
        unit: 'PCS',
        idealCycleTimeSeconds: 25,
        status: 'ACTIVE',
      },
      {
        sku: 'ELEC-SENS-04',
        name: 'Smart Sensor Controller',
        unit: 'PCS',
        idealCycleTimeSeconds: 18,
        status: 'ACTIVE',
      },
    ],
    routings: [
      { productIndex: 0, processIndex: 0, workCenterIndex: 0, machineIndex: 0, sequence: 1, standardCycleTimeSeconds: 20 },
      { productIndex: 0, processIndex: 1, workCenterIndex: 1, machineIndex: 1, sequence: 2, standardCycleTimeSeconds: 25 },
      { productIndex: 0, processIndex: 2, workCenterIndex: 2, machineIndex: 2, sequence: 3, standardCycleTimeSeconds: 15 },
      { productIndex: 0, processIndex: 3, workCenterIndex: 3, machineIndex: 3, sequence: 4, standardCycleTimeSeconds: 20 },
    ],
    shifts: [
      { name: 'Shift 1 Pagi', startTime: '07:00', endTime: '15:00', breakMinutes: 60, crossesMidnight: false, active: true },
      { name: 'Shift 2 Siang', startTime: '15:00', endTime: '23:00', breakMinutes: 60, crossesMidnight: false, active: true },
    ],
    downtimeReasons: [
      { category: DowntimeCategory.MATERIAL, code: 'DT-REEL-EMPTY', name: 'Komponen Habis pada Feeder', isPlanned: false, active: true, sortOrder: 1 },
      { category: DowntimeCategory.MACHINE, code: 'DT-NOZZLE-CLOG', name: 'Nozzle Mampet / Pick Error', isPlanned: false, active: true, sortOrder: 2 },
      { category: DowntimeCategory.PROCESS, code: 'DT-STENCIL-WIPE', name: 'Pembersihan Stensil Solder Paste', isPlanned: true, active: true, sortOrder: 3 },
    ],
    rejectReasons: [
      { category: RejectCategory.ASSEMBLY, code: 'RJ-BRIDGE', name: 'Solder Bridge Antar Pin', active: true, sortOrder: 1 },
      { category: RejectCategory.ASSEMBLY, code: 'RJ-TOMBSTONE', name: 'Tombstoning Komponen Pasif', active: true, sortOrder: 2 },
      { category: RejectCategory.FUNCTION, code: 'RJ-POLARITY', name: 'Komponen Polaritas Terbalik', active: true, sortOrder: 3 },
    ],
    sampleOrder: {
      productIndex: 0,
      quantity: 600,
      orderNumberPrefix: 'PO-ELEC-DEMO',
      goodQty: 585,
      rejectQty: 15,
    },
  },

  // 3. FOOD & BEVERAGE
  fnb: {
    info: {
      id: 'template-fnb-v1',
      name: 'Food & Beverage Bottling & Packing',
      industry: 'fnb',
      version: '1.0',
      description:
        'Template pengolahan dan pembotolan F&B: pencampuran bahan baku cair, filling & capping otomatis, labeling, dan kartonasi.',
      status: 'active',
      icon: 'local_drink',
      productsCount: 3,
      machinesCount: 4,
      workCentersCount: 3,
      processesCount: 4,
      sampleProducts: ['Air Mineral 600ml', 'Jus Buah Apel 250ml', 'Minuman Isotonik 500ml'],
      sampleProcesses: ['Blending & Batch Mixing', 'Rinsing-Filling Monoblock', 'Capping & Sealing', 'Labeling & Case Packing'],
      highlights: [
        'Batch volume & flow rate monitoring',
        'Higienitas & sanitasi CIP/SIP tracking',
        'Kecepatan pengemasan tinggi (BPM)',
      ],
    },
    defaultPlantName: 'Pabrik Minuman Kemasan F&B',
    lines: [
      {
        code: 'LINE-BOTTLING-01',
        name: 'Lini Pembotolan PET Otomatis',
        status: 'ACTIVE',
        plannedProductionTimeMinutes: 480,
      },
    ],
    workCenters: [
      { lineIndex: 0, code: 'WC-MIX', name: 'Work Center Blending Tank', sequence: 1 },
      { lineIndex: 0, code: 'WC-FILL', name: 'Work Center Filling & Capping', sequence: 2 },
      { lineIndex: 0, code: 'WC-PACK', name: 'Work Center Labeling & Packing', sequence: 3 },
    ],
    processes: [
      { code: 'PROC-MIX', name: 'Blending & Batch Mixing', sequenceDefault: 1, status: 'ACTIVE' },
      { code: 'PROC-FILL', name: 'Bottle Filling', sequenceDefault: 2, status: 'ACTIVE' },
      { code: 'PROC-CAP', name: 'Capping & Sealing', sequenceDefault: 3, status: 'ACTIVE' },
      { code: 'PROC-PACK', name: 'Labeling & Secondary Packing', sequenceDefault: 4, status: 'ACTIVE' },
    ],
    machines: [
      {
        workCenterIndex: 0,
        code: 'TANK-MIX-10K',
        name: 'Blending Tank SS316 10,000L',
        status: 'ACTIVE',
        idealCycleTimeSeconds: 10,
        currentState: MachineState.RUNNING,
        currentStateSince: '2026-01-01T00:00:00.000Z',
      },
      {
        workCenterIndex: 1,
        code: 'MONO-FILL-30',
        name: 'Rotary Rinsing-Filling Monoblock',
        status: 'ACTIVE',
        idealCycleTimeSeconds: 5,
        currentState: MachineState.IDLE,
        currentStateSince: '2026-01-01T00:00:00.000Z',
      },
      {
        workCenterIndex: 1,
        code: 'CAP-ROTARY-08',
        name: 'Rotary Capper 8-Head',
        status: 'ACTIVE',
        idealCycleTimeSeconds: 4,
        currentState: MachineState.IDLE,
        currentStateSince: '2026-01-01T00:00:00.000Z',
      },
      {
        workCenterIndex: 2,
        code: 'LBL-SHRINK-01',
        name: 'Shrink Sleeve Labeler & Tunnel',
        status: 'ACTIVE',
        idealCycleTimeSeconds: 8,
        currentState: MachineState.IDLE,
        currentStateSince: '2026-01-01T00:00:00.000Z',
      },
    ],
    products: [
      {
        sku: 'FNB-BTL-600',
        name: 'Air Mineral 600ml',
        unit: 'BTL',
        idealCycleTimeSeconds: 5,
        status: 'ACTIVE',
      },
      {
        sku: 'FNB-JUS-250',
        name: 'Jus Buah Apel 250ml',
        unit: 'BTL',
        idealCycleTimeSeconds: 6,
        status: 'ACTIVE',
      },
      {
        sku: 'FNB-ISO-500',
        name: 'Minuman Isotonik 500ml',
        unit: 'BTL',
        idealCycleTimeSeconds: 5,
        status: 'ACTIVE',
      },
    ],
    routings: [
      { productIndex: 0, processIndex: 0, workCenterIndex: 0, machineIndex: 0, sequence: 1, standardCycleTimeSeconds: 10 },
      { productIndex: 0, processIndex: 1, workCenterIndex: 1, machineIndex: 1, sequence: 2, standardCycleTimeSeconds: 5 },
      { productIndex: 0, processIndex: 2, workCenterIndex: 1, machineIndex: 2, sequence: 3, standardCycleTimeSeconds: 4 },
      { productIndex: 0, processIndex: 3, workCenterIndex: 2, machineIndex: 3, sequence: 4, standardCycleTimeSeconds: 8 },
    ],
    shifts: [
      { name: 'Shift 1 Pagi', startTime: '06:00', endTime: '14:00', breakMinutes: 60, crossesMidnight: false, active: true },
      { name: 'Shift 2 Siang', startTime: '14:00', endTime: '22:00', breakMinutes: 60, crossesMidnight: false, active: true },
    ],
    downtimeReasons: [
      { category: DowntimeCategory.PROCESS, code: 'DT-CIP-CYCLE', name: 'Siklus Pembersihan CIP Harian', isPlanned: true, active: true, sortOrder: 1 },
      { category: DowntimeCategory.MACHINE, code: 'DT-BOTTLE-JAM', name: 'Botol Tersangkut di Infeed', isPlanned: false, active: true, sortOrder: 2 },
      { category: DowntimeCategory.MATERIAL, code: 'DT-CAP-EMPTY', name: 'Hopper Tutup Botol Kosong', isPlanned: false, active: true, sortOrder: 3 },
    ],
    rejectReasons: [
      { category: RejectCategory.DIMENSION, code: 'RJ-UNDERFILL', name: 'Volume Isi di Bawah Standar (<595ml)', active: true, sortOrder: 1 },
      { category: RejectCategory.APPEARANCE, code: 'RJ-LOOSE-CAP', name: 'Tutup Botol Miring / Bocor', active: true, sortOrder: 2 },
      { category: RejectCategory.APPEARANCE, code: 'RJ-LABEL-TORN', name: 'Label Sobek / Posisi Miring', active: true, sortOrder: 3 },
    ],
    sampleOrder: {
      productIndex: 0,
      quantity: 1200,
      orderNumberPrefix: 'PO-FNB-DEMO',
      goodQty: 1180,
      rejectQty: 20,
    },
  },

  // 4. PHARMACEUTICAL
  pharmaceutical: {
    info: {
      id: 'template-pharma-v1',
      name: 'Pharmaceutical Solid Dosage',
      industry: 'pharmaceutical',
      version: '1.0',
      description:
        'Template pabrik farmasi formulasi sediaan padat: penimbangan API, granulasi basah, kompresi tablet presisi, dan blister packaging bersegel.',
      status: 'active',
      icon: 'medication',
      productsCount: 3,
      machinesCount: 4,
      workCentersCount: 3,
      processesCount: 4,
      sampleProducts: ['Paracetamol 500mg Tablet', 'Amoxicillin 250mg Kapsul', 'Cough Relief Syrup 60ml'],
      sampleProcesses: ['Granulasi & Pengeringan', 'Kompresi Rotary Tablet', 'Blister Sealing Al-PVC', 'Inspeksi & Pelabelan BPOM'],
      highlights: [
        'Batch record & line clearance traceability',
        'Disolusi, kerapuhan (friability), & weight variation checks',
        'Kepatuhan GMP / CPOB',
      ],
    },
    defaultPlantName: 'Fasilitas Manufaktur Farmasi GMP',
    lines: [
      {
        code: 'LINE-PHARMA-01',
        name: 'Lini Tablet & Blister Cleanroom Grade D',
        status: 'ACTIVE',
        plannedProductionTimeMinutes: 480,
      },
    ],
    workCenters: [
      { lineIndex: 0, code: 'WC-GRAN', name: 'Work Center Granulasi & Pengeringan', sequence: 1 },
      { lineIndex: 0, code: 'WC-COMP', name: 'Work Center Kompresi Tablet', sequence: 2 },
      { lineIndex: 0, code: 'WC-BLIST', name: 'Work Center Blistering & Packing', sequence: 3 },
    ],
    processes: [
      { code: 'PROC-GRAN', name: 'Granulasi & Fluid Bed Drying', sequenceDefault: 1, status: 'ACTIVE' },
      { code: 'PROC-COMP', name: 'Kompresi Rotary Tablet', sequenceDefault: 2, status: 'ACTIVE' },
      { code: 'PROC-BLIST', name: 'Blister Forming & Sealing', sequenceDefault: 3, status: 'ACTIVE' },
      { code: 'PROC-QA', name: 'Quality Release Inspection', sequenceDefault: 4, status: 'ACTIVE' },
    ],
    machines: [
      {
        workCenterIndex: 0,
        code: 'GRAN-FBD-01',
        name: 'Fluid Bed Dryer Glatt GPCG',
        status: 'ACTIVE',
        idealCycleTimeSeconds: 30,
        currentState: MachineState.RUNNING,
        currentStateSince: '2026-01-01T00:00:00.000Z',
      },
      {
        workCenterIndex: 1,
        code: 'PRESS-FETTE-01',
        name: 'Fette Compacting FE55 Rotary Press',
        status: 'ACTIVE',
        idealCycleTimeSeconds: 12,
        currentState: MachineState.IDLE,
        currentStateSince: '2026-01-01T00:00:00.000Z',
      },
      {
        workCenterIndex: 2,
        code: 'BLIST-UHLMANN-01',
        name: 'Uhlmann B1240 Blister Machine',
        status: 'ACTIVE',
        idealCycleTimeSeconds: 15,
        currentState: MachineState.IDLE,
        currentStateSince: '2026-01-01T00:00:00.000Z',
      },
      {
        workCenterIndex: 2,
        code: 'CARTON-IMA-01',
        name: 'IMA Cartoner Flexa',
        status: 'ACTIVE',
        idealCycleTimeSeconds: 10,
        currentState: MachineState.IDLE,
        currentStateSince: '2026-01-01T00:00:00.000Z',
      },
    ],
    products: [
      {
        sku: 'PHA-TAB-500',
        name: 'Paracetamol 500mg Tablet',
        unit: 'STRIP',
        idealCycleTimeSeconds: 12,
        status: 'ACTIVE',
      },
      {
        sku: 'PHA-CAP-250',
        name: 'Amoxicillin 250mg Kapsul',
        unit: 'STRIP',
        idealCycleTimeSeconds: 15,
        status: 'ACTIVE',
      },
      {
        sku: 'PHA-SYR-60',
        name: 'Cough Relief Syrup 60ml',
        unit: 'BTL',
        idealCycleTimeSeconds: 18,
        status: 'ACTIVE',
      },
    ],
    routings: [
      { productIndex: 0, processIndex: 0, workCenterIndex: 0, machineIndex: 0, sequence: 1, standardCycleTimeSeconds: 30 },
      { productIndex: 0, processIndex: 1, workCenterIndex: 1, machineIndex: 1, sequence: 2, standardCycleTimeSeconds: 12 },
      { productIndex: 0, processIndex: 2, workCenterIndex: 2, machineIndex: 2, sequence: 3, standardCycleTimeSeconds: 15 },
      { productIndex: 0, processIndex: 3, workCenterIndex: 2, machineIndex: 3, sequence: 4, standardCycleTimeSeconds: 10 },
    ],
    shifts: [
      { name: 'Shift 1 Pagi', startTime: '07:00', endTime: '15:30', breakMinutes: 60, crossesMidnight: false, active: true },
      { name: 'Shift 2 Siang', startTime: '15:30', endTime: '23:30', breakMinutes: 60, crossesMidnight: false, active: true },
    ],
    downtimeReasons: [
      { category: DowntimeCategory.PROCESS, code: 'DT-ROOM-CLEAR', name: 'Prosedur Line Clearance Antar Batch', isPlanned: true, active: true, sortOrder: 1 },
      { category: DowntimeCategory.MACHINE, code: 'DT-PUNCH-STUCK', name: 'Sticking / Capping pada Punch Bawah', isPlanned: false, active: true, sortOrder: 2 },
      { category: DowntimeCategory.MATERIAL, code: 'DT-FOIL-JAM', name: 'Foil Blister Tersangkut pada Sealing Jaw', isPlanned: false, active: true, sortOrder: 3 },
    ],
    rejectReasons: [
      { category: RejectCategory.DIMENSION, code: 'RJ-WEIGHT-DEV', name: 'Deviasi Bobot Tablet > 5%', active: true, sortOrder: 1 },
      { category: RejectCategory.MATERIAL, code: 'RJ-FRIABILITY', name: 'Kerapuhan Tablet (Friability > 1%)', active: true, sortOrder: 2 },
      { category: RejectCategory.APPEARANCE, code: 'RJ-FOIL-LEAK', name: 'Seal Blister Tidak Rapat (Leak Test Gagal)', active: true, sortOrder: 3 },
    ],
    sampleOrder: {
      productIndex: 0,
      quantity: 800,
      orderNumberPrefix: 'PO-PHA-DEMO',
      goodQty: 785,
      rejectQty: 15,
    },
  },

  // 5. CHEMICAL
  chemical: {
    info: {
      id: 'template-chemical-v1',
      name: 'Specialty Chemical & Liquid Blending',
      industry: 'chemical',
      version: '1.0',
      description:
        'Template formulasi kimia spesialis: pendosisan material, reaksi reaktor terkendali, dispersi kecepatan tinggi, pengisian drum otomatis.',
      status: 'active',
      icon: 'science',
      productsCount: 3,
      machinesCount: 3,
      workCentersCount: 3,
      processesCount: 3,
      sampleProducts: ['Industrial Detergent Liquid 20L', 'Adhesive Epoxy Part A', 'Heavy Duty Degreaser 5L'],
      sampleProcesses: ['Chemical Raw Dosing', 'Reactor Blending & Dispersion', 'Viscosity Testing & Drum Filling'],
      highlights: [
        'Temperature & reaction time safeguards',
        'Pencatatan densitas, pH, dan viskositas per lot',
        'Safety & containment verification',
      ],
    },
    defaultPlantName: 'Pabrik Formulasi Kimia Industri',
    lines: [
      {
        code: 'LINE-CHEM-01',
        name: 'Lini Reaktor & Drum Filling Otomatis',
        status: 'ACTIVE',
        plannedProductionTimeMinutes: 480,
      },
    ],
    workCenters: [
      { lineIndex: 0, code: 'WC-DOSE', name: 'Work Center Dosing & Prep', sequence: 1 },
      { lineIndex: 0, code: 'WC-REACT', name: 'Work Center Reaktor & Dispersi', sequence: 2 },
      { lineIndex: 0, code: 'WC-FILL', name: 'Work Center Pengisian Drum & QA', sequence: 3 },
    ],
    processes: [
      { code: 'PROC-DOSE', name: 'Raw Material Dosing', sequenceDefault: 1, status: 'ACTIVE' },
      { code: 'PROC-REACT', name: 'Reactor Blending & Heating', sequenceDefault: 2, status: 'ACTIVE' },
      { code: 'PROC-FILL', name: 'Drum Filling & QC Testing', sequenceDefault: 3, status: 'ACTIVE' },
    ],
    machines: [
      {
        workCenterIndex: 0,
        code: 'DOSE-SYSTEM-01',
        name: 'Automated Dosing Manifold',
        status: 'ACTIVE',
        idealCycleTimeSeconds: 20,
        currentState: MachineState.RUNNING,
        currentStateSince: '2026-01-01T00:00:00.000Z',
      },
      {
        workCenterIndex: 1,
        code: 'REACTOR-SS-5K',
        name: 'Jacketed Reactor Vessel 5000L',
        status: 'ACTIVE',
        idealCycleTimeSeconds: 60,
        currentState: MachineState.IDLE,
        currentStateSince: '2026-01-01T00:00:00.000Z',
      },
      {
        workCenterIndex: 2,
        code: 'DRUM-FILLER-04',
        name: 'Automatic Gravimetric Drum Filler',
        status: 'ACTIVE',
        idealCycleTimeSeconds: 30,
        currentState: MachineState.IDLE,
        currentStateSince: '2026-01-01T00:00:00.000Z',
      },
    ],
    products: [
      {
        sku: 'CHM-DET-20L',
        name: 'Industrial Detergent Liquid 20L',
        unit: 'DRUM',
        idealCycleTimeSeconds: 40,
        status: 'ACTIVE',
      },
      {
        sku: 'CHM-EPX-A',
        name: 'Adhesive Epoxy Part A',
        unit: 'PAIL',
        idealCycleTimeSeconds: 50,
        status: 'ACTIVE',
      },
      {
        sku: 'CHM-DEG-05L',
        name: 'Heavy Duty Degreaser 5L',
        unit: 'JRG',
        idealCycleTimeSeconds: 30,
        status: 'ACTIVE',
      },
    ],
    routings: [
      { productIndex: 0, processIndex: 0, workCenterIndex: 0, machineIndex: 0, sequence: 1, standardCycleTimeSeconds: 20 },
      { productIndex: 0, processIndex: 1, workCenterIndex: 1, machineIndex: 1, sequence: 2, standardCycleTimeSeconds: 60 },
      { productIndex: 0, processIndex: 2, workCenterIndex: 2, machineIndex: 2, sequence: 3, standardCycleTimeSeconds: 30 },
    ],
    shifts: [
      { name: 'Shift 1 Pagi', startTime: '07:00', endTime: '15:00', breakMinutes: 60, crossesMidnight: false, active: true },
      { name: 'Shift 2 Siang', startTime: '15:00', endTime: '23:00', breakMinutes: 60, crossesMidnight: false, active: true },
    ],
    downtimeReasons: [
      { category: DowntimeCategory.PROCESS, code: 'DT-FLUSH-SOLVENT', name: 'Pembersihan Tangki Antar Formula', isPlanned: true, active: true, sortOrder: 1 },
      { category: DowntimeCategory.MACHINE, code: 'DT-TEMP-EXCURSION', name: 'Chiller Jacket Under-Capacity', isPlanned: false, active: true, sortOrder: 2 },
    ],
    rejectReasons: [
      { category: RejectCategory.OTHER, code: 'RJ-VISCOSITY-OOS', name: 'Viskositas Di Luar Standar', active: true, sortOrder: 1 },
      { category: RejectCategory.OTHER, code: 'RJ-PH-DEVIATION', name: 'Deviasi pH Produk Akhir', active: true, sortOrder: 2 },
      { category: RejectCategory.APPEARANCE, code: 'RJ-DRUM-LEAK', name: 'Bung Cap Drum Rembes / Bocor', active: true, sortOrder: 3 },
    ],
    sampleOrder: {
      productIndex: 0,
      quantity: 400,
      orderNumberPrefix: 'PO-CHM-DEMO',
      goodQty: 390,
      rejectQty: 10,
    },
  },

  // 6. GENERAL MANUFACTURING (Fallback)
  general: {
    info: {
      id: 'template-general-v1',
      name: 'General Manufacturing & Assembly',
      industry: 'general',
      version: '1.0',
      description:
        'Template fleksibel untuk berbagai industri fabrikasi umum: pemotongan lembaran logam, perakitan part, finishing, dan quality control terpadu.',
      status: 'active',
      icon: 'precision_manufacturing',
      productsCount: 3,
      machinesCount: 3,
      workCentersCount: 3,
      processesCount: 3,
      sampleProducts: ['Metal Bracket Stamping 2mm', 'Industrial Enclosure Box', 'Precision Shaft Assembly'],
      sampleProcesses: ['Sheet Metal Stamping', 'Welding & Mechanical Assembly', 'Surface Finishing & Final QA'],
      highlights: [
        'Desain serbaguna untuk job-shop maupun batch production',
        'Setup cepat tanpa asumsi industri khusus',
        'Mudah disesuaikan dengan master data unik pabrik Anda',
      ],
    },
    defaultPlantName: 'Pabrik Manufaktur Umum',
    lines: [
      {
        code: 'LINE-GEN-01',
        name: 'Lini Fabrikasi & Perakitan Umum',
        status: 'ACTIVE',
        plannedProductionTimeMinutes: 480,
      },
    ],
    workCenters: [
      { lineIndex: 0, code: 'WC-STAMP', name: 'Work Center Stamping & Cutting', sequence: 1 },
      { lineIndex: 0, code: 'WC-ASSY', name: 'Work Center Mechanical Assembly', sequence: 2 },
      { lineIndex: 0, code: 'WC-QA', name: 'Work Center Finishing & QA', sequence: 3 },
    ],
    processes: [
      { code: 'PROC-STAMP', name: 'Stamping & Cutting', sequenceDefault: 1, status: 'ACTIVE' },
      { code: 'PROC-ASSY', name: 'Mechanical Assembly', sequenceDefault: 2, status: 'ACTIVE' },
      { code: 'PROC-QA', name: 'Finishing & Final QA', sequenceDefault: 3, status: 'ACTIVE' },
    ],
    machines: [
      {
        workCenterIndex: 0,
        code: 'PRESS-HYD-100',
        name: 'Hydraulic Press Stamping 100T',
        status: 'ACTIVE',
        idealCycleTimeSeconds: 25,
        currentState: MachineState.RUNNING,
        currentStateSince: '2026-01-01T00:00:00.000Z',
      },
      {
        workCenterIndex: 1,
        code: 'ASSY-BENCH-01',
        name: 'Manual & Pneumatic Assembly Station',
        status: 'ACTIVE',
        idealCycleTimeSeconds: 35,
        currentState: MachineState.IDLE,
        currentStateSince: '2026-01-01T00:00:00.000Z',
      },
      {
        workCenterIndex: 2,
        code: 'INSPECT-QA-01',
        name: 'Quality Testing & Inspection Table',
        status: 'ACTIVE',
        idealCycleTimeSeconds: 20,
        currentState: MachineState.IDLE,
        currentStateSince: '2026-01-01T00:00:00.000Z',
      },
    ],
    products: [
      {
        sku: 'GEN-BRK-01',
        name: 'Metal Bracket Stamping 2mm',
        unit: 'PCS',
        idealCycleTimeSeconds: 25,
        status: 'ACTIVE',
      },
      {
        sku: 'GEN-BOX-02',
        name: 'Industrial Enclosure Box',
        unit: 'UNIT',
        idealCycleTimeSeconds: 40,
        status: 'ACTIVE',
      },
      {
        sku: 'GEN-SFT-03',
        name: 'Precision Shaft Assembly',
        unit: 'PCS',
        idealCycleTimeSeconds: 30,
        status: 'ACTIVE',
      },
    ],
    routings: [
      { productIndex: 0, processIndex: 0, workCenterIndex: 0, machineIndex: 0, sequence: 1, standardCycleTimeSeconds: 25 },
      { productIndex: 0, processIndex: 1, workCenterIndex: 1, machineIndex: 1, sequence: 2, standardCycleTimeSeconds: 35 },
      { productIndex: 0, processIndex: 2, workCenterIndex: 2, machineIndex: 2, sequence: 3, standardCycleTimeSeconds: 20 },
    ],
    shifts: [
      { name: 'Shift 1 Pagi', startTime: '07:30', endTime: '16:00', breakMinutes: 60, crossesMidnight: false, active: true },
      { name: 'Shift 2 Siang', startTime: '16:00', endTime: '00:30', breakMinutes: 60, crossesMidnight: true, active: true },
    ],
    downtimeReasons: [
      { category: DowntimeCategory.MACHINE, code: 'DT-DIE-WEAR', name: 'Dies Tumpul / Aus', isPlanned: false, active: true, sortOrder: 1 },
      { category: DowntimeCategory.PROCESS, code: 'DT-MOLD-CHANGE', name: 'Pergantian Dies & Kalibrasi', isPlanned: true, active: true, sortOrder: 2 },
    ],
    rejectReasons: [
      { category: RejectCategory.DIMENSION, code: 'RJ-BEND-ANGLE', name: 'Sudut Tekukan Di Luar Toleransi', active: true, sortOrder: 1 },
      { category: RejectCategory.APPEARANCE, code: 'RJ-SURF-SCRATCH', name: 'Baret / Gores Permukaan', active: true, sortOrder: 2 },
    ],
    sampleOrder: {
      productIndex: 0,
      quantity: 500,
      orderNumberPrefix: 'PO-GEN-DEMO',
      goodQty: 480,
      rejectQty: 20,
    },
  },
};
