import { z } from "zod"
import { defineCommand } from "../../../src"
import { githubApi } from "../schema"

/** `top <query>` — top N repos by stars matching a query. */
export const top = defineCommand({
  name: "top",
  description: "Search repos and return the top N by stars",
  schema: z.object({
    q: z.string(),
    limit: z.coerce.number().int().default(5),
  }),
  positional: ["q"],
  handler: async ({ q, limit }) => {
    const res = await githubApi.search({ q, sort: "stars", per_page: limit })
    return res.items.map((r) => ({
      repo: r.full_name,
      url: r.html_url,
      stars: r.stargazers_count,
    }))
  },
})
