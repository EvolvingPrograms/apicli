import { describe, expect, test } from "bun:test"
import { z } from "zod"
import { defineCommand } from "./command"

describe("defineCommand", () => {
  test("returns a callable that validates input and runs the handler", async () => {
    const echo = defineCommand({
      name: "echo",
      schema: z.object({ value: z.string() }),
      handler: ({ value }) => ({ echoed: value }),
    })

    const result = await echo({ value: "hi" })
    expect(result).toEqual({ echoed: "hi" })
  })

  test("throws ZodError on invalid input", async () => {
    const cmd = defineCommand({
      name: "cmd",
      schema: z.object({ n: z.number() }),
      handler: ({ n }) => n * 2,
    })
    await expect(cmd({ n: "not a number" as never })).rejects.toThrow(z.ZodError)
  })

  test("applies schema defaults before calling the handler", async () => {
    const cmd = defineCommand({
      name: "cmd",
      schema: z.object({
        n: z.number().default(7),
      }),
      handler: ({ n }) => n,
    })
    expect(await cmd({} as never)).toBe(7)
  })

  test("exposes name, description, schema, positional, def, invoke", () => {
    const schema = z.object({ x: z.string() })
    const cmd = defineCommand({
      name: "test",
      description: "a test command",
      schema,
      positional: ["x"],
      handler: () => null,
    })
    expect(cmd.name).toBe("test")
    expect(cmd.description).toBe("a test command")
    expect(cmd.schema).toBe(schema)
    expect(cmd.positional).toEqual(["x"])
    expect(typeof cmd.invoke).toBe("function")
    expect(cmd.def.handler).toBeDefined()
  })

  test("invoke takes unknown — variance-neutral storage path", async () => {
    const cmd = defineCommand({
      name: "cmd",
      schema: z.object({ v: z.string() }),
      handler: ({ v }) => v.toUpperCase(),
    })
    // `invoke` accepts unknown — must validate at runtime.
    const r1 = await cmd.invoke({ v: "ok" })
    expect(r1).toBe("OK")
    await expect(cmd.invoke({ v: 123 })).rejects.toThrow(z.ZodError)
  })

  test("positional defaults to [] when omitted", () => {
    const cmd = defineCommand({
      name: "cmd",
      schema: z.object({ x: z.string() }),
      handler: () => null,
    })
    expect(cmd.positional).toEqual([])
  })
})
