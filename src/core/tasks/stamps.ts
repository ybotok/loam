/**
 * What the generated suite in THIS repository already carries — read-only, and
 * never written.
 *
 * `loam gherkin` stamps every scenario it emits with `@loam-digest-<16hex>`,
 * the same hex a `scenario.tested` claim carries (`core/gherkin/digest.ts` owns
 * the one recipe). So the presence of a stamp answers exactly one question: has
 * a test skeleton for THESE words been generated yet? That is the difference
 * between a unit waiting at `generate` and one waiting at `implement`, and it is
 * the only reason a packet looks at the service repository at all.
 *
 * The resolution is `loam gherkin`'s own — `gherkinRoot` for the directory,
 * `parseStampedFeature` for the bytes — because a second spelling of either
 * would let the packet grade a suite the emitter does not own, or miss one it
 * does.
 *
 * TWO ABSENCES, KEPT APART. A root directory that is not there means the suite
 * has not been generated: the stamps ARE readable and the set is empty, so every
 * scenario unit honestly reads `generate`. No binding, an unreadable repository,
 * or an output directory that escapes it means loam COULD NOT LOOK, which is
 * reported as "unknown" and never as an empty set — "nothing is wrong" and "I
 * could not look" are opposite facts, and only one of them is a task list.
 */
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseStampedFeature } from "../gherkin/read.js";
import { gherkinRoot } from "../gherkin/stamp.js";

/** Which repository's suite to read, as loam.json describes it. */
export interface GherkinBinding {
  /** The repo root loam.json was found in — never the cwd, which may be any subdirectory. */
  repoDir: string;
  /** The service this repository says it is; absent in a docs repo or an unbound checkout. */
  service?: string;
  /** `gherkinDir` from loam.json, when it names one. */
  gherkinDir?: string;
}

export interface StampReading {
  state: "read" | "unknown";
  /** The `@loam-digest-…` values found. Meaningful only when `state` is "read". */
  digests: ReadonlySet<string>;
  /** The service the stamps belong to — nothing may be said about any other repository's suite. */
  service: string | null;
}

export async function readStamps(binding: GherkinBinding): Promise<StampReading> {
  const unknown: StampReading = { state: "unknown", digests: new Set(), service: null };
  if (binding.service === undefined) return unknown;
  let root: string;
  try {
    root = gherkinRoot(binding.repoDir, binding.gherkinDir);
  } catch {
    // An output directory that escapes the repo is a configuration loam refuses
    // to write through (`core/kernel/path-safety.ts`), so it is also one this
    // must not read through — and it is a could-not-look, not an empty suite.
    return unknown;
  }
  if (!existsSync(root)) return { state: "read", digests: new Set(), service: binding.service };
  const digests = new Set<string>();
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    // The directory is there and will not open. Unreadable is not empty.
    return unknown;
  }
  for (const entry of entries) {
    if (entry.isDirectory() || !entry.name.endsWith(".feature")) continue;
    let text: string;
    try {
      text = await readFile(join(root, entry.name), "utf8");
    } catch {
      // One unreadable file under a readable root: the rest of the suite still
      // answers, and a file loam cannot read carries no stamps it may credit.
      continue;
    }
    const stamped = parseStampedFeature(text);
    // Null means line 1 is not loam's stamp — the file is not loam's writing,
    // and no staleness judgment may be built on it.
    if (stamped === null) continue;
    for (const scenario of stamped.scenarios) digests.add(scenario.digest);
  }
  return { state: "read", digests, service: binding.service };
}
