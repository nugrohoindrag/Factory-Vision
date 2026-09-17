package fixtures

import (
	"bytes"
	"encoding/json"
	"fmt"
)

// IndustryTemplate is one industry seed template (apps/api onboarding),
// data the Go onboarding module clones into a trial tenant.
type IndustryTemplate struct {
	Info             map[string]any `json:"info"`
	DefaultPlantName string         `json:"defaultPlantName"`
	Lines            []struct {
		Code, Name, Status           string
		PlannedProductionTimeMinutes int `json:"plannedProductionTimeMinutes"`
	} `json:"lines"`
	WorkCenters []struct {
		LineIndex  int `json:"lineIndex"`
		Code, Name string
		Sequence   int
	} `json:"workCenters"`
	Processes []struct {
		Code, Name, Status string
		SequenceDefault    int `json:"sequenceDefault"`
	} `json:"processes"`
	Machines []struct {
		WorkCenterIndex       int `json:"workCenterIndex"`
		Code, Name, Status    string
		IdealCycleTimeSeconds float64 `json:"idealCycleTimeSeconds"`
		CurrentState          string  `json:"currentState"`
		CurrentStateSince     string  `json:"currentStateSince"`
	} `json:"machines"`
	Products []struct {
		SKU                   string `json:"sku"`
		Name, Unit, Status    string
		IdealCycleTimeSeconds float64 `json:"idealCycleTimeSeconds"`
	} `json:"products"`
	Routings []struct {
		ProductIndex, ProcessIndex, WorkCenterIndex, MachineIndex, Sequence int
		StandardCycleTimeSeconds                                            float64 `json:"standardCycleTimeSeconds"`
	} `json:"routings"`
	Shifts []struct {
		Name, StartTime, EndTime string
		BreakMinutes             int `json:"breakMinutes"`
		CrossesMidnight, Active  bool
	} `json:"shifts"`
	DowntimeReasons []struct {
		Category, Code, Name string
		IsPlanned, Active    bool
		SortOrder            int `json:"sortOrder"`
	} `json:"downtimeReasons"`
	RejectReasons []struct {
		Category, Code, Name string
		Active               bool
		SortOrder            int `json:"sortOrder"`
	} `json:"rejectReasons"`
	SampleOrder struct {
		ProductIndex, Quantity, GoodQty, RejectQty int
		OrderNumberPrefix                          string `json:"orderNumberPrefix"`
	} `json:"sampleOrder"`
	Boms []struct {
		ProductIndex             int `json:"productIndex"`
		BomName, Version, Status string
		Description              *string
		Items                    []struct {
			ComponentSku, ComponentName, ComponentType, Uom string
			Quantity                                        float64
			ScrapPercentage                                 float64 `json:"scrapPercentage"`
			Sequence                                        *int
			Notes                                           *string
		} `json:"items"`
	} `json:"boms"`
}

// IndustryTemplates keeps the templates in the order the TypeScript literal
// declared them, which is the order the console lists them in.
type IndustryTemplates struct {
	Order []string
	ByKey map[string]IndustryTemplate
}

// LoadIndustryTemplates reads industry-templates.json, preserving key order.
func LoadIndustryTemplates() (IndustryTemplates, error) {
	raw, err := files.ReadFile("industry-templates.json")
	if err != nil {
		return IndustryTemplates{}, err
	}
	byKey := map[string]IndustryTemplate{}
	if err := json.Unmarshal(raw, &byKey); err != nil {
		return IndustryTemplates{}, fmt.Errorf("industry-templates.json: %w", err)
	}
	// encoding/json maps lose order; a second pass over the tokens recovers
	// the top-level keys in document order.
	dec := json.NewDecoder(bytes.NewReader(raw))
	var order []string
	if tok, err := dec.Token(); err != nil || tok != json.Delim('{') {
		return IndustryTemplates{}, fmt.Errorf("industry-templates.json: expected an object")
	}
	for dec.More() {
		tok, err := dec.Token()
		if err != nil {
			return IndustryTemplates{}, err
		}
		key, _ := tok.(string)
		order = append(order, key)
		var skip json.RawMessage
		if err := dec.Decode(&skip); err != nil {
			return IndustryTemplates{}, err
		}
	}
	return IndustryTemplates{Order: order, ByKey: byKey}, nil
}
