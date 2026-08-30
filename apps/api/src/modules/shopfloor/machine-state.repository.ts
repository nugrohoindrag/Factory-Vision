import { MachineState } from '@factory-vision/domain-types';
import type { MachineStateLog } from '@factory-vision/domain-types';
import {
  asDateString,
  asIsoString,
  asOptionalIsoString,
  orUndefined,
  type Executor,
} from '../../platform/db/executor.js';

/**
 * `machine_state_log` (persistence fix §11).
 *
 * A machine's current state is operational: an API that comes back from a
 * restart believing a stopped press is RUNNING tells the board the line is
 * producing when it is not. The log is append-then-close — a state opens with
 * `started_at` and is closed by stamping `ended_at` — so "what is this machine
 * doing right now" is the row that has no end yet, and the history behind it
 * is what Availability is derived from.
 *
 * Only the five states the domain defines are written. `MAINTENANCE` and
 * friends are deliberately absent: an extra state nobody agreed on turns up
 * later as a gap in every OEE figure.
 */
const COLUMNS = `
  id, tenant_id, machine_id, process_id, state, reason_id, started_at, ended_at,
  duration_seconds, work_order_id, to_char(shift_date, 'YYYY-MM-DD') AS shift_date
`;

interface Row {
  id: string;
  tenant_id: string;
  machine_id: string;
  process_id: string | null;
  state: string;
  reason_id: string | null;
  started_at: Date | string;
  ended_at: Date | string | null;
  duration_seconds: number | null;
  work_order_id: string | null;
  shift_date: string | null;
}

function toDomain(row: Row): MachineStateLog {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    machineId: row.machine_id,
    processId: orUndefined(row.process_id),
    state: row.state as MachineState,
    reasonId: orUndefined(row.reason_id),
    startedAt: asIsoString(row.started_at),
    endedAt: asOptionalIsoString(row.ended_at),
    durationSeconds: row.duration_seconds === null ? undefined : Number(row.duration_seconds),
    workOrderId: orUndefined(row.work_order_id),
    shiftDate: row.shift_date ? asDateString(row.shift_date) : undefined,
  };
}

export class MachineStateRepository {
  /**
   * Closes whatever state the machine was in and opens the new one.
   *
   * Both halves run in the caller's transaction: a machine left with two open
   * states, or none, would make its run time either double-counted or lost.
   * A repeat of the state already open is a no-op, so a terminal that resends
   * "still running" does not fragment the log into a thousand rows.
   */
  async transition(
    exec: Executor,
    entry: Omit<MachineStateLog, 'id' | 'endedAt' | 'durationSeconds'> & { id?: string }
  ): Promise<MachineStateLog | undefined> {
    const open = await this.findOpen(exec, entry.tenantId, entry.machineId);
    if (open && open.state === entry.state) return open;

    if (open) {
      await exec.query(
        `UPDATE machine_state_log
            SET ended_at = $3,
                duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM ($3::timestamptz - started_at))::int)
          WHERE tenant_id = $1 AND id = $2`,
        [entry.tenantId, open.id, entry.startedAt]
      );
    }

    const id = entry.id ?? `ms-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const result = await exec.query<Row>(
      `INSERT INTO machine_state_log (id, tenant_id, machine_id, process_id, state, reason_id,
                                      started_at, work_order_id, shift_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO NOTHING
       RETURNING ${COLUMNS}`,
      [
        id, entry.tenantId, entry.machineId, entry.processId ?? null, entry.state,
        entry.reasonId ?? null, entry.startedAt, entry.workOrderId ?? null,
        entry.shiftDate ?? null,
      ]
    );
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  /** The state a machine is in right now: the row with no end. */
  async findOpen(
    exec: Executor,
    tenantId: string,
    machineId: string
  ): Promise<MachineStateLog | undefined> {
    const result = await exec.query<Row>(
      `SELECT ${COLUMNS} FROM machine_state_log
        WHERE tenant_id = $1 AND machine_id = $2 AND ended_at IS NULL
        ORDER BY started_at DESC LIMIT 1`,
      [tenantId, machineId]
    );
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async listOpen(exec: Executor, tenantId: string): Promise<MachineStateLog[]> {
    const result = await exec.query<Row>(
      `SELECT ${COLUMNS} FROM machine_state_log
        WHERE tenant_id = $1 AND ended_at IS NULL
        ORDER BY started_at DESC`,
      [tenantId]
    );
    return result.rows.map(toDomain);
  }

  async list(
    exec: Executor,
    tenantId: string,
    filter: { machineId?: string; limit?: number } = {}
  ): Promise<MachineStateLog[]> {
    const where = ['tenant_id = $1'];
    const params: unknown[] = [tenantId];
    if (filter.machineId) {
      params.push(filter.machineId);
      where.push(`machine_id = $${params.length}`);
    }
    params.push(Math.min(filter.limit ?? 2000, 20000));
    const result = await exec.query<Row>(
      `SELECT ${COLUMNS} FROM machine_state_log
        WHERE ${where.join(' AND ')}
        ORDER BY started_at DESC LIMIT $${params.length}`,
      params
    );
    return result.rows.map(toDomain);
  }

  async count(exec: Executor, tenantId: string): Promise<number> {
    const r = await exec.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM machine_state_log WHERE tenant_id = $1', [tenantId]);
    return Number(r.rows[0]?.n ?? 0);
  }
}
