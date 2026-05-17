/**
 * Atomic tests for `addApiCli`. We verify the registered
 * subcommand tree + flag walking shape here; full dispatch (HTTP
 * fetch → JSON emit) lives in `../qa/integration.test.ts`.
 */

import { beforeEach, describe, expect, test } from "bun:test"
import { Command } from "commander"
import { z } from "zod"
import { addApiCli } from "./cli"
import { defineApi } from "./define"
import { dependent, get } from "./helpers"

function buildApi() {
  return defineApi({
    name: "test",
    baseUrl: "https://example.test",
    endpoints: {
      echo: get(
        "/v1/echo",
        z.object({
          q: z.string(),
          n: z.coerce.number().int().default(0),
        }),
        { description: "echo back" },
      ),
      item: get(
        "/v1/item/{id}",
        z.object({ id: z.string() }),
      ),
      summary: dependent(
        "/v1/summary/{id}",
        z.object({ id: z.string() }),
        "modules",
        {
          detail: z.object({ score: z.number() }),
          financials: z.object({ revenue: z.number() }),
        },
        { description: "dependent endpoint" },
      ),
    },
  })
}

let program: Command
beforeEach(() => {
  program = new Command().name("test-cli").exitOverride()
})

describe("addApiCli — subcommand tree", () => {
  test("registers an `api` parent with one child per endpoint", () => {
    const api = buildApi()
    addApiCli(program, api)

    const apiCmd = program.commands.find((c) => c.name() === "api")
    expect(apiCmd).toBeDefined()

    const names = apiCmd?.commands.map((c) => c.name())
    expect(names).toEqual(["echo", "item", "summary"])
  })

  test("forwards endpoint descriptions to the subcommand", () => {
    const api = buildApi()
    addApiCli(program, api)

    const apiCmd = program.commands.find((c) => c.name() === "api")
    const echo = apiCmd?.commands.find((c) => c.name() === "echo")
    expect(echo?.description()).toBe("echo back")
  })

  test("accepts a custom commandName", () => {
    const api = buildApi()
    addApiCli(program, api, { commandName: "raw" })

    expect(program.commands.find((c) => c.name() === "raw")).toBeDefined()
    expect(program.commands.find((c) => c.name() === "api")).toBeUndefined()
  })
})

describe("addApiCli — flag walking", () => {
  test("walks static endpoint params into commander flags", () => {
    const api = buildApi()
    addApiCli(program, api)

    const echo = program.commands.find((c) => c.name() === "api")
      ?.commands.find((c) => c.name() === "echo")
    expect(echo?.options.find((o) => o.long === "--q")?.mandatory).toBe(true)
    expect(echo?.options.find((o) => o.long === "--n")?.defaultValue).toBe(0)
  })

  test("dependent endpoint: walks baseParams + adds the selectKey as a required option", () => {
    const api = buildApi()
    addApiCli(program, api)

    const summary = program.commands.find((c) => c.name() === "api")
      ?.commands.find((c) => c.name() === "summary")
    expect(summary?.options.find((o) => o.long === "--id")?.mandatory).toBe(true)

    const modules = summary?.options.find((o) => o.long === "--modules")
    expect(modules).toBeDefined()
    expect(modules?.mandatory).toBe(true)
    // The placeholder lists the allowed module names so --help is informative.
    expect(modules?.flags).toContain("detail|financials")
  })

  test("path-only endpoint surfaces its placeholder as a required flag", () => {
    const api = buildApi()
    addApiCli(program, api)

    const item = program.commands.find((c) => c.name() === "api")
      ?.commands.find((c) => c.name() === "item")
    expect(item?.options.find((o) => o.long === "--id")?.mandatory).toBe(true)
  })

  test("camelCase selectKey becomes a kebab-case --flag", () => {
    const api = defineApi({
      name: "kebab",
      baseUrl: "https://example.test",
      endpoints: {
        widget: dependent(
          "/v/{id}",
          z.object({ id: z.string() }),
          "moduleNames", // camelCase select key
          { a: z.object({}), b: z.object({}) },
        ),
      },
    })
    addApiCli(program, api)

    const widget = program.commands.find((c) => c.name() === "api")
      ?.commands.find((c) => c.name() === "widget")
    expect(
      widget?.options.find((o) => o.long === "--module-names"),
    ).toBeDefined()
  })
})
