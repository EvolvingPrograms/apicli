/**
 * Snapshot tests for the rendered tables `prettyPrint` produces
 * against the real shapes downstream utilities emit (FRED
 * observations, edgar filings, yahoo chart, market-stats
 * drawdown, rss feeds, multi-symbol quote maps, etc.).
 *
 * The other test file (`pretty.test.ts`) asserts dispatch
 * decisions — what gets sent through `console.table` vs
 * `console.log`. This file pins the actual rendered text. They
 * complement each other:
 *
 *   - dispatch test changes if we ever rewire which branch
 *     handles which shape;
 *   - snapshot test changes if Node/Bun bumps box-drawing
 *     characters or column widths, or we tweak the formatter's
 *     visible output (spacing, blank-line conventions, etc.).
 *
 * Bun's `console.table` writes through an internal stdout path
 * that bypasses test stubs on `process.stdout.write`, so we spawn
 * a child `bun -e` per case and capture its stdout. Slower than
 * in-process stubbing but the only way to snapshot the real
 * rendering.
 */

import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"

const PRETTY_TS = resolve(import.meta.dir, "pretty.ts")

async function render(value: unknown): Promise<string> {
  // Inline the input as JSON so the child process doesn't have to
  // share memory — keeps the script self-contained and reproducible.
  const script = `
    import { prettyPrint } from ${JSON.stringify(PRETTY_TS)}
    prettyPrint(${JSON.stringify(value)})
  `
  const proc = Bun.spawn(["bun", "-e", script], {
    stdout: "pipe",
    stderr: "pipe",
    // Match the in-process test setup (FORCE_COLOR=1) so snapshots
    // include the ANSI bytes — bold headers, type-colored cells. The
    // color is part of the contract; pinning it in snapshots makes
    // regressions in coloring visible in the diff.
    env: { ...process.env, FORCE_COLOR: "1", NO_COLOR: undefined },
  })

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])

  const exitCode = await proc.exited
  if (exitCode !== 0) {
    throw new Error(`prettyPrint child exited ${exitCode}: ${stderr}`)
  }

  return stdout
}

describe("prettyPrint — rendered snapshots", () => {
  test("FRED observations (mixed: scalars + nested array)", async () => {
    const out = await render({
      seriesId: "GDP",
      count: 3,
      observations: [
        { date: "2016-01-01", value: 18525.933 },
        { date: "2016-04-01", value: 18711.702 },
        { date: "2016-07-01", value: 18892.639 },
      ],
    })

    expect(out).toMatchSnapshot()
  })

  test("FRED meta (flat object)", async () => {
    const out = await render({
      id: "GDP",
      title: "Gross Domestic Product",
      frequency: "Quarterly",
      units: "Billions of Dollars",
      observationStart: "1947-01-01",
    })

    expect(out).toMatchSnapshot()
  })

  test("market-stats returns (primitive array)", async () => {
    const out = await render([0.10, -0.10, 0.05])
    expect(out).toMatchSnapshot()
  })

  test("yahoo chart (meta first, quotes second — insertion order)", async () => {
    const out = await render({
      meta: { symbol: "SPY", currency: "USD", regularMarketPrice: 739.17 },
      quotes: [
        { date: "2024-01-02", open: 472.16, close: 472.65 },
        { date: "2024-01-03", open: 470.43, close: 468.79 },
      ],
    })

    expect(out).toMatchSnapshot()
  })

  test("edgar filings list (single-element tickers inlined as scalar)", async () => {
    const out = await render({
      cik: "0000320193",
      name: "Apple Inc.",
      tickers: ["AAPL"],
      filings: [
        { form: "10-K", filingDate: "2025-10-31", accessionNumber: "0000320193-25-000079" },
        { form: "10-Q", filingDate: "2026-01-30", accessionNumber: "0000320193-26-000010" },
      ],
    })

    expect(out).toMatchSnapshot()
  })

  test("yahoo multi-quote (map of flat records → single combined table)", async () => {
    const out = await render({
      SPY: { regularMarketPrice: 739.17, regularMarketChangePercent: 0.42 },
      QQQ: { regularMarketPrice: 538.10, regularMarketChangePercent: 0.31 },
    })

    expect(out).toMatchSnapshot()
  })

  test("market-stats drawdown (scalars trail nested objects)", async () => {
    const out = await render({
      current: { i: 4, price: 95, dd: -0.05 },
      max: { i: 3, dd: -0.30 },
      peakIdx: 0,
      recoveryIdx: null,
    })

    expect(out).toMatchSnapshot()
  })

  test("rss-feeds fetch (scalars + items array)", async () => {
    const out = await render({
      kind: "rss",
      title: "Press Releases",
      link: "https://www.sec.gov/",
      items: [
        { title: "Headline A", link: "https://...", pubDate: "2026-05-19T11:00:00Z" },
        { title: "Headline B", link: "https://...", pubDate: "2026-05-18T11:00:00Z" },
      ],
    })

    expect(out).toMatchSnapshot()
  })

  test("array of non-flat objects (util.inspect fallback)", async () => {
    const out = await render([{ nested: { deep: 1, deeper: { x: 42 } } }])
    expect(out).toMatchSnapshot()
  })

  // edgar-filings `read` returns a flat object whose `body` is a
  // multi-paragraph string and `url` is a long single line. Pre-fix
  // this rendered as a single console.table cell stretching far
  // past the terminal width with literal `\n` chars breaking row
  // alignment. After the fix: newlines collapse to `⏎ `, long
  // values truncate inline, table integrity preserved.
  test("edgar-filings read (long body + long URL, the original repro)", async () => {
    const out = await render({
      ticker: "AAPL",
      accession: "0000320193-23-000106",
      url: "https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/aapl-20230930.htm",
      form: "10-K",
      filingDate: "2023-11-03",
      raw: false,
      body: "Item 1.\n\nBusiness\n\nApple Inc., designs, manufactures, and markets smartphones, personal computers, tablets, wearables, and accessories worldwide. The company offers iPhone, Mac, iPad, AirPods, Apple TV, Apple Watch, Beats products, HomePod, iPod touch, and accessories.\n\nItem 1A.\n\nRisk Factors\n\nThe Company is subject to a variety of risks ...",
    })

    expect(out).toMatchSnapshot()
  })
})
