import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { z } from "zod"
import { emit, mapError } from "./emit"

// Capture stdout/stderr writes + console.table calls + stub
// process.exit so tests observe outcomes without emitting to the
// runner. `console.table` writes through Bun's internal stdout fd
// (bypassing our `process.stdout.write` shim), so we spy on the
// method directly.
let stdout: string[]
let stderr: string[]
let tableCalls: unknown[]
let exitCode: number | undefined

let realStdoutWrite: typeof process.stdout.write
let realStderrWrite: typeof process.stderr.write
let realExit: typeof process.exit
let realConsoleTable: typeof console.table

beforeEach(() => {
  stdout = []
  stderr = []
  tableCalls = []
  exitCode = undefined

  realStdoutWrite = process.stdout.write.bind(process.stdout)
  realStderrWrite = process.stderr.write.bind(process.stderr)
  realExit = process.exit.bind(process)
  realConsoleTable = console.table.bind(console)

  process.stdout.write = ((data: string | Uint8Array) => {
    stdout.push(typeof data === "string" ? data : data.toString())
    return true
  }) as typeof process.stdout.write

  process.stderr.write = ((data: string | Uint8Array) => {
    stderr.push(typeof data === "string" ? data : data.toString())
    return true
  }) as typeof process.stderr.write

  process.exit = ((code?: number) => {
    exitCode = code
    throw new Error(`__exit_${code ?? 0}__`)
  }) as typeof process.exit

  console.table = ((value: unknown) => {
    tableCalls.push(value)
  }) as typeof console.table
})

afterEach(() => {
  process.stdout.write = realStdoutWrite
  process.stderr.write = realStderrWrite
  process.exit = realExit
  console.table = realConsoleTable
})

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const prior: Record<string, string | undefined> = {}
  for (const k of Object.keys(vars)) prior[k] = process.env[k]
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  try {
    fn()
  } finally {
    for (const [k, v] of Object.entries(prior)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

describe("emit", () => {
  // ---- explicit modes ------------------------------------------------------

  test("explicit json mode writes raw JSON + newline", () => {
    emit({ ok: true }, { mode: "json" })
    expect(stdout.join("")).toBe(`{"ok":true}\n`)
    expect(tableCalls).toEqual([])
  })

  test("explicit json handles arrays + scalars", () => {
    emit([1, 2, 3], { mode: "json" })
    expect(stdout.join("")).toBe(`[1,2,3]\n`)
  })

  test("explicit pretty mode renders via console.table", () => {
    emit({ ok: true }, { mode: "pretty" })
    expect(stdout.join("")).toBe("")
    expect(tableCalls).toEqual([{ ok: true }])
  })

  // ---- built-in default ----------------------------------------------------

  test("no options + no env defaults to pretty", () => {
    withEnv({ JSON: undefined, PRETTY: undefined }, () => {
      emit({ ok: true })
      expect(stdout.join("")).toBe("")
      expect(tableCalls).toEqual([{ ok: true }])
    })
  })

  // ---- env shifts the default ---------------------------------------------

  test("env JSON=1 shifts the default to json", () => {
    withEnv({ JSON: "1", PRETTY: undefined }, () => {
      emit({ ok: true })
      expect(stdout.join("")).toBe(`{"ok":true}\n`)
      expect(tableCalls).toEqual([])
    })
  })

  test("env PRETTY=1 shifts the default to pretty (already the default)", () => {
    withEnv({ JSON: undefined, PRETTY: "1" }, () => {
      emit({ ok: true })
      expect(stdout.join("")).toBe("")
      expect(tableCalls).toEqual([{ ok: true }])
    })
  })

  test("env JSON=0 / JSON=false is treated as unset", () => {
    withEnv({ JSON: "0", PRETTY: undefined }, () => {
      emit({ ok: true })
      expect(stdout.join("")).toBe("")
      expect(tableCalls).toEqual([{ ok: true }])
    })

    withEnv({ JSON: "false", PRETTY: undefined }, () => {
      emit({ ok: true })
    })
    expect(stdout.join("")).toBe("")
  })

  // ---- explicit flag overrides env default ---------------------------------

  test("explicit --pretty overrides env JSON=1", () => {
    withEnv({ JSON: "1", PRETTY: undefined }, () => {
      emit({ ok: true }, { mode: "pretty" })
      expect(stdout.join("")).toBe("")
      expect(tableCalls).toEqual([{ ok: true }])
    })
  })

  test("explicit --json overrides env PRETTY=1", () => {
    withEnv({ JSON: undefined, PRETTY: "1" }, () => {
      emit({ ok: true }, { mode: "json" })
      expect(stdout.join("")).toBe(`{"ok":true}\n`)
      expect(tableCalls).toEqual([])
    })
  })

  test("when both env vars are set, PRETTY beats JSON for the default", () => {
    withEnv({ JSON: "1", PRETTY: "1" }, () => {
      emit({ ok: true })
      expect(stdout.join("")).toBe("")
      expect(tableCalls).toEqual([{ ok: true }])
    })
  })
})

describe("mapError", () => {
  test("maps an errorClass instance to `<name>: <msg>` + exit 1", () => {
    class XError extends Error { override readonly name = "XError" }

    expect(() => mapError(new XError("boom"), "test-cli", XError)).toThrow(/__exit_1__/)
    expect(stderr.join("")).toBe("test-cli: boom\n")
    expect(exitCode).toBe(1)
  })

  test("non-errorClass errors are mapped generically with the name prefix", () => {
    expect(() => mapError(new Error("oops"), "test-cli")).toThrow(/__exit_1__/)
    expect(stderr.join("")).toBe("test-cli: oops\n")
    expect(exitCode).toBe(1)
  })

  test("ZodError surfaces with 'invalid input' header + prettified body", () => {
    const schema = z.object({ n: z.number() })
    const parsed = schema.safeParse({ n: "x" })

    if (parsed.success) throw new Error("expected zod failure")
    expect(() => mapError(parsed.error, "test-cli")).toThrow(/__exit_1__/)

    const out = stderr.join("")
    expect(out).toMatch(/test-cli: invalid input/)
    expect(exitCode).toBe(1)
  })

  test("falls back to String(err) for non-Error values", () => {
    expect(() => mapError("plain string", "test-cli")).toThrow(/__exit_1__/)
    expect(stderr.join("")).toBe("test-cli: plain string\n")
  })
})
