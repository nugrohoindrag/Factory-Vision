package material

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/event"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/masterdata"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/production"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/httpx"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/jsnum"
)

// Recorder is the event timeline the module writes to, detached.
type Recorder interface {
	RecordDetached(in event.Input)
}

// DemandSource is planning's view of what the plans need (M5 fills it).
type DemandSource interface {
	PlanDemandLines(ctx context.Context, tenantID string, planIDs []string, horizonStart, horizonEnd string) ([]DemandLine, error)
}

// Service is material and inventory.
type Service struct {
	pool       *db.Pool
	repo       Repository
	master     *masterdata.Service
	production *production.Service
	events     Recorder
	demand     DemandSource
	now        func() time.Time
}

// NewService wires the module; the demand source is attached by planning.
func NewService(pool *db.Pool, master *masterdata.Service, prod *production.Service, events Recorder) *Service {
	return &Service{pool: pool, master: master, production: prod, events: events, now: time.Now}
}

// AttachDemand connects planning's demand lines.
func (s *Service) AttachDemand(d DemandSource) { s.demand = d }

// Demand returns the attached source, or an empty one.
func (s *Service) Demand() DemandSource {
	if s.demand == nil {
		return noDemand{}
	}
	return s.demand
}

type noDemand struct{}

func (noDemand) PlanDemandLines(context.Context, string, []string, string, string) ([]DemandLine, error) {
	return []DemandLine{}, nil
}

// --- Warehouses & stock ----------------------------------------------------

// Warehouses lists a tenant's warehouses.
func (s *Service) Warehouses(ctx context.Context, tenantID string) ([]Warehouse, error) {
	var out []Warehouse
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.repo.ListWarehouses(ctx, tx, tenantID)
		return err
	})
	return out, err
}

// CreateWarehouse adds an ACTIVE warehouse.
func (s *Service) CreateWarehouse(ctx context.Context, tenantID, code, name string, plantID, warehouseType *string) (Warehouse, error) {
	w := Warehouse{ID: fmt.Sprintf("wh-%d", s.now().UnixMilli()), TenantID: tenantID, PlantID: db.Str(plantID), Code: code, Name: name,
		WarehouseType: db.Deref(warehouseType, "RAW_MATERIAL"), Status: "ACTIVE"}
	if w.WarehouseType == "" {
		w.WarehouseType = "RAW_MATERIAL"
	}
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error { return s.repo.UpsertWarehouse(ctx, tx, w) })
	return w, err
}

// Inventory lists stock.
func (s *Service) Inventory(ctx context.Context, tenantID string, f InventoryFilter) ([]Inventory, error) {
	var out []Inventory
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.repo.ListInventory(ctx, tx, tenantID, f)
		return err
	})
	return out, err
}

func (s *Service) requireMaterial(ctx context.Context, tenantID, materialID string) (*masterdata.Product, error) {
	p, err := s.master.ProductByID(ctx, tenantID, materialID)
	if err != nil {
		return nil, err
	}
	if p == nil {
		return nil, httpx.NotFound(fmt.Sprintf("Material %s tidak ditemukan.", materialID))
	}
	return p, nil
}

func unitOf(p *masterdata.Product, uom *string) string {
	if uom != nil && *uom != "" {
		return *uom
	}
	if p.Unit != "" {
		return p.Unit
	}
	return "PCS"
}

// resolveWarehouseID is the requested warehouse, else the default, else a
// main warehouse created on the spot.
func (s *Service) resolveWarehouseID(ctx context.Context, tx pgx.Tx, tenantID string, requested *string) (string, error) {
	if requested != nil && *requested != "" {
		return *requested, nil
	}
	existing, err := s.repo.DefaultWarehouse(ctx, tx, tenantID)
	if err != nil {
		return "", err
	}
	if existing != nil {
		return existing.ID, nil
	}
	id := "wh-" + tenantID + "-main"
	return id, s.repo.UpsertWarehouse(ctx, tx, Warehouse{ID: id, TenantID: tenantID, Code: "WH-MAIN", Name: "Gudang Utama", WarehouseType: "RAW_MATERIAL", Status: "ACTIVE"})
}

// AdjustInput is a stock take.
type AdjustInput struct {
	MaterialID     string
	WarehouseID    *string
	OnHandQuantity float64
	UOM            *string
	ReorderPoint   *float64
	SafetyStock    *float64
	Reason         string
	Actor          Actor
}

