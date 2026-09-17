// Package masterdata is the manufacturing reference data: the plant
// hierarchy, products and their routings, reason codes, shifts, operators,
// application users, terminals and KPI targets.
//
// The Node API served these from arrays hydrated at boot and persisted most
// writes behind the request. Here PostgreSQL is the record and a per-tenant
// cache in front of it is the projection: written through on every change,
// expired on a timer, and loaded once per miss no matter how many requests
// arrive together.
package masterdata

// Plant is a factory site.
type Plant struct {
	ID       string `json:"id"`
	TenantID string `json:"tenantId"`
	Name     string `json:"name"`
	Location string `json:"location"`
	Timezone string `json:"timezone"`
	Status   string `json:"status"` // ACTIVE | INACTIVE
}

// Line is a production line inside a plant.
type Line struct {
	ID                           string `json:"id"`
	TenantID                     string `json:"tenantId"`
	PlantID                      string `json:"plantId"`
	Code                         string `json:"code"`
	Name                         string `json:"name"`
	Status                       string `json:"status"`
	PlannedProductionTimeMinutes int    `json:"plannedProductionTimeMinutes"`
}

// WorkCenter groups machines on a line (US-007).
type WorkCenter struct {
	ID               string `json:"id"`
	TenantID         string `json:"tenantId"`
	ProductionLineID string `json:"productionLineId"`
	Code             string `json:"code"`
	Name             string `json:"name"`
	Sequence         int    `json:"sequence"`
}

// Machine is one piece of equipment in a work centre.
type Machine struct {
	ID                    string  `json:"id"`
	TenantID              string  `json:"tenantId"`
	WorkCenterID          string  `json:"workCenterId"`
	Code                  string  `json:"code"`
	Name                  string  `json:"name"`
	Status                string  `json:"status"`
	IdealCycleTimeSeconds float64 `json:"idealCycleTimeSeconds"`
	CurrentState          string  `json:"currentState"`
	CurrentStateSince     string  `json:"currentStateSince"`
}

// Process is a production process step.
type Process struct {
	ID              string  `json:"id"`
	TenantID        string  `json:"tenantId"`
	Code            string  `json:"code"`
	Name            string  `json:"name"`
	Description     *string `json:"description,omitempty"`
	SequenceDefault int     `json:"sequenceDefault"`
	Status          string  `json:"status"`
	CreatedAt       *string `json:"createdAt,omitempty"`
	UpdatedAt       *string `json:"updatedAt,omitempty"`
}

// Product is a sellable or consumable item.
type Product struct {
	ID                    string  `json:"id"`
	TenantID              string  `json:"tenantId"`
	SKU                   string  `json:"sku"`
	Name                  string  `json:"name"`
	Unit                  string  `json:"unit"`
	IdealCycleTimeSeconds float64 `json:"idealCycleTimeSeconds"`
	Status                string  `json:"status"`
}

// MachineRate is the ideal cycle time for a Product x Machine pair (US-049).
type MachineRate struct {
	ID                    string  `json:"id"`
	TenantID              string  `json:"tenantId"`
	ProductID             string  `json:"productId"`
	MachineID             string  `json:"machineId"`
	IdealCycleTimeSeconds float64 `json:"idealCycleTimeSeconds"`
}

// Routing is one step of a product's process chain.
type Routing struct {
	ID                       string   `json:"id"`
	TenantID                 string   `json:"tenantId"`
	ProductID                string   `json:"productId"`
	ProcessID                string   `json:"processId"`
	Sequence                 int      `json:"sequence"`
	WorkCenterID             *string  `json:"workCenterId,omitempty"`
	MachineID                *string  `json:"machineId,omitempty"`
	StandardCycleTimeSeconds *float64 `json:"standardCycleTimeSeconds,omitempty"`
	Active                   bool     `json:"active"`
}

// BomItem is one component line of a bill of material.
type BomItem struct {
	ID                string   `json:"id"`
	BomID             string   `json:"bomId"`
	LineNumber        int      `json:"lineNumber"`
	ComponentPartID   string   `json:"componentPartId"`
	ComponentPartSKU  string   `json:"componentPartSku"`
	ComponentPartName string   `json:"componentPartName"`
	ComponentType     string   `json:"componentType"`
	Quantity          float64  `json:"quantity"`
	UOM               string   `json:"uom"`
	ScrapPercentage   *float64 `json:"scrapPercentage,omitempty"`
	Sequence          *int     `json:"sequence,omitempty"`
	Reference         *string  `json:"reference,omitempty"`
	Notes             *string  `json:"notes,omitempty"`
	CreatedAt         *string  `json:"createdAt,omitempty"`
	UpdatedAt         *string  `json:"updatedAt,omitempty"`
}

