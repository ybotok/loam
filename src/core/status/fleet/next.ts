/**
 * `next[]` — the whole repository: adoption gaps first, then every feature in
 * flight, most-unblocking first, capped so the list stays navigation rather
 * than inventory.
 */
import type { DependencyGraph } from "../../dependencies/facts.js";
import { serviceTreePath } from "../../kernel/ids/dirs.js";
import { compareIds, type ServiceEntry } from "../../repo/entries.js";
import { recoverStep } from "../interrupted.js";
import {
  undocumented,
  type ArtifactStatus,
  type FleetFeatureState,
  type InterruptedCommit,
  type NextStep,
} from "../report.js";

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
 * Fleet-level steps, most-unblocking first. A feature ready to ship comes
 * before one that still needs authoring, because archiving it is what releases
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
}

export function fleetNext(fleet: Fleet, binding: Binding | null): NextStep[] {
  const { services, features, graph, interrupted, teaching } = fleet;
  const steps: NextStep[] = [];
  // The two arms of the binding, each named for the question it answers. The
  // first reproduces the old parameter exactly, so everything reading it below
  // is unchanged; the second is the fact that used to be thrown away.
  const unadoptedBinding = binding !== null && !binding.adopted ? binding.id : null;
  const adoptedBinding = binding !== null && binding.adopted ? binding.id : null;

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
  if (unadoptedBinding !== null) {
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
              "State the facts in a fleet.yaml (service ids, `a -> b` calls) and run " +
              "`loam seed --from fleet.yaml` to template the map mechanically — or open the file " +
              "and follow its own comments. Either way loam never guesses who calls whom.",
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
          "here and --service at its canonical id, then commit the loam.json it writes.",
        command: "loam init --docs <path-to-this-docs-repo> --service <service-id>",
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

  // The per-service rungs are collected into their own list rather than pushed
  // straight onto `steps`, because the partition below acts on them as a group
  // — and only on them. Nothing here may float above `next.adopt-bound` or the
  // first-hour ladder, both of which are about the repository rather than about
  // any one service in the fleet.
  const perService: NextStep[] = [];
  for (const s of services.filter(undocumented)) {
    perService.push({
      code: "next.adopt",
      statement: `${serviceTreePath(s)}/ has no spec.md — nothing about ${s.id} is written down, so no feature can be graded against it.`,
      command: `loam adopt --service ${s.id} --json`,
      service: s.id,
    });
  }

  // Adoption does not end at spec.md. A service with a living spec and no
  // model.likec4 is the state archive itself warns about (`service.no-model`)
  // and the fleet gate reports — invisible here until now, because this form
  // looked at exactly one bit of each service's artifact set.
  for (const s of services.filter((x) => !undocumented(x) && !x.has.model)) {
    perService.push({
      code: "next.complete-service",
      statement: `${serviceTreePath(s)}/ has a spec.md but no model.likec4 — the fleet gate reports the service incomplete until something models it.`,
      command: `loam validate --service ${s.id} --json`,
      service: s.id,
    });
  }

  // The boundary this repository IS comes first among the boundaries it merely
  // shares a fleet with. A stable PARTITION and deliberately not a sort: the
  // bound service's rungs move to the front and every other service keeps the
  // alphabetical order it already had, so the list an unbound reader sees — a
  // docs repo, CI, `loam validate --all`'s scorecard — is byte-for-byte the one
  // it saw before.
  //
  // The cap is why this is ordering and not cosmetics. Ten rungs print, and in
  // the ten-repo case WORKFLOW.md describes every developer's `loam status`
  // opened with nine other services' adoption work; past ten services the one
  // rung this developer can actually act on was elided entirely, leaving a list
  // of nothing but other people's boundaries under the heading "next". No new
  // code is emitted for any of this — `next[]` has always been documented as
  // most-unblocking first, and this is the line that makes the claim true from
  // where the reader is standing.
  steps.push(
    ...(adoptedBinding === null
      ? perService
      : [
          ...perService.filter((s) => s.service === adoptedBinding),
          ...perService.filter((s) => s.service !== adoptedBinding),
        ]),
  );

  const ordered = [...features].sort(
    (a, b) =>
      STAGE_RANK[a.stage] - STAGE_RANK[b.stage] ||
      graph.order.indexOf(a.id) - graph.order.indexOf(b.id) ||
      compareIds(a.id, b.id),
  );
  for (const f of ordered) {
    if (f.stage === "done") {
      steps.push({
        code: "next.archive",
        statement: `${f.id} is authored and verified — ship it, and everything waiting on it is released.`,
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
        f.stage === "blocked" && f.blockedBy.length > 0
          ? `${f.id} is waiting on ${f.blockedBy.join(", ")}.`
          : `${f.id} is at '${f.stage}'${f.missing.length > 0 ? ` — missing ${f.missing.join(", ")}` : ""}.`,
      command: `loam status ${f.id} --json`,
    });
  }

  const elided = Math.max(0, steps.length - FLEET_NEXT_LIMIT);
  // Outside the cap, not merely first inside it: the one step that must never
  // be the one this list left out.
  const out = [...(interrupted === null ? [] : [recoverStep(interrupted)]), ...steps.slice(0, FLEET_NEXT_LIMIT)];
  if (elided > 0) {
    out.push({
      code: "next.elided",
      statement: `${elided} more step(s) of the same kinds were left out — this list is ordered most-unblocking first, so work down it and run status again.`,
      command: "loam list --json",
    });
  }

  out.push(
    steps.length === 0
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
