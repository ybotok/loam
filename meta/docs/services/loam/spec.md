---
service: loam
status: draft
owner: spentsov
---

# loam

The **living spec** for loam itself — the promises the tool makes to the people and
agents that run it, as opposed to the promises its source makes to its own
maintainers. Those are next door, in `arch.spec.md`.

Everything below is already frozen elsewhere and is restated here because a
requirement is the only shape loam can grade: `AGENTS.md`'s "What is frozen"
section is the normative text, `CHANGELOG.md` is where a change to any of it has
to be announced, and `test/codes-drift.test.ts` and
`test/agent-commands-runnable.test.ts` are what hold two of the four mechanically.
If this file and `AGENTS.md` ever disagree, `AGENTS.md` wins and this file is the
defect.

**No `sources:` line, and that is a product finding rather than an omission.** A
spec's `sources` are paths into *the service's own repository*, and loam resolves
them against `process.cwd()` when `loam.json` names that service
(`commands/validate/validate.ts`, `repoOf`). This config sits at `meta/`, one
directory *below* the tree it describes, so the only spelling that would reach
`src/` is `../src/` — which `sources.path-outside` refuses, correctly, as an
escape from the repository. So `sources.absent` warns here twice, the provenance
axis is dark, and `loam vouch` has nothing to stamp. See the banner in
`arch.spec.md` for the rest of the families in that condition.

**No `openapi.yaml`, no `asyncapi.yaml`, no `Operations:` and no `Requires:`.**
loam is a CLI: there is no HTTP surface, no message, and no authorization
vocabulary, so those four joins have nothing to join and every check built on them
is silent. Writing any of them to make a check fire is what ROADMAP.md's second
exit criterion for this axis forbids by name.

## Requirements

### Requirement: The documents outlive the tool

Requirement-ID: LOAM-PLAIN-FILES
loam SHALL keep every artifact it reads and writes as a plain file in the user's own
repository — Markdown, YAML and LikeC4 — and SHALL NOT require a server, a database,
a background synchronizer or a network call to answer any question about them.

#### Scenario: Every answer traces back to a file
- **Given** a docs repo that `loam status` reports on
- **When** a reader disbelieves any line of that report
- **Then** a file in the repository says it, and reading that file is enough to check

#### Scenario: The tool is uninstalled
- **Given** a docs repo loam has been maintaining
- **When** loam is deleted from the machine
- **Then** the architecture and the specifications still read as documents, and nothing
  in them is a pointer into storage that is now gone

### Requirement: Two exit codes, and they mean what they say

Requirement-ID: LOAM-EXIT-CODES
loam SHALL exit `0` when the command succeeded and `1` for a refusal or a gating
error, and SHALL NOT introduce a third code without a CHANGELOG entry describing the
change in the terms a user would notice.

#### Scenario: A gating failure is a failure
- **Given** a docs repo with a validation error
- **When** `loam validate --all` runs in CI
- **Then** the process exits `1` and the CI step fails

#### Scenario: A refusal is not a crash
- **Given** a command asked to do something it must refuse
- **When** it refuses
- **Then** it exits `1` with a stable error code, not with an unhandled exception

### Requirement: The --json envelope is a contract

Requirement-ID: LOAM-JSON-ENVELOPE
Every command that accepts `--json` SHALL emit an object carrying `contractVersion`,
the binary `version` and `ok`, and an `error.code` when `ok` is false; a success
payload SHALL also carry a `command` discriminator naming the verb that produced
it. Adding a payload key is allowed, and changing or removing one is a breaking
change.

#### Scenario: A script reads the same three fields it always did
- **Given** an agent script written against an earlier release
- **When** it runs `loam validate --all --json` against a later one
- **Then** `contractVersion`, `ok` and `error.code` are present and mean what they did

#### Scenario: A consumer can tell which binary answered, and which verb
- **Given** a `--json` envelope held out of context — a CI artifact, an MCP tool result
- **When** the consumer needs to know whether to apply `docs.binary-behind`'s caution
- **Then** `version` names the binary that produced it, and on a success envelope
  `command` names the verb, so no consumer has to sniff for `valid` or `services`

#### Scenario: A usage error still produces an envelope
- **Given** an unknown flag on a `--json` invocation
- **When** commander refuses to parse it
- **Then** stdout carries the error envelope rather than nothing at all

### Requirement: Stable codes are a machine surface

Requirement-ID: LOAM-STABLE-CODES
loam SHALL treat every `ErrorCode` and every `IssueCode` string as frozen — prose may
be reworded freely, codes may not — and SHALL document every code it can emit in the
agent-facing docs it generates.

#### Scenario: A code that ships undocumented is a branch nobody was told about
- **Given** a new finding code added to the vocabulary
- **When** the gate runs
- **Then** `test/codes-drift.test.ts` fails until the generated AGENTS.md and slash
  commands name it

#### Scenario: A reworded message does not break a consumer
- **Given** a consumer branching on `error.code`
- **When** the human-readable message beside that code is rewritten
- **Then** the consumer is unaffected

### Requirement: An instruction loam prints is an instruction that runs

Requirement-ID: LOAM-PRINTED-COMMANDS
Every `loam …` command line loam prints — in the generated AGENTS.md, in a slash
command body, in a `doctor` fix or a `status` next step — SHALL parse against the real
CLI, because loam instructs agents and an instruction that does not parse is a defect.

#### Scenario: A flag is renamed and a printed instruction is not
- **Given** a printed instruction naming a flag that has been renamed
- **When** the gate runs
- **Then** `test/agent-commands-runnable.test.ts` hands the line to `buildProgram()`
  and fails on the parse