// AdjustInventory sets the on-hand figure, writing the delta as an
// ADJUSTMENT, and optionally the reorder point and safety stock.
func (s *Service) AdjustInventory(ctx context.Context, tenantID string, in AdjustInput) (Inventory, error) {
	material, err := s.requireMaterial(ctx, tenantID, in.MaterialID)
	if err != nil {
		return Inventory{}, err
	}
	var out *Inventory
	err = s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		warehouseID, err := s.resolveWarehouseID(ctx, tx, tenantID, in.WarehouseID)
		if err != nil {
			return err
		}
		uom := unitOf(material, in.UOM)
		current, err := s.repo.FindInventory(ctx, tx, tenantID, in.MaterialID, warehouseID)
		if err != nil {
			return err
		}
		currentOnHand := 0.0
		if current != nil {
			currentOnHand = current.OnHandQuantity
		}
		if delta := in.OnHandQuantity - currentOnHand; delta != 0 {
			if _, err := s.repo.ApplyMovement(ctx, tx, Movement{
				TenantID: tenantID, MaterialID: in.MaterialID, WarehouseID: warehouseID, TransactionType: "ADJUSTMENT", OnHandDelta: delta, UOM: uom,
				ReferenceType: db.Ptr("STOCK_TAKE"), Reason: &in.Reason, ActorID: in.Actor.ID, ActorName: in.Actor.Name,
			}); err != nil {
				return err
			}
		}
		if in.ReorderPoint != nil || in.SafetyStock != nil {
			after, err := s.repo.FindInventory(ctx, tx, tenantID, in.MaterialID, warehouseID)
			if err != nil {
				return err
			}
			up := UpsertInput{TenantID: tenantID, MaterialID: in.MaterialID, WarehouseID: warehouseID, UOM: uom, OnHandQuantity: in.OnHandQuantity}
			if after != nil {
				up.OnHandQuantity, up.ReservedQuantity, up.IncomingQuantity = after.OnHandQuantity, after.ReservedQuantity, after.IncomingQuantity
			}
			up.ReorderPoint, up.SafetyStock = in.ReorderPoint, in.SafetyStock
			if current != nil {
				if up.ReorderPoint == nil {
					up.ReorderPoint = current.ReorderPoint
				}
				if up.SafetyStock == nil {
					up.SafetyStock = current.SafetyStock
				}
			}
			if err := s.repo.UpsertInventory(ctx, tx, up); err != nil {
				return err
			}
		}
		out, err = s.repo.FindInventory(ctx, tx, tenantID, in.MaterialID, warehouseID)
		return err
	})
	if err != nil {
		return Inventory{}, err
	}
	if out == nil {
		return Inventory{}, httpx.Internal("Stok tidak dapat dibaca kembali.")
	}
	return *out, nil
}

// MovementInput is a receipt or an incoming schedule.
type MovementInput struct {
	MaterialID  string
	WarehouseID *string
	Quantity    float64
	UOM         *string
	Reference   *string
	Actor       Actor
}

// RecordIncoming schedules supply: incoming rises, on hand does not.
func (s *Service) RecordIncoming(ctx context.Context, tenantID string, in MovementInput) (Transaction, error) {
	material, err := s.requireMaterial(ctx, tenantID, in.MaterialID)
	if err != nil {
		return Transaction{}, err
	}
	var out Transaction
	err = s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		warehouseID, err := s.resolveWarehouseID(ctx, tx, tenantID, in.WarehouseID)
		if err != nil {
			return err
		}
		out, err = s.repo.ApplyMovement(ctx, tx, Movement{
			TenantID: tenantID, MaterialID: in.MaterialID, WarehouseID: warehouseID, TransactionType: "RECEIPT", IncomingDelta: in.Quantity,
			UOM: unitOf(material, in.UOM), ReferenceType: db.Ptr("PURCHASE"), ReferenceID: db.Str(in.Reference),
			Reason: db.Ptr("Incoming supply dijadwalkan"), ActorID: in.Actor.ID, ActorName: in.Actor.Name,
		})
		return err
	})
	return out, err
}

// ReceiveMaterial books a goods receipt: on hand rises and the scheduled
// incoming is consumed up to the quantity received.
func (s *Service) ReceiveMaterial(ctx context.Context, tenantID string, in MovementInput) (Transaction, error) {
	material, err := s.requireMaterial(ctx, tenantID, in.MaterialID)
	if err != nil {
		return Transaction{}, err
	}
	var out Transaction
	err = s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		warehouseID, err := s.resolveWarehouseID(ctx, tx, tenantID, in.WarehouseID)
		if err != nil {
			return err
		}
		current, err := s.repo.FindInventory(ctx, tx, tenantID, in.MaterialID, warehouseID)
		if err != nil {
			return err
		}
		incoming := 0.0
		if current != nil {
			incoming = current.IncomingQuantity
		}
		out, err = s.repo.ApplyMovement(ctx, tx, Movement{
			TenantID: tenantID, MaterialID: in.MaterialID, WarehouseID: warehouseID, TransactionType: "RECEIPT",
			OnHandDelta: in.Quantity, IncomingDelta: -math.Min(in.Quantity, incoming), UOM: unitOf(material, in.UOM),
			ReferenceType: db.Ptr("GOODS_RECEIPT"), ReferenceID: db.Str(in.Reference), ActorID: in.Actor.ID, ActorName: in.Actor.Name,
		})
		return err
	})
	return out, err
}

// Transactions reads the ledger.
func (s *Service) Transactions(ctx context.Context, tenantID string, f TransactionFilter) ([]Transaction, error) {
	var out []Transaction
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.repo.ListTransactions(ctx, tx, tenantID, f)
		return err
	})
	return out, err
}

// --- BOM explosion & readiness ---------------------------------------------

// ExplodedLine is one material of a BOM explosion.
type ExplodedLine struct {
	MaterialID string  `json:"materialId"`
	BomID      string  `json:"bomId"`
	Quantity   float64 `json:"quantity"`
	UOM        string  `json:"uom"`
	Level      int     `json:"level"`
}

