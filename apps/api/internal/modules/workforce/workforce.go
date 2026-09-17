// Package workforce is workforce and labour (Improvement PRD §23–§25):
// skills, qualification requirements per machine or process, operator
// qualifications with expiry, shift assignments, availability, the
// eligibility check an assignment consults, labour requirements against
// work orders, time records and utilisation.
package workforce

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/event"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/masterdata"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/production"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/httpx"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/jsnum"
)

// Skill is the TypeScript Skill.
type Skill struct {
	ID          string  `json:"id"`
	TenantID    string  `json:"tenantId"`
	Code        string  `json:"code"`
	Name        string  `json:"name"`
	Category    *string `json:"category,omitempty"`
	Description *string `json:"description,omitempty"`
	MaxLevel    int     `json:"maxLevel"`
	CreatedAt   string  `json:"createdAt"`
}

// Qualification is the TypeScript OperatorQualification.
type Qualification struct {
	ID                string  `json:"id"`
	TenantID          string  `json:"tenantId"`
	OperatorID        string  `json:"operatorId"`
	OperatorName      string  `json:"operatorName"`
	SkillID           string  `json:"skillId"`
	SkillCode         string  `json:"skillCode"`
	SkillName         string  `json:"skillName"`
	Level             int     `json:"level"`
	CertifiedDate     string  `json:"certifiedDate"`
	ExpiryDate        *string `json:"expiryDate,omitempty"`
	Issuer            *string `json:"issuer,omitempty"`
	CertificateNumber *string `json:"certificateNumber,omitempty"`
	Status            string  `json:"status"`
	SuspendedReason   *string `json:"suspendedReason,omitempty"`
	CreatedBy         *string `json:"createdBy,omitempty"`
	CreatedAt         string  `json:"createdAt"`
	UpdatedAt         string  `json:"updatedAt"`
}

// Requirement is the TypeScript QualificationRequirement.
type Requirement struct {
	ID           string `json:"id"`
	TenantID     string `json:"tenantId"`
	TargetType   string `json:"targetType"`
	TargetID     string `json:"targetId"`
	TargetName   string `json:"targetName"`
	SkillID      string `json:"skillId"`
	SkillCode    string `json:"skillCode"`
	SkillName    string `json:"skillName"`
	MinimumLevel int    `json:"minimumLevel"`
	Mandatory    bool   `json:"mandatory"`
	CreatedAt    string `json:"createdAt"`
}

// ShiftAssignment is the TypeScript OperatorShiftAssignment.
type ShiftAssignment struct {
	ID            string  `json:"id"`
	TenantID      string  `json:"tenantId"`
	OperatorID    string  `json:"operatorId"`
	OperatorName  string  `json:"operatorName"`
	ShiftID       string  `json:"shiftId"`
	ShiftName     string  `json:"shiftName"`
	EffectiveFrom string  `json:"effectiveFrom"`
	EffectiveTo   *string `json:"effectiveTo,omitempty"`
	IsDefault     bool    `json:"isDefault"`
	CreatedBy     *string `json:"createdBy,omitempty"`
	CreatedAt     string  `json:"createdAt"`
}

// Availability is the TypeScript OperatorAvailability.
type Availability struct {
	ID            string  `json:"id"`
	TenantID      string  `json:"tenantId"`
	OperatorID    string  `json:"operatorId"`
	OperatorName  string  `json:"operatorName"`
	State         string  `json:"state"`
	ShiftID       *string `json:"shiftId,omitempty"`
	ShiftName     *string `json:"shiftName,omitempty"`
	EffectiveFrom string  `json:"effectiveFrom"`
	EffectiveTo   *string `json:"effectiveTo,omitempty"`
	Reason        *string `json:"reason,omitempty"`
	UpdatedBy     *string `json:"updatedBy,omitempty"`
	UpdatedAt     string  `json:"updatedAt"`
}

// LaborRequirement is the TypeScript LaborRequirement.
type LaborRequirement struct {
	ID                          string  `json:"id"`
	TenantID                    string  `json:"tenantId"`
	WorkOrderID                 string  `json:"workOrderId"`
	WorkOrderNumber             string  `json:"workOrderNumber"`
	ProcessID                   *string `json:"processId,omitempty"`
	MachineID                   *string `json:"machineId,omitempty"`
	RequiredOperators           int     `json:"requiredOperators"`
	AssignedOperators           int     `json:"assignedOperators"`
	AvailableQualifiedOperators int     `json:"availableQualifiedOperators"`
	Status                      string  `json:"status"`
	ShiftID                     *string `json:"shiftId,omitempty"`
	Notes                       *string `json:"notes,omitempty"`
	UpdatedAt                   string  `json:"updatedAt"`
}

// QualificationCheck is what an assignment recorded about the operator.
type QualificationCheck struct {
	Qualified     bool     `json:"qualified"`
	MatchedSkills []string `json:"matchedSkills"`
	MissingSkills []string `json:"missingSkills"`
}

