/**
 * What an agent DOES: the cycle step by step, adopting a service, what is
 * authored versus derived, and the rules the validator enforces.
 *
 * The done-check itself is no longer here — it is `loam instructions
 * loam-done-check` (../workflows/reference/done-check.ts). Steps 4 and 7 used
 * to end `See "The requirement baseline"` and `See "The done-check"`, naming
 * headings that were further down this same file; they now name the COMMAND
 * that prints them. That is not a rewording for its own sake: a section
 * reference to a section that left is a pointer at nothing, and a reader who
 * scrolls looking for it concludes the file is truncated — which, on the two
 * hosts that truncate silently, is a conclusion they cannot check.
 *
 * One section of the AGENTS.md template. ../agents-md.ts assembles the
 * document by PLAIN CONCATENATION — no join separator — so every section
 * starts at the first character of its opening line and ends with the newline
 * that closes its last one. Keep that shape when editing, or two sections glue
 * onto one line in every docs repo loam scaffolds from now on.
 */
export const CYCLE = `## The cycle

0. **Wire the repo** — \`loam init --docs <path-to-docs-repo> --service <id>\` in
   each service repo, then \`loam doctor\`. Once per repository, before anything
   else; see "\`loam.json\` — the wiring" above. Every step below runs in a repo
   that has been through this one.
1. **Adopt** — a service with no documentation at all starts at
   \`loam adopt --service <id> --json\`, which briefs you on the baseline to write.
   See "Adopting a service" below. Once per service, not once per feature.
2. **Understand** — \`loam status --json\` first if you joined halfway or lost the
   session: it says what is in flight and what the next step is, for the fleet or
   for one feature (\`loam status FEAT-101 --json\`). Then \`loam list --json\` and
   \`loam show <service> --json\`.
   Then \`loam explore <service> --json\` around the services you believe are
   involved — it writes nothing and answers the one question the next step takes
   as an argument: which services this change actually touches. It reports the
   ring one hop out in the fleet map (\`neighbours\`), how far each service's
   documentation has got (\`maturity\`), what each already exposes, the features
   already in flight over the same ground (\`overlaps\`), and the \`loam new\` line
   the seeds imply (\`scaffold\`). \`--op <operationId>\` seeds from an operation
   when you know the call but not who owns it.
   Never propose a change to a service you have not read.
3. **Scaffold** — \`loam new FEAT-101 --title "..." --touches <existing> --new-service <new>\`.
   The scaffold leaves a \`delta.likec4\` whose context elements are commented out —
   a requirements-only feature should DELETE that file rather than ship an empty
   one — and gives every \`--new-service\` a \`specs/<svc>/arch.spec.md\` alongside.
   \`--capability <id>\` (repeatable, and it composes with \`--touches\`) scaffolds a
   capability delta instead of a service one — the inversion of this step, for a
   change whose BUSINESS side is what is known: open the promise that changes and
   derive the service work from it. An id the fleet has never named is scaffolded
   rather than refused, with the close spellings printed beside it; the archive
   is what creates the living \`capabilities/<id>/spec.md\`.
4. **Author** the four files the scaffold left as TODO: intent, delta.likec4,
   a spec.md per service, an openapi.yaml per new service. Finish with
   \`loam rebase FEAT-101\`: it pins every MODIFIED/REMOVED requirement and every
   operation in the contract delta to the living version you wrote it against.
   On the contract axis run it even when you changed nothing but one endpoint —
   that is exactly what marks the REST of the document as quotation the merge
   must not write. See \`loam instructions loam-spine\` — "The requirement baseline".
5. **Check** — \`loam validate FEAT-101 --json\`. Fix every error before writing code.
   \`loam dependencies --json\` says whether another feature in flight has to
   archive first.
6. **Build** — \`loam delta FEAT-101 --service <svc> --json\` is the task for one service:
   intent, its requirement delta with scenarios verbatim, and the edges around it.
   In the service's own repo, \`loam gherkin FEAT-101\` then emits those scenarios as
   \`.feature\` files under \`<gherkinDir>/loam/\` — write step definitions against them
   **first**, outside \`loam/\`, and implement until they pass.
   If \`architecture.errors\` is non-empty the payload keeps \`ok: true\` (the command
   ran) but the exit code is 1: the C4 slice is empty because delta.likec4 did not
   parse, not because the feature changes no architecture — do not build on it.
7. **Verify** — \`loam verify FEAT-101 --json\` turns the feature's own promises into a
   checklist. The scenario claims are answered by the cucumber report
   (\`--results report.json\`); answer the rest with evidence and record them
   (\`--record answers.json --service <id>\`), **from each affected service's own
   repo**. See \`loam instructions loam-done-check\`.
8. **Ship** — \`loam archive FEAT-101\` once the code is merged. \`--dry-run\` shows
   every file the merge would write, and writes none of them.

## Adopting a service

\`loam adopt --service <id>\` does not read code and never will. Nothing
deterministic can look at a legacy service and say what its architecture MEANS,
and a guessed model is worse than none: everybody downstream has to re-derive it
to know whether to believe it. So loam takes the half of the job that is
mechanical — stating the work, and checking the result — and you do the reading.

The brief names every file to write, the grammar each must be in, what the
landscape already says about the service (bind to those elements, do not draw a
parallel fleet), the frontmatter, and the checks that follow. It also lists what
**no** check will ever catch. Read that list: everything on it is a way to be
wrong quietly, and \`loam validate\` passing means nothing about any of it.

One of the targets is not under \`services/<id>/\`: \`architecture/landscape.likec4\`,
the fleet map, carried with \`action: "edit"\` and a \`landscape.instruction\`
spelling out the block this service owes it. That target appears only while
nothing in the map resolves to the service. **Add to that file; never rewrite
it** — every other service's elements and edges are in there. A service that is
fully documented and undrawn is \`landscape.service-unmodelled\` (error) and is
invisible to every cross-service check: no edge into it can be graded against
its openapi.yaml, and no feature can draw a call to it.

An adoption ends with two runs, not one: \`loam validate --service <id> --json\`
for the baseline, then \`loam validate --all --json\` in the docs repo — the
fleet cross-check the first invocation does not perform is exactly where a
landscape edit that did not land shows up. Done, stated once: \`--service\`
clean when run from inside the service's own repo, and \`--all\` reporting no
\`landscape.*\` finding. The fleet run is never SILENT — \`sources.unverifiable-from-here\`
(severity ok) appears per service as a confirmation, not work — so "keep going
until validation is quiet" is the wrong loop; the two runs above are the test.

Two rules the brief repeats and this file will too. An artifact that already
exists is reported as \`action: "diff"\` — read it and report what disagrees;
never replace it, because a document somebody wrote is evidence. And everything
you write is \`status: draft\`: promotion is \`loam vouch\`, run by a person in the
service's own repo — \`loam vouch --pack --service <id>\` (read-only) preps that read.

## What you author, what loam derives

Authored by hand: \`intent.md\`, \`delta.likec4\`, \`specs/<svc>/spec.md\`,
\`specs/<svc>/arch.spec.md\`, \`specs/<svc>/openapi.yaml\`, ADRs, runbooks, health.

Written by loam: the merge into \`services/<svc>/spec.md\`, \`services/<svc>/arch.spec.md\`,
\`services/<svc>/openapi.yaml\` and \`architecture/landscape.likec4\` at archive time.

**Do not hand-edit the living landscape to add a feature's changes.** Put them in a
delta and archive it — otherwise the change has no intent, no requirement and no
history behind it.

## Rules the validator enforces

- every requirement has at least one \`#### Scenario:\` — scenarios are the acceptance
  criteria and the source for tests;
- every operationId a requirement governs exists in that service's OpenAPI;
- every C4 edge's \`op\` resolves to an operation the target actually exposes;
- every operation is governed by some requirement (warning);
- a "Calls" edge with no \`metadata { op }\` is unlinked (warning);
- **the map is complete**: every \`services/<svc>/\` has an element in the landscape,
  and every element that looks like a service has a directory (warning) or is
  tagged \`#external\`;
- **the diff applies**: a \`MODIFIED\` or \`REMOVED\` requirement exists in the living
  spec, an \`ADDED\` one does not, and a section heading matches the grammar exactly;
- a \`Requirement-ID: <id>\` is optional, but when present it is valid and unique;
  archive selects by it, so carry the same ID through \`MODIFIED\` to rename a heading;
- **every requirement in a delta is under a delta section**: one under a prose heading
  (\`## Behavior\`) is documentation as far as the merge is concerned and is dropped
  (warning). \`## Requirements\` is exempt — quoting the living state is legal.

That last pair of rules exists because each of its failures used to be silent.
\`MODIFIED\` of a requirement that does not exist merged as a creation; \`ADDED\` of one
that does exist REPLACED it, scenarios and all; a near-miss heading like
\`## ADDED Requirement\` (singular) parses as plain prose, so archive merged nothing and
said nothing; and a requirement under \`## Behavior\` vanished the same way.

Write the delta section heading on its own line exactly as \`## ADDED Requirements\`.
The heading is the only thing that gives a requirement its kind: without a matching
one, archive merges the requirement as nothing.

Severity and gating are two different questions. An ERROR means the document is
invalid — \`loam validate\` fails. A finding with \`gates: true\` means \`loam archive\`
will refuse — the merge is unsafe. They usually agree (errors gate, warnings do
not), and where they diverge the \`--json\` output says so: \`delta.requirement-not-merged\`
is a warning (the shape is legal OpenSpec) that gates (the merge would drop the
requirement). Leave a warning standing only deliberately.

`;