func (s *Service) explode(ctx context.Context, tenantID, productID string, quantity float64, level int, visited map[string]bool, into *[]ExplodedLine) error {
	if level > 10 || visited[productID] {
		return nil
	}
	visited[productID] = true
	bom, err := s.master.ActiveBomForProduct(ctx, tenantID, productID)
	if err != nil || bom == nil {
		return err
	}
	for _, c := range bom.Components {
		scrap := 0.0
		if c.ScrapPercentage != nil {
			scrap = *c.ScrapPercentage
		}
		required := c.Quantity * quantity * (1 + scrap/100)
		*into = append(*into, ExplodedLine{MaterialID: c.ComponentPartID, BomID: bom.ID, Quantity: required, UOM: c.UOM, Level: level})
		if c.ComponentType == "SUB_ASSEMBLY" {
			if err := s.explode(ctx, tenantID, c.ComponentPartID, required, level+1, visited, into); err != nil {
				return err
			}
		}
	}
	return nil
}

func collapse(lines []ExplodedLine) []ExplodedLine {
	merged := map[string]*ExplodedLine{}
	var order []string
	for _, l := range lines {
		if e, ok := merged[l.MaterialID]; ok {
			e.Quantity += l.Quantity
			if l.Level < e.Level {
				e.Level = l.Level
			}
			continue
		}
		copy := l
		merged[l.MaterialID] = &copy
		order = append(order, l.MaterialID)
	}
	out := make([]ExplodedLine, 0, len(order))
	for _, id := range order {
		out = append(out, *merged[id])
	}
	return out
}

func readinessOf(required, available float64) string {
	if required-available <= 0 {
		return "READY"
	}
	if available > 0 {
		return "PARTIAL"
	}
	return "SHORTAGE"
}

// ExplodeDemand is the collapsed explosion of one product quantity.
func (s *Service) ExplodeDemand(ctx context.Context, tenantID, productID string, quantity float64) ([]ExplodedLine, error) {
	var lines []ExplodedLine
	if err := s.explode(ctx, tenantID, productID, quantity, 1, map[string]bool{}, &lines); err != nil {
		return nil, err
	}
	return collapse(lines), nil
}

type source struct {
	typ, id, label, date string
}

func (s *Service) resolveRequirements(ctx context.Context, tx pgx.Tx, tenantID string, src source, lines []ExplodedLine) ([]Requirement, error) {
	collapsed := collapse(lines)
	ids := make([]string, len(collapsed))
	for i, l := range collapsed {
		ids[i] = l.MaterialID
	}
	totals, err := s.repo.TotalsByMaterial(ctx, tx, tenantID, ids)
	if err != nil {
		return nil, err
	}
	ref, err := s.master.Reference(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	now := db.ISO(s.now())
	reqs := make([]Requirement, 0, len(collapsed))
	for i, l := range collapsed {
		stock := totals[l.MaterialID]
		available := stock.OnHand - stock.Reserved + stock.Incoming
		sku, name := l.MaterialID, l.MaterialID
		for _, p := range ref.Products {
			if p.ID == l.MaterialID {
				sku, name = p.SKU, p.Name
				break
			}
		}
		bomID := l.BomID
		reqs = append(reqs, Requirement{
			ID: fmt.Sprintf("mreq-%s-%d", src.id, i+1), TenantID: tenantID, SourceType: src.typ, SourceID: src.id, SourceLabel: src.label,
			MaterialID: l.MaterialID, MaterialSKU: sku, MaterialName: name, BomID: &bomID, Level: l.Level,
			RequiredQuantity: jsnum.ToFixed(l.Quantity, 4), OnHandQuantity: stock.OnHand, ReservedQuantity: stock.Reserved,
			IncomingQuantity: stock.Incoming, AvailableQuantity: available, ShortageQuantity: jsnum.ToFixed(math.Max(l.Quantity-available, 0), 4),
			UOM: l.UOM, RequirementDate: src.date, Status: readinessOf(l.Quantity, available), CreatedAt: now,
		})
	}
	if err := s.repo.ReplaceRequirements(ctx, tx, tenantID, src.typ, src.id, reqs); err != nil {
		return nil, err
	}
	return reqs, nil
}

func (s *Service) summarise(src source, reqs []Requirement) Readiness {
	ready, shortage := 0, 0
	for _, r := range reqs {
		if r.Status == "READY" {
			ready++
		} else {
			shortage++
		}
	}
	status := "NOT_CHECKED"
	pct := 0.0
	if len(reqs) > 0 {
		switch {
		case shortage == 0:
			status = "READY"
		case ready > 0:
			status = "PARTIAL"
		default:
			status = "SHORTAGE"
		}
		pct = jsnum.Round1(float64(ready) / float64(len(reqs)) * 100)
	}
	return Readiness{SourceType: src.typ, SourceID: src.id, SourceLabel: src.label, Status: status, ReadinessPercentage: pct,
		TotalRequirements: len(reqs), ReadyRequirements: ready, ShortageRequirements: shortage, CheckedAt: db.ISO(s.now()), Requirements: reqs}
}

// CheckWorkOrder explodes a work order's product and stores its requirements.
func (s *Service) CheckWorkOrder(ctx context.Context, tenantID, workOrderID string) (Readiness, error) {
	wo, err := s.production.WorkOrderByID(ctx, tenantID, workOrderID)
	if err != nil {
		return Readiness{}, err
	}
	if wo == nil {
		return Readiness{}, httpx.NotFound("Work Order tidak ditemukan.")
	}
	quantity := float64(wo.PlannedQuantity)
	if quantity == 0 {
		quantity = float64(wo.TargetQuantity)
	}
	var lines []ExplodedLine
	if err := s.explode(ctx, tenantID, wo.ProductID, quantity, 1, map[string]bool{}, &lines); err != nil {
		return Readiness{}, err
	}
	date := wo.PlannedStart
	if date == "" {
		date = db.ISO(s.now())
	}
	src := source{typ: "WORK_ORDER", id: workOrderID, label: wo.WoNumber, date: date[:10]}
	var out Readiness
	err = s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		reqs, err := s.resolveRequirements(ctx, tx, tenantID, src, lines)
		if err != nil {
			return err
		}
		out = s.summarise(src, reqs)
		return nil
	})
	return out, err
}

