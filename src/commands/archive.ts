import type { Command } from "commander";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, rename, rm, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { isMap, parseDocument } from "yaml";
import { loadConfig } from "../core/config.js";
import { fail, emitJson, reportNoConfig, type ErrorCode } from "../core/json.js";
import { gatesArchive, type Issue } from "../core/issue.js";
import { loadFile, type Elem, type Rel } from "../core/likec4.js";
import {
  featurePaths,
  featureSpecPaths,
  featureSpecServices,
  featuresDir as featuresRoot,
  landscapePath as landscapeFile,
  missingFeatureMessage,
  resolveFeature,
  servicePaths,
} from "../core/repo.js";
import { operationIds } from "../core/openapi.js";
import { featureCoherence } from "../core/coherence.js";
import { repoPath } from "./list.js";
import {
  parseRequirements,
  serializeRequirements,
  applyRequirementDelta,
  isRequirementsHeading,
  sectionHeadings,
  splitRequirementsSection,
  type Requirement,
} from "../core/spec.js";

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
        const code = err instanceof ArchiveFailure ? err.code : "internal";
        fail(json, code, `archive ${featureId} failed: ${message(err)}`);
      }
    });
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
  console.log(JSON.stringify({ ok: false, error: { code, message: msg }, issues: issues.map(issueJson) }, null, 2));
  process.exitCode = 1;
}

