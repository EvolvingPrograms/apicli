/**
 * Output emission + error mapping for the CLI runtime.
 */

import { z } from "zod"

export function emit(value: unknown): void {
  process.stdout.write(JSON.stringify(value) + "\n")
}

export function mapError(
  err: unknown,
  name: string,
  errorClass?: new (msg: string) => Error,
): never {
  if (errorClass && err instanceof errorClass) {
    process.stderr.write(`${name}: ${err.message}\n`)
    process.exit(1)
  }

  if (err instanceof z.ZodError) {
    process.stderr.write(`${name}: invalid input\n${z.prettifyError(err)}\n`)
    process.exit(1)
  }

  const message = err instanceof Error ? err.message : String(err)
  process.stderr.write(`${name}: ${message}\n`)
  process.exit(1)
}
