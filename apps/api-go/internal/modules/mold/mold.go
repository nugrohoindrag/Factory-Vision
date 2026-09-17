// Package mold is mould master data (MES-006) and the product compatibility
// ADR-36 reads: a Work Order needs a mould exactly while its product has an
// active compatibility.
//
// A mould in use cannot be retired, a mould production has referenced
// cannot be deleted, and a compatibility is deactivated, never dropped,
// once anything might have been confirmed against it — the row is the
// evidence for why that confirmation was allowed.
package mold

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/audit"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/httpx"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/tenancy"
)

// Mold is the TypeScript Mold plus the current machine's name.
type Mold struct {
	ID                 string  `json:"id"`
	TenantID           string  `json:"tenantId"`
	Code               string  `json:"code"`
	Name               string  `json:"name"`
	CavityCount        int     `json:"cavityCount"`
	Status             string  `json:"status"`
	CurrentMachineID   *string `json:"currentMachineId,omitempty"`
	CurrentMachineName *string `json:"currentMachineName,omitempty"`
	CreatedAt          *string `json:"createdAt,omitempty"`
	UpdatedAt          *string `json:"updatedAt,omitempty"`
}

// Compatibility is the TypeScript ProductMoldCompatibility with the product.
type Compatibility struct {
	ID          string  `json:"id"`
	TenantID    string  `json:"tenantId"`
	ProductID   string  `json:"productId"`
	MoldID      string  `json:"moldId"`
	Active      bool    `json:"active"`
	CreatedAt   *string `json:"createdAt,omitempty"`
	ProductSku  *string `json:"productSku,omitempty"`
	ProductName *string `json:"productName,omitempty"`
}

// Detail is a mould with its compatibilities.
type Detail struct {
	Mold
	Compatibilities []Compatibility `json:"compatibilities"`
}

// Filter narrows the list.
type Filter struct {
	Status, Search, ProductID, MachineID string
}

// Input is a create or patch.
type Input struct {
	Code, Name         *string
	CavityCount        *int
	Status             *string
	CurrentMachineID   *string
	MachineIDMentioned bool
}

var statuses = []string{"AVAILABLE", "IN_USE", "MAINTENANCE", "RETIRED"}

const moldColumns = `m.id, m.tenant_id, m.code, m.name, m.cavity_count, m.status, m.current_machine_id, m.created_at, m.updated_at`

func scanMold(row pgx.Row, withMachine bool) (Mold, error) {
	var m Mold
	var created, updated *time.Time
	dest := []any{&m.ID, &m.TenantID, &m.Code, &m.Name, &m.CavityCount, &m.Status, &m.CurrentMachineID, &created, &updated}
	if withMachine {
		dest = append(dest, &m.CurrentMachineName)
	}
	if err := row.Scan(dest...); err != nil {
		return Mold{}, err
	}
	m.CreatedAt, m.UpdatedAt = db.ISOPtr(created), db.ISOPtr(updated)
	return m, nil
}

func scanCompat(row pgx.Row, withProduct bool) (Compatibility, error) {
	var c Compatibility
	var created *time.Time
	dest := []any{&c.ID, &c.TenantID, &c.ProductID, &c.MoldID, &c.Active, &created}
	if withProduct {
		dest = append(dest, &c.ProductSku, &c.ProductName)
	}
	if err := row.Scan(dest...); err != nil {
		return Compatibility{}, err
	}
	c.CreatedAt = db.ISOPtr(created)
	return c, nil
}

// Repository is mold and product_mold_compatibility.
type Repository struct{}

