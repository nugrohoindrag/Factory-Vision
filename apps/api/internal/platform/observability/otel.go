package observability

import (
	"context"
	"net/http"
	"time"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

// Tracing is the OpenTelemetry pipeline, active only when an OTLP endpoint
// is configured. Without one the middleware is not installed at all, so a
// plant that runs no collector pays nothing for the option.
type Tracing struct {
	provider *sdktrace.TracerProvider
}

// StartTracing wires an OTLP/HTTP exporter from the standard environment
// (OTEL_EXPORTER_OTLP_ENDPOINT and friends). Returns nil when disabled.
func StartTracing(ctx context.Context, endpoint, serviceName, version string) (*Tracing, error) {
	if endpoint == "" {
		return nil, nil
	}
	exporter, err := otlptracehttp.New(ctx)
	if err != nil {
		return nil, err
	}
	res, err := resource.Merge(resource.Default(), resource.NewWithAttributes(
		semconv.SchemaURL,
		semconv.ServiceName(serviceName),
		semconv.ServiceVersion(version),
	))
	if err != nil {
		return nil, err
	}
	provider := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(res),
	)
	otel.SetTracerProvider(provider)
	return &Tracing{provider: provider}, nil
}

// Middleware instruments every request with a span named after its route.
func (t *Tracing) Middleware(next http.Handler) http.Handler {
	if t == nil {
		return next
	}
	return otelhttp.NewHandler(next, "http", otelhttp.WithSpanNameFormatter(func(_ string, r *http.Request) string {
		return r.Method + " " + r.URL.Path
	}))
}

// Shutdown flushes pending spans.
func (t *Tracing) Shutdown(ctx context.Context) error {
	if t == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return t.provider.Shutdown(ctx)
}
