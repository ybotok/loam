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
 *
 * The `feature-active` / `snapshot-*` group is `unarchive` refusing to guess:
 * each names a different reason the undo is not one, and a caller has to tell
 * them apart to know whether re-running could ever work.
 *
 * The `answers-*` group is `loam verify --record` refusing an answer set that
 * does not answer the current checklist. They are separated for the same reason:
 * an unreadable file is a bug in whatever wrote it, a mismatch means the feature
 * moved and the claims have to be answered again, and an unevidenced
 * confirmation is the one an agent can fix on the spot.
 */
export type ErrorCode =
  | "no-config"
  | "unknown-target"
  | "unknown-section"
  | "invalid-option"
  | "sources-absent"
  | "sources-path-missing"
  | "feature-active"
  | "snapshot-missing"
  | "snapshot-stale"
  | "restore-failed"
  | "answers-unreadable"
  | "answers-mismatch"
  | "answers-unevidenced";

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
