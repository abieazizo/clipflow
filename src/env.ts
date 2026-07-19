/**
 * env.ts — load a local .env file into process.env, once, as a side effect.
 *
 * Import this FIRST (before appconfig or anything that reads process.env):
 *   import "./env.js";
 *
 * Deliberately dependency-free (no dotenv): the project ships no framework, so
 * neither does its config. Real environment variables always win — a value
 * already present in process.env is never overwritten by the file. That means
 * `PORT=5000 npm run app` still beats whatever .env says.
 *
 * Supported lines: KEY=value, # comments, blank lines, optional surrounding
 * single/double quotes, and `export KEY=value`.
 */

import { readFileSync, existsSync } from "node:fs";

function parseAndApply(text: string): void {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const withoutExport = line.startsWith("export ") ? line.slice(7).trim() : line;
    const eq = withoutExport.indexOf("=");
    if (eq === -1) continue;

    const key = withoutExport.slice(0, eq).trim();
    if (!key) continue;

    let value = withoutExport.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // real env wins; only fill what isn't already set
    if (!(key in process.env)) process.env[key] = value;
  }
}

export function loadEnv(path = process.env.DOTENV_PATH || ".env"): void {
  if (!existsSync(path)) return;
  try {
    parseAndApply(readFileSync(path, "utf8"));
  } catch {
    // an unreadable .env should never crash boot — real env vars still apply
  }
}

// Run on import so a bare `import "./env.js"` is enough.
loadEnv();
