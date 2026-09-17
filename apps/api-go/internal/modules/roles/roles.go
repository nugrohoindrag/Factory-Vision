// Package roles is role and permission resolution (US-003, US-006).
//
// System roles are materialised per tenant on first use so the console can
// list roles and their permissions uniformly. `system: true` fixes their
// identity: a tenant may retune what each baseline role can do through the
// access matrix, but not rename, relocate or delete one, and ADMIN stays
// untouched entirely.
package roles

import (
	"context"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/masterdata"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/auth"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/cache"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/httpx"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/rbac"
)

// Role is a RoleDefinition, either one of the system roles or a
// tenant-defined custom role.
type Role struct {
	ID          string   `json:"id"`
	TenantID    string   `json:"tenantId"`
	Key         string   `json:"key"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	System      bool     `json:"system"`
	Permissions []string `json:"permissions"`
	LandingPath string   `json:"landingPath"`
	CreatedAt   string   `json:"createdAt"`
	UpdatedAt   string   `json:"updatedAt"`
}

// Service reads and writes role_definition / role_permission.
type Service struct {
	pool   *db.Pool
	master *masterdata.Service
	roles  *cache.Tenant[[]Role]
}

// NewService builds the role cache.
func NewService(pool *db.Pool, master *masterdata.Service) (*Service, error) {
	c, err := cache.New[[]Role]("roles", cache.Options{MaxEntries: 256, TTL: masterdata.CacheTTL})
	if err != nil {
		return nil, err
	}
	return &Service{pool: pool, master: master, roles: c}, nil
}

const columns = `id, tenant_id, key, name, description, is_system, landing_path, created_at, updated_at`

func (s *Service) list(ctx context.Context, tx pgx.Tx, tenantID string) ([]Role, error) {
	rows, err := tx.Query(ctx, `SELECT `+columns+` FROM role_definition WHERE tenant_id = $1 ORDER BY is_system DESC, name ASC`, tenantID)
	if err != nil {
		return nil, err
	}
	var out []Role
	index := map[string]int{}
	for rows.Next() {
		var r Role
		var description *string
		var created, updated time.Time
		if err := rows.Scan(&r.ID, &r.TenantID, &r.Key, &r.Name, &description, &r.System, &r.LandingPath, &created, &updated); err != nil {
			rows.Close()
			return nil, err
		}
		r.Description = db.StrOr(description, "")
		r.CreatedAt, r.UpdatedAt = db.ISO(created), db.ISO(updated)
		r.Permissions = []string{}
		index[r.ID] = len(out)
		out = append(out, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return []Role{}, nil
	}
	// One query for every role's permissions rather than one per role.
	perms, err := tx.Query(ctx,
		`SELECT rp.role_id, rp.permission FROM role_permission rp
		   JOIN role_definition rd ON rd.id = rp.role_id
		  WHERE rd.tenant_id = $1`, tenantID)
	if err != nil {
		return nil, err
	}
	defer perms.Close()
	for perms.Next() {
		var roleID, permission string
		if err := perms.Scan(&roleID, &permission); err != nil {
			return nil, err
		}
		if i, ok := index[roleID]; ok {
			out[i].Permissions = append(out[i].Permissions, permission)
		}
	}
	return out, perms.Err()
}

// upsert writes a role and replaces its permission set, delete-then-insert
// inside the transaction so a role is never briefly visible with half its
// permissions.
func (s *Service) upsert(ctx context.Context, tx pgx.Tx, r Role) error {
	created, _ := db.ParseISO(r.CreatedAt)
	updated, _ := db.ParseISO(r.UpdatedAt)
	if _, err := tx.Exec(ctx,
		`INSERT INTO role_definition (id, tenant_id, key, name, description, is_system, landing_path, created_at, updated_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		 ON CONFLICT (id) DO UPDATE SET
		   name = EXCLUDED.name, description = EXCLUDED.description,
		   landing_path = EXCLUDED.landing_path, updated_at = EXCLUDED.updated_at`,
		r.ID, r.TenantID, r.Key, r.Name, r.Description, r.System, r.LandingPath, created, updated); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM role_permission WHERE role_id = $1`, r.ID); err != nil {
		return err
	}
	batch := &pgx.Batch{}
	for _, p := range r.Permissions {
		batch.Queue(`INSERT INTO role_permission (role_id, permission) VALUES ($1, $2) ON CONFLICT (role_id, permission) DO NOTHING`, r.ID, p)
	}
	if batch.Len() == 0 {
		return nil
	}
	results := tx.SendBatch(ctx, batch)
	for range r.Permissions {
		if _, err := results.Exec(); err != nil {
			results.Close()
			return err
		}
	}
	return results.Close()
}

