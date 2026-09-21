/**
 * The feature's own delta documents, read once: the requirement axes, the join
 * from a scenario claim back to the words it was minted from, and whether the
 * architecture and contract documents could be read at all.
 *
 * Everything here reads; nothing grades. The readability answers travel beside
 * the counts for `core/projection/api.ts`'s reason, one axis over: a delta that
 * does not parse yields an EMPTY change list, which is the same answer as a
 * delta that genuinely changes nothing — and a packet is consumed as "what is
 * left to do", where an empty answer over a YAML error reads as "nothing to do".
 */
import { existsSync } from "node:fs";
import { errorText } from "../c4/likec4.js";
import { repoPath } from "../envelope/json.js";
import type { FleetContext } from "../fleet-context.js";
import { scenarioBodyHash } from "../gherkin/digest.js";
import type { DocsDir, FeatureDir } from "../kernel/ids/dirs.js";
import type { PathableService } from "../kernel/ids/service.js";
import { requirementsMissingScenarios } from "../document/scenarios.js";
import type { Requirement } from "../document/spec.js";
import { apiChanges } from "../projection/api.js";
import { eventChanges } from "../projection/events.js";
import { featurePaths, featureSpecPaths, SPEC_AXES, type SpecAxis } from "../repo/paths.js";
import { claimId, DIGEST_LENGTH, ID_LENGTH } from "../verify/claims/identity.js";
import { describedUnitId, doneCheck, type ScenarioSource, type TaskUnit } from "./unit.js";

/** One spec axis of one service's delta, parsed. */
export interface DeltaAxis {
  service: string;
  axis: SpecAxis;
  /** Repo-relative, for the payload and for a human opening the file. */
  path: string;
  requirements: Requirement[];
}

/**
 * Both spec axes of every service the feature carries a delta for, in the order
 * `core/verify/checklist.ts` walks them — service-major, `spec.md` before
 * `arch.spec.md`. The order is load-bearing rather than tidy: it is what makes
 * the recomputed claim ids below land on the same occurrence counters the
 * checklist minted.
 */
export async function readDeltaAxes(
  docsDir: DocsDir,
  featureDir: FeatureDir,
  services: readonly PathableService[],
  context: FleetContext,
): Promise<DeltaAxis[]> {
  const out: DeltaAxis[] = [];
  for (const service of services) {
    const paths = featureSpecPaths(featureDir, service);
    for (const axis of SPEC_AXES) {
      const file = paths[axis.key];
      if (!existsSync(file)) continue;
      out.push({ service, axis, path: repoPath(docsDir, file), requirements: await context.readRequirements(file) });
    }
  }
  return out;
}

/**
 * A scenario's words, with the digest the claim that owns them must carry. The
 * digest travels beside the source rather than inside it because it is not part
 * of the source — it is the proof that this walk and the checklist's are talking
 * about the same scenario.
 */
export interface MintedSource {
  digest: string;
  source: ScenarioSource;
}

/**
 * Every scenario claim's source, keyed by the claim id it will carry.
 *
 * THE ID IS THE JOIN, and that is stronger than matching on the digest alone.
 * A scenario claim's id is `claimId(featureId, "scenario.tested", tuple, seen)`
 * over a tuple that already contains the requirement's identity, the scenario
 * name and a prefix of the body hash — so recomputing it from the same walk, in
 * the same order, with one shared occurrence map, reproduces the checklist's own
 * answer rather than approximating it. Two identically-worded scenarios under
 * one requirement share a digest and are still two questions: `claimId`'s `seen`
 * counter numbers them in DOCUMENT ORDER, and this walk visits them in document
 * order too, so the nth scenario pairs with the nth claim exactly.
 *
 * The digest is carried alongside and checked by the caller before a source is
 * attached. That is the belt: if this walk and the checklist's ever disagreed
 * about what a scenario says, the packet must show the unit with NO source
 * rather than with somebody else's Given/When/Then.
 *
 * Only ADDED and MODIFIED requirements, exactly as the checklist does: a BASE
 * requirement is the living state quoted inside the delta, and a REMOVED one is
 * being retired. Neither is work anybody has to have done.
 */