// List filters moulds; productId keeps only those with an active compatibility.
func (Repository) List(ctx context.Context, tx pgx.Tx, tenantID string, f Filter) ([]Mold, error) {
	where, args := []string{"m.tenant_id = $1"}, []any{tenantID}
	if f.Status != "" {
		args = append(args, f.Status)
		where = append(where, fmt.Sprintf("m.status = $%d", len(args)))
	}
	if f.MachineID != "" {
		args = append(args, f.MachineID)
		where = append(where, fmt.Sprintf("m.current_machine_id = $%d", len(args)))
	}
	if f.Search != "" {
		args = append(args, "%"+strings.ToLower(f.Search)+"%")
		where = append(where, fmt.Sprintf("(lower(m.code) LIKE $%d OR lower(m.name) LIKE $%d)", len(args), len(args)))
	}
	if f.ProductID != "" {
		args = append(args, f.ProductID)
		where = append(where, fmt.Sprintf("EXISTS (SELECT 1 FROM product_mold_compatibility c WHERE c.tenant_id = m.tenant_id AND c.mold_id = m.id AND c.product_id = $%d AND c.active = TRUE)", len(args)))
	}
	rows, err := tx.Query(ctx, `SELECT `+moldColumns+`, mc.name FROM mold m LEFT JOIN machine mc ON mc.id = m.current_machine_id AND mc.tenant_id = m.tenant_id
		WHERE `+strings.Join(where, " AND ")+` ORDER BY m.code`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Mold{}
	for rows.Next() {
		m, err := scanMold(rows, true)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func moldOrNil(m Mold, err error) (*Mold, error) {
	if db.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &m, nil
}

// FindByID reads one mould; nil when absent.
func (Repository) FindByID(ctx context.Context, tx pgx.Tx, tenantID, id string) (*Mold, error) {
	return moldOrNil(scanMold(tx.QueryRow(ctx, `SELECT `+moldColumns+`, mc.name FROM mold m LEFT JOIN machine mc ON mc.id = m.current_machine_id AND mc.tenant_id = m.tenant_id
		WHERE m.tenant_id = $1 AND m.id = $2`, tenantID, id), true))
}

// FindByCode reads one mould by code, case-insensitively.
func (Repository) FindByCode(ctx context.Context, tx pgx.Tx, tenantID, code string) (*Mold, error) {
	return moldOrNil(scanMold(tx.QueryRow(ctx, `SELECT `+moldColumns+` FROM mold m WHERE m.tenant_id = $1 AND lower(m.code) = lower($2)`, tenantID, code), false))
}

// Create inserts a mould.
func (Repository) Create(ctx context.Context, tx pgx.Tx, tenantID string, in Input) (Mold, error) {
	return scanMold(tx.QueryRow(ctx, `INSERT INTO mold (id, tenant_id, code, name, cavity_count, status, current_machine_id) VALUES ($1,$2,$3,$4,$5,$6,$7)
		RETURNING id, tenant_id, code, name, cavity_count, status, current_machine_id, created_at, updated_at`,
		"mold-"+uuid.NewString(), tenantID, db.Deref(in.Code, ""), db.Deref(in.Name, ""), db.Deref(in.CavityCount, 1), db.Deref(in.Status, "AVAILABLE"), in.CurrentMachineID), false)
}

// Update patches the mentioned fields; a mentioned nil machine detaches.
func (r Repository) Update(ctx context.Context, tx pgx.Tx, tenantID, id string, in Input) (*Mold, error) {
	sets, args := []string{}, []any{tenantID, id}
	push := func(column string, v any) {
		args = append(args, v)
		sets = append(sets, fmt.Sprintf("%s = $%d", column, len(args)))
	}
	if in.Code != nil {
		push("code", *in.Code)
	}
	if in.Name != nil {
		push("name", *in.Name)
	}
	if in.CavityCount != nil {
		push("cavity_count", *in.CavityCount)
	}
	if in.Status != nil {
		push("status", *in.Status)
	}
	if in.MachineIDMentioned {
		push("current_machine_id", in.CurrentMachineID)
	}
	if len(sets) == 0 {
		return r.FindByID(ctx, tx, tenantID, id)
	}
	sets = append(sets, "updated_at = CURRENT_TIMESTAMP")
	return moldOrNil(scanMold(tx.QueryRow(ctx, `UPDATE mold SET `+strings.Join(sets, ", ")+` WHERE tenant_id = $1 AND id = $2
		RETURNING id, tenant_id, code, name, cavity_count, status, current_machine_id, created_at, updated_at`, args...), false))
}

// ReferenceCounts is what makes a mould undeletable.
func (Repository) ReferenceCounts(ctx context.Context, tx pgx.Tx, tenantID, id string) (workOrders, batches int, err error) {
	err = tx.QueryRow(ctx, `SELECT (SELECT count(*) FROM work_order WHERE tenant_id = $1 AND mold_id = $2), (SELECT count(*) FROM production_batch WHERE tenant_id = $1 AND mold_id = $2)`, tenantID, id).Scan(&workOrders, &batches)
	return
}

// ListCompatibilities lists links, with the product's SKU and name.
func (Repository) ListCompatibilities(ctx context.Context, tx pgx.Tx, tenantID, moldID, productID string, activeOnly bool) ([]Compatibility, error) {
	where, args := []string{"c.tenant_id = $1"}, []any{tenantID}
	if moldID != "" {
		args = append(args, moldID)
		where = append(where, fmt.Sprintf("c.mold_id = $%d", len(args)))
	}
	if productID != "" {
		args = append(args, productID)
		where = append(where, fmt.Sprintf("c.product_id = $%d", len(args)))
	}
	if activeOnly {
		where = append(where, "c.active = TRUE")
	}
	rows, err := tx.Query(ctx, `SELECT c.id, c.tenant_id, c.product_id, c.mold_id, c.active, c.created_at, p.sku, p.name
		FROM product_mold_compatibility c LEFT JOIN product p ON p.id = c.product_id AND p.tenant_id = c.tenant_id
		WHERE `+strings.Join(where, " AND ")+` ORDER BY p.sku NULLS LAST, c.created_at`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Compatibility{}
	for rows.Next() {
		c, err := scanCompat(rows, true)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// FindCompatibility reads one link; nil when absent.
func (Repository) FindCompatibility(ctx context.Context, tx pgx.Tx, tenantID, id string) (*Compatibility, error) {
	c, err := scanCompat(tx.QueryRow(ctx, `SELECT id, tenant_id, product_id, mold_id, active, created_at FROM product_mold_compatibility WHERE tenant_id = $1 AND id = $2`, tenantID, id), false)
	if db.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// UpsertCompatibility links a product to a mould, reactivating an existing link.
func (Repository) UpsertCompatibility(ctx context.Context, tx pgx.Tx, tenantID, moldID, productID string, active bool) (Compatibility, error) {
	return scanCompat(tx.QueryRow(ctx, `INSERT INTO product_mold_compatibility (id, tenant_id, product_id, mold_id, active) VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (tenant_id, product_id, mold_id) DO UPDATE SET active = EXCLUDED.active RETURNING id, tenant_id, product_id, mold_id, active, created_at`,
		"pmc-"+uuid.NewString(), tenantID, productID, moldID, active), false)
}

// SetCompatibilityActive switches a link on or off.
func (Repository) SetCompatibilityActive(ctx context.Context, tx pgx.Tx, tenantID, id string, active bool) (*Compatibility, error) {
	c, err := scanCompat(tx.QueryRow(ctx, `UPDATE product_mold_compatibility SET active = $3 WHERE tenant_id = $1 AND id = $2 RETURNING id, tenant_id, product_id, mold_id, active, created_at`, tenantID, id, active), false)
	if db.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func exists(ctx context.Context, tx pgx.Tx, query, tenantID, id string) (bool, error) {
	var one int
	err := tx.QueryRow(ctx, query, tenantID, id).Scan(&one)
	if db.IsNoRows(err) {
		return false, nil
	}
	return err == nil, err
}

// --- Service ------------------------------------------------------------------

// Service is the mould module.
type Service struct {
	pool *db.Pool
	repo Repository
}

// NewService wires the module.
func NewService(pool *db.Pool) *Service { return &Service{pool: pool} }

// Molds lists moulds.
func (s *Service) Molds(ctx context.Context, tenantID string, f Filter) ([]Mold, error) {
	var out []Mold
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.repo.List(ctx, tx, tenantID, f)
		return err
	})
	return out, err
}

// Mold reads one mould with its compatibilities.
func (s *Service) Mold(ctx context.Context, tenantID, id string) (Detail, error) {
	var out Detail
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		m, err := s.repo.FindByID(ctx, tx, tenantID, id)
		if err != nil {
			return err
		}
		if m == nil {
			return httpx.NotFound("Mold tidak ditemukan.")
		}
		compat, err := s.repo.ListCompatibilities(ctx, tx, tenantID, id, "", false)
		if err != nil {
			return err
		}
		out = Detail{Mold: *m, Compatibilities: compat}
		return nil
	})
	return out, err
}

func (s *Service) assertMachine(ctx context.Context, tx pgx.Tx, tenantID string, machineID *string) error {
	if machineID == nil || *machineID == "" {
		return nil
	}
	ok, err := exists(ctx, tx, `SELECT 1 FROM machine WHERE tenant_id = $1 AND id = $2`, tenantID, *machineID)
	if err != nil {
		return err
	}
	if !ok {
		return httpx.Validation("Mesin tidak ditemukan.", httpx.FieldError{Field: "currentMachineId", Code: "NOT_FOUND", Message: "Mesin tidak ditemukan."})
	}
	return nil
}

// Create adds a mould; the code clash is checked first so the operator sees
// which code clashed rather than a constraint name.
func (s *Service) Create(ctx context.Context, tenantID string, in Input) (Mold, error) {
	var out Mold
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		existing, err := s.repo.FindByCode(ctx, tx, tenantID, db.Deref(in.Code, ""))
		if err != nil {
			return err
		}
		if existing != nil {
			return httpx.Conflict(fmt.Sprintf("Kode mold %s sudah digunakan.", *in.Code))
		}
		if err := s.assertMachine(ctx, tx, tenantID, in.CurrentMachineID); err != nil {
			return err
		}
		out, err = s.repo.Create(ctx, tx, tenantID, in)
		return err
	})
	return out, err
}

// Update patches a mould.
func (s *Service) Update(ctx context.Context, tenantID, id string, in Input) (Mold, error) {
	var out Mold
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		current, err := s.repo.FindByID(ctx, tx, tenantID, id)
		if err != nil {
			return err
		}
		if current == nil {
			return httpx.NotFound("Mold tidak ditemukan.")
		}
		if in.Code != nil && *in.Code != "" && !strings.EqualFold(*in.Code, current.Code) {
			clash, err := s.repo.FindByCode(ctx, tx, tenantID, *in.Code)
			if err != nil {
				return err
			}
			if clash != nil {
				return httpx.Conflict(fmt.Sprintf("Kode mold %s sudah digunakan.", *in.Code))
			}
		}
		if err := s.assertMachine(ctx, tx, tenantID, in.CurrentMachineID); err != nil {
			return err
		}
		if in.Status != nil && *in.Status != "" && *in.Status != current.Status {
			if indexOf(statuses, *in.Status) < 0 {
				return httpx.Validation(fmt.Sprintf("Status mold %s tidak dikenal.", *in.Status))
			}
			// A mould cannot leave the register while a machine is running it.
			if current.Status == "IN_USE" && *in.Status == "RETIRED" {
				return httpx.InvalidState(fmt.Sprintf("Mold %s sedang IN_USE dan tidak dapat langsung di-RETIRED. Lepaskan dari mesin terlebih dahulu.", current.Code))
			}
		}
		updated, err := s.repo.Update(ctx, tx, tenantID, id, in)
		if err != nil {
			return err
		}
		if updated == nil {
			return httpx.NotFound("Mold tidak ditemukan.")
		}
		out = *updated
		return nil
	})
	return out, err
}

