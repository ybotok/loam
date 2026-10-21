/**
 * The work-packet terms: the words `loam tasks` prints — a unit, the frontier,
 * and the steps a unit waits at (core/tasks/unit.ts `TaskStep`).
 *
 * The fourth step, `attested`, is not here: it is the same fact as the
 * done-check verdict of that name, seen from `loam tasks` rather than from
 * `loam verify`, and ./done-check.ts answers both readings in one entry. A
 * second `attested` would be a name two entries compete for.
 *
 * Every pin points at step 3 of the /loam-implement body, which is where the
 * binary teaches the packet — each step's own bullet there is one line, so
 * each entry here pins the clause that bullet opens with.
 */
import type { TermGroup } from "./entry.js";

export const TASK_TERMS: TermGroup = {
  heading: "the work packet — what `loam tasks` lists",
  terms: [
    {
      term: "unit",
      aliases: ["units", "work packet", "packet"],
      paragraph:
        "A unit is one piece of open work in the packet `loam tasks` derives, and its id is the id of the done-check " +
        "claim it closes. " +
        "`loam tasks <FEAT> --service <id> --next --json` is ONE unit of work, and the loop an implementation runs " +
        "inside; drop `--next` for every open unit. " +
        "Each entry of `units[]` carries its `id` (the same id the verify checklist uses for that claim), its `kind`, " +
        "the `source` it was derived from, and `done.check` — the fact that closes it. " +
        "`at` is the instruction. It is the step the unit waits at — `describe`, `generate`, `implement` or " +
        "`attested` — and each names exactly one action (`loam explain <step>`). " +
        "The packet is derived, never stored: from the verify checklist, the delta, the verification record and, in a " +
        "bound service repo, the digest stamps of the generated `.feature` files, so it is recomputed on every run. " +
        "One kind is not a claim: `requirement.described`, a requirement with no scenario yet (`loam explain describe`).",
      pins: [
        { source: "IMPLEMENT", phrase: "ONE unit of work, and the loop" },
        { source: "IMPLEMENT", phrase: "(the same id the verify checklist uses" },
        { source: "IMPLEMENT", phrase: "`at` is the instruction." },
      ],
    },
    {
      term: "frontier",
      aliases: [],
      paragraph:
        "The frontier is the head of the work packet: the first ten open unit ids, in the order `loam tasks` says to " +
        "take them. " +
        "`--json` carries it as `frontier` (the first ten open unit ids, in order), with how many more are open beside " +
        "it, and `--next` prints its head alone, in full, with what closes it. " +
        "It is recomputed from the documents on every run, which is what makes taking the head of it always safe — so " +
        "re-run `loam tasks <FEAT> --service <id>` after every recording instead of working down a list you copied out. " +
        "When the packet is narrowed to one service, `waitingOn` names what another service still owes before your " +
        "frontier can move.",
      pins: [
        { source: "IMPLEMENT", phrase: "`frontier` (the first ten open unit ids, in order)" },
        { source: "IMPLEMENT", phrase: "every run, which is what makes taking the head of it always safe" },
        { source: "IMPLEMENT", phrase: "still owes before your frontier can move" },
      ],
    },
    {
      term: "describe",
      aliases: ["requirement.described"],
      paragraph:
        "Describe is the first step a `loam tasks` unit can wait at: the requirement owns no scenarios yet. " +
        "So there is nothing to generate a test from and nothing for `loam verify` to claim. " +
        "Write the Given/When/Then in the DOCS repo, on the requirement the unit's `source` names, and nothing else — " +
        "loam does not author, and no amount of code closes a unit sitting here. " +
        "Its kind is `requirement.described`, the one unit kind that is not a done-check claim, because a requirement " +
        "with no scenario asks no question anybody could answer with evidence; it closes when the requirement carries " +
        "at least one `#### Scenario:`, which `loam validate --feature <FEAT>` grades. " +
        "The steps after it are `generate`, `implement` and `attested`.",
      pins: [
        { source: "IMPLEMENT", phrase: "the requirement owns no scenarios yet" },
        { source: "IMPLEMENT", phrase: "no amount of code closes a unit sitting here" },
      ],
    },
    {
      term: "generate",
      aliases: [],
      paragraph:
        "Generate is the step a `loam tasks` unit waits at when its scenario's test has not been generated yet. " +
        "`generate` means no stamped `.feature` carries this scenario's digest, and the only action is " +
        "`loam gherkin <FEAT>` in the service's own repository — do not write code. It writes one digest-stamped " +
        "`.feature` per changed requirement under `<gherkinDir>/loam/`. Those files ARE the acceptance criteria. " +
        "Never edit them: regeneration rewrites the directory. Generating is the whole action, and on the next run the " +
        "same unit reads `implement`. " +
        "The stamps are read from the repository `loam tasks` runs in, and nobody else's: an `unknown` makes every " +
        "`generate` verdict a guess, so fix the binding before acting on one.",
      pins: [
        { source: "IMPLEMENT", phrase: "no stamped `.feature` carries this scenario's digest" },
        { source: "IMPLEMENT", phrase: "Those files ARE the acceptance criteria." },
        { source: "IMPLEMENT", phrase: "an `unknown` makes every `generate` verdict a guess" },
      ],
    },
    {
      term: "implement",
      aliases: [],
      paragraph:
        "Implement is the step a `loam tasks` unit waits at when what is still owed is code, or a recorded answer " +
        "about code. " +
        "For a scenario claim it means the stamped scenario exists and no recorded run has confirmed it: write step " +
        "definitions outside the generated `loam/` directory, implement until the suite passes, then record the run " +
        "with `loam verify <FEAT> --service <id> --results report.json`. " +
        "For the other claim kinds it means the claim is not yet recorded confirmed: answer from the code with " +
        "`file:line` evidence (`loam verify <FEAT> --record answers.json --service <id>`), or for `api.exposes` with a " +
        "contract-test report. " +
        "Either way the record decides — never your own reading of the code you just wrote — and the unit leaves " +
        "the packet only once its claim is recorded confirmed. " +
        "A scenario also reads `implement` when nothing could see its generated test — the stamps are read from the " +
        "repository `loam tasks` runs in alone — so check `stamps` before writing a test by hand. " +
        "`loam instructions loam-implement <FEAT>` is the whole protocol.",
      pins: [
        { source: "IMPLEMENT", phrase: "the stamped scenario exists and no recorded run has confirmed" },
        { source: "IMPLEMENT", phrase: "never your own reading of the code you just wrote" },
      ],
    },
  ],
};
