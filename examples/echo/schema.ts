/**
 * Echo API schema — the canonical demo. Covers all four
 * endpoint shapes:
 *
 *   - static GET with response validation (`echo`)
 *   - GET with path placeholder (`item`)
 *   - GET that intentionally 5xx's (`boom`, for error mapping)
 *   - dependent endpoint where the response type depends on
 *     the literal tuple at `modules` (`summary`)
 *
 * `baseUrl` comes from `ECHO_BASE_URL` so the qa harness can
 * boot a `Bun.serve` mock on a random port. Real consumers
 * would hardcode their URL.
 */

import { z } from "zod"
import { defineApi, dependent, get } from "../../src"

const baseUrl = process.env.ECHO_BASE_URL ?? "http://localhost:0"

export class EchoError extends Error {
  override readonly name = "EchoError"
}

export const echoApi = defineApi({
  name: "echo-api",
  baseUrl,
  endpoints: {
    echo: get(
      "/v1/echo",
      z.object({
        q: z.string(),
        n: z.coerce.number().int().default(0),
      }),
      {
        response: z.object({
          q: z.string(),
          n: z.number(),
        }),
      },
    ),

    item: get(
      "/v1/item/{id}",
      z.object({ id: z.string() }),
      { response: z.object({ id: z.string(), name: z.string() }) },
    ),

    boom: get("/v1/boom", z.object({})),

    summary: dependent(
      "/v1/summary/{id}",
      z.object({ id: z.string() }),
      "modules",
      {
        detail: z.object({ score: z.number() }),
        financials: z.object({ revenue: z.number() }),
      },
    ),
  },
})
