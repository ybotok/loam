/**
 * Where one service stands on the adoption ladder, as the fleet form of
 * `loam status` asks it. Two predicates, beside the only two modules that read
 * them (`./fleet.ts`, `./next.ts`); they lived in `../report.ts` among the
 * report's types, which is where the feature report's shape needed the room.
 * And the fold of the rungs into `serviceSteps`, moved here from `./next.ts`
 * when the archived features' steps took that file to its line limit.
 */
import type { ServiceEntry } from "../../repo/entries.js";
import type { NextStep } from "../report.js";

/** Nothing is written down: no living spec at all. Every other absence is partial adoption. */
export function undocumented(s: ServiceEntry): boolean {
  return !s.has.spec;
}

/** A person stamped it — `loam vouch`'s exact postcondition, read back off the frontmatter. */
export function vouched(s: ServiceEntry): boolean {
  return s.status === "verified" && s.sources.stamped;
}

/**
 * `perServiceSteps` grouped by code, in first-appearance order — the
 * `serviceSteps` payload. `command` is the FIRST service's step command, so a
 * reader folding forty rungs into one line still gets a literal to run rather
 * than a second spelling of it.
 */
export function groupServiceSteps(steps: NextStep[]): Array<{ code: string; services: string[]; command: string }> {
  const groups = new Map<string, { code: string; services: string[]; command: string }>();
  for (const step of steps) {
    if (step.service === undefined) continue;
    const group = groups.get(step.code) ?? { code: step.code, services: [], command: step.command };
    group.services.push(step.service);
    groups.set(step.code, group);
  }
  return [...groups.values()];
}
