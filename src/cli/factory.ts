/**
 * `createCli({ commands, api? })` — wires a set of friendly
 * commands and (optionally) a typed API client into a commander
 * program with JSON-on-stdout emission and centralised error
 * mapping.
 */

import { Command } from "commander"
import { addApiCli } from "../api/cli"
import type { Cli, CreateCliOptions, StoredCommand } from "../types"
import type { EmitMode } from "./emit"
import { emit, mapError, resolveDefaultMode } from "./emit"
import { collectArgs, walkSchemaToCommander } from "./walker"

export function createCli(opts: CreateCliOptions): Cli {
  const program = new Command().name(opts.name).description(opts.description)

  // Program-level output mode flags. Default is `pretty` (a
  // formatted table via `console.table`); `--json` opts out into
  // raw JSON. `JSON=1` / `PRETTY=1` in the env shift the default
  // for a shell session, and the `(default)` annotation in `--help`
  // reflects whichever mode is currently active — an explicit flag
  // always overrides at call time.
  const defaultMode = resolveDefaultMode()

  program
    .option(
      "--json",
      defaultMode === "json" ? "Emit raw JSON (default)." : "Emit raw JSON.",
    )
    .option(
      "--pretty",
      defaultMode === "pretty"
        ? "Emit a formatted table (default)."
        : "Emit a formatted table.",
    )

  for (const cmd of opts.commands) {
    registerCommand(program, cmd, opts)
  }

  if (opts.api) {
    addApiCli(program, opts.api, {
      errorName: opts.name,
      errorClass: opts.errorClass,
    })
  }

  return {
    program,
    run: async () => {
      await program.parseAsync()
    },
  }
}

function registerCommand(
  program: Command,
  cmd: StoredCommand,
  cliOpts: CreateCliOptions,
): void {
  const sub = program.command(cmd.name)
  if (cmd.description) sub.description(cmd.description)

  walkSchemaToCommander(sub, cmd.schema, { positional: cmd.positional })

  sub.action(async (...argv: unknown[]) => {
    try {
      const argsIn = collectArgs(cmd.schema, cmd.positional, argv)
      const result = await cmd.invoke(argsIn)

      // `program.opts()` reads parent-level options. Commander accepts
      // the flag in either position (`cli --json list` or `cli list --json`).
      // Explicit `--json` / `--pretty` beats env defaults inside `emit`.
      const programOpts = program.opts()
      const mode: EmitMode | undefined = programOpts.json
        ? "json"
        : programOpts.pretty
          ? "pretty"
          : undefined

      emit(result, { mode })
    } catch (err) {
      mapError(err, cliOpts.name, cliOpts.errorClass)
    }
  })
}
