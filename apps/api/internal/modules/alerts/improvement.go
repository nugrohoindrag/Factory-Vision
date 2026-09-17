// Package alerts is the improvement's exception layer (Improvement PRD §26).
//
// Kept apart from the analytics operational alerts, which are built from OEE
// aggregates; the analytics feed concatenates both lists so the console still
// sees one. Every alert carries the console route that answers it. Rules are
// evaluated against live figures on each request and none is stored: an
// alert that outlived the condition it describes is the failure mode that
// teaches people to ignore the feed.
package alerts

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"golang.org/x/sync/errgroup"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/analytics"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/maintenance"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/material"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/quality"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/wip"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/workforce"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/jsnum"
)

// Alert is one operational alert, shared with analytics.
type Alert = analytics.OperationalAlert

// Improvement evaluates the §26 rules.
type Improvement struct {
	material    *material.Service
	quality     *quality.Service
	maintenance *maintenance.Service
	workforce   *workforce.Service
	wip         *wip.Service
	now         func() time.Time
}

// NewImprovement wires the rules.
func NewImprovement(mat *material.Service, q *quality.Service, mt *maintenance.Service, wf *workforce.Service, w *wip.Service) *Improvement {
	return &Improvement{material: mat, quality: q, maintenance: mt, workforce: wf, wip: w, now: time.Now}
}

var severityRank = map[string]int{"CRITICAL": 0, "WARNING": 1, "INFORMATIONAL": 2}

// Alerts runs every group; one failing module leaves the rest of the feed
// intact — a material query that times out must not blank the maintenance
// alerts a technician is waiting on.
func (s *Improvement) Alerts(ctx context.Context, tenantID string) ([]Alert, error) {
	raisedAt := db.ISO(s.now())
	groups := make([][]Alert, 5)
	rules := []func(context.Context, string, string) ([]Alert, error){s.materialAlerts, s.qualityAlerts, s.maintenanceAlerts, s.workforceAlerts, s.wipAlerts}
	g, gctx := errgroup.WithContext(ctx)
	for i, rule := range rules {
		i, rule := i, rule
		g.Go(func() error {
			list, err := rule(gctx, tenantID, raisedAt)
			if err != nil {
				list = nil
			}
			groups[i] = list
			return nil
		})
	}
	_ = g.Wait()
	out := []Alert{}
	for _, group := range groups {
		out = append(out, group...)
	}
	sort.SliceStable(out, func(i, j int) bool { return severityRank[out[i].Severity] < severityRank[out[j].Severity] })
	return out, nil
}

// materialAlerts is §26 Material: reorder point and shortage.
func (s *Improvement) materialAlerts(ctx context.Context, tenantID, raisedAt string) ([]Alert, error) {
	var out []Alert
	inventory, err := s.material.Inventory(ctx, tenantID, material.InventoryFilter{})
	if err != nil {
		return nil, err
	}
	for _, stock := range inventory {
		if stock.ReorderPoint == nil || stock.AvailableQuantity > *stock.ReorderPoint {
			continue
		}
		// Out of stock is critical; at or below the reorder point is a
		// warning, because the reorder point exists precisely to warn before zero.
		severity := "WARNING"
		if stock.AvailableQuantity <= 0 {
			severity = "CRITICAL"
		}
		out = append(out, Alert{ID: "alert-material-reorder-" + stock.MaterialID + "-" + stock.WarehouseID, Severity: severity, Rule: "MATERIAL_BELOW_REORDER_POINT",
			Title:         stock.MaterialSKU + " di bawah reorder point",
			Detail:        fmt.Sprintf("Tersedia %s %s terhadap reorder point %s di %s.", jsnum.Format(stock.AvailableQuantity), stock.UOM, jsnum.Format(*stock.ReorderPoint), stock.WarehouseName),
			DrillDownPath: "/material-inventory?materialId=" + stock.MaterialID, EntityType: "TENANT", EntityID: stock.MaterialID,
			ObservedValue: stock.AvailableQuantity, ThresholdValue: *stock.ReorderPoint, RaisedAt: raisedAt})
	}
	requirements, err := s.material.StoredRequirements(ctx, tenantID, material.RequirementFilter{Status: "SHORTAGE"})
	if err != nil {
		return nil, err
	}
	if len(requirements) > 20 {
		requirements = requirements[:20]
	}
	for _, r := range requirements {
		entityType := "TENANT"
		if r.SourceType == "WORK_ORDER" {
			entityType = "WORK_ORDER"
		}
		out = append(out, Alert{ID: "alert-material-shortage-" + r.SourceID + "-" + r.MaterialID, Severity: "CRITICAL", Rule: "MATERIAL_SHORTAGE",
			Title:         "Material kurang untuk " + r.SourceLabel,
			Detail:        fmt.Sprintf("%s kurang %s %s dari kebutuhan %s.", r.MaterialSKU, jsnum.Format(r.ShortageQuantity), r.UOM, jsnum.Format(r.RequiredQuantity)),
			DrillDownPath: "/material-readiness", EntityType: entityType, EntityID: r.SourceID, ObservedValue: r.AvailableQuantity, ThresholdValue: r.RequiredQuantity, RaisedAt: raisedAt})
	}
	return out, nil
}

