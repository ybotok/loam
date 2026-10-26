/**
 * The generated views file: `architecture/subsystems.likec4`, one LikeC4 view
 * per subsystem enumerating the services beneath it. GENERATED, never
 * authored — authored bytes stay authored (archive's verbatim-splice promise),
 * so the tree is mirrored into a file of its own that `loam subsystem sync`
 * owns outright, and staleness against the tree is a byte compare
 * (`subsystem.views-stale` in `validate --all`), never a parse: a spike
 * confirmed a views-only document does NOT parse standalone (its `include`
 * lines reference elements the landscape defines), so nothing in loam ever
 * loads this file (and rule 26 does not change that: this file is GENERATED and
 * holds STATIC views, whose contents loam may not read in any document) — only
 * the LikeC4 renderer, which merges the whole `architecture/` project per
 * likec4.config.json, resolves it.
 *
 * Each view opens with the LABEL a human reads — `title`, and `description`
 * when the marker carries one — because this file exists only to be rendered
 * and an unlabelled view is shown by its id, which is hex-escaped for
 * injectivity and reads as `subsystem_platform__order_2dflow`. Both
 * strings are somebody else's words and go through `likec4String`, which
 * records what a raw one does.
 *
 * The output is deterministic and line-oriented, and both halves are the
 * contract: subsystems sorted by path, members sorted by id, ONE `include`
 * per line — so two concurrent moves into different groups touch different
 * lines and git merges the file without intervention, exactly as the
 * service-grouped landscape splice already achieves. Byte-reproducible on any
 * machine: no timestamps, no absolute paths, no readdir-order dependence (the
 * walk sorts, and every list is re-sorted here). Plain lexicographic sorts on
 * purpose — the ids' own grammar is ASCII, an INVALID name is still ordered
 * deterministically, and `compareIds`' numeric tokenizing lives in `repo/`,
 * which this package must not import (`walk.ts` says why the edge only points
 * the other way).
 *
 * Membership is TRANSITIVE: a subsystem's view includes every service beneath
 * it at any depth, so a parent's view is the whole group's map rather than an
 * empty frame around its children — EXCEPT when the map draws each child as a
 * box of its own directly inside the parent's. Then the parent's view draws
 * each child as that one box and leaves its services to the child's own view
 * (`./body.ts`'s `collapsedBody` has the measurement that decided it). An
 * empty view body is legal LikeC4 (same spike), so an empty subsystem renders
 * as one — `subsystem new` must be usable before anything moves in.
 *
 * Include lines name the landscape ELEMENT id, resolved through the same
 * element→service join `validate` uses (`serviceResolver`: explicit
 * `metadata { service }` binding first, then a title naming a real service) —
 * because element ids in real landscapes are not service ids, and a view of
 * raw service ids would silently render empty for every such fleet. A member
 * with no landscape element is omitted from the includes: the omission is
 * already an error (`landscape.service-unmodelled`), and rendering only what
 * the committed landscape resolves keeps the output a function of committed
 * bytes alone.
 */
import { type LoadedDoc } from "../../../c4/likec4.js";
import { renderContext, viewBody } from "./body.js";
import { GENERATED_MARK } from "./service/header.js";
import { escapeViewIdSegment } from "./service/view-id.js";
import {
  renderServiceViews,
  SERVICE_STYLE_GROUP,
  type ServiceViewSubject,
} from "./service/views.js";
import { likec4String, viewTitle } from "./text.js";
import type { FleetTree, SubsystemEntry } from "../walk.js";

/**
 * The global style group a generated view references when the map declares
 * one: `global { styleGroup subsystems { … } }` (or the single-rule form
 * `global { style subsystems … }` — LikeC4 files both under one id table).
 * Presence is the opt-in and it is read off a DECLARATION, never a view: a
 * generated view cannot carry an inline `style` rule of its own (the file is
 * regenerated wholesale), and the one mechanism LikeC4 offers a view for
 * borrowing a repository's palette is a reference to a global style by id.
 * Referencing one that is not declared is a parse error that blanks the whole
 * `architecture/` project in the renderer, which is why the line is written
 * only when the id is declared and why its absence leaves the file exactly
 * what it was before this constant existed.
 *
 * One conventional name rather than "the single declared group": a second
 * group somebody declares for a hand-drawn view would otherwise silently
 * switch the generated views' styling OFF and restale the file on a change
 * that touched no subsystem — behaviour flipping on an unrelated declaration
 * is the shape `body.ts` calls "a picture that looks the same whether or not
 * the two agree". The name mirrors the file it styles.
 */
