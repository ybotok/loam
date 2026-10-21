/**
 * The terminal view of a work packet.
 *
 * Two shapes for two readers. The whole packet is a person's orientation — how
 * much is open, filed under which service and which requirement, what each unit
 * asks them to DO, and which unit leads — so every row is an action rather than
 * the claim it answers, and the requirement's file is printed once over its
 * scenarios rather than on each of them. `--next` is the opposite: a single
 * leaf, printed in full, including the scenario's Given/When/Then VERBATIM,
 * because that text is the acceptance criterion and the exact words the digest
 * was taken over. Paraphrasing it into a summary is the one thing the digest
 * chain exists to prevent.
 *
 * Every row keeps its unit id. The id is what an agent hands `loam verify`, and
 * a view that dropped it to read better would turn the human listing into one
 * nobody can act on without a second, `--json`, run.
 *
 * Every `loam …` line printed here parses against the real CLI —
 * `test/agent-commands-runnable.test.ts` is the consumer, and an instruction
 * loam prints that does not parse is a defect rather than a typo.
 */
import type { WorkPacket } from "../../core/tasks/packet.js";
import type { RecordState } from "../../core/tasks/record.js";
import type { TaskStep, TaskUnit } from "../../core/tasks/unit.js";
import { actionOf, groupOf, type UnitGroup } from "./actions.js";

/** What the command knows and the packet does not: where the lens came from, and which repository this is. */
export interface TasksView {
  /** True when `--service` named the lens; false when it came from the binding, or there is none. */
  explicitLens: boolean;
  /** loam.json's `service` — set only when standing in a service repository. */
  bound: string | undefined;
}

/**
 * How many units one service shows in the WHOLE-feature view before the rest
 * are elided behind its own lens. Under a lens nothing is elided: the lens IS
 * the full listing, and pointing a person who already asked for one service at
 * `--json` to see the rest of it sent them to the one view not written for them.
 */
const PER_SERVICE_LIMIT = 12;

/** What each record state means for the list below it, in the words a reader acts on. */
const RECORD_MEANING: Record<RecordState, string> = {
  absent: "no verification record yet, so nothing counts as done",
  recorded: "the verification record answers this checklist; what it confirmed is off this list, bar attested scenarios",
  stale: "the verification record answers an older question set, so it closes nothing until it is re-recorded",
  unreadable: "the verification record could not be read, so it closes nothing",
};

/**
 * What the stamps reading means, which turns on WHERE loam is standing.
 *
 * The stamps are read from this repository's generated suite and nobody else's
 * (core/tasks/stamps.ts). So a scenario owned by another service reads
 * `implement` whatever its own repository holds — the packet's honest answer,
 * because nothing here looked — and the header says so whenever such a unit is
 * on screen, or a person reads "implement" as "the test exists".
 */
function stampsMeaning(packet: WorkPacket, view: TasksView): string {
  if (packet.stamps === "unknown") {
    return view.bound === undefined
      ? "this is not a service repository bound with loam.json, so loam cannot see which tests were generated — " +
          "run it in the service's repo to tell 'generate' from 'implement'"
      : `this repository's generated suite (${view.bound}) could not be read — an unreadable directory, ` +
          "or a gherkinDir outside the repository — so no scenario reads 'generate'";
  }
  const own = `from this repository's generated suite${view.bound === undefined ? "" : ` (${view.bound})`}`;
  const elsewhere = [
    ...new Set(packet.units.filter((unit) => unit.kind === "scenario.tested" && unit.subject !== view.bound).map((u) => u.subject)),
  ];
  if (elsewhere.length === 0) return own;
  const one = elsewhere.length === 1;
  return (
    `${own}; ${elsewhere.join(", ")} ${one ? "keeps its tests in its own repository" : "keep their tests in their own repositories"}, ` +
    `so ${one ? "its" : "their"} scenarios read 'implement' whatever is generated there — ` +
    `run loam tasks in ${one ? "that repository" : "those repositories"}`
  );
}

/** Which slice of the feature this is, and how to get another. */
function lensLine(packet: WorkPacket, view: TasksView): string {
  const lens = packet.service;
  if (lens !== null && view.explicitLens) return `lens: ${lens} — its units only, every one listed`;
  if (lens !== null) return `lens: ${lens} — this repository's service (loam.json); pass --service <id> for another`;
  const among = packet.services.length === 0 ? "" : ` (${packet.services.join(", ")})`;
  return view.bound === undefined
    ? `view: the whole feature${among} — --service <id> narrows it to one service`
    : `view: the whole feature${among} — this repository's service, ${view.bound}, is not one ${packet.feature} touches`;
}

