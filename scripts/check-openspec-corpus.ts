import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { parseRequirements, serializeRequirements } from "../src/core/spec.js";

type BaselineName = "release" | "canary";
type CorpusTotals = { files: number; requirements: number; scenarios: number };
const BASELINES: Record<
  BaselineName,
  { label: string; commit: string; expected: CorpusTotals }
> = {
  release: {
    label: "OpenSpec v1.7.0 release",
    commit: "4e16790d90d8f54d4773ad9a5e71a57cd9f1e86b",
    expected: { files: 207, requirements: 739, scenarios: 2273 },
  },
  canary: {
    label: "OpenSpec main canary",
    commit: "45cca5db6137ed209117cc70510eb3e057fb981b",
    expected: { files: 209, requirements: 742, scenarios: 2284 },
  },
};

let baselineName: BaselineName = "canary";
let checkoutArg = process.env.OPENSPEC_CHECKOUT;
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg === "--baseline") {
    const value = process.argv[++index];
    if (value !== "release" && value !== "canary") {
      throw new Error("--baseline must be release or canary");
    }
    baselineName = value;
  } else if (!checkoutArg) {
    checkoutArg = arg;
  } else {
    throw new Error(`unexpected argument: ${arg}`);
  }
}
const baseline = BASELINES[baselineName];
if (!checkoutArg) {
  console.error("usage: npm run test:openspec-corpus -- [--baseline release|canary] /path/to/OpenSpec");
  console.error(`release: ${BASELINES.release.commit}`);
  console.error(`canary:  ${BASELINES.canary.commit}`);
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
