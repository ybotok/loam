/**
 * `c4.declaration-diverged` — the check the "every shared element is declared
 * once per document" report asked for.
 *
 * A STANDALONE model has to re-declare every element it talks about: it is
 * parsed alone, so `kafka`, `uaa` and each peer service appear a second time,
 * with a second kind, a second title, a second tag list and a second binding.
 * Nothing compared the copies. Measured on the fleet that filed the report: 78
 * double declarations across 56 services, and the copies had already drifted —
 * `#platform` was on the map's elements and missing from the models'.
 *
 * WHAT IS COMPARED, and why exactly these four. `kind`, `title`, the tag SET and
 * the `metadata { service }` binding each change what loam concludes or what a
 * view shows: the kind decides which specification rule applies and which
 * exemptions (`ACTOR_KINDS`, `#external`) fire, the title is a resolver fallback
 * when nothing is bound, a tag is graded (`#external`, `#obl-…`), and the
 * binding decides which directory an edge is filed under. `description` is
 * deliberately NOT compared: it is prose, nothing joins on it, and reporting two
 * differently-worded sentences as a divergence would train a reader to ignore
 * the code.
 *
 * WHICH TWO DECLARATIONS ARE ONE ELEMENT is `counterpart` below, and it is the
 * half the first release got wrong: it joined on the literal id, so in a GROUPED
 * map — one that nests its services under `marketplace`, as loam's own example
 * does — a model's `paymentService` never met the map's
 * `marketplace.paymentService` and the check was silent on every fleet that
 * groups (verification 2026-09-04, W3). The three rungs are ordered by how much
 * they assume: the id, then the `metadata { service }` binding both sides wrote,
 * then a unique dotted TAIL of the map's id. Ambiguity is never resolved by
 * picking one — a key two map elements answer to joins nothing, because a
 * divergence reported against the wrong peer is worse than the silence. And the
 * BARE last segment is a tail only when the map element it names is a
 * FLEET-LEVEL box: see `joinIndex`, where the first release of the tail rung
 * joined one service's `db` to another service's.
 *
 * WHAT "FLEET-LEVEL" MEANS, spelled once here because three pages spelled it
 * differently and all three were wrong (verification 2026-09-04, second pass):
 * a map element NO ANCESTOR of which stands for a service — `serviceLevelElements`,
 * the one predicate every fleet check asks this question with. That is a
 * top-level element, and equally a child of a plain grouping element: a map
 * that draws `infra = group 'Infra' { cache = database … }` is drawing the
 * fleet's cache, at fleet level, and a standalone model that declares its own
 * top-level `cache` IS shadowing that box — the two documents give one name two
 * meanings, which is the thing this code exists to report. What the rung must
 * never reach is an element drawn INSIDE a service's own element: that is
 * somebody's interior, it belongs to that service, and a model's private `db`
 * being told to copy another service's `db` verbatim is the wrong-join class
 * the tail rung was restricted for in the first place.
 *
 * SILENT WHEN THE MAP DOES NOT PARSE, and when the model does not: a diff
 * against half a document is invention, and both states already have a finding
 * of their own.
 *
 * The repair has two forms on purpose. Copying the map's declaration verbatim
 * keeps the standalone shape, which is legal forever; migrating the model to
 * extend the map removes the copy altogether, which is the only fix that cannot
 * drift again. Except where the first repair is a no-op, and `copyIsNoOp`
 * decides that by SIMULATING it rather than by pattern-matching one shape of it:
 * a tag difference that survives the copy comes off the two documents'
 * `specification` blocks, so the message names the block instead.
 */
import type { Elem, LoadedDoc } from "../../../../core/c4/likec4.js";
import type { DocSpecification } from "../../../../core/c4/parsed/specification.js";
import type { ServiceModel } from "../../../../core/c4/service-model/load.js";
import type { PathableService } from "../../../../core/kernel/ids/service.js";
import { ARTIFACT_FILES } from "../../../../core/repo/paths.js";
import type { Finding } from "../../../../core/vocabulary/report.js";
import { serviceLevelElements } from "../../fleet/census.js";

