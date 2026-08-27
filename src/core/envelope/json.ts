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
import { relative } from "node:path";

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
 * is the gate — issues in the FEATURE, carried in `issues[]`. Most yield to
 * `--approve`; the ones that do not name an illegal service id — a
 * `specs/<svc>/` directory name (`delta.service-id-invalid`) or a
 * `metadata { service }` binding (`c4.service-binding-invalid`) — because the
 * name IS the path the merge would write, and the fix is a rename, never a
 * flag. A consumer branches on data, not prose: coherence issues carry the
 * additive `overridable` key resolved per issue, and a refusal `--approve`
 * cannot move says "--approve does not override this" in `error.message`;
 * `living-outside-requirements` is the refusal whose fault is not the
 * feature's — the LIVING spec holds requirements outside `## Requirements`,
 * and the merge would duplicate them, so the fix is in the living docs, and
 * `--approve` does not move it either; `archive-exists` is a
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
  /** `loam verify --record` found the record changed between its locked read and the swap — an editor or a lock-ignoring writer landed first. Nothing was written; re-running merges over the record as it now stands. */
  | "record-raced"
  /** `loam gherkin <FEAT>` refusing to overwrite a `.feature` file owned by another feature still in flight. */
  | "gherkin-conflict"
  /** `loam vouch` found the spec changed under it between reading and stamping — another vouch or an edit landed first, and nothing was written. */
  | "vouch-raced"
  /** `loam vouch` with nothing on the other end of stdin and no `--yes`: the stamp is a person's claim, and nobody was asked. */
  | "vouch-unattended"
  /** `loam vouch` could not learn who is vouching — git names no `user.email` here, so the stamp would record a claim with nobody behind it. */
  | "vouch-unattributable"
  /** `loam vouch` was asked to confirm and the answer was no. Nothing was stamped; this is a successful refusal, not a failure. */
  | "vouch-declined"
  /** `docsDir` in loam.json points at nothing: the docs repo was never cloned, or the path is wrong. A read command refuses rather than reporting an empty fleet. */
  | "docs-missing"
  /** `docsDir` is a directory but has no `services/`: it is some other directory, most often the service repo itself after a typo. */
  | "services-missing"
  /** Another loam writer holds the docs repo's advisory lock: nothing was read or written, and re-running once it finishes works. `verify --record` waits out a short holder before giving this answer. */
  | "docs-busy"
  /** `loam subsystem rm` refusing a subsystem that still holds members — services or child subsystems, named in the message. A destructive command never picks targets the caller did not name: move them out (or remove the children) first, then re-run. */
  | "subsystem-not-empty"
  /** `loam subsystem move`/`rename` refusing because git reports uncommitted or untracked paths under a directory being moved — the ONLY move-specific refusal: the rename would sweep them into a move nobody reviewed. Commit them, `git stash -u` (plain `stash` leaves untracked files behind), or remove them, then re-run. When git cannot answer at all the move proceeds — refusal needs positive evidence. */
  | "move-uncommitted"
  /** A subsystem move/rename failed and was rolled back cleanly: every rename undone, the generated views file restored, the docs unchanged — re-running can work. Distinct from `merge-failed` because no merge was computed; a failure that could NOT be fully undone is `rollback-incomplete`, exactly as for archive. */
  | "move-failed"
  /** `loam open` found no service checkout bound to this docs repo under any scanned root — the workspace would hold only the docs repo. Re-running can succeed once a bound checkout exists beside it, or with `--root` pointing where the checkouts live. */
  | "no-members"
  /** Two discovered repositories' committed loam.json files declare the same `service` for this docs repo — two checkouts of one service, or a copied config. loam will not guess which checkout speaks for the service; narrow the scan with `--root` or fix the stray binding, then re-run. */
  | "binding-duplicate"
  /** `loam list --owners` could not use the user-named CODEOWNERS file: the path cannot be read, or a line in it cannot be parsed as `pattern owner…` (the message names the line). Fail-closed like `answers-unreadable` for the other user-named file — a half-read ownership file must never file a service under the wrong team. Re-running succeeds once the path or the line is fixed. */
  | "owners-unreadable"
  /** `loam seed`'s fleet file is missing, unreadable, not YAML, the wrong shape, carries an illegal id or name, or no longer names every existing `services/<id>/` (that arm carries the additive `missingServices` payload key). The message names the file and, where one exists, the line; editing the file and re-running succeeds. */
  | "seed-file-invalid"
  /** fleet.yaml declares one name twice — as two services, or as both a service and an external/subsystem. Service ids, subsystem names and externals share one flat namespace (a call endpoint must name exactly one thing); the message names both declaration lines. Rename one and re-run. */
  | "seed-duplicate-service"
  /** A service's `subsystem:` in fleet.yaml names nothing `subsystems:` declares; the message carries a did-you-mean hint over the names the file really declares. Fix the spelling (or add the subsystem) and re-run. */
  | "seed-unknown-subsystem"
  /** architecture/landscape.likec4 carries hand edits (the line-1 stamp's digest no longer matches) or was authored some other way (no stamp, and not the scaffold's untouched stub). Seed never overwrites human work and nothing was written; re-running cannot succeed until the file is deleted or the edits are folded into fleet.yaml. */
  | "seed-landscape-edited"
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
const NO_CONFIG_MESSAGE = "No loam.json found. Run `loam init --docs <dir>` first.";

/**
 * The message the service-scoped commands print when neither `--service` nor
 * loam.json names one. Four commands ask the same question and owe the same two
 * answers, and a fifth would have been written by hand. `loam delta` keeps its
 * own longer sentence on purpose — it can say which feature was being read.
 */
export const NO_SERVICE_MESSAGE = "No service. Pass --service <id> or set it in loam.json.";

/**
 * Report "no config" in whichever mode the caller is in — distinguishing a
 * config that is absent from one that exists but would not load, because the
 * two point at opposite fixes: a missing config wants `loam init`, a corrupt
 * one wants repair, and `init` would silently rewrite the corrupt file. The
 * distinction arrives as DATA on the load outcome rather than being re-derived
 * from the filesystem here — the file could change between the load and a
 * re-check, and the parse problem itself is worth showing.
 */
export function reportNoConfig(json: boolean, load: { kind: "absent" } | { kind: "invalid"; path: string; problem: string }): void {
  if (load.kind === "invalid") {
    fail(
      json,
      "config-invalid",
      `Invalid loam.json: ${load.problem}. Fix it (or delete it and re-run \`loam init\`).`,
    );
    return;
  }
  fail(json, "no-config", NO_CONFIG_MESSAGE);
}
