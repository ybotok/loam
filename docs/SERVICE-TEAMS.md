# For service teams

Your repository is one service in a fleet whose architecture, requirements and contracts live in a
shared docs repo. This is the part of loam you use from your side; the rest belongs to whoever
runs the docs repo. [WORKFLOW.md](../WORKFLOW.md) has the whole protocol.

**Once, beside the docs repo checkout:**

```bash
loam init --docs ../docs --service <your-id> --agent-profile service
loam doctor
```

Commit `loam.json` and the agent files it writes. `--agent-profile service` installs the five
entry points that run in a service repo and leaves out feature authoring and shipping, which happen
in the docs repo. CI runs the same checks on every pull request: the
[service-repo recipe](../CI.md#check-each-service-repo-on-its-own-pull-requests).

| Command | When |
|---|---|
| `loam status` | What to do next. Each `next[]` row names the literal command, or the edit still owed |
| `loam validate --service <id>` | Grade your service's documents against the fleet's |
| `loam vouch --service <id>` | You have read the baseline: `draft` becomes `verified`. A person, never the agent. `--pack` prints what changed since the last vouch |
| `loam doctor` | Anything surprising. It prints the state, the resolved docs path, the code and a `fix:` line |

| Slash command | When |
|---|---|
| `/loam-adopt <id>` | Once: an agent reads the code and writes the baseline as `draft` |
| `/loam-implement <FEAT> <id>` | A feature touches your service: generated Gherkin first, then tests, then code |
| `/loam-check` | Validate and fix what it reports, code by code |
| `/loam-verify <FEAT>` | The code is built: answer the feature's checklist with evidence |
| `/loam-report` | loam or the agent misbehaved: a sanitized local report, uploaded nowhere |

Gemini spells them `/loam:adopt`, Amazon Q `@loam-adopt`, a skills-only host `$loam-adopt`.

**Before you vouch, know what you are signing.**

- **Green means the documents agree, not that they are true.** `validate` proves every
  `Operations:` line names an operationId your `openapi.yaml` defines, and every call into you that
  names an operation on the fleet map names one you have. The source files it reads, it only
  digests; nothing interprets your code.
- **Completeness is unchecked.** One endpoint documented out of thirty passes every check. Holding
  the baseline against what the service really does is the review, and only you can do it.
- **`sources` is the agent's claim about what it read.** Your vouch stamps a digest of those files,
  so `sources.stale` can fire when the code under the spec moves. Nothing checks that anyone read
  them.
- **`attested` is not `verified`.** In a feature's done-check, `verified` is a test run answering a
  digest-stamped scenario; `attested` is an agent's word with `file:line` evidence. Both are kept,
  and neither turns into the other.
- **A re-vouch is owed when the words move.** An archive into your spec moves it under your stamp
  (`content.stale`). `loam vouch --pack` shows exactly what changed.
- `loam adopt --service <id>` prints the list of what no check covers. Read it once.

**The codes you will meet.** Any other: `loam explain <code>`.

| Code | Means | Do |
|---|---|---|
| `docs-missing` | refusal: `docsDir` points at nothing | clone the docs repo there, or fix `loam.json` |
| `service.no-model` | error: no `model.likec4` yet | `/loam-adopt` |
| `service.no-spec` | warn: no living `spec.md` yet | `/loam-adopt` |
| `requirements.missing-scenarios` | error: a requirement with no scenario | add one; never delete the requirement |
| `spine.op-undefined` | error: a call into you names an operation your OpenAPI lacks | fix the edge or add the endpoint |
| `spine.op-link-missing` | warn: a caller's edge names no operation | `metadata { op '<operationId>' }` on the edge |
| `api.ungoverned` | warn: an operation no `Operations:` line names | write the requirement, or link an existing one |
| `openapi.generated-stale` | warn: your build's contract differs from the committed copy | review the named operationIds, copy it across |
| `sources.unvouched` | warn: the baseline has never been vouched | read it, then `loam vouch` |
| `sources.stale` | warn: code under a vouched spec changed | re-read those paths, fix the spec, re-vouch |
| `sources.path-missing` | error: a listed source no longer exists | the code moved: re-read it, update the doc |
| `content.stale` | warn: the spec's words changed after the vouch | `loam vouch --pack`, read, re-vouch |
| `gherkin.stale`, `gherkin.missing` | warn: the generated suite is behind the scenarios | `loam gherkin --service <id>`; never hand-edit it |
| `gherkin.edited` | warn: a generated file was edited by hand — `verify --results` will not confirm its edited scenarios | regenerate; to change what is tested, change the spec |
| `gate.feature-unverified` | warn: a feature touching you has nothing confirmed | `/loam-verify <FEAT>` |
