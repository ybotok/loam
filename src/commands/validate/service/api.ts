/**
 * The HTTP contract axis: openapi.yaml graded against the living spec.
 *
 * What it decides for everything downstream is whether there is a contract to
 * read at all. A missing or unparseable openapi.yaml is ONE finding about ONE
 * file, and that fact has to travel: grading the fleet map's inbound edges
 * against the empty operation set it leaves behind turns one broken YAML into
 * one `spine.op-undefined` per consumer, each of them accusing the landscape of
 * a fault that is not there. `ServiceContract` is how it travels; `./spine.js`
 * is what reads it.
 */
import { existsSync } from "node:fs";
import { closeIds } from "../../../core/c4/arch.js";
import { type LoadedDoc } from "../../../core/c4/likec4.js";
import { type DeclaredService, type PathableService } from "../../../core/kernel/ids.js";
import { type ServicePaths } from "../../../core/repo/paths.js";
import { type Finding } from "../../../core/vocabulary/report.js";
import { type Requirement } from "../../../core/document/spec.js";
import { readOpenapi } from "../../../core/openapi.js";
import { FleetContext } from "../../../core/fleet-context.js";

/** What the service target hands the HTTP axis. */
export interface ApiAxis {
  service: PathableService;
  /** `service` widened for `===` against the resolver's DOCUMENT text — see service.ts. */
  me: string;
  paths: ServicePaths;
  /** Every requirement the living spec declares, REMOVED ones included. */
  reqs: Requirement[];
  /** The ones that still govern something. */
  livingReqs: Requirement[];
  /** The living landscape, or null when the repo has none. */
  land: LoadedDoc | null;
  /** Its element→service resolver, built once per run; null exactly when `land` is. */
  landSvcOf: ((id: string) => DeclaredService) | null;
  fleet?: FleetContext;
}

/**
 * What the spine may conclude from this service's contract.
 *
 * `unreadable` covers both shapes of "there is nothing to read" — absent and
 * unparseable — because they have the same consequence for an inbound edge:
 * the contract proves neither that the operation exists nor that it does not.
 */
export interface ServiceContract {
  /** operationIds the living contract defines, empty when there is nothing to read. */
  ops: string[];
  /** Those of them the contract marks `deprecated: true`. */
  deprecated: ReadonlySet<string>;
  unreadable: boolean;
}

