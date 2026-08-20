/**
 * `loam flow env [group]` — the participant union of a suite, as machine
 * output: WHICH SERVICES MUST BE UP for a group's flows to run.
 *
 * This is the answer a fleet maintains by hand today — a compose file, a CI
 * matrix, a paragraph in a runbook — and it is derivable, because a journey
 * already names every participant it touches and the fleet map already says
 * which `services/<id>/` each of those elements stands for. Deriving it means
 * it cannot drift from the journeys: add a service to a flow and the
 * environment its suite needs changes in the same commit.
 *
 * ONE SHAPE, always `groups[]`, whether or not a group was named. A payload
 * that changed shape with the argument would make every consumer branch before
 * it can read anything, and naming a group is a FILTER over the same answer,
 * not a different question.
 *
 * Unresolved participants are carried, never dropped — `core/flows/groups.ts`
 * says why at length: a silently shorter list is the one failure mode invisible
 * from the output itself. A journey in NO group is the same failure one level
 * up — every line below is per-group, so an unsuited journey is missing from
 * all of them — and `./render.ts` is the sentence that closes it.
 */
import { emitJson, fail } from "../../core/envelope/json.js";
import { groupEnvironments, ungroupedFlows, type GroupEnvironment } from "../../core/flows/groups.js";
import { flowErrorLine, readFlowState } from "../../core/flows/project.js";
import type { DocsDir } from "../../core/kernel/ids/dirs.js";
import { listServices } from "../../core/repo/repo.js";
import { printUngrouped } from "./render.js";

export async function runEnv(docsDir: DocsDir, group: string | undefined, json: boolean): Promise<void> {
  const state = await readFlowState(docsDir);
  if (state.errors.length > 0) {
    fail(
      json,
      "flow-invalid",
      `${state.errors.length} error(s) in the LikeC4 document(s) the flows are read from ` +
        "(architecture/flows/ and the fleet map beside it) — an environment derived from a journey nobody " +
        "can read would be missing whatever the unreadable document names, and a short environment list is " +
        "exactly the answer this command exists to stop being wrong:\n" +
        state.errors.map((err) => `  ${flowErrorLine(docsDir, err)}`).join("\n"),
    );
    return;
  }
  const known: ReadonlySet<string> = new Set((await listServices(docsDir)).map((entry) => entry.id));
  const all = groupEnvironments(state.groups, state.elements, known);
  const environments = group === undefined ? all : all.filter((env) => env.group === group);
  if (group !== undefined && environments.length === 0) {
    fail(
      json,
      "unknown-target",
      `No flow group '${group}'.` +
        (all.length === 0
          ? " No flow under architecture/flows/ declares a group tag yet."
          : ` Declared groups: ${all.map((env) => env.group).join(", ")}.`),
    );
    return;
  }
  // UNFILTERED, even when a group was named, and both views agree about that.
  // Which journeys reached no suite is a fact about the fleet's flows, not
  // about the suite being asked after — filtering it by the argument would make
  // `flow env smoke` claim every journey is suited whenever the smoke one is.
  const ungrouped = ungroupedFlows(state.flows);
  if (json) {
    emitJson({ groups: environments, journeys: state.flows.length, ungrouped });
    return;
  }
  print(environments);
  printUngrouped(ungrouped, state.flows.length);
}

/**
 * `environments` is empty here only when NO group was named — a named group
 * that matches nothing was already refused above as `unknown-target`, which is
 * why this says "none exist" rather than branching on the argument.
 */
function print(environments: GroupEnvironment[]): void {
  if (environments.length === 0) {
    console.log("no flow groups — no flow under architecture/flows/ carries a group tag.");
    return;
  }
  for (const [i, env] of environments.entries()) {
    if (i > 0) console.log("");
    console.log(
      `group ${env.group} — ${env.flows.length} flow(s), ${env.services.length} service(s) must be up`,
    );
    for (const service of env.services) console.log(`  ${service}`);
    for (const missing of env.unresolved) {
      // Named on its own line with a marker rather than folded into the list:
      // a participant that resolves to no directory is not a service somebody
      // can start, and reading it as one is how an environment comes up short.
      console.log(
        `  ! ${missing.participant} — no services/${missing.service}/` +
          (missing.external ? " (#external: bring a double, not a directory)" : ""),
      );
    }
    console.log(`  flows: ${env.flows.join(", ")}`);
  }
}
