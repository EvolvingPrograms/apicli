/**
 * GitHub REST API schema. Demonstrates `auth: "GITHUB_TOKEN"` —
 * the one-line bearer shorthand. `defineApi` resolves the env
 * lazily, so this module can be imported before `GITHUB_TOKEN`
 * is set; the validation fires only when a request is actually
 * made.
 *
 * Locally:
 *
 *   GITHUB_TOKEN=$(gh auth token) bun examples/github/ top "language:rust stars:>10000"
 */

import { z } from "zod"
import { defineApi, get } from "../../src"

export class GithubError extends Error {
  override readonly name = "GithubError"
}

export const githubApi = defineApi({
  name: "github",
  baseUrl: "https://api.github.com",
  auth: "GITHUB_TOKEN", // → required env + auto-Bearer header
  endpoints: {
    user: get(
      "/users/{username}",
      z.object({ username: z.string() }),
      {
        response: z.object({
          login: z.string(),
          id: z.number(),
          html_url: z.string(),
          type: z.string(),
        }),
      },
    ),

    search: get(
      "/search/repositories",
      z.object({
        q: z.string(),
        sort: z.enum(["stars", "forks", "updated"]).optional(),
        per_page: z.coerce.number().int().default(5),
      }),
      {
        response: z.object({
          total_count: z.number(),
          items: z.array(z.object({
            full_name: z.string(),
            html_url: z.string(),
            stargazers_count: z.number(),
          })),
        }),
      },
    ),

    rateLimit: get("/rate_limit", z.object({}), {
      response: z.object({
        resources: z.object({
          core: z.object({
            limit: z.number(),
            remaining: z.number(),
            reset: z.number(),
          }),
        }),
      }),
    }),
  },
})