// CheckProductionPlan explodes a plan's demand lines and stores the result.
func (s *Service) CheckProductionPlan(ctx context.Context, tenantID, planID string, demand []DemandLine) (Readiness, error) {
	var lines []ExplodedLine
	today := db.ISO(s.now())[:10]
	date, label := today, planID
	for _, line := range demand {
		label = line.PlanNumber
		if line.RequiredDate < date || date == today {
			date = line.RequiredDate
		}
		if err := s.explode(ctx, tenantID, line.ProductID, line.PlannedQuantity, 1, map[string]bool{}, &lines); err != nil {
			return Readiness{}, err
		}
	}
	src := source{typ: "PRODUCTION_PLAN", id: planID, label: label, date: date}
	var out Readiness
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		reqs, err := s.resolveRequirements(ctx, tx, tenantID, src, lines)
		if err != nil {
			return err
		}
		out = s.summarise(src, reqs)
		return nil
	})
	return out, err
}

// StoredRequirements reads what the last check stored.
func (s *Service) StoredRequirements(ctx context.Context, tenantID string, f RequirementFilter) ([]Requirement, error) {
	var out []Requirement
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.repo.ListRequirements(ctx, tx, tenantID, f)
		return err
	})
	return out, err
}

// --- Reservations ----------------------------------------------------------

// ReserveForWorkOrder reserves what is on hand for every requirement, once.
func (s *Service) ReserveForWorkOrder(ctx context.Context, tenantID, workOrderID string, actor Actor) ([]Reservation, error) {
	readiness, err := s.CheckWorkOrder(ctx, tenantID, workOrderID)
	if err != nil {
		return nil, err
	}
	wo, err := s.production.WorkOrderByID(ctx, tenantID, workOrderID)
	if err != nil {
		return nil, err
	}
	woNumber := workOrderID
	if wo != nil {
		woNumber = wo.WoNumber
	}
	var out []Reservation
	err = s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		existing, err := s.repo.ListReservations(ctx, tx, tenantID, ReservationFilter{WorkOrderID: workOrderID, Status: "RESERVED"})
		if err != nil {
			return err
		}
		if len(existing) > 0 {
			out = existing
			return nil
		}
		warehouseID, err := s.resolveWarehouseID(ctx, tx, tenantID, nil)
		if err != nil {
			return err
		}
		out = []Reservation{}
		for _, req := range readiness.Requirements {
			quantity := math.Min(req.RequiredQuantity, math.Max(req.OnHandQuantity, 0))
			if quantity <= 0 {
				continue
			}
			r := Reservation{
				ID: fmt.Sprintf("mres-%d-%d", s.now().UnixMilli(), len(out)+1), TenantID: tenantID, MaterialID: req.MaterialID,
				MaterialSKU: req.MaterialSKU, MaterialName: req.MaterialName, WarehouseID: &warehouseID, WorkOrderID: &workOrderID,
				Quantity: quantity, UOM: req.UOM, Status: "RESERVED", ReservedBy: actor.ID, ReservedAt: db.ISO(s.now()),
			}
			if wo != nil {
				r.WorkOrderNumber = &wo.WoNumber
			}
			if err := s.repo.InsertReservation(ctx, tx, r); err != nil {
				return err
			}
			if _, err := s.repo.ApplyMovement(ctx, tx, Movement{
				TenantID: tenantID, MaterialID: req.MaterialID, WarehouseID: warehouseID, TransactionType: "RESERVATION", ReservedDelta: quantity,
				UOM: req.UOM, ReferenceType: db.Ptr("WORK_ORDER"), ReferenceID: &workOrderID, Reason: db.Ptr("Reservasi untuk " + woNumber),
				ActorID: actor.ID, ActorName: actor.Name,
			}); err != nil {
				return err
			}
			out = append(out, r)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if len(out) > 0 && len(out) != 0 {
		skus := make([]string, len(out))
		for i, r := range out {
			skus[i] = r.MaterialSKU
		}
		in := event.Input{TenantID: tenantID, EventType: "MATERIAL_RESERVED", EntityType: "WORK_ORDER", EntityID: workOrderID, ActorType: "USER",
			ActorID: &actor.ID, ActorName: actor.Name, WorkOrderID: &workOrderID,
			Summary: fmt.Sprintf("%d material direservasi untuk %s.", len(out), woNumber), Metadata: map[string]any{"materials": skus}}
		if wo != nil {
			in.MachineID, in.LineID = wo.MachineID, &wo.LineID
		}
		s.events.RecordDetached(in)
	}
	return out, nil
}

// ReleaseReservation returns a reservation's quantity to available stock.
func (s *Service) ReleaseReservation(ctx context.Context, tenantID, reservationID string, actor Actor) error {
	return s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		all, err := s.repo.ListReservations(ctx, tx, tenantID, ReservationFilter{})
		if err != nil {
			return err
		}
		var reservation *Reservation
		for i := range all {
			if all[i].ID == reservationID {
				reservation = &all[i]
				break
			}
		}
		if reservation == nil {
			return httpx.NotFound("Reservasi material tidak ditemukan.")
		}
		if reservation.Status != "RESERVED" {
			return nil
		}
		if err := s.repo.SetReservationStatus(ctx, tx, tenantID, reservationID, "RELEASED"); err != nil {
			return err
		}
		warehouseID := ""
		if reservation.WarehouseID != nil {
			warehouseID = *reservation.WarehouseID
		} else if warehouseID, err = s.resolveWarehouseID(ctx, tx, tenantID, nil); err != nil {
			return err
		}
		_, err = s.repo.ApplyMovement(ctx, tx, Movement{
			TenantID: tenantID, MaterialID: reservation.MaterialID, WarehouseID: warehouseID, TransactionType: "RELEASE", ReservedDelta: -reservation.Quantity,
			UOM: reservation.UOM, ReferenceType: db.Ptr("WORK_ORDER"), ReferenceID: reservation.WorkOrderID, Reason: db.Ptr("Reservasi dilepas"),
			ActorID: actor.ID, ActorName: actor.Name,
		})
		return err
	})
}

