/**
 * `defineApi(spec)` — turn an endpoint schema into a typed client.
 *
 *   ╭─ schema ─────────╮    ╭─ typed client ──╮
 *   │ ENDPOINTS = {    │ →  │ api.chart({…})  │
 *   │   chart: get(…), │    │ // typed return │
 *   │ } as const       │    ╰─────────────────╯
 *   ╰──────────────────╯
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

export function defineApi<const E extends EndpointMap>(
  spec: ApiSpec<E>,
): ApiClient<E> {
  // Validate each endpoint's path placeholders against its
  // schema keys at definition time — catches typos before the
  // first request.
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
        callDependent(spec, endpoint, args)
    } else {
      client[name] = async (args: unknown) => callEndpoint(spec, endpoint, args)
    }
  }

  Object.defineProperty(client, "__spec", { value: spec, enumerable: false })
  return client as ApiClient<E>
}

function paramsShape(ep: AnyEndpointSpec): Record<string, z.ZodType> {
  return isDependentEndpoint(ep) ? ep.baseParams.shape : ep.params.shape
}
