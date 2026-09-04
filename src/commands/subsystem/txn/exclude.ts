/**
 * The ROOT `likec4.config.json`'s `exclude` list, as `loam subsystem sync`
 * derives it from the shapes on disk.
 *
 * It sits beside `./views.ts` for that module's reason and by the same seam:
 * both answer "what should this renderer-only file say, given the tree?", both
 * are pure derivations one command writes, and keeping them together is what
 * stops the writer and the grader spelling one rule twice. The difference is
 * ownership, and it is stated in `core/c4/service-model/renderer.ts`: every byte
 * of the generated views file is loam's, while this file is the team's and loam
 * maintains exactly the `services/` entries in it. What an entry COVERS is
 * `core/c4/root-project/exclude.ts`'s question, asked of the directory the entry
 * names rather than of its spelling.
 *
 * It is a module rather than three functions in `../sync.ts` because that file
 * reached its line limit carrying them, and this is the phase boundary inside
 * it: `sync.ts` is the lock, the transaction and the report; this is one of the
 * three things it decides to write.
 */
import { readFile } from "node:fs/promises";
import { excludingEntry, parseRootProject, readRootExclude } from "../../../core/c4/root-project/exclude.js";
import { standaloneExclude } from "../../../core/c4/service-model/renderer.js";
import { serviceTreePath, type DocsDir } from "../../../core/kernel/ids/dirs.js";
import { rootProjectPath } from "../../../core/repo/paths.js";
import type { SurveyedModel } from "../../../core/repo/tree/render/projects.js";
import type { WalkedService } from "../../../core/repo/tree/walk.js";
import { planWrite, type PlannedWrite } from "../../../core/staging/writes.js";

/** What one sync did to the ROOT project's `exclude` list. */
export interface ExcludePlan {
  /** Whether this run rewrites the list. */
  updated: boolean;
  /** The list as it stands after this run — the current one when nothing changed. */
  entries: string[];
  added: string[];
  removed: string[];
  /** The rewrite, staged with everything else. Null when nothing is owed. */
  write: PlannedWrite | null;
  /** The root file exists and loam could not read an `exclude` list out of it — reported, never rewritten. */
  unreadable: boolean;
}

/** The answer for a run that has no root file to read, and the shape every other arm fills. */
export const NO_EXCLUDE: ExcludePlan = {
  updated: false,
  entries: [],
  added: [],
  removed: [],
  write: null,
  unreadable: false,
};

/**
 * The root project's `exclude` list, recomputed from the shapes on disk.
 *
 * WHAT MAKES THIS SAFE TO RUN ON EVERY SYNC is the split `standaloneExclude`
 * enforces: the `services/` half of the list is loam's and every other entry is
 * the team's, kept in order. The scaffold's node_modules glob, `features/**`, a
 * team's own `drafts/**` all survive; only the entries that decide whether a
 * model is renderable are derived. A standalone model MUST be excluded (inside
 * the root project every kind it declares is a duplicate blamed on the map as
 * well) and an extending model must NOT be (the root project is the only place
 * it parses), so a service that migrates from one shape to the other has its
 * entry added or dropped on the next sync instead of quietly blanking a project.
 *
 * THE GATE keeps an old repository untouched. A fleet whose models all stand
 * alone and whose root already says `services/**` is already correct, and
 * rewriting it into one entry per service would be a diff with no fact behind
 * it — so the rewrite happens only when at least one model extends the map (the
 * blanket exclusion is then wrong) or some standalone model is not covered at
 * all (the renderer is merging it into the map right now). Comparing the parsed
 * ARRAYS rather than the bytes is the second half of the same rule: a file whose
 * `exclude` already says what this run would write is left exactly as the team
 * formatted it.
 *
 * A root config loam cannot read an `exclude` list out of is REPORTED and never
 * rewritten. Guessing at the JSON a team hand-wrote is how a writer destroys a
 * file it did not understand.
 */
export async function planExclude(
  docsDir: DocsDir,
  services: readonly WalkedService[],
  models: readonly SurveyedModel<WalkedService>[],
): Promise<ExcludePlan> {
  const current = await readRootExclude(docsDir);
  if (current === null) return { ...NO_EXCLUDE, unreadable: true };
  const standalone = models.filter((m) => m.standalone).map((m) => serviceTreePath(m.service));
  // Both halves of the shape scan travel, not just the standalone one: an entry
  // is loam's to take back either because loam wrote it (a tree the enumeration
  // returns) or because it HIDES a model that only parses in the root project,
  // and only the extending list can answer the second question. Without it a
  // subsystem-wide `services/platform/**` survived every sync while
  // `service.model-excluded` named that same sync as the repair.
  const extending = models.filter((m) => !m.standalone).map((m) => serviceTreePath(m.service));
  const wanted = standaloneExclude(current, {
    standalone,
    extending,
    enumerated: services.map((svc) => serviceTreePath(svc)),
  });
  const uncovered = standalone.some((tree) => excludingEntry(current, tree) === null);
  if (extending.length === 0 && !uncovered) return { ...NO_EXCLUDE, entries: [...current] };
  if (current.length === wanted.length && current.every((entry, i) => entry === wanted[i])) {
    return { ...NO_EXCLUDE, entries: wanted };
  }
  const bytes = await rewrittenRootProject(docsDir, wanted);
  if (bytes === null) return { ...NO_EXCLUDE, entries: [...current], unreadable: true };
  return {
    updated: true,
    entries: wanted,
    added: wanted.filter((entry) => !current.includes(entry)),
    removed: current.filter((entry) => !wanted.includes(entry)),
    // `planWrite` decides create-vs-overwrite from the filesystem, so the root
    // file — which by definition already exists here — is staged as an
    // OVERWRITE, and `swapStaged` compares it against its pre-image immediately
    // before the rename: a team member editing the same file during the sync
    // stops the commit instead of having their bytes buried.
    write: planWrite(rootProjectPath(docsDir), bytes),
    unreadable: false,
  };
}

/**
 * The root project file with its `exclude` replaced and NOTHING else touched —
 * every other key kept, in the order the team wrote them, re-serialised as
 * 2-space JSON with a trailing newline (`core/docs.ts`'s own form, so a
 * scaffolded file round-trips byte for byte).
 *
 * Null when the file stopped being a JSON object between `readRootExclude` and
 * here, which is a concurrent edit rather than a state loam may write over.
 */
async function rewrittenRootProject(docsDir: DocsDir, exclude: readonly string[]): Promise<string | null> {
  let text: string;
  try {
    text = await readFile(rootProjectPath(docsDir), "utf8");
  } catch {
    // Unreadable is not "excludes nothing": the caller reports it and writes
    // nothing at all.
    return null;
  }
  // The SAME parse the grader read the list with — `parseRootProject`, which
  // tolerates the byte-order mark PowerShell's `Out-File` writes. Two parses
  // would mean a run that read an `exclude` here and then declared the file
  // unreadable at the write, which is exactly what a BOM produced before
  // (re-verification 2026-09-04, area C item 3). Re-read rather than carried:
  // the point of this read is that it happens immediately before the swap.
  const parsed = parseRootProject(text);
  if (parsed === null) return null;
  return `${JSON.stringify({ ...parsed, exclude: [...exclude] }, null, 2)}\n`;
}
