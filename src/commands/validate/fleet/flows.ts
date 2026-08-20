/**
 * The flows a fleet draws, graded against the model they are drawn over and the
 * scenarios that are supposed to answer them.
 *
 * A flow is one LikeC4 dynamic view — an ordered interaction across several
 * services, read at the parsed stage and flattened with its branch structure
 * intact (core/c4/flows/). Two things can be asked of one without reading a
 * single test, and this module asks both:
 *
 *   `flow.step-unresolved` — a step drawn between elements no declared
 *   relationship joins: an arrow with no edge behind it at all, which is a
 *   different question from `spine.op-link-missing`'s (an edge that EXISTS and
 *   carries no `metadata { op }`) and takes that code's grade.
 *
 *   `flow.uncovered` — a flow with more branch outcomes than there are
 *   architecture scenarios covering it. This is the check that makes the branch
 *   structure a test matrix rather than a picture: an `alt` nobody wrote a
 *   second scenario for is a case the fleet has decided to draw and not to
 *   test.
 *
 * FLEET SCOPE, and it follows from where a journey can resolve at all: the
 * LikeC4 project scope excludes `services/**`, so a dynamic view stored under a
 * service resolves only that service's own containers, and a cross-service
 * journey resolves at fleet level or not at all. A per-service model's own
 * intra-service sequences stay that service's business — already coverable by
 * its arch requirements through the `Covers: view:<id>` form.
 *
 * THE FLOWS ARE HANDED IN, and that is the seam this module is built around:
 * where a fleet STORES its journeys is a repository-layout question, and it has
 * moved once already (from the landscape's own `views { ... }` block towards
 * documents of their own). Neither grade opens a flow document, so a change of
 * storage is a change at the call site and nothing in the walk, the arithmetic
 * or the messages has to be re-verified. (`flow.uncovered` does read the fleet's
 * `arch.spec.md` files — scenarios are not in a flow document and never will be.
 * Only where the journeys come from is storage-independent, and that is the half
 * that keeps moving.)
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { parseCoversEntry } from "../../../core/c4/arch.js";
import type { Flow, FlowNode } from "../../../core/c4/flows/flow.js";
import { stepsInOrder } from "../../../core/c4/flows/steps.js";
import { inOrder } from "../../../core/kernel/concurrency.js";
import { parseRequirements } from "../../../core/document/parse.js";
import type { Requirement } from "../../../core/document/spec.js";
import { FleetContext } from "../../../core/fleet-context.js";
import type { ServiceEntry } from "../../../core/repo/entries.js";
import { servicePathsAt } from "../../../core/repo/paths.js";
import type { Finding } from "../../../core/vocabulary/report.js";

/**
 * Both flow grades over the dynamic views the caller hands in.
 *
 * A fleet with no flows returns before anything is read: the arch.spec.md walk
 * below is a filesystem probe and a parse per service, and a fleet that draws no
 * journey owes none of it. (Under `--all` the parses are the fleet memo's, so
 * the walk costs nothing the service targets have not paid — but a repo with no
 * flows should not even pay the probes.)
 */
export async function flowFindings(
  flows: Flow[],
  services: ServiceEntry[],
  fleet: FleetContext | undefined,
): Promise<Finding[]> {
  if (flows.length === 0) return [];
  const findings: Finding[] = flows.flatMap(stepFindings);
  const covering = await coveringScenarios(services, fleet);
  for (const flow of flows) {
    const outcomes = outcomeCount(flow);
    const scenarios = covering.get(flow.id) ?? 0;
    if (scenarios >= outcomes) continue;
    findings.push({
      severity: "warn",
      code: "flow.uncovered",
      subject: flow.id,
      message:
        `flows: '${flow.id}' draws ${outcomes} branch outcome(s) and ${scenarios} architecture ` +
        `scenario(s) cover it — so at least ${outcomes - scenarios} outcome(s) have none. ` +
        "loam never reads a test, so it cannot say WHICH outcome is uncovered: it counts the " +
        "branches drawn in the view against the scenarios of the requirements whose " +
        `'Covers: view:${flow.id}' line names it. Write the missing scenario(s) under an ` +
        "arch.spec.md requirement covering this flow, or drop the branch nobody means to test",
    });
  }
  return findings;
}

