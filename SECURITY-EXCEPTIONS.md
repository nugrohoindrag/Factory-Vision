# Security exceptions

Known findings that are accepted for now, with the reason and the date they
are reviewed again. An exception with no owner and no review date is not an
exception, it is a finding somebody stopped looking at.

The Cyber Security Requirement (§47) asks for vulnerabilities to be tracked
with severity and status; this is that register for the ones we have chosen
not to fix immediately.

| ID | Finding | Severity | Where | Why accepted | Owner | Review |
|---|---|---|---|---|---|---|
| EX-001 | `vite` — `server.fs.deny` bypass on Windows (GHSA-fx2h-pf6j-xcff), all 5.x | High (dev), none in production | `apps/console`, `apps/operator`, `apps/admin`, `apps/landing` — devDependency | The advisory is against the **development server**. Production serves a pre-built static bundle from nginx; no Vite dev server runs in any deployed image, and `pnpm audit --prod` is clean. The fix requires Vite 6+, a migration across four apps that is not a security change and should not ride in with one. | Engineering | 2026-12-01, or sooner if a Vite 6 migration lands |
| EX-002 | `esbuild` — dev server request forgery; `launch-editor` NTLM hash disclosure; `qs` array-limit / DoS | Moderate | Build and test tooling only | Same shape as EX-001: reachable only through developer tooling. `qs` enters through the dev server stack, not through the API, which uses Express 4's own parser. | Engineering | 2026-12-01 |

## How this register is used

- CI blocks on the production dependency tree: `pnpm audit --prod --audit-level high`.
- CI reports the full tree without blocking, so a new dev-tooling advisory is
  visible in the run log rather than silently ignored.
- Anything that is reachable from a deployed image is **not** eligible for this
  register. It gets fixed, or the release waits.
- Every row is re-read at its review date. If the reason no longer holds, the
  row is deleted and the finding goes back into the backlog.
