package identity

import (
	"context"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/masterdata"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/auth"
)

// SubjectSource adapts master data to what the resolver re-reads on every
// request: the account's status, role and scope.
type SubjectSource struct {
	Master *masterdata.Service
}

// UserByID implements auth.SubjectSource.
func (s SubjectSource) UserByID(ctx context.Context, tenantID, userID string) (*auth.Subject, error) {
	u, err := s.Master.UserByID(ctx, tenantID, userID)
	if err != nil || u == nil {
		return nil, err
	}
	return &auth.Subject{ID: u.ID, Status: u.Status, Role: u.Role, ScopeLevel: u.ScopeLevel, ScopeID: u.ScopeID}, nil
}

// OperatorByID implements auth.SubjectSource.
func (s SubjectSource) OperatorByID(ctx context.Context, tenantID, operatorID string) (*auth.Subject, error) {
	o, err := s.Master.OperatorByID(ctx, tenantID, operatorID)
	if err != nil || o == nil {
		return nil, err
	}
	level := "TENANT"
	if o.DefaultLineID != nil {
		level = "LINE"
	}
	return &auth.Subject{ID: o.ID, Status: o.Status, Role: "OPERATOR", ScopeLevel: level, ScopeID: o.DefaultLineID}, nil
}
