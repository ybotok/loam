/**
 * The agent contract: what `loam init` lays down so a coding agent can run the
 * cycle without being told it each time.
 *
 * AGENTS.md goes into the docs repo — it travels with the thing it describes.
 * The slash commands go into the repo `init` runs in, because that is where the
 * agent is invoked. Neither is ever overwritten: they are starting points, and
 * a team's edits to them outrank ours.
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const AGENTS_MD = `# Working in this docs repo

This is a **loam** docs repo: the shared source of truth for a fleet of services —
their architecture, their contracts, and what they are required to do. Everything
here is plain files. \`loam\` reads and writes them; delete \`loam\` and the docs remain.

## Layout

\`\`\`
architecture/landscape.likec4     the living C4 model of the whole fleet
services/<svc>/
  model.likec4                    this service's C4
  spec.md                         its living requirements (current state)
  openapi.yaml                    its API contract
  adrs/  runbook.md  health.yaml  why it is like this, how to run it
features/<FEAT>/                  a change in flight
  intent.md                       why, in business terms
  delta.likec4                    the architecture change, tagged #<FEAT>
  specs/<svc>/spec.md             the requirement change for one service
  specs/<svc>/openapi.yaml        the endpoints this feature adds
features/archive/<FEAT>/          shipped changes — the evolution history
\`\`\`

**Living vs delta.** \`services/<svc>/spec.md\` is the complete current state.
\`features/<FEAT>/specs/<svc>/spec.md\` is a diff against it, reviewed as a diff, with
requirements grouped under \`## ADDED\`, \`## MODIFIED\` or \`## REMOVED Requirements\`.
\`loam archive\` folds the delta into the living state.

## The ID spine

Three artifacts describe the same call in three languages. They are joined by the
**operationId**, and that join is what \`loam validate\` checks:

- architecture — a C4 edge names the operation it calls:
  \`checkoutWeb -> paymentService 'Calls authorizePayment' { metadata { op 'authorizePayment' } }\`
- behaviour — a requirement declares the operations it governs:
  \`Operations: authorizePayment\`
- contract — the provider's \`openapi.yaml\` defines it:
  \`operationId: authorizePayment\`

Spell it identically in all three places. A mismatch is an error, not a warning:
an edge calling an operation nobody defines is a broken contract between services.

Features are joined the same way: a delta's new elements and edges carry the
feature id as a LikeC4 tag (\`#FEAT-101\`), and that tag is exactly what
\`loam archive\` folds into the living landscape. Untagged elements in a delta are
context for the diagram, not changes.

## The cycle

1. **Understand** — \`loam list --json\`, \`loam show <service> --json\`.
   Never propose a change to a service you have not read.
2. **Scaffold** — \`loam new FEAT-101 --title "..." --service <existing> --new-service <new>\`.
3. **Author** the four files the scaffold left as TODO: intent, delta.likec4,
   a spec.md per service, an openapi.yaml per new service.
4. **Check** — \`loam validate --feature FEAT-101 --json\`. Fix every error before writing code.
5. **Build** — \`loam delta FEAT-101 --service <svc> --json\` is the task for one service:
   intent, its requirement delta with scenarios verbatim, and the edges around it.
   Write one test per scenario **first**, from the Given/When/Then lines as written.
6. **Ship** — \`loam archive FEAT-101\` once the code is merged.

## What you author, what loam derives

Authored by hand: \`intent.md\`, \`delta.likec4\`, \`specs/<svc>/spec.md\`,
\`specs/<svc>/openapi.yaml\`, ADRs, runbooks, health.

Written by loam: the merge into \`services/<svc>/spec.md\`, \`services/<svc>/openapi.yaml\`
and \`architecture/landscape.likec4\` at archive time.

**Do not hand-edit the living landscape to add a feature's changes.** Put them in a
delta and archive it — otherwise the change has no intent, no requirement and no
history behind it.

## Rules the validator enforces

- every requirement has at least one \`#### Scenario:\` — scenarios are the acceptance
  criteria and the source for tests;
- every operationId a requirement governs exists in that service's OpenAPI;
- every C4 edge's \`op\` resolves to an operation the target actually exposes;
- every operation is governed by some requirement (warning);
- a "Calls" edge with no \`metadata { op }\` is unlinked (warning).

Errors gate. Warnings do not, but leave one only deliberately.

## Reading loam's output

Every command takes \`--json\`. Branch on \`findings[].code\` (\`c4.invalid\`,
\`requirements.missing-scenarios\`, \`spec-api.op-undefined\`, \`c4-api.op-undefined\`,
\`c4.op-ungoverned\`, \`api.op-unconsumed\`, \`spine.op-link-missing\`), never on the prose —
the wording changes, the codes do not. The envelope separates \`ok\` (the command
ran) from \`valid\` (the docs pass).

## The archive gate

The three axes agreeing is called **coherence**, and \`loam validate --feature\` reports
it as such. \`loam archive\` runs the same coherence check first and refuses a feature
that fails it, because the merge would carry the disagreement into the living docs,
where every later reader inherits it.

\`--approve\` overrides the gate. It is a human decision, not an agent's: if archive
refuses, fix the breach or hand it back.
`;

/** Claude Code slash commands: `.claude/commands/<name>.md` -> `/<name>`. */
export const SLASH_COMMANDS: Record<string, string> = {
  "loam-feature": `---
description: Start a new loam feature — scaffold it, then author the C4 delta and requirement deltas
argument-hint: <FEAT-id> "<title>"
---

Start a new feature in the loam docs repo (its path is \`docsDir\` in ./loam.json).

1. Read \`AGENTS.md\` at the root of the docs repo first — it defines the ID spine
   everything here depends on.
2. Understand the current state before proposing a change:
   - \`loam list --json\` — what services exist, and what documentation they are missing
   - \`loam show <service> --json\` — what a service owns, exposes, and who already calls it
3. Scaffold it: \`loam new $1 --title "$2"\`, adding \`--service <id>\` for every service the
   feature touches and \`--new-service <id>\` for every one it introduces.
4. Author what the templates left as TODO:
   - \`intent.md\` — the problem in business terms
   - \`delta.likec4\` — new elements and edges, each tagged \`#$1\`; every call edge carries
     \`metadata { op '<operationId>' }\`
   - \`specs/<svc>/spec.md\` — one behaviour per requirement, SHALL, at least one
     Given/When/Then scenario; uncomment \`Operations:\` once the operation exists
   - \`specs/<svc>/openapi.yaml\` — define every operationId the edges reference
5. \`loam validate --feature $1 --json\`. Do not stop while \`valid\` is false.

The operation's three spellings — the edge's \`op\`, the requirement's \`Operations:\`
line, and the OpenAPI \`operationId\` — must match exactly.
`,

  "loam-implement": `---
description: Implement a loam feature's slice for one service — tests from the scenarios first
argument-hint: <FEAT-id> [service]
---

Implement one service's part of a feature.

1. \`loam delta $1 --service $2 --json\` (drop \`--service\` to use the service configured
   in ./loam.json). That output IS the task:
   - \`intent\` — why this exists
   - \`requirements[]\` — what to build, with \`scenarios[].lines\` verbatim
   - \`architecture\` — whether this service is new, and the calls in and out of it
2. Write the tests FIRST — one per scenario, straight from the Given/When/Then lines.
   Do not paraphrase a scenario into something easier to pass; it is the acceptance
   criterion someone else reviews against.
3. Implement until they pass.
4. Honour the contract: every operation in \`architecture.inbound\` must exist under
   exactly that operationId, and every one in \`architecture.outbound\` must be called.
5. \`loam validate --feature $1 --json\` before handing back.

If the requirement is ambiguous, say so and stop — do not invent behaviour and
leave the spec disagreeing with the code.
`,

  "loam-check": `---
description: Validate the loam docs repo and fix what it reports
argument-hint: [--all | <FEAT-id> | <service>]
---

Run loam's checks and fix what they find.

- whole fleet: \`loam validate --all --json\`
- one feature: \`loam validate --feature <FEAT-id> --json\`
- one service: \`loam validate --service <id> --json\`

Branch on \`findings[].code\`, not the prose:

| code | what it means | what to do |
|---|---|---|
| \`c4.invalid\` / \`delta.invalid\` | the LikeC4 file does not parse | fix this first — an unreadable axis makes every other check meaningless |
| \`requirements.missing-scenarios\` | a requirement with no scenario | add the acceptance criteria; do not delete the requirement |
| \`spec-api.op-undefined\` | a requirement governs an operation its OpenAPI does not define | define the endpoint, or correct the \`Operations:\` line |
| \`c4-api.op-undefined\` | an edge calls an operation the target does not expose | a broken contract between services — fix the caller or add the endpoint |
| \`c4.op-ungoverned\` (warn) | an operation is called but no requirement governs it | write the requirement |
| \`api.op-unconsumed\` (warn) | an added operation no edge consumes | model the caller, or say why it is provider-only |
| \`spine.op-link-missing\` (warn) | a "Calls" edge with no \`metadata { op }\` | link it to the operationId |
| \`service.no-requirement-delta\` (warn) | a new service with no spec delta | write \`specs/<svc>/spec.md\` |

Errors gate; warnings do not. Fix every error. Leave a warning only if you can say
why, and say it.
`,

  "loam-ship": `---
description: Archive a finished loam feature — merge its deltas into the living docs
argument-hint: <FEAT-id>
---

Archive a shipped feature.

1. Confirm the code is actually built and merged. Archiving folds the delta into the
   living docs; doing it early makes the docs claim something that does not exist.
2. \`loam validate --feature $1 --json\` — must come back \`valid: true\`.
3. \`loam archive $1\`. It merges three axes into the living state — requirements into
   \`services/<svc>/spec.md\`, endpoints into \`services/<svc>/openapi.yaml\`, elements and
   edges into \`architecture/landscape.likec4\` — then moves the feature under
   \`features/archive/\`.
4. If it refuses, the feature is not coherent. Fix the reported breaches.
   \`--approve\` overrides the gate and may corrupt the living docs — that is a human's
   call to make, not yours. Report the breach and stop.
`,
};

/**
 * Write the slash commands into `.claude/commands/` of `cwd`. Existing files are
 * left alone. Returns the paths created.
 */
export async function scaffoldAgentCommands(cwd: string): Promise<string[]> {
  const dir = join(cwd, ".claude", "commands");
  const created: string[] = [];
  for (const [name, body] of Object.entries(SLASH_COMMANDS)) {
    const path = join(dir, `${name}.md`);
    if (existsSync(path)) continue;
    await mkdir(dir, { recursive: true });
    await writeFile(path, body, "utf8");
    created.push(path);
  }
  return created;
}
