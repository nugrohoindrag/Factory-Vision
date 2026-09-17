// Package improvement adapts the v2.0 modules to the shop-floor sync batch:
// an operator terminal that replays its queue after a reconnect must issue
// the material, record the inspection or move the WIP exactly once, and the
// client event id is the idempotency key that makes it so.
package improvement

import (
	"context"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/material"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/quality"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/shopfloor"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/wip"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/httpx"
)

// Offline implements shopfloor.Improvement.
type Offline struct {
	material *material.Service
	quality  *quality.Service
	wip      *wip.Service
}

// NewOffline wires the adapter.
func NewOffline(mat *material.Service, q *quality.Service, w *wip.Service) *Offline {
	return &Offline{material: mat, quality: q, wip: w}
}

var _ shopfloor.Improvement = (*Offline)(nil)

// RecordConsumption replays a RECORD_CONSUMPTION command.
func (o *Offline) RecordConsumption(ctx context.Context, tenantID string, payload map[string]any, workOrderID, idempotencyKey string, actor shopfloor.OfflineActor) (string, error) {
	v := httpx.Validate(payload)
	in := material.ConsumptionInput{
		WorkOrderID: workOrderID, IdempotencyKey: &idempotencyKey,
		PlannedQuantity: v.Number("plannedQuantity", httpx.Opt{Optional: true}), WarehouseID: v.OptStr("warehouseId"), BatchID: v.OptStr("batchId"), ProcessID: v.OptStr("processId"),
		MachineID: v.OptStr("machineId"), OperatorID: v.OptStr("operatorId"), ConsumptionType: v.OptStr("consumptionType"), UOM: v.OptStr("uom"), Notes: v.OptStr("notes"),
	}
	materialID := v.String("materialId", httpx.Opt{})
	actual := v.Number("actualQuantity", httpx.Opt{})
	override := v.Boolean("allowOverride", httpx.Opt{Optional: true})
	if err := v.Done(); err != nil {
		return "", err
	}
	in.MaterialID, in.ActualQuantity, in.AllowOverride = *materialID, *actual, override != nil && *override
	rec, err := o.material.RecordConsumption(ctx, tenantID, in, material.Actor{ID: actor.ID, Name: actor.Name, Type: actor.Type})
	if err != nil {
		return "", err
	}
	return rec.ID, nil
}

// RecordInspection replays a RECORD_INSPECTION command.
func (o *Offline) RecordInspection(ctx context.Context, tenantID string, payload map[string]any, workOrderID, idempotencyKey string, actor shopfloor.OfflineActor) (string, error) {
	v := httpx.Validate(payload)
	in := quality.InspectionInput{
		WorkOrderID: &workOrderID, IdempotencyKey: &idempotencyKey,
		InspectionPlanID: v.OptStr("inspectionPlanId"), InspectionType: v.OptStr("inspectionType"), BatchID: v.OptStr("batchId"), ProductID: v.OptStr("productId"),
		ProcessID: v.OptStr("processId"), MachineID: v.OptStr("machineId"), FailedQuantity: v.Number("failedQuantity", httpx.Opt{Optional: true}), UOM: v.OptStr("uom"),
		OperatorID: v.OptStr("operatorId"), Notes: v.OptStr("notes"), Measurements: quality.MeasurementsFrom(payload["measurements"]),
	}
	inspected := v.Number("inspectedQuantity", httpx.Opt{})
	if err := v.Done(); err != nil {
		return "", err
	}
	in.InspectedQuantity = *inspected
	rec, err := o.quality.RecordInspection(ctx, tenantID, in, quality.Actor{ID: actor.ID, Name: actor.Name, Type: actor.Type})
	if err != nil {
		return "", err
	}
	return rec.ID, nil
}

// CreateWip replays a RECORD_WIP command.
func (o *Offline) CreateWip(ctx context.Context, tenantID string, payload map[string]any, workOrderID string, actor shopfloor.OfflineActor) (string, error) {
	v := httpx.Validate(payload)
	in := wip.CreateInput{
		WorkOrderID: workOrderID,
		ProductID:   v.OptStr("productId"), BatchID: v.OptStr("batchId"), SourceProcessID: v.OptStr("sourceProcessId"), DestinationProcessID: v.OptStr("destinationProcessId"),
		Uom: v.OptStr("uom"), LocationID: v.OptStr("locationId"), LocationName: v.OptStr("locationName"), QualityStatus: v.OptStr("qualityStatus"), Notes: v.OptStr("notes"),
	}
	quantity := v.Number("quantity", httpx.Opt{})
	if err := v.Done(); err != nil {
		return "", err
	}
	in.Quantity = *quantity
	rec, err := o.wip.CreateWip(ctx, tenantID, in, wip.Actor{ID: actor.ID, Name: actor.Name, Type: actor.Type})
	if err != nil {
		return "", err
	}
	return rec.ID, nil
}

// CreateWipTransfer replays a TRANSFER_WIP command.
func (o *Offline) CreateWipTransfer(ctx context.Context, tenantID string, payload map[string]any, idempotencyKey string, actor shopfloor.OfflineActor) (string, error) {
	v := httpx.Validate(payload)
	in := wip.TransferInput{IdempotencyKey: &idempotencyKey, DestinationWorkOrderID: v.OptStr("destinationWorkOrderId"), DestinationProcessID: v.OptStr("destinationProcessId"), Notes: v.OptStr("notes")}
	wipID := v.String("wipId", httpx.Opt{})
	quantity := v.Number("quantity", httpx.Opt{})
	if err := v.Done(); err != nil {
		return "", err
	}
	in.WipID, in.Quantity = *wipID, *quantity
	rec, err := o.wip.CreateTransfer(ctx, tenantID, in, wip.Actor{ID: actor.ID, Name: actor.Name, Type: actor.Type})
	if err != nil {
		return "", err
	}
	return rec.ID, nil
}
