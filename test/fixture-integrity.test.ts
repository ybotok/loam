/**
 * The vendored OpenSpec fixtures are worth exactly as much as they are
 * verbatim: test/openspec-compat.test.ts pins loam's parser against "markdown
 * that OpenSpec actually produces", and a quietly edited fixture would turn
 * that suite into loam testing itself against its own invention. The fixtures'
 * README lists a sha256 per file and says "Do not edit these files" — but
 * until now nothing recomputed the checksums, so the premise was enforced by
 * politeness alone.
 *
 * This file is the enforcement: the README's checksum block is parsed and every
 * digest recomputed from the bytes on disk. Fails when a fixture drifts from
 * its recorded checksum, when a listed file is missing, or when a spec file
 * exists that the README does not account for (an unprovenanced fixture is as
 * suspect as an edited one). To add a fixture: fetch it verbatim, add the
 * provenance row AND the checksum line to the README.
 */
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const FIXTURES = fileURLToPath(new URL("./fixtures/openspec/", import.meta.url));

/** The README's checksum block: 4-space-indented `<sha256>  <relative path>` lines. */
async function readmeChecksums(): Promise<Map<string, string>> {
  const readme = await readFile(join(FIXTURES, "README.md"), "utf8");
  const out = new Map<string, string>();
  for (const m of readme.matchAll(/^ {4}([0-9a-f]{64}) {2}(\S+)$/gm)) {
    out.set(m[2]!, m[1]!);
  }
  return out;
}

/** Every vendored spec file on disk, as `<dir>/<name>` with forward slashes. */
async function fixtureFiles(): Promise<string[]> {
  const out: string[] = [];
  for (const dir of ["living", "delta"]) {
    for (const name of await readdir(join(FIXTURES, dir))) {
      out.push(`${dir}/${name}`);
    }
  }
  return out.sort();
}

describe("fixture integrity: the vendored files are still byte-for-byte upstream", () => {
  it("the README has a parseable checksum for every fixture", async () => {
    const sums = await readmeChecksums();
    // Seven files were vendored; fewer parsed lines means the block's format
    // drifted and this suite is checking nothing.
    expect(sums.size).toBeGreaterThanOrEqual(7);
    expect([...sums.keys()].sort()).toEqual(await fixtureFiles());
  });

  it("every fixture's bytes still hash to the README's checksum", async () => {
    const sums = await readmeChecksums();
    for (const [rel, expected] of sums) {
      // Raw bytes, no encoding: the recorded values are `shasum -a 256` over
      // the files as fetched, BOM, CRLF and all.
      const actual = createHash("sha256")
        .update(await readFile(join(FIXTURES, rel)))
        .digest("hex");
      expect(actual, `${rel} no longer matches its recorded checksum — the fixture is no longer verbatim upstream`).toBe(
        expected,
      );
    }
  });
});
