/**
 * What `loam validate` reports about a generated suite: which scenarios moved
 * out from under it, which were never generated at all, and which were edited
 * by hand after they were.
 *
 * Service-repo-scoped, and silent until a suite exists — a service that never
 * ran `loam gherkin` has not opted into the axis and is not failing it. The
 * staleness comparison is by digest rather than by name, so a reworded scenario
 * reads as stale rather than as missing plus new; the edit comparison is by
 * text, because a digest is a tag and nothing about a tag stops the words
 * under it changing.
 */
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { PathableService } from "../kernel/ids/service.js";
import { isFeatureId } from "../kernel/ids/feature.js";
import { listFeatures } from "../repo/repo.js";
import type { FeatureEntry } from "../repo/entries.js";
import { entryIs, markDescended } from "../repo/tree/fs.js";
import type { FleetContext } from "../fleet-context.js";
import type { Finding } from "../vocabulary/report.js";
import { UnsafePathError } from "../kernel/path-safety.js";
import { LOAM_VERSION } from "../envelope/version.js";
import { gherkinRoot, scenarioDigest } from "./stamp.js";
import { axisLabel, emissionInput, planEmission, type ByAxis } from "./emit.js";
import { featureSegments, handEdits, parseStampedFeature, type FeatureSegments, type StampedFeature } from "./read.js";
import type { DocsDir } from "../kernel/ids/dirs.js";

/** Where a service's generated suite is, and what it answers to. */
export interface SuiteContext {
  docsDir: DocsDir;
  service: PathableService;
  /** The service repo, when loam is standing in it. Undefined disables the chain, like sources.*. */
  repoDir?: string;
  gherkinDir?: string;
  fleet: FleetContext;
}

/** One stamped file of the suite, read once for every check below. */
interface SuiteFile {
  /** Repo-relative, `/`-separated — what a finding names. */
  rel: string;
  /** Root-relative — the file name an emission plan uses. */
  name: string;
  text: string;
  file: StampedFeature;
}

/**
 * The gherkin freshness chain, service-repo-scoped like `sources.*`: it needs
 * the repo (the suite lives there), and it stays quiet until
 * `<gherkinDir>/loam/` exists — a service that never generated has not opted
 * in, and silence there is honest, not vacuous.
 *
 * The LIVING specs are the reference, with one carve-out. A stamped file
 * tagged with a feature still in flight answers to that feature's delta, not
 * to the living spec its requirements have not merged into yet — so it is
 * skipped by the staleness half (its regeneration is `loam gherkin <FEAT>`),
 * and the moment the feature archives, its requirements ARE living
 * requirements, digests unchanged, and the same file grades current with no
 * rewrite. A tag naming no active feature (the feature was archived, or
 * abandoned) gets no exemption: the living spec is all there is to answer to.
 *
 * Four warnings, one per way the suite and the spec can disagree:
 *
 * - `gherkin.missing` — a living scenario whose digest no stamped scenario of
 *   its axis carries: the suite has no test for these words.
 * - `gherkin.stale` — a stamped scenario whose digest matches no living
 *   scenario while its file's requirement still exists: the spec moved under
 *   the generated file. (A reworded scenario therefore reports both: the old
 *   words are stale, the new words are missing — one regeneration clears
 *   both.)
 * - `gherkin.orphaned` — a whole file whose requirement no longer exists in
 *   its axis's living spec; reported once per file, because every scenario in
 *   it is moot together.
 * - `gherkin.edited` — a file whose text, under a stamp that still names
 *   current words, is not what this loam writes for those words
 *   ({@link suiteEdits}). An in-flight file is graded here too, against its own
 *   feature's delta.
 *
 * Digests are content identity within one service and one axis, deliberately:
 * two identically-worded scenarios of one service's one axis share one digest,
 * so one stamped copy covers both — while the axes stay separate namespaces
 * twice over (every comparison here is axis-scoped, and the recipe salts the
 * arch axis), and the services stay separate because the recipe salts the
 * service too. That last salt is why a stamped file copied out of another
 * service's repository grades `gherkin.orphaned`/`gherkin.stale` here instead
 * of quietly counting as this service's coverage.
 *
 * All warnings — `--strict` is the CI escalation — plus one `ok` confirmation
 * (`gherkin.current`, the `sources.current` pattern) when a generated suite
 * exists and nothing disagrees.
 */