// qualityAlerts is §26 Quality: hold, fail rate, NCR overdue.
func (s *Improvement) qualityAlerts(ctx context.Context, tenantID, raisedAt string) ([]Alert, error) {
	var out []Alert
	d, err := s.quality.QualityDashboard(ctx, tenantID, "", "")
	if err != nil {
		return nil, err
	}
	if d.OpenHolds > 0 {
		out = append(out, Alert{ID: "alert-quality-hold", Severity: "WARNING", Rule: "QUALITY_HOLD_OPEN", Title: fmt.Sprintf("%d Quality Hold menunggu keputusan", d.OpenHolds),
			Detail: fmt.Sprintf("%s unit ditahan dan belum memiliki disposition.", jsnum.Format(d.HeldQuantity)), DrillDownPath: "/quality", EntityType: "TENANT", EntityID: tenantID,
			ObservedValue: float64(d.OpenHolds), RaisedAt: raisedAt})
	}
	// 5% is the reject ceiling the v1.7 dashboards already treat as the line
	// between normal variation and something to look at.
	if d.InspectedQuantity > 0 && d.FailRate > 5 {
		severity := "WARNING"
		if d.FailRate > 10 {
			severity = "CRITICAL"
		}
		out = append(out, Alert{ID: "alert-quality-reject-rate", Severity: severity, Rule: "QUALITY_FAIL_RATE_ABOVE_THRESHOLD", Title: "Tingkat kegagalan inspeksi melewati ambang",
			Detail: fmt.Sprintf("%s%% dari %s unit yang diperiksa gagal.", jsnum.Format(d.FailRate), jsnum.Format(d.InspectedQuantity)), DrillDownPath: "/quality", EntityType: "TENANT",
			EntityID: tenantID, ObservedValue: d.FailRate, ThresholdValue: 5, RaisedAt: raisedAt})
	}
	if d.OverdueNcr > 0 {
		out = append(out, Alert{ID: "alert-quality-ncr-overdue", Severity: "CRITICAL", Rule: "NCR_OVERDUE", Title: fmt.Sprintf("%d NCR melewati jatuh tempo", d.OverdueNcr),
			Detail: "Non-conformance yang lewat jatuh tempo dan belum ditutup.", DrillDownPath: "/quality", EntityType: "TENANT", EntityID: tenantID, ObservedValue: float64(d.OverdueNcr), RaisedAt: raisedAt})
	}
	return out, nil
}

// maintenanceAlerts is §26 Maintenance: PM due or overdue, emergency open.
func (s *Improvement) maintenanceAlerts(ctx context.Context, tenantID, raisedAt string) ([]Alert, error) {
	var out []Alert
	plans, err := s.maintenance.Plans(ctx, tenantID, maintenance.PlanFilter{Status: "ACTIVE"})
	if err != nil {
		return nil, err
	}
	for _, plan := range plans {
		due := db.Deref(plan.DueStatus, "")
		if due != "DUE" && due != "OVERDUE" {
			continue
		}
		severity, rule, word, observed := "WARNING", "PM_DUE", "jatuh tempo", 0.0
		if due == "OVERDUE" {
			severity, rule, word, observed = "CRITICAL", "PM_OVERDUE", "terlambat", 1
		}
		out = append(out, Alert{ID: "alert-pm-" + plan.ID, Severity: severity, Rule: rule, Title: plan.Name + " " + word,
			Detail: fmt.Sprintf("%s: perawatan setiap %s %s.", plan.MachineName, jsnum.Format(plan.IntervalValue), plan.IntervalUnit), DrillDownPath: "/maintenance",
			EntityType: "MACHINE", EntityID: plan.MachineID, ObservedValue: observed, RaisedAt: raisedAt})
	}
	records, err := s.maintenance.Records(ctx, tenantID, maintenance.RecordFilter{Limit: 200})
	if err != nil {
		return nil, err
	}
	for _, rec := range records {
		if rec.MaintenanceType != "EMERGENCY" || rec.Status == "COMPLETED" {
			continue
		}
		out = append(out, Alert{ID: "alert-emergency-" + rec.ID, Severity: "CRITICAL", Rule: "EMERGENCY_MAINTENANCE_OPEN", Title: rec.MachineName + " dalam emergency maintenance",
			Detail: db.Deref(rec.Problem, "Perbaikan darurat sedang berjalan; mesin tidak dapat berproduksi."), DrillDownPath: "/maintenance", EntityType: "MACHINE", EntityID: rec.MachineID,
			ObservedValue: 1, RaisedAt: raisedAt})
	}
	return out, nil
}

