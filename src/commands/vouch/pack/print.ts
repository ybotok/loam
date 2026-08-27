/**
 * The reading pack's two renderings — the human view in the proposal's order
 * (per axis: the body diff, then the source worklist, then the sections
 * already covered; first vouch: the fleet map's claims, then everything), and
 * the `--json` envelope. `runPack` is the whole command surface of
 * `--pack`: vouch.ts hands over here as soon as the flag combination is
 * legal, so the write path's machinery — identity, prompt, lock, journal —
 * never loads for a run that cannot write. Exit 0 covers every computed pack
 * INCLUDING full-read fallbacks ("read everything" is an answer, not a
 * failure); only refusals exit 1.
 */
import { emitJson, fail } from "../../../core/envelope/json.js";
import type { DocsDir } from "../../../core/kernel/ids/dirs.js";
import type { PathableService } from "../../../core/kernel/ids/service.js";
import type { LandscapeEdge } from "../../../core/vocabulary/maturity.js";
import { plural } from "../../policy/format.js";
import type { PackAxis, PackReport } from "./contract.js";
import type { PackSample } from "./sections.js";
import { buildPack } from "./pack.js";

export interface RunPackRequest {
  docsDir: DocsDir;
  service: PathableService;
  repoDir: string;
  json: boolean;
  /** `--sample <n>`: print the reading list for a SAMPLED vouch rather than the whole one. */
  sample?: number;
}

export async function runPack(req: RunPackRequest): Promise<void> {
  const outcome = await buildPack({
    docsDir: req.docsDir,
    service: req.service,
    repoDir: req.repoDir,
    ...(req.sample === undefined ? {} : { sample: req.sample }),
  });
  if (!outcome.ok) return fail(req.json, outcome.code, outcome.message);
  if (req.json) {
    emitJson(packPayload(outcome.report));
    return;
  }
  printPack(outcome.report);
}

/** The additive `--json` shape: `mode: "pack"` beside the write path's stamp payload. */
function packPayload(report: PackReport): Record<string, unknown> {
  return {
    command: "vouch",
    mode: "pack",
    service: report.service,
    packMode: report.packMode,
    pendingCommit: report.pendingCommit,
    spec: axisPayload(report.spec),
    archSpec: report.archSpec === null ? null : axisPayload(report.archSpec),
    ...(report.landscape === null ? {} : { landscape: report.landscape }),
  };
}

/** One axis, stamp fields under their frontmatter spellings. */
function axisPayload(axis: PackAxis): Record<string, unknown> {
  return {
    path: axis.path,
    file: axis.file,
    ...(axis.vouchedBy === undefined ? {} : { vouched_by: axis.vouchedBy }),
    ...(axis.lastVerified === undefined ? {} : { last_verified: axis.lastVerified }),
    body: axis.body,
    sources: axis.sources,
    skipped: axis.skipped,
    ...(axis.headings === undefined ? {} : { headings: axis.headings }),
    ...(axis.vouchScope === undefined ? {} : { vouchScope: axis.vouchScope }),
    ...(axis.sample === undefined ? {} : { sample: axis.sample }),
  };
}

function printPack(report: PackReport): void {
  // Before anything else: a pack computed over a half-committed docs repo may
  // be describing bytes the next journaled writer will replace, and a person
  // must know that before they spend a read on it.
  if (report.pendingCommit) {
    console.log(
      "⚠ an interrupted docs-repo commit is pending — what is on disk (this pack included) may " +
        "predate it. Any journaled docs-repo writer (`loam vouch`, `loam archive`) rolls it " +
        "forward on its next run; re-run --pack after.\n",
    );
  }
  if (report.packMode === "first-vouch") {
    console.log(`${report.service} first-vouch reading pack — the whole document is the read\n`);
    printLandscape(report);
  } else {
    console.log(`${report.service} re-vouch reading pack\n`);
  }
  for (const axis of [report.spec, ...(report.archSpec === null ? [] : [report.archSpec])]) {
    printAxis(axis);
  }
  console.log(
    `\nWhen the read is done, a person runs \`loam vouch --service ${report.service}\` in the service's own repo — the pack stamps nothing.`,
  );
}

