/**
 * Kebab-case example entry point.
 */

import { createCli } from "../../src"
import { kebabApi } from "./schema"
import { searchCmd } from "./commands"

export { kebabApi } from "./schema"
export * from "./commands"

export const kebabCli = createCli({
  name: "kebab-cli",
  description: "kebab example CLI",
  api: kebabApi,
  commands: [searchCmd],
})

if (import.meta.main) {
  await kebabCli.run()
}
