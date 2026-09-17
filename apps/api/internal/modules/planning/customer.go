package planning

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/audit"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/auth"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/httpx"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/tenancy"
)

// Customer is the TypeScript Customer (MES-004, MES-029).
type Customer struct {
	ID              string  `json:"id"`
	TenantID        string  `json:"tenantId"`
	Code            string  `json:"code"`
	Name            string  `json:"name"`
	PicName         *string `json:"picName,omitempty"`
	PicContact      *string `json:"picContact,omitempty"`
	DeliveryAddress *string `json:"deliveryAddress,omitempty"`
	DockNumber      *string `json:"dockNumber,omitempty"`
	Status          string  `json:"status"`
	CreatedAt       *string `json:"createdAt,omitempty"`
	UpdatedAt       *string `json:"updatedAt,omitempty"`
}

const customerColumns = `id, tenant_id, code, name, pic_name, pic_contact, delivery_address, dock_number, status, created_at, updated_at`

func scanCustomer(row pgx.Row) (Customer, error) {
	var c Customer
	var status *string
	var created, updated *time.Time
	if err := row.Scan(&c.ID, &c.TenantID, &c.Code, &c.Name, &c.PicName, &c.PicContact, &c.DeliveryAddress, &c.DockNumber, &status, &created, &updated); err != nil {
		return Customer{}, err
	}
	c.Status = db.Deref(status, "ACTIVE")
	c.CreatedAt, c.UpdatedAt = db.ISOPtr(created), db.ISOPtr(updated)
	return c, nil
}

// CustomerRepository is the customer table.
type CustomerRepository struct{}

// List filters by status and a case-insensitive code/name search.
func (CustomerRepository) List(ctx context.Context, tx pgx.Tx, tenantID, status, search string) ([]Customer, error) {
	where, args := []string{"tenant_id = $1"}, []any{tenantID}
	if status != "" {
		args = append(args, status)
		where = append(where, fmt.Sprintf("status = $%d", len(args)))
	}
	if search != "" {
		args = append(args, "%"+strings.ToLower(search)+"%")
		where = append(where, fmt.Sprintf("(LOWER(code) LIKE $%d OR LOWER(name) LIKE $%d)", len(args), len(args)))
	}
	rows, err := tx.Query(ctx, `SELECT `+customerColumns+` FROM customer WHERE `+strings.Join(where, " AND ")+` ORDER BY code`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Customer{}
	for rows.Next() {
		c, err := scanCustomer(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func customerOrNil(c Customer, err error) (*Customer, error) {
	if db.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// FindByID reads one customer; nil when absent.
func (CustomerRepository) FindByID(ctx context.Context, tx pgx.Tx, tenantID, id string) (*Customer, error) {
	return customerOrNil(scanCustomer(tx.QueryRow(ctx, `SELECT `+customerColumns+` FROM customer WHERE tenant_id = $1 AND id = $2`, tenantID, id)))
}

// FindByCode reads one customer by code.
func (CustomerRepository) FindByCode(ctx context.Context, tx pgx.Tx, tenantID, code string) (*Customer, error) {
	return customerOrNil(scanCustomer(tx.QueryRow(ctx, `SELECT `+customerColumns+` FROM customer WHERE tenant_id = $1 AND code = $2`, tenantID, code)))
}

// Insert stores a customer and returns the row.
func (CustomerRepository) Insert(ctx context.Context, tx pgx.Tx, c Customer) (Customer, error) {
	return scanCustomer(tx.QueryRow(ctx, `INSERT INTO customer (id, tenant_id, code, name, pic_name, pic_contact, delivery_address, dock_number, status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING `+customerColumns,
		c.ID, c.TenantID, c.Code, c.Name, c.PicName, c.PicContact, c.DeliveryAddress, c.DockNumber, c.Status))
}

// CustomerPatch is what an update may change.
type CustomerPatch struct {
	Code, Name, PicName, PicContact, DeliveryAddress, DockNumber, Status *string
}

// Update patches with COALESCE semantics.
func (CustomerRepository) Update(ctx context.Context, tx pgx.Tx, tenantID, id string, p CustomerPatch) (*Customer, error) {
	return customerOrNil(scanCustomer(tx.QueryRow(ctx, `UPDATE customer SET code = COALESCE($3, code), name = COALESCE($4, name), pic_name = COALESCE($5, pic_name),
		pic_contact = COALESCE($6, pic_contact), delivery_address = COALESCE($7, delivery_address), dock_number = COALESCE($8, dock_number),
		status = COALESCE($9, status), updated_at = CURRENT_TIMESTAMP WHERE tenant_id = $1 AND id = $2 RETURNING `+customerColumns,
		tenantID, id, p.Code, p.Name, p.PicName, p.PicContact, p.DeliveryAddress, p.DockNumber, p.Status)))
}

// --- Service ------------------------------------------------------------------

// auditIn writes the audit row in the caller's transaction (MES-020-1): a
// Customer Order cannot exist without the entry that says who created it,
// and a rolled-back edit cannot leave an entry claiming it happened.
func (s *Service) auditIn(ctx context.Context, tx pgx.Tx, tenantID, actorID, actorType, entityType, entityID, action string, previous, next any) error {
	if actorType == "" {
		actorType = "USER"
	}
	_, err := s.audit.RecordIn(ctx, tx, audit.Entry{TenantID: tenantID, ActorType: actorType, ActorID: actorID, EntityType: entityType, EntityID: entityID, Action: action, PreviousValue: previous, NewValue: next})
	return err
}

// Customers lists customers; activeOnly is what the order form's picker asks.
func (s *Service) Customers(ctx context.Context, tenantID, status, search string, activeOnly bool) ([]Customer, error) {
	if activeOnly {
		status = "ACTIVE"
	}
	var out []Customer
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.customers.List(ctx, tx, tenantID, status, search)
		return err
	})
	return out, err
}

// Customer reads one.
func (s *Service) Customer(ctx context.Context, tenantID, id string) (Customer, error) {
	var out *Customer
	if err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.customers.FindByID(ctx, tx, tenantID, id)
		return err
	}); err != nil {
		return Customer{}, err
	}
	if out == nil {
		return Customer{}, httpx.NotFound("Customer tidak ditemukan.")
	}
	return *out, nil
}

// CreateCustomer adds one; code is unique per tenant.
func (s *Service) CreateCustomer(ctx context.Context, tenantID string, in Customer, actorID string) (Customer, error) {
	var out Customer
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		existing, err := s.customers.FindByCode(ctx, tx, tenantID, in.Code)
		if err != nil {
			return err
		}
		if existing != nil {
			return httpx.Conflict(fmt.Sprintf("Customer dengan code %s sudah ada.", in.Code))
		}
		in.ID, in.TenantID = "cust-"+uuid.NewString(), tenantID
		if in.Status == "" {
			in.Status = "ACTIVE"
		}
		out, err = s.customers.Insert(ctx, tx, in)
		if err != nil {
			return err
		}
		return s.auditIn(ctx, tx, tenantID, actorID, "", "customer", out.ID, "CREATE", nil, out)
	})
	return out, err
}

