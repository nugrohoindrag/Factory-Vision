import type { PermissionId, RoleDefinition } from '@factory-vision/domain-types';
import { asIsoString, type Executor } from '../../platform/db/executor.js';

/**
 * `role_definition` and its `role_permission` rows.
 *
 * This is the security context the API enforces on every request. A role whose
 * permissions live only in memory means a permission an administrator revoked
 * comes back at the next restart, which is the kind of defect nobody notices
 * until it matters.
 *
 * Permissions are a child table rather than an array column so a single grant
 * is a row, which is what makes `PERMISSION_CHANGED` in the audit trail
 * something you can reconcile against the database.
 */
const COLUMNS = `
  id, tenant_id, key, name, description, is_system, landing_path, created_at, updated_at
`;

interface Row {
  id: string;
  tenant_id: string;
  key: string;
  name: string;
  description: string | null;
  is_system: boolean;
  landing_path: string;
  created_at: Date | string;
  updated_at: Date | string;
}

export class RoleRepository {
  async list(exec: Executor, tenantId: string): Promise<RoleDefinition[]> {
    const roles = await exec.query<Row>(
      `SELECT ${COLUMNS} FROM role_definition WHERE tenant_id = $1
        ORDER BY is_system DESC, name ASC`,
      [tenantId]
    );
    if (roles.rows.length === 0) return [];

    // One query for every role's permissions rather than one per role.
    const perms = await exec.query<{ role_id: string; permission: string }>(
      `SELECT rp.role_id, rp.permission
         FROM role_permission rp
         JOIN role_definition rd ON rd.id = rp.role_id
        WHERE rd.tenant_id = $1`,
      [tenantId]
    );
    const byRole = new Map<string, PermissionId[]>();
    for (const row of perms.rows) {
      const list = byRole.get(row.role_id) ?? [];
      list.push(row.permission as PermissionId);
      byRole.set(row.role_id, list);
    }

    return roles.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      key: row.key,
      name: row.name,
      description: row.description ?? '',
      system: row.is_system,
      permissions: byRole.get(row.id) ?? [],
      landingPath: row.landing_path,
      createdAt: asIsoString(row.created_at),
      updatedAt: asIsoString(row.updated_at),
    }));
  }

  /**
   * Writes a role and replaces its permission set.
   *
   * Delete-then-insert inside the caller's transaction, so a role is never
   * briefly visible with half its permissions — which, for the table the API
   * authorises from, would be a window where requests are wrongly refused or
   * wrongly allowed.
   */
  async upsert(exec: Executor, role: RoleDefinition): Promise<void> {
    await exec.query(
      `INSERT INTO role_definition (id, tenant_id, key, name, description, is_system,
                                    landing_path, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         landing_path = EXCLUDED.landing_path,
         updated_at = EXCLUDED.updated_at`,
      [
        role.id, role.tenantId, role.key, role.name, role.description ?? '',
        role.system, role.landingPath, role.createdAt, role.updatedAt,
      ]
    );

    await exec.query('DELETE FROM role_permission WHERE role_id = $1', [role.id]);
    for (const permission of role.permissions) {
      await exec.query(
        `INSERT INTO role_permission (role_id, permission) VALUES ($1, $2)
         ON CONFLICT (role_id, permission) DO NOTHING`,
        [role.id, permission]
      );
    }
  }

  async delete(exec: Executor, tenantId: string, id: string): Promise<boolean> {
    // role_permission cascades on the foreign key.
    const r = await exec.query('DELETE FROM role_definition WHERE tenant_id = $1 AND id = $2',
                               [tenantId, id]);
    return (r.rowCount ?? 0) > 0;
  }

  async count(exec: Executor, tenantId: string): Promise<number> {
    const r = await exec.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM role_definition WHERE tenant_id = $1', [tenantId]);
    return Number(r.rows[0]?.n ?? 0);
  }
}
