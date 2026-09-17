// Package migrate is the migration runner that ships inside the API image.
//
// `pnpm db:migrate` needs a source checkout, which a pull-based deployment
// does not have: the VPS pulls images and never clones the repository. The
// schema still has to be applied before the API will start, so the SQL
// travels with the image and `fv migrate` applies it:
//
//	docker compose -f deploy/docker-compose.yml --profile migrate run --rm migrate
//
// It stays a deliberate, separate step rather than something the API does on
// boot. Migrations are the one part of a deployment that can destroy data,
// and §18 of the deployment doc is explicit that they run under supervision,
// not as a side effect of a container restarting.
package migrate

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
)

// Options shape one run. Every field mirrors the environment variable the
// Node runner read, so a compose file written for it still works.
type Options struct {
	// DatabaseURL is the schema owner connection (MIGRATE_DATABASE_URL, else
	// DATABASE_URL).
	DatabaseURL string
	// Root holds migrations/ and seeds/ (MIGRATIONS_DIR, default ./db).
	Root string
	// AppRole and AppPassword give the RLS-bound application role its
	// password; migration 004 creates it NOLOGIN precisely so no credential
	// lives in a committed .sql file (APP_DB_USER, APP_DB_PASSWORD).
	AppRole     string
	AppPassword string
	// SeedDemoData applies seeds/ after the migrations (SEED_DEMO_DATA).
	SeedDemoData bool
	// Out receives the progress lines.
	Out io.Writer
}

// Run applies every migrations/*.sql in name order, grants the app role its
// login, and applies seeds/*.sql when the demo data is on. It returns the
// number of migration files applied; any failure stops the run, because a
// swallowed one would let the API start against a half-applied schema.
func Run(ctx context.Context, opts Options) (int, error) {
	if opts.DatabaseURL == "" {
		return 0, errors.New("set MIGRATE_DATABASE_URL (or DATABASE_URL) to the schema owner connection")
	}
	if opts.Root == "" {
		opts.Root = "db"
	}
	if opts.AppRole == "" {
		opts.AppRole = "factory_app"
	}
	if opts.Out == nil {
		opts.Out = io.Discard
	}
	conn, err := pgx.Connect(ctx, opts.DatabaseURL)
	if err != nil {
		return 0, err
	}
	defer conn.Close(context.Background())

	migrations, err := applyDirectory(ctx, conn, filepath.Join(opts.Root, "migrations"), "migration", opts.Out)
	if err != nil {
		return 0, err
	}
	if err := grantAppRoleLogin(ctx, conn, opts); err != nil {
		return 0, err
	}
	if opts.SeedDemoData {
		if _, err := applyDirectory(ctx, conn, filepath.Join(opts.Root, "seeds"), "seed", opts.Out); err != nil {
			return 0, err
		}
	}
	fmt.Fprintf(opts.Out, "[migrate] %d migration file(s) applied.\n", migrations)
	return migrations, nil
}

// applyDirectory runs each .sql file in name order. A file is one
// multi-statement script sent as a whole, as the Node runner sent it, so a
// migration's own transaction blocks keep their meaning.
func applyDirectory(ctx context.Context, conn *pgx.Conn, dir, label string, out io.Writer) (int, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			fmt.Fprintf(out, "[migrate] %s directory not found at %s, skipping.\n", label, dir)
			return 0, nil
		}
		return 0, err
	}
	var files []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".sql") {
			files = append(files, e.Name())
		}
	}
	sort.Strings(files)
	for _, file := range files {
		fmt.Fprintf(out, "[migrate] %s: %s\n", label, file)
		sql, err := os.ReadFile(filepath.Join(dir, file))
		if err != nil {
			return 0, err
		}
		if _, err := conn.Exec(ctx, string(sql)); err != nil {
			return 0, fmt.Errorf("%s %s: %w", label, file, err)
		}
	}
	return len(files), nil
}

func grantAppRoleLogin(ctx context.Context, conn *pgx.Conn, opts Options) error {
	if opts.AppPassword == "" {
		fmt.Fprintf(opts.Out, "[migrate] APP_DB_PASSWORD is not set, so %s stays NOLOGIN. The API connects as that role; connecting as the bootstrap superuser instead would bypass row-level security.\n", opts.AppRole)
		return nil
	}
	var ident, literal string
	if err := conn.QueryRow(ctx, `SELECT quote_ident($1), quote_literal($2)`, opts.AppRole, opts.AppPassword).Scan(&ident, &literal); err != nil {
		return err
	}
	if _, err := conn.Exec(ctx, `ALTER ROLE `+ident+` LOGIN PASSWORD `+literal); err != nil {
		return err
	}
	fmt.Fprintf(opts.Out, "[migrate] %s can now log in (NOSUPERUSER, NOBYPASSRLS).\n", opts.AppRole)
	return nil
}
