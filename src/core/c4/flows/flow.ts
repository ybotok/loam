/**
 * What a FLOW is to loam: one LikeC4 dynamic view, flattened — an ordered
 * interaction across several services, with its branch structure intact.
 *
 * A package of its own rather than another file beside `../likec4.ts`, because
 * the two answer different questions — that module asks LikeC4 what a document
 * DECLARES, boxes and arrows, while a dynamic view is what somebody DREW over
 * those declarations — and because `core/c4/` is already at its five-file
 * limit, so the next subject had to open a directory seam regardless.
 *
 * Three shape decisions live here rather than in the reader, because they are
 * what every later caller sees:
 *
 * A TREE, NOT A STEP LIST. A dynamic view states the interaction and states no
 * outcome; outcomes stay with the scenarios that cover it. "Which branches has
 * nobody covered?" is the question that makes a flow a test matrix rather than
 * a picture, and only the tree can answer it — an `alt` flattened into its
 * steps has lost exactly the axis being asked about.
 *
 * A STEP CARRIES ITS RELATIONSHIPS, NOT AN OPERATION. A parsed step has no
 * `metadata` of its own, so the operationId it exercises can only come from the
 * relationship it matches; and one pair of elements may carry TWO declared
 * relationships (`authorize` and `capture`), which a step drawn source→target
 * cannot choose between. So every match is carried and none is picked: an
 * ambiguity the author can see is worth more than a coin flip nobody can.
 *
 * A VIEW ID STAYS A PLAIN STRING. `../model/`'s `DeclaredService` is branded
 * because a name a document asserts crosses into PATHS, where an unchecked
 * string is a traversal. A view id is only ever looked up — a `Covers:` entry
 * that resolves to nothing is the existing `covers.unknown` — and loam
 * validates nothing about it that a brand could then claim to have checked.
 */
import type { Rel } from "../model/model.js";

/** loam-neutral journey view (flattened from a LikeC4 dynamic view). */
export interface Flow {
  /** The view id — what a `Covers:` entry names, and what a finding must quote. */
  id: string;
  title?: string;
  /**
   * Tags as LikeC4 reports them, WITHOUT '#', exactly as `Elem.tags` does. A
   * feature id and a suite group tag share this one line, which is why the
   * feature-delta projection needs no new concept for flows.
   */
  tags: string[];
  /**
   * Every element id the steps touch, de-duplicated, in first-appearance order.
   * Ids and not services: resolving one to a `services/<id>` directory needs
   * the document's elements, and only some callers hold them.
   */
  participants: string[];
  /** The view's body in document order. */
  steps: FlowNode[];
}

/**
 * One entry in a flow's body: an interaction, or one of the blocks LikeC4 draws
 * around interactions.
 *
 * LikeC4's `series` — its parse of the chain form `a -> b -> c` — is absent on
 * purpose. It carries no condition and no title, so its steps ARE the enclosing
 * body's steps, and inlining them keeps every variant here a structure that
 * changes what a suite must cover.
 */
export type FlowNode = FlowStep | FlowBlock | FlowAlt | FlowTry | FlowUnknown;

/** One interaction: an arrow drawn from one element to another. */
export interface FlowStep {
  kind: "step";
  source: string;
  target: string;
  title?: string;
  /**
   * Every declared relationship this step could be exercising, in declaration
   * order — where its `metadata { op }` comes from. EMPTY means the step is
   * drawn between elements no relationship joins, the state a later slice
   * grades as `flow.step-unresolved`; it is a value here and not an omission,
   * because a step that silently vanished from the tree would take a branch's
   * coverage question with it.
   */
  rels: Rel[];
}

/**
 * A block with one body and no branches. The four keywords stay distinct rather
 * than collapsing into "block", because what a suite owes each one differs: a
 * `loop`'s body runs again, an `opt`'s may not run at all, a `par`'s runs in no
 * fixed order, and a `break` leaves the block it sits in.
 */
export interface FlowBlock {
  kind: "par" | "opt" | "loop" | "break";
  /** The block's own label — a loop's condition, an opt's guard. */
  title?: string;
  steps: FlowNode[];
}

/** `alt`: the branch point, and the reason the tree exists. */
export interface FlowAlt {
  kind: "alt";
  title?: string;
  branches: FlowBranch[];
}

/**
 * One arm of an `alt`. The keyword is kept rather than normalized to
 * "condition"/"otherwise": `when` and `if` state a case the author named, while
 * `else` is the fallback, and a matrix that cannot tell the fallback from a
 * named case cannot say which case nobody wrote a scenario for.
 */
export interface FlowBranch {
  kind: "when" | "if" | "else";
  title?: string;
  steps: FlowNode[];
}

/** `try` with its optional `catch` and `finally` sections. */
export interface FlowTry {
  kind: "try";
  try: FlowSection;
  catch?: FlowSection;
  finally?: FlowSection;
}

/** One section of a `try`: a body, and the label LikeC4 allows on it. */
export interface FlowSection {
  title?: string;
  steps: FlowNode[];
}

/**
 * A block whose kind this reader does not know — what a LikeC4 newer than the
 * pinned one declares.
 *
 * It is a variant rather than a refusal because the document READ and PARSED;
 * the only thing missing is a reader one version behind, and "could not read"
 * is a different thing to tell an author than "read and did not understand"
 * (see `../flows/flatten.ts`'s `readUnknown`). The steps that could be
 * recovered are kept, so the branches inside it stay a question a later slice
 * can ask, exactly as an unresolved step keeps its empty `rels`.
 */
export interface FlowUnknown {
  kind: "unknown";
  /** LikeC4's own name for the block, verbatim — what a finding would have to quote. */
  block: string;
  title?: string;
  steps: FlowNode[];
}
