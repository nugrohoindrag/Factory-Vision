// Package planning is Customer Orders, Demand Forecast, Capacity Plan and
// the Production Plan wizard (MES-019 … MES-042).
//
// Planning never calls production, quality or the shop floor directly: it
// writes an outbox_event row inside the transaction that changed the data,
// and whoever cares reads it. Production may ask planning what a work order
// is for (the Facade); planning never reaches into execution.
package planning

import (
	"context"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/httpx"
)

// --- Numbering (Naming Convention standard) ---------------------------------
//
//	CO-YYMMDD-NNN      Customer Order
//	PLAN-YYYYMM-NNN    Production Plan
//	FC-YYYYMM-NNN      Demand Forecast
//	CAP-YYYYMM-NNN     Capacity Plan
//
// The sequence is resolved from what is already stored, inside the same
// transaction as the insert, so two API instances cannot hand out the same
// number.

func dateOf(s string) time.Time {
	if t, err := time.Parse("2006-01-02", s); err == nil {
		return t
	}
	if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
		return t
	}
	return time.Now()
}

// CustomerOrderPrefix is CO-YYMMDD.
func CustomerOrderPrefix(orderDate string) string { return "CO-" + dateOf(orderDate).Format("060102") }

// ProductionPlanPrefix is PLAN-YYYYMM.
func ProductionPlanPrefix(periodStart string) string {
	return "PLAN-" + dateOf(periodStart).Format("200601")
}

// DemandForecastPrefix is FC-YYYYMM.
func DemandForecastPrefix(periodStart string) string {
	return "FC-" + dateOf(periodStart).Format("200601")
}

// CapacityPlanPrefix is CAP-YYYYMM.
func CapacityPlanPrefix(periodStart string) string {
	return "CAP-" + dateOf(periodStart).Format("200601")
}

// NextNumber is the next free PREFIX-NNN for a tenant; table and column are
// compile-time literals, never request input. The suffix is compared as an
// integer so -010 sorts after -009.
func NextNumber(ctx context.Context, tx pgx.Tx, tenantID, table, column, prefix string, width int) (string, error) {
	if width <= 0 {
		width = 3
	}
	var max *int
	err := tx.QueryRow(ctx, fmt.Sprintf(`SELECT MAX(NULLIF(regexp_replace(%s, '^.*-', ''), '')::int) FROM %s
		WHERE tenant_id = $1 AND %s LIKE $2 AND %s ~ ('^' || $3 || '-[0-9]+$')`, column, table, column, column),
		tenantID, prefix+"-%", regexp.QuoteMeta(prefix)).Scan(&max)
	if err != nil {
		return "", err
	}
	next := 1
	if max != nil {
		next = *max + 1
	}
	return fmt.Sprintf("%s-%0*d", prefix, width, next), nil
}

// --- Customer Order status derivation (MES-026) -----------------------------
//
//	Received ──► Planned ──► In Production ──► Produced ──► (manual) Ready to Ship / Shipped / Completed
//
// The first four are derived from production facts, never typed; the last
// three stay manual because the MVP does not execute shipping.

// DerivationFacts are what the status rule is judged against.
type DerivationFacts struct {
	LineCount              int `json:"lineCount"`
	FullyPlannedLines      int `json:"fullyPlannedLines"`
	FullyProducedLines     int `json:"fullyProducedLines"`
	WorkOrdersInProduction int `json:"workOrdersInProduction"`
	WorkOrderCount         int `json:"workOrderCount"`
}

var derivedOrder = []string{"RECEIVED", "PLANNED", "IN_PRODUCTION", "PRODUCED"}

// ManualLogisticsStatuses are the statuses a human sets.
var ManualLogisticsStatuses = []string{"READY_TO_SHIP", "SHIPPED", "COMPLETED"}

func indexOf(list []string, s string) int {
	for i, x := range list {
		if x == s {
			return i
		}
	}
	return -1
}

