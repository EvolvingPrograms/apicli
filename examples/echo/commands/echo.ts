import { z } from "zod"
import { defineCommand } from "../../../src"
import { echoApi } from "../schema"

export const echoCmd = defineCommand({
  name: "echo",
  description: "Echo a query string + optional number",
  schema: z.object({
    q: z.string(),
    n: z.coerce.number().int().default(0),
  }),
  positional: ["q"],
  handler: ({ q, n }) => echoApi.echo({ q, n }),
})
