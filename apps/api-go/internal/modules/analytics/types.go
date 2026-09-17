// Package analytics is the Executive Dashboard and the reports (US-024 …
// US-031, US-038 … US-040, US-050): every figure rolls up from one grain —
// a line's aggregate for one shift date — so a KPI card, a trend point and
// a line row can never disagree with each other.
//
// The grain is derived from the shared execution snapshot, so the tables
// are scanned once per change rather than once per request; the rounding
// is JavaScript's, so the console shows the same digits as before.
package analytics

import "github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/production"

// OEEComponents is the four ratios, 4 decimals.
type OEEComponents struct {
	Availability float64 `json:"availability"`
	Performance  float64 `json:"performance"`
	Quality      float64 `json:"quality"`
	Oee          float64 `json:"oee"`
}

// LiveBoardRow is one work order on the live production board (US-026).
type LiveBoardRow struct {
	LineID            string               `json:"lineId"`
	WorkOrder         production.WorkOrder `json:"workOrder"`
	AchievementPct    float64              `json:"achievementPct"`
	HasActiveDowntime bool                 `json:"hasActiveDowntime"`
	Oee               float64              `json:"oee"`
	Availability      float64              `json:"availability"`
	Performance       float64              `json:"performance"`
	Quality           float64              `json:"quality"`
}

// DowntimeParetoItem is one bar of the downtime Pareto (US-028).
type DowntimeParetoItem struct {
	ReasonID             string  `json:"reasonId"`
	ReasonCode           string  `json:"reasonCode"`
	ReasonName           string  `json:"reasonName"`
	Category             string  `json:"category"`
	TotalDurationSeconds float64 `json:"totalDurationSeconds"`
	TotalDurationMinutes float64 `json:"totalDurationMinutes"`
	OccurrenceCount      int     `json:"occurrenceCount"`
	PercentageOfTotal    float64 `json:"percentageOfTotal"`
	CumulativePercentage float64 `json:"cumulativePercentage"`
}

// RejectParetoItem is one bar of the defect Pareto (US-029).
type RejectParetoItem struct {
	ReasonID             string  `json:"reasonId"`
	ReasonCode           string  `json:"reasonCode"`
	ReasonName           string  `json:"reasonName"`
	Category             string  `json:"category"`
	TotalRejectQuantity  float64 `json:"totalRejectQuantity"`
	OccurrenceCount      int     `json:"occurrenceCount"`
	PercentageOfTotal    float64 `json:"percentageOfTotal"`
	CumulativePercentage float64 `json:"cumulativePercentage"`
}

// DailyPerformancePoint is the daily aggregate every trend reads.
type DailyPerformancePoint struct {
	ShiftDate                string  `json:"shiftDate"`
	TargetQuantity           float64 `json:"targetQuantity"`
	GoodQuantity             float64 `json:"goodQuantity"`
	RejectQuantity           float64 `json:"rejectQuantity"`
	AchievementPct           float64 `json:"achievementPct"`
	RejectRatePct            float64 `json:"rejectRatePct"`
	PlannedMinutes           float64 `json:"plannedMinutes"`
	DowntimeMinutes          float64 `json:"downtimeMinutes"`
	PlannedDowntimeMinutes   float64 `json:"plannedDowntimeMinutes"`
	UnplannedDowntimeMinutes float64 `json:"unplannedDowntimeMinutes"`
	Availability             float64 `json:"availability"`
	Performance              float64 `json:"performance"`
	Quality                  float64 `json:"quality"`
	Oee                      float64 `json:"oee"`
}

// ExecutiveKpi is one of the eight cards (US-024).
type ExecutiveKpi struct {
	Metric            string   `json:"metric"`
	Label             string   `json:"label"`
	Value             float64  `json:"value"`
	Unit              string   `json:"unit"`
	Direction         string   `json:"direction"`
	PreviousValue     float64  `json:"previousValue"`
	DeltaVsPrevious   float64  `json:"deltaVsPrevious"`
	DeltaPct          float64  `json:"deltaPct"`
	Trend             string   `json:"trend"`
	TrendIsFavourable bool     `json:"trendIsFavourable"`
	Target            *float64 `json:"target,omitempty"`
	Variance          *float64 `json:"variance,omitempty"`
	AttainmentPct     *float64 `json:"attainmentPct,omitempty"`
	Status            *string  `json:"status,omitempty"`
}

// ProductionTrendPoint is target vs actual over time with the preceding
// window overlaid.
type ProductionTrendPoint struct {
	ShiftDate                  string   `json:"shiftDate"`
	TargetQuantity             float64  `json:"targetQuantity"`
	GoodQuantity               float64  `json:"goodQuantity"`
	AchievementPct             float64  `json:"achievementPct"`
	PreviousPeriodGoodQuantity *float64 `json:"previousPeriodGoodQuantity"`
}

