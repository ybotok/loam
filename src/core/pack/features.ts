/**
 * The in-flight section of one service's context pack: every active feature
 * whose delta touches the service, projected onto it exactly the way
 * `loam delta` projects — same helpers (`core/projection/`), same known-set,
 * same shapes — so the pack and the brief can never disagree about what a
 * feature changes here.
 *
 * THE BUSINESS CORPUS IS DELIBERATELY EXCLUDED, and it is the one place this
 * module and `loam delta` are allowed to differ. `loam delta` gained a
 * `capabilities` section — the promises a feature changes, and the
 * `Realizes: <capability>#<id>` entry each one is addressed by — because it is
 * read by a person about to author a requirement. A context pack is not that:
 * it is ONE SERVICE'S slice, assembled to be copied into that service's own
 * repository, and a capability delta names no service. Including it would make
 * a service repository's briefing depend on the fleet's business corpus — the
 * first such dependency anywhere in loam, and the exact inversion of the rule
 * this axis is built on, that neither corpus is derived from the other
 * (`core/capabilities/rollup.ts` states it: "TWO CORPORA MEET HERE, and neither
 * is derived from the other"). A service that wants to know which promise its
 * requirement keeps reads the `Realizes:` line on the requirement itself, which
 * IS in the pack, because it is part of the service's own document.
 *
 * That is an exclusion by design, not an omission waiting to be filled: adding
 * the section later is a product decision about what a service repository is
 * allowed to depend on, and it needs to be argued in those terms rather than
 * landed as a missing field.
 */
import { existsSync } from "node:fs";
import { FleetContext } from "../fleet-context.js";
import { type LoadedDoc } from "../c4/likec4.js";
import { repoPath } from "../envelope/json.js";
import { stripFrontmatter } from "../document/frontmatter.js";
import { inOrder } from "../kernel/concurrency.js";
import { apiChanges, type ApiChange, type ApiSlice } from "../projection/api.js";
import { eventChanges, type EventSlice } from "../projection/events.js";
import { archSlice, introducedServices, type ArchSlice } from "../projection/arch-slice.js";
import { compareIds, type FeatureEntry, type ServiceEntry } from "../repo/entries.js";
import { featurePaths, featureSpecPaths } from "../repo/paths.js";
import { packRequirement, type PackRequirement } from "./living.js";
import type { DocsDir } from "../kernel/ids/dirs.js";

/** One active feature's projection onto the pack's service — `loam delta`'s shapes, verbatim. */
export interface PackFeature {
  feature: string;
  path: string;
  /** Every service the feature speaks about: its spec deltas plus what its C4 delta introduces. */
  services: string[];
  intent: string | null;
  requirements: PackRequirement[];
  archRequirements: PackRequirement[];
  api: ApiChange[];
  openapi: { unreadable: boolean; error?: string };
  events: EventSlice;
  architecture: ArchSlice;
}

export interface FeaturesRequest {
  docsDir: DocsDir;
  entry: ServiceEntry;
  /** The one feature `--feature` named, or null for every touching feature. */
  feature: FeatureEntry | null;
  context: FleetContext;
}

/** A feature with its delta loaded and its full service list derived. */
interface LoadedFeature {
  entry: FeatureEntry;
  deltaDoc: LoadedDoc | null;
  services: string[];
}