/**
 * How the OTHER declaration is named.
 *
 * The document, not the file: `Elem` carries no source path, and the map is a
 * PROJECT — `architecture/landscape.likec4` plus every other `.likec4` under
 * `architecture/` — so naming the landscape file was a guess that sent an author
 * to a document that does not declare the element at all.
 */
const MAP = "the fleet map (architecture/)";

export interface DivergenceCheck {
  service: PathableService;
  model: ServiceModel;
  /** The `architecture/` project — the map as every other fleet check reads it. Null when the repo has none. */
  architecture: LoadedDoc | null;
  /**
   * Every `services/<id>/` that exists — the census's positive evidence, which
   * is what tells a map's fleet-level box from a container drawn inside a
   * service. Only the bare-last-segment tail join reads it; see `joinIndex`.
   */
  known: ReadonlySet<string>;
}

export function divergedFindings(check: DivergenceCheck): Finding[] {
  const { service, model, architecture, known } = check;
  // An extending model declares each of these elements exactly once by
  // construction — there is no copy to diverge — and the shapes' other grade
  // (`c4.element-unowned`) is what asks its question.
  if (model.shape !== "standalone") return [];
  if (model.doc.errors.length > 0) return [];
  if (architecture === null || architecture.errors.length > 0) return [];

  const index = joinIndex(architecture.elements, known);
  const findings: Finding[] = [];
  for (const mine of model.doc.elements) {
    const theirs = counterpart(index, mine);
    if (theirs === undefined) continue;
    const fields = differing(mine, theirs);
    if (fields.length === 0) continue;
    // Where "copy the map's declaration verbatim" is a no-op: the tag sets are
    // all that differ (so the two kinds are equal, and the block to open can be
    // named) and copying the map's literal tags across would leave them still
    // differing. `fields` is checked first because copying DOES fix a title or a
    // binding, so the verbatim remedy stays right whenever one of those differs.
    const specs = { mine: model.doc.specification, theirs: architecture.specification };
    const inherited =
      fields.length === 1 && fields[0] === "tags" && copyIsNoOp(mine, theirs, specs)
        ? declaringSide(mine.kind, specs)
        : null;
    findings.push({
      severity: "warn",
      code: "c4.declaration-diverged",
      subject: service,
      message:
        `${service}: ${ARTIFACT_FILES.model} declares '${mine.id}' as ${describe(mine)} and ` +
        `${MAP} declares ${theirs.id === mine.id ? "it" : `'${theirs.id}'`} as ${describe(theirs)} — ` +
        remedy(fields, mine.kind, inherited),
    });
  }
  return findings;
}

/**
 * What the message says after the two declarations: which fields differ, and
 * what to do about it. `inherited` is null when copying the map's declaration
 * fixes this, and otherwise the clause naming which document's `specification`
 * puts the tags on the kind — the side an author has to open.
 */
function remedy(fields: string[], kind: string, inherited: string | null): string {
  // "the kind differs" / "the title differs" / "the tags differ": the verb
  // agrees with the last field named, and `tags` is the one plural noun in the
  // set. It shipped as "the kind differ", and a sentence a reader trips over is
  // one they stop reading.
  const plural = fields.length > 1 || fields[fields.length - 1] === "tags";
  const named = `the ${fields.join(", ")} differ${plural ? "" : "s"}`;
  // The two kinds are equal whenever `tags` is the only differing field, so the
  // block to open can be named exactly.
  if (inherited !== null) {
    return (
      `${named}, and copying the map's declaration would not clear it: the sets come apart on ` +
      `\`specification { element ${kind} { … } }\`, ${inherited}. Either match the two specification ` +
      'blocks on that kind, or migrate the model to extend the map (SCHEMA.md, "Two shapes of a service ' +
      'model") so there is one specification and one declaration'
    );
  }
  return (
    `${named}, so two documents are two authorities on one element. Copy the map's declaration verbatim, or ` +
    'migrate the model to extend the map (SCHEMA.md, "Two shapes of a service model") so it is declared once'
  );
}

