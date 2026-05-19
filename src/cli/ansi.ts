/**
 * Minimal ANSI styling helpers — a chalk-shaped API without the
 * dependency. Used by `table.ts` for cell coloring and by
 * `factory.ts` to style Commander's `--help` output.
 *
 * All helpers no-op when color is disabled, so callers can wrap
 * unconditionally:
 *
 *   bold(`Usage:`) + " " + commandName
 *
 * Color gating (in `colorEnabled()`):
 *
 *   1. `NO_COLOR` set → off (https://no-color.org).
 *   2. `FORCE_COLOR` set → on, even when piped. Useful for
 *      `bin --pretty | less -R` and for snapshot tests.
 *   3. Otherwise: on only when `process.stdout.isTTY` is true.
 *
 * The escapes themselves are zero-width — `string-width` strips
 * them before measuring, so wrapping a cell never inflates a
 * column.
 */

const ESC = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  underline: "\x1b[4m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
} as const

type StyleName = Exclude<keyof typeof ESC, "reset">

/**
 * Are ANSI escapes safe to emit on stdout right now?
 *
 *   - `NO_COLOR=1`         → false (wins over everything).
 *   - `FORCE_COLOR=1`      → true (even when piped).
 *   - otherwise            → true iff `process.stdout.isTTY`.
 */
export function colorEnabled(): boolean {
  if (process.env.NO_COLOR) return false
  if (process.env.FORCE_COLOR) return true
  return Boolean(process.stdout.isTTY)
}

function wrap(style: StyleName, s: string): string {
  if (!colorEnabled() || s === "") return s
  return ESC[style] + s + ESC.reset
}

// --- styles ------------------------------------------------------------------

export const bold = (s: string): string => wrap("bold", s)
export const dim = (s: string): string => wrap("dim", s)
export const italic = (s: string): string => wrap("italic", s)
export const underline = (s: string): string => wrap("underline", s)

// --- colors ------------------------------------------------------------------

export const red = (s: string): string => wrap("red", s)
export const green = (s: string): string => wrap("green", s)
export const yellow = (s: string): string => wrap("yellow", s)
export const blue = (s: string): string => wrap("blue", s)
export const magenta = (s: string): string => wrap("magenta", s)
export const cyan = (s: string): string => wrap("cyan", s)
export const gray = (s: string): string => wrap("gray", s)

// --- type-aware cell coloring ------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}(T[\d:.+\-Z]+)?$/
const NUMBER_RE = /^-?\d+(\.\d+)?$/

/**
 * Color a table cell by inferred type. Conventions match `jq -C`
 * and most syntax-highlighted REPLs:
 *
 *   - ISO date (`YYYY-MM-DD[Thh:mm…]`)   → cyan
 *   - finite number                       → yellow
 *   - `true` / `false`                    → magenta
 *   - `null`                              → dim gray
 *   - anything else (strings)             → unchanged
 */
export function colorize(cell: string): string {
  if (!colorEnabled() || cell === "") return cell
  if (cell === "null") return gray(cell)
  if (cell === "true" || cell === "false") return magenta(cell)
  if (DATE_RE.test(cell)) return cyan(cell)
  if (NUMBER_RE.test(cell)) return yellow(cell)
  return cell
}
