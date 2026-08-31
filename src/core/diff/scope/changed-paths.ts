/**
 * Which targets a base git ref puts in scope — the narrowing behind
 * `loam validate --all --base <ref>`.
 *
 * The defect this exists for: a partly-adopted fleet has no CI setting that is
 * both passing today and tightening over time. `--all` is green over eleven
 * undocumented services (they warn, and warnings do not gate) and `--strict` is
 * red from the first minute of adoption until the last boundary is written, so
 * a team installs either a gate that never notices adoption stalling at 8% or
 * one it cannot turn on. `--base` is the third setting: grade what this branch
 * TOUCHED, at full `--strict` severity if the caller wants it, and let the
 * untouched majority stay untouched.
 *
 * A SUB-PACKAGE of `core/diff/` rather than a sixth file in it, because that
 * directory is at the five-file limit and because this is a different subject
 * from the semantic diff beside it: `diff` compares two states of the fleet and
 * reports what moved, this one only decides WHICH SUBJECTS a run should look
 * at. Nothing here reads a document.
 *
 * What it does NOT do, and the line is not negotiable: a diff-scoped validate
 * cannot see a victim boundary the change did not touch. Removing an operation
 * from `payment-service` puts `payment-service` in scope and leaves
 * `checkout-web` — whose living requirement still names the operation — out of
 * it. That join is `loam diff --base`'s question and it stays `loam diff`'s;
 * the two gates answer "did you document what you touched" and "did you break a
 * consumer", and neither substitutes for the other. Selling a green here that
 * hides a broken join would be worse than shipping no flag at all.
 */
import { declineDetail, gitText } from "../../provenance/git.js";
import { repoPath, type ErrorCode } from "../../envelope/json.js";
import { resolveBase } from "../base-git.js";
import type { DocsDir } from "../../kernel/ids/dirs.js";
import type { FeatureEntry, ServiceEntry } from "../../repo/entries.js";

/** Everything the narrowing needs: where to ask, what to ask about, and what there is to narrow. */
export interface ScopeRequest {
  docsDir: DocsDir;
  /** The ref as the caller spelled it — echoed in every message and in the payload. */
  ref: string;
  /** The run's full service enumeration, at whatever depth the tree walk found each one. */
  services: readonly ServiceEntry[];
  /** The run's full ACTIVE feature enumeration. */
  features: readonly FeatureEntry[];
}

/** The narrowed run: which targets the branch touched, and what it narrowed from. */
export interface ValidateScope {
  kind: "scope";
  ref: string;
  /** The 40-hex commit `ref` resolved to — what a rerun would have to pass to reproduce this scope. */
  commit: string;
  /** Did `architecture/` change? The landscape target is the fleet's own subject and has no directory of its own. */
  landscape: boolean;
  services: ServiceEntry[];
  features: FeatureEntry[];
  /** The denominators — what the run would have graded without `--base`. */
  totals: { services: number; features: number };
}

/**
 * A refusal, already spelled. The code is one `loam diff` already emits for the
 * same two conditions and the message is in the same register, deliberately: a
 * second stable code for "that ref does not resolve" would be a second thing to
 * document, branch on and keep in step, for a condition that is identical.
 *
 * The prose is built here rather than in the command because it is the same
 * sentence for every caller and because `base-git.ts`'s `detail` — git's own
 * words, bounded — is what makes it diagnosable; a command that only received a
 * `kind` would have to reinvent the sentence to say why.
 */
export interface ScopeRefusal {
  kind: "refused";
  code: ErrorCode;
  message: string;
}

export type ScopeOutcome = ValidateScope | ScopeRefusal;

/**
 * Every path that differs between `ref` and the WORKING TREE, docs-relative.
 *
 * Two questions, not one, and the second is not optional: `git diff` compares
 * the tree git tracks, so a service adopted five minutes ago — a brand new
 * `services/<id>/spec.md` nobody has committed — is invisible to it. `validate`
 * grades the working tree, so the scope has to be the working tree's, and an
 * untracked new boundary that the run then skipped would be the flag's very
 * first user reporting that it graded nothing.
 *
 * `--no-renames` on purpose: with rename detection on (git's default since
 * 2.9) a service moved into a subsystem reports only its DESTINATION, and the
 * checks that grade the fleet from the old placement would be out of scope.
 * Two paths for a move is the honest answer.
 *
 * `-z` because git quotes non-ASCII and space-bearing paths in line output —
 * the same reason `gitTrackedFiles` asks that way, and the same phantom
 * directory named `"src` if it did not.
 */
async function changedPaths(docsDir: DocsDir, commit: string, prefix: string): Promise<string[] | { detail: string }> {
  // Both run from docsDir. `git diff` ignores cwd and answers for the whole
  // repository with root-relative paths; `git ls-files` restricts itself to
  // cwd, and `--full-name` makes ITS paths root-relative too — so one prefix
  // strip below is correct for both, exactly as `listBaseTree` needs one.
  const tracked = await gitText(docsDir, ["diff", "--name-only", "--no-renames", "-z", commit, "--"]);
  if (tracked.spawnError !== undefined || tracked.code !== 0 || tracked.overflowed) {
    return { detail: tracked.overflowed ? "the changed-path listing exceeded the output cap." : declineDetail(tracked) };
  }
  const untracked = await gitText(docsDir, ["ls-files", "--others", "--exclude-standard", "--full-name", "-z"]);
  if (untracked.spawnError !== undefined || untracked.code !== 0 || untracked.overflowed) {
    return { detail: untracked.overflowed ? "the untracked-path listing exceeded the output cap." : declineDetail(untracked) };
  }
  const seen = new Set<string>();
  for (const raw of [...tracked.out.split("\0"), ...untracked.out.split("\0")]) {
    // A docs repo checked out as a subdirectory of a larger repository answers
    // in the whole repository's paths; anything outside the docs dir is
    // somebody else's change and is not a target here.
    if (raw === "" || !raw.startsWith(prefix)) continue;
    const rel = raw.slice(prefix.length);
    if (rel !== "") seen.add(rel);
  }
  return [...seen].sort();
}

