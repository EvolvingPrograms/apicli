Up: [../README.md](../README.md)

# `lib/api-cli/cli/` — CLI runtime

Wraps a set of zod-typed `defineCommand` functions (plus an
optional API client) into a commander program with auto JSON
emission, error-class mapping, and a schema-driven `--flag`
walker.

## Files

- [`index.ts`](./index.ts) — barrel.
- [`command.ts`](./command.ts) — `defineCommand({schema,
  handler, positional?})` returns a `CommandFn<S, R>` — callable
  like a function with typed args + return, plus a
  variance-neutral `StoredCommand` view (name, schema,
  positional, `invoke(unknown)`) that `createCli` can register
  uniformly.
- [`command.test.ts`](./command.test.ts) — typed call,
  invalid-input rejection, schema defaults, exposed metadata,
  variance-neutral `invoke` shape, positional defaults to `[]`.
- [`factory.ts`](./factory.ts) — `createCli({name, description,
  commands, api?, errorClass?})` builds the commander program:
  registers each command, walks its schema for `--flag` /
  `<arg>` declarations, wires `addApiCli` if `api` is set, and
  hands back `{ program, run() }`.
- [`factory.test.ts`](./factory.test.ts) — positional + flag
  dispatch, JSON emission, errorClass mapping → stderr + exit 1,
  array flags comma-split, raw `program` escape hatch.
- [`walker.ts`](./walker.ts) — `walkSchemaToCommander(cmd, schema,
  {positional})` and `collectArgs(schema, positional, argv)`.
  The introspection layer over zod: handles `.optional()`,
  `.default()`, `.nullable()`, enums, arrays, numbers, booleans,
  strings. Camel-case schema keys become kebab-case flags.
- [`walker.test.ts`](./walker.test.ts) — required vs optional,
  defaults, enum placeholders, array placeholders, kebab-case
  conversion, positional + variadic, argv → args reconstitution.
- [`emit.ts`](./emit.ts) — `emit(value)` (JSON-on-stdout) and
  `mapError(err, name, errorClass?)` (typed `→ stderr` + `exit 1`,
  with special-case formatting for `z.ZodError`).
- [`emit.test.ts`](./emit.test.ts) — stdout JSON, errorClass
  branch, ZodError prettify branch, generic Error fallback,
  non-Error string fallback.

## How `walker.ts` maps zod → commander

| zod schema field                | commander declaration             |
|---|---|
| `z.string()` (required)         | `.requiredOption("--key <v>", "")` |
| `z.string().optional()`         | `.option("--key <v>", "")`         |
| `z.string().default("x")`       | `.option("--key <v>", "", "x")`    |
| `z.coerce.number()`             | `.option("--key <n>", "")`         |
| `z.boolean()`                   | `.option("--key")`                 |
| `z.array(z.string())`           | `.option("--key <a,b,c>", "")`     |
| `z.enum(["a","b"])`             | `.option("--key <a\|b>", "")`      |
| key in `positional` (string)    | `.argument("<key>")`               |
| key in `positional` (array)     | `.argument("<key...>")` (variadic) |

camelCase schema keys (`seriesId`) become kebab-case flags
(`--series-id`). The reverse mapping happens at action time via
commander's own option-name canonicalisation.

## Order of operations on dispatch

```
argv  →  walkSchemaToCommander declared parser
      →  collectArgs(schema, positional, argv) [merges positional + opts,
                                                comma-splits array flags]
      →  cmd.invoke(rawArgs) [zod.parse() inside]
      →  handler({...validated})
      →  emit(JSON.stringify(return value))
              [on throw → mapError(err) → stderr + exit 1]
```
