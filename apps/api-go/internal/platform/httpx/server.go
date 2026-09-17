package httpx

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"time"
)

// Server is http.Server with the timeouts a public API must set and a
// shutdown that lets in-flight requests finish.
//
// WriteTimeout stays zero on purpose: a CSV export or a large offline sync
// batch can legitimately take longer than any fixed number, and the per-route
// deadline (middleware.Timeout) is where slowness is bounded.
type Server struct {
	http *http.Server
	log  *slog.Logger
}

// NewServer builds the listener with production timeouts.
func NewServer(addr string, handler http.Handler, log *slog.Logger) *Server {
	return &Server{
		http: &http.Server{
			Addr:              addr,
			Handler:           handler,
			ReadHeaderTimeout: 10 * time.Second,
			ReadTimeout:       30 * time.Second,
			IdleTimeout:       120 * time.Second,
			MaxHeaderBytes:    64 << 10,
			ErrorLog:          slog.NewLogLogger(log.Handler(), slog.LevelWarn),
		},
		log: log,
	}
}

// Start serves until the context is cancelled, then drains for up to
// `grace`. Returns nil on a clean stop.
func (s *Server) Start(ctx context.Context, grace time.Duration) error {
	ln, err := net.Listen("tcp", s.http.Addr)
	if err != nil {
		return fmt.Errorf("listen %s: %w", s.http.Addr, err)
	}

	errCh := make(chan error, 1)
	go func() {
		if err := s.http.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
		close(errCh)
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
	}

	// Stop accepting, let what is in flight finish: a deploy must not cut a
	// production capture off in the middle of its transaction.
	shutdownCtx, cancel := context.WithTimeout(context.Background(), grace)
	defer cancel()
	if err := s.http.Shutdown(shutdownCtx); err != nil {
		s.log.Warn("http: forced close after grace period", "error", err)
		return s.http.Close()
	}
	return nil
}

// Addr is the bound address, useful when Port is 0 in tests.
func (s *Server) Addr() string { return s.http.Addr }
