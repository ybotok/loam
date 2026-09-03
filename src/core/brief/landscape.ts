/**
 * The fleet-map half of the adoption brief, READ side: what
 * `architecture/landscape.likec4` already says about one service — its
 * elements, its inbound and outbound edges, the operations the fleet already
 * calls on it — and which of the four states the map is in for it. The write
 * the service still owes the file — the block, when nothing in it resolves to
 * the service yet, or the EDGES, when an element does and no edge touches it —
 * is spelled in `./map/owed.ts` (`landscapeArtifact`, `instructionFor`), which
 * this module hands its findings to. Both halves exist to stop an agent
 * inventing a parallel model: the fleet has already drawn some of these boxes
 * and edges, and a baseline has to attach.
 */
import { existsSync } from "node:fs";
import { loadFile } from "../c4/likec4.js";
import { attestedCalls, type AttestedCall } from "../c4/resolve/attested.js";
import { serviceResolver } from "../c4/resolve/service.js";
import { OBLIGATION_TAG_PREFIX } from "../obligations/obligations.js";
import { landscapePath } from "../repo/paths.js";
import { enumeratedServiceIds, serviceTreePathOf } from "../repo/service-target.js";
import { GRADED_TAGS } from "../vocabulary/maturity.js";
import { instructionFor } from "./map/owed.js";
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
  present: boolean;
  /** False when the landscape exists but does not parse. */
  parses: boolean;
  /** Whether any element resolves to this service — null when nothing could be read. */
  modelled: boolean | null;
  /**
   * The service-LEVEL elements that resolve to this service: an element whose
   * ancestor also resolves to it is one of its containers, not a second box.
   */
  elements: LandscapeElement[];
  inbound: LandscapeEdge[];
  outbound: LandscapeEdge[];
  /** Operations other services already call on this one: the contract owes them. */
  expects: string[];
  /**
   * Whether at least one relationship in the map has an endpoint resolving to
   * this service — `inbound.length + outbound.length > 0` stated as a fact. An
   * intra-service edge counts: it is an edge the map draws on this service,
   * exactly the predicate `loam context` prints as "(modelled, no edges touch
   * it)". `null` exactly when `modelled` is `null` or `false`. It exists
   * because `instruction` used to go null on element existence alone, and
   * `loam seed` writes a bound, edgeless element for every service nobody
   * listed under `calls:` — so the brief declared the map finished for exactly
   * the services the map had not reached.
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

/** Every dotted prefix of an id, nearest first: `a.b` and `a` for `a.b.c`. */
function properAncestorIds(id: string): string[] {
  const out: string[] = [];
  for (let dot = id.lastIndexOf("."); dot !== -1; dot = id.lastIndexOf(".", dot - 1)) out.push(id.slice(0, dot));
  return out;
}

/**
 * The attested calls, or nothing off a model that does not parse: `c4.invalid`
 * is validate's finding, and an edge list read off half a document is invention.
 */
async function attestedFrom(modelPath: string, service: string, known: ReadonlySet<string>): Promise<AttestedCall[]> {
  const model = await loadFile(modelPath);
  return model.errors.length > 0 ? [] : attestedCalls(model, service, known);
}

/**
 * What the living landscape already says about this service — the half of the
 * brief that stops an agent inventing a parallel model: the fleet has already
 * drawn some of these boxes and edges, and the baseline has to attach to them.
 * A landscape that does not parse yields `modelled: null` — "nothing models
 * it" would be a claim about a document nobody could read. `modelPath` is the
 * service's own model, located by the caller through the enumeration (never
 * joined at `services/<id>/`): it is opened in exactly one state — an element
 * with no edge — to name the calls the map most likely owes. It is required
 * rather than optional because the edgeless instruction states what that file
 * attests, and a caller that omitted the path would get a brief asserting a
 * fact about a document loam never opened.
 */
export async function landscapeContext(docsDir: DocsDir, service: string, modelPath: string): Promise<LandscapeContext> {
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

  const land = await loadFile(path);
  if (land.errors.length > 0) return { ...empty, instruction: instructionFor({ ...bare, state: "unparseable" }) };

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
  const known = await knownServices(docsDir);
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
  for (const r of land.relationships) {
    const edge = { op: r.op ?? null, title: r.title ?? null };
    if (mine(r.target)) inbound.push({ from: svcOf(r.source), ...edge });
    else if (mine(r.source)) outbound.push({ to: svcOf(r.target), ...edge });
  }

  const expects = [...new Set(inbound.map((e) => e.op).filter((op): op is string => op !== null))];
  const modelled = land.elements.some((e) => mine(e.id));
  const touched = modelled ? inbound.length + outbound.length > 0 : null;
  const attested = touched === false && existsSync(modelPath) ? await attestedFrom(modelPath, service, known) : [];
  const req = {
    service,
    expects,
    servicePath,
    attested,
    foreignTags: foreignTagsOf(elements),
    elementId: elements[0]?.id,
  };
  const instruction = !modelled
    ? instructionFor({ ...req, state: "unmodelled" })
    : touched === false
      ? instructionFor({ ...req, state: "edgeless" })
      : null;
  return { present: true, parses: true, modelled, elements, inbound, outbound, expects, touched, attested, instruction };
}
