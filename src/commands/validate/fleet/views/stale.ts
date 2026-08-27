/**
 * Staleness of the GENERATED `architecture/subsystems.likec4` against the
 * tree: exactly ONE error on exactly one file, repaired by exactly one
 * command (`loam subsystem sync`).
 *
 * A byte compare, deliberately — never a parse. A views-only document does
 * not parse standalone (its `include` lines reference elements the landscape
 * defines; the spike in `core/repo/tree/views.ts` records it), and no check
 * anywhere reads the file's CONTENT: the file is a scoping convenience for
 * the LikeC4 renderer, so the only question loam owes it is "are these the
 * bytes the tree renders to". Rule 26 leaves this untouched: what loam may
 * read is a `dynamic view`'s declared steps out of a document it already
 * parses — never a static view's `include` predicates, and never this
 * generated file at all. Absent counts as a state of its own: a fleet
 * with subsystems and no file is stale, and a fleet with NO subsystems and a
 * leftover file is stale too — the render contract says the file must then
 * not exist, or a group deleted months ago keeps a view forever.
 *
 * Graded only when the landscape PARSED (the caller holds that gate): the
 * expected bytes resolve members through the landscape's element→service
 * join, and grading them against a map that is missing or unreadable would
 * cascade a second error behind `landscape.missing`/`landscape.invalid`,
 * pointing at a file whose repair command would only re-derive the same
 * incomplete answer.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { Elem } from "../../../../core/c4/likec4.js";
import type { DocsDir } from "../../../../core/kernel/ids/dirs.js";
import { subsystemViewsPath } from "../../../../core/repo/paths.js";
import { renderSubsystemViews } from "../../../../core/repo/tree/views.js";
import type { FleetTree } from "../../../../core/repo/tree/walk.js";
import type { Finding } from "../../../../core/vocabulary/report.js";

export async function viewsStaleFindings(
  docsDir: DocsDir,
  tree: FleetTree,
  elements: Elem[],
): Promise<Finding[]> {
  const path = subsystemViewsPath(docsDir);
  const expected = renderSubsystemViews(tree, elements);
  const actual = existsSync(path) ? await readFile(path, "utf8") : null;
  if (actual === expected) return [];
  const state =
    actual === null
      ? "does not exist, but the tree has subsystems to mirror"
      : expected === null
        ? "exists, but the tree has no subsystems — the generated file must be absent"
        : "does not match the tree";
  return [
    {
      severity: "error",
      code: "subsystem.views-stale",
      subject: "architecture/subsystems.likec4",
      message:
        `subsystems: architecture/subsystems.likec4 ${state} — ` +
        `it is generated, one view per subsystem, and every derived scope drawn from it is wrong until it agrees. ` +
        "Run `loam subsystem sync` to regenerate it; never edit it by hand.",
    },
  ];
}
