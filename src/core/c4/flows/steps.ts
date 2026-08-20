/**
 * A flow's steps, flattened out of its tree, and the relationships they draw.
 *
 * The tree is what makes a flow a test matrix rather than a picture (`./flow.ts`
 * says why), so nothing here flattens it away — but two questions are about the
 * arrows alone and not about the branches around them: which arrows are drawn,
 * in the order an author counts them down the diagram, and which declared
 * relationships those arrows carry.
 *
 * A leaf beside the shape it walks rather than a private helper inside either
 * caller, and that is the reason it exists at all: the first question is asked
 * by `commands/validate/fleet/flows.ts` (`flow.step-unresolved`) and the second
 * by `commands/validate/arch-coverage.ts` (`flow.unrepresented`), so a second
 * copy of the walk would be a second answer to "which steps does this flow
 * have" — and the two disagreeing about, say, whether a `try`'s `finally`
 * contributes steps would put two findings on two different diagrams.
 */
import type { Flow, FlowNode, FlowStep } from "./flow.js";
import type { Rel } from "../model/model.js";

/**
 * Every step of a flow, in document order — the tree flattened where only the
 * arrows matter.
 *
 * EVERY step, resolved ones and unresolved ones alike: `flow.step-unresolved`
 * numbers its findings out of this order, and it is the number an author counts
 * down the diagram, so dropping any step here would point at the wrong arrow.
 */
export function stepsInOrder(nodes: FlowNode[]): FlowStep[] {
  return nodes.flatMap((node): FlowStep[] => {
    switch (node.kind) {
      case "step":
        return [node];
      case "alt":
        return node.branches.flatMap((branch) => stepsInOrder(branch.steps));
      case "try":
        return [node.try, node.catch, node.finally].flatMap((section) =>
          section === undefined ? [] : stepsInOrder(section.steps),
        );
      default:
        return stepsInOrder(node.steps);
    }
  });
}

/**
 * Every relationship some step of these flows carries — the set
 * `flow.unrepresented` asks a feature's new operation about.
 *
 * THE DECISION THIS ENCODES, and it is a trade rather than a derivation: a step
 * COVERS every relationship it carries. `./resolve.ts`'s join is
 * granularity-blind and hands a step EVERY match, so one `orderService ->
 * paymentService` arrow drawn over three container-level declarations carries
 * all three, and all three count as drawn here.
 *
 * The alternative — a step covers only a relationship declared between its own
 * two endpoints — would force every journey to be redrawn at container
 * granularity the moment anybody modelled a container, which defeats the point
 * of a FLEET-level map and is the very state `./resolve.ts`'s descent was added
 * to tolerate.
 *
 * The cost is under-reporting, and the caller must say so where an author can
 * read it: a genuinely new operation between two services some step already
 * joins is drawn by that step for free, so the warning will never name it. What
 * this set can prove is that a journey draws the INTERACTION — never that
 * anybody thought about the operation.
 *
 * Identity rather than a structural key, which is what confines that trade to
 * the one document. The relationships a step carries are the very objects the
 * reader resolved out of the same parse, so a caller asking about a
 * relationship from that parse gets an exact answer — and one asking about a
 * relationship from a DIFFERENT document gets `false`, rather than a guess that
 * two documents' element ids mean the same box.
 */
export function drawnRelationships(flows: Flow[]): Set<Rel> {
  return new Set(flows.flatMap((flow) => stepsInOrder(flow.steps)).flatMap((step) => step.rels));
}
