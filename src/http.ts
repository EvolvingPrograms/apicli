/**
 * Minimal polite-fetch used internally by `defineApi`. Plain
 * fetch wrapper with a wall-clock timeout and optional retry on
 * 5xx. Network errors propagate; callers wrap them in their own
 * error class via `errorClass` on `createCli`.
 *
 * User-Agent + Accept + arbitrary extra headers are caller-
 * supplied (via `ApiSpec.headers`). This module deliberately
 * has no opinion about identity — every API has different
 * requirements.
 */

export type FetchFn = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

export interface PoliteFetchOptions {
  /** Override `globalThis.fetch` (mostly for unit tests). */
  fetchImpl?: FetchFn
  /** Abort after this many ms. Default 15s. */
  timeoutMs?: number
  /** `Accept` header. Default star-slash-star. */
  accept?: string
  /** Extra headers; merged on top of `User-Agent` + `Accept`. */
  headers?: Record<string, string>
  /** Forced User-Agent. Default `apicli/<version>`. */
  userAgent?: string
  /** Retry up to N times on 5xx with exponential backoff. Default 0. */
  retries?: number
  /** Base delay for retry backoff in ms. Default 200. */
  retryBaseDelayMs?: number
  /** Pass-through to `fetch()` — usually "follow". */
  redirect?: "follow" | "error" | "manual"
}

const DEFAULT_USER_AGENT = "apicli/0.1"

export async function politeFetch(
  url: string | URL | Request,
  opts: PoliteFetchOptions = {},
): Promise<Response> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const timeoutMs = opts.timeoutMs ?? 15_000
  const retries = opts.retries ?? 0
  const baseDelay = opts.retryBaseDelayMs ?? 200

  const headers: Record<string, string> = {
    "User-Agent": opts.userAgent ?? DEFAULT_USER_AGENT,
    Accept: opts.accept ?? "*/*",
    ...opts.headers,
  }

  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let res: Response

    try {
      res = await fetchImpl(url, {
        headers,
        signal: controller.signal,
        redirect: opts.redirect,
      })
    } finally {
      clearTimeout(timer)
    }

    if (res.ok || res.status < 500 || attempt >= retries) {
      return res
    }

    await new Promise((r) => setTimeout(r, baseDelay * 2 ** attempt))
  }
}
