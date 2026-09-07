/**
 * `architecture/services.likec4` — one generated LikeC4 view per service,
 * showing that service, its own interior, and its links to everything else the
 * fleet map draws.
 *
 * GENERATED, never authored, exactly like the subsystem views beside it:
 * authored bytes stay authored (archive's verbatim-splice promise), `loam
 * subsystem sync` owns this file outright, and staleness against the tree is a
 * content compare and never a parse — a views-only document does not parse
 * standalone, so nothing in loam ever loads it. docs/DESIGN.md rule 26 does not
 * change with a second file: what a view SHOWS stays unread in every document,
 * this one included.
 *
 * ## The recipe, and why the obvious one is wrong
 *
 * Measured at likec4 1.59.2 on a 120-service and a 58-service fleet. Each view
 * is written as
 *
 *     view service_<id> of <fqn> {
 *       title '<subsystem path> / <service id>'
 *       global style services          // only when the map declares the group
 *       include *                      // the service and its own interior
 *       include <peer>                 // one line per peer, id-sorted
 *       exclude * -> *                 // drop the peer-to-peer cross traffic
 *       include -> <fqn>               // its inbound edges
 *       include <fqn> ->               // its outbound edges
 *       include <fqn>.* -> <fqn>.*     // its internal wiring
 *     }
 *
 * Three things in that shape are measurements rather than taste, and each one
 * fails SILENTLY — zero errors, a wrong picture — if it is tidied away:
 *
 *  1. **The peers are named, not wildcarded.** `./peers.ts` carries the
 *     measurement: `include <fqn> -> *` collapses every counterpart to its
 *     GROUP box and yields zero drill-down on any map that nests services.
 *  2. **The edge predicates are UNARY.** `include -> <fqn>` and `include <fqn>
 *     ->`, never the binary `include * -> <fqn>` / `include <fqn> -> *`.
 *     Measured on `payments.svc0` of the 58-service fleet, swapping the two
 *     unary lines for their binary forms takes the view from 11 nodes to 15:
 *     the four parent GROUP boxes of the named peers come back as nodes of
 *     their own, so the view regrows exactly what rule 1 removed. Zero errors
 *     either way, which is what makes it worth a comment.
 *  3. **`exclude * -> *` sits between the includes and the edge lines.** Without
 *     it the named peers bring their own cross traffic with them: on the same
 *     subject, 24 edges instead of 9, on a view about one service.
 *
 * `of <fqn>` is the navigation half and costs one keyword: LikeC4 computes
 * `navigateTo` into a view declared `of` an element from every OTHER view that
 * draws that element, with no authored links. That is what makes the fleet map,
 * every subsystem view and every other service view click-through into a
 * service. Two views of one element are legal — the first document
 * alphabetically wins the default target and both stay reachable, because the
 * subject's own node cycles to the other — so a team's authored element view in
 * `landscape.likec4` keeps precedence over this file, which sorts later.
 *
 * ## What arrives from outside
 *
 * Everything about the TREE — which services exist, what each one's element is,
 * what its title reads — arrives composed, in `ServiceViewSubject`. This package
 * may not import `../views.ts` or `../text.ts`: the parent imports it, and the
 * reverse edge would be the package cycle `scripts/package-graph.mjs` refuses.
 * So the title arrives already through `likec4String` rather than escaped a
 * second time here; a second escaper is how one of the two forgets an
 * apostrophe and ships a fleet-wide parse error.
 */
import type { Rel } from "../../../../c4/likec4.js";
import { GENERATED_MARK } from "./header.js";
import { peersOf } from "./peers.js";
import { serviceViewId } from "./view-id.js";

/**
 * The global style group these views reference when the map declares one, the
 * exact counterpart of `SUBSYSTEM_STYLE_GROUP` and reserved on the same terms:
 * presence of the DECLARATION is the whole opt-in, because referencing an
 * undeclared style id is a parse error that blanks the entire `architecture/`
 * project in the renderer. The name mirrors the file it styles.
 */
export const SERVICE_STYLE_GROUP = "services";

