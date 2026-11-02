/**
 * Loads a local `.env` before anything else reads `process.env`.
 *
 * `server/index.ts` imports this module first: ES module evaluation follows the
 * import order, so the file is read before `db.ts` chooses its data directory or
 * the jobs worker chooses its media directory. Variables already present in the
 * environment win over the file (that is Node's own `loadEnvFile` rule), so a
 * host's configuration is never overridden by a checked-out `.env`.
 *
 * The file is resolved from this module's location, not the shell's cwd, so
 * `npm run dev` behaves the same from anywhere.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FILE = fileURLToPath(new URL('../.env', import.meta.url));

if (existsSync(FILE)) process.loadEnvFile(FILE);

/** The `.env` that was read, or `null` when the app runs from the environment alone. */
export const ENV_FILE = existsSync(FILE) ? FILE : null;
