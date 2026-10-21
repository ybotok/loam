/**
 * The done-check terms: what `loam verify` asks (a claim, and the five kinds
 * of one), and what the answer is worth (the verdicts).
 *
 * One entry per claim kind rather than one `claim` entry with the kinds as
 * aliases, because the kinds differ in exactly the fact a reader looks one up
 * for: WHO may answer it. A `scenario.tested` claim is a test runner's, an
 * `api.exposes` claim may be a contract suite's, and the other three are
 * answered from the code — a single paragraph listing all five would answer
 * `loam explain c4.calls` with four sentences about something else. Each kind
 * is pinned to its own line of the /loam-verify body, which is where the
 * binary already teaches "what to open" one kind at a time.
 *
 * `attested` moved here from the old flat registry with its paragraph and
 * pins intact, and gained a sentence and a pin of its own: `loam tasks` prints
 * the same word as the fourth step a unit waits at, and the two meanings are
 * one fact seen from two commands, so one entry answers both rather than two
 * entries competing for one name.
 */
import type { TermGroup } from "./entry.js";

export const DONE_CHECK_TERMS: TermGroup = {
  heading: "the done-check — what `loam verify` asks, and what an answer is worth",
  terms: [
    {
      term: "claim",
      aliases: ["claims", "checklist", "confirmed", "unconfirmed", "unanswered"],
      paragraph:
        "A claim is one question on the done-check's checklist: a promise the feature's documents make about code. " +
        "loam asks it so that evidence, not prose, can answer it. " +
        "`loam verify <FEAT>` derives a checklist from the feature's own artifacts: one claim per new service " +
        "(`service.exists`), per operation the contract delta adds (`api.exposes`), per message the event contract " +
        "newly declares (`event.declares`), per tagged edge that names an operation (`c4.calls`), and per scenario of " +
        "every changed requirement (`scenario.tested`) — `loam explain <kind>` says what each one asks and who may answer it. " +
        "Each claim has a stable id, so two runs are diffable and an answer cannot drift onto a different question; " +
        "`loam tasks` uses the same id for the unit that closes it. " +
        "An answer is `confirmed` with `file:line` evidence or `unconfirmed` with a note saying why — a successful " +
        "record either way — and a claim nobody answered is `unanswered`. Every recorded answer says who gave it " +
        "(`answered_by: runner | external-runner | agent`), and that is what separates **verified** from **attested**.",
      pins: [
        { source: "DONE_CHECK", phrase: "`loam verify <FEAT>` derives a checklist from the feature's own artifacts" },
        { source: "DONE_CHECK", phrase: "Each claim has a stable id, so" },
        { source: "DONE_CHECK", phrase: "two runs are diffable and an answer cannot drift onto a different question" },
        { source: "DONE_CHECK", phrase: "`answered_by: runner | external-runner | agent`" },
      ],
    },
    {
      term: "service.exists",
      aliases: [],
      paragraph:
        "A `service.exists` claim asks whether a service the feature introduces has actually been built. " +
        "`loam verify` derives one per new service the feature's delta.likec4 adds to the fleet map. " +
        "Answer it by finding it in the code, not by reasoning that it must be there. What to open: " +
        "`service.exists` — the service is deployable: its build, its entry point. " +
        "The answer is `file:line` evidence, recorded from that service's own repository with " +
        "`loam verify <FEAT> --service <id> --record answers.json`. No test runner answers this kind, so an agent's " +
        "word is the expected answer here, and it never makes the verdict **attested** — only scenario claims do.",
      pins: [{ source: "VERIFY", phrase: "`service.exists` — the service is deployable: its build, its entry point." }],
    },
    {
      term: "api.exposes",
      aliases: [],
      paragraph:
        "An `api.exposes` claim asks whether the service really serves an operation the feature's contract delta adds. " +
        "`loam verify` derives one per operationId in the feature's openapi.yaml that the living contract does not " +
        "already define; an operation the delta merely restates is never asked about. " +
        "What to open: `api.exposes` — the route handler serving that operationId, not the spec that declares it. " +
        "It also has a mechanical channel: an API contract-test run, passed back in loam's contract-results shape with " +
        "`loam verify <FEAT> --contract-results contract.json`, answers it as `answered_by: external-runner`. " +
        "In `loam tasks`, a `c4.calls` unit depends on the `api.exposes` unit that promises the operation it calls.",
      pins: [
        { source: "VERIFY", phrase: "`api.exposes` — the route handler serving that operationId, not the spec that" },
        { source: "DONE_CHECK", phrase: "`loam verify <FEAT> --contract-results contract.json`" },
      ],
    },
    {
      term: "event.declares",
      aliases: [],
      paragraph:
        "An `event.declares` claim asks whether the service sends or receives a message the feature's event contract " +
        "newly declares. " +
        "For a feature, `loam verify` derives one per (direction, message) its asyncapi delta newly declares against the " +
        "living contract's send/receive sets — quotes and removals are never questions. " +
        "What to open: `event.declares` — the code that puts the message on the wire (sends) or handles it off the " +
        "wire (receives), not the contract that names it. " +
        "It is answered with `file:line` evidence through `loam verify <FEAT> --service <id> --record answers.json`.",
      pins: [
        { source: "VERIFY", phrase: "`event.declares` — the code that puts the message on the wire (sends) or" },
        { source: "VERIFY", phrase: "per (direction, message) its asyncapi delta newly declares against the living" },
      ],
    },
    {
      term: "c4.calls",
      aliases: [],
      paragraph:
        "A `c4.calls` claim asks whether a call the feature draws on the architecture really exists in the caller's code. " +
        "`loam verify` derives one per edge in delta.likec4 that is tagged with the feature and names an operation " +
        "(`metadata { op '<operationId>' }`); an untagged edge is context, and an edge with no operation names nothing " +
        "specific enough to look for. " +
        "What to open: `c4.calls` — the call site in the CALLER. " +
        "Its subject is the calling service, so it is answered from that service's repository, and in `loam tasks` it " +
        "depends on the `api.exposes` unit for the operation it calls when the same feature adds that operation.",
      pins: [{ source: "VERIFY", phrase: "`c4.calls` — the call site in the CALLER." }],
    },
    {
      term: "scenario.tested",
      aliases: [],
      paragraph:
        "A `scenario.tested` claim asks whether one scenario of a changed requirement passes in a test run. " +
        "The run is of the service's generated suite, in that service's own repository. " +
        "`loam verify` derives one per scenario of every requirement the feature adds or modifies, arch.spec.md deltas " +
        "included (those want an integration or ops test, not an acceptance test). " +
        "The `scenario.tested` claims are the runner's to answer, not yours. Run the suite `loam gherkin <FEAT>` " +
        "generated, with a JSON report, and pass it back with `loam verify <FEAT> --service <id> --results report.json`; " +
        "the match is the scenario's `@loam-digest-…` tag. The digest is the only identity: a reworded spec scenario " +
        "matches nothing until the suite is regenerated and re-run. " +
        "With no runnable suite your word may answer them, and the feature is then **attested**, not verified — these " +
        "are the only claims that verdict turns on.",
      pins: [
        { source: "VERIFY", phrase: "The `scenario.tested` claims are the runner's to answer, not yours." },
        { source: "DONE_CHECK", phrase: "The digest is the only identity: a reworded spec scenario matches" },
      ],
    },
    {
      term: "attested",
      aliases: ["attest", "attestation"],
      paragraph:
        "Attested is the verdict one rung below verified on the done-check's ladder. " +
        "Verified means somebody says the code was built and showed evidence — and for scenario claims that evidence is a " +
        "test runner's report, answered mechanically. Without a runnable suite your word can still answer them " +
        "(`loam verify <FEAT> --record` alone), but the record says who answered, and a feature whose " +
        "scenario claims rest on an agent's word is **attested**, not verified. Nothing gates on the difference; " +
        "pass `--results <report>` the moment a suite runs and the verdict moves on its own. " +
        "In `loam tasks` it is also the fourth step a unit can wait at, and the one that is not work to write: " +
        "the claim was closed on somebody's word rather than on a run, so the unit stays visible at `attested` until a " +
        "test run re-records it.",
      pins: [
        { source: "REFUSALS", phrase: "somebody says the code was built and showed evidence" },
        // Left the cycle with the done-check teaching; repaired by following the
        // text, as `vouch`'s two were.
        { source: "DONE_CHECK", phrase: "scenario claims rest on an agent's word is **attested**, not verified" },
        { source: "IMPLEMENT", phrase: "the claim was closed on somebody's word rather than on a run" },
      ],
    },
    {
      // The other half of the most overloaded word in loam's output. The status
      // row and the scorecard print the verdict (`verified · attested ·
      // unverified`), while a document's frontmatter prints `status: verified`
      // for a vouch — and the two have nothing to do with each other. A reader
      // who looks the word up after either one gets both meanings here.
      term: "verified",
      aliases: ["unverified", "verdict", "verdicts"],
      paragraph:
        "Verified is the done-check's top verdict: every claim recorded confirmed, the scenario claims by a test run. " +
        "Every claim on the checklist has an answer with evidence, and no scenario claim rests on somebody's word. " +
        "A record's `verdict` (`verified` | `attested` | `unverified`) is computed from its claims, never stored: " +
        "`unverified` means some claim is still unconfirmed or unanswered, or the record answers a checklist the feature " +
        "no longer asks; **attested** means complete, with a scenario claim resting on an agent's word. " +
        "Between `verified` and `attested` the verdict turns on the scenario claims alone, so a `verified` record can still rest " +
        "partly on an agent's word about kinds the verdict does not turn on — `service.exists` or `c4.calls`, which " +
        "only the code can answer. " +
        "Only `verified` makes a feature in flight `done`. **Nothing gates on it.** `loam archive` will ship an " +
        "unverified feature. " +
        "The same word on a living document means something else: `status: verified` in a spec.md's frontmatter is a " +
        "person's vouch for the words, not a test result (`loam explain vouch`).",
      pins: [
        { source: "CODES_PAGE", phrase: "`verdict` (`verified` | `attested` | `unverified`)" },
        { source: "CODES_PAGE", phrase: "partly on an agent's word about kinds the verdict does not turn on" },
      ],
    },
  ],
};
