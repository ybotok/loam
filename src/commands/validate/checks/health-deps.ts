/**
 * The health.yaml → model reconciliation: every id the `dependencies:` block
 * declares must be something this service's OWN model answers to.
 *
 * Without this reconciliation, a disabled optional service registry can leave
 * the model, landscape, arch spec and runbook corrected while health.yaml still
 * declares `serviceRegistry` as a `critical: startup` dependency under a green
 * validator — in the file an on-call engineer reaches for first. Its
 * dependencies block was otherwise free text as far as validation was
 * concerned.
 *
 * Resolution is against the SERVICE'S OWN model — deliberately never the
 * landscape. A store one service owns may be nested inside that service's
 * element or drawn as a fleet-level peer, whichever the team chose (loam grades
 * neither: `landscape.datastore-private`, which used to push it into the first,
 * was retired 2026-09-07). Only the nested placement puts it in the landscape's
 * interior at all, so the landscape is not a set this check could rely on, while
 * the model carries everything the service touches — and that is the set the
 * on-call file has to agree with. An id resolves by the same names every other join
 * uses: the element's likec4 id, its `metadata { service }` binding, or its
 * title. Exact match, no case folding — a fold would be a permanent
 * equivalence semantic no other loam join has, able to silently join two
 * genuinely different names; the did-you-mean hint bridges the typo case
 * instead.
 */
import { closeIds } from "../../../core/c4/arch.js";
import { type Elem } from "../../../core/c4/likec4.js";
import { elementService } from "../../../core/c4/resolve/service.js";
import { type Finding } from "../../../core/vocabulary/report.js";

export interface HealthDeps {
  service: string;
  /**
   * The resolved path of the service's own `model.likec4`, repo-relative and
   * `/`-separated — the file this check grades and the one its message names.
   * Handed in rather than joined from the id: `services/<id>/model.likec4` is
   * right only for an unfiled service, and every sibling finding in this
   * command prints the resolved path of the file it means. Relative because a
   * message is read beside other people's runs: an absolute path names the
   * machine that ran the check, not the file in the repository.
   */
  modelPath: string;
  /** `dependencies:` ids, already muted by the caller when health.yaml is unreadable. */
  dependencies: string[];
  /** The service's own parsed model — empty when absent or invalid, which mutes the check. */
  elements: Elem[];
}

export function healthDependencyFindings(deps: HealthDeps): Finding[] {
  const { service, dependencies, elements, modelPath } = deps;
  // An absent or unparsable model already has its own finding, and grading
  // health.yaml against a model nobody could read would manufacture warns out
  // of the wrong file's breakage.
  if (elements.length === 0) return [];
  const findings: Finding[] = [];
  for (const dep of dependencies) {
    if (elements.some((e) => e.id === dep || elementService(e) === dep)) continue;
    const pool = [...new Set(elements.flatMap((e) => [e.id, elementService(e) as string]))];
    const close = closeIds(dep, pool);
    findings.push({
      severity: "warn",
      code: "health.dependency-unmodelled",
      subject: service,
      message:
        `${service}: health.yaml declares dependency '${dep}' but nothing in ` +
        `${modelPath} answers to that name — either a dependency nobody ` +
        `modelled, or one that no longer exists. Model it (an external system as its own element ` +
        `with the edge this service actually has; a store this service owns as a nested container ` +
        `or as its own element, whichever the map already does), or ` +
        `delete the entry` +
        (close.length > 0 ? `. Did you mean: ${close.join(", ")}?` : ""),
    });
  }
  return findings;
}
