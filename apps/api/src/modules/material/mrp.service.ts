import type { MrpResult, MrpRun, MaterialReadinessStatus } from '@factory-vision/domain-types';
import { withTenant } from '../../platform/db/pool.js';
import { asDateString, asIsoString, orUndefined, type Executor } from '../../platform/db/executor.js';
import { ApiError } from '../../platform/http/api-error.js';
import type { MasterDataService } from '../master-data/master-data.service.js';
import type { PlanningFacade } from '../planning/public/index.js';
import type { EventService } from '../event/event.service.js';
import type { MaterialService } from './material.service.js';

/**
 * Material Requirements Planning (Improvement PRD §3.2, US-M002).
 *
 * A run is a snapshot, not a live view. It reads the demand inside a horizon,
 * explodes it through the BOM, subtracts what the plant already has or has
 * coming, and stores the net requirement together with the horizon and the
 * timestamp it was computed at (BR-M08) — because a net requirement is only
 * meaningful against the inventory it was computed from.
 *
 * MRP recommends and never purchases (BR-M07). The recommendation is a
 * sentence a PPIC acts on, not an order anything downstream will execute.
 */
export class MrpService {
  constructor(
    private readonly material: MaterialService,
    private readonly masterData: MasterDataService,
    private readonly planning: PlanningFacade,
    private readonly events: EventService
  ) {}

  async run(
    tenantId: string,
    input: { horizonStart?: string; horizonEnd?: string; planIds?: string[]; notes?: string },
    actor: { id: string; name?: string }
  ): Promise<{ run: MrpRun; results: MrpResult[] }> {
    const horizonStart = input.horizonStart ?? new Date().toISOString().slice(0, 10);
    const horizonEnd =
      input.horizonEnd ?? new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    if (horizonEnd < horizonStart) {
      throw ApiError.validation('Akhir horizon perencanaan tidak boleh mendahului awalnya.');
    }

    const demand = await this.planning.planDemandLines(tenantId, {
      planIds: input.planIds,
      horizonStart,
      horizonEnd,
    });

    // Gross requirement: every plan line's product exploded through its BOM,
    // summed per material, keeping the earliest date any of them needs it.
    const gross = new Map<
      string,
      { quantity: number; uom: string; level: number; date: string; sources: Set<string> }
    >();

    for (const line of demand) {
      const exploded = await this.material.explodeDemand(tenantId, line.productId, line.plannedQuantity);
      for (const component of exploded) {
        const existing = gross.get(component.materialId);
        if (existing) {
          existing.quantity += component.quantity;
          existing.level = Math.min(existing.level, component.level);
          if (line.requiredDate < existing.date) existing.date = line.requiredDate;
          existing.sources.add(line.planNumber);
        } else {
          gross.set(component.materialId, {
            quantity: component.quantity,
            uom: component.uom,
            level: component.level,
            date: line.requiredDate,
            sources: new Set([line.planNumber]),
          });
        }
      }
    }

    const materialIds = [...gross.keys()];
    const totals = await this.material.stockTotals(tenantId, materialIds);

    const runId = `mrp-${Date.now()}`;
    const runNumber = `MRP-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(
      Date.now() % 1000
    ).padStart(3, '0')}`;

    const results: MrpResult[] = materialIds.map((materialId, index) => {
      const requirement = gross.get(materialId)!;
      const stock = totals.get(materialId);
      const onHand = stock?.onHand ?? 0;
      const reserved = stock?.reserved ?? 0;
      const incoming = stock?.incoming ?? 0;
      const available = onHand - reserved + incoming;
      const net = Number(Math.max(requirement.quantity - available, 0).toFixed(4));
      const material = this.masterData.getProductById(tenantId, materialId);
      const status: MaterialReadinessStatus = net <= 0 ? 'READY' : available > 0 ? 'PARTIAL' : 'SHORTAGE';

      return {
        id: `mrpr-${runId}-${index + 1}`,
        tenantId,
        mrpRunId: runId,
        materialId,
        materialSku: material?.sku ?? materialId,
        materialName: material?.name ?? materialId,
        level: requirement.level,
        grossRequirement: Number(requirement.quantity.toFixed(4)),
        onHandQuantity: onHand,
        reservedQuantity: reserved,
        incomingQuantity: incoming,
        availableQuantity: available,
        netRequirement: net,
        uom: requirement.uom,
        requirementDate: requirement.date,
        requirementSource: [...requirement.sources].join(', '),
        status,
        recommendation:
          net <= 0
            ? undefined
            : `Adakan ${net.toLocaleString('id-ID')} ${requirement.uom} sebelum ${requirement.date}.`,
      };
    });

    results.sort((a, b) => b.netRequirement - a.netRequirement || a.materialSku.localeCompare(b.materialSku));

    const run: MrpRun = {
      id: runId,
      tenantId,
      runNumber,
      horizonStart,
      horizonEnd,
      status: 'COMPLETED',
      demandSource: 'PRODUCTION_PLAN',
      planIds: [...new Set(demand.map((line) => line.productionPlanId))],
      totalMaterials: results.length,
      shortageMaterials: results.filter((r) => r.netRequirement > 0).length,
      runBy: actor.id,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      notes: input.notes,
    };

    await withTenant(tenantId, async (client) => {
      await this.insertRun(client, run);
      for (const result of results) await this.insertResult(client, result);
    });

    this.events.recordDetached({
      tenantId,
      eventType: 'MRP_RUN',
      entityType: 'MRP_RUN',
      entityId: run.id,
      actorType: 'USER',
      actorId: actor.id,
      actorName: actor.name,
      summary: `${run.runNumber}: ${run.totalMaterials} material, ${run.shortageMaterials} shortage.`,
      afterValue: {
        horizonStart,
        horizonEnd,
        totalMaterials: run.totalMaterials,
        shortageMaterials: run.shortageMaterials,
      },
    });

    return { run, results };
  }

