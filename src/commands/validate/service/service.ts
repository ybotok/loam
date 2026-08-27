/**
 * The service target: one adopted service graded across every axis it owns.
 *
 * This module is the ORDER, not the checks. It reads what more than one axis
 * joins through — the C4 model, the living landscape and its resolver, the two
 * requirement documents — hands each of those to the axis that grades it, and
 * pushes the findings in the sequence the report is read in. The axes
 * themselves cannot see each other, which is the point: `./api.js` decides once
 * whether there is a contract to read, and `./spine.js` is handed the answer
 * instead of re-deriving it against a file it would open a second time.
 */
import { existsSync } from "node:fs";
import { loadFile, type Elem, type Rel } from "../../../core/c4/likec4.js";
import { serviceResolver } from "../../../core/c4/resolve/service.js";
import { type PathableService } from "../../../core/kernel/ids/service.js";
import { capabilitiesPath, landscapePath as landscapeFile, permissionsPath } from "../../../core/repo/paths.js";
import { locateServicePaths } from "../../../core/repo/service-target.js";
import { readVocabulary } from "../../../core/permissions/permissions.js";
import { readCapabilities } from "../../../core/capabilities/capabilities.js";
import { capabilityUnknownFindings } from "../../../core/capabilities/findings.js";
import { requiresUnknownFindings } from "../checks/requirements.js";
import { listServices } from "../../../core/repo/repo.js";
import { type LoadedDoc } from "../../../core/c4/likec4.js";
import { type Finding, type TargetReport } from "../../../core/vocabulary/report.js";
import { closeIds } from "../../../core/c4/arch.js";
import { serviceProvenance } from "../../../core/provenance/findings.js";
import { gherkinFindings } from "../../../core/gherkin/stale.js";
import { gherkinRoot } from "../../../core/gherkin/stamp.js";
import { UnsafePathError } from "../../../core/kernel/path-safety.js";
import { interruptedCommitFinding } from "../../../core/staging/recovery/finding.js";
import { FleetContext } from "../../../core/fleet-context.js";
import { errorText } from "../checks/vocabulary.js";
import { sourceScopeFindings } from "../checks/sources.js";
import { apiAxisFindings } from "./api.js";
import { evidencePinFindings } from "./evidence-pins.js";
import { spineFindings } from "./spine.js";
import { eventAxisFindings } from "./events/events.js";
import { archAxisFindings, readServiceSpecs } from "./specs.js";
import type { DocsDir } from "../../../core/kernel/ids/dirs.js";

/**
 * A service's absences are graded by what each one proves.
 *
 * `service.unknown` (error): the directory itself does not exist — the id is a
 * typo until proven otherwise, so the hint names ids that DO exist and never
 * `loam adopt`, which would faithfully document the misspelling.
 * `service.no-model` (error): the directory is real but the C4 center is not —
 * adopt is the right hint. Every check that does not read the model still runs
 * (spec coverage, the arch axis, provenance, gherkin staleness): archive
 * creates exactly this state for a new service, and those signals must not go
 * quiet there.
 * `service.no-spec` / `service.no-openapi` (warn): the adopt brief marks both
 * required, but a fleet mid-rollout legitimately has part-adopted services —
 * the absence must stay visible without gating CI for months. The openapi warn
 * keeps quiet when the landscape proves nobody calls an operation on this
 * service: a worker with no API is not missing one.
 * `api.ops-unlinked` (warn): an OpenAPI and requirements that never name each
 * other pass every cross-axis check vacuously — a repo migrated from OpenSpec
 * does exactly that by default, and vacuous is not the same as checked.
 */
