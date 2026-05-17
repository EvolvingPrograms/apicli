/**
 * api-cli — schema-driven API client + auto-generated CLI.
 *
 *   ╭─ schema (zod) ──╮      ╭─ typed client ──╮
 *   │  ENDPOINTS = {  │  →   │  api.chart({…}) │
 *   │   chart: get…   │      ╰─────────────────╯
 *   │  } as const     │      ╭─ generic CLI ───╮
 *   ╰─────────────────╯  →   │  api chart --…  │
 *                            ╰─────────────────╯
 *
 *   ╭─ defineCommand(…) ──────╮     ╭─ createCli(…) ──────╮
 *   │  typed "API function"    │ →  │  commander program  │
 *   │  callable + storable     │    │  + error mapping    │
 *   ╰──────────────────────────╯    ╰─────────────────────╯
 */

export * from "./types"
export * from "./api"
export * from "./cli"
