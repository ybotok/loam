import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { parseRequirements } from "../src/core/document/parse.js";
import { serializeRequirements } from "../src/core/document/spec.js";

type CorpusTotals = { files: number; requirements: number; scenarios: number };
/**
 * `release` is the certified current upstream release; `legacy` and `canary`
 * are the older pins kept so a parser change cannot fix today's corpus by
 * breaking a corpus somebody already migrated from. Each entry is an exact
 * commit with its own totals, so a checkout can never stand in for another.
 */
const BASELINES = {
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
} as const satisfies Record<string, { label: string; commit: string; expected: CorpusTotals }>;
type BaselineName = keyof typeof BASELINES;
const NAMES = Object.keys(BASELINES) as BaselineName[];
const isBaselineName = (value: string | undefined): value is BaselineName =>
  value !== undefined && value in BASELINES;

let baselineName: BaselineName = "release";
let checkoutArg = process.env.OPENSPEC_CHECKOUT;
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg === "--baseline") {
    const value = process.argv[++index];
    if (!isBaselineName(value)) throw new Error(`--baseline must be one of ${NAMES.join(", ")}`);
    baselineName = value;
  } else if (!checkoutArg) {
    checkoutArg = arg;
  } else {
    throw new Error(`unexpected argument: ${arg}`);
  }
}
const baseline = BASELINES[baselineName];
if (!checkoutArg) {
  console.error(`usage: npm run test:openspec-corpus -- [--baseline ${NAMES.join("|")}] /path/to/OpenSpec`);
  for (const [name, pin] of Object.entries(BASELINES)) console.error(`${name.padEnd(8)} ${pin.commit}`);
  process.exit(2);
}

const checkout = realpathSync(resolve(checkoutArg));
function git(...args: string[]): string {
  return execFileSync("git", ["-C", checkout, ...args], { encoding: "utf8" }).trim();
}

const head = git("rev-parse", "HEAD");
if (head !== baseline.commit) {
  throw new Error(`OpenSpec checkout is ${head}; expected ${baselineName} ${baseline.commit}`);
}

const tracked = git("ls-files").split("\n").filter(Boolean);
const files = tracked.filter(
  (path) =>
    /^openspec\/specs\/.+\.md$/.test(path) ||
    /^openspec\/changes\/.+\/specs\/.+\.md$/.test(path),
);
const dirty = git("status", "--porcelain", "--", "openspec/specs", "openspec/changes");
if (dirty) throw new Error("OpenSpec corpus paths have local modifications; use a clean checkout");

let requirementCount = 0;
let scenarioCount = 0;

for (const path of files) {
  const parsed = parseRequirements(readFileSync(resolve(checkout, path), "utf8"));
  const reparsed = parseRequirements(serializeRequirements(parsed));
  // serializeRequirements emits living-spec blocks, so delta kinds and outer
  // sections intentionally disappear. The compatibility claim is about the
  // requirement/scenario content, with only edge whitespace normalized.
  const project = (requirements: typeof parsed) =>
    requirements.map(({ name, text, scenarios, operations }) => ({
      name,
      text: text.join("\n").trim(),
      scenarios: scenarios.map((scenario) => ({
        name: scenario.name,
        body: scenario.lines.join("\n").trim(),
      })),
      operations,
    }));

  if (JSON.stringify(project(parsed)) !== JSON.stringify(project(reparsed))) {
    throw new Error(`requirement round-trip changed parsed content in ${path}`);
  }
  requirementCount += parsed.length;
  scenarioCount += parsed.reduce((sum, requirement) => sum + requirement.scenarios.length, 0);
}

const actual = { files: files.length, requirements: requirementCount, scenarios: scenarioCount };
if (JSON.stringify(actual) !== JSON.stringify(baseline.expected)) {
  throw new Error(
    `corpus totals changed: expected ${JSON.stringify(baseline.expected)}, got ${JSON.stringify(actual)}`,
  );
}

console.log(
  `ok: ${baseline.label} at ${baseline.commit.slice(0, 7)}: ` +
    `${actual.files} Markdown files, ${actual.requirements} requirements, ${actual.scenarios} scenarios`,
);