// Reservations lists reservations.
func (s *Service) Reservations(ctx context.Context, tenantID string, f ReservationFilter) ([]Reservation, error) {
	var out []Reservation
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.repo.ListReservations(ctx, tx, tenantID, f)
		return err
	})
	return out, err
}

// --- Consumption -----------------------------------------------------------

// ConsumptionInput is one issue or return against a work order.
type ConsumptionInput struct {
	WorkOrderID     string
	MaterialID      string
	ActualQuantity  float64
	PlannedQuantity *float64
	WarehouseID     *string
	BatchID         *string
	ProcessID       *string
	MachineID       *string
	OperatorID      *string
	ConsumptionType *string
	UOM             *string
	Notes           *string
	IdempotencyKey  *string
	AllowOverride   bool
}

func consumptionStatus(planned, variance float64) string {
	switch {
	case planned <= 0 || math.Abs(variance) < 0.0001:
		return "NORMAL"
	case variance > 0:
		return "OVER_CONSUMPTION"
	}
	return "UNDER_CONSUMPTION"
}

// RecordConsumption issues (or returns) material against a work order,
// idempotent on the key the terminal sends.
func (s *Service) RecordConsumption(ctx context.Context, tenantID string, in ConsumptionInput, actor Actor) (Consumption, error) {
	if in.ActualQuantity <= 0 {
		return Consumption{}, httpx.Validation("Kuantitas konsumsi harus lebih besar dari nol.")
	}
	wo, err := s.production.WorkOrderByID(ctx, tenantID, in.WorkOrderID)
	if err != nil {
		return Consumption{}, err
	}
	if wo == nil {
		return Consumption{}, httpx.NotFound("Work Order tidak ditemukan.")
	}
	material, err := s.requireMaterial(ctx, tenantID, in.MaterialID)
	if err != nil {
		return Consumption{}, err
	}
	var out Consumption
	created := false
	err = s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		if in.IdempotencyKey != nil && *in.IdempotencyKey != "" {
			existing, err := s.repo.ListConsumption(ctx, tx, tenantID, ConsumptionFilter{IdempotencyKey: *in.IdempotencyKey})
			if err != nil {
				return err
			}
			if len(existing) > 0 {
				out = existing[0]
				return nil
			}
		}
		warehouseID, err := s.resolveWarehouseID(ctx, tx, tenantID, in.WarehouseID)
		if err != nil {
			return err
		}
		uom := unitOf(material, in.UOM)
		consumptionType := db.Deref(in.ConsumptionType, "PRODUCTION")
		if consumptionType == "" {
			consumptionType = "PRODUCTION"
		}
		isReturn := consumptionType == "RETURN"
		if !isReturn && !in.AllowOverride {
			stock, err := s.repo.FindInventory(ctx, tx, tenantID, in.MaterialID, warehouseID)
			if err != nil {
				return err
			}
			onHand := 0.0
			if stock != nil {
				onHand = stock.OnHandQuantity
			}
			if in.ActualQuantity > onHand {
				return httpx.Conflict(fmt.Sprintf("Stok %s tidak mencukupi: tersedia %s %s, diminta %s %s.",
					material.SKU, num(onHand), uom, num(in.ActualQuantity), uom))
			}
		}
		planned := 0.0
		if in.PlannedQuantity != nil {
			planned = *in.PlannedQuantity
		} else {
			reqs, err := s.repo.ListRequirements(ctx, tx, tenantID, RequirementFilter{SourceType: "WORK_ORDER", SourceID: in.WorkOrderID})
			if err != nil {
				return err
			}
			for _, r := range reqs {
				if r.MaterialID == in.MaterialID {
					planned = r.RequiredQuantity
					break
				}
			}
		}
		variance := jsnum.ToFixed(in.ActualQuantity-planned, 4)
		record := Consumption{
			ID: fmt.Sprintf("mcon-%d-%s", s.now().UnixMilli(), db.RandomBase36(4)), TenantID: tenantID, WorkOrderID: in.WorkOrderID, WorkOrderNumber: wo.WoNumber,
			BatchID: db.Str(in.BatchID), ProcessID: firstOf(in.ProcessID, wo.ProcessID), MachineID: firstOf(in.MachineID, wo.MachineID),
			MaterialID: in.MaterialID, MaterialSKU: material.SKU, MaterialName: material.Name, WarehouseID: &warehouseID,
			PlannedQuantity: planned, ActualQuantity: in.ActualQuantity, VarianceQuantity: variance, UOM: uom,
			ConsumptionType: consumptionType, Status: consumptionStatus(planned, variance), OperatorID: db.Str(in.OperatorID),
			RecordedBy: actor.ID, ConsumedAt: db.ISO(s.now()), IdempotencyKey: db.Str(in.IdempotencyKey), Notes: db.Str(in.Notes),
		}
		if planned > 0 {
			record.VariancePercentage = jsnum.ToFixed((variance/planned)*100, 2)
		}
		if err := s.repo.InsertConsumption(ctx, tx, record); err != nil {
			return err
		}
		reservedDelta := 0.0
		if !isReturn {
			consumed, err := s.reservedAgainst(ctx, tx, tenantID, in.WorkOrderID, in.MaterialID, in.ActualQuantity)
			if err != nil {
				return err
			}
			reservedDelta = -consumed
		}
		onHandDelta := -in.ActualQuantity
		txType := "ISSUE"
		if isReturn {
			onHandDelta, txType = in.ActualQuantity, "RETURN"
		}
		reason := record.ConsumptionType + " " + wo.WoNumber
		if in.Notes != nil && *in.Notes != "" {
			reason = *in.Notes
		}
		if _, err := s.repo.ApplyMovement(ctx, tx, Movement{
			TenantID: tenantID, MaterialID: in.MaterialID, WarehouseID: warehouseID, TransactionType: txType, OnHandDelta: onHandDelta, ReservedDelta: reservedDelta,
			UOM: uom, ReferenceType: db.Ptr("MATERIAL_CONSUMPTION"), ReferenceID: &record.ID, Reason: &reason, ActorID: actor.ID, ActorName: actor.Name,
		}); err != nil {
			return err
		}
		out, created = record, true
		return nil
	})
	if err != nil {
		return Consumption{}, err
	}
	_ = created
	eventType := "MATERIAL_CONSUMED"
	if out.ConsumptionType == "RETURN" {
		eventType = "MATERIAL_RETURNED"
	}
	actorType := actor.Type
	if actorType == "" {
		actorType = "USER"
	}
	s.events.RecordDetached(event.Input{
		TenantID: tenantID, EventType: eventType, EntityType: "WORK_ORDER", EntityID: out.WorkOrderID, ActorType: actorType,
		ActorID: &actor.ID, ActorName: actor.Name, WorkOrderID: &out.WorkOrderID, BatchID: out.BatchID, MachineID: out.MachineID, ProcessID: out.ProcessID, LineID: &wo.LineID,
		Summary:    fmt.Sprintf("%s: %s %s pada %s.", out.MaterialSKU, num(out.ActualQuantity), out.UOM, out.WorkOrderNumber),
		AfterValue: map[string]any{"materialId": out.MaterialID, "quantity": out.ActualQuantity, "variance": out.VarianceQuantity, "status": out.Status},
	})
	return out, nil
}

