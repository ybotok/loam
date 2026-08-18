/**
 * The inbound half of the C4↔API spine: every cross-system edge the living
 * landscape draws INTO this service must resolve to a real operation in its
 * OpenAPI.
 *
 * Separate from `./api.js` because the two grade different documents and the
 * fix lives in different files — a broken edge is the fleet map's mistake, a
 * missing operation is the contract's — but it may conclude nothing without
 * `api.js`'s answer, which is why `ServiceContract` is a parameter rather than
 * a second read of openapi.yaml.
 *
 * The event-side mirror of this check is inside `./events.js`: there the
 * PRODUCER owns the contract and it lives in another repository, so the two
 * could not share a walk even though they share the shape.
 */
import { type DeclaredService } from "../../../core/kernel/ids/service.js";
import { type LoadedDoc } from "../../../core/c4/likec4.js";
import { type PathableService } from "../../../core/kernel/ids/service.js";
import { type Finding } from "../../../core/vocabulary/report.js";
import { errorText } from "../checks/vocabulary.js";
import { type ServiceContract } from "./api.js";

/** What the service target hands the spine check. */
export interface Spine {
  service: PathableService;
  /** `service` widened for `===` against the resolver's DOCUMENT text — see service.ts. */
  me: string;
  /** The living landscape, or null when the repo has none. */
  land: LoadedDoc | null;
  /** Its element→service resolver; null exactly when `land` is. */
  landSvcOf: ((id: string) => DeclaredService) | null;
  contract: ServiceContract;
  /** True when this run also emits a landscape target — see `ServiceCheck`. */
  landscapeReported?: boolean;
}

export function spineFindings(spine: Spine): Finding[] {
  const { service, me, land, landSvcOf, contract } = spine;
  const findings: Finding[] = [];

  // Landscape spine: cross-system edges calling THIS service must resolve to a real
  // operation in its OpenAPI — the C4↔API contract, checked in the living landscape,
  // not only in feature mode. Catches dangling / de-linked op edges.
  if (land !== null) {
    if (land.errors.length > 0) {
      // A living landscape that does not parse disables the C4↔API spine check —
      // that is a broken source of truth, not a skippable detail.
      //
      // The parser's own output is attached ONCE per run, and not here when the
      // run has a landscape target to carry it. One syntax error in one file
      // becomes N copies of a dozen cascading diagnostics on a fleet of N
      // services — the report stops being readable at exactly the moment
      // somebody needs to read it, and the fix is one file either way.
      findings.push({
        severity: "error",
        code: "spine.landscape-invalid",
        subject: service,
        message:
          `${service}: landscape.likec4 has ${land.errors.length} error(s) — spine check impossible` +
          (spine.landscapeReported === true
            ? "; the parser output is reported once, on the landscape target"
            : ""),
        ...(spine.landscapeReported === true ? {} : { details: land.errors.map(errorText) }),
      });
    } else {
      // Which element IS this service is the binding's call, then a title that
      // names a real services/<id>/, and an edge into a modelled container
      // counts as an edge into its service — matching the exact id alone meant a
      // container edge left the spine without a word.
      const svcOf = landSvcOf!;
      const opset = new Set(contract.ops);
      let checked = 0;
      let broken = 0;
      for (const r of land.relationships) {
        if (svcOf(r.target) !== me) continue;
        if (r.op !== undefined) {
          // A contract that cannot be read — broken, or not there at all —
          // proves nothing about this edge, neither broken nor resolved.
          // Grading the edges against an empty operation set turned ONE root
          // cause (the file) into one `spine.op-undefined` per inbound edge, so
          // a service with twelve consumers reported twelve landscape defects
          // and never named the file. `openapi.invalid` / `service.no-openapi`
          // already did, from ./api.js; only op-link-missing (which never reads
          // the contract) stays live, and `checked` stays 0 so no false
          // spine.resolved is claimed either.
          if (contract.unreadable) continue;
          checked += 1;
          if (!opset.has(r.op)) {
            broken += 1;
            findings.push({
              severity: "error",
              code: "spine.op-undefined",
              message: `${service}: landscape edge ${svcOf(r.source)} → ${service} calls '${r.op}', not defined in ${service}'s OpenAPI`,
            });
          } else if (contract.deprecated.has(r.op)) {
            // The contract holds — the op is defined — but it is marked
            // `deprecated: true`: the consumer is standing on a contract being
            // retired, and should be migrating off it. Warn per inbound edge;
            // a deprecated op nobody calls raises no spine finding at all.
            findings.push({
              severity: "warn",
              code: "spine.op-deprecated",
              message: `${service}: landscape edge ${svcOf(r.source)} → ${service} calls '${r.op}', which ${service}'s OpenAPI marks deprecated — the consumer should migrate off it`,
            });
          }
        } else if ((r.title ?? "").toLowerCase().startsWith("call")) {
          findings.push({
            severity: "warn",
            code: "spine.op-link-missing",
            message: `${service}: landscape edge ${svcOf(r.source)} → ${service} ("${r.title}") has no operation link (metadata { op })`,
          });
        }
      }
      if (broken === 0 && checked > 0) {
        findings.push({
          severity: "ok",
          code: "spine.resolved",
          message: `${service}: landscape spine (${checked} inbound call(s) resolve to OpenAPI)`,
        });
      }
    }
  }

  return findings;
}
