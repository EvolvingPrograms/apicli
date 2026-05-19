/**
 * Shared type surface for the api-cli infra.
 *
 * The variance trick used here: storage-side types (`StoredApi`,
 * `StoredCommand`) use `unknown` in input positions and read-only
 * `__spec` / `invoke` properties. Specific typed clients/commands
 * fit those shapes via property covariance, so plugins keep their
 * narrow inference at call sites while the factory accepts them
 * uniformly.
 */

import type {
  Command,
  CommanderError,
  HelpConfiguration,
  OutputConfiguration,
} from "commander"
import type { z } from "zod"

// ===========================================================================
// API layer — schema-driven HTTP client
// ===========================================================================

export interface EndpointSpec<
  S extends z.ZodObject = z.ZodObject,
  R extends z.ZodType | undefined = z.ZodType | undefined,
> {
  method: "GET" | "POST"
  path: string
  params: S
  description?: string
  response?: R
}

export interface EndpointOptions<R extends z.ZodType | undefined = undefined> {
  description?: string
  response?: R
}

/**
 * Per-endpoint return type. If the endpoint declared a `response`
 * zod schema, the inferred type flows through to the client method;
 * otherwise callers get `unknown` and validate themselves.
 */
export type EndpointResult<E extends EndpointSpec>
  = E extends EndpointSpec<z.ZodObject, infer R>
    ? R extends z.ZodType
      ? z.infer<R>
      : unknown
    : unknown

/**
 * Dependent endpoint — the response shape depends on one of the
 * request params. Used when an endpoint takes a "select" arg
 * (e.g. Yahoo's `modules: ["summaryDetail", ...]`) and returns
 * only the requested slices.
 *
 * `selectMap`: `selectKey value → response zod schema`. The
 * generated client method is generic over the literal tuple of
 * selected values; the return type collects only the picked
 * schemas.
 *
 *   quoteSummary: dependent("/v10/.../{symbol}", baseParams, "modules", {
 *     summaryDetail: z.object({...}),
 *     financialData: z.object({...}),
 *   })
 *   yahoo.quoteSummary({ symbol: "AAPL", modules: ["summaryDetail"] })
 *   //                                            ^^^^^^^^^^^^^^^^^ inferred as tuple
 *   // → Promise<{ summaryDetail: { ... } }>
 *
 * `wrap` (optional) reshapes the inferred per-call response zod
 * schema before validation. Defaults to identity.
 */
export interface DependentEndpointSpec<
  S extends z.ZodObject = z.ZodObject,
  SelectKey extends string = string,
  Map extends Record<string, z.ZodType> = Record<string, z.ZodType>,
> {
  method: "GET" | "POST"
  path: string
  baseParams: S
  selectKey: SelectKey
  selectMap: Map
  description?: string
  wrap?: (picked: z.ZodObject<Record<string, z.ZodType>>) => z.ZodType
  /** Runtime discriminator. */
  readonly __dependent: true
}

export type AnyEndpointSpec
  = | EndpointSpec
    | DependentEndpointSpec<z.ZodObject, string, Record<string, z.ZodType>>

export type EndpointMap = Record<string, AnyEndpointSpec>

/**
 * Declarative requirements an API needs at construction time.
 * Validated by `defineApi` — if any required entry is missing,
 * a clear error is thrown before the first request fires.
 *
 * Currently supports env vars; future-extensible to files /
 * secrets / capabilities as the need surfaces.
 */
export interface ApiRequires<Env extends readonly string[] = readonly string[]> {
  /**
   * Env var names that must be present in `process.env` when
   * the client is built. The headers / baseQuery callbacks get
   * each one typed as `string` (not `string | undefined`).
   */
  env?: Env
}

/**
 * Context handed to `headers` / `baseQuery` callbacks. `env`
 * carries the env vars declared in `ApiSpec.requires.env`,
 * already validated and pre-fetched. When `requires.env` isn't
 * declared, `env` is an empty record.
 */
export interface ApiContext<Env extends readonly string[] = readonly string[]> {
  env: Record<Env[number], string>
}

export interface ApiSpec<
  E extends EndpointMap = EndpointMap,
  Env extends readonly string[] = readonly string[],
> {
  name: string
  baseUrl: string
  /**
   * Shorthand for "this API uses bearer-token auth from this env
   * var". Equivalent to:
   *
   *   - adding the var name to `requires.env`
   *   - prepending `Authorization: Bearer ${env[name]}` to every
   *     request's headers
   *
   * User-supplied `headers` still win — if you return your own
   * `Authorization` from the `headers` callback, it overrides
   * the auto-injected one. Use that escape hatch for non-Bearer
   * schemes (HMAC, OAuth refresh, etc.).
   */
  auth?: string
  /** Declared construction-time requirements (env vars, ...). */
  requires?: ApiRequires<Env>
  /**
   * Override the env source. By default `defineApi` reads from
   * `process.env`; pass a record here to substitute (useful for
   * tests, in-process multi-tenant setups, etc.). Required vars
   * declared in `requires.env` are still validated against this
   * source.
   */
  env?: Record<string, string>
  /** Headers attached to every request. Async ok (for crumb dances, etc.). */
  headers?: (ctx: ApiContext<Env>) => Record<string, string> | Promise<Record<string, string>>
  /** Query params merged onto every request (api_key, file_type, ...). */
  baseQuery?: (ctx: ApiContext<Env>) => Record<string, string> | Promise<Record<string, string>>
  endpoints: E
}

