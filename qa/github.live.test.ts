/**
 * Live network test against the real GitHub REST API. Proves
 * that `auth: "GITHUB_TOKEN"` validation + auto-Bearer header +
 * response zod schemas all compose end-to-end.
 *
 * Token resolution order:
 *   1. `process.env.GITHUB_TOKEN` — set explicitly or by CI.
 *   2. `gh auth token` — spawned locally when the env var is
 *      missing but the `gh` CLI is installed and authenticated.
 *   3. Skip the suite otherwise.
 *
 * Env is resolved lazily by `defineApi` on each request, so we
 * can `import` the example before setting `GITHUB_TOKEN` — the
 * validation only fires when a test actually calls the API.
 */

import { describe, expect, test } from "bun:test"
import { githubApi, githubCli } from "../examples/github"

function resolveToken(): string | undefined {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN

  try {
    const proc = Bun.spawnSync(["gh", "auth", "token"], {
      stdout: "pipe",
      stderr: "ignore",
    })

    if (proc.exitCode === 0) {
      const out = proc.stdout.toString().trim()
      if (out) {
        process.env.GITHUB_TOKEN = out
        return out
      }
    }
  } catch {
    // `gh` not on PATH → fall through to skipping.
  }

  return undefined
}

const token = resolveToken()

describe("github live", () => {
  test.if(!!token)(
    "lookup torvalds returns a typed { login, url, type }",
    async () => {
      const user = await githubApi.user({ username: "torvalds" })
      expect(user.login).toBe("torvalds")
      expect(user.html_url).toMatch(/github\.com\/torvalds/)
      expect(user.type).toBe("User")

      const hasLookup = githubCli.program.commands.some(
        (c) => c.name() === "lookup",
      )

      expect(hasLookup).toBe(true)
    },
    { timeout: 30_000 },
  )

  test.if(!!token)(
    "search returns a top-stars list shape",
    async () => {
      const res = await githubApi.search({
        q: "language:typescript stars:>10000",
        sort: "stars",
        per_page: 3,
      })

      expect(res.items.length).toBeGreaterThan(0)
      expect(res.items.length).toBeLessThanOrEqual(3)

      const first = res.items[0]
      expect(typeof first?.full_name).toBe("string")
      expect(typeof first?.stargazers_count).toBe("number")
    },
    { timeout: 30_000 },
  )

  test.if(!!token)(
    "authenticated rate_limit reports the 5000/hour bucket",
    async () => {
      const rl = await githubApi.rateLimit({})
      expect(rl.resources.core.limit).toBe(5000)
      expect(rl.resources.core.remaining).toBeLessThanOrEqual(5000)
    },
    { timeout: 30_000 },
  )
})
