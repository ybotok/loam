/**
 * `loam list suites [<name>]` — which use cases run together, and WHICH
 * SERVICES MUST BE UP for a suite's journeys to run.
 *
 * That answer is maintained by hand in most fleets — a compose file, a CI
 * matrix, a paragraph in a runbook — and it is derivable, because a journey
 * already names every participant it touches and the fleet map already says
 * which `services/<id>/` each of those elements stands for. Deriving it means it
 * cannot drift from the journeys: add a hop to a flow and the environment its
 * suites need changes in the same commit. The grouping and the union are
 * `core/usecases/suites/`; this module turns them into the section's payload
 * and its text.
 *
 * A sub-package of list/ for `./campaign/`'s reason: the list package stands at
 * its five-file limit. The direction is list → list/suites, never back.
 *
 * ONE SHAPE whether or not a suite was named. Naming one is a filter over the
 * same answer, not a different question, so `suites[]` narrows and nothing else
 * does — `ungrouped[]` in particular stays the fleet's, because which journeys
 * reached no suite is not a fact about the suite being asked after.
 *
 * The use-case corpus's health travels as `useCases`, spelled as `list
 * capabilities`, `status` and `delta` spell it (`unreadable`, `error`), plus a
 * `state` this section needs and they do not: here the corpus IS the rows, so
 * "the fleet declares no use case" (`absent`) and "loam read them" (`ok`) are
 * two answers a reader has to be able to tell apart from one empty list. Over an
 * unreadable `architecture/` the section DEGRADES rather than refusing, exactly
 * as `list capabilities` does: `suites` and `ungrouped` are ABSENT keys — `[]`
 * would be "loam looked and found none", said about a project nobody read — and
 * a named suite is not refused as unknown, because that refusal would be a
 * claim about suites loam never saw.
 */
import { fail } from "../../../core/envelope/json.js";
import type { FleetContext } from "../../../core/fleet-context.js";
import type { DocsDir } from "../../../core/kernel/ids/dirs.js";
import { listServices } from "../../../core/repo/repo.js";
import { closeNamesHint } from "../../../core/repo/tree/find.js";
import type { ParsedView } from "../../../core/c4/parsed/dynamic-views.js";
import { readUseCases } from "../../../core/usecases/fleet.js";
import { viewFile } from "../../../core/usecases/place.js";
import { suiteListing, type Suite } from "../../../core/usecases/suites/suites.js";

export interface SuitesRequest {
  docsDir: DocsDir;
  /** The `[name]` argument: narrows `suites[]` to one suite, refusing a name no use case carries. */
  name: string | undefined;
  json: boolean;
  fleet: FleetContext;
}

/** The section, ready for whichever view the run prints. */
export interface SuitesSection {
  /** The additive payload keys, spread into the `list` envelope. */
  payload: Record<string, unknown>;
  /** The text view of the same answer. */
  print: () => void;
}

/**
 * Read the fleet's use cases and group them, or refuse an unknown suite name.
 *
 * Returns `null` when it has already refused — the caller's cue to stop, the
 * `resolveSubsystemSlice` convention one package over.
 *
 * The services are enumerated for the RESOLVER, not for the rows: the
 * element→service join needs the fleet set for the reason every edge join does
 * (`readUseCases`' `UseCaseRequest.known`), and without it a step into
 * `orders.api` would resolve to a service called "api".
 */
export async function suitesSection(req: SuitesRequest): Promise<SuitesSection | null> {
  const entries = await listServices(req.docsDir, req.fleet);
  const scan = await readUseCases({ docsDir: req.docsDir, known: new Set(entries.map((e) => e.id)) });
  if (scan.kind === "unreadable") {
    const error = scan.errors[0];
    return {
      payload: { useCases: { state: "unreadable", unreadable: true, ...(error === undefined ? {} : { error }) } },
      print: () => printUnreadable(error),
    };
  }
  const listing = suiteListing(scan);
  const state = scan.views.length === 0 ? "absent" : "ok";
  const shown = req.name === undefined ? listing.suites : listing.suites.filter((s) => s.name === req.name);
  if (req.name !== undefined && shown.length === 0) {
    const names = listing.suites.map((s) => s.name);
    // `unknown-target`, the code `--subsystem` and `show` use for a name that
    // resolves to nothing, with the same close-name hint — an empty environment
    // for a typo would read as a suite that needs nothing started.
    fail(
      req.json,
      "unknown-target",
      `No suite '${req.name}'.` +
        closeNamesHint(
          req.name,
          names,
          names.length === 0
            ? " No use case under architecture/ carries a `#suite-` tag."
            : ` Declared suites: ${names.join(", ")}.`,
        ),
    );
    return null;
  }
  return {
    payload: {
      suites: shown.map(suiteJson),
      ungrouped: listing.ungrouped.map(viewJson),
      useCases: { state, unreadable: false },
    },
    print: () => printSuites(shown, listing.ungrouped, state === "absent"),
  };
}

/** A use case as the payload names it: enough to open the document it is written in. */
function viewJson(view: ParsedView): { id: string; file: string } {
  return { id: view.id, file: viewFile(view) };
}

function suiteJson(suite: Suite): Record<string, unknown> {
  return {
    name: suite.name,
    views: suite.views.map(viewJson),
    services: suite.services,
    unresolved: suite.unresolved,
  };
}

/**
 * One block per suite — its services, then the participants a stand cannot
 * start — then the journeys in no suite.
 *
 * An unresolved participant gets a line of its own with a marker rather than
 * being folded into the service list: it is not a service anybody can start,
 * and reading it as one is how an environment comes up short.
 */
function printSuites(suites: readonly Suite[], ungrouped: readonly ParsedView[], absent: boolean): void {
  if (absent) {
    console.log(
      "no use cases — no dynamic view under architecture/ carries #cap-, #req- or #suite-, so there are no suites",
    );
    return;
  }
  if (suites.length === 0) console.log("no suites — no use case under architecture/ carries a #suite- tag");
  for (const [i, suite] of suites.entries()) {
    if (i > 0) console.log("");
    console.log(
      `suite ${suite.name} — ${suite.views.length} use case(s), ${suite.services.length} service(s) must be up`,
    );
    for (const service of suite.services) console.log(`  ${service}`);
    for (const missing of suite.unresolved) {
      console.log(
        `  ! ${missing.element} — resolves to no service in services/` +
          (missing.external ? " (#external: bring a double)" : ""),
      );
    }
    console.log(`  use cases: ${suite.views.map((v) => v.id).join(", ")}`);
  }
  console.log("");
  console.log(`use cases in no suite (${ungrouped.length})`);
  const width = Math.max(0, ...ungrouped.map((v) => v.id.length));
  for (const view of ungrouped) console.log(`  ${view.id.padEnd(width)}  ${viewFile(view)}`);
}

/**
 * The `list capabilities` note, in this section's words: UNKNOWN rather than
 * none, and the parser's own message on its own line, because a LikeC4 error is
 * several lines of expected-token list and inlining it would push the sentence
 * off the reader's screen.
 */
function printUnreadable(error: string | undefined): void {
  console.log(
    "note: architecture/ did not parse, so no use case could be read — " +
      "which suites exist, and what each needs up, is UNKNOWN here, not none",
  );
  if (error !== undefined) console.log(`  ${error}`);
}
