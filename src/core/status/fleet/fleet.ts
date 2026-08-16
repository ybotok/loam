/**
 * The whole repository — why the fleet form is cheaper than the feature form.
 *
 * `loam status` with no feature runs over every active feature, and deriving a
 * coherence report or a verification checklist per feature means spinning a
 * fresh LikeC4 workspace per feature. On a fleet-sized repository that is the
 * cost that gets a command switched off — `list` made the same call about its
 * verification column. So the fleet form grades nothing: it reports artifact
 * PRESENCE, the dependency order, and a verification record only where one
 * already exists, and its `next[]` hands off to `loam status <FEAT>`, which is
 * where the checks actually run.
 */
import { existsSync } from "node:fs";
import { analyzeDependencies } from "../../dependencies/dependencies.js";
import { type DependencyGraph } from "../../dependencies/facts.js";
import { repoPath } from "../../envelope/json.js";
import { FleetContext } from "../../fleet-context.js";
import { compareIds, type FeatureEntry } from "../../repo/entries.js";
import { featurePaths, featureSpecPaths } from "../../repo/paths.js";
import { listFeatures, listServices } from "../../repo/repo.js";
import { contractOwners, contractsHeldElsewhere, owesContract } from "../contracts.js";
import { readInterruptedCommit } from "../interrupted.js";
import {
  undocumented,
  vouched,
  type ArtifactStatus,
  type FleetFeatureState,
  type FleetStatusReport,
  type InterruptedCommit,
} from "../report.js";
import { governedServices, scanDeltas } from "../scan.js";
import { fullyVerified, verificationState } from "../verification.js";
import { fleetNext } from "./next.js";

/**
 * The fleet view: how much of `services/` anyone has written down, every
 * feature in flight with the stage it has reached, and the order they have to
 * land in. Nothing here is graded — the module header says why — so the stages
 * are drawn from artifact presence and from a record that already exists, and
 * `next[]` hands off to `loam status <FEAT>` for everything else.
 */
export async function fleetStatus(
  docsDir: string,
  opts: { service?: string; bound?: string; context?: FleetContext } = {},
): Promise<FleetStatusReport> {
  const context = opts.context ?? new FleetContext();
  const interrupted = await readInterruptedCommit(docsDir);
  const narrowed = opts.service;
  const all = await listServices(docsDir, context);
  const services = narrowed === undefined ? all : all.filter((s) => s.id === narrowed);
  // The service this repository says it IS, when the fleet has never heard of
  // it. Asked against the UNNARROWED list, because "is it adopted" is a question
  // about the fleet and not about the view.
  const unadopted =
    opts.bound !== undefined && !all.some((s) => s.id === opts.bound) ? opts.bound : null;
  const graph = await analyzeDependencies(docsDir, undefined, context);
  const entries = await listFeatures(docsDir, {}, context);
  const inScope = narrowed === undefined ? entries : entries.filter((f) => f.services.some((s) => s === narrowed));
  // Once for the fleet, not once per feature: which features hold a contract
  // for which service is one fact about the repository, and every feature below
  // reads its own row out of it. Built over the UNNARROWED list on purpose — a
  // `--service` view still has to know that a feature outside it discharges the
  // contract, or the narrowing would invent an obligation.
  const owners = await contractOwners(docsDir, context);

  const features = await Promise.all(
    inScope.map((f) =>
      fleetFeature(docsDir, f, {
        graph,
        contracted: contractsHeldElsewhere(owners, f.id),
        context,
        interrupted,
      }),
    ),
  );
  features.sort((a, b) => compareIds(a.id, b.id));

  return {
    interrupted,
    services: {
      total: services.length,
      undocumented: services.filter(undocumented).length,
      draft: services.filter((s) => !undocumented(s) && !vouched(s)).length,
      vouched: services.filter(vouched).length,
    },
    features,
    order: graph.order.filter((id) => features.some((f) => f.id === id)),
    service: narrowed ?? null,
    // The binding is passed only when this run was NOT narrowed. `--service X`
    // is an explicit question about X, and answering it with a step about
    // whichever service loam.json happens to name would be a different
    // question's answer at the top of the list.
    next: fleetNext({ services, features, graph, interrupted }, narrowed === undefined ? unadopted : null),
  };
}

/** What a feature's fleet row needs about the fleet AROUND it. */
interface FleetView {
  graph: DependencyGraph;
  /** Operations some other feature's contract already holds. */
  contracted: ReadonlySet<string>;
  context: FleetContext;
  interrupted: InterruptedCommit | null;
}

async function fleetFeature(
  docsDir: string,
  feature: FeatureEntry,
  view: FleetView,
): Promise<FleetFeatureState> {
  const { graph, contracted, context, interrupted } = view;
  const paths = featurePaths(feature.dir);
  const missing: string[] = [];
  if (!existsSync(paths.intent)) missing.push("intent");
  if (feature.services.length === 0) missing.push("spec");
  // Requirement text, not a coherence run: `Operations:` lines are read off the
  // same cached parse `list` already pays for, and the contract question needs
  // them (owesContract). No LikeC4 workspace is spun here, which is the cost
  // this form actually refuses.
  const governs = governedServices(await scanDeltas(docsDir, feature, feature.services, context));
  for (const svc of feature.services) {
    const p = featureSpecPaths(feature.dir, svc);
    if (!existsSync(p.spec)) missing.push(`${svc}/spec`);
    // The same question featureArtifacts asks, through the same function: the
    // two forms must never disagree about whether a feature owes a contract.
    if (owesContract(docsDir, svc, contracted, governs.has(svc)) && !existsSync(p.openapi)) {
      missing.push(`${svc}/openapi`);
    }
  }
  const verification = (await verificationState(docsDir, feature)).state;
  const blockedBy = graph.nodes.find((n) => n.id === feature.id)?.dependsOn ?? [];

  // No `draft` here, ever: that verdict needs the coherence run this form
  // refuses to pay for, and inferring it from presence alone would be a second
  // opinion about validity — the one thing status must never invent.
  //
  // The interrupted commit leads, exactly as it does in the feature form: every
  // presence test below is a question about files a killed `archive` may have
  // half-written, so answering `done` from them is a claim about bytes nobody
  // has established. Without this the two forms contradicted each other over
  // one repository — `loam status --json` said `done` and offered "ship it"
  // while `loam status <FEAT>` said `blocked` — and the rule in report.ts's
  // header is that this projection is never greener than the gates.
  const stage: ArtifactStatus =
    interrupted !== null
      ? "blocked"
      : missing.length > 0
        ? "missing"
        : blockedBy.length > 0
          ? "blocked"
          : fullyVerified(verification)
            ? "done"
            : "ready";

  return {
    id: feature.id,
    dirName: feature.dirName,
    path: repoPath(docsDir, feature.dir),
    stage,
    services: feature.services,
    blockedBy,
    missing,
    verification,
  };
}
