import { beforeEach, describe, expect, test } from "bun:test"
import { Command } from "commander"
import { z } from "zod"
import { collectArgs, walkSchemaToCommander } from "./walker"

function newCommand(): Command {
  // exitOverride keeps commander from calling process.exit when
  // a required option is missing during tests.
  return new Command().exitOverride()
}

describe("walkSchemaToCommander — flag generation", () => {
  let cmd: Command
  beforeEach(() => {
    cmd = newCommand()
  })

  test("adds a mandatory option for a plain string (must be provided)", () => {
    walkSchemaToCommander(cmd, z.object({ name: z.string() }))
    const opt = cmd.options.find((o) => o.long === "--name")
    expect(opt).toBeDefined()
    // commander: `mandatory` = the flag itself must appear in argv.
    // (`required` is about the value placeholder, which is always
    // required for `--key <v>` form.)
    expect(opt?.mandatory).toBe(true)
  })

  test("--key for optional fields is not mandatory", () => {
    walkSchemaToCommander(cmd, z.object({ from: z.string().optional() }))
    const opt = cmd.options.find((o) => o.long === "--from")
    expect(opt?.mandatory).toBe(false)
  })

  test("default values propagate to commander", () => {
    walkSchemaToCommander(cmd, z.object({
      interval: z.string().default("1d"),
    }))
    const opt = cmd.options.find((o) => o.long === "--interval")
    expect(opt?.defaultValue).toBe("1d")
  })

  test("enum options display the choices in the placeholder", () => {
    walkSchemaToCommander(cmd, z.object({
      kind: z.enum(["a", "b", "c"]),
    }))
    const opt = cmd.options.find((o) => o.long === "--kind")
    expect(opt?.flags).toContain("a|b|c")
  })

  test("array fields render as a comma-separated placeholder", () => {
    walkSchemaToCommander(cmd, z.object({
      symbols: z.array(z.string()),
    }))
    const opt = cmd.options.find((o) => o.long === "--symbols")
    expect(opt?.flags).toContain("<a,b,c>")
  })

  test("camelCase keys become kebab-case flags", () => {
    walkSchemaToCommander(cmd, z.object({
      seriesId: z.string(),
    }))
    expect(cmd.options.find((o) => o.long === "--series-id")).toBeDefined()
  })

  test("nullable fields are treated as optional", () => {
    walkSchemaToCommander(cmd, z.object({
      maybe: z.string().nullable(),
    }))
    const opt = cmd.options.find((o) => o.long === "--maybe")
    expect(opt).toBeDefined()
    expect(opt?.mandatory).toBe(false)
  })

  test("boolean fields render as a flag with no value placeholder", () => {
    walkSchemaToCommander(cmd, z.object({
      verbose: z.boolean(),
    }))
    const opt = cmd.options.find((o) => o.long === "--verbose")
    expect(opt).toBeDefined()
    expect(opt?.flags).not.toContain("<")
  })

  test("non-zod fields in the shape are skipped silently", () => {
    // Synthesised shape with a non-zod entry — defensive guard
    // path. Wouldn't happen via `z.object({...})` but the type
    // system doesn't prevent direct construction.
    const fakeShape = {
      real: z.string(),
      bogus: "not a zod type",
    } as unknown as Record<string, z.ZodType>
    const schema = { shape: fakeShape } as unknown as z.ZodObject
    walkSchemaToCommander(cmd, schema)
    expect(cmd.options.find((o) => o.long === "--real")).toBeDefined()
    expect(cmd.options.find((o) => o.long === "--bogus")).toBeUndefined()
  })
})

describe("walkSchemaToCommander — positional", () => {
  test("positional keys become commander arguments, not flags", () => {
    const cmd = newCommand()
    walkSchemaToCommander(
      cmd,
      z.object({
        symbol: z.string(),
        interval: z.string().default("1d"),
      }),
      { positional: ["symbol"] },
    )
    // The positional arg should not appear as an option.
    expect(cmd.options.find((o) => o.long === "--symbol")).toBeUndefined()
    expect(cmd.options.find((o) => o.long === "--interval")).toBeDefined()
  })

  test("array positionals are variadic", () => {
    const cmd = newCommand()
    walkSchemaToCommander(
      cmd,
      z.object({ symbols: z.array(z.string()) }),
      { positional: ["symbols"] },
    )
    expect(cmd.options.find((o) => o.long === "--symbols")).toBeUndefined()
    // Variadic arg: commander stores them on the action callback's
    // params; can't easily inspect from outside without running.
    // Smoke-check below in collectArgs tests.
  })
})

describe("collectArgs", () => {
  test("merges positional + option values into one object", () => {
    const schema = z.object({
      symbol: z.string(),
      interval: z.string().default("1d"),
      from: z.string().optional(),
    })
    // commander hands action: (...positional, options, command)
    // commander invokes the action with (...positional, options, command).
    const argv = ["SPY", { interval: "1wk", from: "2026-01-01" }, {}]
    const out = collectArgs(schema, ["symbol"], argv)
    expect(out).toEqual({ symbol: "SPY", interval: "1wk", from: "2026-01-01" })
  })

  test("comma-splits array-typed flags", () => {
    const schema = z.object({
      symbols: z.array(z.string()),
    })
    const argv = [{ symbols: "SPY,AAPL,MSFT" }, {}]
    const out = collectArgs(schema, [], argv)
    expect(out.symbols).toEqual(["SPY", "AAPL", "MSFT"])
  })

  test("keeps array values that are already arrays (variadic positional)", () => {
    const schema = z.object({ symbols: z.array(z.string()) })
    const argv = [["SPY", "AAPL"], {}, {}]
    const out = collectArgs(schema, ["symbols"], argv)
    expect(out.symbols).toEqual(["SPY", "AAPL"])
  })

  test("omits undefined values entirely (doesn't store null)", () => {
    const schema = z.object({
      symbol: z.string(),
      from: z.string().optional(),
    })
    const argv = ["SPY", { /* no from */ }, {}]
    const out = collectArgs(schema, ["symbol"], argv)
    expect(out).toEqual({ symbol: "SPY" })
    expect("from" in out).toBe(false)
  })
})