/** The map's elements, indexed by each key `counterpart` may join on — ambiguous keys dropped. */
interface JoinIndex {
  byId: Map<string, Elem>;
  byBinding: Map<string, Elem>;
  bySuffix: Map<string, Elem>;
}

function joinIndex(elements: readonly Elem[], known: ReadonlySet<string>): JoinIndex {
  // Which map elements are the fleet's own boxes rather than somebody's
  // interior, by the ONE predicate every other fleet check asks it with
  // (`fleet/census.ts`): a binding or a title naming a real services/<id>/ makes
  // an element a service at any depth, and what sits inside one is that
  // service's container. Everything else is fleet-level — a top-level element,
  // or a box the map draws inside a plain grouping element — see the header.
  const fleetLevel = new Set(serviceLevelElements([...elements], known).map((e) => e.id));
  return {
    byId: unique(elements, (e) => [e.id]),
    byBinding: unique(elements, (e) => (e.service === undefined ? [] : [e.service as string])),
    // Every DOTTED tail of the id, so a model's `paymentService.api` reaches the
    // map's `marketplace.paymentService.api`: a tail carrying a dot names the
    // owner as well as the leaf, so the two documents are talking about one
    // element.
    //
    // The bare LAST segment names only the leaf, and it is emitted for
    // FLEET-LEVEL boxes alone. This shipped unconditional, and the comment
    // here claimed it was not: a standalone model's own `db`, `api` or `agent`
    // joined whatever `<something>.<that name>` the map happened to hold — one
    // service's private cache told to copy another service's store, verbatim.
    // loam's own meta/docs hit it (`agent` ↔ `loam.core.agent`, a container of
    // src/core/agent/), which is the case that made the rung wrong rather than
    // merely risky (verification 2026-09-04).
    //
    // A box the map draws inside a plain GROUP still emits its bare segment,
    // and deliberately: `infra.cache` is the fleet's cache, so a model's own
    // top-level `cache` is a second meaning for one name and worth the warning.
    // Grouping is a drawing convenience, not ownership — only a SERVICE owns an
    // interior — so the guard is "no ancestor stands for a service" and not
    // "the id carries no dot".
    bySuffix: unique(elements, (e) => {
      const segments = e.id.split(".");
      const tails = segments.map((_, i) => segments.slice(i).join("."));
      return fleetLevel.has(e.id) ? tails : tails.slice(0, -1);
    }),
  };
}

/** An index holding only the keys exactly ONE element answers to — a shared key joins nothing. */
function unique(elements: readonly Elem[], keys: (e: Elem) => string[]): Map<string, Elem> {
  const claims = new Map<string, Elem[]>();
  for (const element of elements) {
    for (const key of keys(element)) {
      const held = claims.get(key);
      if (held === undefined) claims.set(key, [element]);
      else held.push(element);
    }
  }
  const index = new Map<string, Elem>();
  for (const [key, held] of claims) if (held.length === 1) index.set(key, held[0]!);
  return index;
}

/** The map's declaration of the element this model declares, or undefined when nothing joins. */
function counterpart(index: JoinIndex, mine: Elem): Elem | undefined {
  const byId = index.byId.get(mine.id);
  if (byId !== undefined) return byId;
  // The binding is the strongest evidence after the id: both documents wrote
  // `metadata { service '<id>' }`, so both mean the same directory.
  const bound = mine.service === undefined ? undefined : index.byBinding.get(mine.service as string);
  if (bound !== undefined) return bound;
  return index.bySuffix.get(mine.id);
}

/** Which of the four compared fields disagree, in a fixed order so two runs read alike. */
function differing(mine: Elem, theirs: Elem): string[] {
  const fields: string[] = [];
  if (mine.kind !== theirs.kind) fields.push("kind");
  if (mine.title !== theirs.title) fields.push("title");
  // A SET, sorted: tag order is authoring order and means nothing, and a model
  // that lists the map's two tags the other way round is the same declaration.
  if (tagList(mine) !== tagList(theirs)) fields.push("tags");
  if (mine.service !== theirs.service) fields.push("service binding");
  return fields;
}