// Assignment is the TypeScript LaborAssignment.
type Assignment struct {
	ID                 string              `json:"id"`
	TenantID           string              `json:"tenantId"`
	WorkOrderID        string              `json:"workOrderId"`
	WorkOrderNumber    string              `json:"workOrderNumber"`
	OperatorID         string              `json:"operatorId"`
	OperatorName       string              `json:"operatorName"`
	Role               *string             `json:"role,omitempty"`
	ShiftID            *string             `json:"shiftId,omitempty"`
	AssignedBy         string              `json:"assignedBy"`
	AssignedAt         string              `json:"assignedAt"`
	UnassignedAt       *string             `json:"unassignedAt,omitempty"`
	Status             string              `json:"status"`
	QualificationCheck *QualificationCheck `json:"qualificationCheck,omitempty"`
}

// TimeRecord is the TypeScript LaborTimeRecord.
type TimeRecord struct {
	ID                string  `json:"id"`
	TenantID          string  `json:"tenantId"`
	OperatorID        string  `json:"operatorId"`
	OperatorName      string  `json:"operatorName"`
	WorkOrderID       *string `json:"workOrderId,omitempty"`
	WorkOrderNumber   *string `json:"workOrderNumber,omitempty"`
	ShiftID           *string `json:"shiftId,omitempty"`
	ShiftDate         string  `json:"shiftDate"`
	StartedAt         string  `json:"startedAt"`
	EndedAt           *string `json:"endedAt,omitempty"`
	ProductiveMinutes float64 `json:"productiveMinutes"`
	AvailableMinutes  float64 `json:"availableMinutes"`
	Category          string  `json:"category"`
	RecordedBy        *string `json:"recordedBy,omitempty"`
}

// Utilization is the TypeScript LaborUtilization.
type Utilization struct {
	Scope                 string  `json:"scope"`
	ScopeID               string  `json:"scopeId"`
	ScopeName             string  `json:"scopeName"`
	ProductiveMinutes     float64 `json:"productiveMinutes"`
	AvailableMinutes      float64 `json:"availableMinutes"`
	UtilizationPercentage float64 `json:"utilizationPercentage"`
}

// MatchedSkill is one requirement an operator meets.
type MatchedSkill struct {
	SkillCode string `json:"skillCode"`
	SkillName string `json:"skillName"`
	Level     int    `json:"level"`
}

// MissingSkill is one requirement an operator does not meet.
type MissingSkill struct {
	SkillCode    string `json:"skillCode"`
	SkillName    string `json:"skillName"`
	MinimumLevel int    `json:"minimumLevel"`
	Reason       string `json:"reason"`
}

// Eligibility is the TypeScript OperatorEligibility.
type Eligibility struct {
	OperatorID        string         `json:"operatorId"`
	OperatorName      string         `json:"operatorName"`
	Eligible          bool           `json:"eligible"`
	Qualified         bool           `json:"qualified"`
	Available         bool           `json:"available"`
	AvailabilityState string         `json:"availabilityState"`
	MatchedSkills     []MatchedSkill `json:"matchedSkills"`
	MissingSkills     []MissingSkill `json:"missingSkills"`
	ShiftID           *string        `json:"shiftId,omitempty"`
	ShiftName         *string        `json:"shiftName,omitempty"`
	BlockedReason     *string        `json:"blockedReason,omitempty"`
}

// Dashboard is the workforce overview.
type Dashboard struct {
	OperatorsTotal             int     `json:"operatorsTotal"`
	OperatorsAvailable         int     `json:"operatorsAvailable"`
	OperatorsAssigned          int     `json:"operatorsAssigned"`
	OperatorsUnavailable       int     `json:"operatorsUnavailable"`
	QualificationsActive       int     `json:"qualificationsActive"`
	QualificationsExpired      int     `json:"qualificationsExpired"`
	QualificationsExpiringSoon int     `json:"qualificationsExpiringSoon"`
	UtilizationPercentage      float64 `json:"utilizationPercentage"`
}

// Actor is who performed a workforce action.
type Actor struct {
	ID   string
	Name *string
}

// Recorder is the event timeline.
type Recorder interface {
	RecordDetached(in event.Input)
}

// Service is the workforce module.
type Service struct {
	pool       *db.Pool
	repo       Repository
	master     *masterdata.Service
	production *production.Service
	events     Recorder
	now        func() time.Time
}

// NewService wires the module.
func NewService(pool *db.Pool, master *masterdata.Service, prod *production.Service, events Recorder) *Service {
	return &Service{pool: pool, master: master, production: prod, events: events, now: time.Now}
}

func (s *Service) tx(ctx context.Context, tenantID string, fn func(tx pgx.Tx) error) error {
	return s.pool.WithTenant(ctx, tenantID, fn)
}

// --- Skills & requirements -------------------------------------------------

// Skills lists a tenant's skills.
func (s *Service) Skills(ctx context.Context, tenantID string) ([]Skill, error) {
	var out []Skill
	err := s.tx(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.repo.ListSkills(ctx, tx, tenantID)
		return err
	})
	return out, err
}

// CreateSkill adds a skill (default max level 3).
func (s *Service) CreateSkill(ctx context.Context, tenantID, code, name string, category, description *string, maxLevel *int) (Skill, error) {
	skill := Skill{ID: fmt.Sprintf("skill-%d", s.now().UnixMilli()), TenantID: tenantID, Code: code, Name: name, Category: db.Str(category), Description: db.Str(description),
		MaxLevel: db.Deref(maxLevel, 3), CreatedAt: db.ISO(s.now())}
	err := s.tx(ctx, tenantID, func(tx pgx.Tx) error { return s.repo.UpsertSkill(ctx, tx, skill) })
	return skill, err
}

