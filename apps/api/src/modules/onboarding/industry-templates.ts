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
  boms?: Array<{
    productIndex: number;
    bomName: string;
    version: string;
    status: 'ACTIVE' | 'DRAFT';
    description?: string;
    items: Array<{
      componentSku: string;
      componentName: string;
      componentType: 'RAW_MATERIAL' | 'COMPONENT' | 'SUB_ASSEMBLY' | 'PACKAGING';
      quantity: number;
      uom: string;
      scrapPercentage?: number;
      sequence?: number;
      notes?: string;
    }>;
  }>;
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

  // 7. PACKAGING
  packaging: {
    info: {
      id: 'template-packaging-v1',
      name: 'Kemasan & Percetakan Industri (Packaging)',
      industry: 'packaging',
      version: '1.0',
      description: 'Pembuatan karton box corrugated, cetak offset/flexo, die-cutting rotary, dan folder-gluer berkecepatan tinggi.',
      status: 'active',
      icon: 'inventory_2',
      productsCount: 3,
      machinesCount: 4,
      workCentersCount: 4,
      processesCount: 4,
      sampleProducts: ['Master Corrugated Box 60x40x40', 'Mailbox E-Commerce Die-Cut', 'Printed Folding Carton FMCG'],
      sampleProcesses: ['Corrugating & Fluting', 'Flexographic 4-Color Printing', 'Rotary Die-Cutting', 'High-Speed Folding & Gluing'],
      highlights: ['Kalkulasi yield roll kertas & flute', 'Manajemen cetak multi-warna & die cutter', 'BOM material kertas, lem & tinta'],
    },
    defaultPlantName: 'Pabrik Karton & Kemasan Nusantara',
    lines: [
      { code: 'LINE-BOX-01', name: 'Lini Corrugated Box Master', status: 'ACTIVE', plannedProductionTimeMinutes: 480 },
    ],
    workCenters: [
      { lineIndex: 0, code: 'WC-CORR', name: 'Work Center Corrugating', sequence: 1 },
      { lineIndex: 0, code: 'WC-PRINT', name: 'Work Center Flexo Printing', sequence: 2 },
      { lineIndex: 0, code: 'WC-DIECUT', name: 'Work Center Die Cutting', sequence: 3 },
      { lineIndex: 0, code: 'WC-GLUE', name: 'Work Center Folding & Gluing', sequence: 4 },
    ],
    processes: [
      { code: 'PROC-CORR', name: 'Corrugating & Fluting', sequenceDefault: 1, status: 'ACTIVE' },
      { code: 'PROC-FLEXO', name: 'Flexographic Printing', sequenceDefault: 2, status: 'ACTIVE' },
      { code: 'PROC-DIECUT', name: 'Rotary Die Cutting', sequenceDefault: 3, status: 'ACTIVE' },
      { code: 'PROC-GLUE', name: 'Folder Gluing & Bundling', sequenceDefault: 4, status: 'ACTIVE' },
    ],
    machines: [
      { workCenterIndex: 0, code: 'CORR-BHS', name: 'BHS Corrugator Line 2.5m', status: 'ACTIVE', idealCycleTimeSeconds: 1.0, currentState: MachineState.RUNNING, currentStateSince: '2026-01-01T00:00:00.000Z' },
      { workCenterIndex: 1, code: 'FLEXO-HEIDEL', name: 'Heidelberg Speedmaster XL 106', status: 'ACTIVE', idealCycleTimeSeconds: 0.5, currentState: MachineState.RUNNING, currentStateSince: '2026-01-01T00:00:00.000Z' },
      { workCenterIndex: 2, code: 'BOBST-NOVACUT', name: 'Bobst Novacut 106 E Die-Cutter', status: 'ACTIVE', idealCycleTimeSeconds: 0.6, currentState: MachineState.IDLE, currentStateSince: '2026-01-01T00:00:00.000Z' },
      { workCenterIndex: 3, code: 'BOBST-GLUER', name: 'Bobst Expertfold 110 Gluer', status: 'ACTIVE', idealCycleTimeSeconds: 0.4, currentState: MachineState.IDLE, currentStateSince: '2026-01-01T00:00:00.000Z' },
    ],
    products: [
      { sku: 'BOX-MSTR-6040', name: 'Corrugated Master Box 60x40x40cm Single Wall', unit: 'PCS', idealCycleTimeSeconds: 1.2, status: 'ACTIVE' },
      { sku: 'BOX-ECOM-M', name: 'Mailbox Karton E-Commerce Self-Locking M', unit: 'PCS', idealCycleTimeSeconds: 0.8, status: 'ACTIVE' },
      { sku: 'CTN-FMCG-250', name: 'Printed Folding Carton Kemasan Makanan Ringan', unit: 'PCS', idealCycleTimeSeconds: 0.5, status: 'ACTIVE' },
    ],
    routings: [
      { productIndex: 0, processIndex: 0, workCenterIndex: 0, machineIndex: 0, sequence: 1, standardCycleTimeSeconds: 1.0 },
      { productIndex: 0, processIndex: 1, workCenterIndex: 1, machineIndex: 1, sequence: 2, standardCycleTimeSeconds: 0.5 },
      { productIndex: 0, processIndex: 2, workCenterIndex: 2, machineIndex: 2, sequence: 3, standardCycleTimeSeconds: 0.6 },
      { productIndex: 0, processIndex: 3, workCenterIndex: 3, machineIndex: 3, sequence: 4, standardCycleTimeSeconds: 0.4 },
    ],
    shifts: [
      { name: 'Shift 1 Pagi', startTime: '07:00', endTime: '15:00', breakMinutes: 60, crossesMidnight: false, active: true },
      { name: 'Shift 2 Siang', startTime: '15:00', endTime: '23:00', breakMinutes: 60, crossesMidnight: false, active: true },
    ],
    downtimeReasons: [
      { category: DowntimeCategory.MACHINE, code: 'DT-WASHUP', name: 'Wash-up Tinta & Pembersihan Plate', isPlanned: true, active: true, sortOrder: 1 },
      { category: DowntimeCategory.PROCESS, code: 'DT-DIE-CHG', name: 'Setup Pisau Pond & Creasing Matrix', isPlanned: true, active: true, sortOrder: 2 },
    ],
    rejectReasons: [
      { category: RejectCategory.APPEARANCE, code: 'RJ-MISREG', name: 'Meleset Cetak Warna / Misregistration', active: true, sortOrder: 1 },
      { category: RejectCategory.ASSEMBLY, code: 'RJ-GLUE-FAIL', name: 'Lem Terkelupas / Joint Rusak', active: true, sortOrder: 2 },
    ],
    sampleOrder: { productIndex: 0, quantity: 10000, orderNumberPrefix: 'PO-PACK-DEMO', goodQty: 9750, rejectQty: 250 },
    boms: [
      {
        productIndex: 0,
        bomName: 'BOM Master Box 60x40x40 Standard',
        version: 'v1.0',
        status: 'ACTIVE',
        description: 'Struktur material kertas liner kraft, medium fluting, tinta, dan lem PVA.',
        items: [
          { componentSku: 'RAW-KRAFT-150', componentName: 'Kertas Kraft Liner 150 GSM', componentType: 'RAW_MATERIAL', quantity: 0.65, uom: 'KG', scrapPercentage: 2.0, sequence: 1 },
          { componentSku: 'RAW-MED-FLUTE', componentName: 'Kertas Medium Fluting 125 GSM', componentType: 'RAW_MATERIAL', quantity: 0.45, uom: 'KG', scrapPercentage: 2.0, sequence: 2 },
          { componentSku: 'CHEM-INK-BLACK', componentName: 'Tinta Water-Based Black', componentType: 'RAW_MATERIAL', quantity: 0.008, uom: 'KG', sequence: 3 },
          { componentSku: 'CHEM-GLUE-PVA', componentName: 'Lem PVA Carton Adhesive', componentType: 'RAW_MATERIAL', quantity: 0.015, uom: 'KG', sequence: 4 },
        ],
      },
    ],
  },

  // 8. METAL FABRICATION
  'metal-fabrication': {
    info: {
      id: 'template-metal-fab-v1',
      name: 'Fabrikasi Logam & Sheet Metal',
      industry: 'metal-fabrication',
      version: '1.0',
      description: 'Pemotongan pelat baja fiber laser, penekukan CNC press brake, pengelasan robotic, dan finishing powder coating oven.',
      status: 'active',
      icon: 'handyman',
      productsCount: 3,
      machinesCount: 4,
      workCentersCount: 4,
      processesCount: 4,
      sampleProducts: ['Electrical Cabinet IP66 600x400', '19 Inch Server Rack Frame 42U', 'Heavy Duty Structural Wall Bracket'],
      sampleProcesses: ['Fiber Laser Cutting', 'CNC Press Brake Bending', 'MIG/TIG Robotic Welding', 'Powder Coating & Curing Oven'],
      highlights: ['Yield nesting pelat lembaran SPCC/SUS', 'Pengendalian sudut tekukan & toleransi pengelasan', 'BOM pelat, kawat las, dan powder coat'],
    },
    defaultPlantName: 'Pabrik Sheet Metal & Fabrikasi Cipta',
    lines: [
      { code: 'LINE-MET-01', name: 'Lini Fabrikasi Panel & Enclosure', status: 'ACTIVE', plannedProductionTimeMinutes: 480 },
    ],
    workCenters: [
      { lineIndex: 0, code: 'WC-LASER', name: 'Work Center Laser Cutting', sequence: 1 },
      { lineIndex: 0, code: 'WC-BEND', name: 'Work Center Press Brake', sequence: 2 },
      { lineIndex: 0, code: 'WC-WELD', name: 'Work Center Robotic Welding', sequence: 3 },
      { lineIndex: 0, code: 'WC-COAT', name: 'Work Center Powder Coating', sequence: 4 },
    ],
    processes: [
      { code: 'PROC-LASER', name: 'High-Power Laser Cutting', sequenceDefault: 1, status: 'ACTIVE' },
      { code: 'PROC-BEND', name: 'CNC Hydraulic Bending', sequenceDefault: 2, status: 'ACTIVE' },
      { code: 'PROC-WELD', name: 'Robotic MIG/TIG Welding', sequenceDefault: 3, status: 'ACTIVE' },
      { code: 'PROC-COAT', name: 'Powder Coating Oven', sequenceDefault: 4, status: 'ACTIVE' },
    ],
    machines: [
      { workCenterIndex: 0, code: 'TRUMPF-3030', name: 'Trumpf TruLaser 3030 Fiber 6kW', status: 'ACTIVE', idealCycleTimeSeconds: 15, currentState: MachineState.RUNNING, currentStateSince: '2026-01-01T00:00:00.000Z' },
      { workCenterIndex: 1, code: 'AMADA-HFE', name: 'Amada HFE 100-3 Press Brake', status: 'ACTIVE', idealCycleTimeSeconds: 20, currentState: MachineState.RUNNING, currentStateSince: '2026-01-01T00:00:00.000Z' },
      { workCenterIndex: 2, code: 'FANUC-ROBOWELD', name: 'Fanuc ARC Mate Robotic Welder', status: 'ACTIVE', idealCycleTimeSeconds: 35, currentState: MachineState.IDLE, currentStateSince: '2026-01-01T00:00:00.000Z' },
      { workCenterIndex: 3, code: 'GEMA-COATOVEN', name: 'Gema Automatic Powder Spray Booth', status: 'ACTIVE', idealCycleTimeSeconds: 25, currentState: MachineState.IDLE, currentStateSince: '2026-01-01T00:00:00.000Z' },
    ],
    products: [
      { sku: 'CAB-IP66-6040', name: 'Electrical Enclosure Cabinet IP66 (600x400x200mm)', unit: 'UNIT', idealCycleTimeSeconds: 95, status: 'ACTIVE' },
      { sku: 'SRV-RACK-42U', name: '19 Inch Server Rack 42U Welded Frame', unit: 'UNIT', idealCycleTimeSeconds: 180, status: 'ACTIVE' },
      { sku: 'BRK-HVY-WALL', name: 'Heavy Duty Structural Wall Mounting Bracket', unit: 'PCS', idealCycleTimeSeconds: 30, status: 'ACTIVE' },
    ],
    routings: [
      { productIndex: 0, processIndex: 0, workCenterIndex: 0, machineIndex: 0, sequence: 1, standardCycleTimeSeconds: 15 },
      { productIndex: 0, processIndex: 1, workCenterIndex: 1, machineIndex: 1, sequence: 2, standardCycleTimeSeconds: 20 },
      { productIndex: 0, processIndex: 2, workCenterIndex: 2, machineIndex: 2, sequence: 3, standardCycleTimeSeconds: 35 },
      { productIndex: 0, processIndex: 3, workCenterIndex: 3, machineIndex: 3, sequence: 4, standardCycleTimeSeconds: 25 },
    ],
    shifts: [
      { name: 'Shift Pagi', startTime: '07:30', endTime: '16:00', breakMinutes: 60, crossesMidnight: false, active: true },
      { name: 'Shift Malam', startTime: '16:00', endTime: '00:30', breakMinutes: 60, crossesMidnight: true, active: true },
    ],
    downtimeReasons: [
      { category: DowntimeCategory.MACHINE, code: 'DT-LENS', name: 'Pembersihan Lensa Optik Laser', isPlanned: true, active: true, sortOrder: 1 },
      { category: DowntimeCategory.PROCESS, code: 'DT-BEND-TOOL', name: 'Ganti Punch & Die Press Brake', isPlanned: true, active: true, sortOrder: 2 },
    ],
    rejectReasons: [
      { category: RejectCategory.DIMENSION, code: 'RJ-ANGLE', name: 'Sudut Tekukan Melenceng', active: true, sortOrder: 1 },
      { category: RejectCategory.APPEARANCE, code: 'RJ-PAINT', name: 'Gelembung / Scratch Powder Coat', active: true, sortOrder: 2 },
    ],
    sampleOrder: { productIndex: 0, quantity: 200, orderNumberPrefix: 'PO-MET-DEMO', goodQty: 195, rejectQty: 5 },
    boms: [
      {
        productIndex: 0,
        bomName: 'BOM Electrical Cabinet IP66 600x400',
        version: 'v1.0',
        status: 'ACTIVE',
        description: 'Struktur pelat SPCC, kawat las, cat powder coat, dan aksesori kunci cam lock.',
        items: [
          { componentSku: 'RAW-SPCC-2MM', componentName: 'Pelat Baja SPCC 2.0mm', componentType: 'RAW_MATERIAL', quantity: 12.5, uom: 'KG', scrapPercentage: 2.5, sequence: 1 },
          { componentSku: 'CONS-WELD-WIRE', componentName: 'Kawat Las MIG ER70S-6', componentType: 'RAW_MATERIAL', quantity: 0.35, uom: 'KG', sequence: 2 },
          { componentSku: 'CHEM-POWDER-RAL', componentName: 'Powder Coat RAL 7035 Grey', componentType: 'RAW_MATERIAL', quantity: 0.85, uom: 'KG', sequence: 3 },
          { componentSku: 'FAST-RIVET-M6', componentName: 'Blind Rivet Nut M6', componentType: 'COMPONENT', quantity: 8, uom: 'PCS', sequence: 4 },
          { componentSku: 'ACC-LOCK-CAM', componentName: 'Kunci Cam Lock Chrome', componentType: 'COMPONENT', quantity: 2, uom: 'PCS', sequence: 5 },
        ],
      },
    ],
  },

  // 9. FURNITURE
  furniture: {
    info: {
      id: 'template-furniture-v1',
      name: 'Furnitur & Pengolahan Kayu (Furniture & Woodworking)',
      industry: 'furniture',
      version: '1.0',
      description: 'Pemotongan panel beam sizing saw, CNC nesting router, penempelan edging PUR, pengeboran dowel, dan flat-pack.',
      status: 'active',
      icon: 'chair',
      productsCount: 3,
      machinesCount: 4,
      workCentersCount: 4,
      processesCount: 4,
      sampleProducts: ['Executive Desk L-Shape HPL Teak', '3-Drawer Mobile Filing Pedestal Cabinet', 'Open Bookshelf 5-Tier Heavy Duty'],
      sampleProcesses: ['Computerized Panel Beam Sizing', 'PUR Adhesive Edge Banding', 'CNC Dowel & Cam Drilling', 'Hardware Kitting & Flatpack'],
      highlights: ['Manajemen panel board MDF & HPL', 'Pengendalian edging PVC & aksesoris minifix', 'BOM flatpack & packaging proteksi'],
    },
    defaultPlantName: 'Pabrik Mebel & Furnitur Kencana',
    lines: [
      { code: 'LINE-FURN-01', name: 'Lini Furnitur Kantor & Kabinet', status: 'ACTIVE', plannedProductionTimeMinutes: 480 },
    ],
    workCenters: [
      { lineIndex: 0, code: 'WC-BEAM', name: 'Work Center Beam Sizing Saw', sequence: 1 },
      { lineIndex: 0, code: 'WC-EDGE', name: 'Work Center Edgebanding', sequence: 2 },
      { lineIndex: 0, code: 'WC-DRILL', name: 'Work Center CNC Drilling', sequence: 3 },
      { lineIndex: 0, code: 'WC-PACK', name: 'Work Center Flatpack Assembly', sequence: 4 },
    ],
    processes: [
      { code: 'PROC-SAW', name: 'Panel Beam Sizing', sequenceDefault: 1, status: 'ACTIVE' },
      { code: 'PROC-EDGE', name: 'PUR Edge Banding', sequenceDefault: 2, status: 'ACTIVE' },
      { code: 'PROC-DRILL', name: 'CNC Boring & Dowel Drilling', sequenceDefault: 3, status: 'ACTIVE' },
      { code: 'PROC-FLATPACK', name: 'Hardware Packing & Carton', sequenceDefault: 4, status: 'ACTIVE' },
    ],
    machines: [
      { workCenterIndex: 0, code: 'HOMAG-SAW', name: 'Homag SAWTEQ B-300 Dividing Saw', status: 'ACTIVE', idealCycleTimeSeconds: 18, currentState: MachineState.RUNNING, currentStateSince: '2026-01-01T00:00:00.000Z' },
      { workCenterIndex: 1, code: 'BIESSE-EDGE', name: 'Biesse Akron 1440 Edgebander', status: 'ACTIVE', idealCycleTimeSeconds: 12, currentState: MachineState.RUNNING, currentStateSince: '2026-01-01T00:00:00.000Z' },
      { workCenterIndex: 2, code: 'SCM-DRILL', name: 'SCM Morbidelli CX100 Boring Centre', status: 'ACTIVE', idealCycleTimeSeconds: 22, currentState: MachineState.IDLE, currentStateSince: '2026-01-01T00:00:00.000Z' },
      { workCenterIndex: 3, code: 'PANOTEC-PACK', name: 'Panotec Box-on-Demand Machine', status: 'ACTIVE', idealCycleTimeSeconds: 15, currentState: MachineState.IDLE, currentStateSince: '2026-01-01T00:00:00.000Z' },
    ],
    products: [
      { sku: 'DESK-EXEC-L', name: 'Executive L-Shape Office Desk 160x140cm', unit: 'UNIT', idealCycleTimeSeconds: 120, status: 'ACTIVE' },
      { sku: 'CAB-FILE-3D', name: '3-Drawer Mobile Filing Pedestal Cabinet', unit: 'UNIT', idealCycleTimeSeconds: 85, status: 'ACTIVE' },
      { sku: 'RACK-BOOK-5T', name: 'Open Storage Bookshelf 5-Tier Heavy Duty', unit: 'UNIT', idealCycleTimeSeconds: 65, status: 'ACTIVE' },
    ],
    routings: [
      { productIndex: 0, processIndex: 0, workCenterIndex: 0, machineIndex: 0, sequence: 1, standardCycleTimeSeconds: 18 },
      { productIndex: 0, processIndex: 1, workCenterIndex: 1, machineIndex: 1, sequence: 2, standardCycleTimeSeconds: 12 },
      { productIndex: 0, processIndex: 2, workCenterIndex: 2, machineIndex: 2, sequence: 3, standardCycleTimeSeconds: 22 },
      { productIndex: 0, processIndex: 3, workCenterIndex: 3, machineIndex: 3, sequence: 4, standardCycleTimeSeconds: 15 },
    ],
    shifts: [
      { name: 'Shift Normal', startTime: '08:00', endTime: '17:00', breakMinutes: 60, crossesMidnight: false, active: true },
    ],
    downtimeReasons: [
      { category: DowntimeCategory.PROCESS, code: 'DT-SAW-BLADE', name: 'Ganti Mata Pisau Sizing Saw', isPlanned: true, active: true, sortOrder: 1 },
      { category: DowntimeCategory.MACHINE, code: 'DT-GLUE-POT', name: 'Bersihkan Glue Pot Lem PUR', isPlanned: true, active: true, sortOrder: 2 },
    ],
    rejectReasons: [
      { category: RejectCategory.ASSEMBLY, code: 'RJ-CHIPPING', name: 'Gumpil Potong Laminasi (Chipping)', active: true, sortOrder: 1 },
      { category: RejectCategory.DIMENSION, code: 'RJ-HOLE-DRIFT', name: 'Titik Lubang Bor Meleset', active: true, sortOrder: 2 },
    ],
    sampleOrder: { productIndex: 0, quantity: 150, orderNumberPrefix: 'PO-FURN-DEMO', goodQty: 145, rejectQty: 5 },
    boms: [
      {
        productIndex: 0,
        bomName: 'BOM Executive Desk L-Shape HPL Teak',
        version: 'v1.0',
        status: 'ACTIVE',
        description: 'Struktur papan MDF, HPL teak, PVC edgeband, hardware cam lock dowel, dan box flatpack.',
        items: [
          { componentSku: 'RAW-MDF-18', componentName: 'Papan MDF E1 Moisture Resistant 18mm', componentType: 'RAW_MATERIAL', quantity: 2.2, uom: 'PCS', scrapPercentage: 4.0, sequence: 1 },
          { componentSku: 'RAW-HPL-TEAK', componentName: 'HPL Natural Teak Sheet', componentType: 'RAW_MATERIAL', quantity: 2, uom: 'PCS', sequence: 2 },
          { componentSku: 'EDGE-PVC-2MM', componentName: 'PVC Edgeband 2mm Teak Roll', componentType: 'RAW_MATERIAL', quantity: 18, uom: 'METER', sequence: 3 },
          { componentSku: 'HARD-CAM-LOCK', componentName: 'Cam Lock & Dowel Minifix Set', componentType: 'COMPONENT', quantity: 24, uom: 'SET', sequence: 4 },
          { componentSku: 'PKG-CORNER-BOX', componentName: 'Foam Protector & Carton Flatpack', componentType: 'PACKAGING', quantity: 1, uom: 'BOX', sequence: 5 },
        ],
      },
    ],
  },
};
