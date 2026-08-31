import { existsSync } from "node:fs";
import { loadFile, type Elem, type LoadedDoc, type Rel } from "../c4/likec4.js";
import { elementService, serviceResolver } from "../c4/resolve/service.js";
import { serviceIdProblem } from "../kernel/ids/service.js";
import { deltaShapeIssues } from "../delta/delta.js";
import type { Issue } from "../vocabulary/issue.js";
import { featurePaths } from "../repo/paths.js";
import { featureSpecServices } from "../repo/repo.js";
import { enumeratedServiceIds, enumeratedServiceIndex } from "../repo/service-target.js";
import { serviceOperationIds } from "../openapi/doc.js";
import type { FleetContext } from "../fleet-context.js";
import { declaredByService, type DeltaScope } from "./declared.js";
import { coherenceLookups } from "./lookups.js";
import { eventCoherence } from "./events/events.js";
import { authoringIssues } from "./authoring/scaffold.js";
import { glossaryDeltaIssues } from "../glossary/delta.js";
import { flowDeltaIssues } from "../usecases/delta/flows.js";
import type { DocsDir, FeatureDir } from "../kernel/ids/dirs.js";


/**
 * Cross-axis consistency for a feature: do C4 (architecture), requirements (behaviour),
 * and OpenAPI (contract) agree? Errors are hard (would corrupt the living docs on archive);
 * warnings surface softer misalignments.
 *
 * `preloadedDelta` is the feature's already-parsed delta.likec4, when the caller
 * has it — loading a LikeC4 document spins up a fresh Langium workspace, the
 * dominant per-feature cost, and validate/archive have both parsed the same file
 * moments earlier. Standalone calls omit it and nothing changes: the file is
 * loaded here, exactly as before.
 */

/** How a caller names the feature being graded, and what it already has in hand. */
export interface CoherenceRequest {
  docsDir: DocsDir;
  featureDir: FeatureDir;
  featureId: string;
  /** The delta LikeC4 document, when the caller already parsed it. */
  preloadedDelta?: LoadedDoc;
  context?: FleetContext;
}

