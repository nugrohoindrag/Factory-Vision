import { UserRole } from '@factory-vision/domain-types';
import type {
  AccessScope,
  AppUser,
  PermissionDefinition,
  PermissionId,
  RoleDefinition,
} from '@factory-vision/domain-types';
import { ApiError } from '../../platform/http/api-error.js';
import { withTenant } from '../../platform/db/pool.js';
import { RoleRepository } from './role.repository.js';
import { MasterDataService } from '../master-data/master-data.service.js';
import {
  PERMISSION_CATALOG,
  PERMISSION_IDS,
  ROLE_DESCRIPTION,
  ROLE_LANDING_PATH,
  SYSTEM_ROLE_PERMISSIONS,
  isPrivileged,
} from './permissions.js';

const PILOT_TENANT = 'tenant-pilot-factory-01';

/**
 * Role and permission resolution (US-003, US-006).
 *
 * System roles are materialised per tenant on first use so the console can list
 * roles and their permissions uniformly. `system: true` fixes their identity,
 * a tenant may retune what each baseline role can do through the access
 * matrix, but not rename, relocate or delete one, and ADMIN stays untouched
 * entirely (see `updateRole`).
 */
export class RbacService {
  private roles: RoleDefinition[] = [];
  private readonly repo = new RoleRepository();

  constructor(private masterData: MasterDataService) {}

  /**
   * Rebuilds the role cache from PostgreSQL.
   *
   * Roles are the security context the API authorises from, and they are read
   * synchronously on every request, so they stay in `this.roles` — but that
   * array is now a projection of `role_definition` rather than the record. On
   * an empty database the seven system roles are materialised and written
   * down, so the next boot reads them back rather than inventing them again.
   */
  async hydrate(tenantId: string): Promise<number> {
    return withTenant(tenantId, async (client) => {
      const stored = await this.repo.list(client, tenantId);
      if (stored.length === 0) {
        this.ensureSystemRoles(tenantId);
        for (const role of this.roles.filter((r) => r.tenantId === tenantId)) {
          await this.repo.upsert(client, role);
        }
      } else {
        this.roles = this.roles.filter((r) => r.tenantId !== tenantId).concat(stored);
      }
      return this.roles.filter((r) => r.tenantId === tenantId).length;
    });
  }

  getPermissionCatalog(): PermissionDefinition[] {
    return PERMISSION_CATALOG;
  }