func (s *Service) reservedAgainst(ctx context.Context, tx pgx.Tx, tenantID, workOrderID, materialID string, quantity float64) (float64, error) {
	reservations, err := s.repo.ListReservations(ctx, tx, tenantID, ReservationFilter{WorkOrderID: workOrderID, MaterialID: materialID, Status: "RESERVED"})
	if err != nil {
		return 0, err
	}
	remaining, consumed := quantity, 0.0
	for _, r := range reservations {
		if remaining <= 0 {
			break
		}
		take := math.Min(r.Quantity, remaining)
		consumed += take
		remaining -= take
		if take >= r.Quantity {
			if err := s.repo.SetReservationStatus(ctx, tx, tenantID, r.ID, "CONSUMED"); err != nil {
				return 0, err
			}
		}
	}
	return consumed, nil
}

// Consumption lists consumption records.
func (s *Service) Consumption(ctx context.Context, tenantID string, f ConsumptionFilter) ([]Consumption, error) {
	var out []Consumption
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.repo.ListConsumption(ctx, tx, tenantID, f)
		return err
	})
	return out, err
}

// ConsumptionVariance compares what a work order needed with what it took.
func (s *Service) ConsumptionVariance(ctx context.Context, tenantID, workOrderID string) ([]VarianceRow, error) {
	ref, err := s.master.Reference(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	var out []VarianceRow
	err = s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		reqs, err := s.repo.ListRequirements(ctx, tx, tenantID, RequirementFilter{SourceType: "WORK_ORDER", SourceID: workOrderID})
		if err != nil {
			return err
		}
		consumed, order, err := s.repo.ConsumedByMaterial(ctx, tx, tenantID, workOrderID)
		if err != nil {
			return err
		}
		out = []VarianceRow{}
		for _, req := range reqs {
			actual := consumed[req.MaterialID]
			delete(consumed, req.MaterialID)
			variance := jsnum.ToFixed(actual-req.RequiredQuantity, 4)
			pct := 0.0
			if req.RequiredQuantity > 0 {
				pct = jsnum.ToFixed((variance/req.RequiredQuantity)*100, 2)
			}
			out = append(out, VarianceRow{MaterialID: req.MaterialID, MaterialSKU: req.MaterialSKU, MaterialName: req.MaterialName,
				PlannedQuantity: req.RequiredQuantity, ActualQuantity: actual, VarianceQuantity: variance, VariancePercentage: pct, UOM: req.UOM,
				Status: consumptionStatus(1, variance)})
		}
		for _, id := range order {
			actual, ok := consumed[id]
			if !ok {
				continue
			}
			row := VarianceRow{MaterialID: id, MaterialSKU: id, MaterialName: id, ActualQuantity: actual, VarianceQuantity: actual, UOM: "PCS", Status: "OVER_CONSUMPTION"}
			for _, p := range ref.Products {
				if p.ID == id {
					row.MaterialSKU, row.MaterialName = p.SKU, p.Name
					if p.Unit != "" {
						row.UOM = p.Unit
					}
					break
				}
			}
			out = append(out, row)
		}
		return nil
	})
	return out, err
}

