<img src="https://raw.githubusercontent.com/ybotok/loam/main/docs/assets/loam-logo.png" alt="loam logo: a seedling whose leaves are diagram nodes, rooted in layered soil" width="128" align="right">

# loam

**One docs repo for a system of many services — C4 architecture, API contracts and requirements as
plain files, checked by a CLI to still agree. Your agent writes them; loam checks them.**

![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![node: >=22.22.3](https://img.shields.io/badge/node-%3E%3D22.22.3-brightgreen.svg)
[![CI](https://github.com/ybotok/loam/actions/workflows/ci.yml/badge.svg?branch=main&event=push)](https://github.com/ybotok/loam/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@ybotok/loam/alpha.svg?label=npm%20alpha)](https://www.npmjs.com/package/@ybotok/loam)

With coding agents writing the code, the bottleneck has moved to context. A change that crosses
three services means reading the architecture, a pile of OpenAPI files and the requirements — and
then keeping all of it in sync, which in practice nobody does.

## What it is

loam is a CLI that keeps a system's design documents in one docs repository, as plain files:

- the C4 architecture model, in [LikeC4](https://likec4.dev);
- each service's OpenAPI and AsyncAPI contracts;
- requirements, with Gherkin scenarios.

No server, no database, no network calls: delete loam and the files still make sense. A fleet of
services, one modular monolith, or a mix of both — the lifecycle is the same.

> **Early alpha, MIT.** Works with Claude Code, Cursor, GitHub Copilot, Codex, Gemini CLI and other
> agent tools. If you run a fleet and try loam, or can tell why it would not fit yours,
> [open an issue](https://github.com/ybotok/loam/issues).

## How it works

The documents point at each other through exact tokens spelled in two places: a call between two
services names an `operationId` that must exist in the provider's OpenAPI contract, a requirement's
`Covers:` names a C4 element, and so on. loam reads those joins and does two things with them:

- **It checks, deterministically, that the documents still agree.** A call naming an operation the
  provider does not define is an error, and a pull request that removes an operation another
  service still consumes fails, naming the consumer.
- **It hands over only the slice a change needs.** `loam context <service>` assembles one service's
  requirements, contracts and the edges around it, and `loam delta <FEAT> --service <id>` projects a
  feature onto one service — what an agent or a reviewer reads instead of the whole corpus.

loam never guesses what code means: an agent reads the code and writes the docs, and loam checks
the result. Work moves in two directions:

```text
adopt  (once per service):  code → brief → an agent writes the docs as draft → a person vouches
change (per feature):       intent → C4 delta → Gherkin → tests → code → verify → archive
```

`loam init` installs slash commands and Agent Skills for the AI tools it finds in the repository —
`/loam-adopt`, `/loam-feature`, `/loam-implement`, `/loam-check`, `/loam-verify`, `/loam-ship` — and
every command takes `--json` with stable finding codes, so an agent branches on a code, not on prose.

Green means the documents agree with each other — never that they are true, and never that they are
complete. `loam verify` keeps two answers apart for good: **verified**, a green test run answered
the scenario, and **attested**, an agent's word with its evidence.

## Install

Node ≥ 22.22.3 is the only prerequisite.

```bash
npm install -g @ybotok/loam
loam --version
```

Per repository instead: `npm i -D @ybotok/loam`, then `npx loam …`.

> **Pre-release: `0.2.0-alpha.18`** is the version this checkout's `package.json` names. Whether npm
> serves it is not something this file can know, so **the npm dist-tags are the source of truth**:
> `npm view @ybotok/loam dist-tags` prints them, and `npm i @ybotok/loam@alpha` installs the newest
> prerelease that published.

## Quick start

See it work on the example fleet that ships inside the package:

```bash
loam init --example ./loam-demo
cd loam-demo && loam validate --all     # 0 errors, 10 deliberate warnings
```

[`examples/README.md`](https://github.com/ybotok/loam/blob/main/examples/README.md) is the guided
tour of what each service, feature and warning is there to show. Then try it on your own code:

```bash
loam init --docs loam-docs --create --service commerce-app
```

That scaffolds a docs repo at `loam-docs/` and binds this repository to the id `commerce-app`.
`init` ends by printing the first hour, which is this loop:

```bash
loam adopt --service commerce-app --json   # the brief: an agent reads the code, writes the baseline as draft
loam validate --service commerce-app       # grade the result in this repo
loam vouch --service commerce-app          # you, not the agent: draft -> verified
loam status                                   # what to do next, derived from the files
```

[QUICKSTART.md](QUICKSTART.md) is the whole path — including ten minutes with the CLI alone that
catch a misspelt operation between two services from nothing but a `fleet.yaml` and the contracts
you already have.

## Documentation

- [QUICKSTART.md](QUICKSTART.md) — from install to the first agent-driven change.
- [WORKFLOW.md](WORKFLOW.md) — how work moves: day zero for a fleet, what gates and what only
  advises, the six workflows, the agent entry points, and every command with its flags.
- [CI.md](CI.md) — pipelines for the docs repo, each service repo, deploys and cloud agents.
- [SCHEMA.md](SCHEMA.md) — the docs-repo layout, each artifact's grammar, and the rules behind them.
- [docs/SERVICE-TEAMS.md](https://github.com/ybotok/loam/blob/main/docs/SERVICE-TEAMS.md) — one
  screen for a team whose repository is one service in the fleet.
- [COMPARISON.md](COMPARISON.md) — where loam fits beside the tools around it, each treated as a
  neighbouring specialist rather than a rival.
- [MIGRATING-from-OpenSpec.md](MIGRATING-from-OpenSpec.md) — moving an OpenSpec repo onto loam.
- [ROADMAP.md](ROADMAP.md) — priorities, non-goals and known limits.
- [CHANGELOG.md](CHANGELOG.md) — released beta.1–alpha.18 plus the changes on `main` under
  `[Unreleased]`.
- [docs/BENCHMARKS.md](https://github.com/ybotok/loam/blob/main/docs/BENCHMARKS.md) — what a
  fleet-sized run costs, and what each payload loam hands an agent weighs.

## Contributing

Issues and pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) has the local setup, the
full gate and what a reviewable change looks like.

## Security

Do not put vulnerability details in a public issue. Report privately through
[GitHub Private Vulnerability Reporting](https://github.com/ybotok/loam/security/advisories/new);
[SECURITY.md](SECURITY.md) says what to include and what to leave out.

## License

[MIT](LICENSE). Published as [`@ybotok/loam`](https://www.npmjs.com/package/@ybotok/loam): the
unscoped `loam` name belongs to an unrelated package.
