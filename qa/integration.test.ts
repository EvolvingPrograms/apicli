/**
 * End-to-end qa for the api-cli framework.
 *
 * Boots a real (loopback) HTTP server with canned responses,
 * defines a small API + commands via api-cli, and exercises the
 * full pipeline:
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
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"
import { z } from "zod"
import {
  createCli,
  defineApi,
  defineCommand,
  dependent,
  get,
} from ".."

// ---------------------------------------------------------------------------
// Mock HTTP server
// ---------------------------------------------------------------------------

interface SeenRequest {
  pathname: string
  query: URLSearchParams
  headers: Headers
}

let baseUrl = ""
let server: ReturnType<typeof Bun.serve> | undefined
let seen: SeenRequest[] = []

beforeAll(() => {
  server = Bun.serve({
    port: 0, // OS-assigned
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
        // Server returns the unwrapped picked shape directly —
        // matches the dependent endpoint's default (no `wrap`).
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
  baseUrl = `http://localhost:${server.port}`
})

afterAll(() => {
  server?.stop()
})

beforeEach(() => {
  seen = []
})

// Capture stdout/stderr + stub process.exit (same pattern as
// the cli-side atomic tests).
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

// ---------------------------------------------------------------------------
// API + command definitions under test
// ---------------------------------------------------------------------------

function buildTestSetup() {
  const api = defineApi({
    name: "test-api",
    baseUrl,
    endpoints: {
      echo: get(
        "/v1/echo",
        z.object({
          q: z.string(),
          n: z.coerce.number().int().default(0),
        }),
        {
          response: z.object({
            q: z.string(),
            n: z.number(),
          }),
        },
      ),

      item: get(
        "/v1/item/{id}",
        z.object({ id: z.string() }),
        { response: z.object({ id: z.string(), name: z.string() }) },
      ),

      boom: get("/v1/boom", z.object({})),

      summary: dependent(
        "/v1/summary/{id}",
        z.object({ id: z.string() }),
        "modules",
        {
          detail: z.object({ score: z.number() }),
          financials: z.object({ revenue: z.number() }),
        },
      ),
    },
  })

  const echoCmd = defineCommand({
    name: "echo",
    description: "Echo a query string + optional number",
    schema: z.object({
      q: z.string(),
      n: z.coerce.number().int().default(0),
    }),
    positional: ["q"],
    handler: ({ q, n }) => api.echo({ q, n }),
  })

  const summaryCmd = defineCommand({
    name: "summary",
    schema: z.object({
      id: z.string(),
      modules: z.array(z.string()).min(1),
    }),
    positional: ["id"],
    handler: async ({ id, modules }) => {
      // Cast at the command boundary because the schema declares
      // string[], not the literal-tuple form needed for the
      // dependent inference. Inside, we trust the runtime check.
      type ModuleName = "detail" | "financials"
      const result = await api.summary({
        id,
        modules: modules as readonly ModuleName[],
      })

      // Unwrap the Yahoo-style envelope for ergonomic output.
      return result
    },
  })

  class TestError extends Error { override readonly name = "TestError" }

  const failCmd = defineCommand({
    name: "fail",
    schema: z.object({}),
    handler: () => {
      throw new TestError("simulated")
    },
  })

  const cli = createCli({
    name: "test-cli",
    description: "integration test cli",
    commands: [echoCmd, summaryCmd, failCmd],
    api,
    errorClass: TestError,
  })

  // exitOverride so commander doesn't call process.exit on
  // missing args, etc. (We have our own exit stub but commander
  // throws CommanderError which messes with our flow.)
  cli.program.exitOverride()

  return { cli, api }
}

async function run(cli: ReturnType<typeof buildTestSetup>["cli"], argv: string[]): Promise<void> {
  await cli.program.parseAsync(["bun", "test-cli", ...argv])
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("api-cli integration", () => {
  test("command → typed API call → mock HTTP → response validated → JSON emitted", async () => {
    const { cli } = buildTestSetup()
    await run(cli, ["echo", "hello", "--n", "7"])

    expect(seen).toHaveLength(1)
    expect(seen[0]?.pathname).toBe("/v1/echo")
    expect(seen[0]?.query.get("q")).toBe("hello")
    expect(seen[0]?.query.get("n")).toBe("7")

    const out = JSON.parse(stdout.join(""))
    expect(out).toEqual({ q: "hello", n: 7 })
  })

  test("default values apply when a flag is omitted", async () => {
    const { cli } = buildTestSetup()
    await run(cli, ["echo", "default-test"])
    const out = JSON.parse(stdout.join(""))
    expect(out.n).toBe(0)
  })

  test("path placeholders substituted from positional args", async () => {
    const { api } = buildTestSetup()
    const result = await api.item({ id: "abc" })
    expect(seen[0]?.pathname).toBe("/v1/item/abc")
    expect(result).toEqual({ id: "abc", name: "item-abc" })
  })

  test("non-2xx upstream → throw → mapError → stderr + exit 1", async () => {
    const { api } = buildTestSetup()
    // Bun's HTTP server normalises statusText to the standard
    // phrase ("Internal Server Error"), so we match on the
    // status code + the GET + path prefix instead.
    await expect(api.boom({})).rejects.toThrow(/test-api: GET \/v1\/boom → 500/)
  })

  test("errorClass thrown in handler → stderr + exit 1", async () => {
    const { cli } = buildTestSetup()
    try {
      await run(cli, ["fail"])
    } catch { /* exit stub throws */ }
    expect(stderr.join("")).toContain("test-cli: simulated")
    expect(exitCode).toBe(1)
  })

  test("dependent endpoint validates only requested module slices", async () => {
    const { api } = buildTestSetup()
    const result = await api.summary({ id: "x", modules: ["detail"] })
    // Type-level inference: result.detail is the only key. At
    // runtime the response zod schema picked just `detail`, so
    // accessing `financials` from the parsed shape would fail.
    expect(result.detail.score).toBe(42)
    // @ts-expect-error — financials not in requested modules
    void result.financials
  })

  test("dependent endpoint rejects unknown module values", async () => {
    const { api } = buildTestSetup()
    await expect(
      api.summary({ id: "x", modules: ["nope"] as never }),
    ).rejects.toThrow(/unknown "modules" value "nope"/)
  })

  test("api echo --q hello --n 7 dispatches end-to-end through the API", async () => {
    const { cli } = buildTestSetup()
    await run(cli, ["api", "echo", "--q", "hello", "--n", "7"])

    expect(seen[0]?.pathname).toBe("/v1/echo")
    expect(seen[0]?.query.get("q")).toBe("hello")
    expect(seen[0]?.query.get("n")).toBe("7")

    const out = JSON.parse(stdout.join(""))
    expect(out).toEqual({ q: "hello", n: 7 })
  })

  test("api item --id abc substitutes the path placeholder", async () => {
    const { cli } = buildTestSetup()
    await run(cli, ["api", "item", "--id", "abc"])

    expect(seen[0]?.pathname).toBe("/v1/item/abc")
    const out = JSON.parse(stdout.join(""))
    expect(out).toEqual({ id: "abc", name: "item-abc" })
  })

  test("api summary --id x --modules detail,financials dispatches the dependent endpoint", async () => {
    const { cli } = buildTestSetup()
    await run(cli, ["api", "summary", "--id", "x", "--modules", "detail,financials"])

    expect(seen[0]?.pathname).toBe("/v1/summary/x")
    const out = JSON.parse(stdout.join(""))
    expect(out.detail.score).toBe(42)
    expect(out.financials.revenue).toBe(1000)
  })

  test("api summary with an unknown module value → stderr + exit 1", async () => {
    const { cli } = buildTestSetup()
    try {
      await run(cli, ["api", "summary", "--id", "x", "--modules", "nope"])
    } catch { /* exit stub */ }
    expect(stderr.join("")).toContain("unknown \"modules\" value \"nope\"")
    expect(exitCode).toBe(1)
  })

  test("kebab-cased flag for a camelCase schema key works end-to-end", async () => {
    const api = defineApi({
      name: "kebab-api",
      baseUrl,
      endpoints: {
        echo: get(
          "/v1/echo",
          z.object({
            queryText: z.string(),
            maxItems: z.coerce.number().int().default(5),
          }),
          { response: z.object({ q: z.string().nullable(), n: z.number() }) },
        ),
      },
    })

    const cmd = defineCommand({
      name: "search",
      schema: z.object({
        queryText: z.string(),
        maxItems: z.coerce.number().int().default(5),
      }),
      // map our camelCase schema to the API's snake_case-via-comma path
      handler: ({ queryText, maxItems }) =>
        api.echo({ queryText, maxItems }),
    })

    const cli = createCli({
      name: "kebab-cli",
      description: "kebab",
      commands: [cmd],
    })
    cli.program.exitOverride()

    await cli.program.parseAsync([
      "bun", "kebab-cli",
      "search", "--query-text", "foo", "--max-items", "3",
    ])

    // The handler should have been called with the right values.
    expect(seen[0]?.query.get("queryText")).toBe("foo")
    expect(seen[0]?.query.get("maxItems")).toBe("3")
  })
})
