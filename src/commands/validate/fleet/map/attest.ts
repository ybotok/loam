/**
 * What the fleet's own `model.likec4` files say, read ONCE for the two map
 * checks that need it: the calls each model attests across its boundary
 * (`./isolation.ts`), and the datastores that live nested inside a service's own
 * element (`../../checks/fleet-shape.ts`).
 *
 * One reader rather than two, because the two checks were answering the same
 * question from different evidence and disagreeing about the fleet. The
 * consumer census walked the MAP's relationships alone, so a store whose
 * consuming edges are all drawn in `services/<…>/model.likec4` had zero
 * consumers and earned nothing at all — and a store reached by three models plus
 * one map edge was reported `landscape.datastore-private` naming the single
 * service the MAP happened to draw (R1). A model is evidence about the fleet
 * exactly as the map is, so it is read here and handed to both.
 *
 * EXTENDING MODELS ONLY, for the consumer join. An extending model's ids ARE the
 * map's fully-qualified ids — one project, one id space — so `counterpartId`
 * joins to a drawn element exactly. A standalone model's ids are its own file's,
 * and `../../../../core/c4/resolve/attested.ts` says outright that a counterpart
 * is never matched to a landscape element: joining one would file a coincidence
 * of spelling as a coupling. Standalone models still contribute their attested
 * CALLS, because `landscape.service-isolated` asks only whether the model
 * declares any, which is shape-independent.
 *
 * A model that does not parse contributes nothing — neither calls nor stores.
 * `c4.invalid` is that file's finding, and a fleet-shape advisory computed from
 * a document nobody could read would be an inference about bytes.
 *
 * A sub-package of `fleet/` for `./isolation.ts`'s reason and with its rule: it
 * imports NOTHING from `fleet/`, so the map facts it needs (the resolver, the
 * ids the map draws at fleet level) arrive on the input record.
 */
import { existsSync } from "node:fs";
import { type Elem } from "../../../../core/c4/likec4.js";
import { attestedCalls, type AttestedCall } from "../../../../core/c4/resolve/attested.js";
import { FleetContext } from "../../../../core/fleet-context.js";
import { inOrder } from "../../../../core/kernel/concurrency.js";
import type { DocsDir } from "../../../../core/kernel/ids/dirs.js";
import { type ServiceEntry } from "../../../../core/repo/entries.js";
import { servicePathsAt } from "../../../../core/repo/paths.js";

/** The element kind read as a datastore, compared case-insensitively — `fleet-shape.ts`'s spelling. */
const DATASTORE_KIND = "database";

/** One service's model, as the map checks read it. */
export interface AttestedModel {
  /** The service directory this model belongs to. */
  service: string;
  /** EXTENDING — and therefore whether `counterpartId` is a map id at all. */
  extending: boolean;
  calls: readonly AttestedCall[];
}

/** A datastore drawn INSIDE the element that resolves to its owner, rather than beside it. */
export interface NestedStore {
  /** The service whose element holds it. */
  owner: string;
  /** The store's id as the one project spells it — `marketplace.orderService.db`. */
  fqn: string;
  title: string;
}

export interface MapAttestation {
  models: readonly AttestedModel[];
  nestedStores: readonly NestedStore[];
}

export interface AttestInput {
  docsDir: DocsDir;
  /** The enumerated services — every one of them, not a candidate subset: both readers ask about the whole fleet. */
  entries: readonly ServiceEntry[];
  /** The services/<id>/ directories that exist, as the resolver's `known`. */
  services: ReadonlySet<string>;
  /** The MAP's element→service resolver — what decides whose element a nested id sits under. */
  resolve: (id: string) => string;
  /**
   * `census.ts`'s one predicate for "this element stands for a `services/<id>/`",
   * injected because a `fleet/map/` module may not import `fleet/`. A `database`
   * that IS a service directory is the fleet itself, not a store: the binding
   * checks grade it, exactly as they do in `./consumers.ts`'s two halves.
   */
  standsForService: (e: Elem) => boolean;
  /** The ids the map draws at FLEET level: a datastore among them is a peer, and the peer census owns it. */
  drawnIds: ReadonlySet<string>;
  /** Under `--all` every model.likec4 is already in this memo, so the reads below are hits. */
  fleet?: FleetContext;
}

export async function mapAttestation(input: AttestInput): Promise<MapAttestation> {
  // Through the ONE reader of `model.likec4` (`core/c4/service-model/load.ts`),
  // so a model that EXTENDS the map attests the calls it draws inside the
  // element the map binds — read as a slice of the per-service project — exactly
  // as a standalone one attests the calls it draws in its own file. Memoised in
  // the index, so under `--all` these are hits. Pooled and joined on the entry,
  // never by index.
  const context = input.fleet ?? new FleetContext();
  const present = input.entries.filter((entry) => existsSync(servicePathsAt(entry.dir).model));
  // ONE workspace for the fleet's models rather than one per service. Both
  // answers below are about the WHOLE fleet — who else reaches this store is not
  // a question a narrowed run may answer differently — while `--base` prefetches
  // only the scope it grades, so without this a scoped run would spin a LikeC4
  // workspace per un-narrowed service. An accelerator with `prefetchLikeC4`'s
  // failure story exactly: a batch that cannot run seeds nothing, and every read
  // below falls back to its own load.
  await context.prefetchServiceModels(input.docsDir, present.map((entry) => servicePathsAt(entry.dir)));
  const loaded = await inOrder(present, async (entry) => ({
    entry,
    // CONTAINED, for `fleet/load.ts unreadableLandscape`'s reason: this runs on
    // the landscape target, which sits outside the dispatcher's `guarded`, so a
    // `model.likec4` that is a directory or carries a permission bit would
    // otherwise become the whole run's `repository-unavailable` — one file, and
    // no report at all for the ninety-nine services that are fine. A model that
    // could not be READ contributes nothing here, exactly as one that did not
    // parse does; `service.unreadable` is its own target's finding.
    model: await context.serviceModel(input.docsDir, servicePathsAt(entry.dir)).catch(() => null),
  }));

  const models: AttestedModel[] = [];
  const nestedStores: NestedStore[] = [];
  for (const { entry, model } of loaded) {
    // A model that does not parse attests nothing: `c4.invalid` is its finding.
    // An extending model whose MAP does not parse could not be read at all, and
    // neither reader runs in that state anyway — the fleet target returns on
    // `landscape.invalid` long before here.
    if (model === null || model.mapUnreadable || model.doc.errors.length > 0) continue;
    models.push({
      service: entry.id,
      extending: model.shape === "extending",
      calls: attestedCalls(model.doc, entry.id, input.services),
    });
    if (model.shape !== "extending") continue;
    for (const element of model.doc.elements) {
      if (element.kind.toLowerCase() !== DATASTORE_KIND) continue;
      // The slice carries the partners this model's own edges point at, and a
      // partner may be another service's store — so the store is kept only when
      // the MAP's resolver files it under this service, and only when the map
      // does not draw it as a peer of the services (which is the fleet-level
      // census's subject, and a different grade).
      if (input.standsForService(element)) continue;
      if (input.drawnIds.has(element.id) || input.resolve(element.id) !== (entry.id as string)) continue;
      nestedStores.push({ owner: entry.id, fqn: element.id, title: element.title });
    }
  }
  return { models, nestedStores };
}
