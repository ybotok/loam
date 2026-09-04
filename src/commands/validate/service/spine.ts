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
import { relative } from "node:path";
import { type DeclaredService } from "../../../core/kernel/ids/service.js";
import { type LoadedDoc } from "../../../core/c4/likec4.js";
import { type DocsDir } from "../../../core/kernel/ids/dirs.js";
import { type PathableService } from "../../../core/kernel/ids/service.js";
import { type Finding } from "../../../core/vocabulary/report.js";
import { errorText } from "../../../core/c4/likec4.js";
import { type ServiceContract } from "./api.js";

/** What the service target hands the spine check. */
export interface Spine {
  service: PathableService;
  /** The docs root, so a project error's absolute path can be spelled repo-relative. */
  docsDir: DocsDir;
  /** The service directory, repo-relative and `/`-separated — the scope location beside the broken file. */
  treePath: string;
  /** `service` widened for `===` against the resolver's DOCUMENT text — see service.ts. */
  me: string;
  /** The living landscape, or null when the repo has none. */
  land: LoadedDoc | null;
  /** Its element→service resolver; null exactly when `land` is. */
  landSvcOf: ((id: string) => DeclaredService) | null;
  contract: ServiceContract;
  /** True when this run also emits a landscape target — see `ServiceCheck`. */
  landscapeReported?: boolean;
  /**
   * True when this service's `model.likec4` EXTENDS the map rather than
   * standing alone (`core/c4/service-model/shape.ts`).
   *
   * It changes one sentence and no verdict. An extending model is parsed inside
   * the `architecture/` project, so a map that does not parse takes the model
   * with it: there is no `c4.invalid` and no `c4.valid` on the service target,
   * and without this clause the report shows a service whose model is simply
   * never mentioned. Said here rather than as a finding of its own because it is
   * the same fact — one unreadable document — and a second code would be a
   * second thing to fix for one repair.
   */
  modelExtends?: boolean;
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
      // Which DOCUMENT broke, spelled exactly as the fleet arm spells it
      // (`fleet/landscape.ts`): `land` is the whole `architecture/` project, so
      // the broken file is as often a `usecases/*.likec4` as the map itself,
      // and the filename used to be hardcoded here — an agent told to "fix the
      // file the message names" opened a document that parses (verification
      // 2026-09-04, W2).
      const broken = [
        ...new Set(land.errors.map((e) => e.sourceFsPath).filter((p): p is string => p !== undefined)),
      ]
        .map((abs) => relative(spine.docsDir, abs).split(/[\\/]/).join("/"))
        .sort();
      const named = broken.length === 0 ? "architecture/landscape.likec4" : broken.join(", ");
      // The verb agrees with the LIST, not with the count after it: `named` is a
      // comma-joined series once two documents broke, and "a, b, c has 6
      // error(s)" is a sentence a reader trips over — the same care `remedy()`
      // in model/diverged.ts takes over "the kind differ".
      const verb = broken.length > 1 ? "have" : "has";
      findings.push({
        severity: "error",
        code: "spine.landscape-invalid",
        subject: service,
        message:
          `${service}: ${named} ${verb} ${land.errors.length} error(s) — spine check impossible` +
          (spine.modelExtends === true
            ? " — and model.likec4 extends it, so the model cannot be read either"
            : "") +
          (spine.landscapeReported === true
            ? "; the parser output is reported once, on the landscape target"
            : ""),
        ...(spine.landscapeReported === true
          ? {}
          : {
              // Every line carries its own file once more than one document is
              // broken, the fleet arm's rule verbatim: a bare `L8:` across two
              // documents is unactionable.
              details: land.errors.map((e) =>
                e.sourceFsPath === undefined || broken.length < 2
                  ? errorText(e)
                  : `${relative(spine.docsDir, e.sourceFsPath).split(/[\\/]/).join("/")} ${errorText(e)}`,
              ),
            }),
        // The broken document first, the service second: the finding is about a
        // file under `architecture/` and is FILED on this service, and without
        // the pair the payload carried only the service directory.
        locations: [
          ...(broken.length === 0 ? [] : [{ path: broken[0]!, role: "primary" as const }]),
          { path: spine.treePath, role: "scope" as const },
        ],
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
