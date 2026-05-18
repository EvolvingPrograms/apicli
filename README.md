# clipi

Encode any HTTP API as a zod schema, get a typed client + a
working CLI back. Every endpoint in your schema is reachable from
the command line as `api <endpoint> --flag value` — no manual
argv parsing, no flag definitions, no JSON-arg gymnastics.

```bash
bun add clipi
```

Pure TypeScript, no build step. Designed for [Bun](https://bun.sh).
Runs on Node ≥ 22 with `--experimental-strip-types`. Depends on
`zod` and `commander` (pulled in transitively).

---

## Hello, API

Define a schema. That's the whole thing:

```ts
// my-cli.ts
import { z } from "zod"
import { createCli, defineApi, get } from "clipi"

const github = defineApi({
  name: "github",
  baseUrl: "https://api.github.com",
  endpoints: {
    user: get("/users/{username}", z.object({
      username: z.string(),
    })),
    search: get("/search/repositories", z.object({
      q: z.string(),
      sort: z.enum(["stars", "forks", "updated"]).optional(),
      per_page: z.coerce.number().int().default(30),
    })),
  },
})

const program = createCli({
  name: "gh",
  description: "Tiny GitHub CLI",
  api: github,
})

program.run()
```

Run it:

```bash
$ bun my-cli.ts api user --username torvalds
{"login":"torvalds","id":1024025,...}

$ bun my-cli.ts api search --q "language:rust stars:>50000" --sort stars --per-page 5
{"total_count":...,"items":[...]}

$ bun my-cli.ts api search --help
Usage: gh api search [options]

Options:
  --q <v>
  --sort <stars|forks|updated>
  --per-page <n>
```

Every endpoint becomes an `api <name>` subcommand. Every zod
schema key becomes a `--flag`. `--help` is generated automatically
from the schema. The response comes back as JSON on stdout.

That's the minimum useful thing — schema in, CLI out.

---

## You also get a typed client

The same schema gives you a programmatic client:

```ts
const user = await github.user({ username: "torvalds" })
//    ^^^^ Promise<unknown>   ← no response schema, you cast or narrow
```

Attach a `response` schema and the return type becomes the
inferred shape, with runtime validation:

```ts
endpoints: {
  user: get(
    "/users/{username}",
    z.object({ username: z.string() }),
    {
      response: z.object({
        login:    z.string(),
        id:       z.number(),
        html_url: z.string(),
      }),
    },
  ),
}

const user = await github.user({ username: "torvalds" })
//    ^^^^ { login: string, id: number, html_url: string }
user.login            // ✓
user.notAField        // ✗ type error
```

Only schematize the fields you actually use — extra fields in the
response are ignored at runtime.

---

## Custom commands on top

The generic `api <endpoint>` surface hits the endpoint exactly as
specified. Most of the time you want something more ergonomic —
defaults, positional args, post-processing, multiple calls
composed together. That's what `defineCommand` is for.

```ts
import { defineCommand } from "clipi"

const lookup = defineCommand({
  name: "lookup",
  description: "Look up a user by login",
  schema: z.object({ username: z.string() }),
  positional: ["username"],         // → `gh lookup torvalds` (not `--username`)
  handler: async ({ username }) => {
    const user = await github.user({ username })
    return { login: user.login, url: user.html_url }
  },
})

const program = createCli({
  name: "gh",
  description: "Tiny GitHub CLI",
  api: github,
  commands: [lookup],
})

program.run()
```

```bash
$ bun my-cli.ts lookup torvalds
{"login":"torvalds","url":"https://github.com/torvalds"}
```

The CLI now exposes **both** surfaces — `gh lookup <username>`
for the common path and `gh api user --username <name>` for raw
access.

Each `defineCommand` is also callable as a function:

```ts
import { lookup } from "./commands/lookup"

const { login } = await lookup({ username: "torvalds" })
```

Typed args, runtime validation, return type inferred from the
handler.

---

## Auth (one line)

Most APIs use a bearer token from an env var. `auth: "ENV_NAME"`
is the shortcut — same effect as writing
`Authorization: Bearer ${env.ENV_NAME}` in a `headers` callback,
without any of the boilerplate:

```ts
const github = defineApi({
  name: "github",
  baseUrl: "https://api.github.com",
  auth: "GITHUB_TOKEN",     // ← that's it
  endpoints: { ... },
})
```

`defineApi` reads `GITHUB_TOKEN` lazily — on each request, not at
construction — so you can `import` your CLI module before the env
is set. Run it:

```bash
GITHUB_TOKEN=$(gh auth token) bun my-cli.ts api user --username torvalds
```

In GitHub Actions, `secrets.GITHUB_TOKEN` is auto-provisioned —
pass it through in your workflow:

```yaml
- run: bun my-cli.ts api user --username torvalds
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

If the env var isn't set when a request fires, you get a clear
error: `github: required env var GITHUB_TOKEN is not set`.

For non-Bearer auth or multiple env vars, use `requires.env` +
`headers`:

```ts
defineApi({
  name: "myapi",
  baseUrl: "https://example.test",
  requires: { env: ["MYAPI_KEY", "MYAPI_SECRET"] },
  headers: ({ env }) => ({
    "X-API-Key":    env.MYAPI_KEY,     // typed as `string`
    "X-API-Secret": env.MYAPI_SECRET,  // not `string | undefined`
  }),
  endpoints: { ... },
})
```

The `headers` and `baseQuery` callbacks both receive `ctx.env`
typed against your declared `requires.env` tuple (no `as const`
needed).

`baseQuery` is merged into the query string on every call —
useful for APIs that want their key as a query param instead of
a header:

```ts
defineApi({
  name: "fred",
  baseUrl: "https://api.stlouisfed.org/fred",
  requires: { env: ["FRED_API_KEY"] },
  baseQuery: ({ env }) => ({
    api_key:   env.FRED_API_KEY,
    file_type: "json",
  }),
  endpoints: { ... },
})
```

---

## Dependent endpoints

Some APIs let you request specific slices of a response — Yahoo
Finance's `quoteSummary?modules=summaryDetail,financialData`,
GraphQL-ish field selectors, etc. The response shape depends on
what you asked for.

`dependent()` makes that typed:

```ts
import { dependent } from "clipi"

const yahoo = defineApi({
  name: "yahoo",
  baseUrl: "https://query1.finance.yahoo.com",
  endpoints: {
    summary: dependent(
      "/v10/finance/quoteSummary/{symbol}",
      z.object({ symbol: z.string() }),
      "modules",
      {
        summaryDetail: z.object({ marketCap: z.number().optional() }),
        financialData: z.object({ totalCash:  z.number().optional() }),
        earningsHistory: z.object({
          history: z.array(z.object({ epsActual: z.number().optional() })),
        }),
      },
    ),
  },
})

const s = await yahoo.summary({
  symbol: "AAPL",
  modules: ["summaryDetail", "financialData"],
})

s.summaryDetail.marketCap      // ✓
s.financialData.totalCash      // ✓
s.earningsHistory              // ✗ type error — not requested
```

The literal tuple at `modules` flows through to the return type
via a `const` type parameter — no `as const` needed at the call
site. Runtime validation only runs the schemas for modules you
asked for.

`bun ... api summary --symbol AAPL --modules summaryDetail,financialData`
works too — the CLI side accepts a comma-separated list.

---

## Errors

Throw an instance of your own `errorClass` from a handler and it
maps to `<cli-name>: <message>` on stderr with exit code 1:

```ts
class GithubError extends Error {
  override readonly name = "GithubError"
}

const lookup = defineCommand({
  name: "lookup",
  schema: z.object({ username: z.string() }),
  handler: async ({ username }) => {
    if (username.length < 1) throw new GithubError("empty username")
    return github.user({ username })
  },
})

const program = createCli({
  name: "gh",
  description: "...",
  api: github,
  commands: [lookup],
  errorClass: GithubError,
})

program.run()
```

Other thrown errors (including `ZodError` from input validation
and the env-not-set error from `auth`/`requires.env`) get
pretty-printed under the same prefix.

---

## POST endpoints

`post(path, params, opts?)` is identical to `get` apart from the
HTTP method. Body construction from params is on the roadmap —
for now use `headers` + a custom serializer if you need it.

---

## Examples

Runnable, self-contained demos. Each lives in its own folder
(`index.ts` + `schema.ts` + `commands/`) using flat top-level
`const` exports — copy and adapt.

- **[`examples/github/`](./examples/github/)** — the canonical
  real-world example. Bearer auth via `auth: "GITHUB_TOKEN"`,
  response schemas, two friendly commands (`lookup`, `top`),
  and an `if (import.meta.main)` block so you can run it as a
  script: `GITHUB_TOKEN=$(gh auth token) bun examples/github/
  top "language:typescript stars:>10000"`.
- **[`examples/echo/`](./examples/echo/)** — exercises every
  endpoint shape (static GET, path placeholders, intentional
  5xx, dependent endpoint), three command shapes (positional,
  dependent dispatch, intentional throw), and a custom
  `errorClass`. Used as the integration-test fixture.
- **[`examples/kebab/`](./examples/kebab/)** — proves the
  walker converts camelCase schema keys to kebab-case
  `--flag-name` CLI options.

---

## What this isn't

- **A code generator.** Schemas are runtime values, not files
  generated from OpenAPI. If you want OpenAPI ingestion, write
  a converter that emits `defineApi(...)` source.
- **A way to skip writing the schema.** clipi buys you the CLI
  + typed client; you still describe each endpoint.
- **A fetch wrapper.** It uses a small built-in fetcher
  (timeout + optional retry) but offers no caching, no
  request/response middleware, no streaming. Keep your fetch
  layer simple and put cross-cutting concerns elsewhere.

---

## Layout

- `src/api/` — `defineApi`, `get`, `post`, `dependent`,
  `callEndpoint`, `addApiCli` (the auto-CLI walker).
- `src/cli/` — `defineCommand`, `createCli`, zod-schema →
  commander flag walker, error mapping.
- `src/http.ts` — internal polite-fetch (timeout + retry).
- `src/types.ts` — all shared types.
- `examples/` — runnable demos linked above.
- `qa/integration.test.ts` — full pipeline against `Bun.serve`.
- `qa/github.live.test.ts` — live GitHub API test gated on
  `GITHUB_TOKEN` / `gh auth token`.

## Status

v0.1 — pre-release. API may change. Use a pinned version.

## License

MIT.