interface ServiceCheck {
  docsDir: DocsDir;
  service: PathableService;
  /** The service's own repo, when loam is standing in it. Undefined from the docs repo. */
  repoDir?: string;
  /** The living landscape under --all; undefined means "load it if you need it", null means "there is none". */
  preloaded?: LoadedDoc | null;
  gherkinDir?: string;
  fleet?: FleetContext;
  /**
   * True when this run ALSO emits a `landscape` target. It decides one thing:
   * whether a landscape parse error's details are repeated here. Under --all
   * they are not — the landscape target already carries them once, and N copies
   * of one parser's cascade is the whole report.
   */
  landscapeReported?: boolean;
}


export async function validateService(check: ServiceCheck): Promise<TargetReport> {
  const { docsDir, service, repoDir, preloaded, gherkinDir, fleet } = check;
  // The spine and event joins below all ask the landscape's resolver one
  // question: does this edge's endpoint resolve into the directory being
  // validated? The resolver answers with DOCUMENT text and `service` is the
  // repository's own name — disjoint brands, so `===` between them is TS2367.
  // Widening to `string` is not a cast: membership questions cross the
  // provenance line through plain-string containers by design (kernel/ids/service.ts),
  // and nothing pathable ever comes back out of a comparison.
  const me: string = service;
  const findings: Finding[] = [];
  const report: TargetReport = { kind: "service", id: service, findings };
  const paths = await locateServicePaths(docsDir, service, fleet);

  // A directory that does not exist is a different fact from a directory with
  // everything missing: validating a typo must say "typo", not "unadopted".
  if (!existsSync(paths.dir)) {
    const close = closeIds(service, (await listServices(docsDir, fleet)).map((s) => s.id));
    findings.push({
      severity: "error",
      code: "service.unknown",
      message:
        `No service directory at ${paths.dir}.` +
        (close.length > 0
          ? ` Did you mean: ${close.join(", ")}?`
          : " `loam list services` shows what exists."),
      text: { marker: false },
    });
    return report;
  }

  // C4 model. Its absence is an error — this is where `adopt` comes in — but it
  // must NOT silence the rest of the gate stack: `loam archive` of a feature
  // introducing a new service creates exactly this state (spec.md, arch.spec.md,
  // openapi.yaml, no model.likec4), and an early return here suspended arch
  // coverage, health.uncovered, provenance (content_digest included) and the
  // gherkin staleness chain for the very services vouch had just promised them
  // to. So the finding is emitted and the walk CONTINUES; only the checks that
  // read the model itself are guarded.
  const hasModel = existsSync(paths.model);
  let elements: Elem[] = [];
  let relationships: Rel[] = [];
  if (!hasModel) {
    findings.push({
      severity: "error",
      code: "service.no-model",
      message: `No C4 model at ${paths.model}. Run \`loam adopt\` for '${service}' first.`,
      text: { marker: false },
    });
  } else {
    const model = fleet === undefined ? await loadFile(paths.model) : await fleet.loadLikeC4(paths.model);
    elements = model.elements;
    relationships = model.relationships;
    if (model.errors.length > 0) {
      findings.push({
        severity: "error",
        code: "c4.invalid",
        message: `${service}: C4 model has ${model.errors.length} error(s)`,
        details: model.errors.map(errorText),
      });
    } else {
      findings.push({
        severity: "ok",
        code: "c4.valid",
        message: `${service}: C4 model valid (${elements.length} elements · ${relationships.length} relationships)`,
      });
    }
  }

  // The living landscape, parsed at most once per run: under --all the caller
  // hands in the doc it already loaded, single-service runs load on demand. It
  // serves two checks below — the no-openapi grace and the spine.
  const land =
    preloaded ??
    (existsSync(landscapeFile(docsDir))
      ? fleet === undefined
        ? await loadFile(landscapeFile(docsDir))
        : await fleet.loadLikeC4(landscapeFile(docsDir))
      : null);

  // Which service directories actually exist — the positive evidence
  // `serviceOf` needs to resolve an edge drawn into a modelled CONTAINER
  // (`paymentService.api`) back to the service that owns it. Without it every
  // such edge resolves to the container's own title, i.e. to a service nobody
  // has ever adopted, and drops out of the spine unnoticed.
  const known = new Set((await listServices(docsDir, fleet)).map((s) => s.id));


  // The living landscape's element→service resolver, container-aware and
  // memoized. Every question below that asks "does this edge point at me?"
  // asks it through this one function, so the no-openapi grace, the HTTP spine
  // and the event spine can never disagree about which edges are inbound.
  const landSvcOf = land === null ? null : serviceResolver(land.elements, known);

  const specs = await readServiceSpecs({ service, paths, fleet });
  findings.push(...specs.findings);
  const { reqs, livingReqs, archText, archReqs } = specs;

  const api = await apiAxisFindings({
    service,
    me,
    paths,
    reqs,
    livingReqs,
    land,
    landSvcOf,
    fleet,
  });
  findings.push(...api.findings);
  findings.push(
    ...spineFindings({
      service,
      me,
      land,
      landSvcOf,
      contract: api.contract,
      landscapeReported: check.landscapeReported,
    }),
  );
  findings.push(
    ...(await eventAxisFindings({
      docsDir,
      service,
      me,
      paths,
      reqs,
      livingReqs,
      archReqs,
      land,
      landSvcOf,
      known,
      fleet,
    })),
  );
  findings.push(
    ...(await archAxisFindings({
      service,
      paths,
      archText,
      archReqs,
      elements,
      relationships,
      land,
      known,
    })),
  );

  // The authorization axis. Both requirement documents are graded against one
  // fleet vocabulary — a permission is a fleet fact, and an arch requirement
  // gates on one exactly as a business requirement does. The capability axis
  // rides the same loop against ITS fleet vocabulary; under --all the fleet
  // memo makes that one parse for the whole run.
  const vocabulary = await readVocabulary(permissionsPath(docsDir));
  const capabilities =
    fleet === undefined
      ? await readCapabilities(capabilitiesPath(docsDir))
      : await fleet.capabilities(capabilitiesPath(docsDir));
  for (const [label, docReqs] of [
    ["spec.md", reqs],
    ["arch.spec.md", archReqs],
  ] as const) {
    const target = { where: `${service}: ${label}`, subject: service };
    findings.push(...requiresUnknownFindings(docReqs, target, vocabulary));
    findings.push(...capabilityUnknownFindings(docReqs, target, capabilities));
  }

  // Provenance last: who vouched for this, and what code it was written from.
  findings.push(...(await serviceProvenance(docsDir, service, { repoDir, fleet })));
  findings.push(...(await sourceScopeFindings(docsDir, service, repoDir, fleet)));

  // The generated-gherkin freshness chain, service-repo-scoped like sources.*:
  // it needs the repo (the suite lives there), and it stays quiet until
  // <gherkinDir>/loam/ exists — a service that never generated has not opted in.
  findings.push(...(await gherkinFindings({ docsDir, service, repoDir, gherkinDir, fleet })));

  // The evidence-pin re-check, the same service-repo-scoped family: recorded
  // verification citations graded against THIS working tree, quiet from the
  // docs repo — sources.unverifiable-from-here already names that blind spot.
  findings.push(...(await evidencePinFindings(docsDir, service, repoDir, fleet)));

  // The one journal that does NOT live in the docs repo: gherkin commits into
  // the service repo's emission root. A half-committed suite graded by the
  // freshness chain above reads as merely stale — warn-severity, which never
  // gates — while doctor calls the same state a blocker. Same finding, same
  // code, led rather than appended, exactly as validate leads with the docs
  // repo's own journal.
  if (repoDir !== undefined) {
    try {
      const interrupted = await interruptedCommitFinding(gherkinRoot(repoDir, gherkinDir));
      if (interrupted !== null) findings.unshift(interrupted);
    } catch (err) {
      // An unsafe gherkinDir is `loam gherkin`'s refusal to make, with its
      // own sentence; grading declines to scan what it cannot trust.
      if (!(err instanceof UnsafePathError)) throw err;
    }
  }

  return report;
}
