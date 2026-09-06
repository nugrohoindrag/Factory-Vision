import type { SeedIndustryDataset } from '../industry.types.js';

export const FOOD_BEVERAGE_DATASET: SeedIndustryDataset = {
  id: 'fnb',
  name: 'Makanan & Minuman (F&B)',
  code: 'IND-FNB',
  description: 'Proses mixing formulasi, batch pasteurisasi, rotary aseptic filling, capping, dan sleeve labeling.',
  companyName: 'PT Sukses Pangan Berjaya',
  warehouses: [
    { code: 'WH-ING-01', name: 'Gudang Bahan Baku & Gula', type: 'RAW_MATERIAL' },
    { code: 'WH-COLD-01', name: 'Cold Storage Room & Concentrate', type: 'COLD_STORAGE' },
    { code: 'WH-BEV-FG', name: 'Gudang Finished Goods Minuman Siap Kirim', type: 'FINISHED_GOODS' },
  ],
  workCenters: [
    { code: 'WC-MIX', name: 'Work Center Mixing & Blending', capacityPerShift: 15000 },
    { code: 'WC-FILL', name: 'Work Center Aseptic Rotary Filling', capacityPerShift: 18000 },
    { code: 'WC-PACK', name: 'Work Center Shrink Wrap & Secondary Packaging', capacityPerShift: 12000 },
  ],
  processes: [
    { code: 'PROC-BLEND', name: 'High-Shear Mixing & Dissolving', sequenceDefault: 1 },
    { code: 'PROC-UHT', name: 'UHT Pasteurization 138C 4s', sequenceDefault: 2 },
    { code: 'PROC-BOTTLE', name: 'Rotary Aseptic Bottle Filling', sequenceDefault: 3 },
    { code: 'PROC-LABEL', name: 'Shrink Sleeve Labeling & Date Coding', sequenceDefault: 4 },
  ],
  machines: [
    { code: 'TANK-MIX-5K', name: '316L Stainless Mixing Tank 5000L', idealCycleTimeSeconds: 2, workCenterCode: 'WC-MIX' },
    { code: 'UHT-PASTEUR', name: 'Tetra Therm Aseptic Flex UHT Unit', idealCycleTimeSeconds: 1, workCenterCode: 'WC-MIX' },
    { code: 'KRONES-FILL', name: 'Krones Isobaric Monoblock Filler 24-Head', idealCycleTimeSeconds: 0.8, workCenterCode: 'WC-FILL' },
    { code: 'SLEEVE-LABEL', name: 'Rotary Shrink Sleeve Applicator Fuji', idealCycleTimeSeconds: 0.9, workCenterCode: 'WC-PACK' },
    { code: 'PACK-WRAPPER', name: 'Robopac Matrix Case Packer & Shrink', idealCycleTimeSeconds: 3, workCenterCode: 'WC-PACK' },
  ],
  lines: [
    { code: 'LINE-PET-330', name: 'Lini Botol PET 330ml - 500ml' },
    { code: 'LINE-TETRA-250', name: 'Lini Aseptic Carton Brick 250ml' },
  ],
  shifts: [
    { name: 'Shift Pagi', startTime: '07:00', endTime: '15:00', breakMinutes: 60 },
    { name: 'Shift Siang', startTime: '15:00', endTime: '23:00', breakMinutes: 60 },
    { name: 'Shift Malam', startTime: '23:00', endTime: '07:00', breakMinutes: 60 },
  ],
  parts: [
    { sku: 'ING-RO-WATER', name: 'Air Demineralisasi RO UV-Treated', unit: 'LITER', category: 'RAW_MATERIAL', initialStock: 50000 },
    { sku: 'ING-SUGAR-REF', name: 'Gula Pasir Kristal Rafinasi R1', unit: 'KG', category: 'RAW_MATERIAL', initialStock: 12000 },
    { sku: 'ING-TEA-EXTRACT', name: 'Ekstrak Teh Hitam Premium Concentrate', unit: 'KG', category: 'RAW_MATERIAL', initialStock: 1500 },
    { sku: 'ING-CITRIC-ACID', name: 'Asam Sitrat Food Grade Anhydrous', unit: 'KG', category: 'RAW_MATERIAL', initialStock: 800 },
    { sku: 'PKG-PET-BTL-450', name: 'Botol PET 450ml Clear Food Grade', unit: 'PCS', category: 'PACKAGING', initialStock: 35000 },
    { sku: 'PKG-CAP-28MM', name: 'Tutup Botol HDPE 28mm Tamper-Evident', unit: 'PCS', category: 'PACKAGING', initialStock: 40000 },
    { sku: 'PKG-LABEL-SLEEV', name: 'Label Shrink Sleeve PVC 450ml Teh Melati', unit: 'ROLL', category: 'PACKAGING', initialStock: 80 },
    { sku: 'PKG-CARTON-24', name: 'Karton Box Corrugated Isi 24 Botol', unit: 'BOX', category: 'PACKAGING', initialStock: 2500 },
  ],
  products: [
    { sku: 'PRD-TEA-450ML', name: 'Teh Melati Segar Botol 450ml', unit: 'PCS', idealCycleTimeSeconds: 1.2, category: 'Ready-to-Drink Tea' },
    { sku: 'PRD-WATER-600ML', name: 'Air Mineral Alami Pegunungan 600ml', unit: 'PCS', idealCycleTimeSeconds: 0.8, category: 'Bottled Water' },
    { sku: 'PRD-JUICE-330ML', name: 'Minuman Jus Apel Bervitamin 330ml', unit: 'PCS', idealCycleTimeSeconds: 1.5, category: 'Juice & Fruit Drink' },
    { sku: 'PRD-MILK-250ML', name: 'Susu UHT Cokelat Siap Minum 250ml', unit: 'PCS', idealCycleTimeSeconds: 1.8, category: 'Dairy Beverage' },
  ],
  boms: [
    {
      bomNumber: 'BOM-FNB-001',
      productSku: 'PRD-TEA-450ML',
      bomName: 'BOM Teh Melati Botol 450ml',
      version: 'v1.0',
      status: 'ACTIVE',
      effectiveDate: '2026-01-01',
      description: 'Formulasi per botol teh melati siap saji 450ml termasuk botol dan cap.',
      items: [
        { componentPartSku: 'ING-RO-WATER', componentType: 'RAW_MATERIAL', quantity: 0.45, uom: 'LITER', scrapPercentage: 1.0, sequence: 1 },
        { componentPartSku: 'ING-SUGAR-REF', componentType: 'RAW_MATERIAL', quantity: 0.035, uom: 'KG', sequence: 2 },
        { componentPartSku: 'ING-TEA-EXTRACT', componentType: 'RAW_MATERIAL', quantity: 0.008, uom: 'KG', sequence: 3 },
        { componentPartSku: 'PKG-PET-BTL-450', componentType: 'PACKAGING', quantity: 1, uom: 'PCS', scrapPercentage: 0.5, sequence: 4 },
        { componentPartSku: 'PKG-CAP-28MM', componentType: 'PACKAGING', quantity: 1, uom: 'PCS', sequence: 5 },
      ],
    },
  ],
  customers: [
    { code: 'CUST-INDOMARCO', name: 'PT Indomarco Prismatama (Indomaret)', email: 'po@indomaret.co.id', phone: '+62-21-5080001', address: 'Ancol Barat, Jakarta Utara' },
    { code: 'CUST-SUMBER-ALF', name: 'PT Sumber Alfaria Trijaya Tbk (Alfamart)', email: 'orders@alfamart.co.id', phone: '+62-21-5570001', address: 'Cikokol, Tangerang' },
    { code: 'CUST-LION-SUPER', name: 'PT Lion Super Indo', email: 'procurement@superindo.co.id', phone: '+62-21-2920001', address: 'Pancoran, Jakarta Selatan' },
    { code: 'CUST-HYPERMART', name: 'PT Matahari Putra Prima Tbk (Hypermart)', email: 'merchandise@hypermart.co.id', phone: '+62-21-5460001', address: 'Lippo Karawaci, Tangerang' },
    { code: 'CUST-TRANS-RETAIL', name: 'PT Trans Retail Indonesia (Carrefour)', email: 'supply@transretail.co.id', phone: '+62-21-8290001', address: 'Lebak Bulus, Jakarta Selatan' },
  ],
  suppliers: [
    { code: 'SUP-SUGAR-JAWA', name: 'PT Kebun Tebu Mas', category: 'Refined Sugar', contact: 'sales@kebuntebumas.co.id' },
    { code: 'SUP-TEA-PERKEB', name: 'PT Perkebunan Nusantara VIII', category: 'Premium Black Tea', contact: 'ptpn8@ptpn.co.id' },
    { code: 'SUP-DYNA-PLAST', name: 'PT Dynaplast Preform', category: 'PET Preform Bottles', contact: 'sales@dynaplast.co.id' },
    { code: 'SUP-BERLINA-CAP', name: 'PT Berlina Tbk Closure', category: 'HDPE Bottle Closures', contact: 'info@berlina.co.id' },
    { code: 'SUP-INDAH-LABEL', name: 'PT Indah Kiat Label', category: 'Shrink Sleeve Film', contact: 'order@indahlabel.co.id' },
  ],
  routings: [
    { productSku: 'PRD-TEA-450ML', processCode: 'PROC-BLEND', sequence: 1, workCenterCode: 'WC-MIX', machineCode: 'TANK-MIX-5K', standardCycleTimeSeconds: 2 },
    { productSku: 'PRD-TEA-450ML', processCode: 'PROC-UHT', sequence: 2, workCenterCode: 'WC-MIX', machineCode: 'UHT-PASTEUR', standardCycleTimeSeconds: 1 },
    { productSku: 'PRD-TEA-450ML', processCode: 'PROC-BOTTLE', sequence: 3, workCenterCode: 'WC-FILL', machineCode: 'KRONES-FILL', standardCycleTimeSeconds: 0.8 },
    { productSku: 'PRD-TEA-450ML', processCode: 'PROC-LABEL', sequence: 4, workCenterCode: 'WC-PACK', machineCode: 'SLEEVE-LABEL', standardCycleTimeSeconds: 0.9 },
  ],
  orders: [
    { orderNumber: 'PO-INDO-2026-001', customerCode: 'CUST-INDOMARCO', productSku: 'PRD-TEA-450ML', quantity: 24000, unit: 'PCS', targetDays: 3 },
    { orderNumber: 'PO-ALFA-2026-002', customerCode: 'CUST-SUMBER-ALF', productSku: 'PRD-WATER-600ML', quantity: 36000, unit: 'PCS', targetDays: 2 },
  ],
  workOrders: [
    { woNumber: 'WO-FNB-2026-001', orderNumber: 'PO-INDO-2026-001', productSku: 'PRD-TEA-450ML', lineCode: 'LINE-PET-330', machineCode: 'KRONES-FILL', targetQuantity: 12000, unit: 'PCS', status: 'IN_PROGRESS' },
  ],
  downtimeReasons: [
    { code: 'DT-CIP-CLEAN', name: 'Cleaning-in-Place (CIP) Sanitasi Jalur', category: 'MAINTENANCE', isPlanned: true },
    { code: 'DT-CAP-JAM', name: 'Capper Sorter Botol Macet', category: 'MECHANICAL', isPlanned: false },
    { code: 'DT-CHANGE-FLAV', name: 'Changeover Varian Rasa & Flushing', category: 'SETUP', isPlanned: true },
  ],
  rejectReasons: [
    { code: 'REJ-SEAL-LEAK', name: 'Bocor Seal / Tutup Miring', category: 'PACKAGING' },
    { code: 'REJ-UNDER-FILL', name: 'Volume Cairan Kurang (Underfill)', category: 'PROCESS' },
    { code: 'REJ-LABEL-WRINK', name: 'Label Kerut / Shrinkage Cacat', category: 'PACKAGING' },
  ],
};
