import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FactoryVisionApiClient, ApiRequestError } from '@factory-vision/api-client';
import type { PermissionDefinition, RoleDefinition } from '@factory-vision/domain-types';
import { Button, Checkbox, Icon } from '@factory-vision/ui';
import { SurfaceCard } from '@factory-vision/ui/fv';
import { useSession } from '../../../app/SessionContext.js';

const api = new FactoryVisionApiClient({ baseUrl: '' });

/** The one role the matrix never lets go of, the server refuses it too. */
const LOCKED_ROLE_KEY = 'ADMIN';

const MODULE_LABEL: Record<string, string> = {
  dashboard: 'Dashboard',
  production_order: 'Production Order',
  work_order: 'Work Order',
  batch: 'Batch dan Lot',
  shopfloor: 'Shop Floor',
  production_record: 'Catatan Produksi',
  downtime: 'Downtime',
  reject: 'Reject',
  correction: 'Koreksi Data',
  shift: 'Shift',
  analytics: 'Analitik',
  report: 'Laporan',
  master_data: 'Master Data',
  device: 'Terminal',
  user: 'Pengguna',
  role: 'Peran dan Permission',
  audit: 'Audit Trail',
  configuration: 'Konfigurasi Sistem',
};

/** `Record<roleId, permissionId[]>`, the matrix as the console is editing it. */
type Draft = Record<string, string[]>;

const draftFromRoles = (roles: RoleDefinition[]): Draft =>
  Object.fromEntries(roles.map((role) => [role.id, [...role.permissions].sort()]));

const sameSet = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * US-006, the access matrix as the thing it describes.
 *
 * The matrix used to be a hard-coded transcription of the PRD's ACL baseline,
 * so it could disagree with the permissions the API actually enforced and
 * nobody would know. It is now the roles themselves: one column per role, one
 * row per permission in the catalogue, and a checkbox is the grant. Reading it
 * and changing it are the same gesture, which is the only way a permission
 * table stays true.
 *
 * Two cells stay locked. ADMIN, because it is the only role holding
 * `role:edit` and unticking it would lock a tenant out of its own permission
 * model; and a privileged permission the acting admin does not hold, because
 * the server refuses that grant anyway (no escalation by proxy).
 */