// StockTotals sums stock per material.
func (s *Service) StockTotals(ctx context.Context, tenantID string, materialIDs []string) (map[string]StockTotal, error) {
	var out map[string]StockTotal
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.repo.TotalsByMaterial(ctx, tx, tenantID, materialIDs)
		return err
	})
	return out, err
}

// --- MRP -------------------------------------------------------------------

// MrpInput is one run's parameters.
type MrpInput struct {
	HorizonStart *string
	HorizonEnd   *string
	PlanIDs      []string
	Notes        *string
}

// RunMrp explodes the plans' demand over the horizon and nets it against
// stock, storing the run and its results.
func (s *Service) RunMrp(ctx context.Context, tenantID string, in MrpInput, actor Actor) (MrpOutcome, error) {
	now := s.now()
	horizonStart := db.Deref(in.HorizonStart, db.ISO(now)[:10])
	horizonEnd := db.Deref(in.HorizonEnd, db.ISO(now.Add(30 * 24 * time.Hour))[:10])
	if horizonEnd < horizonStart {
		return MrpOutcome{}, httpx.Validation("Akhir horizon perencanaan tidak boleh mendahului awalnya.")
	}
	demand, err := s.Demand().PlanDemandLines(ctx, tenantID, in.PlanIDs, horizonStart, horizonEnd)
	if err != nil {
		return MrpOutcome{}, err
	}
	type gross struct {
		quantity float64
		uom      string
		level    int
		date     string
		sources  []string
	}
	byMaterial := map[string]*gross{}
	var order []string
	for _, line := range demand {
		exploded, err := s.ExplodeDemand(ctx, tenantID, line.ProductID, line.PlannedQuantity)
		if err != nil {
			return MrpOutcome{}, err
		}
		for _, c := range exploded {
			g, ok := byMaterial[c.MaterialID]
			if !ok {
				byMaterial[c.MaterialID] = &gross{quantity: c.Quantity, uom: c.UOM, level: c.Level, date: line.RequiredDate, sources: []string{line.PlanNumber}}
				order = append(order, c.MaterialID)
				continue
			}
			g.quantity += c.Quantity
			if c.Level < g.level {
				g.level = c.Level
			}
			if line.RequiredDate < g.date {
				g.date = line.RequiredDate
			}
			if !contains(g.sources, line.PlanNumber) {
				g.sources = append(g.sources, line.PlanNumber)
			}
		}
	}
	totals, err := s.StockTotals(ctx, tenantID, order)
	if err != nil {
		return MrpOutcome{}, err
	}
	ref, err := s.master.Reference(ctx, tenantID)
	if err != nil {
		return MrpOutcome{}, err
	}
	runID := fmt.Sprintf("mrp-%d", now.UnixMilli())
	runNumber := fmt.Sprintf("MRP-%s-%03d", strings.ReplaceAll(db.ISO(now)[:10], "-", ""), now.UnixMilli()%1000)
	results := make([]MrpResult, 0, len(order))
	for i, id := range order {
		g := byMaterial[id]
		stock := totals[id]
		available := stock.OnHand - stock.Reserved + stock.Incoming
		net := jsnum.ToFixed(math.Max(g.quantity-available, 0), 4)
		sku, name := id, id
		for _, p := range ref.Products {
			if p.ID == id {
				sku, name = p.SKU, p.Name
				break
			}
		}
		status := "SHORTAGE"
		if net <= 0 {
			status = "READY"
		} else if available > 0 {
			status = "PARTIAL"
		}
		r := MrpResult{
			ID: fmt.Sprintf("mrpr-%s-%d", runID, i+1), TenantID: tenantID, MrpRunID: runID, MaterialID: id, MaterialSKU: sku, MaterialName: name,
			Level: g.level, GrossRequirement: jsnum.ToFixed(g.quantity, 4), OnHandQuantity: stock.OnHand, ReservedQuantity: stock.Reserved,
			IncomingQuantity: stock.Incoming, AvailableQuantity: available, NetRequirement: net, UOM: g.uom, RequirementDate: g.date,
			RequirementSource: strings.Join(g.sources, ", "), Status: status,
		}
		if net > 0 {
			r.Recommendation = db.Ptr(fmt.Sprintf("Adakan %s %s sebelum %s.", formatID(net), g.uom, g.date))
		}
		results = append(results, r)
	}
	sort.SliceStable(results, func(i, j int) bool {
		if results[i].NetRequirement != results[j].NetRequirement {
			return results[i].NetRequirement > results[j].NetRequirement
		}
		return strings.ToLower(results[i].MaterialSKU) < strings.ToLower(results[j].MaterialSKU)
	})
	planIDs := []string{}
	seen := map[string]bool{}
	for _, line := range demand {
		if !seen[line.ProductionPlanID] {
			seen[line.ProductionPlanID] = true
			planIDs = append(planIDs, line.ProductionPlanID)
		}
	}
	shortage := 0
	for _, r := range results {
		if r.NetRequirement > 0 {
			shortage++
		}
	}
	run := MrpRun{
		ID: runID, TenantID: tenantID, RunNumber: runNumber, HorizonStart: horizonStart, HorizonEnd: horizonEnd, Status: "COMPLETED",
		DemandSource: "PRODUCTION_PLAN", PlanIDs: planIDs, TotalMaterials: len(results), ShortageMaterials: shortage, RunBy: actor.ID,
		StartedAt: db.ISO(now), CompletedAt: db.Ptr(db.ISO(now)), Notes: db.Str(in.Notes),
	}
	if err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error { return s.repo.InsertRun(ctx, tx, run, results) }); err != nil {
		return MrpOutcome{}, err
	}
	s.events.RecordDetached(event.Input{
		TenantID: tenantID, EventType: "MRP_RUN", EntityType: "MRP_RUN", EntityID: run.ID, ActorType: "USER", ActorID: &actor.ID, ActorName: actor.Name,
		Summary:    fmt.Sprintf("%s: %d material, %d shortage.", run.RunNumber, run.TotalMaterials, run.ShortageMaterials),
		AfterValue: map[string]any{"horizonStart": horizonStart, "horizonEnd": horizonEnd, "totalMaterials": run.TotalMaterials, "shortageMaterials": run.ShortageMaterials},
	})
	return MrpOutcome{Run: run, Results: results}, nil
}