async function runArchive(featureId: string, opts: ArchiveOptions): Promise<void> {
  const dryRun = opts.dryRun === true;
  const json = opts.json === true;
  // All prose goes through here so `--json` keeps stdout a single JSON document.
  const say = (line = ""): void => {
    if (!json) console.log(line);
  };
  const config = await loadConfig();
  if (!config) {
    reportNoConfig(json);
    return;
  }
  const featuresDir = featuresRoot(config.docsDir);
  const feature = await resolveFeature(config.docsDir, featureId, "exclude");
  if (!feature) {
    fail(json, "unknown-target", await missingFeatureMessage(config.docsDir, featureId));
    return;
  }
  // The raw argument's last appearance: from here on the feature answers only to
  // its canonical id — tags, coherence, and the self-exclusion scans all match
  // on `id`, and `archive FEAT-5-slug` must plan exactly like `archive FEAT-5`.
  const { id, dirName, dir: featureDir } = feature;

  // Gate: GATING issues block the archive. Severity and gating are two
  // different questions (issue.ts): errors gate because the merge would write
  // something wrong, and the rare warning marked `gates` blocks too — the
  // document is legal but the merge would drop authored content. Advisory
  // warnings are printed (and carried into --json) but never block, matching
  // validate's own doctrine (report.ts: "warnings never gate"). --approve
  // overrides the gating issues ONLY, and must say exactly which ones it is
  // walking past. A dry run is gated too: a plan for a merge that would be
  // refused describes nothing that will happen.
  const issues = await featureCoherence(config.docsDir, featureDir, id);
  const gating = issues.filter(gatesArchive);
  const advisory = issues.filter((i) => !gatesArchive(i));
  if (gating.length > 0 && !opts.approve) {
    const msg = `archive ${id} — BLOCKED: not coherent (${gating.length} gating issue(s), ${advisory.length} advisory warning(s))`;
    if (json) {
      refuseJson("not-coherent", msg, issues);
      return;
    }
    console.error(`${msg}:`);
    for (const i of issues) console.error(`  ${i.severity === "error" ? "✗" : "⚠"} ${i.message}`);
    console.error(`\nFix the gating issues (advisory warnings never block), or re-run with --approve to override them (may corrupt the living docs).`);
    process.exitCode = 1;
    return;
  }
  if (gating.length > 0) {
    say(`⚠ archiving despite ${gating.length} gating issue(s) (--approve):`);
    for (const i of gating) say(`  ${i.severity === "error" ? "✗" : "⚠"} ${i.message}`);
    say();
  }
  if (advisory.length > 0) {
    say(`⚠ ${advisory.length} warning(s) (non-blocking):`);
    for (const i of advisory) say(`  ⚠ ${i.message}`);
    say();
  }

  const deltaServices = await featureSpecServices(featureDir);

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
    if (!existsSync(featureSpecPaths(featureDir, svc).spec)) continue;
    const livingPath = servicePaths(config.docsDir, svc).spec;
    if (!existsSync(livingPath)) continue;
    for (const r of parseRequirements(await readFile(livingPath, "utf8"))) {
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
  const archiveDir = join(featuresDir, "archive");
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

  // 1. Requirements merge — apply ADDED/MODIFIED/REMOVED into each living service spec.
  for (const svc of deltaServices) {
    const deltaPath = featureSpecPaths(featureDir, svc).spec;
    if (!existsSync(deltaPath)) continue;
    const deltaReqs = parseRequirements(await readFile(deltaPath, "utf8"));

    const livingPath = servicePaths(config.docsDir, svc).spec;
    if (!existsSync(livingPath)) {
      // New service — create its living spec from the ADDED/MODIFIED requirements.
      const created = applyRequirementDelta([], deltaReqs);
      if (created.length === 0) {
        say(`  requirements: ${svc} — nothing to merge (delta leaves no requirements), no living spec created`);
        continue;
      }
      const frontmatter = `---\nservice: ${svc}\nstatus: draft\n---\n\n# ${svc}\n\n`;
      writes.push({ path: livingPath, content: `${frontmatter}## Requirements\n\n${serializeRequirements(created)}` });
      say(`  requirements: ${svc} — created living spec (${created.length} requirement(s))`);
      continue;
    }
    const livingText = await readFile(livingPath, "utf8");
    // TWO `## Requirements` headings would put the rewrite's one-section
    // invariant to a choice it must not make: the run of the first would be
    // rewritten while the second survived verbatim in the tail — and its
    // requirements, collected by parseRequirements, would land in the run TOO.
    // Mechanical, like a model-less landscape, so merge-failed, not --approve.
    const reqHeadings = sectionHeadings(livingText).filter((h) => isRequirementsHeading(h.text));
    if (reqHeadings.length > 1) {
      throw new ArchiveFailure(
        "merge-failed",
        `living spec for ${svc} has ${reqHeadings.length} '## Requirements' headings (lines ${reqHeadings.map((h) => h.line).join(", ")}) — the merge rewrites ONE requirements section and cannot choose; merge them into one, then re-run`,
      );
    }
    const merged = applyRequirementDelta(parseRequirements(livingText), deltaReqs);
    writes.push({ path: livingPath, content: rewriteRequirementsRun(livingText, merged) });

    const c = summarize(deltaReqs);
    say(`  requirements: ${svc} ← +${c.ADDED} ~${c.MODIFIED} -${c.REMOVED} (now ${merged.length} total)`);
  }

  // 1b. OpenAPI merge — fold the feature's openapi deltas into the living service APIs.
  for (const svc of deltaServices) {
    const featOpenapi = featureSpecPaths(featureDir, svc).openapi;
    if (!existsSync(featOpenapi)) continue;
    const featText = await readFile(featOpenapi, "utf8");
    const livingOpenapi = servicePaths(config.docsDir, svc).openapi;
    const ops = await operationIds(featOpenapi);
    if (!existsSync(livingOpenapi)) {
      writes.push({ path: livingOpenapi, content: featText });
      say(`  openapi: ${svc} — created (${ops.join(", ")})`);
    } else {
      const { text, modified, componentsModified, unresolved } = mergeOpenapiPaths(
        await readFile(livingOpenapi, "utf8"),
        featText,
        svc,
      );
      if (text !== null) {
        writes.push({ path: livingOpenapi, content: text });
        say(`  openapi: ${svc} — merged (${ops.join(", ")})`);
      }
      for (const label of modified) {
        planWarns.push({
          severity: "warn",
          code: "openapi.op-modified",
          subject: svc,
          message: `${svc}: the delta redefines ${label}, which the living OpenAPI already has — the merge overwrites the living operation wholesale`,
        });
        say(`      ⚠ overwrites ${label} — the living definition differs`);
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
  const deltaLikec4 = featurePaths(featureDir).delta;
  const landscapePath = landscapeFile(config.docsDir);
  if (existsSync(deltaLikec4)) {
    const delta = await loadFile(deltaLikec4);
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
      const plan = await planLandscapeMerge(landscapePath, delta.elements, newEls, newRels);
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

  // Gate on what only the plan could see: a merged operation pointing at a
  // component that exists nowhere. Same doctrine as the coherence gate — a
  // judgment call --approve overrides (unlike the mechanical merge-failed
  // refusals), and a dry run is gated too. Checked after the whole plan so the
  // refusal costs nothing: no write has happened yet either way.
  if (planGates.length > 0 && !opts.approve) {
    const msg = `archive ${id} — BLOCKED: ${planGates.length} unresolved $ref(s) in the OpenAPI merge`;
    if (json) {
      refuseJson("not-coherent", msg, [...issues, ...planWarns, ...planGates]);
      return;
    }
    console.error(`${msg}:`);
    for (const i of planGates) console.error(`  ✗ ${i.message}`);
    console.error(`\nDefine the referenced component(s) in the feature's openapi.yaml, or fix the ref — or re-run with --approve to merge the dangling reference anyway.`);
    process.exitCode = 1;
    return;
  }
  if (planGates.length > 0) {
    say(`\n  ⚠ archiving despite ${planGates.length} unresolved $ref(s) (--approve):`);
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
  });

  if (dryRun) {
    if (json) emitJson(payload(false));
    else printPlan(config.docsDir, writes, dirName);
    return;
  }

  // COMMIT — the whole plan computed cleanly. Stage every new version beside its
  // target, snapshot what is about to be overwritten, then swap them into place.
  const staged = await stageWrites(writes);
  let snapshot = false;
  let createdArchiveDir: string | undefined;
  try {
    await writeSnapshot(featureDir, config.docsDir, id, dirName, staged);
    snapshot = true;
    await swapStaged(staged);
    createdArchiveDir = await mkdir(archiveDir, { recursive: true });
    await rename(featureDir, archiveDest);
  } catch (err) {
    // Everything this run made, unmade: the swapped files, the snapshot inside the
    // feature that is staying put, and features/archive/ if we are the ones who
    // created it (mkdir reports nothing when it was already there).
    const failures = await rollbackStaged(staged);
    if (snapshot) await quietRm(snapshotDir(featureDir));
    if (createdArchiveDir !== undefined) await quietRm(createdArchiveDir);
    // The code is a caller's answer to "can I trust the repo?": merge-failed
    // means yes (rolled back), rollback-incomplete means look at it by hand.
    const wrapped = rollbackError(err, failures);
    throw new ArchiveFailure(failures.length > 0 ? "rollback-incomplete" : "merge-failed", wrapped.message);
  }

  if (json) {
    emitJson(payload(true));
    return;
  }
  console.log(`\n  archived: features/${dirName} → features/archive/${dirName}`);
  console.log(`  snapshot: features/archive/${dirName}/${SNAPSHOT_DIR}/ — \`loam unarchive ${id}\` puts it back`);
  console.log("  living spec + landscape are now complete + current.");
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
/* The commit phase                                                    */
/* ------------------------------------------------------------------ */

/**
 * A planned file write — the merge is computed fully before anything touches
 * disk. `content: null` means "delete this file"; only `unarchive` plans those,
 * to take back a file the archive created.
 */
export interface PlannedWrite {
  path: string;
  content: string | null;
}

/** A planned write with its new bytes parked next to the target, ready to swap in. */
export interface StagedWrite {
  write: PlannedWrite;
  /** Temp file holding the new bytes, in the target's OWN directory. Null for a delete. */
  tmp: string | null;
  /** The target's bytes before the swap; null when it did not exist. */
  before: string | null;
  /**
   * Topmost directory this write had to create, if any — a rollback owes the repo
   * its directories back too. An empty `services/<svc>/` left standing is the
   * fleet claiming a service that was never merged.
   */
  createdDir: string | null;
  swapped: boolean;
}

/**
 * Write every new version to a temp file beside its target, remembering what the
 * target said first. Nothing observable changes here: on failure the temp files
 * are removed and the docs are exactly as they were.
 *
 * The pre-image is read eagerly and deliberately: it is what a rollback restores
 * and what `unarchive` is given, so a file we cannot read is a file we cannot
 * safely rewrite, and the merge must stop before it starts.
 */
export async function stageWrites(writes: PlannedWrite[]): Promise<StagedWrite[]> {
  const staged: StagedWrite[] = [];
  try {
    for (const [i, write] of writes.entries()) {
      // mkdir(recursive) reports the topmost directory it had to create — the
      // handle a rollback needs to put the tree back the way it found it.
      const createdDir = (await mkdir(dirname(write.path), { recursive: true })) ?? null;
      const before = existsSync(write.path) ? await readFile(write.path, "utf8") : null;
      let tmp: string | null = null;
      if (write.content !== null) {
        tmp = tempPath(write.path, i);
        await writeFile(tmp, write.content, "utf8");
      }
      staged.push({ write, tmp, before, createdDir, swapped: false });
    }
  } catch (err) {
    await discardStaged(staged);
    throw err;
  }
  return staged;
}

/**
 * Swap the staged versions in, one file at a time. Each swap is a rename(2)
 * within a single directory, so a concurrent reader sees either the old bytes or
 * the new ones — never a half-written file. Across files it is not atomic: the
 * caller rolls back what has already gone in.
 */
export async function swapStaged(staged: StagedWrite[]): Promise<void> {
  for (const s of staged) {
    if (s.tmp === null) {
      if (s.before !== null) await unlink(s.write.path);
    } else {
      await rename(s.tmp, s.write.path);
    }
    s.swapped = true;
  }
}

/**
 * Put back every file that was already swapped, newest first, from the bytes read
 * before the swap. Returns the paths it could NOT restore — the caller must say so
 * out loud rather than report a clean failure over a half-merged repo.
 */
export async function rollbackStaged(staged: StagedWrite[]): Promise<string[]> {
  const failures: string[] = [];
  for (const s of [...staged].reverse()) {
    if (!s.swapped) continue;
    try {
      if (s.before === null) await rm(s.write.path, { force: true });
      else await atomicWrite(s.write.path, s.before);
      s.swapped = false;
    } catch (err) {
      failures.push(`${s.write.path} (${message(err)})`);
    }
  }
  await discardStaged(staged);
  return failures;
}

/** Write `content` to `path` through a temp file in the same directory. */
async function atomicWrite(path: string, content: string): Promise<void> {
  const tmp = tempPath(path, 0);
  await writeFile(tmp, content, "utf8");
  await rename(tmp, path);
}

/** A hidden sibling of `path`: same directory, so the rename never crosses a filesystem. */
function tempPath(path: string, n: number): string {
  return join(dirname(path), `.${basename(path)}.loam-${process.pid}-${n}-${Date.now()}.tmp`);
}

/** Everything staging left on disk: the temp files, and the directories it made for them. */
async function discardStaged(staged: StagedWrite[]): Promise<void> {
  for (const s of staged) if (s.tmp !== null) await quietRm(s.tmp);
  for (const s of [...staged].reverse()) if (s.createdDir !== null) await quietRm(s.createdDir);
}

export async function quietRm(path: string): Promise<void> {
  try {
    await rm(path, { recursive: true, force: true });
  } catch {
    // Best effort — a leftover temp file is noise, not corruption.
  }
}

/** Say what the failure cost: nothing, or a repo that needs looking at by hand. */
export function rollbackError(err: unknown, failures: string[]): Error {
  if (failures.length === 0) {
    return new Error(`${message(err)} — the living docs were rolled back, nothing was merged`);
  }
  return new Error(
    `${message(err)} — ROLLBACK INCOMPLETE, these files may be half-merged and need checking by hand: ${failures.join(", ")}`,
  );
}

export function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/* ------------------------------------------------------------------ */
/* The undo snapshot                                                   */
/* ------------------------------------------------------------------ */

/**
 * Where archive parks the bytes it is about to overwrite, inside the feature
 * directory so it travels with it into `features/archive/`.
 *
 * It exists because the merge is not invertible: a MODIFIED requirement's
 * previous text appears nowhere in the delta, and a landscape rewritten by hand
 * since cannot be un-rewritten by re-reading the delta either. `unarchive` puts
 * bytes back; it does not recompute them.
 */
export const SNAPSHOT_DIR = ".loam-before";
export const SNAPSHOT_MANIFEST = "manifest.json";
/** Bumped only when the layout changes in a way `unarchive` must refuse to guess at. */
export const SNAPSHOT_VERSION = 1;

export interface SnapshotEntry {
  /** Docs-repo-relative path, forward slashes — the same spelling `--json` uses. */
  path: string;
  /** False when archive CREATED the file: restoring it means deleting it again. */
  existed: boolean;
  /** sha256 of what archive wrote, so unarchive can tell its own merge from later edits. */
  after: string;
}

export interface SnapshotManifest {
  version: number;
  feature: string;
  dirName: string;
  archivedAt: string;
  files: SnapshotEntry[];
}

export function snapshotDir(featureDir: string): string {
  return join(featureDir, SNAPSHOT_DIR);
}

export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

async function writeSnapshot(
  featureDir: string,
  docsDir: string,
  featureId: string,
  dirName: string,
  staged: StagedWrite[],
): Promise<void> {
  const dir = snapshotDir(featureDir);
  // A leftover from a rolled-back run would describe a merge that never happened.
  await quietRm(dir);

  const files: SnapshotEntry[] = [];
  for (const s of staged) {
    const rel = repoPath(docsDir, s.write.path);
    files.push({ path: rel, existed: s.before !== null, after: sha256(s.write.content ?? "") });
    if (s.before !== null) {
      const dest = join(dir, "files", rel);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, s.before, "utf8");
    }
  }

  const manifest: SnapshotManifest = {
    version: SNAPSHOT_VERSION,
    feature: featureId,
    dirName,
    archivedAt: new Date().toISOString(),
    files,
  };
  // Manifest last: its presence is what says the pre-images beside it are complete.
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, SNAPSHOT_MANIFEST), JSON.stringify(manifest, null, 2) + "\n", "utf8");
}

/* ------------------------------------------------------------------ */
/* Merging                                                             */
/* ------------------------------------------------------------------ */

/** The keys of a path item that ARE operations — vendor extensions and `parameters` are not. */
const HTTP_METHODS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);

/** What mergeOpenapiPaths computed: the merged text, and everything the plan owes an eye. */
interface OpenapiMerge {
  /** The merged living document, or null when the feature document has no paths to merge. */
  text: string | null;
  /** Labels of EXISTING operations the merge overwrites with different content. */
  modified: string[];
  /** `<kind>/<name>` of living components the closure copy overwrites with different content. */
  componentsModified: string[];
  /** Local $refs reachable from the merged content that resolve in NEITHER document. */
  unresolved: Array<{ ref: string; from: string }>;
}

/**
 * Merge the feature's `paths` into the living OpenAPI structurally (YAML AST, not
 * text splicing): a new path is inserted whole; an existing path gains/overwrites
 * the feature's methods. Never produces duplicate keys or mixed indentation; the
 * living document's comments and formatting are preserved. Returns the merged
 * text (null when the feature document has no paths to merge), plus a label for
 * every EXISTING operation the merge overwrites with different content — the
 * feature file restates the full API, so only the operationId set-difference is
 * ever examined elsewhere, and a changed schema/params/response would otherwise
 * land with zero signal. Set membership + deep-equal only; no schema-diff semantics.
 *
 * The merged operations' `$ref` closure rides along: every
 * `#/components/<kind>/<name>` reachable from the merged path items — recursively
 * through the FEATURE's own components, a component referencing another pulls it
 * in — is copied into the living document, so an operation never lands pointing
 * at a schema that stayed behind. A needed component the living document already
 * has identically is left alone; one it has differently is overwritten wholesale
 * and reported (`componentsModified`, the op-modified discipline). A local ref
 * that resolves in NEITHER document is reported as `unresolved` — the caller
 * gates on it. External refs (URLs, file paths — anything not starting `#/`)
 * are out of scope: left untouched, never gated.
 */
function mergeOpenapiPaths(
  livingText: string,
  featureText: string,
  service: string,
): OpenapiMerge {
  const feature = parseDocument(featureText);
  if (feature.errors.length > 0) {
    throw new ArchiveFailure("merge-failed", `feature openapi for ${service} is not valid YAML: ${feature.errors[0]!.message}`);
  }
  const featPaths = feature.get("paths");
  if (!isMap(featPaths) || featPaths.items.length === 0) {
    return { text: null, modified: [], componentsModified: [], unresolved: [] };
  }

  const living = parseDocument(livingText);
  if (living.errors.length > 0) {
    throw new ArchiveFailure("merge-failed", `living openapi for ${service} is not valid YAML: ${living.errors[0]!.message}`);
  }
  const modified: string[] = [];
  for (const item of featPaths.items) {
    const path = scalarKey(item.key);
    const featItem = item.value;
    const existing = living.getIn(["paths", path]);
    if (existing !== undefined && isMap(existing) && isMap(featItem)) {
      for (const method of featItem.items) {
        const m = scalarKey(method.key);
        const before = living.getIn(["paths", path, m]);
        if (HTTP_METHODS.has(m) && before !== undefined && !isDeepStrictEqual(toPlain(before), toPlain(method.value))) {
          modified.push(opLabel(before, method.value, m, path));
        }
        living.setIn(["paths", path, m], toPlain(method.value));
      }
    } else {
      living.setIn(["paths", path], toPlain(featItem));
    }
  }

  // The $ref closure of what was just merged. Resolution is checked against
  // plain snapshots (components untouched so far); the copies land afterwards,
  // in discovery order, so the walk never chases its own writes.
  const featPlain = (feature.toJS() ?? {}) as unknown;
  const livingPlain = (living.toJS() ?? {}) as unknown;
  const componentsModified: string[] = [];
  const unresolved: OpenapiMerge["unresolved"] = [];
  const visited = new Set<string>();
  const copies: Array<{ kind: string; name: string; value: unknown }> = [];

  const visitRef = (ref: string, from: string): void => {
    if (!ref.startsWith("#/")) return; // external — out of scope, untouched, never gated
    const m = /^#\/components\/([^/]+)\/([^/]+)(?:\/|$)/.exec(ref);
    if (!m) {
      // A local ref outside components (rare). Nothing to copy, but it must
      // point at something in one of the two documents being merged.
      if (!resolvePointer(featPlain, ref).found && !resolvePointer(livingPlain, ref).found) {
        unresolved.push({ ref, from });
      }
      return;
    }
    const kind = m[1]!;
    const name = m[2]!;
    const key = `${kind}/${name}`;
    if (visited.has(key)) return;
    visited.add(key);
    const inFeature = resolvePointer(featPlain, `#/components/${kind}/${name}`);
    if (inFeature.found) {
      copies.push({ kind, name, value: inFeature.value });
      walk(inFeature.value, `components/${key}`);
      return;
    }
    // Not the feature's to provide — fine if the living document has it.
    if (!resolvePointer(livingPlain, `#/components/${kind}/${name}`).found) {
      unresolved.push({ ref, from });
    }
  };

  const walk = (node: unknown, from: string): void => {
    for (const ref of collectRefs(node)) visitRef(ref, from);
  };

  for (const item of featPaths.items) {
    walk(toPlain(item.value), `paths ${scalarKey(item.key)}`);
  }

  for (const { kind, name, value } of copies) {
    const existing = living.getIn(["components", kind, name]);
    if (existing !== undefined) {
      if (isDeepStrictEqual(toPlain(existing), value)) continue;
      componentsModified.push(`${kind}/${name}`);
    }
    living.setIn(["components", kind, name], value);
  }

  return { text: living.toString(), modified, componentsModified, unresolved };
}

/** Every `$ref` string value anywhere in a plain JS tree, in document order. */
function collectRefs(node: unknown): string[] {
  const out: string[] = [];
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) {
      for (const v of n) walk(v);
      return;
    }
    if (n !== null && typeof n === "object") {
      for (const [k, v] of Object.entries(n)) {
        if (k === "$ref" && typeof v === "string") out.push(v);
        else walk(v);
      }
    }
  };
  walk(node);
  return out;
}

