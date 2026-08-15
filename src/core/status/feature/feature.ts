/**
 * One feature: the full report. `featureStatus` gathers what the shared gates
 * say about a feature in flight — findings, the artifact table, the record,
 * the dependency order — and rolls them up into the stage and the steps. The
 * vocabulary it reports in lives in ../report.ts, whose header holds the rules
 * this projection is held to.
 */
import { featureCoherence, invalidSpecServiceFindings, livingMergeConflicts, unknownDeltaServices } from "../../coherence.js";
import { analyzeDependencies } from "../../dependencies.js";
import { repoPath } from "../../envelope/json.js";
import { FleetContext } from "../../fleet-context.js";
import { featureProvenance } from "../../provenance/findings.js";
import type { FeatureEntry } from "../../repo/entries.js";
import { featureSpecServices } from "../../repo/repo.js";
import { gatesArchive, type Issue } from "../../vocabulary/issue.js";
import type { Finding } from "../../vocabulary/report.js";
import { contractOwners, contractsHeldElsewhere } from "../contracts.js";
import { readInterruptedCommit } from "../interrupted.js";
import type {
  ArtifactState,
  ArtifactStatus,
  FeatureStatusReport,
  InterruptedCommit,
  VerificationState,
} from "../report.js";
import { governedServices, scanDeltas, type DeltaScan } from "../scan.js";
import { fullyVerified, verificationState } from "../verification.js";
import { featureArtifacts } from "./artifacts.js";
import { featureNext, unshippable } from "./next.js";

/**
 * Everything about one feature in flight. `service` narrows the per-service
 * artifacts and the per-service steps; the feature's own `services` list stays
 * complete either way, because a narrowed view that also hid which other
 * services exist would read as a feature that touches exactly one.
 */
export async function featureStatus(
  docsDir: string,
  feature: FeatureEntry,
  opts: { service?: string; boundService?: string; context?: FleetContext } = {},
): Promise<FeatureStatusReport> {
  const context = opts.context ?? new FleetContext();
  const interrupted = await readInterruptedCommit(docsDir);
  const services = await featureSpecServices(feature.dir, context);
  const narrowed = opts.service;
  const inView = narrowed === undefined ? services : services.filter((s) => s === narrowed);

  const scans = feature.archived ? [] : await scanDeltas(docsDir, feature, services, context);
  const read = await verificationState(docsDir, feature);
  const verification = read.state;
  // An archived feature is history: its delta is already folded into the living
  // docs, so coherence would grade the change against a world that has absorbed
  // it and report contradictions that are only the merge having happened. The
  // same reason `list` never calls an archived record stale.
  const findings = feature.archived ? [] : await featureFindings(docsDir, feature, scans, context);
  // `verify.scenario-attested` rides in the same array an agent already parses,
  // under verify's own code — a feature confirmed the short way has to be
  // MARKED here, not merely absent from `stage: done`. It is a warning and it
  // gates nothing, so `coherent` is untouched.
  if (!feature.archived && read.notice !== null) {
    findings.push({ severity: read.notice.severity, code: read.notice.code, message: read.notice.message });
  }
  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warn").length;
  // The union of the two gates, and the set every verdict below is drawn from.
  const blocking = findings.filter(unshippable);

  const governs = governedServices(scans);
  // The whole feature is graded, then the view is narrowed — never the other
  // way round. `--service` is a lens on the table and the steps; a rollup that
  // moved with it would report a feature `ready` because the one service you
  // asked about happens to be written, while three others have nothing.
  const graded = featureArtifacts(
    docsDir,
    feature,
    services,
    blocking,
    verification,
    contractsHeldElsewhere(await contractOwners(docsDir, context), feature.id),
    governs,
  );
  const artifacts =
    narrowed === undefined ? graded : graded.filter((a) => a.service === null || a.service === narrowed);

  // The dependency index rather than the `*-pending` issue codes: those name the
  // other feature in prose, and prose is not an API — dependencies.ts opens with
  // exactly that argument. An archived feature waits on nothing; it landed.
  const graph = feature.archived
    ? null
    : await analyzeDependencies(docsDir, feature.id, context);
  const blockedBy = graph?.nodes.find((n) => n.id === feature.id)?.dependsOn ?? [];

  return {
    interrupted,
    feature: {
      id: feature.id,
      dirName: feature.dirName,
      path: repoPath(docsDir, feature.dir),
      archived: feature.archived,
      stage: featureStage(feature, graded, services, blocking.length, blockedBy, verification, interrupted),
      services,
      blockedBy,
    },
    service: narrowed ?? null,
    artifacts,
    checks: {
      ran: !feature.archived,
      coherent: errors.length === 0,
      errors: errors.length,
      warnings,
      gating: findings.filter((f) => f.gates === true).length,
      issues: findings,
    },
    verification,
    next: featureNext(
      feature,
      inView,
      artifacts,
      findings,
      blockedBy,
      verification,
      scans,
      opts.boundService,
      interrupted,
    ),
  };
}

