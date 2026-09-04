/**
 * The fleet-map half of the adoption brief, READ side: what the fleet map
 * already says about one service — its elements, its inbound and outbound
 * edges, the operations the fleet already calls on it — and which of the four
 * states the map is in for it. The write the service still owes the file — the
 * block, when nothing in it resolves to the service yet, or the EDGES, when an
 * element does and no edge touches it — is spelled in `./map/owed.ts`
 * (`landscapeArtifact`, `instructionFor`), which this module hands its findings
 * to. Both halves exist to stop an agent inventing a parallel model: the fleet
 * has already drawn some of these boxes and edges, and a baseline has to attach.
 *
 * "The fleet map" is the `architecture/` PROJECT — the landscape plus every
 * other `.likec4` under it, minus the generated views file — and not the
 * landscape FILE. The two are the same document set `validate --all` grades
 * `landscape.service-isolated` over, and reading one file here let the two
 * surfaces disagree about the same tree.
 */
import { existsSync } from "node:fs";
import { loadFile } from "../c4/likec4.js";
import { loadArchitecture } from "../c4/project/architecture.js";
import { attestedCalls, type AttestedCall } from "../c4/resolve/attested.js";
import { serviceResolver } from "../c4/resolve/service.js";
import { ServiceModels } from "../c4/prefetch/fleet.js";
import { OBLIGATION_TAG_PREFIX } from "../obligations/obligations.js";
import { landscapePath, type ServicePaths } from "../repo/paths.js";
import { enumeratedServiceIds, serviceTreePathOf } from "../repo/service-target.js";
import { EXTERNAL_TAG, GRADED_TAGS } from "../vocabulary/maturity.js";
import { brokenDocuments, instructionFor } from "./map/owed.js";
import { properAncestorIds } from "../kernel/ids/fqn/ancestors.js";
import type { DocsDir } from "../kernel/ids/dirs.js";

/* ------------------------------------------------------------------ */
/* What the fleet already says about this service                      */
/* ------------------------------------------------------------------ */

export interface LandscapeElement {
  id: string;
  title: string;
  kind: string;
  tags: string[];
  /** True when the element binds explicitly with `metadata { service }`. */
  bound: boolean;
}

export interface LandscapeEdge {
  from?: string;
  to?: string;
  op: string | null;
  title: string | null;
}

export interface LandscapeContext {
  /** Whether `architecture/landscape.likec4` — the file the brief asks for edits to — is on disk. */
  present: boolean;
  /**
   * False when the landscape exists but the `architecture/` project does not
   * parse. A sibling under `architecture/` counts: a broken use case leaves the
   * map unusable for `validate --all` too, and a brief that read the landscape
   * alone would report a fleet nobody can render.
   */
  parses: boolean;
  /**
   * Whether loam could read WHO CALLS this service — the only evidence an EMPTY
   * `expects` may be read as "nothing calls it".
   *
   * A separate fact from `parses` because they answer about different documents.
   * `parses` is about the whole `architecture/` PROJECT (W4), and the callers
   * live in the landscape FILE: a broken palette or use case beside a landscape
   * that reads perfectly left `parses` false, and `apiExpected` then demanded an
   * OpenAPI contract of a browser UI the map proves nobody calls — while `loam
   * list` and `loam context`, which read the file (core/pack/living.ts), said the
   * opposite about the same tree.
   */
  callersKnown: boolean;
  /** Whether any element resolves to this service — null when nothing could be read. */
  modelled: boolean | null;
  /**
   * The service-LEVEL elements that resolve to this service: an element whose
   * ancestor also resolves to it is one of its containers, not a second box.
   */
  elements: LandscapeElement[];
  /**
   * The map's edges into and out of this service, INTERNAL edges excluded: an
   * edge whose two endpoints both resolve here (`svc.web -> svc.db`) is this
   * service's own wiring, and filed as inbound it named the service as its own
   * caller.
   */
  inbound: LandscapeEdge[];
  outbound: LandscapeEdge[];
  /** Operations other services already call on this one: the contract owes them. */
  expects: string[];
  /**
   * Whether at least one relationship in the map has an endpoint resolving to
   * this service — read off the relationships, NOT off `inbound`/`outbound`,
   * because an intra-service edge counts here (it is `landscape.service-
   * isolated`'s predicate) while those two lists drop it. `null` exactly when
   * `modelled` is `null` or `false`. It exists
   * because `instruction` used to go null on element existence alone, and
   * `loam seed` writes a bound, edgeless element for every service nobody
   * listed under `calls:` — so the brief declared the map finished for exactly
   * the services the map had not reached.
   *
   * Binary by design, and the fifth silent case of `landscape.service-isolated`
   * with it: ONE edge closes the state, so a map drawing one of five attested
   * calls reports `touched: true`, `attested: []` and no instruction. The check
   * is touched/untouched, not a set difference — loam cannot tell a call the map
   * omits from a call it deliberately does not draw at fleet level, and a
   * difference reported as an omission would be an invented edge with a code
   * beside it.
   */
  touched: boolean | null;
  /**
   * The calls `services/<…>/<svc>/model.likec4` declares ACROSS its boundary
   * (`attestedCalls`, core/c4/resolve/attested.ts). `[]` when the model is
   * absent, unparseable, or declares none — deliberately not told apart, since
   * the only thing the brief may do with the list is name edges ALREADY
   * ATTESTED, never invent one. Read only when `touched` is `false`: every
   * other state either has edges (nothing owed) or no element (the block, not
   * the edges, is owed), and a first adoption has no model to read anyway.
   */
  attested: AttestedCall[];
  /**
   * The write this service still owes the fleet map, in prose — null once an
   * element resolves to it AND an edge touches that element. It duplicates the
   * `landscape.likec4` target's shape rules on purpose: an agent driving off
   * `--json` reads `landscape` to learn what the fleet already says, and every
   * `targets[]` consumer walks the artifact list. Only one of those two readers
   * used to exist, so `adopt` briefed eight files and never once said the ninth
   * thing — that a documented service nobody drew is invisible to the whole
   * cross-service layer.
   */
  instruction: string | null;
}