// DeriveCustomerOrderStatus is monotonic: derivation moves an order forward,
// never back, so a rescheduled work order cannot make the status flicker on
// the screen a sales person reads to answer the customer.
func DeriveCustomerOrderStatus(current string, f DerivationFacts) string {
	if current == "CANCELLED" || indexOf(ManualLogisticsStatuses, current) >= 0 {
		return current
	}
	allPlanned := f.LineCount > 0 && f.FullyPlannedLines >= f.LineCount
	allProduced := f.LineCount > 0 && f.FullyProducedLines >= f.LineCount
	candidate := "RECEIVED"
	if allPlanned {
		candidate = "PLANNED"
	}
	if f.WorkOrdersInProduction > 0 {
		candidate = "IN_PRODUCTION"
	}
	if allProduced {
		candidate = "PRODUCED"
	}
	if indexOf(derivedOrder, candidate) > indexOf(derivedOrder, current) {
		return candidate
	}
	return current
}

// AssertCancellable is the cancellation guard (MES-026-3).
func AssertCancellable(current string, f DerivationFacts) error {
	if current == "CANCELLED" {
		return httpx.InvalidState("Customer Order sudah dibatalkan.")
	}
	if current == "COMPLETED" || current == "SHIPPED" {
		return httpx.InvalidState(fmt.Sprintf("Customer Order berstatus %s tidak dapat dibatalkan.", current))
	}
	if f.WorkOrdersInProduction > 0 {
		return httpx.InvalidState(fmt.Sprintf("Customer Order tidak dapat dibatalkan: %d Work Order yang melayaninya sudah masuk produksi. Batalkan Work Order tersebut lebih dahulu.", f.WorkOrdersInProduction))
	}
	return nil
}

// --- Planning events (MES-019-2, MES-020-2) ---------------------------------

const (
	EventCustomerOrderReceived      = "CustomerOrderReceived"
	EventCustomerOrderCancelled     = "CustomerOrderCancelled"
	EventCustomerOrderStatusChanged = "CustomerOrderStatusChanged"
	EventDemandForecastGenerated    = "DemandForecastGenerated"
	EventCapacityGapDetected        = "CapacityGapDetected"
	EventProductionPlanConfirmed    = "ProductionPlanConfirmed"
	EventProductionPlanCancelled    = "ProductionPlanCancelled"
	EventWorkOrdersGenerated        = "WorkOrdersGenerated"
)

// --- Production Plan wizard (MES-037, MES-038, MES-039) ---------------------
//
//	1 Demand → 2 Production Plan → 3 Work Order → 4 Scheduling → 5 Resource → 6 Confirmation
//
// A step is locked until its prerequisite exists, and going back is always
// allowed. Readiness is computed from the plan's own rows, never from a
// flag the client sends.

// WizardReadiness is the facts each step's unlock condition is judged against.
type WizardReadiness struct {
	PlanID                   string `json:"planId"`
	CurrentStep              int    `json:"currentStep"`
	DemandCount              int    `json:"demandCount"`
	LineCount                int    `json:"lineCount"`
	LinesWithPlannedQuantity int    `json:"linesWithPlannedQuantity"`
	WorkOrderCount           int    `json:"workOrderCount"`
	ScheduledWorkOrders      int    `json:"scheduledWorkOrders"`
	ResourcedWorkOrders      int    `json:"resourcedWorkOrders"`
	ConfirmedWorkOrders      int    `json:"confirmedWorkOrders"`
	CapacityUpRequiredLines  int    `json:"capacityUpRequiredLines"`
}

// StepAvailability says whether a step can be opened, and why not.
type StepAvailability struct {
	Step      int     `json:"step"`
	Label     string  `json:"label"`
	Reachable bool    `json:"reachable"`
	BlockedBy *string `json:"blockedBy,omitempty"`
}

var stepLabels = map[int]string{1: "Demand", 2: "Production Plan", 3: "Work Order", 4: "Scheduling", 5: "Resource", 6: "Confirmation"}

