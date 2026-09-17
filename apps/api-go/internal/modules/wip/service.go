package wip

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/event"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/masterdata"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/production"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/quality"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/httpx"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/jsnum"
)

// Recorder is the event timeline.
type Recorder interface {
	RecordDetached(in event.Input)
}

// Service is the WIP module.
//
// The handoff is the point of the module. A transfer and a receipt are
// separate records with separate quantities (BR-H03), so "1,000 sent, 950
// arrived" is a fact the system holds rather than a discrepancy somebody
// notices at month-end; the 50 has a reason attached to it (BR-WIP04).
// Quality gates the transfer (BR-H04).
type Service struct {
	pool       *db.Pool
	repo       Repository
	master     *masterdata.Service
	production *production.Service
	quality    *quality.Service
	events     Recorder
	// §7.4 — configurable, with defaults that suit a one-shift plant.
	agingHours, criticalHours float64
	now                       func() time.Time
}

// NewService wires the module.
func NewService(pool *db.Pool, master *masterdata.Service, prod *production.Service, q *quality.Service, events Recorder, agingHours, criticalHours float64) *Service {
	return &Service{pool: pool, master: master, production: prod, quality: q, events: events, agingHours: agingHours, criticalHours: criticalHours, now: time.Now}
}

// decorate adds §7.4 aging: now − created, and where that puts the record.
func (s *Service) decorate(r Record) Record {
	created, err := db.ParseISO(r.CreatedAt)
	if err != nil {
		return r
	}
	age := s.now().Sub(created).Hours()
	status := "NORMAL"
	switch {
	case age >= s.criticalHours:
		status = "CRITICAL"
	case age >= s.agingHours:
		status = "AGING"
	}
	r.AgeHours, r.AgingStatus = db.Ptr(jsnum.Round1(age)), &status
	return r
}

func (s *Service) tx(ctx context.Context, tenantID string, fn func(tx pgx.Tx) error) error {
	return s.pool.WithTenant(ctx, tenantID, fn)
}

func (s *Service) newID(prefix string) string {
	return fmt.Sprintf("%s-%d-%s", prefix, s.now().UnixMilli(), db.RandomBase36(4))
}

// --- §7 WIP records ---------------------------------------------------------

// CreateWip records quantity sitting at a process.
func (s *Service) CreateWip(ctx context.Context, tenantID string, in CreateInput, actor Actor) (Record, error) {
	if in.Quantity <= 0 {
		return Record{}, httpx.Validation("Kuantitas WIP harus lebih besar dari nol.")
	}
	wo, err := s.production.WorkOrderByID(ctx, tenantID, in.WorkOrderID)
	if err != nil {
		return Record{}, err
	}
	if wo == nil {
		return Record{}, httpx.NotFound("Work Order tidak ditemukan.")
	}
	product, err := s.master.ProductByID(ctx, tenantID, db.Deref(in.ProductID, wo.ProductID))
	if err != nil {
		return Record{}, err
	}
	if product == nil {
		return Record{}, httpx.NotFound("Produk tidak ditemukan.")
	}
	var rec Record
	if err := s.tx(ctx, tenantID, func(tx pgx.Tx) error {
		number, err := s.repo.NextNumber(ctx, tx, tenantID, "wip_record", "WIP")
		if err != nil {
			return err
		}
		now := db.ISO(s.now())
		uom := db.Deref(in.Uom, product.Unit)
		if uom == "" {
			uom = "PCS"
		}
		source := in.SourceProcessID
		if source == nil {
			source = wo.ProcessID
		}
		rec = Record{ID: s.newID("wip"), TenantID: tenantID, WipNumber: number, ProductID: product.ID, ProductSku: db.Ptr(product.SKU), ProductName: product.Name,
			WorkOrderID: in.WorkOrderID, WorkOrderNumber: wo.WoNumber, BatchID: in.BatchID, SourceProcessID: source, DestinationProcessID: in.DestinationProcessID,
			Quantity: in.Quantity, Uom: uom, Status: "AT_PROCESS", LocationID: in.LocationID, LocationName: in.LocationName,
			QualityStatus: db.Deref(in.QualityStatus, "PENDING_INSPECTION"), CreatedBy: actor.ID, CreatedAt: now, UpdatedAt: now, Notes: in.Notes}
		if product.SKU == "" {
			rec.ProductSku = nil
		}
		if err := s.repo.InsertWip(ctx, tx, rec); err != nil {
			return err
		}
		return s.repo.SetWipStatus(ctx, tx, tenantID, rec.ID, StatusChange{Status: "AT_PROCESS", FromStatus: db.Ptr("CREATED"), ChangedBy: actor.ID, Reason: db.Ptr("WIP dibuat dari output proses.")})
	}); err != nil {
		return Record{}, err
	}
	s.events.RecordDetached(event.Input{TenantID: tenantID, EventType: "WIP_CREATED", EntityType: "WIP", EntityID: rec.ID, ActorType: actor.Type, ActorID: &actor.ID, ActorName: actor.Name,
		WorkOrderID: &rec.WorkOrderID, BatchID: rec.BatchID, ProcessID: rec.SourceProcessID, MachineID: wo.MachineID, LineID: &wo.LineID,
		Summary:    fmt.Sprintf("%s: %s %s %s di proses.", rec.WipNumber, jsnum.Format(rec.Quantity), rec.Uom, rec.ProductName),
		AfterValue: map[string]any{"quantity": rec.Quantity, "status": rec.Status}})
	return s.decorate(rec), nil
}

