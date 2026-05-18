/**
 * Echo example entry point. `createCli` wires the typed API +
 * the friendly commands; the `import.meta.main` guard lets you
 * run this file directly as a script.
 */

import { createCli } from "../../src"
import { echoApi, EchoError } from "./schema"
import { echoCmd, summaryCmd, failCmd } from "./commands"

export { echoApi, EchoError } from "./schema"
export * from "./commands"

export const echoCli = createCli({
  name: "echo-cli",
  description: "Echo example CLI",
  api: echoApi,
  commands: [echoCmd, summaryCmd, failCmd],
  errorClass: EchoError,
})

if (import.meta.main) {
  await echoCli.run()
}