export async function buildFeatures(req: FeaturesRequest): Promise<PackFeature[]> {
  const { docsDir, entry, feature, context } = req;

  // `--feature` narrows to the one feature and includes it even when it does
  // not touch the service — a known feature projects onto any living service
  // (delta's stance), and the empty sections plus the feature's own `services`
  // list ARE the answer. The default is every active feature, and "touches"
  // needs each one's C4 delta: a feature that introduces this service draws no
  // specs/<svc>/ directory yet.
  const candidates = feature !== null ? [feature] : await context.listFeatures(docsDir);
  // Batch-parse the deltas through the shared workspace before the pool walks
  // them: `prefetchLikeC4` seeds the memo, so the loop below hits it instead
  // of opening one Langium workspace per feature. Accelerator only — a
  // batch-infrastructure failure degrades silently to per-path loads, so no
  // answer in the pack can ever depend on tmpdir writability.
  await context.prefetchLikeC4(
    candidates.filter((f) => f.has.delta).map((f) => featurePaths(f.dir).delta),
  );
  // Through the pool: each delta load holds a LikeC4/Langium workspace, and an
  // unbounded fan-out over the features in flight is the memory shape the pool
  // exists to cap. Results come back in input order, which listFeatures already
  // sorted with compareIds — the pack's feature order is that order.
  const loaded: LoadedFeature[] = await inOrder(candidates, async (f) => {
    const deltaDoc = f.has.delta ? await context.loadLikeC4(featurePaths(f.dir).delta) : null;
    const services = [...new Set([...f.services, ...introducedServices(deltaDoc, f.id)])].sort(
      compareIds,
    );
    return { entry: f, deltaDoc, services };
  });
  // A feature whose delta does not parse names no services — `services` above
  // is only its specs/ list — so "does it touch this one?" has no answer. It
  // is INCLUDED, with its errors riding in `architecture.errors` (a hole the
  // command turns into exit 1), because dropping it makes the feature vanish
  // from every service's pack at exit 0: an agent then works in the service
  // believing nothing is in flight, which is the vacuously-green trap again,
  // one document up.
  const deltaUnread = (l: LoadedFeature): boolean =>
    l.deltaDoc !== null && l.deltaDoc.errors.length > 0;
  const included =
    feature !== null
      ? loaded
      : loaded.filter((l) => l.services.includes(entry.id) || deltaUnread(l));

  // The living∪feature known-set delta.ts builds, so a container-targeted edge
  // resolves to the same owner here and there.
  const living = (await context.listServices(docsDir)).map((s) => s.id);
  return inOrder(included, (l) => projectFeature({ docsDir, service: entry.id, living, context, loaded: l }));
}

interface ProjectRequest {
  docsDir: DocsDir;
  service: ServiceEntry["id"];
  living: string[];
  context: FleetContext;
  loaded: LoadedFeature;
}

async function projectFeature(req: ProjectRequest): Promise<PackFeature> {
  const { docsDir, service, living, context, loaded } = req;
  const { entry: f, deltaDoc, services } = loaded;
  const paths = featurePaths(f.dir);
  const specPaths = featureSpecPaths(f.dir, service);

  // Independent reads, fanned out; the contract projections carry their own
  // readability flags, so nothing here throws for a document that merely does
  // not parse — an unparseable delta is a HOLE the pack reports and the
  // command turns into exit 1, never a refusal.
  const [intentText, reqs, archReqs, api, events] = await Promise.all([
    f.has.intent ? context.readText(paths.intent) : null,
    existsSync(specPaths.spec) ? context.readRequirements(specPaths.spec) : [],
    existsSync(specPaths.archSpec) ? context.readRequirements(specPaths.archSpec) : [],
    apiChanges(specPaths.openapi),
    eventChanges(specPaths.asyncapi),
  ]);

  return {
    feature: f.id,
    path: repoPath(docsDir, f.dir),
    services,
    intent: intentText === null ? null : stripFrontmatter(intentText).trim(),
    requirements: reqs.map(packRequirement),
    archRequirements: archReqs.map(packRequirement),
    ...apiSplit(api),
    events,
    architecture: archSlice(deltaDoc, service, f.id, new Set([...living, ...services])),
  };
}

/**
 * The delta payload's split shape, kept verbatim: `api` stays exactly the
 * operations array `loam delta` emits, and the document's readability rides
 * alongside as its own key — a consumer indexing one must not have to learn a
 * second shape here.
 */
function apiSplit(api: ApiSlice): { api: ApiChange[]; openapi: { unreadable: boolean; error?: string } } {
  return {
    api: api.changes,
    openapi: { unreadable: api.unreadable, ...(api.error === undefined ? {} : { error: api.error }) },
  };
}