// workforceAlerts is §26 Workforce: expired and expiring qualifications.
func (s *Improvement) workforceAlerts(ctx context.Context, tenantID, raisedAt string) ([]Alert, error) {
	var out []Alert
	qualifications, err := s.workforce.Qualifications(ctx, tenantID, workforce.QualificationFilter{})
	if err != nil {
		return nil, err
	}
	var expired []workforce.Qualification
	for _, q := range qualifications {
		if q.Status == "EXPIRED" {
			expired = append(expired, q)
		}
	}
	if len(expired) > 0 {
		names := make([]string, 0, 3)
		for i, q := range expired {
			if i == 3 {
				break
			}
			names = append(names, q.OperatorName+" ("+q.SkillCode+")")
		}
		detail := "Operator dengan kualifikasi kedaluwarsa tidak dapat ditugaskan: " + strings.Join(names, ", ")
		if len(expired) > 3 {
			detail += ", …"
		}
		out = append(out, Alert{ID: "alert-qualification-expired", Severity: "WARNING", Rule: "QUALIFICATION_EXPIRED", Title: fmt.Sprintf("%d kualifikasi operator kedaluwarsa", len(expired)),
			Detail: detail + ".", DrillDownPath: "/workforce", EntityType: "TENANT", EntityID: tenantID, ObservedValue: float64(len(expired)), RaisedAt: raisedAt})
	}
	// Expiring within thirty days is the window in which a certificate can
	// still be renewed without taking the operator off the roster.
	expiringAll, err := s.workforce.Qualifications(ctx, tenantID, workforce.QualificationFilter{ExpiringWithinDays: db.Ptr(30)})
	if err != nil {
		return nil, err
	}
	expiring := 0
	for _, q := range expiringAll {
		if q.Status == "ACTIVE" {
			expiring++
		}
	}
	if expiring > 0 {
		out = append(out, Alert{ID: "alert-qualification-expiring", Severity: "INFORMATIONAL", Rule: "QUALIFICATION_EXPIRING_SOON", Title: fmt.Sprintf("%d kualifikasi kedaluwarsa dalam 30 hari", expiring),
			Detail: "Perbarui sertifikasi sebelum operator kehilangan izin menjalankan mesin.", DrillDownPath: "/workforce", EntityType: "TENANT", EntityID: tenantID,
			ObservedValue: float64(expiring), RaisedAt: raisedAt})
	}
	return out, nil
}

// wipAlerts is §26 WIP: stuck, aging, on hold.
func (s *Improvement) wipAlerts(ctx context.Context, tenantID, raisedAt string) ([]Alert, error) {
	var out []Alert
	d, err := s.wip.WipDashboard(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	if d.StuckRecords > 0 {
		out = append(out, Alert{ID: "alert-wip-stuck", Severity: "CRITICAL", Rule: "WIP_STUCK", Title: fmt.Sprintf("%d WIP tertahan lebih dari %s jam", d.StuckRecords, jsnum.Format(d.CriticalThresholdHours)),
			Detail: "Kuantitas yang tidak bergerak biasanya menandai bottleneck pada proses tersebut.", DrillDownPath: "/wip", EntityType: "TENANT", EntityID: tenantID,
			ObservedValue: float64(d.StuckRecords), RaisedAt: raisedAt})
	}
	if d.Aging.Aging > 0 {
		out = append(out, Alert{ID: "alert-wip-aging", Severity: "WARNING", Rule: "WIP_AGING", Title: fmt.Sprintf("%d WIP melewati %s jam", d.Aging.Aging, jsnum.Format(d.AgingThresholdHours)),
			Detail: "WIP yang menua menahan kapasitas dan menunda proses berikutnya.", DrillDownPath: "/wip", EntityType: "TENANT", EntityID: tenantID, ObservedValue: float64(d.Aging.Aging), RaisedAt: raisedAt})
	}
	if d.OnHoldQuantity > 0 {
		out = append(out, Alert{ID: "alert-wip-on-hold", Severity: "WARNING", Rule: "WIP_ON_HOLD", Title: jsnum.Format(d.OnHoldQuantity) + " unit WIP ditahan",
			Detail: "WIP berstatus hold tidak dapat digunakan sampai dilepas oleh pihak yang berwenang.", DrillDownPath: "/wip", EntityType: "TENANT", EntityID: tenantID,
			ObservedValue: d.OnHoldQuantity, RaisedAt: raisedAt})
	}
	return out, nil
}
