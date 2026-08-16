/**
 * The feature target: a delta graded on its own, before anything merges.
 *
 * Everything here reads the feature directory — delta.likec4, the per-service
 * spec.md/arch.spec.md deltas, the provenance stamp — and grades the documents
 * a merge is about to fold into living ones. A delta is held to the same
 * document rules as the file it becomes (`./checks/requirements.js`), because
 * grading it more leniently is how a defect acquires a signature saying it was
 * reviewed.
 *
 * The one question that needs the LIVING fleet — what in this delta is actually
 * new architecture — is `./arch-coverage.js`.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { elementService, loadFile, type Elem, type LoadedDoc, type Rel } from "../../core/c4/likec4.js";
import { type PathableService } from "../../core/kernel/ids.js";
import { type FeatureEntry } from "../../core/repo/entries.js";
import { featurePaths, featureSpecPaths, servicePaths } from "../../core/repo/paths.js";
import { docsRepoState } from "../../core/repo/state.js";
import { featureSpecServices, listServices } from "../../core/repo/repo.js";
import { type Finding, type TargetReport } from "../../core/vocabulary/report.js";
import { parseRequirements } from "../../core/document/parse.js";
import { steplessFindings } from "../../core/document/scenarios.js";
import { type Requirement } from "../../core/document/spec.js";
import { featureCoherence } from "../../core/coherence/coherence.js";
import {
  deltaServiceUnknownFinding,
  invalidSpecServiceFindings,
} from "../../core/coherence/living.js";
import { gatesArchive } from "../../core/vocabulary/issue.js";
import { featureProvenance } from "../../core/provenance/findings.js";
import { FleetContext, documentConflictFinding } from "../../core/fleet-context.js";
import { errorText } from "./checks/vocabulary.js";
import { coverageFinding, repeatedListLineFindings } from "./checks/requirements.js";
import { deltaArchCoverage } from "./arch-coverage.js";

export async function validateFeature(
  docsDir: string,
  feature: FeatureEntry,
  preloadedLand?: LoadedDoc | null,
  fleet?: FleetContext,
): Promise<TargetReport> {
  const findings: Finding[] = [];
  const featureDir = feature.dir;
  const featureId = feature.id;

  // delta.likec4 parse + collect tagged edges. The loaded doc is kept and
  // handed to featureCoherence below — loading it is a Langium workspace spin,
  // and paying it twice per feature was the dominant cost of `validate --all`.
  let taggedEls: Elem[] = [];
  let taggedRels: Rel[] = [];
  let elements: Elem[] = [];
  let deltaRels: Rel[] = [];
  let deltaDoc: LoadedDoc | undefined;
  const deltaPath = featurePaths(featureDir).delta;
  if (existsSync(deltaPath)) {
    const res = fleet === undefined ? await loadFile(deltaPath) : await fleet.loadLikeC4(deltaPath);
    deltaDoc = res;
    if (res.errors.length > 0) {
      findings.push({
        severity: "error",
        code: "delta.invalid",
        message: `delta.likec4 has ${res.errors.length} error(s)`,
        details: res.errors.map(errorText),
      });
    } else {
      elements = res.elements;
      deltaRels = res.relationships;
      taggedEls = res.elements.filter((e) => e.tags.includes(featureId));
      taggedRels = res.relationships.filter((r) => r.tags.includes(featureId));
      findings.push({
        severity: "ok",
        code: "delta.valid",
        message: `delta.likec4 valid (${res.elements.length} elements · ${res.relationships.length} relationships)`,
      });
    }
  }

  findings.push(...(await featureProvenance(featureDir, featureId)));

  // Who this feature is allowed to address. `specs/<svc>/` is what the archive
  // materialises `services/<svc>/` from, and nothing used to ask whether that
  // name means anything: one wrong character in `--touches` passed
  // `validate --all` with zero errors, and archive then created the phantom
  // directory. A delta may legitimately name a service that does not exist yet
  // — but only one it INTRODUCES itself, in its own tagged C4. A delta that did
  // not parse proves neither (`delta.invalid` is that finding), so the question
  // is suspended there rather than answered by guessing.
  //
  // `services/<svc>/` is asked for directly rather than through the
  // enumeration: `validate --feature` is allowed to run in a docs repo with no
  // services/ at all (repo.ts takes the same position), where enumerating is a
  // refusal, not an answer.
  const featureServices = await featureSpecServices(featureDir, fleet);
  const introduces: ReadonlySet<string> = new Set(taggedEls.map(elementService));
  const deltaReadable = deltaDoc === undefined || deltaDoc.errors.length === 0;
  const unknownServices = deltaReadable
    ? featureServices.filter(
        (svc) => !existsSync(servicePaths(docsDir, svc).dir) && !introduces.has(svc),
      )
    : [];
  // The near-miss hint, on the same rule `service.unknown` uses — a typo is
  // only diagnosable against the ids that DO exist.
  const closeTo =
    unknownServices.length > 0 && docsRepoState(docsDir).kind === "ok"
      ? (await listServices(docsDir, fleet)).map((s) => s.id)
      : [];
  // The finding is coherence/living.ts's — the same words archive refuses with,
  // because it is the same conclusion about the same directory.
  for (const svc of unknownServices) findings.push(deltaServiceUnknownFinding(svc, closeTo));

  // The grammar half of the same guarantee. `delta.service-unknown` asks whether
  // the directory names a service anyone knows; this asks whether the NAME could
  // ever be one. The two are independent on purpose: a tagged element whose
  // title matches the directory answers the first question, which is exactly how
  // `specs/Payment Service/` used to validate green and archive into a directory
  // no loam command can address. Not suspended on an unreadable delta either —
  // no reading of the architecture axis can make the name legal.
  findings.push(...(await invalidSpecServiceFindings(featureDir, fleet)));

  // Requirement coverage across every per-service delta — the business spec and
  // the arch spec through the same check — and collect scenario text.
  let scenarioText = "";
  const archDeltas: Array<{ service: PathableService; reqs: Requirement[] }> = [];
  for (const svc of featureServices) {
    const p = featureSpecPaths(featureDir, svc);
    if (existsSync(p.spec)) {
      const raw = fleet === undefined ? await readFile(p.spec, "utf8") : await fleet.readText(p.spec);
      scenarioText += "\n" + raw.toLowerCase();
      const reqs = fleet === undefined ? parseRequirements(raw) : await fleet.readRequirements(p.spec);
      // Both document-level breaches carry into the living spec through the
      // merge, so a delta is graded for them exactly as a living document is:
      // conflict markers merge as prose under someone's requirement, and a
      // stepless scenario merges as a requirement the coverage rule calls
      // covered forever after.
      const conflict = documentConflictFinding(`${svc}: spec.md`, svc, raw);
      if (conflict !== null) findings.push(conflict);
      findings.push({ ...coverageFinding(`${svc}: requirements`, reqs), subject: svc });
      findings.push(...steplessFindings(`${svc}: requirements`, svc, reqs));
      // The keep-last quirk loses lines in a delta exactly as in a living spec
      // — and a delta's lost Operations: line then merges into the living one.
      findings.push(...repeatedListLineFindings(reqs, `${svc}: spec.md`, svc));
    }
    if (existsSync(p.archSpec)) {
      const raw = fleet === undefined ? await readFile(p.archSpec, "utf8") : await fleet.readText(p.archSpec);
      scenarioText += "\n" + raw.toLowerCase();
      const reqs = fleet === undefined ? parseRequirements(raw) : await fleet.readRequirements(p.archSpec);
      archDeltas.push({ service: svc, reqs });
      const conflict = documentConflictFinding(`${svc}: arch.spec.md`, svc, raw);
      if (conflict !== null) findings.push(conflict);
      findings.push({ ...coverageFinding(`${svc}: arch requirements`, reqs), subject: svc });
      findings.push(...steplessFindings(`${svc}: arch requirements`, svc, reqs));
      findings.push(...repeatedListLineFindings(reqs, `${svc}: arch.spec.md`, svc));
    }
  }

  findings.push(
    ...(await deltaArchCoverage({
      docsDir,
      elements,
      relationships: deltaRels,
      taggedEls,
      taggedRels,
      archDeltas,
      featureServices,
      scenarioText,
      preloadedLand,
      fleet,
    })),
  );


  // Coherence — cross-axis consistency (C4 ↔ requirements ↔ OpenAPI).
  const issues = await featureCoherence({ docsDir, featureDir, featureId, preloadedDelta: deltaDoc, context: fleet });
  if (issues.length === 0) {
    findings.push({
      severity: "ok",
      code: "coherence.ok",
      message: "coherence: ✓ C4 · requirements · OpenAPI agree",
      text: { indent: 2, marker: false },
    });
  } else {
    for (const i of issues) {
      findings.push({
        severity: i.severity,
        code: i.code,
        gates: gatesArchive(i),
        ...(i.subject === undefined ? {} : { subject: i.subject }),
        message: i.message,
        text: { indent: 4, header: "coherence:" },
      });
    }
  }

  return { kind: "feature", id: featureId, findings };
}
