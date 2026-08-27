/**
 * `loam list --subsystem` and `loam list --owners` — the adoption campaign,
 * sliced by group and by team.
 *
 * Two properties are load-bearing. FILTER FIRST, THEN RANK: the slice decides
 * which rows appear and never what a row says — fan-in, apiExpected and the
 * missing lists are fleet facts, so a filtered row is byte-equal to its
 * unfiltered self and `reviewRank` stays contiguous within the filtered set.
 * And the owners join is HONEST about its subset: recognised-but-unsupported
 * CODEOWNERS rules are listed as skipped, a line that cannot be parsed
 * refuses (`owners-unreadable`) with its number, and an unmatched service is
 * listed as unowned — never silently somebody's.
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { makeProject, runLoam, type Project } from "./helpers/harness.js";
import { ownersFor, parseCodeowners } from "../src/core/owners/codeowners.js";

/**
 * Three services, two in the payments group (one nested), one unfiled. The
 * map draws two op edges into pay-a — one from INSIDE the eventual slice
 * (pay-d) and one from OUTSIDE it (core-x) — so a slice-first derivation
 * that erased core-x would under-count pay-a's fan-in, which is exactly what
 * the fleet-wide pin below convicts.
 */
const CAMPAIGN_LANDSCAPE = `specification {
  element softwareSystem
}

model {
  payA = softwareSystem 'pay-a' {
    metadata { service 'pay-a' }
  }
  payD = softwareSystem 'pay-d' {
    metadata { service 'pay-d' }
  }
  coreX = softwareSystem 'core-x' {
    metadata { service 'core-x' }
  }

  coreX -> payA 'calls' {
    metadata { op 'doThing' }
  }
  payD -> payA 'calls' {
    metadata { op 'doOther' }
  }
}
`;

function campaignFixture(): Record<string, string> {
  return {
    "architecture/landscape.likec4": CAMPAIGN_LANDSCAPE,
    "services/payments/subsystem.yaml": "",
    "services/payments/pay-a/.keep": "",
    "services/payments/deep/subsystem.yaml": "",
    "services/payments/deep/pay-d/.keep": "",
    "services/core-x/.keep": "",
  };
}

const CODEOWNERS =
  "# fleet ownership\n" +
  "/services/payments/ @team-pay\n" +
  "/services/payments/deep/ @org/deep-team deep-owner@example.com\n" +
  "*.md @team-docs\n";

async function listJson(p: Project, ...args: string[]): Promise<Record<string, any>> {
  const run = await runLoam(p.workDir, "list", ...args, "--json");
  expect(run.code).toBe(0);
  return JSON.parse(run.stdout);
}

async function listRefusal(p: Project, ...args: string[]): Promise<Record<string, any>> {
  const run = await runLoam(p.workDir, "list", ...args, "--json");
  expect(run.code).toBe(1);
  const payload = JSON.parse(run.stdout);
  expect(payload.ok).toBe(false);
  return payload;
}

type Row = Record<string, any>;