/**
 * Is `path` inside `dir`? Both docs-relative, forward-slashed.
 *
 * A prefix test on the directory plus a separator, never a split on "/" and a
 * read of the second segment: a service filed under a subsystem lives at
 * `services/platform/payment-service/`, not at `services/<id>/`, and a
 * path-splitting implementation drops every filed service out of scope
 * SILENTLY — the run stays green because it graded nothing, which is the exact
 * failure this flag is not allowed to have. The separator is what stops
 * `services/pay` from claiming `services/payments/spec.md`.
 */
function inside(path: string, dir: string): boolean {
  return dir !== "" && (path === dir || path.startsWith(`${dir}/`));
}

/** The fleet's own documents — the landscape target's subject, which owns no service directory. */
const ARCHITECTURE_DIR = "architecture";

/**
 * Narrow a `--all` run to what changed since `ref`.
 *
 * Targets are matched through the ENUMERATIONS' own directories
 * (`ServiceEntry.dir`, `FeatureEntry.dir`), turned docs-relative by the same
 * `repoPath` the JSON contract uses. That is the whole reason the enumerations
 * are passed in rather than re-derived: they already know where each service
 * sits, at whatever depth, and asking them is what makes a filed fleet work.
 */
export async function scopeSince(request: ScopeRequest): Promise<ScopeOutcome> {
  const { docsDir, ref } = request;
  const base = await resolveBase(docsDir, ref);
  if (base.kind === "no-git") {
    return {
      kind: "refused",
      code: "repository-unavailable",
      message:
        `The docs repo at ${docsDir} is not somewhere git can answer from (${base.detail}) — ` +
        `--base narrows the run to what changed since a ref, which it reads with read-only git questions ` +
        `(rev-parse/diff/ls-files). Clone the docs repo with its history, then re-run — or drop --base to grade every target.`,
    };
  }
  if (base.kind === "no-ref") {
    return {
      kind: "refused",
      code: "unknown-target",
      message:
        `--base ${ref} does not resolve to a commit in the docs repo at ${docsDir}` +
        `${base.detail === "" ? "" : ` (${base.detail})`}. ` +
        `Pass a ref that exists there — main, origin/main, a tag or a commit sha — fetching first if it lives on the remote.`,
    };
  }

  const changed = await changedPaths(docsDir, base.commit, base.prefix);
  if (!Array.isArray(changed)) {
    // Git resolved the ref and then would not say what moved. There is no
    // partial answer to give: a scope built from half an answer grades a
    // subset nobody chose and reports it as the branch's whole footprint.
    return {
      kind: "refused",
      code: "repository-unavailable",
      message:
        `git could not list what changed since ${ref} in the docs repo at ${docsDir} (${changed.detail}) — ` +
        `without that list there is no honest scope, and a run over a guessed subset would report a green ` +
        `for targets nobody graded. Re-run once git can answer, or drop --base to grade every target.`,
    };
  }

  const dirOf = (abs: string): string => repoPath(docsDir, abs);
  return {
    kind: "scope",
    ref,
    commit: base.commit,
    // `architecture/` is the landscape target's whole directory: the fleet map,
    // the permission/capability/obligation vocabularies and the fleet ADRs all
    // live there, and every one of them is graded by the landscape target
    // rather than by any service.
    landscape: changed.some((path) => inside(path, ARCHITECTURE_DIR)),
    services: request.services.filter((svc) => changed.some((path) => inside(path, dirOf(svc.dir)))),
    features: request.features.filter((feat) => changed.some((path) => inside(path, dirOf(feat.dir)))),
    totals: { services: request.services.length, features: request.features.length },
  };
}

/**
 * The `scope` object the `--json` payload carries — the run saying out loud
 * what it looked at.
 *
 * Additive, and emitted only under `--base`, so no consumer of today's payload
 * moves. It exists because the alternative is a payload that is byte-shaped
 * like a whole-fleet run and is not one: `summary.services` would report two
 * where the fleet has twelve, `valid: true` would read as a claim about the
 * fleet, and nothing in the document would say otherwise.
 */
export function scopeJson(scope: ValidateScope): Record<string, unknown> {
  return {
    base: scope.ref,
    commit: scope.commit,
    landscape: scope.landscape,
    services: scope.services.map((svc) => svc.id),
    features: scope.features.map((feat) => feat.id),
    totals: scope.totals,
  };
}

/**
 * The one line both the text view and a reader of a CI log need: how much of
 * the fleet this run actually graded, and against what.
 *
 * The "nothing was graded" clause is the load-bearing half. A `--base` run with
 * no targets in scope has nothing to report and exits 0 — correctly, the branch
 * touched no governed boundary — and a 0 that reads like a green over the
 * system is the exact failure the docs-repo readiness gate exists to prevent.
 * So the sentence says it, rather than letting an empty report say nothing.
 */
export function scopeLine(scope: ValidateScope): string {
  const graded = scope.services.length + scope.features.length + (scope.landscape ? 1 : 0);
  return (
    `${scope.services.length} of ${scope.totals.services} services, ` +
    `${scope.features.length} of ${scope.totals.features} features in scope since ${scope.ref}` +
    (scope.landscape ? ", plus the landscape" : "") +
    (graded === 0 ? " — nothing was graded" : "")
  );
}
