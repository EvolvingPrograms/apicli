/**
 * Bun test preload — pins `FORCE_COLOR=1` so the table renderer
 * emits ANSI codes deterministically in every test, regardless of
 * whether `bun test` allocates a TTY. Tests assert against the
 * colored output because color is part of the contract.
 */
process.env.FORCE_COLOR = "1"
delete process.env.NO_COLOR