describe("--subsystem: the slice", () => {
  it("lists the group's services at any depth, rolls the dial over the slice, and omits unfiledServices", async () => {
    const p = await makeProject(campaignFixture());
    const payload = await listJson(p, "--subsystem", "payments");
    const rows = payload.services as Row[];
    expect(rows.map((r) => r.id)).toEqual(["pay-a", "pay-d"]);
    // The dial is the slice's: two services, whatever rungs they stand on.
    const total = Object.values(payload.maturity as Record<string, number>).reduce((a, b) => a + b, 0);
    expect(total).toBe(2);
    // The named subsystem and its descendants, nothing else.
    expect((payload.subsystems as Row[]).map((s) => s.name).sort()).toEqual(["deep", "payments"]);
    // A fleet-root fact has no honest value inside a slice: omitted, never 0.
    expect(Object.keys(payload)).not.toContain("unfiledServices");
    expect(Object.keys(payload)).not.toContain("features");
    await p.destroy();
  });

  it("filters rows without changing them: each sliced row deep-equals its unfiltered self", async () => {
    const p = await makeProject(campaignFixture());
    const bare = await listJson(p);
    const sliced = await listJson(p, "--subsystem", "payments");
    for (const row of sliced.services as Row[]) {
      const counterpart = (bare.services as Row[]).find((r) => r.id === row.id);
      // apiExpected included: pay-a is called, and the full-fleet views are
      // what keep that fact identical inside and outside the slice.
      expect(row).toEqual(counterpart);
    }
    await p.destroy();
  });

  it("a nested name slices transitively from its own level", async () => {
    const p = await makeProject(campaignFixture());
    const payload = await listJson(p, "--subsystem", "deep");
    expect((payload.services as Row[]).map((r) => r.id)).toEqual(["pay-d"]);
    expect((payload.subsystems as Row[]).map((s) => s.name)).toEqual(["deep"]);
    await p.destroy();
  });

  it("'unfiled' reaches the services filed under no subsystem — and a real node spelled 'unfiled' wins", async () => {
    const p = await makeProject(campaignFixture());
    const payload = await listJson(p, "--subsystem", "unfiled");
    expect((payload.services as Row[]).map((r) => r.id)).toEqual(["core-x"]);
    expect(payload.subsystems).toEqual([]);
    await p.destroy();

    // The concrete-name-wins precedence: a fleet that actually GROUPS under
    // the name 'unfiled' addresses that group, not the reserved reading.
    const shadowed = await makeProject({
      ...campaignFixture(),
      "services/unfiled/subsystem.yaml": "",
      "services/unfiled/svc-u/.keep": "",
    });
    const real = await listJson(shadowed, "--subsystem", "unfiled");
    expect((real.services as Row[]).map((r) => r.id)).toEqual(["svc-u"]);
    await shadowed.destroy();
  });

  it("slices by directory, not id: a name-collision twin outside the group stays outside", async () => {
    // `subsystem.name-collision` fleets still enumerate BOTH directories (the
    // fleet is never reported smaller), so the slice must key on the row's
    // identity — its directory — or each of two disjoint slices claims the
    // other's service and the rolled dial double-counts.
    const p = await makeProject({
      ...campaignFixture(),
      "services/dup-svc/.keep": "",
      "services/payments/dup-svc/.keep": "",
    });
    const sliced = await listJson(p, "--subsystem", "payments");
    const dupRows = (sliced.services as Row[]).filter((r) => r.id === "dup-svc");
    expect(dupRows.map((r) => r.path)).toEqual(["services/payments/dup-svc"]);
    const unfiled = await listJson(p, "--subsystem", "unfiled");
    const dupUnfiled = (unfiled.services as Row[]).filter((r) => r.id === "dup-svc");
    expect(dupUnfiled.map((r) => r.path)).toEqual(["services/dup-svc"]);
    await p.destroy();
  });

  it("refuses an unknown name with close-name hints — never an empty success", async () => {
    const p = await makeProject(campaignFixture());
    const payload = await listRefusal(p, "--subsystem", "paymets");
    expect(payload.error.code).toBe("unknown-target");
    expect(payload.error.message).toContain("paymets");
    expect(payload.error.message).toContain("payments");
    // A name near nothing still refuses, pointing at the tools instead of hints.
    const far = await listRefusal(p, "--subsystem", "zzz");
    expect(far.error.code).toBe("unknown-target");
    expect(far.error.message).toContain("loam subsystem list");
    await p.destroy();
  });

  it("refuses a service name: a service never contains other services", async () => {
    const p = await makeProject(campaignFixture());
    const payload = await listRefusal(p, "--subsystem", "pay-a");
    expect(payload.error.code).toBe("invalid-option");
    expect(payload.error.message).toContain("a service never contains other services");
    await p.destroy();

    // A SERVICE claiming the name 'unfiled' leaves the reserved reading with
    // no spelling at all — the refusal must say what is shadowed.
    const shadowed = await makeProject({ ...campaignFixture(), "services/unfiled/.keep": "" });
    const refusal = await listRefusal(shadowed, "--subsystem", "unfiled");
    expect(refusal.error.code).toBe("invalid-option");
    expect(refusal.error.message).toContain("reserved unfiled-services reading is shadowed");
    await shadowed.destroy();
  });

  it("refuses the features and capabilities sections under either campaign flag", async () => {
    const p = await makeProject(campaignFixture());
    for (const args of [
      ["features", "--subsystem", "payments"],
      ["capabilities", "--subsystem", "payments"],
      ["features", "--owners", "CODEOWNERS"],
    ]) {
      const payload = await listRefusal(p, ...args);
      expect(payload.error.code).toBe("invalid-option");
    }
    await p.destroy();
  });

  it("prints the filter line and the slice-sized worklist denominator in text mode", async () => {
    const p = await makeProject(campaignFixture());
    const table = await runLoam(p.workDir, "list", "--subsystem", "payments");
    expect(table.code).toBe(0);
    expect(table.stdout).toContain("filtered to subsystem 'payments' (services/payments/): 2 of 3 service(s)");
    // The tree dial is a fleet-root fact; the filtered table must not claim it.
    expect(table.stdout).not.toContain("subsystems:");
    const work = await runLoam(p.workDir, "list", "--needs-work", "--subsystem", "payments");
    expect(work.code).toBe(0);
    expect(work.stdout).toContain("2 of 2 service(s) need work");
    await p.destroy();
  });
});

