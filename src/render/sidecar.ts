// Thin JSON-lines client for the web-renderer Swift sidecar (native/WebRenderer.swift).
// The binary is compiled into bin/ on first use (or by `npm run build:renderer`).
// Protocol:
//   each request line: {"id": number, "op": string, "windowId"?: number, "args"?: object}
//   each reply line:    {"id": number, "ok": boolean, "value"?: any, "error"?: string}
// Ops used here: create, setBackgroundColor, loadFile, evaluate, capture, destroy.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

export interface SidecarHandle {
  request(op: string, windowId: number | undefined, args?: Record<string, unknown>): Promise<any>;
  close(): void;
}

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SWIFT_SRC = path.join(REPO_ROOT, "native", "WebRenderer.swift");
const BIN_PATH = path.join(REPO_ROOT, "bin", "jev-web-renderer");

/** Compiles native/WebRenderer.swift into bin/jev-web-renderer. Exported for scripts/build-renderer.ts. */
export function buildSidecarBinary(): string {
  mkdirSync(path.dirname(BIN_PATH), { recursive: true });
  const arch = process.arch === "arm64" ? "arm64" : "x86_64";
  try {
    execFileSync("xcrun", [
      "swiftc", "-O",
      "-target", `${arch}-apple-macos15.0`,
      "-framework", "AppKit",
      "-framework", "AVFoundation",
      "-framework", "CoreImage",
      "-framework", "CoreVideo",
      "-framework", "Vision",
      "-framework", "WebKit",
      SWIFT_SRC,
      "-o", BIN_PATH,
    ], { stdio: ["ignore", "pipe", "pipe"] });
  } catch (err: any) {
    const stderr = err?.stderr?.toString?.() ?? "";
    throw new Error(
      `Could not compile the web renderer (${SWIFT_SRC}). Install the Xcode command line tools ` +
        `(xcode-select --install) and try again.\n${stderr.slice(-2000)}`,
    );
  }
  return BIN_PATH;
}

export function resolveSidecarBinary(): string {
  const stale = !existsSync(BIN_PATH) || statSync(BIN_PATH).mtimeMs < statSync(SWIFT_SRC).mtimeMs;
  return stale ? buildSidecarBinary() : BIN_PATH;
}

export function startSidecar(): SidecarHandle {
  const bin = resolveSidecarBinary();
  const child: ChildProcessWithoutNullStreams = spawn(bin, [], { stdio: ["pipe", "pipe", "pipe"] });
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  let stderrTail = "";
  child.stderr.on("data", (d) => {
    stderrTail = (stderrTail + d.toString()).slice(-4000);
  });
  const rl = createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return; // non-JSON stray output; ignore
    }
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.value);
    else p.reject(new Error(String(msg.error)));
  });
  let exited: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  child.on("exit", (code, signal) => {
    exited = { code, signal };
    for (const [, p] of pending) p.reject(new Error(`sidecar exited (code=${code} signal=${signal}) stderr=${stderrTail}`));
    pending.clear();
  });

  return {
    request(op, windowId, args) {
      if (exited) return Promise.reject(new Error(`sidecar already exited: ${JSON.stringify(exited)}`));
      const id = nextId++;
      const cmd = { id, op, windowId, args: args ?? {} };
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        child.stdin.write(JSON.stringify(cmd) + "\n");
      });
    },
    close() {
      try {
        child.stdin.end();
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, 500);
    },
  };
}
