/**
 * The C4 half of projecting a feature onto one service: which services exist,
 * which the feature introduces, and what its tagged edges add around the one
 * being projected onto. Moved out of `commands/delta/slices.ts` beside
 * `./api.ts` and `./events.ts`; named `arch-slice.ts` rather than `arch.ts`
 * because `core/c4/arch.ts` already exists and a twin name invites the wrong
 * import.
 */
import { errorText, type Elem, type LoadedDoc, type Rel } from "../c4/likec4.js";
import { elementService, serviceResolver } from "../c4/resolve/service.js";
import { livingMapOf, readDeltaSystem } from "../c4/resolve/systems.js";
import { landscapePath } from "../repo/paths.js";
import { DocsRepoUnavailableError } from "../repo/state.js";
import { listServices } from "../repo/repo.js";
import type { DocsDir } from "../kernel/ids/dirs.js";

/** One end of a feature edge, as seen from the projected service. */
export interface Edge {
  service: string;
  op: string | null;
  title: string | null;
}

export interface ArchSlice {
  isNew: boolean;
  inbound: Edge[];
  outbound: Edge[];
  errors: string[];
}

/** Every service in the docs repo, or none when there is no docs repo to ask. */
export async function livingServices(docsDir: DocsDir): Promise<string[]> {
  try {
    return (await listServices(docsDir)).map((s) => s.id);
  } catch (err) {
    // "There is no docs repo at all" is a different diagnosis with its own
    // command (`loam doctor`); turning it into "unknown service" here would
    // send the reader after a typo that is not there.
    if (!(err instanceof DocsRepoUnavailableError)) throw err;
    return [];
  }
}

/** Services the feature's C4 delta introduces — its own tagged top-level elements. */
export function introducedServices(doc: LoadedDoc | null, featureId: string): string[] {
  if (doc === null || doc.errors.length > 0) return [];
  return doc.elements.filter((e: Elem) => e.tags.includes(featureId)).map(elementService);
}

/** What `touchedServices` reads a delta against — the fleet the merge leaves. */
export interface TouchedScope {
  docsDir: DocsDir;
  /** The enumerated `services/` ids. */
  living: readonly string[];
  /** The feature's own `specs/<id>/` directories. */
  specs: readonly string[];
  /** How the living map is parsed, if it has to be — the caller's shared context, or a bare load. */
  load: (path: string) => Promise<LoadedDoc>;
}

/**
 * The services a feature speaks about: its `specs/` directories, plus the tagged
 * elements of its C4 delta that are SERVICES on the map the merge leaves — the
 * reading `service.exists` and `service.no-requirement-delta` already give a
 * tagged element (`readDeltaSystem`). `introducedServices` maps every tagged
 * element to a name, so a delta's human operator, its `#external` monitoring
 * system and an unbound `database` were each a service the feature "touches"
 * in `loam delta`'s refusal and beside every projection (a pilot fleet,
 * 2026-10-28). A delta that does not parse names only its `specs/`, as before.
 */
export async function touchedServices(doc: LoadedDoc | null, featureId: string, scope: TouchedScope): Promise<string[]> {
  const touched = new Set(scope.specs);
  if (doc === null || doc.errors.length > 0) return [...touched];
  const living = new Set(scope.living);
  const systems = {
    elements: doc.elements,
    known: new Set([...living, ...scope.specs]),
    living,
    livingMap: livingMapOf(landscapePath(scope.docsDir), scope.load),
  };
  for (const e of doc.elements) {
    if (e.tags.includes(featureId) && (await readDeltaSystem(e, systems)) !== "none") touched.add(elementService(e));
  }
  return [...touched];
}

/** The feature's tagged edges around one service, plus whether the service is new. */
export function archSlice(
  doc: LoadedDoc | null,
  service: string,
  featureId: string,
  known?: ReadonlySet<string>,
): ArchSlice {
  const empty: ArchSlice = { isNew: false, inbound: [], outbound: [], errors: [] };
  if (doc === null) return empty;

  const { errors, elements, relationships } = doc;
  if (errors.length > 0) {
    return { ...empty, errors: errors.map(errorText) };
  }

  // Which service an element stands for is the binding's call, not the title's
  // — and the enumerated fleet rides in so the slice agrees with `validate`
  // about an edge drawn into a modelled container. Without it, this projection
  // told the provider "no inbound calls" and the consumer "you call 'api'" for
  // the same `checkoutWeb -> paymentService.api` edge the validator was
  // grading against payment-service — and the brief an agent implements from
  // must never disagree with the gate it will be checked by.
  const svcOf = serviceResolver(elements, known);
  const edge = (r: Rel, other: string): Edge => ({
    service: other,
    op: r.op ?? null,
    title: r.title ?? null,
  });
  const featRels = relationships.filter((r) => r.tags.includes(featureId));

  return {
    isNew: elements.some((e) => elementService(e) === service && e.tags.includes(featureId)),
    inbound: featRels.filter((r) => svcOf(r.target) === service).map((r) => edge(r, svcOf(r.source))),
    outbound: featRels.filter((r) => svcOf(r.source) === service).map((r) => edge(r, svcOf(r.target))),
    errors: [],
  };
}