// Remove deletes a mould, or explains why it cannot be.
func (s *Service) Remove(ctx context.Context, tenantID, id string) error {
	return s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		m, err := s.repo.FindByID(ctx, tx, tenantID, id)
		if err != nil {
			return err
		}
		if m == nil {
			return httpx.NotFound("Mold tidak ditemukan.")
		}
		workOrders, batches, err := s.repo.ReferenceCounts(ctx, tx, tenantID, id)
		if err != nil {
			return err
		}
		if workOrders > 0 || batches > 0 {
			return httpx.Conflict(fmt.Sprintf("Mold %s tidak dapat dihapus karena masih dipakai %d work order dan %d batch. Ubah statusnya menjadi RETIRED bila mold sudah tidak dipakai.", m.Code, workOrders, batches))
		}
		// Compatibility rows belong to the mould and mean nothing without it.
		if _, err := tx.Exec(ctx, `DELETE FROM product_mold_compatibility WHERE tenant_id = $1 AND mold_id = $2`, tenantID, id); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `DELETE FROM mold WHERE tenant_id = $1 AND id = $2`, tenantID, id)
		return err
	})
}

// Compatibilities lists a mould's links.
func (s *Service) Compatibilities(ctx context.Context, tenantID, moldID string, activeOnly bool) ([]Compatibility, error) {
	var out []Compatibility
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.repo.ListCompatibilities(ctx, tx, tenantID, moldID, "", activeOnly)
		return err
	})
	return out, err
}

