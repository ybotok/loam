/**
 * What the merge would do to the LIVING documents.
 *
 * The refusals `loam archive` makes about the world a feature is about to be
 * merged INTO — as opposed to the feature's own three axes agreeing, which is
 * coherence.ts's question: a per-service delta addressed to a service that
 * exists nowhere, a `specs/<svc>/` directory whose NAME could never be a
 * service id, and git conflict markers in a living document the merge would
 * rewrite. `validate` and `status` read the same functions, so the gates
 * cannot drift into disagreeing about what they refuse.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { loadFile, type LoadedDoc } from "../c4/likec4.js";
import { elementService } from "../c4/resolve/service.js";
import { closeIds } from "../c4/arch.js";
import { serviceIdProblem, type PathableService } from "../kernel/ids/service.js";
import { repoPath } from "../envelope/json.js";
import type { Finding } from "../vocabulary/report.js";
import { featurePaths, landscapePath, SPEC_AXES } from "../repo/paths.js";
import { livingCapabilityPaths } from "../repo/authored/paths.js";
import { docsRepoState } from "../repo/state.js";
import { featureSpecServices, listServices } from "../repo/repo.js";
import { enumeratedServices, locateServicePaths } from "../repo/service-target.js";
import type { DocsDir, FeatureDir } from "../kernel/ids/dirs.js";
import { documentConflictFinding, landscapeConflictFinding } from "../conflict-markers.js";
import type { FleetContext } from "../fleet-context.js";


/* ------------------------------------------------------------------ */
/* What the merge would do to the LIVING documents                     */
/* ------------------------------------------------------------------ */

/**
 * Per-service deltas addressed to a service that exists nowhere: no
 * `services/<svc>/`, and nothing in this feature's own tagged delta introducing
 * one.
 *
 * `validate` grades this (`delta.service-unknown`); `archive` is where it costs
 * something, because `specs/<svc>/` is what the merge MATERIALISES
 * `services/<svc>/` from — one wrong character in `--touches` and the fleet
 * acquires a living service nobody meant to adopt, under a banner saying the
 * living docs are complete. Both gates read this function so they cannot drift
 * into disagreeing about which service ids are real; the `code:` literal lives
 * here, once, where the drift collector sees it.
 *
 * A delta that did not parse proves nothing either way — whether it introduces
 * the service is exactly what nobody can read — so the question is suspended
 * there rather than answered by guessing. `delta.invalid` is that file's
 * finding, and coherence already makes it.
 *
 * `services/<svc>/` is asked for directly rather than through the enumeration:
 * a feature may be graded in a docs repo with no `services/` at all (repo.ts
 * takes the same position), where enumerating is a refusal, not an answer.
 */
export async function unknownDeltaServices(
  docsDir: DocsDir,
  featureDir: FeatureDir,
  featureId: string,
  loaded: { preloadedDelta?: LoadedDoc; context?: FleetContext } = {},
): Promise<Finding[]> {
  const { preloadedDelta, context } = loaded;
  const deltaPath = featurePaths(featureDir).delta;
  let delta: LoadedDoc | undefined;
  if (existsSync(deltaPath)) {
    delta = preloadedDelta ?? (context === undefined ? await loadFile(deltaPath) : await context.loadLikeC4(deltaPath));
  }
  if (delta !== undefined && delta.errors.length > 0) return [];

  const introduces: ReadonlySet<string> = new Set(
    (delta?.elements ?? []).filter((e) => e.tags.includes(featureId)).map(elementService),
  );
  // Enumeration MEMBERSHIP, not an existsSync of services/<svc>/ at the root:
  // a service filed into a subsystem exists wherever the tree walk found it,
  // and the root probe would grade it unknown. `enumeratedServices` swallows
  // an unenumerable services/ to [] on purpose — this also runs under archive
  // in repos validate --feature tolerates (no services/ at all), where every
  // probe would have found nothing there anyway.
  const known: ReadonlySet<string> = new Set((await enumeratedServices(docsDir, context)).map((s) => s.id));
  const unknown = (await featureSpecServices(featureDir, context)).filter(
    (svc) => !known.has(svc) && !introduces.has(svc),
  );
  if (unknown.length === 0) return [];

  // The near-miss hint, on the same rule `service.unknown` uses — a typo is
  // only diagnosable against the ids that DO exist.
  const closeTo =
    docsRepoState(docsDir).kind === "ok" ? (await listServices(docsDir, context)).map((s) => s.id) : [];
  return unknown.map((svc) => deltaServiceUnknownFinding(svc, closeTo));
}

/**
 * The finding itself, for the two gates that reach this conclusion by different
 * routes.
 *
 * `archive` gets there through `unknownDeltaServices` above; `validate` gets
 * there through its own enumeration, because it suspends the question on an
 * unreadable delta rather than returning early on it, and that difference is
 * deliberate. What must NOT differ is the sentence: the two were spelled out
 * word for word in two files, so a reworded hint in one of them would have made
 * `loam validate` and `loam archive` describe the same typo differently, on the
 * same code, in the same repo.
 *
 * `knownIds` is the fleet's real service ids — already enumerated by the caller,
 * which is also the caller's chance to skip the enumeration entirely when there
 * is nothing to diagnose.
 */
