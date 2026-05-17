Up: [../README.md](../README.md)

# `lib/api-cli/api/` — API client runtime

Builds a typed HTTP client from a zod-driven endpoint schema.

## Files

- [`index.ts`](./index.ts) — barrel.
- [`helpers.ts`](./helpers.ts) — endpoint declaration helpers.
  - `get(path, params, opts?)` — declare a `GET` endpoint
  - `post(path, params, opts?)` — declare a `POST` endpoint
  - `dependent(path, baseParams, selectKey, selectMap, opts?)` —
    declare an endpoint whose response type depends on a
    "select" param (e.g. Yahoo's `modules: [...]`).
- [`helpers.test.ts`](./helpers.test.ts) — shape tests for the
  three helpers.
- [`define.ts`](./define.ts) — `defineApi(spec)` turns the
  schema into a typed `ApiClient<E>`. Validates path
  placeholders against schema keys at definition time. Routes
  static endpoints through `callEndpoint`, dependent endpoints
  through an internal `callDependent` that synthesises a
  per-call response schema from the requested select values.
- [`define.test.ts`](./define.test.ts) — construction shape,
  placeholder validation, dependent-endpoint runtime guards.
- [`call.ts`](./call.ts) — `callEndpoint(spec, endpoint, args)`
  — the pipeline: zod-validate input → substitute path
  placeholders → serialize query (arrays comma-joined) →
  merge baseQuery + headers → `politeFetch` → optionally
  validate response.
- [`call.test.ts`](./call.test.ts) — placeholder substitution,
  baseQuery, headers, non-2xx, response validation,
  unset-response → raw JSON.
- [`path.ts`](./path.ts) — `extractPlaceholders`, `renderPath`,
  `serialize`. URL-template plumbing.
- [`path.test.ts`](./path.test.ts) — zero/one/many placeholders,
  URL-encoding, missing-value error.
- [`cli.ts`](./cli.ts) — `addApiCli(program, api)`: adds an
  `api <endpoint> --flag value` subcommand to a commander
  program. **Currently stub** — the flag-walker is TODO; see
  [the cli walker](../cli/walker.ts) for the reusable
  zod-schema → commander mapping.

## Conventions

- Every fetch routes through the shared
  [`@/lib/http`](../../http.ts) `politeFetch` so the per-domain
  User-Agent map applies uniformly.
- `serialize` joins array values with `,` (matches FRED's
  `series_id=...`, Yahoo's `symbols=A,B,C`, etc.). Override
  with a custom `wrap` in `dependent()` when an API wants
  something else.
- Response validation is opt-in: leave `response` off →
  `unknown`. Use `z.custom<T>()` for a type-only assertion or
  a real `z.object({...})` for runtime safety.
