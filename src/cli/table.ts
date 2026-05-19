/**
 * Minimal ANSI-aware table renderer.
 *
 * Replaces `console.table` for the prettyPrint pipeline so we
 * can wrap long URLs in OSC 8 hyperlinks without `console.table`
 * miscounting the column width — Node/Bun's built-in renderer
 * treats every byte of the escape sequence as a visible character,
 * which inflates the cell and breaks the right border.
 *
 * We measure visible width with the modern `string-width`
 * package (handles SGR, OSC 8, emoji, fullwidth, etc.) and
 * draw the table ourselves with Unicode box-drawing chars that
 * match `console.table`'s look.
 *
 * Three shapes are supported, matching console.table's behaviour:
 *
 *   - `renderObjectTable({ a: 1, b: 2 })`     → vertical k/v
 *   - `renderArrayTable([{ x:1 }, { x:2 }])`  → header + index column
 *   - `renderMapTable({ SPY:{...}, QQQ:{...} })` → outer keys as left col
 *
 * Each takes an already-normalised value — callers are expected to
 * have truncated long strings and collapsed newlines beforehand
 * via `prettyPrint`'s helpers. The renderer itself never mutates
 * cell content, only measures and pads.
 */

import stringWidth from "string-width"

const BOX = {
  top: { l: "┌", r: "┐", x: "┬", h: "─" },
  mid: { l: "├", r: "┤", x: "┼", h: "─" },
  bot: { l: "└", r: "┘", x: "┴", h: "─" },
  v: "│",
}

// ----- color -----------------------------------------------------------------
//
// Type-aware coloring for cell contents, gated on `process.stdout.isTTY`.
// Mirrors the conventions a developer would recognise from `jq -C`, Bun's
// own `console.table`, and most syntax-highlighted REPLs: dates in cyan,
// numbers in yellow, booleans in magenta, null/blank dimmed, strings
// default. Coloring never widens a cell — `stringWidth` strips ANSI
// before measuring.

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  gray: "\x1b[90m",
}

function bold(s: string): string {
  if (!colorEnabled() || s === "") return s
  return ANSI.bold + s + ANSI.reset
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}(T[\d:.+\-Z]+)?$/
const NUMBER_RE = /^-?\d+(\.\d+)?$/

function colorEnabled(): boolean {
  // `NO_COLOR` wins (https://no-color.org). `FORCE_COLOR` opts in even
  // when piped — useful for `--pretty | less -R`. Otherwise: TTY only.
  if (process.env.NO_COLOR) return false
  if (process.env.FORCE_COLOR) return true
  return Boolean(process.stdout.isTTY)
}

function colorize(cell: string): string {
  if (!colorEnabled() || cell === "") return cell
  if (cell === "null") return ANSI.gray + cell + ANSI.reset
  if (cell === "true" || cell === "false") {
    return ANSI.magenta + cell + ANSI.reset
  }

  if (DATE_RE.test(cell)) return ANSI.cyan + cell + ANSI.reset
  if (NUMBER_RE.test(cell)) return ANSI.yellow + cell + ANSI.reset
  return cell
}

function pad(content: string, width: number): string {
  const padCount = width - stringWidth(content)
  if (padCount <= 0) return content
  return content + " ".repeat(padCount)
}

function rule(widths: number[], side: keyof typeof BOX): string {
  if (side === "v") return BOX.v
  const { l, r, x, h } = BOX[side]
  return l + widths.map((w) => h.repeat(w + 2)).join(x) + r
}

function row(cells: string[], widths: number[]): string {
  const padded = cells.map((c, i) => ` ${pad(c, widths[i]!)} `)
  return BOX.v + padded.join(BOX.v) + BOX.v
}

function columnWidths(headers: string[], rows: string[][]): number[] {
  return headers.map((h, i) => {
    let max = stringWidth(h)
    for (const r of rows) {
      const w = stringWidth(r[i] ?? "")
      if (w > max) max = w
    }

    return max
  })
}

function render(headers: string[], rows: string[][]): string {
  const widths = columnWidths(headers, rows)
  // Column 0 in every renderer is the "leftmost label" — auto-index
  // in `renderArrayTable`, key in `renderObjectTable`, outer key in
  // `renderMapTable`. Bold it (it's a label, not a value). Type-color
  // every other column; never type-color the label column.
  const styledHeaders = headers.map(bold)
  const styledRows = rows.map((r) =>
    r.map((cell, ci) => (ci === 0 ? bold(cell) : colorize(cell))),
  )
  const lines = [rule(widths, "top"), row(styledHeaders, widths), rule(widths, "mid")]
  for (let i = 0; i < styledRows.length; i++) {
    lines.push(row(styledRows[i]!, widths))
  }

  lines.push(rule(widths, "bot"))
  return lines.join("\n") + "\n"
}

function cellString(v: unknown): string {
  if (v === null) return "null"
  if (v === undefined) return ""
  if (typeof v === "string") return v
  return String(v)
}

/**
 * Render a flat object as a 2-column vertical key/value table.
 * Matches console.table({...}) on a flat object.
 */
export function renderObjectTable(obj: Record<string, unknown>): string {
  const entries = Object.entries(obj)
  return render(
    ["", "Value"],
    entries.map(([k, v]) => [k, cellString(v)]),
  )
}

/**
 * Render an array of flat objects (or primitives) with an
 * auto-index column and a column per key. Keys come from the
 * union of all rows' keys, preserving first-seen order.
 */
export function renderArrayTable(arr: unknown[]): string {
  if (arr.length === 0) return render([""], [])

  // Primitives + non-objects fall back to single-column "Value".
  if (arr.every((item) => item === null || typeof item !== "object")) {
    return render(
      ["", "Value"],
      arr.map((v, i) => [String(i), cellString(v)]),
    )
  }

  // Union of keys, first-seen order.
  const keys: string[] = []
  for (const item of arr) {
    if (item !== null && typeof item === "object" && !Array.isArray(item)) {
      for (const k of Object.keys(item)) {
        if (!keys.includes(k)) keys.push(k)
      }
    }
  }

  const rows = arr.map((item, i) => {
    const cells = [String(i)]
    const record = (item ?? {}) as Record<string, unknown>
    for (const k of keys) {
      cells.push(cellString(record[k]))
    }

    return cells
  })

  return render(["", ...keys], rows)
}

/**
 * Render a map-of-flat-records as a single table — outer keys
 * become the leftmost column, inner keys become headers.
 */
export function renderMapTable(map: Record<string, Record<string, unknown>>): string {
  const entries = Object.entries(map)
  if (entries.length === 0) return render([""], [])

  // Union of inner keys, first-seen order.
  const keys: string[] = []
  for (const [, record] of entries) {
    for (const k of Object.keys(record)) {
      if (!keys.includes(k)) keys.push(k)
    }
  }

  const rows = entries.map(([outer, record]) => [
    outer,
    ...keys.map((k) => cellString(record[k])),
  ])

  return render(["", ...keys], rows)
}

/**
 * Wrap visible text in an OSC 8 hyperlink escape so terminals
 * that support it (iTerm2, WezTerm, modern macOS Terminal,
 * VS Code's terminal) render `text` as a clickable link to
 * `url`. Terminals without support fall back gracefully — the
 * escape sequence is invisible and only `text` displays.
 *
 * Width measurement via `string-width` already strips this
 * sequence, so wrapped values pad correctly in the table.
 */
export function hyperlink(url: string, text: string): string {
  const OSC = "\x1b]8;;"
  const ST = "\x1b\\"
  return `${OSC}${url}${ST}${text}${OSC}${ST}`
}