// Records lists WIP records with aging.
func (s *Service) Records(ctx context.Context, tenantID string, f RecordFilter) ([]Record, error) {
	var records []Record
	if err := s.tx(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		records, err = s.repo.ListWip(ctx, tx, tenantID, f)
		return err
	}); err != nil {
		return nil, err
	}
	out := make([]Record, 0, len(records))
	for _, r := range records {
		d := s.decorate(r)
		if f.AgingOnly && db.Deref(d.AgingStatus, "NORMAL") == "NORMAL" {
			continue
		}
		out = append(out, d)
	}
	return out, nil
}

// StatusHistory lists a record's changes.
func (s *Service) StatusHistory(ctx context.Context, tenantID, wipID string) ([]StatusHistory, error) {
	var out []StatusHistory
	err := s.tx(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.repo.StatusHistory(ctx, tx, tenantID, wipID)
		return err
	})
	return out, err
}

// HoldWip takes WIP out of circulation (BR-WIP05).
func (s *Service) HoldWip(ctx context.Context, tenantID, id, reason string, actor Actor) (Record, error) {
	return s.changeStatus(ctx, tenantID, id, "ON_HOLD", reason, actor, db.Ptr("HOLD"))
}

// ReleaseWip puts held WIP back at its process.
func (s *Service) ReleaseWip(ctx context.Context, tenantID, id, reason string, actor Actor) (Record, error) {
	return s.changeStatus(ctx, tenantID, id, "AT_PROCESS", reason, actor, db.Ptr("RELEASED"))
}

func (s *Service) changeStatus(ctx context.Context, tenantID, id, status, reason string, actor Actor, qualityStatus *string) (Record, error) {
	var out Record
	err := s.tx(ctx, tenantID, func(tx pgx.Tx) error {
		existing, err := s.repo.ListWip(ctx, tx, tenantID, RecordFilter{ID: id})
		if err != nil {
			return err
		}
		if len(existing) == 0 {
			return httpx.NotFound("Catatan WIP tidak ditemukan.")
		}
		if err := s.repo.SetWipStatus(ctx, tx, tenantID, id, StatusChange{Status: status, QualityStatus: qualityStatus, FromStatus: &existing[0].Status, ChangedBy: actor.ID, Reason: &reason}); err != nil {
			return err
		}
		updated, err := s.repo.ListWip(ctx, tx, tenantID, RecordFilter{ID: id})
		if err != nil {
			return err
		}
		out = updated[0]
		return nil
	})
	if err != nil {
		return Record{}, err
	}
	return s.decorate(out), nil
}

// --- §8 Transfer ------------------------------------------------------------