export const SUBSYSTEM_STYLE_GROUP = "subsystems";

/**
 * What the render reads off the parsed map: the elements the member join
 * resolves, the RELATIONSHIPS a per-service view computes its peer set from,
 * and the global style ids a view may reference. A record rather than three
 * threaded parameters because all three come out of ONE parsed document, and
 * passing them apart would make an inconsistent pair representable. Every
 * `LoadedDoc` is structurally a `MapFacts`, so a caller holding the document
 * passes the document.
 *
 * `relationships` is REQUIRED, and that is the type doing work rather than a
 * shape falling out of `LoadedDoc`. It was optional once, on the reasoning that
 * the `LoadedDoc` literals standing in for a map that is absent or did not parse
 * have no edges to offer — and the consequence of omitting it is SILENT: every
 * per-service view renders with NO peers, the service and its own interior and
 * nothing it touches, with no error anywhere. Two independent readers found the
 * same caller composing a literal without the field beside a document that
 * carried one (`commands/subsystem/txn/views.ts`'s landscape-only fallback), so
 * documenting the hazard was measurably not enough: a caller with no edges must
 * now say `relationships: []` and mean it, and a caller holding a parsed
 * document passes the document.
 *
 * `globalStyles` stays optional because `LoadedDoc` declares it so and its
 * absence is not silent in the same way: a missing palette costs one `global
 * style` line, which the file-level disclosure comment then names.
 */
export type MapFacts = Pick<LoadedDoc, "elements" | "relationships" | "globalStyles">;

/**
 * The header every generated file opens with — stable bytes, part of the
 * byte-compare contract, naming the regenerator so a reader who found the
 * file first knows what owns it.
 *
 * It OPENS with the shared `GENERATED_MARK` rather than spelling it, because
 * the same bytes are what `loam subsystem sync` reads back off disk to decide
 * whether the file standing at this reserved path is loam's to rewrite at all
 * (`./service/header.ts` carries the whole reason). A second literal here is
 * how a file loam wrote stops being recognised as loam's.
 */
const HEADER =
  `${GENERATED_MARK} — the subsystem tree under services/, one view per subsystem.\n` +
  "// Do not edit: `loam subsystem sync` regenerates this file from the directories,\n" +
  "// and `loam validate --all` reports `subsystem.views-stale` when it drifts.\n" +
  "// A scoping aid, not the fleet's architecture: author your own diagrams elsewhere.\n";

/**
 * The one file-level comment the render may write: the map declares global
 * style groups, and none is the conventional one. Written between `HEADER`
 * and `views {` — outside every view body, graded by nothing — so a team
 * that already declared a palette under another name reads the fix in the
 * diff of the sync that regenerated the file, instead of wondering why the
 * generated views ignore it. Silent when the map declares no group at all: a
 * fleet with no palette is owed no sentence about one. Ids go unescaped
 * because LikeC4's grammar admits only identifier bytes in a style id.
 *
 * The group is a PARAMETER because there are two generated files now and each
 * reserves its own name (`subsystems`, `services`); a map declaring one and not
 * the other must get the sentence in exactly the file that went unstyled.
 */
function stylesDisclosure(declared: readonly string[], group: string): string | null {
  if (declared.length === 0 || declared.includes(group)) return null;
  return (
    `// styles: the project declares global style group(s) ${[...declared].sort().join(", ")}, ` +
    `and none named \`${group}\` — these views carry the renderer's defaults until one is.`
  );
}

/**
 * Render the views file for a walked tree, or null when the tree has no
 * subsystems — the file must then be ABSENT, so a flat fleet never carries a
 * generated artifact that says nothing.
 */
