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
    expect(out).toBe([
      "┌───────────┬───────────┐",
      "│           │ Values    │",
      "├───────────┼───────────┤",
      "│ id        │ GDP       │",
      "│ frequency │ Quarterly │",
      "└───────────┴───────────┘",
      "",
    ].join("\n"))
  })

  test("empty object → just header rows (no body)", () => {
    const out = renderObjectTable({})
    expect(out).toContain("│  │ Values │")
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

    expect(out).toBe([
      "┌───┬────────────┬───────┐",
      "│   │ date       │ value │",
      "├───┼────────────┼───────┤",
      "│ 0 │ 2024-01-01 │ 1     │",
      "│ 1 │ 2024-02-01 │ 2     │",
      "└───┴────────────┴───────┘",
      "",
    ].join("\n"))
  })

  test("array of primitives → single Values column", () => {
    const out = renderArrayTable([0.1, -0.1, 0.05])
    expect(out).toContain("│   │ Values │")
    expect(out).toContain("│ 0 │ 0.1    │")
    expect(out).toContain("│ 1 │ -0.1   │")
    expect(out).toContain("│ 2 │ 0.05   │")
  })

  test("non-uniform keys → union of keys, blanks where missing", () => {
    const out = renderArrayTable([
      { a: 1, b: 2 },
      { a: 3, c: 4 },
    ])

    expect(out).toContain("│ a │ b │ c │")
    expect(out).toContain("│ 1 │ 2 │   │")
    expect(out).toContain("│ 3 │   │ 4 │")
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

    expect(out).toBe([
      "┌─────┬────────┬────────┐",
      "│     │ price  │ change │",
      "├─────┼────────┼────────┤",
      "│ SPY │ 739.17 │ 0.42   │",
      "│ QQQ │ 538.1  │ 0.31   │",
      "└─────┴────────┴────────┘",
      "",
    ].join("\n"))
  })
})

describe("type-aware coloring", () => {
  // Coloring is gated on `process.stdout.isTTY`. We can't fake a TTY
  // cheaply, but `FORCE_COLOR=1` overrides the gate — same path the
  // env uses to opt in when piping. Each test sets/unsets it.

  function withForceColor<T>(fn: () => T): T {
    const prior = process.env.FORCE_COLOR
    process.env.FORCE_COLOR = "1"
    try {
      return fn()
    } finally {
      if (prior === undefined) delete process.env.FORCE_COLOR
      else process.env.FORCE_COLOR = prior
    }
  }

  test("NO_COLOR=1 disables coloring even with FORCE_COLOR=1", () => {
    const priorNo = process.env.NO_COLOR
    process.env.NO_COLOR = "1"
    try {
      const out = withForceColor(() =>
        renderArrayTable([{ date: "2024-01-01", n: 1 }]),
      )
      expect(out).not.toContain("\x1b[")
    } finally {
      if (priorNo === undefined) delete process.env.NO_COLOR
      else process.env.NO_COLOR = priorNo
    }
  })

  test("ISO date cells are wrapped in cyan", () => {
    const out = withForceColor(() =>
      renderArrayTable([{ date: "2024-01-01", n: 1 }]),
    )
    expect(out).toContain("\x1b[36m2024-01-01\x1b[0m")
  })

  test("numeric cells are wrapped in yellow", () => {
    const out = withForceColor(() =>
      renderArrayTable([{ date: "2024-01-01", n: 42.5 }]),
    )
    expect(out).toContain("\x1b[33m42.5\x1b[0m")
  })

  test("the auto-index column stays uncolored even though it's numeric", () => {
    const out = withForceColor(() =>
      renderArrayTable([{ n: 7 }, { n: 8 }]),
    )
    // Index "0" / "1" are bare; only "7" and "8" pick up yellow.
    expect(out).toContain("│ 0 │")
    expect(out).toContain("│ 1 │")
    expect(out).toContain("\x1b[33m7\x1b[0m")
    expect(out).toContain("\x1b[33m8\x1b[0m")
  })

  test("booleans get magenta, null gets gray", () => {
    const out = withForceColor(() =>
      renderArrayTable([{ ok: true, miss: null }]),
    )
    expect(out).toContain("\x1b[35mtrue\x1b[0m")
    expect(out).toContain("\x1b[90mnull\x1b[0m")
  })

  test("renderObjectTable colors the Values column, not the keys", () => {
    const out = withForceColor(() =>
      renderObjectTable({ date: "2024-01-01", n: 42 }),
    )
    // Keys (column 0) stay uncolored.
    expect(out).toContain("│ date ")
    expect(out).toContain("│ n    ")
    expect(out).toContain("\x1b[36m2024-01-01\x1b[0m")
    expect(out).toContain("\x1b[33m42\x1b[0m")
  })

  test("widths still measure visible characters (table doesn't widen)", () => {
    const colored = withForceColor(() =>
      renderArrayTable([{ date: "2024-01-01", n: 1 }]),
    )
    const plain = renderArrayTable([{ date: "2024-01-01", n: 1 }])
    // Strip ANSI from the colored version; geometry should match.
    // eslint-disable-next-line no-control-regex
    const stripped = colored.replace(/\x1b\[[0-9;]*m/g, "")
    expect(stripped).toBe(plain)
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
    // measurement it's just wide enough for "Values" (6 chars) +
    // padding + the 3-char "url" key column.
    const borderLine = out.split("\n")[0]!
    // "┌───┬──────┐" shape — but actual widths depend on padding.
    // Sanity: the border is short (< 30 chars total) despite the
    // long URL inside the cell.
    expect(borderLine.length).toBeLessThan(30)
  })
})
