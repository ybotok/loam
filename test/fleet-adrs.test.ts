/**
 * `architecture/adrs/` — the fleet's own decision records, and the promise that
 * comes with them: they are counted, and nothing else.
 *
 * ADRs used to exist at two altitudes only, `services/<id>/adrs/` and
 * `features/<FEAT>/adrs/`, so a decision about the FLEET — "event publishers use
 * a transactional outbox" — had no home but one arbitrary service's directory,
 * where the readers of the other fifty services never find it. The fix is
 * deliberately the smallest one that could work: a directory loam knows the name
 * of, counted the way the service directory beside it is counted, carrying no
 * obligation whatsoever.
 *
 * That last clause is the half a test has to hold, because it is the half a
 * later change would most naturally break: a count is one edit away from a
 * threshold, and "this fleet has no ADRs" is one opinion away from a finding.
 * So the assertions below pin the count AND the silence — an empty
 * `architecture/adrs/` must cost nothing, and a full one must change no verdict.
 */
import { describe, expect, it, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { coherentFixture, makeProject, makeTmpDir, runLoam, type Project } from "./helpers/harness.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function project(files: Record<string, string>): Promise<Project> {
  const p = await makeProject(files);
  cleanups.push(() => p.destroy());
  return p;
}

/** A MADR-shaped decision file, the way the layout documents it. */
function adr(title: string): string {
  return `# ${title}\n\n## Context\n\nThe fleet needs one answer.\n\n## Decision\n\nThis one.\n\n## Consequences\n\nIt holds.\n`;
}

async function listJson(p: Project, ...args: string[]): Promise<Record<string, any>> {
  const res = await runLoam(p.workDir, "list", ...args, "--json");
  expect(res.code, res.out).toBe(0);
  return JSON.parse(res.stdout);
}

/**
 * Every finding a `validate --all` run produced, across every target.
 *
 * Flattened from `targets[].findings`, which is where they actually live: the
 * envelope has no top-level `findings` key, and a helper that read one returned
 * `[]` for every fleet — so the comparisons below passed over a deliberately
 * planted ADR check. The richness floor is the guard against that class: a
 * comparison of two empty lists proves nothing, so this refuses to hand one back.
 */
async function findings(p: Project): Promise<Array<{ code: string; message: string }>> {
  const res = await runLoam(p.workDir, "validate", "--all", "--json");
  const json = JSON.parse(res.stdout) as {
    targets?: Array<{ findings?: Array<{ code: string; message: string }> }>;
  };
  const all = (json.targets ?? []).flatMap((t) => t.findings ?? []);
  expect(all.length, `validate --all reported nothing to compare: ${res.stdout}`).toBeGreaterThan(0);
  return all;
}

/** The same run as a sorted code list — the verdict as comparable data. */
async function findingCodes(p: Project): Promise<string[]> {
  return (await findings(p)).map((f) => f.code).sort();
}

/* ------------------------------------------------------------------ */
/* The count                                                           */
/* ------------------------------------------------------------------ */

