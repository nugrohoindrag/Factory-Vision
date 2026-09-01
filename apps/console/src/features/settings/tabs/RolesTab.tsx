import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FactoryVisionApiClient, ApiRequestError } from '@factory-vision/api-client';
import type { PermissionDefinition, RoleDefinition } from '@factory-vision/domain-types';
import { Button, Icon, Modal } from '@factory-vision/ui';
import { SurfaceCard } from '@factory-vision/ui/fv';
import { useSession } from '../../../app/SessionContext.js';

const api = new FactoryVisionApiClient({ baseUrl: '' });

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: `var(--space-3) var(--space-3)`,
  borderRadius: 'var(--radius-md, 8px)',
  backgroundColor: 'var(--color-surface-container-high)',
  border: '1px solid var(--color-outline-variant)',
  color: 'var(--color-on-surface)',
  fontSize: '13px',
  boxSizing: 'border-box',
};

interface RoleForm {
  id?: string;
  key: string;
  name: string;
  description: string;
  permissions: string[];
  landingPath: string;
}

const EMPTY: RoleForm = { key: '', name: '', description: '', permissions: [], landingPath: '/' };

/**
 * US-006, Manage Roles & Permissions.
 *
 * System roles are shown but locked: lets a tenant *add* roles, not
 * redefine the seven baseline ones, and an editable Admin role would be a way
 * to lock everyone out of their own MES. Privileged permissions are marked, and
 * the server refuses to grant one the acting admin does not already hold.
 */