/**
 * Typed callable per endpoint. Two variants:
 *
 *   - Plain `EndpointSpec`: a single-signature method whose
 *     return type comes from the optional `response` schema.
 *
 *   - `DependentEndpointSpec`: a generic method whose return
 *     type depends on the literal tuple at `selectKey`. The
 *     `const` type parameter makes inference work without an
 *     explicit `as const` at the call site.
 */
export type ApiClient<E extends EndpointMap> = {
  [K in keyof E]: E[K] extends DependentEndpointSpec<infer S, infer SK, infer Map>
    ? <const Picked extends ReadonlyArray<keyof Map & string>>(
        args: z.input<S> & { [P in SK]: Picked },
      ) => Promise<{ [P in Picked[number]]: z.infer<Map[P]> }>
    : E[K] extends EndpointSpec<z.ZodObject, z.ZodType | undefined>
      ? (args: z.input<E[K]["params"]>) => Promise<EndpointResult<E[K]>>
      : never
} & { readonly __spec: ApiSpec<E> }

/**
 * Variance-neutral view of an ApiClient. Used by `addApiCli`
 * and `createCli` so specific `ApiClient<E>` values fit the
 * storage shape via the covariant `__spec` property.
 */
export interface StoredApi {
  readonly __spec: ApiSpec
}

// ===========================================================================
// CLI layer — typed command functions
// ===========================================================================

export interface CommandDef<S extends z.ZodObject = z.ZodObject, R = unknown> {
  name: string
  description?: string
  schema: S
  /**
   * Schema keys rendered as positional `<arg>` instead of
   * `--flag` for the CLI. Order matters — positionals are
   * consumed left-to-right. e.g. `["symbol"]` makes
   * `quote SPY` work in addition to / instead of
   * `quote --symbol SPY`.
   */
  positional?: ReadonlyArray<Extract<keyof z.infer<S>, string>>
  handler: (args: z.infer<S>) => R | Promise<R>
}

/**
 * Variance-neutral storage view of a command. The `invoke` method
 * takes `unknown` (universal in input position), so any specific
 * `CommandFn<S, R>` is assignable to this.
 */
export interface StoredCommand {
  readonly name: string
  readonly description: string | undefined
  readonly schema: z.ZodObject
  readonly positional: ReadonlyArray<string>
  readonly invoke: (args: unknown) => Promise<unknown>
}

/**
 * Public-facing command. Intersection of:
 *   - the typed call signature (for direct callers like
 *     `await chart({symbol:"SPY"})` — returns typed `R`)
 *   - the type-erased `StoredCommand` view (for `createCli` to
 *     register without variance friction)
 *   - the `def` metadata (for tooling / introspection)
 */
export type CommandFn<S extends z.ZodObject, R>
  = & ((args: z.input<S>) => Promise<R>)
    & StoredCommand
    & { readonly def: CommandDef<S, R> }

/**
 * Subset of Commander's setter API that callers can override on
 * `createCli({ commander })`. Each field maps 1:1 to a method on
 * the underlying `Command`:
 *
 *   - `configureHelp` → `program.configureHelp(value)`
 *   - `configureOutput` → `program.configureOutput(value)`
 *   - `exitOverride` → `program.exitOverride(value)`
 *   - `helpOption` → `program.helpOption(...args)`
 *   - `showHelpAfterError` → `program.showHelpAfterError(value)`
 *   - `allowUnknownOption` → `program.allowUnknownOption(value)`
 *   - `allowExcessArguments` → `program.allowExcessArguments(value)`
 *
 * For `configureHelp` specifically, clipi merges the caller's
 * style hooks with its defaults on a per-property basis — so
 * passing `{ configureHelp: { styleTitle: x => x } }` overrides
 * only `styleTitle` and leaves the other style hooks in place.
 *
 * Each option is optional. When absent, clipi's defaults apply.
 */
export interface CommanderOptions {
  configureHelp?: HelpConfiguration
  configureOutput?: OutputConfiguration
  /**
   * `true` → call `program.exitOverride()` with no args (throws
   * a `CommanderError` instead of calling `process.exit`).
   * Function → forwarded as the callback.
   */
  exitOverride?: true | ((err: CommanderError) => never | void)
  /** Args forwarded to `program.helpOption(...)`. */
  helpOption?: [string, string?] | false
  showHelpAfterError?: boolean | string
  allowUnknownOption?: boolean
  allowExcessArguments?: boolean
}

export interface CreateCliOptions {
  name: string
  description: string
  /** Friendly commands. Each becomes a commander subcommand. */
  commands: ReadonlyArray<StoredCommand>
  /** API client from `defineApi`. If provided, exposes `api <endpoint>`. */
  api?: StoredApi
  /** Error class. Thrown instances get mapped to `name: <msg>` + exit 1. */
  errorClass?: new (msg: string) => Error
  /**
   * Pass-through configuration applied to the underlying
   * Commander program. Each field maps to a Commander setter
   * method. Clipi's defaults (notably a styled `configureHelp`)
   * apply when fields are absent; caller-provided values
   * override on a per-property basis where it makes sense.
   *
   * See {@link CommanderOptions} for the supported fields.
   */
  commander?: CommanderOptions
}

export interface Cli {
  /** Raw commander program — escape hatch for plugin-specific tweaks. */
  program: Command
  /** Call after all setup. Parses argv and dispatches. */
  run(): Promise<void>
}
