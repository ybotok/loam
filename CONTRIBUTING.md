# Contributing to Loam

Loam requires Node.js 22.22.3 or newer. Install from the lockfile with `npm ci`. Before submitting a
change, run the complete gate in this order:

```sh
npm run lint
npm run typecheck
npm run arch:check
npm test
npm run test:coverage
npm run test:package
```

The one-shot `npm run setup` command performs installation, build, and a CLI smoke check. Keep
changes scoped, add tests for behavior changes, and do not commit generated `dist/`, coverage, local
`loam.json`, fleet data, or command outputs containing internal paths.

Read [AGENTS.md](https://github.com/ybotok/loam/blob/main/AGENTS.md) before changing Loam itself.
[docs/DESIGN.md](https://github.com/ybotok/loam/blob/main/docs/DESIGN.md) explains the module
boundaries and dependency direction, while
[docs/CODE-STYLE.md](https://github.com/ybotok/loam/blob/main/docs/CODE-STYLE.md) records the
conventions the compiler and linter cannot enforce and the defect behind each one. Read the
code-style guide before a first change to `src/`.

Three of those conventions are hard limits, counted by `test/code-limits.test.ts` inside `npm test`:
at most 400 lines per source file, at most 4 parameters per function or constructor, and at most 5
files per package directory. A fourth — a branded type on every validated identifier or path — is
held by the compiler instead. `test/code-limits-baseline.json` is currently empty and must remain
empty: any entry is a regression, not accepted backlog. Do not add an entry to land a change.

Pull requests should explain the user-visible contract being changed, the failure mode being
prevented, and the verification performed. Machine-facing CLI changes must preserve the documented
JSON envelope and stable error codes or explicitly describe a versioned contract change.

## The LikeC4 canary

[likec4-canary.yml](https://github.com/ybotok/loam/blob/main/.github/workflows/likec4-canary.yml) is
a weekly scheduled workflow (manual dispatch included) that installs `likec4@latest` over the exact
lockfile pin and runs the LikeC4-touching suites against it, then the committed 120-service
benchmark as informational evidence in the run's step summary. It is an early-warning smoke,
explicitly not the gate: the gate and every release run against the exact 1.59.2 lockfile pin, the
canary has no push or pull-request trigger — so it can never post a status on a pull request or
become a required check — and a red canary blocks nothing. When the npm latest equals the pin, every
step after the version comparison is skipped and the summary says nothing new was tested.

What a red run means, by failing step. A red typecheck means likec4's type surface moved. A red
`likec4-batch-parity.test.ts` means the undocumented multi-project workspace behaviour the batch
loader leans on — per-folder configs, per-project model parsing, error attribution by source path —
moved upstream; that suite was designed as this exact tripwire. A red `scale.test.ts` is the
superlinear blow-up alarm. A failure in the version-comparison or install steps is infrastructure
(usually the npm registry), not upstream drift. The benchmark step never fails on timing —
wall-clock thresholds on shared runners measure the host, not the code — only on a run that is
itself unsound.

Reproduce a red locally:

```sh
npm ci
npm install --no-save likec4@latest
npx vitest run test/likec4-batch-parity.test.ts   # or the workflow's full suite list
```

then `npm ci` again to restore the pinned tree — the overlay install mutates `node_modules` without
touching the lockfile.

A red has three honest outcomes: fix the adapter and bump the pin in an ordinary pull request (a pin
bump is a user-visible dependency change and needs a CHANGELOG entry); stay pinned and record the
blocked version in ROADMAP.md or an issue; or, when only the canary's own plumbing broke, fix the
workflow. When adding a new suite that touches LikeC4, extend the workflow's suite list in the same
change. GitHub disables scheduled workflows after sixty days without repository activity, so after a
quiet stretch check that the canary is still enabled.

## Releases

Only maintainers create release tags. A release is driven by an exact `v<package.version>` tag and
the workflow in `.github/workflows/release.yml`; do not run `npm publish` from a workstation and do
not add an `NPM_TOKEN` fallback. The canonical GitHub repository, protected `npm-production`
environment, npm trusted publisher, changelog date, private security channel, and all
release-readiness checks must be in place first.

See the
[fail-closed release checklist](https://github.com/ybotok/loam/blob/main/docs/RELEASE-READINESS.md).
Creating a tag or publishing a package is never part of an ordinary contribution.