/** One service this file draws — resolved against the map, and already escaped. */
export interface ServiceViewSubject {
  /** The `services/<id>/` directory id: the sort key and the view id's source. */
  id: string;
  /** The landscape element it resolves to — the view's `of`, and its subject. */
  fqn: string;
  /** `<subsystem path> / <service id>`, already through `likec4String`. */
  title: string;
}

/** Everything the file render reads, as one record — see the banner on why it arrives composed. */
export interface ServiceViewsInput {
  subjects: readonly ServiceViewSubject[];
  /** The map's edges, from which each subject's peer set is computed. */
  relationships: readonly Rel[];
  /** Emit `global style services` — true only when the map DECLARES that group. */
  styled: boolean;
  /** The one file-level comment the render may write, or null. */
  disclosure: string | null;
}

/**
 * The header every generated file opens with — stable bytes, part of the
 * content-compare contract, naming the regenerator so a reader who found the
 * file before the docs knows what owns it. `loam subsystem sync` regenerates
 * BOTH generated files, which is why one command is named here and why one
 * finding code (`subsystem.views-stale`) honestly covers both.
 *
 * It OPENS with the shared `GENERATED_MARK` rather than spelling it, because
 * the same bytes are what `loam subsystem sync` reads back off disk to decide
 * whether the file at this reserved path is loam's to rewrite at all
 * (`./header.js`). A second literal here is how a file loam wrote stops being
 * recognised as loam's.
 */
const HEADER =
  `${GENERATED_MARK} — one overview view per service under services/, drawn from the fleet map.\n` +
  "// Do not edit: `loam subsystem sync` regenerates this file from the directories and the map,\n" +
  "// and `loam validate --all` reports `subsystem.views-stale` when it drifts.\n" +
  "// A navigation aid, not the fleet's architecture: author your own diagrams elsewhere.\n";

/**
 * Render the whole file, or null when no service resolves to a map element —
 * the file must then be ABSENT, so a fleet whose map draws nothing never
 * carries a generated artifact that says nothing.
 *
 * Services sorted by id and peers sorted by id, one `include` per line: the
 * output is byte-reproducible on any machine from the same committed bytes (no
 * timestamps, no absolute paths, no readdir-order dependence), and two
 * concurrent changes to different services touch different lines, so git merges
 * the file without intervention.
 */
export function renderServiceViews(input: ServiceViewsInput): string | null {
  if (input.subjects.length === 0) return null;
  const lines: string[] = [HEADER, ...(input.disclosure === null ? [] : [input.disclosure]), "views {"];
  const subjects = [...input.subjects].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const [i, subject] of subjects.entries()) {
    if (i > 0) lines.push("");
    lines.push(...viewLines(subject, peersOf(subject.fqn, input.relationships), input.styled));
  }
  lines.push("}");
  return lines.join("\n") + "\n";
}

/**
 * One view, in the order the parser demands: metadata FIRST, and that is a hard
 * constraint rather than a taste — measured, an `include` line followed by
 * `title` is a parse error ("Expecting token of type '}' but found `title`"),
 * and one parse error in this file blanks the whole `architecture/` project in
 * the renderer. `global style` sits after `title` and before anything that
 * includes, where the same pin measured it parsing with zero errors.
 */
function viewLines(subject: ServiceViewSubject, peers: readonly string[], styled: boolean): string[] {
  const { fqn } = subject;
  const out = [`  view ${serviceViewId(subject.id)} of ${fqn} {`, `    title '${subject.title}'`];
  if (styled) out.push(`    global style ${SERVICE_STYLE_GROUP}`);
  out.push("    include *");
  for (const peer of peers) out.push(`    include ${peer}`);
  out.push("    exclude * -> *", `    include -> ${fqn}`, `    include ${fqn} ->`);
  // The interior wiring, last. Measured: `include <fqn>.* -> <fqn>.*` on a
  // CHILDLESS element is legal — `likec4 validate` reports valid and the export
  // carries zero errors — so one generated line serves both model shapes: an
  // EXTENDING model's containers live in the root project and are drawn, a
  // STANDALONE model's are not in this project and the line matches nothing.
  out.push(`    include ${fqn}.* -> ${fqn}.*`, "  }");
  return out;
}