// UpdateSkill patches a skill.
func (s *Service) UpdateSkill(ctx context.Context, tenantID, id string, code, name, category, description *string, maxLevel *int) (Skill, error) {
	var out Skill
	err := s.tx(ctx, tenantID, func(tx pgx.Tx) error {
		skills, err := s.repo.ListSkills(ctx, tx, tenantID)
		if err != nil {
			return err
		}
		found := false
		for _, sk := range skills {
			if sk.ID == id {
				out, found = sk, true
				break
			}
		}
		if !found {
			return httpx.NotFound("Skill tidak ditemukan.")
		}
		if code != nil {
			out.Code = *code
		}
		if name != nil {
			out.Name = *name
		}
		if category != nil {
			out.Category = db.Str(category)
		}
		if description != nil {
			out.Description = db.Str(description)
		}
		if maxLevel != nil {
			out.MaxLevel = *maxLevel
		}
		return s.repo.UpsertSkill(ctx, tx, out)
	})
	return out, err
}

// DeleteSkill removes a skill.
func (s *Service) DeleteSkill(ctx context.Context, tenantID, id string) error {
	return s.tx(ctx, tenantID, func(tx pgx.Tx) error { return s.repo.DeleteSkill(ctx, tx, tenantID, id) })
}

// Requirements lists qualification requirements.
func (s *Service) Requirements(ctx context.Context, tenantID, targetType, targetID string) ([]Requirement, error) {
	var out []Requirement
	err := s.tx(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.repo.ListRequirements(ctx, tx, tenantID, targetType, targetID)
		return err
	})
	return out, err
}

func (s *Service) targetName(ctx context.Context, tenantID, targetType, targetID string) string {
	if targetType == "MACHINE" {
		if m, err := s.master.MachineByID(ctx, tenantID, targetID); err == nil && m != nil {
			return m.Name
		}
		return targetID
	}
	if p, err := s.master.ProcessByID(ctx, tenantID, targetID); err == nil && p != nil {
		return p.Name
	}
	return targetID
}

// SetRequirement upserts a requirement on a machine or process.
func (s *Service) SetRequirement(ctx context.Context, tenantID, targetType, targetID, skillID string, minimumLevel *int, mandatory *bool) (Requirement, error) {
	name := s.targetName(ctx, tenantID, targetType, targetID)
	var out Requirement
	err := s.tx(ctx, tenantID, func(tx pgx.Tx) error {
		skill, err := s.repo.findSkill(ctx, tx, tenantID, skillID)
		if err != nil {
			return err
		}
		if skill == nil {
			return httpx.NotFound("Skill tidak ditemukan.")
		}
		out = Requirement{ID: "qreq-" + targetType + "-" + targetID + "-" + skillID, TenantID: tenantID, TargetType: targetType, TargetID: targetID, TargetName: name,
			SkillID: skillID, SkillCode: skill.Code, SkillName: skill.Name, MinimumLevel: db.Deref(minimumLevel, 1), Mandatory: db.Deref(mandatory, true), CreatedAt: db.ISO(s.now())}
		return s.repo.UpsertRequirement(ctx, tx, out)
	})
	return out, err
}

// DeleteRequirement removes a requirement.
func (s *Service) DeleteRequirement(ctx context.Context, tenantID, id string) error {
	return s.tx(ctx, tenantID, func(tx pgx.Tx) error { return s.repo.DeleteRequirement(ctx, tx, tenantID, id) })
}

// --- Qualifications --------------------------------------------------------

// QualificationFilter narrows qualifications.
type QualificationFilter struct {
	ID, OperatorID, SkillID string
	ExpiringWithinDays      *int
}

// Qualifications lists qualifications with their effective status.
func (s *Service) Qualifications(ctx context.Context, tenantID string, f QualificationFilter) ([]Qualification, error) {
	var out []Qualification
	err := s.tx(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.repo.ListQualifications(ctx, tx, tenantID, f)
		return err
	})
	return out, err
}

// QualificationInput is one certification.
type QualificationInput struct {
	OperatorID, SkillID                                  string
	Level                                                int
	CertifiedDate, ExpiryDate, Issuer, CertificateNumber *string
	Status, SuspendedReason                              *string
}

