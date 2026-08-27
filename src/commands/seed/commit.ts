/**
 * Seed's commit window: lock, recover, the under-lock provenance and
 * fleet-consistency checks, one journaled transaction. Modeled line for line
 * on commands/new/commit.ts and on the same seam: everything in here holds
 * the docs lock, nothing outside it does, and the module prints nothing —
 * the caller renders every arm.
 *
 * The checks live UNDER the lock on purpose: the never-overwrite promise is a
 * statement about the landscape as it is at the moment of the write, and an
 * unlocked classification would be a TOCTOU against every other docs writer.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { FleetSeed } from "../../core/c4/seed/fleet-file.js";
import { landscapeProvenance } from "../../core/c4/seed/stamp.js";
import { isLandscapeStub } from "../../core/scaffold/landscape.js";
import type { DocsDir } from "../../core/kernel/ids/dirs.js";
import { parseServiceId } from "../../core/kernel/ids/service.js";
import { landscapePath } from "../../core/repo/paths.js";
import { listFleetTree } from "../../core/repo/repo.js";
import { DocsRepoUnavailableError } from "../../core/repo/state.js";
import type { FleetTree } from "../../core/repo/tree/walk.js";
import { stageWrites } from "../../core/staging/commit.js";
import { type CommitRecovery, InterruptedCommitError } from "../../core/staging/interrupted.js";
import { acquireDocsLockWaiting, DocsBusyError, LOCK_WAIT_MS } from "../../core/staging/lock.js";
import { recoverInterruptedCommit } from "../../core/staging/recovery/recover.js";
import { commitStaged } from "../../core/staging/txn/transaction.js";
import { planSeedWrites, type SeedPlanInput } from "./plan.js";

/** The plan's input, plus the one fact only the transaction needs. */
export interface SeedCommitRequest extends SeedPlanInput {
  /** How a human re-runs this command — the transaction journal's `rerun`. */
  rerun: string;
}

/** What happened to architecture/landscape.likec4 — the three writes seed may prove safe. */
export type LandscapeDisposition = "created" | "replaced-stub" | "regenerated";

export type SeedCommit =
  | {
      ok: true;
      landscape: LandscapeDisposition;
      /** Absolute path of every file the transaction wrote, in write order. */
      written: string[];
      /**
       * Absolute path of every file the transaction REMOVED — only ever the
       * generated views file, when the resulting tree has no subsystems left
       * to view. Separate from `written` because "+ path" is a lie about a
       * delete.
       */
      removed: string[];
      /** Service ids split by whether this run created the directory. */
      services: { created: string[]; existing: string[] };
      recovered: CommitRecovery | null;
    }
  | {
      ok: false;
      code:
        | "docs-busy"
        | "commit-interrupted"
        | "merge-failed"
        | "rollback-incomplete"
        | "seed-landscape-edited";
      message: string;
    }
  /** The under-lock fleet-consistency preflight refusing; see `missingServices`. */
  | { ok: false; code: "seed-file-invalid"; message: string; missingServices: string[] }
  /** The docs repo went away between the command's gate and the locked read — new/commit.ts says why this is not a `code:` arm. */
  | { ok: false; repoGone: DocsRepoUnavailableError };

export async function commitSeed(req: SeedCommitRequest): Promise<SeedCommit> {
  const { docsDir } = req;
  let releaseLock: () => Promise<void>;
  try {
    releaseLock = await acquireDocsLockWaiting(docsDir, LOCK_WAIT_MS);
  } catch (err) {
    if (err instanceof DocsBusyError) return { ok: false, code: "docs-busy", message: err.message };
    throw err;
  }
  try {
    let recovered: CommitRecovery | null;
    try {
      recovered = await recoverInterruptedCommit(docsDir);
    } catch (err) {
      if (!(err instanceof InterruptedCommitError)) throw err;
      return { ok: false, code: "commit-interrupted", message: err.message };
    }

    // Provenance first, then the tree: both read the repo as this run will
    // leave it, and both refusals must prove nothing was written.
    const landscape = await classifyLandscape(docsDir);
    if ("refusal" in landscape) {
      return { ok: false, code: "seed-landscape-edited", message: landscape.refusal };
    }

    let tree: FleetTree;
    try {
      tree = await listFleetTree(docsDir);
    } catch (err) {
      if (!(err instanceof DocsRepoUnavailableError)) throw err;
      return { ok: false, repoGone: err };
    }
    const inconsistency = preflight(tree, req.seed);
    if (inconsistency !== null) return inconsistency;

    const plan = await planSeedWrites(req, tree);
    const staged = await stageWrites(plan.writes);
    const committed = await commitStaged(
      { root: docsDir, command: "seed", rerun: req.rerun, target: "landscape" },
      staged,
      "seeded",
    );
    if (!committed.ok) {
      // `committed.raced` is deliberately NOT remapped: the lock serialises
      // loam writers, so a fired CAS or a lost exclusive create here means an
      // out-of-band editor, and seed has no softer race answer the way `new`
      // has already-exists — merge-failed's "nothing was written, re-run" is
      // the honest sentence either way.
      return { ok: false, code: committed.code, message: committed.message };
    }
    return {
      ok: true,
      landscape: landscape.disposition,
      written: plan.writes.filter((w) => w.content !== null).map((w) => w.path),
      removed: plan.writes.filter((w) => w.content === null).map((w) => w.path),
      services: plan.services,
      recovered,
    };
  } finally {
    await releaseLock();
  }
}

