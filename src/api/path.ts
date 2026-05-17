/**
 * Path-template and query-string helpers for the API client.
 */

export function extractPlaceholders(path: string): string[] {
  const out: string[] = []
  for (const match of path.matchAll(/\{([^}]+)\}/g)) {
    const name = match[1]
    if (name !== undefined) out.push(name)
  }

  return out
}

export function renderPath(path: string, params: Record<string, string>): string {
  return path.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const value = params[name]
    if (value === undefined) {
      throw new Error(`renderPath: missing value for {${name}}`)
    }
    return encodeURIComponent(value)
  })
}

/**
 * Query-string serialisation. Arrays → comma-joined (matches the
 * convention used by FRED, Yahoo's `symbols=A,B,C`, etc.).
 */
export function serialize(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(",")
  return String(value)
}
