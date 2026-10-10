/**
 * The OpenSpec corpus gate's decisions, apart from the git checkout it reads
 * and the console it reports to. scripts/check-openspec-corpus.ts is the I/O
 * around this module; the split exists so a test can hold the verdict without
 * an upstream clone.
 */
import { parseRequirements } from "../src/core/document/parse.js";
import { serializeRequirements } from "../src/core/document/spec.js";

export type CorpusTotals = { files: number; requirements: number; scenarios: number };
type Pin = { label: string; commit: string; expected: CorpusTotals };

/**
 * `release` is the certified current upstream release; `legacy` and `canary`
 * are the older pins kept so a parser change cannot fix today's corpus by
 * breaking a corpus somebody already migrated from. Each entry is an exact
 * commit with its own totals, so a checkout can never stand in for another.
 */
export const BASELINES = {
  release: {
    label: "OpenSpec v1.9.0 release",
    commit: "2826b8889e5223a9a8095d4428b60b56597e1020",
    expected: { files: 211, requirements: 746, scenarios: 2317 },
  },
  legacy: {
    label: "OpenSpec v1.7.0 release",
    commit: "4e16790d90d8f54d4773ad9a5e71a57cd9f1e86b",
    expected: { files: 207, requirements: 739, scenarios: 2273 },
  },
  canary: {
    label: "OpenSpec post-v1.7 main canary",
    commit: "45cca5db6137ed209117cc70510eb3e057fb981b",
    expected: { files: 209, requirements: 742, scenarios: 2284 },
  },
} as const satisfies Record<string, Pin>;

export type BaselineName = keyof typeof BASELINES;
export const BASELINE_NAMES = Object.keys(BASELINES) as BaselineName[];
export const isBaselineName = (value: string | undefined): value is BaselineName =>
  value !== undefined && value in BASELINES;

/** The tracked Markdown the sweep reads: living, active and archived spec trees. */
export function corpusPaths(tracked: readonly string[]): string[] {
  return tracked.filter(
    (path) =>
      /^openspec\/specs\/.+\.md$/.test(path) ||
      /^openspec\/changes\/.+\/specs\/.+\.md$/.test(path),
  );
}

export interface CorpusTally {
  totals: CorpusTotals;
  /** Files whose requirement content changed across the round trip. */
  unstable: string[];
}

/**
 * Parse every file, write it as loam writes it, and parse that back.
 *
 * serializeRequirements emits living-spec blocks, so delta kinds and outer
 * sections intentionally disappear. The compatibility claim is about the
 * requirement/scenario content, with only edge whitespace normalized.
 */
export function tallyCorpus(files: ReadonlyArray<{ path: string; raw: string }>): CorpusTally {
  const project = (requirements: ReturnType<typeof parseRequirements>) =>
    requirements.map(({ name, text, scenarios, operations }) => ({
      name,
      text: text.join("\n").trim(),
      scenarios: scenarios.map((scenario) => ({
        name: scenario.name,
        body: scenario.lines.join("\n").trim(),
      })),
      operations,
    }));
  const totals: CorpusTotals = { files: files.length, requirements: 0, scenarios: 0 };
  const unstable: string[] = [];
  for (const { path, raw } of files) {
    const parsed = parseRequirements(raw);
    const reparsed = parseRequirements(serializeRequirements(parsed));
    if (JSON.stringify(project(parsed)) !== JSON.stringify(project(reparsed))) unstable.push(path);
    totals.requirements += parsed.length;
    totals.scenarios += parsed.reduce((sum, requirement) => sum + requirement.scenarios.length, 0);
  }
  return { totals, unstable };
}

export interface SweepVerdict {
  ok: boolean;
  lines: string[];
}

const summary = (totals: CorpusTotals): string =>
  `${totals.files} Markdown files, ${totals.requirements} requirements, ${totals.scenarios} scenarios`;

/**
 * The gate's answer for one sweep. A pinned corpus never changes, so another
 * HEAD is refused and any total that moved is a failure: it can only mean the
 * parser did.
 */
export function judgeSweep(name: BaselineName, head: string, tally: CorpusTally): SweepVerdict {
  const pin = BASELINES[name];
  if (head !== pin.commit) {
    return { ok: false, lines: [`OpenSpec checkout is ${head}; expected ${name} ${pin.commit}`] };
  }
  if (tally.unstable.length > 0) {
    return {
      ok: false,
      lines: tally.unstable.map((path) => `requirement round-trip changed parsed content in ${path}`),
    };
  }
  if (JSON.stringify(tally.totals) !== JSON.stringify(pin.expected)) {
    return {
      ok: false,
      lines: [`corpus totals changed: expected ${JSON.stringify(pin.expected)}, got ${JSON.stringify(tally.totals)}`],
    };
  }
  return { ok: true, lines: [`ok: ${pin.label} at ${pin.commit.slice(0, 7)}: ${summary(tally.totals)}`] };
}
