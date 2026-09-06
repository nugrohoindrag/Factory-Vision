import type {
  BillOfMaterialStatus,
  BomComponentType,
  DowntimeCategory,
  RejectCategory,
} from '@factory-vision/domain-types';

export interface SeedPart {
  sku: string;
  name: string;
  unit: string;
  category: 'RAW_MATERIAL' | 'COMPONENT' | 'SUB_ASSEMBLY' | 'PACKAGING';
  initialStock: number;
}

export interface SeedProduct {
  sku: string;
  name: string;
  unit: string;
  idealCycleTimeSeconds: number;
  category: string;
}

export interface SeedBomItem {
  componentPartSku: string;
  componentType: BomComponentType;
  quantity: number;
  uom: string;
  scrapPercentage?: number;
  sequence?: number;
  notes?: string;
}

export interface SeedBom {
  bomNumber: string;
  productSku: string;
  bomName: string;
  version: string;
  status: BillOfMaterialStatus;
  effectiveDate: string;
  description?: string;
  items: SeedBomItem[];
}

export interface SeedMachine {
  code: string;
  name: string;
  idealCycleTimeSeconds: number;
  workCenterCode: string;
}

export interface SeedWorkCenter {
  code: string;
  name: string;
  capacityPerShift: number;
}

export interface SeedProcess {
  code: string;
  name: string;
  sequenceDefault: number;
}

export interface SeedRouting {
  productSku: string;
  processCode: string;
  sequence: number;
  workCenterCode?: string;
  machineCode?: string;
  standardCycleTimeSeconds?: number;
}

export interface SeedCustomer {
  code: string;
  name: string;
  email: string;
  phone: string;
  address: string;
}

export interface SeedSupplier {
  code: string;
  name: string;
  category: string;
  contact: string;
}

export interface SeedOrder {
  orderNumber: string;
  customerCode: string;
  productSku: string;
  quantity: number;
  unit: string;
  targetDays: number;
}

export interface SeedWorkOrder {
  woNumber: string;
  orderNumber: string;
  productSku: string;
  lineCode: string;
  machineCode: string;
  targetQuantity: number;
  unit: string;
  status: 'DRAFT' | 'RELEASED' | 'IN_PROGRESS' | 'COMPLETED';
}

export interface SeedIndustryDataset {
  id: string;
  name: string;
  code: string;
  description: string;
  companyName: string;
  warehouses: Array<{ code: string; name: string; type: string }>;
  workCenters: SeedWorkCenter[];
  processes: SeedProcess[];
  machines: SeedMachine[];
  lines: Array<{ code: string; name: string }>;
  shifts: Array<{ name: string; startTime: string; endTime: string; breakMinutes: number }>;
  parts: SeedPart[];
  products: SeedProduct[];
  boms: SeedBom[];
  customers: SeedCustomer[];
  suppliers: SeedSupplier[];
  routings: SeedRouting[];
  orders: SeedOrder[];
  workOrders: SeedWorkOrder[];
  downtimeReasons: Array<{ code: string; name: string; category: DowntimeCategory; isPlanned: boolean }>;
  rejectReasons: Array<{ code: string; name: string; category: RejectCategory }>;
}