export function renderSubsystemViews(tree: FleetTree, map: MapFacts): string | null {
  if (tree.subsystems.length === 0) return null;
  const ctx = renderContext(tree, map.elements);
  const declared = map.globalStyles ?? [];
  const styled = declared.includes(SUBSYSTEM_STYLE_GROUP);
  const disclosure = stylesDisclosure(declared, SUBSYSTEM_STYLE_GROUP);
  const lines: string[] = [HEADER, ...(disclosure === null ? [] : [disclosure]), "views {"];
  const subsystems = [...tree.subsystems].sort((a, b) => (pathKey(a) < pathKey(b) ? -1 : 1));
  for (const [i, sub] of subsystems.entries()) {
    if (i > 0) lines.push("");
    lines.push(`  // services/${pathKey(sub)}`);
    const body = viewBody(ctx, sub);
    if (body.disclosure !== null) lines.push(`  // ${body.disclosure}`);
    // `of <ancestor>` when — and only when — the map holds an element that owns
    // exactly this subsystem's members (`../render/body.ts` argues the
    // "exactly"). It is the same one keyword the per-service views spend, and it
    // buys the same thing: LikeC4 computes `navigateTo` into this view from
    // every other view that draws that element, so the fleet map's group boxes
    // become click-through and a neighbouring group box inside one subsystem
    // view opens THAT subsystem's view. Measured at 58 services in 11 groups,
    // 12 of 14 nodes navigable. With no owning ancestor there is no element to
    // be `of`, so there is no navigation — honest, and one more reason to nest
    // the map that loam already discloses one line above.
    lines.push(`  view ${subsystemViewId(sub)}${body.of === null ? "" : ` of ${body.of}`} {`);
    // Metadata FIRST, and that ordering is a hard constraint rather than a
    // taste: measured, an `include` OR a `group { … }` line followed by
    // `title` is a parse error ("Expecting token of type '}' but found
    // `title`"), and one parse error in this file blanks the whole
    // `architecture/` project in the renderer.
    lines.push(`    title '${viewTitle(titleChain(tree, sub.path))}'`);
    const description = likec4String(sub.meta.description ?? "");
    if (description !== "") lines.push(`    description '${description}'`);
    // After the label, before anything that includes: measured at the pin
    // (test/likec4-view-shape.test.ts), a `global style <id>` line here
    // parses with zero errors, while the same line before `title` is the
    // parse error the comment above records. The palette is the map's own —
    // the group is declared in the same project this file renders into — so
    // the reference resolves exactly when the presence test says it does.
    if (styled) lines.push(`    global style ${SUBSYSTEM_STYLE_GROUP}`);
    lines.push(...body.lines);
    lines.push("  }");
  }
  lines.push("}");
  return lines.join("\n") + "\n";
}

/**
 * The GENERATED per-service overviews — `architecture/services.likec4`, one
 * view per service the map resolves. Null when it resolves none, so the file is
 * then absent exactly as `subsystems.likec4` is for a tree with no subsystems.
 *
 * This function is the composer and nothing else: `./service/` owns the view
 * shape and its measurements, and everything about the TREE is resolved here,
 * because that package may not import `./body.ts` or `./text.ts` (the edge runs
 * the other way — `./service/views.ts` says why) and duplicating either would
 * put a second element→service join and a second string escaper in the tree.
 *
 * Emission is gated on the SAME join the subsystem views use: a service the map
 * does not draw is omitted rather than invented, because that omission is
 * already `landscape.service-unmodelled` and rendering only what the committed
 * map resolves keeps the output a function of committed bytes alone.
 */
export function renderServiceOverviews(tree: FleetTree, map: MapFacts): string | null {
  const ctx = renderContext(tree, map.elements);
  const declared = map.globalStyles ?? [];
  const subjects: ServiceViewSubject[] = [];
  for (const service of tree.services) {
    const fqn = ctx.elementOf.get(service.id);
    if (fqn === undefined) continue;
    subjects.push({ id: service.id, fqn, title: serviceViewTitle(tree, service.subsystem, service.id) });
  }
  return renderServiceViews({
    subjects,
    relationships: map.relationships,
    elements: map.elements.map((e) => e.id),
    styled: declared.includes(SERVICE_STYLE_GROUP),
    disclosure: stylesDisclosure(declared, SERVICE_STYLE_GROUP),
  });
}

/**
 * A per-service view's title: its subsystem path and then its own id, joined
 * with ` / ` — `Platform / order-flow / checkout-web`, or bare `checkout-web`
 * for a service filed directly under `services/`.
 *
 * LikeC4 reads that as a folder path (`./text.ts` measured it), so a service's
 * overview lands in the SAME browser folder as its subsystem's view rather than
 * in a flat list of fifty-eight titles — which is the whole readability answer
 * at fleet scale, and it costs the same helpers the subsystem views already use.
 *
 * The leaf is the service's `services/<id>/` DIRECTORY id and deliberately not
 * the map element's title: it is the name every loam command addresses the
 * service by, it cannot drift when somebody renames a box on the map, and a
 * directory name cannot contain `/`, so it needs no folder-separator
 * substitution of its own. It still goes through `likec4String` — an id is a
 * directory name, and a directory name is somebody else's word.
 */
