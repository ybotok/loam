/**
 * The `--json` envelope — loam's machine contract.
 *
 * Every JSON response carries `ok`. Success spreads the payload alongside it;
 * failure carries a stable `error.code` a caller can branch on without parsing
 * prose. Errors go to stdout too: a consumer reads one stream and always gets
 * valid JSON, whether the command succeeded or not. The exit code still tells
 * the shell what happened.
 *
 * Three keys identify the envelope before its payload is read, and they answer
 * three different questions: `contractVersion` is the SHAPE's version,
 * `version` is the BINARY's, and `command` (on every success payload) says
 * which verb produced it. The first two are stamped by the emitters below so
 * no command can forget them; the third is the payload's own first key,
 * because only the command knows its name.
 *
 * Key casing: camelCase, with one deliberate exception — a key that mirrors a
 * frontmatter field verbatim keeps that field's snake_case spelling
 * (`last_verified`, `sources_digest` in vouch's payload), so the envelope and
 * the document it describes spell the same fact the same way. snake_case only
 * where a key mirrors a frontmatter field verbatim; camelCase everywhere else.
 */
import { relative } from "node:path";
import { LOAM_VERSION } from "./version.js";

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

/**
 * `version` is stamped HERE rather than by each command for the reason the
 * `command` discriminator was not, and had to be retrofitted one call site at a
 * time: a key every envelope owes is a key no command can be trusted to
 * remember. Two lines in the two emitters give it to every command and every
 * refusal at once, and a command added tomorrow cannot ship without it.
 *
 * Why a consumer needs it at all: `docs.binary-behind` exists to say that a
 * green run from an old binary is worth less than it looks, and a caller
 * holding only a `--json` payload could not tell which loam produced it — so it
 * could not apply that caution, and could not see a mixed-version fleet in the
 * contract. It sits beside `contractVersion`, never inside it: the envelope
 * SHAPE and the binary that filled it version independently, and collapsing
 * them would make every release look like a contract break.
 */
export function emitJson(payload: Record<string, unknown>): void {
  console.log(
    JSON.stringify({ contractVersion: JSON_CONTRACT_VERSION, version: LOAM_VERSION, ok: true, ...payload }, null, 2),
  );
}

/** Paths in the contract are repo-relative, with forward slashes: diffable across machines. */
export function repoPath(docsDir: string, abs: string): string {
  return relative(docsDir, abs).split(/[\\/]/).join("/");
}

/**
 * Emit a failure envelope and set the exit code. Returns false, to `return`
 * from a caller.
 *
 * `version` is on this path too, and deliberately: a refusal is the envelope a
 * consumer is most likely to be holding at the moment it needs to know which
 * binary answered — "this loam does not have that flag / that code" is a
 * question about the build, and an unversioned refusal makes it unanswerable.
 *
 * There is no `command` here, and adding one is not a small change. The error
 * emitter has no command in scope: `fail()` is called from deep inside core-ish
 * helpers that never learn which verb the user typed, so threading it means
 * either module-level mutable state — a hazard this codebase names outright,
 * because a value cached at import time leaks across the forked test processes
 * and across invocations in a long-running host — or one more argument threaded
 * through `fail()`, `reportNoConfig()` and every deep helper that refuses, each
 * of which would then carry a value it has no other use for. A consumer that
 * needs to know which command refused already knows: it made the call.
 */
export function emitJsonError(
  code: ErrorCode,
  message: string,
  details: Record<string, unknown> = {},
): false {
  console.log(
    JSON.stringify(
      { contractVersion: JSON_CONTRACT_VERSION, version: LOAM_VERSION, ok: false, error: { code, message }, ...details },
      null,
      2,
    ),
  );
  process.exitCode = 1;
  return false;
}

/**
 * The refusals that print no `loam explain` pointer, each with the reason it is
 * here. ONE named set rather than a condition per call site: "is this refusal
 * worth looking up?" is a single question, and answering it in seven places is
 * how two of them come to disagree.
 *
 * - `vouch-declined` — loam asked whether to stamp, and a person said no.
 *   Nothing failed and there is nothing to fix, so a pointer would invite
 *   somebody to go read the meaning of their own answer.
 *
 * `internal` was weighed and deliberately LEFT OUT. It is the one code with no
 * stable meaning, which reads like a reason to stay silent — but its
 * explanation carries the only instruction available to a person staring at an
 * unexpected throw (a repeatable `internal` is a loam defect worth reporting),
 * and that is worth more than the silence the old behaviour gave them.
 *
 * Exported so test/explain.test.ts can pin the membership: an entry added here
 * silently removes a pointer nobody would notice was gone.
 */
export const NO_EXPLAIN_POINTER: ReadonlySet<ErrorCode> = new Set<ErrorCode>(["vouch-declined"]);

/**
 * The one-line pointer from a refusal to the command that explains it.
 *
 * Measured over eight wrong invocations a person makes in their first hour —
 * no loam.json, an unknown service, an unknown feature, an unbound `gherkin`,
 * a malformed feature id — every single one printed prose and no code, and
 * only `loam validate` mentioned `loam explain` at all. `explain` is the best
 * usability asset loam has and the message that most needs it could not reach
 * it: to look a refusal up you first had to re-run the whole command with
 * `--json` and read `error.code` out of the envelope, which is precisely the
 * knowledge a first-hour user does not have. The code is printed as well as
 * the invocation because the two are different needs: the bare code is what
 * goes into a bug report, a grep or a CI branch, and the invocation is what
 * answers it here.
 *
 * STDERR, never stdout, and that is the load-bearing half: a refusal's
 * diagnostic must not pollute a piped payload. `loam show svc > out.json`
 * already keeps its message off stdout, and a pointer that broke that rule
 * would corrupt exactly the pipelines text mode was careful never to touch.
 * (Findings do the opposite — their codes go to stdout with the report, in
 * document order, for validate/report.ts's own reason. Same fact, two streams,
 * because a finding is the answer and a refusal is the absence of one.)
 *
 * Nothing runs here under `--json`: the envelope already carries `error.code`
 * as data, and a machine reader has no use for being told a second command
 * exists — the same doctrine `EXPLAIN_FOOTER` follows in
 * commands/policy/format.ts.
 *
 * No ANSI escape, though the line is meant to READ as dim. Nothing in this
 * codebase emits escape sequences, the output is graded by tests that compare
 * strings, and a colour that survives into a redirected file or a CI log is
 * noise nobody asked for. The typography does the dimming: the code, a spaced
 * middot, the command — an aside, not a sentence.
 */
export function sayExplain(code: ErrorCode): void {
  if (NO_EXPLAIN_POINTER.has(code)) return;
  console.error(`${code}  ·  loam explain ${code}`);
}

/**
 * Report a failure in whichever mode the caller is in. Text mode goes to
 * stderr as it always has — now with the code and its lookup on a second line;
 * JSON mode goes into the envelope, whose stdout bytes are unchanged.
 */
export function fail(json: boolean, code: ErrorCode, message: string): void {
  if (json) {
    emitJsonError(code, message);
    return;
  }
  console.error(message);
  sayExplain(code);
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