/**
 * Resolve a local JSON pointer (`#/a/b~1c`) against a plain JS tree. `found`
 * distinguishes "resolves to null/undefined-shaped content" from "no such
 * spot": a component whose body is legitimately null still resolves.
 */
function resolvePointer(root: unknown, ref: string): { found: boolean; value: unknown } {
  let cur: unknown = root;
  for (const raw of ref.slice(2).split("/")) {
    const seg = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(cur)) {
      const i = Number(seg);
      if (!Number.isInteger(i) || i < 0 || i >= cur.length) return { found: false, value: undefined };
      cur = cur[i];
    } else if (cur !== null && typeof cur === "object" && seg in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      return { found: false, value: undefined };
    }
  }
  return { found: true, value: cur };
}

/** Name an overwritten operation by its operationId (feature's, else living's), or by path+method. */
function opLabel(before: unknown, after: unknown, method: string, path: string): string {
  const idOf = (n: unknown): string | undefined => {
    const v = isMap(n) ? n.get("operationId") : undefined;
    return typeof v === "string" && v.length > 0 ? v : undefined;
  };
  const op = idOf(after) ?? idOf(before);
  return op !== undefined ? `'${op}' (${method} ${path})` : `${method} ${path}`;
}

function scalarKey(key: unknown): string {
  if (key && typeof key === "object" && "value" in key) return String((key as { value: unknown }).value);
  return String(key);
}

