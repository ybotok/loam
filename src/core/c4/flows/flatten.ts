/**
 * Reading dynamic views out of a PARSED LikeC4 model, and flattening them into
 * `./flow.ts`'s neutral tree. What the parse output looks like is `./parsed-view.ts`.
 *
 * The parsed stage is not an optimisation here, it is the constraint. A view
 * only becomes a first-class `LikeC4ViewModel` once the model is COMPUTED —
 * `model.views()` is empty at the parsed stage, by design ("Model with parsed
 * data will not have views, as they must be computed") — and computing builds
 * every view in the document at a cost superlinear in edge count, which
 * `../likec4.ts` and `../workspace.ts` refuse to pay on every load. What the
 * parsed stage does carry is the view's declaration, in `$data.views`, which is
 * everything loam reads: the steps as authored, their nesting, and the tags.
 */
import { isRecord, ownValue } from "../../kernel/records.js";
import type { Rel } from "../model/model.js";
import type { Flow, FlowBranch, FlowNode, FlowSection, FlowStep, FlowTry } from "./flow.js";
import type {
  ParsedAlt,
  ParsedBranch,
  ParsedNode,
  ParsedSection,
  ParsedStep,
  ParsedTry,
  ReadableViews,
} from "./parsed-view.js";
import { relationResolver } from "./resolve.js";

/** Every `_type` the parsed union spells — a plain step, its one member without one, aside. */
type BlockType = Extract<ParsedNode, { _type: string }>["_type"];

/**
 * loam's block vocabulary as a VALUE, so the reader can ask at runtime whether
 * a `_type` is one it knows. Typed from the union rather than hand-listed: a
 * member added to `ParsedNode` with no entry here fails to compile, and an
 * entry here with no case in `readNode`'s switch fails at that switch's
 * `never`. The two halves cannot drift apart, which matters because the drift
 * would be silent — a block routed to the wrong half either loses its steps or
 * reaches a branch that is supposed to be dead.
 */
const KNOWN_BLOCKS: Record<BlockType, true> = {
  series: true,
  par: true,
  opt: true,
  loop: true,
  break: true,
  alt: true,
  try: true,
};

/**
 * What one flow is being read with: the relationship lookup, shared across
 * every step of the document, and the participants accumulated as the walk
 * goes. A `Set` and not a list plus a seen-set, because insertion order IS
 * first-appearance order in JavaScript — two structures that had to agree about
 * the same fact is one that can disagree.
 */
interface FlowWalk {
  link: (source: string, target: string) => Rel[];
  participants: Set<string>;
}

/**
 * Every dynamic view in the document, as loam's `Flow`.
 *
 * Sorted by id, and that is not cosmetic: `$data.views` is a record, so its
 * iteration order is LikeC4's own insertion order — which is not the
 * document's, since an auto-generated landscape view is inserted ahead of
 * everything the author wrote. Sorting makes the order a property of the
 * document rather than of the dependency's build order, which is what a
 * generated file compared byte-for-byte after a regeneration needs.
 */
