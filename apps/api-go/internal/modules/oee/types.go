// Package oee is OEE calculation, drill-down and the pilot validation log
// (US-027, US-032–US-037, US-041, US-025).
//
// The tenant's operational definitions live in oee_config, so a factory
// can move from "planned downtime counts against Availability" to the
// opposite without anyone editing a formula; the version bump then makes
// every figure traceable to the definition that produced it. The Node API
// kept the configuration and the validation log in memory.
package oee

// Config is the TypeScript OeeCalculationConfig.
type Config struct {
	TenantID                   string `json:"tenantId"`
	CalcVersion                int    `json:"calcVersion"`
	PptExcludesPlannedDowntime bool   `json:"pptExcludesPlannedDowntime"`
	IdealCycleSource           string `json:"idealCycleSource"` // PRODUCT_MACHINE | ROUTING | PRODUCT
	AllowIdealCycleFallback    bool   `json:"allowIdealCycleFallback"`
	UpdatedAt                  string `json:"updatedAt"`
	UpdatedBy                  string `json:"updatedBy"`
}

// ConfigPatch is what PUT /oee/config may change.
type ConfigPatch struct {
	PptExcludesPlannedDowntime *bool
	IdealCycleSource           *string
	AllowIdealCycleFallback    *bool
}

// CalculationInput is one OEE computation's inputs.
type CalculationInput struct {
	PlannedProductionSeconds float64
	PlannedDowntimeSeconds   float64
	UnplannedDowntimeSeconds float64
	GoodCount                float64
	RejectCount              float64
	IdealCycleSeconds        *float64
}

// CalculationInputs is the inputs echoed back with a result.
type CalculationInputs struct {
	PlannedProductionSeconds float64  `json:"plannedProductionSeconds"`
	PlannedDowntimeSeconds   float64  `json:"plannedDowntimeSeconds"`
	UnplannedDowntimeSeconds float64  `json:"unplannedDowntimeSeconds"`
	RunTimeSeconds           float64  `json:"runTimeSeconds"`
	IdealCycleSeconds        *float64 `json:"idealCycleSeconds"`
	GoodCount                float64  `json:"goodCount"`
	RejectCount              float64  `json:"rejectCount"`
	TotalCount               float64  `json:"totalCount"`
}

// CalculationResult is one reproducible OEE computation with its inputs.
type CalculationResult struct {
	Availability               float64           `json:"availability"`
	Performance                float64           `json:"performance"`
	Quality                    float64           `json:"quality"`
	Oee                        float64           `json:"oee"`
	Inputs                     CalculationInputs `json:"inputs"`
	CalcVersion                int               `json:"calcVersion"`
	PptExcludesPlannedDowntime bool              `json:"pptExcludesPlannedDowntime"`
	IdealCycleMissing          bool              `json:"idealCycleMissing"`
	ComputedAt                 string            `json:"computedAt"`
}

// Filter is shared by every drill-down, report and bottleneck query.
type Filter struct {
	Days           *int
	From           string
	To             string
	PlantID        string
	LineID         string
	ProcessID      string
	MachineID      string
	ShiftID        string
	ProductID      string
	AllowedLineIDs []string // nil means tenant-wide
}

// MachineDayRow is the machine × shift × day grain every OEE surface rolls
// up from, which is why no two screens can quote different numbers for the
// same window.
type MachineDayRow struct {
	ShiftDate                string
	ShiftID                  string
	MachineID                string
	LineID                   string
	ProcessID                *string
	ProductID                *string
	PlannedSeconds           float64
	PlannedDowntimeSeconds   float64
	UnplannedDowntimeSeconds float64
	GoodQuantity             float64
	RejectQuantity           float64
	TargetQuantity           float64
	IdealCycleSeconds        *float64
}

// MachinePerformanceRow is the leaf of the Process → Machine drill-down.
type MachinePerformanceRow struct {
	MachineID         string   `json:"machineId"`
	MachineCode       string   `json:"machineCode"`
	MachineName       string   `json:"machineName"`
	WorkCenterID      string   `json:"workCenterId"`
	WorkCenterName    string   `json:"workCenterName"`
	ProcessID         *string  `json:"processId"`
	ProcessName       *string  `json:"processName"`
	LineID            string   `json:"lineId"`
	LineName          string   `json:"lineName"`
	Oee               float64  `json:"oee"`
	Availability      float64  `json:"availability"`
	Performance       float64  `json:"performance"`
	Quality           float64  `json:"quality"`
	GoodQuantity      float64  `json:"goodQuantity"`
	RejectQuantity    float64  `json:"rejectQuantity"`
	TargetQuantity    float64  `json:"targetQuantity"`
	AchievementPct    float64  `json:"achievementPct"`
	PlannedMinutes    int      `json:"plannedMinutes"`
	RunMinutes        int      `json:"runMinutes"`
	DowntimeMinutes   int      `json:"downtimeMinutes"`
	IdealCycleSeconds *float64 `json:"idealCycleSeconds"`
	IdealCycleMissing bool     `json:"idealCycleMissing"`
	Status            string   `json:"status"`
}

