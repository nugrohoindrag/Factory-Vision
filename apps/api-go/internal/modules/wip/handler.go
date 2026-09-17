package wip

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/audit"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/auth"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/httpx"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/tenancy"
)

func actorOf(r *http.Request) Actor {
	p := auth.PrincipalFrom(r.Context())
	if p == nil {
		return Actor{ID: "system", Name: db.Ptr("System"), Type: "USER"}
	}
	a := Actor{ID: p.SubjectID, Name: db.Ptr(p.Name), Type: "USER"}
	if p.Kind == auth.KindOperator {
		a.Type = "OPERATOR"
	}
	return a
}

func queryInt(r *http.Request, key string) (int, error) {
	raw := r.URL.Query().Get(key)
	if raw == "" {
		return 0, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return 0, httpx.Validation(key + " harus berupa angka.")
	}
	return n, nil
}

// Mount registers /wip/*.
func Mount(r chi.Router, svc *Service, auditor audit.Recorder) {
	tenant := func(r *http.Request) string { return tenancy.TenantID(r.Context()) }
	q := func(r *http.Request, key string) string { return r.URL.Query().Get(key) }

	// --- WIP records ------------------------------------------------------

	r.Get("/wip/records", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		limit, err := queryInt(r, "limit")
		if err != nil {
			return err
		}
		list, err := svc.Records(r.Context(), tenant(r), RecordFilter{WorkOrderID: q(r, "workOrderId"), Status: q(r, "status"), OpenOnly: q(r, "openOnly") != "false",
			DestinationProcessID: q(r, "destinationProcessId"), ProductID: q(r, "productId"), AgingOnly: q(r, "agingOnly") == "true", Limit: limit})
		if err != nil {
			return err
		}
		return httpx.OK(w, list)
	}))

	r.Post("/wip/records", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		in := CreateInput{ProductID: v.OptStr("productId"), BatchID: v.OptStr("batchId"), SourceProcessID: v.OptStr("sourceProcessId"), DestinationProcessID: v.OptStr("destinationProcessId"),
			Uom: v.OptStr("uom"), LocationID: v.OptStr("locationId"), LocationName: v.OptStr("locationName"), Notes: v.String("notes", httpx.Opt{Optional: true, Max: httpx.Max(1000)})}
		workOrderID := v.String("workOrderId", httpx.Opt{})
		quantity := v.Number("quantity", httpx.Opt{Min: httpx.Min(0.0001)})
		if err := v.Done(); err != nil {
			return err
		}
		in.WorkOrderID, in.Quantity = *workOrderID, *quantity
		rec, err := svc.CreateWip(r.Context(), tenant(r), in, actorOf(r))
		if err != nil {
			return err
		}
		return httpx.Created(w, rec)
	}))

	r.Get("/wip/records/{id}/history", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		list, err := svc.StatusHistory(r.Context(), tenant(r), chi.URLParam(r, "id"))
		if err != nil {
			return err
		}
		return httpx.OK(w, list)
	}))

	statusChange := func(action string, change func(ctx *http.Request, id, reason string) (Record, error), value func(reason string, rec Record) map[string]any) http.HandlerFunc {
		return httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
			body, err := httpx.Body(r)
			if err != nil {
				return err
			}
			v := httpx.Validate(body)
			reason := v.String("reason", httpx.Opt{Min: httpx.Min(3), Max: httpx.Max(500)})
			if err := v.Done(); err != nil {
				return err
			}
			rec, err := change(r, chi.URLParam(r, "id"), *reason)
			if err != nil {
				return err
			}
			if _, err := auditor.Record(r.Context(), audit.FromRequest(r, "wip_record", rec.ID, action, nil, value(*reason, rec))); err != nil {
				return err
			}
			return httpx.OK(w, rec)
		})
	}

	r.Post("/wip/records/{id}/hold", statusChange("WIP_HOLD",
		func(r *http.Request, id, reason string) (Record, error) {
			return svc.HoldWip(r.Context(), tenant(r), id, reason, actorOf(r))
		},
		func(reason string, rec Record) map[string]any {
			return map[string]any{"reason": reason, "quantity": rec.Quantity}
		}))

	r.Post("/wip/records/{id}/release", statusChange("WIP_RELEASE",
		func(r *http.Request, id, reason string) (Record, error) {
			return svc.ReleaseWip(r.Context(), tenant(r), id, reason, actorOf(r))
		},
		func(reason string, _ Record) map[string]any { return map[string]any{"reason": reason} }))

	// --- Transfers --------------------------------------------------------

	r.Get("/wip/transfers", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		limit, err := queryInt(r, "limit")
		if err != nil {
			return err
		}
		list, err := svc.Transfers(r.Context(), tenant(r), TransferFilter{WipID: q(r, "wipId"), SourceWorkOrderID: q(r, "sourceWorkOrderId"),
			DestinationWorkOrderID: q(r, "destinationWorkOrderId"), Status: q(r, "status"), Limit: limit})
		if err != nil {
			return err
		}
		return httpx.OK(w, list)
	}))

	r.Post("/wip/transfers", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		in := TransferInput{DestinationWorkOrderID: v.OptStr("destinationWorkOrderId"), DestinationProcessID: v.OptStr("destinationProcessId"),
			Notes: v.String("notes", httpx.Opt{Optional: true, Max: httpx.Max(1000)}), IdempotencyKey: v.OptStr("idempotencyKey")}
		wipID := v.String("wipId", httpx.Opt{})
		quantity := v.Number("quantity", httpx.Opt{Min: httpx.Min(0.0001)})
		if err := v.Done(); err != nil {
			return err
		}
		in.WipID, in.Quantity = *wipID, *quantity
		t, err := svc.CreateTransfer(r.Context(), tenant(r), in, actorOf(r))
		if err != nil {
			return err
		}
		if _, err := auditor.Record(r.Context(), audit.FromRequest(r, "wip_transfer", t.ID, "WIP_TRANSFER", nil,
			map[string]any{"quantity": t.Quantity, "sourceWorkOrderId": t.SourceWorkOrderID, "destinationWorkOrderId": t.DestinationWorkOrderID})); err != nil {
			return err
		}
		return httpx.Created(w, t)
	}))

	// --- Receiving --------------------------------------------------------

	r.Post("/wip/transfers/{id}/receive", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		in := ReceiveInput{VarianceReason: v.String("varianceReason", httpx.Opt{Optional: true, Max: httpx.Max(500)}), DestinationWorkOrderID: v.OptStr("destinationWorkOrderId"),
			DestinationProcessID: v.OptStr("destinationProcessId"), Notes: v.String("notes", httpx.Opt{Optional: true, Max: httpx.Max(1000)}), IdempotencyKey: v.OptStr("idempotencyKey")}
		received := v.Number("receivedQuantity", httpx.Opt{Min: httpx.Min(0)})
		if err := v.Done(); err != nil {
			return err
		}
		in.ReceivedQuantity = *received
		id := chi.URLParam(r, "id")
		outcome, err := svc.ReceiveTransfer(r.Context(), tenant(r), id, in, actorOf(r))
		if err != nil {
			return err
		}
		rc := outcome.Receipt
		if _, err := auditor.Record(r.Context(), audit.FromRequest(r, "wip_receipt", rc.ID, "WIP_RECEIVE", nil,
			map[string]any{"transferId": id, "receivedQuantity": rc.ReceivedQuantity, "transferredQuantity": rc.TransferredQuantity, "varianceQuantity": rc.VarianceQuantity,
				"varianceReason": rc.VarianceReason, "result": rc.Result})); err != nil {
			return err
		}
		return httpx.Created(w, outcome)
	}))

	r.Get("/wip/receipts", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		list, err := svc.Receipts(r.Context(), tenant(r), q(r, "transferId"))
		if err != nil {
			return err
		}
		return httpx.OK(w, list)
	}))

	// --- Dashboard --------------------------------------------------------

	r.Get("/wip/dashboard", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		d, err := svc.WipDashboard(r.Context(), tenant(r))
		if err != nil {
			return err
		}
		return httpx.OK(w, d)
	}))
}