// OeeTrendPoint is OEE actual vs target vs previous period.
type OeeTrendPoint struct {
	ShiftDate         string   `json:"shiftDate"`
	Oee               float64  `json:"oee"`
	Availability      float64  `json:"availability"`
	Performance       float64  `json:"performance"`
	Quality           float64  `json:"quality"`
	TargetOee         *float64 `json:"targetOee"`
	PreviousPeriodOee *float64 `json:"previousPeriodOee"`
}

// LinePerformanceRow is the per-line comparison table.
type LinePerformanceRow struct {
	LineID            string  `json:"lineId"`
	LineName          string  `json:"lineName"`
	PlantID           string  `json:"plantId"`
	PlantName         string  `json:"plantName"`
	Oee               float64 `json:"oee"`
	Availability      float64 `json:"availability"`
	Performance       float64 `json:"performance"`
	Quality           float64 `json:"quality"`
	GoodQuantity      float64 `json:"goodQuantity"`
	TargetQuantity    float64 `json:"targetQuantity"`
	AchievementPct    float64 `json:"achievementPct"`
	DowntimeMinutes   float64 `json:"downtimeMinutes"`
	RejectQuantity    float64 `json:"rejectQuantity"`
	RejectRatePct     float64 `json:"rejectRatePct"`
	HasActiveDowntime bool    `json:"hasActiveDowntime"`
	Status            string  `json:"status"`
}

// PlantPerformanceRow is the plant roll-up of the line table.
type PlantPerformanceRow struct {
	PlantID         string  `json:"plantId"`
	PlantName       string  `json:"plantName"`
	LineCount       int     `json:"lineCount"`
	Oee             float64 `json:"oee"`
	GoodQuantity    float64 `json:"goodQuantity"`
	TargetQuantity  float64 `json:"targetQuantity"`
	AchievementPct  float64 `json:"achievementPct"`
	DowntimeMinutes float64 `json:"downtimeMinutes"`
	RejectQuantity  float64 `json:"rejectQuantity"`
	RejectRatePct   float64 `json:"rejectRatePct"`
	Status          string  `json:"status"`
}

// ProcessPerformanceRow is the multi-process breakdown.
type ProcessPerformanceRow struct {
	ProcessID       string  `json:"processId"`
	ProcessCode     string  `json:"processCode"`
	ProcessName     string  `json:"processName"`
	SequenceDefault int     `json:"sequenceDefault"`
	Oee             float64 `json:"oee"`
	Availability    float64 `json:"availability"`
	Performance     float64 `json:"performance"`
	Quality         float64 `json:"quality"`
	GoodQuantity    float64 `json:"goodQuantity"`
	RejectQuantity  float64 `json:"rejectQuantity"`
	TargetQuantity  float64 `json:"targetQuantity"`
	AchievementPct  float64 `json:"achievementPct"`
	DowntimeMinutes float64 `json:"downtimeMinutes"`
	Status          string  `json:"status"`
}

// DowntimeByLine is one line's share of the loss overview.
type DowntimeByLine struct {
	LineID          string  `json:"lineId"`
	LineName        string  `json:"lineName"`
	DowntimeMinutes float64 `json:"downtimeMinutes"`
	OccurrenceCount int     `json:"occurrenceCount"`
}

// DowntimeByMachine is one machine's share of the loss overview.
type DowntimeByMachine struct {
	MachineID       string  `json:"machineId"`
	MachineName     string  `json:"machineName"`
	DowntimeMinutes float64 `json:"downtimeMinutes"`
	OccurrenceCount int     `json:"occurrenceCount"`
}

// DowntimeSummary is the loss overview above the Pareto.
type DowntimeSummary struct {
	TotalDowntimeMinutes     float64              `json:"totalDowntimeMinutes"`
	PlannedDowntimeMinutes   float64              `json:"plannedDowntimeMinutes"`
	UnplannedDowntimeMinutes float64              `json:"unplannedDowntimeMinutes"`
	PlannedProductionMinutes float64              `json:"plannedProductionMinutes"`
	DowntimeRatePct          float64              `json:"downtimeRatePct"`
	OccurrenceCount          int                  `json:"occurrenceCount"`
	AverageDurationMinutes   float64              `json:"averageDurationMinutes"`
	Pareto                   []DowntimeParetoItem `json:"pareto"`
	ByLine                   []DowntimeByLine     `json:"byLine"`
	TopMachines              []DowntimeByMachine  `json:"topMachines"`
}

// QualityByLine is one line's reject share.
type QualityByLine struct {
	LineID         string  `json:"lineId"`
	LineName       string  `json:"lineName"`
	RejectQuantity float64 `json:"rejectQuantity"`
	RejectRatePct  float64 `json:"rejectRatePct"`
}