// MrpRuns lists runs, newest first.
func (s *Service) MrpRuns(ctx context.Context, tenantID string, limit int) ([]MrpRun, error) {
	var out []MrpRun
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.repo.ListRuns(ctx, tx, tenantID, limit)
		return err
	})
	return out, err
}

// MrpRun reads one run; nil when absent.
func (s *Service) MrpRun(ctx context.Context, tenantID, id string) (*MrpOutcome, error) {
	var out *MrpOutcome
	err := s.pool.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.repo.FindRun(ctx, tx, tenantID, id)
		return err
	})
	return out, err
}

// LatestMrp is the most recent run; nil when none.
func (s *Service) LatestMrp(ctx context.Context, tenantID string) (*MrpOutcome, error) {
	runs, err := s.MrpRuns(ctx, tenantID, 1)
	if err != nil || len(runs) == 0 {
		return nil, err
	}
	return s.MrpRun(ctx, tenantID, runs[0].ID)
}

// --- helpers --------------------------------------------------------------

func firstOf(values ...*string) *string {
	for _, v := range values {
		if v != nil && *v != "" {
			return v
		}
	}
	return nil
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

// num renders a number the way a JavaScript template literal does.
func num(f float64) string { return strconv.FormatFloat(f, 'f', -1, 64) }

// formatID is Number.prototype.toLocaleString('id-ID'): thousands with a
// dot, decimals with a comma, at most three decimals.
func formatID(f float64) string {
	v := jsnum.ToFixed(f, 3)
	neg := v < 0
	if neg {
		v = -v
	}
	s := strconv.FormatFloat(v, 'f', -1, 64)
	intPart, frac := s, ""
	if i := strings.IndexByte(s, '.'); i >= 0 {
		intPart, frac = s[:i], s[i+1:]
	}
	var b strings.Builder
	for i, c := range intPart {
		if i > 0 && (len(intPart)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(c)
	}
	out := b.String()
	if frac != "" {
		out += "," + frac
	}
	if neg {
		out = "-" + out
	}
	return out
}