/**
 * `flow.step-unresolved`, one finding per step — the shape
 * `spine.op-link-missing` uses for a landscape edge, and for its reason: each
 * step is its own drawn arrow with its own endpoints and its own fix, and
 * rolling them into one finding per flow would make the author count details
 * lines to find the pair that is wrong. A hand-authored journey is a dozen
 * steps, not a fleet's worth of relationships, so this cannot become the
 * cascade the per-file findings elsewhere are shaped to avoid.
 *
 * The ordinal is document order over EVERY step, resolved ones included: it is
 * the number an author counts down the diagram, and numbering only the broken
 * ones would point at the wrong arrow.
 */
function stepFindings(flow: Flow): Finding[] {
  const findings: Finding[] = [];
  for (const [index, step] of stepsInOrder(flow.steps).entries()) {
    if (step.rels.length > 0) continue;
    findings.push({
      severity: "warn",
      code: "flow.step-unresolved",
      subject: flow.id,
      message:
        `flows: '${flow.id}' step ${index + 1}` +
        (step.title === undefined ? "" : ` '${step.title}'`) +
        ` (${step.source} → ${step.target}) matches no declared relationship — the step is drawn ` +
        "and joined to nothing, so no operation is reachable through it and nothing the flow does " +
        "there can be traced to an operationId. Declare the edge in the model (with " +
        "metadata { op '<operationId>' } where it calls one), or correct the step's endpoints",
    });
  }
  return findings;
}

/**
 * How many outcomes a flow has — the N of the `flow.uncovered` shortfall.
 *
 * OUTCOMES ARE SUMMED ACROSS SUB-FLOWS, NEVER MULTIPLIED. Three nested `alt`s
 * of three branches are nine outcomes, not twenty-seven. The product is the
 * mathematically complete answer and it is the wrong rule here: it demands a
 * scenario count nobody will ever write, and a rule people route around — by
 * deleting branches from the diagram, which is the one artifact this whole item
 * exists to make worth maintaining — is worse than no rule at all.
 *
 * A flow with no sub-flows has ONE outcome, satisfied by one covering scenario:
 * `Math.max` is what states that, and it is also what keeps a flow made only of
 * `loop`/`par`/`break` blocks (which contribute nothing) at one rather than
 * zero, so a journey drawn as a plain sequence still owes a scenario.
 */
function outcomeCount(flow: Flow): number {
  return Math.max(1, branchOutcomes(flow.steps));
}

function branchOutcomes(nodes: FlowNode[]): number {
  return nodes.reduce((total, node) => total + outcomesOf(node), 0);
}

/**
 * What one node contributes, and why each keyword contributes what it does:
 *
 *   `alt`   — its branch count. It IS the branch point; each arm is a case an
 *             author named and a case a scenario has to state.
 *   `try`   — its `try` section, plus its `catch` when one is written. The
 *             `finally` is not an outcome: it runs either way, so it adds no
 *             case to distinguish.
 *   `opt`   — 2, taken and skipped. The skip is the outcome authors forget, and
 *             it is exactly the one an optional block asserts exists.
 *   `loop`, `par`, `break` — nothing. A body that runs again, a body whose
 *             order is unfixed, and an early exit change the ORDER of what
 *             happens, not the set of ways the journey can end; counting them
 *             would inflate N with cases no scenario could name apart.
 *   `unknown` — nothing of its own. A block kind this reader does not know may
 *             well branch, but loam cannot say into how many arms without
 *             understanding it, and an invented number is a coverage demand
 *             nobody could satisfy. Its recovered interior is still walked, as
 *             the reader keeps those steps rather than dropping them.
 *
 * Every branch's own body is walked and summed in, so an `alt` nested inside an
 * `opt` contributes both.
 */
function outcomesOf(node: FlowNode): number {
  switch (node.kind) {
    case "step":
      return 0;
    case "alt":
      return (
        node.branches.length + node.branches.reduce((n, b) => n + branchOutcomes(b.steps), 0)
      );
    case "try":
      return (
        (node.catch === undefined ? 1 : 2) +
        [node.try, node.catch, node.finally].reduce(
          (n, section) => n + (section === undefined ? 0 : branchOutcomes(section.steps)),
          0,
        )
      );
    case "opt":
      return 2 + branchOutcomes(node.steps);
    case "par":
    case "loop":
    case "break":
    case "unknown":
      return branchOutcomes(node.steps);
    default: {
      // `never` fails the build if a FlowNode variant is added with no case
      // here — the alternative being a new block kind silently counting as zero
      // outcomes, which reads as coverage rather than as an unanswered question.
      const unreachable: never = node;
      throw new Error(`unsupported flow node: ${JSON.stringify(unreachable)}`);
    }
  }
}

