import type { Command } from "commander";
import { existsSync } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../core/envelope/config.js";
import { emitJson, emitJsonError, fail, repoPath, reportNoConfig, type ErrorCode } from "../core/envelope/json.js";
import { gatesArchive, type Issue } from "../core/vocabulary/issue.js";
import {
  acquireDocsLock,
  clearCommitIntent,
  DocsBusyError,
  InterruptedCommitError,
  message,
  NotUtf8Error,
  planWrite,
  quietPruneEmptyParents,
  quietRm,
  readUtf8,
  recoverInterruptedCommit,
  rollbackError,
  rollbackStaged,
  snapshotDir,
  SnapshotClobberError,
  stageWrites,
  swapStaged,
  writeCommitIntent,
  writeSnapshot,
  SNAPSHOT_DIR,
  type CommitRecovery,
  type PlannedWrite,
} from "../core/staging.js";
import {
  elementService,
  loadFile,
  loadSource,
  maskSource,
  matchBrace,
  scanModel,
  serviceOf,
  type Elem,
  type Rel,
  type ScannedElement,
  type ScannedModel,
  type ScannedRel,
} from "../core/c4/likec4.js";
import {
  archiveDir as archiveRoot,
  featurePaths,
  featureSpecPaths,
  featureSpecServices,
  landscapePath as landscapeFile,
  missingFeatureMessage,
  resolveFeature,
  servicePaths,
  SPEC_AXES,
} from "../core/repo.js";
import { readOpenapi } from "../core/openapi.js";
import {
  mergeOpenapiPaths,
  OpenapiMergeError,
  stripOpenapiRemovalMarkers,
  type OpenapiMergeResult,
} from "../core/openapi-merge.js";
import { featureCoherence, livingMergeConflicts, unknownDeltaServices } from "../core/coherence.js";
import { findingJson, SEVERITY_MARK, type Finding } from "../core/vocabulary/report.js";
import {
  parseRequirements,
  serializeRequirements,
  applyRequirementDelta,
  isRequirementsHeading,
  sectionHeadings,
  splitRequirementsSection,
  type Requirement,
} from "../core/document/spec.js";

interface ArchiveOptions {
  approve?: boolean;
  dryRun?: boolean;
  json?: boolean;
}

/**
 * A refusal or failure with its stable `--json` code attached. Thrown from the
 * plan phase (nothing written yet) and from the commit's rollback path (whose
 * message says whether the rollback held). Anything ELSE that escapes runArchive
 * is a bug, and the action handler reports it as `internal`.
 */
class ArchiveFailure extends Error {
  constructor(
    readonly code: ErrorCode,
    msg: string,
  ) {
    super(msg);
  }
}

export function registerArchive(program: Command): void {
  program
    .command("archive")
    .argument("<featureId>", "feature id, e.g. FEAT-101")
    .description("Merge a shipped feature's deltas into the living specs + model, then archive it")
    .option("--approve", "archive despite GATING coherence issues (may corrupt the living docs); advisory warnings never block")
    .option("--dry-run", "print the whole merge plan and write nothing")
    .option("--json", "emit the machine contract instead of the human view")
    .action(async (featureId: string, opts: ArchiveOptions) => {
      const json = opts.json === true;
      try {
        await runArchive(featureId, opts);
      } catch (err) {
        // Plan-phase failures happen before any write; commit-phase failures are
        // rolled back by runArchive, which says so in the message it throws.
        // A file loam cannot decode is one it cannot merge, and that is the same
        // answer as any other merge it could not compute: nothing was written.
        fail(json, archiveErrorCode(err), `archive ${featureId} failed: ${message(err)}`);
      }
    });
}

function archiveErrorCode(err: unknown): ErrorCode {
  if (err instanceof ArchiveFailure) return err.code;
  if (err instanceof NotUtf8Error) return "merge-failed";
  // The merge branch wraps its own call and re-throws as merge-failed; the
  // create branch (`stripOpenapiRemovalMarkers`) does not, so one unreadable
  // feature contract answered merge-failed or `internal` depending on whether
  // the service already had a living openapi.yaml. The code answers "can I
  // trust the repo?", and that answer does not turn on which side of the merge
  // the document sat on.
  if (err instanceof OpenapiMergeError) return "merge-failed";
  if (err instanceof InterruptedCommitError) return "commit-interrupted";
  return "internal";
}

/**
 * An Issue as the `--json` envelope spells it — the Finding shape, minus details.
 * `gates` is always present and already resolved: a consumer must not have to
 * re-implement the severity default to know what blocks archive.
 */
function issueJson(i: Issue): Record<string, unknown> {
  return {
    severity: i.severity,
    code: i.code,
    gates: gatesArchive(i),
    ...(i.subject === undefined ? {} : { subject: i.subject }),
    message: i.message,
  };
}

/** The failure envelope plus the issues that caused it, so a caller need not re-run validate. */
function refuseJson(code: ErrorCode, msg: string, issues: Issue[]): void {
  emitJsonError(code, msg, { issues: issues.map(issueJson) });
}

/**
 * The same envelope for a refusal computed from `Finding`s rather than
 * `Issue`s — the plan-time checks whose codes are not coherence's (they belong
 * to the LIVING documents, not to the feature) and so are not `IssueCode`s.
 *
 * `gates: true` is asserted rather than derived: every finding listed in a
 * refusal is a reason archive stopped, which is what the field means. Nothing
 * advisory reaches here.
 */
function refuseFindings(code: ErrorCode, msg: string, findings: Finding[]): void {
  emitJsonError(code, msg, { issues: findings.map((f) => ({ ...findingJson(f), gates: true })) });
}

/**
 * Take the docs repo's advisory lock for the WHOLE plan+commit window, then
 * archive.
 *
 * The window is the point. Two archives that overlap do not fight over a
 * rename: they each read the living landscape, each splice their additions into
 * the bytes they read, and the second write replaces the first — both exit 0,
 * and `validate` stays green over a landscape that is missing one feature's
 * architecture, because a document with fewer elements is not an invalid one.
 * That is the only silent-loss path in loam that a later command cannot even
 * detect, so it is closed at the coarsest possible granularity: one writer per
 * docs repo, refusing rather than queueing, because a CLI that blocks for an
 * unknown time is worse for an agent than one that says `docs-busy`.
 */
async function runArchive(featureId: string, opts: ArchiveOptions): Promise<void> {
  const json = opts.json === true;
  const config = await loadConfig();
  if (!config) {
    reportNoConfig(json);
    return;
  }
  let release: () => Promise<void>;
  try {
    release = await acquireDocsLock(config.docsDir);
  } catch (err) {
    if (err instanceof DocsBusyError) throw new ArchiveFailure("docs-busy", err.message);
    throw err;
  }
  try {
    await archiveLocked(config, featureId, opts);
  } finally {
    await release();
  }
}

