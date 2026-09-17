//go:build integration

package identity

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/masterdata"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/roles"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/async"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/auth"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/testkit"
)

// A session row written the way the Node API wrote it — token hash, JSON
// snapshot, lifetime columns — must resolve to the same principal here, so
// nobody is logged out by the cutover.
func TestResolverReadsNodeShapedSession(t *testing.T) {
	pools := testkit.Open(t)
	ctx := context.Background()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))

	master, err := masterdata.NewService(pools.App)
	if err != nil {
		t.Fatal(err)
	}
	roleSvc, err := roles.NewService(pools.App, master)
	if err != nil {
		t.Fatal(err)
	}
	users, err := master.Users(ctx, testkit.Tenant)
	if err != nil {
		t.Fatal(err)
	}
	var admin *masterdata.User
	for i := range users {
		if users[i].Role == "ADMIN" && users[i].Status == "ACTIVE" {
			admin = &users[i]
			break
		}
	}
	if admin == nil {
		t.Skip("no active ADMIN in the pilot tenant; run the seed and the bootstrap first")
	}

	token := auth.NewToken(testkit.Tenant)
	sessionID := auth.NewSessionID()
	now := time.Now()
	snapshot := map[string]any{
		"sessionId": sessionID, "kind": "APPLICATION", "tenantId": testkit.Tenant, "subjectId": admin.ID,
		"name": admin.Name, "role": "ADMIN", "permissions": []string{"dashboard:view"},
		"scope":    map[string]any{"level": "TENANT", "plantIds": []string{}, "lineIds": []string{}, "workCenterIds": []string{}},
		"issuedAt": db.ISO(now), "expiresAt": db.ISO(now.Add(12 * time.Hour)), "idleExpiresAt": db.ISO(now.Add(time.Hour)),
		"landingPath": "/settings?tab=users",
	}
	raw, _ := json.Marshal(snapshot)
	if _, err := pools.Owner.Exec(ctx,
		`INSERT INTO app_session (id, tenant_id, kind, subject_id, token_hash, principal, issued_at, expires_at, idle_expires_at, last_seen_at)
		 VALUES ($1, $2, 'APPLICATION', $3, $4, $5::jsonb, $6, $7, $8, $6)`,
		sessionID, testkit.Tenant, admin.ID, auth.HashToken(token), raw, now, now.Add(12*time.Hour), now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { pools.Owner.Exec(ctx, `DELETE FROM app_session WHERE id = $1`, sessionID) })

	sessions := NewSessionRepository(pools.App)
	resolver, err := auth.NewResolver(sessions, SubjectSource{Master: master}, roleSvc, async.NewRunner(2, 5*time.Second, log), log)
	if err != nil {
		t.Fatal(err)
	}
	defer resolver.Close()

	p, err := resolver.Resolve(ctx, token)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if p.SessionID != sessionID || p.SubjectID != admin.ID || p.Kind != auth.KindApplication {
		t.Fatalf("principal mismatch: %+v", p)
	}
	// Permissions and scope are re-derived, not taken from the snapshot: the
	// snapshot said dashboard:view only, the ADMIN role holds everything.
	if !p.Has("role:edit") || p.Scope.Level != "TENANT" || len(p.Scope.LineIDs) == 0 {
		t.Fatalf("permissions/scope must be re-derived: %d perms, scope %+v", len(p.Permissions), p.Scope)
	}
	// A second call is answered from the cache; a garbage token is refused.
	if _, err := resolver.Resolve(ctx, token); err != nil {
		t.Fatal(err)
	}
	if _, err := resolver.Resolve(ctx, testkit.Tenant+".not-a-real-token"); err != auth.ErrNoSession {
		t.Fatalf("unknown token must be ErrNoSession, got %v", err)
	}
	if _, err := resolver.Resolve(ctx, "no-tenant-prefix"); err != auth.ErrNoSession {
		t.Fatalf("token without tenant prefix must be ErrNoSession, got %v", err)
	}
}

// The other tenant's session store must not see the pilot's sessions, and
// a delete must be honoured on the next resolve.
func TestSessionStoreIsTenantIsolated(t *testing.T) {
	pools := testkit.Open(t)
	pools.RequireAppRole(t)
	ctx := context.Background()
	sessions := NewSessionRepository(pools.App)

	token := auth.NewToken(testkit.Tenant)
	principal := auth.Principal{
		SessionID: auth.NewSessionID(), Kind: auth.KindOperator, TenantID: testkit.Tenant, SubjectID: "op-testkit",
		Name: "Testkit", Role: "OPERATOR", Permissions: []string{}, Scope: auth.Scope{Level: "TENANT", PlantIDs: []string{}, LineIDs: []string{}, WorkCenterIDs: []string{}},
		IssuedAt: db.Now(), ExpiresAt: db.ISO(time.Now().Add(time.Hour)), IdleExpiresAt: db.ISO(time.Now().Add(time.Hour)), LandingPath: "/terminal",
	}
	if err := sessions.Insert(ctx, principal, token, nil, nil); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { pools.Owner.Exec(ctx, `DELETE FROM app_session WHERE id = $1`, principal.SessionID) })

	found, err := sessions.FindByToken(ctx, token)
	if err != nil || found == nil {
		t.Fatalf("own session must be found: %v", err)
	}
	// The same hash asked for under the other tenant prefix finds nothing.
	foreign := testkit.OtherTenant + token[len(testkit.Tenant):]
	if _, err := pools.Owner.Exec(ctx, `UPDATE app_session SET token_hash = $2 WHERE id = $1`, principal.SessionID, auth.HashToken(foreign)); err != nil {
		t.Fatal(err)
	}
	if got, err := sessions.FindByToken(ctx, foreign); err != nil || got != nil {
		t.Fatalf("cross-tenant lookup must find nothing: %v %v", err, got)
	}
	if err := sessions.Delete(ctx, testkit.Tenant, principal.SessionID); err != nil {
		t.Fatal(err)
	}
}
