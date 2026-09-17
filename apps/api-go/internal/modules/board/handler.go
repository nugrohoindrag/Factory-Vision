package board

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

func queryIntPtr(r *http.Request, key string) (*int, error) {
	raw := r.URL.Query().Get(key)
	if raw == "" {
		return nil, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return nil, httpx.Validation(key + " harus berupa angka.")
	}
	return &n, nil
}

// Mount registers /production-board and /production-board/dispatch.
//
// One read endpoint and one write endpoint. The write is a single `dispatch`
// action rather than five verbs because §9.6 lists five things a dispatcher
// may do and §39 requires all of them audited the same way.
func Mount(r chi.Router, svc *Service, auditor audit.Recorder) {
	tenant := func(r *http.Request) string { return tenancy.TenantID(r.Context()) }
	q := func(r *http.Request, key string) string { return r.URL.Query().Get(key) }

	r.Get("/production-board", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		days, err := queryIntPtr(r, "days")
		if err != nil {
			return err
		}
		priority, err := queryIntPtr(r, "priority")
		if err != nil {
			return err
		}
		board, err := svc.Build(r.Context(), tenant(r), Query{ViewMode: q(r, "viewMode"), Date: q(r, "date"), Days: days, PlantID: q(r, "plantId"), LineID: q(r, "lineId"),
			WorkCenterID: q(r, "workCenterId"), MachineID: q(r, "machineId"), ProcessID: q(r, "processId"), ProductID: q(r, "productId"), ShiftID: q(r, "shiftId"),
			Status: q(r, "status"), Priority: priority})
		if err != nil {
			return err
		}
		return httpx.OK(w, board)
	}))

	r.Post("/production-board/dispatch", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		a := DispatchAction{PlannedStart: v.OptStr("plannedStart"), PlannedEnd: v.OptStr("plannedEnd"), MachineID: v.OptStr("machineId"),
			OperatorIDs: v.StringArray("operatorIds", httpx.Opt{Optional: true}), Sequence: v.Int("sequence", httpx.Opt{Min: httpx.Min(0), Optional: true}),
			Priority: v.Int("priority", httpx.Opt{Min: httpx.Min(0), Max: httpx.Max(100), Optional: true}), Reason: v.String("reason", httpx.Opt{Optional: true, Max: httpx.Max(500)})}
		action := v.String("action", httpx.Opt{})
		workOrderID := v.String("workOrderId", httpx.Opt{})
		if err := v.Done(); err != nil {
			return err
		}
		a.Action, a.WorkOrderID, a.HasOperatorIDs = *action, *workOrderID, v.Has("operatorIds")
		if !a.HasOperatorIDs {
			a.OperatorIDs = nil
		}

		// The three narrower rights from §34, checked where the action is
		// known: the route table can only see the path, and the path is the
		// same for all six actions.
		needed := "production_board:reschedule"
		switch a.Action {
		case "REASSIGN_MACHINE", "REASSIGN_OPERATOR":
			needed = "production_board:assign"
		case "CONFIRM", "CANCEL":
			needed = "production_board:dispatch"
		}
		actor := Actor{ID: "system", Name: db.Ptr("System")}
		if p := auth.PrincipalFrom(r.Context()); p != nil {
			if !p.Has(needed) {
				return httpx.Forbidden("Aksi " + a.Action + " memerlukan izin " + needed + ".")
			}
			actor = Actor{ID: p.SubjectID, Name: db.Ptr(p.Name)}
		}
		wo, err := svc.Dispatch(r.Context(), tenant(r), a, actor)
		if err != nil {
			return err
		}
		if _, err := auditor.Record(r.Context(), audit.FromRequest(r, "work_order", a.WorkOrderID, "BOARD_"+a.Action, nil,
			map[string]any{"plannedStart": wo.PlannedStart, "plannedEnd": wo.PlannedEnd, "machineId": wo.MachineID, "priority": wo.Priority, "sequence": wo.Sequence, "reason": a.Reason})); err != nil {
			return err
		}
		return httpx.OK(w, wo)
	}))
}
