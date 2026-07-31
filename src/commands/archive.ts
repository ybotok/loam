import type { Command } from "commander";
import { existsSync } from "node:fs";
import { readFile, writeFile, readdir, mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../core/config.js";
import { loadFile, type Elem } from "../core/likec4.js";
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

      // 2. Architecture merge — reported for now (auto-merge into landscape is the next step).
      const deltaLikec4 = join(featureDir, "delta.likec4");
      if (existsSync(deltaLikec4)) {
        const { errors, elements, relationships } = await loadFile(deltaLikec4);
        if (errors.length === 0) {
          const newEls = elements.filter((e) => e.tags.includes(featureId));
          const newRels = relationships.filter((r) => r.tags.includes(featureId));
          console.log(`\n  architecture: ${newEls.length} element(s) + ${newRels.length} relationship(s) to fold into landscape:`);
          for (const e of newEls) console.log(`      + ${e.title} (${e.kind})`);
          for (const r of newRels) {
            console.log(`      + ${titleOf(elements, r.source)} -> ${titleOf(elements, r.target)}  "${r.title ?? ""}"`);
          }
          console.log("    (C4 auto-merge into landscape.likec4 is the remaining piece — apply manually for now)");
        }
      }

      // 3. Archive the feature — the diff is now part of the living (final) spec.
      const archiveDir = join(featuresDir, "archive");
      await mkdir(archiveDir, { recursive: true });
      await rename(featureDir, join(archiveDir, dirName));
      console.log(`\n  archived: features/${dirName} → features/archive/${dirName}`);
      console.log("  living spec is now complete + current.");
    });
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
