# loam quick start

From installation to the first agent-driven change, with the smallest useful setup. This guide
uses one application and a local docs directory. A real fleet normally keeps that directory in a
separate repository; the commands and chat flow stay the same.

## 1. Install

loam requires Node 22.22.3 or newer.

```bash
npm install -g @ybotok/loam
loam --version
```

A project-local install works too: `npm install --save-dev @ybotok/loam`, then replace `loam` below
with `npx loam`.

## 2. Wire one project

Run this in the code repository you want to govern:

```bash
loam init --docs loam-docs --create --service commerce-app
loam doctor
```

This creates a docs repo under `loam-docs/`, binds the current code checkout to the governed
boundary `commerce-app`, and installs command and Agent Skill pointers for the AI tools it detects.
Commit the generated `loam.json`, agent files and docs directory. Use your real stable service or
application id instead of `commerce-app`.

`--create` is only for a new docs repo. To join an existing shared docs repo, use:

```bash
loam init --docs ../architecture-docs --service commerce-app
loam doctor
```

## 3. Adopt what already exists

In chat, use the explicit entry point:

```text
/loam-adopt commerce-app
```

The agent loads the version-matched protocol, asks loam for an adoption brief, reads the code, writes
the baseline as draft, and validates it. It must report what it did not inspect or could not prove.
The agent does not vouch for its own work. After reviewing the baseline, a person runs:

```bash
loam vouch --service commerce-app
```

Most hosts use `/loam-adopt`; Gemini uses `/loam:adopt`, Amazon Q uses `@loam-adopt`, and a
skills-only host can use `$loam-adopt`. A natural-language request such as “adopt commerce-app into
loam” may load the same skill automatically, but the explicit spelling is the predictable path.

## 4. Make the first change

For this one-project setup, stay in the wired code repo: its `loam.json` resolves `loam-docs/`, and
its generated agent entries are already present. In a separately cloned team docs repo, run
`loam init` there once to install that repo's own entries before starting chat.

```text
/loam-feature FEAT-101 "Split payments"
```

The agent explores the living model before it proposes anything, scaffolds the feature, authors its
intent and deltas, and validates the result. Then use the remaining entry points as the work moves:

```text
/loam-implement FEAT-101 commerce-app
/loam-check FEAT-101
/loam-verify FEAT-101
/loam-ship FEAT-101
```

`loam-implement` runs in each affected code checkout. `loam-check`, `loam-verify` and `loam-ship`
read the files and machine envelopes rather than relying on conversational memory. Shipping begins
with an archive dry run and still waits for the code merge and any human-only decision.

At any point, this is the reliable way to resume:

```bash
loam status --json
```

Its ordered `next[]` is the work queue. The agent runs an entry only when `next[].execution.runnable`
is true; edits, work in another checkout and human review stay visibly different.

## 5. When something behaves badly

Use the support entry point; it is not another lifecycle step:

```text
/loam-report
```

Or ask naturally: “Create a loam problem report for what just happened.” The generated
`loam-report` Agent Skill preserves the symptom, collects `loam --version`, `loam doctor --json`,
relevant status and the smallest safe reproduction, and writes a separate file:

```text
loam-reports/NNN-YYYY-MM-DD-short-symptom.md
```

`NNN` is the report's ordinal — at least three digits, zero-padded, one more than the highest
already in the directory, which
`loam doctor` reports together with how many reports are open, sent, fixed or superseded — and a
`Status: open` line in the header is where the report's own state is kept (`doctor` reads it from
the header block above the first `##` heading, never from a quoted template inside the body). The report records
expected versus actual behavior, stable codes, relevant locations, write state, classification and
missing evidence. It replaces secrets with `<redacted>`, prefers repo-relative
paths, does not copy source/spec bodies, does not retry a writer merely to reproduce it, and never
uploads or submits anything automatically. Review the file before sharing or committing it.

If the report command or skill file is missing after an upgrade, rerun `loam init`. loam refreshes
only pointers whose recorded digest still matches; a file your team edited remains untouched.

## What to read next

- [WORKFLOW.md](WORKFLOW.md) explains the complete lifecycle and human/agent boundary.
- [SCHEMA.md](SCHEMA.md) defines every docs-repo artifact and join.
- [COMPARISON.md](COMPARISON.md) explains where loam fits beside neighboring tools.
- [MIGRATING-from-OpenSpec.md](MIGRATING-from-OpenSpec.md) covers an OpenSpec migration.

Three rules prevent most surprises: use `--create` only once, let a human vouch, and branch on JSON
codes rather than message prose.