// BottleneckRow is one rank in the bottleneck ladder (US-037).
type BottleneckRow struct {
	Kind            string  `json:"kind"`
	Rank            int     `json:"rank"`
	EntityID        string  `json:"entityId"`
	EntityName      string  `json:"entityName"`
	ContextLabel    string  `json:"contextLabel"`
	Oee             float64 `json:"oee"`
	Availability    float64 `json:"availability"`
	Performance     float64 `json:"performance"`
	Quality         float64 `json:"quality"`
	LostUnits       float64 `json:"lostUnits"`
	LostUnitsPct    float64 `json:"lostUnitsPct"`
	DowntimeMinutes int     `json:"downtimeMinutes"`
	RejectQuantity  float64 `json:"rejectQuantity"`
	DominantLoss    string  `json:"dominantLoss"`
	DominantLossPct float64 `json:"dominantLossPct"`
	DrillDownPath   string  `json:"drillDownPath"`
}

// ReportItem is one row of the OEE report (US-041).
type ReportItem struct {
	ShiftDate         string  `json:"shiftDate"`
	ShiftID           string  `json:"shiftId"`
	ShiftName         string  `json:"shiftName"`
	LineID            string  `json:"lineId"`
	LineName          string  `json:"lineName"`
	MachineID         string  `json:"machineId"`
	MachineName       string  `json:"machineName"`
	ProcessID         *string `json:"processId"`
	ProcessName       *string `json:"processName"`
	ProductID         *string `json:"productId"`
	ProductName       *string `json:"productName"`
	Availability      float64 `json:"availability"`
	Performance       float64 `json:"performance"`
	Quality           float64 `json:"quality"`
	Oee               float64 `json:"oee"`
	PlannedMinutes    int     `json:"plannedMinutes"`
	RunMinutes        int     `json:"runMinutes"`
	DowntimeMinutes   int     `json:"downtimeMinutes"`
	GoodQuantity      float64 `json:"goodQuantity"`
	RejectQuantity    float64 `json:"rejectQuantity"`
	TotalQuantity     float64 `json:"totalQuantity"`
	IdealCycleMissing bool    `json:"idealCycleMissing"`
	CalcVersion       int     `json:"calcVersion"`
}

// TargetVsActualRow is one group of the Target vs Actual view (US-025).
type TargetVsActualRow struct {
	Dimension              string   `json:"dimension"`
	Key                    string   `json:"key"`
	Label                  string   `json:"label"`
	TargetQuantity         float64  `json:"targetQuantity"`
	ActualQuantity         float64  `json:"actualQuantity"`
	RejectQuantity         float64  `json:"rejectQuantity"`
	Variance               float64  `json:"variance"`
	AchievementPct         float64  `json:"achievementPct"`
	Status                 string   `json:"status"`
	ForecastQuantity       *float64 `json:"forecastQuantity"`
	ForecastAchievementPct *float64 `json:"forecastAchievementPct"`
}

// TargetVsActualSummary is the Target vs Actual view.
type TargetVsActualSummary struct {
	Dimension      string              `json:"dimension"`
	TotalTarget    float64             `json:"totalTarget"`
	TotalActual    float64             `json:"totalActual"`
	TotalVariance  float64             `json:"totalVariance"`
	AchievementPct float64             `json:"achievementPct"`
	Status         string              `json:"status"`
	Rows           []TargetVsActualRow `json:"rows"`
}

// ValidationEntry is one of the six pilot validation items V1–V6.
type ValidationEntry struct {
	ID                     string   `json:"id"`
	TenantID               string   `json:"tenantId"`
	Item                   string   `json:"item"`
	Title                  string   `json:"title"`
	ScopeLabel             string   `json:"scopeLabel"`
	ShiftDate              string   `json:"shiftDate"`
	MesValue               *float64 `json:"mesValue"`
	FactoryValue           *float64 `json:"factoryValue"`
	Gap                    *float64 `json:"gap"`
	GapClass               string   `json:"gapClass"`
	Status                 string   `json:"status"`
	Resolution             string   `json:"resolution"`
	ResolvedByConfigChange bool     `json:"resolvedByConfigChange"`
	CalcVersion            int      `json:"calcVersion"`
	Notes                  string   `json:"notes"`
	RecordedBy             string   `json:"recordedBy"`
	RecordedAt             string   `json:"recordedAt"`
	UpdatedAt              string   `json:"updatedAt"`
}

// ValidationPatch is what PUT /oee/validation/:item may change.
type ValidationPatch struct {
	ScopeLabel             *string
	ShiftDate              *string
	MesValue               *float64
	FactoryValue           *float64
	GapClass               *string
	Status                 *string
	Resolution             *string
	ResolvedByConfigChange *bool
	Notes                  *string
}

// GateStatus is the readiness gate: every item resolved.
type GateStatus struct {
	Passed bool     `json:"passed"`
	Open   []string `json:"open"`
}
