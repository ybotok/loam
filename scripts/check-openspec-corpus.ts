import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import {
  BASELINES,
  BASELINE_NAMES,
  corpusPaths,
  isBaselineName,
  judgeSweep,
  tallyCorpus,
  type BaselineName,
} from "./openspec-corpus.js";

// The pins, their totals and the verdict live in ./openspec-corpus.ts; this
// file is only the checkout, the reads and the exit code around them.
let baselineName: BaselineName = "release";
let checkoutArg = process.env.OPENSPEC_CHECKOUT;
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg === "--baseline") {
    const value = process.argv[++index];
    if (!isBaselineName(value)) throw new Error(`--baseline must be one of ${BASELINE_NAMES.join(", ")}`);
    baselineName = value;
  } else if (!checkoutArg) {
    checkoutArg = arg;
  } else {
    throw new Error(`unexpected argument: ${arg}`);
  }
}
if (!checkoutArg) {
  console.error(`usage: npm run test:openspec-corpus -- [--baseline ${BASELINE_NAMES.join("|")}] /path/to/OpenSpec`);
  for (const [name, pin] of Object.entries(BASELINES)) console.error(`${name.padEnd(8)} ${pin.commit}`);
  process.exit(2);
}

const checkout = realpathSync(resolve(checkoutArg));
function git(...args: string[]): string {
  // Bounded like every other git question in the tree: a corpus checkout on a
  // stalled filesystem must fail the gate loudly, not hang the weekly job.
  return execFileSync("git", ["-C", checkout, ...args], { encoding: "utf8", timeout: 60_000, maxBuffer: 64 * 1024 * 1024 }).trim();
}

const head = git("rev-parse", "HEAD");
const dirty = git("status", "--porcelain", "--", "openspec/specs", "openspec/changes");
if (dirty) throw new Error("OpenSpec corpus paths have local modifications; use a clean checkout");

const files = corpusPaths(git("ls-files").split("\n").filter(Boolean)).map((path) => ({
  path,
  raw: readFileSync(resolve(checkout, path), "utf8"),
}));
const verdict = judgeSweep(baselineName, head, tallyCorpus(files));
if (!verdict.ok) throw new Error(verdict.lines.join("\n"));
for (const line of verdict.lines) console.log(line);
