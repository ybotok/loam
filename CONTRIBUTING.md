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

To work on loam itself — or to run an unreleased commit — install from a clone:

```sh
git clone https://github.com/ybotok/loam.git && cd loam
./scripts/setup.sh --link     # checks node >= 22.22.3, npm ci, build, smoke-test, npm link
```

Drop `--link` to build without a global `loam`. `npm run setup` is `bash scripts/setup.sh`, so on
Windows run `npm ci && npm run build` by hand. `npm run dev -- --help` runs the CLI from source
without building.

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

## The OpenSpec canary

[openspec-canary.yml](https://github.com/ybotok/loam/blob/main/.github/workflows/openspec-canary.yml)
is the same kind of early-warning smoke for the OpenSpec migration, weekly on Thursday with manual
dispatch. It resolves the newest `vX.Y.Z` OpenSpec tag with `git ls-remote`, shallow-clones it, and
runs `npm run test:openspec-corpus -- --baseline latest` against it. Like the LikeC4 canary it has no
push or pull-request trigger and blocks nothing. The certified claim is the exact-commit corpus job
in `ci.yml`, whose `release` pin is `OPENSPEC_BASELINES.release` in
`src/core/openspec/model/model.ts`. When the newest tag is that pin, the sweep re-checks it exactly
and the summary says there is nothing newer.

What a red run means, by failing step. A red sweep means a file in the newest upstream corpus no
longer survives the migration's read/serialize/read round trip; the log names the file. A red audit
means `audit-openspec` could not complete on OpenSpec's own workspace — a YAML, root or I/O refusal,
not a blocker, since blockers are only listed. A red resolve or clone step is infrastructure: GitHub,
or a tag scheme upstream changed. The parser-source diff never fails. It warns when upstream's
readers (`src/core/parsers/`), archive merge (`src/core/specs-apply.ts`) or validation rules
(`src/core/validation/`) moved since the pin, and it is the step to read first. The 1.13 grammar
changes appeared in no upstream spec file, so a green sweep says nothing about them.

Reproduce locally:

```sh
git clone --depth 1 --branch <tag> https://github.com/Fission-AI/OpenSpec.git /tmp/OpenSpec
npm run test:openspec-corpus -- --baseline latest /tmp/OpenSpec
npm run dev -- audit-openspec /tmp/OpenSpec
```

Moving the pin is an ordinary pull request. Run the sweep and the documented audit, mapping and
staged-apply path against the new release. Read the parser diff and give loam's OpenSpec reader
(`src/core/openspec/scan/shape.ts`) whatever grammar it shows, each with a test. Then update
`OPENSPEC_BASELINES.release` and the `release` totals in `scripts/openspec-corpus.ts`, the `ci.yml`
matrix, and the pin tables in MIGRATING-from-OpenSpec.md and `test/fixtures/openspec/README.md`.
The outgoing release becomes the `previous` pin, and the pin it displaces either gets a name of its
own or a recorded reason to go. The banner and `baselines.release` under `--json` change, so the
move needs a CHANGELOG entry.

## Releases

Only maintainers create release tags. A release is driven by an exact `v<package.version>` tag and
the workflow in `.github/workflows/release.yml`; do not run `npm publish` from a workstation and do
not add an `NPM_TOKEN` fallback. The canonical GitHub repository, protected `npm-production`
environment, npm trusted publisher, changelog date, private security channel, and all
release-readiness checks must be in place first.

See the
[fail-closed release checklist](https://github.com/ybotok/loam/blob/main/docs/RELEASE-READINESS.md).
Creating a tag or publishing a package is never part of an ordinary contribution.
