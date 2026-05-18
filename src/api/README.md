Up: [../../README.md](../../README.md)

# `src/api/` — API client runtime

Builds a typed HTTP client from a zod-driven endpoint schema +
exposes the same schema as a generic `api <endpoint> --flag value`
commander subcommand tree.

## Files

- [`index.ts`](./index.ts) — barrel.
- [`helpers.ts`](./helpers.ts) — endpoint declaration helpers.
  - `get(path, params, opts?)` — declare a `GET` endpoint.
  - `post(path, params, opts?)` — declare a `POST` endpoint.
  - `dependent(path, baseParams, selectKey, selectMap, opts?)` —
    declare an endpoint whose response type depends on a
    "select" tuple (e.g. Yahoo's `modules: [...]`). The client
    method becomes generic over the literal tuple; the return
    type collects only the picked slices.
- [`helpers.test.ts`](./helpers.test.ts) — shape tests for the
  three helpers.
- [`define.ts`](./define.ts) — `defineApi(spec)` turns the
  schema into a typed `ApiClient<E>`. Validates path
  placeholders eagerly (typos throw at construction). Env /
  auth requirements are deferred — they're resolved on each
  request via `call.ts → resolveEnv`. Routes static endpoints
  through `callEndpoint`, dependent endpoints through
  `callDependent`.
- [`define.test.ts`](./define.test.ts) — placeholder validation,
  dependent-endpoint runtime guards.
- [`call.ts`](./call.ts) — `callEndpoint(spec, endpoint, args)`:
  zod-validate input → substitute path placeholders → serialize
  query (arrays comma-joined) → `resolveEnv` (read + validate
  required env from `process.env` or `spec.env`) → build
  `ctx.env` → merge baseQuery + headers (auto-Bearer if `auth`
  is set) → `politeFetch` → optionally validate response. Also
  exports `callDependent`, `isDependentEndpoint`, and
  `resolveEnv`.
- [`call.test.ts`](./call.test.ts) — placeholder substitution,
  baseQuery, headers, non-2xx, response validation,
  unset-response → raw JSON, dependent-endpoint input guards.
- [`path.ts`](./path.ts) — `extractPlaceholders`, `renderPath`,
  `serialize`. URL-template plumbing.
- [`path.test.ts`](./path.test.ts) — zero/one/many placeholders,
  URL-encoding, missing-value error.
- [`cli.ts`](./cli.ts) — `addApiCli(program, api, opts?)`:
  registers an `api <endpoint>` subcommand tree on a commander
  program, walking each endpoint's zod params via the cli-side
  walker. Dispatches to the same `callEndpoint` /
  `callDependent` as the typed client. `createCli` calls this
  automatically when you pass `api`.
- [`cli.test.ts`](./cli.test.ts) — subcommand tree shape,
  description forwarding, custom commandName, static + dependent
  flag walking.

## Conventions

- Every fetch routes through the small internal
  [`../http.ts`](../http.ts) (`politeFetch` — timeout + optional
  retry on 5xx).
- `serialize` joins array values with `,` (matches the convention
  used by most REST APIs: `?series_id=...`, `?symbols=A,B,C`).
  Override with a custom `wrap` in `dependent()` if a specific
  endpoint demands something else.
- Response validation is opt-in: leave `response` off →
  `unknown`; provide `z.object({...})` for a typed + validated
  return.

## Auth and required env

`defineApi` supports three knobs for credential / env handling.
All three can be combined. **All env reads are lazy** — they
happen on each request, not at `defineApi` time — so you can
`import` an API module before exporting the credentials, and
flipping `process.env.X` between calls is reflected immediately.

| Field | Effect |
|---|---|
| `requires.env: ["NAME", ...]` | Names of env vars that must be set when a request fires. On each call, `resolveEnv` reads them from `process.env` (or `spec.env` override) and throws on missing or empty. The resolved values land in `ctx.env` typed as `string` (not `string \| undefined`). The `const` type parameter on `defineApi` narrows the tuple — no `as const` needed. |
| `auth: "NAME"` | Shorthand: implicitly adds `NAME` to `requires.env` AND auto-prepends `Authorization: Bearer ${env.NAME}` to every request. The user's `headers` callback runs after and can override (for HMAC schemes, per-endpoint overrides, etc.). |
| `env: { ... }` | Substitutes for `process.env`. Useful for tests and in-process multi-tenant setups. Required vars are validated against this source instead of `process.env`. |

Example combinations:

```ts
// Bare minimum bearer auth:
defineApi({
  name: "github",
  baseUrl: "https://api.github.com",
  auth: "GITHUB_TOKEN",
  endpoints: { ... },
})

// Custom auth shape — opt out of the Bearer shortcut, use
// requires.env + headers directly:
defineApi({
  name: "myapi",
  baseUrl: "...",
  requires: { env: ["MYAPI_KEY", "MYAPI_SECRET"] },
  headers: ({ env }) => ({
    "X-API-Key":    env.MYAPI_KEY,
    "X-API-Secret": env.MYAPI_SECRET,
  }),
  endpoints: { ... },
})

// Test injection — substitute for process.env:
defineApi({
  name: "github",
  baseUrl: "https://api.github.com",
  auth: "GITHUB_TOKEN",
  env: { GITHUB_TOKEN: "fake-for-tests" },
  endpoints: { ... },
})
```

Because env resolution is lazy, the canonical test pattern is
just:

```ts
import { githubApi } from "./examples/github"      // no env yet — OK

process.env.GITHUB_TOKEN = await getTokenSomehow()  // before first call
const u = await githubApi.user({ username: "x" })  // resolves env here
```
