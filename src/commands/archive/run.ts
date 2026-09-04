/**
 * The archive itself, under the docs lock: gate, plan, commit.
 *
 * The order is the command's whole safety property. Every refusal happens before
 * a byte is planned (`./plan/gate.ts`), the plan is computed entirely in memory
 * so a failure on any axis leaves the living docs untouched (`./plan/specs.ts`,
 * `./plan/contracts/`, `./plan/landscape.ts`), and only a plan that succeeded
 * on every axis is staged
 * and swapped. `--dry-run` returns between the second and the third.
 */
import { existsSync } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import { emitJson, repoPath, sayExplain } from "../../core/envelope/json.js";
import {
  message,
  quietPruneEmptyParents,
  quietRm,
  rollbackError,
  rollbackStaged,
  stageWrites,
  swapStaged,
} from "../../core/staging/commit.js";
import { clearCommitIntent, writeCommitIntent } from "../../core/staging/recovery/intent.js";
import {
  SNAPSHOT_DIR,
  SnapshotClobberError,
  snapshotDir,
  writeSnapshot,
  type ServiceKey,
} from "../../core/staging/snapshot.js";
import { enumeratedServices } from "../../core/repo/service-target.js";
import { listFleetTree } from "../../core/repo/repo.js";
import { subsystemViewsPath } from "../../core/repo/paths.js";
import { viewsState } from "../../core/repo/tree/render/stale.js";
import { loadArchitecture } from "../../core/c4/project/architecture.js";
import { FleetContext } from "../../core/fleet-context.js";
import { gate } from "./plan/gate.js";
import { type ArchiveOptions } from "./plan/refusal.js";
import { planCapabilities, planGlossary, planSpecs } from "./plan/specs.js";
import { planOpenapiContracts } from "./plan/contracts/openapi.js";
import { planAsyncapiContracts } from "./plan/contracts/asyncapi.js";
import { planDeployments, planFlows, planLandscape } from "./plan/landscape.js";
import { emptyPlan } from "./plan/state.js";
import { issueJson, refuseJson } from "./plan/refusal.js";
import { ArchiveFailure } from "./plan/refusal.js";
import { printPlan } from "./plan/refusal.js";
import type { DocsDir } from "../../core/kernel/ids/dirs.js";

