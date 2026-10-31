# loam in CI

Copy-paste pipelines for the three places a fleet asks loam something: the docs repo's pull
requests, each service repo's pull requests, and the deploy pipeline — plus the setup a cloud
coding agent needs before it starts. Every command exits 1 on what it fails and takes `--json` when
a later step wants the findings. [WORKFLOW.md](WORKFLOW.md#what-actually-gates) says what each
finding means for a pipeline; this page is the wiring.

## Contents

- [Guard the fleet's edges on every PR](#guard-the-fleets-edges-on-every-pr) — the docs repo, on
  GitHub
- [GitLab merge requests](#gitlab-merge-requests) — the same gate as a merge-request job
- [Check each service repo on its own pull requests](#check-each-service-repo-on-its-own-pull-requests)
- [Ask whether a service may deploy](#ask-whether-a-service-may-deploy)
- [Cloud agents in a service repo](#cloud-agents-in-a-service-repo)

## Guard the fleet's edges on every PR

Two commands, each installable on its own with no part of [the workflow](WORKFLOW.md) adopted. **`loam diff`
exits 1 when a pull request removes an operation or an event message the fleet still consumes**,
and names the consumers — of a removal, a deprecation, or a change to what an operation or message
returns. That question — *who is joined to this?* — is the one a fleet answers wrong, and it is
answerable only from a document that knows the whole fleet. **`loam validate --all --base <ref>`
grades only the boundaries the branch touched**, which is what lets a strict gate go in on the
first day of adoption and tighten as the system gets written down.

**At level 1 — a map seeded from `fleet.yaml`, nothing adopted yet — the gate is the spine.** The
unscoped `validate --all --spine` re-grades every join on the map against the contracts on every
PR, which takes seconds and needs no scoping: a branch that edits one contract is checked against
every caller and consumer of it, wherever they are drawn.

```yaml
# .github/workflows/fleet-joins.yml — in the docs repo
name: fleet joins
on: pull_request
jobs:
  joins:
    runs-on: ubuntu-latest
    env:
      LOAM: "@ybotok/loam@0.2.0-alpha.18"   # an exact version: bump it in a PR of its own, re-seeded
      BASE: origin/${{ github.base_ref }}
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }          # diff reads the base out of git history
      - uses: actions/setup-node@v4
        with: { node-version: 22 }        # loam's floor is Node 22.22.3; `22` is the newest 22.x
      # every join on the map against the contracts at both ends (fails on a wrong one)
      - run: npx -y "$LOAM" validate --all --spine
      # a removed operation or message somebody still consumes (fails, naming them)
      - if: ${{ !cancelled() }}
        run: npx -y "$LOAM" diff --base "$BASE"
      # fleet.yaml and the committed map say the same thing (drop this step once the map is hand-owned)
      - if: ${{ !cancelled() }}
        run: npx -y "$LOAM" seed --from fleet.yaml && test -z "$(git status --porcelain)"
```

The last step keeps `fleet.yaml` in the docs repo honest: re-seeding an unedited map from the same
file with the same loam version writes the same bytes, so a PR that changed one without the other
leaves a dirty tree. A loam release may reword the comment seed writes at the top of the map, so
the PR that moves the pinned version re-seeds and commits the map with it. A
`--spine` run that checked no join says so in words (`joins: none stated`) rather than reading as a
pass. Once services are adopted, `--spine` also sets aside their own findings, so a partly adopted
fleet adds the scoped gate below for what it has written down.

**Once adoption starts, the scoped gate grades what each PR touched.** A PR that adds a service's
`openapi.yaml` stays red under `--base` until that service has a `model.likec4` — the gate grades
the service the PR touched, and `service.no-model` is that ratchet working as designed — while a PR
that only changes joins on the map is graded on those edges alone.

```yaml
# .github/workflows/fleet-edges.yml — in the docs repo
name: fleet edges
on: pull_request
jobs:
  edges:
    runs-on: ubuntu-latest
    env:
      LOAM: "@ybotok/loam@0.2.0-alpha.18"   # an exact version: bump it in a PR of its own
      BASE: origin/${{ github.base_ref }}
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }          # every step reads the base out of git history
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      # did you remove something an authored consumer still names? (fails) — and
      # who is joined to each operation or message you changed? (warns, naming them)
      - run: npx -y "$LOAM" diff --base "$BASE"
      # did you document what you touched?
      - run: npx -y "$LOAM" validate --all --base "$BASE" --strict
      # does a changed operation break its readers? oasdiff answers that; loam does not
      - run: |
          for spec in $(git diff --name-only --diff-filter=M "$BASE"... -- 'services/*openapi.yaml'); do
            git show "$BASE:./$spec" > "$RUNNER_TEMP/base.yaml"
            docker run --rm -v "$RUNNER_TEMP:/base:ro" -v "$PWD:/head:ro" tufin/oasdiff \
              breaking /base/base.yaml "/head/$spec" --fail-on ERR
          done
```

**Pin loam, and move the pin on purpose.** An unpinned `npx -y @ybotok/loam` runs whatever the
`latest` tag points at on the day the job starts, so a release can change what gates your pull
requests in the middle of a review. Bump `LOAM` in a pull request of its own: run
`loam subsystem sync` with the new version, update the `<!-- generated by loam vX.Y.Z -->` stamp
in the docs repo's `AGENTS.md`, and read the release's CHANGELOG entry, which opens with what a
repository notices after upgrading. Pin the oasdiff image's tag the same way.

Three steps, three different questions, and none is another's cheaper form. `diff` reports every
removal against the fleet's authored consumers — landscape edges, other services' living
requirements, use-case hops — rather than against a rule list, which is why it repays installation
before anything else exists. It names who is joined to a changed operation or message, and it never
says whether the change breaks them: loam does not read what a schema says, so a renamed required
field and a new optional one are the same warning to it. That half is oasdiff's, and
`asyncapi diff`'s for event contracts. A caller drawn on the map with no operation on its edge is
listed as one nobody could check, never counted as no caller. `validate --base` grades the
boundaries this branch changed, at full strictness, and says out loud how much of the system that
was — a run with nothing in scope prints that it graded nothing rather than the word valid.
Unscoped, neither setting is usable on a partly-documented system: `loam validate --all` is green
over boundaries nobody has written yet, because warnings do not gate, and `--strict` over all of
them is red from the first minute of adoption until the last one is done.

An archive's PR stays red under `--base --strict` until its re-vouches land: the merge moves every
vouched spec it touches under its vouch stamp, so `content.stale` follows, and `loam archive` names
each such spec and its owner (`revouchOwed`) so those re-vouches can join the same PR.

**A `--base`-scoped validate cannot see a victim boundary the change did not touch.** Remove an
operation `payment-service` owns, and `checkout-web` — whose living requirement still names it —
is not in scope, so nothing in that gate reports the broken join. That is `loam diff --base`'s
question, it stays `loam diff --base`'s, and a green scoped validate is not a statement about the
consumers of what changed. A join the branch itself *wrote* is the other case: a call edge it adds
or edits in `architecture/` is graded against its provider's contract even with the provider out of
scope, so the one-letter `authorisePayment` of
[QUICKSTART's first ten minutes](QUICKSTART.md#2-ten-minutes-cli-only-the-fleet-spine) fails on the
PR that introduces it.
[WORKFLOW.md](WORKFLOW.md#what-actually-gates) has what each does and
does not grade — including the oasdiff invocation for the byte-level OpenAPI breaking-change
catalogue, which loam deliberately does not reimplement.

## GitLab merge requests

The same level-1 gate as a merge-request job. Every command exits 1 on what it fails, which is all
a GitLab job needs; `--json` is there when a later step wants the findings.

```yaml
# .gitlab-ci.yml — in the docs repo
fleet-joins:
  image: node:24                  # loam's floor is Node 22.22.3
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  variables:
    GIT_DEPTH: "0"                # --base reads history; a shallow clone may not hold the base commit
    LOAM: "@ybotok/loam@0.2.0-alpha.18"
  script:
    - npx -y "$LOAM" validate --all --spine
    - npx -y "$LOAM" diff --base "$CI_MERGE_REQUEST_DIFF_BASE_SHA"
    - npx -y "$LOAM" seed --from fleet.yaml && test -z "$(git status --porcelain)"
```

A base commit the clone does not hold refuses with `unknown-target` rather than comparing against
nothing. Unlike the GitHub job, a failing script line stops the ones after it. On an air-gapped
runner, point `NPM_CONFIG_REGISTRY` at the internal npm proxy and `image:` at the registry mirror;
loam itself makes no network call.

## Check each service repo on its own pull requests

The docs repo's job cannot see provenance. `sources` resolve only inside a service's own
repository, so `sources.stale` — the code under a vouched spec moved — surfaces only in that
service repo's CI ([SCHEMA.md](SCHEMA.md), "Operating at fleet scale"). Its committed `loam.json`
reaches the docs repo through a relative `docsDir` such as `"../docs"`, so the job rebuilds the
side-by-side layout a laptop has. `actions/checkout` refuses `path: ../docs` — it writes only
beneath `GITHUB_WORKSPACE` — so check out **both** repositories as subdirectories of the workspace,
siblings, and run loam from the service's:

```yaml
# .github/workflows/loam.yml — in each service repo
name: loam
on: pull_request
jobs:
  docs:
    runs-on: ubuntu-latest
    env:
      LOAM: "@ybotok/loam@0.2.0-alpha.18"   # the docs repo's pin: move them together
      SERVICE: payment-service              # this repo's "service" in its loam.json
    steps:
      # Both repositories as siblings under the workspace, the way a laptop holds
      # them, so the committed "docsDir": "../docs" resolves unchanged.
      - uses: actions/checkout@v4
        with: { path: payment-service }
      - uses: actions/checkout@v4
        with:
          repository: acme/docs                       # your docs repo
          path: docs                                  # the last segment of docsDir
          token: ${{ secrets.LOAM_DOCS_READ_TOKEN }}  # contents: read on the docs repo
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - name: loam validate --service
        working-directory: payment-service
        run: |
          rc=0
          npx -y "$LOAM" validate --service "$SERVICE" --json > "$RUNNER_TEMP/loam.json" || rc=$?
          # one annotation per error and warning; a refusal (docs-missing, …) is one error
          jq -r '
            def esc: gsub("%"; "%25") | gsub("\r"; "%0D") | gsub("\n"; "%0A");
            if .ok then
              .targets[].findings[] | select(.severity != "ok")
              | "::\(if .severity == "error" then "error" else "warning" end) title=\(.code)::\(.message | esc) (docs: \(.locations[0].path))"
            else "::error title=\(.error.code)::\(.error.message | esc)" end
          ' "$RUNNER_TEMP/loam.json"
          # the same findings as a table on the run's summary page
          jq -r '
            if .ok then
              "### loam validate --service \(.targets[0].id) — \(.summary.errors) error(s), \(.summary.warnings) warning(s)",
              "", "| severity | code | finding |", "|---|---|---|",
              (.targets[].findings[] | select(.severity != "ok")
                | "| \(.severity) | `\(.code)` | \(.message | gsub("\\|"; "\\|") | gsub("\n"; " ")) |")
            else "### loam refused: `\(.error.code)`", "", .error.message end
          ' "$RUNNER_TEMP/loam.json" >> "$GITHUB_STEP_SUMMARY"
          exit "$rc"
```

Run from a `payment-service` checkout beside `examples/docs`, in a repository with no
`src/main/java/` — the source that service's specs name — the step exits 1 and prints:

```text
::warning title=spine.op-link-missing::payment-service: landscape edge checkout-web → payment-service ("Calls the payment API") has no operation link (metadata { op }) (docs: services/payment-service)
::error title=sources.path-missing::payment-service: spec.md: 1 source(s) do not exist — src/main/java/ (docs: services/payment-service)
::error title=sources.path-missing::payment-service: arch.spec.md: 1 source(s) do not exist — src/main/java/ (docs: services/payment-service)
```

The annotations carry no `file=`, on purpose: every location loam reports is a path in the docs
repo, which is not the repository this pull request diffs, so GitHub could not place one on a line
here. They land on the check run and its summary instead. A docs repo that is private needs a token
that can read it — a fine-grained token or a GitHub App token with `contents: read` on that one
repository — because the workflow's own `GITHUB_TOKEN` reads only the repository it runs in. Add
`--strict` once the service is vouched and its warnings are ones you mean to keep at zero; before
that, the warnings are the adoption still to do.

## Ask whether a service may deploy

The service-repo layout above answers the deploy question too. In the deploy pipeline, check the
docs repo out with `fetch-depth: 0` — `--since` is read from its git history — and ask whether this
service may ship:

```bash
npx -y "$LOAM" gate --service "$SERVICE" --since "$DOCS_SHA_OF_LAST_DEPLOY"
```

`gate` executes nothing and writes nothing, and without `--strict` its warnings stay advisory;
[WORKFLOW.md](WORKFLOW.md#what-actually-gates) says what each finding of it means for a pipeline.

## Cloud agents in a service repo

A cloud agent in a service repo needs the same sibling on disk before it starts: a lone clone
of the service answers every docs-reading command with `docs-missing`. GitHub's Copilot coding
agent and Codex cloud each start from the one repository the task names and run a setup step you
own, so clone the docs repo there, into the committed `docsDir`. Copilot reads the job
`copilot-setup-steps` from `.github/workflows/copilot-setup-steps.yml` on the default branch —
`loam init --copilot-setup` writes it once, filled in from `loam.json` and the docs repo's `origin` —
and an
[Agents secret](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/configure-secrets-and-variables)
reaches those steps as an environment variable:

```yaml
# .github/workflows/copilot-setup-steps.yml — in each service repo
name: Copilot setup steps
on: workflow_dispatch
jobs:
  copilot-setup-steps:
    runs-on: ubuntu-latest
    permissions: { contents: read }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm install -g @ybotok/loam@0.2.0-alpha.18
      # "../docs" is outside the workspace, so git clone rather than actions/checkout;
      # the second command takes the token back out of the clone's config
      - run: |
          git clone --depth 1 "https://x-access-token:${LOAM_DOCS_READ_TOKEN}@github.com/acme/docs.git" ../docs
          git -C ../docs remote set-url origin https://github.com/acme/docs.git
      - run: loam doctor
```

Codex cloud has no workflow file: the same commands go in the environment's setup script, with
the token as an environment **secret** — Codex hands secrets to the setup script only and removes
them before the agent phase, which is all a clone needs. Pin Node.js to 22 or newer in the
environment's package versions, and spell the target from the repository root, because where the
script starts is not documented:

```bash
npm install -g @ybotok/loam@0.2.0-alpha.18
DOCS="$(git rev-parse --show-toplevel)/../docs"
git clone --depth 1 "https://x-access-token:${LOAM_DOCS_READ_TOKEN}@github.com/acme/docs.git" "$DOCS"
git -C "$DOCS" remote set-url origin https://github.com/acme/docs.git
loam doctor
```

The clone is the agent's reading, not a second place it can deliver. A cloud agent opens its pull
request against the repository it was started in, so anything it writes into the docs checkout —
a verification record, a spec edit — stays in its sandbox. `loam-implement`'s own outputs, the
generated Gherkin and the code, land in the service repo as usual; what belongs in the docs repo
goes there through that repo's own pull request.
