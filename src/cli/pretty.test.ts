import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { prettyPrint } from "./pretty"

// `prettyPrint` writes to both `console.table` (for the actual
// box-drawing) and `console.log` (for header lines, section
// labels, blank separators). These tests stub both so we can
// assert on dispatch decisions without comparing rendered table
// strings, which would brittle the suite against Node/Bun
// upgrades changing their drawing characters.

let tableCalls: unknown[]
let logCalls: unknown[]
let realConsoleTable: typeof console.table
let realConsoleLog: typeof console.log

beforeEach(() => {
  tableCalls = []
  logCalls = []
  realConsoleTable = console.table.bind(console)
  realConsoleLog = console.log.bind(console)

  console.table = ((value: unknown) => {
    tableCalls.push(value)
  }) as typeof console.table

  console.log = ((...args: unknown[]) => {
    logCalls.push(args.length === 1 ? args[0] : args)
  }) as typeof console.log
})

afterEach(() => {
  console.table = realConsoleTable
  console.log = realConsoleLog
})

describe("prettyPrint", () => {
  test("array of flat objects → one console.table call", () => {
    const rows = [{ date: "2024-01-01", value: 1 }, { date: "2024-02-01", value: 2 }]
    prettyPrint(rows)
    expect(tableCalls).toEqual([rows])
    expect(logCalls).toEqual([])
  })

  test("array of primitives → one console.table call", () => {
    prettyPrint([0.1, -0.1, 0.05])
    expect(tableCalls).toEqual([[0.1, -0.1, 0.05]])
  })

  test("flat object (all scalar values) → one console.table call", () => {
    const obj = { id: "GDP", title: "Gross Domestic Product", frequency: "Quarterly" }
    prettyPrint(obj)
    expect(tableCalls).toEqual([obj])
    expect(logCalls).toEqual([])
  })

  test("map of flat records → one console.table call (combined)", () => {
    const obj = {
      SPY: { price: 739.17, change: 0.42 },
      QQQ: { price: 538.10, change: 0.31 },
    }
    prettyPrint(obj)
    expect(tableCalls).toEqual([obj])
    expect(logCalls).toEqual([])
  })

  test("mixed object (scalars + nested array) → header lines + sub-table", () => {
    prettyPrint({
      seriesId: "GDP",
      count: 2,
      observations: [
        { date: "2016-01-01", value: 1 },
        { date: "2016-04-01", value: 2 },
      ],
    })

    // Header order is preserved: scalars first, then "observations:" label, then table.
    expect(logCalls.slice(0, 3)).toEqual([
      "seriesId: GDP",
      "count: 2",
      "",
    ])
    expect(logCalls).toContain("observations:")
    expect(tableCalls).toEqual([[
      { date: "2016-01-01", value: 1 },
      { date: "2016-04-01", value: 2 },
    ]])
  })

  test("insertion order preserved when containers appear before scalars", () => {
    prettyPrint({
      meta: { symbol: "SPY", currency: "USD" },
      quotes: [{ date: "2024-01-02", close: 472.65 }],
    })

    // First the "meta:" section, then the "quotes:" section.
    const metaIdx = logCalls.indexOf("meta:")
    const quotesIdx = logCalls.indexOf("quotes:")
    expect(metaIdx).toBeGreaterThanOrEqual(0)
    expect(quotesIdx).toBeGreaterThan(metaIdx)

    // Both nested values went through console.table in that same order.
    expect(tableCalls).toEqual([
      { symbol: "SPY", currency: "USD" },
      [{ date: "2024-01-02", close: 472.65 }],
    ])
  })

  test("single-element primitive array → inlined as `key: value`", () => {
    prettyPrint({
      cik: "0000320193",
      tickers: ["AAPL"],
      filings: [{ form: "10-K" }],
    })

    // `tickers` should join the scalar header, not get its own table.
    expect(logCalls).toContain("tickers: AAPL")
    // Single-row table still rendered for `filings`.
    expect(tableCalls).toEqual([[{ form: "10-K" }]])
  })

  test("scalar value → console.log (no table)", () => {
    prettyPrint("hello")
    expect(logCalls).toEqual(["hello"])
    expect(tableCalls).toEqual([])
  })

  test("array of non-flat objects → util.inspect fallback (console.log, no table)", () => {
    prettyPrint([{ nested: { deep: 1 } }])
    expect(tableCalls).toEqual([])
    expect(logCalls.length).toBe(1)
    expect(String(logCalls[0])).toContain("nested")
  })
})