// SetQualification upserts an operator's qualification in a skill.
func (s *Service) SetQualification(ctx context.Context, tenantID string, in QualificationInput, actor Actor) (Qualification, error) {
	operator, err := s.master.OperatorByID(ctx, tenantID, in.OperatorID)
	if err != nil {
		return Qualification{}, err
	}
	if operator == nil {
		return Qualification{}, httpx.NotFound("Operator tidak ditemukan.")
	}
	var out Qualification
	err = s.tx(ctx, tenantID, func(tx pgx.Tx) error {
		skill, err := s.repo.findSkill(ctx, tx, tenantID, in.SkillID)
		if err != nil {
			return err
		}
		if skill == nil {
			return httpx.NotFound("Skill tidak ditemukan.")
		}
		if in.Level < 1 || in.Level > skill.MaxLevel {
			return httpx.Validation(fmt.Sprintf("Level harus antara 1 dan %d untuk skill %s.", skill.MaxLevel, skill.Code))
		}
		now := db.ISO(s.now())
		q := Qualification{ID: "qual-" + in.OperatorID + "-" + in.SkillID, TenantID: tenantID, OperatorID: in.OperatorID, OperatorName: operator.Name, SkillID: in.SkillID,
			SkillCode: skill.Code, SkillName: skill.Name, Level: in.Level, CertifiedDate: db.Deref(in.CertifiedDate, now[:10]), ExpiryDate: db.Str(in.ExpiryDate), Issuer: db.Str(in.Issuer),
			CertificateNumber: db.Str(in.CertificateNumber), Status: db.Deref(in.Status, "ACTIVE"), SuspendedReason: db.Str(in.SuspendedReason), CreatedBy: &actor.ID, CreatedAt: now, UpdatedAt: now}
		if q.Status == "" {
			q.Status = "ACTIVE"
		}
		if err := s.repo.UpsertQualification(ctx, tx, q); err != nil {
			return err
		}
		stored, err := s.repo.ListQualifications(ctx, tx, tenantID, QualificationFilter{OperatorID: in.OperatorID, SkillID: in.SkillID})
		if err != nil {
			return err
		}
		out = q
		if len(stored) > 0 {
			out = stored[0]
		}
		return nil
	})
	return out, err
}

// DeleteQualification removes a qualification.
func (s *Service) DeleteQualification(ctx context.Context, tenantID, id string) error {
	return s.tx(ctx, tenantID, func(tx pgx.Tx) error { return s.repo.DeleteQualification(ctx, tx, tenantID, id) })
}

// --- Shift assignments & availability --------------------------------------

// ShiftAssignments lists shift assignments.
func (s *Service) ShiftAssignments(ctx context.Context, tenantID, operatorID, shiftID, onDate string) ([]ShiftAssignment, error) {
	var out []ShiftAssignment
	err := s.tx(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.repo.ListShiftAssignments(ctx, tx, tenantID, operatorID, shiftID, onDate)
		return err
	})
	return out, err
}

// AssignShift puts an operator on a shift from a date.
func (s *Service) AssignShift(ctx context.Context, tenantID, operatorID, shiftID string, effectiveFrom, effectiveTo *string, isDefault *bool, actor Actor) (ShiftAssignment, error) {
	operator, err := s.master.OperatorByID(ctx, tenantID, operatorID)
	if err != nil {
		return ShiftAssignment{}, err
	}
	if operator == nil {
		return ShiftAssignment{}, httpx.NotFound("Operator tidak ditemukan.")
	}
	shift, err := s.master.ShiftByID(ctx, tenantID, shiftID)
	if err != nil {
		return ShiftAssignment{}, err
	}
	if shift == nil {
		return ShiftAssignment{}, httpx.NotFound("Shift tidak ditemukan.")
	}
	now := s.now()
	a := ShiftAssignment{ID: fmt.Sprintf("osa-%d-%s", now.UnixMilli(), db.RandomBase36(4)), TenantID: tenantID, OperatorID: operatorID, OperatorName: operator.Name, ShiftID: shiftID,
		ShiftName: shift.Name, EffectiveFrom: db.Deref(effectiveFrom, db.ISO(now)[:10]), EffectiveTo: db.Str(effectiveTo), IsDefault: db.Deref(isDefault, false), CreatedBy: &actor.ID, CreatedAt: db.ISO(now)}
	err = s.tx(ctx, tenantID, func(tx pgx.Tx) error { return s.repo.InsertShiftAssignment(ctx, tx, a) })
	return a, err
}

// RemoveShiftAssignment deletes a shift assignment.
func (s *Service) RemoveShiftAssignment(ctx context.Context, tenantID, id string) error {
	return s.tx(ctx, tenantID, func(tx pgx.Tx) error { return s.repo.DeleteShiftAssignment(ctx, tx, tenantID, id) })
}

// AvailabilityList is every active operator's current state.
func (s *Service) AvailabilityList(ctx context.Context, tenantID, operatorID string) ([]Availability, error) {
	var out []Availability
	err := s.tx(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.repo.CurrentAvailability(ctx, tx, tenantID, operatorID, s.now())
		return err
	})
	return out, err
}

// SetAvailability opens a new availability window, closing the open one.
func (s *Service) SetAvailability(ctx context.Context, tenantID, operatorID, state string, shiftID, effectiveFrom, effectiveTo, reason *string, actor Actor) (Availability, error) {
	operator, err := s.master.OperatorByID(ctx, tenantID, operatorID)
	if err != nil {
		return Availability{}, err
	}
	if operator == nil {
		return Availability{}, httpx.NotFound("Operator tidak ditemukan.")
	}
	now := s.now()
	a := Availability{ID: fmt.Sprintf("avail-%d-%s", now.UnixMilli(), db.RandomBase36(4)), TenantID: tenantID, OperatorID: operatorID, OperatorName: operator.Name, State: state,
		ShiftID: db.Str(shiftID), EffectiveFrom: db.Deref(effectiveFrom, db.ISO(now)), EffectiveTo: db.Str(effectiveTo), Reason: db.Str(reason), UpdatedBy: &actor.ID, UpdatedAt: db.ISO(now)}
	err = s.tx(ctx, tenantID, func(tx pgx.Tx) error { return s.repo.SetAvailability(ctx, tx, a) })
	return a, err
}

