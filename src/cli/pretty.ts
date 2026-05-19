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

// Two failure modes for string values inside `console.table`:
//
//   1. Newlines render literally, breaking row alignment — the
//      right border drifts to wrap each line.
//   2. Very long single-line strings stretch a column across the
//      whole terminal, even when the value isn't load-bearing.
//
// We normalise each string before it hits `console.table`:
//
//   - newlines collapse to a visible `⏎ ` marker so the cell
//     stays single-line and the table's row alignment survives;
//   - anything over MAX_INLINE_LENGTH is truncated with a
//     `… [+N chars]` tail.
//
// Truncating URLs is a known tradeoff — the alternative (rendering
// them out-of-line below the table) split the output into two
// sections and read worse for the common case. If a user needs
// the full URL or body content, they can re-run with `--json`.
const MAX_INLINE_LENGTH = 80
const NEWLINE_MARKER = " ⏎ "

function normaliseForTable(v: unknown): unknown {
  if (typeof v !== "string") return v
  const flat = v.includes("\n") ? v.replaceAll(/\n+/g, NEWLINE_MARKER) : v
  if (flat.length <= MAX_INLINE_LENGTH) return flat
  // Reserve ~14 chars for the ` … [+N chars]` marker so the cell
  // never exceeds MAX_INLINE_LENGTH overall.
  const head = flat.slice(0, MAX_INLINE_LENGTH - 14).trimEnd()
  return `${head}… [+${v.length - head.length} chars]`
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

export function prettyPrint(value: unknown): void {
  // Top-level arrays and primitives.
  if (Array.isArray(value)) {
    if (isFlatArray(value)) {
      console.table(normaliseArrayForTable(value))
    } else {
      console.log(inspect(value, { depth: 4, colors: false }))
    }

    return
  }

  if (!isPlainObject(value)) {
    console.log(value)
    return
  }

  // Whole-object shortcuts.
  if (Object.values(value).every(isScalar)) {
    console.table(normaliseObjectForTable(value))
    return
  }

  if (isMapOfFlatRecords(value)) {
    console.table(normaliseMapForTable(value))
    return
  }

  // Mixed: walk entries in insertion order. Batch adjacent scalars
  // into one "header block" and render each container value as its
  // own labelled table.
  let scalarBuffer: [string, unknown][] = []

  const flushScalars = (): void => {
    if (scalarBuffer.length === 0) return
    for (const [k, v] of scalarBuffer) {
      console.log(`${k}: ${v}`)
    }

    console.log("")
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
    console.log(`${k}:`)

    if (Array.isArray(v)) {
      if (isFlatArray(v)) {
        console.table(normaliseArrayForTable(v))
      } else {
        console.log(inspect(v, { depth: 3, colors: false }))
      }
    } else if (isPlainObject(v)) {
      if (isFlatObject(v)) {
        console.table(normaliseObjectForTable(v))
      } else if (isMapOfFlatRecords(v)) {
        console.table(normaliseMapForTable(v))
      } else {
        console.log(inspect(v, { depth: 3, colors: false }))
      }
    }

    console.log("")
  }

  flushScalars()
}
