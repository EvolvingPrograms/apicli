import { z } from "zod"
import { defineCommand } from "../../../src"
import { echoApi } from "../schema"

type ModuleName = "detail" | "financials"

export const summaryCmd = defineCommand({
  name: "summary",
  schema: z.object({
    id: z.string(),
    modules: z.array(z.string()).min(1),
  }),
  positional: ["id"],
  handler: async ({ id, modules }) => {
    // Cast at the command boundary: the friendly schema is
    // `string[]`, not the literal tuple form needed for the
    // dependent inference. The runtime check inside the API
    // call still validates each entry against the selectMap.
    return echoApi.summary({
      id,
      modules: modules as readonly ModuleName[],
    })
  },
})
