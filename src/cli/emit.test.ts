import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { z } from "zod"
import { emit, mapError } from "./emit"

// Capture stdout/stderr writes; stub process.exit so tests can
// observe the exit code without actually exiting.
let stdout: string[]
let stderr: string[]
let exitCode: number | undefined
let realStdoutWrite: typeof process.stdout.write
let realStderrWrite: typeof process.stderr.write
let realExit: typeof process.exit

beforeEach(() => {
  stdout = []
  stderr = []
  exitCode = undefined
  realStdoutWrite = process.stdout.write.bind(process.stdout)
  realStderrWrite = process.stderr.write.bind(process.stderr)
  realExit = process.exit.bind(process)
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
})

afterEach(() => {
  process.stdout.write = realStdoutWrite
  process.stderr.write = realStderrWrite
  process.exit = realExit
})

describe("emit", () => {
  test("writes JSON + newline to stdout", () => {
    emit({ ok: true })
    expect(stdout.join("")).toBe(`{"ok":true}\n`)
  })

  test("handles arrays + scalars", () => {
    emit([1, 2, 3])
    expect(stdout.join("")).toBe(`[1,2,3]\n`)
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
