import type { CommandContent } from "../contract.js";

/** Starting a feature: explore, scaffold, author the three axes, rebase, validate. */
export const LOAM_FEATURE: CommandContent = {
  name: "loam-feature",
  description:
    "Start a new loam feature — scaffold it, then author the C4 delta and requirement deltas",
  argumentHint: `<FEAT-id> "<title>"`,
  purpose:
    "Start a feature in the docs repo: decide which services it touches, scaffold it, then author the C4 delta and one requirement delta per service. The `--touches` list is the hardest call in the cycle and nothing downstream catches one that is short by a service.",
  invocation: 'loam instructions loam-feature $1 "$2"',
  // $2 is the feature's human title: any string is a legal one.
  placeholders: ["feature", "free"],
  spine: [
    "read `AGENTS.md` at the docs repo root — it defines the ID spine everything else depends on",
    "`loam explore` around the services you think are involved: the ring one hop out, and what is already in flight over the same ground",
    "`loam status` / `loam list` / `loam show` — what exists and what is already owed",
    "`loam new` with a `--touches` per service it changes and a `--new-service` per service it introduces",
    "author what the templates left as TODO: intent, the C4 delta, the per-service spec / arch spec / openapi",
    "`loam rebase` — pin every MODIFIED requirement and every operation to the living version you wrote against",
    "validate the feature, then read `loam dependencies` before anyone starts building",
  ],
  body: `Start a new feature in the loam docs repo (its path is \`docsDir\` in ./loam.json).

1. Read \`AGENTS.md\` at the root of the docs repo first — it defines the ID spine
   everything here depends on.
2. Understand the current state before proposing a change:
   - \`loam status --json\` — what is already in flight and what it is waiting on.
     Run this FIRST if you joined this repository halfway or lost the session:
     \`next[]\` is ordered and each entry carries the literal command to run, so it
     tells you whether the work is to start $1 at all. \`loam status $1 --json\`
     narrows it to one feature once $1 exists
   - \`loam list --json\` — what services exist, and what documentation they are missing
   - \`loam show <service> --json\` — what a service owns, exposes, and who already calls it
2b. \`loam explore <service> --json --as $1\` around every service you believe this
   feature touches. This is the step that decides step 3's \`--touches\` list, and it
   is the only decision in the cycle nothing downstream catches — a list short by one
   service produces a feature that validates, archives and ships with a consumer
   nobody updated. Read four fields:
   - \`neighbours\` — the services one hop out in the fleet map. Weigh each one. loam
     knows they are connected, not whether you change them, and it deliberately
     leaves them OUT of the suggested command line rather than guessing for you
   - \`services[].maturity\` — a service at \`empty\` or \`partial\` has no baseline to
     write a delta against, so the work starts with \`loam adopt --service <id>\`, not
     with this feature
   - \`services[].operations\` — what each already exposes, so an operation you are
     about to "add" that is already there becomes a MODIFIED requirement instead
   - \`overlaps\` — active features already carrying a delta for these services.
     \`loam dependencies --json\` (step 7) then says which must archive first
   \`--op <operationId>\` seeds from an operation when you know the call but not who
   owns it. A seed naming no \`services/<id>/\` is reported in \`unknown\` with the
   closest real ids rather than refused — the feature may be introducing it, and a
   typo looks identical until you read that list. \`scaffold\` is the literal step-3
   command line the seeds imply, with \`--new-service\` where the service does not
   exist yet.
3. Scaffold it: \`loam new $1 --title "$2"\`, adding \`--touches <id>\` for every service the
   feature touches and \`--new-service <id>\` for every one it introduces. Every id goes
   through the \`services/<id>/\` grammar, so a typo is refused (\`invalid-option\`)
   rather than scaffolded; a \`--touches\` that matches nothing existing comes back as
   a \`note\` with the close ids, not as a failure — read it, because a \`--touches\`
   naming a service that does not exist is \`delta.service-unknown\` at validate time
   and a phantom \`services/<typo>/\` directory if it ever archives.
4. Author what the templates left as TODO:
   - \`intent.md\` — the problem in business terms
   - \`delta.likec4\` — new elements and edges, each tagged \`#$1\`; every call edge carries
     \`metadata { op '<operationId>' }\`. For a requirements-only feature DELETE this
     file: an empty delta is legal, but a scaffold left half-filled is not
   - \`specs/<svc>/spec.md\` — one behaviour per requirement, SHALL, at least one
     Given/When/Then scenario; uncomment \`Operations:\` once the operation exists
   - \`specs/<svc>/arch.spec.md\` — the architectural obligations (outbox, retries,
     idempotency, alerts), same grammar; a \`Covers:\` line per requirement naming the
     tagged elements/edges it accounts for, or \`c4.uncovered\` says nothing does
   - \`specs/<svc>/openapi.yaml\` — define every operationId the edges reference
5. **\`loam rebase $1\`** — the step between authoring and checking, and the one that
   stops two features in flight from silently deleting each other's work. It pins
   every MODIFIED/REMOVED requirement (\`Based-On:\`) and every operation in the
   contract delta (\`x-loam-based-on\`) to the living version you wrote against.
   Run it on the contract axis even if you changed exactly one endpoint: that is
   what marks the REST of the document as quotation the merge must not write back.
   Without the pins, \`delta.baseline-missing\` / \`openapi.baseline-missing\` warn,
   nothing refuses, and the second feature to archive reverts the first — with
   \`+0 ~1 -0\`, exit 0, and nobody told.
   Restamping is not resolving: if rebase reports a requirement as MOVED, re-read
   the living text and fold in what you still mean BEFORE you ship.
6. \`loam validate --feature $1 --json\`. Do not stop while \`valid\` is false.
7. \`loam dependencies $1 --json\` before anyone starts building: it says which
   features in flight have to archive first (\`order\`) and which collisions no
   ordering fixes (\`conflicts\`, \`cycles\`). Every conflict it names is one \`loam rebase\`
   cannot fix for you — two intentions have to be merged by people.

The operation's three spellings — the edge's \`op\`, the requirement's \`Operations:\`
line, and the OpenAPI \`operationId\` — must match exactly.
`,
};
