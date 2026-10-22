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
    "decide whether this is a feature at all — a change that touches no requirement, operation or edge needs none",
    "read `AGENTS.md` at the docs repo root — it defines the ID spine everything else depends on",
    "`loam explore` around the services you think are involved: the ring one hop out, and what is already in flight over the same ground",
    "`loam status` / `loam list` / `loam show` — what exists and what is already owed",
    "`loam new` with a `--touches` per service it changes and a `--new-service` per service it introduces",
    "author what the templates left as TODO: intent, the C4 delta, the per-service spec / arch spec / openapi",
    "analyze before you pin — write what the documents leave open under `## Open questions` in intent.md, for a human to answer",
    "`loam rebase` — pin every MODIFIED requirement and every living operation you edited to the version you wrote against",
    "validate the feature, then read `loam dependencies` before anyone starts building",
  ],
  // Step 0 and step 4b are the two this protocol was missing, and neither is
  // graded — on purpose. Step 0 exists because the lightest lane loam has (no
  // feature at all, for a change that moves no requirement, operation or edge)
  // was true and written down nowhere, so the work that is most of a legacy
  // fleet's week either walked the whole feature cycle or routed around loam.
  // Step 4b exists because every check after it is a join between exact
  // tokens: two services that agree on every operationId and disagree on what
  // it means (one confirms a split the other answers 422 for) validate, archive
  // and ship green, and a `Realizes:` whose requirement does not deliver the
  // promise reads as a clean join. Nothing in the binary can read meaning, and
  // a check pretending to would be the false green this tool exists to refuse,
  // so the step asks for questions and leaves the answers to a person.
  body: `Start a new feature in the loam docs repo (its path is \`docsDir\` in ./loam.json).

0. First decide whether this needs a feature at all. A change that touches no
   requirement, no operation and no fleet edge — a refactor, a dependency bump,
   a fix that brings the code back to behaviour the living spec already
   documents — needs NONE: nothing in the docs repo changes, so there is nothing
   to scaffold, pin or archive. It is a code PR in the service repo, then
   \`loam validate --service <id>\` there (the service repo is the only place
   \`sources.stale\` is visible), then \`loam vouch --pack --service <id>\` to
   prepare the re-read the moved sources owe — the vouch itself is a human's.
   If the change alters what a requirement promises, it IS a feature, however
   small: one \`--touches\`, a Why, the ADDED/MODIFIED requirement, and
   \`loam rebase\` for a MODIFIED one — the rest of this page still applies.
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
4. Author what the templates left as TODO. This step is gated, not advisory:
   \`loam archive\` refuses a scaffold nobody edited (\`scaffold.placeholder\`,
   \`intent.empty\`), so the placeholder text cannot reach the living docs.
   - \`intent.md\` — the problem in business terms, in prose; the scaffold's
     comment-only Why/Scope count as unwritten
   - \`delta.likec4\` — new elements and edges, each tagged \`#$1\`; every call edge carries
     \`metadata { op '<operationId>' }\`; replace the scaffolded TODO description on each
     new service. For a requirements-only feature DELETE this
     file: an empty delta is legal, but a scaffold left half-filled is not.
     Draw each edge with its relationship kind (\`-[calls]->\`, \`-[publishes]->\`,
     \`-[delivers]->\`, …), and draw a direction only where the evidence shows
     one: anything else is \`-[connects]->\`. A message runs producer
     \`-[publishes]->\` topic and topic \`-[delivers]->\` consumer, never
     producer \`->\` consumer. A producer outside the fleet is an \`#external\`
     element whose edge carries \`metadata { publishes }\`. Declare every kind
     you draw in the delta's own \`specification\`, and check that the living
     map's declares it too. The archive copies the edge and never the
     declaration, so a kind the map lacks refuses the archive (\`merge-failed\`)
     even though validate and status call the feature ready.
     \`loam instructions loam-drawing\` has the kinds and their styles
   - \`specs/<svc>/spec.md\` — the example requirement ships INSIDE the template's
     comment: copy it out, unindent, one behaviour per requirement, SHALL, at
     least one Given/When/Then scenario; add \`Operations:\` once the operation exists
   - \`specs/<svc>/arch.spec.md\` — the architectural obligations (outbox, retries,
     idempotency, alerts), same grammar; a \`Covers:\` line per requirement naming the
     tagged elements/edges it accounts for, or \`c4.uncovered\` says nothing does.
     Write an edge by its endpoints' service names
     (\`order-service -> payment-service\`), which resolve the same before and
     after the archive
   - write every document for a reviewer who has never seen the code.
     \`intent.md\` gains a \`## How to read this feature\` section, a
     business-requirement coverage table, and \`## Open questions\` as a table
     (ID, question, blocks, owner, current default). Each spec delta opens
     with a plain-language \`## Purpose\`. A long requirement body becomes a
     one-line lead plus one bullet per SHALL sentence. Every abbreviation is
     expanded on first use. "This delta" and "this feature" stay out of
     requirement bodies and contract descriptions, because the archive copies
     those into the living docs. A word the feature brings goes in
     \`glossary/<term>.md\` and a decision in \`adrs/\`, both inside the feature,
     and a cross-service flow in \`usecases/<name>.likec4\`, tagged with a
     \`#cap-\` that resolves. \`loam instructions loam-authoring\`, "Writing
     for a person", has the shapes
   - \`specs/<svc>/openapi.yaml\` — define every operationId the edges reference.
     A self-contained document holding ONLY the operations this feature adds,
     changes or removes — never a copy of the living contract. An operation you
     leave out stays exactly as the living contract has it, and a local \`$ref\`
     (\`#/components/schemas/Order\`) resolves into the living document, so there
     is nothing to restate. Every operation you quote costs a pin, and once a
     parallel feature retires it — or moves it, and you quoted the old
     address — a pinned quote is \`openapi.baseline-invalid\` and
     \`openapi.op-revived\` both, an unpinned one \`openapi.op-revived\` alone
     (\`asyncapi.slot-revived\` on the event axis) — archive refuses either.
     Delete the quote; only a feature that MEANS to bring a retired operation
     back keeps it, and archives past the finding with a human's \`--approve\`
   - \`specs/<svc>/asyncapi.yaml\` — the event axis, only when the feature changes
     what a service puts on or takes off the bus: an AsyncAPI 3.0 document
     holding only the channel, operation and message slots you add, change or
     remove (an edited slot is written out whole), new messages under
     \`components.messages\`, and a \`Publishes:\`/\`Consumes:\` line on each
     requirement that names them. \`loam new\` scaffolds none — an event
     contract is genuinely optional
   - for a service (or capability) this feature CREATES, the delta is the
     living document's first draft, and \`loam archive\` carries only what you
     mark as the document's own: the frontmatter \`owner\`, an H1 that neither
     names $1 nor calls itself a delta (the scaffold's does both — retitle it),
     and a \`## Purpose\` section — put the service's narrative there. Everything
     else in the delta is read as being about the change and stays with it in
     \`features/archive/\`, linked from the new document
   - links: write each one so it resolves where you write it, relative to the
     file. A link into this feature — from its deltas, or from any other
     document whose links validate grades — is re-pointed by \`loam archive\`
     to wherever the file ends up — a term in \`glossary/<term>.md\` at the living glossary,
     anything else (an ADR in \`adrs/\` above all) inside
     \`features/archive/\`, because a feature ADR is never copied into the living
     tree. A decision meant to outlive this change belongs in
     \`architecture/adrs/\` or the service's own \`adrs/\` instead. The same
     holds inside this feature: its own documents (the intent, its ADRs) move
     to \`features/archive/\` with it, and the archive re-expresses their links
     for the move — never write them for the archived location yourself
4b. **Analyze before you pin.** Nothing grades this step, which is why it is here:
   every check after it is a join between exact tokens, so two services that
   agree on every operationId and disagree on what it means validate, archive
   and ship green. Read the feature as its reviewer will, before rebase freezes it:
   - \`loam show $1 --json\` — its \`review\` object joins the intent, the C4
     objects, the API/event slices and the dependencies
   - \`loam context <service> --feature $1 --json\` for every service it touches —
     the living requirements verbatim, the edges one hop out, and this delta
   - the \`neighbours\` step 2b's \`loam explore\` reported
   Then write what the documents leave open under \`## Open questions\` in
   \`intent.md\` (the scaffold already carries the heading), one table row per
   question — ID, the question, what it blocks (the requirement id or edge it is
   about), its owner, and the default that gets built if nobody answers:
   - a SHALL two engineers could build two ways — an unstated unit, bound,
     ordering, or an "eventually" with no window
   - a value, limit or window two services state differently (a refund window,
     a rounding rule, a retry budget), and which side refuses when they
     disagree — a caller that accepts what its provider answers 4xx for is a
     contradiction no check can see
   - a \`Realizes:\` line whose requirement does not actually deliver the
     capability promise it names, or a promise this feature changes that no
     realizing requirement keeps
   - per call edge in the delta: the timeout, the retry and what makes it safe
     to repeat, what a partial failure leaves behind, and what compensates it —
     an edge no requirement answers these for is a question, not a default
   - each \`explore\` neighbour outside \`--touches\`: why it is untouched, or that
     it is a candidate — adding one means a \`specs/<svc>/\` delta in this feature,
     because that directory IS the feature's service list
   Ask; do not answer for the author. The default column records what the
   documents imply today, not what you would choose. A human answers by editing the file —
   replacing a question with the decision, or with a change to the delta.
   Nothing is graded: an empty section is legal, and so is an answered one.
5. **\`loam rebase $1\`** — the step between authoring and checking, and the one that
   stops two features in flight from silently deleting each other's work. It pins
   every MODIFIED/REMOVED requirement (\`Based-On:\`), and every operation and
   asyncapi channel/operation/message slot the living contract already holds
   (\`x-loam-based-on\`), to the living version you wrote against. What the
   feature ADDS has no living version and takes no pin, so an add-only contract
   delta needs no rebase. Any living operation or slot the delta spells is one
   the merge upserts, so it needs its pin even when you changed one line of it.
   Without the pins, \`delta.baseline-missing\` / \`openapi.baseline-missing\` /
   \`asyncapi.baseline-missing\` GATE
   the archive: before they did, the second feature to archive reverted the
   first — with \`+0 ~1 -0\`, exit 0, and nobody told. Rebase clears them; a
   human's \`--approve\` is the only other way past.
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
