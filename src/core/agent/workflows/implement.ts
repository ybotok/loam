import type { CommandContent } from "../contract.js";

/** Building one service's slice: the delta brief, generated gherkin, steps, code, verify. */
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
    "`loam delta` — the task: the intent, every requirement verbatim, the endpoints, and the calls in and out",
    "`loam gherkin` in the service's repo — the digest-stamped `.feature` files. Never edit them",
    "write step definitions for the generated scenarios first, outside the generated directory",
    "implement until the suite passes, running it with a JSON report",
    "honour the contract in both directions: expose every inbound operation, call every outbound one",
    "`loam rebase` if building made you change the feature's documents at all, then validate the feature",
  ],
  body: `Implement one service's part of a feature. Every step runs in the SERVICE'S own
repository, which needs its own committed ./loam.json — if there is none,
\`loam init --docs <path-to-docs-repo> --service $2\` then \`loam doctor\` first.

0. \`loam status $1 --json\` — where this feature actually is. Run it before
   anything else if you joined halfway or lost the session: it says which
   artifacts are still owed, whether another feature has to archive first, and
   what the next step is, each \`next[]\` entry carrying the literal command. It
   writes nothing, so it is always safe to re-run.
1. \`loam delta $1 --service $2 --json\` (drop \`--service\` to use the service configured
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
2. In the service's repo, \`loam gherkin $1 --json\` — one \`.feature\` file per changed
   requirement lands under \`<gherkinDir>/loam/\` (default \`features/loam/\`), scenarios
   digest-stamped, arch requirements tagged \`@architecture\`. Those files ARE the
   acceptance criteria. Never edit them: regeneration rewrites the directory, and
   \`loam validate\` reports the suite stale by digest, not by your intentions.
3. Write step definitions for the generated scenarios FIRST — outside \`loam/\`.
   Do not paraphrase a scenario into something easier to pass; it is the acceptance
   criterion someone else reviews against.
4. Implement until the suite passes — run it with a JSON report
   (\`cucumber-js --format json:report.json\`):
   \`loam verify $1 --service $2 --results report.json\` consumes that report as the
   done-check's answer sheet. Record from THIS repo, with \`--service\` — the
   \`--service\`-less \`--record\` form writes the whole record from one place and is
   refused (\`record-federated\`) once another service has attested.
5. Honour the contract: every operation in \`architecture.inbound\` must exist under
   exactly that operationId, and every one in \`architecture.outbound\` must be called.
6. If building made you change the feature's documents at all — a requirement's
   wording, an operation in its openapi.yaml — **\`loam rebase $1\`** before you
   validate. Every edit you make in the docs repo while other features are in
   flight is written against a living document that may have moved since the
   feature directory was created, and the pins are the only thing that lets the
   merge tell an EDIT from a QUOTE. \`delta.baseline-missing\` and
   \`openapi.baseline-missing\` are the warnings that say you skipped it — archive
   refuses on them until you rebase (or a human \`--approve\`s the unpinned merge);
   \`delta.baseline-stale\` / \`openapi.baseline-stale\` are archive refusing because
   somebody landed a change underneath you — re-read theirs, fold in what you
   still mean, then rebase again. Re-pinning without re-reading is how you
   overwrite someone else's requirement with loam's blessing.
7. \`loam validate --feature $1 --json\` before handing back.

If the requirement is ambiguous, say so and stop — do not invent behaviour and
leave the spec disagreeing with the code.
`,
};