/** The lines under the title both views share: what the record and the stamps MEAN, the lens, the blind spots. */
function header(packet: WorkPacket, view: TasksView): void {
  console.log(`  record: ${packet.record} — ${RECORD_MEANING[packet.record]}`);
  console.log(`  stamps: ${packet.stamps} — ${stampsMeaning(packet, view)}`);
  console.log(`  ${lensLine(packet, view)}`);
  // The blind spots straight after, and before any list: an empty packet over a
  // document nobody could read is the one output an implementer must never take
  // at face value, and a warning under fifty lines of units is one nobody reads.
  for (const warning of blindSpots(packet)) console.log(`  ⚠ ${warning}`);
}

/** The step tag, padded so the actions line up: `[implement]` is the widest. */
function tag(step: TaskStep): string {
  return `[${step}]`.padEnd("[implement]".length);
}

/** One row: the step, the action, the scenario's own line when it has one, and the id an agent hands on. */
function row(unit: TaskUnit, feature: string): string {
  const source = unit.source;
  const line = source !== undefined && "scenario" in source && source.line !== undefined ? ` · line ${source.line}` : "";
  return `      ${tag(unit.at)} ${actionOf(unit, feature)}${line} · ${unit.id}`;
}

/** Units filed under their heading, in the order the packet already sorted them — first appearance wins. */
function grouped(units: readonly TaskUnit[]): Array<UnitGroup & { units: TaskUnit[] }> {
  const groups = new Map<string, UnitGroup & { units: TaskUnit[] }>();
  for (const unit of units) {
    const group = groupOf(unit);
    const existing = groups.get(group.key);
    if (existing === undefined) groups.set(group.key, { ...group, units: [unit] });
    else existing.units.push(unit);
  }
  return [...groups.values()];
}

/** `9 open`, plus the attested ones when there are any — those are listed, and are not work. */
function tally(units: readonly TaskUnit[]): string {
  const attested = units.filter((unit) => unit.at === "attested").length;
  return `${units.length - attested} open${attested === 0 ? "" : ` · ${attested} attested`}`;
}

/** The `--next` invocation for this packet's own slice — the flag carried only when the reader typed it. */
function nextCommand(packet: WorkPacket, view: TasksView): string {
  const lens = view.explicitLens && packet.service !== null ? ` --service ${packet.service}` : "";
  return `loam tasks ${packet.feature}${lens} --next`;
}

/**
 * The frontier as a person reads it: the head's action first, then the ids.
 * A bare list of ten hashes said what to do to nobody; the ids stay, because
 * they are the order an orchestrator hands units out in.
 */
function frontierLines(packet: WorkPacket, view: TasksView): string[] {
  const headId = packet.frontier[0];
  if (headId === undefined) return [];
  const head = packet.units.find((unit) => unit.id === headId);
  const more = packet.frontierElided > 0 ? ` (+${packet.frontierElided} more open)` : "";
  return [
    head === undefined
      ? `  next up: ${headId}`
      : `  next up (${head.subject}): ${actionOf(head, packet.feature)} · ${headId}`,
    `    ${nextCommand(packet, view)} prints it in full, with what closes it`,
    `    frontier, the order to take open units in: ${packet.frontier.join(", ")}${more}`,
  ];
}

export function renderPacket(packet: WorkPacket, view: TasksView): void {
  // Attested is the one count whose word misleads: it reads like "done", and
  // it is the opposite — complete work resting on an assertion, still listed.
  const attested = packet.counts.attested === 0 ? "" : " (confirmed on an agent's word, not a run — still listed)";
  console.log(
    `${packet.feature} — ${packet.counts.open} open · ${packet.counts.done} done · ${packet.counts.attested} attested${attested}`,
  );
  header(packet, view);
  console.log("");

  if (packet.units.length === 0) {
    console.log(
      packet.counts.attested > 0 || packet.counts.done > 0
        ? "  Nothing open. Every unit is recorded confirmed, or attested and waiting on a run."
        : "  Nothing open — this feature's delta, specs and contracts promise nothing yet.",
    );
  }
  const capped = packet.service === null;
  for (const subject of new Set(packet.units.map((unit) => unit.subject))) {
    const units = packet.units.filter((unit) => unit.subject === subject);
    const shown = capped ? units.slice(0, PER_SERVICE_LIMIT) : units;
    console.log(`  ${subject} — ${tally(units)}`);
    for (const group of grouped(shown)) {
      console.log(`    ${group.heading}`);
      for (const unit of group.units) console.log(row(unit, packet.feature));
    }
    if (shown.length < units.length) {
      console.log(
        `    +${units.length - shown.length} more — \`loam tasks ${packet.feature} --service ${subject}\` lists every one`,
      );
    }
    console.log("");
  }

  for (const line of frontierLines(packet, view)) console.log(line);
  for (const waiting of packet.waitingOn ?? []) {
    console.log(`  waiting on ${waiting.subject}: ${waiting.claim} · ${waiting.id}, still open there`);
  }
  if (packet.units.length > 0) {
    console.log(
      "\n  [step] is where a unit waits: describe → generate → implement, or attested. " +
        "`loam explain <word>` defines each of those, and frontier.",
    );
  }
  console.log("\n  Review:");
  for (const note of packet.review) console.log(`    - ${note}`);
}

