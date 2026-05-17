/**
 * `createCli({ commands, api? })` — wires a set of friendly
 * commands and (optionally) a typed API client into a commander
 * program with JSON-on-stdout emission and centralised error
 * mapping.
 */

import { Command } from "commander"
import { addApiCli } from "../api/cli"
import type { Cli, CreateCliOptions, StoredCommand } from "../types"
import { emit, mapError } from "./emit"
import { collectArgs, walkSchemaToCommander } from "./walker"

export function createCli(opts: CreateCliOptions): Cli {
  const program = new Command().name(opts.name).description(opts.description)

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
      emit(result)
    } catch (err) {
      mapError(err, cliOpts.name, cliOpts.errorClass)
    }
  })
}