// --- Eligibility -----------------------------------------------------------

// EligibilityContext is what an assignment needs.
type EligibilityContext struct {
	MachineID, ProcessID, OnDate string
	OperatorIDs                  []string
}

func (s *Service) gatherRequirements(ctx context.Context, tx pgx.Tx, tenantID string, c EligibilityContext) ([]Requirement, error) {
	var all []Requirement
	if c.MachineID != "" {
		list, err := s.repo.ListRequirements(ctx, tx, tenantID, "MACHINE", c.MachineID)
		if err != nil {
			return nil, err
		}
		all = append(all, list...)
	}
	if c.ProcessID != "" {
		list, err := s.repo.ListRequirements(ctx, tx, tenantID, "PROCESS", c.ProcessID)
		if err != nil {
			return nil, err
		}
		all = append(all, list...)
	}
	bySkill := map[string]int{}
	var out []Requirement
	for _, r := range all {
		if i, ok := bySkill[r.SkillID]; ok {
			if r.MinimumLevel > out[i].MinimumLevel {
				out[i].MinimumLevel = r.MinimumLevel
			}
			out[i].Mandatory = out[i].Mandatory || r.Mandatory
			continue
		}
		bySkill[r.SkillID] = len(out)
		out = append(out, r)
	}
	return out, nil
}

