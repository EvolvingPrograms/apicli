# apicli

Schema-driven API client + auto-generated CLI. Define your API
once with zod schemas — get a typed HTTP client, a generic
`api <endpoint> --flag value` CLI, and ergonomic `defineCommand`
wrappers for free.

```
┌─ schema (zod) ─────────┐      ┌─ typed client ─────────┐
│  ENDPOINTS = {         │  →   │  api.chart({…})        │
│    chart: get(…),      │      │  // typed return       │
│    quoteSummary: dependent(…),│      ╰────────────────────────╯
│  } as const            │      ┌─ generic CLI ──────────┐
╰────────────────────────╯  →   │  api chart --…         │
                                ╰────────────────────────╯

┌─ defineCommand(schema, handler) ─┐     ┌─ createCli({api, commands}) ──┐
│  typed "API function"             │ →   │  commander program            │
│  + variance-neutral storage view  │     │  + JSON-on-stdout             │
│  + callable + composable          │     │  + error → stderr + exit 1    │
╰───────────────────────────────────╯     ╰───────────────────────────────╯
```

## Install

```bash
bun add apicli
```

`apicli` ships as **pure TypeScript** (no build step, no
transpilation). Designed for [Bun](https://bun.sh) — published
`.ts` source resolves natively and runs with full type checking.

Depends on `zod` and `commander`.

## Runtime

- **Bun** — first-class. `bun add apicli` and import.
- **Node ≥ 22** — works with `--experimental-strip-types`, or
  via a TS loader (`tsx`, `ts-node`). Not the primary target.

If you need a built JS/CJS version, fork and add a `tsc` build
step — the source is plain ES modules with no Bun-specific APIs
in the runtime path (tests use `bun:test` + `Bun.serve`).

## Quick start

```ts
import { z } from "zod"
import { createCli, defineApi, defineCommand, get } from "apicli"

// 1. Schema — single source of truth (types + runtime + flags)
const myApi = defineApi({
  name: "my-api",
  baseUrl: "https://example.test",
  endpoints: {
    foo: get(
      "/v1/foo/{id}",
      z.object({
        id: z.string(),
        verbose: z.boolean().optional(),
      }),
      { response: z.object({ id: z.string(), name: z.string() }) },
    ),
  },
})

// 2. Typed client method works in-process
const result = await myApi.foo({ id: "abc" })
//    ^^^ { id: string, name: string } — inferred from `response`

// 3. Friendly command wraps the API for ergonomic CLI use
const fetchFoo = defineCommand({
  name: "fetch",
  schema: z.object({ id: z.string() }),
  positional: ["id"],
  handler: ({ id }) => myApi.foo({ id }),
})

// 4. createCli wires the lot into a commander program
const cli = createCli({
  name: "my-cli",
  description: "Demo CLI",
  api: myApi,             // → adds `api <endpoint> --flag value` for free
  commands: [fetchFoo],   // → adds `fetch <id>` ergonomic surface
})

await cli.run()
```

Now the user can do either:

```bash
my-cli fetch abc                       # ergonomic friendly command
my-cli api foo --id abc --verbose      # generic API surface
```

Both call `myApi.foo({...})` under the hood — same validation,
same response parsing, same error mapping.

## Three endpoint shapes

```ts
// 1. Static endpoint
foo: get("/v1/foo", z.object({ x: z.string() })),

// 2. Static endpoint with typed response
foo: get(
  "/v1/foo",
  z.object({ x: z.string() }),
  { response: z.object({ ok: z.boolean() }) },
),

// 3. Dependent endpoint — return type depends on a "select" arg
summary: dependent(
  "/v1/summary/{id}",
  z.object({ id: z.string() }),
  "modules",
  {
    detail: z.object({ score: z.number() }),
    financials: z.object({ revenue: z.number() }),
  },
)
// Then:
api.summary({ id: "x", modules: ["detail"] })
//    → Promise<{ detail: { score: number } }>   ← inferred from the tuple
```

The dependent variant uses a `const` type parameter + a mapped
type discriminated by `__dependent: true`, so the literal tuple
flows into the return type without an `as const` at the call site.

## Strict typing

- No `any` anywhere in the public surface.
- Variance handled with `StoredApi` / `StoredCommand` views that use
  `unknown` in input positions — specific typed clients assign in
  via property covariance.
- Response shapes are opt-in. Leave `response` off the endpoint
  spec for `unknown`; provide a `z.object({...})` for full runtime
  validation.

## Layout

- `src/types.ts` — all shared types.
- `src/api/` — `defineApi`, `get`, `post`, `dependent`, `callEndpoint`,
  `addApiCli` (auto-generated CLI surface).
- `src/cli/` — `defineCommand`, `createCli`, `walkSchemaToCommander`
  (zod schema → commander flag walker), error mapping.
- `src/http.ts` — internal polite-fetch wrapper (timeout + retry).
- `src/qa/integration.test.ts` — end-to-end pipeline against a
  Bun.serve mock.

## Status

v0.1 — pre-release. API may change.

## License

MIT.