/**
 * View id → how many architecture scenarios cover it, summed over the fleet.
 *
 * arch.spec.md ONLY. A flow is an interaction across services and the outcome
 * of one is an integration or operational fact; the business spec grades what
 * one service promises its callers, and counting its scenarios here would let a
 * unit-level requirement silence a fleet-level question.
 *
 * REMOVED requirements cover nothing, exactly as `coversEntries` has it —
 * content on its way out obliges nothing and answers nothing.
 *
 * Scenarios are COUNTED, not read — so an empty scenario heading would buy an
 * outcome for free. That loophole is closed one check up rather than here:
 * `requirements.stepless-scenario` is an ERROR on a scenario with no steps, in
 * living documents and deltas alike, so a heading that tests nothing cannot
 * reach a fleet this check then grades.
 *
 * THE ID IS BARE, a stated limit rather than an oversight. LikeC4 refuses a
 * duplicate view id WITHIN a project, and a service's `model.likec4` is a
 * different project from `architecture/` — so a service may legally declare its
 * own `dynamic view checkout` beside a fleet journey of that name, and an arch
 * requirement covering the local one would be counted against the fleet one.
 * Closing that means qualifying the entry, which is a change to the `Covers:`
 * GRAMMAR and to what SCHEMA.md publishes; until an author actually collides,
 * saying so here beats inventing a spelling nobody asked for.
 *
 * Pooled rather than serial: the sum is order-independent (a `Map` keyed by
 * view id), and on a fleet with neither vocabulary file present this is the
 * FIRST fleet-wide walk of `arch.spec.md` — 120 serialised reads landing before
 * any service target starts.
 */
async function coveringScenarios(
  services: ServiceEntry[],
  fleet: FleetContext | undefined,
): Promise<Map<string, number>> {
  const perService = await inOrder(services, async (entry): Promise<[string, number][]> => {
    const path = servicePathsAt(entry.dir).archSpec;
    // Existence first: arch.spec.md is optional (most of a legacy fleet has
    // none) and `FleetContext.readRequirements` throws ENOENT, which surfaces
    // as `repository-unavailable` and takes the whole `--all` run down. An
    // absent optional artifact must never be able to do that.
    if (!existsSync(path)) return [];
    const reqs = fleet === undefined ? await readRequirementsAt(path) : await fleet.readRequirements(path);
    const found: [string, number][] = [];
    for (const requirement of reqs) {
      if (requirement.kind === "REMOVED") continue;
      for (const id of coveredViews(requirement)) found.push([id, requirement.scenarios.length]);
    }
    return found;
  });
  const counts = new Map<string, number>();
  for (const [id, scenarios] of perService.flat()) {
    counts.set(id, (counts.get(id) ?? 0) + scenarios);
  }
  return counts;
}

/**
 * The DISTINCT view ids one requirement covers. A `Covers:` line naming the same
 * view twice states one obligation, not two — counting it twice would let a
 * repeated entry buy coverage nobody wrote a scenario for, the one way this
 * check could be talked out of firing without a test being written.
 */
function coveredViews(requirement: Requirement): Set<string> {
  const ids = new Set<string>();
  for (const raw of requirement.covers) {
    const entry = parseCoversEntry(raw);
    if (entry.form === "view") ids.add(entry.id);
  }
  return ids;
}

/**
 * The uncached read, for a caller that hands in no fleet context.
 * `validateLandscape` declares its `fleet` optional and every wired caller
 * passes one, so this is a signature loose end and not a live mode — named
 * exactly, because a comment pointing at a `--service` path that does not exist
 * costs the next reader a grep. It stays for `permissionFindings`' reason: an
 * undefined context must degrade to a plain read, never throw.
 */
async function readRequirementsAt(path: string): Promise<Requirement[]> {
  return parseRequirements(await readFile(path, "utf8"));
}
