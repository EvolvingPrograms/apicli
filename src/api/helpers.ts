/**
 * Endpoint declaration helpers: `get(path, params)` / `post(...)`
 * for static endpoints, and `dependent(...)` for endpoints whose
 * response shape depends on a "select" param.
 *
 *   chart: get("/v8/finance/chart/{symbol}", z.object({...}))
 *
 * Path placeholders (`{symbol}`) are matched against the zod
 * schema's keys at `defineApi` time — typos throw before the
 * first request.
 */

import type { z } from "zod"
import type {
  DependentEndpointSpec,
  EndpointOptions,
  EndpointSpec,
} from "../types"

export function get<
  S extends z.ZodObject,
  R extends z.ZodType | undefined = undefined,
>(
  path: string,
  params: S,
  opts: EndpointOptions<R> = {},
): EndpointSpec<S, R> {
  return { method: "GET", path, params, ...opts }
}

export function post<
  S extends z.ZodObject,
  R extends z.ZodType | undefined = undefined,
>(
  path: string,
  params: S,
  opts: EndpointOptions<R> = {},
): EndpointSpec<S, R> {
  return { method: "POST", path, params, ...opts }
}

export interface DependentOptions {
  description?: string
  /** Reshape the per-call response zod schema before validation. */
  wrap?: (picked: z.ZodObject<Record<string, z.ZodType>>) => z.ZodType
}

/**
 * Declare a dependent endpoint — the response type depends on
 * which keys the caller picks via `selectKey`.
 *
 *   quoteSummary: dependent(
 *     "/v10/finance/quoteSummary/{symbol}",
 *     z.object({ symbol: z.string() }),
 *     "modules",
 *     {
 *       summaryDetail: z.object({...}),
 *       financialData: z.object({...}),
 *     },
 *   )
 *
 * The generated client method:
 *
 *   yahoo.quoteSummary({ symbol: "AAPL", modules: ["summaryDetail"] })
 *   //                                            ^^^^^^^^^^^^^^^^^ tuple
 *   // → Promise<{ summaryDetail: { ... } }>
 */
export function dependent<
  S extends z.ZodObject,
  const SelectKey extends string,
  const Map extends Record<string, z.ZodType>,
>(
  path: string,
  baseParams: S,
  selectKey: SelectKey,
  selectMap: Map,
  opts: DependentOptions = {},
): DependentEndpointSpec<S, SelectKey, Map> {
  return {
    method: "GET",
    path,
    baseParams,
    selectKey,
    selectMap,
    description: opts.description,
    wrap: opts.wrap,
    __dependent: true,
  }
}
