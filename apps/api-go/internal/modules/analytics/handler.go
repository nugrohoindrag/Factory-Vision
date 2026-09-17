package analytics

import (
	"math"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/shopfloor"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/auth"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/httpx"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/tenancy"
)

// parseDays reads ?days=, clamped to a sane analysis window, the way the
// Node route did: absent → fallback, garbage → fallback, otherwise 1..90.
func parseDays(r *http.Request, fallback int) int {
	if !r.URL.Query().Has("days") {
		return fallback
	}
	raw := r.URL.Query().Get("days")
	if raw == "" {
		return 1 // Number('') is 0, clamped up to 1
	}
	v, err := strconv.ParseFloat(raw, 64)
	if err != nil || math.IsNaN(v) || math.IsInf(v, 0) {
		return fallback
	}
	return int(math.Min(90, math.Max(1, math.Trunc(v))))
}

// Mount registers /analytics/* and /reports/{production,downtime,shift}.
func Mount(r chi.Router, svc *Service, sf *shopfloor.Service) {
	tenant := func(r *http.Request) string { return tenancy.TenantID(r.Context()) }

	r.Get("/analytics/live-board", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		rows, err := svc.LiveProductionBoard(r.Context(), tenant(r))
		if err != nil {
			return err
		}
		return httpx.OK(w, rows)
	}))
	r.Get("/analytics/downtime-pareto", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		rows, err := svc.DowntimePareto(r.Context(), tenant(r), httpx.QueryStr(r, "lineId"))
		if err != nil {
			return err
		}
		return httpx.OK(w, rows)
	}))
	r.Get("/analytics/executive-kpi", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		rows, err := svc.ExecutiveKpi(r.Context(), tenant(r), parseDays(r, 7))
		if err != nil {
			return err
		}
		return httpx.OK(w, rows)
	}))
	r.Get("/analytics/production-trend", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		rows, err := svc.ProductionTrend(r.Context(), tenant(r), parseDays(r, 7))
		if err != nil {
			return err
		}
		return httpx.OK(w, rows)
	}))
	r.Get("/analytics/oee-trend", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		rows, err := svc.OeeTrend(r.Context(), tenant(r), parseDays(r, 7))
		if err != nil {
			return err
		}
		return httpx.OK(w, rows)
	}))
	r.Get("/analytics/line-performance", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		rows, err := svc.LinePerformance(r.Context(), tenant(r), parseDays(r, 7))
		if err != nil {
			return err
		}
		return httpx.OK(w, rows)
	}))
	r.Get("/analytics/plant-performance", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		rows, err := svc.PlantPerformance(r.Context(), tenant(r), parseDays(r, 7))
		if err != nil {
			return err
		}
		return httpx.OK(w, rows)
	}))
	r.Get("/analytics/process-performance", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		rows, err := svc.ProcessPerformance(r.Context(), tenant(r), parseDays(r, 7))
		if err != nil {
			return err
		}
		return httpx.OK(w, rows)
	}))
	r.Get("/analytics/downtime-summary", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		out, err := svc.DowntimeSummary(r.Context(), tenant(r), parseDays(r, 7))
		if err != nil {
			return err
		}
		return httpx.OK(w, out)
	}))
	r.Get("/analytics/reject-pareto", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		rows, err := svc.RejectPareto(r.Context(), tenant(r), httpx.QueryStr(r, "lineId"))
		if err != nil {
			return err
		}
		return httpx.OK(w, rows)
	}))
	r.Get("/analytics/quality-summary", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		out, err := svc.QualitySummary(r.Context(), tenant(r), parseDays(r, 7))
		if err != nil {
			return err
		}
		return httpx.OK(w, out)
	}))
	r.Get("/analytics/order-status", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		out, err := svc.OrderStatus(r.Context(), tenant(r), svc.now())
		if err != nil {
			return err
		}
		return httpx.OK(w, out)
	}))
	r.Get("/analytics/alerts", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		rows, err := svc.Alerts(r.Context(), tenant(r), parseDays(r, 7))
		if err != nil {
			return err
		}
		return httpx.OK(w, rows)
	}))
	r.Get("/analytics/daily-performance", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		rows, err := svc.DailyPerformance(r.Context(), tenant(r), parseDays(r, 30))
		if err != nil {
			return err
		}
		return httpx.OK(w, rows)
	}))

	// Reports: every report is filtered to the caller's scope before it is
	// serialised, so the JSON view and the CSV download can never disagree
	// about what the user may see.
	csv := func(w http.ResponseWriter, filename, body string) error {
		w.Header().Set("Content-Type", "text/csv")
		w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
		_, err := w.Write([]byte(body))
		return err
	}

	r.Get("/reports/production", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		p := auth.PrincipalFrom(r.Context())
		lineID := httpx.QueryStr(r, "lineId")
		if err := auth.AssertLine(p, lineID); err != nil {
			return err
		}
		rows, err := svc.ProductionReport(r.Context(), tenant(r), lineID)
		if err != nil {
			return err
		}
		rows = auth.FilterLines(p, rows, func(x ProductionReportRow) string { return x.LineID })
		if httpx.QueryStr(r, "format") == "csv" {
			return csv(w, "production-report.csv", ProductionReportCSV(rows))
		}
		return httpx.OK(w, rows)
	}))

	r.Get("/reports/downtime", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		p := auth.PrincipalFrom(r.Context())
		lineID := httpx.QueryStr(r, "lineId")
		if err := auth.AssertLine(p, lineID); err != nil {
			return err
		}
		records, err := sf.DowntimeRecords(r.Context(), tenant(r), shopfloor.DowntimeFilter{LineID: lineID})
		if err != nil {
			return err
		}
		rows, err := svc.DowntimeReport(r.Context(), tenant(r), lineID, records)
		if err != nil {
			return err
		}
		rows = auth.FilterLines(p, rows, func(x DowntimeReportRow) string { return x.LineID })
		if httpx.QueryStr(r, "format") == "csv" {
			return csv(w, "downtime-report.csv", DowntimeReportCSV(rows))
		}
		return httpx.OK(w, rows)
	}))

	r.Get("/reports/shift", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		p := auth.PrincipalFrom(r.Context())
		rows, err := svc.ShiftReport(r.Context(), tenant(r), httpx.QueryStr(r, "shiftDate"), httpx.QueryStr(r, "shiftId"))
		if err != nil {
			return err
		}
		rows = auth.FilterLines(p, rows, func(x ShiftReportRow) string { return x.LineID })
		if httpx.QueryStr(r, "format") == "csv" {
			return csv(w, "shift-report.csv", ShiftReportCSV(rows))
		}
		return httpx.OK(w, rows)
	}))
}
