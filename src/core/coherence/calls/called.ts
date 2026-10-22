/**
 * The services a feature's delta CALLS an operation on — the target of every
 * tagged edge carrying `metadata { op }`, resolved the way coherence's own
 * edge checks resolve it.
 *
 * Read for `loam status` (`core/status/contracts.ts`), which has to know
 * whether a service is owed an `openapi.yaml` and used to answer "always" for a
 * service the living docs had never heard of. An op-linked edge into a service
 * is one of the two things that make its contract owed: `c4-api.op-undefined`
 * grades exactly these edges against that file, so a service called this way
 * with no contract is a gate error, and a status that said "none owed" beside
 * it would contradict its own payload.
 *
 * A second reading of the join `../coherence.ts`'s edge loop makes, not that
 * loop itself: the loop grades each edge as it goes and keeps no list. It lives
 * beside it so the two are read together — the same tagged edges, the same
 * fleet set handed to the same resolver — and a change to which edges the gate
 * grades has to be made in both.
 *
 * Through the context's memo: both status forms have already parsed the delta
 * by the time they ask (the coherence pass, the dependency graph), so this is
 * a lookup, never a second LikeC4 workspace.
 */
import { existsSync } from "node:fs";
import { serviceResolver } from "../../c4/resolve/service.js";
import type { FleetContext } from "../../fleet-context.js";
import { featurePaths } from "../../repo/paths.js";
import { featureSpecServices } from "../../repo/repo.js";
import { enumeratedServiceIds } from "../../repo/service-target.js";
import type { DeltaScope } from "../declared.js";

/**
 * The called services, or `unreadable` when the delta does not parse — which
 * is not "nobody is called": loam could not look, and `delta.invalid` already
 * gates. A feature with no delta calls nobody.
 */
export async function calledServices(scope: DeltaScope, context: FleetContext): Promise<ReadonlySet<string> | "unreadable"> {
  const { docsDir, featureDir, featureId } = scope;
  const deltaPath = featurePaths(featureDir).delta;
  if (!existsSync(deltaPath)) return new Set();
  const doc = await context.loadLikeC4(deltaPath);
  if (doc.errors.length > 0) return "unreadable";
  // The same fleet set coherence hands its resolver — `services/` plus this
  // feature's own `specs/` — so an edge into a modelled container names the
  // service that owns it, never a service called after the container.
  const known = new Set<string>([
    ...(await enumeratedServiceIds(docsDir, context)),
    ...(await featureSpecServices(featureDir, context)),
  ]);
  const svcOf = serviceResolver(doc.elements, known);
  return new Set(
    doc.relationships.filter((r) => r.op !== undefined && r.tags.includes(featureId)).map((r) => svcOf(r.target)),
  );
}
