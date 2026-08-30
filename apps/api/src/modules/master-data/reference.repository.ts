import type { AppUser, Operator, Shift } from '@factory-vision/domain-types';
import { asIsoString, orUndefined, type Executor } from '../../platform/db/executor.js';

/**
 * Shifts, operators and application users.
 *
 * These three are read on almost every request and written rarely: a shift
 * decides which `shift_date` a production record belongs to, an operator is
 * resolved on every capture, and a user carries the permissions the API
 * enforces. `MasterDataService` therefore keeps them in an index it can read
 * synchronously — but the index is rebuilt from these tables at boot and every
 * mutation lands here first, so PostgreSQL is the source of truth and a
 * restart changes nothing.
 *
 * They share a file because they share that lifecycle, not because they share
 * a domain; splitting them would mean three files saying the same thing about
 * hydration.
 */

// --- shift -------------------------------------------------------------------

const SHIFT_COLUMNS = `
  id, tenant_id, plant_id, name, start_time, end_time, break_minutes,
  crosses_midnight, active
`;

interface ShiftRow {
  id: string;
  tenant_id: string;
  plant_id: string;
  name: string;
  start_time: string;
  end_time: string;
  break_minutes: number | null;
  crosses_midnight: boolean | null;
  active: boolean | null;
}

function toShift(row: ShiftRow): Shift {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    plantId: row.plant_id,
    name: row.name,
    startTime: row.start_time,
    endTime: row.end_time,
    breakMinutes: Number(row.break_minutes ?? 0),
    crossesMidnight: Boolean(row.crosses_midnight),
    active: row.active === null ? true : Boolean(row.active),
  };
}

export class ShiftRepository {
  async list(exec: Executor, tenantId: string): Promise<Shift[]> {
    const result = await exec.query<ShiftRow>(
      `SELECT ${SHIFT_COLUMNS} FROM shift WHERE tenant_id = $1 ORDER BY start_time ASC, id ASC`,
      [tenantId]
    );
    return result.rows.map(toShift);
  }

  async upsert(exec: Executor, shift: Shift): Promise<Shift> {
    const result = await exec.query<ShiftRow>(
      `INSERT INTO shift (id, tenant_id, plant_id, name, start_time, end_time,
                          break_minutes, crosses_midnight, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET
         plant_id = EXCLUDED.plant_id,
         name = EXCLUDED.name,
         start_time = EXCLUDED.start_time,
         end_time = EXCLUDED.end_time,
         break_minutes = EXCLUDED.break_minutes,
         crosses_midnight = EXCLUDED.crosses_midnight,
         active = EXCLUDED.active
       RETURNING ${SHIFT_COLUMNS}`,
      [
        shift.id, shift.tenantId, shift.plantId, shift.name, shift.startTime,
        shift.endTime, shift.breakMinutes, shift.crossesMidnight, shift.active,
      ]
    );
    return toShift(result.rows[0]);
  }

  async delete(exec: Executor, tenantId: string, id: string): Promise<boolean> {
    const r = await exec.query('DELETE FROM shift WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
    return (r.rowCount ?? 0) > 0;
  }

  async count(exec: Executor, tenantId: string): Promise<number> {
    const r = await exec.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM shift WHERE tenant_id = $1', [tenantId]);
    return Number(r.rows[0]?.n ?? 0);
  }
}

// --- operator ----------------------------------------------------------------

const OPERATOR_COLUMNS = `
  id, tenant_id, employee_number, name, pin_hash, default_line_id, status
`;

interface OperatorRow {
  id: string;
  tenant_id: string;
  employee_number: string;
  name: string;
  pin_hash: string | null;
  default_line_id: string | null;
  status: string | null;
}

function toOperator(row: OperatorRow): Operator {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    employeeNumber: row.employee_number,
    name: row.name,
    pinHash: orUndefined(row.pin_hash),
    defaultLineId: orUndefined(row.default_line_id),
    status: (row.status as Operator['status']) ?? 'ACTIVE',
  };
}

export class OperatorRepository {
  async list(exec: Executor, tenantId: string): Promise<Operator[]> {
    const result = await exec.query<OperatorRow>(
      `SELECT ${OPERATOR_COLUMNS} FROM operator WHERE tenant_id = $1 ORDER BY employee_number ASC`,
      [tenantId]
    );
    return result.rows.map(toOperator);
  }

  async upsert(exec: Executor, operator: Operator): Promise<Operator> {
    const result = await exec.query<OperatorRow>(
      `INSERT INTO operator (id, tenant_id, employee_number, name, pin_hash, default_line_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET
         employee_number = EXCLUDED.employee_number,
         name = EXCLUDED.name,
         -- A null pin_hash on the way in means "unchanged", not "cleared":
         -- saving an operator's name must never revoke their PIN.
         pin_hash = COALESCE(EXCLUDED.pin_hash, operator.pin_hash),
         default_line_id = EXCLUDED.default_line_id,
         status = EXCLUDED.status
       RETURNING ${OPERATOR_COLUMNS}`,
      [
        operator.id, operator.tenantId, operator.employeeNumber, operator.name,
        operator.pinHash ?? null, operator.defaultLineId ?? null, operator.status,
      ]
    );
    return toOperator(result.rows[0]);
  }

