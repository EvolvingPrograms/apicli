import { z } from "zod"
import { defineCommand } from "../../../src"
import { kebabApi } from "../schema"

export const searchCmd = defineCommand({
  name: "search",
  description: "Demo: camelCase schema → kebab-case --flags",
  schema: z.object({
    queryText: z.string(),
    maxItems: z.coerce.number().int().default(5),
  }),
  handler: ({ queryText, maxItems }) =>
    kebabApi.echo({ queryText, maxItems }),
})
