/**
 * End-to-end sanity check for the Sprint 3–6 planning flow.
 *
 * Drives the real services against the real database, in the order a PPIC
 * planner would: customer → order → forecast → capacity → plan → demand →
 * work orders → confirm. It is a smoke test, not the QA suite: it proves the
 * pieces fit together and the invariants bite, so the next sprint can build on
 * them.
 *
 *   node --import tsx scripts/verify-planning-flow.mjs
 *
 * Everything it writes is prefixed `VERIFY-` and removed at the end, so it can
 * be run repeatedly against a development database.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../../.env') });

const { withTenant, closePool } = await import('../src/platform/db/pool.ts');
const { CustomerService } = await import('../src/modules/planning/application/customer.service.ts');
const { CustomerOrderService } = await import(
  '../src/modules/planning/application/customer-order.service.ts'
);
const { DemandForecastService } = await import(
  '../src/modules/planning/application/demand-forecast.service.ts'
);
const { CapacityPlanService } = await import(
  '../src/modules/planning/application/capacity-plan.service.ts'
);
const { ProductionPlanService } = await import(
  '../src/modules/planning/application/production-plan.service.ts'
);
const { JobRunner } = await import('@factory-vision/job-queue');
const { getJobQueue, createPlanningJobHandlers } = await import(
  '../src/platform/queue/index.ts'
);
const { WorkOrderGenerationService } = await import(
  '../src/modules/production/work-order-generation.service.ts'
);
const { PlanningFacade } = await import('../src/modules/planning/public/index.ts');

const TENANT = process.env.VERIFY_TENANT || 'tenant-pilot-factory-01';
const ACTOR = 'verify-script';

let passed = 0;
let failed = 0;

function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function expectRejection(label, fn, matcher) {
  try {
    await fn();
    failed += 1;
    console.error(`  FAIL  ${label} — tidak ditolak`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (matcher && !matcher.test(message)) {
      failed += 1;
      console.error(`  FAIL  ${label} — pesan tidak sesuai: ${message}`);
    } else {
      passed += 1;
      console.log(`  PASS  ${label}`);
    }
  }
}

const customers = new CustomerService();
const orders = new CustomerOrderService();
const forecasts = new DemandForecastService();
const capacity = new CapacityPlanService();
const plans = new ProductionPlanService();
const generator = new WorkOrderGenerationService();
const runner = new JobRunner({
  queue: getJobQueue(),
  handlers: await createPlanningJobHandlers(),
  label: 'verify-planning-flow',
});
const facade = new PlanningFacade();

const created = { customerId: null, orderIds: [], planIds: [] };

async function cleanup() {
  await withTenant(TENANT, async (client) => {
    for (const planId of created.planIds) {
      await client.query(
        `DELETE FROM work_order WHERE tenant_id = $1 AND production_plan_line_id IN
           (SELECT id FROM production_plan_line WHERE production_plan_id = $2)`,
        [TENANT, planId]
      );
      await client.query('DELETE FROM production_plan WHERE tenant_id = $1 AND id = $2', [TENANT, planId]);
    }
    for (const orderId of created.orderIds) {
      await client.query('DELETE FROM customer_order WHERE tenant_id = $1 AND id = $2', [TENANT, orderId]);
    }
    if (created.customerId) {
      await client.query('DELETE FROM customer WHERE tenant_id = $1 AND id = $2', [TENANT, created.customerId]);
    }
    await client.query(
      `DELETE FROM demand_forecast WHERE tenant_id = $1 AND forecast_number LIKE 'FC-%'
        AND generated_by = $2`,
      [TENANT, ACTOR]
    );
    await client.query(
      `DELETE FROM planning_job WHERE tenant_id = $1 AND requested_by = $2`,
      [TENANT, ACTOR]
    );
    await client.query(
      `DELETE FROM audit_log WHERE tenant_id = $1 AND actor_id = $2`,
      [TENANT, ACTOR]
    );
    await client.query(
      `DELETE FROM outbox_event WHERE tenant_id = $1 AND aggregate_id = ANY($2)`,
      [TENANT, [...created.orderIds, ...created.planIds]]
    );
  });
}

try {
  // --- Master data the flow needs ------------------------------------
  const product = await withTenant(TENANT, async (client) => {
    const result = await client.query(
      `SELECT p.id, p.sku FROM product p
        WHERE p.tenant_id = $1 AND p.status = 'ACTIVE'
          AND EXISTS (SELECT 1 FROM product_routing r WHERE r.product_id = p.id AND r.active)
        ORDER BY p.sku LIMIT 1`,
      [TENANT]
    );
    return result.rows[0];
  });

  if (!product) {
    console.error('Tidak ada product aktif dengan routing pada tenant ini; jalankan pnpm db:seed lebih dahulu.');
    process.exit(1);
  }
  console.log(`\nProduct uji: ${product.sku} (${product.id})\n`);

  // --- MES-029 Customer master --------------------------------------
  console.log('MES-029 Customer master');
  const customer = await customers.create(
    TENANT,
    {
      code: `VERIFY-${Date.now().toString().slice(-6)}`,
      name: 'VERIFY Customer Sanity',
      picName: 'Budi',
      deliveryAddress: 'Kawasan Industri MM2100',
      dockNumber: 'D-04',
    },
    ACTOR
  );
  created.customerId = customer.id;
  check('customer dibuat dengan code unik', customer.status === 'ACTIVE');

  await expectRejection(
    'code duplikat ditolak',
    () => customers.create(TENANT, { code: customer.code, name: 'Duplikat' }, ACTOR),
    /sudah ada/i
  );

  // --- MES-021 / MES-022 Customer Order + lines ----------------------
  console.log('\nMES-021 / MES-022 Customer Order');
  const order = await orders.create(
    TENANT,
    {
      customerId: customer.id,
      orderChannel: 'PO_DOCUMENT',
      requestedDeliveryDate: '2026-10-15',
      poNumber: 'PO-VERIFY-1',
      lines: [{ productId: product.id, orderedQuantity: 5000 }],
    },
    ACTOR
  );
  created.orderIds.push(order.id);
  check('order number CO-YYMMDD-NNN', /^CO-\d{6}-\d{3}$/.test(order.orderNumber), order.orderNumber);
  check('status awal RECEIVED', order.status === 'RECEIVED');
  check('order line tersimpan', order.lines.length === 1 && order.lines[0].orderedQuantity === 5000);
  check('order channel tersimpan', order.orderChannel === 'PO_DOCUMENT');
  check(
    'delivery address diturunkan dari customer',
    order.deliveryAddress === 'Kawasan Industri MM2100'
  );

  const secondLine = await orders.addLine(
    TENANT,
    order.id,
    { productId: product.id, orderedQuantity: 1500 },
    ACTOR
  );
  check('order line kedua bertambah dengan line_no berurutan', secondLine.lineNo === 2);

  await expectRejection(
    'product tidak aktif / tidak dikenal ditolak',
    () => orders.addLine(TENANT, order.id, { productId: 'tidak-ada', orderedQuantity: 10 }, ACTOR),
    /tidak ditemukan/i
  );

  // --- MES-025 Dokumen ------------------------------------------------
  console.log('\nMES-025 Dokumen order');
  const doc = await orders.attachDocument(
    TENANT,
    order.id,
    {
      fileName: 'po-verify.csv',
      contentType: 'text/csv',
      sizeBytes: 12,
      content: Buffer.from('sku,qty\nA,10\n').toString('base64'),
    },
    ACTOR
  );
  check('dokumen tersimpan dan mengembalikan URL', Boolean(doc.storageUrl));
  const objectId = doc.storageUrl.split('/').at(-2);
  const content = await orders.readDocumentContent(TENANT, objectId);
  check('dokumen dapat dibaca kembali', content.buffer.toString().includes('sku,qty'));

  try {
    await orders.attachDocument(
      TENANT,
      order.id,
      { fileName: 'x.exe', contentType: 'application/x-msdownload', sizeBytes: 10, content: 'AA==' },
      ACTOR
    );
    check('tipe file tidak didukung ditolak dengan pesan', false, 'tidak ditolak');
  } catch (error) {
    // The envelope carries the headline; the cause is a per-field error, which
    // is what the form renders beside the file input (MES-023).
    const fields = error.fields ?? [];
    check(
      'tipe file tidak didukung ditolak dengan pesan per field',
      fields.some((f) => f.field === 'contentType' && /tidak didukung/i.test(f.message)),
      JSON.stringify(fields)
    );
  }

  // --- MES-027 / MES-028 Forecast ------------------------------------
  console.log('\nMES-027 / MES-028 Demand Forecast');
  // Backdate two orders into completed months so the average has something to
  // average. The order created above is dated today and is deliberately
  // excluded: the current month never counts (MES-027).
  const historyMonths = [];
  await withTenant(TENANT, async (client) => {
    for (let back = 1; back <= 2; back += 1) {
      const d = new Date();
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() - back);
      const day = d.toISOString().slice(0, 10);
      historyMonths.push(day.slice(0, 7));
      const orderId = `co-verify-hist-${back}`;
      created.orderIds.push(orderId);
      await client.query(
        `INSERT INTO customer_order (id, tenant_id, order_number, customer_id, order_channel,
           order_date, requested_delivery_date, status, created_by)
         VALUES ($1,$2,$3,$4,'MANUAL',$5::date,$5::date,'RECEIVED',$6)
         ON CONFLICT (id) DO NOTHING`,
        [orderId, TENANT, `CO-VERIFY-H${back}`, created.customerId, day, ACTOR]
      );
      await client.query(
        `INSERT INTO customer_order_line (id, tenant_id, customer_order_id, product_id,
           ordered_quantity, unit, line_no)
         VALUES ($1,$2,$3,$4,$5,'PCS',1)
         ON CONFLICT (id) DO NOTHING`,
        [`col-verify-hist-${back}`, TENANT, orderId, product.id, 3000]
      );
    }
  });

  const job = await forecasts.enqueueGenerate(
    TENANT,
    { periodStart: '2026-10-01', periodEnd: '2026-10-31', lookbackMonths: 6 },
    ACTOR
  );
  check('generate forecast masuk antrean job, bukan dihitung di request', job.status === 'PENDING');
  const ranJob = await runner.runOnce();
  check('job dijalankan runner', ranJob?.status === 'SUCCEEDED', ranJob?.lastError);

  const forecastList = await forecasts.list(TENANT, { status: 'GENERATED' });
  const forecast = forecastList[0] ? await forecasts.get(TENANT, forecastList[0].id) : undefined;
  check('forecast snapshot tersimpan', Boolean(forecast));
  if (forecast) {
    const line = forecast.lines.find((l) => l.productId === product.id);
    check('forecast line untuk product uji ada', Boolean(line));
    if (line) {
      const backdatedTotal = historyMonths.reduce(
        (sum, month) => sum + (line.historicalDemand[month] ?? 0),
        0
      );
      check('histori backdate ikut terhitung', backdatedTotal >= 6000, String(backdatedTotal));
      check(
        'average = total / lookback (bukan / bulan yang ada isinya)',
        Math.abs(line.averageDemand -
          Object.values(line.historicalDemand).reduce((a, b) => a + b, 0) / 6) < 0.01,
        `avg=${line.averageDemand}`
      );
      const months = Object.keys(line.historicalDemand);
      check('historical_demand berisi 6 bulan lookback', months.length === 6, months.join(','));
      const nowMonth = new Date().toISOString().slice(0, 7);
      check('bulan berjalan dikecualikan', !months.includes(nowMonth), nowMonth);
      check(
        'bulan kosong dihitung nol, bukan dilewati',
        months.every((m) => typeof line.historicalDemand[m] === 'number')
      );
      check('insufficient_history ditandai eksplisit', typeof line.insufficientHistory === 'boolean');
    }
  }

  // Regenerate: a new row, the old one SUPERSEDED and untouched.
  const beforeLines = forecast ? JSON.stringify(forecast.lines) : '';
  await forecasts.enqueueGenerate(
    TENANT,
    { periodStart: '2026-10-01', periodEnd: '2026-10-31', lookbackMonths: 6 },
    ACTOR
  );
  await runner.runOnce();
  if (forecast) {
    const reread = await forecasts.get(TENANT, forecast.id);
    check('forecast lama menjadi SUPERSEDED', reread.status === 'SUPERSEDED', reread.status);
    check('baris forecast lama TIDAK diubah', JSON.stringify(reread.lines) === beforeLines);
  }

  // --- MES-031..033 Capacity -----------------------------------------
  console.log('\nMES-031 / MES-032 / MES-033 Capacity');
  const assessment = await capacity.assessProduct(TENANT, {
    productId: product.id,
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    demandQuantity: 6500,
  });
  check('total capacity terhitung dari shift x mesin', assessment.totalCapacity >= 0);
  check(
    'planning capacity = total x utilization',
    assessment.planningCapacity ===
      Math.floor((assessment.totalCapacity * assessment.planningUtilizationPct) / 100)
  );
  check(
    'buffer = total - planning',
    assessment.capacityBuffer === assessment.totalCapacity - assessment.planningCapacity
  );
  check(
    'capacity status ditentukan sistem',
    ['WITHIN_PLAN', 'ADDITIONAL_DEMAND', 'CAPACITY_UP_REQUIRED'].includes(assessment.capacityStatus)
  );
  check(
    'gap = max(demand - total, 0)',
    assessment.capacityGap === Math.max(6500 - assessment.totalCapacity, 0)
  );
  check(
    'mesin tanpa cycle time dilaporkan, bukan dianggap nol',
    Array.isArray(assessment.uncomputedMachines)
  );

  // --- MES-035 / MES-036 Production Plan -----------------------------
  console.log('\nMES-035 / MES-036 Production Plan');
  const plan = await plans.create(
    TENANT,
    { periodStart: '2026-10-01', periodEnd: '2026-10-31' },
    ACTOR
  );
  created.planIds.push(plan.id);
  check('plan number PLAN-YYYYMM-NNN', /^PLAN-\d{6}-\d{3}$/.test(plan.planNumber), plan.planNumber);
  check('status awal DRAFT', plan.status === 'DRAFT');
  check('version tersimpan untuk optimistic locking', plan.version === 1);

  const detail = await orders.get(TENANT, order.id);
  const first = await plans.addDemand(
    TENANT,
    plan.id,
    { customerOrderLineId: detail.lines[0].id },
    ACTOR
  );
  const second = await plans.addDemand(
    TENANT,
    plan.id,
    { customerOrderLineId: detail.lines[1].id },
    ACTOR
  );
  check(
    'demand product yang sama teragregasi menjadi SATU plan line',
    first.line.id === second.line.id
  );
  check('demand teragregasi 5000 + 1500', second.line.demandQuantity === 6500);

  const breakdown = await plans.demandBreakdown(TENANT, plan.id);
  check(
    'asal order tetap dapat ditelusuri dari plan line',
    breakdown[0]?.sources.length === 2 &&
      breakdown[0].sources.every((s) => s.orderNumber === order.orderNumber)
  );

  const afterPlanning = await orders.get(TENANT, order.id);
  check(
    'customer_order_line.planned_quantity ikut naik',
    afterPlanning.lines.every((l) => l.plannedQuantity === l.orderedQuantity)
  );
  check(
    'status order menjadi PLANNED setelah seluruh line masuk plan',
    afterPlanning.status === 'PLANNED',
    afterPlanning.status
  );

  await expectRejection(
    'order line yang sudah penuh ditolak masuk plan lagi',
    () => plans.addDemand(TENANT, plan.id, { customerOrderLineId: detail.lines[0].id }, ACTOR),
    /sudah masuk plan|sudah seluruhnya masuk Production Plan/i
  );

  // MES-035-3 optimistic locking
  const currentPlan = await plans.get(TENANT, plan.id);
  await expectRejection(
    'optimistic locking menolak versi usang',
    () => plans.update(TENANT, plan.id, currentPlan.version - 1, { wizardStep: 2 }, ACTOR),
    /sudah diubah orang lain/i
  );

  // --- MES-037/038/039 Wizard gating ---------------------------------
  console.log('\nMES-037 / MES-038 / MES-039 Wizard');
  const readiness = await plans.readiness(TENANT, plan.id);
  check('step 1 selalu terbuka', readiness.demandCount === 2);
  const planForStep = await plans.get(TENANT, plan.id);
  await expectRejection(
    'step terkunci sampai prasyarat terpenuhi',
    () => plans.update(TENANT, plan.id, planForStep.version, { wizardStep: 4 }, ACTOR),
    /belum dapat dibuka/i
  );

  const planned = await plans.updateLine(
    TENANT,
    plan.id,
    first.line.id,
    { plannedQuantity: 6500 },
    ACTOR
  );
  check('planned quantity tersimpan terpisah dari demand', planned.plannedQuantity === 6500);
  check(
    'capacity status plan line ditentukan sistem',
    ['WITHIN_PLAN', 'ADDITIONAL_DEMAND', 'CAPACITY_UP_REQUIRED'].includes(planned.capacityStatus)
  );

  // --- MES-041 / MES-042 Work Order generation -----------------------
  console.log('\nMES-041 / MES-042 Work Order generation');
  const generated = await generator.generateForPlan(TENANT, plan.id, ACTOR);
  check('satu WO per process routing', generated.created.length > 0, `dibuat ${generated.created.length}`);

  const chainOk = generated.created.every((wo, index) =>
    index === 0 ? !wo.predecessorWorkOrderId : Boolean(wo.predecessorWorkOrderId)
  );
  check('process pertama predecessor NULL, sisanya membentuk rantai', chainOk);
  check(
    'planned_quantity process pertama = planned_quantity plan line',
    generated.created[0]?.plannedQuantity === 6500
  );
  check(
    'WO tidak menyimpan customer/order/alokasi',
    generated.created.every((wo) => !('customerId' in wo) && !('customerOrderId' in wo))
  );

  const regenerated = await generator.generateForPlan(TENANT, plan.id, ACTOR);
  check(
    'generate ulang TIDAK menghasilkan duplikat',
    regenerated.created.length === 0 && regenerated.existing.length === generated.created.length,
    `created=${regenerated.created.length} existing=${regenerated.existing.length}`
  );

  const demandView = await facade.workOrderDemand(TENANT, generated.created[0].id);
  check(
    'customer dapat ditelusuri read-only dari WO lewat plan line',
    demandView?.demands.length === 2
  );

  // --- MES-020 Audit & outbox ----------------------------------------
  console.log('\nMES-020 Audit & Outbox');
  await withTenant(TENANT, async (client) => {
    const audit = await client.query(
      `SELECT entity_type, action FROM audit_log
        WHERE tenant_id = $1 AND actor_id = $2
        ORDER BY occurred_at`,
      [TENANT, ACTOR]
    );
    const entries = audit.rows.map((r) => `${r.entity_type}:${r.action}`);
    check(
      'perubahan Customer Order tercatat di audit log',
      entries.includes('customer_order:CREATE'),
      entries.join(', ')
    );
    check(
      'perubahan Production Plan tercatat di audit log',
      entries.includes('production_plan:CREATE'),
      entries.join(', ')
    );
    check(
      'perubahan plan demand tercatat di audit log',
      entries.includes('production_plan_demand:CREATE')
    );

    const withValues = await client.query(
      `SELECT count(*)::int AS n FROM audit_log
        WHERE tenant_id = $1 AND actor_id = $2 AND new_value IS NOT NULL`,
      [TENANT, ACTOR]
    );
    check(
      'audit menyimpan nilai baru, bukan hanya nama aksi',
      withValues.rows[0].n > 0
    );

    const outbox = await client.query(
      `SELECT event_type FROM outbox_event WHERE tenant_id = $1 ORDER BY occurred_at DESC LIMIT 50`,
      [TENANT]
    );
    const events = outbox.rows.map((r) => r.event_type);
    check(
      'CustomerOrderReceived diterbitkan lewat outbox',
      events.includes('CustomerOrderReceived'),
      events.join(', ')
    );
    check(
      'DemandForecastGenerated diterbitkan lewat outbox',
      events.includes('DemandForecastGenerated')
    );
    check(
      'CustomerOrderStatusChanged diterbitkan saat status diturunkan',
      events.includes('CustomerOrderStatusChanged')
    );

    // The audit row and the change it describes share a transaction, so an
    // order can never exist without the entry that says who created it.
    const orphans = await client.query(
      // Excludes the backdated history rows this script inserts with raw SQL to
      // give the forecast something to average — they never went through the
      // service, so they legitimately have no audit entry.
      `SELECT count(*)::int AS n FROM customer_order co
        WHERE co.tenant_id = $1 AND co.created_by = $2
          AND co.id NOT LIKE 'co-verify-hist-%'
          AND NOT EXISTS (
            SELECT 1 FROM audit_log a
             WHERE a.tenant_id = co.tenant_id AND a.entity_id = co.id
               AND a.entity_type = 'customer_order' AND a.action = 'CREATE'
          )`,
      [TENANT, ACTOR]
    );
    check(
      'tidak ada Customer Order tanpa audit entry (satu transaksi)',
      orphans.rows[0].n === 0,
      String(orphans.rows[0].n)
    );
  });

  // --- MES-040 Confirmation guards -----------------------------------
  console.log('\nMES-040 Production Plan confirmation');
  await expectRejection(
    'confirm ditolak selama masih ada WO belum dikonfirmasi',
    () => plans.confirm(TENANT, plan.id, ACTOR),
    /belum dikonfirmasi/i
  );

  console.log(`\n${passed} pemeriksaan lulus, ${failed} gagal.`);
} catch (error) {
  failed += 1;
  console.error('\nGagal dengan exception:', error);
} finally {
  await cleanup().catch((error) => console.error('cleanup gagal:', error.message));
  runner.stop();
  await closePool();
}

process.exit(failed > 0 ? 1 : 0);
