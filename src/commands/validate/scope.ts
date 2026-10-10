/**
 * What a `--base` run does to the landscape target, which is the one target
 * whose subject is not a directory.
 *
 * Every other target is graded whole or not at all: a service or a feature the
 * branch touched is graded by exactly the checks `--all` runs on it. The
 * landscape cannot be, for two reasons that pull in opposite directions, and
 * both are defects a docs-repo PR gate actually shipped with.
 *
 * IT GRADED TOO MUCH. The landscape target carries the fleet-wide
 * vocabularies' warnings — a permission nobody requires, a capability nobody
 * realizes, an obligation nobody applies, a glossary term nobody cites — and
 * the AGENTS.md stamp. Every one of those grades a file other than the map, so
 * any `architecture/` branch re-graded all of them, and under `--strict` a
 * one-line map edit on the adopted example fleet went red on four warnings that
 * were all there at the base. Those findings now ride a scoped run only when the
 * file that carries them changed.
 *
 * IT GRADED TOO LITTLE. `spine.op-undefined` is graded on the PROVIDER's
 * service target, so an edge the branch drew or re-spelled on the map was
 * graded by no scoped run unless the provider happened to change too —
 * README's own `authorisePayment` example merged green through both PR gates.
 * Those edges are now graded here, against their providers' contracts, and
 * ONLY those edges: pulling the provider into scope instead would grade every
 * document it already has, which on a spine-first fleet means
 * `service.no-model` reddening exactly the labour that path asks for.
 */
import { existsSync } from "node:fs";
import { serviceResolver } from "../../core/c4/resolve/service.js";
import type { LoadedDoc } from "../../core/c4/likec4.js";
import { edgeKey } from "../../core/diff/scope/edges.js";
import { touched, type ValidateScope } from "../../core/diff/scope/changed-paths.js";
import { repoPath } from "../../core/envelope/json.js";
import type { FleetContext } from "../../core/fleet-context.js";
import { inOrder } from "../../core/kernel/concurrency.js";
import { serviceTreePath, type DocsDir } from "../../core/kernel/ids/dirs.js";
import { readOpenapi } from "../../core/openapi/doc.js";
import { capabilityDocsDir, glossaryDir } from "../../core/repo/authored/paths.js";
import type { ServiceEntry } from "../../core/repo/entries.js";
import { agentsPath, capabilitiesPath, obligationsPath, permissionsPath, servicePathsAt } from "../../core/repo/paths.js";
import type { Finding } from "../../core/vocabulary/report.js";
import { contractOf } from "./service/api.js";
import { spineFindings } from "./service/spine.js";

/**
 * The landscape target's findings that grade a file other than the map, with
 * the file — or directory — that carries each.
 *
 * Only the families that are a VERDICT ON THAT FILE are listed: the vocabulary
 * that does not read, and the declaration nothing cites. The obligation codes
 * the MAP causes stay off this table — `obligation.unknown` (a tag naming no
 * rule) and `obligation.uncovered` (an applied rule no requirement covers) are
 * written by an edit to `architecture/`, and a scoped run over that edit owes
 * them. A code on no row rides the landscape target exactly as before.
 *
 * What this costs, said once: the "nothing cites it" grades also move when a
 * CITATION goes away — a branch deleting the last `Requires:` line naming a
 * permission. A branch that touches only a service never graded the landscape
 * at all, so that is not a new blind spot; the unscoped `validate --all` keeps
 * reporting every one of these.
 */
const CARRIED: readonly { carries: (code: string) => boolean; by: (docsDir: DocsDir) => string[] }[] = [
  { carries: (code) => code.startsWith("permissions."), by: (d) => [permissionsPath(d)] },
  { carries: (code) => code.startsWith("capability."), by: (d) => [capabilitiesPath(d), capabilityDocsDir(d)] },
  { carries: (code) => code === "obligation.invalid" || code === "obligation.unapplied", by: (d) => [obligationsPath(d)] },
  { carries: (code) => code.startsWith("glossary."), by: (d) => [glossaryDir(d)] },
  // The stamp is a fact about which binary wrote the file, and a branch that
  // did not edit the file did not move it — `loam doctor` is where a binary
  // upgrade is noticed, not every map PR that happens to follow one.
  { carries: (code) => code === "agents.stale" || code === "docs.binary-behind", by: (d) => [agentsPath(d)] },
];

/** What the scoped landscape grade needs from the run. */
export interface ScopedLandscape {
  docsDir: DocsDir;
  scope: ValidateScope;
  /** The parsed `architecture/` project, or null when the repo draws no fleet. */
  land: LoadedDoc | null;
  /** The run's FULL service enumeration: a changed edge's provider is found here whether or not it is in scope. */
  services: readonly ServiceEntry[];
  fleet: FleetContext;
}

/** The landscape target's `findings` as a `--base` run reports them. */
export async function scopedLandscapeFindings(findings: Finding[], scoped: ScopedLandscape): Promise<Finding[]> {
  const { docsDir, scope } = scoped;
  const kept = findings.filter((f) => {
    const carried = CARRIED.find((row) => row.carries(f.code));
    return carried === undefined || carried.by(docsDir).some((abs) => touched(scope, repoPath(docsDir, abs)));
  });
  return [...kept, ...(await changedEdgeFindings(scoped))];
}

/**
 * The spine of the edges this branch wrote, graded per provider by the
 * service target's own `spineFindings` over just those edges — so a changed
 * edge reads exactly as it would on the provider's target, and an unreadable
 * or absent contract proves nothing here for the reason it proves nothing
 * there.
 *
 * A provider the run already grades is skipped: its own target walks every
 * inbound edge, these included, and grading them twice would report one broken
 * join as two.
 */
async function changedEdgeFindings(scoped: ScopedLandscape): Promise<Finding[]> {
  const { docsDir, scope, land, services, fleet } = scoped;
  // A map that does not parse has no edges to read, and `landscape.invalid`
  // on this same target already says so.
  if (land === null || land.errors.length > 0 || scope.edges.size === 0) return [];
  const svcOf = serviceResolver(land.elements, new Set(services.map((s) => s.id)));
  const providerOf = (target: string): string => svcOf(target);
  const edges = land.relationships.filter((r) => scope.edges.has(edgeKey(r)));
  const graded = new Set(scope.services.map((s) => s.id));
  const providers = services.filter((s) => !graded.has(s.id) && edges.some((r) => providerOf(r.target) === s.id));
  const perProvider = await inOrder(providers, async (svc) => {
    const paths = servicePathsAt(svc.dir);
    return spineFindings({
      service: svc.id,
      docsDir,
      treePath: serviceTreePath(svc),
      me: svc.id,
      land: { ...land, relationships: edges.filter((r) => providerOf(r.target) === svc.id) },
      landSvcOf: svcOf,
      contract: contractOf(await readOpenapi(paths.openapi, fleet), !existsSync(paths.openapi)),
      landscapeReported: true,
    });
  });
  return perProvider.flat();
}
