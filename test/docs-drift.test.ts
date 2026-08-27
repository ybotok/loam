import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const PRIVATE_ROUTE_BLOCKER = "<!-- loam-release-blocker: private-security-route -->";

async function read(rel: string): Promise<string> {
  return readFile(join(ROOT, rel), "utf8");
}

async function version(): Promise<string> {
  const pkg = JSON.parse(await read("package.json")) as { version: string };
  return pkg.version;
}

describe("mutable release facts", () => {
  it("derives the README version from package.json", async () => {
    const readme = await read("README.md");
    const current = await version();
    expect(readme).toContain(`**Pre-release: \`${current}\`**`);
    expect(readme).toContain(`currently \`${current}\``);
  });

  it("does not restore superseded publication claims", async () => {
    const readme = await read("README.md");
    expect(readme).not.toMatch(/not on npm yet/i);
    expect(readme).not.toMatch(/until (it|the package) is published/i);
    expect(readme).not.toMatch(/nothing has been released yet/i);
  });

  it("derives the pilot tarball path from the release manifest", async () => {
    const pilot = await read("docs/pilot/README.md");
    expect(pilot).toContain("release-manifest.json");
    expect(pilot).toContain("manifest.filename");
    expect(pilot).toMatch(/bump both `package\.json` and `package-lock\.json` to the intended candidate version/i);
  });

  it("keeps version literals out of the pilot run book", async () => {
    const pilot = await read("docs/pilot/README.md");
    expect(pilot).not.toContain(await version());
    expect(pilot).not.toMatch(/ybotok-loam-\d[^\s`"']*\.tgz/i);
  });

  it("keeps the unrun pilot status explicit", async () => {
    const [pilot, scorecard] = await Promise.all([
      read("docs/pilot/README.md"),
      read("docs/pilot/SCORECARD.md"),
    ]);
    expect(pilot).toMatch(/not a claim that Loam has already worked in production/i);
    expect(scorecard).toContain("Current repository status: **not run**");
  });
});

describe("the released range and the unreleased head", () => {
  /** CHANGELOG's dated release headings, newest first — the derivation. */
  async function releasedVersions(): Promise<string[]> {
    const changelog = await read("CHANGELOG.md");
    return [...changelog.matchAll(/^## \[(\d[^\]]*)\] - \d{4}-\d{2}-\d{2}$/gm)].map(
      (match) => match[1]!,
    );
  }

  it("README's Docs bullet names the range CHANGELOG actually released", async () => {
    // Derived, not pinned: the moment a "## [0.1.0-beta.4] - …" heading lands
    // (the project plan's next release event), the range below stops matching
    // and README's Docs bullet must move in the same change.
    const versions = await releasedVersions();
    expect(versions.length, "CHANGELOG must carry at least one dated release heading").toBeGreaterThan(0);
    const tail = (version: string): string => version.split("-").slice(1).join("-");
    const range = `released ${tail(versions[versions.length - 1]!)}–${tail(versions[0]!)}`;
    expect(await read("README.md")).toContain(`${range} plus the changes on \`main\` under \`[Unreleased]\``);
  });

  it("while README claims `main` is ahead, CHANGELOG's [Unreleased] section backs it", async () => {
    const readme = await read("README.md");
    if (!readme.includes("`main` is ahead under `[Unreleased]`")) return;
    const changelog = await read("CHANGELOG.md");
    const start = changelog.indexOf("## [Unreleased]");
    expect(start, "README claims `main` is ahead, so CHANGELOG needs an [Unreleased] section").toBeGreaterThan(-1);
    const end = changelog.indexOf("\n## [", start + 1);
    const section = changelog.slice(start + "## [Unreleased]".length, end === -1 ? undefined : end);
    expect(
      /\S/.test(section),
      "README claims `main` is ahead while CHANGELOG's [Unreleased] section is empty — move both lines together",
    ).toBe(true);
  });
});

describe("the OpenSpec product reference and the corpus pin", () => {
  it("README and COMPARISON both name OpenSpec v1.10.0 as the product reference", async () => {
    expect(await read("README.md")).toContain("OpenSpec v1.10.0");
    expect(await read("COMPARISON.md")).toContain("OpenSpec v1.10.0");
  });

  it("COMPARISON still pins the certified corpus to the v1.9.0 commit", async () => {
    expect(await read("COMPARISON.md")).toContain("2826b8889e5223a9a8095d4428b60b56597e1020");
  });

  it("README no longer claims the product reference and the compatibility pin are one release", async () => {
    expect(await read("README.md")).not.toContain("the compatibility pin are now the same release");
  });
});

describe("private vulnerability reporting status", () => {
  it("marks the intended private route as unavailable and release-blocking", async () => {
    const [security, readiness] = await Promise.all([
      read("SECURITY.md"),
      read("docs/pilot/RELEASE-READINESS.md"),
    ]);
    expect(security).toContain(PRIVATE_ROUTE_BLOCKER);
    expect(security).toMatch(/Private Vulnerability Reporting[\s\S]{0,240}not currently confirmed or enabled/i);
    expect(security).toMatch(/detail-free issue/i);
    expect(security).toMatch(/release prerequisite/i);
    expect(readiness).toMatch(/enable and test GitHub Private Vulnerability Reporting/i);
    expect(readiness).not.toMatch(/currently has no remote/i);
    expect(readiness).not.toMatch(/first-publication bootstrap/i);
  });

  it("does not tell readers that private reporting is already enabled", async () => {
    const readme = await read("README.md");
    expect(readme).toMatch(
      /Private Vulnerability Reporting[\s\S]{0,240}not (?:currently )?(?:confirmed|enabled|switched on)/i,
    );
  });
});