/** The fleet map's claims — first, because the spec's author did not write them. */
function printLandscape(report: PackReport): void {
  if (report.landscape === null) return;
  if (report.landscape.kind === "silent") {
    console.log(`  ${report.landscape.reason}\n`);
    return;
  }
  const { inbound, outbound } = report.landscape;
  if (inbound.length === 0 && outbound.length === 0) {
    console.log(`  the fleet map draws no edge touching ${report.service}\n`);
    return;
  }
  console.log("  what the fleet map says:");
  for (const edge of inbound) console.log(`      ${edgeLine(edge.service, report.service, edge)}`);
  for (const edge of outbound) console.log(`      ${edgeLine(report.service, edge.service, edge)}`);
  console.log("");
}

function edgeLine(from: string, to: string, edge: LandscapeEdge): string {
  const label = edge.op !== null ? ` (${edge.op})` : edge.title !== null ? ` — ${edge.title}` : "";
  return `${from} -> ${to}${label}`;
}

/** One axis in the proposal's order: (a) body, (b) source worklist, (c) already covered. */
function printAxis(axis: PackAxis): void {
  console.log(`${axis.path}\n`);
  printBody(axis);
  printSources(axis);
  printSkipped(axis);
  printSampledStamp(axis);
  printCovered(axis);
  // Under `--sample` the sampled list REPLACES the full heading listing —
  // printing both would make the list a person must not skip look like the
  // one they may. The diff above is never filtered: a sample narrows what the
  // stamp CLAIMS, never what a reader is shown.
  if (axis.sample !== undefined) {
    printSample(axis.sample);
  } else if (axis.headings !== undefined) {
    console.log(`  sections to read (${axis.headings.length}):`);
    for (const heading of axis.headings) console.log(`      ${heading}`);
    console.log("");
  }
}

/**
 * The forward sample: exactly what the `--sample <n>` vouch after this pack
 * will stand behind. The consequences are named in one line rather than
 * restated at length — `sample/print.ts` says them in full at the prompt,
 * which is the screen where somebody is about to commit to them.
 */
function printSample(sample: PackSample): void {
  if (sample.covers) {
    console.log(`  sampled read: the sample reaches all ${sample.of} section(s) — the vouch after it is an ordinary full one.\n`);
    return;
  }
  console.log(`  sampled read — ${sample.headings.length} of ${sample.of} section(s), seed=${sample.seed}:`);
  console.log("      the preamble above the first heading — always read, never part of the count");
  for (const heading of sample.headings) console.log(`      ${heading}`);
  console.log(
    `\n  Reading only these is what --sample means, and the stamp will say so: \`vouch_scope: sampled ` +
      `${sample.headings.length}/${sample.of}\`, then \`sources.sampled-vouch\` until somebody reads the whole document.\n`,
  );
}

/**
 * The last vouch's own scope, printed BEFORE the covered list it disqualifies
 * — which sections that person actually read (`sections.ts`'s `priorScope`
 * recomputes them from the stamped seed), and which have now survived a vouch
 * without anybody looking. Where the read set cannot be recomputed, no
 * covered set is named at all: an unreproducible sample licenses nothing.
 */
function printSampledStamp(axis: PackAxis): void {
  const scope = axis.vouchScope;
  if (scope === undefined) return;
  const whose = `${axis.vouchedBy === undefined ? "" : ` by ${axis.vouchedBy}`}${axis.lastVerified === undefined ? "" : ` on ${axis.lastVerified}`}`;
  console.log(
    scope.scope === null
      ? `  ⚠ the last vouch${whose} carries a vouch_scope this loam cannot read (\`${scope.stamped}\`) — graded as ` +
          "SAMPLED, because an unreadable scope must never be taken for a full read."
      : `  ⚠ the last vouch${whose} was SAMPLED: ${scope.scope.sections} of ${scope.scope.of} section(s), ` +
          `seed=${scope.scope.seed}. "Unchanged since then" does not mean anybody read it.`,
  );
  if (scope.read === null) {
    console.log("      which sections it read cannot be recomputed (the body moved, or the scope does not decode), so nothing here is covered.\n");
    return;
  }
  console.log(`      read at that vouch (${scope.read.length}): ${scope.read.join(" · ")}`);
  if (scope.unread !== null && scope.unread.length > 0) {
    console.log(`      NEVER read by anyone (${scope.unread.length}) — this is the read:`);
    for (const heading of scope.unread) console.log(`          ${heading}`);
  }
  console.log("");
}

