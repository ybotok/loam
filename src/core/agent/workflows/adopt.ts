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
    "write the artifacts, everything `status: draft` — the model EXTENDS the fleet map — then `loam subsystem sync` for the renderer wiring, which is loam's and never yours",
    "validate the service, then validate the whole fleet — a baseline that passes one and fails the other is documented and invisible",
    "hand back with what you could not determine from the code, which directories you never opened, the branch-to-scenario count per operation, and three behaviours your documents do not describe — then let a human vouch",
  ],
  body: `Write one service's baseline documentation into the loam docs repo (its path is
\`docsDir\` in ./loam.json). You read the code; loam states the work and checks the
result. It never reads the service — so anything you cannot show, do not write.

**The bar this artifact set aims at is reproducibility**: a reader should be able
to answer, from these files alone — what this boundary exposes, what it reaches,
what shapes it exchanges, how it is run, and what pages whom — without opening
the code. \`loam validate\` grades form and joins, never depth: green means the
files agree with each other, and the bar is what "done" is measured against — a
thin baseline that validates is thin, not done.

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
     It appears while nothing resolves to the service AND while the element that does
     has no edge touching it; \`targets[].shape\` says which of the two you are in.
     It does NOT appear when loam could not READ the map (\`landscape.modelled: null\`
     — a broken landscape, or a broken sibling under \`architecture/\`): nothing is
     known about what the map already draws, so no write to the whole fleet's map is
     briefed. \`landscape.instruction\` carries the answer and names the documents that
     failed; fix those and re-run.
   - \`targets[].shape\` — the grammar of each artifact, and \`example\` where one is
     shorter than a description. Every rule there is one a later check depends on;
     rules nothing checks are in \`unchecked[]\` instead, and are still worth following.
   - \`landscape\` — the elements and edges the fleet already has for this service.
     Bind to them; do not draw a second version of the same box. \`landscape.expects\`
     lists operations other services already call — your openapi.yaml owes them.
     \`landscape.instruction\` is the write the fleet map still owes this service; it
     is \`null\` once an element resolves to it AND at least one edge ANYWHERE in the
     \`architecture/\` project touches that element (\`landscape.touched\`), and only
     then — one edge closes the state, so draw every call in one pass.
     \`landscape.attested\` lists the
     calls \`services/$1/model.likec4\` already declares across its boundary — those
     are the edges the map owes, collapsed to the service; an empty list on a
     service with no model is not licence to invent one, and the instruction says so.
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
   make the landscape edit the brief asks for — the element where none resolves, the
   edges where the element stands alone, and the map's own housekeeping
   \`unchecked[]\` names: a placeholder tag to clear, a curated view to add the
   element to.
   **model.likec4 EXTENDS the fleet map.** It declares no \`specification\` block and
   no copy of anything the map already draws: its whole body is
   \`model { extend <fqn> { …containers… } }\`, where \`<fqn>\` is the FULLY-QUALIFIED
   id of the element bound to \`services/$1/\` (the brief's \`landscape.elements\` names
   it; \`extend orderService\` resolves to nothing when the id is
   \`marketplace.orderService\`). Kinds and tags come from
   \`architecture/landscape.likec4\` — a kind you need and the map does not declare
   (\`element database\`, \`element queue\`) is added THERE, once, in the same landscape
   edit. Cross-boundary edges are written OUTSIDE the extend block, from the container
   that makes the call to the other party's element as the map spells it; an element
   this file declares outside its own is \`c4.element-unowned\` (warn), and which fix
   applies depends on whose it is — a store or component this service OWNS belongs
   INSIDE the \`extend\` block (its id becomes \`<fqn>.<name>\`), a system the service
   merely reaches is declared in the map instead, and another service's internals
   belong in that service's model. If you are DIFFING an existing model
   that carries its own \`specification\`, leave it alone: that shape is still legal
   and still parsed on its own, and \`c4.declaration-diverged\` is what reports where
   its copies of the map's elements have drifted. Migrating one is the recipe in
   SCHEMA.md, "Two shapes of a service model" — not something to do inside an
   adoption you were not asked to widen.
   A flow behind one of your arch.spec.md requirements — a \`dynamic view\`
   over this service's own containers — goes in a \`.likec4\` beside model.likec4
   (\`services/$1/usecases/<name>.likec4\` by convention; \`views.likec4\` reads the
   same, because the renderer's per-service project reads every \`.likec4\` under the
   directory and so does loam), tagged \`#req-<Requirement-ID>\` of a requirement in
   this service's spec.md or arch.spec.md, with the tag declared in the map's
   \`specification\` block or in a tags-only \`specification { tag req-… }\` beside the
   \`extend\` — in exactly ONE of the two. Declared in both, the model's own project
   holds the tag twice: the error lands on whichever document carries the second
   declaration, as \`c4.invalid\` (an error, and the model's grading is suspended
   behind it) when that is model.likec4, or as \`usecase.flow-invalid\` when it is the
   sibling. Step 4 grades it. It never goes in \`architecture/usecases/\`,
   which cannot see your containers and turns the whole fleet \`landscape.invalid\`; a
   flow that crosses services goes there and is tagged \`#cap-\`. Never a \`#cap-\` tag
   beside a model. Then run \`loam subsystem sync\` (from
   this repo or the docs repo — it resolves \`docsDir\`): once the docs root carries
   the \`likec4.config.json\` step 0's doctor asks for, it keeps that file's
   \`exclude\` list covering exactly the service directories whose models stand alone —
   so an extending model stays inside the root project, where it is the only place it
   parses and where the renderer draws it beside the map — and writes
   \`services/<…>/<id>/likec4.config.json\` beside each STANDALONE model that has none.
   Both are loam's — never write one yourself, never list it in \`sources\`, never
   diff it, never hand-edit the root \`exclude\`'s \`services/\` entries — and \`sync\`
   leaves what it wrote untracked for you to commit. A repo whose models all extend
   the map usually has nothing for \`sync\` to write here, and that is the healthy
   state, not a skipped step.
   Everything \`status: draft\`. Never write \`last_verified\`, \`sources_digest\`,
   \`content_digest\` or \`sources_files\`.
4. \`loam validate --service $1 --json\`. Fix every error. \`c4.valid\` reading
   "extends the fleet map" is the confirmation that the model was read as one
   document with the map; \`c4.invalid\` on this run means the model plus the map do
   not parse together, and every error is YOURS even where the message names
   \`architecture/landscape.likec4\` — the map parses clean on its own, or
   \`spine.landscape-invalid\` would say so instead and this model could not be read
   at all. \`c4.element-unowned\` (warn) is an element you declared outside the
   element you extend — nest it inside the \`extend\` block if this service owns it,
   declare it in the map if the service only reaches it. \`sources.unvouched\` is
   expected on a fresh baseline — it closes when a person vouches, not when you do.
   \`sources.unwalked\` is the walk graded against the repository: its \`details\` name
   the top-level paths git tracks and \`sources\` never reached into. Treat each one
   as a place to go back to, not as a line to silence — the fix is reading it, or
   one sentence in step 6 saying why this document does not owe it.
   \`usecase.*\` findings on this run are about the flows beside model.likec4:
   \`usecase.step-unbacked\` is a hop no relationship in model.likec4 backs,
   \`usecase.step-contested\` two edges backing one hop and naming different
   operations, \`usecase.requirement-unresolved\` a \`#req-\` tag naming no
   \`Requirement-ID:\` of this service's spec.md or arch.spec.md,
   \`usecase.capability-unresolved\` a \`#cap-\` tag beside a model (drop it — a
   capability is claimed on the fleet map, never inside one service), and
   \`usecase.flow-invalid\` a file beside the model that does not read — the flows
   were not graded, the model still was. \`usecase.step-unlinked\` never fires on a hop
   whose caller and provider resolve to the same service — a service owes no
   operationId to itself — but a hop from such a flow into another service's element
   (a stand-in model.likec4 declares for a sibling, with no \`metadata { op }\`) still
   warns here, exactly as it does on the fleet map.
5. \`loam validate --all --json\` in the docs repo. This is the run that grades the
   fleet map: \`landscape.service-unmodelled\` means the element never landed,
   \`landscape.binding-unknown\` / \`landscape.binding-duplicate\` mean it landed wrong,
   and \`landscape.missing\` means there is no map at all. A baseline that passes step 4
   and fails this one is documented and invisible.
   \`landscape.service-isolated\` (a warning) means the element landed with no edge
   anywhere in \`architecture/\` while \`services/$1/model.likec4\` declares calls across
   its boundary — the map owes those edges. It goes quiet on the FIRST edge, so draw
   every call the brief listed in one pass: nothing will name the ones you leave out.
   A service whose model declares no such call and whose element
   has no edge is SILENT here: \`landscape.touched: false\` in step 1's brief is the
   only place that state is named, so read it before this run rather than hoping
   for it in it.
   Six warnings on this run are about the RENDERER's wiring rather than about any
   document, and one command fixes four of them: \`service.model-excluded\` (the root
   \`likec4.config.json\` excludes a directory holding a model that extends the map, so
   the renderer never loads it), \`service.model-unexcluded\` (its mirror, and the most
   damaging — a model that STANDS ALONE whose directory the root \`exclude\` does not
   cover merges into the root project and duplicates every kind the map declares,
   which blanks the whole project rather than one service),
   \`service.likec4-config-stray\` (a project file beside an extending model, which
   claims the model out of the root project),
   \`service.likec4-config-missing\` (a model that stands alone with no project file of
   its own) and, when the first four are clear, \`c4.fleet-project-invalid\` — every
   document reads clean where loam grades it and the ONE project the renderer builds
   out of the map plus every extending model does not parse, because something is
   declared in two of them. The first four: run \`loam subsystem sync\` — it rewrites
   the root \`exclude\`, writes the missing project file and DELETES the stray one. The
   fifth is an authoring fix: the message names the file and line, and the answer is
   to declare the tag or element once, in the map or in the single service that owns it.
   A sixth reads the same list and is NOT one of sync's: \`landscape.excluded\` says the
   root \`exclude\` covers \`architecture/landscape.likec4\` itself, so the renderer has no
   map to draw at all and every extending model in the root project resolves against
   nothing — delete or narrow that entry by hand, at the line the finding quotes. While
   it stands, \`c4.fleet-project-invalid\` is not graded at all: that check reads the
   renderer's project, so the one entry would come back once per model instead of once as
   the cause. Fix it first, then re-run and read the fifth.
   Done, stated once: step 4 clean when run from inside the service's own repo, this
   run reporting no \`landscape.*\` finding, no \`service.*\` renderer warning and no
   \`c4.fleet-project-invalid\`, and
   step 1's brief re-run reporting \`landscape.touched: true\` — or, for a service that
   truly makes and receives no call, a stated reason its element is edgeless.
   The fleet run is never SILENT —
   \`sources.unverifiable-from-here\` (severity ok) appears per service as a
   confirmation, not work — so "keep going until validation is quiet" is the wrong
   loop; the two runs are the test.
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

An empty docs repo's \`loam status --json\` names this recipe's own states as its
first-hour ladder: \`next.author-landscape\` (the fleet map is missing, or still the
scaffold's untouched bytes — step 3's landscape edit is what discharges it),
\`next.bind-service\` (no service repository is wired to the fleet yet — step 0) and
\`next.adopt-first\` (services/ is empty — this protocol, from step 1). Landing on
one of those codes means: run this recipe, starting at the step it points at.

Where the code does not say, write that it does not say. A confident sentence about
behaviour nobody can find is the one failure mode none of loam's checks can catch.
`,
};