async function archiveLocked(
  config: { docsDir: string },
  featureId: string,
  opts: ArchiveOptions,
): Promise<void> {
  const dryRun = opts.dryRun === true;
  const json = opts.json === true;
  // All prose goes through here so `--json` keeps stdout a single JSON document.
  const say = (line = ""): void => {
    if (!json) console.log(line);
  };
  // Before anything is read: a commit that was killed between two renames left
  // the living docs half-written, and every other command in loam would have
  // planned against them as if they were the truth. Under the same lock, so the
  // repair cannot race a writer. It refuses when the half-merged files have been
  // edited since — that is a human's call, not a merge's.
  const recovered = await recoverInterruptedCommit(config.docsDir);
  if (recovered !== null && !json) sayRecovery(recovered);

  const feature = await resolveFeature(config.docsDir, featureId, "exclude");
  if (!feature) {
    fail(json, "unknown-target", await missingFeatureMessage(config.docsDir, featureId));
    return;
  }
  // The raw argument's last appearance: from here on the feature answers only to
  // its canonical id — tags, coherence, and the self-exclusion scans all match
  // on `id`, and `archive FEAT-5-slug` must plan exactly like `archive FEAT-5`.
  const { id, dirName, dir: featureDir } = feature;

  // Parse delta.likec4 ONCE for the whole run: the coherence gate and the
  // architecture merge below read the same file, and loading it spins up a
  // fresh Langium workspace each time. Nothing writes it in between.
  const deltaLikec4 = featurePaths(featureDir).delta;
  const deltaDoc = existsSync(deltaLikec4) ? await loadFile(deltaLikec4) : undefined;

  const deltaServices = await featureSpecServices(featureDir);

  // Git conflict markers in a LIVING document this merge would rewrite, before
  // anything else is asked of it. Both sides of somebody's merge are in the
  // file, so nothing it says is anyone's text — and the requirements rewrite
  // deletes whichever marker lines fall inside the section it owns, turning a
  // conflict anyone can see into a file nobody can tell is wrong. Checked ahead
  // of the coherence gate for `inspectLandscape`'s reason: a conflicted
  // document parses, so every verdict downstream of it is an opinion about half
  // of two people's work.
  //
  // --approve does not apply, exactly as with the strayed-requirement refusal
  // below: --approve overrides judgments about the FEATURE, and this is a fact
  // about the living document.
  const conflicted = await livingMergeConflicts(config.docsDir, deltaServices);
  if (conflicted.length > 0) {
    const msg = `archive ${id} — BLOCKED: ${conflicted.length} living document(s) still hold git conflict markers`;
    if (json) {
      refuseFindings("merge-failed", msg, conflicted);
      return;
    }
    console.error(`${msg}:`);
    for (const f of conflicted) console.error(`  ✗ ${f.message}`);
    console.error(`\n--approve does not override this — the loss is mechanical, not a judgment call.`);
    process.exitCode = 1;
    return;
  }

  // Gate: GATING issues block the archive. Severity and gating are two
  // different questions (issue.ts): errors gate because the merge would write
  // something wrong, and the rare warning marked `gates` blocks too — the
  // document is legal but the merge would drop authored content. Advisory
  // warnings are printed (and carried into --json) but never block, matching
  // validate's own doctrine (report.ts: "warnings never gate"). --approve
  // overrides the gating issues ONLY, and must say exactly which ones it is
  // walking past. A dry run is gated too: a plan for a merge that would be
  // refused describes nothing that will happen.
  const issues = await featureCoherence(config.docsDir, featureDir, id, deltaDoc);
  const gating = issues.filter(gatesArchive);
  const advisory = issues.filter((i) => !gatesArchive(i));
  if (gating.length > 0 && !opts.approve) {
    const msg = `archive ${id} — BLOCKED: not coherent (${gating.length} gating issue(s), ${advisory.length} advisory warning(s))`;
    if (json) {
      refuseJson("not-coherent", msg, issues);
      return;
    }
    console.error(`${msg}:`);
    for (const i of issues) console.error(`  ${SEVERITY_MARK[i.severity]} ${i.message}`);
    console.error(`\nFix the gating issues (advisory warnings never block), or re-run with --approve to override them (may corrupt the living docs).`);
    process.exitCode = 1;
    return;
  }
  if (gating.length > 0) {
    say(`⚠ archiving despite ${gating.length} gating issue(s) (--approve):`);
    for (const i of gating) say(`  ${SEVERITY_MARK[i.severity]} ${i.message}`);
    say();
  }
  if (advisory.length > 0) {
    say(`⚠ ${advisory.length} warning(s) (non-blocking):`);
    for (const i of advisory) say(`  ⚠ ${i.message}`);
    say();
  }

  // A `specs/<svc>/` addressed to a service that exists nowhere. `validate`
  // graded this and archive did not, which is the half that costs something:
  // `specs/<svc>/` is what the merge MATERIALISES `services/<svc>/` from, so a
  // one-character slip in `--touches` archived at exit 0 and left the fleet a
  // living service nobody meant to adopt. The set comes from coherence.ts's
  // `unknownDeltaServices` — the same function validate reads — so the two
  // gates cannot drift into disagreeing about which ids are real.
  //
  // Gated exactly like a coherence error, --approve included: which service you
  // meant is a judgment about the FEATURE. A feature that genuinely introduces
  // one has a better escape hatch than --approve anyway — tag its element in
  // delta.likec4, which is also what makes the fleet map true afterwards.
  const unknownServices = await unknownDeltaServices(config.docsDir, featureDir, id, deltaDoc);
  if (unknownServices.length > 0 && !opts.approve) {
    const msg = `archive ${id} — BLOCKED: ${unknownServices.length} per-service delta(s) address a service that does not exist`;
    if (json) {
      refuseFindings("not-coherent", msg, unknownServices);
      return;
    }
    console.error(`${msg}:`);
    for (const f of unknownServices) console.error(`  ✗ ${f.message}`);
    console.error(`\nFix the id, or introduce the service in this feature's delta.likec4 — or re-run with --approve to create it anyway.`);
    process.exitCode = 1;
    return;
  }
  if (unknownServices.length > 0) {
    say(`⚠ archiving despite ${unknownServices.length} unknown service(s) (--approve) — this merge creates them:`);
    for (const f of unknownServices) say(`  ✗ ${f.message}`);
    say();
  }

  // A LIVING requirement outside `## Requirements` is a merge loam cannot do
  // correctly: the rewrite replaces only the requirements RUN inside that
  // section (rewriteRequirementsRun) while parseRequirements collects from
  // every section — so the strayed requirement keeps its authored copy in the
  // preserved prose AND lands again in the rewritten run, and the next
  // archive's MODIFIED replaces only one of them. Refused rather than
  // repaired: excising blocks from prose programmatically would be archive
  // editing text it does not understand. --approve does not apply — it
  // overrides judgments about the FEATURE, and this is neither.
  const strayed: Issue[] = [];
  for (const svc of deltaServices) {
    for (const axis of SPEC_AXES) {
      if (!existsSync(featureSpecPaths(featureDir, svc)[axis.key])) continue;
      const livingPath = servicePaths(config.docsDir, svc)[axis.key];
      if (!existsSync(livingPath)) continue;
      for (const r of parseRequirements(await readUtf8(livingPath))) {
        // The ONE definition of the heading (spec.ts): the guard and the rewrite
        // boundary match the same way, so they cannot disagree about "outside".
        if (r.section !== undefined && isRequirementsHeading(r.section)) continue;
        const where = r.section === undefined ? "above every heading" : `under '${r.section}'`;
        strayed.push({
          severity: "error",
          code: "living.requirement-outside-requirements",
          subject: svc,
          message: `${svc}: living requirement '${r.name}' sits ${where} in ${repoPath(config.docsDir, livingPath)} — the merge rewrites only '## Requirements', so it would land in the file twice. Re-home it under '## Requirements' first, then re-run.`,
        });
      }
    }
  }
  if (strayed.length > 0) {
    const msg = `archive ${id} — BLOCKED: ${strayed.length} living requirement(s) outside '## Requirements'`;
    if (json) {
      refuseJson("living-outside-requirements", msg, strayed);
      return;
    }
    console.error(`${msg}:`);
    for (const i of strayed) console.error(`  ✗ ${i.message}`);
    console.error(`\n--approve does not override this — the duplication is mechanical, not a judgment call.`);
    process.exitCode = 1;
    return;
  }

  // Pre-flight: the archive destination must be free, or the final move would fail
  // after the living docs were already rewritten.
  const archiveDir = archiveRoot(config.docsDir);
  const archiveDest = join(archiveDir, dirName);
  if (existsSync(archiveDest)) {
    fail(json, "archive-exists", `archive ${id} — BLOCKED: features/archive/${dirName} already exists. Remove or rename it, then re-run.`);
    return;
  }

  say(`archive ${id}${dryRun ? "  (dry run)" : ""}\n`);

  // PLAN — compute every merge in memory. Nothing is written until the whole plan
  // succeeds, so a failure on any axis leaves the living docs untouched.
  const writes: PlannedWrite[] = [];
  // Warnings born in the plan itself (openapi.op-modified,
  // openapi.component-modified) — printed with the plan and carried into the
  // --json envelope beside the coherence warnings.
  const planWarns: Issue[] = [];
  // Gating issues born in the plan itself (openapi.ref-unresolved). The gate
  // ran before the plan, but only the computed merge can see these; they block
  // the same way, and --approve overrides them the same way.
  const planGates: Issue[] = [];
  const openapiRemovals: Array<{ service: string; operations: string[] }> = [];
  /** Services this feature introduces on the architecture axis alone — filled by the landscape merge below. */
  const architectureServices = new Set<string>();

  // 1. Requirements merge — apply ADDED/MODIFIED/REMOVED into each living service
  // spec. ONE code path for the pair of requirement-carrying files: the business
  // spec.md and the architecture arch.spec.md ride the same delta algebra, the
  // same prose-preserving rewrite and the same guards, parameterized by filename
  // (SPEC_AXES) — a fork here would be two places the merge could disagree.
  for (const svc of deltaServices) {
    for (const axis of SPEC_AXES) {
      const deltaPath = featureSpecPaths(featureDir, svc)[axis.key];
      if (!existsSync(deltaPath)) continue;
      const deltaReqs = parseRequirements(await readUtf8(deltaPath));

      const livingPath = servicePaths(config.docsDir, svc)[axis.key];
      if (!existsSync(livingPath)) {
        // New service (or first arch spec) — create the living file from the
        // ADDED/MODIFIED requirements.
        const created = applyRequirementDelta([], deltaReqs);
        if (created.length === 0) {
          say(`  ${axis.label}: ${svc} — nothing to merge (delta leaves no requirements), no living ${axis.file} created`);
          continue;
        }
        const heading = axis.key === "spec" ? svc : `${svc} — architecture`;
        const frontmatter = `---\nservice: ${svc}\nstatus: draft\n---\n\n# ${heading}\n\n`;
        writes.push(planWrite(livingPath, `${frontmatter}## Requirements\n\n${serializeRequirements(created)}`));
        say(`  ${axis.label}: ${svc} — created living ${axis.file} (${created.length} requirement(s))`);
        continue;
      }
      const livingText = await readUtf8(livingPath);
      // TWO `## Requirements` headings would put the rewrite's one-section
      // invariant to a choice it must not make: the run of the first would be
      // rewritten while the second survived verbatim in the tail — and its
      // requirements, collected by parseRequirements, would land in the run TOO.
      // Mechanical, like a model-less landscape, so merge-failed, not --approve.
      const reqHeadings = sectionHeadings(livingText).filter((h) => isRequirementsHeading(h.text));
      if (reqHeadings.length > 1) {
        throw new ArchiveFailure(
          "merge-failed",
          `living ${axis.file} for ${svc} has ${reqHeadings.length} '## Requirements' headings (lines ${reqHeadings.map((h) => h.line).join(", ")}) — the merge rewrites ONE requirements section and cannot choose; merge them into one, then re-run`,
        );
      }
      const merged = applyRequirementDelta(parseRequirements(livingText), deltaReqs);
      writes.push(planWrite(livingPath, rewriteRequirementsRun(livingText, merged)));

      const c = summarize(deltaReqs);
      say(`  ${axis.label}: ${svc} ← +${c.ADDED} ~${c.MODIFIED} -${c.REMOVED} (now ${merged.length} total)`);
    }
  }

  // 1b. OpenAPI merge — fold the feature's openapi deltas into the living service APIs.
  for (const svc of deltaServices) {
    const featOpenapi = featureSpecPaths(featureDir, svc).openapi;
    if (!existsSync(featOpenapi)) continue;
    const featText = await readUtf8(featOpenapi);
    const livingOpenapi = servicePaths(config.docsDir, svc).openapi;
    const featDoc = await readOpenapi(featOpenapi);
    // Every other reader of this flag suspends its own judgement when it is set
    // — validate grades `openapi.invalid`, show and status print that the file
    // does not parse. Archive was the only one that never looked, and it is the
    // command that WRITES: a feature openapi.yaml holding a sequence instead of
    // a mapping was planned verbatim into services/<svc>/openapi.yaml, `ok:
    // true`, printing `created ()` because the reader saw no operations in it.
    // A document loam cannot read is one it cannot merge, and that is the same
    // answer as any other merge it could not compute: nothing is written.
    if (featDoc.unreadable) {
      throw new ArchiveFailure(
        "merge-failed",
        `feature openapi ${repoPath(config.docsDir, featOpenapi)} for ${svc} does not read as an OpenAPI document (${featDoc.error ?? "not a YAML mapping"}) — the API axis cannot be merged; fix the file, or delete it if this feature has no contract delta`,
      );
    }
    const ops = featDoc.ops.filter((op) => !op.remove).map((op) => op.id);
    // An `x-loam-remove: true` written at PATH level retires nothing: the marker
    // addresses one operation, and beside the methods there is no operation for
    // it to address. The merge now strips it on every branch, so the living
    // contract is safe either way — but the author asked for a removal that will
    // not happen, and silence there is how a retired endpoint stayed live.
    // Gated like the other plan-visible breaches, --approve and all.
    for (const path of featDoc.pathLevelRemovals) {
      planGates.push({
        severity: "error",
        code: "openapi.remove-marker-path-level",
        subject: svc,
        message: `${svc}: '${path}' carries x-loam-remove at PATH level, beside the methods — a removal marker names ONE operation, so this retires nothing and is not a contract key either. Move it inside the operation you are retiring (with its operationId), or delete it.`,
      });
    }
    if (!existsSync(livingOpenapi)) {
      // A removal against a non-existent contract is gated by coherence. Keep
      // the feature-only marker out of living docs even under --approve — and
      // ask the DOCUMENT, not the operation reader: a marker with no
      // operationId is invisible to `operations()`, so gating the strip on
      // "does the reader see a removal" let exactly that marker through into a
      // living contract, published to every consumer of the fleet.
      const content = stripOpenapiRemovalMarkers(featText, svc);
      writes.push(planWrite(livingOpenapi, content));
      say(`  openapi: ${svc} — created (${ops.join(", ")})`);
    } else {
      let merge: OpenapiMergeResult;
      try {
        merge = mergeOpenapiPaths(await readUtf8(livingOpenapi), featText, svc);
      } catch (err) {
        if (err instanceof OpenapiMergeError) throw new ArchiveFailure("merge-failed", err.message);
        throw err;
      }
      const { text, modified, pathItemModified, removed, quoted, componentsModified, unresolved } = merge;
      if (text !== null) {
        writes.push(planWrite(livingOpenapi, text));
        say(`  openapi: ${svc} — merged (${ops.join(", ")})`);
      }
      if (removed.length > 0) {
        openapiRemovals.push({ service: svc, operations: removed });
        for (const label of removed) say(`      - removes ${label}`);
      }
      // Said out loud, because "the plan wrote less than my delta spells" is
      // the one thing a reader cannot infer from a merged file. Not a warning:
      // quoting the contract around your change is correct authoring, and
      // leaving the quote alone is the correct merge.
      for (const label of quoted) say(`      · quotes ${label} — unchanged since it was pinned, left as living has it`);
      for (const label of modified) {
        planWarns.push({
          severity: "warn",
          code: "openapi.op-modified",
          subject: svc,
          message: `${svc}: the delta redefines ${label}, which the living OpenAPI already has — the merge overwrites the living operation wholesale`,
        });
        say(`      ⚠ overwrites ${label} — the living definition differs`);
      }
      for (const label of pathItemModified) {
        planWarns.push({
          severity: "warn",
          code: "openapi.path-item-modified",
          subject: svc,
          message: `${svc}: the delta redefines the path-level key ${label}, which the living OpenAPI already has — the merge overwrites it wholesale, and it applies to EVERY operation on that path, including ones this feature never mentions`,
        });
        say(`      ⚠ overwrites path-level ${label} — the living definition differs`);
      }
      for (const comp of componentsModified) {
        planWarns.push({
          severity: "warn",
          code: "openapi.component-modified",
          subject: svc,
          message: `${svc}: the merged operations carry component '${comp}', which the living OpenAPI already defines differently — the merge overwrites the living component wholesale`,
        });
        say(`      ⚠ overwrites component ${comp} — the living definition differs`);
      }
      for (const u of unresolved) {
        planGates.push({
          severity: "error",
          code: "openapi.ref-unresolved",
          subject: svc,
          message: `${svc}: $ref '${u.ref}' (referenced from ${u.from}) resolves in neither the feature's openapi.yaml nor the living one — the merged document would carry a dangling reference`,
        });
      }
    }
  }

  // 2. Architecture merge — fold the feature's tagged elements/relationships into the living landscape.
  const landscapePath = landscapeFile(config.docsDir);
  if (deltaDoc !== undefined) {
    const delta = deltaDoc;
    if (delta.errors.length > 0) {
      // --approve overrides loam's JUDGMENT about coherence, never its ability to
      // read an axis. Skipping here would silently drop one merge axis in the one
      // command engineered against quiet partial merges — same rule as an
      // unparseable landscape or openapi: the plan stops before anything is written.
      throw new ArchiveFailure(
        "merge-failed",
        `delta.likec4 has ${delta.errors.length} parse error(s) — the architecture axis cannot be merged; fix it (\`loam validate --feature ${id}\`) or delete the file`,
      );
    }
    const newEls = delta.elements.filter((e) => e.tags.includes(id));
    const newRels = delta.relationships.filter((r) => r.tags.includes(id));
    if (existsSync(landscapePath)) {
      const plan = await planLandscapeMerge(landscapePath, deltaLikec4, delta.elements, newEls, newRels, id);
      // A service can arrive on the ARCHITECTURE axis alone: an element this
      // merge ADDS, carrying a `metadata { service }` binding, with no
      // `specs/<svc>/` anywhere in the feature. It is a service the fleet gate
      // will demand a directory for the moment this merge lands, so it owes the
      // same warning as one arriving with a requirement delta — and until it
      // did, the closing "complete + current" line printed over a landscape
      // this very archive had just made red. Read off the ADDED elements, not
      // the tagged ones: an element the living landscape already had is not
      // arriving, and one that is never merged is not there to demand anything.
      for (const e of plan.addedEls) {
        if (e.service !== undefined) architectureServices.add(e.service);
      }
      writes.push(...plan.writes);
      say(`\n  architecture: merged into landscape.likec4 — +${plan.addedEls.length} element(s), +${plan.addedRels.length} relationship(s)`);
      for (const e of plan.addedEls) say(`      + ${e.title} (${e.kind})`);
      for (const r of plan.addedRels) {
        say(`      + ${titleOf(delta.elements, r.source)} -> ${titleOf(delta.elements, r.target)}  "${r.title ?? ""}"`);
      }
    } else {
      say(`\n  architecture: no landscape.likec4 — ${newEls.length} element(s) not merged`);
    }
  }

  // A service this archive BRINGS INTO EXISTENCE arrives without the one file
  // `validate` demands of every service: its own model.likec4. The merge cannot
  // write it — the delta's tagged subtree is a landscape-level box, not a
  // container model, and inventing a plausible one is the kind of quiet fiction
  // the rest of loam exists to prevent — so the archive says so instead, and
  // stops claiming the docs are complete. Non-gating: the feature is coherent
  // and the merge is correct; what is missing is the next step, and refusing
  // here would make onboarding a new service impossible in one command.
  const newServices = [...new Set([...deltaServices, ...architectureServices])].filter(
    (svc) => !existsSync(servicePaths(config.docsDir, svc).dir),
  );
  for (const svc of newServices) {
    // Two shapes of the same debt: a service with a requirement delta gets its
    // directory from this merge, one that arrives only in the landscape gets no
    // directory at all — and `validate --all` fails the second harder
    // (`landscape.service-unmodelled` names the binding with nothing behind it).
    const creates = deltaServices.includes(svc)
      ? `this archive creates services/${svc}/, but nothing writes services/${svc}/model.likec4`
      : `this archive puts '${svc}' in the landscape, but the fleet has no services/${svc}/ at all`;
    planWarns.push({
      severity: "warn",
      code: "service.no-model",
      subject: svc,
      message: `${svc}: ${creates} — 'loam validate --all' will report the service as incomplete until it exists. Run 'loam adopt --service ${svc}' from the service repo, or write the model by hand.`,
    });
  }

  // Gate on what only the plan could see: a merged operation pointing at a
  // component that exists nowhere, a removal marker addressing no operation.
  // Same doctrine as the coherence gate — a judgment call --approve overrides
  // (unlike the mechanical merge-failed refusals), and a dry run is gated too.
  // Checked after the whole plan so the refusal costs nothing: no write has
  // happened yet either way.
  if (planGates.length > 0 && !opts.approve) {
    const msg = `archive ${id} — BLOCKED: ${planGates.length} issue(s) in the OpenAPI merge`;
    if (json) {
      refuseJson("not-coherent", msg, [...issues, ...planWarns, ...planGates]);
      return;
    }
    console.error(`${msg}:`);
    for (const i of planGates) console.error(`  ✗ ${i.message}`);
    console.error(`\nFix them in the feature's openapi.yaml — or re-run with --approve to merge anyway.`);
    process.exitCode = 1;
    return;
  }
  if (planGates.length > 0) {
    say(`\n  ⚠ archiving despite ${planGates.length} OpenAPI merge issue(s) (--approve):`);
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
    feature: id,
    archived,
    path: repoPath(config.docsDir, archiveDest),
    plan,
    warnings: warnings.map(issueJson),
    overridden: overridden.map(issueJson),
    openapiRemovals,
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
    await writeSnapshot(featureDir, config.docsDir, id, dirName, staged);
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

  if (json) {
    emitJson(payload(true));
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
  if (incomplete.length === 0 && overridden.length === 0) {
    console.log("  living spec + landscape are now complete + current.");
    return;
  }
  for (const w of incomplete) console.log(`  ⚠ ${w.message}`);
  if (overridden.length > 0) {
    console.log(
      `  ⚠ merged past ${overridden.length} gating issue(s) with --approve — the living docs carry them now; \`loam validate --all\` says what they cost.`,
    );
  }
}

/**
 * What the recovery did, before this command's own output — a docs repo that
 * changed under the caller is the first thing they have to be told, not a
 * footnote. Shared by archive and unarchive through the same CommitRecovery.
 */
export function sayRecovery(r: CommitRecovery): void {
  const what = `an interrupted \`loam ${r.command} ${r.feature}\``;
  if (r.outcome === "completed") {
    console.log(`⚠ ${what} had in fact finished — cleared its commit record.\n`);
    return;
  }
  if (r.outcome === "consistent") {
    console.log(`⚠ ${what} was rolled back before it wrote anything — cleared its commit record.\n`);
    return;
  }
  // An interrupted archive is UNDONE and an interrupted unarchive is FINISHED —
  // the merged text a restore was replacing is written down nowhere, so there is
  // nothing to go back to. Say which happened; the paths are the same either way.
  const what_ = r.command === "archive" ? "put them back from" : "finished them from";
  console.log(`⚠ ${what} left ${r.repaired.length} file(s) half-written; ${what_} its snapshot:`);
  for (const p of r.repaired) console.log(`  ↩ ${p}`);
  console.log("");
}

/** The full plan, as files: what a dry run shows instead of doing. */
function printPlan(docsDir: string, writes: PlannedWrite[], dirName: string): void {
  console.log(`\n  plan — ${writes.length} file(s):`);
  for (const w of writes) {
    const verb = existsSync(w.path) ? "update" : "create";
    console.log(`    ${verb}  ${repoPath(docsDir, w.path)}`);
  }
  console.log(`    move    features/${dirName} → features/archive/${dirName}`);
  console.log("\n  dry run — nothing was written.");
}

/* ------------------------------------------------------------------ */
/* Merging                                                             */
/* ------------------------------------------------------------------ */

interface LandscapePlan {
  writes: PlannedWrite[];
  addedEls: Elem[];
  addedRels: Rel[];
}

/**
 * Plan the merge of the feature's new elements + relationships into the living
 * landscape's `model { ... }` block (preserving the rest of the file).
 *
 * The additions are SPLICED from delta.likec4 as authored — byte for byte,
 * technology, style, icons, links, metadata, nested children and all — never
 * re-serialized from the parsed model: a rebuild keeps only the fields loam
 * models, and every field it forgets is authored detail destroyed. The one
 * edit on the way over is dropping the feature's own tag — the additions are
 * baseline now (SCHEMA.md documents the drop as why unarchive restores bytes
 * instead of recomputing) — and a construct the strip empties goes with it.
 *
 * Placement is deterministic and SERVICE-GROUPED (the spot* helpers below):
 * a top-level addition lands beside what already belongs to its service, so
 * two concurrent archives touching different services usually splice on
 * different lines and git merges their PRs — the single shared append point
 * every archive used to hit made two concurrent archives conflict BY
 * CONSTRUCTION. A NESTED element lands inside its parent's block — inside the
 * living parent when the landscape already has it, riding verbatim inside the
 * spliced parent when the parent is new from the same delta — never as a flat
 * dotted id at top level, which LikeC4 rejects. The additions carry no marker
 * comment: which archive added what is the git history's to say.
 *
 * Existence is checked semantically against the parsed landscape (by element
 * id/title and by edge identity), so re-archiving is idempotent and title
 * strings appearing elsewhere in the source cause no false skips. Assumes the
 * delta reuses the landscape's element identifiers for existing services. A
 * title match whose two sides are BOTH bound to different services is not an
 * existence hit but a collision, and refuses the archive (see the guard).
 *
 * Splicing is text surgery, so the computed result is PARSED before it is
 * returned: a merged landscape LikeC4 rejects refuses the archive at plan time
 * (merge-failed, nothing written — the unparseable-delta discipline) instead
 * of landing in the living docs.
 */
async function planLandscapeMerge(
  landscapePath: string,
  deltaPath: string,
  deltaElements: Elem[],
  newEls: Elem[],
  newRels: Rel[],
  featureId: string,
): Promise<LandscapePlan> {
  const text = await readUtf8(landscapePath);
  const land = await loadFile(landscapePath);
  if (land.errors.length > 0) {
    throw new ArchiveFailure("merge-failed", `landscape.likec4 has ${land.errors.length} error(s) — fix it before archiving`);
  }
  const haveIds = new Set(land.elements.map((e) => e.id));
  // The title join needs the matched element back, not just membership: the
  // cross-service guard below compares service BINDINGS across the join.
  const byTitle = new Map<string, Elem[]>();
  const seeTitle = (el: Elem): void => {
    byTitle.set(el.title, [...(byTitle.get(el.title) ?? []), el]);
  };
  for (const el of land.elements) seeTitle(el);
  const addedEls: Elem[] = [];
  for (const e of newEls) {
    if (haveIds.has(e.id)) continue;
    const sameTitle = byTitle.get(e.title);
    if (sameTitle !== undefined) {
      // A title match is the id-less fallback join, and skipping on it is only
      // safe when the two sides could be the same box. When both sides carry an
      // explicit `metadata { service }` binding and every binding disagrees,
      // they are provably DIFFERENT services' boxes sharing a title ('API',
      // 'Database') — the skip would silently drop the addition, and any delta
      // edge into it would then refuse the whole archive at the parse net
      // below with a message about nothing. Refuse here instead, at plan time,
      // naming both sides.
      if (e.service !== undefined && sameTitle.every((m) => m.service !== undefined && m.service !== e.service)) {
        const m = sameTitle[0]!;
        throw new ArchiveFailure(
          "merge-failed",
          `the delta's '${e.id}' (bound to service '${e.service}') shares the title '${e.title}' with '${m.id}' (bound to service '${m.service}') — a title join across services would silently drop the addition; ` +
            `retitle one of them, or reuse the id '${m.id}' if they really are the same element`,
        );
      }
      // KNOWN (narrowed by the guard above): with EITHER side unbound the title
      // join stays trusting — the unbound title-fallback is the legal legacy
      // pattern — so a cross-service collision hiding behind an unbound element
      // is still silently skipped here. Scoping titles per service is backlog.
      continue;
    }
    haveIds.add(e.id);
    seeTitle(e);
    addedEls.push(e);
  }

  // Edges are matched by COUNT, not by membership: two edges the model cannot tell
  // apart are still two edges, and dropping the second one silently loses a call
  // the author drew. An edge already in the landscape consumes one delta edge of
  // the same identity, which is what keeps re-archiving idempotent.
  const have = new Map<string, number>();
  for (const r of land.relationships) {
    const k = relKey(land.elements, r);
    have.set(k, (have.get(k) ?? 0) + 1);
  }
  const addedRels: Rel[] = [];
  for (const r of newRels) {
    const k = relKey(deltaElements, r);
    const n = have.get(k) ?? 0;
    if (n > 0) {
      have.set(k, n - 1);
      continue;
    }
    addedRels.push(r);
  }

  if (addedEls.length === 0 && addedRels.length === 0) return { writes: [], addedEls, addedRels };

  const deltaText = await readUtf8(deltaPath);
  const scan = scanModel(deltaText);
  if (scan === null) {
    throw new ArchiveFailure("merge-failed", "delta.likec4 has no model block — nothing to splice the additions from");
  }

  // Everything below either locates a declaration's authored bytes or refuses.
  // `spliced` remembers the delta ranges already carried over, so a child whose
  // parent is itself new is recognised as riding inside the parent's text and
  // is never inserted twice.
  const byId = new Map(scan.elements.map((e) => [e.id, e]));
  const spliced: Array<{ start: number; end: number }> = [];
  const rides = (start: number, end: number): boolean =>
    spliced.some((r) => start >= r.start && end <= r.end);

  // The living model, scanned on MASKED source (scanModel) and RE-SCANNED
  // after every splice: each addition lands in the text exactly as the
  // previous one left it, so an archive of N additions produces the same
  // bytes as N single-addition archives run back to back. Placement then
  // composes per statement — the unit the order-independence argument below
  // is stated in — instead of per archive, where a batch computed against a
  // stale layout could interleave with itself. Masking matters — a `model {`
  // spelled inside a comment or string above the real block must not capture
  // the match, or every top-level addition lands inside the comment (legal
  // LikeC4, so the parse net below would pass a landscape containing none of
  // the architecture).
  let content = text;
  // Service binding for placement: living elements first (they win a shared
  // id), the delta's after — a spliced statement's id resolves to its service
  // the moment its bytes land in the scan.
  const bindEls = [...land.elements, ...deltaElements.filter((d) => !land.elements.some((l) => l.id === d.id))];
  let livingScan = scanModel(content);
  let stmts = livingScan === null ? [] : topStatements(livingScan, bindEls);
  const rescan = (): void => {
    livingScan = scanModel(content);
    stmts = livingScan === null ? [] : topStatements(livingScan, bindEls);
  };
  const requireModel = (): ScannedModel => {
    if (livingScan === null) throw new ArchiveFailure("merge-failed", "landscape.likec4 has no model block");
    return livingScan;
  };
  const applyAt = (at: number, insert: string): void => {
    content = content.slice(0, at) + insert + content.slice(at);
    rescan();
  };
  const applyTop = (spot: Spot, block: string): void => {
    // A bare spot shares its line with other text (the closing brace, or a
    // statement the block displaces) — it brings its own newlines; a
    // line-start spot slots between lines.
    applyAt(spot.at, spot.bare ? `\n${block}\n` : `${block}\n`);
  };

  // Placement walks the scanned statement layout, so a declaration the scan
  // cannot see is one placement would blindly splice around — LikeC4 accepts
  // two declarations on one line, but scanModel's statement head runs to the
  // end of the line, so the second rides invisibly inside the first: an
  // element bound to its service would miss its neighborhood, and a bodyless
  // parent gaining a body could wrap the wrong declaration. Refuse
  // mechanically (the parse-net discipline) instead of splicing blind.
  if (livingScan !== null) {
    const seen = new Set(livingScan.elements.map((e) => e.id));
    const invisible = land.elements.find((e) => !seen.has(e.id));
    if (invisible !== undefined) {
      throw new ArchiveFailure(
        "merge-failed",
        `landscape.likec4 declares '${invisible.id}' in a form placement cannot locate — most often two declarations sharing one line; give each its own line, then re-run`,
      );
    }
    if (livingScan.rels.length < land.relationships.length) {
      throw new ArchiveFailure(
        "merge-failed",
        `landscape.likec4 declares ${land.relationships.length} relationship(s) but placement can locate only ${livingScan.rels.length} — most often two statements sharing one line; give each its own line, then re-run`,
      );
    }
  }

  const livingParentOf = (parentId: string): ScannedElement | null => {
    if (livingScan === null) return null;
    const direct = livingScan.elements.find((e) => e.id === parentId);
    if (direct !== undefined) return direct;
    // The delta may spell an existing element under its own id; the title is
    // the stable cross-namespace name (the same rule the existence check uses).
    const title = deltaElements.find((e) => e.id === parentId)?.title;
    const livingId = title === undefined ? undefined : land.elements.find((e) => e.title === title)?.id;
    if (livingId === undefined) return null;
    return livingScan.elements.find((e) => e.id === livingId) ?? null;
  };

  // Ancestors first: a spliced parent covers its children before they are seen.
  const depth = (id: string): number => id.split(".").length;
  const sortedEls = [...addedEls].sort(
    (a, b) => depth(a.id) - depth(b.id) || (byId.get(a.id)?.start ?? 0) - (byId.get(b.id)?.start ?? 0),
  );
  for (const e of sortedEls) {
    const src = byId.get(e.id);
    if (src === undefined) {
      throw new ArchiveFailure(
        "merge-failed",
        `cannot locate '${e.id}' in delta.likec4 — the landscape merge splices authored source, and this declaration was not found`,
      );
    }
    if (rides(src.start, src.end)) continue;
    const dot = e.id.lastIndexOf(".");
    if (dot === -1) {
      const spot = elementSpot(content, stmts, requireModel().close, e.id, elementService(e));
      applyTop(spot, spliceSource(deltaText, src, featureId, "  "));
      spliced.push({ start: src.start, end: src.end });
      continue;
    }
    const parentId = e.id.slice(0, dot);
    const parent = livingParentOf(parentId);
    if (parent === null) {
      throw new ArchiveFailure(
        "merge-failed",
        `'${e.id}' nests under '${parentId}', which is neither in the living landscape nor added by this delta — there is nowhere to insert it`,
      );
    }
    const nested = nestedInsert(content, parent, spliceSource(deltaText, src, featureId, parent.indent + "  "));
    applyAt(nested.at, nested.insert);
    spliced.push({ start: src.start, end: src.end });
  }

  // Relationships: match each parsed addition back to its statement in the
  // delta source — full identity (endpoints, title, op, tags), consumed one
  // statement per addition so duplicates stay duplicates.
  const relKeyOf = (source: string, target: string, title?: string, op?: string, tags: string[] = []): string =>
    JSON.stringify([source, target, title ?? "", op ?? "", [...tags].sort()]);
  const pool = new Map<string, ScannedRel[]>();
  for (const s of scan.rels) {
    const k = relKeyOf(s.source, s.target, s.title, s.op, s.tags);
    pool.set(k, [...(pool.get(k) ?? []), s]);
  }
  for (const r of addedRels) {
    const s = pool.get(relKeyOf(r.source, r.target, r.title, r.op, r.tags))?.shift();
    if (s === undefined) {
      throw new ArchiveFailure(
        "merge-failed",
        `cannot locate the '${r.source} -> ${r.target}' relationship in delta.likec4 — the landscape merge splices authored source, and no matching declaration was found`,
      );
    }
    if (rides(s.start, s.end)) continue;
    const key = relSortKey(deltaElements, r);
    const spot = relSpot(content, stmts, requireModel().close, serviceOf(deltaElements, r.source), key);
    applyTop(spot, spliceSource(deltaText, s, featureId, "  "));
  }

  // The safety net: prove the computed landscape parses before anything is
  // written. Splice bugs — and legal inputs the living document cannot absorb,
  // like a kind its specification never declares — refuse here, at plan time,
  // instead of corrupting the one file the whole fleet reads.
  const check = await loadSource(content);
  if (check.errors.length > 0) {
    const detail = check.errors
      .slice(0, 3)
      .map((e) => (typeof e.line === "number" ? `L${e.line}: ${e.message}` : e.message))
      .join("; ");
    throw new ArchiveFailure(
      "merge-failed",
      `the merged landscape would not parse (${check.errors.length} error(s): ${detail}) — nothing was written. ` +
        `The delta's additions do not fit the living landscape as authored — most often an element kind or tag ` +
        `its specification block does not declare; fix the landscape's specification or the delta, then re-run`,
    );
  }

  return { writes: [planWrite(landscapePath, content)], addedEls, addedRels };
}

/**
 * A declaration's authored source, ready to land in the living landscape:
 * byte-verbatim except that the feature's own tag is stripped and the
 * indentation is rebased from where the block sat in the delta to where it
 * lands. A construct the strip leaves empty goes too — a line that held only
 * the tag disappears whole, and `x = kind 'y' { #FEAT-1 }` lands as
 * `x = kind 'y'`, not as a pair of empty braces.
 */
function spliceSource(
  deltaText: string,
  decl: { start: number; end: number; indent: string },
  featureId: string,
  targetIndent: string,
): string {
  const block = deltaText.slice(decl.start, decl.end);
  return reindent(stripFeatureTag(block, featureId), decl.indent, targetIndent);
}

function stripFeatureTag(block: string, featureId: string): string {
  const { code } = maskSource(block);
  const esc = featureId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const removals: Array<[number, number]> = [];
  for (const m of block.matchAll(new RegExp(`#${esc}(?![\\w-])`, "g"))) {
    // Only tags in CODE count — a description quoting "#FEAT-1" is content.
    if (code.slice(m.index, m.index + m[0].length) !== m[0]) continue;
    let s = m.index;
    let e = s + m[0].length;
    // Take the whitespace on ONE side with the token — trailing first, so
    // `#FEAT-1 #critical` leaves `#critical` at its own indent, and a token at
    // the end of a line does not leave a trailing space behind.
    if (block[e] === " " || block[e] === "\t") {
      while (block[e] === " " || block[e] === "\t") e += 1;
    } else {
      while (s > 0 && (block[s - 1] === " " || block[s - 1] === "\t")) s -= 1;
    }
    removals.push([s, e]);
  }
  if (removals.length === 0) return block;

  // A line the strip emptied disappears whole, newline included.
  for (let lineStart = 0; lineStart < block.length; ) {
    const nl = block.indexOf("\n", lineStart);
    const lineEnd = nl === -1 ? block.length : nl + 1;
    if (
      removals.some(([s, e]) => s >= lineStart && e <= lineEnd) &&
      /^\s*$/.test(residual(block, lineStart, nl === -1 ? block.length : nl, removals))
    ) {
      removals.push([lineStart, lineEnd]);
    }
    lineStart = lineEnd;
  }

  // A body the strip emptied goes too, braces and all — but only one the strip
  // emptied: braces that were authored empty are authored bytes and survive.
  for (let at = code.indexOf("{"); at !== -1; at = code.indexOf("{", at + 1)) {
    const closeAt = matchBrace(code, at);
    if (closeAt === -1) continue;
    if (!removals.some(([s, e]) => s > at && e <= closeAt)) continue;
    if (!/^\s*$/.test(residual(block, at + 1, closeAt, removals))) continue;
    let s = at;
    while (s > 0 && /\s/.test(block[s - 1]!)) s -= 1;
    removals.push([s, closeAt + 1]);
  }
  return applyRemovals(block, removals);
}

/** The text of [from, to) with the removal ranges cut out. */
function residual(text: string, from: number, to: number, removals: Array<[number, number]>): string {
  let out = "";
  for (let i = from; i < to; i += 1) {
    if (!removals.some(([s, e]) => i >= s && i < e)) out += text[i];
  }
  return out;
}

function applyRemovals(text: string, removals: Array<[number, number]>): string {
  const sorted = [...removals].sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  let out = "";
  let i = 0;
  for (const [s, e] of sorted) {
    if (s > i) out += text.slice(i, s);
    if (e > i) i = e;
  }
  return out + text.slice(i);
}

/**
 * Rebase a block's indentation: the `base` its lines carried in the delta
 * becomes `target`. The first line arrives with no leading whitespace (the
 * scanner's span starts at the declaration itself), so it only gains `target`.
 */
function reindent(block: string, base: string, target: string): string {
  return block
    .split("\n")
    .map((line, k) => {
      const body = k === 0 ? line : line.startsWith(base) ? line.slice(base.length) : line;
      return body.length === 0 ? "" : target + body;
    })
    .join("\n");
}

/**
 * Where a child block enters an existing living parent: before the closing
 * brace of the parent's body, on its own line at the parent's inner indent —
 * and a parent that never had a body gains one around the child.
 */
function nestedInsert(text: string, parent: ScannedElement, block: string): { at: number; insert: string } {
  if (parent.bodyOpen === -1) {
    return { at: parent.end, insert: ` {\n${block}\n${parent.indent}}` };
  }
  const lineStart = text.lastIndexOf("\n", parent.bodyClose - 1) + 1;
  if (/^[ \t]*$/.test(text.slice(lineStart, parent.bodyClose))) {
    return { at: lineStart, insert: `${block}\n` };
  }
  // `{ ... }` on one line — break the brace onto its own line to make room.
  return { at: parent.bodyClose, insert: `\n${block}\n${parent.indent}` };
}

/**
 * What makes two edges the same edge. Endpoints are compared by TITLE, which is
 * stable across the delta's and the landscape's id namespaces.
 *
 * An edge that carries an `op` IS that call, whatever it is titled — retitling it
 * must not merge a second copy. An edge with no `op` has only its title. The two
 * live in separate namespaces because they are separate things: an op-less edge
 * titled `authorizePayment` is not the edge whose operationId is authorizePayment,
 * and keying on `op ?? title` quietly merged only one of them.
 */
function relKey(els: Elem[], r: Rel): string {
  const src = titleOf(els, r.source);
  const tgt = titleOf(els, r.target);
  return JSON.stringify(r.op !== undefined ? ["op", src, tgt, r.op] : ["title", src, tgt, r.title ?? ""]);
}

/* ------------------------------------------------------------------ */
/* Landscape placement — where a top-level addition lands               */
/* ------------------------------------------------------------------ */

/**
 * The placement scheme, in full. It never moves an authored byte — placement
 * only chooses where NEW spliced blocks go — and it is deterministic in a
 * stronger sense: archiving feature A then feature B (touching different
 * services) yields the SAME final bytes as B then A, which is what lets two
 * concurrent archive PRs merge in git instead of colliding on one shared
 * append point.
 *
 *  - An ELEMENT whose service already has top-level elements in the model
 *    (the elementService join — binding first, title as the fallback) lands
 *    immediately after the last of them: it joins its service's neighborhood.
 *    Two features touching the SAME service therefore land adjacently, and
 *    their concurrent PRs still conflict — expected, and documented
 *    (SCHEMA.md sends that conflict to the PR flow).
 *  - An element opening a NEW service lands in the trailing region before the
 *    model's closing brace: skip the trailing relationship run, then walk left
 *    per same-service RUN, past every run whose leading id is
 *    lexicographically greater — an insertion sort of neighborhood heads
 *    against whatever is already there, which is what makes the region's
 *    final order independent of archive order (see the note on elementSpot:
 *    per-statement comparison was order-dependent).
 *  - A RELATIONSHIP lands after the last top-level relationship touching its
 *    SOURCE's service (either endpoint counts), then past the anchor's own
 *    CLUSTER members with a smaller sort key — two edges anchored to the same
 *    statement must order by key, not by which archived first. With no such
 *    neighborhood it falls to the trailing region, cluster-head-key-sorted
 *    the same insertion-sort way, after the trailing elements.
 *
 * LikeC4 reference resolution is not order-dependent, so a relationship
 * placed before an element it names still parses; the in-memory parse net in
 * planLandscapeMerge stays as the backstop regardless.
 */
interface Spot {
  /** Offset into the living text: a line start, or a point inside a shared line. */
  at: number;
  /** True when `at` shares its line with other text (the closing brace, or a displaced statement) — the block must bring its own newlines. */
  bare: boolean;
}

/** A top-level statement of the living model, with everything placement asks of it. */
interface TopStmt {
  kind: "element" | "rel";
  /** Element: its id. */
  id: string;
  /** Relationship: its placement sort key (relSortKey). */
  key: string;
  /** The service(s) this statement resolves to — one for an element, both endpoints for a rel. */
  services: string[];
  start: number;
  end: number;
}

/** The model's top-level statements in document order, joined to the parsed elements for services. */
function topStatements(scan: ScannedModel, els: Elem[]): TopStmt[] {
  const topEls = scan.elements.filter((e) => !e.id.includes("."));
  const bound = new Map(els.map((e) => [e.id, elementService(e)]));
  const stmts: TopStmt[] = topEls.map((e) => ({
    kind: "element" as const,
    id: e.id,
    key: "",
    services: [bound.get(e.id) ?? e.id],
    start: e.start,
    end: e.end,
  }));
  for (const r of scan.rels) {
    // A rel declared inside an element's body is not a top-level statement —
    // anchoring after it would splice into the parent's block.
    if (topEls.some((e) => r.start > e.start && r.start < e.end)) continue;
    stmts.push({
      kind: "rel",
      id: "",
      key: relSortKey(els, r),
      services: [serviceOf(els, r.source), serviceOf(els, r.target)],
      start: r.start,
      end: r.end,
    });
  }
  return stmts.sort((a, b) => a.start - b.start);
}

/**
 * The order of loam-inserted relationships that share a landing region:
 * (source title, target title, op, title) as one comparable string. Titles,
 * not ids — the delta's and the landscape's id namespaces differ, and the
 * same edge must sort identically as today's addition and as an existing
 * statement in the next archive's scan.
 */
function relSortKey(
  els: Elem[],
  r: { source: string; target: string; title?: string; op?: string },
): string {
  return JSON.stringify([titleOf(els, r.source), titleOf(els, r.target), r.op ?? "", r.title ?? ""]);
}

/**
 * The trailing walks move in PLACEMENT UNITS, never single statements. A unit
 * is a service neighborhood: a contiguous run of top-level elements resolving
 * to one service, or a contiguous cluster of relationships grown around the
 * statements touching one — keyed by its LEADING statement's id/key. Anchored
 * inserts extend a neighborhood without changing its head, so the insertion
 * sort the trailing region maintains is over neighborhood heads, which
 * archive order cannot reshuffle. Comparing per statement instead let an
 * anchored insert legally sit a LOWER id/key after a higher one (its anchor
 * decides where it lives, not its own sort key), and a later trailing walk
 * then stopped at different statements depending on which archive had run
 * first — order-DEPENDENT bytes for features touching disjoint services, the
 * exact regime the scheme guarantees.
 */
function elementSpot(text: string, stmts: TopStmt[], close: number, id: string, service: string): Spot {
  let anchor: TopStmt | undefined;
  for (const s of stmts) {
    if (s.kind === "element" && s.services.includes(service)) anchor = s;
  }
  if (anchor !== undefined) return spotAfter(text, close, anchor.end);
  let i = stmts.length - 1;
  let before: TopStmt | undefined;
  while (i >= 0 && stmts[i]!.kind === "rel") {
    before = stmts[i];
    i -= 1;
  }
  while (i >= 0 && stmts[i]!.kind === "element") {
    // The same-service run ending here is one unit: skip it whole or stop
    // before it whole — an anchored member may carry any id, the run's
    // LEADING id is its sort key.
    let j = i;
    while (j > 0 && stmts[j - 1]!.kind === "element" && stmts[j - 1]!.services[0] === stmts[i]!.services[0]) j -= 1;
    if (!(stmts[j]!.id > id)) break;
    before = stmts[j];
    i = j - 1;
  }
  return before !== undefined ? beforeSpot(text, before) : closeSpot(text, close);
}

/**
 * Each top-level statement's cluster, as the index of the cluster's leading
 * statement. A relationship whose SOURCE's service some earlier relationship
 * in the same contiguous stretch already touches is an anchored join — it
 * belongs to that neighborhood wherever its own key would sort. One whose
 * source's service nothing before it touches opens a new cluster; sharing
 * only a TARGET does not join (every trailing edge into a busy hub would
 * otherwise dissolve into one giant cluster, and the trailing sort with it).
 * Recomputed from bytes alone, so the next archive sees the same units this
 * one placed.
 */
function relClusterHeads(stmts: TopStmt[]): number[] {
  const heads = stmts.map((_, i) => i);
  let head = -1;
  let services: Set<string> | null = null;
  for (let i = 0; i < stmts.length; i += 1) {
    const s = stmts[i]!;
    if (s.kind !== "rel") {
      head = -1;
      services = null;
      continue;
    }
    if (services !== null && services.has(s.services[0]!)) {
      for (const svc of s.services) services.add(svc);
    } else {
      head = i;
      services = new Set(s.services);
    }
    heads[i] = head;
  }
  return heads;
}

function relSpot(text: string, stmts: TopStmt[], close: number, sourceService: string, key: string): Spot {
  const heads = relClusterHeads(stmts);
  let anchorAt = -1;
  for (let i = 0; i < stmts.length; i += 1) {
    const s = stmts[i]!;
    if (s.kind === "rel" && s.services.includes(sourceService)) anchorAt = i;
  }
  if (anchorAt !== -1) {
    // Past the anchor, order among the cluster's OWN members is by key — two
    // edges anchored to the same statement must order by key, not by which
    // archived first — but the walk never leaves the cluster: the next
    // cluster is another neighborhood's, and stepping over it would depend
    // on which archive put it there.
    let last = stmts[anchorAt]!;
    for (let j = anchorAt + 1; j < stmts.length; j += 1) {
      const s = stmts[j]!;
      if (s.kind !== "rel" || heads[j] !== heads[anchorAt] || s.key >= key) break;
      last = s;
    }
    return spotAfter(text, close, last.end);
  }
  let i = stmts.length - 1;
  let before: TopStmt | undefined;
  while (i >= 0 && stmts[i]!.kind === "rel") {
    const j = heads[i]!;
    if (!(stmts[j]!.key > key)) break;
    before = stmts[j];
    i = j - 1;
  }
  return before !== undefined ? beforeSpot(text, before) : closeSpot(text, close);
}

/**
 * Insertion before an existing statement: at the start of its line when only
 * whitespace precedes it there, at the statement itself — bare, displacing it
 * onto a fresh line — when other text shares the line (a statement written on
 * the `model {` line, say). The unguarded line start spliced the block BEFORE
 * the model keyword, and the parse net refused a perfectly legal landscape.
 */
function beforeSpot(text: string, before: TopStmt): Spot {
  const ls = lineStartAt(text, before.start);
  if (/^[ \t]*$/.test(text.slice(ls, before.start))) return { at: ls, bare: false };
  return { at: before.start, bare: true };
}

/** The line following the statement that ends at `end` — clamped to the closing brace's own spot. */
function spotAfter(text: string, close: number, end: number): Spot {
  const nl = text.indexOf("\n", end);
  const at = nl === -1 ? text.length : nl + 1;
  return at > close ? closeSpot(text, close) : { at, bare: false };
}

/** The last resort: directly before the model's closing brace. */
function closeSpot(text: string, close: number): Spot {
  const ls = lineStartAt(text, close);
  if (/^[ \t]*$/.test(text.slice(ls, close))) return { at: ls, bare: false };
  return { at: close, bare: true };
}

function lineStartAt(text: string, at: number): number {
  return text.lastIndexOf("\n", at - 1) + 1;
}

/**
 * Rewrite ONLY the requirements run of a living spec. Byte-for-byte preserved:
 * everything before the first requirement inside `## Requirements` (the intro,
 * the heading line, prose under the heading) and everything from the section's
 * end onward (the next `## ` heading to EOF) — the old cut was a substring
 * `indexOf("\n## Requirements")`, a prefix match that also hit
 * `## Requirements Extra` and silently destroyed every section after the
 * requirements. Prose BETWEEN requirements is body text of whatever is open
 * above it (parseRequirements attributes it to the previous requirement's last
 * scenario, or its text) and survives inside the re-serialized run, framing
 * normalized. `merged` must contain every living requirement — runArchive's
 * stray guard refuses any document whose requirements sit outside the section,
 * using the same heading definition, before this output is ever written.
 */
function rewriteRequirementsRun(text: string, merged: Requirement[]): string {
  const s = splitRequirementsSection(text);
  // No `## Requirements` at all: the stray guard has already refused any doc
  // whose requirements live elsewhere, so this one has none — open the section.
  if (s === null) return `${text.trimEnd()}\n\n## Requirements\n\n${serializeRequirements(merged)}`;
  const body = serializeRequirements(merged);
  // head/tail are raw slices; only the run's own framing is normalized. When
  // the section held no requirements yet, the glue supplies the blank line the
  // author never had reason to write.
  const headGlue = s.run !== "" || s.head.endsWith("\n\n") ? "" : s.head.endsWith("\n") ? "\n" : "\n\n";
  const tailGlue = s.tail === "" ? "" : "\n";
  return s.head + headGlue + body + tailGlue + s.tail;
}

function summarize(reqs: Requirement[]): { ADDED: number; MODIFIED: number; REMOVED: number } {
  const c = { ADDED: 0, MODIFIED: 0, REMOVED: 0 };
  for (const r of reqs) {
    if (r.kind === "ADDED") c.ADDED += 1;
    else if (r.kind === "MODIFIED") c.MODIFIED += 1;
    else if (r.kind === "REMOVED") c.REMOVED += 1;
  }
  return c;
}

function titleOf(elements: Elem[], id: string): string {
  return elements.find((e) => e.id === id)?.title ?? id;
}