  private ensureSystemRoles(tenantId: string): void {
    for (const role of Object.values(UserRole)) {
      const exists = this.roles.some((r) => r.tenantId === tenantId && r.key === role);
      if (exists) continue;
      const now = new Date().toISOString();
      this.roles.push({
        id: `role-${tenantId}-${role.toLowerCase()}`,
        tenantId,
        key: role,
        name: humanizeRole(role),
        description: ROLE_DESCRIPTION[role],
        system: true,
        permissions: [...SYSTEM_ROLE_PERMISSIONS[role]],
        landingPath: ROLE_LANDING_PATH[role],
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  getRoles(tenantId: string): RoleDefinition[] {
    this.ensureSystemRoles(tenantId);
    return this.roles
      .filter((r) => r.tenantId === tenantId)
      .sort((a, b) => Number(b.system) - Number(a.system) || a.name.localeCompare(b.name));
  }

  getRole(tenantId: string, id: string): RoleDefinition {
    const role = this.getRoles(tenantId).find((r) => r.id === id || r.key === id);
    if (!role) throw ApiError.notFound(`Peran ${id} tidak ditemukan.`);
    return role;
  }

  /**
   * Creates a tenant role. `grantedBy` is the acting principal's permission set:
   * forbids handing out a privileged permission you do not hold yourself.
   */
  async createRole(
    tenantId: string,
    payload: {
      key: string;
      name: string;
      description?: string;
      permissions: PermissionId[];
      landingPath?: string;
    },
    grantedBy: PermissionId[]
  ): Promise<RoleDefinition> {
    this.ensureSystemRoles(tenantId);

    const key = payload.key
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, '_');
    if (this.roles.some((r) => r.tenantId === tenantId && r.key === key)) {
      throw ApiError.conflict(`Peran dengan key ${key} sudah ada.`);
    }
    if (Object.values(UserRole).includes(key as UserRole)) {
      throw ApiError.conflict(`${key} adalah system role dan tidak dapat dibuat ulang.`);
    }

    const permissions = this.assertGrantable(payload.permissions, grantedBy);
    const now = new Date().toISOString();
    const role: RoleDefinition = {
      id: `role-${tenantId}-${key.toLowerCase()}-${Date.now()}`,
      tenantId,
      key,
      name: payload.name.trim(),
      description: payload.description?.trim() ?? '',
      system: false,
      permissions,
      landingPath: payload.landingPath ?? '/',
      createdAt: now,
      updatedAt: now,
    };
    this.roles.push(role);
    await withTenant(tenantId, (c) => this.repo.upsert(c, role));
    return role;
  }

  /**
   * A system role's *permissions* are editable, the access matrix (US-006) is
   * where a tenant tunes what a Supervisor or a PPIC may do, and a baseline
   * transcribed from the PRD is a starting point rather than a contract. Its
   * identity, key, name, description and landing path, stays fixed so the
   * seven baseline roles remain recognisable and `SYSTEM_ROLE_PERMISSIONS`
   * keeps resolving them.
   *
   * ADMIN is the exception and stays wholly immutable: it is the only role
   * holding `role:edit`, so an admin who unticked it would lock every user of
   * the tenant out of their own permission model with no way back.
   */
  async updateRole(
    tenantId: string,
    id: string,
    payload: { name?: string; description?: string; permissions?: PermissionId[]; landingPath?: string },
    grantedBy: PermissionId[]
  ): Promise<RoleDefinition> {
    const role = this.getRole(tenantId, id);
    if (role.system && role.key === UserRole.ADMIN) {
      throw ApiError.forbidden('Peran Admin tidak dapat diubah agar akses administratif tidak terkunci.');
    }
    if (
      role.system &&
      (payload.name !== undefined || payload.description !== undefined || payload.landingPath !== undefined)
    ) {
      throw ApiError.forbidden(
        'Nama, deskripsi, dan halaman awal system role tidak dapat diubah. Hanya permission yang dapat disesuaikan.'
      );
    }
    if (payload.permissions) {
      role.permissions = this.assertGrantable(payload.permissions, grantedBy);
    }
    if (payload.name !== undefined) role.name = payload.name.trim();
    if (payload.description !== undefined) role.description = payload.description.trim();
    if (payload.landingPath !== undefined) role.landingPath = payload.landingPath;
    role.updatedAt = new Date().toISOString();
    await withTenant(tenantId, (c) => this.repo.upsert(c, role));
    return role;
  }

  async deleteRole(tenantId: string, id: string): Promise<{ success: boolean; message: string }> {
    const role = this.getRole(tenantId, id);
    if (role.system) throw ApiError.forbidden('System role tidak dapat dihapus.');

    const inUse = this.masterData.getUsers(tenantId).some((u) => String(u.role) === role.key);
    if (inUse) throw ApiError.conflict('Peran masih dipakai oleh pengguna aktif.');

    await withTenant(tenantId, (c) => this.repo.delete(c, tenantId, role.id));
    this.roles = this.roles.filter((r) => r.id !== role.id);
    return { success: true, message: `Peran ${role.name} dihapus.` };
  }

  private assertGrantable(requested: PermissionId[], grantedBy: PermissionId[]): PermissionId[] {
    const unknown = requested.filter((p) => !PERMISSION_IDS.includes(p));
    if (unknown.length > 0) {
      throw ApiError.validation(
        'Permission tidak dikenal.',
        unknown.map((p) => ({
          field: 'permissions',
          code: 'UNKNOWN_PERMISSION',
          message: `${p} tidak ada dalam katalog.`,
        }))
      );
    }
    const escalating = requested.filter((p) => isPrivileged(p) && !grantedBy.includes(p));
    if (escalating.length > 0) {
      throw ApiError.forbidden(
        `Tidak dapat memberikan permission privileged yang tidak Anda miliki: ${escalating.join(', ')}.`
      );
    }
    return Array.from(new Set(requested));
  }

  /** Effective permissions for a user, resolved through their role. */
  permissionsFor(tenantId: string, role: UserRole | string): PermissionId[] {
    this.ensureSystemRoles(tenantId);
    const custom = this.roles.find((r) => r.tenantId === tenantId && r.key === String(role));
    if (custom) return custom.permissions;
    return SYSTEM_ROLE_PERMISSIONS[role as UserRole] ?? [];
  }

  landingPathFor(tenantId: string, role: UserRole | string): string {
    const custom = this.roles.find((r) => r.tenantId === tenantId && r.key === String(role));
    return custom?.landingPath ?? ROLE_LANDING_PATH[role as UserRole] ?? '/';
  }

  /**
   * Expands a user's scope assignment into the concrete plant / line / work
   * centre ids their queries may touch.
   */
  resolveScope(user: Pick<AppUser, 'tenantId' | 'scopeLevel' | 'scopeId'>): AccessScope {
    const plants = this.masterData.getPlants(user.tenantId);
    const lines = this.masterData.getLines(user.tenantId);
    const workCenters = this.masterData.getWorkCenters(user.tenantId);

    const level = user.scopeLevel ?? 'TENANT';

    if (level === 'TENANT' || !user.scopeId) {
      return {
        level: 'TENANT',
        plantIds: plants.map((p) => p.id),
        lineIds: lines.map((l) => l.id),
        workCenterIds: workCenters.map((w) => w.id),
      };
    }

    if (level === 'PLANT') {
      const plantLines = lines.filter((l) => l.plantId === user.scopeId);
      const lineIds = plantLines.map((l) => l.id);
      return {
        level,
        id: user.scopeId,
        plantIds: [user.scopeId],
        lineIds,
        workCenterIds: workCenters.filter((w) => lineIds.includes(w.productionLineId)).map((w) => w.id),
      };
    }

    if (level === 'LINE') {
      const line = lines.find((l) => l.id === user.scopeId);
      return {
        level,
        id: user.scopeId,
        plantIds: line ? [line.plantId] : [],
        lineIds: line ? [line.id] : [],
        workCenterIds: workCenters.filter((w) => w.productionLineId === user.scopeId).map((w) => w.id),
      };
    }

    // WORK_CENTER
    const workCenter = workCenters.find((w) => w.id === user.scopeId);
    const line = workCenter ? lines.find((l) => l.id === workCenter.productionLineId) : undefined;
    return {
      level: 'WORK_CENTER',
      id: user.scopeId,
      plantIds: line ? [line.plantId] : [],
      lineIds: line ? [line.id] : [],
      workCenterIds: workCenter ? [workCenter.id] : [],
    };
  }
}

function humanizeRole(role: UserRole): string {
  return role
    .split('_')
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(' ');
}
