/**
 * The `--json` envelope — loam's machine contract.
 *
 * Every JSON response carries `ok`. Success spreads the payload alongside it;
 * failure carries a stable `error.code` a caller can branch on without parsing
 * prose. Errors go to stdout too: a consumer reads one stream and always gets
 * valid JSON, whether the command succeeded or not. The exit code still tells
 * the shell what happened.
 *
 * Key casing: camelCase, with one deliberate exception — a key that mirrors a
 * frontmatter field verbatim keeps that field's snake_case spelling
 * (`last_verified`, `sources_digest` in vouch's payload), so the envelope and
 * the document it describes spell the same fact the same way. snake_case only
 * where a key mirrors a frontmatter field verbatim; camelCase everywhere else.
 */
import { existsSync } from "node:fs";
import { relative } from "node:path";
import { configPath } from "./config.js";

/**
 * Version of the top-level JSON envelope, independent of the CLI/package
 * version. Additive payload fields do not require a bump; incompatible changes
 * to `ok`, `error`, or their semantics do.
 */
export const JSON_CONTRACT_VERSION = "1.0";

/**
 * Stable failure codes. Prose may change; these may not.
 *
 * The `sources-*` pair mirrors the `sources.*` finding codes on purpose: the
 * same breach is recognisable whether it arrives as a refusal from `vouch` or
 * as a finding from `validate`.
 *
 * The `feature-active` / `snapshot-*` group is `unarchive` refusing to guess:
 * each names a different reason the undo is not one, and a caller has to tell
 * them apart to know whether re-running could ever work. Its commit failures
 * split the same way archive's do: `restore-failed` means nothing was restored
 * or everything was rolled back — the living docs are unchanged and re-running
 * can work; `rollback-incomplete` (shared with archive, same meaning) means
 * some files could not be put back, and the message lists them.
 *
 * The `answers-*` group is `loam verify --record` refusing an answer set that
 * does not answer the current checklist. They are separated for the same reason:
 * an unreadable file is a bug in whatever wrote it, a mismatch means the feature
 * moved and the claims have to be answered again, and an unevidenced
 * confirmation is the one an agent can fix on the spot.
 *
 * The archive group is `loam archive` refusing or failing, and each code is a
 * different answer to "what do I fix, and can I trust the repo?": `not-coherent`
 * is the gate — errors in the FEATURE, fix them or override with `--approve`;
 * `living-outside-requirements` is the one refusal `--approve` does not move —
 * the LIVING spec holds requirements outside `## Requirements`, and the merge
 * would duplicate them, so the fix is in the living docs; `archive-exists` is a
 * destination collision under `features/archive/`; `merge-failed` is a merge
 * that could not be computed or was rolled back — either way the living docs
 * are unchanged; `rollback-incomplete` is the one that demands a human: the
 * merge failed AND some files could not be restored.
 *
 * `config-invalid` is distinct from `no-config` because the fixes point in
 * opposite directions: a missing config wants `loam init`, a corrupt one wants
 * repair — and an agent that ran `init` on a corrupt file would silently
 * rewrite it.
 *
 * `internal` is the one code with no stable meaning: an unexpected throw. It
 * exists so a `--json` consumer still receives an envelope instead of a stack
 * trace on stdout's sibling stream.
 */
export type ErrorCode =
  | "no-config"
  | "config-invalid"
  | "unknown-target"
  | "invalid-option"
  | "already-exists"
  | "sources-absent"
  | "sources-path-missing"
  | "not-coherent"
  | "living-outside-requirements"
  | "archive-exists"
  | "merge-failed"
  | "rollback-incomplete"
  | "feature-active"
  | "snapshot-missing"
  | "snapshot-stale"
  /** A snapshot pre-image whose bytes no longer match the digest archive recorded for them: `unarchive` will not restore text nobody wrote. */
  | "snapshot-corrupt"
  /** A `loam archive`/`unarchive` was killed mid-commit: the living docs are half-written, and this run refuses rather than writing over the evidence. */
  | "commit-interrupted"
  | "restore-failed"
  | "answers-unreadable"
  | "answers-mismatch"
  | "answers-unevidenced"
  | "service-mismatch"
  | "unknown-service"
  | "repository-unavailable"
  /** `loam verify --record` without `--service` over a federated (schema 2) record: it would erase other repositories' attestations. */
  | "record-federated"
  /** A `verification.yaml` that exists but cannot be read as a record — never overwritten, never reported as absent. */
  | "record-unreadable"
  /** `loam gherkin <FEAT>` refusing to overwrite a `.feature` file owned by another feature still in flight. */
  | "gherkin-conflict"
  /** `loam vouch` found the spec changed under it between reading and stamping — another vouch or an edit landed first, and nothing was written. */
  | "vouch-raced"
  /** `docsDir` in loam.json points at nothing: the docs repo was never cloned, or the path is wrong. A read command refuses rather than reporting an empty fleet. */
  | "docs-missing"
  /** `docsDir` is a directory but has no `services/`: it is some other directory, most often the service repo itself after a typo. */
  | "services-missing"
  /** Another `loam archive`/`unarchive` holds the docs repo's advisory lock: nothing was read or written, and re-running once it finishes works. */
  | "docs-busy"
  | "internal";

export function emitJson(payload: Record<string, unknown>): void {
  console.log(JSON.stringify({ contractVersion: JSON_CONTRACT_VERSION, ok: true, ...payload }, null, 2));
}

/** Paths in the contract are repo-relative, with forward slashes: diffable across machines. */
export function repoPath(docsDir: string, abs: string): string {
  return relative(docsDir, abs).split(/[\\/]/).join("/");
}

/** Emit a failure envelope and set the exit code. Returns false, to `return` from a caller. */
export function emitJsonError(
  code: ErrorCode,
  message: string,
  details: Record<string, unknown> = {},
): false {
  console.log(
    JSON.stringify(
      { contractVersion: JSON_CONTRACT_VERSION, ok: false, error: { code, message }, ...details },
      null,
      2,
    ),
  );
  process.exitCode = 1;
  return false;
}

/**
 * Report a failure in whichever mode the caller is in. Text mode goes to
 * stderr as it always has; JSON mode goes into the envelope.
 */
export function fail(json: boolean, code: ErrorCode, message: string): void {
  if (json) {
    emitJsonError(code, message);
    return;
  }
  console.error(message);
  process.exitCode = 1;
}

/** The message every command prints when there is no loam.json. */
export const NO_CONFIG_MESSAGE = "No loam.json found. Run `loam init --docs <dir>` first.";

/**
 * Report "no config" in whichever mode the caller is in — distinguishing a
 * config that is absent from one that exists but would not load, because the
 * two point at opposite fixes: a missing config wants `loam init`, a corrupt
 * one wants repair, and `init` would silently rewrite the corrupt file.
 * Callers reach here only after `loadConfig()` returned null, so the file
 * existing is proof it failed to load.
 */
export function reportNoConfig(json: boolean): void {
  if (existsSync(configPath())) {
    fail(
      json,
      "config-invalid",
      "loam.json exists but could not be loaded. Fix it (or delete it and re-run `loam init`).",
    );
    return;
  }
  fail(json, "no-config", NO_CONFIG_MESSAGE);
}
