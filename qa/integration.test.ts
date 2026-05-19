/**
 * End-to-end qa for the api-cli framework.
 *
 * Boots a real (loopback) HTTP server with canned responses,
 * points the flat example modules at it via env vars, and
 * proves the full pipeline:
 *
 *   zod schema → defineApi → typed client method → mock HTTP →
 *   response validation → command handler → JSON emission
 *
 * Atomic sibling tests already cover each piece in isolation;
 * this file proves they compose.
 */

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"

interface SeenRequest {
  pathname: string
  query: URLSearchParams
  headers: Headers
}

const seen: SeenRequest[] = []

const server = Bun.serve({
  port: 0,
  fetch(req) {
    const url = new URL(req.url)
    seen.push({
      pathname: url.pathname,
      query: url.searchParams,
      headers: req.headers,
    })

    if (url.pathname === "/v1/echo") {
      return Response.json({
        q: url.searchParams.get("q"),
        n: Number(url.searchParams.get("n") ?? 0),
      })
    }

    if (url.pathname.startsWith("/v1/item/")) {
      const id = url.pathname.split("/").pop()
      return Response.json({ id, name: `item-${id}` })
    }

    if (url.pathname.startsWith("/v1/summary/")) {
      return Response.json({
        detail: { score: 42 },
        financials: { revenue: 1000 },
      })
    }

    if (url.pathname === "/v1/boom") {
      return new Response("oops", { status: 500, statusText: "Server Error" })
    }

    return new Response("not found", { status: 404 })
  },
})

const baseUrl = `http://localhost:${server.port}`
process.env.ECHO_BASE_URL = baseUrl
process.env.KEBAB_BASE_URL = baseUrl

// Top-level await — env is set before the examples'
// `defineApi(...)` calls execute.
const { echoApi, echoCli, EchoError } = await import("../examples/echo")
const { kebabCli } = await import("../examples/kebab")

// commander throws CommanderError on bad argv rather than
// calling process.exit; our exit stub catches the rest. We
// apply this once on the imported CLIs.
echoCli.program.exitOverride()
kebabCli.program.exitOverride()

afterAll(() => {
  server.stop()
})

// Capture stdout/stderr + stub process.exit per test.
let stdout: string[]
let stderr: string[]
let exitCode: number | undefined
let realStdoutWrite: typeof process.stdout.write
let realStderrWrite: typeof process.stderr.write
let realExit: typeof process.exit

beforeEach(() => {
  seen.length = 0
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

async function runEcho(argv: string[]): Promise<void> {
  await echoCli.program.parseAsync(["bun", "echo-cli", "--json", ...argv])
}

async function runKebab(argv: string[]): Promise<void> {
  await kebabCli.program.parseAsync(["bun", "kebab-cli", "--json", ...argv])
}

describe("api-cli integration", () => {
  test("command → typed API call → mock HTTP → response validated → JSON emitted", async () => {
    await runEcho(["echo", "hello", "--n", "7"])

    expect(seen).toHaveLength(1)
    expect(seen[0]?.pathname).toBe("/v1/echo")
    expect(seen[0]?.query.get("q")).toBe("hello")
    expect(seen[0]?.query.get("n")).toBe("7")

    const out = JSON.parse(stdout.join(""))
    expect(out).toEqual({ q: "hello", n: 7 })
  })

  test("default values apply when a flag is omitted", async () => {
    await runEcho(["echo", "default-test"])
    const out = JSON.parse(stdout.join(""))
    expect(out.n).toBe(0)
  })

  test("path placeholders substituted from positional args", async () => {
    const result = await echoApi.item({ id: "abc" })
    expect(seen[0]?.pathname).toBe("/v1/item/abc")
    expect(result).toEqual({ id: "abc", name: "item-abc" })
  })

  test("non-2xx upstream → thrown error", async () => {
    await expect(echoApi.boom({})).rejects.toThrow(
      /echo-api: GET \/v1\/boom → 500/,
    )
  })

  test("errorClass thrown in handler → stderr + exit 1", async () => {
    try {
      await runEcho(["fail"])
    } catch { /* exit stub */ }

    expect(stderr.join("")).toContain("echo-cli: simulated")
    expect(exitCode).toBe(1)
    expect(new EchoError("x").name).toBe("EchoError")
  })

  test("dependent endpoint validates only requested module slices", async () => {
    const result = await echoApi.summary({ id: "x", modules: ["detail"] })
    expect(result.detail.score).toBe(42)
    // @ts-expect-error — financials not in requested modules
    void result.financials
  })

  test("dependent endpoint rejects unknown module values", async () => {
    await expect(
      echoApi.summary({ id: "x", modules: ["nope"] as never }),
    ).rejects.toThrow(/unknown "modules" value "nope"/)
  })

  test("api echo dispatches end-to-end through the API", async () => {
    await runEcho(["api", "echo", "--q", "hello", "--n", "7"])

    expect(seen[0]?.pathname).toBe("/v1/echo")
    expect(seen[0]?.query.get("q")).toBe("hello")
    expect(seen[0]?.query.get("n")).toBe("7")

    const out = JSON.parse(stdout.join(""))
    expect(out).toEqual({ q: "hello", n: 7 })
  })

  test("api item --id abc substitutes the path placeholder", async () => {
    await runEcho(["api", "item", "--id", "abc"])

    expect(seen[0]?.pathname).toBe("/v1/item/abc")
    const out = JSON.parse(stdout.join(""))
    expect(out).toEqual({ id: "abc", name: "item-abc" })
  })

  test("api summary dispatches the dependent endpoint", async () => {
    await runEcho(["api", "summary", "--id", "x", "--modules", "detail,financials"])

    expect(seen[0]?.pathname).toBe("/v1/summary/x")
    const out = JSON.parse(stdout.join(""))
    expect(out.detail.score).toBe(42)
    expect(out.financials.revenue).toBe(1000)
  })

  test("api summary with an unknown module value → stderr + exit 1", async () => {
    try {
      await runEcho(["api", "summary", "--id", "x", "--modules", "nope"])
    } catch { /* exit stub */ }

    expect(stderr.join("")).toContain("unknown \"modules\" value \"nope\"")
    expect(exitCode).toBe(1)
  })

  test("camelCase schema key → kebab-case --flag end-to-end", async () => {
    await runKebab(["search", "--query-text", "foo", "--max-items", "3"])

    expect(seen[0]?.query.get("queryText")).toBe("foo")
    expect(seen[0]?.query.get("maxItems")).toBe("3")
  })
})
