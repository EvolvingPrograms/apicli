import { describe, expect, test } from "bun:test"
import { extractPlaceholders, renderPath, serialize } from "./path"

describe("extractPlaceholders", () => {
  test("returns [] for paths with no placeholders", () => {
    expect(extractPlaceholders("/v7/finance/quote")).toEqual([])
  })

  test("extracts a single placeholder", () => {
    expect(extractPlaceholders("/v8/chart/{symbol}")).toEqual(["symbol"])
  })

  test("extracts multiple placeholders in document order", () => {
    expect(extractPlaceholders("/a/{foo}/b/{bar}/c/{baz}")).toEqual([
      "foo", "bar", "baz",
    ])
  })
})

describe("renderPath", () => {
  test("substitutes placeholders from the params object", () => {
    expect(renderPath("/a/{x}/b/{y}", { x: "1", y: "2" })).toBe("/a/1/b/2")
  })

  test("URL-encodes substituted values", () => {
    expect(renderPath("/a/{x}", { x: "hello world" })).toBe("/a/hello%20world")
    expect(renderPath("/a/{x}", { x: "a/b" })).toBe("/a/a%2Fb")
  })

  test("throws on missing values", () => {
    expect(() => renderPath("/a/{x}", {})).toThrow(/missing value for \{x\}/)
  })

  test("leaves paths with no placeholders alone", () => {
    expect(renderPath("/foo", {})).toBe("/foo")
  })
})

describe("serialize", () => {
  test("joins arrays with commas", () => {
    expect(serialize(["SPY", "AAPL", "MSFT"])).toBe("SPY,AAPL,MSFT")
  })

  test("stringifies scalars", () => {
    expect(serialize("foo")).toBe("foo")
    expect(serialize(42)).toBe("42")
    expect(serialize(true)).toBe("true")
  })

  test("empty array → empty string", () => {
    expect(serialize([])).toBe("")
  })
})