  /**
   * Stores a PIN hash in both places the schema keeps one.
   *
   * `operator.pin_hash` is what the operator record carries;
   * `operator_credential` is the row that records when it was last set and by
   * whom, which is what an auditor asks about after a shared PIN is rotated.
   */
  async setPin(exec: Executor, tenantId: string, operatorId: string, pinHash: string,
               updatedBy?: string): Promise<void> {
    await exec.query(
      'UPDATE operator SET pin_hash = $3 WHERE tenant_id = $1 AND id = $2',
      [tenantId, operatorId, pinHash]
    );
    await exec.query(
      `INSERT INTO operator_credential (operator_id, tenant_id, pin_hash, updated_at, updated_by)
       VALUES ($1, $2, $3, now(), $4)
       ON CONFLICT (operator_id) DO UPDATE SET
         pin_hash = EXCLUDED.pin_hash, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [operatorId, tenantId, pinHash, updatedBy ?? null]
    );
  }

  async delete(exec: Executor, tenantId: string, id: string): Promise<boolean> {
    const r = await exec.query('DELETE FROM operator WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
    return (r.rowCount ?? 0) > 0;
  }

  async count(exec: Executor, tenantId: string): Promise<number> {
    const r = await exec.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM operator WHERE tenant_id = $1', [tenantId]);
    return Number(r.rows[0]?.n ?? 0);
  }
}

// --- app_user ----------------------------------------------------------------

const USER_COLUMNS = `
  id, tenant_id, email, password_hash, name, role, account_type, scope_level,
  scope_id, employee_number, status, last_login_at, created_at
`;

interface UserRow {
  id: string;
  tenant_id: string;
  email: string;
  password_hash: string | null;
  name: string;
  role: string;
  account_type: string | null;
  scope_level: string | null;
  scope_id: string | null;
  employee_number: string | null;
  status: string | null;
  last_login_at: Date | string | null;
  created_at: Date | string;
}

export interface StoredUser {
  user: AppUser;
  passwordHash?: string;
}

function toUser(row: UserRow): StoredUser {
  return {
    user: {
      id: row.id,
      tenantId: row.tenant_id,
      email: row.email,
      name: row.name,
      role: row.role as AppUser['role'],
      accountType: (row.account_type as AppUser['accountType']) ?? 'APPLICATION',
      scopeLevel: (row.scope_level as AppUser['scopeLevel']) ?? 'TENANT',
      scopeId: orUndefined(row.scope_id),
      employeeNumber: orUndefined(row.employee_number),
      status: (row.status as AppUser['status']) ?? 'ACTIVE',
      lastLoginAt: row.last_login_at ? asIsoString(row.last_login_at) : undefined,
      createdAt: asIsoString(row.created_at),
    },
    passwordHash: orUndefined(row.password_hash),
  };
}

export class AppUserRepository {
  async list(exec: Executor, tenantId: string): Promise<StoredUser[]> {
    const result = await exec.query<UserRow>(
      `SELECT ${USER_COLUMNS} FROM app_user WHERE tenant_id = $1 ORDER BY created_at ASC, id ASC`,
      [tenantId]
    );
    return result.rows.map(toUser);
  }

  async upsert(exec: Executor, user: AppUser, passwordHash?: string): Promise<StoredUser> {
    const result = await exec.query<UserRow>(
      `INSERT INTO app_user (id, tenant_id, email, password_hash, name, role, account_type,
                             scope_level, scope_id, employee_number, status, last_login_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (id) DO UPDATE SET
         email = EXCLUDED.email,
         -- As with the operator PIN, a null hash means "leave it alone".
         password_hash = COALESCE(EXCLUDED.password_hash, app_user.password_hash),
         name = EXCLUDED.name,
         role = EXCLUDED.role,
         account_type = EXCLUDED.account_type,
         scope_level = EXCLUDED.scope_level,
         scope_id = EXCLUDED.scope_id,
         employee_number = EXCLUDED.employee_number,
         status = EXCLUDED.status,
         last_login_at = COALESCE(EXCLUDED.last_login_at, app_user.last_login_at)
       RETURNING ${USER_COLUMNS}`,
      [
        user.id, user.tenantId, user.email, passwordHash ?? null, user.name, user.role,
        user.accountType, user.scopeLevel, user.scopeId ?? null, user.employeeNumber ?? null,
        user.status, user.lastLoginAt ?? null, user.createdAt,
      ]
    );
    return toUser(result.rows[0]);
  }

  async setPassword(exec: Executor, tenantId: string, userId: string, hash: string): Promise<void> {
    await exec.query('UPDATE app_user SET password_hash = $3 WHERE tenant_id = $1 AND id = $2',
                     [tenantId, userId, hash]);
  }

  async touchLogin(exec: Executor, tenantId: string, userId: string, at: string): Promise<void> {
    await exec.query('UPDATE app_user SET last_login_at = $3 WHERE tenant_id = $1 AND id = $2',
                     [tenantId, userId, at]);
  }

  async delete(exec: Executor, tenantId: string, id: string): Promise<boolean> {
    const r = await exec.query('DELETE FROM app_user WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
    return (r.rowCount ?? 0) > 0;
  }

  async count(exec: Executor, tenantId: string): Promise<number> {
    const r = await exec.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM app_user WHERE tenant_id = $1', [tenantId]);
    return Number(r.rows[0]?.n ?? 0);
  }
}
