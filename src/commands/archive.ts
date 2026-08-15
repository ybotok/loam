import type { Command } from "commander";
import { existsSync } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../core/envelope/config.js";
import { emitJson, emitJsonError, fail, repoPath, reportNoConfig, type ErrorCode } from "../core/envelope/json.js";
import { approveOverrides, gatesArchive, type Issue } from "../core/vocabulary/issue.js";
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
import { loadFile } from "../core/c4/likec4.js";
import { LandscapeSpliceError } from "../core/c4/splice/contract.js";
import { planLandscapeMerge } from "../core/c4/splice/landscape-merge.js";
import { titleOf } from "../core/c4/splice/placement.js";
import { featurePaths, featureSpecPaths, servicePaths, SPEC_AXES } from "../core/repo/paths.js";
import { archiveDir as archiveRoot, landscapePath as landscapeFile } from "../core/repo/paths.js";
import { featureSpecServices, missingFeatureMessage, resolveFeature } from "../core/repo/repo.js";
import { readOpenapi } from "../core/openapi.js";
import {
  mergeOpenapiPaths,
  OpenapiMergeError,
  stripOpenapiRemovalMarkers,
  type OpenapiMergeResult,
} from "../core/openapi-merge.js";
import { featureCoherence, invalidSpecServiceFindings, livingMergeConflicts, unknownDeltaServices } from "../core/coherence.js";
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
  // Every splice refusal is the mechanical merge answer — see the class.
  if (err instanceof LandscapeSpliceError) return "merge-failed";
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
 * `gates` and `overridable` are always present and already resolved: a consumer
 * must not have to re-implement the severity default to know what blocks
 * archive, nor keep a code list to know what `--approve` can move.
 */
function issueJson(i: Issue): Record<string, unknown> {
  return {
    severity: i.severity,
    code: i.code,
    gates: gatesArchive(i),
    overridable: approveOverrides(i),
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

  // A `specs/<svc>/` whose NAME is not a legal service id, refused before
  // anything joins that name into a path: the conflict scan below probes
  // `services/<svc>/<axis>` with it, and the requirements merge would
  // materialise `services/<svc>/` from it — a directory `service.id-invalid`
  // then calls an error on the next `validate --all`, and one no loam command
  // can address or re-create. The set comes from coherence.ts's
  // `invalidSpecServiceFindings` — the same function validate reads — so the
  // two gates cannot drift.
  //
  // --approve does not apply, exactly as with the conflict-marker refusal
  // below: --approve overrides judgments about the FEATURE, and a name the id
  // grammar refuses is a mechanical fact about the path it would become. The
  // dry run is gated too: a plan built on that name describes a merge loam
  // must never perform.
  const illegalServices = await invalidSpecServiceFindings(featureDir);
  if (illegalServices.length > 0) {
    const msg = `archive ${id} — BLOCKED: ${illegalServices.length} per-service delta(s) named by an illegal service id; --approve does not override this`;
    if (json) {
      refuseFindings("not-coherent", msg, illegalServices);
      return;
    }
    console.error(`${msg}:`);
    for (const f of illegalServices) console.error(`  ✗ ${f.message}`);
    console.error(`\n--approve does not override this — the directory the merge would create is one loam can never address, mechanically.`);
    process.exitCode = 1;
    return;
  }

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
  // The issues --approve cannot move, carved out before the gate below reads
  // the rest. The register is issue.ts's `approveOverrides` — the same data
  // the `overridable` key in the envelope is resolved from — never a code
  // string spelled here, because two spellings of "what the flag moves" would
  // drift. Today the register holds one code: a `metadata { service }` binding
  // the id grammar refuses, anywhere in a tagged element's spliced block. The
  // landscape merge would splice that name into the living map verbatim, and
  // the new-service scan would probe `services/<binding>/` with it — a '../'
  // collapses the probe out of services/ altogether — so the refusal is a
  // mechanical fact about the path the name becomes, not a judgment about the
  // feature. Same doctrine as the illegal-specs-name refusal above; the dry
  // run is gated the same way, and the --json envelope stays not-coherent
  // with every issue attached, exactly like the overridable branch below, so
  // a consumer branches on the code and not on which refusal path fired.
  const nonOverridable = issues.filter((i) => !approveOverrides(i));
  if (nonOverridable.length > 0) {
    const msg = `archive ${id} — BLOCKED: ${nonOverridable.length} element binding(s) name an illegal service id; --approve does not override this`;
    if (json) {
      refuseJson("not-coherent", msg, issues);
      return;
    }
    console.error(`${msg}:`);
    // The whole list, not just the carve-out: the reader is about to fix the
    // feature, and the issues --approve COULD have moved are work they still
    // owe — hiding them here made the second refusal a surprise. The closing
    // line says which of the marks the flag cannot move.
    for (const i of issues) console.error(`  ${SEVERITY_MARK[i.severity]} ${i.message}`);
    console.error(
      `\nOf these, --approve does not override the ${nonOverridable.length} illegal binding(s) — the merge would write a name loam can never resolve into services/, mechanically. Fix the binding(s); the other issues gate as usual.`,
    );
    process.exitCode = 1;
    return;
  }
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
      const plan = await planLandscapeMerge({
        landscapeText: await readUtf8(landscapePath),
        deltaText: await readUtf8(deltaLikec4),
        deltaElements: delta.elements,
        newEls,
        newRels,
        featureId: id,
      });
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
      if (plan.content !== null) writes.push(planWrite(landscapePath, plan.content));
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
    const creates = deltaServices.some((d) => d === svc)
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
