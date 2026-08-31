---
name: self-model
description: Keep loam's own architecture documented in loam — `meta/docs/` is a docs repo describing `src/`. Use whenever a change adds, removes or re-points an import edge between two top-level subjects of `src/`, whenever `npm run meta:check` is red, and when a change to the architecture is worth recording as a feature rather than an edit.
---

# loam documents itself in loam

`meta/docs/` is a real loam docs repo, and the system it describes is this repository.
`architecture/landscape.likec4` draws one container per top-level subject of `src/` and one
relationship per value import that crosses two of them; `services/loam/arch.spec.md` carries
`docs/DESIGN.md`'s numbered rules as requirements whose `Covers:` lines land on those objects.

It exists because the alternative was a table nobody was checking. When the axis landed it convicted
nine missing rows and eleven false `Depends on` cells in DESIGN's package-layout table, a DAG-levels
table that placed `verify/` below `gherkin/` — which it imports — and two mutual dependencies
`npm run arch:graph` cannot see at all, because that script keys on the full relative directory so
`core/c4/project` and `core/c4` are different nodes.

**`meta/loam.json` sits BELOW the tree it describes, and that is deliberate.** `loam.json` is in
`.gitignore` (the README's Quick start tells a reader to write a throwaway one at the repo root), so
a committed root config would break the documented first experience. Config discovery walks upward
from the cwd, which is what makes a subdirectory work.

## The cheap path, and it is not optional

```bash
npm run meta:check
```

Runs in CI beside `arch:check`, and takes about 150 ms. It compares the model to the tree and prints
the exact fix — `add: loam.core.delta -> loam.core.usecases` — and **never applies it**. Deciding what
the subjects of `src/` are is the whole content of that document, and a landscape emitted from a scan
would be a picture of the code rather than a claim about it.

Run it after any change that moves an import between two top-level subjects. Adding a file to an
existing package usually changes nothing; adding the package's first import of another subject
always does.

When it reports a missing relationship, edit `meta/docs/architecture/landscape.likec4` by hand — the
edges are one sorted block per source, and the new line goes in its block. **Then check the three
places the same fact is written in prose**, because none of them is derived and all three have gone
stale before:

- `docs/DESIGN.md`'s package-layout table — the `Depends on` cell for the source package.
- `docs/DESIGN.md`'s DAG-levels table — a new edge can move a package up a level, and everything
  above it with it. Recompute rather than guess; the levels resolve the two accepted mutual
  dependencies by reading `repo`'s own two edges as the pair that does not lift it.
- The banner comment at the top of `landscape.likec4`, which counts modules, packages and edges.

A cycle finding is different: it is edited into `src/`, or recorded in `ACCEPTED_CYCLES` in
`scripts/self-model.mjs` **with the refactor it is waiting for**. That baseline may only shrink.

## The forward flow, for a change worth documenting as a feature

An architectural change can go through loam's own lifecycle rather than being edited into the living
documents. It works end to end, and the archived result has been compared against the same edits made
by hand and found identical. Use it when the change is one somebody should be able to read back as a
decision — a new subject, a seam moved, a rule added to DESIGN — and not for a one-line edge.

Run every command from `meta/`, so config discovery finds `meta/loam.json`:

```bash
cd meta && npx tsx ../src/cli.ts new FEAT-1 --title "what changed" --touches loam
```

Then author, in `meta/docs/features/FEAT-1-what-changed/`:

- **`intent.md`** — why, in the terms a reader who has not seen the diff would need. Needs
  `feature`, `status` and `owner` in its frontmatter, or the gate warns.
- **`delta.likec4`** — the new elements and edges, each tagged `#FEAT-1`. Everything untagged is
  context for the diagram and is not merged.
- **`specs/loam/arch.spec.md`** — the rule this change establishes, as an `## ADDED Requirements`
  delta, with `Requirement-ID:`, `Covers:` lines naming real model objects, and at least one
  scenario.

Then:

```bash
cd meta && npx tsx ../src/cli.ts validate --feature FEAT-1
```

```bash
cd meta && npx tsx ../src/cli.ts delta FEAT-1 --service loam
```

```bash
cd meta && npx tsx ../src/cli.ts archive FEAT-1
```

Finish by running `npm run meta:check` from the repo root: the archive merges the delta's edges into
the landscape, so a green model is the proof that what you documented is what the tree does.

### Four frictions, measured, none of them a blocker

The scaffold and the reports are written for the fleet loam is FOR — many services, each a top-level
system. The self-model is 70 nested containers inside one bound system, so:

- **The `delta.likec4` template does not fit.** It offers `x = softwareSystem 'x'` and an edge between
  two of them. Delete all of it and re-declare the nesting the landscape uses
  (`loam { core { usecases = container 'src/core/usecases/' } }`), reusing the landscape's own
  identifiers so the merge lines up.
- **`loam new` scaffolds `specs/<svc>/spec.md`, the business axis.** This service has only the
  architectural one. Delete the scaffolded file and write `specs/loam/arch.spec.md` instead; there is
  no flag for it.
- **Every arch-edge coverage line reads `loam → loam`,** because every edge is between two containers
  inside one bound system. Correct by its own definition and useless here — the same shape as the
  fleet scorecard reporting `c4: {elements: 1}` over a 70-box model.
- **`loam verify` cannot produce a `verified` claim here, ever.** This repository's tests are vitest,
  not cucumber, so every scenario claim would be `attested`. Do not build a vitest-to-cucumber-JSON
  bridge to improve that number — the non-goals forbid exactly that, and the distinction between
  attested and tested is the one property self-hosting does not exercise.

## What is silent here, and must never be read as coverage

`meta/docs` declares no `openapi.yaml`, no `asyncapi.yaml`, no `permissions.yaml`, no
`capabilities.yaml`, no `health.yaml`, no `sources:` and no `dynamic view`. So the `api.*`, `event.*`,
`spine.*`, `permissions.*`, `capability.*`, `health.*`, `usecase.*`, `obligation.*`, `link.*` and
`glossary.*` families are quiet **because nothing asked them**, not because they passed. A green run
is two `ok` findings and two `warn`s.

The two warnings are `sources.absent` on both axes, and they are permanent: `repoDir` is the cwd only
when the config's own `service` field matches, and `meta/loam.json` sits below the tree it describes,
so the only spelling that reaches `src/` is `../src/` — which `sources.path-outside` correctly
refuses. There is no spelling that works. Provenance is dark here and maturity is capped below
`sourced`. If a third warning appears, a check that was silent has started speaking and somebody has
to decide whether it is right.

`test/self-model.test.ts` pins all of this, including the warning count.

## Two traps

**`meta/docs/AGENTS.md` is generated, and `agents.stale` grades the STAMP, not the content.** A
change to any `AGENTS_MD` section in `src/core/agent/` leaves that file behind while every command
still reports the repo healthy, because the version in its stamp still matches. In a fleet that is
somebody else's file and a version bump surfaces it; here the sections and the file are in one
repository, so one commit can move the first without the second — which is exactly what had happened
when this was written.

So after ANY edit under `src/core/agent/agents-md/` or `src/core/agent/workflows/`:

```bash
npm run meta:agents
```

CI runs `npx tsx scripts/meta-agents.ts --check`, which refuses instead of writing. A differing
STAMP refuses outright in both modes: that means the version moved, which is a release-checklist
question about what else moves with it, not a drift to paper over.

**`loam init` writes agent tooling into the cwd.** Running it inside a repository that already has a
`.claude/` gets a duplicate set. `--no-commands --no-skills` is the escape hatch.