describe("--subsystem composes with --review-order: filter first, then rank", () => {
  it("ranks are contiguous within the filtered set and fan-in values stay fleet-wide", async () => {
    const p = await makeProject(campaignFixture());
    const unfiltered = await listJson(p, "--needs-work", "--review-order");
    const filtered = await listJson(p, "--needs-work", "--review-order", "--subsystem", "payments");
    const rows = filtered.services as Row[];
    expect(rows.map((r) => r.id)).toEqual(["pay-a", "pay-d"]);
    expect(rows.map((r) => r.reviewRank)).toEqual([1, 2]);
    // The fleet-wide pin: core-x sits OUTSIDE the slice and still counts as a
    // caller of pay-a — a slice-first fanIn would report 1 here and 2 there.
    expect(rows[0]).toMatchObject({ id: "pay-a", fanIn: 2 });
    for (const row of rows) {
      const counterpart = (unfiltered.services as Row[]).find((r) => r.id === row.id);
      expect(row.fanIn).toBe(counterpart!.fanIn);
    }
    await p.destroy();
  });

  it("--review-order still requires --needs-work with a subsystem filter present", async () => {
    const p = await makeProject(campaignFixture());
    const payload = await listRefusal(p, "--review-order", "--subsystem", "payments");
    expect(payload.error.code).toBe("invalid-option");
    expect(payload.error.message).toContain("--needs-work");
    await p.destroy();
  });
});

