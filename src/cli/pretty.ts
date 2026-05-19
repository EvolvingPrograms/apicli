/**
 * Pretty-print a CLI value for humans (and agents) to read.
 *
 * `console.table` alone is sharp on one shape — array of flat
 * objects — but mangles everything else: a wrapping object with
 * a nested array becomes a 41-column horizontal eyesore as it
 * tries to inline each array element into the wrapper's row.
 *
 * `prettyPrint` walks the value once and picks the best fit per
 * piece:
 *
 *   - flat array (scalars or flat objects)  → `console.table`
 *   - flat object (all primitive values)    → `console.table` (vertical k/v)
 *   - map of flat records                   → `console.table` (single combined table)
 *   - mixed object (scalars + containers)   → header lines for scalars,
 *                                             labelled sub-table per container,
 *                                             insertion order preserved
 *   - single-element primitive array        → inlined as `key: value`
 *     (avoids the noisy 2-column table)
 *   - long string cells                     → truncated with `… [+N chars]`
 *     so a 400-char description doesn't stretch a column across the
 *     whole terminal; newlines collapse to a `⏎ ` marker so they
 *     don't break row alignment
 *   - anything still deeply nested at a leaf → `util.inspect(depth: 3)`
 *
 * The output is plain text on stdout. No colour, no TTY detection —
 * tables are easy to read whether they land in a terminal, a log
 * file, or an agent's tool-result window.
 */

import { inspect } from "node:util"

import {
  hyperlink,
  renderArrayTable,
  renderMapTable,
  renderObjectTable,
} from "./table"

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function isScalar(v: unknown): boolean {
  return v === null || typeof v !== "object"
}

function isFlatObject(v: unknown): v is Record<string, unknown> {
  return isPlainObject(v) && Object.values(v).every(isScalar)
}

function isFlatArray(v: unknown[]): boolean {
  return v.every((item) => isScalar(item) || isFlatObject(item))
}

function isMapOfFlatRecords(v: Record<string, unknown>): boolean {
  const vals = Object.values(v)
  return vals.length > 0 && vals.every(isFlatObject)
}

// Three failure modes for string values inside a table cell:
//
//   1. Newlines render literally and break row alignment.
//   2. Very long single-line strings stretch a column across the
//      whole terminal, even when the value isn't load-bearing.
//   3. URLs in particular are useless when truncated — you can't
//      copy what's not there. So we keep them clickable via an
//      OSC 8 hyperlink escape (terminals that support it render
//      the visible text as a link; others render it as plain
//      text, with the escape bytes hidden in supporting tools).
//
// We normalise each table-bound string accordingly:
//
//   - URL-shaped values → truncated visible text wrapped in
//     OSC 8 hyperlink to the full URL.
//   - Newlines collapse to a `⏎ ` marker so the cell stays
//     single-line.
//   - Anything over MAX_INLINE_LENGTH (and not a URL) is
//     truncated with a `… [+N chars]` tail.
//
// Width measurement uses `string-width` from our own
// `./table` module, which correctly strips OSC 8 + SGR before
// measuring — `console.table` couldn't (it counts every byte),
// which is why we replaced it with the local renderer.
const MAX_INLINE_LENGTH = 80
const NEWLINE_MARKER = " ⏎ "

function isUrl(v: string): boolean {
  return /^https?:\/\//.test(v)
}

function truncateVisible(s: string, max: number): string {
  if (s.length <= max) return s
  const head = s.slice(0, max - 14).trimEnd()
  return `${head}… [+${s.length - head.length} chars]`
}

function normaliseForTable(v: unknown): unknown {
  if (typeof v !== "string") return v
  // URLs: keep clickable via OSC 8, truncate the visible text
  // so the column doesn't stretch across the terminal.
  if (isUrl(v)) {
    if (v.length <= MAX_INLINE_LENGTH) return hyperlink(v, v)
    const visible = truncateVisible(v, MAX_INLINE_LENGTH)
    return hyperlink(v, visible)
  }

  const flat = v.includes("\n") ? v.replaceAll(/\n+/g, NEWLINE_MARKER) : v
  return truncateVisible(flat, MAX_INLINE_LENGTH)
}

function normaliseObjectForTable(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    out[k] = normaliseForTable(v)
  }

  return out
}

function normaliseArrayForTable(arr: unknown[]): unknown[] {
  return arr.map((item) =>
    isPlainObject(item) ? normaliseObjectForTable(item) : normaliseForTable(item),
  )
}

function normaliseMapForTable(
  obj: Record<string, unknown>,
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {}
  for (const [k, v] of Object.entries(obj)) {
    out[k] = normaliseObjectForTable(v as Record<string, unknown>)
  }

  return out
}

/**
 * Build the pretty-printed string for `value`. Returns the
 * complete rendering (including trailing newlines); callers are
 * responsible for writing it to stdout. Keeping this as a pure
 * function makes it cheap to unit-test and snapshot.
 */
export function prettyFormat(value: unknown): string {
  // Top-level arrays and primitives.
  if (Array.isArray(value)) {
    if (isFlatArray(value)) {
      return renderArrayTable(normaliseArrayForTable(value))
    }

    return inspect(value, { depth: 4, colors: false }) + "\n"
  }

  if (!isPlainObject(value)) {
    return String(value) + "\n"
  }

  // Whole-object shortcuts.
  if (Object.values(value).every(isScalar)) {
    return renderObjectTable(normaliseObjectForTable(value))
  }

  if (isMapOfFlatRecords(value)) {
    return renderMapTable(normaliseMapForTable(value))
  }

  // Mixed: walk entries in insertion order. Batch adjacent scalars
  // into one "header block" and render each container value as its
  // own labelled table.
  const parts: string[] = []
  let scalarBuffer: [string, unknown][] = []

  const flushScalars = (): void => {
    if (scalarBuffer.length === 0) return
    for (const [k, v] of scalarBuffer) {
      parts.push(`${k}: ${v}\n`)
    }

    parts.push("\n")
    scalarBuffer = []
  }

  for (const [k, v] of Object.entries(value)) {
    if (isScalar(v)) {
      scalarBuffer.push([k, v])
      continue
    }

    // Single-element primitive array → inline as `key: value`.
    if (Array.isArray(v) && v.length === 1 && isScalar(v[0])) {
      scalarBuffer.push([k, v[0]])
      continue
    }

    flushScalars()
    parts.push(`${k}:\n`)

    if (Array.isArray(v)) {
      if (isFlatArray(v)) {
        parts.push(renderArrayTable(normaliseArrayForTable(v)))
      } else {
        parts.push(inspect(v, { depth: 3, colors: false }) + "\n")
      }
    } else if (isPlainObject(v)) {
      if (isFlatObject(v)) {
        parts.push(renderObjectTable(normaliseObjectForTable(v)))
      } else if (isMapOfFlatRecords(v)) {
        parts.push(renderMapTable(normaliseMapForTable(v)))
      } else {
        parts.push(inspect(v, { depth: 3, colors: false }) + "\n")
      }
    }

    parts.push("\n")
  }

  flushScalars()
  return parts.join("")
}

/**
 * Write `prettyFormat(value)` to stdout. Thin shim so the rest
 * of clipi (emit.ts) can call a single entry point.
 */
export function prettyPrint(value: unknown): void {
  process.stdout.write(prettyFormat(value))
}
