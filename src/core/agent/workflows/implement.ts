import type { CommandContent } from "../contract.js";

/**
 * Building one service's slice: the delta brief, then a unit at a time —
 * generated gherkin, steps, code, verify.
 *
 * Steps 3-5 are a LOOP, not a sequence, and that is why `loam tasks` sits at
 * the head of them. They used to be three things done in order — generate the
 * suite, write the definitions, implement — which is only the right order for a
 * slice whose every requirement already owns a scenario. Where one does not,
 * the next thing owed is a sentence in the docs repo, and the body had no step
 * that could say so; where the suite is half written, nothing here answered
 * which half. `at` answers both: the projection names which of four states the
 * next unit is in, and each state names exactly one action, so the numbering
 * below is a table of destinations rather than an itinerary. An editor adding a
 * step must therefore say which `at` value routes to it, or it is unreachable.
 */
export const LOAM_IMPLEMENT: CommandContent = {
  name: "loam-implement",
  description:
    "Implement a loam feature's slice for one service — generated gherkin first, tests from it, then code",
  argumentHint: "<FEAT-id> [service]",
  purpose:
    "Build one service's part of a feature, in that service's own repository. The generated Gherkin is the acceptance criterion — it comes before the step definitions, and those come before the code.",
  invocation: "loam instructions loam-implement $1 $2",
  placeholders: ["feature", "service"],
  spine: [
    "`loam status` — where this feature actually is, and what is owed before you start",
    "`loam context` — the briefing: the service's living slice, and every delta in flight over it",
    "`loam delta` — the task: the intent, every requirement verbatim, the endpoints, and the calls in and out",
    "`loam tasks` — the open units, ordered; `--next` is the single next unit, with the scenario verbatim and the fact that closes it",
    "`loam gherkin` in the service's repo — the digest-stamped `.feature` files. Never edit them",
    "write step definitions for the generated scenarios first, outside the generated directory",
    "implement until the suite passes, running it with a JSON report",
    "honour the contract in both directions: expose every inbound operation, call every outbound one",
    "`loam rebase` if building made you change the feature's documents at all, then validate the feature",
  ],
  body: `Implement one service's part of a feature. Every step runs in the SERVICE'S own
repository, which needs its own committed ./loam.json — if there is none,
\`loam init --docs <path-to-docs-repo> --service $2 --agent-profile service\` then
\`loam doctor\` first.

0. \`loam status $1 --json\` — where this feature actually is. Run it before
   anything else if you joined halfway or lost the session: it says which
   artifacts are still owed, whether another feature has to archive first, and
   what the next step is, each \`next[]\` entry carrying the literal command. It
   writes nothing, so it is always safe to re-run.
1. \`loam context $2 --feature $1 --json\` — the briefing to load before touching
   code: the service's living requirements and arch requirements verbatim, its
   operations and messages as they stand today, the permissions and capabilities
   its requirements join to, the fleet edges around it, and this feature's delta
   over it (\`--feature $1\` narrows the in-flight section; drop it to see every
   feature working over this service). The delta below is WHAT CHANGES; the pack
   is what it changes INTO — read it first so a MODIFIED requirement lands as an
   edit rather than a rewrite, and an operation you are about to add is caught
   when the living contract already defines it. Exit 1 with \`ok: true\` means a
   document behind the pack did not parse; the empty section beside the flag is
   the parse failure, not "nothing here".
2. \`loam delta $1 --service $2 --json\` (drop \`--service\` to use the service configured
   in ./loam.json). That output IS the task:
   - \`intent\` — why this exists
   - \`requirements[]\` — what to build, with \`scenarios[].lines\` verbatim
   - \`archRequirements[]\` — the architectural obligations (outbox, retries, alerts),
     same shape; their scenarios become integration/ops tests, and \`covers\` names
     the model objects each exercises
   - \`architecture\` — whether this service is new, and the calls in and out of it
   - \`api\` — the endpoints this feature adds or retires for this service: path,
     method, operationId and summary, with removals spelled \`REMOVE <METHOD> <path>\`
   - \`openapi\` — whether that contract could be read at all: \`unreadable\`, plus an
     \`error\` when the parser gave a message. It rides beside \`api\` rather than
     inside it because \`api\` stays the operations array it has always been, and it
     is what tells an empty \`api\` apart from a contract delta that did not parse
   - \`services\` — every service this feature projects onto, so a run without
     \`--service\` tells you which ones to ask for rather than guessing
   Exit 1 with \`ok: true\` means one of the two authored documents behind this brief
   did not parse: \`architecture.errors\` non-empty (delta.likec4), or
   \`openapi.unreadable\` true (the feature's openapi.yaml for this service). The empty
   slice is the parse failure itself, not "nothing changes there". Stop and fix that
   document before building anything — for the delta, \`loam validate $1 --json\` names
   the error; the contract delta is not graded by validate, so read the parser message
   the payload carries.
3. \`loam tasks $1 --service $2 --next --json\` — ONE unit of work, and the loop
   every step below runs inside. Step 2 is the whole brief; this is the next thing
   to do in it. It writes nothing: the projection is derived from the verify
   checklist, the delta scans, the feature's verification record and — in this,
   the bound service repo — the digest stamps in the generated \`.feature\` files.
   Drop \`--next\` to see every open unit instead of only the head.
   Each entry of \`units[]\` carries its \`id\` (the same id the verify checklist uses
   for that claim), \`kind\` (\`service.exists\`, \`api.exposes\`, \`event.declares\`,
   \`c4.calls\`, \`scenario.tested\` or \`requirement.described\`), \`subject\`, \`claim\`,
   \`digest\`, \`dependsOn\`, \`source\` — the path, line, requirement and scenario it was
   derived from, with the scenario's own \`lines\` verbatim — and \`done.check\`.

   \`at\` is the instruction. It says what the unit NEEDS, and each of its four
   values names exactly one action:
   - \`describe\` — the requirement owns no scenarios yet. Write the Given/When/Then
     in the DOCS repo, on the requirement \`source\` names, and nothing else. loam
     does not author, and no amount of code closes a unit sitting here.
   - \`generate\` — no stamped \`.feature\` carries this scenario's digest. The only
     action is \`loam gherkin $1\` in this repo (step 4). Do not write code.
   - \`implement\` — the stamped scenario exists and no recorded run has confirmed
     it. Write step definitions outside \`loam/\`, implement until the suite passes,
     then \`loam verify $1 --service $2 --results report.json\` (step 5).
   - \`attested\` — the claim was closed on somebody's word rather than on a run.
     Run the suite and re-record it so it stops resting on an assertion. An
     agent-attested scenario stays visible at \`attested\` forever, deliberately: it
     is the one state that cannot be made to go away by ignoring it.

   \`done.check\` is the FACT that closes the unit, and the RUNNER decides whether
   that fact holds — never your own reading of the code you just wrote. Done means
   the unit no longer appears, and it stops appearing only once its claim is
   recorded confirmed in a verification record that is not stale. So re-run
   \`loam tasks $1 --service $2 --json\` after every recording instead of working
   down a list you copied out: \`frontier\` (the first ten open unit ids, in order)
   and \`counts\` (\`open\`, \`done\`, \`attested\`) are recomputed from the documents on
   every run, which is what makes taking the head of it always safe.
   \`checklist\` is the digest of the question set the whole projection derives from.
   If it differs from the one you started against, the question set moved under
   you — re-read the feature before continuing, because what you closed earlier may
   not be what is being asked now.
   \`record\` says whether the answers were found at all (\`absent\`, \`recorded\`,
   \`stale\`, \`unreadable\`) and \`stamps\` whether this repo's generated suite could be
   read (\`read\`, \`unknown\`); an \`unknown\` makes every \`generate\` verdict a guess,
   so fix the binding before acting on one. \`contracts\` restates step 6 as data
   (\`expose[]\` and \`call[]\`), \`size\` the shape of the packet, \`review[]\` what a
   reviewer of it will read, and \`waitingOn\` — whenever the packet is narrowed to one
   service: by \`--service\`, or without it to this repo's own service when the feature
   touches it — what another service still owes before your frontier can move.
   Exit 1 with \`ok: true\` is step 2's rule again: delta.likec4 or one of the
   contract axes did not parse, so the projection is SHORT by everything that
   document would have contributed. Fix the document; do not work the units that
   happened to survive it.
4. \`at: "generate"\` — in the service's repo, \`loam gherkin $1 --json\`. One
   \`.feature\` file per changed requirement lands under \`<gherkinDir>/loam/\`
   (default \`features/loam/\`), scenarios digest-stamped, arch requirements tagged
   \`@architecture\`. Those files ARE the acceptance criteria. Never edit them:
   regeneration rewrites the directory, and \`loam validate\` reports the suite stale
   by digest, not by your intentions. Generating is the WHOLE action for a unit at
   \`generate\`: go back to step 3, where the same unit now reads \`implement\`.
5. \`at: "implement"\` — step definitions FIRST, outside \`loam/\`, then the code.
   Do not paraphrase a scenario into something easier to pass; it is the acceptance
   criterion someone else reviews against.
   Run \`loam steps --service $2 --json\` before you write any: it collapses every
   written step onto the phrase a definition actually matches, so you see the size
   of the registry you owe and which phrases already exist. Write ONE definition per
   phrase row. If \`nearDuplicates\` is non-empty, two rows differ by an article or a
   trailing \`because …\` clause and one definition was meant — fix the SPEC's wording
   and regenerate, rather than writing the second definition.
   A step's argument arrives as an argument: a \`"""\` docstring is the payload, an
   indented table is a DataTable. Assert against them; do not re-parse the step text.
   Then implement until the suite passes — run it with a JSON report
   (\`cucumber-js --format json:report.json\`; cucumber-jvm, behave, Reqnroll,
   pytest-bdd \`--cucumberjson\` and godog write the same cucumber JSON):
   \`loam verify $1 --service $2 --results report.json\` consumes that report as the
   done-check's answer sheet. A runner with no cucumber formatter answers through
   loam's runner-neutral shape instead, keyed by each scenario's \`@loam-digest\`
   tag — adapting the runner's report into it is a build step you own:
   \`{"loamScenarioReport": 1, "results": [{"digest": "<16 hex>", "status": "passed"}]}\`.
   A cucumber run must have run every step of the stamped scenario: a report
   entry whose step count differs is not that scenario's run and stays
   unconfirmed. Record from THIS repo, with \`--service\` — the
   \`--service\`-less \`--record\` form writes the whole record from one place and is
   refused (\`record-federated\`) once another service has attested. Recording is what
   closes the unit, so step 3 is the command AFTER it, not the end of the run.
6. Honour the contract: every operation in \`architecture.inbound\` must exist under
   exactly that operationId, and every one in \`architecture.outbound\` must be called.
7. If building made you change the feature's documents at all — a requirement's
   wording, an operation in its openapi.yaml — **\`loam rebase $1\`** before you
   validate. Every edit you make in the docs repo while other features are in
   flight is written against a living document that may have moved since the
   feature directory was created, and the pins are the only thing that lets the
   merge tell an EDIT from a QUOTE — for operations, path-level keys and
   components alike. \`delta.baseline-missing\` and
   \`openapi.baseline-missing\` are the warnings that say you skipped it — archive
   refuses on them until you rebase (or a human \`--approve\`s the unpinned merge);
   \`delta.baseline-stale\` / \`openapi.baseline-stale\` are archive refusing because
   somebody landed a change underneath you — re-read theirs, fold in what you
   still mean, then rebase again. Re-pinning without re-reading is how you
   overwrite someone else's requirement with loam's blessing.
8. \`loam validate --feature $1 --json\` before handing back.

If the requirement is ambiguous, say so and stop — do not invent behaviour and
leave the spec disagreeing with the code. Write the question under
\`## Open questions\` in the feature's \`intent.md\`, where loam-feature's analyze
step put the ones it found, so a person answers it once for every service.
`,
};