// Eligibility judges every active operator against the requirements of a
// machine and process and their current availability.
func (s *Service) Eligibility(ctx context.Context, tenantID string, c EligibilityContext) ([]Eligibility, error) {
	operators, err := s.master.Operators(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	var out []Eligibility
	err = s.tx(ctx, tenantID, func(tx pgx.Tx) error {
		requirements, err := s.gatherRequirements(ctx, tx, tenantID, c)
		if err != nil {
			return err
		}
		availability, err := s.repo.CurrentAvailability(ctx, tx, tenantID, "", s.now())
		if err != nil {
			return err
		}
		onDate := c.OnDate
		if onDate == "" {
			onDate = db.ISO(s.now())[:10]
		}
		shiftAssignments, err := s.repo.ListShiftAssignments(ctx, tx, tenantID, "", "", onDate)
		if err != nil {
			return err
		}
		allQualifications, err := s.repo.ListQualifications(ctx, tx, tenantID, QualificationFilter{})
		if err != nil {
			return err
		}
		out = []Eligibility{}
		for _, operator := range operators {
			if operator.Status != "ACTIVE" {
				continue
			}
			if c.OperatorIDs != nil && !contains(c.OperatorIDs, operator.ID) {
				continue
			}
			state := "AVAILABLE"
			for _, a := range availability {
				if a.OperatorID == operator.ID {
					state = a.State
					break
				}
			}
			var shift *ShiftAssignment
			for i := range shiftAssignments {
				if shiftAssignments[i].OperatorID == operator.ID {
					shift = &shiftAssignments[i]
					break
				}
			}
			matched, missing := []MatchedSkill{}, []MissingSkill{}
			for _, req := range requirements {
				var held *Qualification
				for i := range allQualifications {
					if allQualifications[i].OperatorID == operator.ID && allQualifications[i].SkillID == req.SkillID {
						held = &allQualifications[i]
						break
					}
				}
				switch {
				case held == nil:
					missing = append(missing, MissingSkill{req.SkillCode, req.SkillName, req.MinimumLevel, "Belum memiliki kualifikasi ini."})
				case held.Status != "ACTIVE":
					reason := "Kualifikasi disuspensi."
					if held.Status == "EXPIRED" {
						reason = "Kualifikasi sudah kedaluwarsa."
					}
					missing = append(missing, MissingSkill{req.SkillCode, req.SkillName, req.MinimumLevel, reason})
				case held.Level < req.MinimumLevel:
					missing = append(missing, MissingSkill{req.SkillCode, req.SkillName, req.MinimumLevel, fmt.Sprintf("Level %d, dibutuhkan minimal %d.", held.Level, req.MinimumLevel)})
				default:
					matched = append(matched, MatchedSkill{held.SkillCode, held.SkillName, held.Level})
				}
			}
			var blocking []MissingSkill
			for _, m := range missing {
				for _, req := range requirements {
					if req.SkillCode == m.SkillCode && req.Mandatory {
						blocking = append(blocking, m)
						break
					}
				}
			}
			qualified := len(blocking) == 0
			available := state == "AVAILABLE" || state == "ASSIGNED"
			e := Eligibility{OperatorID: operator.ID, OperatorName: operator.Name, Eligible: qualified && available, Qualified: qualified, Available: available,
				AvailabilityState: state, MatchedSkills: matched, MissingSkills: missing}
			if shift != nil {
				e.ShiftID, e.ShiftName = &shift.ShiftID, &shift.ShiftName
			}
			if !available {
				e.BlockedReason = db.Ptr(fmt.Sprintf("Operator berstatus %s.", state))
			} else if len(blocking) > 0 {
				parts := make([]string, len(blocking))
				for i, b := range blocking {
					parts[i] = b.SkillCode + ": " + b.Reason
				}
				e.BlockedReason = db.Ptr(strings.Join(parts, " "))
			}
			out = append(out, e)
		}
		sort.SliceStable(out, func(i, j int) bool {
			if out[i].Eligible != out[j].Eligible {
				return out[i].Eligible
			}
			return jsnum.LocaleLess(out[i].OperatorName, out[j].OperatorName)
		})
		return nil
	})
	return out, err
}

// --- Labour requirements & assignments -------------------------------------

// SetLaborRequirement stores how many operators a work order needs.
func (s *Service) SetLaborRequirement(ctx context.Context, tenantID, workOrderID string, required int, shiftID, notes *string) (LaborRequirement, error) {
	wo, err := s.production.WorkOrderByID(ctx, tenantID, workOrderID)
	if err != nil {
		return LaborRequirement{}, err
	}
	if wo == nil {
		return LaborRequirement{}, httpx.NotFound("Work Order tidak ditemukan.")
	}
	shift := shiftID
	if shift == nil {
		shift = wo.ShiftID
	}
	if err := s.tx(ctx, tenantID, func(tx pgx.Tx) error {
		return s.repo.UpsertLaborRequirement(ctx, tx, tenantID, workOrderID, required, wo.ProcessID, wo.MachineID, shift, notes)
	}); err != nil {
		return LaborRequirement{}, err
	}
	return s.LaborStatus(ctx, tenantID, workOrderID)
}

// LaborStatus compares what a work order needs with who is assigned and
// who could be.
func (s *Service) LaborStatus(ctx context.Context, tenantID, workOrderID string) (LaborRequirement, error) {
	wo, err := s.production.WorkOrderByID(ctx, tenantID, workOrderID)
	if err != nil {
		return LaborRequirement{}, err
	}
	if wo == nil {
		return LaborRequirement{}, httpx.NotFound("Work Order tidak ditemukan.")
	}
	var stored *storedRequirement
	if err := s.tx(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		stored, err = s.repo.FindLaborRequirement(ctx, tx, tenantID, workOrderID)
		return err
	}); err != nil {
		return LaborRequirement{}, err
	}
	required := 1
	if stored != nil {
		required = stored.RequiredOperators
	}
	assignments, err := s.Assignments(ctx, tenantID, AssignmentFilter{WorkOrderID: workOrderID, Active: true})
	if err != nil {
		return LaborRequirement{}, err
	}
	eligible, err := s.Eligibility(ctx, tenantID, EligibilityContext{MachineID: db.Deref(wo.MachineID, ""), ProcessID: db.Deref(wo.ProcessID, "")})
	if err != nil {
		return LaborRequirement{}, err
	}
	availableQualified := 0
	for _, e := range eligible {
		if e.Eligible {
			availableQualified++
		}
	}
	status := "SHORTAGE"
	if len(assignments) >= required {
		status = "SUFFICIENT"
		if len(assignments) > required {
			status = "OVERSTAFFED"
		}
	}
	out := LaborRequirement{ID: "lreq-" + workOrderID, TenantID: tenantID, WorkOrderID: workOrderID, WorkOrderNumber: wo.WoNumber, ProcessID: wo.ProcessID, MachineID: wo.MachineID,
		RequiredOperators: required, AssignedOperators: len(assignments), AvailableQualifiedOperators: availableQualified, Status: status, ShiftID: wo.ShiftID, UpdatedAt: db.ISO(s.now())}
	if stored != nil {
		if stored.ShiftID != nil {
			out.ShiftID = stored.ShiftID
		}
		out.Notes, out.UpdatedAt = stored.Notes, stored.UpdatedAt
	}
	return out, nil
}

// AssignmentFilter narrows assignments.
type AssignmentFilter struct {
	ID, WorkOrderID, OperatorID, Status string
	Active                              bool
}

// Assignments lists assignments.
func (s *Service) Assignments(ctx context.Context, tenantID string, f AssignmentFilter) ([]Assignment, error) {
	var out []Assignment
	err := s.tx(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.repo.ListAssignments(ctx, tx, tenantID, f)
		return err
	})
	return out, err
}

