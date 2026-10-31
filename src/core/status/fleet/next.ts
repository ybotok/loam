/**
 * `next[]` — the whole repository: the steps about the repository itself
 * first, then every feature in flight, then each service's adoption gaps,
 * most-unblocking first, then the archived features whose done-check is still
 * open (reported, never runnable), capped so the list stays navigation rather
 * than inventory.
 */
import type { DependencyGraph } from "../../dependencies/facts.js";
import { compareIds, type ServiceEntry } from "../../repo/entries.js";
import { recoverStep } from "../interrupted.js";
import { featureLabel, fleetStageWords } from "../feature/words.js";
import { archivedStep } from "../feature/next.js";
import { type ArtifactStatus, type InterruptedCommit, type NextStep } from "../report.js";
import type { ArchivedFeatureState, FleetFeatureState } from "./report.js";
import { perServiceSteps } from "./rungs.js";

/** How urgent a stage is at fleet level. See {@link fleetNext}. */
const STAGE_RANK: Record<ArtifactStatus, number> = {
  done: 0,
  ready: 1,
  draft: 2,
  missing: 3,
  blocked: 4,
};

/**
 * How many per-service and per-feature steps the fleet form will print before
 * it stops and says how many it left out. A fleet mid-adoption produced 135
 * entries under the heading "the next thing to do" — a list nobody reads is a
 * list that is not navigation, and the first ten are the ten that matter
 * because the ordering below is already most-unblocking-first.
 *
 * Exported so the test asserts the cap through the constant: a literal 10 in a
 * fixture is a second declaration of the limit, free to disagree the day this
 * one moves.
 */
export const FLEET_NEXT_LIMIT = 10;

/**
 * Fleet-level steps, most-unblocking first. A verified feature, ready to
 * archive, comes before one that still needs authoring, because archiving it
 * is what releases
 * everything queued behind it; a blocked feature comes last, because there is
 * nothing to do about it from here — its prerequisite is already higher up the
 * list under its own entry.
 *
 * The gate is the LAST entry and it is always there. `next.fleet-clean` used to
 * be the only route to `loam validate --all`, and it was emitted only when
 * nothing was in flight — so a repository that FAILS the fleet gate, which is
 * every repository with work in it, was handed a green-looking list that never
 * once named the command CI runs. This form grades nothing; the least it can do
 * is say where grading happens. `next.fleet-clean` is also no longer the
 * empty-repo answer: over zero services, "every service is written down" is
 * vacuously true, and the first hour of a docs repo used to get that green
 * sentence instead of its first three steps. The teaching ladder below owns
 * that case now, and the clean entry survives only for its truthful one —
 * services exist, and nothing is owed.
 */
/** The whole fleet as the next-step walk reads it. */
export interface Fleet {
  services: ServiceEntry[];
  features: FleetFeatureState[];
  /** Archived features whose done-check is still open (`FleetStatusReport.unverifiedArchived`). */
  archived: ArchivedFeatureState[];
  graph: DependencyGraph;
  interrupted: InterruptedCommit | null;
  /**
   * The ladder's fact, present exactly when the ladder can apply — an
   * unnarrowed run over an empty fleet. `null` otherwise: on a narrowed run
   * (withheld for the reason fleet.ts records beside the binding) and on any
   * fleet with services or features, where fleet.ts skips the read entirely.
   */
  teaching: { landscape: "missing" | "stub" | "authored" } | null;
}

/**
 * What this repository says it IS, as the walk needs it — and it needs BOTH
 * facts, which is why this is a record and not the bare id it used to be.
 *
 * `adopted: false` is the case the walk always handled: the fleet has no
 * `services/<id>/`, and `next.adopt-bound` leads. `adopted: true` was invisible
 * — the parameter was `string | null` and went null exactly when the directory
 * existed — so a repository bound to a service the fleet DOES know got the
 * whole system's worklist in alphabetical order, with its own boundary
 * somewhere in the middle of it or, past ten services, not on the list at all.
 */
export interface Binding {
  id: string;
  /** Whether the fleet has a `services/<id>/` for it. */
  adopted: boolean;
  /**
   * The active features whose `specs/` introduce it (`introducingFeatures`) —
   * empty unless `adopted` is false. A service a feature in flight introduces
   * has no code to adopt yet: the work in its repository IS that feature.
   */
  introducedBy: string[];
}

