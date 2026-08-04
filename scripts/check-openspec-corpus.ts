import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { parseRequirements, serializeRequirements } from "../src/core/spec.js";

const PINNED_COMMIT = "45cca5db6137ed209117cc70510eb3e057fb981b";
const EXPECTED = { files: 157, requirements: 614, scenarios: 1846 };

const checkoutArg = process.argv[2] ?? process.env.OPENSPEC_CHECKOUT;
if (!checkoutArg) {
  console.error("usage: npm run test:openspec-corpus -- /path/to/OpenSpec");
  console.error(`expected OpenSpec commit ${PINNED_COMMIT} (v1.7.0)`);
  process.exit(2);
}

const checkout = realpathSync(resolve(checkoutArg));
function git(...args: string[]): string {
  return execFileSync("git", ["-C", checkout, ...args], { encoding: "utf8" }).trim();
}

const head = git("rev-parse", "HEAD");
if (head !== PINNED_COMMIT) {
  throw new Error(`OpenSpec checkout is ${head}; expected pinned commit ${PINNED_COMMIT}`);
}

const tracked = git("ls-files").split("\n").filter(Boolean);
const files = tracked.filter(
  (path) =>
    /^openspec\/specs\/.+\.md$/.test(path) ||
    /^openspec\/changes\/archive\/[^/]+\/specs\/.+\.md$/.test(path),
);
const dirty = git("status", "--porcelain", "--", "openspec/specs", "openspec/changes/archive");
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
if (JSON.stringify(actual) !== JSON.stringify(EXPECTED)) {
  throw new Error(
    `corpus totals changed: expected ${JSON.stringify(EXPECTED)}, got ${JSON.stringify(actual)}`,
  );
}

console.log(
  `ok: OpenSpec v1.7.0 corpus at ${PINNED_COMMIT.slice(0, 7)}: ` +
    `${actual.files} Markdown files, ${actual.requirements} requirements, ${actual.scenarios} scenarios`,
);
