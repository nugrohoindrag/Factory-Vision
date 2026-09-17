// Package execution is the read side of the execution core: one snapshot
// of a tenant's work orders, production records and downtime records that
// every derived view (OEE, the executive dashboard, reports, handover) is
// computed from.
//
// The Node API re-read all three tables for every analytics request. Here
// the snapshot is loaded once per change (the write side invalidates it)
// and at most every ten seconds, with the three scans running concurrently
// and concurrent misses collapsed into one load.
package execution

import (
	"context"
	"sort"
	"time"

	"golang.org/x/sync/errgroup"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/production"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/shopfloor"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/cache"
)

// Snapshot is a tenant's execution records as the Node API's list calls
// returned them: work orders in board order (limit 2000), production and
// downtime records oldest first (limit 5000), plus the open downtimes.
type Snapshot struct {
	WorkOrders      []production.WorkOrder
	Records         []shopfloor.ProductionRecord
	Downtimes       []shopfloor.DowntimeRecord
	ActiveDowntimes []shopfloor.DowntimeRecord
	LoadedAt        time.Time

	byID map[string]production.WorkOrder
}

// WorkOrder finds a work order by id.
func (s *Snapshot) WorkOrder(id string) (production.WorkOrder, bool) {
	w, ok := s.byID[id]
	return w, ok
}

// ShiftDates is every distinct shift date across records and downtimes,
// ascending.
func (s *Snapshot) ShiftDates() []string {
	seen := map[string]bool{}
	var dates []string
	for _, r := range s.Records {
		if !seen[r.ShiftDate] {
			seen[r.ShiftDate] = true
			dates = append(dates, r.ShiftDate)
		}
	}
	for _, d := range s.Downtimes {
		if !seen[d.ShiftDate] {
			seen[d.ShiftDate] = true
			dates = append(dates, d.ShiftDate)
		}
	}
	sort.Strings(dates)
	return dates
}

// ReadModel loads and caches snapshots per tenant.
type ReadModel struct {
	production *production.Service
	shopfloor  *shopfloor.Service
	cache      *cache.Tenant[*Snapshot]
}

// New wires the read model and registers it for invalidation on every
// committed change to the execution data.
func New(prod *production.Service, sf *shopfloor.Service) (*ReadModel, error) {
	c, err := cache.New[*Snapshot]("execution_snapshot", cache.Options{MaxEntries: 256, TTL: 10 * time.Second})
	if err != nil {
		return nil, err
	}
	rm := &ReadModel{production: prod, shopfloor: sf, cache: c}
	prod.OnChange(rm.Invalidate)
	return rm, nil
}

// Invalidate drops a tenant's snapshot.
func (rm *ReadModel) Invalidate(tenantID string) { rm.cache.Invalidate(tenantID) }

// Snapshot returns the tenant's current snapshot, loading it on a miss.
func (rm *ReadModel) Snapshot(ctx context.Context, tenantID string) (*Snapshot, error) {
	return rm.cache.Get(ctx, tenantID, func(ctx context.Context) (*Snapshot, error) {
		return rm.load(ctx, tenantID)
	})
}

// Load reads a fresh snapshot, bypassing the cache.
func (rm *ReadModel) Load(ctx context.Context, tenantID string) (*Snapshot, error) {
	return rm.load(ctx, tenantID)
}

func (rm *ReadModel) load(ctx context.Context, tenantID string) (*Snapshot, error) {
	snap := &Snapshot{LoadedAt: time.Now()}
	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() error {
		var err error
		snap.WorkOrders, err = rm.production.WorkOrders(gctx, tenantID, production.WorkOrderFilter{})
		return err
	})
	g.Go(func() error {
		var err error
		snap.Records, err = rm.shopfloor.ProductionRecords(gctx, tenantID, shopfloor.ProductionRecordFilter{})
		return err
	})
	g.Go(func() error {
		var err error
		snap.Downtimes, err = rm.shopfloor.DowntimeRecords(gctx, tenantID, shopfloor.DowntimeFilter{})
		return err
	})
	g.Go(func() error {
		var err error
		snap.ActiveDowntimes, err = rm.shopfloor.ActiveDowntimes(gctx, tenantID)
		return err
	})
	if err := g.Wait(); err != nil {
		return nil, err
	}
	snap.byID = make(map[string]production.WorkOrder, len(snap.WorkOrders))
	for _, w := range snap.WorkOrders {
		snap.byID[w.ID] = w
	}
	return snap, nil
}
