import { describe, expect, test } from "bun:test"
import { politeFetch } from "./http"

describe("politeFetch — headers", () => {
  test("sends the default User-Agent + Accept */* by default", async () => {
    let captured = new Headers()
    await politeFetch("https://example.test/foo", {
      fetchImpl: async (_url, init) => {
        captured = new Headers(init?.headers)
        return new Response("ok")
      },
    })
    expect(captured.get("User-Agent")).toMatch(/^clipi\//)
    expect(captured.get("Accept")).toBe("*/*")
  })

  test("custom userAgent overrides the default", async () => {
    let captured = new Headers()
    await politeFetch("https://example.test/foo", {
      userAgent: "custom/1.0",
      fetchImpl: async (_url, init) => {
        captured = new Headers(init?.headers)
        return new Response("ok")
      },
    })
    expect(captured.get("User-Agent")).toBe("custom/1.0")
  })

  test("custom accept overrides the default", async () => {
    let captured = new Headers()
    await politeFetch("https://example.test/foo", {
      accept: "application/json",
      fetchImpl: async (_url, init) => {
        captured = new Headers(init?.headers)
        return new Response("ok")
      },
    })
    expect(captured.get("Accept")).toBe("application/json")
  })

  test("extra headers merge on top of UA + Accept", async () => {
    let captured = new Headers()
    await politeFetch("https://example.test/foo", {
      headers: { "X-Custom": "yes" },
      fetchImpl: async (_url, init) => {
        captured = new Headers(init?.headers)
        return new Response("ok")
      },
    })
    expect(captured.get("X-Custom")).toBe("yes")
    expect(captured.get("User-Agent")).toMatch(/^clipi\//)
  })
})

describe("politeFetch — retry behavior", () => {
  test("4xx is returned without retrying", async () => {
    let calls = 0
    const res = await politeFetch("https://example.test/foo", {
      retries: 3,
      fetchImpl: async () => {
        calls++
        return new Response("nope", { status: 404 })
      },
    })
    expect(res.status).toBe(404)
    expect(calls).toBe(1)
  })

  test("5xx retries up to `retries` then returns the last response", async () => {
    let calls = 0
    const res = await politeFetch("https://example.test/foo", {
      retries: 2,
      retryBaseDelayMs: 1,
      fetchImpl: async () => {
        calls++
        return new Response("err", { status: 503 })
      },
    })
    expect(res.status).toBe(503)
    expect(calls).toBe(3) // initial + 2 retries
  })

  test("stops retrying as soon as a non-5xx response arrives", async () => {
    let calls = 0
    const res = await politeFetch("https://example.test/foo", {
      retries: 5,
      retryBaseDelayMs: 1,
      fetchImpl: async () => {
        calls++
        return calls < 2
          ? new Response("err", { status: 503 })
          : new Response("ok", { status: 200 })
      },
    })
    expect(res.status).toBe(200)
    expect(calls).toBe(2)
  })

  test("no retries by default — single attempt on 5xx", async () => {
    let calls = 0
    await politeFetch("https://example.test/foo", {
      fetchImpl: async () => {
        calls++
        return new Response("err", { status: 500 })
      },
    })
    expect(calls).toBe(1)
  })
})

describe("politeFetch — timeout + abort signal", () => {
  test("aborts after timeoutMs and surfaces the underlying error", async () => {
    const attempt = politeFetch("https://example.test/foo", {
      timeoutMs: 5,
      fetchImpl: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          )
        }),
    })
    await expect(attempt).rejects.toThrow(/aborted/)
  })

  test("redirect option is passed through to fetch()", async () => {
    let capturedRedirect: "follow" | "error" | "manual" | undefined
    await politeFetch("https://example.test/foo", {
      redirect: "manual",
      fetchImpl: async (_url, init) => {
        capturedRedirect = init?.redirect
        return new Response("ok")
      },
    })
    expect(capturedRedirect).toBe("manual")
  })
})