export async function gherkinFindings(ctx: SuiteContext): Promise<Finding[]> {
  if (ctx.repoDir === undefined) return [];
  let root: string;
  try {
    root = gherkinRoot(ctx.repoDir, ctx.gherkinDir);
  } catch (err) {
    if (!(err instanceof UnsafePathError)) throw err;
    return [
      {
        severity: "error",
        code: "gherkin.path-outside",
        subject: ctx.service,
        message: `The configured Gherkin output is unsafe: ${err.message}. It must stay inside the service repo.`,
      },
    ];
  }
  if (!existsSync(root)) return [];

  // The living reference, per axis: requirement names, and scenario digests.
  interface AxisState {
    file: string;
    reqNames: Set<string>;
    digests: Set<string>;
    scenarios: Array<{ req: string; name: string; digest: string }>;
  }
  const living = await emissionInput(ctx);
  const axes = new Map<"business" | "arch", AxisState>();
  for (const { axis, reqs } of living) {
    const label = axisLabel(axis);
    const state: AxisState = { file: axis.file, reqNames: new Set(), digests: new Set(), scenarios: [] };
    for (const r of reqs) {
      state.reqNames.add(r.name);
      for (const s of r.scenarios) {
        const digest = scenarioDigest(ctx.service, s.lines, label);
        state.digests.add(digest);
        state.scenarios.push({ req: r.name, name: s.name, digest });
      }
    }
    axes.set(label, state);
  }

  // The stamped side. Every stamped digest counts toward coverage — an
  // in-flight file whose scenario matches the living words IS a test for them.
  // `Set<string>`, not the ids' own brand: this set answers membership
  // questions for tags read out of .feature files — document text.
  const features = await listFeatures(ctx.docsDir, {}, ctx.fleet);
  const active = new Set<string>(features.map((f) => f.id));
  const stampedDigests = { business: new Set<string>(), arch: new Set<string>() };
  const suite = await readSuite(root, ctx.repoDir);
  let stampedScenarios = 0;
  for (const { file } of suite) {
    const axis = file.tags.includes("architecture") ? "arch" : "business";
    for (const s of file.scenarios) stampedDigests[axis].add(s.digest);
    stampedScenarios += file.scenarios.length;
  }

  const findings: Finding[] = [];
  const regen = `\`loam gherkin --service ${ctx.service}\``;
  for (const [axis, state] of axes) {
    for (const sc of state.scenarios) {
      if (stampedDigests[axis].has(sc.digest)) continue;
      findings.push({
        severity: "warn",
        code: "gherkin.missing",
        subject: ctx.service,
        message: `${ctx.service}: scenario '${sc.name}' of requirement '${sc.req}' (${state.file}) has no generated .feature scenario — the suite has no test for these words; ${regen} regenerates it`,
      });
    }
  }
  for (const { rel, file } of suite) {
    if (file.tags.some((t) => active.has(t))) continue;
    const state = axes.get(file.tags.includes("architecture") ? "arch" : "business")!;
    if (file.featureName === null || !state.reqNames.has(file.featureName)) {
      findings.push({
        severity: "warn",
        code: "gherkin.orphaned",
        subject: ctx.service,
        message: `${ctx.service}: ${rel}: requirement '${file.featureName ?? "(unnamed)"}' no longer exists in the living ${state.file} — the whole file is orphaned; ${regen} removes it`,
      });
      continue;
    }
    for (const s of file.scenarios) {
      if (state.digests.has(s.digest)) continue;
      findings.push({
        severity: "warn",
        code: "gherkin.stale",
        subject: ctx.service,
        message: `${ctx.service}: ${rel}: scenario '${s.name}' matches no scenario in the living ${state.file} — the spec moved under the generated file; ${regen} regenerates it`,
      });
    }
  }
  const { edits, uncompared } = await suiteEdits(ctx, { suite, living, features });
  for (const edit of edits) findings.push(editedFinding(ctx.service, edit));
  if (findings.length === 0) {
    const older = uncompared === 0 ? "" : `; ${uncompared} stamped by another loam version, not compared for hand edits until regenerated`;
    findings.push({
      severity: "ok",
      code: "gherkin.current",
      message: `${ctx.service}: generated gherkin current (${suite.length} file(s), ${stampedScenarios} stamped scenario(s) agree with the living specs${older})`,
    });
  }
  return findings;
}