export function flattenFlows(model: ReadableViews, relationships: Rel[]): Flow[] {
  const link = relationResolver(relationships);
  const flows: Flow[] = [];
  for (const [id, view] of Object.entries(model.$data.views)) {
    if (view._type !== "dynamic") continue;
    const walk: FlowWalk = { link, participants: new Set<string>() };
    // Steps first: the walk is what fills `participants`.
    const steps = readNodes(view.steps, walk);
    flows.push({
      id,
      title: view.title ?? undefined,
      tags: [...(view.tags ?? [])],
      participants: [...walk.participants],
      steps,
    });
  }
  return flows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** A body, in document order. `flatMap` because a `series` inlines into several. */
function readNodes(nodes: readonly ParsedNode[], walk: FlowWalk): FlowNode[] {
  return nodes.flatMap((node) => readNode(node, walk));
}

function readNode(node: ParsedNode, walk: FlowWalk): FlowNode[] {
  if (!("_type" in node)) return [readStep(node, walk)];
  // The runtime unknown is narrowed off BEFORE the dispatch, and the two are
  // separate concerns on purpose. The parsed union is loam's claim about likec4
  // 1.59.2; a newer one may declare a block kind that is not in it, and that
  // value is read as `unknown` by a reader that validates what it uses. What is
  // left is loam's own vocabulary, so the switch's `never` stays what it is
  // meant to be — a compile-time proof that every variant has a case — instead
  // of doubling as the place a dependency upgrade lands.
  if (!Object.hasOwn(KNOWN_BLOCKS, node._type)) return [readUnknown(node, walk)];
  switch (node._type) {
    case "series":
      return node.steps.map((step) => readStep(step, walk));
    case "alt":
      return [readAlt(node, walk)];
    case "try":
      return [readTry(node, walk)];
    case "par":
    case "opt":
    case "loop":
    case "break":
      return [{ kind: node._type, title: node.title ?? undefined, steps: readNodes(node.steps, walk) }];
    default: {
      // Dead in both senses, and kept for the first one: `never` fails the build
      // if a variant is added above without a case, and no runtime value reaches
      // here because a `_type` outside the vocabulary was routed away above.
      const unreachable: never = node;
      throw new Error(`unsupported LikeC4 dynamic-view block: ${JSON.stringify(unreachable)}`);
    }
  }
}

/**
 * A block kind loam does not know: REPRESENTED, never refused.
 *
 * The document parsed and validated — the only thing missing is a reader one
 * version ahead. Throwing would surface that as `landscape.invalid` /
 * `service.unreadable` / `repository-unavailable`, each of which tells the
 * author the file could not be READ, and the first of which returns early and
 * skips every remaining fleet check. loam separates "could not read" from "read
 * and did not understand" everywhere else it grades a document
 * (`health.invalid`, `openapi.invalid`), and this is the second.
 *
 * Its steps are kept, so a later slice can still ask what covers them — the
 * same reason an unresolved step keeps `rels: []` rather than vanishing.
 */
function readUnknown(node: unknown, walk: FlowWalk): FlowNode {
  const block = isRecord(node) ? node : {};
  const kind = ownValue(block, "_type");
  const title = ownValue(block, "title");
  return {
    kind: "unknown",
    block: typeof kind === "string" ? kind : "",
    title: typeof title === "string" ? title : undefined,
    steps: readUnknownSteps(ownValue(block, "steps"), walk),
  };
}

/**
 * The steps inside an unknown block, from its own `steps` array — the shape six
 * of the seven blocks in the pinned version use. Every field is checked here,
 * because nothing on this path is covered by the loaders' assertion.
 *
 * Two deliberate limits. A block that nests its body some other way is
 * represented with no steps rather than with guessed ones, since an invented
 * step is a coverage question nobody asked. And a block nested inside an
 * unknown one is read as unknown too, even when its kind is one loam knows:
 * routing it back through the dispatch would mean asserting a shape nothing has
 * checked, and salvage is the worst place to start trusting unvalidated data.
 */
function readUnknownSteps(steps: unknown, walk: FlowWalk): FlowNode[] {
  if (!Array.isArray(steps)) return [];
  return steps.flatMap((entry: unknown): FlowNode[] => {
    if (!isRecord(entry)) return [];
    const source = ownValue(entry, "source");
    const target = ownValue(entry, "target");
    if (typeof source !== "string" || typeof target !== "string") return [readUnknown(entry, walk)];
    const title = ownValue(entry, "title");
    return [readStep({ source, target, title: typeof title === "string" ? title : null }, walk)];
  });
}

function readStep(step: ParsedStep, walk: FlowWalk): FlowStep {
  walk.participants.add(step.source);
  walk.participants.add(step.target);
  return {
    kind: "step",
    source: step.source,
    target: step.target,
    title: step.title ?? undefined,
    rels: walk.link(step.source, step.target),
  };
}

function readAlt(node: ParsedAlt, walk: FlowWalk): FlowNode {
  return { kind: "alt", title: node.title ?? undefined, branches: readBranches(node.branches, walk) };
}

function readBranches(branches: readonly ParsedBranch[], walk: FlowWalk): FlowBranch[] {
  return branches.map((branch) => ({
    kind: branch._type,
    title: branch.title ?? undefined,
    steps: readNodes(branch.steps, walk),
  }));
}

function readTry(node: ParsedTry, walk: FlowWalk): FlowTry {
  // Read in source order: `participants` is first-appearance order, so pulling
  // `finally` up ahead of `catch` would reorder the flow's participant list
  // without changing a character of the document.
  const tried = readSection(node.try, walk);
  const caught = node.catch === undefined ? undefined : readSection(node.catch, walk);
  const ended = node.finally === undefined ? undefined : readSection(node.finally, walk);
  return {
    kind: "try",
    try: tried,
    ...(caught === undefined ? {} : { catch: caught }),
    ...(ended === undefined ? {} : { finally: ended }),
  };
}

function readSection(section: ParsedSection, walk: FlowWalk): FlowSection {
  return { title: section.title ?? undefined, steps: readNodes(section.steps, walk) };
}
