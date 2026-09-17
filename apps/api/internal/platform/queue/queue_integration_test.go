//go:build integration

package queue

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"

	"github.com/nugrohoindrag/factory-vision/apps/api/internal/testkit"
)

// Port of qa-worker-queue.mjs: a job is enqueued with its tenant, claimed
// exactly once under SKIP LOCKED, and a deterministic failure stops being
// retried at max_attempts rather than spinning for ever.
func TestQueueClaimSucceedAndRetry(t *testing.T) {
	pools := testkit.Open(t)
	ctx := context.Background()
	q := New(pools.App)

	job, err := q.Enqueue(ctx, Request{TenantID: testkit.Tenant, JobType: "TESTKIT_ECHO", Payload: map[string]any{"n": 1}, MaxAttempts: 2})
	if err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	if job.Status != "PENDING" || job.TenantID != testkit.Tenant || job.Attempts != 0 {
		t.Fatalf("enqueued job: %+v", job)
	}

	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	calls := 0
	runner := NewRunner(q, map[string]Handler{
		"TESTKIT_ECHO": func(_ context.Context, j Job) (map[string]any, error) {
			calls++
			if calls == 1 {
				return nil, errors.New("first attempt fails on purpose")
			}
			return map[string]any{"echo": j.Payload["n"]}, nil
		},
	}, "testkit", log)

	// First drain: the handler fails, the job goes back to PENDING with the
	// error recorded and one attempt consumed.
	first, err := runner.RunOnce(ctx)
	if err != nil || first == nil || first.Status != "FAILED" {
		t.Fatalf("first run: %+v %v", first, err)
	}
	stored, err := q.FindByID(ctx, testkit.Tenant, job.ID)
	if err != nil || stored == nil {
		t.Fatalf("find: %v", err)
	}
	if stored.Status != "PENDING" || stored.Attempts != 1 || stored.LastError == nil {
		t.Fatalf("after failure: %+v", stored)
	}

	// Second drain: succeeds, result readable back under the tenant.
	second, err := runner.RunOnce(ctx)
	if err != nil || second == nil || second.Status != "SUCCEEDED" {
		t.Fatalf("second run: %+v %v", second, err)
	}
	stored, _ = q.FindByID(ctx, testkit.Tenant, job.ID)
	if stored.Status != "SUCCEEDED" || stored.Attempts != 2 || stored.Result["echo"] != float64(1) || stored.LastError != nil || stored.FinishedAt == nil {
		t.Fatalf("after success: %+v", stored)
	}

	// A job nobody has a handler for is failed, not left RUNNING.
	orphan, err := q.Enqueue(ctx, Request{TenantID: testkit.Tenant, JobType: "TESTKIT_UNKNOWN", MaxAttempts: 1})
	if err != nil {
		t.Fatal(err)
	}
	if out, err := runner.RunOnce(ctx); err != nil || out == nil || out.ID != orphan.ID || out.Status != "FAILED" {
		t.Fatalf("orphan run: %+v %v", out, err)
	}
	stored, _ = q.FindByID(ctx, testkit.Tenant, orphan.ID)
	if stored.Status != "FAILED" || stored.FinishedAt == nil {
		t.Fatalf("orphan should stay FAILED: %+v", stored)
	}

	// The other tenant cannot read either job.
	if got, _ := q.FindByID(ctx, testkit.OtherTenant, job.ID); got != nil {
		t.Fatal("cross-tenant read returned a job")
	}
	// The queue is empty for this handler set now.
	if out, err := runner.RunOnce(ctx); err != nil || out != nil {
		t.Fatalf("expected empty queue, got %+v %v", out, err)
	}
	list, err := q.List(ctx, testkit.Tenant, "TESTKIT_ECHO", 10)
	if err != nil || len(list) == 0 || list[0].ID != job.ID {
		t.Fatalf("list: %v %+v", err, list)
	}
}