export const RolesTab: React.FC<{ onToast: (message: string) => void }> = ({ onToast }) => {
  const queryClient = useQueryClient();
  const { can, principal } = useSession();
  const editable = can('role:create') || can('role:edit');

  const [form, setForm] = useState<RoleForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: roles = [], isLoading } = useQuery({ queryKey: ['roles'], queryFn: () => api.rbac.getRoles() });
  const { data: permissions = [] } = useQuery({
    queryKey: ['permissions'],
    queryFn: () => api.rbac.getPermissions(),
  });

  const grouped = useMemo(() => {
    const map = new Map<string, PermissionDefinition[]>();
    for (const permission of permissions) {
      const list = map.get(permission.module) ?? [];
      list.push(permission);
      map.set(permission.module, list);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [permissions]);

  const save = useMutation({
    mutationFn: (payload: RoleForm) =>
      payload.id
        ? api.rbac.updateRole(payload.id, {
            name: payload.name,
            description: payload.description,
            permissions: payload.permissions,
            landingPath: payload.landingPath,
          })
        : api.rbac.createRole({
            key: payload.key,
            name: payload.name,
            description: payload.description,
            permissions: payload.permissions,
            landingPath: payload.landingPath,
          }),
    onSuccess: () => {
      onToast('Peran tersimpan dan perubahan tercatat pada audit trail.');
      setForm(null);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['roles'] });
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : 'Gagal menyimpan peran.'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.rbac.deleteRole(id),
    onSuccess: () => {
      onToast('Peran dihapus.');
      queryClient.invalidateQueries({ queryKey: ['roles'] });
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : 'Gagal menghapus peran.'),
  });

  const togglePermission = (id: string) => {
    if (!form) return;
    setForm({
      ...form,
      permissions: form.permissions.includes(id)
        ? form.permissions.filter((p) => p !== id)
        : [...form.permissions, id],
    });
  };

  const openEdit = (role: RoleDefinition) => {
    setError(null);
    setForm({
      id: role.id,
      key: role.key,
      name: role.name,
      description: role.description,
      permissions: [...role.permissions],
      landingPath: role.landingPath,
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 'var(--space-3)',
          flexWrap: 'wrap',
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: '12px',
            color: 'var(--color-on-surface-variant)',
            maxWidth: '640px',
            lineHeight: 1.6,
          }}
        >
          Permission memakai format <code>module:action</code>. Permission bertanda <strong>privileged</strong>{' '}
          hanya dapat diberikan oleh admin yang sudah memilikinya.
        </p>
        {can('role:create') && (
          <Button variant="filled" icon={<Icon name="add" size={16} />} onClick={() => setForm({ ...EMPTY })}>
            Buat Custom Role
          </Button>
        )}
      </div>

      {error && (
        <div
          role="alert"
          style={{
            padding: `var(--space-3) var(--space-3)`,
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

      {isLoading ? (
        <Empty label="Memuat peran…" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {roles.map((role) => (
            <SurfaceCard key={role.id} padding="md">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <span style={{ fontSize: '14px', fontWeight: 800, color: 'var(--color-on-surface)' }}>
                      {role.name}
                    </span>
                    <span
                      style={{
                        padding: `var(--space-1) var(--space-2)`,
                        borderRadius: 'var(--radius-full, 999px)',
                        fontSize: '10px',
                        fontWeight: 700,
                        backgroundColor: role.system
                          ? 'var(--color-primary)'
                          : 'var(--color-tertiary-container)',
                        color: role.system ? 'var(--color-on-primary)' : 'var(--color-on-tertiary-container)',
                      }}
                    >
                      {role.system ? 'SYSTEM' : 'CUSTOM'}
                    </span>
                    {principal?.role === role.key && (
                      <span
                        style={{ fontSize: '10px', fontWeight: 700, color: 'var(--color-on-surface-variant)' }}
                      >
                        (peran Anda)
                      </span>
                    )}
                  </div>
                  <p style={{ margin: `var(--space-1) 0 0`, fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
                    {role.description}
                  </p>
                  <div style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)', marginTop: 'var(--space-1)' }}>
                    {role.permissions.length} permission · landing <code>{role.landingPath}</code>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start' }}>
                  <Button variant="text" onClick={() => setExpanded(expanded === role.id ? null : role.id)}>
                    {expanded === role.id ? 'Sembunyikan' : 'Lihat Permission'}
                  </Button>
                  {editable && !role.system && (
                    <>
                      <Button variant="tonal" onClick={() => openEdit(role)}>
                        Ubah
                      </Button>
                      <Button variant="text" onClick={() => remove.mutate(role.id)}>
                        Hapus
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {expanded === role.id && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
                  {role.permissions.length === 0 && (
                    <span style={{ fontSize: '12px', color: 'var(--color-on-surface-variant)' }}>
                      Peran ini belum memiliki permission.
                    </span>
                  )}
                  {role.permissions.map((permission) => (
                    <code
                      key={permission}
                      style={{
                        padding: `var(--space-1) var(--space-2)`,
                        borderRadius: 'var(--radius-xs, 4px)',
                        backgroundColor: 'var(--color-surface-container-high)',
                        color: 'var(--color-on-surface)',
                        fontSize: '11px',
                      }}
                    >
                      {permission}
                    </code>
                  ))}
                </div>
              )}
            </SurfaceCard>
          ))}
        </div>
      )}

      <Modal
        isOpen={form !== null}
        onClose={() => setForm(null)}
        title={form?.id ? 'Ubah Custom Role' : 'Buat Custom Role'}
      >
        {form && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-3)',
              maxHeight: '70vh',
              overflowY: 'auto',
            }}
          >
            {!form.id && (
              <Field label="Key (huruf kapital, tanpa spasi)">
                <input
                  value={form.key}
                  onChange={(e) => setForm({ ...form, key: e.target.value.toUpperCase() })}
                  placeholder="LEAD_QC"
                  style={inputStyle}
                />
              </Field>
            )}

            <Field label="Nama Peran">
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Lead Quality Control"
                style={inputStyle}
              />
            </Field>

            <Field label="Deskripsi">
              <input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Tanggung jawab peran ini"
                style={inputStyle}
              />
            </Field>

            <Field label="Halaman Awal Setelah Login">
              <input
                value={form.landingPath}
                onChange={(e) => setForm({ ...form, landingPath: e.target.value })}
                placeholder="/"
                style={inputStyle}
              />
            </Field>

            <div>
              <div
                style={{
                  fontSize: '12px',
                  fontWeight: 800,
                  color: 'var(--color-on-surface)',
                  marginBottom: 'var(--space-2)',
                }}
              >
                Permission ({form.permissions.length} dipilih)
              </div>
              {grouped.map(([module, list]) => (
                <div key={module} style={{ marginBottom: 'var(--space-3)' }}>
                  <div
                    style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      color: 'var(--color-on-surface-variant)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      marginBottom: 'var(--space-1)',
                    }}
                  >
                    {module.replace(/_/g, ' ')}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                    {list.map((permission) => {
                      const held = principal?.permissions.includes(permission.id) ?? false;
                      const blocked = permission.privileged && !held;
                      return (
                        <label
                          key={permission.id}
                          title={
                            blocked ? 'Anda tidak memiliki permission privileged ini' : permission.description
                          }
                          style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 'var(--space-2)',
                            fontSize: '12px',
                            color: blocked ? 'var(--color-on-surface-variant)' : 'var(--color-on-surface)',
                            opacity: blocked ? 0.55 : 1,
                          }}
                        >
                          <input
                            type="checkbox"
                            disabled={blocked}
                            checked={form.permissions.includes(permission.id)}
                            onChange={() => togglePermission(permission.id)}
                          />
                          <span>
                            <code style={{ fontSize: '11px' }}>{permission.id}</code>
                            {permission.privileged && (
                              <span
                                style={{
                                  marginLeft: 'var(--space-2)',
                                  padding: `var(--space-1) var(--space-2)`,
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
                            <br />
                            <span style={{ fontSize: '11px', color: 'var(--color-on-surface-variant)' }}>
                              {permission.description}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div
              style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end', position: 'sticky', bottom: 0 }}
            >
              <Button variant="text" onClick={() => setForm(null)}>
                Batal
              </Button>
              <Button
                variant="filled"
                disabled={
                  save.isPending || form.name.trim().length < 2 || (!form.id && form.key.trim().length < 2)
                }
                onClick={() => save.mutate(form)}
              >
                {save.isPending ? 'Menyimpan…' : 'Simpan'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
    <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-on-surface-variant)' }}>{label}</span>
    {children}
  </label>
);

const Empty: React.FC<{ label: string }> = ({ label }) => (
  <div
    style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--color-on-surface-variant)', fontSize: '12px' }}
  >
    {label}
  </div>
);