func systemRole(tenantID, key string) Role {
	now := db.Now()
	return Role{
		ID:          "role-" + tenantID + "-" + strings.ToLower(key),
		TenantID:    tenantID,
		Key:         key,
		Name:        rbac.HumanizeRole(key),
		Description: rbac.RoleDescription(key),
		System:      true,
		Permissions: rbac.BaselinePermissions(key),
		LandingPath: rbac.BaselineLandingPath(key),
		CreatedAt:   now,
		UpdatedAt:   now,
	}
}

// Roles lists the tenant's roles, materialising any system role the
// database does not yet hold. A system role missing from a non-empty
// database is also created — SALES was added to the enum after the pilot
// was provisioned and could not be assigned until it was. What this
// deliberately does not do is re-apply the baseline to roles that already
// exist: changing a baseline for an existing role is a migration.
func (s *Service) Roles(ctx context.Context, tenantID string) ([]Role, error) {
	roles, err := s.roles.Get(ctx, tenantID, func(ctx context.Context) ([]Role, error) {
		var stored []Role
		err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
			var err error
			stored, err = s.list(ctx, tx, tenantID)
			if err != nil {
				return err
			}
			have := map[string]bool{}
			for _, r := range stored {
				have[r.Key] = true
			}
			for _, key := range rbac.SystemRoles {
				if have[key] {
					continue
				}
				r := systemRole(tenantID, key)
				if err := s.upsert(ctx, tx, r); err != nil {
					return err
				}
				stored = append(stored, r)
			}
			return nil
		})
		return stored, err
	})
	if err != nil {
		return nil, err
	}
	out := append([]Role(nil), roles...)
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].System != out[j].System {
			return out[i].System
		}
		return out[i].Name < out[j].Name
	})
	return out, nil
}

// Role finds a role by id or key.
func (s *Service) Role(ctx context.Context, tenantID, id string) (Role, error) {
	roles, err := s.Roles(ctx, tenantID)
	if err != nil {
		return Role{}, err
	}
	for _, r := range roles {
		if r.ID == id || r.Key == id {
			return r, nil
		}
	}
	return Role{}, httpx.NotFound("Peran " + id + " tidak ditemukan.")
}

