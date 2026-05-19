/**
 * Tests for `src/cli/ansi.ts`. The test runner preloads
 * `src/test-setup.ts`, which pins `FORCE_COLOR=1` — so by default
 * the helpers DO emit escapes. Each test toggles env explicitly
 * when it needs to verify the gating path.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import {
  blue,
  bold,
  colorEnabled,
  colorize,
  cyan,
  dim,
  gray,
  green,
  italic,
  magenta,
  red,
  underline,
  yellow,
} from "./ansi"

const ORIG = {
  FORCE_COLOR: process.env.FORCE_COLOR,
  NO_COLOR: process.env.NO_COLOR,
}

beforeEach(() => {
  process.env.FORCE_COLOR = "1"
  delete process.env.NO_COLOR
})

afterEach(() => {
  if (ORIG.FORCE_COLOR === undefined) delete process.env.FORCE_COLOR
  else process.env.FORCE_COLOR = ORIG.FORCE_COLOR
  if (ORIG.NO_COLOR === undefined) delete process.env.NO_COLOR
  else process.env.NO_COLOR = ORIG.NO_COLOR
})

describe("colorEnabled", () => {
  test("NO_COLOR wins over FORCE_COLOR", () => {
    process.env.NO_COLOR = "1"
    process.env.FORCE_COLOR = "1"
    expect(colorEnabled()).toBe(false)
  })

  test("FORCE_COLOR=1 enables color even when not a TTY", () => {
    process.env.FORCE_COLOR = "1"
    delete process.env.NO_COLOR
    expect(colorEnabled()).toBe(true)
  })

  test("neither set → falls back to isTTY (false under bun test)", () => {
    delete process.env.FORCE_COLOR
    delete process.env.NO_COLOR
    expect(colorEnabled()).toBe(Boolean(process.stdout.isTTY))
  })
})

describe("style helpers", () => {
  test("each helper wraps its argument with the matching SGR escape", () => {
    expect(bold("x")).toBe("\x1b[1mx\x1b[0m")
    expect(dim("x")).toBe("\x1b[2mx\x1b[0m")
    expect(italic("x")).toBe("\x1b[3mx\x1b[0m")
    expect(underline("x")).toBe("\x1b[4mx\x1b[0m")
    expect(red("x")).toBe("\x1b[31mx\x1b[0m")
    expect(green("x")).toBe("\x1b[32mx\x1b[0m")
    expect(yellow("x")).toBe("\x1b[33mx\x1b[0m")
    expect(blue("x")).toBe("\x1b[34mx\x1b[0m")
    expect(magenta("x")).toBe("\x1b[35mx\x1b[0m")
    expect(cyan("x")).toBe("\x1b[36mx\x1b[0m")
    expect(gray("x")).toBe("\x1b[90mx\x1b[0m")
  })

  test("empty input → empty output (no escape pair around nothing)", () => {
    expect(bold("")).toBe("")
    expect(cyan("")).toBe("")
  })

  test("no-op when NO_COLOR is set", () => {
    process.env.NO_COLOR = "1"
    expect(bold("x")).toBe("x")
    expect(cyan("hello")).toBe("hello")
  })
})

describe("colorize (type-aware cell coloring)", () => {
  test("ISO date → cyan", () => {
    expect(colorize("2024-01-01")).toBe("\x1b[36m2024-01-01\x1b[0m")
    expect(colorize("2024-01-01T14:30:00.000Z")).toBe(
      "\x1b[36m2024-01-01T14:30:00.000Z\x1b[0m",
    )
  })

  test("integer / float → yellow", () => {
    expect(colorize("42")).toBe("\x1b[33m42\x1b[0m")
    expect(colorize("3.14")).toBe("\x1b[33m3.14\x1b[0m")
    expect(colorize("-7")).toBe("\x1b[33m-7\x1b[0m")
  })

  test("true / false → magenta", () => {
    expect(colorize("true")).toBe("\x1b[35mtrue\x1b[0m")
    expect(colorize("false")).toBe("\x1b[35mfalse\x1b[0m")
  })

  test("null → gray", () => {
    expect(colorize("null")).toBe("\x1b[90mnull\x1b[0m")
  })

  test("plain string → unchanged", () => {
    expect(colorize("AAPL")).toBe("AAPL")
    expect(colorize("Gross Domestic Product")).toBe("Gross Domestic Product")
  })

  test("empty cell → unchanged", () => {
    expect(colorize("")).toBe("")
  })

  test("no-op when NO_COLOR is set", () => {
    process.env.NO_COLOR = "1"
    expect(colorize("2024-01-01")).toBe("2024-01-01")
    expect(colorize("42")).toBe("42")
    expect(colorize("true")).toBe("true")
    expect(colorize("null")).toBe("null")
  })
})
