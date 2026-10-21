/**
 * The fleet's `next` list, as a person reads it.
 *
 * `next[]` is capped at ten for the reason core/status/fleet/next.ts records,
 * and its per-service rungs are one step per service — so on a fleet
 * mid-adoption the human list was ten copies of "services/x/ has no spec.md"
 * and a "more step(s) of the same kinds" line, with the one feature anybody
 * was working on somewhere past the fold. The JSON keeps every step it had (an
 * agent branches per step); this view folds each per-service code into ONE
 * counted line from the uncapped `serviceSteps`, so adoption debt reads as the
 * backlog it is, under the features, with its size stated.
 */
import type { FleetStatusReport, NextStep } from "../../core/status/report.js";

/** How many services a folded line names before it says "+N more". */
const NAMED = 6;

/** What a folded line says about each per-service code, after the count; anything unlisted falls back to its code. */
const SAY: Record<string, string> = {
  "next.adopt": "with no spec.md — nothing written down yet; adopt each",
  "next.complete-service": "with a spec.md and no model.likec4 — the fleet gate reports each incomplete until something models it",
  "next.revouch": "whose documents changed after the vouch — a person re-reads each and re-vouches it from its own repository",
};

/** `12 services with no spec.md …: a, b, c, +9 more.` */
function foldedLine(group: { code: string; services: string[] }): string {
  const n = group.services.length;
  const shown = group.services.slice(0, NAMED).join(", ");
  const names = n > NAMED ? `${shown}, +${n - NAMED} more` : shown;
  return `${n} service${n === 1 ? "" : "s"} ${SAY[group.code] ?? `owing ${group.code}`}: ${names}.`;
}

export function printFleetNext(r: FleetStatusReport): void {
  const folded = new Map(r.serviceSteps.map((group) => [group.code, group]));
  const printed = new Set<string>();
  const lines: Array<{ code: string; statement: string; command: string }> = [];
  const add = (step: Pick<NextStep, "code" | "statement" | "command">): void => {
    lines.push({ code: step.code, statement: step.statement, command: step.command });
  };

  // A feature step can only be missing from the capped list when more than the
  // cap is in flight — the table above still names every one of them.
  const featureSteps = r.next.filter((s) => s.code === "next.feature" || s.code === "next.archive").length;
  const hiddenFeatures = Math.max(0, r.features.length - featureSteps);

  for (const step of r.next) {
    const group = step.service === undefined ? undefined : folded.get(step.code);
    if (group !== undefined) {
      // A code one service owes prints as that service's own step; a code
      // several owe prints once, counted, where its first step stood.
      if (group.services.length === 1) add(step);
      else if (!printed.has(group.code)) {
        add({
          code: `${group.code} ×${group.services.length}`,
          statement:
            `${foldedLine(group)} ` +
            "The command is the first of them; `loam list services` shows every service.",
          command: group.command,
        });
      }
      printed.add(group.code);
      continue;
    }
    if (step.code === "next.elided") {
      // Every elided per-service rung is already counted in a folded line; only
      // features past the cap remain unnamed in this list.
      if (hiddenFeatures > 0) {
        add({
          code: step.code,
          statement: `${hiddenFeatures} more feature(s) in flight are not in this list — the features table above names them all.`,
          command: step.command,
        });
      }
      continue;
    }
    add(step);
  }

  // Groups whose every step fell past the cap still print — the cap exists to
  // keep the list short, and one counted line per code is already short. They
  // go just above the gate entry, which always closes the list.
  const gate = lines.length > 0 && /^next\.fleet-(gate|clean)$/.test(lines[lines.length - 1]!.code) ? lines.pop() : undefined;
  for (const group of r.serviceSteps) {
    if (printed.has(group.code)) continue;
    add({
      code: group.services.length === 1 ? group.code : `${group.code} ×${group.services.length}`,
      statement: foldedLine(group),
      command: group.command,
    });
  }
  if (gate !== undefined) lines.push(gate);

  printNext(lines);
}

/**
 * The steps, numbered, with the command on its own indented line — doctor's
 * layout, for doctor's reason: what to do and what to type are two different
 * sentences, and someone scanning a half-built feature reads down the `run:`
 * column. Here rather than in ./print.ts, which imports this module: the
 * feature view and the folded fleet list print through the one layout.
 */
export function printNext(steps: ReadonlyArray<Pick<NextStep, "code" | "statement" | "command">>): void {
  console.log("\n  next");
  for (const [i, step] of steps.entries()) {
    console.log(`    ${i + 1}. ${step.code}: ${step.statement}`);
    console.log(`       run: ${step.command}`);
  }
}
