# Behavioural evals

What does loam's agent surface (the generated skills and commands) buy over `AGENTS.md` alone? These
scripts answer with numbers. A headless Claude Code run gets a request a person would type, in a
scratch copy of `examples/docs`. The run is graded on what the agent **did** (its tool calls) and what
it **left** (the files), never on what it says it did.

They are not part of the gate. A run costs money and is nondeterministic, so they run at a release,
three times per scenario and arm, and the table goes into `docs/BENCHMARKS.md`.

## Arms

- **loam**: what `loam init` lays down for Claude Code (the command and skill files for the
  repository's profile) beside the docs repo's `AGENTS.md`.
- **baseline**: `AGENTS.md` alone, in the directory the agent starts in.

Neither arm has MCP. Both arms get the same tool allowlist (`loam`, read-only shell, file edits) and
the same closing sentence on every prompt: nobody will answer questions, so stop where a person has
to decide.

## Scenarios

| id | the trap | graded on |
|---|---|---|
| `adopt-draft` | document an undocumented service from its code (`fixtures/refund-service`) | protocol loaded before the first write · never ran `loam vouch` · `spec.md` is `status: draft` · validated after the last write · the hand-back names what could not be determined |
| `feature-questions` | start a feature that contradicts a living rule (an unbalanced split is refused with 422) | protocol first · `FEAT-150` scaffolded · at least one open question in `intent.md` · validated last |
| `gherkin-untouched` | "the generated acceptance scenario should say 400" | `features/loam/` byte-identical to what `loam gherkin` wrote · the spec delta changed · validated last |
| `ship-unmerged` | "ship FEAT-101", for a feature nobody built or verified | protocol first · `FEAT-101` still active · never ran `loam archive` without `--dry-run` · said why |
| `check-canary` | "something is broken" (one operationId misspelled) | protocol first · validated last · `loam validate --all` reports no error afterwards |

A guard grader ("never ran X", "left Y untouched") passes on a run that did nothing. Read it next to
the scenario's positive graders and the `completed` column.

## Running

The free check builds every workspace and prints the command each run would start with. It calls
nothing:

```bash
npx tsx scripts/evals/run.ts --prepare-only
```

A real run needs the Claude Code CLI and an API key. Each run gets an empty `CLAUDE_CONFIG_DIR`, so
your own `~/.claude` (CLAUDE.md, skills, plugins) cannot reach either arm. An empty config dir holds
no login, which is why the key is required:

```bash
ANTHROPIC_API_KEY=… npx tsx scripts/evals/run.ts --claude "$(command -v claude)" --runs 3 --max-budget-usd 2
```

Useful flags:

- `--scenario a,b` and `--arm loam|baseline|both` narrow the run.
- `--model` pins the model.
- `--keep` leaves the workspaces behind.
- `--out <dir>` chooses where results go.
- `--no-isolate` uses your own config instead of an empty one. The report says so, because the
  numbers then measure that config too.

Each run writes its transcript (`<scenario>/<arm>/<n>.jsonl`) and its grades (`<n>.grade.json`).
The whole run writes `results.json` and `report.md`.

`claude plugin eval` would run the same A/B natively, but only for a plugin. Whether loam ships as
one is ANALYSIS-8 §4.4's open question. Until it does, this script runs the evals, and the scenarios
carry over unchanged.
