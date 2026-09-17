package oee

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/audit"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/auth"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/httpx"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/tenancy"
)

// filterFrom reads the shared filter contract, narrowed to the caller's
// scope server-side so a hand-crafted query string cannot widen what a
// line supervisor sees.
func filterFrom(r *http.Request) Filter {
	q := r.URL.Query()
	f := Filter{
		From: q.Get("from"), To: q.Get("to"), LineID: q.Get("lineId"), ProcessID: q.Get("processId"),
		MachineID: q.Get("machineId"), ShiftID: q.Get("shiftId"), ProductID: q.Get("productId"),
	}
	if raw := q.Get("days"); raw != "" {
		if n, err := strconv.ParseFloat(raw, 64); err == nil {
			d := int(n)
			f.Days = &d
		}
	}
	if p := auth.PrincipalFrom(r.Context()); p != nil && p.Scope.Level != "TENANT" {
		f.AllowedLineIDs = p.Scope.LineIDs
		if f.AllowedLineIDs == nil {
			f.AllowedLineIDs = []string{}
		}
	}
	return f
}

func queryNumber(r *http.Request, key string) float64 {
	raw := r.URL.Query().Get(key)
	if raw == "" {
		return 0
	}
	n, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return 0
	}
	return n
}

// Mount registers the /oee routes and /reports/oee.
func Mount(r chi.Router, svc *Service, auditor audit.Recorder) {
	tenant := func(r *http.Request) string { return tenancy.TenantID(r.Context()) }

	r.Get("/oee/config", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		config, err := svc.GetConfig(r.Context(), tenant(r))
		if err != nil {
			return err
		}
		return httpx.OK(w, config)
	}))

	r.Put("/oee/config", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		p := ConfigPatch{
			PptExcludesPlannedDowntime: v.Boolean("pptExcludesPlannedDowntime", httpx.Opt{Optional: true}),
			IdealCycleSource:           v.OneOf("idealCycleSource", []string{"PRODUCT_MACHINE", "ROUTING", "PRODUCT"}, httpx.Opt{Optional: true}),
			AllowIdealCycleFallback:    v.Boolean("allowIdealCycleFallback", httpx.Opt{Optional: true}),
		}
		if err := v.Done(); err != nil {
			return err
		}
		actor := auth.ActorID(r.Context())
		before, after, err := svc.UpdateConfig(r.Context(), tenant(r), p, actor)
		if err != nil {
			return err
		}
		auditor.RecordDetached(audit.FromRequest(r, "oee_config", tenant(r), "OEE_CONFIG_CHANGED", before, after))
		return httpx.OK(w, after)
	}))

	r.Get("/oee/calculate", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		in := CalculationInput{
			PlannedProductionSeconds: queryNumber(r, "plannedProductionSeconds"),
			PlannedDowntimeSeconds:   queryNumber(r, "plannedDowntimeSeconds"),
			UnplannedDowntimeSeconds: queryNumber(r, "unplannedDowntimeSeconds"),
			GoodCount:                queryNumber(r, "goodCount"),
			RejectCount:              queryNumber(r, "rejectCount"),
		}
		if r.URL.Query().Get("idealCycleSeconds") != "" {
			ideal := queryNumber(r, "idealCycleSeconds")
			in.IdealCycleSeconds = &ideal
		}
		result, err := svc.Calculate(r.Context(), tenant(r), in)
		if err != nil {
			return err
		}
		return httpx.OK(w, result)
	}))

	r.Get("/oee/machine-performance", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		rows, err := svc.MachinePerformance(r.Context(), tenant(r), filterFrom(r))
		if err != nil {
			return err
		}
		return httpx.OK(w, rows)
	}))

	r.Get("/oee/bottlenecks", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		rows, err := svc.Bottlenecks(r.Context(), tenant(r), filterFrom(r), r.URL.Query().Get("kind"))
		if err != nil {
			return err
		}
		return httpx.OK(w, rows)
	}))

	r.Get("/oee/target-vs-actual", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		dimension := strings.ToUpper(r.URL.Query().Get("dimension"))
		switch dimension {
		case "LINE", "PROCESS", "PRODUCT", "SHIFT", "DATE":
		default:
			dimension = "LINE"
		}
		summary, err := svc.TargetVsActual(r.Context(), tenant(r), dimension, filterFrom(r))
		if err != nil {
			return err
		}
		return httpx.OK(w, summary)
	}))

	report := httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		rows, err := svc.Report(r.Context(), tenant(r), filterFrom(r))
		if err != nil {
			return err
		}
		if r.URL.Query().Get("format") == "csv" {
			return writeReportCSV(w, rows)
		}
		return httpx.OK(w, rows)
	})
	r.Get("/oee/report", report)
	r.Get("/reports/oee", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		// The reports namespace reads the same rows without the from/to and
		// processId filters, as the Node route did.
		f := filterFrom(r)
		f.From, f.To, f.ProcessID = "", "", ""
		rows, err := svc.Report(r.Context(), tenant(r), f)
		if err != nil {
			return err
		}
		return httpx.OK(w, rows)
	}))

	r.Get("/oee/validation", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		entries, err := svc.ValidationEntries(r.Context(), tenant(r))
		if err != nil {
			return err
		}
		config, err := svc.GetConfig(r.Context(), tenant(r))
		if err != nil {
			return err
		}
		return httpx.OK(w, map[string]any{"entries": entries, "gate": GateStatusOf(entries), "config": config})
	}))

	r.Put("/oee/validation/{item}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		body, err := httpx.Body(r)
		if err != nil {
			return err
		}
		v := httpx.Validate(body)
		p := ValidationPatch{
			ScopeLabel:             v.String("scopeLabel", httpx.Opt{Optional: true, Max: httpx.Max(160)}),
			ShiftDate:              v.String("shiftDate", httpx.Opt{Optional: true}),
			GapClass:               v.OneOf("gapClass", []string{"DEFINITION", "DATA_CAPTURE", "MASTER_DATA", "NONE"}, httpx.Opt{Optional: true}),
			Status:                 v.OneOf("status", []string{"OPEN", "IN_REVIEW", "RESOLVED"}, httpx.Opt{Optional: true}),
			Resolution:             v.String("resolution", httpx.Opt{Optional: true, Max: httpx.Max(1000)}),
			Notes:                  v.String("notes", httpx.Opt{Optional: true, Max: httpx.Max(2000)}),
			ResolvedByConfigChange: v.Boolean("resolvedByConfigChange", httpx.Opt{Optional: true}),
			MesValue:               v.Number("mesValue", httpx.Opt{Optional: true}),
			FactoryValue:           v.Number("factoryValue", httpx.Opt{Optional: true}),
		}
		if err := v.Done(); err != nil {
			return err
		}
		item := strings.ToUpper(chi.URLParam(r, "item"))
		entry, err := svc.UpsertValidationEntry(r.Context(), tenant(r), item, p, auth.ActorID(r.Context()))
		if err != nil {
			return err
		}
		auditor.RecordDetached(audit.FromRequest(r, "oee_validation", entry.ID, "OEE_VALIDATION_UPDATED", nil,
			map[string]any{"item": entry.Item, "status": entry.Status, "gapClass": entry.GapClass, "gap": entry.Gap}))
		return httpx.OK(w, entry)
	}))
}