  async listRuns(tenantId: string, limit = 50): Promise<MrpRun[]> {
    return withTenant(tenantId, async (client) => {
      const rows = await client.query<RunRow>(
        `SELECT ${RUN_COLUMNS} FROM mrp_run WHERE tenant_id = $1 ORDER BY started_at DESC LIMIT $2`,
        [tenantId, Math.min(limit, 200)]
      );
      return rows.rows.map(toRun);
    });
  }

  async getRun(tenantId: string, id: string): Promise<{ run: MrpRun; results: MrpResult[] } | undefined> {
    return withTenant(tenantId, async (client) => {
      const runRows = await client.query<RunRow>(
        `SELECT ${RUN_COLUMNS} FROM mrp_run WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id]
      );
      const row = runRows.rows[0];
      if (!row) return undefined;

      const resultRows = await client.query<ResultRow>(
        `SELECT r.id, r.tenant_id, r.mrp_run_id, r.material_id, p.sku AS material_sku, p.name AS material_name,
                r.level, r.gross_requirement, r.on_hand_quantity, r.reserved_quantity, r.incoming_quantity,
                r.available_quantity, r.net_requirement, r.uom, r.requirement_date, r.requirement_source,
                r.status, r.recommendation
           FROM mrp_result r
           JOIN product p ON p.id = r.material_id
          WHERE r.mrp_run_id = $1
          ORDER BY r.net_requirement DESC, p.sku`,
        [id]
      );

      return { run: toRun(row), results: resultRows.rows.map(toResult) };
    });
  }

  /** The most recent completed run, which is what a dashboard shows. */
  async latest(tenantId: string): Promise<{ run: MrpRun; results: MrpResult[] } | undefined> {
    const [run] = await this.listRuns(tenantId, 1);
    return run ? this.getRun(tenantId, run.id) : undefined;
  }

  private async insertRun(exec: Executor, run: MrpRun): Promise<void> {
    await exec.query(
      `INSERT INTO mrp_run (
         id, tenant_id, run_number, horizon_start, horizon_end, status, demand_source, plan_ids,
         total_materials, shortage_materials, run_by, started_at, completed_at, error_message, notes
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        run.id,
        run.tenantId,
        run.runNumber,
        run.horizonStart,
        run.horizonEnd,
        run.status,
        run.demandSource,
        JSON.stringify(run.planIds),
        run.totalMaterials,
        run.shortageMaterials,
        run.runBy,
        run.startedAt,
        run.completedAt ?? null,
        run.errorMessage ?? null,
        run.notes ?? null,
      ]
    );
  }

  private async insertResult(exec: Executor, result: MrpResult): Promise<void> {
    await exec.query(
      `INSERT INTO mrp_result (
         id, tenant_id, mrp_run_id, material_id, level, gross_requirement, on_hand_quantity,
         reserved_quantity, incoming_quantity, available_quantity, net_requirement, uom,
         requirement_date, requirement_source, status, recommendation
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        result.id,
        result.tenantId,
        result.mrpRunId,
        result.materialId,
        result.level,
        result.grossRequirement,
        result.onHandQuantity,
        result.reservedQuantity,
        result.incomingQuantity,
        result.availableQuantity,
        result.netRequirement,
        result.uom,
        result.requirementDate,
        result.requirementSource,
        result.status,
        result.recommendation ?? null,
      ]
    );
  }
}

const RUN_COLUMNS = `
  id, tenant_id, run_number, horizon_start, horizon_end, status, demand_source, plan_ids,
  total_materials, shortage_materials, run_by, started_at, completed_at, error_message, notes
`;

interface RunRow {
  id: string;
  tenant_id: string;
  run_number: string;
  horizon_start: Date | string;
  horizon_end: Date | string;
  status: string;
  demand_source: string;
  plan_ids: string[] | null;
  total_materials: number;
  shortage_materials: number;
  run_by: string;
  started_at: Date | string;
  completed_at: Date | string | null;
  error_message: string | null;
  notes: string | null;
}

function toRun(row: RunRow): MrpRun {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    runNumber: row.run_number,
    horizonStart: asDateString(row.horizon_start),
    horizonEnd: asDateString(row.horizon_end),
    status: row.status as MrpRun['status'],
    demandSource: row.demand_source as MrpRun['demandSource'],
    planIds: row.plan_ids ?? [],
    totalMaterials: Number(row.total_materials),
    shortageMaterials: Number(row.shortage_materials),
    runBy: row.run_by,
    startedAt: asIsoString(row.started_at),
    completedAt: row.completed_at ? asIsoString(row.completed_at) : undefined,
    errorMessage: orUndefined(row.error_message),
    notes: orUndefined(row.notes),
  };
}

interface ResultRow {
  id: string;
  tenant_id: string;
  mrp_run_id: string;
  material_id: string;
  material_sku: string;
  material_name: string;
  level: number;
  gross_requirement: string;
  on_hand_quantity: string;
  reserved_quantity: string;
  incoming_quantity: string;
  available_quantity: string;
  net_requirement: string;
  uom: string;
  requirement_date: Date | string | null;
  requirement_source: string | null;
  status: string;
  recommendation: string | null;
}

function toResult(row: ResultRow): MrpResult {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    mrpRunId: row.mrp_run_id,
    materialId: row.material_id,
    materialSku: row.material_sku,
    materialName: row.material_name,
    level: row.level,
    grossRequirement: Number(row.gross_requirement),
    onHandQuantity: Number(row.on_hand_quantity),
    reservedQuantity: Number(row.reserved_quantity),
    incomingQuantity: Number(row.incoming_quantity),
    availableQuantity: Number(row.available_quantity),
    netRequirement: Number(row.net_requirement),
    uom: row.uom,
    requirementDate: row.requirement_date ? asDateString(row.requirement_date) : '',
    requirementSource: row.requirement_source ?? '',
    status: row.status as MaterialReadinessStatus,
    recommendation: orUndefined(row.recommendation),
  };
}