describe("loam list reports how many ADRs the fleet holds", () => {
  it("a fleet with no architecture/adrs/ reports 0 — the permanent, normal state", async () => {
    const p = await project(coherentFixture());
    expect((await listJson(p)).fleetAdrs).toBe(0);
  });

  it("counts the markdown files in architecture/adrs/", async () => {
    const p = await project({
      ...coherentFixture(),
      "architecture/adrs/0001-transactional-outbox.md": adr("Event publishers use a transactional outbox"),
      "architecture/adrs/0002-circuit-breakers.md": adr("Cross-service calls carry a circuit breaker"),
    });
    expect((await listJson(p)).fleetAdrs).toBe(2);
  });

  it("counts by the same rule the service directory uses: .md files, directly in it", async () => {
    // `countMarkdown` is loam's one spelling of "count the decisions", and this
    // is what it means — a non-markdown note and a nested filing directory both
    // sit outside the count. A second implementation for the fleet altitude is
    // exactly how `list` and `show` once disagreed about one service's count.
    const p = await project({
      ...coherentFixture(),
      "architecture/adrs/0001-outbox.md": adr("Outbox"),
      "architecture/adrs/notes.txt": "not markdown",
      "architecture/adrs/superseded/0000-old.md": adr("Old"),
    });
    expect((await listJson(p)).fleetAdrs).toBe(1);
  });

  it("is the FLEET's count and never a service's — the two altitudes do not leak", async () => {
    const files = coherentFixture();
    files["services/payment-service/adrs/0001-retry.md"] = adr("Retry policy");
    files["services/payment-service/adrs/0002-cache.md"] = adr("Cache policy");
    files["architecture/adrs/0001-outbox.md"] = adr("Outbox");
    const p = await project(files);

    const json = await listJson(p);
    expect(json.fleetAdrs).toBe(1);
    const payment = json.services.find((s: { id: string }) => s.id === "payment-service");
    expect(payment.adrs).toBe(2);
  });

  it("answers for a docs repo that has decisions before it has services", async () => {
    // The count sits OUTSIDE the maturity rollup for exactly this fleet: a team
    // can decide how it will build services before it has documented one, and a
    // number printed by nothing is a number nobody wrote down.
    const p = await project({
      "architecture/landscape.likec4": "specification {\n  element system\n}\nmodel {\n}\n",
      "architecture/adrs/0001-outbox.md": adr("Outbox"),
      "services/.gitkeep": "",
    });
    expect((await listJson(p)).fleetAdrs).toBe(1);
  });

  it("is reported for `loam list features --json` too — it belongs to the repo, not to a section", async () => {
    const p = await project({
      ...coherentFixture(),
      "architecture/adrs/0001-outbox.md": adr("Outbox"),
    });
    expect((await listJson(p, "features")).fleetAdrs).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* The text view                                                       */
/* ------------------------------------------------------------------ */

describe("the human view says it once, and only when there is something to say", () => {
  it("prints the count, naming the directory it came from", async () => {
    const p = await project({
      ...coherentFixture(),
      "architecture/adrs/0001-outbox.md": adr("Outbox"),
      "architecture/adrs/0002-breakers.md": adr("Breakers"),
    });
    const res = await runLoam(p.workDir, "list");
    expect(res.code, res.out).toBe(0);
    expect(res.out).toContain("adrs: 2 fleet decisions  (architecture/adrs/)");
  });

  it("says `decision` for one, not `decisions`", async () => {
    const p = await project({
      ...coherentFixture(),
      "architecture/adrs/0001-outbox.md": adr("Outbox"),
    });
    expect((await runLoam(p.workDir, "list")).out).toContain("adrs: 1 fleet decision  (");
  });

  it("stays silent at zero — no fleet owes a fleet-level ADR, so `adrs: 0` would read as a gap", async () => {
    const p = await project(coherentFixture());
    const res = await runLoam(p.workDir, "list");
    expect(res.code, res.out).toBe(0);
    expect(res.out).not.toContain("fleet decision");
    expect(res.out).not.toContain("architecture/adrs/");
  });

  it("survives --subsystem: it is not a fact about the slice, so the filter does not withhold it", async () => {
    // The tree dial IS withheld under a filter — a slice's own "unfiled: 0"
    // would be read as a claim about the subsystem. The fleet's decision count
    // is not derived from the rows at all and the line names its own directory,
    // so the two fleet-root facts are withheld differently on purpose.
    const p = await project({
      "architecture/landscape.likec4": "specification {\n  element system\n}\nmodel {\n}\n",
      "architecture/adrs/0001-outbox.md": adr("Outbox"),
      "services/payments/subsystem.yaml": "title: Payments\n",
      "services/payments/payment-service/spec.md": "---\nservice: payment-service\n---\n",
    });

    const res = await runLoam(p.workDir, "list", "--subsystem", "payments");
    expect(res.code, res.out).toBe(0);
    expect(res.out).toContain("filtered to");
    expect(res.out).toContain("adrs: 1 fleet decision");
    expect(res.out).not.toContain("subsystems: ");
  });
});

/* ------------------------------------------------------------------ */
/* No obligation — the half a later change would break                 */
/* ------------------------------------------------------------------ */

describe("nothing grades the fleet's ADRs", () => {
  it("a fleet with none and a fleet with three produce the same findings", async () => {
    const bare = await project(coherentFixture());
    const decided = await project({
      ...coherentFixture(),
      "architecture/adrs/0001-outbox.md": adr("Outbox"),
      "architecture/adrs/0002-breakers.md": adr("Breakers"),
      "architecture/adrs/0003-idempotency.md": adr("Idempotency keys"),
    });

    expect(await findingCodes(decided)).toEqual(await findingCodes(bare));
  });

  it("an EMPTY architecture/adrs/ changes no verdict either", async () => {
    // The half-adopted state: somebody made the directory and wrote nothing in
    // it. It must not become a finding in either direction — neither "you have
    // an empty ADR directory" nor "you have a directory and no decisions".
    const p = await project(coherentFixture());
    const before = await findingCodes(p);
    await mkdir(join(p.docsDir, "architecture", "adrs"), { recursive: true });
    expect(await findingCodes(p)).toEqual(before);
    expect((await listJson(p)).fleetAdrs).toBe(0);
  });

  it("no finding anywhere mentions the fleet ADR directory", async () => {
    // The absence has to be asserted on the MESSAGES too: a check that named
    // `architecture/adrs/` in advice — "consider recording this decision" —
    // would keep the code set identical above and still be exactly the
    // obligation this directory was given specifically so as not to have.
    const p = await project(coherentFixture());
    const mentions = (await findings(p)).filter(
      (f) => f.message.includes("architecture/adrs") || f.code.includes("adr"),
    );
    expect(mentions, JSON.stringify(mentions)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* init leaves it alone                                                */
/* ------------------------------------------------------------------ */

describe("loam init does not scaffold the directory", () => {
  it("a freshly created docs repo has no architecture/adrs/", async () => {
    // git does not carry an empty directory, so a scaffolded one would vanish
    // on the first clone and come back as a diff on the next `init`; and an
    // empty `adrs/` in a new repo reads as an obligation nobody has met, when
    // there is no obligation at all. Documenting the path is the whole feature.
    const dir = await makeTmpDir("loam-fleet-adrs-");
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const res = await runLoam(dir, "init", "--docs", "./d", "--create");
    expect(res.code, res.out).toBe(0);

    expect(existsSync(join(dir, "d", "architecture"))).toBe(true);
    expect(existsSync(join(dir, "d", "architecture", "adrs"))).toBe(false);
    expect(res.out).not.toContain("architecture/adrs");
  });

  it("but the generated AGENTS.md tells an agent the directory exists, and that nothing grades it", async () => {
    const dir = await makeTmpDir("loam-fleet-adrs-agents-");
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    await runLoam(dir, "init", "--docs", "./d", "--create");
    const agents = await readFile(join(dir, "d", "AGENTS.md"), "utf8");

    expect(agents).toContain("architecture/adrs/");
    expect(agents).toMatch(/architecture\/adrs\/[^\n]*nothing grades them/);
  });
});

/* ------------------------------------------------------------------ */
/* The path itself                                                     */
/* ------------------------------------------------------------------ */

describe("the path is spelled once", () => {
  it("a directory named anything else is not the fleet's ADR directory", async () => {
    // The name is `adrs`, the same constant the service directory uses, so the
    // two altitudes cannot drift into `adrs/` and `decisions/`.
    const p = await project({
      ...coherentFixture(),
      "architecture/decisions/0001-outbox.md": adr("Outbox"),
    });
    expect((await listJson(p)).fleetAdrs).toBe(0);
  });

  it("reads the fleet's directory, not the docs root's", async () => {
    const p = await project(coherentFixture());
    await mkdir(join(p.docsDir, "adrs"), { recursive: true });
    await writeFile(join(p.docsDir, "adrs", "0001-stray.md"), adr("Stray"), "utf8");
    expect((await listJson(p)).fleetAdrs).toBe(0);
  });
});
