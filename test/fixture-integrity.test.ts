/**
 * The vendored fixtures are worth exactly as much as they are verbatim:
 * test/openspec-compat.test.ts pins loam's parser against "markdown that
 * OpenSpec actually produces", and test/verify-contract-results.test.ts pins
 * the contract-results parser against the normative sample of loam's own
 * documented report shape — in both cases a quietly edited fixture would turn
 * the suite into loam testing itself against its own invention. Each corpus's
 * README lists a sha256 per file and says "Do not edit these files" — but
 * until now nothing recomputed the checksums, so the premise was enforced by
 * politeness alone.
 *
 * This file is the enforcement: each README's checksum block is parsed and
 * every digest recomputed from the bytes on disk. Fails when a fixture drifts
 * from its recorded checksum, when a listed file is missing, or when a fixture
 * file exists that its README does not account for (an unprovenanced fixture
 * is as suspect as an edited one). To add a fixture: fetch or author it under
 * the corpus's provenance rules, add the provenance row AND the checksum line
 * to that README.
 */
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const OPENSPEC = fileURLToPath(new URL("./fixtures/openspec/", import.meta.url));
const CONTRACT_RESULTS = fileURLToPath(new URL("./fixtures/contract-results/", import.meta.url));

/** A README's checksum block: 4-space-indented `<sha256>  <relative path>` lines. */
async function readmeChecksums(root: string): Promise<Map<string, string>> {
  const readme = await readFile(join(root, "README.md"), "utf8");
  const out = new Map<string, string>();
  for (const m of readme.matchAll(/^ {4}([0-9a-f]{64}) {2}(\S+)$/gm)) {
    out.set(m[2]!, m[1]!);
  }
  return out;
}

/** Every vendored OpenSpec file on disk, as `<dir>/<name>` with forward slashes. */
async function openspecFiles(): Promise<string[]> {
  const out: string[] = [];
  for (const dir of ["living", "delta"]) {
    for (const name of await readdir(join(OPENSPEC, dir))) {
      out.push(`${dir}/${name}`);
    }
  }
  return out.sort();
}

/** The contract-results corpus is flat: every file beside its README. */
async function contractResultsFiles(): Promise<string[]> {
  return (await readdir(CONTRACT_RESULTS)).filter((name) => name !== "README.md").sort();
}

/** Recompute every recorded digest from the bytes on disk and compare. */
async function expectChecksums(root: string, sums: Map<string, string>): Promise<void> {
  for (const [rel, expected] of sums) {
    // Raw bytes, no encoding: the recorded values are `shasum -a 256` over
    // the files' canonical repository bytes, BOM and all.
    const actual = createHash("sha256")
      .update(await readFile(join(root, rel)))
      .digest("hex");
    expect(actual, `${rel} no longer matches its recorded checksum — the fixture is no longer verbatim`).toBe(
      expected,
    );
  }
}

describe("fixture integrity: the vendored OpenSpec files are still byte-for-byte upstream", () => {
  it("the README has a parseable checksum for every fixture", async () => {
    const sums = await readmeChecksums(OPENSPEC);
    // Seven files were vendored; fewer parsed lines means the block's format
    // drifted and this suite is checking nothing.
    expect(sums.size).toBeGreaterThanOrEqual(7);
    expect([...sums.keys()].sort()).toEqual(await openspecFiles());
  });

  it("every fixture's bytes still hash to the README's checksum", async () => {
    await expectChecksums(OPENSPEC, await readmeChecksums(OPENSPEC));
  });
});

describe("fixture integrity: the contract-results sample is still the normative bytes", () => {
  it("the README has a parseable checksum for every fixture", async () => {
    const sums = await readmeChecksums(CONTRACT_RESULTS);
    // One file was authored; zero parsed lines means the block's format
    // drifted and this suite is checking nothing.
    expect(sums.size).toBeGreaterThanOrEqual(1);
    expect([...sums.keys()].sort()).toEqual(await contractResultsFiles());
  });

  it("every fixture's bytes still hash to the README's checksum", async () => {
    await expectChecksums(CONTRACT_RESULTS, await readmeChecksums(CONTRACT_RESULTS));
  });
});
