import type { Command } from "commander";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, rename, rm, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { isMap, parseDocument } from "yaml";
import { loadConfig } from "../core/config.js";
import { loadFile, type Elem, type Rel } from "../core/likec4.js";
import {
  featurePaths,
  featureSpecPaths,
  featureSpecServices,
  featuresDir as featuresRoot,
  landscapePath as landscapeFile,
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
  type Requirement,
} from "../core/spec.js";

interface ArchiveOptions {
  approve?: boolean;
  dryRun?: boolean;
}

export function registerArchive(program: Command): void {
  program
    .command("archive")
    .argument("<featureId>", "feature id, e.g. FEAT-101")
    .description("Merge a shipped feature's deltas into the living specs + model, then archive it")
    .option("--approve", "archive even if the feature is not coherent (may corrupt the living docs)")
    .option("--dry-run", "print the whole merge plan and write nothing")
    .action(async (featureId: string, opts: ArchiveOptions) => {
      try {
        await runArchive(featureId, opts);
      } catch (err) {
        // Plan-phase failures happen before any write; commit-phase failures are
        // rolled back by runArchive, which says so in the message it throws.
        console.error(`archive ${featureId} failed: ${message(err)}`);
        process.exitCode = 1;
      }
    });
}

async function runArchive(featureId: string, opts: ArchiveOptions): Promise<void> {
  const dryRun = opts.dryRun === true;
  const config = await loadConfig();
  if (!config) {
    console.error("No loam.json found. Run `loam init --docs <dir>` first.");
    process.exitCode = 1;
    return;
  }
  const featuresDir = featuresRoot(config.docsDir);
  const feature = await resolveFeature(config.docsDir, featureId);
  if (!feature) {
    console.error(`No feature '${featureId}' under ${featuresDir}.`);
    process.exitCode = 1;
    return;
  }
  const { dirName, dir: featureDir } = feature;

  // Gate: never archive an incoherent feature without explicit approval — the merge would corrupt the living docs.
  // A dry run is gated too: a plan for a merge that would be refused describes nothing that will happen.
  const issues = await featureCoherence(config.docsDir, featureDir, featureId);
  if (issues.length > 0 && !opts.approve) {
    const errs = issues.filter((i) => i.severity === "error").length;
    console.error(`archive ${featureId} — BLOCKED: not coherent (${errs} error(s), ${issues.length - errs} warning(s)):`);
    for (const i of issues) console.error(`  ${i.severity === "error" ? "✗" : "⚠"} ${i.message}`);
    console.error(`\nFix these, or re-run with --approve to archive anyway (may corrupt the living docs).`);
    process.exitCode = 1;
    return;
  }
  if (issues.length > 0) {
    console.log(`⚠ archiving despite ${issues.length} coherence issue(s) (--approve):`);
    for (const i of issues) console.log(`  ${i.severity === "error" ? "✗" : "⚠"} ${i.message}`);
    console.log("");
  }

  // Pre-flight: the archive destination must be free, or the final move would fail
  // after the living docs were already rewritten.
  const archiveDir = join(featuresDir, "archive");
  const archiveDest = join(archiveDir, dirName);
  if (existsSync(archiveDest)) {
    console.error(`archive ${featureId} — BLOCKED: features/archive/${dirName} already exists. Remove or rename it, then re-run.`);
    process.exitCode = 1;
    return;
  }

  console.log(`archive ${featureId}${dryRun ? "  (dry run)" : ""}\n`);

  // PLAN — compute every merge in memory. Nothing is written until the whole plan
  // succeeds, so a failure on any axis leaves the living docs untouched.
  const writes: PlannedWrite[] = [];

  const deltaServices = await featureSpecServices(featureDir);

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
        console.log(`  requirements: ${svc} — nothing to merge (delta leaves no requirements), no living spec created`);
        continue;
      }
      const frontmatter = `---\nservice: ${svc}\nstatus: draft\n---\n\n# ${svc}\n\n`;
      writes.push({ path: livingPath, content: `${frontmatter}## Requirements\n\n${serializeRequirements(created)}` });
      console.log(`  requirements: ${svc} — created living spec (${created.length} requirement(s))`);
      continue;
    }
    const livingText = await readFile(livingPath, "utf8");
    const { intro, reqs: livingReqs } = splitSpec(livingText);
    const merged = applyRequirementDelta(livingReqs, deltaReqs);
    writes.push({ path: livingPath, content: `${intro.trimEnd()}\n\n## Requirements\n\n${serializeRequirements(merged)}` });

    const c = summarize(deltaReqs);
    console.log(`  requirements: ${svc} ← +${c.ADDED} ~${c.MODIFIED} -${c.REMOVED} (now ${merged.length} total)`);
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
      console.log(`  openapi: ${svc} — created (${ops.join(", ")})`);
    } else {
      const merged = mergeOpenapiPaths(await readFile(livingOpenapi, "utf8"), featText, svc);
      if (merged !== null) {
        writes.push({ path: livingOpenapi, content: merged });
        console.log(`  openapi: ${svc} — merged (${ops.join(", ")})`);
      }
    }
  }

  // 2. Architecture merge — fold the feature's tagged elements/relationships into the living landscape.
  const deltaLikec4 = featurePaths(featureDir).delta;
  const landscapePath = landscapeFile(config.docsDir);
  if (existsSync(deltaLikec4)) {
    const { errors, elements, relationships } = await loadFile(deltaLikec4);
    if (errors.length > 0) {
      console.log("\n  architecture: delta.likec4 has errors — skipped (run `loam validate --feature`).");
    } else {
      const newEls = elements.filter((e) => e.tags.includes(featureId));
      const newRels = relationships.filter((r) => r.tags.includes(featureId));
      if (existsSync(landscapePath)) {
        const plan = await planLandscapeMerge(landscapePath, elements, newEls, newRels);
        writes.push(...plan.writes);
        console.log(`\n  architecture: merged into landscape.likec4 — +${plan.addedEls.length} element(s), +${plan.addedRels.length} relationship(s)`);
        for (const e of plan.addedEls) console.log(`      + ${e.title} (${e.kind})`);
        for (const r of plan.addedRels) {
          console.log(`      + ${titleOf(elements, r.source)} -> ${titleOf(elements, r.target)}  "${r.title ?? ""}"`);
        }
      } else {
        console.log(`\n  architecture: no landscape.likec4 — ${newEls.length} element(s) not merged`);
      }
    }
  }

  if (dryRun) {
    printPlan(config.docsDir, writes, dirName);
    return;
  }

  // COMMIT — the whole plan computed cleanly. Stage every new version beside its
  // target, snapshot what is about to be overwritten, then swap them into place.
  const staged = await stageWrites(writes);
  let snapshot = false;
  let createdArchiveDir: string | undefined;
  try {
    await writeSnapshot(featureDir, config.docsDir, featureId, dirName, staged);
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
    throw rollbackError(err, failures);
  }

  console.log(`\n  archived: features/${dirName} → features/archive/${dirName}`);
  console.log(`  snapshot: features/archive/${dirName}/${SNAPSHOT_DIR}/ — \`loam unarchive ${featureId}\` puts it back`);
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