// QualitySummary is the quality overview above the defect Pareto.
type QualitySummary struct {
	GoodQuantity       float64            `json:"goodQuantity"`
	RejectQuantity     float64            `json:"rejectQuantity"`
	TotalQuantity      float64            `json:"totalQuantity"`
	RejectRatePct      float64            `json:"rejectRatePct"`
	QualityPct         float64            `json:"qualityPct"`
	QualityTargetPct   *float64           `json:"qualityTargetPct"`
	QualityVariancePct *float64           `json:"qualityVariancePct"`
	Pareto             []RejectParetoItem `json:"pareto"`
	ByLine             []QualityByLine    `json:"byLine"`
}

// AttentionOrder is a production order that needs a look (US-030).
type AttentionOrder struct {
	ID             string  `json:"id"`
	OrderNumber    string  `json:"orderNumber"`
	DueDate        string  `json:"dueDate"`
	Status         string  `json:"status"`
	AchievementPct float64 `json:"achievementPct"`
	DaysToDue      int     `json:"daysToDue"`
	Classification string  `json:"classification"`
}

// OrderStatusSummary is schedule health.
type OrderStatusSummary struct {
	Planned         int              `json:"planned"`
	Running         int              `json:"running"`
	Completed       int              `json:"completed"`
	AtRisk          int              `json:"atRisk"`
	Delayed         int              `json:"delayed"`
	Overdue         int              `json:"overdue"`
	Total           int              `json:"total"`
	AttentionOrders []AttentionOrder `json:"attentionOrders"`
}

// OperationalAlert is one entry of the exception feed (US-031), field for
// field the TypeScript OperationalAlert.
type OperationalAlert struct {
	ID             string  `json:"id"`
	Severity       string  `json:"severity"` // CRITICAL | WARNING | INFORMATIONAL
	Rule           string  `json:"rule"`
	Title          string  `json:"title"`
	Detail         string  `json:"detail"`
	DrillDownPath  string  `json:"drillDownPath"`
	EntityType     string  `json:"entityType"`
	EntityID       string  `json:"entityId"`
	ObservedValue  float64 `json:"observedValue"`
	ThresholdValue float64 `json:"thresholdValue"`
	RaisedAt       string  `json:"raisedAt"`
}

// ProductionReportRow is one line of the production report (US-038).
type ProductionReportRow struct {
	WorkOrderID    string  `json:"workOrderId"`
	WoNumber       string  `json:"woNumber"`
	ProductSKU     string  `json:"productSku"`
	ProductName    string  `json:"productName"`
	LineID         string  `json:"lineId"`
	LineName       string  `json:"lineName"`
	TargetQuantity int     `json:"targetQuantity"`
	GoodQuantity   int     `json:"goodQuantity"`
	RejectQuantity int     `json:"rejectQuantity"`
	AchievementPct float64 `json:"achievementPct"`
	Variance       int     `json:"variance"`
	Status         string  `json:"status"`
	PlannedStart   string  `json:"plannedStart"`
	ActualStart    string  `json:"actualStart"`
	ActualEnd      string  `json:"actualEnd"`
}

// DowntimeReportRow is one line of the downtime report (US-039).
type DowntimeReportRow struct {
	ID              string  `json:"id"`
	ShiftDate       string  `json:"shiftDate"`
	ShiftID         string  `json:"shiftId"`
	LineID          string  `json:"lineId"`
	LineName        string  `json:"lineName"`
	MachineID       string  `json:"machineId"`
	MachineName     string  `json:"machineName"`
	ReasonCategory  string  `json:"reasonCategory"`
	ReasonName      string  `json:"reasonName"`
	IsPlanned       string  `json:"isPlanned"`
	StartTime       string  `json:"startTime"`
	EndTime         string  `json:"endTime"`
	DurationMinutes float64 `json:"durationMinutes"`
	Status          string  `json:"status"`
	Notes           string  `json:"notes"`
}

// ShiftReportRow is one line of the shift report (US-040).
type ShiftReportRow struct {
	LineID                string  `json:"lineId"`
	LineName              string  `json:"lineName"`
	ShiftID               string  `json:"shiftId"`
	ShiftName             string  `json:"shiftName"`
	ShiftDate             string  `json:"shiftDate"`
	TotalTarget           int     `json:"totalTarget"`
	TotalGood             int     `json:"totalGood"`
	TotalReject           int     `json:"totalReject"`
	TotalDowntimeMinutes  float64 `json:"totalDowntimeMinutes"`
	AchievementPct        float64 `json:"achievementPct"`
	ActiveWorkOrdersCount int     `json:"activeWorkOrdersCount"`
	Notes                 string  `json:"notes"`
}