function toPlain(node: unknown): unknown {
  if (node && typeof node === "object" && "toJSON" in node) return (node as { toJSON: () => unknown }).toJSON();
  return node;
}

interface LandscapePlan {
  writes: PlannedWrite[];
  addedEls: Elem[];
  addedRels: Rel[];
}

/**
 * Plan the insertion of the feature's new elements + relationships into the living
 * landscape's `model { ... }` block (preserving the rest of the file). Existence is
 * checked semantically against the parsed landscape (by element id/title and by
 * edge identity), so re-archiving is idempotent and title strings appearing
 * elsewhere in the source cause no false skips. Feature tags are dropped — the
 * additions are now part of the baseline. Assumes the delta reuses the landscape's
 * element identifiers for existing services.
 */
async function planLandscapeMerge(
  landscapePath: string,
  deltaElements: Elem[],
  newEls: Elem[],
  newRels: Rel[],
): Promise<LandscapePlan> {
  const text = await readFile(landscapePath, "utf8");
  const land = await loadFile(landscapePath);
  if (land.errors.length > 0) {
    throw new ArchiveFailure("merge-failed", `landscape.likec4 has ${land.errors.length} error(s) — fix it before archiving`);
  }
  const haveIds = new Set(land.elements.map((e) => e.id));
  const haveTitles = new Set(land.elements.map((e) => e.title));
  const addedEls: Elem[] = [];
  for (const e of newEls) {
    if (haveIds.has(e.id) || haveTitles.has(e.title)) continue;
    haveIds.add(e.id);
    haveTitles.add(e.title);
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

  const lines: string[] = [];
  for (const e of addedEls) lines.push(...elementLines(e));
  for (const r of addedRels) lines.push(relLine(r));
  if (lines.length === 0) return { writes: [], addedEls, addedRels };
  return {
    writes: [{ path: landscapePath, content: insertIntoModelBlock(text, lines) }],
    addedEls,
    addedRels,
  };
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

/** Quote a string as LikeC4 source — single-quoted with backslash/apostrophe escapes. */
function lq(s: string): string {
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/**
 * An element as living-landscape source. Both spines survive the rewrite: the
 * description, and `metadata { service }` — the binding that says which
 * `services/<svc>/` this box IS. Dropping the binding does not merely lose
 * decoration, it unmodels the directory the same archive just created.
 */
function elementLines(e: Elem): string[] {
  const body: string[] = [];
  if (e.description) body.push(`  description ${lq(e.description)}`);
  if (e.service) body.push(`  metadata { service ${lq(e.service)} }`);
  const head = `${e.id} = ${e.kind} ${lq(e.title)}`;
  return body.length === 0 ? [head] : [`${head} {`, ...body, `}`];
}

function relLine(r: Rel): string {
  const base = `${r.source} -> ${r.target}${r.title ? ` ${lq(r.title)}` : ""}`;
  // Preserve the operationId spine link. Dropping `metadata { op }` here de-links the
  // merged edge from the OpenAPI contract on the living side (was a silent bug).
  return r.op ? `${base} { metadata { op ${lq(r.op)} } }` : base;
}

/**
 * Insert lines before the closing brace of the top-level `model { ... }` block.
 * The brace scan is string- and comment-aware — braces inside quoted titles,
 * descriptions, or comments must not derail the balance.
 */
function insertIntoModelBlock(text: string, lines: string[]): string {
  const m = /\bmodel\s*\{/.exec(text);
  if (!m) throw new ArchiveFailure("merge-failed", "landscape.likec4 has no model block");
  let depth = 0;
  let close = -1;
  type State = "code" | "squote" | "dquote" | "lineComment" | "blockComment";
  let state: State = "code";
  for (let i = m.index + m[0].length - 1; i < text.length && close === -1; i += 1) {
    const ch = text[i]!;
    const next = text[i + 1];
    switch (state) {
      case "code":
        if (ch === "'") state = "squote";
        else if (ch === '"') state = "dquote";
        else if (ch === "/" && next === "/") { state = "lineComment"; i += 1; }
        else if (ch === "/" && next === "*") { state = "blockComment"; i += 1; }
        else if (ch === "{") depth += 1;
        else if (ch === "}") {
          depth -= 1;
          if (depth === 0) close = i;
        }
        break;
      case "squote":
        if (ch === "\\") i += 1;
        else if (ch === "'") state = "code";
        break;
      case "dquote":
        if (ch === "\\") i += 1;
        else if (ch === '"') state = "code";
        break;
      case "lineComment":
        if (ch === "\n") state = "code";
        break;
      case "blockComment":
        if (ch === "*" && next === "/") { state = "code"; i += 1; }
        break;
    }
  }
  if (close === -1) throw new ArchiveFailure("merge-failed", "landscape.likec4 has an unbalanced model block");
  const block = `\n  // merged by loam archive\n${lines.map((l) => `  ${l}`).join("\n")}\n`;
  return text.slice(0, close) + block + text.slice(close);
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
