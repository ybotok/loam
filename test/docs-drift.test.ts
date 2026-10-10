import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { OPENSPEC_BASELINES } from "../src/core/openspec/model/model.js";

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
  it("derives the README version from package.json, as the version of this checkout", async () => {
    const readme = flat(await read("README.md"));
    const current = await version();
    expect(readme).toContain(`**Pre-release: \`${current}\`** is the version this checkout's \`package.json\` names`);
    expect(readme).toContain(`This checkout is \`${current}\``);
  });

  /**
   * The test above is exactly why the README must never say the version it
   * names is PUBLISHED. It derives that version from package.json, and the
   * version is bumped before the publish runs — so a sentence calling it "the
   * newest published version" was true by construction of the bump and false
   * whenever the publish then failed. That happened to 0.2.0-alpha.8: its
   * release run died at `npm ci` on a lockfile npm-on-Windows had stripped, and
   * the README went on calling it published for weeks while npm served alpha.7.
   * The repository cannot know what npm serves; the dist-tags can, so README
   * points at them and this pins that it keeps doing so.
   */
  it("never asserts that the checkout's version is published — it names the dist-tags instead", async () => {
    const readme = flat(await read("README.md"));
    expect(readme).not.toMatch(/newest published/i);
    expect(readme).not.toMatch(/\b\w+ published release of\b/i);
    expect(readme).not.toMatch(/always installs this line/i);
    expect(readme).toContain("the npm dist-tags are the source of truth");
    expect(readme).toContain("`npm view @ybotok/loam dist-tags`");
  });

  it("CHANGELOG's section for the checkout's version does not promise a dist-tag installs it", async () => {
    // The same root cause one file over: the section is written in the commit
    // that bumps the version, before any publish, so "`npm i …@alpha` installs
    // it" is a claim about an event that has not happened yet — and it stayed
    // in alpha.3's and alpha.8's sections after both publishes failed.
    const changelog = await read("CHANGELOG.md");
    const current = await version();
    const start = changelog.indexOf(`## [${current}]`);
    if (start === -1) return;
    const end = changelog.indexOf("\n## [", start + 1);
    const section = flat(changelog.slice(start, end === -1 ? undefined : end));
    expect(section).not.toMatch(/`npm i @ybotok\/loam@\w+` installs it/);
  });

  it("pins the fleet-edges recipe to the version README names, and runs no unpinned loam", async () => {
    // The recipe is the first gate a fleet installs, and an unpinned `npx`
    // resolves `latest` on the day the job runs, so a release can move what
    // gates every PR mid-review. A pin is only worth having if it cannot trail
    // the version this README describes.
    const readme = await read("README.md");
    expect(readme).toContain(`LOAM: "@ybotok/loam@${await version()}"`);
    expect(readme).not.toMatch(/npx -y @ybotok\/loam (?:diff|validate)\b/);
    // The service-repo recipe and the cloud-agent setup pin the same way, and
    // a fleet bumps all of them in one change or its service repos gate on a
    // different loam from its docs repo. So EVERY exact version README names
    // must be this checkout's — a dist-tag such as `@alpha` is not a pin and
    // is left alone.
    const pinned = [...readme.matchAll(/@ybotok\/loam@(\d[^\s"'`]*)/g)].map((match) => match[1]);
    expect(pinned.length, "README carries no pinned loam version at all").toBeGreaterThan(0);
    expect(new Set(pinned), "a README recipe pins a loam other than this checkout's").toEqual(new Set([await version()]));
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
    // The page was a 2,983-word "loam vs OpenSpec" duel until alpha.1, and was
    // rewritten as an ecosystem map on purpose: loam's position is a governed
    // system, not a rival framework, and OpenSpec's real compatibility concern —
    // the one-way migration and its pinned corpus — lives in the migration guide.
    // That is why this test used to forbid the name outright.
    //
    // It no longer can, and the reason is the reader. Whoever evaluates loam
    // holds it against OpenSpec, Spec Kit and Kiro, and a page silent on all
    // three left them to guess what those tools already do across repositories.
    // So the names may come back in ONE place: a dated "Spec-driven change
    // tools" section, facts with sources, which these tools' weekly releases
    // will age — the date is what lets a reader see how stale it is. Anywhere
    // else on the page they would be the duel coming back, and that is still
    // what this test refuses.
    const comparison = await read("COMPARISON.md");
    const heading = /^## Spec-driven change tools, as of (January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$/m;
    const at = comparison.search(heading);
    expect(at, "COMPARISON's spec-driven section must keep its dated heading").toBeGreaterThan(-1);
    const end = comparison.indexOf("\n## ", at + 1);
    const dated = comparison.slice(at, end === -1 ? undefined : end);
    const outside = comparison.slice(0, at) + (end === -1 ? "" : comparison.slice(end));
    for (const tool of [/OpenSpec/i, /Spec Kit/i, /\bKiro\b/i]) {
      expect(outside, `COMPARISON names ${tool.source} outside its dated section`).not.toMatch(tool);
      expect(dated, `the dated section no longer covers ${tool.source}`).toMatch(tool);
    }
    expect(dated, "the dated section must say the day it was checked").toMatch(/checked \d{4}-\d{2}-\d{2}/);
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
    // Read from the constant `audit-openspec` prints rather than spelled here:
    // a literal kept passing after the pin moved, because the guide still names
    // the old pin as a regression baseline.
    const { version, commit } = OPENSPEC_BASELINES.release;
    const guide = await read("MIGRATING-from-OpenSpec.md");
    expect(guide).toContain(`the v${version} exact-commit corpus is certified`);
    expect(guide).toContain(commit);
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
