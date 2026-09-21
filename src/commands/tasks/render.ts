/**
 * The terminal view of a work packet.
 *
 * Two shapes for two readers. The whole packet is a person's orientation — how
 * much is open, filed under which service, and which ten units lead — so it is
 * capped per service and never prints a claim twice. `--next` is the opposite: a
 * single leaf, printed in full, including the scenario's Given/When/Then
 * VERBATIM, because that text is the acceptance criterion and the exact words
 * the digest was taken over. Paraphrasing it into a summary is the one thing the
 * digest chain exists to prevent.
 *
 * Every `loam …` line printed here parses against the real CLI —
 * `test/agent-commands-runnable.test.ts` is the consumer, and an instruction
 * loam prints that does not parse is a defect rather than a typo.
 */
import type { WorkPacket } from "../../core/tasks/packet.js";
import type { TaskUnit } from "../../core/tasks/unit.js";

/** How many units one service shows before the rest are elided behind its own lens. */
const PER_SERVICE_LIMIT = 12;

/** `path:line`, or just the path — a source with no line is still worth opening. */
function at(unit: TaskUnit): string {
  const source = unit.source;
  if (source === undefined) return "";
  return source.line === undefined ? ` (${source.path})` : ` (${source.path}:${source.line})`;
}

function line(unit: TaskUnit): string {
  return `    [${unit.at}] ${unit.kind}  ${unit.claim}${at(unit)}`;
}

export function renderPacket(packet: WorkPacket): void {
  console.log(
    `${packet.feature} — ${packet.counts.open} open · ${packet.counts.done} done · ${packet.counts.attested} attested`,
  );
  console.log(`  record: ${packet.record} · stamps: ${packet.stamps}${packet.service === null ? "" : ` · lens: ${packet.service}`}`);
  // The blind spots FIRST, and before any list: an empty packet over a document
  // nobody could read is the one output an implementer must never take at face
  // value, and a warning under fifty lines of units is a warning nobody reads.
  for (const warning of blindSpots(packet)) console.log(`  ⚠ ${warning}`);
  console.log("");

  const subjects = [...new Set(packet.units.map((unit) => unit.subject))];
  if (packet.units.length === 0) {
    console.log(
      packet.counts.attested > 0 || packet.counts.done > 0
        ? "  Nothing open. Every unit is recorded confirmed, or attested and waiting on a run."
        : "  Nothing open — this feature's delta, specs and contracts promise nothing yet.",
    );
  }
  for (const subject of subjects) {
    const units = packet.units.filter((unit) => unit.subject === subject);
    console.log(`  ${subject}`);
    for (const unit of units.slice(0, PER_SERVICE_LIMIT)) console.log(line(unit));
    if (units.length > PER_SERVICE_LIMIT) {
      console.log(
        `    +${units.length - PER_SERVICE_LIMIT} more — loam tasks ${packet.feature} --service ${subject} --json`,
      );
    }
    console.log("");
  }

  if (packet.frontier.length > 0) {
    console.log(`  frontier: ${packet.frontier.join(", ")}${packet.frontierElided > 0 ? ` (+${packet.frontierElided})` : ""}`);
  }
  for (const waiting of packet.waitingOn ?? []) {
    console.log(`  waiting on ${waiting.subject}: ${waiting.id}  ${waiting.claim}`);
  }
  console.log("\n  Review:");
  for (const note of packet.review) console.log(`    - ${note}`);
}

/**
 * The leaf, in full. The follow-up command is literal rather than a shape to
 * fill in, because the reader is usually a model cheap enough that "the
 * appropriate verify invocation" is a guess it will get wrong.
 */
export function renderNext(packet: WorkPacket): void {
  const unit = packet.units[0];
  if (unit === undefined) {
    console.log(`${packet.feature} — nothing open (${packet.counts.done} done · ${packet.counts.attested} attested)`);
    console.log(`  record: ${packet.record} · stamps: ${packet.stamps}`);
    for (const warning of blindSpots(packet)) console.log(`  ⚠ ${warning}`);
    return;
  }
  console.log(`${packet.feature} — next: ${unit.id}`);
  for (const warning of blindSpots(packet)) console.log(`  ⚠ ${warning}`);
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
