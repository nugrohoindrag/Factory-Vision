package fixtures

// DemoPlant is the reference data a SEED_DEMO_DATA boot upserts before the
// shop-floor history is written: the pilot tenant, its plant, lines,
// processes and products. Exported from the Node API's in-memory demo rows,
// which its `syncReferenceData` wrote with the same upsert semantics.
//
// The history seed resolved its ideal cycle times, operator and planned
// minutes from the same in-memory rows before the reference data was
// hydrated from PostgreSQL, so the rates, routings and operators travel
// here too and the Go seed writes the same history.
type DemoPlant struct {
	Tenant       DemoTenant        `json:"tenant"`
	Plants       []DemoPlantRow    `json:"plants"`
	Lines        []DemoLine        `json:"lines"`
	Processes    []DemoProcess     `json:"processes"`
	Products     []DemoProduct     `json:"products"`
	MachineRates []DemoMachineRate `json:"machineRates"`
	Routings     []DemoRouting     `json:"routings"`
	Operators    []DemoOperator    `json:"operators"`
}

type DemoMachineRate struct {
	ProductID             string  `json:"productId"`
	MachineID             string  `json:"machineId"`
	IdealCycleTimeSeconds float64 `json:"idealCycleTimeSeconds"`
}

type DemoRouting struct {
	ProductID                string   `json:"productId"`
	MachineID                *string  `json:"machineId"`
	StandardCycleTimeSeconds *float64 `json:"standardCycleTimeSeconds"`
	Active                   bool     `json:"active"`
}

type DemoOperator struct {
	ID string `json:"id"`
}

// IdealCycleSeconds resolves a product's rate on a machine the way the Node
// seed did: the product × machine rate, else an active routing on the
// machine, else the product's own ideal cycle; nil when none is set.
func (d DemoPlant) IdealCycleSeconds(productID, machineID string) *float64 {
	if productID != "" && machineID != "" {
		for _, r := range d.MachineRates {
			if r.ProductID == productID && r.MachineID == machineID {
				v := r.IdealCycleTimeSeconds
				return &v
			}
		}
	}
	if productID != "" {
		for _, r := range d.Routings {
			if r.ProductID == productID && r.Active && (machineID == "" || (r.MachineID != nil && *r.MachineID == machineID)) {
				if r.StandardCycleTimeSeconds != nil && *r.StandardCycleTimeSeconds != 0 {
					v := *r.StandardCycleTimeSeconds
					return &v
				}
				break
			}
		}
		for _, p := range d.Products {
			if p.ID == productID && p.IdealCycleTimeSeconds != nil && *p.IdealCycleTimeSeconds != 0 {
				v := *p.IdealCycleTimeSeconds
				return &v
			}
		}
	}
	return nil
}

type DemoTenant struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Timezone string `json:"timezone"`
	Plan     string `json:"plan"`
	Status   string `json:"status"`
}

type DemoPlantRow struct {
	ID       string  `json:"id"`
	TenantID string  `json:"tenantId"`
	Name     string  `json:"name"`
	Location *string `json:"location"`
	Timezone *string `json:"timezone"`
	Status   *string `json:"status"`
}

type DemoLine struct {
	ID                           string  `json:"id"`
	TenantID                     string  `json:"tenantId"`
	PlantID                      string  `json:"plantId"`
	Code                         string  `json:"code"`
	Name                         string  `json:"name"`
	Status                       *string `json:"status"`
	PlannedProductionTimeMinutes *int    `json:"plannedProductionTimeMinutes"`
}

type DemoProcess struct {
	ID              string  `json:"id"`
	TenantID        string  `json:"tenantId"`
	Code            string  `json:"code"`
	Name            string  `json:"name"`
	Description     *string `json:"description"`
	SequenceDefault *int    `json:"sequenceDefault"`
	Status          *string `json:"status"`
}

type DemoProduct struct {
	ID                    string   `json:"id"`
	TenantID              string   `json:"tenantId"`
	SKU                   string   `json:"sku"`
	Name                  string   `json:"name"`
	Unit                  *string  `json:"unit"`
	IdealCycleTimeSeconds *float64 `json:"idealCycleTimeSeconds"`
	Status                *string  `json:"status"`
}

// LoadDemoPlant reads the demo plant fixture.
func LoadDemoPlant() DemoPlant { return load[DemoPlant]("demo-plant.json") }