// PermissionsFor is the effective permission set of a role: the tenant's
// stored definition when it has one, else the baseline.
func (s *Service) PermissionsFor(ctx context.Context, tenantID, role string) ([]string, error) {
	roles, err := s.Roles(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	for _, r := range roles {
		if r.Key == role {
			return append([]string(nil), r.Permissions...), nil
		}
	}
	return rbac.BaselinePermissions(role), nil
}

// LandingPathFor is where a role lands after login.
func (s *Service) LandingPathFor(ctx context.Context, tenantID, role string) (string, error) {
	roles, err := s.Roles(ctx, tenantID)
	if err != nil {
		return "", err
	}
	for _, r := range roles {
		if r.Key == role {
			return r.LandingPath, nil
		}
	}
	return rbac.BaselineLandingPath(role), nil
}

// ResolveScope expands a user's scope assignment into the concrete plant /
// line / work centre ids their queries may touch.
func (s *Service) ResolveScope(ctx context.Context, tenantID, level string, scopeID *string) (auth.Scope, error) {
	ref, err := s.master.Reference(ctx, tenantID)
	if err != nil {
		return auth.Scope{}, err
	}
	ids := func() (plants, lines, wcs []string) {
		plants, lines, wcs = []string{}, []string{}, []string{}
		return
	}
	if level == "" {
		level = "TENANT"
	}
	if level == "TENANT" || scopeID == nil || *scopeID == "" {
		plants, lines, wcs := ids()
		for _, p := range ref.Plants {
			plants = append(plants, p.ID)
		}
		for _, l := range ref.Lines {
			lines = append(lines, l.ID)
		}
		for _, w := range ref.WorkCenters {
			wcs = append(wcs, w.ID)
		}
		return auth.Scope{Level: "TENANT", PlantIDs: plants, LineIDs: lines, WorkCenterIDs: wcs}, nil
	}
	id := *scopeID
	switch level {
	case "PLANT":
		plants, lines, wcs := ids()
		plants = append(plants, id)
		lineSet := map[string]bool{}
		for _, l := range ref.Lines {
			if l.PlantID == id {
				lines = append(lines, l.ID)
				lineSet[l.ID] = true
			}
		}
		for _, w := range ref.WorkCenters {
			if lineSet[w.ProductionLineID] {
				wcs = append(wcs, w.ID)
			}
		}
		return auth.Scope{Level: level, ID: &id, PlantIDs: plants, LineIDs: lines, WorkCenterIDs: wcs}, nil
	case "LINE":
		plants, lines, wcs := ids()
		for _, l := range ref.Lines {
			if l.ID == id {
				plants = append(plants, l.PlantID)
				lines = append(lines, l.ID)
			}
		}
		for _, w := range ref.WorkCenters {
			if w.ProductionLineID == id {
				wcs = append(wcs, w.ID)
			}
		}
		return auth.Scope{Level: level, ID: &id, PlantIDs: plants, LineIDs: lines, WorkCenterIDs: wcs}, nil
	default: // WORK_CENTER
		plants, lines, wcs := ids()
		for _, w := range ref.WorkCenters {
			if w.ID != id {
				continue
			}
			wcs = append(wcs, w.ID)
			for _, l := range ref.Lines {
				if l.ID == w.ProductionLineID {
					plants = append(plants, l.PlantID)
					lines = append(lines, l.ID)
				}
			}
		}
		return auth.Scope{Level: "WORK_CENTER", ID: &id, PlantIDs: plants, LineIDs: lines, WorkCenterIDs: wcs}, nil
	}
}

var keyCleaner = regexp.MustCompile(`[^A-Z0-9_]`)

// CreateInput is the POST /roles body after validation.
type CreateInput struct {
	Key         string
	Name        string
	Description *string
	Permissions []string
	LandingPath *string
}

// Create adds a tenant role. grantedBy is the acting principal's permission
// set: handing out a privileged permission you do not hold is forbidden.
func (s *Service) Create(ctx context.Context, tenantID string, in CreateInput, grantedBy []string) (Role, error) {
	roles, err := s.Roles(ctx, tenantID)
	if err != nil {
		return Role{}, err
	}
	key := keyCleaner.ReplaceAllString(strings.ToUpper(strings.TrimSpace(in.Key)), "_")
	for _, r := range roles {
		if r.Key == key {
			return Role{}, httpx.Conflict("Peran dengan key " + key + " sudah ada.")
		}
	}
	if rbac.IsSystemRole(key) {
		return Role{}, httpx.Conflict(key + " adalah system role dan tidak dapat dibuat ulang.")
	}
	permissions, err := assertGrantable(in.Permissions, grantedBy)
	if err != nil {
		return Role{}, err
	}
	now := db.Now()
	role := Role{
		ID:          "role-" + tenantID + "-" + strings.ToLower(key) + "-" + itoa(time.Now().UnixMilli()),
		TenantID:    tenantID,
		Key:         key,
		Name:        strings.TrimSpace(in.Name),
		Description: strings.TrimSpace(db.Deref(in.Description, "")),
		System:      false,
		Permissions: permissions,
		LandingPath: db.Deref(in.LandingPath, "/"),
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	err = s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error { return s.upsert(ctx, tx, role) })
	s.roles.Invalidate(tenantID)
	return role, err
}

// UpdateInput is the PUT /roles/:id body; nil means untouched.
type UpdateInput struct {
	Name        *string
	Description *string
	Permissions []string // nil means untouched
	LandingPath *string
}

// Update edits a role. A system role's permissions are editable — the
// access matrix is where a tenant tunes what a Supervisor may do — but its
// identity stays fixed, and ADMIN is wholly immutable: it is the only role
// holding role:edit, so an admin who unticked it would lock every user of
// the tenant out of their own permission model with no way back.
func (s *Service) Update(ctx context.Context, tenantID, id string, in UpdateInput, grantedBy []string) (Role, error) {
	role, err := s.Role(ctx, tenantID, id)
	if err != nil {
		return Role{}, err
	}
	if role.System && role.Key == "ADMIN" {
		return Role{}, httpx.Forbidden("Peran Admin tidak dapat diubah agar akses administratif tidak terkunci.")
	}
	if role.System && (in.Name != nil || in.Description != nil || in.LandingPath != nil) {
		return Role{}, httpx.Forbidden("Nama, deskripsi, dan halaman awal system role tidak dapat diubah. Hanya permission yang dapat disesuaikan.")
	}
	if in.Permissions != nil {
		perms, err := assertGrantable(in.Permissions, grantedBy)
		if err != nil {
			return Role{}, err
		}
		role.Permissions = perms
	}
	if in.Name != nil {
		role.Name = strings.TrimSpace(*in.Name)
	}
	if in.Description != nil {
		role.Description = strings.TrimSpace(*in.Description)
	}
	if in.LandingPath != nil {
		role.LandingPath = *in.LandingPath
	}
	role.UpdatedAt = db.Now()
	err = s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error { return s.upsert(ctx, tx, role) })
	s.roles.Invalidate(tenantID)
	return role, err
}

