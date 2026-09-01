import { isDatabaseConfigured, withTenant, queryOne } from './db/pool.js';
import { MasterDataRepository } from '../modules/master-data/master-data.repository.js';
import type { MasterDataService } from '../modules/master-data/master-data.service.js';
import type { ProductionService } from '../modules/production/production.service.js';
import type { ShopFloorService } from '../modules/shopfloor/shopfloor.service.js';
import type { HistoryLineSpec } from '../modules/shopfloor/history.seed.js';

/**
 * Everything that must be true before the API serves its first request.
 *
 * PostgreSQL is not optional any more. Production records, downtime, work
 * orders and their totals are the MES system of record, and an API that
 * accepted them into memory would be telling the shop floor their work was
 * captured while a restart was about to erase it. Refusing to start is the
 * honest failure: an operator finds out at the start of the shift instead of
 * at the end of it.
 */
export async function assertDatabaseReady(): Promise<void> {
  if (!isDatabaseConfigured()) {
    throw new Error(
      'DATABASE_URL is not set. The MES stores production records, downtime and work orders in ' +
        'PostgreSQL; without it nothing the shop floor captures would survive a restart, so the API ' +
        'will not start. See deploy/DEPLOYMENT.md.'
    );
  }

  const row = await queryOne<{ count: string }>(
    "SELECT count(*)::text AS count FROM information_schema.tables WHERE table_name = 'production_record'"
  );
  if (!row || row.count === '0') {
    throw new Error(
      'The production_record table is missing. Run `pnpm db:migrate` before starting the API.'
    );
  }
}

/**
 * Makes sure the tenant row exists.
 *
 * Every table in the schema has a foreign key to `tenant`, so nothing — not a
 * shift, not a user, not a production record — can be written before this row
 * does. It runs on every boot, demo data or not: a real install starts empty
 * but still needs somewhere to put its first shift.
 */