// CreateTransfer moves quantity into transit after the quality gate.
//
// The WIP moves to IN_TRANSIT rather than being consumed: until the
// destination receives it, the quantity is nobody's input (BR-WIP03).
func (s *Service) CreateTransfer(ctx context.Context, tenantID string, in TransferInput, actor Actor) (Transfer, error) {
	var wip *Record
	if err := s.tx(ctx, tenantID, func(tx pgx.Tx) error {
		list, err := s.repo.ListWip(ctx, tx, tenantID, RecordFilter{ID: in.WipID})
		if err != nil {
			return err
		}
		if len(list) > 0 {
			wip = &list[0]
		}
		return nil
	}); err != nil {
		return Transfer{}, err
	}
	if wip == nil {
		return Transfer{}, httpx.NotFound("Catatan WIP tidak ditemukan.")
	}
	if in.Quantity <= 0 {
		return Transfer{}, httpx.Validation("Kuantitas transfer harus lebih besar dari nol.")
	}
	if in.Quantity > wip.Quantity {
		return Transfer{}, httpx.Validation(fmt.Sprintf("Kuantitas transfer (%s) melebihi WIP yang tersedia (%s %s).", jsnum.Format(in.Quantity), jsnum.Format(wip.Quantity), wip.Uom))
	}
	if wip.Status == "ON_HOLD" {
		return Transfer{}, httpx.Conflict("WIP berstatus ON_HOLD tidak dapat ditransfer tanpa pelepasan resmi.")
	}
	// BR-H04 / BR-Q02.
	gate, err := s.quality.TransferBlock(ctx, tenantID, wip.WorkOrderID, &wip.ProductID, wip.SourceProcessID)
	if err != nil {
		return Transfer{}, err
	}
	if gate.Blocked {
		return Transfer{}, httpx.Conflict("Transfer diblokir oleh quality gate: " + db.Deref(gate.Reason, ""))
	}

	var transfer Transfer
	if err := s.tx(ctx, tenantID, func(tx pgx.Tx) error {
		if in.IdempotencyKey != nil && *in.IdempotencyKey != "" {
			existing, err := s.repo.ListTransfers(ctx, tx, tenantID, TransferFilter{IdempotencyKey: *in.IdempotencyKey})
			if err != nil {
				return err
			}
			if len(existing) > 0 {
				transfer = existing[0]
				return nil
			}
		}
		number, err := s.repo.NextNumber(ctx, tx, tenantID, "wip_transfer", "TRF")
		if err != nil {
			return err
		}
		destProcess := in.DestinationProcessID
		if destProcess == nil {
			destProcess = wip.DestinationProcessID
		}
		transfer = Transfer{ID: s.newID("wtr"), TenantID: tenantID, TransferNumber: number, WipID: wip.ID, ProductID: wip.ProductID, ProductName: wip.ProductName, BatchID: wip.BatchID,
			SourceWorkOrderID: wip.WorkOrderID, SourceWorkOrderNumber: wip.WorkOrderNumber, SourceProcessID: wip.SourceProcessID, SourceProcessName: wip.SourceProcessName,
			DestinationWorkOrderID: in.DestinationWorkOrderID, DestinationProcessID: destProcess, Quantity: in.Quantity, Uom: wip.Uom, Status: "IN_TRANSIT",
			CreatedBy: actor.ID, CreatedByName: actor.Name, TransferredAt: db.ISO(s.now()), IdempotencyKey: in.IdempotencyKey, Notes: in.Notes}
		if err := s.repo.InsertTransfer(ctx, tx, transfer); err != nil {
			return err
		}
		// A full transfer empties the WIP; a partial one leaves the remainder
		// at the source, which is why the quantity is rewritten either way.
		remaining := wip.Quantity - in.Quantity
		status := "IN_TRANSIT"
		if remaining > 0 {
			status = "AT_PROCESS"
		}
		return s.repo.SetWipStatus(ctx, tx, tenantID, wip.ID, StatusChange{Status: status, Quantity: &remaining, FromStatus: &wip.Status, ChangedBy: actor.ID,
			Reason: db.Ptr(fmt.Sprintf("Transfer %s: %s %s", transfer.TransferNumber, jsnum.Format(in.Quantity), wip.Uom))})
	}); err != nil {
		return Transfer{}, err
	}
	s.events.RecordDetached(event.Input{TenantID: tenantID, EventType: "WIP_TRANSFERRED", EntityType: "WIP", EntityID: wip.ID, ActorType: actor.Type, ActorID: &actor.ID, ActorName: actor.Name,
		WorkOrderID: &wip.WorkOrderID, BatchID: wip.BatchID, ProcessID: wip.SourceProcessID, LineID: wip.LineID,
		Summary:    fmt.Sprintf("%s: %s %s dikirim dari %s.", transfer.TransferNumber, jsnum.Format(transfer.Quantity), transfer.Uom, wip.WorkOrderNumber),
		AfterValue: map[string]any{"quantity": transfer.Quantity, "destinationWorkOrderId": transfer.DestinationWorkOrderID, "destinationProcessId": transfer.DestinationProcessID}})
	return transfer, nil
}