export async function featureCoherence(request: CoherenceRequest): Promise<Issue[]> {
  const { docsDir, featureDir, featureId, preloadedDelta, context } = request;
  const scope: DeltaScope = { docsDir, featureDir, featureId };
  // Delta shape first: a diff that does not apply to the living spec explains
  // everything downstream, and it is the one breach that is silent without a check.
  const issues: Issue[] = await deltaShapeIssues(docsDir, featureDir, featureId, context);

  // The vocabulary axis, and it is asked first because it is cheap and
  // independent: one `existsSync` for a feature with no glossary/, and nothing
  // downstream reads its answer. A term this feature introduces that the living
  // glossary already defines is the one thing that can go wrong on a create-only
  // merge, and it must be caught before the copy, not after.
  issues.push(...(await glossaryDeltaIssues(docsDir, featureDir)));

  // The use-case axis, and it is asked here for the vocabulary axis's reasons
  // exactly: one walk over a directory that is usually absent, nothing
  // downstream reads its answer, and a create-only merge has one thing that can
  // go wrong. A flow this feature introduces that the living `architecture/`
  // already holds must be caught before the copy, not after it has replaced an
  // authored hop sequence.
  issues.push(...(await flowDeltaIssues(docsDir, featureDir)));

  // --- C4 delta ---
  let elements: Elem[] = [];
  let taggedEls: Elem[] = [];
  let taggedRels: Rel[] = [];
  const deltaPath = featurePaths(featureDir).delta;
  if (existsSync(deltaPath)) {
    const res = preloadedDelta ?? (context === undefined ? await loadFile(deltaPath) : await context.loadLikeC4(deltaPath));
    if (res.errors.length > 0) {
      // An unreadable architecture axis can prove nothing — it must never count as coherent.
      issues.push({
        severity: "error",
        code: "delta.invalid",
        message: `delta.likec4 has ${res.errors.length} parse error(s) — architecture axis unreadable (run \`loam validate --feature ${featureId}\`)`,
      });
    } else {
      elements = res.elements;
      taggedEls = res.elements.filter((e) => e.tags.includes(featureId));
      taggedRels = res.relationships.filter((r) => r.tags.includes(featureId));
      // Every rule below filters by the feature tag, so a delta whose author
      // forgot the tags entirely passes every check and archives while merging
      // nothing. Whole-file only: once ANYTHING is tagged, deciding that an
      // untagged edge "looks intended" would be guessing.
      if (
        (res.elements.length > 0 || res.relationships.length > 0) &&
        taggedEls.length === 0 &&
        taggedRels.length === 0
      ) {
        issues.push({
          severity: "error",
          code: "delta.nothing-tagged",
          message: `delta.likec4 declares elements/relationships but none are tagged #${featureId}; loam cannot see untagged changes`,
        });
      }
    }
  }
  // --- per-service specs (requirement operations) + openapi deltas ---
  const svcNames = await featureSpecServices(featureDir, context);

  // Every axis below joins on the service id, so endpoints resolve through the
  // element's `metadata { service }` binding — never through what the box is
  // called. The enumerated fleet — `services/` plus this feature's own
  // `specs/` directories, the same union `enumeratedTarget` probes below —
  // rides into the resolver so a delta that models CONTAINERS joins correctly:
  // without it, an edge into `payment.api` resolves to a service called "api"
  // that has never existed, and every check below grades the edge against an
  // absent service instead of the one that owns the container. An unenumerable
  // services/ falls back to the feature's own names — every living probe would
  // have found nothing there anyway.
  const fleetIds = await enumeratedServiceIds(docsDir, context);
  const svcOf = serviceResolver(elements, new Set<string>([...fleetIds, ...svcNames]));

  // Which elements the landscape merge would SPLICE: the tagged ones and
  // everything nested inside their blocks. Defined here because two checks
  // share it — the scaffold gate just below, and the binding-grammar check
  // near the end of this function — and the merge carries a tagged element's
  // authored block over byte for byte, children included, so a scope narrower
  // than the splice lets a nested child's text ride through unread.
  const taggedIds = taggedEls.map((el) => el.id);
  const ridesWithTag = (el: Elem): boolean =>
    el.tags.includes(featureId) || taggedIds.some((id) => el.id.startsWith(`${id}.`));

  // The scaffold gate: placeholder text and an unwritten intent are legal
  // documents whose merge would publish content nobody authored — the exact
  // template strings `loam new` wrote (authoring/scaffold.ts owns the list).
  issues.push(
    ...(await authoringIssues({ featureDir, featureId, splicedEls: elements.filter(ridesWithTag), svcNames, context })),
  );
  const {
    reqOps, removingOps, featureApiOps, unreadableApis,
  } = await declaredByService(scope, svcNames, issues, context);
  const {
    governedByLivingSpec, edgeConsumers, requirementConsumers, definedElsewhere,
    deprecatedInLiving, undeprecatedByFeature,
  } = coherenceLookups(scope, context);

  for (const [svc, retiring] of removingOps) {
    for (const op of retiring) {
      const consumers = [...(await edgeConsumers(svc, op)), ...(await requirementConsumers(svc, op))];
      if (consumers.length === 0) continue;
      issues.push({
        severity: "error",
        code: "openapi.remove-op-consumed",
        subject: svc,
        message: `${svc}: this feature retires '${op}', but the living fleet still consumes it — ${consumers.join("; ")}. Retire the consumer in the same feature (drop the edge from architecture/landscape.likec4, or the requirement that names it), or archive with --approve to break it deliberately.`,
      });
    }
  }

  // E1: Spec -> API — every operation a requirement governs must exist in that service's OpenAPI.
  for (const [svc, ops] of reqOps) {
    // The union below reads the feature's own contract; unreadable means the
    // op may well be defined in the file nobody could open, and `op-undefined`
    // would point the author at the requirement when the truth is the YAML.
    // `openapi.invalid` (declared.ts) already gates; one breach, one finding.
    if (unreadableApis.has(svc)) continue;
    const available = await serviceOperationIds(docsDir, svc, featureDir, context);
    for (const op of ops) {
      if (available.includes(op)) continue;
      const other = await definedElsewhere(svc, op);
      if (other !== undefined) {
        issues.push({ severity: "warn", code: "spec-api.op-pending", message: `requirement in ${svc} governs '${op}', defined by in-flight ${other} — archive it first` });
        continue;
      }
      issues.push({ severity: "error", code: "spec-api.op-undefined", message: `requirement in ${svc} governs '${op}', not defined in ${svc}'s OpenAPI` });
    }
  }

  // The declared→enumerated bridge for edge TARGETS. `svcOf` answers with
  // whatever the document wrote — `metadata { service '../../x' }` parses in
  // LikeC4 without one error — and every living lookup below joins its answer
  // into `services/<target>/` or `specs/<target>/`. So a target resolves
  // through the enumerations first (the fleet's `services/` plus this
  // feature's own `specs/`, where a service it introduces lives), and a name
  // neither knows skips the lookups — no ops, not governed, not deprecated —
  // grading exactly as an absent service, spelled with the declared name.
  const enumeratedTarget = enumeratedServiceIndex(docsDir, svcNames, context);

  // E2 / W1 / W4: C4 edges vs API + requirements.
  for (const r of taggedRels) {
    if (r.op === undefined) {
      if ((r.title ?? "").toLowerCase().startsWith("call")) {
        issues.push({ severity: "warn", code: "c4.op-link-missing", message: `edge ${svcOf(r.source)} → ${svcOf(r.target)} ("${r.title}") has no operation link (metadata { op })` });
      }
      continue;
    }
    const target = svcOf(r.target);
    const pathable = await enumeratedTarget(target);
    // Same suspension as E1, but only for the verdicts that READ a contract:
    // does the op exist, is it being removed, is it deprecated (whose
    // un-deprecation escape reads the feature contract too). Each of those
    // would be an opinion about a file nobody could open. The governance
    // question below is deliberately NOT suspended — it joins the edge against
    // requirement documents alone, so the broken YAML could never change its
    // answer, and silencing it deferred a real warning for no reason.
    const contractUnreadable = pathable !== undefined && unreadableApis.has(pathable);
    const available =
      pathable === undefined || contractUnreadable
        ? []
        : await serviceOperationIds(docsDir, pathable, featureDir, context);
    if (contractUnreadable) {
      // openapi.invalid (declared.ts) already gates; one breach, one finding.
    } else if (pathable !== undefined && removingOps.get(pathable)?.has(r.op) === true) {
      issues.push({ severity: "error", code: "c4-api.op-removing", message: `${svcOf(r.source)} builds new consumption on '${r.op}', which this feature removes from ${target}` });
    } else if (!available.includes(r.op)) {
      const other = await definedElsewhere(target, r.op);
      if (other !== undefined) {
        issues.push({ severity: "warn", code: "c4-api.op-pending", message: `${svcOf(r.source)} calls '${r.op}' on ${target}, defined by in-flight ${other} — archive it first` });
      } else {
        issues.push({ severity: "error", code: "c4-api.op-undefined", message: `${svcOf(r.source)} calls '${r.op}' on ${target}, but ${target}'s OpenAPI does not define it (contract broken)` });
      }
    }
    // Governed by THIS target's requirements, not by anybody's. An operationId
    // is unique only inside one contract, so the fleet-wide set this used to
    // ask meant a `getStatus` governed in service A silenced the question for
    // service B's entirely unrelated `getStatus` — the warning went quiet for
    // the edge that needed it, and only in repos where some other service
    // happened to reuse the name. The living half on the same line has always
    // joined per service (`governedByLivingSpec(target, …)`); this is the delta
    // half asking it the same way.
    if (pathable === undefined || (!(reqOps.get(pathable) ?? []).includes(r.op) && !(await governedByLivingSpec(pathable, r.op)))) {
      issues.push({ severity: "warn", code: "c4.op-ungoverned", message: `'${r.op}' is called by ${svcOf(r.source)} but no requirement governs it` });
    }
    // Lifecycle: this NEW tagged edge builds consumption on an operation the
    // living provider contract already marks deprecated. Advisory, never an
    // archive gate — the edge is legal and the contract holds — but new
    // consumption of a dying op deserves an eye before it ships. Quiet when
    // the feature's own openapi delta drops the flag: that state is the fix
    // in progress, not new consumption of a dying op.
    if (!contractUnreadable && pathable !== undefined && (await deprecatedInLiving(pathable, r.op)) && !(await undeprecatedByFeature(pathable, r.op))) {
      issues.push({ severity: "warn", code: "c4-api.op-deprecated", message: `${svcOf(r.source)} builds new consumption on '${r.op}', which ${target}'s living OpenAPI marks deprecated — prefer the replacement operation` });
    }
  }

  // W2: API -> C4 — every operation the feature adds should be consumed by some edge.
  const consumed = new Set(taggedRels.map((r) => r.op).filter((o): o is string => o !== undefined));
  for (const op of featureApiOps) {
    if (!consumed.has(op)) {
      issues.push({ severity: "warn", code: "api.op-unconsumed", message: `operation '${op}' is added but no architecture edge consumes it (provider-only or unmodeled)` });
    }
  }

  // W3: a new service should carry a requirement delta.
  for (const e of taggedEls) {
    const svc: string = elementService(e);
    if (e.kind === "softwareSystem" && !svcNames.some((n) => n === svc)) {
      issues.push({ severity: "warn", code: "service.no-requirement-delta", message: `new service ${svc} has no requirement delta under specs/` });
    }
  }

  // An explicit `metadata { service '<id>' }` binding, held to the same grammar
  // every `--service` flag is — on the tagged elements AND everything nested
  // inside their blocks. The scope is the splice's, not the tag's: the
  // landscape merge carries a tagged element's authored block over byte for
  // byte, children included (landscape-merge.ts's rides() exists exactly so a
  // child travels inside its parent's text), so an untagged container's
  // binding reaches the living map as surely as its tagged parent's — and
  // checking only the tagged elements themselves let it ride through unread.
  // The binding is the one name the archive TRUSTS: the merge splices it into
  // the living map verbatim, and the new-service scan probes
  // `services/<binding>/` with it — where `metadata { service '../outside-svc' }`,
  // which LikeC4 parses without a murmur, collapses the probe right out of
  // services/, and the spliced map fails the very next `validate --all`
  // (`landscape.binding-unknown`). Explicit bindings only, on purpose: a prose
  // title with no binding is legal C4, and a title becomes a path only through
  // `specs/<svc>/`, whose own grammar check (`delta.service-id-invalid`)
  // guards that route. `ridesWithTag` itself is defined up beside the scaffold
  // gate, which shares the splice's scope for the same reason.
  for (const e of elements.filter(ridesWithTag)) {
    if (e.service === undefined) continue;
    const problem = serviceIdProblem(e.service, "metadata { service } binding");
    if (problem === null) continue;
    issues.push({
      severity: "error",
      code: "c4.service-binding-invalid",
      subject: e.service,
      message:
        `'${e.title}' (${e.id}) — ${problem} ` +
        `\`loam archive\` would splice '${e.service}' into the living landscape.likec4 exactly as written, ` +
        `and probe services/${e.service}/ with it. Bind the element to the services/<id>/ directory it means.`,
    });
  }

  // The event axis — the same three-way agreement the operation checks above
  // grade, joined on the message name instead of the operationId: the
  // feature's asyncapi deltas (pins, markers, justification), the tagged
  // edges' publishes/consumes metadata, and the requirement deltas'
  // Publishes:/Consumes: lines (./events/events.ts owns the walk).
  issues.push(...(await eventCoherence({ scope, svcNames, taggedRels, svcOf, context })));

  return issues;
}