// AssignOperator assigns an operator to a work order after the
// eligibility check, unless forced.
func (s *Service) AssignOperator(ctx context.Context, tenantID, workOrderID, operatorID string, role, shiftID *string, force bool, actor Actor) (Assignment, error) {
	wo, err := s.production.WorkOrderByID(ctx, tenantID, workOrderID)
	if err != nil {
		return Assignment{}, err
	}
	if wo == nil {
		return Assignment{}, httpx.NotFound("Work Order tidak ditemukan.")
	}
	eligibility, err := s.Eligibility(ctx, tenantID, EligibilityContext{MachineID: db.Deref(wo.MachineID, ""), ProcessID: db.Deref(wo.ProcessID, ""), OperatorIDs: []string{operatorID}})
	if err != nil {
		return Assignment{}, err
	}
	if len(eligibility) == 0 {
		return Assignment{}, httpx.NotFound("Operator tidak ditemukan atau tidak aktif.")
	}
	e := eligibility[0]
	if !e.Eligible && !force {
		return Assignment{}, httpx.Conflict(db.Deref(e.BlockedReason, "Operator tidak memenuhi syarat kualifikasi atau ketersediaan untuk penugasan ini."))
	}
	now := s.now()
	shift := shiftID
	if shift == nil {
		shift = wo.ShiftID
	}
	matched := make([]string, len(e.MatchedSkills))
	for i, m := range e.MatchedSkills {
		matched[i] = fmt.Sprintf("%s L%d", m.SkillCode, m.Level)
	}
	missing := make([]string, len(e.MissingSkills))
	for i, m := range e.MissingSkills {
		missing[i] = m.SkillCode + ": " + m.Reason
	}
	a := Assignment{ID: fmt.Sprintf("lasg-%d-%s", now.UnixMilli(), db.RandomBase36(4)), TenantID: tenantID, WorkOrderID: workOrderID, WorkOrderNumber: wo.WoNumber, OperatorID: operatorID,
		OperatorName: e.OperatorName, Role: db.Str(role), ShiftID: shift, AssignedBy: actor.ID, AssignedAt: db.ISO(now), Status: "ASSIGNED",
		QualificationCheck: &QualificationCheck{Qualified: e.Qualified, MatchedSkills: matched, MissingSkills: missing}}
	if err := s.tx(ctx, tenantID, func(tx pgx.Tx) error {
		if err := s.repo.InsertAssignment(ctx, tx, a); err != nil {
			return err
		}
		return s.repo.SetAvailability(ctx, tx, Availability{ID: fmt.Sprintf("avail-%d-%s", now.UnixMilli(), db.RandomBase36(4)), TenantID: tenantID, OperatorID: operatorID,
			OperatorName: e.OperatorName, State: "ASSIGNED", ShiftID: a.ShiftID, EffectiveFrom: a.AssignedAt, Reason: db.Ptr("Ditugaskan pada " + wo.WoNumber), UpdatedBy: &actor.ID, UpdatedAt: a.AssignedAt})
	}); err != nil {
		return Assignment{}, err
	}
	s.events.RecordDetached(event.Input{TenantID: tenantID, EventType: "OPERATOR_ASSIGNED", EntityType: "WORK_ORDER", EntityID: workOrderID, ActorType: "USER", ActorID: &actor.ID, ActorName: actor.Name,
		WorkOrderID: &workOrderID, MachineID: wo.MachineID, LineID: &wo.LineID, Summary: fmt.Sprintf("%s ditugaskan pada %s.", e.OperatorName, wo.WoNumber),
		AfterValue: map[string]any{"operatorId": operatorID, "qualified": e.Qualified, "forced": force}})
	return a, nil
}

// UnassignOperator cancels an assignment and frees the operator.
func (s *Service) UnassignOperator(ctx context.Context, tenantID, assignmentID string, actor Actor) error {
	var existing Assignment
	if err := s.tx(ctx, tenantID, func(tx pgx.Tx) error {
		list, err := s.repo.ListAssignments(ctx, tx, tenantID, AssignmentFilter{ID: assignmentID})
		if err != nil {
			return err
		}
		if len(list) == 0 {
			return httpx.NotFound("Penugasan tidak ditemukan.")
		}
		existing = list[0]
		if err := s.repo.SetAssignmentStatus(ctx, tx, tenantID, assignmentID, "CANCELLED"); err != nil {
			return err
		}
		now := s.now()
		return s.repo.SetAvailability(ctx, tx, Availability{ID: fmt.Sprintf("avail-%d-%s", now.UnixMilli(), db.RandomBase36(4)), TenantID: tenantID, OperatorID: existing.OperatorID,
			OperatorName: existing.OperatorName, State: "AVAILABLE", EffectiveFrom: db.ISO(now), Reason: db.Ptr("Dilepas dari " + existing.WorkOrderNumber), UpdatedBy: &actor.ID, UpdatedAt: db.ISO(now)})
	}); err != nil {
		return err
	}
	s.events.RecordDetached(event.Input{TenantID: tenantID, EventType: "OPERATOR_UNASSIGNED", EntityType: "WORK_ORDER", EntityID: existing.WorkOrderID, ActorType: "USER", ActorID: &actor.ID,
		ActorName: actor.Name, WorkOrderID: &existing.WorkOrderID, Summary: fmt.Sprintf("%s dilepas dari %s.", existing.OperatorName, existing.WorkOrderNumber)})
	return nil
}

// --- Time & utilisation ----------------------------------------------------

// TimeInput is one labour time record.
type TimeInput struct {
	OperatorID                          string
	WorkOrderID, ShiftID, ShiftDate     *string
	StartedAt                           string
	EndedAt                             *string
	ProductiveMinutes, AvailableMinutes float64
	Category                            *string
}