/** One generated file whose text is not what this loam emits for it. */
export interface GeneratedEdit {
  /** Repo-relative path. */
  rel: string;
  /** The in-flight feature the file answers to, or null for the living specs. */
  owner: string | null;
  /**
   * Digests of the scenarios that answer for the edit — the ones whose own text
   * changed, or every one in the file when the change sits above them all (a
   * hand-added Background runs before each).
   */
  digests: string[];
  /** Their names, in file order — what a reader is shown. */
  scenarios: string[];
  /** The edit is (also) above the first scenario. */
  header: boolean;
}

/**
 * The suite's hand edits, for a caller that has not read it already —
 * `loam verify --results`, which must not confirm a claim on a run of words
 * the spec never held. Empty wherever {@link gherkinFindings} is silent.
 */
export async function generatedEdits(ctx: SuiteContext): Promise<GeneratedEdit[]> {
  if (ctx.repoDir === undefined) return [];
  let root: string;
  try {
    root = gherkinRoot(ctx.repoDir, ctx.gherkinDir);
  } catch (err) {
    if (!(err instanceof UnsafePathError)) throw err;
    return [];
  }
  if (!existsSync(root)) return [];
  const suite = await readSuite(root, ctx.repoDir);
  const living = await emissionInput(ctx);
  return (await suiteEdits(ctx, { suite, living, features: await listFeatures(ctx.docsDir, {}, ctx.fleet) })).edits;
}

/** One emission plan, read back the way the files on disk are. */
interface PlanRead {
  all: FeatureSegments[];
  /** By axis and requirement name — the first file the plan writes for it. */
  requirements: Map<string, FeatureSegments>;
}

/**
 * Re-emit each stamped file in memory and compare — the check the stamp line
 * has always asked for ("do not hand-edit") and nothing performed. Emission is
 * deterministic to the byte, so what `loam gherkin` would write today IS what
 * the file held when it was written, for every scenario whose digest still
 * names current words; a scenario whose body moved is `gherkin.stale`'s, and
 * `./read.ts`'s `handEdits` skips it rather than call it an edit.
 *
 * Only a file stamped by THIS version is compared. An emitter change between
 * releases rewrites bytes nobody touched, and grading an older file against
 * newer output would accuse every file in the suite at once. The skip is
 * counted rather than silent: `gherkin.current` says how many files it did not
 * compare, because a suite nobody regenerated since the upgrade is a suite this
 * check is not looking at.
 *
 * The reference follows the staleness half's carve-out: a file tagged with a
 * feature in flight is compared with that feature's delta as `loam gherkin
 * <FEAT>` emits it; any other with the living specs, carrying the feature tag
 * it already has (an archived feature's files keep theirs until regenerated).
 * Scenarios are matched across the whole plan, so a file renamed or moved by
 * hand is still compared; its header is compared with the plan's file for the
 * same requirement, and only when the plan writes one.
 */
async function suiteEdits(
  ctx: SuiteContext,
  read: { suite: SuiteFile[]; living: ByAxis; features: FeatureEntry[] },
): Promise<{ edits: GeneratedEdit[]; uncompared: number }> {
  const plans = new Map<string, PlanRead>();
  const plan = async (owner: FeatureEntry | undefined, tag: string | undefined): Promise<PlanRead> => {
    const key = `${owner?.id ?? ""}|${tag ?? ""}`;
    const known = plans.get(key);
    if (known !== undefined) return known;
    const byAxis = owner === undefined ? read.living : await emissionInput(ctx, owner);
    const out: PlanRead = { all: [], requirements: new Map() };
    for (const p of planEmission(byAxis, { service: ctx.service, featureTag: tag, version: LOAM_VERSION })) {
      const cut = featureSegments(p.content)!;
      const req = `${axisLabel(p.axis)}\n${p.requirement.name}`;
      out.all.push(cut);
      if (!out.requirements.has(req)) out.requirements.set(req, cut);
    }
    plans.set(key, out);
    return out;
  };
  const edits: GeneratedEdit[] = [];
  let uncompared = 0;
  for (const { rel, text, file } of read.suite) {
    const disk = featureSegments(text);
    if (disk === null) continue;
    if (file.version !== LOAM_VERSION) {
      uncompared += 1;
      continue;
    }
    const owner = read.features.find((f) => file.tags.includes(f.id));
    const reference = await plan(owner, owner?.id ?? file.tags.find((t) => isFeatureId(t)));
    const req = `${file.tags.includes("architecture") ? "arch" : "business"}\n${file.featureName ?? ""}`;
    const found = handEdits(disk, { file: reference.requirements.get(req) ?? null, all: reference.all });
    const touched = disk.scenarios.filter((s) => found.header || found.digests.includes(s.digest));
    if (!found.header && touched.length === 0) continue;
    edits.push({
      rel,
      owner: owner?.id ?? null,
      digests: touched.map((s) => s.digest),
      scenarios: touched.map((s) => s.name),
      header: found.header,
    });
  }
  return { edits, uncompared };
}