/**
 * Merge the feature's `paths` into the living OpenAPI structurally (YAML AST, not
 * text splicing): a new path is inserted whole; an existing path gains/overwrites
 * the feature's methods. Never produces duplicate keys or mixed indentation; the
 * living document's comments and formatting are preserved. Returns the merged
 * text, or null when the feature document has no paths to merge.
 */
function mergeOpenapiPaths(livingText: string, featureText: string, service: string): string | null {
  const feature = parseDocument(featureText);
  if (feature.errors.length > 0) {
    throw new Error(`feature openapi for ${service} is not valid YAML: ${feature.errors[0]!.message}`);
  }
  const featPaths = feature.get("paths");
  if (!isMap(featPaths) || featPaths.items.length === 0) return null;

  const living = parseDocument(livingText);
  if (living.errors.length > 0) {
    throw new Error(`living openapi for ${service} is not valid YAML: ${living.errors[0]!.message}`);
  }
  for (const item of featPaths.items) {
    const path = scalarKey(item.key);
    const featItem = item.value;
    const existing = living.getIn(["paths", path]);
    if (existing !== undefined && isMap(existing) && isMap(featItem)) {
      for (const method of featItem.items) {
        living.setIn(["paths", path, scalarKey(method.key)], toPlain(method.value));
      }
    } else {
      living.setIn(["paths", path], toPlain(featItem));
    }
  }
  return living.toString();
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
    throw new Error(`landscape.likec4 has ${land.errors.length} error(s) — fix it before archiving`);
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
  if (!m) throw new Error("landscape.likec4 has no model block");
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
  if (close === -1) throw new Error("landscape.likec4 has an unbalanced model block");
  const block = `\n  // merged by loam archive\n${lines.map((l) => `  ${l}`).join("\n")}\n`;
  return text.slice(0, close) + block + text.slice(close);
}

function splitSpec(text: string): { intro: string; reqs: Requirement[] } {
  const i = text.indexOf("\n## Requirements");
  const intro = i >= 0 ? text.slice(0, i) : text;
  return { intro, reqs: parseRequirements(text) };
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