function serviceViewTitle(tree: FleetTree, subsystem: string[], id: string): string {
  return [viewTitle(titleChain(tree, subsystem)), likec4String(id)].filter((part) => part !== "").join(" / ");
}

/**
 * The MARKED subsystems along a path, outermost first — the chain `viewTitle`
 * composes a folder path out of, for a subsystem's own view and for the view of
 * a service filed beneath it alike.
 *
 * Marked, because an intermediate directory holding no `subsystem.yaml` is
 * `subsystem.unmarked`, an error the walk already names: it is not a group,
 * so it contributes no folder level here either. Read off the walked tree
 * rather than off the path segments, so what the title says and what the
 * finding says about the same directory cannot disagree.
 */
function titleChain(tree: FleetTree, path: readonly string[]): SubsystemEntry[] {
  return tree.subsystems
    .filter((s) => s.path.length <= path.length && s.path.every((name, i) => path[i] === name))
    .sort((a, b) => a.path.length - b.path.length);
}

/** The sort key and the comment spelling: the subsystem's path from services/, joined. */
function pathKey(sub: SubsystemEntry): string {
  return sub.path.join("/");
}

/**
 * A LikeC4 identifier for the view, derived from the subsystem's path so
 * nesting reads in the name — and INJECTIVE over every path the name grammar
 * admits, because the renderer refuses the whole `architecture/` project over
 * a duplicate view id.
 *
 * The per-BYTE encoding, the collision it was written against, and the reason
 * segments join on `__` all live with the encoder in `./service/view-id.ts` —
 * which is also where the per-service ids are minted, so the two generated
 * files cannot drift into two spellings of the same escape. That module sits
 * BELOW this one on purpose: it is the leaf, and the import may only run
 * downward (`./service/views.ts`'s banner records the package direction).
 *
 * EXPORTED here still, with its prefix, because `subsystem.view-id-collision`
 * has to ask the generator what it mints rather than re-deriving it. A check
 * carrying its own copy of the escaping would go quiet the day the encoding
 * changed, and going quiet is the failure this whole family exists to prevent.
 */
export const SUBSYSTEM_VIEW_PREFIX = "subsystem_";

export function subsystemViewId(sub: SubsystemEntry): string {
  return `${SUBSYSTEM_VIEW_PREFIX}${sub.path.map(escapeViewIdSegment).join("__")}`;
}

/**
 * Does the file on disk already SAY what `renderSubsystemViews` renders?
 *
 * The generator above only ever emits LF. `core.autocrlf=true` is Git for
 * Windows' installer default and a docs repo ships no `.gitattributes`, so an
 * ordinary Windows clone hands the file back with CRLF and not one fact
 * changed. Four call sites asked this question with a byte equality and all
 * four answered "stale" on such a clone: `loam validate` reported an error,
 * `loam subsystem sync` reported `updated` and rewrote with LF, git then showed
 * the file permanently modified, and the next checkout restored the CRLF. That
 * is a loop rather than a diagnosis, which is why the comparison lives here
 * now — the module that mints the bytes is the one that owes an answer about
 * them, and three near-copies of this rule would go stale one at a time.
 *
 * Still never a parse: a views-only document does not parse standalone, and no
 * check anywhere reads this file's content. The narrowing is from BYTES to
 * CONTENT, which is what `subsystem.views-stale`'s own message ("does not match
 * the tree") already claims. The symmetric cost is accepted and is the one
 * `core/verify/pins/pin.ts` documents for `pinnedDigest`: a pure line-ending
 * change is invisible, correctly, because it is not a change to what the file
 * says.
 *
 * `null` is carried through as itself rather than collapsing into `""`: absent,
 * must-be-absent and present-but-different are three distinct states with three
 * distinct messages, and a fleet whose views file does not exist is not a fleet
 * whose views file is blank.
 */
export function viewsAgree(actual: string | null, expected: string | null): boolean {
  const lf = (text: string | null): string | null => (text === null ? null : text.replace(/\r\n|\r/g, "\n"));
  return lf(actual) === lf(expected);
}