/**
 * May seed write the landscape? Absent and untouched-scaffold-stub are the
 * two states with provably no human work in them; a matching stamp digest is
 * the third (`core/c4/seed/stamp.ts`). Everything else refuses.
 */
async function classifyLandscape(
  docsDir: DocsDir,
): Promise<{ disposition: LandscapeDisposition } | { refusal: string }> {
  const path = landscapePath(docsDir);
  if (!existsSync(path)) return { disposition: "created" };
  const text = (await readFile(path)).toString("utf8");
  // `isLandscapeStub`, never a byte-compare of our own: that function IS the
  // repo's answer to "is this still the scaffold's untouched map", it is what
  // `loam status` reads before telling the reader to run seed, and it is
  // suffix-matched and CRLF-normalised for two reasons seed shares —
  // `migrate-openspec` prepends a preamble to the identical stub, and a
  // checkout under `core.autocrlf` (Git for Windows' installer default)
  // rewrites every line without touching a fact. A stricter compare here made
  // status and seed contradict each other about the same file.
  if (isLandscapeStub(text)) return { disposition: "replaced-stub" };
  const provenance = landscapeProvenance(text);
  if (provenance === "seed-stamped") return { disposition: "regenerated" };
  return {
    refusal:
      `architecture/landscape.likec4 ${
        provenance === "seed-edited"
          ? "was seeded but has been hand-edited since — the line-1 stamp's digest no longer matches the content"
          : "was not written by `loam seed`: it carries no line-1 stamp and is not the scaffold's untouched stub"
      }. Seed never overwrites human work; nothing was written. Either fold the edits into ` +
      `fleet.yaml and delete the file, then re-run — or keep the hand-authored map and stop ` +
      `using seed here.`,
  };
}

/**
 * The fleet-consistency preflight. Seed regenerates the landscape WHOLESALE —
 * that is the only posture the stamp can prove safe — so every existing
 * services/<id>/ must be named in fleet.yaml, or the regenerate would orphan
 * it into `landscape.service-unmodelled`. And the file's names must not
 * collide with what the tree already holds under a different kind: one flat
 * namespace, the same rule the walk enforces.
 */
function preflight(tree: FleetTree, seed: FleetSeed): SeedCommit | null {
  const treeSubs = new Set(tree.subsystems.map((s) => s.name));
  const treeIds = new Set(tree.services.map((s) => s.id as string));

  // The collision scan runs BEFORE the missing-service scan, and the order is
  // load-bearing. A name the file declares as a subsystem or an external while
  // the tree holds it as a service DIRECTORY is both facts at once: it is a
  // namespace collision, and it is also an existing service the file does not
  // name. With the missing scan first, the caller was told to paste that name
  // into `services:` — advice that walks straight into `seed-duplicate-service`
  // on the next run, because the file already declares it as something else.
  const collisions: string[] = [];
  for (const sub of seed.subsystems) {
    if (treeIds.has(sub as string)) collisions.push(`subsystem '${sub}' is an existing service directory`);
  }
  for (const s of seed.services) {
    if (treeSubs.has(s.id as string)) collisions.push(`service '${s.id}' is an existing subsystem directory`);
  }
  for (const x of seed.externals) {
    if (treeIds.has(x)) collisions.push(`external '${x}' is an existing service directory`);
    if (treeSubs.has(x)) collisions.push(`external '${x}' is an existing subsystem directory`);
  }
  if (collisions.length > 0) {
    return {
      ok: false,
      code: "seed-file-invalid",
      message:
        `fleet.yaml collides with the services/ tree — service ids, subsystem names and externals ` +
        `share one flat namespace: ${collisions.join("; ")}. Rename the fleet.yaml side (or the ` +
        `directory, with \`loam subsystem rename <from> <to>\`), then re-run. Nothing was written.`,
      missingServices: [],
    };
  }

  const ids = new Set(seed.services.map((s) => s.id as string));
  const missing = tree.services.map((s) => s.id as string).filter((id) => !ids.has(id)).sort();
  if (missing.length === 0) return null;
  // The ids are partitioned because one half cannot take the other's advice.
  // `tree.services` carries RAW ids — a directory whose name fails the service
  // grammar is still a service to the walk, by design — and "add it to
  // services: exactly as spelled" is impossible for one of those: the fleet
  // file would refuse the entry. Without this split, seed was simply unusable
  // on such a repo and never said so.
  const legal = missing.filter((id) => parseServiceId(id, "services entry").ok);
  const illegal = missing.filter((id) => !parseServiceId(id, "services entry").ok);
  const fixes: string[] = [];
  if (legal.length > 0) fixes.push(`add ${legal.join(", ")} to services:, exactly as spelled`);
  if (illegal.length > 0) {
    fixes.push(
      `rename the ${illegal.length === 1 ? "directory" : "directories"} ${illegal.join(", ")} ` +
        `first — ${illegal.length === 1 ? "that name is not a legal service id" : "those names are not legal service ids"}, ` +
        `so no services: entry can name ${illegal.length === 1 ? "it" : "them"}`,
    );
  }
  return {
    ok: false,
    code: "seed-file-invalid",
    message:
      `fleet.yaml must name every existing service — seed regenerates the landscape wholesale, ` +
      `and these services/ directories are not in it: ${missing.join(", ")}. ` +
      `To fix: ${fixes.join("; and ")}. Then re-run. Nothing was written.`,
    missingServices: missing,
  };
}
