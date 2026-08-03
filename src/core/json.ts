/**
 * The `--json` envelope — loam's machine contract.
 *
 * Every JSON response carries `ok`. Success spreads the payload alongside it;
 * failure carries a stable `error.code` a caller can branch on without parsing
 * prose. Errors go to stdout too: a consumer reads one stream and always gets
 * valid JSON, whether the command succeeded or not. The exit code still tells
 * the shell what happened.
 */

/**
 * Stable failure codes. Prose may change; these may not.
 *
 * The `sources-*` pair mirrors the `sources.*` finding codes on purpose: the
 * same breach is recognisable whether it arrives as a refusal from `vouch` or
 * as a finding from `validate`.
 */
export type ErrorCode =
  | "no-config"
  | "unknown-target"
  | "unknown-section"
  | "invalid-option"
  | "sources-absent"
  | "sources-path-missing";

export function emitJson(payload: Record<string, unknown>): void {
  console.log(JSON.stringify({ ok: true, ...payload }, null, 2));
}

/** Emit a failure envelope and set the exit code. Returns false, to `return` from a caller. */
export function emitJsonError(code: ErrorCode, message: string): false {
  console.log(JSON.stringify({ ok: false, error: { code, message } }, null, 2));
  process.exitCode = 1;
  return false;
}

/** The message every command prints when there is no loam.json. */
export const NO_CONFIG_MESSAGE = "No loam.json found. Run `loam init --docs <dir>` first.";

/**
 * Report "no config" in whichever mode the caller is in. Text mode goes to
 * stderr as it always has; JSON mode goes into the envelope.
 */
export function reportNoConfig(json: boolean): void {
  if (json) {
    emitJsonError("no-config", NO_CONFIG_MESSAGE);
    return;
  }
  console.error(NO_CONFIG_MESSAGE);
  process.exitCode = 1;
}
