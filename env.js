// Loads .env at startup using Node's built-in loader (no dotenv dependency).
// Import this module before any code that reads process.env.*
// (db.js and server.js both import it; it is idempotent).
import { loadEnvFile } from 'node:process';

let loaded = false;
if (!loaded) {
  loaded = true;
  try {
    loadEnvFile();
  } catch (err) {
    // No .env file is fine — all variables have sensible defaults.
    if (err && err.code !== 'ENOENT') throw err;
  }
}

/** True when running in production (NODE_ENV === 'production'). */
export const isProduction = () => process.env.NODE_ENV === 'production';

/**
 * Whether the demo-only "Reset Sample Data" action is enabled.
 * The reset wipes real financial records, so it must never be reachable in a
 * production UI or API. Outside production, DEMO_MODE=false disables it.
 */
export const demoResetEnabled = () =>
  !isProduction() && process.env.DEMO_MODE !== 'false';
