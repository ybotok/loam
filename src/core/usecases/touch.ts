/**
 * Which business flows run through a service — the blast radius `loam delta`
 * and `loam status` report beside the requirements and contracts a feature
 * changes.
 *
 * ## The join is on ENDPOINTS, never on relationships
 *
 * `core/usecases/operations.ts` asks what a hop EXERCISES, which needs the
 * relationship behind it. This asks something weaker and more useful early:
 * does this hop mention the service at all? So it resolves the step's own two
 * endpoints and stops — no `attributeStep`, no candidate scan.
 *
 * That is the difference between answering and not answering for the service a
 * feature is about to INTRODUCE. A flow drawn for work that has not happened yet
 * has hops nothing in the model backs — `usecase.step-unbacked` is validate's
 * finding about exactly that, and it is an ERROR precisely because the fleet map
 * has not caught up — and a relationship join reports such a flow as touching
 * nobody. The endpoints are still there; the arrow is what is missing. An
 * implementer reading a delta brief needs to know the flow exists most of all in
 * that state, because that is the state their change is supposed to end.
 *
 * ## Everything a caller sees, it sees per HOP
 *
 * A view is reported only when at least one of its hops touches the addressed
 * services, and only those hops travel. "Checkout touches you" is not actionable;
 * "Checkout touches you at step 4" is where the reader goes to look.
 */
import { compareIds } from "../repo/entries.js";
import type { DocsDir } from "../kernel/ids/dirs.js";
import type { ParsedStep, ParsedView } from "../c4/parsed/dynamic-views.js";
import { readUseCases, type UseCaseScan } from "./fleet.js";
import { viewFile } from "./place.js";

/** One hop of a flow that mentions a service the caller asked about. */
export interface TouchedStep {
  /** The view's own leaf numbering — what the author sees on the diagram. */
  ordinal: number;
  title?: string;
  /** The step's endpoints as the view declares them: element ids, already oriented. */
  source: string;
  target: string;
  /**
   * Which of the ADDRESSED services this hop mentions, sorted. Both, when a flow
   * calls a service and it answers within the same addressed set.
   */
  services: string[];
}

/** One flow that touches the addressed services, with only the hops that do. */
export interface TouchedUseCase {
  id: string;
  title?: string;
  /** Repo-relative document the view is written in — where the reader goes to change it. */
  file: string;
  /**
   * The `#cap-` tags the view carries, verbatim and unresolved.
   *
   * Verbatim because resolving them means reading
   * `architecture/capabilities.yaml`, and a slug is not injective — the join can
   * legitimately answer "two capabilities" (core/capabilities/usecase-join.ts).
   * A blast-radius list is not the place to make that call: `loam validate --all`
   * already grades every tag with `usecase.capability-unresolved`, and a second
   * resolution here would be a second answer to the same question.
   */
  tags: string[];
  steps: TouchedStep[];
}

/**
 * The flows over a set of services, and whether loam could look at all.
 *
 * `unreadable` is a HOLE, in the sense `core/pack/pack.ts` uses the word: `flows`
 * is empty because `architecture/` did not parse, not because the fleet draws no
 * use cases. A consumer that cannot tell those apart reads "no business flow
 * depends on this" off a directory nobody could open, which is the vacuously
 * green answer every surface in loam is built to refuse.
 */
export interface UseCaseBlastRadius {
  unreadable: boolean;
  /** LikeC4's first message, so a reader knows which document to open. */
  error?: string;
  flows: TouchedUseCase[];
}

export interface BlastRadiusRequest {
  docsDir: DocsDir;
  /**
   * The fleet the element→service resolver is built with. Wider than `services`
   * on purpose: it should be every service the resolver could legitimately land
   * on, so a hop into a modelled container resolves to its owner rather than to
   * the container's own title.
   */
  known: ReadonlySet<string>;
  /** The services being asked about. */
  services: ReadonlySet<string>;
}

/** The addressed services one hop mentions, source and target both, sorted and de-duplicated. */
function touched(step: ParsedStep, scan: Extract<UseCaseScan, { kind: "read" }>, services: ReadonlySet<string>): string[] {
  const hit = [step.source, step.target].map((id) => scan.resolve(id)).filter((id) => services.has(id));
  return [...new Set(hit)].sort(compareIds);
}

/** One view's touching hops, in the author's own step order — the order the diagram reads in. */
function touchedView(view: ParsedView, scan: Extract<UseCaseScan, { kind: "read" }>, services: ReadonlySet<string>): TouchedUseCase | null {
  const steps: TouchedStep[] = [];
  for (const step of view.steps) {
    const hit = touched(step, scan, services);
    if (hit.length === 0) continue;
    steps.push({
      ordinal: step.ordinal,
      ...(step.title === undefined ? {} : { title: step.title }),
      source: step.source,
      target: step.target,
      services: hit,
    });
  }
  if (steps.length === 0) return null;
  return {
    id: view.id,
    ...(view.title === undefined ? {} : { title: view.title }),
    file: viewFile(view),
    tags: [...view.tags].sort(compareIds),
    steps,
  };
}

/**
 * The flows touching a set of services, over a scan somebody already has.
 *
 * Separate from `useCaseBlastRadius` below because `core/pack/joins.ts` reads
 * the scan ONCE and asks two different questions of it — this one and the
 * capability claim join — and a second read there would be a second LikeC4
 * project load inside a single `loam context`.
 *
 * An `unreadable` scan answers with nothing. Every caller pairs this with the
 * scan's own health, because an empty list means "no flow mentions these
 * services" and "nobody could look" only when read together.
 */
export function flowsTouching(scan: UseCaseScan, services: ReadonlySet<string>): TouchedUseCase[] {
  if (scan.kind !== "read") return [];
  return (
    scan.views
      .map((view) => touchedView(view, scan, services))
      .filter((flow): flow is TouchedUseCase => flow !== null)
      // Sorted by (file, view id) rather than reported in LikeC4's own record
      // order: nothing in loam has measured that the parse preserves declaration
      // order, so a payload ordered by it would reorder under a dependency bump.
      .sort((a, b) => compareIds(a.file, b.file) || compareIds(a.id, b.id))
  );
}

/**
 * The flows touching a set of services, read and joined in one call.
 *
 * The load underneath is `readUseCases`, which carries its own cheap gate: a
 * fleet whose `architecture/` documents never mention the reserved tag prefix
 * answers `{ flows: [] }` without starting LikeC4 at all. That gate is what
 * makes this callable from `loam delta`, which sits in `/loam-implement`'s inner
 * loop and would otherwise pay a Langium workspace spin-up on every iteration of
 * somebody's afternoon.
 */
export async function useCaseBlastRadius(req: BlastRadiusRequest): Promise<UseCaseBlastRadius> {
  const scan = await readUseCases({ docsDir: req.docsDir, known: req.known });
  if (scan.kind !== "read") {
    return { unreadable: true, ...(scan.errors[0] === undefined ? {} : { error: scan.errors[0] }), flows: [] };
  }
  return { unreadable: false, flows: flowsTouching(scan, req.services) };
}
