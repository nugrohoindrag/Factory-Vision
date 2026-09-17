package masterdata

import (
	"context"
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/cache"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/httpx"
)

// CacheTTL bounds how stale a projection may get without a write through
// this process: another writer (a migration, a seed, a second replica) is
// seen within this window.
const CacheTTL = 30 * time.Second

// Service is the master-data application layer.
type Service struct {
	pool *db.Pool
	repo Repository

	reference *cache.Tenant[*Reference]
	shifts    *cache.Tenant[[]Shift]
	operators *cache.Tenant[[]Operator]
	users     *cache.Tenant[[]StoredUser]
	devices   *cache.Tenant[[]Device]
	kpi       *cache.Tenant[[]KpiTarget]
	boms      *cache.Tenant[[]Bom]
}

// NewService builds the caches.
func NewService(pool *db.Pool) (*Service, error) {
	s := &Service{pool: pool}
	opts := cache.Options{MaxEntries: 256, TTL: CacheTTL}
	var err error
	if s.reference, err = cache.New[*Reference]("masterdata.reference", opts); err != nil {
		return nil, err
	}
	if s.shifts, err = cache.New[[]Shift]("masterdata.shifts", opts); err != nil {
		return nil, err
	}
	if s.operators, err = cache.New[[]Operator]("masterdata.operators", opts); err != nil {
		return nil, err
	}
	if s.users, err = cache.New[[]StoredUser]("masterdata.users", opts); err != nil {
		return nil, err
	}
	if s.devices, err = cache.New[[]Device]("masterdata.devices", opts); err != nil {
		return nil, err
	}
	if s.kpi, err = cache.New[[]KpiTarget]("masterdata.kpi", opts); err != nil {
		return nil, err
	}
	if s.boms, err = cache.New[[]Bom]("masterdata.boms", opts); err != nil {
		return nil, err
	}
	return s, nil
}

// Invalidate drops every cached projection for a tenant, after a bulk
// change such as a CSV import or an onboarding template.
func (s *Service) Invalidate(tenantID string) {
	s.reference.Invalidate(tenantID)
	s.shifts.Invalidate(tenantID)
	s.operators.Invalidate(tenantID)
	s.users.Invalidate(tenantID)
	s.devices.Invalidate(tenantID)
	s.kpi.Invalidate(tenantID)
	s.boms.Invalidate(tenantID)
}

// --- ids ---------------------------------------------------------------

var (
	idMu   sync.Mutex
	idLast int64
)

// newID mirrors the Node API's `<prefix>-<Date.now()>` ids, made strictly
// increasing within the process so two creates in one millisecond cannot
// collide.
func newID(prefix string) string {
	idMu.Lock()
	defer idMu.Unlock()
	now := time.Now().UnixMilli()
	if now <= idLast {
		now = idLast + 1
	}
	idLast = now
	return fmt.Sprintf("%s-%d", prefix, now)
}

// --- reference reads ---------------------------------------------------

func (s *Service) ref(ctx context.Context, tenantID string) (*Reference, error) {
	return s.reference.Get(ctx, tenantID, func(ctx context.Context) (*Reference, error) {
		r := &Reference{}
		err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
			var err error
			if r.Plants, err = s.repo.ListPlants(ctx, tx, tenantID); err != nil {
				return err
			}
			if r.Lines, err = s.repo.ListLines(ctx, tx, tenantID); err != nil {
				return err
			}
			if r.WorkCenters, err = s.repo.ListWorkCenters(ctx, tx, tenantID); err != nil {
				return err
			}
			if r.Machines, err = s.repo.ListMachines(ctx, tx, tenantID); err != nil {
				return err
			}
			if r.Products, err = s.repo.ListProducts(ctx, tx, tenantID); err != nil {
				return err
			}
			if r.Processes, err = s.repo.ListProcesses(ctx, tx, tenantID); err != nil {
				return err
			}
			if r.Routings, err = s.repo.ListRoutings(ctx, tx, tenantID); err != nil {
				return err
			}
			if r.Rates, err = s.repo.ListRates(ctx, tx, tenantID); err != nil {
				return err
			}
			if r.DowntimeReasons, err = s.repo.ListDowntimeReasons(ctx, tx, tenantID); err != nil {
				return err
			}
			r.RejectReasons, err = s.repo.ListRejectReasons(ctx, tx, tenantID)
			return err
		})
		return r, err
	})
}

// Reference is the whole reference set, for modules that read several
// entities at once.
func (s *Service) Reference(ctx context.Context, tenantID string) (*Reference, error) {
	return s.ref(ctx, tenantID)
}

