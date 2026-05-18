import { z } from "zod"
import { defineCommand } from "../../../src"
import { EchoError } from "../schema"

export const failCmd = defineCommand({
  name: "fail",
  schema: z.object({}),
  handler: () => {
    throw new EchoError("simulated")
  },
})
