// bench is the closed-loop load generator behind the README's performance
// baseline: N workers each issue the next request the moment the previous
// one answers, for a fixed number of seconds per endpoint, and the latencies
// are reported as rps and p50 / p95 / p99. It is written in Go rather than
// as a Node script because a JavaScript fetch loop tops out around a
// thousand requests a second on one core and would measure itself.
//
//	BOOTSTRAP_ADMIN_PASSWORD=... go run ./cmd/bench -base http://localhost:4000 -workers 32 -seconds 5
//
// Nothing here writes. Run it on the machine that hosts the API: this is a
// measurement of the API, not of the network.
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"time"
)

func main() {
	base := flag.String("base", "http://localhost:4000", "API base URL")
	workers := flag.Int("workers", 32, "concurrent workers")
	seconds := flag.Int("seconds", 5, "seconds per endpoint")
	list := flag.String("endpoints", "/api/v1/master/products,/api/v1/master/machines,/api/v1/roles,/api/v1/events?limit=200,/api/v1/auth/session,/api/v1/work-orders,/api/v1/analytics/executive-kpi,/api/v1/analytics/live-board", "comma-separated paths")
	flag.Parse()

	email := env("BOOTSTRAP_ADMIN_EMAIL", "admin@pabrik.co.id")
	password := os.Getenv("BOOTSTRAP_ADMIN_PASSWORD")
	tenant := env("DEFAULT_TENANT_ID", "tenant-pilot-factory-01")
	if password == "" {
		fmt.Fprintln(os.Stderr, "set BOOTSTRAP_ADMIN_PASSWORD")
		os.Exit(2)
	}
	client := &http.Client{Transport: &http.Transport{MaxIdleConns: *workers * 2, MaxIdleConnsPerHost: *workers * 2, IdleConnTimeout: 90 * time.Second}, Timeout: 30 * time.Second}

	body, _ := json.Marshal(map[string]string{"email": email, "password": password})
	req, _ := http.NewRequest(http.MethodPost, strings.TrimRight(*base, "/")+"/api/v1/auth/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Tenant-Id", tenant)
	resp, err := client.Do(req)
	if err != nil {
		fmt.Fprintln(os.Stderr, "login:", err)
		os.Exit(1)
	}
	var login struct {
		Token string `json:"token"`
	}
	raw, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 200 || json.Unmarshal(raw, &login) != nil || login.Token == "" {
		fmt.Fprintf(os.Stderr, "login %d: %s\n", resp.StatusCode, raw)
		os.Exit(1)
	}

	get := func(path string) (int, error) {
		r, _ := http.NewRequest(http.MethodGet, strings.TrimRight(*base, "/")+path, nil)
		r.Header.Set("Authorization", "Bearer "+login.Token)
		r.Header.Set("X-Tenant-Id", tenant)
		res, err := client.Do(r)
		if err != nil {
			return 0, err
		}
		_, _ = io.Copy(io.Discard, res.Body)
		res.Body.Close()
		return res.StatusCode, nil
	}

	endpoints := strings.Split(*list, ",")
	// Warm-up: caches and connection pools in their steady state.
	for _, p := range endpoints {
		for i := 0; i < 20; i++ {
			_, _ = get(strings.TrimSpace(p))
		}
	}

	fmt.Printf("%s — %d workers × %ds per endpoint\n\n", *base, *workers, *seconds)
	fmt.Println("| Endpoint | rps | p50 / p95 / p99 (ms) | errors |")
	fmt.Println("|---|---|---|---|")
	for _, p := range endpoints {
		p = strings.TrimSpace(p)
		var mu sync.Mutex
		var latencies []float64
		errors := 0
		deadline := time.Now().Add(time.Duration(*seconds) * time.Second)
		var wg sync.WaitGroup
		for w := 0; w < *workers; w++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				local := make([]float64, 0, 4096)
				failed := 0
				for time.Now().Before(deadline) {
					started := time.Now()
					status, err := get(p)
					if err != nil || status >= 400 {
						failed++
					}
					local = append(local, float64(time.Since(started).Microseconds())/1000)
				}
				mu.Lock()
				latencies = append(latencies, local...)
				errors += failed
				mu.Unlock()
			}()
		}
		wg.Wait()
		sort.Float64s(latencies)
		rps := float64(len(latencies)) / float64(*seconds)
		fmt.Printf("| `%s` | %s | %.1f / %.1f / %.1f | %d |\n", strings.TrimPrefix(p, "/api/v1"), thousands(int(rps)), pct(latencies, 50), pct(latencies, 95), pct(latencies, 99), errors)
	}
}

func pct(sorted []float64, p float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	idx := int(p/100*float64(len(sorted))+0.999999) - 1
	if idx < 0 {
		idx = 0
	}
	if idx >= len(sorted) {
		idx = len(sorted) - 1
	}
	return sorted[idx]
}

func thousands(n int) string {
	s := fmt.Sprint(n)
	if len(s) <= 3 {
		return s
	}
	var out []string
	for len(s) > 3 {
		out = append([]string{s[len(s)-3:]}, out...)
		s = s[:len(s)-3]
	}
	return s + " " + strings.Join(out, " ")
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