export function scenarioSources(featureId: string, axes: readonly DeltaAxis[]): Map<string, MintedSource> {
  const out = new Map<string, MintedSource>();
  const seen = new Map<string, number>();
  for (const { service, axis, path, requirements } of axes) {
    const arch = axis.key === "archSpec";
    for (const requirement of requirements) {
      if (requirement.kind === "BASE" || requirement.kind === "REMOVED") continue;
      const identity = requirement.id ?? requirement.name;
      for (const scenario of requirement.scenarios) {
        const body = scenarioBodyHash(service, scenario.lines, arch ? "arch" : "business");
        // The tuple is `core/verify/checklist.ts`'s, part for part — the arch
        // axis carries `arch.spec.md` as its second element, which is what keeps
        // two identically-worded scenarios on the two axes two questions.
        const parts = arch
          ? [service, "arch.spec.md", identity, scenario.name, body.slice(0, ID_LENGTH)]
          : [service, identity, scenario.name, body.slice(0, ID_LENGTH)];
        const id = claimId(featureId, "scenario.tested", parts, seen);
        out.set(id, {
          digest: body.slice(0, DIGEST_LENGTH),
          source: {
            path,
            ...(scenario.line === undefined ? {} : { line: scenario.line }),
            requirement: requirement.name,
            ...(requirement.id === undefined ? {} : { requirementId: requirement.id }),
            scenario: scenario.name,
            lines: scenario.lines,
          },
        });
      }
    }
  }
  return out;
}

/**
 * The first BDD act, as units: a requirement nobody has written a scenario for.
 *
 * `requirementsMissingScenarios` is the coverage rule every other surface
 * applies — REMOVED requirements are exempt there and stay exempt here, content
 * on its way out owes no acceptance criteria — so a packet can never disagree
 * with `loam validate` about which requirements are bare.
 */
export function describeUnits(featureId: string, axes: readonly DeltaAxis[]): TaskUnit[] {
  const out: TaskUnit[] = [];
  for (const { service, axis, path, requirements } of axes) {
    for (const requirement of requirementsMissingScenarios(requirements)) {
      const id = describedUnitId(featureId, service, axis.file, requirement.id ?? requirement.name);
      out.push({
        id,
        kind: "requirement.described",
        subject: service,
        at: "describe",
        claim:
          `requirement '${requirement.name}' (${service}, ${axis.file}) has no scenarios` +
          " — write the Given/When/Then first",
        dependsOn: [],
        source: {
          path,
          ...(requirement.line === undefined ? {} : { line: requirement.line }),
          requirement: requirement.name,
          ...(requirement.id === undefined ? {} : { requirementId: requirement.id }),
        },
        done: { check: doneCheck({ kind: "requirement.described" }) },
      });
    }
  }
  return out;
}

/** What could not be read. Keys are omitted when clean, so `{}` never means "checked and fine". */
export interface Unreadable {
  architecture?: string;
  contracts?: string[];
}

/** The delta's size, as documents rather than as open work — see `WorkPacket.size`. */
export interface DeltaSize {
  requirements: number;
  scenarios: number;
  operations: number;
  messages: number;
  calls: number;
}

/**
 * The two contract axes and the architecture delta, read for their COUNTS and
 * for whether they could be read.
 *
 * The same readers `loam delta` projects through (`apiChanges`/`eventChanges`),
 * so a packet can never report an operation the brief does not. The
 * architecture half is read through the invocation's context, which means the
 * parse is shared with the checklist derivation that has already loaded the same
 * document — one LikeC4 workspace per invocation rather than two.
 */
export async function readContracts(
  docsDir: DocsDir,
  featureDir: FeatureDir,
  services: readonly PathableService[],
  context: FleetContext,
): Promise<{ operations: number; messages: number; unreadable: Unreadable }> {
  let operations = 0;
  let messages = 0;
  const broken: string[] = [];
  for (const service of services) {
    const paths = featureSpecPaths(featureDir, service);
    const api = await apiChanges(paths.openapi);
    const events = await eventChanges(paths.asyncapi);
    if (api.unreadable || events.unreadable) broken.push(service);
    operations += api.changes.filter((change) => !change.remove).length;
    messages += events.changes.filter((change) => !change.remove).length;
  }
  const delta = featurePaths(featureDir).delta;
  let architecture: string | undefined;
  if (existsSync(delta)) {
    const loaded = await context.loadLikeC4(delta);
    // The first error only: the packet says WHICH document could not be read and
    // why, and a reader who needs the rest runs `loam validate --feature`, whose
    // job the whole list is.
    const first = loaded.errors[0];
    if (first !== undefined) architecture = errorText(first);
  }
  return {
    operations,
    messages,
    unreadable: {
      ...(architecture === undefined ? {} : { architecture }),
      ...(broken.length === 0 ? {} : { contracts: broken }),
    },
  };
}

/** How many requirements and scenarios the delta axes hold, whatever their kind. */
export function axisSize(axes: readonly DeltaAxis[]): { requirements: number; scenarios: number } {
  return {
    requirements: axes.reduce((n, a) => n + a.requirements.length, 0),
    scenarios: axes.reduce((n, a) => n + a.requirements.reduce((m, r) => m + r.scenarios.length, 0), 0),
  };
}