/**
 * The leaf, in full. The follow-up command is literal rather than a shape to
 * fill in, because the reader is usually a model cheap enough that "the
 * appropriate verify invocation" is a guess it will get wrong.
 */
export function renderNext(packet: WorkPacket, view: TasksView): void {
  const unit = packet.units[0];
  if (unit === undefined) {
    console.log(`${packet.feature} — nothing open (${packet.counts.done} done · ${packet.counts.attested} attested)`);
    header(packet, view);
    return;
  }
  console.log(`${packet.feature} — next: ${unit.id}`);
  console.log(`  ${actionOf(unit, packet.feature)}`);
  // The lens only when the binding chose it: a reader who typed --service knows
  // which slice this is, and one who did not would otherwise be handed another
  // service's head with no word on why it is this one.
  if (packet.service !== null && !view.explicitLens) console.log(`  ${lensLine(packet, view)}`);
  for (const warning of blindSpots(packet)) console.log(`  ⚠ ${warning}`);
  const ungraded = ungradedScenario(packet, view, unit);
  if (ungraded !== undefined) console.log(`  ⚠ ${ungraded}`);
  console.log("");
  console.log(`  [${unit.at}] ${unit.kind}  [${unit.subject}]`);
  console.log(`  ${unit.claim}`);
  const source = unit.source;
  if (source !== undefined) {
    console.log(`  ${source.path}${source.line === undefined ? "" : `:${source.line}`}`);
    // Verbatim, never reflowed: these are the bytes the scenario digest was
    // taken over, and a test written from reworded criteria answers a claim
    // nobody made.
    if ("lines" in source) for (const body of source.lines) console.log(`    ${body}`);
  }
  if (unit.dependsOn.length > 0) console.log(`  depends on: ${unit.dependsOn.join(", ")}`);
  console.log(`\n  done: ${unit.done.check}`);
  console.log(`\n  ${followUp(packet.feature, unit)}`);
}

/**
 * The caveat a scenario at `implement` needs when nobody looked for its
 * generated test: `implement` is also what a scenario reads when the stamps
 * could not be read, or belong to another repository, and handing a worker
 * "make it pass" for a test that was never generated sends them to write one by
 * hand — the paraphrase the generated suite exists to prevent.
 */
function ungradedScenario(packet: WorkPacket, view: TasksView, unit: TaskUnit): string | undefined {
  if (unit.kind !== "scenario.tested" || unit.at !== "implement") return undefined;
  if (packet.stamps === "read" && unit.subject === view.bound) return undefined;
  if (unit.subject === view.bound) {
    return (
      "whether this scenario's test was generated is unknown — this repository's generated suite could not be read; " +
      `if loam gherkin ${packet.feature} has not run here, run it first`
    );
  }
  return (
    `whether this scenario's test was generated is unknown here — its suite lives in ${unit.subject}'s repository; ` +
    `run loam tasks there, or loam gherkin ${packet.feature} there first if it has not run`
  );
}

/**
 * The command that closes this unit.
 *
 * A `describe` unit is the one arm that is NOT a `loam verify --record`: there
 * is no claim to answer, because a requirement with no scenario asks no
 * question — the work is writing the Given/When/Then into the file named above,
 * and `loam validate --feature` is what grades that it landed. Pointing it at
 * `--record` would invite an answer to a question the checklist does not carry.
 */
function followUp(feature: string, unit: TaskUnit): string {
  if (unit.at === "describe") return `loam validate --feature ${feature}`;
  if (unit.at === "generate") return `loam gherkin ${feature}`;
  if (unit.kind === "scenario.tested") {
    return `loam verify ${feature} --service ${unit.subject} --results report.json`;
  }
  return `loam verify ${feature} --record answers.json --service ${unit.subject}`;
}

/** What the packet could not look at — one sentence per document class. */
function blindSpots(packet: WorkPacket): string[] {
  const out: string[] = [];
  if (packet.unreadable.architecture !== undefined) {
    out.push(
      `delta.likec4 does not parse (${packet.unreadable.architecture}) — no c4.calls unit could be derived, ` +
        "so this list is short because loam could not look, not because the work is done",
    );
  }
  const contracts = packet.unreadable.contracts;
  if (contracts !== undefined) {
    out.push(
      `contract delta unreadable for ${contracts.join(", ")} — operations and messages are missing from this packet, ` +
        "not absent from the feature",
    );
  }
  return out;
}