// DeleteResult is what the console shows after a delete.
type DeleteResult struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
}

// Delete removes a custom role that no user holds.
func (s *Service) Delete(ctx context.Context, tenantID, id string) (DeleteResult, error) {
	role, err := s.Role(ctx, tenantID, id)
	if err != nil {
		return DeleteResult{}, err
	}
	if role.System {
		return DeleteResult{}, httpx.Forbidden("System role tidak dapat dihapus.")
	}
	users, err := s.master.Users(ctx, tenantID)
	if err != nil {
		return DeleteResult{}, err
	}
	for _, u := range users {
		if u.Role == role.Key {
			return DeleteResult{}, httpx.Conflict("Peran masih dipakai oleh pengguna aktif.")
		}
	}
	err = s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `DELETE FROM role_definition WHERE tenant_id = $1 AND id = $2`, tenantID, role.ID)
		return err
	})
	s.roles.Invalidate(tenantID)
	if err != nil {
		return DeleteResult{}, err
	}
	return DeleteResult{Success: true, Message: "Peran " + role.Name + " dihapus."}, nil
}

func assertGrantable(requested, grantedBy []string) ([]string, error) {
	var unknown []httpx.FieldError
	for _, p := range requested {
		if !rbac.Known(p) {
			unknown = append(unknown, httpx.FieldError{Field: "permissions", Code: "UNKNOWN_PERMISSION", Message: p + " tidak ada dalam katalog."})
		}
	}
	if len(unknown) > 0 {
		return nil, httpx.Validation("Permission tidak dikenal.", unknown...)
	}
	held := map[string]bool{}
	for _, p := range grantedBy {
		held[p] = true
	}
	var escalating []string
	for _, p := range requested {
		if rbac.IsPrivileged(p) && !held[p] {
			escalating = append(escalating, p)
		}
	}
	if len(escalating) > 0 {
		return nil, httpx.Forbidden("Tidak dapat memberikan permission privileged yang tidak Anda miliki: " + strings.Join(escalating, ", ") + ".")
	}
	// De-duplicated, in the order requested.
	seen := map[string]bool{}
	out := make([]string, 0, len(requested))
	for _, p := range requested {
		if !seen[p] {
			seen[p] = true
			out = append(out, p)
		}
	}
	return out, nil
}

func itoa(n int64) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}