// AddCompatibility links a product to a mould that is not retired.
func (s *Service) AddCompatibility(ctx context.Context, tenantID, moldID, productID string) (Compatibility, error) {
	var out Compatibility
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		m, err := s.repo.FindByID(ctx, tx, tenantID, moldID)
		if err != nil {
			return err
		}
		if m == nil {
			return httpx.NotFound("Mold tidak ditemukan.")
		}
		if m.Status == "RETIRED" {
			return httpx.InvalidState(fmt.Sprintf("Mold %s sudah RETIRED, sehingga tidak dapat dijadikan kompatibel dengan produk baru.", m.Code))
		}
		ok, err := exists(ctx, tx, `SELECT 1 FROM product WHERE tenant_id = $1 AND id = $2`, tenantID, productID)
		if err != nil {
			return err
		}
		if !ok {
			return httpx.Validation("Produk tidak ditemukan.", httpx.FieldError{Field: "productId", Code: "NOT_FOUND", Message: "Produk tidak ditemukan."})
		}
		out, err = s.repo.UpsertCompatibility(ctx, tx, tenantID, moldID, productID, true)
		return err
	})
	return out, err
}

// SetCompatibilityActive is the switch that makes the mould field required
// or optional on the confirmation checklist (ADR-36).
func (s *Service) SetCompatibilityActive(ctx context.Context, tenantID, moldID, compatID string, active bool) (Compatibility, error) {
	var out Compatibility
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		existing, err := s.repo.FindCompatibility(ctx, tx, tenantID, compatID)
		if err != nil {
			return err
		}
		if existing == nil || existing.MoldID != moldID {
			return httpx.NotFound("Kompatibilitas mold tidak ditemukan.")
		}
		updated, err := s.repo.SetCompatibilityActive(ctx, tx, tenantID, compatID, active)
		if err != nil {
			return err
		}
		if updated == nil {
			return httpx.NotFound("Kompatibilitas mold tidak ditemukan.")
		}
		out = *updated
		return nil
	})
	return out, err
}

