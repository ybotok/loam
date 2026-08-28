# Benchmarks

Numbers behind performance claims in the CHANGELOG and ROADMAP. Every table here is produced by
`npm run bench:validate` (`scripts/bench-validate.ts`) against the built CLI, and is committed
together with the change it measures — a claim like "~Nx faster" divides one committed median by
another, never by a recollection.

## The shape a fleet feels

The tables below are the method and the committed runs. This is what those numbers mean for somebody
operating a fleet — 2026-08, on a generated 120-service fleet with 400 and 800 op-linked landscape
edges and 10 active features (built CLI, 8-core laptop, idle, wall clock including Node startup — of
which ~0.16 s is Node itself): `loam list` **~0.45 s**, `loam validate --service <id>` — the command
each service repo's CI runs — **~0.6 s**, and `loam status` **~1.3 s** — it grades every active
feature's `delta.likec4`, so it costs about 0.11 s per feature *in flight* and is nearly flat in the
size of the fleet (the same 120 services with one active feature answer in ~0.34 s). The fleet gate
used to be the outlier: `loam validate --all` over 120 services took **~13–14 s** while it paid a
fresh LikeC4 workspace per service. Since the batched loader it parses the run's C4 documents in one
shared workspace and answers in **~0.7 s median** on the committed 120-service benchmark fixture —
the method, the machine and the committed runs are below (measured 2026-08-19). It is the docs
repo's own CI job and it is not on anybody's inner loop; on a machine whose cores are already busy,
expect meaningfully more. `test/scale.test.ts` gates a smaller fleet — 30 services, 10 features, 24
op-linked edges — under a 110 s wall-clock ceiling. That ceiling was calibrated against the
then-64-file parallel suite; the suite has grown since. It remains a blowup alarm for an
order-of-magnitude regression, not evidence that a two-fold slowdown is acceptable.

## Method

- **Fixture** — the synthetic fleet from `test/helpers/fleet-fixture.ts` at benchmark shape: **120
  services** (20 apiless / 40 documented / 40 sourced / 20 vouched) and **20 active features** — the
  scale suite's 5/10/10/5 + 10 shape with services ×4 and features ×2 (20/40/40/20 + 20). That is
  **141 `.likec4` documents** (1 landscape + 120 service models + 20 feature deltas) and **119
  op-linked edges** (the landscape's 99-call chain + 20 tagged feature edges). The fleet is clean:
  `validate --all` exits 0, so the runs measure grading, not error rendering.
- **Cold/warm policy** — one fresh `node dist/cli.js <args> --json` child process per run (real
  startup, no in-process warm LikeC4 state), sequential, on an otherwise idle machine; the OS page
  cache stays warm across runs.
- **Repetitions** — per command: 1 discarded warm-up, then 5 measured runs. Tables report the
  **median** of the five, with all five beside it.
- **Peak RSS** — sampled per run by polling `ps -o rss=` every 25ms; a run's peak is the largest
  sample, and the table reports the median of the five per-run peaks. Sampled, not exact
  (`/usr/bin/time -l|-v` would be exact but its flags and units differ across darwin/linux) — good
  to a few MB, which is enough for the hundreds-of-MB questions asked here.
- Every measured run is checked before its timing is kept: exit 0, parseable `--json`, `ok: true`,
  and `valid` not `false`. A failing run measures nothing.

## Baseline — one LikeC4 workspace per document (pre-batch)

Recorded before the `validate --all` batch loader landed, from the tree at the fixture-extraction
commit. This is the number the batch change's "≥2x" claim divides by.

Machine: darwin/arm64, 8× Apple M1, 8 GB RAM · node v24.13.1 · 2026-08-19

| command | median | runs (ms) | peak RSS (median of per-run peaks) |
|---|---|---|---|
| `loam validate --all --json` | 13748 ms | 13830, 13768, 13693, 13626, 13748 | 526 MB |
| `loam validate svc-21 --json` | 515 ms | 519, 510, 515, 513, 515 | 204 MB |
| `loam list --json` | 405 ms | 409, 403, 405, 403, 409 | 177 MB |

The 13.7s median reproduces the roadmap's 13–14s assessment: under `--all`, every service model,
feature delta and the landscape paid a fresh LikeC4/Langium workspace (~100ms each even warm), one
per document.

## After — one shared workspace for the whole `--all` run

Same machine, same fixture, same method, re-measured after `validate --all` started prefetching the
run's documents through `loadBatch` (`src/core/c4/workspace.ts`): one mkdtemp workspace, one
single-file project per document, one `LikeC4.fromWorkspace`. Single-service `validate` and `list`
keep their untouched per-path code, so their rows are the drift bound, not a claim.

Machine: darwin/arm64, 8× Apple M1, 8 GB RAM · node v24.13.1 · 2026-08-19

| command | median | runs (ms) | peak RSS (median of per-run peaks) |
|---|---|---|---|
| `loam validate --all --json` | 731 ms | 731, 727, 716, 731, 746 | 246 MB |
| `loam validate svc-21 --json` | 515 ms | 515, 513, 515, 513, 517 | 205 MB |
| `loam list --json` | 406 ms | 408, 408, 406, 404, 406 | 177 MB |

Exit-criteria arithmetic, against the baseline above:

- `validate --all`: 13748 ms → 731 ms = **18.8x faster** (criterion: ≥2x).
- `validate svc-21`: 515 ms → 515 ms = 0.0% drift (criterion: within 10%).
- `list`: 405 ms → 406 ms = +0.2% drift (criterion: within 10%).
- Peak RSS for `--all` **dropped** 526 MB → 246 MB: one workspace holding all 141 documents costs
  less than the serial loop's per-document workspaces, whose memory `dispose()` does not promptly
  return. The linear caveat stands: a fleet with far fatter documents scales this row linearly, and
  this table is the honest bound at the committed shape.
