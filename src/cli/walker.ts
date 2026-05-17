/**
 * Walks a `z.ZodObject` shape and adds one commander argument
 * or option per key. Handles the common zod types we use
 * (string, number, boolean, array, enum) plus `.optional()` and
 * `.default()` wrappers.
 *
 * `positional` lifts those keys out of `--flag` form and into
 * `.argument("<key>")` (or `.argument("<key...>")` for arrays)
 * for plugin commands that want a positional surface. The
 * generic `api <endpoint>` walker always passes
 * `positional: []` so every key is a `--flag`.
 */

import type { Command } from "commander"
import { z } from "zod"

interface FieldInfo {
  /** Logical type the CLI side cares about. */
  kind: "string" | "number" | "boolean" | "string-array" | "number-array" | "enum"
  optional: boolean
  defaultValue: unknown | undefined
  enumValues?: readonly string[]
  description?: string
}

export interface WalkOptions {
  /** Keys to render as positional `.argument()` instead of `--flag`. */
  positional?: readonly string[]
}

export function walkSchemaToCommander(
  cmd: Command,
  schema: z.ZodObject,
  opts: WalkOptions = {},
): void {
  const positional = new Set(opts.positional ?? [])

  for (const [key, fieldSchema] of Object.entries(schema.shape)) {
    if (!isZodType(fieldSchema)) continue
    const info = inspectZod(fieldSchema)

    if (positional.has(key)) {
      addArgument(cmd, key, info)
    } else {
      addOption(cmd, key, info)
    }
  }
}

// ---------------------------------------------------------------------------
// Schema → CLI primitives
// ---------------------------------------------------------------------------

function addArgument(cmd: Command, key: string, info: FieldInfo): void {
  const isArray = info.kind === "string-array" || info.kind === "number-array"
  const required = !info.optional && info.defaultValue === undefined
  const wrap = required ? "<>" : "[]"
  const label = isArray ? `${wrap[0]}${key}...${wrap[1]}` : `${wrap[0]}${key}${wrap[1]}`

  cmd.argument(label, info.description)
}

function addOption(cmd: Command, key: string, info: FieldInfo): void {
  const flag = `--${kebab(key)}`
  const placeholder = optionPlaceholder(info)
  const required = !info.optional && info.defaultValue === undefined
  const flagDecl = info.kind === "boolean"
    ? flag
    : `${flag} ${placeholder}`

  const description = info.description ?? optionDescription(info)

  if (info.defaultValue !== undefined) {
    cmd.option(flagDecl, description, info.defaultValue as string)
  } else if (required) {
    cmd.requiredOption(flagDecl, description)
  } else {
    cmd.option(flagDecl, description)
  }
}

function optionPlaceholder(info: FieldInfo): string {
  if (info.kind === "string-array" || info.kind === "number-array") return "<a,b,c>"
  if (info.kind === "number") return "<n>"
  if (info.kind === "enum" && info.enumValues) {
    return `<${info.enumValues.join("|")}>`
  }
  return "<v>"
}

function optionDescription(info: FieldInfo): string {
  if (info.kind === "enum" && info.enumValues) {
    return info.enumValues.join(" | ")
  }
  return ""
}

// ---------------------------------------------------------------------------
// zod introspection — unwrap .optional() / .default() / .coerce, identify the
// underlying type. Covers the cases we use; new types extend this.
// ---------------------------------------------------------------------------

function inspectZod(schema: z.ZodType): FieldInfo {
  let optional = false
  let defaultValue: unknown | undefined
  let current: z.ZodType = schema

  // Peel wrapper types repeatedly.
  while (true) {
    const def = (current as { def?: { type?: string } }).def
    const tag = def?.type

    if (tag === "optional") {
      optional = true
      current = (current as z.ZodOptional<z.ZodType>).unwrap()
      continue
    }
    if (tag === "default") {
      // zod v4: `def.defaultValue` is the value itself
      // (v3 wrapped it as a thunk).
      const inner = (current as unknown as { def: { innerType: z.ZodType, defaultValue: unknown } }).def
      if (defaultValue === undefined) defaultValue = inner.defaultValue
      current = inner.innerType
      continue
    }
    if (tag === "nullable") {
      optional = true
      current = (current as z.ZodNullable<z.ZodType>).unwrap()
      continue
    }
    break
  }

  const innerTag = (current as { def?: { type?: string } }).def?.type

  if (innerTag === "enum") {
    const values = (current as z.ZodEnum<Record<string, string>>).options
    return { kind: "enum", optional, defaultValue, enumValues: values }
  }
  if (innerTag === "array") {
    const arr = current as z.ZodArray<z.ZodType>
    const elTag = (arr.element as { def?: { type?: string } }).def?.type
    return {
      kind: elTag === "number" ? "number-array" : "string-array",
      optional,
      defaultValue,
    }
  }
  if (innerTag === "number") {
    return { kind: "number", optional, defaultValue }
  }
  if (innerTag === "boolean") {
    return { kind: "boolean", optional, defaultValue }
  }
  // Default: treat as string. (Catches z.string(), z.coerce.string(), etc.)
  return { kind: "string", optional, defaultValue }
}

function isZodType(v: unknown): v is z.ZodType {
  return typeof v === "object" && v !== null && "def" in v
}

function kebab(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
}

// ---------------------------------------------------------------------------
// argv → args object
//
// commander hands the action callback its positional args as
// individual params and the parsed options as a single object.
// `collectArgs` rebuilds a flat `{ key: value }` object from
// the action callback's argv, coercing array-shaped flags from
// their CSV / variadic form back to JS arrays.
// ---------------------------------------------------------------------------

export function collectArgs(
  schema: z.ZodObject,
  positional: readonly string[],
  argv: unknown[],
): Record<string, unknown> {
  // argv layout: [...positional, optionsObject, commandInstance]
  const optionsObj = argv[argv.length - 2] as Record<string, unknown>
  const positionals = argv.slice(0, argv.length - 2)

  const out: Record<string, unknown> = {}

  // Positional args, in declaration order.
  for (let i = 0; i < positional.length; i++) {
    const key = positional[i]
    if (key === undefined) continue
    const value = positionals[i]
    if (value === undefined) continue
    out[key] = coerceForKey(schema, key, value)
  }

  // Options. Commander camelCases kebab-flag names, so a `--from-date`
  // flag becomes `opts.fromDate`. We match against the schema's actual
  // keys (which are camelCase).
  for (const key of Object.keys(schema.shape)) {
    if (positional.includes(key)) continue
    const value = optionsObj[key]
    if (value === undefined) continue
    out[key] = coerceForKey(schema, key, value)
  }

  return out
}

function coerceForKey(
  schema: z.ZodObject,
  key: string,
  rawValue: unknown,
): unknown {
  const field = schema.shape[key]
  if (!field || !isZodType(field)) return rawValue
  const info = inspectZod(field)

  if (info.kind === "string-array" || info.kind === "number-array") {
    if (Array.isArray(rawValue)) return rawValue
    if (typeof rawValue === "string") {
      const parts = rawValue.split(",").map((p) => p.trim()).filter(Boolean)
      return info.kind === "number-array" ? parts.map(Number) : parts
    }
  }
  return rawValue
}
