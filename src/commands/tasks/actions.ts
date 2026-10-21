/**
 * A unit said as something a person does, and the heading it is filed under.
 *
 * The packet's `claim` is the QUESTION `loam verify` asks — "scenario 'X' of
 * requirement 'Y' (svc) is covered by a test" — and a list of questions reads as
 * a claim ledger rather than a to-do list: the step a unit waits at used to be a
 * bracketed tag in front of a sentence that never changed with it. Here the step
 * and the kind together pick the verb, so a unit at `generate` says "generate
 * the test" and the same scenario at `implement` says "make it pass". The claim
 * stays on the payload and in `--next`, verbatim; this is a rendering, and
 * nothing ever reads it back.
 *
 * Two facts the phrasing wants live only in the claim's prose — which way an
 * event.declares message goes, and which service a c4.calls edge lands on:
 * `featureChecklist` (core/verify/checklist.ts) spells both into the sentence
 * and carries neither as a field. They are read out of the prose for DISPLAY
 * only, and a reworded claim falls back to the claim itself, which is always
 * true: no join key, count or verdict comes from here, which is the line
 * `Claim.operation`'s docblock draws against parsing claim prose.
 */
import type { TaskUnit } from "../../core/tasks/unit.js";

/** The scenario's own name, when the packet found the words the claim was minted from. */
function scenarioOf(unit: TaskUnit): string | undefined {
  const source = unit.source;
  return source !== undefined && "scenario" in source ? source.scenario : undefined;
}

/**
 * A scenario action, with the claim appended when the name is missing. A
 * scenario unit has no source only when the digest belt in core/tasks/packet.ts
 * refused somebody else's words — rare, and then "make it pass" alone would be
 * an instruction about nothing in particular.
 */
function aboutScenario(unit: TaskUnit, phrase: (what: string) => string): string {
  const name = scenarioOf(unit);
  return name === undefined ? `${phrase("it")}: ${unit.claim}` : phrase(`scenario '${name}'`);
}

/** `sends` or `receives`, out of the claim's prose — display only, see the header. */
const DIRECTION = / declares it (sends|receives) message /;

/** The provider at the end of `<from> calls '<op>' on <to>` — display only, see the header. */
const CALLEE = / on (\S+)$/;

/** What a unit waiting at `implement` asks for, by kind. */
function implementAction(unit: TaskUnit): string {
  switch (unit.kind) {
    case "scenario.tested":
      return aboutScenario(unit, (what) => `make ${what} pass, then record the run`);
    case "api.exposes":
      // Named because its channel is the unusual one: its done check asks for
      // a contract-test report (`--contract-results`), not a cucumber run.
      return unit.operation === undefined
        ? unit.claim
        : `expose operation '${unit.operation}' (contract-test evidence closes it)`;
    case "event.declares": {
      const direction = DIRECTION.exec(unit.claim)?.[1];
      if (unit.token === undefined || direction === undefined) return unit.claim;
      return `${direction === "sends" ? "send" : "receive"} message '${unit.token}'`;
    }
    case "c4.calls": {
      const callee = CALLEE.exec(unit.claim)?.[1];
      if (unit.token === undefined || callee === undefined) return unit.claim;
      return `call '${unit.token}' on ${callee}`;
    }
    case "service.exists":
      return `create service '${unit.subject}'`;
    default:
      // A kind added to the vocabulary after this was written still prints
      // something true rather than nothing.
      return unit.claim;
  }
}

/**
 * The unit as an action. `feature` is spelled into the one arm that names a
 * command, because a reader handed "run the generator" with no id has to go and
 * find out which feature they are looking at.
 */
export function actionOf(unit: TaskUnit, feature: string): string {
  switch (unit.at) {
    case "describe":
      return unit.source === undefined
        ? unit.claim
        : `write the scenarios for requirement '${unit.source.requirement}' — at least one Given/When/Then, in the docs repo`;
    case "generate":
      return aboutScenario(unit, (what) => `generate the test for ${what} (loam gherkin ${feature})`);
    case "attested":
      return aboutScenario(unit, (what) => `re-answer ${what} from a test run — it rests on an agent's word`);
    case "implement":
      return implementAction(unit);
    default: {
      const unreachable: never = unit.at;
      return unreachable;
    }
  }
}

/** The kinds a contract delta promises — openapi.yaml and asyncapi.yaml. */
const CONTRACT_KINDS: ReadonlySet<string> = new Set(["api.exposes", "event.declares"]);

/** The kinds delta.likec4 promises — a service drawn, an edge between two. */
const ARCHITECTURE_KINDS: ReadonlySet<string> = new Set(["service.exists", "c4.calls"]);

export interface UnitGroup {
  /** What makes two units one group: the same document and the same requirement in it. */
  key: string;
  heading: string;
}

/**
 * The heading a unit is filed under inside its service.
 *
 * A requirement's units sit under the requirement, which is where a person
 * opens the file — and the path is printed ONCE there rather than on every
 * row, which is most of what made the old view unreadable. The key carries the
 * path as well as the requirement: one name may legitimately appear on both
 * axes (`spec.md` and `arch.spec.md`), and those are two requirements.
 *
 * A describe unit's line IS the requirement heading's, so it rides on the
 * heading; a scenario's line is its own and is printed on its row.
 */
export function groupOf(unit: TaskUnit): UnitGroup {
  if (CONTRACT_KINDS.has(unit.kind)) return { key: "contract", heading: "contract — operations and messages" };
  if (ARCHITECTURE_KINDS.has(unit.kind)) return { key: "architecture", heading: "architecture — delta.likec4" };
  const source = unit.source;
  if (source === undefined) {
    return { key: "unplaced", heading: "scenarios loam could not match to their words — each row quotes its claim" };
  }
  const label = source.path.endsWith("arch.spec.md") ? "arch requirement" : "requirement";
  const id = source.requirementId === undefined ? "" : ` [${source.requirementId}]`;
  const line = unit.at === "describe" && source.line !== undefined ? `:${source.line}` : "";
  return {
    key: ["requirement", source.path, source.requirementId ?? "", source.requirement].join("\0"),
    heading: `${label} '${source.requirement}'${id} — ${source.path}${line}`,
  };
}