// UpdateCustomer patches one; deactivation rather than deletion, since
// orders reference customers by foreign key.
func (s *Service) UpdateCustomer(ctx context.Context, tenantID, id string, p CustomerPatch, actorID string) (Customer, error) {
	var out Customer
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		before, err := s.customers.FindByID(ctx, tx, tenantID, id)
		if err != nil {
			return err
		}
		if before == nil {
			return httpx.NotFound("Customer tidak ditemukan.")
		}
		if p.Code != nil && *p.Code != "" && *p.Code != before.Code {
			clash, err := s.customers.FindByCode(ctx, tx, tenantID, *p.Code)
			if err != nil {
				return err
			}
			if clash != nil {
				return httpx.Conflict(fmt.Sprintf("Customer dengan code %s sudah ada.", *p.Code))
			}
		}
		updated, err := s.customers.Update(ctx, tx, tenantID, id, p)
		if err != nil {
			return err
		}
		if updated == nil {
			return httpx.NotFound("Customer tidak ditemukan.")
		}
		out = *updated
		return s.auditIn(ctx, tx, tenantID, actorID, "", "customer", id, "UPDATE", before, updated)
	})
	return out, err
}

// --- Routes -------------------------------------------------------------------

// actorOf is the actor recorded in the audit trail; falls back for the
// auth-off demo.
func actorOf(r *http.Request) string {
	if p := auth.PrincipalFrom(r.Context()); p != nil {
		return p.SubjectID
	}
	if id := tenancy.From(r.Context()).UserID; id != "" {
		return id
	}
	return "system"
}

func customerPatchFrom(v *httpx.Validator) CustomerPatch {
	return CustomerPatch{
		Code: v.String("code", httpx.Opt{Optional: true, Max: httpx.Max(64)}), Name: v.String("name", httpx.Opt{Optional: true, Max: httpx.Max(255)}),
		PicName: v.String("picName", httpx.Opt{Optional: true, Max: httpx.Max(255)}), PicContact: v.String("picContact", httpx.Opt{Optional: true, Max: httpx.Max(255)}),
		DeliveryAddress: v.OptStr("deliveryAddress"), DockNumber: v.String("dockNumber", httpx.Opt{Optional: true, Max: httpx.Max(64)}),
		Status: v.OneOf("status", []string{"ACTIVE", "INACTIVE"}, httpx.Opt{Optional: true}),
	}
}

func (h *handler) mountCustomers(r chi.Router) {
	r.Get("/customers", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		q := r.URL.Query()
		list, err := h.svc.Customers(r.Context(), h.tenant(r), q.Get("status"), q.Get("search"), q.Get("activeOnly") == "true")
		if err != nil {
			return err
		}
		return httpx.OK(w, list)
	}))
	r.Get("/customers/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		c, err := h.svc.Customer(r.Context(), h.tenant(r), chi.URLParam(r, "id"))
		if err != nil {
			return err
		}
		return httpx.OK(w, c)
	}))
	r.Post("/customers", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		code := v.String("code", httpx.Opt{Min: httpx.Min(1), Max: httpx.Max(64)})
		name := v.String("name", httpx.Opt{Min: httpx.Min(1), Max: httpx.Max(255)})
		p := customerPatchFrom(v)
		if err := v.Done(); err != nil {
			return err
		}
		created, err := h.svc.CreateCustomer(r.Context(), h.tenant(r), Customer{Code: *code, Name: *name, PicName: p.PicName, PicContact: p.PicContact,
			DeliveryAddress: p.DeliveryAddress, DockNumber: p.DockNumber, Status: db.Deref(p.Status, "ACTIVE")}, actorOf(r))
		if err != nil {
			return err
		}
		return httpx.Created(w, created)
	}))
	r.Patch("/customers/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		p := customerPatchFrom(v)
		if err := v.Done(); err != nil {
			return err
		}
		updated, err := h.svc.UpdateCustomer(r.Context(), h.tenant(r), chi.URLParam(r, "id"), p, actorOf(r))
		if err != nil {
			return err
		}
		return httpx.OK(w, updated)
	}))
}