export async function archiveLocked(
  config: { docsDir: DocsDir },
  featureId: string,
  opts: ArchiveOptions,
): Promise<void> {
  const dryRun = opts.dryRun === true;
  const json = opts.json === true;
  // All prose goes through here so `--json` keeps stdout a single JSON document.
  const say = (line = ""): void => {
    if (!json) console.log(line);
  };

  // One read index for the whole run, threaded through every planner's
  // config record: gate, the spec merge and both contract merges each hold
  // per-service loops that resolve living paths through the enumeration, and
  // without a shared context every one of those calls re-walks the fleet —
  // O(services²) work under a lock that guarantees the tree is not moving.
  // The snapshot resolver below reads through the same context, so it pays
  // for that enumeration too.
  const read = { docsDir: config.docsDir, fleet: new FleetContext() };
  const gated = await gate(read, featureId, opts, say);
  if (gated === null) return;
  const { id, dirName, featureDir, gating, advisory, archiveDir, archiveDest, recovered, issues } = gated;

  say(`archive ${id}${dryRun ? "  (dry run)" : ""}\n`);

  // PLAN — compute every merge in memory. Nothing is written until the whole plan
  // succeeds, so a failure on any axis leaves the living docs untouched.
  const planned = emptyPlan();
  await planSpecs(read, gated, planned, say);
  // The business corpus, beside the service one and before the contracts: both
  // are requirement merges, and reading them together is how a plan stays
  // legible as "what this feature promises" followed by "how it is built".
  await planCapabilities(read, gated, planned, say);
  // The vocabulary the change brings with it, beside the promises it makes:
  // a create-only whole-file copy, refused at the gate if the word already
  // lives (`core/glossary/delta.ts`).
  await planGlossary(read, gated, planned, say);
  await planOpenapiContracts(read, gated, planned, say);
  await planAsyncapiContracts(read, gated, planned, say);
  // `read`, not `config`: the C4 merge now asks which services own their own
  // interior, and that answer comes from the fleet enumeration this run has
  // already paid for.
  await planLandscape(read, gated, planned, say);
  // The flows this feature brings, after the elements they draw hops over: the
  // copy is create-only and refused at the gate if the living tree already holds
  // one (`core/usecases/delta/flows.ts`), and it is ordered after the landscape
  // merge so a reader of the plan sees the map change before the sequence drawn
  // on it.
  await planFlows(config, gated, planned, say);
  await planDeployments(config, gated, planned, say);
  const { writes, planWarns, planGates, openapiRemovals, asyncapiRemovals } = planned;

  // Gate on what only the plan could see: a merged operation pointing at a
  // component that exists nowhere, a removal marker addressing no operation.
  // Same doctrine as the coherence gate — a judgment call --approve overrides
  // (unlike the mechanical merge-failed refusals), and a dry run is gated too.
  // Checked after the whole plan so the refusal costs nothing: no write has
  // happened yet either way.
  if (planGates.length > 0 && !opts.approve) {
    const msg = `archive ${id} — BLOCKED: ${planGates.length} issue(s) in the contract merge`;
    if (json) {
      refuseJson(
        "not-coherent",
        msg,
        [...issues, ...planWarns, ...planGates],
        `features/${dirName}`,
      );
      return;
    }
    console.error(`${msg}:`);
    for (const i of planGates) console.error(`  ✗ ${i.message}`);
    console.error(`\nFix them in the feature's openapi.yaml / asyncapi.yaml — or re-run with --approve to merge anyway.`);
    sayExplain("not-coherent");
    process.exitCode = 1;
    return;
  }
  if (planGates.length > 0) {
    say(`\n  ⚠ archiving despite ${planGates.length} contract merge issue(s) (--approve):`);
    for (const i of planGates) say(`      ✗ ${i.message}`);
  }

  // The plan as data, verb decided now — after the commit everything would read
  // as an update. The `--json` payload is identical for a dry run and the real
  // thing except for `archived`; what WOULD happen is what DOES happen.
  const warnings = [...advisory, ...planWarns];
  const overridden = opts.approve === true ? [...gating, ...planGates] : [];
  const plan: Array<Record<string, unknown>> = writes.map((w) => ({
    path: repoPath(config.docsDir, w.path),
    action: existsSync(w.path) ? "update" : "create",
  }));
  plan.push({ path: `features/${dirName}`, action: "move", to: `features/archive/${dirName}` });
  const payload = (archived: boolean): Record<string, unknown> => ({
    command: "archive",
    feature: id,
    archived,
    path: repoPath(config.docsDir, archiveDest),
    plan,
    warnings: warnings.map((issue) => issueJson(issue, repoPath(config.docsDir, archiveDest))),
    overridden: overridden.map((issue) => issueJson(issue, repoPath(config.docsDir, archiveDest))),
    openapiRemovals,
    asyncapiRemovals,
    // Present only when this run found an interrupted commit and dealt with it:
    // an agent that sees the docs change under it deserves to be told why, and
    // the absent field is the ordinary case.
    ...(recovered === null ? {} : { recovered }),
  });

  if (dryRun) {
    if (json) emitJson(payload(false));
    else printPlan(config.docsDir, writes, dirName);
    return;
  }

  // COMMIT — the whole plan computed cleanly. Stage every new version beside its
  // target, snapshot what is about to be overwritten, then swap them into place.
  // Staging touches the filesystem — a read-only `architecture/`, a full disk,
  // a target whose pre-image cannot be read. None of that is a bug in loam, and
  // reporting `internal` sends the reader looking for one; it is the same
  // answer as any other merge that could not be computed: nothing was written.
  let staged;
  try {
    staged = await stageWrites(writes);
  } catch (err) {
    throw new ArchiveFailure("merge-failed", `${message(err)} — nothing was written`);
  }
  let snapshot = false;
  let createdArchiveDir: string | undefined;
  try {
    // The snapshot's resolver pair: how a docs-relative path decomposes into a
    // service identity, and where that identity lives NOW. Built here — the
    // command layer's view of the tree — and injected, so the snapshot module
    // never learns the repo layout. The seam the flat wave left is now
    // threaded: both answers come from the enumeration, so a service filed
    // into a subsystem keys its snapshot rows by the directory it actually
    // lives in, and the clobber guard grades a leftover claim at that same
    // address. The root-level parse stays as the fallback for the one path
    // shape the enumeration cannot know yet — a service this archive CREATES,
    // which always materialises unfiled at services/<id>/.
    // Tolerant on purpose: a docs repo whose services/ is absent still
    // archives a landscape-only feature exactly as before — the enumeration
    // is empty, every row keys by the flat fallback, and the missing
    // directory stays doctor's diagnosis rather than a merge-failed here.
    const dirOf = new Map(
      (await enumeratedServices(config.docsDir, read.fleet)).map((s) => [s.id as string, repoPath(config.docsDir, s.dir)]),
    );
    const serviceKeyOf = (rel: string): ServiceKey | null => {
      for (const [service, dir] of dirOf) {
        if (rel.startsWith(`${dir}/`)) return { service, artifact: rel.slice(dir.length + 1) };
      }
      const m = /^services\/([^/]+)\/(.+)$/.exec(rel);
      return m ? { service: m[1]!, artifact: m[2]! } : null;
    };
    const serviceDirOf = (service: string): string | null => dirOf.get(service) ?? null;
    await writeSnapshot({
      featureDir,
      docsDir: config.docsDir,
      feature: { featureId: id, dirName },
      staged,
      serviceKeyOf,
      serviceDirOf,
    });
    snapshot = true;
    // The journal, fsynced, BEFORE the first rename: swapStaged is N renames and
    // only each one of them is atomic, so a kill between two used to leave a
    // half-merged repo that nothing could name — `doctor` and `status` called it
    // healthy and `validate --all` blamed the delta. Written from `staged`, so
    // it records the same digests the swaps are about to produce.
    await writeCommitIntent(
      config.docsDir,
      { command: "archive", restore: "before", feature: id, moveFrom: featureDir, moveTo: archiveDest },
      staged,
    );
    await swapStaged(staged);
    createdArchiveDir = await mkdir(archiveDir, { recursive: true });
    await rename(featureDir, archiveDest);
    // Last: while it exists, the commit is in flight.
    await clearCommitIntent(config.docsDir);
  } catch (err) {
    if (err instanceof SnapshotClobberError) {
      // Nothing swapped — the refusal happens before the journal is even
      // written — so this only takes the temp files away. Its own code, because
      // the answer is not "re-run": a previous archive of this feature is still
      // sitting in the living docs.
      await rollbackStaged(staged);
      throw new ArchiveFailure("commit-interrupted", err.message);
    }
    // Everything this run made, unmade: the swapped files, the snapshot inside the
    // feature that is staying put, and features/archive/ if we are the ones who
    // created it (mkdir reports nothing when it was already there).
    const failures = await rollbackStaged(staged);
    // The rollback decided the outcome, so the journal has nothing left to
    // describe — including on rollback-incomplete, where the files it names are
    // the ones the message tells a human to look at.
    await clearCommitIntent(config.docsDir);
    // The snapshot goes only when the rollback HELD. On rollback-incomplete it
    // holds the only on-disk pre-images of the very files the message tells the
    // reader to repair by hand — a MODIFIED requirement's previous text appears
    // nowhere else. Retaining it is safe: the next archive of this feature reads
    // it before it would replace it, and refuses if the living docs have moved.
    if (snapshot && failures.length === 0) await quietRm(snapshotDir(featureDir));
    // `features/archive/` is shared the moment it exists: another archive can
    // have moved a whole feature into it between our mkdir and this rollback,
    // and a recursive remove of "the directory we created" took that feature —
    // snapshot and all — with it, on OUR failure path, in silence. Empty
    // directories only, stopping at the first that is not.
    if (createdArchiveDir !== undefined) await quietPruneEmptyParents(archiveDir, createdArchiveDir);
    // The code is a caller's answer to "can I trust the repo?": merge-failed
    // means yes (rolled back), rollback-incomplete means look at it by hand.
    const wrapped = rollbackError(err, failures);
    const kept =
      snapshot && failures.length > 0
        ? ` Pre-images of the overwritten files are kept in features/${dirName}/${SNAPSHOT_DIR}/files/.`
        : "";
    throw new ArchiveFailure(failures.length > 0 ? "rollback-incomplete" : "merge-failed", wrapped.message + kept);
  }

  // This merge just changed the map, and the generated views file is a
  // function of the tree AND the map: a delta whose element lands inside a
  // group that exactly covered a subsystem takes that subsystem's boundary
  // line away, and a delta binding an element to a filed service adds an
  // include. Archive does not rewrite the file — `loam subsystem sync` owns it
  // outright, and folding a second generated artifact into this transaction
  // would mean archive computing the post-merge tree AND the post-merge map,
  // which is how the two writers disagree — but it must not report a repo as
  // current when the next `validate --all` will call it stale. Graded through
  // validate's own function, so the two cannot answer differently.
  const staleViews = await subsystemViewsStale(config.docsDir);

  if (json) {
    emitJson({ ...payload(true), ...(staleViews ? { subsystemViewsStale: true } : {}) });
    return;
  }
  console.log(`\n  archived: features/${dirName} → features/archive/${dirName}`);
  console.log(`  snapshot: features/archive/${dirName}/${SNAPSHOT_DIR}/ — \`loam unarchive ${id}\` puts it back`);
  // The closing line is a claim about the whole docs repo, and it is the line a
  // reader stops at. It may be printed only when this archive left nothing the
  // next `validate --all` will fail on — a service with no model, or a gate the
  // caller told it to merge past. Printing it over either is how a red fleet
  // gets reported as a finished one.
  const incomplete = planWarns.filter((w) => w.code === "service.no-model");
  if (incomplete.length === 0 && overridden.length === 0 && !staleViews) {
    console.log("  living spec + landscape are now complete + current.");
    return;
  }
  if (staleViews) {
    console.log(
      "  ⚠ architecture/subsystems.likec4 no longer matches the tree and this map — run `loam subsystem sync`.",
    );
  }
  for (const w of incomplete) console.log(`  ⚠ ${w.message}`);
  if (overridden.length > 0) {
    console.log(
      `  ⚠ merged past ${overridden.length} gating issue(s) with --approve — the living docs carry them now; \`loam validate --all\` says what they cost.`,
    );
  }
}

/**
 * Would the next `validate --all` report `subsystem.views-stale`?
 *
 * Asked through validate's OWN function rather than a second compare, so the
 * warning archive prints and the error validate raises can never disagree —
 * including about the gate validate holds: a map that does not parse is
 * `landscape.invalid`'s business, and grading a generated file against a map
 * nobody can read would cascade a second complaint behind the first. An
 * unreadable map therefore answers "no claim", exactly as validate does.
 */
async function subsystemViewsStale(docsDir: DocsDir): Promise<boolean> {
  try {
    const doc = await loadArchitecture(docsDir);
    if (doc.errors.length > 0) return false;
    const state = await viewsState(subsystemViewsPath(docsDir), await listFleetTree(docsDir), doc);
    return !state.agrees;
  } catch {
    // Tolerant for the reason the snapshot resolver above is: a docs repo with
    // no `services/` at all still archives a landscape-only feature, and this
    // question is an ADVISORY printed after a commit that already succeeded.
    // Nothing here may turn a landed archive into a non-zero exit.
    return false;
  }
}