// StepsAvailability is whether each step can be opened.
func StepsAvailability(r WizardReadiness) []StepAvailability {
	var steps []StepAvailability
	push := func(step int, reachable bool, blockedBy string) {
		s := StepAvailability{Step: step, Label: stepLabels[step], Reachable: reachable}
		if !reachable && blockedBy != "" {
			s.BlockedBy = &blockedBy
		}
		steps = append(steps, s)
	}
	push(1, true, "")
	push(2, r.DemandCount > 0, "Pilih minimal satu demand pada Step 1 sebelum menentukan planned quantity.")
	push(3, r.LinesWithPlannedQuantity > 0, "Tentukan planned quantity minimal satu plan line pada Step 2 sebelum generate Work Order.")
	push(4, r.WorkOrderCount > 0, "Generate Work Order pada Step 3 sebelum menjadwalkan.")
	blocked5 := "Jadwalkan minimal satu Work Order pada Step 4 sebelum menetapkan resource."
	if r.WorkOrderCount == 0 {
		blocked5 = "Generate Work Order pada Step 3 sebelum menetapkan resource."
	}
	push(5, r.WorkOrderCount > 0 && r.ScheduledWorkOrders > 0, blocked5)
	resourceComplete := r.WorkOrderCount > 0 && r.ResourcedWorkOrders >= r.WorkOrderCount
	blocked6 := fmt.Sprintf("%d Work Order belum memiliki mesin dan mold.", r.WorkOrderCount-r.ResourcedWorkOrders)
	if r.WorkOrderCount == 0 {
		blocked6 = "Generate Work Order lebih dahulu."
	}
	push(6, resourceComplete, blocked6)
	return steps
}

// FurthestReachableStep is the furthest step the plan's data supports.
func FurthestReachableStep(r WizardReadiness) int {
	furthest := 1
	for _, s := range StepsAvailability(r) {
		if !s.Reachable {
			break
		}
		furthest = s.Step
	}
	return furthest
}

// AssertStepReachable refuses a jump to a step whose prerequisite is not
// met (MES-038-5); moving backwards is never refused.
func AssertStepReachable(step int, r WizardReadiness) error {
	if step < 1 || step > 6 {
		return httpx.Validation(fmt.Sprintf("Wizard step %d tidak valid; step 1–6.", step),
			httpx.FieldError{Field: "wizardStep", Code: "OUT_OF_RANGE", Message: "Wizard step harus 1 sampai 6."})
	}
	if step <= r.CurrentStep {
		return nil
	}
	for _, s := range StepsAvailability(r) {
		if s.Step == step && !s.Reachable {
			msg := fmt.Sprintf("Step %d (%s) belum dapat dibuka.", step, s.Label)
			if s.BlockedBy != nil {
				msg += " " + *s.BlockedBy
			}
			return httpx.InvalidState(strings.TrimSpace(msg))
		}
	}
	return nil
}

// --- Capacity engine (MES-031, MES-032, §45.6) ------------------------------
//
//	Total Capacity    = Σ (available machine minutes ÷ ideal cycle time) over compatible machines
//	Planning Capacity = Total Capacity × planning_utilization_pct
//	Capacity Buffer   = Total − Planning
//	Capacity Gap      = max(Demand − Total, 0)
//
// A machine with no ideal cycle time for the product is not counted, and is
// reported ("kapasitas belum terhitung"); status is computed, never typed.

// MachineCapacityInput is one candidate machine.
type MachineCapacityInput struct {
	MachineID, MachineCode, MachineName, LineID, PlantID, MachineStatus string
	IdealCycleTimeSeconds                                               *float64
	AvailableMinutes                                                    float64
	PlannedDowntimeMinutes                                              float64
}

// UncomputedMachine is a machine deliberately left out, with the reason.
type UncomputedMachine struct {
	MachineID   string `json:"machineId"`
	MachineCode string `json:"machineCode"`
	Reason      string `json:"reason"`
	Message     string `json:"message"`
}

// Contribution is one machine's share of the total (§18.3).
type Contribution struct {
	MachineID             string  `json:"machineId"`
	MachineCode           string  `json:"machineCode"`
	AvailableMinutes      float64 `json:"availableMinutes"`
	IdealCycleTimeSeconds float64 `json:"idealCycleTimeSeconds"`
	Capacity              int     `json:"capacity"`
}

