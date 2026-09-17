package auth

import (
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/httpx"
)

// The scope helpers used inside handlers, where the check needs the record
// itself. These are the query-side half of authorization: the middleware
// answers "may this role do this at all", and these answer "may this session
// touch this row".

// FilterLines keeps only the rows on lines the session may see. A row with
// no line is kept, as the Node API did.
func FilterLines[T any](p *Principal, rows []T, lineOf func(T) string) []T {
	if p == nil || p.Scope.Level == "TENANT" {
		return rows
	}
	allowed := make(map[string]bool, len(p.Scope.LineIDs))
	for _, id := range p.Scope.LineIDs {
		allowed[id] = true
	}
	out := make([]T, 0, len(rows))
	for _, row := range rows {
		line := lineOf(row)
		if line == "" || allowed[line] {
			out = append(out, row)
		}
	}
	return out
}

// AssertLine fails unless the line is inside the session's scope.
func AssertLine(p *Principal, lineID string) error {
	if p == nil || lineID == "" || p.Scope.Level == "TENANT" {
		return nil
	}
	for _, id := range p.Scope.LineIDs {
		if id == lineID {
			return nil
		}
	}
	return httpx.OutOfScope("Production line berada di luar cakupan akses Anda.")
}

// AssertPlant fails unless the plant is inside the session's scope.
func AssertPlant(p *Principal, plantID string) error {
	if p == nil || plantID == "" || p.Scope.Level == "TENANT" {
		return nil
	}
	for _, id := range p.Scope.PlantIDs {
		if id == plantID {
			return nil
		}
	}
	return httpx.OutOfScope("Plant berada di luar cakupan akses Anda.")
}

// AssertAssignedWorkOrder enforces rule 4: an operator may execute only
// their own work orders. Supervisors and managers execute on behalf of the
// line, so they pass.
func AssertAssignedWorkOrder(p *Principal, lineID string, operatorID string) error {
	if p == nil {
		return nil
	}
	if err := AssertLine(p, lineID); err != nil {
		return err
	}
	if p.Kind != KindOperator {
		return nil
	}
	if operatorID != "" && operatorID != p.SubjectID {
		return httpx.Forbidden("Operator hanya dapat menjalankan work order yang ditugaskan kepadanya.")
	}
	return nil
}