// Bom is a bill of material (migration 022).
type Bom struct {
	ID              string    `json:"id"`
	TenantID        string    `json:"tenantId"`
	BomNumber       string    `json:"bomNumber"`
	ProductID       string    `json:"productId"`
	ProductSKU      string    `json:"productSku"`
	ProductName     string    `json:"productName"`
	ProductRevision *string   `json:"productRevision,omitempty"`
	BomName         string    `json:"bomName"`
	Version         string    `json:"version"`
	Status          string    `json:"status"` // DRAFT | ACTIVE | INACTIVE
	EffectiveDate   string    `json:"effectiveDate"`
	EndDate         *string   `json:"endDate,omitempty"`
	Description     *string   `json:"description,omitempty"`
	Components      []BomItem `json:"components"`
	CreatedBy       *string   `json:"createdBy,omitempty"`
	CreatedAt       string    `json:"createdAt"`
	UpdatedBy       *string   `json:"updatedBy,omitempty"`
	UpdatedAt       string    `json:"updatedAt"`
}

// Operator is a shop-floor worker who signs in with a PIN.
type Operator struct {
	ID             string  `json:"id"`
	TenantID       string  `json:"tenantId"`
	EmployeeNumber string  `json:"employeeNumber"`
	Name           string  `json:"name"`
	PinHash        *string `json:"pinHash,omitempty"`
	DefaultLineID  *string `json:"defaultLineId,omitempty"`
	Status         string  `json:"status"`
}

// Shift is a working period (US-021).
type Shift struct {
	ID              string `json:"id"`
	TenantID        string `json:"tenantId"`
	PlantID         string `json:"plantId"`
	Name            string `json:"name"`
	StartTime       string `json:"startTime"` // HH:mm
	EndTime         string `json:"endTime"`
	BreakMinutes    int    `json:"breakMinutes"`
	CrossesMidnight bool   `json:"crossesMidnight"`
	Active          bool   `json:"active"`
}

// DowntimeReason is a configured downtime code.
type DowntimeReason struct {
	ID          string  `json:"id"`
	TenantID    string  `json:"tenantId"`
	ParentID    *string `json:"parentId,omitempty"`
	Category    string  `json:"category"`
	Code        string  `json:"code"`
	Name        string  `json:"name"`
	Description *string `json:"description,omitempty"`
	IsPlanned   bool    `json:"isPlanned"`
	Active      bool    `json:"active"`
	SortOrder   int     `json:"sortOrder"`
}

// RejectReason is a configured reject/defect code.
type RejectReason struct {
	ID          string  `json:"id"`
	TenantID    string  `json:"tenantId"`
	ParentID    *string `json:"parentId,omitempty"`
	Category    string  `json:"category"`
	Code        string  `json:"code"`
	Name        string  `json:"name"`
	Description *string `json:"description,omitempty"`
	Active      bool    `json:"active"`
	SortOrder   int     `json:"sortOrder"`
}

// User is an application account. The password hash never travels: the
// record is what the console reads freely.
type User struct {
	ID             string  `json:"id"`
	TenantID       string  `json:"tenantId"`
	Email          string  `json:"email"`
	Name           string  `json:"name"`
	Role           string  `json:"role"`
	AccountType    string  `json:"accountType"` // APPLICATION_USER | OPERATOR
	ScopeLevel     string  `json:"scopeLevel"`  // TENANT | PLANT | LINE | WORK_CENTER
	ScopeID        *string `json:"scopeId,omitempty"`
	EmployeeNumber *string `json:"employeeNumber,omitempty"`
	Status         string  `json:"status"` // ACTIVE | INACTIVE | SUSPENDED | INVITED
	LastLoginAt    *string `json:"lastLoginAt,omitempty"`
	CreatedAt      string  `json:"createdAt"`
}

// StoredUser pairs a user with the credential kept beside it.
type StoredUser struct {
	User         User
	PasswordHash *string
}

// Device is a shop-floor terminal.
type Device struct {
	ID                   string  `json:"id"`
	TenantID             string  `json:"tenantId"`
	DeviceCode           string  `json:"deviceCode"`
	Name                 string  `json:"name"`
	AssignedLineID       *string `json:"assignedLineId,omitempty"`
	AssignedWorkCenterID *string `json:"assignedWorkCenterId,omitempty"`
	Status               string  `json:"status"` // ONLINE | OFFLINE
	IPAddress            *string `json:"ipAddress,omitempty"`
	LastHeartbeatAt      *string `json:"lastHeartbeatAt,omitempty"`
	RegisteredAt         string  `json:"registeredAt"`
}

// KpiTarget is a configured target for one KPI metric.
type KpiTarget struct {
	ID                   string  `json:"id"`
	TenantID             string  `json:"tenantId"`
	Metric               string  `json:"metric"`
	TargetValue          float64 `json:"targetValue"`
	Unit                 string  `json:"unit"`
	Direction            string  `json:"direction"` // HIGHER_IS_BETTER | LOWER_IS_BETTER
	WatchThresholdPct    float64 `json:"watchThresholdPct"`
	CriticalThresholdPct float64 `json:"criticalThresholdPct"`
}

// Reference is everything the analytics and shop-floor modules read
// together, loaded in one cache entry per tenant.
type Reference struct {
	Plants          []Plant
	Lines           []Line
	WorkCenters     []WorkCenter
	Machines        []Machine
	Products        []Product
	Processes       []Process
	Routings        []Routing
	Rates           []MachineRate
	DowntimeReasons []DowntimeReason
	RejectReasons   []RejectReason
}
