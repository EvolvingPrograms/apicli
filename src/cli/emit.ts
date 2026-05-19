/**
 * Output emission + error mapping for the CLI runtime.
 *
 * Two output modes:
 *
 *   - **pretty** (default): `console.table(value)` — Node/Bun's
 *     built-in renderer. Auto-promotes one level of nested object
 *     keys into sibling columns; deeper nesting falls back to
 *     `util.inspect`. Good for humans *and* agents — Claude reads
 *     tables more reliably than JSON.
 *
 *   - **json**: `JSON.stringify(value) + "\n"` — for pipes, scripts,
 *     or anything that wants the raw shape.
 *
 * Precedence (highest wins):
 *
 *   1. Explicit `--json` or `--pretty` on the CLI invocation.
 *   2. `JSON=1` / `PRETTY=1` in the environment — shifts the *default*
 *      for an entire shell session without having to pass the flag
 *      every time. An explicit flag still overrides.
 *   3. Built-in default: pretty.
 *
 * We deliberately do NOT check `process.stdout.isTTY`: agents and
 * subprocesses run without a TTY, and the point of `pretty` as the
 * default is that *everyone* reads tables better than raw JSON.
 * Force JSON explicitly when you actually want it.
 */

import { z } from "zod"

export type EmitMode = "pretty" | "json"

export interface EmitOptions {
  /** Explicit mode chosen at the CLI level (from `--json` / `--pretty`). */
  mode?: EmitMode
}

function envFlag(name: string): boolean {
  const v = process.env[name]
  if (!v) return false
  return v !== "0" && v.toLowerCase() !== "false"
}

/**
 * The mode that would be chosen with no explicit flag — derived
 * from `PRETTY` / `JSON` env vars, falling back to `pretty`. Used
 * both by `emit` (runtime selection) and by `createCli` (so
 * `--help` can mark the currently-active default).
 */
export function resolveDefaultMode(): EmitMode {
  // `PRETTY=1` is the no-op default, but we honour it so a shell
  // can pin the mode unambiguously even if `JSON=1` is exported
  // elsewhere. Explicit pretty beats implicit json.
  if (envFlag("PRETTY")) return "pretty"
  if (envFlag("JSON")) return "json"
  return "pretty"
}

function resolveMode(opts: EmitOptions): EmitMode {
  // Explicit flag wins, otherwise fall through to env-derived default.
  if (opts.mode) return opts.mode
  return resolveDefaultMode()
}

export function emit(value: unknown, opts: EmitOptions = {}): void {
  const mode = resolveMode(opts)
  if (mode === "json") {
    process.stdout.write(JSON.stringify(value) + "\n")
    return
  }
  console.table(value)
}

export function mapError(
  err: unknown,
  name: string,
  errorClass?: new (msg: string) => Error,
): never {
  if (errorClass && err instanceof errorClass) {
    process.stderr.write(`${name}: ${err.message}\n`)
    process.exit(1)
  }

  if (err instanceof z.ZodError) {
    process.stderr.write(`${name}: invalid input\n${z.prettifyError(err)}\n`)
    process.exit(1)
  }

  const message = err instanceof Error ? err.message : String(err)
  process.stderr.write(`${name}: ${message}\n`)
  process.exit(1)
}
