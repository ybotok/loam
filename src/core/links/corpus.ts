/**
 * WHICH documents loam reads links out of — the corpus, spelled once.
 *
 * Two readers need it and must not disagree. `commands/validate/links/` grades
 * each target's own documents for `link.unresolved`; `core/glossary/backlinks.ts`
 * reads the WHOLE fleet's, because "which documents use this term" is a question
 * no single target can answer. A corpus that differed between them would report
 * a term as unused while the very document citing it was being graded one target
 * over.
 *
 * THE CORPUS IS EVERY AUTHORED MARKDOWN DOCUMENT, and the word doing the work is
 * authored. `AGENTS.md` and the scaffolded `README.md` are excluded because loam
 * WRITES them: a finding against generated prose names a defect its reader
 * cannot fix by editing, since the next `loam init` restores it. Their links are
 * loam's own problem, held on this side of the boundary by
 * `test/docs-facts.test.ts` and `test/package-docs.test.ts`.
 *
 * ADRs AND RUNBOOKS ARE IN IT, and they are the reason the convention was
 * written down at all: an ADR that supersedes another says which, by linking to
 * it. They are also the first documents loam reads that it previously only
 * counted, which is what `link.unreadable` exists for.
 *
 * `delta.likec4` IS NOT, and neither is any YAML: this is a markdown question.
 * The one thing a delta holds that addresses another file — `metadata { op }` —
 * has its own resolution and its own findings.
 */
import { featureCapabilityDeltas } from "../capabilities/delta/tree.js";
import { readCapabilityTree } from "../capabilities/tree.js";
import type { FleetContext } from "../fleet-context.js";
import { featureGlossary } from "../glossary/delta.js";
import { readGlossary } from "../glossary/tree.js";
import type { DocsDir, FeatureDir } from "../kernel/ids/dirs.js";
import { featurePaths, featureSpecPaths, fleetAdrsDir, servicePathsAt, type ServicePaths } from "../repo/paths.js";
import { capabilityDocsDir, glossaryDir } from "../repo/authored/paths.js";
import { featureSpecServices, listFeatures, listServices } from "../repo/repo.js";
import { markdownFiles } from "../repo/tree/fs.js";

/**
 * One service's authored documents: the two requirement specs, the runbook, and
 * every ADR. The specs cost nothing extra when a `FleetContext` is in play — it
 * has already read both to parse their requirements, and the memo hands back the
 * same text.
 */
export async function serviceDocuments(paths: ServicePaths): Promise<string[]> {
  return [paths.spec, paths.archSpec, paths.runbook, ...(await markdownFiles(paths.adrsDir))];
}

/**
 * One feature's authored documents: the intent, each addressed service's two
 * spec deltas, every ADR, and each capability delta document.
 */
export async function featureDocuments(featureDir: FeatureDir, fleet?: FleetContext): Promise<string[]> {
  const paths = featurePaths(featureDir);
  const docs = [paths.intent, ...(await markdownFiles(paths.adrsDir))];
  for (const svc of await featureSpecServices(featureDir, fleet)) {
    const spec = featureSpecPaths(featureDir, svc);
    docs.push(spec.spec, spec.archSpec);
  }
  const capabilities =
    fleet === undefined ? await featureCapabilityDeltas(featureDir) : await fleet.featureCapabilityDeltas(featureDir);
  docs.push(...capabilities.docs.map((d) => d.spec));
  // The definitions this feature introduces. Their own links are graded like
  // any other document's — a term that cites a term the feature is not adding
  // is a broken join whether or not it has shipped yet.
  docs.push(...(await featureGlossary(featureDir)).terms.map((t) => t.path));
  return docs;
}

/**
 * The documents that belong to no service and no feature: the fleet's own
 * decision records, the living capability tree, and the glossary.
 *
 * Graded at fleet scope, so `validate --all` reports them once. A single-target
 * run says nothing about them — the rule `permissions.unenforced` and
 * `capability.invalid` already follow, and for the same reason: a finding about
 * the fleet repeated on every service target is the report.
 */
export async function fleetDocuments(docsDir: DocsDir, fleet?: FleetContext): Promise<string[]> {
  const capabilities =
    fleet === undefined
      ? await readCapabilityTree(capabilityDocsDir(docsDir))
      : (await fleet.capabilities(docsDir)).tree;
  const glossary = await readGlossary(glossaryDir(docsDir));
  return [
    ...(await markdownFiles(fleetAdrsDir(docsDir))),
    ...capabilities.docs.map((d) => d.spec),
    ...glossary.terms.map((t) => t.path),
  ];
}

/**
 * Every authored document in the repository — the union of the three above over
 * every service and every in-flight feature.
 *
 * ARCHIVED FEATURES ARE OUT, and the omission is the point rather than an
 * oversight. `features/archive/<FEAT>/` is the evolution history: its documents
 * describe a change that already shipped, its links point at whatever the tree
 * looked like then, and grading them would make every directory rename a
 * retroactive error against a record nobody may edit. `listFeatures` excludes
 * them by default, which is the same judgement one enumeration up.
 */
export async function allAuthoredDocuments(docsDir: DocsDir, fleet?: FleetContext): Promise<string[]> {
  const docs = await fleetDocuments(docsDir, fleet);
  for (const service of await listServices(docsDir, fleet)) {
    docs.push(...(await serviceDocuments(servicePathsAt(service.dir))));
  }
  for (const feature of await listFeatures(docsDir, {}, fleet)) {
    docs.push(...(await featureDocuments(feature.dir, fleet)));
  }
  return docs;
}
