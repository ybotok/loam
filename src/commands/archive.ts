import type { Command } from "commander";
import { existsSync } from "node:fs";
import { readFile, writeFile, readdir, mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isMap, parseDocument } from "yaml";
import { loadConfig } from "../core/config.js";
import { loadFile, type Elem, type Rel } from "../core/likec4.js";
import { operationIds } from "../core/openapi.js";
import { featureCoherence } from "../core/coherence.js";
import {
  parseRequirements,
  serializeRequirements,
  applyRequirementDelta,
  type Requirement,
} from "../core/spec.js";

/** A planned file write — the merge is computed fully before anything touches disk. */
interface PlannedWrite {
  path: string;
  content: string;
}

export function registerArchive(program: Command): void {
  program
    .command("archive")
    .argument("<featureId>", "feature id, e.g. FEAT-101")
    .description("Merge a shipped feature's deltas into the living specs + model, then archive it")
    .option("--approve", "archive even if the feature is not coherent (may corrupt the living docs)")
    .action(async (featureId: string, opts: { approve?: boolean }) => {
      try {
        await runArchive(featureId, opts);
      } catch (err) {
        // Plan-phase failures happen before any write — the living docs are untouched.
        console.error(`archive ${featureId} failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      }
    });
}

async function runArchive(featureId: string, opts: { approve?: boolean }): Promise<void> {
  const config = await loadConfig();
  if (!config) {
    console.error("No loam.json found. Run `loam init --docs <dir>` first.");
    process.exitCode = 1;
    return;
  }
  const featuresDir = join(config.docsDir, "features");
  const dirName = await findFeatureDirName(featuresDir, featureId);
  if (!dirName) {
    console.error(`No feature '${featureId}' under ${featuresDir}.`);
    process.exitCode = 1;
    return;
  }
  const featureDir = join(featuresDir, dirName);

  // Gate: never archive an incoherent feature without explicit approval — the merge would corrupt the living docs.
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

  console.log(`archive ${featureId}\n`);

  // PLAN — compute every merge in memory. Nothing is written until the whole plan
  // succeeds, so a failure on any axis leaves the living docs untouched.
  const writes: PlannedWrite[] = [];

  // 1. Requirements merge — apply ADDED/MODIFIED/REMOVED into each living service spec.
  const specsDir = join(featureDir, "specs");
  if (existsSync(specsDir)) {
    const svcs = (await readdir(specsDir, { withFileTypes: true })).filter((e) => e.isDirectory());
    for (const svc of svcs) {
      const deltaPath = join(specsDir, svc.name, "spec.md");
      if (!existsSync(deltaPath)) continue;
      const deltaReqs = parseRequirements(await readFile(deltaPath, "utf8"));

      const livingPath = join(config.docsDir, "services", svc.name, "spec.md");
      if (!existsSync(livingPath)) {
        // New service — create its living spec from the ADDED/MODIFIED requirements.
        const created = applyRequirementDelta([], deltaReqs);
        if (created.length === 0) {
          console.log(`  requirements: ${svc.name} — nothing to merge (delta leaves no requirements), no living spec created`);
          continue;
        }
        const frontmatter = `---\nservice: ${svc.name}\nstatus: draft\n---\n\n# ${svc.name}\n\n`;
        writes.push({ path: livingPath, content: `${frontmatter}## Requirements\n\n${serializeRequirements(created)}` });
        console.log(`  requirements: ${svc.name} — created living spec (${created.length} requirement(s))`);
        continue;
      }
      const livingText = await readFile(livingPath, "utf8");
      const { intro, reqs: livingReqs } = splitSpec(livingText);
      const merged = applyRequirementDelta(livingReqs, deltaReqs);
      writes.push({ path: livingPath, content: `${intro.trimEnd()}\n\n## Requirements\n\n${serializeRequirements(merged)}` });

      const c = summarize(deltaReqs);
      console.log(`  requirements: ${svc.name} ← +${c.ADDED} ~${c.MODIFIED} -${c.REMOVED} (now ${merged.length} total)`);
    }
  }

  // 1b. OpenAPI merge — fold the feature's openapi deltas into the living service APIs.
  if (existsSync(specsDir)) {
    const svcs = (await readdir(specsDir, { withFileTypes: true })).filter((e) => e.isDirectory());
    for (const svc of svcs) {
      const featOpenapi = join(specsDir, svc.name, "openapi.yaml");
      if (!existsSync(featOpenapi)) continue;
      const featText = await readFile(featOpenapi, "utf8");
      const livingOpenapi = join(config.docsDir, "services", svc.name, "openapi.yaml");
      const ops = await operationIds(featOpenapi);
      if (!existsSync(livingOpenapi)) {
        writes.push({ path: livingOpenapi, content: featText });
        console.log(`  openapi: ${svc.name} — created (${ops.join(", ")})`);
      } else {
        const merged = mergeOpenapiPaths(await readFile(livingOpenapi, "utf8"), featText, svc.name);
        if (merged !== null) {
          writes.push({ path: livingOpenapi, content: merged });
          console.log(`  openapi: ${svc.name} — merged (${ops.join(", ")})`);
        }
      }
    }
  }

  // 2. Architecture merge — fold the feature's tagged elements/relationships into the living landscape.
  const deltaLikec4 = join(featureDir, "delta.likec4");
  const landscapePath = join(config.docsDir, "architecture", "landscape.likec4");
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

  // COMMIT — the whole plan computed cleanly; write it out, then archive the feature.
  for (const w of writes) {
    await mkdir(dirname(w.path), { recursive: true });
    await writeFile(w.path, w.content, "utf8");
  }
  await mkdir(archiveDir, { recursive: true });
  await rename(featureDir, archiveDest);
  console.log(`\n  archived: features/${dirName} → features/archive/${dirName}`);
  console.log("  living spec + landscape are now complete + current.");
}

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
 * edge endpoints + op), so re-archiving is idempotent and title strings appearing
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

  // Edges are compared by endpoint TITLES (stable across id namespaces) + op/title.
  const relKey = (els: Elem[], r: Rel): string =>
    [titleOf(els, r.source), titleOf(els, r.target), r.op ?? r.title ?? ""].join(" ");
  const haveRels = new Set(land.relationships.map((r) => relKey(land.elements, r)));
  const addedRels: Rel[] = [];
  for (const r of newRels) {
    const k = relKey(deltaElements, r);
    if (haveRels.has(k)) continue;
    haveRels.add(k);
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

/** Quote a string as LikeC4 source — single-quoted with backslash/apostrophe escapes. */
function lq(s: string): string {
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function elementLines(e: Elem): string[] {
  if (e.description) {
    return [`${e.id} = ${e.kind} ${lq(e.title)} {`, `  description ${lq(e.description)}`, `}`];
  }
  return [`${e.id} = ${e.kind} ${lq(e.title)}`];
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

async function findFeatureDirName(featuresDir: string, featureId: string): Promise<string | null> {
  if (!existsSync(featuresDir)) return null;
  const entries = await readdir(featuresDir, { withFileTypes: true });
  const match = entries.find(
    (e) => e.isDirectory() && (e.name === featureId || e.name.startsWith(featureId + "-")),
  );
  return match ? match.name : null;
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
