import { describe, expect, test } from "bun:test"
import { z } from "zod"
import type { ApiSpec, EndpointSpec } from "../types"
import { callDependent, callEndpoint } from "./call"
import { dependent, get } from "./helpers"

// callEndpoint goes through `politeFetch` which uses
// `globalThis.fetch`. We patch it for the duration of each test
// rather than threading a fetchImpl through callEndpoint's
// signature — that would leak test concerns into the runtime API.
function withMockFetch(
  fn: (req: { url: string, headers: Headers }) => Response,
  body: () => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    const headers = new Headers(init?.headers)
    return fn({ url, headers })
  }) as typeof fetch
  return body().finally(() => {
    globalThis.fetch = original
  })
}

describe("callEndpoint", () => {
  test("substitutes path placeholders and emits query for the rest", async () => {
    let capturedUrl = ""
    await withMockFetch(
      ({ url }) => {
        capturedUrl = url
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        })
      },
      async () => {
        const spec: ApiSpec = {
          name: "test",
          baseUrl: "https://test.example",
          endpoints: {},
        }
        const endpoint: EndpointSpec = get("/v/{id}", z.object({
          id: z.string(),
          limit: z.coerce.number(),
        }))
        await callEndpoint(spec, endpoint, { id: "abc", limit: 5 })
      },
    )
    expect(capturedUrl).toContain("/v/abc")
    expect(capturedUrl).toContain("limit=5")
    expect(capturedUrl).not.toContain("{")
  })

  test("merges baseQuery onto every request", async () => {
    let capturedUrl = ""
    await withMockFetch(
      ({ url }) => {
        capturedUrl = url
        return new Response("{}", { headers: { "Content-Type": "application/json" } })
      },
      async () => {
        const spec: ApiSpec = {
          name: "test",
          baseUrl: "https://test.example",
          baseQuery: () => ({ api_key: "K", file_type: "json" }),
          endpoints: {},
        }
        await callEndpoint(spec, get("/foo", z.object({})), {})
      },
    )
    expect(capturedUrl).toContain("api_key=K")
    expect(capturedUrl).toContain("file_type=json")
  })

  test("applies headers from spec.headers()", async () => {
    let captured = new Headers()
    await withMockFetch(
      ({ headers }) => {
        captured = headers
        return new Response("{}", { headers: { "Content-Type": "application/json" } })
      },
      async () => {
        const spec: ApiSpec = {
          name: "test",
          baseUrl: "https://test.example",
          headers: async () => ({ "X-Test": "yes" }),
          endpoints: {},
        }
        await callEndpoint(spec, get("/foo", z.object({})), {})
      },
    )
    expect(captured.get("X-Test")).toBe("yes")
  })

  test("throws on non-2xx with name + method + path + status", async () => {
    await withMockFetch(
      () => new Response("nope", { status: 404, statusText: "Not Found" }),
      async () => {
        const spec: ApiSpec = {
          name: "test",
          baseUrl: "https://test.example",
          endpoints: {},
        }
        const endpoint = get("/foo", z.object({}))
        await expect(callEndpoint(spec, endpoint, {})).rejects.toThrow(
          /test: GET \/foo → 404 Not Found/,
        )
      },
    )
  })

  test("validates response when endpoint declares one", async () => {
    await withMockFetch(
      () => new Response(JSON.stringify({ ok: "yes" })),
      async () => {
        const spec: ApiSpec = {
          name: "test",
          baseUrl: "https://test.example",
          endpoints: {},
        }
        const endpoint = get("/foo", z.object({}), {
          response: z.object({ ok: z.boolean() }), // wrong: expects bool, gets string
        })
        await expect(callEndpoint(spec, endpoint, {})).rejects.toThrow()
      },
    )
  })

  test("returns raw JSON when no response schema is set", async () => {
    await withMockFetch(
      () => new Response(JSON.stringify({ shape: "any" })),
      async () => {
        const spec: ApiSpec = {
          name: "test",
          baseUrl: "https://test.example",
          endpoints: {},
        }
        const result = await callEndpoint(spec, get("/foo", z.object({})), {})
        expect(result).toEqual({ shape: "any" })
      },
    )
  })
})

describe("callDependent — input validation paths", () => {
  const spec: ApiSpec = {
    name: "test",
    baseUrl: "https://test.example",
    endpoints: {},
  }
  const ep = dependent(
    "/v/{id}",
    z.object({ id: z.string() }),
    "modules",
    { a: z.object({}), b: z.object({}) },
  )

  test("rejects non-object args", async () => {
    await expect(
      callDependent(spec, ep, "not an object" as unknown),
    ).rejects.toThrow(/args must be an object/)
    await expect(callDependent(spec, ep, null)).rejects.toThrow(
      /args must be an object/,
    )
  })

  test("rejects non-string entries in the select array", async () => {
    await expect(
      callDependent(spec, ep, { id: "x", modules: [42] }),
    ).rejects.toThrow(/entries must be strings/)
  })
})
