/**
 * The fleet's use cases, graded — the CALL, with the two vocabulary reads it
 * needs, lifted out of `../landscape.ts` when that module reached its line
 * limit.
 *
 * The seam is a phase rather than a subject: everything here happens after the
 * map has parsed and grades documents the map does not own — every
 * `dynamic view` in `architecture/landscape.likec4` and in every
 * `architecture/usecases/*.likec4`. `../usecases/usecases.ts` owns the opt-in and
 * the grades; this owns which inputs they are handed, which is the part that has
 * twice been got wrong and is worth stating in one place.
 *
 * A sub-package of `fleet/` for `map/isolation.ts`'s reason, and with its rule:
 * it imports NOTHING from `fleet/` itself — a child reaching back into its
 * parent while the parent calls the child is the package cycle
 * `scripts/package-graph.mjs` refuses — so everything it needs arrives in one
 * record the caller fills.
 */
import { readCapabilityVocabulary } from "../../../../core/capabilities/capabilities.js";
import { capabilityRequirementIndex, gradableCapabilityIds } from "../../../../core/capabilities/findings.js";
import { parseRequirements, readRequirementsDocument } from "../../../../core/document/parse.js";
import { FleetContext } from "../../../../core/fleet-context.js";
import type { DocsDir } from "../../../../core/kernel/ids/dirs.js";
import type { Elem, Rel } from "../../../../core/c4/likec4.js";
import type { ParsedView } from "../../../../core/c4/parsed/dynamic-views.js";
import type { Finding } from "../../../../core/vocabulary/report.js";
import { useCaseFindings } from "../usecases/usecases.js";

export interface FleetUseCases {
  docsDir: DocsDir;
  /**
   * The views come from the PROJECT load, never from a single-file fallback,
   * and that is the file-naming rule made mechanical instead of remembered:
   * only the project load gives a view the `sourcePath` a finding has to name,
   * while a single-file load calls every document `source.c4` — so a message
   * built from that load would send its reader to `architecture/source.c4`, a
   * file that has never existed. No project, no views, and nothing to get wrong.
   */
  views: readonly ParsedView[];
  /** The map's model — what a hop is resolved against. */
  elements: Elem[];
  relationships: Rel[];
  /** The enumerated fleet, and the resolver every other edge join in the target uses. */
  services: ReadonlySet<string>;
  resolve: (id: string) => string;
  fleet?: FleetContext;
}

/**
 * The capability ladder is APPLIED BY ITS OWN FUNCTION rather than re-spelled
 * here: an absent or unreadable capabilities.yaml means silence for the whole
 * family, not a fleet full of unresolved tags, so `null` travels rather than an
 * empty list — which the join would read as "the fleet declares no capabilities"
 * and grade every tag against. `gradableCapabilityIds`
 * (`core/capabilities/findings.ts`) is the one statement of that rule, and this
 * is a caller of it precisely so a fourth un-gradable vocabulary state cannot be
 * fixed in core while the command layer keeps handing the join a whole key set.
 *
 * Both reads are already paid for under `--all`: `capabilityFleetFindings` has
 * asked for the vocabulary, and every requirement document behind the `#req-`
 * tag was parsed by it, so the fleet memo answers from cache. The requirement
 * index is built here rather than inside the use-case package so that package
 * never learns what a capability document is.
 */
export async function fleetUseCaseFindings(input: FleetUseCases): Promise<Finding[]> {
  const { docsDir, fleet } = input;
  const vocabulary =
    fleet === undefined ? await readCapabilityVocabulary(docsDir) : await fleet.capabilities(docsDir);
  const capabilityReqs = await capabilityRequirementIndex(
    vocabulary,
    fleet === undefined
      ? async (p) => parseRequirements(await readRequirementsDocument(p))
      : (p) => fleet.readRequirements(p),
  );
  return useCaseFindings({
    views: input.views,
    elements: input.elements,
    relationships: input.relationships,
    services: input.services,
    resolve: input.resolve,
    capabilities: gradableCapabilityIds(vocabulary),
    requirementsOf: (capability) => capabilityReqs.byCapability.get(capability),
  });
}
