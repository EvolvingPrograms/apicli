/**
 * `defineApi(spec)` — turn an endpoint schema into a typed client.
 *
 *   ╭─ schema ─────────╮    ╭─ typed client ──╮
 *   │ ENDPOINTS = {    │ →  │ api.chart({…})  │
 *   │   chart: get(…), │    │ // typed return │
 *   │ } as const       │    ╰─────────────────╯
 *   ╰──────────────────╯
 *
 * Validates schema-side things eagerly (path placeholders match
 * schema keys). Env / auth requirements (`requires.env`, `auth`)
 * are resolved **lazily** at request time — they read
 * `process.env` (or `spec.env` override) each call, so
 * `defineApi` succeeds even before any env vars are exported.
 */

import type { z } from "zod"
import type {
  AnyEndpointSpec,
  ApiClient,
  ApiSpec,
  EndpointMap,
} from "../types"
import { extractPlaceholders } from "./path"
import { callDependent, callEndpoint, isDependentEndpoint } from "./call"

/**
 * `<const Env extends readonly string[]>` makes the `requires.env`
 * tuple infer as a literal — so `requires: { env: ["GITHUB_TOKEN"] }`
 * narrows `ctx.env` to `{ GITHUB_TOKEN: string }` without
 * needing `as const` at the call site.
 */
export function defineApi<
  const E extends EndpointMap,
  const Env extends readonly string[] = readonly [],
>(
  spec: ApiSpec<E, Env>,
): ApiClient<E> {
  // Validate each endpoint's path placeholders against its
  // schema keys at definition time — catches typos before the
  // first request. Env validation is intentionally deferred to
  // the call site (see `call.ts → resolveCtx`).
  for (const [name, endpoint] of Object.entries(spec.endpoints)) {
    const shape = paramsShape(endpoint)
    for (const placeholder of extractPlaceholders(endpoint.path)) {
      if (!(placeholder in shape)) {
        throw new Error(
          `defineApi(${spec.name}): endpoint "${name}" path has {${placeholder}} but the schema doesn't include that key`,
        )
      }
    }
  }

  const client = {} as Record<string, (args: unknown) => Promise<unknown>>

  for (const [name, endpoint] of Object.entries(spec.endpoints)) {
    if (isDependentEndpoint(endpoint)) {
      client[name] = async (args: unknown) =>
        callDependent(spec as ApiSpec, endpoint, args)
    } else {
      client[name] = async (args: unknown) =>
        callEndpoint(spec as ApiSpec, endpoint, args)
    }
  }

  Object.defineProperty(client, "__spec", { value: spec, enumerable: false })
  return client as ApiClient<E>
}

function paramsShape(ep: AnyEndpointSpec): Record<string, z.ZodType> {
  return isDependentEndpoint(ep) ? ep.baseParams.shape : ep.params.shape
}
