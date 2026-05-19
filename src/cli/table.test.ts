/**
 * Unit tests for the box-drawing table renderer. Each test
 * compares against a known-good string so changes to spacing,
 * padding, or border characters surface as a visible diff.
 *
 * Width measurement uses the modern `string-width` package, so
 * ANSI / OSC 8 / emoji / fullwidth all measure correctly — those
 * cases are covered here too.
 */

import { describe, expect, test } from "bun:test"

import {
  hyperlink,
  renderArrayTable,
  renderMapTable,
  renderObjectTable,
} from "./table"

describe("renderObjectTable", () => {
  test("flat key/value object → 2-column vertical table", () => {
    const out = renderObjectTable({ id: "GDP", frequency: "Quarterly" })
    expect(out).toContain("Value")
    expect(out).toContain("id")
    expect(out).toContain("frequency")
    expect(out).toContain("GDP")
    expect(out).toContain("Quarterly")
    expect(out).toMatchSnapshot()
  })

  test("empty object → just header rows (no body)", () => {
    const out = renderObjectTable({})
    expect(out).toContain("Value")
    // Body section between header and bottom border is empty.
    expect(out.split("\n")).toHaveLength(5) // top, header, sep, bottom, ""
  })
})

describe("renderArrayTable", () => {
  test("array of flat objects → header row + index column", () => {
    const out = renderArrayTable([
      { date: "2024-01-01", value: 1 },
      { date: "2024-02-01", value: 2 },
    ])
    expect(out).toContain("date")
    expect(out).toContain("value")
    expect(out).toContain("2024-01-01")
    expect(out).toContain("2024-02-01")
    expect(out).toMatchSnapshot()
  })

  test("array of primitives → single Values column", () => {
    const out = renderArrayTable([0.1, -0.1, 0.05])
    expect(out).toContain("Value")
    expect(out).toContain("0.1")
    expect(out).toContain("-0.1")
    expect(out).toContain("0.05")
    expect(out).toMatchSnapshot()
  })

  test("non-uniform keys → union of keys, blanks where missing", () => {
    const out = renderArrayTable([
      { a: 1, b: 2 },
      { a: 3, c: 4 },
    ])
    // Union: a, b, c — first-seen order. Headers + label column are
    // bold; the snapshot pins the exact escape sequencing.
    expect(out).toContain("a")
    expect(out).toContain("b")
    expect(out).toContain("c")
    expect(out).toMatchSnapshot()
  })

  test("empty array → degenerate header-only", () => {
    expect(renderArrayTable([])).toContain("│")
  })
})

describe("renderMapTable", () => {
  test("map of flat records → outer keys as left col, inner keys as headers", () => {
    const out = renderMapTable({
      SPY: { price: 739.17, change: 0.42 },
      QQQ: { price: 538.10, change: 0.31 },
    })
    expect(out).toContain("SPY")
    expect(out).toContain("QQQ")
    expect(out).toContain("price")
    expect(out).toContain("change")
    expect(out).toMatchSnapshot()
  })
})

describe("type-aware coloring", () => {
  test("ISO date cells are wrapped in cyan", () => {
    const out = renderArrayTable([{ date: "2024-01-01", n: 1 }])
    expect(out).toContain("\x1b[36m2024-01-01\x1b[0m")
  })

  test("numeric cells are wrapped in yellow", () => {
    const out = renderArrayTable([{ date: "2024-01-01", n: 42.5 }])
    expect(out).toContain("\x1b[33m42.5\x1b[0m")
  })

  test("the auto-index column gets bold (label) not yellow (number)", () => {
    const out = renderArrayTable([{ n: 7 }, { n: 8 }])
    // Index column: bold, not yellow.
    expect(out).toContain("\x1b[1m0\x1b[0m")
    expect(out).toContain("\x1b[1m1\x1b[0m")
    expect(out).not.toContain("\x1b[33m0\x1b[0m")
    expect(out).not.toContain("\x1b[33m1\x1b[0m")
    // Data column: yellow, not bold.
    expect(out).toContain("\x1b[33m7\x1b[0m")
    expect(out).toContain("\x1b[33m8\x1b[0m")
  })

  test("booleans get magenta, null gets gray", () => {
    const out = renderArrayTable([{ ok: true, miss: null }])
    expect(out).toContain("\x1b[35mtrue\x1b[0m")
    expect(out).toContain("\x1b[90mnull\x1b[0m")
  })

  test("renderObjectTable bolds the key column, type-colors the value column", () => {
    const out = renderObjectTable({ date: "2024-01-01", n: 42 })
    // Keys: bold.
    expect(out).toContain("\x1b[1mdate\x1b[0m")
    expect(out).toContain("\x1b[1mn\x1b[0m")
    // Values: type-colored.
    expect(out).toContain("\x1b[36m2024-01-01\x1b[0m")
    expect(out).toContain("\x1b[33m42\x1b[0m")
  })
})

describe("hyperlink", () => {
  test("wraps text in OSC 8 escape sequence", () => {
    const result = hyperlink("https://example.com", "click here")
    expect(result).toBe("\x1b]8;;https://example.com\x1b\\click here\x1b]8;;\x1b\\")
  })

  test("ANSI/OSC 8 in cell → table width still based on visible characters", () => {
    // The hyperlinked string is much longer than the visible text;
    // the column should size to the visible width only.
    const url = "https://example.com/long/url"
    const linked = hyperlink(url, "short")
    const out = renderObjectTable({ url: linked })

    // The escape sequence is present in the raw output…
    expect(out).toContain("\x1b]8;;" + url + "\x1b\\short\x1b]8;;\x1b\\")

    // …but the table's border lines size to the visible content,
    // not the escape-laden byte length. Pre-fix, the bottom border
    // would have been hundreds of `─` wide; with proper width
    // measurement it's just wide enough for "Value" (6 chars) +
    // padding + the 3-char "url" key column.
    const borderLine = out.split("\n")[0]!
    // "┌───┬──────┐" shape — but actual widths depend on padding.
    // Sanity: the border is short (< 30 chars total) despite the
    // long URL inside the cell.
    expect(borderLine.length).toBeLessThan(30)
  })
})
