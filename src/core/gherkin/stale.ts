/**
 * What `loam validate` reports about a generated suite: which scenarios moved
 * out from under it, and which were never generated at all.
 *
 * Service-repo-scoped, and silent until a suite exists — a service that never
 * ran `loam gherkin` has not opted into the axis and is not failing it. The
 * whole comparison is by digest rather than by name, so a reworded scenario
 * reads as stale rather than as missing plus new.
 */
import { existsSync, statSync, type Dirent } from "node:fs";
import { readdir, readFile, realpath } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { parseRequirements } from "../document/parse.js";
import type { PathableService } from "../kernel/ids/service.js";
import { servicePaths, SPEC_AXES } from "../repo/paths.js";
import { listFeatures } from "../repo/repo.js";
import type { FleetContext } from "../fleet-context.js";
import type { Finding } from "../vocabulary/report.js";
import { UnsafePathError } from "../kernel/path-safety.js";
import { gherkinRoot, scenarioDigest } from "./stamp.js";
import { axisLabel } from "./emit.js";
import { parseStampedFeature, type StampedFeature } from "./read.js";
import type { DocsDir } from "../kernel/ids/dirs.js";

/**
 * The gherkin freshness chain, service-repo-scoped like `sources.*`: it needs
 * the repo (the suite lives there), and it stays quiet until
 * `<gherkinDir>/loam/` exists — a service that never generated has not opted
 * in, and silence there is honest, not vacuous.
 *
 * The LIVING specs are the reference, with one carve-out. A stamped file
 * tagged with a feature still in flight answers to that feature's delta, not
 * to the living spec its requirements have not merged into yet — so it is
 * skipped here (its regeneration is `loam gherkin <FEAT>`), and the moment the
 * feature archives, its requirements ARE living requirements, digests
 * unchanged, and the same file grades current with no rewrite. A tag naming
 * no active feature (the feature was archived, or abandoned) gets no
 * exemption: the living spec is all there is to answer to.
 *
 * Three warnings, one per way the suite and the spec can disagree, judged
 * digest-first and by requirement name second:
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
export async function gherkinFindings(ctx: {
  docsDir: DocsDir;
  service: PathableService;
  /** The service repo, when loam is standing in it. Undefined disables the chain, like sources.*. */
  repoDir?: string;
  gherkinDir?: string;
  fleet?: FleetContext;
}): Promise<Finding[]> {
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
  const paths = servicePaths(ctx.docsDir, ctx.service);
  const axes = new Map<"business" | "arch", AxisState>();
  for (const axis of SPEC_AXES) {
    const label = axisLabel(axis);
    const state: AxisState = { file: axis.file, reqNames: new Set(), digests: new Set(), scenarios: [] };
    const path = paths[axis.key];
    if (existsSync(path)) {
      const reqs = ctx.fleet === undefined
        ? parseRequirements(await readFile(path, "utf8"))
        : await ctx.fleet.readRequirements(path);
      for (const r of reqs) {
        if (r.kind === "REMOVED") continue;
        state.reqNames.add(r.name);
        for (const s of r.scenarios) {
          const digest = scenarioDigest(ctx.service, s.lines, label);
          state.digests.add(digest);
          state.scenarios.push({ req: r.name, name: s.name, digest });
        }
      }
    }
    axes.set(label, state);
  }

  // The stamped side. Every stamped digest counts toward coverage — an
  // in-flight file whose scenario matches the living words IS a test for them.
  // `Set<string>`, not the ids' own brand: this set answers membership
  // questions for tags read out of .feature files — document text.
  const active = new Set<string>((await listFeatures(ctx.docsDir, {}, ctx.fleet)).map((f) => f.id));
  const stampedDigests = { business: new Set<string>(), arch: new Set<string>() };
  const parsed: Array<{ rel: string; axis: "business" | "arch"; file: StampedFeature }> = [];
  let stampedScenarios = 0;
  for (const abs of await featureFilesUnder(root)) {
    const file = parseStampedFeature(await readFile(abs, "utf8"));
    if (file === null) continue;
    const axis = file.tags.includes("architecture") ? "arch" : "business";
    for (const s of file.scenarios) stampedDigests[axis].add(s.digest);
    stampedScenarios += file.scenarios.length;
    parsed.push({ rel: relative(ctx.repoDir, abs).split(sep).join("/"), axis, file });
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
  for (const { rel, axis, file } of parsed) {
    if (file.tags.some((t) => active.has(t))) continue;
    const state = axes.get(axis)!;
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
  if (findings.length === 0) {
    findings.push({
      severity: "ok",
      code: "gherkin.current",
      message: `${ctx.service}: generated gherkin current (${parsed.length} file(s), ${stampedScenarios} stamped scenario(s) agree with the living specs)`,
    });
  }
  return findings;
}

/**
 * Every `.feature` file at or under `root`, sorted by repo-relative path —
 * enumeration is part of the output contract, so the order cannot depend on
 * the filesystem's. Dot-entries are skipped, like every other walk in loam.
 *
 * Symlinks are FOLLOWED — repo.ts's `entryIs` and brief/brief.ts's `hasMarkdown` are
 * the same rule for the same reason. A `Dirent` from `readdir(withFileTypes)`
 * never follows one, so `isFile()` and `isDirectory()` are both false for a
 * symlinked `.feature`: it was invisible to the orphan scan (`loam gherkin`
 * left it behind forever) and invisible to the staleness scan (it graded as no
 * coverage at all). Composing a suite out of links is legitimate, so they are
 * followed rather than refused, and a dangling one is skipped exactly as an
 * absent file is.
 */
export async function featureFilesUnder(root: string): Promise<string[]> {
  const out: string[] = [];
  // Following links means a cycle is now possible; every directory is entered
  // once by its resolved path, so a loop terminates instead of hanging.
  const entered = new Set<string>();
  const walk = async (dir: string): Promise<void> => {
    if (!existsSync(dir)) return;
    let resolved: string;
    try {
      resolved = await realpath(dir);
    } catch {
      return;
    }
    if (entered.has(resolved)) return;
    entered.add(resolved);
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const abs = join(dir, entry.name);
      const what = entryKind(abs, entry);
      if (what === "dir") await walk(abs);
      else if (what === "file" && entry.name.endsWith(".feature")) out.push(abs);
    }
  };
  await walk(root);
  return out.sort((a, b) => {
    const ra = a.split(sep).join("/");
    const rb = b.split(sep).join("/");
    return ra < rb ? -1 : ra > rb ? 1 : 0;
  });
}

/** What an entry IS, resolving a symlink to find out. Nothing when it dangles. */
function entryKind(abs: string, e: Dirent): "dir" | "file" | null {
  if (!e.isSymbolicLink()) return e.isDirectory() ? "dir" : e.isFile() ? "file" : null;
  try {
    const s = statSync(abs);
    return s.isDirectory() ? "dir" : s.isFile() ? "file" : null;
  } catch {
    return null;
  }
}