var reportHeader = []string{"shiftDate", "shiftName", "lineName", "machineName", "processName", "productName",
	"availability", "performance", "quality", "oee", "plannedMinutes", "runMinutes", "downtimeMinutes",
	"goodQuantity", "rejectQuantity", "totalQuantity", "calcVersion"}

func writeReportCSV(w http.ResponseWriter, rows []ReportItem) error {
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="oee-report.csv"`)
	var b strings.Builder
	b.WriteString(strings.Join(reportHeader, ","))
	str := func(p *string) string { return deref(p) }
	num := func(f float64) string { return strconv.FormatFloat(f, 'f', -1, 64) }
	for _, r := range rows {
		b.WriteString("\n")
		b.WriteString(strings.Join([]string{
			r.ShiftDate, r.ShiftName, r.LineName, r.MachineName, str(r.ProcessName), str(r.ProductName),
			num(r.Availability), num(r.Performance), num(r.Quality), num(r.Oee),
			fmt.Sprint(r.PlannedMinutes), fmt.Sprint(r.RunMinutes), fmt.Sprint(r.DowntimeMinutes),
			num(r.GoodQuantity), num(r.RejectQuantity), num(r.TotalQuantity), fmt.Sprint(r.CalcVersion),
		}, ","))
	}
	_, err := w.Write([]byte(b.String()))
	return err
}

func deref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
