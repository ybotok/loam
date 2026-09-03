/**
 * Staleness of the GENERATED `architecture/subsystems.likec4` against the
 * tree: exactly ONE error on exactly one file, repaired by exactly one
 * command (`loam subsystem sync`).
 *
 * A content compare, deliberately — never a parse. A views-only document does
 * not parse standalone (its `include` lines reference elements the landscape
 * defines; the spike in `core/repo/tree/render/views.ts` records it), and no check
 * anywhere reads the file's MEANING: the file is a scoping convenience for
 * the LikeC4 renderer, so the only question loam owes it is "is this what the
 * tree renders to". Rule 26 leaves this untouched: what loam may
 * read is a `dynamic view`'s declared steps out of a document it already
 * parses — never a static view's `include` predicates, and never this
 * generated file at all. Absent counts as a state of its own: a fleet
 * with subsystems and no file is stale, and a fleet with NO subsystems and a
 * leftover file is stale too — the render contract says the file must then
 * not exist, or a group deleted months ago keeps a view forever.
 *
 * The compare is over CONTENT, not BYTES, and `viewsAgree` in
 * `core/repo/tree/render/views.ts` both performs it and records why: an ordinary
 * Windows clone hands this file back with CRLF and not one fact in it changed,
 * and under a byte compare the advertised repair is a loop rather than a
 * diagnosis. The rule lives beside the generator because the module that mints
 * the bytes is the one that owes an answer about them.
 *
 * Graded only when the landscape PARSED (the caller holds that gate): the
 * expected bytes resolve members through the landscape's element→service
 * join, and grading them against a map that is missing or unreadable would
 * cascade a second error behind `landscape.missing`/`landscape.invalid`,
 * pointing at a file whose repair command would only re-derive the same
 * incomplete answer.
 *
 * The map arrives as the parsed document's facts — its elements AND the
 * global style ids it declares — because the expected bytes now depend on
 * both: a view references `global style subsystems` exactly when the project
 * declares that id, so a fleet that declares it sees this finding once, until
 * the next `sync` writes the line.
 */
import type { DocsDir } from "../../../../core/kernel/ids/dirs.js";
import { subsystemViewsPath } from "../../../../core/repo/paths.js";
import { viewsState } from "../../../../core/repo/tree/render/stale.js";
import type { MapFacts } from "../../../../core/repo/tree/render/views.js";
import type { FleetTree } from "../../../../core/repo/tree/walk.js";
import type { Finding } from "../../../../core/vocabulary/report.js";

export async function viewsStaleFindings(
  docsDir: DocsDir,
  tree: FleetTree,
  map: MapFacts,
): Promise<Finding[]> {
  const { actual, expected, agrees } = await viewsState(subsystemViewsPath(docsDir), tree, map);
  if (agrees) return [];
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
      // The file the message names, so an editor jumping to the finding lands
      // on it. Without a location the report's fallback files this under the
      // TARGET, which is the landscape — a reader was sent to
      // architecture/landscape.likec4 to fix a file the sentence beside it
      // named as architecture/subsystems.likec4. A file that does not exist
      // yet cannot be `primary`: the actionable place is then the directory
      // the regenerator will write into.
      locations: [
        actual === null
          ? { path: "architecture", role: "scope" as const }
          : { path: "architecture/subsystems.likec4", role: "primary" as const },
      ],
      message:
        `subsystems: architecture/subsystems.likec4 ${state} — ` +
        `it is generated, one view per subsystem, and every derived scope drawn from it is wrong until it agrees. ` +
        "Run `loam subsystem sync` to regenerate it; never edit it by hand.",
    },
  ];
}
