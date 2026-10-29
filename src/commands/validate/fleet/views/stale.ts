/**
 * Staleness of the GENERATED documents under `architecture/` against the tree
 * and the map: ONE error per stale file, naming that file, repaired by exactly
 * one command (`loam subsystem sync`).
 *
 * TWO FILES, ONE CODE, and that is a decision rather than an omission.
 * `subsystems.likec4` (one view per subsystem) and `services.likec4` (one
 * overview view per service the map draws) are written by the same command in
 * the same commit, drift for overlapping reasons — a `subsystem move` restales
 * both, because a per-service view's title is `<subsystem path> / <service
 * id>` — and are repaired by the same run. A second code would buy a reader
 * nothing the `subject` and the message do not already say, and every code costs
 * a row in `core/agent/workflows/check.ts`, a `loam explain` entry and a place in
 * the vocabulary. What DOES have to stay apart is which file drifted, so the two
 * are graded separately and each finding carries its own path — folding them
 * into one finding would lose the only thing the message has to say.
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
 * `core/repo/tree/render/stale.ts` both performs it and records why: an ordinary
 * Windows clone hands this file back with CRLF and not one fact in it changed,
 * and under a byte compare the advertised repair is a loop rather than a
 * diagnosis. The rule lives in the render package because the package that mints
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
import { serviceViewsPath, subsystemViewsPath } from "../../../../core/repo/paths.js";
import { serviceViewsState, viewsState, type ViewsState } from "../../../../core/repo/tree/render/stale.js";
import type { MapFacts } from "../../../../core/repo/tree/render/views.js";
import type { FleetTree } from "../../../../core/repo/tree/walk.js";
import type { Finding } from "../../../../core/vocabulary/report.js";

export async function viewsStaleFindings(docsDir: DocsDir, tree: FleetTree, map: MapFacts): Promise<Finding[]> {
  const subsystems = await viewsState(subsystemViewsPath(docsDir), tree, map);
  const services = await serviceViewsState(serviceViewsPath(docsDir), tree, map);
  return [
    ...staleFinding(subsystems, {
      file: "architecture/subsystems.likec4",
      absent: "does not exist, but the tree has subsystems to mirror",
      leftover: "exists, but the tree has no subsystems — the generated file must be absent",
      what: "one view per subsystem, and every derived scope drawn from it is wrong until it agrees",
    }),
    ...staleFinding(services, {
      file: "architecture/services.likec4",
      absent: "does not exist, but the fleet map draws services this file must mirror",
      leftover:
        "exists, but the fleet map draws none of the services under services/ — the generated file must be absent",
      what:
        "one overview view per service the map draws, and every drill-down into a service goes through it, so a " +
        "reader following the map lands on a picture that is wrong until it agrees",
    }),
  ];
}

/** The four sentences one file's finding differs by — the rest of it is shared. */
interface StaleFile {
  /** The docs-relative path, which is the subject, the location and the head of the message. */
  file: string;
  /** Why an absent file is stale. */
  absent: string;
  /** Why a present file that must not exist is stale. */
  leftover: string;
  /** What the file holds, and what is wrong while it disagrees. */
  what: string;
}

/**
 * One finding, or none — the shape both generated files share, spelled once so
 * they cannot drift into two dialects of the same sentence.
 */
function staleFinding(state: ViewsState, file: StaleFile): Finding[] {
  if (state.agrees) return [];
  const said =
    state.actual === null ? file.absent : state.expected === null ? file.leftover : "does not match the tree and the map";
  return [
    {
      severity: "error",
      code: "subsystem.views-stale",
      subject: file.file,
      // The file the message names, so an editor jumping to the finding lands
      // on it. Without a location the report's fallback files this under the
      // TARGET, which is the landscape — a reader was sent to
      // architecture/landscape.likec4 to fix a file the sentence beside it
      // named as architecture/subsystems.likec4.
      //
      // A file that does not exist yet is `primary` too, with the directory
      // after it as its scope. It used to be the directory alone, on the
      // argument that a `primary` should point at something; but a reader — an
      // editor, a CI annotation, an agent reading `locations[0]` — was then
      // sent to `architecture/` to find out which of its files the finding
      // meant, when the finding is about one path, and that path is exactly
      // where `loam subsystem sync` will write.
      locations: state.actual === null
        ? [{ path: file.file, role: "primary" as const }, { path: "architecture", role: "scope" as const }]
        : [{ path: file.file, role: "primary" as const }],
      message:
        `subsystems: ${file.file} ${said} — it is generated, ${file.what}. ` +
        "Run `loam subsystem sync` to regenerate it; never edit it by hand.",
    },
  ];
}
