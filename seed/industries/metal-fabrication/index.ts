import type { SeedIndustryDataset } from '../industry.types.js';

export const METAL_FABRICATION_DATASET: SeedIndustryDataset = {
  id: 'metal-fabrication',
  name: 'Fabrikasi Logam & Sheet Metal (Metal Fabrication)',
  code: 'IND-METAL',
  description: 'Fiber laser cutting, CNC hydraulic bending/press brake, robotic MIG/TIG welding, dan electrostatic powder coating.',
  companyName: 'PT Cipta Fabrikasi Metalindo',
  warehouses: [
    { code: 'WH-PLATE-01', name: 'Gudang Pelat Baja & Stainless Steel Sheet', type: 'RAW_MATERIAL' },
    { code: 'WH-ENCL-FG', name: 'Gudang Rak Server & Panel Box Jadi', type: 'FINISHED_GOODS' },
  ],
  workCenters: [
    { code: 'WC-LASER', name: 'Work Center Fiber Laser Cutting', capacityPerShift: 1500 },
    { code: 'WC-BEND', name: 'Work Center CNC Press Brake Bending', capacityPerShift: 1200 },
    { code: 'WC-WELD', name: 'Work Center Robotic & Manual Welding', capacityPerShift: 800 },
    { code: 'WC-COAT', name: 'Work Center Powder Coating & Curing Oven', capacityPerShift: 2000 },
  ],
  processes: [
    { code: 'PROC-LASER', name: 'CNC High-Power Fiber Laser Cutting', sequenceDefault: 1 },
    { code: 'PROC-DEBURR', name: 'Vibratory Deburring & Edge Rounding', sequenceDefault: 2 },
    { code: 'PROC-BEND', name: 'Precision CNC Hydraulic Bending', sequenceDefault: 3 },
    { code: 'PROC-WELD', name: 'MIG/TIG Enclosure Seam Welding', sequenceDefault: 4 },
    { code: 'PROC-COAT', name: 'Electrostatic Powder Coating', sequenceDefault: 5 },
  ],
  machines: [
    { code: 'LASER-TRUMPF-01', name: 'Trumpf TruLaser 3030 Fiber 6kW', idealCycleTimeSeconds: 15, workCenterCode: 'WC-LASER' },
    { code: 'BEND-AMADA-02', name: 'Amada HFE 100-3 Press Brake 100T', idealCycleTimeSeconds: 20, workCenterCode: 'WC-BEND' },
    { code: 'WELD-FANUC-03', name: 'Fanuc ARC Mate Robotic Welding Cell', idealCycleTimeSeconds: 35, workCenterCode: 'WC-WELD' },
    { code: 'OVEN-GEMA-04', name: 'Gema Automatic Powder Spray & Oven 200C', idealCycleTimeSeconds: 25, workCenterCode: 'WC-COAT' },
  ],
  lines: [
    { code: 'LINE-PANEL-A', name: 'Lini Fabrikasi Panel Box & Cabinet Listrik' },
    { code: 'LINE-BRACKET-B', name: 'Lini Fabrikasi Bracket Heavy Structural' },
  ],
  shifts: [
    { name: 'Shift Pagi', startTime: '07:30', endTime: '16:00', breakMinutes: 60 },
    { name: 'Shift Malam', startTime: '16:00', endTime: '00:30', breakMinutes: 60 },
  ],
  parts: [
    { sku: 'RAW-SPCC-2MM', name: 'Pelat Baja SPCC Dingin 2.0mm (1220x2440mm)', unit: 'KG', category: 'RAW_MATERIAL', initialStock: 16000 },
    { sku: 'RAW-SUS304-15', name: 'Pelat Stainless Steel SUS304 1.5mm', unit: 'KG', category: 'RAW_MATERIAL', initialStock: 9500 },
    { sku: 'RAW-ALUM-3MM', name: 'Pelat Aluminium 5052 H32 3.0mm', unit: 'KG', category: 'RAW_MATERIAL', initialStock: 7200 },
    { sku: 'CONS-WELD-WIRE', name: 'Kawat Las MIG ER70S-6 1.2mm Spool', unit: 'KG', category: 'RAW_MATERIAL', initialStock: 800 },
    { sku: 'CHEM-POWDER-RAL', name: 'Cat Bubuk Powder Coat RAL 7035 Grey', unit: 'KG', category: 'RAW_MATERIAL', initialStock: 1500 },
    { sku: 'FAST-RIVET-M6', name: 'Blind Rivet Nut M6 Carbon Steel Zinc', unit: 'PCS', category: 'COMPONENT', initialStock: 10000 },
    { sku: 'ACC-LOCK-CAM', name: 'Kunci Panel Cam Lock Chrome Plated', unit: 'PCS', category: 'COMPONENT', initialStock: 2500 },
  ],
  products: [
    { sku: 'PRD-CAB-ELEC', name: 'Electrical Enclosure Cabinet IP66 (600x400x200mm)', unit: 'UNIT', idealCycleTimeSeconds: 95, category: 'Enclosures' },
    { sku: 'PRD-FRAME-SRV', name: '19 Inch Server Rack 42U Welded Frame', unit: 'UNIT', idealCycleTimeSeconds: 180, category: 'Server Racks' },
    { sku: 'PRD-BRK-HVY', name: 'Heavy Duty Structural Wall Mounting Bracket', unit: 'PCS', idealCycleTimeSeconds: 30, category: 'Brackets' },
    { sku: 'PRD-TRAY-CBL', name: 'Perforated Cable Tray 300x50x3000mm G.I.', unit: 'PCS', idealCycleTimeSeconds: 40, category: 'Cable Trays' },
  ],
  boms: [
    {
      bomNumber: 'BOM-MET-001',
      productSku: 'PRD-CAB-ELEC',
      bomName: 'BOM Electrical Cabinet IP66 600x400',
      version: 'v1.0',
      status: 'ACTIVE',
      effectiveDate: '2026-01-01',
      description: 'Struktur material kabinet panel listrik dari pelat SPCC, pengelasan, powder coating, dan aksesori kunci.',
      items: [
        { componentPartSku: 'RAW-SPCC-2MM', componentType: 'RAW_MATERIAL', quantity: 12.5, uom: 'KG', scrapPercentage: 2.5, sequence: 1 },
        { componentPartSku: 'CONS-WELD-WIRE', componentType: 'RAW_MATERIAL', quantity: 0.35, uom: 'KG', sequence: 2 },
        { componentPartSku: 'CHEM-POWDER-RAL', componentType: 'RAW_MATERIAL', quantity: 0.85, uom: 'KG', sequence: 3 },
        { componentPartSku: 'FAST-RIVET-M6', componentType: 'COMPONENT', quantity: 8, uom: 'PCS', sequence: 4 },
        { componentPartSku: 'ACC-LOCK-CAM', componentType: 'COMPONENT', quantity: 2, uom: 'PCS', sequence: 5 },
      ],
    },
    {
      bomNumber: 'BOM-MET-002',
      productSku: 'PRD-BRK-HVY',
      bomName: 'BOM Heavy Duty Wall Bracket Galvanized',
      version: 'v1.0',
      status: 'ACTIVE',
      effectiveDate: '2026-01-01',
      description: 'Bracket penopang struktur mesin beban berat.',
      items: [
        { componentPartSku: 'RAW-SPCC-2MM', componentType: 'RAW_MATERIAL', quantity: 3.2, uom: 'KG', scrapPercentage: 1.5, sequence: 1 },
        { componentPartSku: 'CHEM-POWDER-RAL', componentType: 'RAW_MATERIAL', quantity: 0.25, uom: 'KG', sequence: 2 },
      ],
    },
  ],
  customers: [
    { code: 'CUST-PLN-EN', name: 'PT PLN Enjiniring', email: 'pengadaan@pln-enjiniring.co.id', phone: '+62-21-7918000', address: 'Mampang Prapatan, Jakarta Selatan' },
    { code: 'CUST-HUAWEI-ID', name: 'Huawei Tech Investment Indonesia', email: 'po.vendor@huawei.com', phone: '+62-21-2924000', address: 'Wisma Mulia 2, Jakarta' },
    { code: 'CUST-TELKOM-INF', name: 'PT Telkom Infra Solusi', email: 'scm@telkominfra.co.id', phone: '+62-21-8370001', address: 'Tebet Barat, Jakarta Selatan' },
    { code: 'CUST-WIKA-IND', name: 'PT Wijaya Karya Industri & Konstruksi', email: 'tender@wikainkon.co.id', phone: '+62-21-8140000', address: 'Cileungsi, Bogor' },
    { code: 'CUST-TOTAL-BANGUN', name: 'PT Total Bangun Persada Tbk', email: 'procurement@totalbp.com', phone: '+62-21-5666999', address: 'Tomang Raya, Jakarta Barat' },
  ],
  suppliers: [
    { code: 'SUP-GUNUNG-STEEL', name: 'PT Gunung Raja Paksi Tbk', category: 'Steel Plates & Coils', contact: 'sales@gunungsteel.com' },
    { code: 'SUP-BHP-STAINLESS', name: 'BHP Stainless Steel Distribution', category: 'SUS304 Sheet Stock', contact: 'orders@bhpmeta.com' },
    { code: 'SUP-LINCOLN-WELD', name: 'Lincoln Electric Indonesia', category: 'MIG/TIG Welding Consumables', contact: 'indo@lincolnelectric.com' },
    { code: 'SUP-JOTUN-POWDER', name: 'PT Jotun Indonesia Powder Coating', category: 'Corro-Coat Powders', contact: 'powder@jotun.co.id' },
    { code: 'SUP-TITAN-FAST', name: 'PT Titan Fasteners Presisi', category: 'Rivet Nuts & Hardware', contact: 'sales@titanfast.co.id' },
  ],
  routings: [
    { productSku: 'PRD-CAB-ELEC', processCode: 'PROC-LASER', sequence: 1, workCenterCode: 'WC-LASER', machineCode: 'LASER-TRUMPF-01', standardCycleTimeSeconds: 15 },
    { productSku: 'PRD-CAB-ELEC', processCode: 'PROC-BEND', sequence: 2, workCenterCode: 'WC-BEND', machineCode: 'BEND-AMADA-02', standardCycleTimeSeconds: 20 },
    { productSku: 'PRD-CAB-ELEC', processCode: 'PROC-WELD', sequence: 3, workCenterCode: 'WC-WELD', machineCode: 'WELD-FANUC-03', standardCycleTimeSeconds: 35 },
    { productSku: 'PRD-CAB-ELEC', processCode: 'PROC-COAT', sequence: 4, workCenterCode: 'WC-COAT', machineCode: 'OVEN-GEMA-04', standardCycleTimeSeconds: 25 },
  ],
  orders: [
    { orderNumber: 'PO-PLN-2026-001', customerCode: 'CUST-PLN-EN', productSku: 'PRD-CAB-ELEC', quantity: 500, unit: 'UNIT', targetDays: 7 },
    { orderNumber: 'PO-HUAWEI-2026-002', customerCode: 'CUST-HUAWEI-ID', productSku: 'PRD-FRAME-SRV', quantity: 150, unit: 'UNIT', targetDays: 10 },
  ],
  workOrders: [
    { woNumber: 'WO-MET-2026-001', orderNumber: 'PO-PLN-2026-001', productSku: 'PRD-CAB-ELEC', lineCode: 'LINE-PANEL-A', machineCode: 'LASER-TRUMPF-01', targetQuantity: 150, unit: 'UNIT', status: 'IN_PROGRESS' },
  ],
  downtimeReasons: [
    { code: 'DT-LENS-CLEAN', name: 'Pembersihan Lensa Optik Laser', category: 'MAINTENANCE', isPlanned: true },
    { code: 'DT-GAS-EMPTY', name: 'Tekanan Gas Nitrogen Assist Habis', category: 'MATERIAL', isPlanned: false },
    { code: 'DT-TOOLING-BEND', name: 'Setting Punch & V-Die Bending', category: 'SETUP', isPlanned: true },
  ],
  rejectReasons: [
    { code: 'REJ-BURR-DROSS', name: 'Dross / Terak Pemotongan Tebal', category: 'PROCESS' },
    { code: 'REJ-ANGLE-OFF', name: 'Sudut Tekukan Melenceng (> 0.5 deg)', category: 'DIMENSION' },
    { code: 'REJ-PAINT-BLISTER', name: 'Gelembung / Kulit Jeruk Powder Coat', category: 'SURFACE' },
  ],
};
