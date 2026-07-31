import type { Command } from "commander";
import { existsSync } from "node:fs";
import { readFile, writeFile, readdir, mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../core/config.js";
import { loadFile, type Elem, type Rel } from "../core/likec4.js";
import {
  parseRequirements,
  serializeRequirements,
  applyRequirementDelta,
  type Requirement,
} from "../core/spec.js";

export function registerArchive(program: Command): void {
  program
    .command("archive")
    .argument("<featureId>", "feature id, e.g. FEAT-101")
    .description("Merge a shipped feature's deltas into the living specs + model, then archive it")
    .action(async (featureId: string) => {
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
      console.log(`archive ${featureId}\n`);

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
            // New service — create its living spec from the ADDED requirements.
            const created = applyRequirementDelta([], deltaReqs);
            await mkdir(join(config.docsDir, "services", svc.name), { recursive: true });
            const frontmatter = `---\nservice: ${svc.name}\nstatus: draft\n---\n\n# ${svc.name}\n\n`;
            await writeFile(livingPath, `${frontmatter}## Requirements\n\n${serializeRequirements(created)}`, "utf8");
            console.log(`  requirements: ${svc.name} — created living spec (${created.length} requirement(s))`);
            continue;
          }
          const livingText = await readFile(livingPath, "utf8");
          const { intro, reqs: livingReqs } = splitSpec(livingText);
          const merged = applyRequirementDelta(livingReqs, deltaReqs);
          const newText = `${intro.trimEnd()}\n\n## Requirements\n\n${serializeRequirements(merged)}`;
          await writeFile(livingPath, newText, "utf8");

          const c = summarize(deltaReqs);
          console.log(`  requirements: ${svc.name} ← +${c.ADDED} ~${c.MODIFIED} -${c.REMOVED} (now ${merged.length} total)`);
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
            const added = await mergeIntoLandscape(landscapePath, newEls, newRels);
            console.log(`\n  architecture: merged into landscape.likec4 — +${added} element(s), +${newRels.length} relationship(s)`);
            for (const e of newEls) console.log(`      + ${e.title} (${e.kind})`);
            for (const r of newRels) {
              console.log(`      + ${titleOf(elements, r.source)} -> ${titleOf(elements, r.target)}  "${r.title ?? ""}"`);
            }
          } else {
            console.log(`\n  architecture: no landscape.likec4 — ${newEls.length} element(s) not merged`);
          }
        }
      }

      // 3. Archive the feature — the diff is now part of the living (final) spec.
      const archiveDir = join(featuresDir, "archive");
      await mkdir(archiveDir, { recursive: true });
      await rename(featureDir, join(archiveDir, dirName));
      console.log(`\n  archived: features/${dirName} → features/archive/${dirName}`);
      console.log("  living spec + landscape are now complete + current.");
    });
}

/**
 * Surgically insert the feature's new elements + relationships into the living
 * landscape's `model { ... }` block (preserving the rest of the file). Feature tags
 * are dropped — the additions are now part of the baseline. Returns elements added.
 * Assumes the delta reuses the landscape's element identifiers for existing services.
 */
async function mergeIntoLandscape(landscapePath: string, newEls: Elem[], newRels: Rel[]): Promise<number> {
  let text = await readFile(landscapePath, "utf8");
  const lines: string[] = [];
  let added = 0;
  for (const e of newEls) {
    if (elementExists(text, e)) continue;
    lines.push(...elementLines(e));
    added += 1;
  }
  for (const r of newRels) lines.push(relLine(r));
  if (lines.length > 0) {
    text = insertIntoModelBlock(text, lines);
    await writeFile(landscapePath, text, "utf8");
  }
  return added;
}

function elementExists(text: string, e: Elem): boolean {
  return text.includes(`${e.id} =`) || text.includes(`'${e.title}'`);
}

function elementLines(e: Elem): string[] {
  if (e.description) {
    return [`${e.id} = ${e.kind} '${e.title}' {`, `  description '${e.description}'`, `}`];
  }
  return [`${e.id} = ${e.kind} '${e.title}'`];
}

function relLine(r: Rel): string {
  return `${r.source} -> ${r.target}${r.title ? ` '${r.title}'` : ""}`;
}

function insertIntoModelBlock(text: string, lines: string[]): string {
  const m = /\bmodel\s*\{/.exec(text);
  if (!m) throw new Error("landscape.likec4 has no model block");
  let depth = 0;
  let close = -1;
  for (let i = m.index + m[0].length - 1; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
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
