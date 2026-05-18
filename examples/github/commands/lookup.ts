import { z } from "zod"
import { defineCommand } from "../../../src"
import { githubApi } from "../schema"

/** `lookup <username>` — shape a user response into a slim
 * `{ login, url, type }` for the CLI. */
export const lookup = defineCommand({
  name: "lookup",
  description: "Show a user's login + profile URL",
  schema: z.object({ username: z.string() }),
  positional: ["username"],
  handler: async ({ username }) => {
    const u = await githubApi.user({ username })
    return { login: u.login, url: u.html_url, type: u.type }
  },
})