export async function apiAxisFindings(
  axis: ApiAxis,
): Promise<{ findings: Finding[]; contract: ServiceContract }> {
  const { service, me, paths, reqs, livingReqs, land, landSvcOf, fleet } = axis;
  const findings: Finding[] = [];

  // API coverage: every operation in openapi.yaml is governed by a requirement.
  const api = await readOpenapi(paths.openapi, fleet);
  const removeMarkers = api.ops.filter((o) => o.remove);
  const liveOps = api.ops.filter((o) => !o.remove);
  const ops = liveOps.map((o) => o.id);
  const deprecatedOps = new Set(liveOps.filter((o) => o.deprecated).map((o) => o.id));
  // Inbound calls the landscape can PROVE: op-linked edges whose target
  // resolves to this service. Null when the landscape proves nothing at all
  // (absent, or it did not parse) — which is not the same fact as "nobody
  // calls me", and the two must not be graded alike.
  const inboundOps =
    land === null || land.errors.length > 0
      ? null
      : land.relationships.filter((r) => r.op !== undefined && landSvcOf!(r.target) === me);
  // The other half of the evidence a contract is owed: the living spec's own
  // `Operations:` lines. A requirement on its way out governs nothing.
  const governedOps = livingReqs.flatMap((r) => r.operations);
  /** No contract to read: deleted, renamed, or never written. */
  const contractMissing = !existsSync(paths.openapi);
  if (contractMissing) {
    // A contract that is gone is not a reason to stop grading the API axis —
    // it IS the axis's answer, and every check below used to live inside the
    // file-exists branch, so deleting or misspelling the file turned the whole
    // axis (including the documented `spec-api.op-undefined`) green.
    //
    // What decides the severity is whether anything already written down is
    // holding a join into it: a living `Operations:` line, or an op-linked
    // landscape edge. With one of those, the absence breaks a link somebody
    // authored — an error. With neither, this is a service that legitimately
    // has no HTTP surface (a worker nobody calls), and a fleet mid-rollout
    // must not go red for it — a warning, or, when the landscape PROVES nobody
    // calls it, the documented silence.
    //
    // One finding, not one per dangling link: the fix is a single file, and
    // the links it strands ride along as details.
    const dangling = [...new Set([...governedOps, ...(inboundOps ?? []).map((r) => r.op!)])].sort();
    if (dangling.length > 0) {
      findings.push({
        severity: "error",
        code: "service.no-openapi",
        subject: service,
        message:
          `No OpenAPI contract at ${paths.openapi}, and ${dangling.length} operation link(s) already point into it — ` +
          `every requirement and landscape edge naming one of them resolves to nothing until the file is back`,
        details: dangling,
      });
    } else if (inboundOps === null) {
      findings.push({
        severity: "warn",
        code: "service.no-openapi",
        message: `No OpenAPI contract at ${paths.openapi} — API coverage and the landscape spine are unchecked`,
      });
    }
  } else if (api.unreadable) {
    // A contract that EXISTS but does not read is a broken source of truth, not
    // an empty one: swallowing it into zero operations used to grade every
    // inbound landscape edge `spine.op-undefined` — a false diagnosis pointing
    // at the landscape when the truth was this file. So the file is the error,
    // and every check that reads the contract (api.*, the spine's op
    // resolution) is suspended below, the landscape.invalid discipline.
    findings.push({
      severity: "error",
      code: "openapi.invalid",
      message: `${service}: openapi.yaml does not parse — API coverage and the landscape spine are unchecked`,
      ...(api.error === undefined ? {} : { details: [api.error] }),
    });
  } else {
    if (removeMarkers.length > 0) {
      findings.push({
        severity: "error",
        code: "openapi.remove-marker-living",
        message: `${service}: living openapi.yaml contains ${removeMarkers.length} x-loam-remove marker(s) (${removeMarkers.map((op) => op.id).join(", ")}) — removal markers are valid only in feature deltas`,
      });
    }
    // The same marker written at PATH level, beside the methods. `readOpenapi`
    // is keyed by (path, method), which is precisely why the check above cannot
    // see this one and precisely how one reached a living contract in the first
    // place: it addresses no operation, so it retired nothing, and it stayed
    // invisible afterwards. Error, like its method-level sibling — a
    // feature-only key published to every consumer of the fleet, and one that
    // keeps the empty-path cleanup from ever firing. Same code as the archive
    // plan's: one breach, one name, wherever it is found.
    for (const removed of api.pathLevelRemovals) {
      findings.push({
        severity: "error",
        code: "openapi.remove-marker-path-level",
        subject: service,
        message:
          `${service}: living openapi.yaml carries x-loam-remove at PATH level on '${removed}' — ` +
          `a removal marker names ONE operation, so beside the methods it retires nothing and is not a contract key either, ` +
          `and no id-keyed check can see it. Delete it from the living contract; retire an operation through a feature delta whose marker sits inside the operation.`,
      });
    }
    // Two slots claiming one operationId in a LIVING contract. `readOpenapi`
    // has computed this since the merge needed it, and only the feature path
    // (coherence) ever read it — so the ambiguity was reachable only when some
    // unrelated feature happened to carry a delta for this service, and the
    // fleet gate that actually runs in CI was blind to it. Same code and same
    // sentence as the feature-scope check: one breach, one name.
    for (const id of api.duplicateIds) {
      const slots = api.ops.filter((op) => op.id === id).map((op) => `${op.method} ${op.path}`);
      findings.push({
        severity: "warn",
        code: "openapi.duplicate-operationid",
        subject: service,
        message: `${service}: the living OpenAPI defines operationId '${id}' at ${slots.join(" and ")} — every join on the id (a requirement's Operations: line, an edge's metadata { op }, a removal marker) picks one of those slots arbitrarily`,
      });
    }
    const defined = new Set(ops);
    // `Operations:` on a LIVING requirement, resolved against this service's own
    // contract. Nothing did this before: the same spine is checked inside a
    // feature delta (coherence's spec-api.op-undefined) and then never again, so
    // a typo that shipped, or an operation later renamed out of openapi.yaml,
    // left a living requirement governing an operation that does not exist —
    // green forever, and every downstream join through that id silently empty.
    // Same code and severity as the feature-scope check on purpose: one breach,
    // one name, wherever it is found.
    for (const r of livingReqs) {
      for (const op of r.operations) {
        if (defined.has(op)) continue;
        const close = closeIds(op, ops);
        findings.push({
          severity: "error",
          code: "spec-api.op-undefined",
          subject: service,
          message:
            `${service}: requirement '${r.name}' governs '${op}', not defined in ${service}'s OpenAPI` +
            (close.length > 0 ? `. Did you mean: ${close.join(", ")}?` : ""),
        });
      }
    }
    if (ops.length > 0) {
    const governed = new Set(livingReqs.flatMap((r) => r.operations));
    const orphans = ops.filter((op) => !governed.has(op));
    if (orphans.length === 0) {
      findings.push({
        severity: "ok",
        code: "api.covered",
        message: `${service}: API covered (${ops.length} operation(s) governed by requirements)`,
      });
    } else {
      findings.push({
        severity: "warn",
        code: "api.ungoverned",
        message: `${service}: ${orphans.length} operation(s) not governed by any requirement — ${orphans.join(", ")}`,
      });
    }
    // The migration-debt case: requirements exist, the API exists, and no
    // `Operations:` line ties them — every cross-axis check above and in
    // feature mode is vacuously green. Once per service, not per operation;
    // with zero requirements the spec (or its absence) is the finding instead.
    if (reqs.length > 0 && reqs.every((r) => r.operations.length === 0)) {
      findings.push({
        severity: "warn",
        code: "api.ops-unlinked",
        message: `${service}: openapi.yaml defines ${ops.length} operation(s) but no requirement links any — the API axis is unchecked for this service`,
      });
    }
    // Lifecycle: a requirement whose `Operations:` list resolves ONLY to
    // deprecated operations governs behaviour the contract is retiring.
    // Deprecation is the documented first step of removing an op; the explicit
    // feature marker is the final step. Until that delta archives, the op stays
    // live, so the fix is migration or a coordinated retirement. Ops the contract does not define at all
    // prove nothing here and are left to spec-api.op-undefined above.
    for (const r of reqs) {
      const resolved = r.operations.filter((op) => defined.has(op));
      if (resolved.length === 0 || !resolved.every((op) => deprecatedOps.has(op))) continue;
      findings.push({
        severity: "warn",
        code: "api.requirement-deprecated",
        message: `${service}: requirement '${r.name}' governs only deprecated operation(s) (${resolved.join(", ")}) — the behaviour it describes is on its way out; migrate it to the replacement operation, or retire it`,
      });
    }
    }
  }

  return {
    findings,
    contract: { ops, deprecated: deprecatedOps, unreadable: api.unreadable || contractMissing },
  };
}