/**
 * The service ids the resolver may fall back on when an element carries no
 * `metadata { service }` binding — the same positive evidence `validate` and
 * `list` hand it. A docs repo with no `services/` yet (`adopt` runs there)
 * leaves the resolver with bindings alone, which is what it had before.
 */
async function knownServices(docsDir: DocsDir): Promise<ReadonlySet<string>> {
  return new Set(await enumeratedServiceIds(docsDir));
}

/**
 * The tags loam reads on an ELEMENT. `GRADED_TAGS` is the vocabulary's own
 * list of the tags that change what loam concludes — spelled once there, so
 * the day a third tag is graded this set follows and the instruction below
 * does not tell an agent to clear it as unread. The obligation prefix is the
 * one tag PREFIX loam reads on an element; `#cap-`/`#req-` are view tags and
 * never sit on one, so they are not in this list.
 */
const LOAM_TAGS: ReadonlySet<string> = new Set(GRADED_TAGS);
const LOAM_TAG_PREFIXES: readonly string[] = [OBLIGATION_TAG_PREFIX];

/**
 * The element's tags loam does NOT read — named in the instruction and never
 * interpreted. A placeholder convention ("drawn ahead of adoption") is the
 * fleet's own, `loam seed` writes none, and a view written `exclude
 * element.tag = #<that>` keeps an adopted service hidden until it is cleared.
 */
function foreignTagsOf(elements: LandscapeElement[]): string[] {
  const unread = (t: string): boolean => !LOAM_TAGS.has(t) && !LOAM_TAG_PREFIXES.some((p) => t.startsWith(p));
  return [...new Set(elements.flatMap((e) => e.tags))].filter(unread);
}

/**
 * The attested calls, or nothing off a model that could not be read: `c4.invalid`
 * is validate's finding, and an edge list read off half a document is invention.
 *
 * Through the ONE reader of `model.likec4` (`core/c4/service-model/load.ts`),
 * because the two shapes are read differently and this brief is handed to an
 * agent that will act on it: a model that EXTENDS the fleet map, opened as a
 * lone file, comes back as a pile of parse errors — so the brief would tell
 * every migrated service that its model attests nothing and quietly drop the
 * edges the map most likely owes. `mapUnreadable` is the same empty answer for
 * the same reason: an extending model whose map does not parse was never read.
 */
