/**
 * Per-endpoint request execution. Used by `defineApi` (typed
 * client methods) and `addApiCli` (generic `api <endpoint>`
 * subcommand).
 *
 * Pipeline: validate input via zod → split into path / query
 * params → render URL → merge headers + baseQuery → fire via
 * the shared `politeFetch` → optionally validate response.
 */

import { z } from "zod"
import { politeFetch } from "../http"
import { extractPlaceholders, renderPath, serialize } from "./path"

import type {
  AnyEndpointSpec,
  ApiSpec,
  DependentEndpointSpec,
  EndpointSpec,
} from "../types"

export async function callEndpoint(
  spec: ApiSpec,
  endpoint: EndpointSpec,
  rawArgs: unknown,
): Promise<unknown> {
  const args = endpoint.params.parse(rawArgs) as Record<string, unknown>

  const placeholders = new Set(extractPlaceholders(endpoint.path))
  const pathParams: Record<string, string> = {}
  const queryParams: Record<string, string> = {}

  for (const [key, value] of Object.entries(args)) {
    if (value === undefined) continue

    if (placeholders.has(key)) {
      pathParams[key] = String(value)
      continue
    }

    queryParams[key] = serialize(value)
  }

  const path = renderPath(endpoint.path, pathParams)
  const url = new URL(spec.baseUrl + path)

  // Resolve + validate env on each call (not at defineApi
  // time). This lets consumers `import` an API before they've
  // set the env, and lets tests mutate process.env between
  // calls.
  const ctx = { env: resolveEnv(spec) }

  const base = spec.baseQuery ? await spec.baseQuery(ctx) : {}
  for (const [k, v] of Object.entries(base)) url.searchParams.set(k, v)
  for (const [k, v] of Object.entries(queryParams)) url.searchParams.set(k, v)

  // `auth: "X"` shorthand: prepend a Bearer header using the
  // resolved env var. User's `headers` callback runs after and
  // can override (for non-Bearer schemes, per-endpoint
  // overrides, etc.).
  const autoAuth = spec.auth
    ? { Authorization: `Bearer ${ctx.env[spec.auth]}` }
    : undefined

  const userHeaders = spec.headers ? await spec.headers(ctx) : {}
  const headers = { ...autoAuth, ...userHeaders }
  const res = await politeFetch(url, {
    headers,
    accept: "application/json",
  })

  if (!res.ok) {
    throw new Error(
      `${spec.name}: ${endpoint.method} ${endpoint.path} → ${res.status} ${res.statusText}`,
    )
  }

  const json: unknown = await res.json()
  if (endpoint.response) {
    return endpoint.response.parse(json)
  }

  return json
}

/**
 * Dispatch a dependent endpoint: validate the select tuple,
 * build per-call response schema from the picked map entries,
 * route through `callEndpoint` with a synthesized spec.
 */
export async function callDependent(
  spec: ApiSpec,
  endpoint: DependentEndpointSpec,
  rawArgs: unknown,
): Promise<unknown> {
  if (typeof rawArgs !== "object" || rawArgs === null) {
    throw new Error(`${spec.name}: ${endpoint.path}: args must be an object`)
  }

  const argsObj = rawArgs as Record<string, unknown>
  const picked = argsObj[endpoint.selectKey]
  if (!Array.isArray(picked) || picked.length === 0) {
    throw new Error(
      `${spec.name}: ${endpoint.path}: "${endpoint.selectKey}" must be a non-empty array`,
    )
  }

  // Build per-call params schema = baseParams + selectKey: array<string>.
  const baseShape = endpoint.baseParams.shape
  const fullShape: Record<string, z.ZodType> = { ...baseShape }

  fullShape[endpoint.selectKey] = z.array(z.string()).min(1)
  const fullParams = z.object(fullShape)

  // Build per-call response schema from selectMap[picked[i]].
  const pickedFields: Record<string, z.ZodType> = {}
  for (const key of picked) {
    if (typeof key !== "string") {
      throw new Error(
        `${spec.name}: ${endpoint.path}: "${endpoint.selectKey}" entries must be strings`,
      )
    }

    const schema = endpoint.selectMap[key]
    if (!schema) {
      throw new Error(
        `${spec.name}: ${endpoint.path}: unknown "${endpoint.selectKey}" value "${key}"; expected one of ${Object.keys(endpoint.selectMap).join(", ")}`,
      )
    }

    pickedFields[key] = schema
  }

  const pickedObj = z.object(pickedFields)
  const responseSchema = endpoint.wrap ? endpoint.wrap(pickedObj) : pickedObj

  const synthesized: EndpointSpec = {
    method: endpoint.method,
    path: endpoint.path,
    params: fullParams,
    response: responseSchema,
  }

  return callEndpoint(spec, synthesized, argsObj)
}

/** Runtime discriminator for the two endpoint variants. */
export function isDependentEndpoint(
  ep: AnyEndpointSpec,
): ep is DependentEndpointSpec<z.ZodObject, string, Record<string, z.ZodType>> {
  return "__dependent" in ep && ep.__dependent === true
}

/**
 * Resolve the spec's required + auth env vars from the current
 * `process.env` (or `spec.env` override) and throw a descriptive
 * error on first missing entry. Runs once per request — env
 * mutations between calls are reflected.
 */
export function resolveEnv(spec: ApiSpec): Record<string, string> {
  const source: Record<string, string | undefined>
    = spec.env
      ?? (process.env as Record<string, string | undefined>)

  const out: Record<string, string> = {}
  const declared = spec.requires?.env ?? ([] as readonly string[])
  const required = spec.auth && !declared.includes(spec.auth)
    ? [...declared, spec.auth]
    : declared

  for (const name of required) {
    const v = source[name]
    if (v === undefined || v === "") {
      throw new Error(
        `${spec.name}: required env var ${name} is not set`,
      )
    }
    out[name] = v
  }

  return out
}