export async function ensureTenant(tenantId: string): Promise<void> {
  await withTenant(tenantId, (client) =>
    client.query(
      `INSERT INTO tenant (id, name, timezone, plan, status)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [tenantId, 'Factory Vision Tenant', process.env.TZ || 'Asia/Jakarta', 'MID_MARKET', 'ACTIVE']
    )
  );
}

/**
 * Rebuilds the caches the API reads synchronously from what PostgreSQL holds.
 *
 * Shifts, operators, users and roles are read on the hot path — a shift
 * decides a production record's `shift_date`, a role decides whether a request
 * is allowed — so they are served from memory. This is what makes that memory
 * a projection of the database rather than the record itself, and it is why a
 * restart no longer resets them.
 */
export async function hydrateReferenceData(
  tenantId: string,
  services: {
    masterData: MasterDataService;
    rbac: { hydrate(tenantId: string): Promise<number> };
    auth: { hydrateCredentials(tenantId: string): { users: number; operators: number } };
  }
): Promise<{ shifts: number; operators: number; users: number; roles: number; credentials: number }> {
  const counts = await services.masterData.hydrate(tenantId);
  const roles = await services.rbac.hydrate(tenantId);
  const credentials = services.auth.hydrateCredentials(tenantId);
  return {
    ...counts,
    roles,
    credentials: credentials.users + credentials.operators,
  };
}

/**
 * Writes the demo tyre plant into PostgreSQL, in foreign-key order.
 *
 * Order matters and is not incidental: `production_batch` references
 * `production_order`, and `work_order` references both plus `product`,
 * `production_process` and `production_line`. Doing this in one transaction
 * means a half-seeded plant never becomes visible.
 *
 * Everything is an upsert or a `DO NOTHING`, so a second boot adds nothing and,
 * more importantly, does not reset a work order the shop floor has advanced.
 */
export async function seedDemoPlant(
  tenantId: string,
  services: {
    masterData: MasterDataService;
    production: ProductionService;
  }
): Promise<{ plants: number; lines: number; products: number; productionOrders: number; workOrders: number; batches: number }> {
  const masterDataRepo = new MasterDataRepository();

  return withTenant(tenantId, async (client) => {
    const reference = await masterDataRepo.syncReferenceData(client, services.masterData, tenantId);
    const productionOrders = await services.production.seedDemoProductionOrders(client, tenantId);

    // Work orders and batches are no longer hydrated from the in-memory demo
    // lists. Since Sprint 2 a work order requires a Production Plan Line and a
    // batch requires an owning work order (ADR-29), and those in-memory rows
    // predate both — they name plan lines and products that no plan covers, and
    // the only work orders left for their batches to sit on already carry
    // direct production records, which E1/E2 forbids. `db/seeds` builds the
    // whole plan → plan line → work order → batch chain coherently, and is now
    // the single source of the demo plant's production data.
    const workOrders = 0;
    const batches = 0;

    return { ...reference, productionOrders, workOrders, batches };
  });
}

/**
 * The deterministic shop-floor back-catalogue behind the Executive Dashboard's
 * trend and previous-period figures, so they aggregate from real records
 * rather than being fabricated in the browser.
 */
export async function seedDemoHistory(
  tenantId: string,
  services: {
    masterData: MasterDataService;
    production: ProductionService;
    shopFloor: ShopFloorService;
  }
): Promise<{ productionCount: number; downtimeCount: number }> {
  const workOrders = await services.production.getWorkOrders(tenantId);
  const lines = services.masterData.getLines(tenantId).filter((l) => l.status === 'ACTIVE');
  const operators = services.masterData.getOperators(tenantId);
  const products = services.masterData.getProducts(tenantId);

  // A parent work order is a SPLIT container: its children hold the production,
  // and `ck_prod_record_not_parent` refuses any record written against it (E3).
  const executable = workOrders.filter((wo) => !wo.hasChildWorkOrder);

  const historyLines: HistoryLineSpec[] = await Promise.all(
    executable.map(async (wo) => {
    const product = products.find((p) => p.id === wo.productId);
    // A batch-managed work order takes its output through a batch, so the
    // history has to name one. Resolved from the database rather than assumed:
    // the composite foreign key compares the record's mode against the work
    // order's, and a batch-managed order with no batch cannot be seeded at all.
    let batchId: string | undefined;
    if (wo.isBatchManaged) {
      const batches = await services.production.getBatchesForWorkOrder(tenantId, wo.id);
      batchId = batches[0]?.id;
      if (!batchId) {
        throw new Error(
          `Work order ${wo.id} is batch-managed but owns no batch; demo history cannot be seeded (ADR-35 E1)`
        );
      }
    }
    return {
      lineId: wo.lineId,
      processId: wo.processId,
      batchId,
      isBatchManaged: Boolean(wo.isBatchManaged),
      machineId: wo.machineId,
      workOrderId: wo.id,
      operatorId: operators[0]?.id ?? 'op-001',
      //, Alpha is the good performer, Beta the average one, and Gamma
      // (the pilot validation line) the under-performer the drill-down finds.
      profile: wo.lineId === 'line-01' ? 'GOOD' : wo.lineId === 'line-02' ? 'AVERAGE' : 'POOR',
      dailyTarget: wo.plannedQuantity,
      // The generator must bound output with the very rate the OEE engine
      // later divides by. Resolving both through `resolveIdealCycleSeconds` is
      // what keeps Performance believable: a seed that produced at 750 s/unit
      // while the engine measured against 30 s/unit reported a 21%
      // Performance that no factory would recognise.
      idealCycleSeconds:
        services.masterData.resolveIdealCycleSeconds(tenantId, wo.productId, wo.machineId) ??
        product?.idealCycleTimeSeconds ??
        120,
    };
    })
  );

  return services.shopFloor.seedHistory({
    tenantId,
    anchorDate: '2026-08-28',
    days: 60,
    shiftId: 'shift-1',
    plannedProductionMinutes: lines[0]?.plannedProductionTimeMinutes ?? 480,
    lines: historyLines,
    // Pilot Tire Factory Downtime & Reject Reasons
    downtimeReasonIds: ['dt-breakdown', 'dt-material', 'dt-setup', 'dt-cleaning', 'dt-qc-wait', 'dt-operator'],
    rejectReasonIds: ['rej-dimension', 'rej-blister', 'rej-scratch', 'rej-flash', 'rej-distortion', 'rej-other'],
  });
}
