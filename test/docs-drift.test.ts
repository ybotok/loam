/**
 * Mutable release facts, pinned to their one source of truth.
 *
 * The version is written in prose in three places a reader trusts — the README
 * banner, the README status paragraph, the pilot run book — and every one of
 * them has already drifted once: the README said `beta.1` and "not on npm yet"
 * for two releases after the package was published. Prose cannot be generated
 * here (these documents are read on npm and GitHub, not through loam), so the
 * next-best thing is a test that fails the gate when `package.json` moves and
 * the prose does not.
 *
 * Deliberately NOT pinned: performance numbers (a measurement, not a fact the
 * repo can derive) and the OpenSpec comparison's upstream claims (pinned to an
 * exact upstream commit by design — see COMPARISON.md's own header).
 */
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

async function read(rel: string): Promise<string> {
  return readFile(join(ROOT, rel), "utf8");
}

async function version(): Promise<string> {
  const pkg = JSON.parse(await read("package.json")) as { version: string };
  return pkg.version;
}

describe("release facts in prose match package.json", () => {
  it("the README banner names the current version and no other", async () => {
    const readme = await read("README.md");
    expect(readme).toContain(`**Pre-release: \`${await version()}\`**`);
  });

  it("the README status paragraph names the current version", async () => {
    const readme = await read("README.md");
    expect(readme).toContain(`currently \`${await version()}\``);
  });

  it("the README no longer claims the package is unpublished", async () => {
    const readme = await read("README.md");
    // The exact sentences that sat in the README for two releases after the
    // publish. Wording may change freely; the CLAIM must not come back.
    expect(readme).not.toMatch(/not on npm yet/i);
    expect(readme).not.toMatch(/until (it|the package) is published/i);
  });

  it("the pilot run book packs the tarball npm pack would produce for this version", async () => {
    const pilot = await read("docs/pilot/README.md");
    // `npm pack` derives the filename from name + version, so the run book's
    // literal is re-derivable — and re-drifts on every release unless pinned.
    expect(pilot).toContain(`ybotok-loam-${await version()}.tgz`);
  });

  it("no doc still points the pilot at a superseded tarball", async () => {
    const pilot = await read("docs/pilot/README.md");
    const stale = /ybotok-loam-\d[^\s`]*\.tgz/g;
    const v = await version();
    for (const hit of pilot.match(stale) ?? []) {
      expect(hit).toBe(`ybotok-loam-${v}.tgz`);
    }
  });
});