function tagList(e: Elem): string {
  return [...new Set(e.tags)].sort().join(" ");
}

/** The two documents' `specification` blocks, as `copyIsNoOp` and `declaringSide` read them. */
interface SpecPair {
  mine: DocSpecification | undefined;
  theirs: DocSpecification | undefined;
}

/**
 * Would "copy the map's declaration verbatim" leave the tag sets still
 * differing? Answered by SIMULATING the copy, which is the only way to be right
 * about it in both directions.
 *
 * `Elem.tags` is what LikeC4 hands over, and since 1.59.0 that includes every
 * tag the element's kind declares (`core/c4/parsed/specification.ts` says why
 * loam reads the block at all). Copying the map's DECLARATION copies its literal
 * tags into the model and nothing else — the model keeps its own specification —
 * so the model's element would come back carrying `mine's kind defaults ∪ the
 * map's literal tags`, against the map's `its kind defaults ∪ the same literal
 * tags`. Those differ exactly when the two kind defaults differ outside the
 * copied literals, and then the remedy is a no-op.
 *
 * The first version compared the two LITERAL tag lists and switched arms only
 * when they were equal, which caught one direction of the same case and missed
 * its mirror: a model writing `#external` on an element whose map twin inherits
 * `#external #platform` from `element topic { … }` was told to copy the map's
 * bare line, and doing exactly that produced the OTHER arm of this same message
 * (verification 2026-09-04, second pass, examples/docs order-service).
 */
function copyIsNoOp(mine: Elem, theirs: Elem, specs: SpecPair): boolean {
  const copied = literalTags(theirs, specs.theirs);
  const after = union(kindTags(mine.kind, specs.mine), copied);
  const before = union(kindTags(theirs.kind, specs.theirs), copied);
  return after !== before;
}

/**
 * Which document's `specification` puts the tags on the kind — the half of the
 * message that tells an author which file to open. "Both, differently" is a real
 * state (each block declares its own tag on the same kind) and gets its own
 * words rather than a guess at one side.
 */
function declaringSide(kind: string, specs: SpecPair): string {
  const mine = kindTags(kind, specs.mine);
  const theirs = kindTags(kind, specs.theirs);
  if (mine.length > 0 && theirs.length > 0) return "which the two documents declare different tags on";
  if (theirs.length > 0) return `which ${MAP} declares tags on and ${ARTIFACT_FILES.model} does not`;
  if (mine.length > 0) return `which ${ARTIFACT_FILES.model} declares tags on and ${MAP} does not`;
  // No kind declares anything and the copy still fails: not reachable from the
  // predicate above (with equal kinds and no defaults the copy always clears
  // it), and a sentence that names no file beats one that names the wrong file.
  return "which the two documents' blocks disagree on";
}

/** The tags `spec` puts on every element of `kind`, sorted — the defaults an element cannot see. */
function kindTags(kind: string, spec: DocSpecification | undefined): string[] {
  return [...new Set(spec?.elementKindTags[kind] ?? [])].sort();
}

/** A tag SET as one comparable string; see `tagList` for why order is dropped. */
function union(a: readonly string[], b: readonly string[]): string {
  return [...new Set([...a, ...b])].sort().join(" ");
}

function literalTags(e: Elem, spec: DocSpecification | undefined): string[] {
  const inherited = new Set(kindTags(e.kind, spec));
  return [...new Set(e.tags)].filter((tag) => !inherited.has(tag)).sort();
}

/** One element as the message names it — every compared field, in the order `differing` reports them. */
function describe(e: Elem): string {
  const tags = tagList(e);
  return `${e.kind} '${e.title}' [${tags === "" ? "no tags" : tags}, bound to ${e.service ?? "unbound"}]`;
}