// RecordTime stores a time record.
func (s *Service) RecordTime(ctx context.Context, tenantID string, in TimeInput, actor Actor) (TimeRecord, error) {
	operator, err := s.master.OperatorByID(ctx, tenantID, in.OperatorID)
	if err != nil {
		return TimeRecord{}, err
	}
	if operator == nil {
		return TimeRecord{}, httpx.NotFound("Operator tidak ditemukan.")
	}
	shiftDate := db.Deref(in.ShiftDate, "")
	if shiftDate == "" && len(in.StartedAt) >= 10 {
		shiftDate = in.StartedAt[:10]
	}
	r := TimeRecord{ID: fmt.Sprintf("ltr-%d-%s", s.now().UnixMilli(), db.RandomBase36(4)), TenantID: tenantID, OperatorID: in.OperatorID, OperatorName: operator.Name, WorkOrderID: db.Str(in.WorkOrderID),
		ShiftID: db.Str(in.ShiftID), ShiftDate: shiftDate, StartedAt: in.StartedAt, EndedAt: db.Str(in.EndedAt), ProductiveMinutes: in.ProductiveMinutes, AvailableMinutes: in.AvailableMinutes,
		Category: db.Deref(in.Category, "PRODUCTIVE"), RecordedBy: &actor.ID}
	if r.Category == "" {
		r.Category = "PRODUCTIVE"
	}
	err = s.tx(ctx, tenantID, func(tx pgx.Tx) error { return s.repo.InsertTimeRecord(ctx, tx, r) })
	return r, err
}

// TimeFilter narrows time records.
type TimeFilter struct {
	OperatorID, WorkOrderID, From, To string
	Limit                             int
}

// TimeRecords lists time records.
func (s *Service) TimeRecords(ctx context.Context, tenantID string, f TimeFilter) ([]TimeRecord, error) {
	var out []TimeRecord
	err := s.tx(ctx, tenantID, func(tx pgx.Tx) error {
		var err error
		out, err = s.repo.ListTimeRecords(ctx, tx, tenantID, f)
		return err
	})
	return out, err
}

// UtilizationBy rolls time records up by operator, shift or plant.
func (s *Service) UtilizationBy(ctx context.Context, tenantID, scope, from, to string) ([]Utilization, error) {
	records, err := s.TimeRecords(ctx, tenantID, TimeFilter{From: from, To: to, Limit: 5000})
	if err != nil {
		return nil, err
	}
	shifts, err := s.master.Shifts(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	type bucket struct {
		name                  string
		productive, available float64
	}
	buckets := map[string]*bucket{}
	var order []string
	for _, r := range records {
		key, name := "plant", "Seluruh Plant"
		switch scope {
		case "OPERATOR":
			key, name = r.OperatorID, r.OperatorName
		case "SHIFT":
			key, name = db.Deref(r.ShiftID, "unassigned"), "Tanpa Shift"
			for _, sh := range shifts {
				if r.ShiftID != nil && sh.ID == *r.ShiftID {
					name = sh.Name
					break
				}
			}
		}
		b, ok := buckets[key]
		if !ok {
			b = &bucket{name: name}
			buckets[key] = b
			order = append(order, key)
		}
		b.productive += r.ProductiveMinutes
		b.available += r.AvailableMinutes
	}
	out := make([]Utilization, 0, len(order))
	for _, key := range order {
		b := buckets[key]
		u := Utilization{Scope: scope, ScopeID: key, ScopeName: b.name, ProductiveMinutes: jsnum.Round1(b.productive), AvailableMinutes: jsnum.Round1(b.available)}
		if b.available > 0 {
			u.UtilizationPercentage = jsnum.Round1((b.productive / b.available) * 100)
		}
		out = append(out, u)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].UtilizationPercentage > out[j].UtilizationPercentage })
	return out, nil
}

// WorkforceDashboard is the overview.
func (s *Service) WorkforceDashboard(ctx context.Context, tenantID string) (Dashboard, error) {
	availability, err := s.AvailabilityList(ctx, tenantID, "")
	if err != nil {
		return Dashboard{}, err
	}
	qualifications, err := s.Qualifications(ctx, tenantID, QualificationFilter{})
	if err != nil {
		return Dashboard{}, err
	}
	expiring, err := s.Qualifications(ctx, tenantID, QualificationFilter{ExpiringWithinDays: db.Ptr(30)})
	if err != nil {
		return Dashboard{}, err
	}
	plant, err := s.UtilizationBy(ctx, tenantID, "PLANT", db.ISO(s.now().Add(-30 * 24 * time.Hour))[:10], "")
	if err != nil {
		return Dashboard{}, err
	}
	d := Dashboard{OperatorsTotal: len(availability)}
	for _, a := range availability {
		switch a.State {
		case "AVAILABLE":
			d.OperatorsAvailable++
		case "ASSIGNED", "WORKING":
			d.OperatorsAssigned++
		case "ABSENT", "LEAVE", "SICK", "OFFLINE":
			d.OperatorsUnavailable++
		}
	}
	for _, q := range qualifications {
		switch q.Status {
		case "ACTIVE":
			d.QualificationsActive++
		case "EXPIRED":
			d.QualificationsExpired++
		}
	}
	for _, q := range expiring {
		if q.Status == "ACTIVE" {
			d.QualificationsExpiringSoon++
		}
	}
	if len(plant) > 0 {
		d.UtilizationPercentage = plant[0].UtilizationPercentage
	}
	return d, nil
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}
