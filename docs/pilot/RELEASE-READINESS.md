# Release readiness

The release workflow is fail-closed and tag-driven. It does not publish from pull requests or branches, and only the `publish` job receives `id-token: write`; all jobs keep `contents: read`. The protected `npm-production` environment sits between the complete gate and npm publishing. Actions are pinned to full commit SHAs and checkout does not persist git credentials.

## External prerequisites

These cannot be inferred or created safely from this workspace and must be completed before any tag is created:

- verify that `https://github.com/ybotok/loam` is the canonical public repository and that `package.repository`, the release workflow, and GitHub's case-sensitive repository identity all refer to it;
- confirm continued maintainer control of the `@ybotok` npm scope and `@ybotok/loam` package;
- create/protect the GitHub `npm-production` environment and require appropriate reviewers;
- configure npm trusted publishing for the exact owner/repository, workflow filename `release.yml`, and environment `npm-production`;
- protect release tags and restrict creation of `v*` tags to release maintainers;
- verify the existing npm trusted-publisher configuration from the npm and GitHub settings; repository files alone cannot prove that external configuration is active.

Trusted publishing requires a GitHub-hosted runner, Node.js 22.14 or newer, npm 11.5.1 or newer, `id-token: write`, and `contents: read`. The workflow uses Node 24, installs npm 11.5.1 explicitly, disables release caching, configures the npm registry, and relies on npm's automatic provenance generation.

The gate builds one `.tgz`, writes its SHA-256/size/source-commit manifest, and uploads those two files as a short-lived artifact. The publish job downloads that artifact, verifies its exact contents, digest, size, tag, commit, runtime, and OIDC context, then runs `npm publish <verified.tgz>`. It does not install project dependencies, rebuild, or repack, so the bytes tested by the gate are the bytes sent to npm.

## Candidate checklist

Before tagging:

1. Bump `package.json` and `package-lock.json` to the intended version.
2. Move release notes from `Unreleased` to a dated `## [version] - YYYY-MM-DD` changelog section.
3. Complete security review and the two-fleet exit scorecard against one digest-bound `release:pack` candidate; do not substitute the blank template for evidence.
4. Confirm CI is green on Node 22.22.3 and Node 24, including the installed-tarball smoke.
5. From a clean checkout, run `npm run release:check -- --tag v<version>`. Any blocker stops the release.
6. Review `npm pack --dry-run` contents and ensure no internal pilot artifacts or credentials are present.
7. Merge the candidate. An authorized maintainer may then create the exact `v<version>` tag; the workflow performs the gate again before publishing.

For prereleases the workflow derives a non-`latest` npm dist-tag (`alpha`, `beta`, `rc`, or `next`). Stable versions use `latest`. A version is immutable: if publication is wrong, stop promotion, deprecate the bad version when appropriate, fix forward with a new version, and document the incident. Never delete and reuse a version or rerun a failed publish by weakening provenance or permissions.

After publication, verify the npm package page shows provenance, the dist-tag is correct, the tarball CLI reports the expected version, and the changelog/release record links to the immutable commit. Record verification evidence; do not infer success from a green build job alone.
