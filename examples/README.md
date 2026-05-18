# `examples/`

Small, self-contained API CLIs that exercise the framework
end-to-end. Each example is a single file exporting a
`build(baseUrl)` factory so qa tests (and real consumers) can
point the same wiring at any host — production, staging, or a
mock server on a random port.

## Files

- [`echo.ts`](./echo.ts) — the canonical demo. Four endpoints
  (static GET with response validation, GET with path
  placeholder, intentional 5xx for error mapping, dependent
  endpoint with `modules` select). Three friendly commands on
  top (positional + flag, dependent, failing-with-errorClass).
- [`kebab.ts`](./kebab.ts) — proves the walker converts
  camelCase schema keys to kebab-case CLI flags
  (`queryText` → `--query-text`).

## Pattern

```ts
import { echoExample } from "./examples/echo"

const { api, cli } = echoExample("https://my-api.example")

// Use the typed client in-process:
const r = await api.echo({ q: "hi", n: 1 })

// Or run the CLI:
await cli.program.parseAsync(["bun", "echo-cli", "echo", "hi", "--n", "1"])
```

## Running

```bash
# qa imports these and tests against a Bun.serve mock:
bun test qa
```

These files aren't shipped to npm (`.npmignore` excludes
`examples/`). They live here so the qa suite has a clean
copy of "what real consumer code looks like" without bloating
the test files themselves.