describe("--owners: the CODEOWNERS join", () => {
  it("files each row under the last matching rule's owners, lists unowned and skipped honestly", async () => {
    const p = await makeProject({ ...campaignFixture(), CODEOWNERS });
    const payload = await listJson(p, "--owners", join(p.docsDir, "CODEOWNERS"));
    const owners = payload.owners as Row;
    expect(owners.path).toBe(join(p.docsDir, "CODEOWNERS"));
    // pay-d matches the payments rule AND the deep rule; the LAST wins, and a
    // two-owner rule files the service under both teams. Teams sort by owner.
    expect(owners.teams).toEqual([
      { owner: "@org/deep-team", services: ["pay-d"] },
      { owner: "@team-pay", services: ["pay-a"] },
      { owner: "deep-owner@example.com", services: ["pay-d"] },
    ]);
    expect(owners.unowned).toEqual(["core-x"]);
    expect(owners.skippedRules).toEqual([{ line: 4, pattern: "*.md" }]);
    await p.destroy();
  });

  it("teams' arrays respect the active filter and order — the per-team campaign queues", async () => {
    const p = await makeProject({ ...campaignFixture(), CODEOWNERS });
    const payload = await listJson(
      p,
      "--needs-work",
      "--review-order",
      "--subsystem",
      "payments",
      "--owners",
      join(p.docsDir, "CODEOWNERS"),
    );
    const owners = payload.owners as Row;
    // core-x is outside the slice: not unowned, simply not a row.
    expect(owners.unowned).toEqual([]);
    expect(owners.teams).toEqual([
      { owner: "@org/deep-team", services: ["pay-d"] },
      { owner: "@team-pay", services: ["pay-a"] },
      { owner: "deep-owner@example.com", services: ["pay-d"] },
    ]);
    // And the rows themselves are still the ranked queue.
    expect((payload.services as Row[]).map((r) => r.reviewRank)).toEqual([1, 2]);
    await p.destroy();
  });

  it("refuses a missing file with owners-unreadable, naming the path", async () => {
    const p = await makeProject(campaignFixture());
    const missing = join(p.docsDir, "no-such-CODEOWNERS");
    const payload = await listRefusal(p, "--owners", missing);
    expect(payload.error.code).toBe("owners-unreadable");
    expect(payload.error.message).toContain("no-such-CODEOWNERS");
    expect(Object.keys(payload)).not.toContain("services");
    await p.destroy();
  });

  it("refuses a malformed line with its number — fail-closed, never silently skipped", async () => {
    const p = await makeProject({
      ...campaignFixture(),
      CODEOWNERS: "# ok\nservices/core-x nobody\n",
    });
    const payload = await listRefusal(p, "--owners", join(p.docsDir, "CODEOWNERS"));
    expect(payload.error.code).toBe("owners-unreadable");
    expect(payload.error.message).toContain(":2:");
    expect(payload.error.message).toContain("nobody");
    await p.destroy();
  });

  it("an empty file is not a refusal: every service lands in unowned", async () => {
    const p = await makeProject({ ...campaignFixture(), CODEOWNERS: "" });
    const payload = await listJson(p, "--owners", join(p.docsDir, "CODEOWNERS"));
    const owners = payload.owners as Row;
    expect(owners.teams).toEqual([]);
    expect(owners.unowned).toEqual(["core-x", "pay-a", "pay-d"]);
    expect(owners.skippedRules).toEqual([]);
    await p.destroy();
  });

  it("prints the grouped worklist with unowned last and the skipped-rules note", async () => {
    const p = await makeProject({ ...campaignFixture(), CODEOWNERS });
    const run = await runLoam(p.workDir, "list", "--needs-work", "--owners", join(p.docsDir, "CODEOWNERS"));
    expect(run.code).toBe(0);
    const lines = run.stdout.split("\n");
    expect(lines[0]).toContain("3 of 3 service(s) need work — by owner");
    const heading = (needle: string): number => lines.findIndex((l) => l.includes(needle));
    expect(heading("@team-pay (1)")).toBeGreaterThan(0);
    expect(heading("unowned (1)")).toBeGreaterThan(heading("@team-pay (1)"));
    // Line AND pattern: a reader must be able to tell a skipped fleet-wide
    // `*` default from a skipped docs rule without opening the file.
    expect(run.stdout).toContain("note: 1 rule(s) outside the supported CODEOWNERS subset skipped: line 4 (*.md)");
    await p.destroy();
  });
});

describe("the frozen default", () => {
  it("bare `loam list --json` carries every pre-existing key and none of the campaign ones", async () => {
    const p = await makeProject(campaignFixture());
    const payload = await listJson(p);
    for (const key of ["docsDir", "services", "maturity", "subsystems", "unfiledServices", "features"]) {
      expect(Object.keys(payload)).toContain(key);
    }
    expect(Object.keys(payload)).not.toContain("owners");
    for (const row of payload.services as Row[]) {
      expect(Object.keys(row)).not.toContain("fanIn");
      expect(Object.keys(row)).not.toContain("reviewRank");
    }
    await p.destroy();
  });
});

