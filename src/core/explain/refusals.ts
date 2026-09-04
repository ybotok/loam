/**
 * One sentence per envelope refusal code, for `loam explain`.
 *
 * This is the one deliberate restatement in the explain lookup, and the
 * compiler is its drift test: unlike the finding codes — whose prose ships in
 * the /loam-check fix tables and is PARSED at runtime (fix-tables.ts) — the
 * `ErrorCode` union's meanings live only in doc comments, which are erased,
 * so there is no runtime constant to read. `satisfies Record<ErrorCode,
 * string>` makes the pairing exhaustive both ways: a new union member cannot
 * ship without a row here (missing key fails typecheck), and a row for a
 * retired code fails the same way. What tsc cannot pin is accuracy — a
 * reworded doc comment can drift from its sentence — which is why each row
 * stays ONE sentence in the union's own voice (what happened, what it means,
 * whether re-running can work) rather than growing a paragraph of its own.
 */
import type { ErrorCode } from "../envelope/json.js";

export const REFUSAL_MEANINGS = {
  "no-config":
    "No loam.json at or above the working directory — the repo is not wired to a fleet; run `loam init --docs <dir>` once per repository rather than letting a command guess where the fleet lives.",
  "config-invalid":
    "loam.json exists but cannot be loaded — repair the file (or delete it and re-run `loam init`); the code is distinct from `no-config` because running init over a corrupt config would silently rewrite it.",
  "unknown-target":
    "The name resolves to nothing this command can address — no such service, feature, workflow or subject; the message offers the closest known names.",
  "invalid-option":
    "The invocation itself is wrong — flags that contradict each other, a value that cannot be right, or a mistyped flag or command; nothing was read or written, and with `--json` anywhere in the arguments even commander's own usage errors arrive as this envelope.",
  "already-exists":
    "Refusing to create over something that already exists — a feature directory, a workspace file, a name already claimed in the subsystem namespace — because overwriting would destroy work nobody asked to lose.",
  "sources-absent":
    "`loam vouch` refuses to stamp a document that names no `sources` — with nothing tying the document to code, the staleness signal a vouch exists to power could never fire.",
  "sources-path-missing":
    "`loam vouch` refuses to stamp: a listed source does not exist in the service repo, or is a glob pattern (not supported) — the digest would cover a different file set than the author meant.",
  "not-coherent":
    "`loam archive` refuses: the feature has coherence issues, carried in `issues[]` with a per-issue `overridable` — fix the gating ones, or `--approve` the judgment calls; a refusal `--approve` cannot move says so in the message.",
  "living-outside-requirements":
    "`loam archive` refuses: the LIVING spec holds a requirement outside its `## Requirements` section, and the merge rewrites only that section, so the requirement would land in the file twice — the fix is in the living document, and `--approve` does not override it.",
  "archive-exists":
    "`loam archive` refuses: `features/archive/` already holds a directory for this feature — a destination collision, not a merge problem; move the old archive entry aside first.",
  "merge-failed":
    "The merge — or a journaled writer's one-file commit — could not be computed or was rolled back; the living docs are unchanged, and re-running can work.",
  "rollback-incomplete":
    "A failed write could not be fully undone: some files were not put back, and the message lists them — the one refusal that needs a human before anything else runs against the repo.",
  "feature-active":
    "`loam unarchive` refuses: a `features/` directory for this feature already exists outside the archive, so restoring would write over work in flight — remove or rename it, then re-run.",
  "snapshot-missing":
    "`loam unarchive` refuses: the archive carries no snapshot of what it overwrote (it predates snapshots, or was written by a different loam) — restore the living docs from version control instead.",
  "snapshot-stale":
    "`loam unarchive` refuses: the living docs changed after the archive, so restoring is no longer an undo — re-run with `--force` to restore anyway, deliberately discarding those later changes.",
  "snapshot-corrupt":
    "`loam unarchive` refuses: a snapshot pre-image no longer matches the digest the archive recorded for it, so restoring would write text nobody wrote — `--force` does not override this one; restore from version control.",
  "commit-interrupted":
    "A journaled writer (archive, unarchive, rebase, vouch, new, gherkin, a recording verify) was killed mid-commit and this run cannot repair the leftovers on its own — the docs may be half-written; run the command the message names, or `loam doctor` for the file-by-file account.",
  "restore-failed":
    "`loam unarchive` failed and everything was rolled back — nothing was restored, the living docs are unchanged, and re-running can work.",
  "answers-unreadable":
    "A recording `loam verify` could not read a user-named file — the answers JSON, or a cucumber/contract report — as what it claims to be; fail-closed: nothing was recorded, so fix the file and re-run.",
  "answers-mismatch":
    "The answer set does not answer the current checklist — an id not on it, a claim with no answer, or an entry for a claim a passed report already owns; re-derive the checklist and answer exactly what it asks.",
  "answers-unevidenced":
    "A `confirmed` answer carries no evidence — evidence is `file:line`, and a claim you cannot show is `unconfirmed` with a note saying why, which is a successful record, not a failure.",
  "service-mismatch":
    "A command that must run inside one service's own repository was told `--service` for a service this repository's loam.json does not declare: a recording `loam verify`, whose attestation must be bound to the code it is about; `loam gherkin`, whose .feature files land in that service's checkout; or `loam vouch`, whose `sources` resolve there. Run it from that service's own repo.",
  "unknown-service":
    "Federated verify recording: the selected service is not one this feature's checklist (or the docs repo) knows, so there is nothing its attestation could bind to — fix the id.",
  "repository-unavailable":
    "The repository this operation must be bound to (or read from) cannot be answered for — most commonly a writing `loam verify`, a `loam gherkin` or a `loam vouch` run where loam.json declares no `service` at all (the docs repo, usually), or a docs repo that cannot be enumerated — so the command refuses rather than guessing which service it is about.",
  "record-federated":
    "`loam verify --record` without `--service` over a federated (schema 2) record — the all-at-once form would erase other repositories' attestations, so it is refused naming the attestors; record per service instead.",
  "record-unreadable":
    "A verification.yaml exists but cannot be read as a record — it is never overwritten and never reported as absent; repair it by hand, or re-record from the service's repo.",
  "record-raced":
    "`loam verify --record` found the record changed between its locked read and the swap — an editor or a lock-ignoring writer landed first; nothing was written, and re-running merges over the record as it now stands.",
  "gherkin-conflict":
    "`loam gherkin <FEAT>` would overwrite a `.feature` file owned by another feature still in flight — the whole emission refuses and names the owner; archive or coordinate with that feature first.",
  "vouch-raced":
    "`loam vouch` found the spec changed between reading and stamping — another vouch or an edit landed first; nothing was written, so re-read and re-run.",
  "vouch-unattended":
    "`loam vouch` with nobody on the other end of stdin and no `--yes` — the stamp is a person's claim to have read the document, and nobody was asked.",
  "vouch-unattributable":
    "`loam vouch` could not learn who is vouching — git names no `user.email` here — and a stamp with nobody behind it records only that the word was written; set your git identity and re-run.",
  "vouch-declined":
    "`loam vouch` asked and the person said no — nothing was stamped; a successful refusal, not a failure.",
  "docs-missing":
    "`docsDir` in loam.json points at nothing — the docs repo was never cloned, or the path is wrong; a read command refuses rather than reporting an empty fleet, and `loam doctor` names the wiring to fix.",
  "services-missing":
    "`docsDir` is a directory but holds no `services/` — it is some other directory, most often the service repo itself after a typo; fix the pointer rather than scaffolding a second source of truth beside the real one.",
  "docs-busy":
    "Another loam writer holds the docs repo's advisory lock — nothing was read or written, and re-running once it finishes works; a lock nothing will ever release shows up in `loam doctor` as a blocker.",
  "subsystem-not-empty":
    "`loam subsystem` rm refuses a subsystem that still holds members — services or child subsystems, named in the message — because a destructive command never picks targets the caller did not name; move them out first, then re-run.",
  "move-uncommitted":
    "A subsystem move/rename refuses because git reports uncommitted or untracked paths under a directory being moved — the rename would sweep them into a move nobody reviewed; commit, `git stash -u`, or remove them, then re-run.",
  "move-failed":
    "A subsystem move/rename failed and was rolled back cleanly — every rename undone, the generated views file restored, the docs unchanged; re-running can work.",
  "no-members":
    "`loam open` found no service checkout bound to this docs repo under any scanned root — the workspace would hold only the docs repo; clone a bound checkout beside it, or point `--root` at where the checkouts live.",
  "binding-duplicate":
    "Two discovered repositories' committed loam.json files declare the same `service` for this docs repo — loam will not guess which checkout speaks for the service; narrow the scan with `--root`, or fix the stray binding.",
  "owners-unreadable":
    "`loam list --owners` could not use the named CODEOWNERS file — the path cannot be read, or a line does not parse as `pattern owner…` (the message names the line); fail-closed, because a half-read ownership file must never file a service under the wrong team.",
  "seed-file-invalid":
    "`loam seed`'s fleet file is missing, unreadable, not YAML, the wrong shape, carries an illegal id — or no longer names every existing `services/<id>/` (that refusal lists the exact ids as `missingServices`); the message names the file and line, and editing the file and re-running succeeds.",
  "seed-duplicate-service":
    "fleet.yaml declares one name twice — as two services, or as both a service and an external/subsystem; service ids, subsystem names and externals share one flat namespace, both declaration lines are named, and renaming one fixes it.",
  "seed-unknown-subsystem":
    "A service's `subsystem:` in fleet.yaml names nothing `subsystems:` declares — the message carries a did-you-mean over the names the file really declares; add the subsystem or fix the spelling, then re-run.",
  "seed-landscape-edited":
    "architecture/landscape.likec4 carries hand edits (the line-1 stamp's digest no longer matches) or was authored some other way, which includes anything written ABOVE the scaffold's stub — `loam seed` never overwrites human work and wrote nothing; fold the edits into fleet.yaml and delete the file, or keep the hand-authored map and stop using seed.",
  internal:
    "An unexpected throw — the one refusal with no stable meaning; it exists so a `--json` consumer still receives an envelope instead of a stack trace, and a repeatable `internal` is a loam defect worth reporting.",
} as const satisfies Record<ErrorCode, string>;
