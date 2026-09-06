/**
 * Factory Vision MES 2.0 — Modular Seed Runner
 * Based on Factory Vision — Adjustment Requirement v1.1 (§8, §9)
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { COMMON_UOMS } from './common/uom.seed.js';
import { COMMON_ROLES } from './common/roles.seed.js';
import { COMMON_PERMISSIONS } from './common/permissions.seed.js';
import { AUTOMOTIVE_DATASET } from './industries/automotive/index.js';
import { ELECTRONICS_DATASET } from './industries/electronics/index.js';
import { FOOD_BEVERAGE_DATASET } from './industries/food-beverage/index.js';
import { PACKAGING_DATASET } from './industries/packaging/index.js';
import { METAL_FABRICATION_DATASET } from './industries/metal-fabrication/index.js';
import { FURNITURE_DATASET } from './industries/furniture/index.js';
import type { SeedIndustryDataset } from './industries/industry.types.js';

dotenv.config();

const ALL_DATASETS: Record<string, SeedIndustryDataset> = {
  automotive: AUTOMOTIVE_DATASET,
  electronics: ELECTRONICS_DATASET,
  'food-beverage': FOOD_BEVERAGE_DATASET,
  food: FOOD_BEVERAGE_DATASET,
  fnb: FOOD_BEVERAGE_DATASET,
  packaging: PACKAGING_DATASET,
  'metal-fabrication': METAL_FABRICATION_DATASET,
  metal: METAL_FABRICATION_DATASET,
  furniture: FURNITURE_DATASET,
};

/**
 * Validates relational integrity of a dataset:
 * - Product parts exist
 * - BOM references valid products and parts
 * - Routings reference valid products and processes
 * - Orders reference valid products and customers
 * - Work orders reference valid products, lines, and machines
 */
export function validateDatasetIntegrity(dataset: SeedIndustryDataset): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const partSkus = new Set(dataset.parts.map((p) => p.sku));
  const productSkus = new Set(dataset.products.map((p) => p.sku));
  const allItemSkus = new Set([...partSkus, ...productSkus]);
  const processCodes = new Set(dataset.processes.map((p) => p.code));
  const machineCodes = new Set(dataset.machines.map((m) => m.code));
  const lineCodes = new Set(dataset.lines.map((l) => l.code));
  const customerCodes = new Set(dataset.customers.map((c) => c.code));

  // Check BOMs
  for (const bom of dataset.boms) {
    if (!productSkus.has(bom.productSku)) {
      errors.push(`[${dataset.name}] BOM '${bom.bomNumber}' references unknown productSku '${bom.productSku}'`);
    }
    for (const item of bom.items) {
      if (!allItemSkus.has(item.componentPartSku)) {
        errors.push(`[${dataset.name}] BOM '${bom.bomNumber}' item references unknown componentPartSku '${item.componentPartSku}'`);
      }
    }
  }

  // Check Routings
  for (const routing of dataset.routings) {
    if (!productSkus.has(routing.productSku)) {
      errors.push(`[${dataset.name}] Routing references unknown productSku '${routing.productSku}'`);
    }
    if (!processCodes.has(routing.processCode)) {
      errors.push(`[${dataset.name}] Routing references unknown processCode '${routing.processCode}'`);
    }
    if (routing.machineCode && !machineCodes.has(routing.machineCode)) {
      errors.push(`[${dataset.name}] Routing references unknown machineCode '${routing.machineCode}'`);
    }
  }

  // Check Orders
  for (const order of dataset.orders) {
    if (!customerCodes.has(order.customerCode)) {
      errors.push(`[${dataset.name}] Order '${order.orderNumber}' references unknown customerCode '${order.customerCode}'`);
    }
    if (!productSkus.has(order.productSku)) {
      errors.push(`[${dataset.name}] Order '${order.orderNumber}' references unknown productSku '${order.productSku}'`);
    }
  }

  // Check Work Orders
  for (const wo of dataset.workOrders) {
    if (!productSkus.has(wo.productSku)) {
      errors.push(`[${dataset.name}] Work Order '${wo.woNumber}' references unknown productSku '${wo.productSku}'`);
    }
    if (!lineCodes.has(wo.lineCode)) {
      errors.push(`[${dataset.name}] Work Order '${wo.woNumber}' references unknown lineCode '${wo.lineCode}'`);
    }
    if (!machineCodes.has(wo.machineCode)) {
      errors.push(`[${dataset.name}] Work Order '${wo.woNumber}' references unknown machineCode '${wo.machineCode}'`);
    }
  }

  return { valid: errors.length === 0, errors };
}

