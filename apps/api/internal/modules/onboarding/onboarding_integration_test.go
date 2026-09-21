//go:build integration

package onboarding

import (
	"context"
	"testing"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/masterdata"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/modules/production"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/platform/security"
	"github.com/nugrohoindrag/factory-vision/apps/api/internal/testkit"
)

// The onboarding wizard's state was in-process memory in Node; here it has
// to survive a restart, so it is read back through a fresh service and is
// invisible to another tenant.
func TestOnboardingProgressPersists(t *testing.T) {
	pools := testkit.Open(t)
	ctx := context.Background()
	master, err := masterdata.NewService(pools.App)
	if err != nil {
		t.Fatal(err)
	}
	prod := production.NewService(pools.App, nil, nil, nil)
	svc, err := NewService(pools.App, master, prod, nil, security.NewPolicy(12))
	if err != nil {
		t.Fatal(err)
	}

	status, err := svc.Status(ctx, testkit.Tenant, "usr-testkit")
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	if len(status.Steps) != 9 || status.ReadinessPercent == 0 || len(status.ReadinessItems) != 9 || len(status.ActivationItems) != 5 {
		t.Fatalf("status: %+v", status)
	}
	total := 0
	for _, it := range status.ReadinessItems {
		total += it.Weight
	}
	if total != 100 {
		t.Fatalf("readiness weights must sum to 100, got %d", total)
	}

	if _, err := svc.UpdateStep(ctx, testkit.Tenant, "welcome_tour", "completed"); err != nil {
		t.Fatalf("update step: %v", err)
	}
	guidance, err := svc.UpdateGuidance(ctx, testkit.Tenant, GuidancePatch{DismissedTooltips: []string{"tip-a", "tip-b"}})
	if err != nil {
		t.Fatalf("guidance: %v", err)
	}
	if _, err := svc.UpdateGuidance(ctx, testkit.Tenant, GuidancePatch{DismissedTooltips: []string{"tip-b", "tip-c"}}); err != nil {
		t.Fatal(err)
	}

	// A fresh service instance sees what the first one wrote.
	again, err := NewService(pools.App, master, prod, nil, security.NewPolicy(12))
	if err != nil {
		t.Fatal(err)
	}
	reread, err := again.Status(ctx, testkit.Tenant, "")
	if err != nil {
		t.Fatal(err)
	}
	if reread.Steps["welcome_tour"].Status != "completed" || reread.Steps["welcome_tour"].CompletedAt == nil {
		t.Fatalf("step did not persist: %+v", reread.Steps["welcome_tour"])
	}
	g, err := again.GetGuidance(ctx, testkit.Tenant)
	if err != nil {
		t.Fatal(err)
	}
	if len(guidance.DismissedTooltips) != 2 || len(g.DismissedTooltips) != 3 {
		t.Fatalf("tooltips must accumulate as a set: %v then %v", guidance.DismissedTooltips, g.DismissedTooltips)
	}

	// Another tenant starts from nothing.
	if _, err := again.UpdateStep(ctx, testkit.OtherTenant, "welcome_tour", "completed"); err == nil {
		t.Fatal("a tenant without onboarding data must get 404, not another tenant's row")
	}
}
