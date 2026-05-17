/**
 * `defineCommand({ schema, handler })` — declares an "API
 * function" with a zod-typed signature.
 *
 *   - Callable directly: `await chart({ symbol: "SPY" })` —
 *     return type is inferred from the handler.
 *   - Stored uniformly in `createCli({ commands })` via the
 *     variance-neutral `StoredCommand` view.
 */

import type { z } from "zod"
import type { CommandDef, CommandFn } from "../types"

export function defineCommand<S extends z.ZodObject, R>(
  def: CommandDef<S, R>,
): CommandFn<S, Awaited<R>> {
  const invoke = async (args: unknown): Promise<unknown> => {
    const parsed = def.schema.parse(args) as z.infer<S>
    return def.handler(parsed)
  }

  const fn = async (args: z.input<S>): Promise<Awaited<R>> =>
    invoke(args) as Promise<Awaited<R>>

  // Function `name` is read-only-but-configurable on async arrow
  // fns; Object.assign throws under strict mode. Use
  // defineProperty for each prop so we can also keep them
  // non-enumerable (cleaner reflection).
  defineProp(fn, "name", def.name)
  defineProp(fn, "description", def.description)
  defineProp(fn, "schema", def.schema)
  defineProp(fn, "positional", def.positional ?? [])
  defineProp(fn, "invoke", invoke)
  defineProp(fn, "def", def)

  return fn as unknown as CommandFn<S, Awaited<R>>
}

function defineProp(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    writable: false,
    enumerable: false,
    configurable: true,
  })
}
