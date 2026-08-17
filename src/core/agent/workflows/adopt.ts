import type { CommandContent } from "../contract.js";

/** The adoption protocol: write one service's baseline docs from its code, as draft. */
export const LOAM_ADOPT: CommandContent = {
  name: "loam-adopt",
  description:
    "Adopt a service — write its baseline docs from its code, as draft, then validate",
  argumentHint: "<service-id>",
  purpose:
    "Write one service's baseline documentation into the docs repo from its code, as `draft`. You read the code; loam states the work and checks the result — it never reads the service, so anything you cannot show, do not write.",
  invocation: "loam instructions loam-adopt $1",
  placeholders: ["service"],
  spine: [
    "wire this repo (`loam init`, then `loam doctor`) if it has no ./loam.json yet",
    "`loam adopt` — the brief: the order to read the service in, every file to write, the grammar of each, and what the fleet map already says",
    "walk the service in the brief's order — shape first, then one surface at a time — keeping the list of every path you open, because that list becomes `sources`",
    "write the artifacts, everything `status: draft`",
    "validate the service, then validate the whole fleet — a baseline that passes one and fails the other is documented and invisible",
    "hand back with what you could not determine from the code, which directories you never opened, the branch-to-scenario count per operation, and three behaviours your documents do not describe — then let a human vouch",
  ],
  body: `Write one service's baseline documentation into the loam docs repo (its path is
\`docsDir\` in ./loam.json). You read the code; loam states the work and checks the
result. It never reads the service — so anything you cannot show, do not write.

0. If there is no ./loam.json here, wire the repo first:
   \`loam init --docs <path-to-docs-repo> --service $1\` (add \`--create\` ONLY if the
   docs repo does not exist yet), then \`loam doctor\` — it resolves \`docsDir\`,
   checks the docs repo is one, and reports the service binding. Do not go on with
   \`docs-missing\`, \`services-missing\` or any \`doctor.*\` blocker standing.
   Every \`doctor\` finding carries a \`fix\` field spelling the exact command —
   type that, not an approximation of it.
   If this repo is already wired, \`loam status --json\` in the docs repo is the
   fastest way to see whether $1 is even the service that owes work next: its
   \`next.adopt\` entries name the services with nothing written down yet.
1. \`loam adopt --service $1 --json\`. That output IS the brief:
   - \`warnings[]\` — read these FIRST. A near-miss against an existing service id
     usually means \`$1\` is a typo, and a brief followed to the letter then produces
     a complete, validating baseline for a service that does not exist.
   - \`targets[]\` — every file to write. \`action: "diff"\` means the file ALREADY EXISTS:
     read it, diff your findings against it, report what disagrees. Do not replace it.
     \`action: "edit"\` appears on exactly one target — \`architecture/landscape.likec4\`,
     the WHOLE FLEET's map: add this service's element and edges to it, never rewrite it.
   - \`targets[].shape\` — the grammar of each artifact, and \`example\` where one is
     shorter than a description. Every rule there is one a later check depends on;
     rules nothing checks are in \`unchecked[]\` instead, and are still worth following.
   - \`landscape\` — the elements and edges the fleet already has for this service.
     Bind to them; do not draw a second version of the same box. \`landscape.expects\`
     lists operations other services already call — your openapi.yaml owes them.
     \`landscape.instruction\` is the write the fleet map still owes this service; it
     is \`null\` once an element resolves to it, and only then.
   - \`frontmatter\` — what to put in the header of every markdown artifact.
   - \`checks[]\` — what \`loam validate\` will run. \`unchecked[]\` — what it will not.
2. Read \`AGENTS.md\` at the docs repo root, then walk the service — \`walk[]\` in the
   same \`adopt\` output is the order, and it is an order, not a menu. Each stop
   names what to open, what to take from it, and which artifacts it feeds
   (\`lands\`). The first two stops fix what the service IS — how many processes,
   built from what — before any surface is enumerated: an agent that opens the
   HTTP routes first has already decided the service is an API by the time it
   meets the scheduler, and the consumer group and the outbox never get written
   down. Do not stop at the surface you recognise fastest.
   \`walkClose\` is the question that ends it: **list the directories you did not
   open.** Nothing downstream can find a service you documented a third of —
   \`api.ungoverned\` grades the operations you WROTE, and is silent about the twelve
   you never did.
   **Keep a list of every path you actually open.** That list becomes \`sources\` —
   written as files and directories, never glob patterns — and it is the only line
   tying the document to the repository. Never pad it with paths you did not read:
   it is a record, and \`loam vouch\` hashes exactly what it names.
3. Write the artifacts under \`services/$1/\`, in the order the brief lists them, and
   make the landscape edit the brief asks for.
   Everything \`status: draft\`. Never write \`last_verified\`, \`sources_digest\`,
   \`content_digest\` or \`sources_files\`.
4. \`loam validate --service $1 --json\`. Fix every error. \`sources.unvouched\` is
   expected on a fresh baseline — it closes when a person vouches, not when you do.
   \`sources.unwalked\` is the walk graded against the repository: its \`details\` name
   the top-level paths git tracks and \`sources\` never reached into. Treat each one
   as a place to go back to, not as a line to silence — the fix is reading it, or
   one sentence in step 6 saying why this document does not owe it.
5. \`loam validate --all --json\` in the docs repo. This is the run that grades the
   fleet map: \`landscape.service-unmodelled\` means the element never landed,
   \`landscape.binding-unknown\` / \`landscape.binding-duplicate\` mean it landed wrong,
   and \`landscape.missing\` means there is no map at all. A baseline that passes step 4
   and fails this one is documented and invisible.
6. Hand back, and say seven things:
   - what you could not determine from the code;
   - what the existing artifacts disagreed with;
   - which parts you are least sure of;
   - what you did not open — every path \`sources.unwalked\` named, with one line
     each on why the baseline does not owe it. That list is the only account
     anybody gets of how much of the service was actually read; loam can name the
     paths, and it can never say whether skipping one was right;
   - **two counts per operation**: how many decisions its code makes — permission
     checks, conditionally required fields, defaults and normalisations, refused
     transitions — and how many scenarios you wrote for it.
     \`12 branches / 3 scenarios\` is a fact a reader can act on; "the
     requirements look complete" is not, and no check loam has can tell the two
     apart;
   - **how well this service is covered by its own tests**, and how many of them
     became scenarios. Say the number the service's own coverage tooling
     reports, and where you read it. This is the ceiling on the whole baseline:
     a well-covered service can be documented from evidence, and a service with
     almost no tests can only be documented from a reading of its code, which is
     a weaker document however carefully it is written. Nothing in loam can
     compute this — say it, or nobody ever knows which kind they are holding;
   - **three behaviours this service has that your documents do not describe.**
     Not "is this enough" — that question is answered yes by every agent that
     ever wrote a baseline, including the ones that documented a third of a
     service, because the only thing it can be answered against is the document
     itself. Name three. If you looked for three and found none, say exactly
     that: it is a claim a reviewer can go and check, which "it is complete"
     is not.
   Then a human runs \`loam vouch --service $1\` in the service's own repo.

Where the code does not say, write that it does not say. A confident sentence about
behaviour nobody can find is the one failure mode none of loam's checks can catch.
`,
};
