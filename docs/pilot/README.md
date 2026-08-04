# Two-fleet pilot

This pilot is an evidence-gathering exercise, not a claim that Loam has already worked in production. No fleet result is committed here. The harness records only runs it actually executes, always leaves human assessment as `not-assessed`, and never marks the pilot complete.

## Fleet selection

Choose two independent, owner-approved fleets; toy fixtures and two views of the same docs repository do not qualify.

1. **Brownfield adoption:** at least five services and at least three currently populated maturity states (`empty`, `partial`, `documented`, `sourced`, `vouched`). It should expose adoption/provenance friction rather than only a clean greenfield path.
2. **Active cross-service change:** at least five services, at least one active feature, and at least one active feature touching two or more services. It should exercise the dependency and fleet-validation path on real in-flight artifacts.

Never copy proprietary docs into this repository. Run the harness where the fleets already live, keep scorecards in an access-controlled location, and review paths and stderr before sharing them.

## Reproducible run

Use a clean checkout at the exact candidate commit and Node.js 22.22.3 or newer. Pack one immutable candidate, smoke those exact bytes, then copy `manifest.example.json` outside this repository, replace every placeholder, and declare thresholds before seeing results.

```sh
npm ci
npm run pilot:check
npm run release:pack -- --out /secure/loam-candidate
npm run test:package -- --tarball /secure/loam-candidate/spentsov-loam-0.1.0-beta.1.tgz
npm run pilot:run -- --artifact-dir /secure/loam-candidate --manifest /secure/pilot-manifest.json --out /secure/baseline-scorecard.json
```

`release:pack` refuses a dirty tracked worktree and binds the tarball manifest to the checked-out commit. The harness verifies that manifest and tarball digest, installs the candidate into a fresh isolated dependency tree, and executes only that installed CLI. The scorecard records both the tarball SHA-256 and the complete installed runtime-tree digest, so a stale or modified local `dist/` or dependency cannot masquerade as the candidate.

The output path must not exist and must be outside both measured fleet repositories and docs directories. Each fleet runs `doctor`, `list`, `validate --all`, and `dependencies` twice with `--json`. The scorecard records the candidate identity, environment, exit codes, durations, stdout hashes, selection metrics, and a before/after docs-tree hash. `.git` is excluded from the content hash; symlinks are hashed as links and are not followed.

A baseline may set `requireValid` to `false`: existing findings are evidence to classify, not a reason to hide the fleet. An exit manifest must set it to `true` for both fleets. Keep the same fleet identities and declared thresholds between phases.

## Acceptance criteria

Automated exit gates for both fleets:

- every execution produces the v1.0 successful JSON envelope without a crash;
- repeated read commands have identical exit codes and stdout hashes;
- the docs-tree hash is unchanged;
- the predeclared service, maturity, active-feature, cross-service-feature, and validation-time thresholds pass;
- `doctor` is healthy and `validate --all` reports `valid: true`.

Human exit gates, recorded separately for each fleet in `SCORECARD.md`:

- at least one representative operator completes the profile task without undocumented maintainer intervention;
- every validator finding is classified, with false positives at or below 10% of classified findings;
- no P0/P1 integrity, security, or data-loss defect occurs;
- the operator can explain the source of truth, next action, and any refusal without private implementation guidance;
- pilot owners approve the privacy review and the remaining defects have named owners and release disposition.

The automated scorecard alone is never approval. A release decision requires a reviewed human scorecard for both fleets, links to the stored machine artifacts, and explicit disposition of every failed or waived criterion.