describe("parseCodeowners / ownersFor — the pure subset", () => {
  it("reads anchored and unanchored directory patterns, wildcard tails included", () => {
    const parsed = parseCodeowners("/services/payments/ @a\npayments/ @b\n/services/payments/* @c\n/services/payments/** @d\n");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rules.map((r) => r.anchored)).toEqual([true, false, true, true]);
    expect(parsed.rules.map((r) => r.segments)).toEqual([
      ["services", "payments"],
      ["payments"],
      ["services", "payments"],
      ["services", "payments"],
    ]);
    const dir = ["services", "payments", "pay-a"];
    for (const rule of parsed.rules) expect(ownersFor(dir, [rule])).toEqual(rule.owners);
  });

  it("anchors match from the root only; unanchored patterns match a contiguous run at any depth", () => {
    const parsed = parseCodeowners("/payments/ @root-only\nservices/payments/ @anywhere\n");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const anchored = parsed.rules[0]!;
    const unanchored = parsed.rules[1]!;
    // Segment 0 is 'services', so the anchored 'payments' rule cannot match.
    expect(ownersFor(["services", "payments", "pay-a"], [anchored])).toEqual([]);
    expect(ownersFor(["services", "payments", "pay-a"], [unanchored])).toEqual(["@anywhere"]);
    // The documented divergence: a slash-containing pattern without a leading
    // slash matches at ANY depth here, where the forge would anchor it.
    expect(ownersFor(["x", "services", "payments", "pay-a"], [unanchored])).toEqual(["@anywhere"]);
    // Contiguity is required: the run cannot skip a segment.
    expect(ownersFor(["services", "x", "payments"], [unanchored])).toEqual([]);
  });

  it("later matching rules override earlier ones — GitHub's own precedence", () => {
    const parsed = parseCodeowners("/services/ @broad\n/services/payments/ @narrow\n");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(ownersFor(["services", "payments", "pay-a"], parsed.rules)).toEqual(["@narrow"]);
    expect(ownersFor(["services", "core-x"], parsed.rules)).toEqual(["@broad"]);
  });

  it("skips only out-of-subset patterns: other wildcards and a bare '/', never an owner-less directory rule", () => {
    const parsed = parseCodeowners("*.md @docs\nservices/*/api/ @x\n/services/legacy/\n/ @root\n!services/x @y\n");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // Line 3 is GitHub's ownership-CLEARING form with an in-subset pattern: a
    // rule, not a skip — skipping it would hand the previous broad rule's team
    // a service the forge explicitly took off their plate.
    expect(parsed.rules).toEqual([
      { line: 3, pattern: "/services/legacy/", anchored: true, segments: ["services", "legacy"], owners: [] },
    ]);
    expect(parsed.skipped.map((s) => s.line)).toEqual([1, 2, 4, 5]);
  });

  it("an owner-less rule clears ownership — last match wins with empty owners too", () => {
    const parsed = parseCodeowners("/services/ @org/platform\n/services/legacy/\n");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(ownersFor(["services", "legacy", "legacy-svc"], parsed.rules)).toEqual([]);
    expect(ownersFor(["services", "core-x"], parsed.rules)).toEqual(["@org/platform"]);
  });

  it("strips a UTF-8 BOM and trailing comments; blank and comment lines carry nothing", () => {
    const parsed = parseCodeowners("\uFEFF/services/x/ @a # the team\n\n# whole-line comment\n");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rules).toEqual([
      { line: 1, pattern: "/services/x/", anchored: true, segments: ["services", "x"], owners: ["@a"] },
    ]);
    expect(parsed.skipped).toEqual([]);
  });

  it("refuses a token that is not owner-shaped, as data naming the line", () => {
    const parsed = parseCodeowners("/services/x/ @ok\n/services/y/ not-an-owner\n");
    expect(parsed).toEqual({
      ok: false,
      line: 2,
      problem: "'not-an-owner' is not an owner (@user, @org/team or an email address)",
    });
  });
});
