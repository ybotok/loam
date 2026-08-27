/**
 * An authored view id that collides with one loam GENERATES into
 * `architecture/subsystems.likec4`.
 *
 * This closes a green-while-broken hole, and the shape of it is measured rather
 * than argued. The LikeC4 renderer merges every `.likec4` file in a project into
 * one model, and `likec4.config.json` scopes the root project to
 * `architecture/` — so `landscape.likec4` and the generated `subsystems.likec4`
 * share ONE flat view-id namespace. Author `view subsystem_commerce { }` in the
 * landscape while the tree has a `commerce` subsystem and the renderer refuses
 * the ENTIRE `architecture/` project with two `Duplicate view` diagnostics, one
 * per file — while `loam validate --all` printed `landscape: N service(s)
 * modelled — architecture/landscape.likec4 and services/ agree`. Reproduced at
 * the 1.59.2 pin.
 *
 * Nothing else in a loam repo can produce this. A duplicate INSIDE one document
 * is already 2 LikeC4 errors, so `landscape.invalid` has it (measured). A
 * service's `model.likec4` and a feature's `delta.likec4` are each their own
 * LikeC4 project — `likec4.config.json` excludes `services/**` and
 * `features/**` from the root — so their view ids cannot collide with the
 * landscape's, and a delta's views never travel through `archive` anyway. That
 * leaves exactly one pair, which is why this check compares exactly one pair
 * rather than taking a census across every document loam parses.
 *
 * ONLY the real collision is refused, never the merely reserved-looking name.
 * A landscape view called `subsystem_overview` with no `overview` subsystem
 * breaks nothing today, and refusing it would be loam inventing a rule about a
 * name that harms no one. The latent case is not lost: the moment somebody
 * creates that subsystem, the generator mints the id, and this same check fires
 * on the same run. The message names the reservation anyway, so an author fixing
 * one collision learns not to make the next.
 *
 * Graded on `validate --all` only, and the caller holds that gate together with
 * the landscape-parsed one: under a single-target run the fleet tree is not
 * walked and the generated ids are unknown, so the question is unanswerable and
 * the check stays silent rather than half-answering.
 */
import { SUBSYSTEM_VIEW_PREFIX, subsystemViewId } from "../../../../core/repo/tree/views.js";
import type { FleetTree } from "../../../../core/repo/tree/walk.js";
import type { Finding } from "../../../../core/vocabulary/report.js";

/**
 * `authored` is the landscape's own view ids — every view it declares, static
 * ones included, because a static view claims an id exactly as firmly as a
 * dynamic one. Absent (the document did not parse, or an older loader did not
 * read them) is treated as "nothing to compare", never as "nothing collides".
 */
export function viewIdFindings(authored: string[] | undefined, tree: FleetTree): Finding[] {
  if (authored === undefined || authored.length === 0) return [];
  const generated = new Map(tree.subsystems.map((sub) => [subsystemViewId(sub), sub.path.join("/")]));
  const findings: Finding[] = [];
  // Sorted and de-duplicated so a landscape claiming the same id twice — itself
  // already `landscape.invalid`, but reachable through a partial read — yields
  // one finding per id rather than one per occurrence.
  for (const id of [...new Set(authored)].sort()) {
    const owner = generated.get(id);
    if (owner === undefined) continue;
    findings.push({
      severity: "error",
      code: "subsystem.view-id-collision",
      subject: id,
      message:
        `subsystems: architecture/landscape.likec4 declares \`view ${id}\`, which is the id loam generates ` +
        `into architecture/subsystems.likec4 for services/${owner}/ — LikeC4 merges both files into one project, ` +
        `so it refuses the whole architecture/ project and renders nothing. ` +
        `Rename the view in architecture/landscape.likec4; ids beginning \`${SUBSYSTEM_VIEW_PREFIX}\` are loam's ` +
        "to mint, and architecture/subsystems.likec4 is generated (`loam subsystem sync`) and must never be hand-edited.",
    });
  }
  return findings;
}