async function attestedFrom(
  docsDir: DocsDir,
  paths: ServicePaths,
  service: string,
  known: ReadonlySet<string>,
): Promise<AttestedCall[]> {
  // The memo directly rather than through `core/fleet-context.ts`, and the
  // reason is the package graph: this module already depends on `core/c4/`, and
  // reaching for the read index would add a `brief -> core-root` edge for one
  // read in a command that grades a single service. The three things the memo
  // cannot know for itself are supplied here — the enumeration this function
  // was already handed, the per-file loader, and a counter nobody is keeping.
  const models = new ServiceModels({
    onProjectLoad: () => {
      // `adopt` reports no read counters, so there is nothing to increment. The
      // hook is the memo's way of letting a caller own its own statistics, and
      // an empty one is that answer, not a forgotten line.
    },
    known: async () => known,
    standalone: (path) => loadFile(path),
  });
  const model = await models.model(docsDir, paths);
  if (model.mapUnreadable || model.doc.errors.length > 0) return [];
  return attestedCalls(model.doc, service, known);
}

/**
 * What the living fleet map already says about this service — the half of the
 * brief that stops an agent inventing a parallel model: the fleet has already
 * drawn some of these boxes and edges, and the baseline has to attach to them.
 * An `architecture/` project that does not parse yields `modelled: null` —
 * "nothing models it" would be a claim about documents nobody could read; the
 * landscape FILE parsing on its own does not rescue it, because the map the
 * renderer and `validate --all` see is the whole project. `paths` is the
 * service's own artifact set, located by the caller through the enumeration
 * (never joined at `services/<id>/`): the model is opened in exactly one state —
 * an element with no edge — to name the calls the map most likely owes. The
 * WHOLE record travels rather than the model path alone, because the model is
 * now read through its own shape and an extending one is read as a project of
 * the service's directory plus the map. It is required rather than optional
 * because the edgeless instruction states what that file attests, and a caller
 * that omitted it would get a brief asserting a fact about a document loam never
 * opened.
 */
