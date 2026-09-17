//go:build integration

package planning

import (
	"context"
	"encoding/base64"
	"io"
	"log/slog"
	"regexp"
	"strconv"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/modules/audit"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/async"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/db"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/httpx"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/outbox"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/queue"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/security"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/platform/storage"
	"github.com/nugrohoindrag/factory-vision/apps/api-go/internal/testkit"
)

// Port of verify-planning-flow.mjs: customer → order with lines and a
// document → forecast as a job → capacity assessment → plan → demand
// aggregation → wizard readiness → confirm guard, with the audit rows
// written in the same transactions and the outbox carrying every event.
func TestPlanningFlow(t *testing.T) {
	pools := testkit.Open(t)
	ctx := context.Background()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	auditor := audit.NewService(pools.App, async.NewRunner(4, 5*time.Second, log), security.NewEvents("", log))
	jobs := queue.New(pools.App)
	store := storage.NewFilesystem(t.TempDir())
	svc := NewService(pools.App, auditor, outbox.Repository{}, jobs, store)
	stamp := time.Now().UnixNano()
	actor := "usr-testkit"

	// A product with an active routing and a rate, from the seed.
	var productID string
	if err := pools.Owner.QueryRow(ctx, `SELECT p.id FROM product p WHERE p.tenant_id = $1 AND p.status = 'ACTIVE'
		AND EXISTS (SELECT 1 FROM product_routing pr WHERE pr.product_id = p.id AND pr.active = TRUE) ORDER BY p.sku LIMIT 1`, testkit.Tenant).Scan(&productID); err != nil {
		t.Skipf("no routed product in seed: %v", err)
	}

	// --- Customer & order ---------------------------------------------------
	customer, err := svc.CreateCustomer(ctx, testkit.Tenant, Customer{Code: "QA-" + strconv.FormatInt(stamp, 10), Name: "PT Testkit Sejahtera", DeliveryAddress: db.Ptr("Kawasan Industri Testkit")}, actor)
	if err != nil {
		t.Fatalf("create customer: %v", err)
	}
	if customer.Status != "ACTIVE" {
		t.Fatalf("customer status: %s", customer.Status)
	}
	if _, err := svc.CreateCustomer(ctx, testkit.Tenant, Customer{Code: customer.Code, Name: "dup"}, actor); err == nil {
		t.Fatal("duplicate code must conflict")
	}

	delivery := time.Now().AddDate(0, 0, 30).Format("2006-01-02")
	order, err := svc.CreateOrder(ctx, testkit.Tenant, OrderInput{CustomerID: customer.ID, OrderChannel: "PO_DOCUMENT", RequestedDeliveryDate: delivery,
		Lines: []OrderLineInput{{ProductID: productID, OrderedQuantity: 5000}}}, actor)
	if err != nil {
		t.Fatalf("create order: %v", err)
	}
	if !regexp.MustCompile(`^CO-\d{6}-\d{3}$`).MatchString(order.OrderNumber) {
		t.Fatalf("order number: %s", order.OrderNumber)
	}
	if order.Status != "RECEIVED" || len(order.Lines) != 1 || order.Lines[0].OrderedQuantity != 5000 || order.OrderChannel != "PO_DOCUMENT" {
		t.Fatalf("order: %+v", order)
	}
	if *order.DeliveryAddress != "Kawasan Industri Testkit" {
		t.Fatalf("address should fall back to the customer's: %v", order.DeliveryAddress)
	}
	second, err := svc.AddLine(ctx, testkit.Tenant, order.ID, OrderLineInput{ProductID: productID, OrderedQuantity: 1500}, actor)
	if err != nil {
		t.Fatalf("add line: %v", err)
	}
	if second.LineNo != 2 {
		t.Fatalf("line no: %d", second.LineNo)
	}

	// Transactional audit (MES-020): the CREATE row exists alongside the order.
	var audited int
	if err := pools.Owner.QueryRow(ctx, `SELECT count(*) FROM audit_log WHERE tenant_id = $1 AND entity_type = 'customer_order' AND entity_id = $2 AND action = 'CREATE'`, testkit.Tenant, order.ID).Scan(&audited); err != nil {
		t.Fatal(err)
	}
	if audited != 1 {
		t.Fatalf("expected one CREATE audit row, got %d", audited)
	}
	var published int
	if err := pools.Owner.QueryRow(ctx, `SELECT count(*) FROM outbox_event WHERE tenant_id = $1 AND aggregate_id = $2 AND event_type = 'CustomerOrderReceived'`, testkit.Tenant, order.ID).Scan(&published); err != nil {
		t.Fatal(err)
	}
	if published != 1 {
		t.Fatalf("expected the CustomerOrderReceived event, got %d", published)
	}

	// --- Document ----------------------------------------------------------
	content := base64.StdEncoding.EncodeToString([]byte("sku,qty\nX,1\n"))
	doc, err := svc.AttachDocument(ctx, testkit.Tenant, order.ID, DocumentInput{FileName: "po.csv", ContentType: "text/csv", SizeBytes: 12, Content: &content}, actor)
	if err != nil {
		t.Fatalf("attach: %v", err)
	}
	if doc.StorageURL == "" {
		t.Fatal("document must carry a URL")
	}
	objectID := regexp.MustCompile(`documents/([^/]+)/content`).FindStringSubmatch(doc.StorageURL)[1]
	bytes, contentType, err := svc.DocumentContent(ctx, testkit.Tenant, objectID)
	if err != nil || contentType != "text/csv" || string(bytes) != "sku,qty\nX,1\n" {
		t.Fatalf("read back: %q %s %v", bytes, contentType, err)
	}
	if _, err := svc.AttachDocument(ctx, testkit.Tenant, order.ID, DocumentInput{FileName: "x.exe", ContentType: "application/x-msdownload", SizeBytes: 3, Content: &content}, actor); err == nil {
		t.Fatal("unsupported type must be refused")
	}

	// --- Forecast as a job --------------------------------------------------
	periodStart := time.Now().AddDate(0, 1, 0).Format("2006-01") + "-01"
	periodEnd := time.Now().AddDate(0, 2, 0).Format("2006-01") + "-01"
	job, err := svc.EnqueueForecast(ctx, testkit.Tenant, GenerateForecastInput{PeriodStart: periodStart, PeriodEnd: periodEnd, LookbackMonths: 6}, actor)
	if err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	if job.Status != "PENDING" {
		t.Fatalf("job must be queued, not computed in the request: %s", job.Status)
	}
	runner := queue.NewRunner(jobs, svc.JobHandlers(), "testkit", log)
	ran, err := runner.RunOnce(ctx)
	if err != nil || ran == nil || ran.Status != "SUCCEEDED" {
		t.Fatalf("run: %+v %v", ran, err)
	}
	forecastID, _ := ran.Result["demandForecastId"].(string)
	forecast, err := svc.ForecastByID(ctx, testkit.Tenant, forecastID)
	if err != nil {
		t.Fatalf("forecast: %v", err)
	}
	if forecast.Status != "GENERATED" || forecast.LookbackMonths != 6 {
		t.Fatalf("forecast: %+v", forecast.Forecast)
	}
	for _, line := range forecast.Lines {
		if len(line.HistoricalDemand) != 6 {
			t.Fatalf("historical demand must carry the six lookback months: %v", line.HistoricalDemand)
		}
		if _, current := line.HistoricalDemand[time.Now().UTC().Format("2006-01")]; current {
			t.Fatal("the running month must be excluded")
		}
	}
	// Regenerate: the previous snapshot is superseded, its lines untouched.
	before := forecast.Lines
	if _, err := svc.RunForecast(ctx, testkit.Tenant, GenerateForecastInput{PeriodStart: periodStart, PeriodEnd: periodEnd, LookbackMonths: 6}, actor); err != nil {
		t.Fatalf("regenerate: %v", err)
	}
	reread, _ := svc.ForecastByID(ctx, testkit.Tenant, forecastID)
	if reread.Status != "SUPERSEDED" || len(reread.Lines) != len(before) {
		t.Fatalf("superseded forecast: %s lines %d/%d", reread.Status, len(reread.Lines), len(before))
	}

	// --- Capacity ------------------------------------------------------------
	assessment, err := svc.AssessProduct(ctx, testkit.Tenant, productID, periodStart, periodEnd, 6500)
	if err != nil {
		t.Fatalf("assess: %v", err)
	}
	if assessment.TotalCapacity < 0 || assessment.CapacityStatus == "" || assessment.PlanningCapacity+assessment.CapacityBuffer != assessment.TotalCapacity {
		t.Fatalf("assessment: %+v", assessment)
	}

	// --- Plan and demand aggregation -------------------------------------------
	plan, err := svc.CreatePlan(ctx, testkit.Tenant, CreatePlanInput{PeriodStart: periodStart, PeriodEnd: periodEnd}, actor)
	if err != nil {
		t.Fatalf("create plan: %v", err)
	}
	if !regexp.MustCompile(`^PLAN-\d{6}-\d{3}$`).MatchString(plan.PlanNumber) || plan.Status != "DRAFT" || plan.Version != 1 {
		t.Fatalf("plan: %+v", plan.ProductionPlan)
	}
	first, err := svc.AddDemand(ctx, testkit.Tenant, plan.ID, order.Lines[0].ID, nil, actor)
	if err != nil {
		t.Fatalf("add demand: %v", err)
	}
	secondDemand, err := svc.AddDemand(ctx, testkit.Tenant, plan.ID, second.ID, nil, actor)
	if err != nil {
		t.Fatalf("add second demand: %v", err)
	}
	if secondDemand.Line.ID != first.Line.ID || secondDemand.Line.DemandQuantity != 6500 {
		t.Fatalf("demand must aggregate into one plan line: %+v", secondDemand.Line)
	}
	if _, err := svc.AddDemand(ctx, testkit.Tenant, plan.ID, second.ID, nil, actor); err == nil {
		t.Fatal("re-adding a fully planned line must be refused")
	}
	orderAfter, _ := svc.Order(ctx, testkit.Tenant, order.ID)
	if orderAfter.Status != "PLANNED" || orderAfter.Lines[0].PlannedQuantity != 5000 {
		t.Fatalf("order must be PLANNED with planned quantity carried: %s %d", orderAfter.Status, orderAfter.Lines[0].PlannedQuantity)
	}
	readiness, err := svc.Readiness(ctx, testkit.Tenant, plan.ID)
	if err != nil || readiness.DemandCount != 2 || readiness.LineCount != 1 {
		t.Fatalf("readiness: %+v %v", readiness, err)
	}
	if err := AssertStepReachable(4, readiness); err == nil {
		t.Fatal("step 4 must be locked before work orders exist")
	}
	// Optimistic locking: a stale version is refused.
	if _, err := svc.UpdatePlan(ctx, testkit.Tenant, plan.ID, 99, PlanPatch{WizardStep: db.Ptr(2)}, actor); err == nil {
		t.Fatal("stale version must conflict")
	} else if e, ok := err.(*httpx.Error); !ok || e.Status != 409 {
		t.Fatalf("expected 409, got %v", err)
	}
	updated, err := svc.UpdatePlanLine(ctx, testkit.Tenant, plan.ID, first.Line.ID, db.Ptr(6500), nil, nil, actor)
	if err != nil || updated.PlannedQuantity != 6500 {
		t.Fatalf("update line: %+v %v", updated, err)
	}
	// Confirm is refused until work orders exist and are confirmed.
	if _, err := svc.ConfirmPlan(ctx, testkit.Tenant, plan.ID, actor); err == nil {
		t.Fatal("confirm must refuse without work orders")
	}

	// --- Cancel releases the demand ------------------------------------------
	if _, err := svc.CancelPlan(ctx, testkit.Tenant, plan.ID, "testkit selesai", actor); err != nil {
		t.Fatalf("cancel plan: %v", err)
	}
	released, _ := svc.Order(ctx, testkit.Tenant, order.ID)
	if released.Lines[0].PlannedQuantity != 0 || released.Lines[1].PlannedQuantity != 0 {
		t.Fatalf("cancel must return the planned quantity: %+v", released.Lines)
	}
	cancelled, err := svc.CancelOrder(ctx, testkit.Tenant, order.ID, "testkit selesai", actor)
	if err != nil || cancelled.Status != "CANCELLED" {
		t.Fatalf("cancel order: %+v %v", cancelled, err)
	}
	// The other tenant sees none of it.
	if err := pools.App.WithTenant(ctx, testkit.OtherTenant, func(tx pgx.Tx) error {
		var n int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM customer_order WHERE id = $1`, order.ID).Scan(&n); err != nil {
			return err
		}
		if n != 0 {
			t.Fatalf("cross-tenant read returned %d rows", n)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}
