/**
 * An authored view id that collides with one loam GENERATES into
 * `architecture/subsystems.likec4`.
 *
 * This closes a green-while-broken hole, and the shape of it is measured rather
 * than argued. The LikeC4 renderer merges every `.likec4` file in a project into
 * one model, and `architecture/landscape.likec4` and the generated
 * `architecture/subsystems.likec4` are two documents of the ROOT project — so
 * they share ONE flat view-id namespace. (This file used to say the reason was
 * that `likec4.config.json` scopes the root project to `architecture/`; it does
 * not, and never had to for the collision to exist. The scaffold's `exclude`
 * names `features/**` and node_modules, and a fleet whose models extend the map
 * has `services/` in the root project too — see `./fleet-project.ts`.) Author
 * `view subsystem_commerce { }` in the landscape while the tree has a `commerce`
 * subsystem and the renderer refuses the ENTIRE root project with two
 * `Duplicate view` diagnostics, one per file — while `loam validate --all`
 * printed `landscape: N service(s) modelled — architecture/landscape.likec4 and
 * services/ agree`. Reproduced at the 1.59.2 pin.
 *
 * WHICH DOCUMENTS CLAIM IDS IN THAT NAMESPACE, corrected. A duplicate INSIDE one
 * document is already 2 LikeC4 errors, so `landscape.invalid` has it (measured).
 * A feature's `delta.likec4` is its own LikeC4 project — the root excludes
 * `features/**` — and a delta's views never travel through `archive` anyway. A
 * service's `model.likec4` used to be in the same position and no longer is:
 * this file's original premise, that `likec4.config.json` excludes `services/**`
 * so a model's view ids cannot collide with the landscape's, holds only for a
 * model that STANDS ALONE. A model that EXTENDS the map lives in the root
 * project beside it, so its authored view ids — and those of every `.likec4`
 * beside it — share exactly this namespace. That census is made by the merged
 * load in `./fleet-project.ts` and handed here; the landscape's own claims are
 * still graded from the `architecture/` project, which is the only census a run
 * with no extending model can make.
 *
 * The claims therefore arrive spelled DOCS-RELATIVE, and the caller does the
 * spelling: the `architecture/` project reports a view's `sourcePath` relative
 * to `architecture/`, the merged project reports it relative to the docs root,
 * and a prefix pasted on here would name `architecture/services/…` for every
 * model. The message and the location both print the path verbatim.
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
import type { ViewIdClaim } from "../../../../core/c4/parsed/view-ids.js";
import { SUBSYSTEM_VIEW_PREFIX, subsystemViewId } from "../../../../core/repo/tree/render/views.js";
import type { FleetTree } from "../../../../core/repo/tree/walk.js";
import type { Finding } from "../../../../core/vocabulary/report.js";

/**
 * `authored` is every view id the project claims, each with the DOCS-RELATIVE
 * path of the file that claims it — static views included, because a static view
 * claims an id exactly as firmly as a dynamic one. Absent (the document did not
 * parse, or an older loader did not read them) is treated as "nothing to
 * compare", never as "nothing collides".
 */
export function viewIdFindings(authored: ViewIdClaim[] | undefined, tree: FleetTree): Finding[] {
  if (authored === undefined || authored.length === 0) return [];
  const generated = new Map(tree.subsystems.map((sub) => [subsystemViewId(sub), sub.path.join("/")]));
  const findings: Finding[] = [];
  // Sorted and de-duplicated by id so a project claiming the same id twice —
  // itself already a parse error, but reachable through a partial read — yields
  // one finding per id rather than one per occurrence. The first claimant's file
  // is the one named: with a duplicate the project does not parse at all, so
  // there is never a second one to choose between.
  const claimants = new Map<string, string>();
  for (const claim of authored) if (!claimants.has(claim.id)) claimants.set(claim.id, claim.sourcePath);
  for (const [id, file] of [...claimants].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const owner = generated.get(id);
    if (owner === undefined) continue;
    findings.push({
      severity: "error",
      code: "subsystem.view-id-collision",
      subject: id,
      // The CLAIMANT file — the one the message tells the reader to edit, and
      // the one the report's target fallback gets wrong: it files this under
      // the landscape, which is exactly the file a reader must NOT rename the
      // view in when the claim came from a document of their own.
      locations: [{ path: file, role: "primary" as const }],
      message:
        `subsystems: ${file} declares \`view ${id}\`, which is the id loam generates ` +
        `into architecture/subsystems.likec4 for services/${owner}/ — LikeC4 merges both files into one project, ` +
        // The ROOT project, not `architecture/`: the claimant may be a model's
        // own view now (an extending model is a document of the root project),
        // and telling that author the `architecture/` project is refused sends
        // them to look for the breakage in a directory they never touched.
        `so it refuses the whole root project and renders nothing. ` +
        `Rename the view in ${file}; ids beginning \`${SUBSYSTEM_VIEW_PREFIX}\` are loam's ` +
        "to mint, and architecture/subsystems.likec4 is generated (`loam subsystem sync`) and must never be hand-edited.",
    });
  }
  return findings;
}