func (s *Service) Plants(ctx context.Context, tenantID string) ([]Plant, error) {
	r, err := s.ref(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	return r.Plants, nil
}

func (s *Service) Lines(ctx context.Context, tenantID string) ([]Line, error) {
	r, err := s.ref(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	return r.Lines, nil
}

func (s *Service) LineByID(ctx context.Context, tenantID, id string) (*Line, error) {
	lines, err := s.Lines(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	for i := range lines {
		if lines[i].ID == id {
			l := lines[i]
			return &l, nil
		}
	}
	return nil, nil
}

func (s *Service) WorkCenters(ctx context.Context, tenantID string) ([]WorkCenter, error) {
	r, err := s.ref(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	return r.WorkCenters, nil
}

func (s *Service) WorkCenterByID(ctx context.Context, tenantID, id string) (*WorkCenter, error) {
	wcs, err := s.WorkCenters(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	for i := range wcs {
		if wcs[i].ID == id {
			w := wcs[i]
			return &w, nil
		}
	}
	return nil, nil
}

// Processes are ordered by sequenceDefault, as the console expects.
func (s *Service) Processes(ctx context.Context, tenantID string) ([]Process, error) {
	r, err := s.ref(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	out := append([]Process(nil), r.Processes...)
	sort.SliceStable(out, func(i, j int) bool { return out[i].SequenceDefault < out[j].SequenceDefault })
	return out, nil
}

func (s *Service) ProcessByID(ctx context.Context, tenantID, id string) (*Process, error) {
	r, err := s.ref(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	for i := range r.Processes {
		if r.Processes[i].ID == id {
			p := r.Processes[i]
			return &p, nil
		}
	}
	return nil, nil
}

func (s *Service) Machines(ctx context.Context, tenantID string) ([]Machine, error) {
	r, err := s.ref(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	return r.Machines, nil
}

func (s *Service) MachineByID(ctx context.Context, tenantID, id string) (*Machine, error) {
	machines, err := s.Machines(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	for i := range machines {
		if machines[i].ID == id {
			m := machines[i]
			return &m, nil
		}
	}
	return nil, nil
}

func (s *Service) Products(ctx context.Context, tenantID string) ([]Product, error) {
	r, err := s.ref(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	return r.Products, nil
}

func (s *Service) ProductByID(ctx context.Context, tenantID, id string) (*Product, error) {
	products, err := s.Products(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	for i := range products {
		if products[i].ID == id {
			p := products[i]
			return &p, nil
		}
	}
	return nil, nil
}

// Routings lists a product's routing in sequence order, or every routing.
func (s *Service) Routings(ctx context.Context, tenantID, productID string) ([]Routing, error) {
	r, err := s.ref(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	out := make([]Routing, 0, len(r.Routings))
	for _, rt := range r.Routings {
		if productID == "" || rt.ProductID == productID {
			out = append(out, rt)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Sequence < out[j].Sequence })
	return out, nil
}

func (s *Service) RoutingByID(ctx context.Context, tenantID, id string) (*Routing, error) {
	r, err := s.ref(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	for i := range r.Routings {
		if r.Routings[i].ID == id {
			rt := r.Routings[i]
			return &rt, nil
		}
	}
	return nil, nil
}

// Rates lists the product x machine rates, optionally filtered.
func (s *Service) Rates(ctx context.Context, tenantID, productID, machineID string) ([]MachineRate, error) {
	r, err := s.ref(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	out := make([]MachineRate, 0, len(r.Rates))
	for _, rate := range r.Rates {
		if (productID == "" || rate.ProductID == productID) && (machineID == "" || rate.MachineID == machineID) {
			out = append(out, rate)
		}
	}
	return out, nil
}

func (s *Service) DowntimeReasons(ctx context.Context, tenantID string) ([]DowntimeReason, error) {
	r, err := s.ref(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	out := append([]DowntimeReason(nil), r.DowntimeReasons...)
	sort.SliceStable(out, func(i, j int) bool { return out[i].SortOrder < out[j].SortOrder })
	return out, nil
}

func (s *Service) RejectReasons(ctx context.Context, tenantID string) ([]RejectReason, error) {
	r, err := s.ref(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	out := append([]RejectReason(nil), r.RejectReasons...)
	sort.SliceStable(out, func(i, j int) bool { return out[i].SortOrder < out[j].SortOrder })
	return out, nil
}

// LineIDForMachine is the production line a machine sits on, resolved
// through its work centre.
func (s *Service) LineIDForMachine(ctx context.Context, tenantID, machineID string) (string, error) {
	r, err := s.ref(ctx, tenantID)
	if err != nil {
		return "", err
	}
	for _, m := range r.Machines {
		if m.ID != machineID {
			continue
		}
		for _, w := range r.WorkCenters {
			if w.ID == m.WorkCenterID {
				return w.ProductionLineID, nil
			}
		}
	}
	return "", nil
}

// ResolveIdealCycleSeconds is the Ideal Cycle Time for a Product x Machine
// pair (US-049). Returns nil when no rate is configured: callers must
// surface that rather than substituting a default, since a guessed cycle
// time silently invents a Performance number the factory cannot reproduce.
func (s *Service) ResolveIdealCycleSeconds(ctx context.Context, tenantID, productID, machineID, source string) (*float64, error) {
	r, err := s.ref(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	if source == "" {
		source = "PRODUCT_MACHINE"
	}
	if source == "PRODUCT_MACHINE" && productID != "" && machineID != "" {
		for _, rate := range r.Rates {
			if rate.ProductID == productID && rate.MachineID == machineID {
				return db.Ptr(rate.IdealCycleTimeSeconds), nil
			}
		}
	}
	if source != "PRODUCT" && productID != "" {
		for _, rt := range r.Routings {
			if rt.ProductID == productID && rt.Active && (machineID == "" || (rt.MachineID != nil && *rt.MachineID == machineID)) {
				if rt.StandardCycleTimeSeconds != nil && *rt.StandardCycleTimeSeconds != 0 {
					return db.Ptr(*rt.StandardCycleTimeSeconds), nil
				}
				break
			}
		}
	}
	if productID != "" {
		for _, p := range r.Products {
			if p.ID == productID && p.IdealCycleTimeSeconds != 0 {
				return db.Ptr(p.IdealCycleTimeSeconds), nil
			}
		}
	}
	return nil, nil
}

// write runs a reference mutation and invalidates the projection.
func (s *Service) write(ctx context.Context, tenantID string, fn func(tx pgx.Tx) error) error {
	if err := s.pool.WithTenant(ctx, tenantID, fn); err != nil {
		return err
	}
	s.reference.Invalidate(tenantID)
	return nil
}

func notFound(what string) error { return httpx.NotFound(what + " not found") }