function printBody(axis: PackAxis): void {
  const since = axis.lastVerified === undefined ? "the stamp" : axis.lastVerified;
  switch (axis.body.kind) {
    case "unchanged":
      // The qualification is the whole point after a sampled vouch: the text
      // did not move, and most of it was still never read. Saying "nothing to
      // re-read" over that would be this feature's worst failure — a partial
      // read reported as a finished one — so the sentence stops at what it
      // can actually claim and hands off to the scope block below.
      console.log(
        axis.vouchScope === undefined
          ? `  body unchanged since ${since} — nothing of the document itself to re-read\n`
          : `  body unchanged since ${since} — but that vouch was sampled, so "unchanged" is not "read"\n`,
      );
      return;
    case "full-read":
      console.log(`  full read: ${axis.body.reason}\n`);
      return;
    case "diff": {
      // "The file's diff", not "the body's": a hand edit to the header after
      // the vouch rides along in git's hunks, and promising body-only would
      // make truthful noise read as a bug.
      console.log(
        `  body changed since ${since} — the file's diff from its last vouched state (${axis.body.ancestorCommit.slice(0, 12)}):\n`,
      );
      console.log(axis.body.diff.trimEnd());
      const { changed, added, removed } = axis.body.sections;
      const summary = [
        ...(changed.length > 0 ? [`changed: ${changed.join(", ")}`] : []),
        ...(added.length > 0 ? [`added: ${added.join(", ")}`] : []),
        ...(removed.length > 0 ? [`removed: ${removed.join(", ")}`] : []),
      ];
      if (summary.length > 0) console.log(`\n  sections ${summary.join("; ")}`);
      console.log("");
      return;
    }
  }
}

function printSources(axis: PackAxis): void {
  switch (axis.sources.kind) {
    case "unchanged":
      console.log("  sources unchanged since the stamp\n");
      return;
    case "unvouched":
      console.log("  sources carry no sources_digest yet — the vouch will stamp one\n");
      return;
    case "unavailable":
      console.log(`  sources — the re-vouch will refuse until this is fixed:\n      ${axis.sources.reason}\n`);
      return;
    case "uncounted":
      console.log(
        `  sources changed — ${axis.sources.countThen === null ? "an unknown number of" : axis.sources.countThen} file(s) at the stamp, ` +
          `${axis.sources.countNow} now, and the stamp cannot name which moved: re-read the sources\n`,
      );
      return;
    case "delta": {
      const { added, changed, removed } = axis.sources;
      const moved = added.length + changed.length + removed.length;
      // movedSources' one-column annotated layout, so a reader who knows the
      // stale finding's shape reads this without learning a second one.
      console.log(`  sources — ${moved} path(s) moved since the stamp:`);
      for (const path of added) console.log(`      added    ${path}`);
      for (const path of changed) console.log(`      changed  ${path}`);
      for (const path of removed) console.log(`      removed  ${path}`);
      console.log("");
      return;
    }
  }
}

/**
 * The hole in the promise, said BEFORE the stamp rather than only on
 * vouch.ts's post-stamp screen: paths under the listed sources the digest
 * will not hash. Same sentence as that screen, so the pre-vouch and
 * post-vouch descriptions of one hole cannot drift apart.
 */
function printSkipped(axis: PackAxis): void {
  if (axis.skipped.length === 0) return;
  console.log(`  ⚠ ${plural(axis.skipped.length, "path")} under those sources went unhashed — the vouch's digest says nothing about what is behind them:`);
  for (const skip of axis.skipped) console.log(`      ${skip.path} — ${skip.reason}`);
  console.log("");
}

/** (c): what the previous vouch already covers, so the read can stop where it should. */
function printCovered(axis: PackAxis): void {
  if (axis.body.kind !== "diff" || axis.body.sections.unchanged.length === 0) return;
  const by = axis.vouchedBy === undefined ? "" : ` by ${axis.vouchedBy}`;
  const on = axis.lastVerified === undefined ? "" : ` on ${axis.lastVerified}`;
  // The licence to skip rests entirely on somebody having read the section
  // before. A sampled vouch did not read most of them, so after one this list
  // is only "text that did not move" — it is still worth printing (a reader
  // wants to know what is stable), but it must not be printed under a heading
  // that says a person covered it.
  console.log(
    axis.vouchScope === undefined
      ? `  unchanged — previously vouched${by}${on}:`
      : `  unchanged since the sampled vouch${by}${on} — text that did not move, NOT a covered list:`,
  );
  for (const heading of axis.body.sections.unchanged) console.log(`      ${heading}`);
  console.log("");
}