/**
 * Everything `loam validate --feature` and `loam archive` would say about this
 * feature, in one list, through the very functions they call.
 *
 * Coherence alone was not it. `validate --feature` also runs `featureProvenance`
 * over intent.md and the scenario-coverage check over every per-service delta,
 * and both grade ERRORS — so a feature whose requirements carry no scenario at
 * all read `coherent: true` here while `validate` exited 1 on the same tree.
 * The coherence findings carry `gates` resolved, because archive's question is
 * not severity's (issue.ts) and no consumer should re-derive it.
 */
async function featureFindings(
  docsDir: string,
  feature: FeatureEntry,
  scans: DeltaScan[],
  context: FleetContext,
): Promise<Finding[]> {
  const issues: Issue[] = await featureCoherence(docsDir, feature.dir, feature.id, undefined, context);
  const out: Finding[] = issues.map((i) => ({
    severity: i.severity,
    code: i.code,
    gates: gatesArchive(i),
    ...(i.subject === undefined ? {} : { subject: i.subject }),
    message: i.message,
  }));
  out.push(...(await featureProvenance(feature.dir, feature.id)).filter((f) => f.severity !== "ok"));
  // The three refusals `archive` makes before its merge plan runs, from the
  // same functions it calls: a per-service delta addressed to a service that
  // exists nowhere, a specs/ directory whose NAME the id grammar refuses
  // (that one is refused before archive plans anything — the name itself is
  // the path it would become), and a LIVING document still holding git
  // conflict markers. None are coherence issues — one is about a service id
  // that means nothing, one about a name that can never be a path, one about
  // a LIVING document nobody wrote — so they reach archive outside
  // `featureCoherence`, and a projection that only inherited coherence
  // printed "ship it" over all three. Errors: each is a refusal, and the rule
  // this module is held to is one-directional.
  out.push(...(await unknownDeltaServices(docsDir, feature.dir, feature.id, undefined, context)));
  out.push(...(await invalidSpecServiceFindings(feature.dir, context)));
  out.push(...(await livingMergeConflicts(docsDir, await featureSpecServices(feature.dir, context), context)));
  for (const scan of scans) {
    if (scan.bare.length === 0) continue;
    out.push({
      severity: "error",
      code: "requirements.missing-scenarios",
      subject: scan.service,
      message: `${scan.label}: ${scan.bare.length} requirement(s) without a scenario`,
      details: scan.bare.map((r) => r.name),
    });
  }
  return out;
}

/**
 * The feature's own rollup, worst first. The order is the order the work has to
 * happen in, so the winning branch is also the phase the feature is in:
 * unwritten artifacts come before an ordering problem (you can author while
 * another feature is still in flight), an ordering problem comes before this
 * feature's own errors (fixing them may be pointless until the other one
 * lands), and everything comes before the record — answers written over a
 * broken feature are answers to questions that are about to change.
 *
 * The record is excluded from the `missing` branch on purpose. It is not
 * something an author writes: it is the done-check's output, and counting its
 * absence as unwritten work would report every correctly-authored feature as
 * `missing` right up until somebody ran `loam verify` — which is the state
 * `ready` exists to name, and which the fleet form already names correctly.
 */
function featureStage(
  feature: FeatureEntry,
  artifacts: ArtifactState[],
  services: string[],
  blocking: number,
  blockedBy: string[],
  verification: VerificationState,
  interrupted: InterruptedCommit | null,
): ArtifactStatus {
  // Ahead of `archived`, and ahead of everything else: a killed commit may be
  // this very feature's, half-applied, so "it shipped" is a claim about files
  // nobody has established the contents of. `blocked` is the honest word — the
  // work is stalled on something that is not this feature's artifact — and it
  // is what stops the projection printing `done` over a half-merged repo.
  if (interrupted !== null) return "blocked";
  if (feature.archived) return "done";
  // A feature with no `specs/<service>/` changes nothing. There is no artifact
  // row to be missing — the rows are per service — so the emptiness itself is
  // the finding, and `next.touch-service` is the step.
  if (services.length === 0) return "missing";
  if (artifacts.some((a) => a.id !== "verification" && a.status === "missing")) return "missing";
  if (blockedBy.length > 0) return "blocked";
  if (blocking > 0) return "draft";
  return fullyVerified(verification) ? "done" : "ready";
}