export async function landscapeContext(
  docsDir: DocsDir,
  service: string,
  paths: ServicePaths,
): Promise<LandscapeContext> {
  const path = landscapePath(docsDir);
  // The service's own directory, spelled from the enumeration rather than joined
  // at the root: this text is handed to an AGENT that will go and edit files, and
  // a filed service named at `services/<id>/` sends it to create a second
  // directory beside the one that already exists.
  const servicePath = await serviceTreePathOf(docsDir, service);
  const bare = { service, expects: [], servicePath, attested: [], foreignTags: [] };
  const empty: LandscapeContext = {
    present: existsSync(path),
    parses: false,
    callersKnown: false,
    modelled: null,
    elements: [],
    inbound: [],
    outbound: [],
    expects: [],
    touched: null,
    attested: [],
    instruction: null,
  };
  if (!empty.present) return { ...empty, modelled: false, instruction: instructionFor({ ...bare, state: "absent" }) };

  // The `architecture/` PROJECT, through the one loader every other reader
  // shares — never `loadFile(path)`. A fleet spreads its model over more than
  // the landscape (a second `model { }` block in a sibling, a use case, a
  // palette), and `landscape.service-isolated` grades `touched` over exactly
  // this set: reading the landscape alone made `adopt` report `touched: false`,
  // the attested calls and an edit target for a service the fleet run on the
  // same tree called matched, with nothing to tell an agent which was right.
  const known = await knownServices(docsDir);
  const land = await loadArchitecture(docsDir);
  if (land.errors.length > 0) {
    // Since W4 this arm answers for the whole `architecture/` PROJECT, so the
    // document that broke is very often a SIBLING beside a landscape that parses
    // perfectly — and two things followed from not saying so:
    //   - the instruction told an agent to go and fix parse errors in
    //     `architecture/landscape.likec4`, which has none, contradicting
    //     `validate --all` run one second later on the same tree;
    //   - the API question — who CALLS this service — was answered "unknown"
    //     off a landscape file loam can read, so a broken palette flipped
    //     `openapi.yaml` to required for a browser UI the map proves nobody
    //     calls, while `list` and `context` (which read the FILE, see
    //     core/pack/living.ts) answered the opposite about the same tree.
    // Nothing else is rescued: `modelled`, `elements` and `touched` stay
    // unknown, because those are claims about the project the renderer loads.
    const expects = await expectsFromFile(path, service, known);
    return {
      ...empty,
      callersKnown: expects !== null,
      expects: expects ?? [],
      instruction: instructionFor({
        ...bare,
        expects: expects ?? [],
        state: "unparseable",
        broken: brokenDocuments(docsDir, land),
      }),
    };
  }

  // One resolver for the whole scan, built with the real service ids, and
  // built BEFORE the element filter: "an element resolves to this service" is
  // the resolver's answer — a nearest-ancestor binding wins over a descendant's
  // title — and it is the answer `validate --all` grades `service-unmodelled`
  // on and `loam context` prints `modelled` from. This used to ask each
  // element for its OWN binding-or-title instead, so a container titled
  // 'payment-service' inside an element bound to order-service read as
  // payment-service's box, and the edgeless arm told an agent "do not add a
  // second element" for a service the fleet run reported unmodelled (error).
  // The same resolver serves the edges: one drawn into a modelled container
  // (`paymentService.api`) is an edge into the service, and `expects` — which
  // decides whether this service owes an OpenAPI contract at all — has to see
  // it. Building it once also stops the per-edge rebuild the old
  // `serviceOf(land.elements, id)` call did.
  const svcOf = serviceResolver(land.elements, known);
  const mine = (id: string): boolean => svcOf(id) === service;
  // The service-LEVEL elements only: one that resolves to the service while
  // an ancestor does too is a container of it, and listing it would show a
  // second box the map does not have.
  const elements: LandscapeElement[] = land.elements
    .filter((e) => mine(e.id) && !properAncestorIds(e.id).some(mine))
    .map((e) => ({
      id: e.id,
      title: e.title,
      kind: e.kind,
      tags: e.tags,
      bound: e.service !== undefined,
    }));

  const inbound: LandscapeEdge[] = [];
  const outbound: LandscapeEdge[] = [];
  // An edge whose BOTH endpoints resolve here is the service's own internal
  // wiring: filed as inbound it made the service its own caller (verification
  // 2026-09-04). It still TOUCHES the service, so `touched` below reads the
  // relationships rather than these lists — the isolation check counts either
  // endpoint, and the two predicates must not disagree.
  const self = (r: { source: string; target: string }): boolean => mine(r.source) && mine(r.target);
  for (const r of land.relationships) {
    if (self(r)) continue;
    const edge = { op: r.op ?? null, title: r.title ?? null };
    if (mine(r.target)) inbound.push({ from: svcOf(r.source), ...edge });
    else if (mine(r.source)) outbound.push({ to: svcOf(r.target), ...edge });
  }

  const expects = [...new Set(inbound.map((e) => e.op).filter((op): op is string => op !== null))];
  const modelled = land.elements.some((e) => mine(e.id));
  const touched = modelled ? land.relationships.some((r) => mine(r.source) || mine(r.target)) : null;
  const attested =
    touched === false && existsSync(paths.model) ? await attestedFrom(docsDir, paths, service, known) : [];
  const req = {
    service,
    expects,
    servicePath,
    attested,
    foreignTags: foreignTagsOf(elements),
    elementId: elements[0]?.id,
    // The one graded tag that changes what the brief may PROMISE: an `#external`
    // element is never `landscape.service-isolated`'s subject. Off the same
    // element `elementId` names, never the union.
    external: elements[0]?.tags.includes(EXTERNAL_TAG) ?? false,
  };
  const instruction = !modelled
    ? instructionFor({ ...req, state: "unmodelled" })
    : touched === false
      ? instructionFor({ ...req, state: "edgeless" })
      : null;
  return {
    present: true,
    parses: true,
    callersKnown: true,
    modelled,
    elements,
    inbound,
    outbound,
    expects,
    touched,
    attested,
    instruction,
  };
}

/**
 * The operations the fleet already calls on this service, read off the landscape
 * FILE alone — `null` when that file cannot be read either.
 *
 * The fallback for an `architecture/` project that does not parse, and the
 * narrowest one that can be justified: it answers ONE question, the one `loam
 * list` and `loam context` answer off the same bytes (`landscapeEvidence`,
 * core/vocabulary/maturity.ts). "Nothing calls this service" and "loam could not
 * tell" are different answers, and only the first may switch an API contract
 * off, which is why the empty list and the unreadable file are told apart here
 * rather than collapsed to `[]`.
 */
async function expectsFromFile(path: string, service: string, known: ReadonlySet<string>): Promise<string[] | null> {
  try {
    const doc = await loadFile(path);
    if (doc.errors.length > 0) return null;
    const svcOf = serviceResolver(doc.elements, known);
    const ops = doc.relationships
      .filter((r) => svcOf(r.target) === service)
      .map((r) => r.op)
      .filter((op): op is string => op !== undefined);
    return [...new Set(ops)];
  } catch {
    return null;
  }
}