/**
 * `gherkin.edited`, worded for the reader who has to decide what happened.
 * The step-definition sentence is not decoration: it is the half of the
 * loophole this check cannot close, and a reader who saw `gherkin.current`
 * would otherwise take it as covering both.
 */
function editedFinding(service: PathableService, edit: GeneratedEdit): Finding {
  const regen = edit.owner === null ? `loam gherkin --service ${service}` : `loam gherkin ${edit.owner}`;
  const reference = edit.owner === null ? "the living specs" : `${edit.owner}'s delta`;
  return {
    severity: "warn",
    code: "gherkin.edited",
    subject: service,
    message:
      `${service}: ${edit.rel}: differs from what loam v${LOAM_VERSION} emits from ${reference} — edited by hand` +
      `${edit.header ? ", above its first scenario" : ""}. The runner tests the file's words, not the spec's, so ` +
      `\`loam verify --results\` will not confirm ${edit.header ? "any scenario in it" : edit.scenarios.length === 1 ? "this scenario" : `these ${edit.scenarios.length} scenarios`}; ` +
      `\`${regen}\` restores the emitted text, and changing what is tested means changing the spec. ` +
      `Step definitions are not compared: one that checks less than its step says is invisible here.`,
    details: edit.scenarios,
    text: { detailPrefix: "- " },
  };
}

/** Every stamped `.feature` under `root`, read and parsed once. Unstamped files are not loam's, and are absent. */
async function readSuite(root: string, repoDir: string): Promise<SuiteFile[]> {
  const out: SuiteFile[] = [];
  for (const abs of await featureFilesUnder(root)) {
    const text = await readFile(abs, "utf8");
    const file = parseStampedFeature(text);
    if (file === null) continue;
    out.push({
      rel: relative(repoDir, abs).split(sep).join("/"),
      name: relative(root, abs).split(sep).join("/"),
      text,
      file,
    });
  }
  return out;
}

/**
 * Every `.feature` file at or under `root`, sorted by repo-relative path —
 * enumeration is part of the output contract, so the order cannot depend on
 * the filesystem's. Dot-entries are skipped, like every other walk in loam.
 *
 * Symlinks are FOLLOWED, through `repo/tree/fs.ts`'s `entryIs` — the rule
 * every enumeration shares (brief/brief.ts's `hasEntry` too), for the same
 * reason. A `Dirent` from `readdir(withFileTypes)` never follows one, so
 * `isFile()` and `isDirectory()` are both false for a
 * symlinked `.feature`: it was invisible to the orphan scan (`loam gherkin`
 * left it behind forever) and invisible to the staleness scan (it graded as no
 * coverage at all). Composing a suite out of links is legitimate, so they are
 * followed rather than refused, and a dangling one is skipped exactly as an
 * absent file is.
 */
export async function featureFilesUnder(root: string): Promise<string[]> {
  const out: string[] = [];
  // Following links means a cycle is now possible; every directory is entered
  // once by its resolved path (`markDescended`), so a loop terminates instead
  // of hanging.
  const entered = new Set<string>();
  const walk = async (dir: string): Promise<void> => {
    if (!markDescended(dir, entered)) return;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const abs = join(dir, entry.name);
      if (entryIs(dir, entry, "dir")) await walk(abs);
      else if (entry.name.endsWith(".feature") && entryIs(dir, entry, "file")) out.push(abs);
    }
  };
  await walk(root);
  return out.sort((a, b) => {
    const ra = a.split(sep).join("/");
    const rb = b.split(sep).join("/");
    return ra < rb ? -1 : ra > rb ? 1 : 0;
  });
}
