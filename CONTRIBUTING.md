# Contributing to Loam

Loam requires Node.js 22.22.3 or newer. Use the lockfile and start with:

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run test:package
```

The one-shot `npm run setup` command performs installation, build, and a CLI smoke check. Keep changes scoped, add tests for behavior changes, and do not commit generated `dist/`, coverage, local `loam.json`, pilot fleet data, or pilot outputs containing internal paths.

`docs/CODE-STYLE.md` records the conventions the compiler and linter cannot enforce, and the defect behind each one. Read it before a first change to `src/`.

Three of those conventions are hard limits, counted by `test/code-limits.test.ts` inside `npm test`: at most 300 lines per source file, at most 4 parameters per function or constructor, and at most 5 files per package directory. A fourth — a branded type on every validated identifier or path — is held by the compiler instead. Pre-existing violations of the counted three are listed in `test/code-limits-baseline.json`, which may only shrink: the test fails on a stale entry as well as on a new violation, so the list cannot become permanent. Do not add an entry to land a change.

Pull requests should explain the user-visible contract being changed, the failure mode being prevented, and the verification performed. Machine-facing CLI changes must preserve the documented JSON envelope and stable error codes or explicitly describe a versioned contract change.

## Releases

Only maintainers create release tags. A release is driven by an exact `v<package.version>` tag and the workflow in `.github/workflows/release.yml`; do not run `npm publish` from a workstation and do not add an `NPM_TOKEN` fallback. The canonical GitHub repository, protected `npm-production` environment, npm trusted publisher, changelog date, private security channel, and all release-readiness checks must be in place first.

See `docs/pilot/RELEASE-READINESS.md` for the fail-closed checklist. Creating a tag or publishing a package is never part of an ordinary contribution.
