/**
 * Kebab-case example schema. Proves that camelCase zod keys
 * (`queryText`, `maxItems`) become kebab-case CLI flags
 * (`--query-text`, `--max-items`) end-to-end.
 *
 * `baseUrl` from `KEBAB_BASE_URL` so the qa harness can point
 * at a mock server.
 */

import { z } from "zod"
import { defineApi, get } from "../../src"

const baseUrl = process.env.KEBAB_BASE_URL ?? "http://localhost:0"

export const kebabApi = defineApi({
  name: "kebab-api",
  baseUrl,
  endpoints: {
    echo: get(
      "/v1/echo",
      z.object({
        queryText: z.string(),
        maxItems: z.coerce.number().int().default(5),
      }),
      {
        response: z.object({
          q: z.string().nullable(),
          n: z.number(),
        }),
      },
    ),
  },
})
