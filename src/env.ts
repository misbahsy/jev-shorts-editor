/**
 * Minimal .env reader. Looks up a key in the process environment first, then in
 * the .env file at the repo root. NEVER logs, prints, or writes key values;
 * callers must not console.log the return values either.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Repo root is one level up from src/. */
export const REPO_ROOT = resolve(import.meta.dirname, "..");
const ENV_PATH = resolve(REPO_ROOT, ".env");

function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).replace(/^export\s+/, "").trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

let cached: Record<string, string> | null = null;
function loadEnvFile(): Record<string, string> {
  if (cached) return cached;
  cached = existsSync(ENV_PATH) ? parseEnvFile(readFileSync(ENV_PATH, "utf8")) : {};
  return cached;
}

/** Returns the named key, or throws (without leaking any value) if it is missing. */
export function requireEnv(name: string): string {
  const value = process.env[name] || loadEnvFile()[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Add a line like ${name}=... to ${ENV_PATH} (see .env.example), ` +
        `or export it in your shell.`,
    );
  }
  return value;
}

/** Returns the TypeSafe (Jev) API key. */
export function getApiKey(): string {
  return requireEnv("TYPESAFE_API_KEY");
}