// Transfers lists transfers.
func (s *Service) Transfers(ctx context.Context, tenantID string, f TransferFilter) ([]Transfer, error) {
	var out []Transfer
	err := s.tx(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.repo.ListTransfers(ctx, tx, tenantID, f)
		return err
	})
	return out, err
}

// --- §8.3 Receive -----------------------------------------------------------

// ReceiveTransfer records what actually arrived. A shortfall demands a reason
// (BR-WIP04) and produces a PARTIAL result; on a successful receipt a new WIP
// record is created at the destination (BR-WIP03).
func (s *Service) ReceiveTransfer(ctx context.Context, tenantID, transferID string, in ReceiveInput, actor Actor) (ReceiveOutcome, error) {
	transfers, err := s.Transfers(ctx, tenantID, TransferFilter{ID: transferID})
	if err != nil {
		return ReceiveOutcome{}, err
	}
	if len(transfers) == 0 {
		return ReceiveOutcome{}, httpx.NotFound("Transfer WIP tidak ditemukan.")
	}
	transfer := transfers[0]
	if transfer.Status == "RECEIVED" {
		return ReceiveOutcome{}, httpx.InvalidState("Transfer ini sudah diterima.")
	}
	if in.ReceivedQuantity < 0 {
		return ReceiveOutcome{}, httpx.Validation("Kuantitas diterima tidak boleh negatif.")
	}
	if in.ReceivedQuantity > transfer.Quantity {
		return ReceiveOutcome{}, httpx.Validation(fmt.Sprintf("Kuantitas diterima (%s) melebihi yang dikirim (%s).", jsnum.Format(in.ReceivedQuantity), jsnum.Format(transfer.Quantity)))
	}
	variance := jsnum.Round4(transfer.Quantity - in.ReceivedQuantity)
	if variance != 0 && strings.TrimSpace(db.Deref(in.VarianceReason, "")) == "" {
		return ReceiveOutcome{}, httpx.Validation("Selisih penerimaan wajib disertai alasan (BR-WIP04).")
	}
	result := "PARTIAL"
	switch {
	case in.ReceivedQuantity == 0:
		result = "REJECTED"
	case variance == 0:
		result = "FULL"
	}
	destinationWO := in.DestinationWorkOrderID
	if destinationWO == nil {
		destinationWO = transfer.DestinationWorkOrderID
	}

	var outcome ReceiveOutcome
	if err := s.tx(ctx, tenantID, func(tx pgx.Tx) error {
		if in.IdempotencyKey != nil && *in.IdempotencyKey != "" {
			existing, err := s.repo.ListReceipts(ctx, tx, tenantID, ReceiptFilter{IdempotencyKey: *in.IdempotencyKey})
			if err != nil {
				return err
			}
			if len(existing) > 0 {
				outcome = ReceiveOutcome{Receipt: existing[0]}
				return nil
			}
		}
		receipt := Receipt{ID: s.newID("wrc"), TenantID: tenantID, WipTransferID: transfer.ID, TransferNumber: transfer.TransferNumber, ReceivedQuantity: in.ReceivedQuantity,
			TransferredQuantity: transfer.Quantity, VarianceQuantity: variance, VarianceReason: in.VarianceReason, Result: result, Uom: transfer.Uom,
			ReceivedBy: actor.ID, ReceivedByName: actor.Name, ReceivedAt: db.ISO(s.now()), IdempotencyKey: in.IdempotencyKey, Notes: in.Notes}
		if err := s.repo.InsertReceipt(ctx, tx, receipt); err != nil {
			return err
		}
		transferStatus := "RECEIVED"
		if result == "REJECTED" || result == "PARTIAL" {
			transferStatus = result
		}
		if err := s.repo.SetTransferStatus(ctx, tx, tenantID, transfer.ID, transferStatus, &receipt.ID); err != nil {
			return err
		}
		outcome = ReceiveOutcome{Receipt: receipt}
		if in.ReceivedQuantity > 0 && destinationWO != nil {
			number, err := s.repo.NextNumber(ctx, tx, tenantID, "wip_record", "WIP")
			if err != nil {
				return err
			}
			now := db.ISO(s.now())
			source := in.DestinationProcessID
			if source == nil {
				source = transfer.DestinationProcessID
			}
			wip := Record{ID: s.newID("wip"), TenantID: tenantID, WipNumber: number, ProductID: transfer.ProductID, ProductName: transfer.ProductName, WorkOrderID: *destinationWO,
				WorkOrderNumber: db.Deref(transfer.DestinationWorkOrderNumber, *destinationWO), BatchID: transfer.BatchID, SourceProcessID: source, Quantity: in.ReceivedQuantity,
				Uom: transfer.Uom, Status: "RECEIVED", QualityStatus: "PENDING_INSPECTION", CreatedBy: actor.ID, CreatedAt: now, UpdatedAt: now,
				Notes: db.Ptr("Diterima dari " + transfer.TransferNumber)}
			if err := s.repo.InsertWip(ctx, tx, wip); err != nil {
				return err
			}
			if err := s.repo.SetWipStatus(ctx, tx, tenantID, wip.ID, StatusChange{Status: "AT_PROCESS", FromStatus: db.Ptr("RECEIVED"), ChangedBy: actor.ID, Reason: db.Ptr("Penerimaan " + transfer.TransferNumber)}); err != nil {
				return err
			}
			wip.Status = "AT_PROCESS"
			outcome.Wip = &wip
		}
		return nil
	}); err != nil {
		return ReceiveOutcome{}, err
	}

	// The destination's input quantity is what the routing chain measures
	// progress against, so the received figure has to reach the work order.
	if in.ReceivedQuantity > 0 && destinationWO != nil {
		if err := s.production.IncrementQuantities(ctx, tenantID, *destinationWO, production.Increment{Input: int(math.Round(in.ReceivedQuantity))}); err != nil {
			return ReceiveOutcome{}, err
		}
	}

	eventWO := transfer.SourceWorkOrderID
	if destinationWO != nil {
		eventWO = *destinationWO
	}
	summary := fmt.Sprintf("%s diterima penuh: %s %s.", transfer.TransferNumber, jsnum.Format(in.ReceivedQuantity), transfer.Uom)
	if variance != 0 {
		summary = fmt.Sprintf("%s diterima %s dari %s %s; selisih %s — %s.", transfer.TransferNumber, jsnum.Format(in.ReceivedQuantity), jsnum.Format(transfer.Quantity), transfer.Uom,
			jsnum.Format(variance), db.Deref(in.VarianceReason, ""))
	}
	s.events.RecordDetached(event.Input{TenantID: tenantID, EventType: "WIP_RECEIVED", EntityType: "WIP", EntityID: transfer.WipID, ActorType: actor.Type, ActorID: &actor.ID, ActorName: actor.Name,
		WorkOrderID: &eventWO, BatchID: transfer.BatchID, ProcessID: transfer.DestinationProcessID, Summary: summary,
		AfterValue: map[string]any{"receivedQuantity": in.ReceivedQuantity, "varianceQuantity": variance, "result": result}})
	if outcome.Wip != nil {
		d := s.decorate(*outcome.Wip)
		outcome.Wip = &d
	}
	return outcome, nil
}

