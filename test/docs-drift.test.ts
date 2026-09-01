import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const PRIVATE_ROUTE_BLOCKER = "<!-- loam-release-blocker: private-security-route -->";

async function read(rel: string): Promise<string> {
  return readFile(join(ROOT, rel), "utf8");
}

/** Collapse whitespace runs: a pinned sentence must survive a reflow. */
function flat(text: string): string {
  // Blockquote continuation marks are line furniture, not prose: a wrapped
  // `> …` callout must match the same sentence an unwrapped one does.
  return text.replace(/^[ \t]*>[ \t]?/gm, "").replace(/\s+/g, " ");
}

async function version(): Promise<string> {
  const pkg = JSON.parse(await read("package.json")) as { version: string };
  return pkg.version;
}

describe("mutable release facts", () => {
  it("derives the README version from package.json", async () => {
    const readme = flat(await read("README.md"));
    const current = await version();
    expect(readme).toContain(`**Pre-release: \`${current}\`**`);
    expect(readme).toContain(`currently \`${current}\``);
  });

  it("does not restore superseded publication claims", async () => {
    const readme = flat(await read("README.md"));
    expect(readme).not.toMatch(/not on npm yet/i);
    expect(readme).not.toMatch(/until (it|the package) is published/i);
    expect(readme).not.toMatch(/nothing has been released yet/i);
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
    expect(flat(await read("README.md"))).toContain(`${range} plus the changes on \`main\` under \`[Unreleased]\``);
  });

  it("while README claims `main` is ahead, CHANGELOG's [Unreleased] section backs it", async () => {
    const readme = flat(await read("README.md"));
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

describe("ecosystem positioning and the separate OpenSpec compatibility boundary", () => {
  it("COMPARISON maps neighbouring specialists without defining loam against OpenSpec", async () => {
    const comparison = await read("COMPARISON.md");
    expect(comparison).not.toMatch(/OpenSpec/i);
    const neighbours = [
      "LikeC4",
      "Backstage",
      "EventCatalog",
      "Pact Broker",
      "oasdiff",
      "OpenFastTrace",
      "ArchUnit",
    ];
    for (const neighbour of neighbours) {
      expect(comparison, `COMPARISON never names ${neighbour}`).toContain(neighbour);
    }
  });

  it("the migration guide, not the ecosystem page, owns the certified corpus pin", async () => {
    expect(await read("MIGRATING-from-OpenSpec.md")).toContain("2826b8889e5223a9a8095d4428b60b56597e1020");
  });

  it("README describes COMPARISON as an ecosystem map, not a product duel", async () => {
    const readme = flat(await read("README.md"));
    expect(readme).toContain("neighbouring specialist");
    expect(readme).not.toContain("current product comparison with OpenSpec");
  });
});

describe("private vulnerability reporting status", () => {
  /**
   * The route is live — the repository's PUBLIC advisories page offers "Report
   * a vulnerability" and `/security/advisories/new` answers 200 to an
   * anonymous reader, which is the exact condition RELEASE-READINESS set — so
   * these assertions are the inverse of what they were. The coupling they
   * enforce is unchanged: SECURITY, README and the readiness list say ONE
   * thing about the route, and a document left behind fails here rather than
   * misdirecting a reporter. The blocker constant stays because ABSENCE is now
   * the invariant: re-adding the marker would silently re-block
   * `release-check` from prose nobody re-read.
   */
  it("names the live private route, and no document still calls it unavailable", async () => {
    const [security, readiness, readme] = await Promise.all([
      read("SECURITY.md"),
      read("docs/RELEASE-READINESS.md"),
      read("README.md"),
    ]);
    expect(flat(security)).not.toContain(PRIVATE_ROUTE_BLOCKER);
    expect(flat(security)).toMatch(/security\/advisories\/new/);
    expect(flat(security)).not.toMatch(/not currently confirmed or enabled/i);
    // The public-issue fallback existed only while the private form did not.
    // Leaving it standing would offer a reporter a public route beside a
    // private one, which is the one mistake this file exists to prevent.
    expect(flat(security)).not.toMatch(/detail-free issue/i);
    expect(flat(readiness)).not.toMatch(/enable and test GitHub Private Vulnerability Reporting/i);
    expect(flat(readiness)).not.toMatch(/currently has no remote/i);
    expect(flat(readiness)).not.toMatch(/first-publication bootstrap/i);
    expect(flat(readme)).toMatch(/security\/advisories\/new/);
    expect(flat(readme)).not.toMatch(
      /Private Vulnerability Reporting[\s\S]{0,240}not (?:currently )?(?:confirmed|enabled|switched on)/i,
    );
  });
});