export function deltaServiceUnknownFinding(svc: string, knownIds: string[]): Finding {
  const close = closeIds(svc, knownIds);
  return {
    severity: "error",
    code: "delta.service-unknown",
    subject: svc,
    message:
      `specs/${svc}/ addresses a service that does not exist: there is no services/${svc}/ and this feature's ` +
      `delta.likec4 does not introduce one — archiving would create it out of the typo.` +
      (close.length > 0 ? ` Did you mean: ${close.join(", ")}?` : " `loam list services` shows what exists."),
  };
}

/**
 * Per-service deltas whose DIRECTORY NAME is not a legal service id at all.
 *
 * `specs/<svc>/` is caller-controlled path input exactly as `--service` is:
 * `featureSpecServices` returns whatever `readdir` found, and nothing between
 * that readdir and the archive merge ever asked the id grammar about it. So
 * `specs/Payment Service/` validated green — "requirements covered", even,
 * because a tagged element whose TITLE matched the directory counted as
 * introducing the service — and `loam archive` then materialised
 * `services/Payment Service/`: a directory `service.id-invalid` calls an error
 * on the very next `validate --all`, and one no loam command can address or
 * re-create. Both gates read this function for `unknownDeltaServices`' reason:
 * validate and archive must refuse the same directory with the same sentence.
 *
 * NOT suppressed by what the delta introduces, and NOT suspended on
 * `delta.invalid`: the name is illegal whatever the architecture axis says,
 * because the name itself is what becomes the path.
 */
export async function invalidSpecServiceFindings(
  featureDir: FeatureDir,
  context?: FleetContext,
): Promise<Finding[]> {
  const out: Finding[] = [];
  for (const svc of await featureSpecServices(featureDir, context)) {
    const problem = serviceIdProblem(svc, "specs/ directory name");
    if (problem === null) continue;
    out.push({
      severity: "error",
      code: "delta.service-id-invalid",
      subject: svc,
      message:
        `specs/${svc}/ — ${problem} ` +
        `\`loam archive\` materialises services/${svc}/ from this directory name, and that directory is one ` +
        `no loam command can address afterwards (\`service.id-invalid\`). Rename the specs/ directory to a legal id.`,
    });
  }
  return out;
}

/**
 * Git conflict markers in the LIVING documents a merge of this feature would
 * rewrite: each touched service's requirement files, and the fleet map.
 *
 * The rule and the sentence are conflict-markers's — one spelling of the breach,
 * wherever it is found. What this adds is the SET: the documents `archive`
 * rewrites. A conflicted `services/<svc>/spec.md` parses as prose, so every
 * check upstream of the merge reads it as a valid document with some odd
 * headings in it; the rewrite then drops whichever marker lines fall inside the
 * requirements run it owns, and a conflict anyone could see becomes a file
 * nobody can tell is wrong. For a shared docs repo that a fleet lands in
 * through PRs, that is the default failure and not an edge.
 *
 * `openapi.yaml` is deliberately absent: markers make it unparseable, so the
 * YAML reader already refuses it by name and a second finding would only say
 * the same thing later.
 *
 * `capabilities` is the same question on the business corpus, and it is not
 * optional politeness: a living `capabilities/<id>/spec.md` the feature's
 * capability delta merges into is rewritten by exactly the same
 * `rewriteRequirementsRun`, so a conflicted one loses its marker lines exactly
 * the same way. Passed in rather than walked here because the caller has
 * already read the feature's delta tree and this function must not decide which
 * documents a merge touches.
 *
 * IDS, not the `CapabilityDoc` records the caller holds, and that is a guard
 * rather than a preference: a `CapabilityDoc` from a feature's delta walk
 * carries `spec` and `dir` pointing at the FEATURE'S copy, and the document
 * this function is about is the LIVING one. Taking the whole record would leave
 * `doc.spec` in scope here — the wrong file, one property access away.
 */
export async function livingMergeConflicts(
  docsDir: DocsDir,
  services: readonly PathableService[],
  capabilities: readonly string[],
  context?: FleetContext,
): Promise<Finding[]> {
  const out: Finding[] = [];
  const read = async (path: string): Promise<string> =>
    context === undefined ? readFile(path, "utf8") : context.readText(path);

  for (const svc of services) {
    const paths = await locateServicePaths(docsDir, svc, context);
    for (const axis of SPEC_AXES) {
      const path = paths[axis.key];
      if (!existsSync(path)) continue;
      const finding = documentConflictFinding(repoPath(docsDir, path), svc, await read(path));
      if (finding !== null) out.push(finding);
    }
  }

  for (const id of capabilities) {
    const path = livingCapabilityPaths(docsDir, id).spec;
    if (!existsSync(path)) continue;
    const finding = documentConflictFinding(repoPath(docsDir, path), id, await read(path));
    if (finding !== null) out.push(finding);
  }

  const landscape = landscapePath(docsDir);
  if (existsSync(landscape)) {
    const finding = landscapeConflictFinding(repoPath(docsDir, landscape), await read(landscape));
    if (finding !== null) out.push(finding);
  }
  return out;
}
