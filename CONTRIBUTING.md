# Contributing to Loam

Loam requires Node.js 22.22.3 or newer. Install from the lockfile with `npm ci`. Before submitting a change, run the complete gate in this order:

```sh
npm run lint
npm run typecheck
npm run arch:check
npm test
npm run test:coverage
npm run test:package
```

The one-shot `npm run setup` command performs installation, build, and a CLI smoke check. Keep changes scoped, add tests for behavior changes, and do not commit generated `dist/`, coverage, local `loam.json`, pilot fleet data, or pilot outputs containing internal paths.

Read [AGENTS.md](https://github.com/ybotok/loam/blob/main/AGENTS.md) before changing Loam itself. [docs/DESIGN.md](https://github.com/ybotok/loam/blob/main/docs/DESIGN.md) explains the module boundaries and dependency direction, while [docs/CODE-STYLE.md](https://github.com/ybotok/loam/blob/main/docs/CODE-STYLE.md) records the conventions the compiler and linter cannot enforce and the defect behind each one. Read the code-style guide before a first change to `src/`.

Three of those conventions are hard limits, counted by `test/code-limits.test.ts` inside `npm test`: at most 300 lines per source file, at most 4 parameters per function or constructor, and at most 5 files per package directory. A fourth — a branded type on every validated identifier or path — is held by the compiler instead. `test/code-limits-baseline.json` is currently empty and must remain empty: any entry is a regression, not accepted backlog. Do not add an entry to land a change.

Pull requests should explain the user-visible contract being changed, the failure mode being prevented, and the verification performed. Machine-facing CLI changes must preserve the documented JSON envelope and stable error codes or explicitly describe a versioned contract change.

## Releases

Only maintainers create release tags. A release is driven by an exact `v<package.version>` tag and the workflow in `.github/workflows/release.yml`; do not run `npm publish` from a workstation and do not add an `NPM_TOKEN` fallback. The canonical GitHub repository, protected `npm-production` environment, npm trusted publisher, changelog date, private security channel, and all release-readiness checks must be in place first.

See the [fail-closed release checklist](https://github.com/ybotok/loam/blob/main/docs/pilot/RELEASE-READINESS.md). Creating a tag or publishing a package is never part of an ordinary contribution.
