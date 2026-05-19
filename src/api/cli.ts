/**
 * `addApiCli(program, api)` — adds an
 * `api <endpoint> [--flag value]...` subcommand tree that exposes
 * every endpoint in the schema as a commander child command,
 * walking each endpoint's zod params shape (or baseParams +
 * selectKey for dependent endpoints) to generate one `--flag`
 * per key.
 *
 * Takes the variance-neutral `StoredApi` view so specific clients
 * fit via the covariant `__spec` property without `any`.
 */

import type { Command } from "commander"
import { z } from "zod"
import type { AnyEndpointSpec, StoredApi } from "../types"
import { collectArgs, walkSchemaToCommander } from "../cli/walker"
import type { EmitMode } from "../cli/emit"
import { emit, mapError } from "../cli/emit"
import { callDependent, callEndpoint, isDependentEndpoint } from "./call"

function rootProgram(cmd: Command): Command {
  let cur = cmd
  while (cur.parent) cur = cur.parent
  return cur
}

function modeFromRoot(cmd: Command): EmitMode | undefined {
  const opts = rootProgram(cmd).opts()
  if (opts.json) return "json"
  if (opts.pretty) return "pretty"
  return undefined
}

export interface AddApiCliOptions {
  /** Sub-name under which to register the endpoint tree. Default: "api". */
  commandName?: string
  /** Prefix used in error output. Defaults to `api.__spec.name`. */
  errorName?: string
  /** Mapped to `<name>: <msg>` + exit 1. Other errors fall through generically. */
  errorClass?: new (msg: string) => Error
}

export function addApiCli(
  program: Command,
  api: StoredApi,
  opts: AddApiCliOptions = {},
): void {
  const commandName = opts.commandName ?? "api"
  const errorName = opts.errorName ?? api.__spec.name

  const apiCmd = program
    .command(commandName)
    .description(`Direct API access for ${api.__spec.name}`)

  for (const [endpointName, endpoint] of Object.entries(api.__spec.endpoints)) {
    registerEndpoint(apiCmd, api, endpointName, endpoint, {
      errorName,
      errorClass: opts.errorClass,
    })
  }
}

// ---------------------------------------------------------------------------
// Per-endpoint registration
// ---------------------------------------------------------------------------

interface ErrOpts {
  errorName: string
  errorClass?: new (msg: string) => Error
}

function registerEndpoint(
  parent: Command,
  api: StoredApi,
  name: string,
  endpoint: AnyEndpointSpec,
  errOpts: ErrOpts,
): void {
  const sub = parent.command(name)
  if (endpoint.description) sub.description(endpoint.description)

  if (isDependentEndpoint(endpoint)) {
    registerDependent(sub, api, endpoint, errOpts)
    return
  }

  walkSchemaToCommander(sub, endpoint.params)
  sub.action(async (...argv: unknown[]) => {
    try {
      const args = collectArgs(endpoint.params, [], argv)
      const result = await callEndpoint(api.__spec, endpoint, args)
      emit(result, { mode: modeFromRoot(sub) })
    } catch (err) {
      mapError(err, errOpts.errorName, errOpts.errorClass)
    }
  })
}

/**
 * Dependent endpoint: walk baseParams as flags + add the
 * selectKey as a comma-separated string-array option whose
 * allowed values come from `selectMap` keys.
 */
function registerDependent(
  sub: Command,
  api: StoredApi,
  endpoint: Extract<AnyEndpointSpec, { readonly __dependent: true }>,
  errOpts: ErrOpts,
): void {
  walkSchemaToCommander(sub, endpoint.baseParams)

  const validKeys = Object.keys(endpoint.selectMap)
  const selectFlag = `--${kebab(endpoint.selectKey)} <${validKeys.join("|")}>`
  sub.requiredOption(
    selectFlag,
    `Comma-separated: ${validKeys.join(", ")}`,
  )

  // For `collectArgs` to find the select key with the right
  // coercion (array), we synthesize a schema that mirrors what
  // the action will receive: baseParams + selectKey: array<string>.
  const fullSchema = z.object({
    ...endpoint.baseParams.shape,
    [endpoint.selectKey]: z.array(z.string()),
  })

  sub.action(async (...argv: unknown[]) => {
    try {
      const args = collectArgs(fullSchema, [], argv)
      const result = await callDependent(api.__spec, endpoint, args)
      emit(result, { mode: modeFromRoot(sub) })
    } catch (err) {
      mapError(err, errOpts.errorName, errOpts.errorClass)
    }
  })
}

function kebab(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
}
