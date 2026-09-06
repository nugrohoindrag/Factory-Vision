import type { SeedIndustryDataset } from '../industry.types.js';

export const PACKAGING_DATASET: SeedIndustryDataset = {
  id: 'packaging',
  name: 'Kemasan & Percetakan Industri (Packaging)',
  code: 'IND-PACK',
  description: 'Pembuatan kardus corrugated, cetak offset karton, flexographic printing, die-cutting, dan auto-gluing.',
  companyName: 'PT Nusantara Kemas Mandiri',
  warehouses: [
    { code: 'WH-PAPER-01', name: 'Gudang Roll Kertas Kraft & Corrugated Sheet', type: 'RAW_MATERIAL' },
    { code: 'WH-CARTON-FG', name: 'Gudang Karton Box Jadi Siap Kirim', type: 'FINISHED_GOODS' },
  ],
  workCenters: [
    { code: 'WC-CORR', name: 'Work Center Corrugator & Fluting', capacityPerShift: 8000 },
    { code: 'WC-PRINT', name: 'Work Center Flexo / Offset Printing', capacityPerShift: 10000 },
    { code: 'WC-DIECUT', name: 'Work Center Die-Cutting & Creasing', capacityPerShift: 7500 },
    { code: 'WC-GLUE', name: 'Work Center Folder Gluer & Bundling', capacityPerShift: 9000 },
  ],
  processes: [
    { code: 'PROC-CORRUGATE', name: 'Corrugating & Fluting Bonding', sequenceDefault: 1 },
    { code: 'PROC-FLEXOPRINT', name: '4-Color Flexographic Printing', sequenceDefault: 2 },
    { code: 'PROC-ROTARYCUT', name: 'Rotary Die-Cutting & Creasing', sequenceDefault: 3 },
    { code: 'PROC-FOLDGLUE', name: 'High-Speed Folding & Gluing', sequenceDefault: 4 },
  ],
  machines: [
    { code: 'FLEXO-HEIDEL-01', name: 'Heidelberg Speedmaster XL 106 6-Color', idealCycleTimeSeconds: 0.5, workCenterCode: 'WC-PRINT' },
    { code: 'BOBST-DIECUT-02', name: 'BOBST Novacut 106 E Autoplaten Die-Cutter', idealCycleTimeSeconds: 0.6, workCenterCode: 'WC-DIECUT' },
    { code: 'BOBST-GLUER-03', name: 'BOBST Expertfold 110 Folder Gluer', idealCycleTimeSeconds: 0.4, workCenterCode: 'WC-GLUE' },
    { code: 'CORRUGATOR-BHS', name: 'BHS Corrugated Line 2.5m 3-Ply', idealCycleTimeSeconds: 1.0, workCenterCode: 'WC-CORR' },
  ],
  lines: [
    { code: 'LINE-BOX-A', name: 'Lini Cetak Box Master Karton Heavy-Duty' },
    { code: 'LINE-BOX-B', name: 'Lini Folding Carton Consumer Goods' },
  ],
  shifts: [
    { name: 'Shift Pagi', startTime: '07:00', endTime: '15:00', breakMinutes: 60 },
    { name: 'Shift Siang', startTime: '15:00', endTime: '23:00', breakMinutes: 60 },
    { name: 'Shift Malam', startTime: '23:00', endTime: '07:00', breakMinutes: 60 },
  ],
  parts: [
    { sku: 'RAW-KRAFT-150', name: 'Roll Kertas Kraft Liner 150 GSM', unit: 'KG', category: 'RAW_MATERIAL', initialStock: 45000 },
    { sku: 'RAW-MED-FLUTE', name: 'Roll Kertas Medium Fluting 125 GSM', unit: 'KG', category: 'RAW_MATERIAL', initialStock: 38000 },
    { sku: 'CHEM-INK-CYAN', name: 'Tinta Water-Based Flexo Cyan Food Grade', unit: 'KG', category: 'RAW_MATERIAL', initialStock: 1200 },
    { sku: 'CHEM-INK-BLACK', name: 'Tinta Water-Based Flexo Black High Density', unit: 'KG', category: 'RAW_MATERIAL', initialStock: 1800 },
    { sku: 'CHEM-GLUE-PVA', name: 'Lem PVA High Tack Carton Adhesive', unit: 'KG', category: 'RAW_MATERIAL', initialStock: 2500 },
    { sku: 'PKG-STRAP-PP', name: 'Tali Strapping PP 12mm Roll', unit: 'ROLL', category: 'PACKAGING', initialStock: 150 },
  ],
  products: [
    { sku: 'PRD-BOX-MASTER', name: 'Corrugated Master Box 60x40x40cm Single Wall', unit: 'PCS', idealCycleTimeSeconds: 1.2, category: 'Corrugated' },
    { sku: 'PRD-BOX-ECOM', name: 'Mailbox Karton E-Commerce Die-Cut Self-Locking', unit: 'PCS', idealCycleTimeSeconds: 0.8, category: 'Die-Cut Box' },
    { sku: 'PRD-CARTON-FMCG', name: 'Printed Folding Carton Kemasan Makanan Ringan', unit: 'PCS', idealCycleTimeSeconds: 0.5, category: 'Folding Carton' },
    { sku: 'PRD-BAG-KRAFT', name: 'Paper Bag Kraft Cokelat Handle Tali Twisted', unit: 'PCS', idealCycleTimeSeconds: 1.5, category: 'Paper Bags' },
  ],
  boms: [
    {
      bomNumber: 'BOM-PACK-001',
      productSku: 'PRD-BOX-MASTER',
      bomName: 'BOM Master Corrugated Box 60x40x40cm',
      version: 'v1.0',
      status: 'ACTIVE',
      effectiveDate: '2026-01-01',
      description: 'Pemakaian kertas liner, medium fluting, tinta cetak logo, dan lem bonding.',
      items: [
        { componentPartSku: 'RAW-KRAFT-150', componentType: 'RAW_MATERIAL', quantity: 0.65, uom: 'KG', scrapPercentage: 2.0, sequence: 1 },
        { componentPartSku: 'RAW-MED-FLUTE', componentType: 'RAW_MATERIAL', quantity: 0.45, uom: 'KG', scrapPercentage: 2.0, sequence: 2 },
        { componentPartSku: 'CHEM-INK-BLACK', componentType: 'RAW_MATERIAL', quantity: 0.008, uom: 'KG', sequence: 3 },
        { componentPartSku: 'CHEM-GLUE-PVA', componentType: 'RAW_MATERIAL', quantity: 0.015, uom: 'KG', sequence: 4 },
      ],
    },
    {
      bomNumber: 'BOM-PACK-002',
      productSku: 'PRD-BOX-ECOM',
      bomName: 'BOM E-Commerce Mailbox Self-Locking',
      version: 'v1.0',
      status: 'ACTIVE',
      effectiveDate: '2026-01-01',
      description: 'Box lipat e-commerce tanpa lem perekat luar.',
      items: [
        { componentPartSku: 'RAW-KRAFT-150', componentType: 'RAW_MATERIAL', quantity: 0.32, uom: 'KG', sequence: 1 },
        { componentPartSku: 'RAW-MED-FLUTE', componentType: 'RAW_MATERIAL', quantity: 0.22, uom: 'KG', sequence: 2 },
        { componentPartSku: 'CHEM-INK-BLACK', componentType: 'RAW_MATERIAL', quantity: 0.004, uom: 'KG', sequence: 3 },
      ],
    },
  ],
  customers: [
    { code: 'CUST-UNILEVER', name: 'PT Unilever Indonesia Tbk', email: 'pack.orders@unilever.com', phone: '+62-21-5262112', address: 'BSD City, Tangerang' },
    { code: 'CUST-MAYORA', name: 'PT Mayora Indah Tbk', email: 'procurement@mayora.co.id', phone: '+62-21-8065000', address: 'Daan Mogot, Jakarta Barat' },
    { code: 'CUST-SHOPEE-LOG', name: 'Shopee Express Fulfillment Center', email: 'spx.vendor@shopee.co.id', phone: '+62-21-3950000', address: 'Sunter Agung, Jakarta Utara' },
    { code: 'CUST-TOKOPEDIA-F', name: 'Tokopedia Dilayani Toko Logistics', email: 'logistics@tokopedia.com', phone: '+62-21-8064700', address: 'Cakung, Jakarta Timur' },
    { code: 'CUST-INDORAMA', name: 'PT Indorama Synthetics Tbk', email: 'supply@indorama.com', phone: '+62-21-5260200', address: 'Kuningan, Jakarta Selatan' },
  ],
  suppliers: [
    { code: 'SUP-IKPP', name: 'PT Indah Kiat Pulp & Paper Tbk (APP)', category: 'Industrial Paper Mills', contact: 'sales@app.co.id' },
    { code: 'SUP-FAJAR-PAPER', name: 'PT Fajar Surya Wisesa Tbk', category: 'Recycled Kraft & Fluting', contact: 'marketing@fajarpaper.com' },
    { code: 'SUP-DIC-INK', name: 'PT DIC Graphics Indonesia', category: 'Flexo & Gravure Inks', contact: 'order@dicgraphics.co.id' },
    { code: 'SUP-HENKEL-ADH', name: 'Henkel Adhesives Indonesia', category: 'Packaging Glues & Polymers', contact: 'henkel.indo@henkel.com' },
    { code: 'SUP-MEGABAND', name: 'PT Megaband Packaging Tape', category: 'Strapping Band & Tape', contact: 'sales@megaband.co.id' },
  ],
  routings: [
    { productSku: 'PRD-BOX-MASTER', processCode: 'PROC-CORRUGATE', sequence: 1, workCenterCode: 'WC-CORR', machineCode: 'CORRUGATOR-BHS', standardCycleTimeSeconds: 1.0 },
    { productSku: 'PRD-BOX-MASTER', processCode: 'PROC-FLEXOPRINT', sequence: 2, workCenterCode: 'WC-PRINT', machineCode: 'FLEXO-HEIDEL-01', standardCycleTimeSeconds: 0.5 },
    { productSku: 'PRD-BOX-MASTER', processCode: 'PROC-ROTARYCUT', sequence: 3, workCenterCode: 'WC-DIECUT', machineCode: 'BOBST-DIECUT-02', standardCycleTimeSeconds: 0.6 },
    { productSku: 'PRD-BOX-MASTER', processCode: 'PROC-FOLDGLUE', sequence: 4, workCenterCode: 'WC-GLUE', machineCode: 'BOBST-GLUER-03', standardCycleTimeSeconds: 0.4 },
  ],
  orders: [
    { orderNumber: 'PO-UNILEVER-001', customerCode: 'CUST-UNILEVER', productSku: 'PRD-BOX-MASTER', quantity: 50000, unit: 'PCS', targetDays: 4 },
    { orderNumber: 'PO-SHOPEE-002', customerCode: 'CUST-SHOPEE-LOG', productSku: 'PRD-BOX-ECOM', quantity: 25000, unit: 'PCS', targetDays: 3 },
  ],
  workOrders: [
    { woNumber: 'WO-PACK-2026-001', orderNumber: 'PO-UNILEVER-001', productSku: 'PRD-BOX-MASTER', lineCode: 'LINE-BOX-A', machineCode: 'FLEXO-HEIDEL-01', targetQuantity: 20000, unit: 'PCS', status: 'IN_PROGRESS' },
  ],
  downtimeReasons: [
    { code: 'DT-PLATE-WASH', name: 'Pembersihan Plate Cetak Flexo', category: 'MAINTENANCE', isPlanned: true },
    { code: 'DT-DIE-CHANGE', name: 'Pergantian Pisau Pond / Die Board', category: 'SETUP', isPlanned: true },
    { code: 'DT-PAPER-BREAK', name: 'Putus Kertas Roll (Web Break)', category: 'MATERIAL', isPlanned: false },
  ],
  rejectReasons: [
    { code: 'REJ-PRINT-MISREG', name: 'Miss-Registration Cetak Warna Bergeser', category: 'PROCESS' },
    { code: 'REJ-SLIT-CRUSH', name: 'Fluting Kempes / Crushed Flute', category: 'MATERIAL_DEFECT' },
    { code: 'REJ-GLUE-OPEN', name: 'Joint Lem Lepas / Debonding', category: 'WORKMANSHIP' },
  ],
};