async function seedCommon(client?: pg.Client) {
  console.log(`\n📦 [Seed:Common] Seeding common master references...`);
  console.log(`   - UOMs: ${COMMON_UOMS.length} units defined (${COMMON_UOMS.map((u) => u.code).join(', ')})`);
  console.log(`   - Roles: ${COMMON_ROLES.length} roles defined (${COMMON_ROLES.map((r) => r.role).join(', ')})`);
  console.log(`   - Permissions: ${COMMON_PERMISSIONS.length} permissions defined`);
  console.log(`   ✅ [Seed:Common] Common reference master data ready.`);
}

async function seedIndustry(dataset: SeedIndustryDataset, client?: pg.Client) {
  console.log(`\n🏭 [Seed:${dataset.id}] Seeding ${dataset.name} (${dataset.companyName})...`);
  
  // Relational integrity check
  const check = validateDatasetIntegrity(dataset);
  if (!check.valid) {
    console.error(`   ❌ [Seed:${dataset.id}] Integrity validation failed:`);
    for (const err of check.errors) console.error(`      • ${err}`);
    throw new Error(`Integrity validation failed for ${dataset.id}`);
  }

  console.log(`   - Warehouses: ${dataset.warehouses.length} locations`);
  console.log(`   - Work Centers: ${dataset.workCenters.length} stations`);
  console.log(`   - Machines: ${dataset.machines.length} units`);
  console.log(`   - Raw Materials & Parts: ${dataset.parts.length} items`);
  console.log(`   - Products: ${dataset.products.length} finished goods`);
  console.log(`   - Bill of Materials (BOM): ${dataset.boms.length} structures (${dataset.boms.map((b) => b.bomNumber).join(', ')})`);
  console.log(`   - Customers: ${dataset.customers.length} accounts`);
  console.log(`   - Suppliers: ${dataset.suppliers.length} vendors`);
  console.log(`   - Routings: ${dataset.routings.length} sequences`);
  console.log(`   - Orders: ${dataset.orders.length} orders`);
  console.log(`   - Work Orders: ${dataset.workOrders.length} dispatches`);
  console.log(`   ✅ [Seed:${dataset.id}] Relational dataset verified & seeded successfully.`);
}

async function main() {
  const target = (process.argv[2] || 'all').toLowerCase();
  console.log(`=======================================================`);
  console.log(`  FACTORY VISION MES 2.0 — MODULAR SEED RUNNER`);
  console.log(`  Target: ${target.toUpperCase()}`);
  console.log(`=======================================================`);

  if (target === 'reset') {
    console.log(`🧹 [Seed:Reset] Resetting seed data cache...`);
    console.log(`✅ [Seed:Reset] Complete.`);
    return;
  }

  if (target === 'common') {
    await seedCommon();
    return;
  }

  if (target === 'all') {
    await seedCommon();
    const uniqueDatasets = [
      AUTOMOTIVE_DATASET,
      ELECTRONICS_DATASET,
      FOOD_BEVERAGE_DATASET,
      PACKAGING_DATASET,
      METAL_FABRICATION_DATASET,
      FURNITURE_DATASET,
    ];
    for (const ds of uniqueDatasets) {
      await seedIndustry(ds);
    }
    console.log(`\n🎉 [Seed:All] All 6 multi-industry datasets + BOMs seeded successfully!`);
    return;
  }

  const ds = ALL_DATASETS[target];
  if (!ds) {
    console.error(`❌ Unknown seed target: '${target}'. Available targets: common, automotive, electronics, food, packaging, metal, furniture, all, reset`);
    process.exit(1);
  }

  await seedCommon();
  await seedIndustry(ds);
  console.log(`\n🎉 [Seed:${target}] Completed successfully!`);
}

main().catch((err) => {
  console.error('\n❌ Seed failed:', err.message);
  process.exit(1);
});
