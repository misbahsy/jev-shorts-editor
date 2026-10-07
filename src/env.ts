/**
 * Minimal .env reader. Looks up a key in the process environment first, then in
 * the .env file at the repo root. NEVER logs, prints, or writes key values;
 * callers must not console.log the return values either.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Repo root is one level up from src/. */
export const REPO_ROOT = resolve(import.meta.dirname, "..");

/**
 * In a linked git worktree the checkout has no .env of its own, so fall back to the
 * main checkout's. A worktree's .git is a file reading "gitdir: <main>/.git/worktrees/<name>".
 */
function findEnvPath(): string {
  const own = resolve(REPO_ROOT, ".env");
  if (existsSync(own)) return own;
  const gitFile = resolve(REPO_ROOT, ".git");
  try {
    const m = /^gitdir:\s*(.+?)[\\/]\.git[\\/]worktrees[\\/]/m.exec(readFileSync(gitFile, "utf8"));
    if (m) {
      const main = resolve(m[1], ".env");
      if (existsSync(main)) return main;
    }
  } catch {
    // .git is a directory (normal checkout) or missing: keep the default.
  }
  return own;
}
const ENV_PATH = findEnvPath();

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

/** Returns the named value if it is set, without throwing. */
export function optionalEnv(name: string): string | undefined {
  return process.env[name] || loadEnvFile()[name] || undefined;
}

/** Where Jev decision requests go, and with which key and model name. */
export interface JevTarget {
  via: "typesafe" | "litellm";
  url: string;
  model: string;
  apiKey: string;
}

/**
 * Direct to TypeSafe by default. When LITELLM_BASE_URL is set, requests go to that
 * gateway's /v1/decisions route instead, authenticated with LITELLM_API_KEY, and
 * JEV_MODEL names the gateway's model group (default "jev").
 */
export function getJevTarget(): JevTarget {
  const gateway = optionalEnv("LITELLM_BASE_URL");
  if (gateway) {
    return {
      via: "litellm",
      url: `${gateway.replace(/\/+$/, "")}/v1/decisions`,
      model: optionalEnv("JEV_MODEL") ?? "jev",
      apiKey: requireEnv("LITELLM_API_KEY"),
    };
  }
  return {
    via: "typesafe",
    url: "https://api.typesafe.ai/v1/systemone",
    model: optionalEnv("JEV_MODEL") ?? "jev-latest",
    apiKey: requireEnv("TYPESAFE_API_KEY"),
  };
}