// Assessment is capacity plus the verdict on a demand.
type Assessment struct {
	TotalCapacity          int                 `json:"totalCapacity"`
	PlanningCapacity       int                 `json:"planningCapacity"`
	CapacityBuffer         int                 `json:"capacityBuffer"`
	PlanningUtilizationPct float64             `json:"planningUtilizationPct"`
	AvailableMinutes       float64             `json:"availableMinutes"`
	UncomputedMachines     []UncomputedMachine `json:"uncomputedMachines"`
	Contributions          []Contribution      `json:"contributions"`
	DemandQuantity         int                 `json:"demandQuantity"`
	CapacityGap            int                 `json:"capacityGap"`
	CapacityUtilization    float64             `json:"capacityUtilization"`
	CapacityStatus         string              `json:"capacityStatus"`
}

// AssessCapacity computes the total from the machines that can actually
// make the product and judges the demand against it.
func AssessCapacity(machines []MachineCapacityInput, utilizationPct float64, demand int) Assessment {
	a := Assessment{PlanningUtilizationPct: utilizationPct, UncomputedMachines: []UncomputedMachine{}, Contributions: []Contribution{}, DemandQuantity: demand}
	for _, m := range machines {
		if m.MachineStatus != "ACTIVE" {
			a.UncomputedMachines = append(a.UncomputedMachines, UncomputedMachine{m.MachineID, m.MachineCode, "MACHINE_INACTIVE",
				fmt.Sprintf("Mesin %s berstatus %s dan tidak dihitung dalam kapasitas.", m.MachineCode, m.MachineStatus)})
			continue
		}
		if m.IdealCycleTimeSeconds == nil || *m.IdealCycleTimeSeconds <= 0 {
			a.UncomputedMachines = append(a.UncomputedMachines, UncomputedMachine{m.MachineID, m.MachineCode, "NO_IDEAL_CYCLE_TIME",
				fmt.Sprintf("Mesin %s belum memiliki ideal cycle time untuk product ini, sehingga kapasitasnya belum terhitung — bukan berarti kapasitasnya nol.", m.MachineCode)})
			continue
		}
		effective := math.Max(m.AvailableMinutes-m.PlannedDowntimeMinutes, 0)
		capacity := int(math.Floor(effective * 60 / *m.IdealCycleTimeSeconds))
		a.AvailableMinutes += effective
		a.TotalCapacity += capacity
		a.Contributions = append(a.Contributions, Contribution{m.MachineID, m.MachineCode, effective, *m.IdealCycleTimeSeconds, capacity})
	}
	a.PlanningCapacity = int(math.Floor(float64(a.TotalCapacity) * utilizationPct / 100))
	// Derived by subtraction so buffer and planning capacity add back up to
	// the total despite the flooring.
	a.CapacityBuffer = a.TotalCapacity - a.PlanningCapacity
	a.CapacityGap = demand - a.TotalCapacity
	if a.CapacityGap < 0 {
		a.CapacityGap = 0
	}
	if a.TotalCapacity > 0 {
		// Ratio against total, not planning capacity: utilization above 80%
		// is the interesting signal.
		a.CapacityUtilization = math.Round(float64(demand)/float64(a.TotalCapacity)*10000) / 10000
	}
	a.CapacityStatus = CapacityStatusOf(demand, a.TotalCapacity, a.PlanningCapacity)
	return a
}

// CapacityStatusOf is the three statuses in §45.6's order.
func CapacityStatusOf(demand, total, planning int) string {
	switch {
	case demand <= planning:
		return "WITHIN_PLAN"
	case demand <= total:
		return "ADDITIONAL_DEMAND"
	default:
		return "CAPACITY_UP_REQUIRED"
	}
}

// ShiftMinutes is a shift's length forward from its start, so a shift that
// crosses midnight is still one shift of work.
func ShiftMinutes(startTime, endTime string, breakMinutes int) int {
	parse := func(s string) int {
		var h, m int
		fmt.Sscanf(s, "%d:%d", &h, &m)
		return h*60 + m
	}
	start, end := parse(startTime), parse(endTime)
	if end <= start {
		end += 24 * 60
	}
	if v := end - start - breakMinutes; v > 0 {
		return v
	}
	return 0
}

