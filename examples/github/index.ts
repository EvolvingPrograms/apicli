/**
 * GitHub example entry point. Wires the typed API + the
 * friendly commands; the `import.meta.main` guard lets you run
 * this file directly as a script:
 *
 *   GITHUB_TOKEN=$(gh auth token) bun examples/github/ lookup torvalds
 *   GITHUB_TOKEN=$(gh auth token) bun examples/github/ top "language:rust stars:>10000"
 */

import { createCli } from "../../src"
import { githubApi, GithubError } from "./schema"
import { lookup, top } from "./commands"

export { githubApi, GithubError } from "./schema"
export * from "./commands"

export const githubCli = createCli({
  name: "gh-tiny",
  description: "Tiny GitHub CLI built with clipi",
  api: githubApi,
  commands: [lookup, top],
  errorClass: GithubError,
})

if (import.meta.main) {
  await githubCli.run()
}
