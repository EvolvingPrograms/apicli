import { describe, expect, test } from "bun:test"
import { z } from "zod"
import { dependent, get, post } from "./helpers"

describe("get", () => {
  test("returns an EndpointSpec with method GET", () => {
    const params = z.object({ a: z.string() })
    const spec = get("/foo", params)
    expect(spec.method).toBe("GET")
    expect(spec.path).toBe("/foo")
    expect(spec.params).toBe(params)
  })

  test("forwards description and response options", () => {
    const params = z.object({ a: z.string() })
    const response = z.object({ ok: z.boolean() })
    const spec = get("/foo", params, { description: "test", response })
    expect(spec.description).toBe("test")
    expect(spec.response).toBe(response)
  })
})

describe("post", () => {
  test("returns an EndpointSpec with method POST", () => {
    const spec = post("/foo", z.object({}))
    expect(spec.method).toBe("POST")
  })
})

describe("dependent", () => {
  test("returns a DependentEndpointSpec with __dependent: true", () => {
    const base = z.object({ symbol: z.string() })
    const map = {
      a: z.object({ x: z.number() }),
      b: z.object({ y: z.string() }),
    }
    const spec = dependent("/foo/{symbol}", base, "modules", map)

    expect(spec.__dependent).toBe(true)
    expect(spec.method).toBe("GET")
    expect(spec.path).toBe("/foo/{symbol}")
    expect(spec.baseParams).toBe(base)
    expect(spec.selectKey).toBe("modules")
    expect(spec.selectMap).toBe(map)
  })

  test("forwards description and wrap options", () => {
    const wrap = (picked: z.ZodObject<Record<string, z.ZodType>>) =>
      z.object({ result: picked })
    const spec = dependent("/p", z.object({}), "k", { a: z.string() }, {
      description: "test",
      wrap,
    })
    expect(spec.description).toBe("test")
    expect(spec.wrap).toBe(wrap)
  })
})
