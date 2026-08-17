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
