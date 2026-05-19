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

export function prettyPrint(value: unknown): void {
  // Top-level arrays and primitives.
  if (Array.isArray(value)) {
    if (isFlatArray(value)) {
      console.table(value)
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
    console.table(value)
    return
  }

  if (isMapOfFlatRecords(value)) {
    console.table(value)
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
        console.table(v)
      } else {
        console.log(inspect(v, { depth: 3, colors: false }))
      }
    } else if (isPlainObject(v)) {
      if (isFlatObject(v) || isMapOfFlatRecords(v)) {
        console.table(v)
      } else {
        console.log(inspect(v, { depth: 3, colors: false }))
      }
    }

    console.log("")
  }

  flushScalars()
}
