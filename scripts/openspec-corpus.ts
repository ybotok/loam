/**
 * The OpenSpec corpus gate's decisions, apart from the git checkout it reads
 * and the console it reports to. scripts/check-openspec-corpus.ts is the I/O
 * around this module; the split exists so test/openspec-compat.test.ts can hold
 * the verdict — above all the moving `latest` one — without an upstream clone.
 */
import { parseRequirements } from "../src/core/document/parse.js";
import { serializeRequirements } from "../src/core/document/spec.js";
import { OPENSPEC_BASELINES } from "../src/core/openspec/model/model.js";
import { openspecRequirements } from "../src/core/openspec/scan/shape.js";

export type CorpusTotals = { files: number; requirements: number; scenarios: number };
type Pin = { label: string; commit: string; expected: CorpusTotals };

/**
 * `release` is the certified current upstream release; the other three are the
 * older pins kept so a parser change cannot fix today's corpus by breaking a
 * corpus somebody already migrated from. Each entry is an exact commit with its
 * own totals, so a checkout can never stand in for another.
 *
 * `release` reads its commit from OPENSPEC_BASELINES rather than restating it:
 * that constant is what `audit-openspec` prints as the certified release, and
 * two spellings of one pin are how the banner and the gate behind it come to
 * name different commits. Moving the pin is that constant plus the totals here.
 *
 * `previous` is the release certified before the current one (v1.9.0, which
 * the seven vendored fixtures still come from). When the pin moves again it
 * takes the outgoing release; the one it held then needs a name of its own or
 * a recorded reason to be dropped — never a silent loss of a corpus.
 */
export const BASELINES = {
  release: {
    label: `OpenSpec v${OPENSPEC_BASELINES.release.version} release`,
    commit: OPENSPEC_BASELINES.release.commit,
    expected: { files: 223, requirements: 765, scenarios: 2475 },
  },
  previous: {
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
/**
 * A pinned baseline, or `latest`: whatever commit the checkout holds, swept
 * without a pin. `latest` exists for .github/workflows/openspec-canary.yml.
 * Every pinned mode refuses any other HEAD, which keeps the gate exact and also
 * means it can say nothing about a release newer than its pins: v1.10.0 through
 * v1.14.1 shipped with no signal from it at all. What `latest` answers is
 * whether loam still reads upstream's newest corpus; upstream's own specs never
 * used the grammar 1.13 added, so the canary's signal for THAT is the diff of
 * upstream's parser sources, which the workflow reports beside this sweep.
 */
export type SweepMode = BaselineName | "latest";
export const SWEEP_MODES: readonly SweepMode[] = [...(Object.keys(BASELINES) as BaselineName[]), "latest"];
export const isSweepMode = (value: string | undefined): value is SweepMode =>
  value !== undefined && (SWEEP_MODES as readonly string[]).includes(value);

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
 * Read every file as the migration reads it, write it as loam writes it, and
 * read that back as loam reads it.
 *
 * The first read is `openspecRequirements` — loam's grammar plus what OpenSpec
 * alone accepts (a closing `#` run, `*`/`+` REMOVED bullets) — because that is
 * the reader `audit-openspec` and `migrate-openspec --apply` use. The sweep
 * used to read with `parseRequirements` alone, so the corpus the compatibility
 * claim rests on was never passed through the reader that claim is about. On
 * every pinned corpus the two agree file for file, so no total moved.
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
    const parsed = openspecRequirements(raw);
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

const signed = (value: number): string => (value >= 0 ? `+${value}` : `${value}`);
const summary = (totals: CorpusTotals): string =>
  `${totals.files} Markdown files, ${totals.requirements} requirements, ${totals.scenarios} scenarios`;

/**
 * The gate's answer for one sweep.
 *
 * A pinned mode is exact: another HEAD is refused and any total that moved is
 * a failure, because a pinned corpus never changes and so a moved total can
 * only mean the parser did. `latest` keeps the one check that means the same
 * thing at any commit — every file's requirement content survives the round
 * trip — and REPORTS how the totals moved from the certified release instead
 * of refusing: a newer release has more requirements by design, and refusing
 * it is exactly the silence `latest` was added to end. A `latest` checkout that
 * IS a pinned commit is judged as that pin, strictly, so the canary cannot
 * pass a pinned corpus the pinned gate would fail.
 */
export function judgeSweep(mode: SweepMode, head: string, tally: CorpusTally): SweepVerdict {
  const pinnedAt = (Object.keys(BASELINES) as BaselineName[]).find((name) => BASELINES[name].commit === head);
  if (mode !== "latest" && head !== BASELINES[mode].commit) {
    return { ok: false, lines: [`OpenSpec checkout is ${head}; expected ${mode} ${BASELINES[mode].commit}`] };
  }
  if (tally.unstable.length > 0) {
    return {
      ok: false,
      lines: tally.unstable.map((path) => `requirement round-trip changed parsed content in ${path}`),
    };
  }
  const judgedAs = mode === "latest" ? pinnedAt : mode;
  if (judgedAs !== undefined) {
    const pin = BASELINES[judgedAs];
    if (JSON.stringify(tally.totals) !== JSON.stringify(pin.expected)) {
      return {
        ok: false,
        lines: [`corpus totals changed: expected ${JSON.stringify(pin.expected)}, got ${JSON.stringify(tally.totals)}`],
      };
    }
    const lines = [`ok: ${pin.label} at ${pin.commit.slice(0, 7)}: ${summary(tally.totals)}`];
    if (mode === "latest") lines.push(`this checkout is the ${judgedAs} pin, so it was swept as that pin, exactly`);
    return { ok: true, lines };
  }
  const release = BASELINES.release;
  const { files, requirements, scenarios } = tally.totals;
  return {
    ok: true,
    lines: [
      `ok: unpinned OpenSpec checkout at ${head.slice(0, 7)}: ${summary(tally.totals)}, every file round-tripped`,
      `drift since the certified ${release.label} (${release.commit.slice(0, 7)}): ` +
        `files ${signed(files - release.expected.files)}, ` +
        `requirements ${signed(requirements - release.expected.requirements)}, ` +
        `scenarios ${signed(scenarios - release.expected.scenarios)}`,
    ],
  };
}
