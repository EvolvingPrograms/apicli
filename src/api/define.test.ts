import { describe, expect, test } from "bun:test"
import { z } from "zod"
import { defineApi } from "./define"
import { dependent, get } from "./helpers"

describe("defineApi — construction", () => {
  test("returns a client with one method per endpoint plus __spec", () => {
    const api = defineApi({
      name: "x",
      baseUrl: "https://example.test",
      endpoints: {
        a: get("/a", z.object({})),
        b: get("/b", z.object({})),
      },
    })
    expect(typeof api.a).toBe("function")
    expect(typeof api.b).toBe("function")
    expect(api.__spec.name).toBe("x")
  })

  test("__spec is non-enumerable so JSON.stringify(client) is clean", () => {
    const api = defineApi({
      name: "x",
      baseUrl: "https://example.test",
      endpoints: { a: get("/a", z.object({})) },
    })
    const keys = Object.keys(api)
    expect(keys).toEqual(["a"])
  })

  test("throws when a path placeholder isn't in the schema", () => {
    expect(() =>
      defineApi({
        name: "x",
        baseUrl: "https://example.test",
        endpoints: {
          bad: get("/x/{missing}", z.object({ otherKey: z.string() })),
        },
      }),
    ).toThrow(/endpoint "bad" path has \{missing\}/)
  })

  test("dependent endpoints' baseParams are checked against placeholders", () => {
    expect(() =>
      defineApi({
        name: "x",
        baseUrl: "https://example.test",
        endpoints: {
          summary: dependent(
            "/x/{nope}",
            z.object({ symbol: z.string() }),
            "modules",
            { a: z.object({}) },
          ),
        },
      }),
    ).toThrow(/endpoint "summary" path has \{nope\}/)
  })
})

describe("defineApi — dependent endpoint runtime", () => {
  test("rejects unknown select keys at call time", async () => {
    const api = defineApi({
      name: "x",
      baseUrl: "https://example.test",
      endpoints: {
        summary: dependent(
          "/v/{symbol}",
          z.object({ symbol: z.string() }),
          "modules",
          {
            a: z.object({ x: z.number() }),
            b: z.object({ y: z.string() }),
          },
        ),
      },
    })

    await expect(
      api.summary({ symbol: "x", modules: ["nope"] as never }),
    ).rejects.toThrow(/unknown "modules" value "nope"/)
  })

  test("rejects empty modules array", async () => {
    const api = defineApi({
      name: "x",
      baseUrl: "https://example.test",
      endpoints: {
        summary: dependent(
          "/v/{symbol}",
          z.object({ symbol: z.string() }),
          "modules",
          { a: z.object({}) },
        ),
      },
    })

    await expect(
      api.summary({ symbol: "x", modules: [] as never }),
    ).rejects.toThrow(/must be a non-empty array/)
  })
})