export function fleetNext(fleet: Fleet, binding: Binding | null): NextStep[] {
  const { services, features, archived, graph, interrupted, teaching } = fleet;
  const steps: NextStep[] = [];
  // The two arms of the binding, each named for the question it answers. The
  // first reproduces the old parameter exactly, so everything reading it below
  // is unchanged; the second is the fact that used to be thrown away.
  const unadoptedBinding = binding !== null && !binding.adopted ? binding.id : null;
  const adoptedBinding = binding !== null && binding.adopted ? binding.id : null;
  // The features that bring the bound service into being, when any in flight
  // do. Their steps lead and the feature loop below skips them, so a feature
  // this repository exists for is named once, first — EVERY one of them, since
  // whichever archives first is the one that makes the service living.
  const introducing = unadoptedBinding === null ? [] : features.filter((f) => binding!.introducedBy.includes(f.id));

  // The repository this command is standing in names a service the fleet has no
  // directory for. First, ahead of every other service's partial adoption,
  // because it is the only step that is about HERE.
  //
  // This form used to count the fleet and ignore the binding entirely, so in a
  // service repo bound to an unadopted service — a freshly wired one, the most
  // common repo there is — an empty fleet made "every service is written down"
  // vacuously true and `next.fleet-clean` came out top. `loam doctor` had the
  // right answer (`doctor.service-unknown`) at the same moment, and the
  // documented agent loop reads `status`: an agent following it was sent to
  // start a feature instead of adopting the service under its feet.
  //
  // Unless a feature in flight INTRODUCES the service. Then there is no code
  // yet for `loam adopt` to read — the feature's own specs/ ARE its documents
  // until it archives — and telling its first developer to adopt it sent them
  // to describe an empty repository. The step is the feature's, under the code
  // the feature loop already emits, so nothing new needs branching on.
  for (const f of introducing) {
    const others = introducing.filter((o) => o !== f).map((o) => o.id);
    steps.push({
      code: "next.feature",
      statement:
        `This repository's loam.json says it is '${unadoptedBinding}', which ${f.id} introduces` +
        (others.length > 0 ? ` (so does ${others.join(", ")})` : "") +
        ` — it is not in the living docs until ${others.length > 0 ? "one of them" : f.id} archives, so there is ` +
        `nothing to adopt; ${f.id}'s own status says what this repository owes it.`,
      command: `loam status ${f.id} --json`,
    });
  }
  if (unadoptedBinding !== null && introducing.length === 0) {
    steps.push({
      code: "next.adopt-bound",
      statement:
        `This repository's loam.json says it is '${unadoptedBinding}', and the fleet has no ` +
        `services/${unadoptedBinding}/ — nothing about the service you are standing in is written down yet.`,
      command: `loam adopt --service ${unadoptedBinding} --json`,
      service: unadoptedBinding,
    });
  }

  // The first hour of a docs repo, in order. Zero services and zero features
  // used to fall through every loop below into `next.fleet-clean` — the header
  // says why that answer was vacuous — so the emptiest repository loam serves
  // got the least from the command whose whole purpose is "what do I do next".
  // These are ordinary steps on purpose: the gate entry still closes the list,
  // and the tail ternary is untouched. The bind/adopt rungs are suppressed when
  // `next.adopt-bound` above already names the exact adopt to run, and the
  // whole ladder is withheld on narrowed runs (`teaching === null`).
  if (teaching !== null && services.length === 0 && features.length === 0) {
    if (teaching.landscape !== "authored") {
      steps.push({
        code: "next.author-landscape",
        statement:
          teaching.landscape === "missing"
            ? "architecture/landscape.likec4 does not exist — the fleet map is the one artifact every " +
              "cross-service check reads. Run `loam init --create` to scaffold it, then draw the first service."
            : "architecture/landscape.likec4 is still the scaffold's untouched map — no service is drawn. " +
              "State the facts in a fleet.yaml (service ids, `a -> b` calls, `a -> b: operationId` for the " +
              "operation a call uses) and run `loam seed --from fleet.yaml` to template the map mechanically; " +
              "`loam validate --all --spine` then checks each named operation against its provider's contract. " +
              "Or open the file and follow its own comments. Either way loam never guesses who calls whom.",
        // The command each arm's own prose already names, and for a while it
        // was neither: both arms carried the gate. WORKFLOW.md documents the
        // agent loop as "read next[0], run the command it names, repeat" and
        // every generated skill says to branch on the code rather than the
        // prose — so an agent on the first rung of the first hour ran
        // `validate --all` against a repository with no services in it, which
        // answers ok:true with `landscape.matched` and changes nothing, and
        // came back to the identical next[0] forever. A livelock on day zero,
        // on the one command built to answer "what now". The gate is still
        // named: `next.fleet-gate` closes this same list.
        command: teaching.landscape === "missing" ? "loam init --create" : "loam seed --from fleet.yaml",
        path: "architecture/landscape.likec4",
      });
    }
    if (unadoptedBinding === null) {
      steps.push({
        code: "next.bind-service",
        statement:
          "No service repository is bound to this fleet yet. From a service's own repo, point --docs " +
          "here and --service at its canonical id with the service agent profile, then commit the " +
          "loam.json it writes.",
        // `--agent-profile service`, because the default is `full`, and `full`
        // writes loam-feature and loam-ship into the service checkout — the two
        // workflows this docs repo keeps, which README tells every service
        // repo to leave out. An agent runs this literal, not the README.
        command: "loam init --docs <path-to-this-docs-repo> --service <service-id> --agent-profile service",
      });
      steps.push({
        code: "next.adopt-first",
        statement:
          "services/ is empty — nothing about any service is written down yet. Adopt the first one: " +
          "the brief walks an agent through writing its baseline docs as draft.",
        command: "loam adopt --service <service-id> --json",
      });
    }
  }

  // Features BEFORE the per-service rungs. The rungs used to lead, on the
  // reading that an adoption gap blocks grading — and on a fleet mid-adoption
  // that put a page of `next.adopt` lines ahead of the one feature anybody was
  // working on, and the cap below elided that feature as "more step(s) of the
  // same kinds": the only change in flight, invisible under the heading
  // "next". A feature is work somebody started; an undocumented service is
  // backlog. The rungs still follow, and still in full where it matters —
  // `serviceSteps` beside this list carries every one of them uncapped.
  const ordered = [...features].sort(
    (a, b) =>
      STAGE_RANK[a.stage] - STAGE_RANK[b.stage] ||
      graph.order.indexOf(a.id) - graph.order.indexOf(b.id) ||
      compareIds(a.id, b.id),
  );
  for (const f of ordered) {
    if (introducing.includes(f)) continue;
    const label = featureLabel(f);
    if (f.stage === "done") {
      steps.push({
        code: "next.archive",
        statement: `${label} is authored and verified — archive it to fold its deltas into the living docs, and everything waiting on it is released.`,
        command: `loam archive ${f.id} --dry-run --json`,
      });
      continue;
    }
    steps.push({
      code: "next.feature",
      statement:
        // The list, not the stage, is what this sentence names. `blocked` has
        // two causes now — another feature in flight, and an interrupted commit
        // that stalls the whole repository — and the second one names no
        // feature, so keying off the stage alone printed "FEAT-1 is waiting
        // on ." The recover step above already says what the repository is
        // waiting on.
        //
        // And never the bare stage word: "FEAT-1 is at 'ready'" over a feature
        // with nothing built read as ready to ship. `stageWords` is the one
        // place the human sentence for a stage lives (../feature/words.ts).
        f.stage === "blocked" && interrupted === null && f.blockedBy.length > 0
          ? `${label} is waiting on ${f.blockedBy.join(", ")}.`
          : `${label}: ${fleetStageWords(f, interrupted !== null)}.`,
      command: `loam status ${f.id} --json`,
    });
  }

  steps.push(...perServiceSteps(services, adoptedBinding));

  // Archived features whose done-check is still open, LAST of the substantive
  // steps: seen, because an archive is not where open claims should stop being
  // seen, but behind everything somebody can act on. The record is frozen —
  // `loam verify` refuses an archived feature — so the step reports rather than
  // asks, and its execution is a person's call (`../actions/execution.ts`).
  // Ahead of the adoption rungs it became next[0] of every quiet fleet, a
  // runnable `loam show` that changes nothing, and the documented "run next[0],
  // repeat" loop stalled on it. The step is the one `loam status <FEAT>` gives
  // the same feature, through one builder.
  for (const a of archived) steps.push(archivedStep(a.id, a.verification));

  // The archived steps past the cap are not counted into `next.elided`: its
  // sentence says "work down it and run status again", and there is no work in
  // them to get down to — `unverifiedArchived[]` beside this list carries
  // every one of them uncapped, as `serviceSteps[]` does the rungs.
  const left = steps.slice(FLEET_NEXT_LIMIT).filter((s) => s.code !== "next.archived");
  // Outside the cap, not merely first inside it: the one step that must never
  // be the one this list left out.
  const out = [...(interrupted === null ? [] : [recoverStep(interrupted)]), ...steps.slice(0, FLEET_NEXT_LIMIT)];
  if (left.length > 0) {
    // Which kinds, counted: "of the same kinds" told a reader nothing about
    // whether the feature they came for was among the missing.
    const kinds = [...new Set(left.map((s) => s.code))].map((code) => `${left.filter((s) => s.code === code).length} ${code}`);
    out.push({
      code: "next.elided",
      statement: `${left.length} more step(s) were left out (${kinds.join(", ")}) — this list is ordered most-unblocking first, so work down it and run status again.`,
      command: "loam list --json",
    });
  }

  // An archived feature's step is not outstanding WORK — nothing here can
  // discharge it — so it does not turn the clean answer into the gate one. It
  // did, and `next.fleet-clean` then never appeared again in a repository with
  // one feature archived before anybody used `loam verify`.
  out.push(
    steps.every((s) => s.code === "next.archived")
      ? {
          code: "next.fleet-clean",
          statement:
            "Nothing is in flight and every service is written down — keep the fleet green, then start the next feature.",
          command: "loam validate --all --json",
        }
      : {
          code: "next.fleet-gate",
          // `loam validate --all` inside the backticks, not the bare
          // `validate --all` this sentence carried for a year: a span without
          // the binary name is invisible to every check that reads a
          // backticked `loam <verb>` as an instruction — the parse check in
          // test/agent-commands-runnable.test.ts, and the statement/command
          // invariant in test/status.test.ts. A prefix is cheaper than an
          // exemption, and the exemption is what lets a wrong command through.
          statement:
            `${features.length} feature(s) in flight over ${services.length} service(s) — ` +
            "status grades none of them; `loam validate --all` is the gate this repository has to pass, and it is what CI runs.",
          command: "loam validate --all --json",
        },
  );
  return out;
}