export const AclMatrixTab: React.FC<{ onToast: (message: string) => void }> = ({ onToast }) => {
  const queryClient = useQueryClient();
  const { can, principal } = useSession();
  const editable = can('role:edit');

  const [draft, setDraft] = useState<Draft>({});
  const [error, setError] = useState<string | null>(null);

  const { data: roles = [], isLoading: rolesLoading } = useQuery({
    queryKey: ['roles'],
    queryFn: () => api.rbac.getRoles(),
  });
  const { data: permissions = [], isLoading: permissionsLoading } = useQuery({
    queryKey: ['permissions'],
    queryFn: () => api.rbac.getPermissions(),
  });

  // The server's roles are the baseline the draft is measured against, so a
  // save elsewhere (or a reload) re-seeds rather than silently conflicts.
  useEffect(() => {
    if (roles.length > 0) setDraft(draftFromRoles(roles));
  }, [roles]);

  const grouped = useMemo(() => {
    const map = new Map<string, PermissionDefinition[]>();
    for (const permission of permissions) {
      const list = map.get(permission.module) ?? [];
      list.push(permission);
      map.set(permission.module, list);
    }
    return Array.from(map.entries());
  }, [permissions]);

  const baseline = useMemo(() => draftFromRoles(roles), [roles]);
  const dirtyRoleIds = useMemo(
    () => roles.filter((role) => !sameSet(draft[role.id] ?? [], baseline[role.id] ?? [])).map((r) => r.id),
    [roles, draft, baseline]
  );

  const save = useMutation({
    mutationFn: async (ids: string[]) => {
      // Sequential: one rejected grant should name the role it came from.
      for (const id of ids) {
        await api.rbac.updateRole(id, { permissions: draft[id] ?? [] });
      }
      return ids.length;
    },
    onSuccess: (count) => {
      setError(null);
      onToast(`${count} peran diperbarui dan perubahan tercatat pada audit trail.`);
      queryClient.invalidateQueries({ queryKey: ['roles'] });
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : 'Gagal menyimpan hak akses.'),
  });

  /** Whether this cell may be ticked, and why not when it may not. */
  const lockReason = (role: RoleDefinition, permission: PermissionDefinition): string | null => {
    if (!editable) return 'Peran Anda tidak memiliki izin role:edit.';
    if (role.key === LOCKED_ROLE_KEY) {
      return 'Peran Admin dikunci agar akses administratif tidak dapat terkunci dari dalam.';
    }
    if (permission.privileged && !(principal?.permissions.includes(permission.id) ?? false)) {
      return 'Permission privileged hanya dapat diberikan oleh admin yang sudah memilikinya.';
    }
    return null;
  };

  const toggle = (roleId: string, permissionId: string) => {
    setDraft((current) => {
      const held = current[roleId] ?? [];
      const next = held.includes(permissionId)
        ? held.filter((p) => p !== permissionId)
        : [...held, permissionId].sort();
      return { ...current, [roleId]: next };
    });
  };

  if (rolesLoading || permissionsLoading) {
    return <Empty label="Memuat matriks hak akses…" />;
  }

  const headCell: React.CSSProperties = {
    padding: '10px 12px',
    fontSize: '11px',
    fontWeight: 700,
    textAlign: 'center',
    color: 'var(--color-on-primary)',
    whiteSpace: 'nowrap',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: '12px',
            color: 'var(--color-on-surface-variant)',
            maxWidth: '680px',
            lineHeight: 1.6,
          }}
        >
          Centang permission yang boleh dijalankan setiap peran. Matriks ini adalah hak akses yang benar-benar
          dipakai API, bukan salinan dokumen, sehingga perubahan langsung berlaku pada seluruh pengguna dengan
          peran tersebut. Peran <strong>Admin</strong> dikunci, dan permission bertanda{' '}
          <strong>privileged</strong> hanya dapat diberikan oleh admin yang sudah memilikinya.
        </p>

        {editable && (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <Button
              variant="text"
              disabled={dirtyRoleIds.length === 0 || save.isPending}
              onClick={() => {
                setDraft(draftFromRoles(roles));
                setError(null);
              }}
            >
              Batalkan Perubahan
            </Button>
            <Button
              variant="filled"
              icon={<Icon name="save" size={16} />}
              disabled={dirtyRoleIds.length === 0 || save.isPending}
              onClick={() => save.mutate(dirtyRoleIds)}
            >
              {save.isPending
                ? 'Menyimpan…'
                : dirtyRoleIds.length > 0
                  ? `Simpan ${dirtyRoleIds.length} Peran`
                  : 'Simpan Perubahan'}
            </Button>
          </div>
        )}
      </div>

      {!editable && (
        <div
          style={{
            padding: '10px 12px',
            borderRadius: 'var(--radius-sm, 8px)',
            backgroundColor: 'var(--color-surface-container-high)',
            color: 'var(--color-on-surface-variant)',
            fontSize: '12px',
            fontWeight: 600,
          }}
        >
          Peran Anda tidak memiliki izin <code>role:edit</code>, matriks ditampilkan sebagai bacaan saja.
        </div>
      )}

      {error && (
        <div
          role="alert"
          style={{
            padding: '10px 12px',
            borderRadius: 'var(--radius-sm, 8px)',
            backgroundColor: 'var(--color-error-container)',
            color: 'var(--color-on-error-container)',
            fontSize: '12px',
            fontWeight: 600,
          }}
        >
          {error}
        </div>
      )}

      <SurfaceCard padding="none">
        <div style={{ overflowX: 'auto', borderRadius: 'var(--radius-xl)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--color-primary)' }}>
                <th
                  style={{
                    ...headCell,
                    textAlign: 'left',
                    padding: '10px 20px',
                    position: 'sticky',
                    left: 0,
                    zIndex: 2,
                    backgroundColor: 'var(--color-primary)',
                    minWidth: '280px',
                  }}
                >
                  Permission
                </th>
                {roles.map((role) => (
                  <th key={role.id} style={headCell}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        {role.name}
                        {role.key === LOCKED_ROLE_KEY && <Icon name="lock" size={13} />}
                      </span>
                      <span style={{ fontSize: '10px', fontWeight: 600, opacity: 0.75 }}>
                        {(draft[role.id] ?? []).length} permission
                      </span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {grouped.map(([module, list]) => (
                <React.Fragment key={module}>
                  <tr style={{ backgroundColor: 'var(--color-surface-container)' }}>
                    <td
                      colSpan={roles.length + 1}
                      style={{
                        padding: '8px 20px',
                        fontSize: '11px',
                        fontWeight: 800,
                        letterSpacing: '0.04em',
                        textTransform: 'uppercase',
                        color: 'var(--color-on-surface-variant)',
                      }}
                    >
                      {MODULE_LABEL[module] ?? module.replace(/_/g, ' ')}
                    </td>
                  </tr>

                  {list.map((permission) => (
                    <tr
                      key={permission.id}
                      style={{ borderBottom: '1px solid var(--color-outline-variant)' }}
                    >
                      <td
                        style={{
                          padding: '10px 20px',
                          position: 'sticky',
                          left: 0,
                          zIndex: 1,
                          backgroundColor: 'var(--color-surface)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <code style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-on-surface)' }}>
                            {permission.id}
                          </code>
                          {permission.privileged && (
                            <span
                              style={{
                                padding: '1px 6px',
                                borderRadius: 'var(--radius-full, 999px)',
                                fontSize: '9px',
                                fontWeight: 700,
                                backgroundColor: 'var(--color-error-container)',
                                color: 'var(--color-on-error-container)',
                              }}
                            >
                              PRIVILEGED
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                          {permission.description}
                        </div>
                      </td>

                      {roles.map((role) => {
                        const locked = lockReason(role, permission);
                        return (
                          <td key={role.id} style={{ padding: '10px 12px' }}>
                            <div
                              title={locked ?? `${role.name}, ${permission.description}`}
                              style={{ display: 'flex', justifyContent: 'center' }}
                            >
                              <Checkbox
                                checked={(draft[role.id] ?? []).includes(permission.id)}
                                disabled={locked !== null}
                                onChange={() => toggle(role.id, permission.id)}
                              />
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </SurfaceCard>
    </div>
  );
};

const Empty: React.FC<{ label: string }> = ({ label }) => (
  <div
    style={{ padding: '28px', textAlign: 'center', color: 'var(--color-on-surface-variant)', fontSize: '12px' }}
  >
    {label}
  </div>
);