// DaysInPeriod counts every calendar day in [from, to]; which days a plant
// runs is a roster question the v1.0 schema does not model.
func DaysInPeriod(from, to string) int {
	if len(from) < 10 || len(to) < 10 {
		return 0
	}
	start, err1 := time.Parse("2006-01-02", from[:10])
	end, err2 := time.Parse("2006-01-02", to[:10])
	if err1 != nil || err2 != nil || end.Before(start) {
		return 0
	}
	return int(math.Floor(end.Sub(start).Hours()/24)) + 1
}

// --- Demand forecast engine (MES-027, §45.5, ADR-20) ------------------------
//
//	forecast = Σ monthly_quantity ÷ lookback_months
//
// The current month is excluded, a month with no orders counts as zero,
// cancelled orders do not count, and too little history is flagged rather
// than hidden.

// AllowedLookbacks are the lookbacks ADR-20 permits.
var AllowedLookbacks = []int{3, 6, 12}

// MonthlyDemandRow is one (product, customer, month) total.
type MonthlyDemandRow struct {
	ProductID, CustomerID, Month string
	Quantity                     float64
}

// ForecastLineResult is one computed forecast line.
type ForecastLineResult struct {
	ProductID           string
	CustomerID          *string
	HistoricalDemand    map[string]float64
	Months              []string
	AverageDemand       float64
	ForecastQuantity    int
	MonthsWithHistory   int
	InsufficientHistory bool
}

// LookbackMonths are the YYYY-MM months a lookback covers, ending with the
// last complete month before asOf.
func LookbackMonths(asOf time.Time, lookback int) []string {
	cursor := time.Date(asOf.UTC().Year(), asOf.UTC().Month(), 1, 0, 0, 0, 0, time.UTC).AddDate(0, -1, 0)
	months := make([]string, lookback)
	for i := lookback - 1; i >= 0; i-- {
		months[i] = cursor.Format("2006-01")
		cursor = cursor.AddDate(0, -1, 0)
	}
	return months
}

// CurrentMonth is the month still running, and therefore excluded.
func CurrentMonth(asOf time.Time) string { return asOf.UTC().Format("2006-01") }

// ComputeForecast turns raw monthly totals into forecast lines.
func ComputeForecast(rows []MonthlyDemandRow, lookback int, asOf time.Time, perCustomer bool) []ForecastLineResult {
	months := LookbackMonths(asOf, lookback)
	window := map[string]bool{}
	for _, m := range months {
		window[m] = true
	}
	excluded := CurrentMonth(asOf)
	type group struct {
		productID  string
		customerID *string
		byMonth    map[string]float64
	}
	groups := map[string]*group{}
	var order []string
	for _, r := range rows {
		if r.Month == excluded || !window[r.Month] {
			continue
		}
		key := r.ProductID
		if perCustomer {
			key = r.ProductID + "::" + r.CustomerID
		}
		g, ok := groups[key]
		if !ok {
			g = &group{productID: r.ProductID, byMonth: map[string]float64{}}
			if perCustomer {
				c := r.CustomerID
				g.customerID = &c
			}
			groups[key] = g
			order = append(order, key)
		}
		g.byMonth[r.Month] += r.Quantity
	}
	out := make([]ForecastLineResult, 0, len(order))
	for _, key := range order {
		g := groups[key]
		line := ForecastLineResult{ProductID: g.productID, CustomerID: g.customerID, HistoricalDemand: map[string]float64{}, Months: months}
		total := 0.0
		for _, m := range months {
			q := g.byMonth[m]
			line.HistoricalDemand[m] = q
			total += q
			if q > 0 {
				line.MonthsWithHistory++
			}
		}
		average := total / float64(lookback)
		line.AverageDemand = math.Round(average*100) / 100
		line.ForecastQuantity = int(math.Ceil(average))
		line.InsufficientHistory = line.MonthsWithHistory < lookback
		out = append(out, line)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].ProductID < out[j].ProductID })
	return out
}