// RemoveCompatibility deletes a link.
func (s *Service) RemoveCompatibility(ctx context.Context, tenantID, moldID, compatID string) error {
	return s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		existing, err := s.repo.FindCompatibility(ctx, tx, tenantID, compatID)
		if err != nil {
			return err
		}
		if existing == nil || existing.MoldID != moldID {
			return httpx.NotFound("Kompatibilitas mold tidak ditemukan.")
		}
		_, err = tx.Exec(ctx, `DELETE FROM product_mold_compatibility WHERE tenant_id = $1 AND id = $2`, tenantID, compatID)
		return err
	})
}

func indexOf(list []string, s string) int {
	for i, x := range list {
		if x == s {
			return i
		}
	}
	return -1
}

// --- Routes -------------------------------------------------------------------

// Mount registers /molds and the compatibility beneath it.
func Mount(r chi.Router, svc *Service, auditor audit.Recorder) {
	tenant := func(r *http.Request) string { return tenancy.TenantID(r.Context()) }
	record := func(r *http.Request, entityID, action string, previous, next any) {
		// Detached on purpose: the action being audited has already
		// committed, and a hiccup here must not turn a success into a 500.
		auditor.RecordDetached(audit.FromRequest(r, "mold", entityID, action, previous, next))
	}

	r.Get("/molds", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		q := r.URL.Query()
		list, err := svc.Molds(r.Context(), tenant(r), Filter{Status: q.Get("status"), Search: q.Get("search"), ProductID: q.Get("productId"), MachineID: q.Get("machineId")})
		if err != nil {
			return err
		}
		return httpx.OK(w, list)
	}))

	r.Get("/molds/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		m, err := svc.Mold(r.Context(), tenant(r), chi.URLParam(r, "id"))
		if err != nil {
			return err
		}
		return httpx.OK(w, m)
	}))

	r.Post("/molds", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		in := Input{Code: v.String("code", httpx.Opt{Min: httpx.Min(1), Max: httpx.Max(64)}), Name: v.String("name", httpx.Opt{Min: httpx.Min(1), Max: httpx.Max(255)}),
			// A mould with no cavities produces nothing; a zero would silently
			// break every capacity figure derived from it.
			CavityCount: v.Int("cavityCount", httpx.Opt{Min: httpx.Min(1), Max: httpx.Max(1000)}), Status: v.OneOf("status", statuses, httpx.Opt{Optional: true}),
			CurrentMachineID: v.String("currentMachineId", httpx.Opt{Optional: true, Max: httpx.Max(64)})}
		if err := v.Done(); err != nil {
			return err
		}
		created, err := svc.Create(r.Context(), tenant(r), in)
		if err != nil {
			return err
		}
		record(r, created.ID, "CREATE", nil, created)
		return httpx.Created(w, created)
	}))

	r.Patch("/molds/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		in := Input{Code: v.String("code", httpx.Opt{Optional: true, Min: httpx.Min(1), Max: httpx.Max(64)}), Name: v.String("name", httpx.Opt{Optional: true, Min: httpx.Min(1), Max: httpx.Max(255)}),
			CavityCount: v.Int("cavityCount", httpx.Opt{Optional: true, Min: httpx.Min(1), Max: httpx.Max(1000)}), Status: v.OneOf("status", statuses, httpx.Opt{Optional: true})}
		if err := v.Done(); err != nil {
			return err
		}
		// currentMachineId: null detaches the mould, which is different from
		// omitting the field.
		if raw, mentioned := body["currentMachineId"]; mentioned {
			in.MachineIDMentioned = true
			if s, ok := raw.(string); ok && s != "" {
				in.CurrentMachineID = &s
			}
		}
		tenantID, id := tenant(r), chi.URLParam(r, "id")
		previous, err := svc.Mold(r.Context(), tenantID, id)
		if err != nil {
			return err
		}
		updated, err := svc.Update(r.Context(), tenantID, id, in)
		if err != nil {
			return err
		}
		record(r, updated.ID, "UPDATE", previous, updated)
		return httpx.OK(w, updated)
	}))

	r.Delete("/molds/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		tenantID, id := tenant(r), chi.URLParam(r, "id")
		previous, err := svc.Mold(r.Context(), tenantID, id)
		if err != nil {
			return err
		}
		if err := svc.Remove(r.Context(), tenantID, id); err != nil {
			return err
		}
		record(r, id, "DELETE", previous, nil)
		return httpx.NoContent(w)
	}))

	r.Get("/molds/{id}/compatibilities", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		list, err := svc.Compatibilities(r.Context(), tenant(r), chi.URLParam(r, "id"), r.URL.Query().Get("activeOnly") == "true")
		if err != nil {
			return err
		}
		return httpx.OK(w, list)
	}))

	r.Post("/molds/{id}/compatibilities", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		productID := v.String("productId", httpx.Opt{Min: httpx.Min(1), Max: httpx.Max(64)})
		if err := v.Done(); err != nil {
			return err
		}
		id := chi.URLParam(r, "id")
		created, err := svc.AddCompatibility(r.Context(), tenant(r), id, *productID)
		if err != nil {
			return err
		}
		// Audited against the mould, not the link: "which products may this
		// mould run?" is answered by the mould's history.
		record(r, id, "MOLD_COMPATIBILITY_ADD", nil, created)
		return httpx.Created(w, created)
	}))

	r.Patch("/molds/{id}/compatibilities/{compatibilityId}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		active := v.Boolean("active", httpx.Opt{})
		if err := v.Done(); err != nil {
			return err
		}
		id := chi.URLParam(r, "id")
		updated, err := svc.SetCompatibilityActive(r.Context(), tenant(r), id, chi.URLParam(r, "compatibilityId"), *active)
		if err != nil {
			return err
		}
		action := "MOLD_COMPATIBILITY_DEACTIVATE"
		if *active {
			action = "MOLD_COMPATIBILITY_ACTIVATE"
		}
		record(r, id, action, nil, updated)
		return httpx.OK(w, updated)
	}))

	r.Delete("/molds/{id}/compatibilities/{compatibilityId}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		id := chi.URLParam(r, "id")
		if err := svc.RemoveCompatibility(r.Context(), tenant(r), id, chi.URLParam(r, "compatibilityId")); err != nil {
			return err
		}
		record(r, id, "MOLD_COMPATIBILITY_REMOVE", nil, nil)
		return httpx.NoContent(w)
	}))
}
