import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

/**
 * Loads `.env` before anything reads it.
 *
 * This is imported first by `main.ts`, because ES modules evaluate in import
 * order and `platform/bootstrap` refuses to start without `DATABASE_URL`. The
 * API used to load nothing at all: it worked only for whoever happened to have
 * the variables exported in their shell, and `pnpm dev` failed on a clean
 * checkout with an error that pointed at the database rather than at the
 * missing file.
 *
 * Two files are read, in order of precedence:
 *
 *  1. `apps/api/.env` — the app's own overrides, if any;
 *  2. the repository root `.env` — the one the workspace scripts share.
 *
 * `dotenv` never overwrites a variable the process was already given, so this
 * changes nothing under docker compose, where the environment is authoritative.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

// From `src/platform` in development and `dist/platform` in a build, the
// repository root is three levels up either way.
const repoRoot = path.resolve(here, '../../../..');

dotenv.config();
dotenv.config({ path: path.resolve(repoRoot, '.env') });