// Receipts lists receipts, optionally for one transfer.
func (s *Service) Receipts(ctx context.Context, tenantID, transferID string) ([]Receipt, error) {
	var out []Receipt
	err := s.tx(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.repo.ListReceipts(ctx, tx, tenantID, ReceiptFilter{WipTransferID: transferID})
		return err
	})
	return out, err
}

// --- §7.5 Dashboard ---------------------------------------------------------

type bucket struct {
	id, name string
	quantity float64
	records  int
}

func group(records []Record, keyOf func(Record) (string, string, bool)) []bucket {
	byID := map[string]int{}
	var out []bucket
	for _, r := range records {
		id, name, ok := keyOf(r)
		if !ok {
			continue
		}
		i, seen := byID[id]
		if !seen {
			i = len(out)
			byID[id] = i
			out = append(out, bucket{id: id, name: name})
		}
		out[i].quantity += r.Quantity
		out[i].records++
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].quantity > out[j].quantity })
	return out
}

// WipDashboard is the §7.5 overview of everything still in progress.
func (s *Service) WipDashboard(ctx context.Context, tenantID string) (Dashboard, error) {
	records, err := s.Records(ctx, tenantID, RecordFilter{OpenOnly: true, Limit: 5000})
	if err != nil {
		return Dashboard{}, err
	}
	transfers, err := s.Transfers(ctx, tenantID, TransferFilter{Status: "IN_TRANSIT", Limit: 1000})
	if err != nil {
		return Dashboard{}, err
	}
	lines, err := s.master.Lines(ctx, tenantID)
	if err != nil {
		return Dashboard{}, err
	}
	lineName := func(id string) string {
		for _, l := range lines {
			if l.ID == id {
				return l.Name
			}
		}
		return id
	}
	d := Dashboard{Uom: "PCS", ByProcess: []ProcessBucket{}, ByLine: []LineBucket{}, ByProduct: []ProductBucket{}, AgingThresholdHours: s.agingHours, CriticalThresholdHours: s.criticalHours}
	if len(records) > 0 {
		d.Uom = records[0].Uom
	}
	var total, onHold float64
	for _, r := range records {
		total += r.Quantity
		switch db.Deref(r.AgingStatus, "NORMAL") {
		case "NORMAL":
			d.Aging.Normal++
		case "AGING":
			d.Aging.Aging++
		case "CRITICAL":
			d.Aging.Critical++
			// "Stuck" is the operational reading of CRITICAL: old, and still
			// not moved on — the queue a bottleneck analysis starts from.
			if r.Status != "IN_TRANSIT" {
				d.StuckRecords++
			}
		}
		if r.Status == "ON_HOLD" {
			onHold += r.Quantity
		}
	}
	d.TotalWip = jsnum.ToFixed(total, 2)
	d.OnHoldQuantity = jsnum.ToFixed(onHold, 2)
	for _, b := range group(records, func(r Record) (string, string, bool) {
		if r.SourceProcessID == nil {
			return "", "", false
		}
		return *r.SourceProcessID, db.Deref(r.SourceProcessName, *r.SourceProcessID), true
	}) {
		d.ByProcess = append(d.ByProcess, ProcessBucket{b.id, b.name, b.quantity, b.records})
	}
	for _, b := range group(records, func(r Record) (string, string, bool) {
		if r.LineID == nil {
			return "", "", false
		}
		return *r.LineID, lineName(*r.LineID), true
	}) {
		d.ByLine = append(d.ByLine, LineBucket{b.id, b.name, b.quantity, b.records})
	}
	for _, b := range group(records, func(r Record) (string, string, bool) { return r.ProductID, r.ProductName, true }) {
		d.ByProduct = append(d.ByProduct, ProductBucket{b.id, b.name, b.quantity, b.records})
	}
	var waiting float64
	for _, t := range transfers {
		waiting += t.Quantity
	}
	d.WaitingTransferQuantity = jsnum.ToFixed(waiting, 2)
	return d, nil
}
