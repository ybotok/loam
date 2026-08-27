/**
 * Tests for `loam verify <FEAT> --diff-answers a.json b.json` — the
 * cross-examination lens (src/commands/verify/cross/diff.ts,
 * src/core/verify/cross/diff.ts).
 *
 * The doctrine under test is structural, not prose: two blind answer sets
 * agreeing is a review-ranking signal, never a verdict, so the payload must
 * carry NO `verified`/`verdict`/`attested` key, the record on disk must stay
 * byte-identical, and the read must ride the lock-free path. The join is by
 * deterministic claim id only — which is why the fixtures never have to
 * coordinate the two agents beyond running the same `loam verify --json`.
 */
import { describe, expect, it, afterEach } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { hostname } from "node:os";
import { join } from "node:path";
import {
  coherentFixture,
  makeProject,
  runLoam,
  type Project,
} from "./helpers/harness.js";
import { FEAT, PAYMENT, RECORD, SPLIT, type Claim } from "./helpers/federated.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function project(files: Record<string, string> = coherentFixture()): Promise<Project> {
  const p = await makeProject(files);
  cleanups.push(() => p.destroy());
  return p;
}

async function claims(p: Project): Promise<Claim[]> {
  const res = await runLoam(p.workDir, "verify", FEAT, "--json");
  expect(res.code, res.out).toBe(0);
  return JSON.parse(res.stdout).claims as Claim[];
}

/** Write one answer set (object-with-`answers` form) into the workdir. */
async function writeSet(p: Project, name: string, answers: unknown): Promise<string> {
  await writeFile(join(p.workDir, name), JSON.stringify({ answers }, null, 2), "utf8");
  return name;
}

/** Every claim confirmed, all citing the same evidence entry. */
function confirmed(cs: Claim[], evidence: string): unknown[] {
  return cs.map((c) => ({ id: c.id, verdict: "confirmed", evidence: [evidence] }));
}

async function diff(p: Project, ...extra: string[]): Promise<{ code: number; out: string; payload: any }> {
  const res = await runLoam(p.workDir, "verify", FEAT, "--diff-answers", ...extra);
  let payload: any = null;
  try {
    payload = JSON.parse(res.stdout);
  } catch {
    // Non-json runs land here; callers asserting on payload pass --json.
  }
  return { code: res.code, out: res.out, payload };
}

describe("loam verify --diff-answers: agreement and disagreement", () => {
  it("full agreement on overlapping evidence: every row agree-confirmed, nothing written, digests reviewer-checkable", async () => {
    const p = await project();
    const cs = await claims(p);
    const a = await writeSet(p, "a.json", confirmed(cs, "src/x.ts:12"));
    const b = await writeSet(p, "b.json", confirmed(cs, "src/x.ts:12"));
    const res = await diff(p, a, b, "--json");
    expect(res.code, res.out).toBe(0);
    expect(res.payload.ok).toBe(true);
    expect(res.payload.claims.map((c: any) => c.code)).toEqual(cs.map(() => "cross.agree-confirmed"));
    expect(res.payload.summary).toEqual({
      claims: cs.length,
      agreeConfirmed: cs.length,
      agreeUnconfirmed: 0,
      disagree: 0,
      evidenceDisjoint: 0,
    });
    expect(res.payload.disagreements).toEqual([]);
    expect(res.payload).not.toHaveProperty("notices");
    // The doctrine, structurally: this surface grades nothing.
    expect(res.payload).not.toHaveProperty("verified");
    expect(res.payload).not.toHaveProperty("verdict");
    expect(res.payload).not.toHaveProperty("attested");
    // Writes nothing: no verification.yaml appears.
    expect(p.exists(RECORD)).toBe(false);
    // The file digests are the sha256 of the exact bytes read.
    for (const [name, pin] of [
      [a, res.payload.files.a],
      [b, res.payload.files.b],
    ] as const) {
      expect(pin.path).toBe(name);
      expect(pin.digest).toBe(createHash("sha256").update(await readFile(join(p.workDir, name))).digest("hex"));
    }
    // Determinism: the same inputs produce the same bytes.
    const again = await diff(p, a, b, "--json");
    expect(again.out).toBe(res.out);
  });

  it("disjoint evidence: agree-confirmed rows carry evidenceDisjoint and the cross.evidence-disjoint notice names them", async () => {
    const p = await project();
    const cs = await claims(p);
    const a = await writeSet(p, "a.json", confirmed(cs, "src/a.ts:1"));
    const b = await writeSet(p, "b.json", confirmed(cs, "lib/b.ts:9"));
    const res = await diff(p, a, b, "--json");
    expect(res.code, res.out).toBe(0);
    for (const row of res.payload.claims) {
      expect(row.code).toBe("cross.agree-confirmed");
      expect(row.evidenceDisjoint).toBe(true);
    }
    expect(res.payload.summary.evidenceDisjoint).toBe(cs.length);
    expect(res.payload.notices).toHaveLength(1);
    expect(res.payload.notices[0].code).toBe("cross.evidence-disjoint");
    expect(res.payload.notices[0].claims.sort()).toEqual(cs.map((c) => c.id).sort());
  });

  it("a :line suffix is normalized away: two citations into one file are NOT disjoint", async () => {
    const p = await project();
    const cs = await claims(p);
    const a = await writeSet(p, "a.json", confirmed(cs, "src/x.ts:42"));
    const b = await writeSet(p, "b.json", confirmed(cs, "src/x.ts:99"));
    const res = await diff(p, a, b, "--json");
    expect(res.code, res.out).toBe(0);
    for (const row of res.payload.claims) expect(row).not.toHaveProperty("evidenceDisjoint");
    expect(res.payload).not.toHaveProperty("notices");
    // A :start-end range suffix normalizes the same way.
    const c = await writeSet(p, "c.json", confirmed(cs, "src/x.ts:10-20"));
    const ranged = await diff(p, a, c, "--json");
    expect(ranged.payload.summary.evidenceDisjoint).toBe(0);
  });

  it("one flipped verdict: cross.disagree, listed in disagreements[], still exit 0 and ok:true", async () => {
    const p = await project();
    const cs = await claims(p);
    const flipped = cs[0]!;
    const a = await writeSet(p, "a.json", confirmed(cs, "src/x.ts:12"));
    const b = await writeSet(p, "b.json", [
      { id: flipped.id, verdict: "unconfirmed", note: "could not find it" },
      ...confirmed(cs.slice(1), "src/x.ts:12"),
    ]);
    const res = await diff(p, a, b, "--json");
    expect(res.code, res.out).toBe(0);
    expect(res.payload.ok).toBe(true);
    const row = res.payload.claims.find((c: any) => c.id === flipped.id);
    expect(row.code).toBe("cross.disagree");
    expect(row.a.verdict).toBe("confirmed");
    expect(row.b.verdict).toBe("unconfirmed");
    expect(row.b.note).toBe("could not find it");
    expect(res.payload.disagreements).toHaveLength(1);
    expect(res.payload.disagreements[0].id).toBe(flipped.id);
    expect(res.payload.summary.disagree).toBe(1);
  });

  it("both unconfirmed: cross.agree-unconfirmed — nobody could look is not agreement-with-evidence", async () => {
    const p = await project();
    const cs = await claims(p);
    const doubted = cs[0]!;
    const rest = cs.slice(1);
    const a = await writeSet(p, "a.json", [
      { id: doubted.id, verdict: "unconfirmed", note: "not built yet" },
      ...confirmed(rest, "src/x.ts:12"),
    ]);
    const b = await writeSet(p, "b.json", [
      { id: doubted.id, verdict: "unconfirmed" },
      ...confirmed(rest, "src/x.ts:12"),
    ]);
    const res = await diff(p, a, b, "--json");
    expect(res.code, res.out).toBe(0);
    const row = res.payload.claims.find((c: any) => c.id === doubted.id);
    expect(row.code).toBe("cross.agree-unconfirmed");
    // Disjointness is a statement about cited evidence, so it never appears on
    // a row where neither side cited any.
    expect(row).not.toHaveProperty("evidenceDisjoint");
    expect(res.payload.summary.agreeUnconfirmed).toBe(1);
    expect(res.payload).not.toHaveProperty("notices");
  });
});

describe("loam verify --diff-answers: fail-closed refusals name the file", () => {
  it("a set that drops a claim refuses answers-mismatch, naming the second file", async () => {
    const p = await project();
    const cs = await claims(p);
    const a = await writeSet(p, "a.json", confirmed(cs, "src/x.ts:12"));
    const b = await writeSet(p, "b.json", confirmed(cs.slice(1), "src/x.ts:12"));
    const res = await diff(p, a, b, "--json");
    expect(res.code).toBe(1);
    expect(res.payload.error.code).toBe("answers-mismatch");
    expect(res.payload.error.message).toContain("second answer set (b.json)");
  });

  it("an unreadable first file refuses answers-unreadable, naming the first file — never a silent empty diff", async () => {
    const p = await project();
    const cs = await claims(p);
    await writeFile(join(p.workDir, "a.json"), "{ not json", "utf8");
    const b = await writeSet(p, "b.json", confirmed(cs, "src/x.ts:12"));
    const res = await diff(p, "a.json", b, "--json");
    expect(res.code).toBe(1);
    expect(res.payload.error.code).toBe("answers-unreadable");
    expect(res.payload.error.message).toContain("first answer set (a.json)");
    // A missing file is the same refusal with the read error.
    const gone = await diff(p, "missing.json", b, "--json");
    expect(gone.payload.error.code).toBe("answers-unreadable");
    expect(gone.payload.error.message).toContain("first answer set (missing.json)");
  });

  it("a confirmed with no evidence in either file refuses answers-unevidenced", async () => {
    const p = await project();
    const cs = await claims(p);
    const a = await writeSet(p, "a.json", confirmed(cs, "src/x.ts:12"));
    const b = await writeSet(p, "b.json", [
      { id: cs[0]!.id, verdict: "confirmed", evidence: [] },
      ...confirmed(cs.slice(1), "src/x.ts:12"),
    ]);
    const res = await diff(p, a, b, "--json");
    expect(res.code).toBe(1);
    expect(res.payload.error.code).toBe("answers-unevidenced");
    expect(res.payload.error.message).toContain("second answer set (b.json)");
  });

  it("a step-6-shaped file (scenario claims omitted for --results) refuses answers-mismatch naming them — the diff consults no report", async () => {
    // The workflow's step 5 teaches exactly this: the cross-examination file
    // must answer EVERY claim in scope, scenario.tested included, so the file
    // shaped for a `--results` recording (which must omit the runner's
    // claims) is a DIFFERENT artifact and refuses here rather than diffing.
    const p = await project();
    const cs = await claims(p);
    const scenarios = cs.filter((c) => c.kind === "scenario.tested");
    expect(scenarios.length).toBeGreaterThan(0);
    const withoutRunners = cs.filter((c) => c.kind !== "scenario.tested");
    const a = await writeSet(p, "a.json", confirmed(withoutRunners, "src/x.ts:12"));
    const b = await writeSet(p, "b.json", confirmed(cs, "src/x.ts:12"));
    const res = await diff(p, a, b, "--json");
    expect(res.code).toBe(1);
    expect(res.payload.error.code).toBe("answers-mismatch");
    expect(res.payload.error.message).toContain("first answer set (a.json)");
    for (const s of scenarios) expect(res.payload.error.message).toContain(s.id);
  });

  it("under --service, an answer naming another service's REAL claim is diagnosed as off-lens, not off-checklist", async () => {
    const p = await project();
    const cs = await claims(p);
    const mine = cs.filter((c) => c.subject === SPLIT);
    const foreign = cs.find((c) => c.subject === PAYMENT)!;
    const a = await writeSet(p, "a.json", confirmed([...mine, foreign], "src/x.ts:12"));
    const b = await writeSet(p, "b.json", confirmed(mine, "src/x.ts:12"));
    const res = await diff(p, a, b, "--service", SPLIT, "--json");
    expect(res.code).toBe(1);
    expect(res.payload.error.code).toBe("answers-mismatch");
    expect(res.payload.error.message).toContain(foreign.id);
    expect(res.payload.error.message).toContain("owned by another service");
    expect(res.payload.error.message).toContain(
      `narrowed the comparison to ${mine.length} of ${cs.length} claims`,
    );
  });

  it("a --service naming no claim on the checklist refuses unknown-service before any file is read", async () => {
    const p = await project();
    const res = await diff(p, "a.json", "b.json", "--service", "no-such-service", "--json");
    expect(res.code).toBe(1);
    expect(res.payload.error.code).toBe("unknown-service");
    expect(res.payload.error.message).toContain("no-such-service");
  });

  it("refuses combination with each recording flag (invalid-option), and writes nothing", async () => {
    const p = await project();
    for (const extra of [
      ["--record", "answers.json"],
      ["--results", "report.json"],
      ["--contract-results", "contract.json"],
    ]) {
      const res = await diff(p, "a.json", "b.json", ...extra, "--json");
      expect(res.code, res.out).toBe(1);
      expect(res.payload.error.code).toBe("invalid-option");
      expect(res.payload.error.message).toContain("writes nothing");
    }
    expect(p.exists(RECORD)).toBe(false);
  });

  it("refuses any arity but exactly two files (invalid-option)", async () => {
    const p = await project();
    const one = await diff(p, "a.json", "--json");
    expect(one.code).toBe(1);
    expect(one.payload.error.code).toBe("invalid-option");
    expect(one.payload.error.message).toContain("exactly two");
    const three = await diff(p, "a.json", "b.json", "c.json", "--json");
    expect(three.code).toBe(1);
    expect(three.payload.error.code).toBe("invalid-option");
  });

  it("an archived feature refuses (invalid-option): frozen history has no current checklist", async () => {
    const p = await project();
    const shipped = await runLoam(p.workDir, "archive", FEAT, "--json");
    expect(shipped.code, shipped.out).toBe(0);
    const res = await diff(p, "a.json", "b.json", "--json");
    expect(res.code).toBe(1);
    expect(res.payload.error.code).toBe("invalid-option");
    expect(res.payload.error.message).toContain("frozen history");
  });
});

describe("loam verify --diff-answers: the --service lens", () => {
  it("narrows the compared claims to one service's, and names the lens in the payload", async () => {
    const p = await project();
    const cs = await claims(p);
    const mine = cs.filter((c) => c.subject === SPLIT);
    const others = cs.filter((c) => c.subject !== SPLIT);
    expect(mine.length).toBeGreaterThan(0);
    expect(others.length).toBeGreaterThan(0);
    const a = await writeSet(p, "a.json", confirmed(mine, "src/x.ts:12"));
    const b = await writeSet(p, "b.json", confirmed(mine, "src/x.ts:12"));
    const res = await diff(p, a, b, "--service", SPLIT, "--json");
    expect(res.code, res.out).toBe(0);
    expect(res.payload.service).toBe(SPLIT);
    expect(res.payload.checklistClaims).toBe(cs.length);
    expect(res.payload.summary.claims).toBe(mine.length);
    // The same files WITHOUT the lens leave the rest of the checklist
    // unanswered — the mismatch refusal, not a silently narrowed diff.
    const whole = await diff(p, a, b, "--json");
    expect(whole.code).toBe(1);
    expect(whole.payload.error.code).toBe("answers-mismatch");
    expect(whole.payload.error.message).toContain(PAYMENT);
  });
});

describe("loam verify --diff-answers: doctrine pins", () => {
  it("never touches a record and never moves a verdict: attested stays attested, bytes stay identical", async () => {
    const p = await project();
    const cs = await claims(p);
    const recorded = await writeSet(p, "recorded.json", confirmed(cs, "src/x.ts:12"));
    const rec = await runLoam(p.workDir, "verify", FEAT, "--record", recorded, "--json");
    expect(rec.code, rec.out).toBe(0);
    expect(JSON.parse(rec.stdout).verdict).toBe("attested");
    const before = await readFile(join(p.docsDir, RECORD));

    const a = await writeSet(p, "a.json", confirmed(cs, "src/x.ts:12"));
    const b = await writeSet(p, "b.json", confirmed(cs, "src/x.ts:12"));
    const res = await diff(p, a, b, "--json");
    expect(res.code, res.out).toBe(0);
    // Agreement upgraded nothing: the payload has no verdict to upgrade.
    expect(res.payload).not.toHaveProperty("verified");
    expect(res.payload).not.toHaveProperty("verdict");
    expect(res.payload).not.toHaveProperty("attested");
    const after = await readFile(join(p.docsDir, RECORD));
    expect(after.equals(before)).toBe(true);
    const reread = await runLoam(p.workDir, "verify", FEAT, "--json");
    expect(JSON.parse(reread.stdout).verdict).toBe("attested");
  });

  it("a verification.yaml too damaged to read blocks the plain read view but NOT the diff", async () => {
    // The moment a cross-examination is most needed is before re-recording
    // over a broken record — so the record-unreadable refusal must not bar
    // the one command that would inform that re-recording.
    const p = await project();
    const cs = await claims(p);
    const a = await writeSet(p, "a.json", confirmed(cs, "src/x.ts:12"));
    const b = await writeSet(p, "b.json", confirmed(cs, "src/x.ts:12"));
    await p.write(RECORD, "claims: [broken yaml\n");
    const read = await runLoam(p.workDir, "verify", FEAT, "--json");
    expect(read.code).toBe(1);
    expect(JSON.parse(read.stdout).error.code).toBe("record-unreadable");
    const res = await diff(p, a, b, "--json");
    expect(res.code, res.out).toBe(0);
    expect(res.payload.ok).toBe(true);
    // And the damaged record was left exactly as it was found.
    expect(await p.read(RECORD)).toBe("claims: [broken yaml\n");
  });

  it("reads lock-free: a live docs lock held by somebody else does not queue or refuse the diff", async () => {
    const p = await project();
    const cs = await claims(p);
    const a = await writeSet(p, "a.json", confirmed(cs, "src/x.ts:12"));
    const b = await writeSet(p, "b.json", confirmed(cs, "src/x.ts:12"));
    // A lock naming a LIVE pid on this host — exactly what a concurrent writer
    // looks like, and unbreakable by the stale-lock rule. The read form must
    // never notice it.
    await writeFile(
      join(p.docsDir, ".loam-lock"),
      `${JSON.stringify({ pid: process.pid, host: hostname(), at: new Date().toISOString() })}\n`,
      "utf8",
    );
    const res = await diff(p, a, b, "--json");
    expect(res.code, res.out).toBe(0);
    expect(res.payload.ok).toBe(true);
  });

  it("human view: the disagreement line reads cross.disagree, and the closing sentence says nothing was written", async () => {
    const p = await project();
    const cs = await claims(p);
    const a = await writeSet(p, "a.json", confirmed(cs, "src/x.ts:12"));
    const b = await writeSet(p, "b.json", [
      { id: cs[0]!.id, verdict: "unconfirmed", note: "not found" },
      ...confirmed(cs.slice(1), "src/x.ts:12"),
    ]);
    const res = await diff(p, a, b);
    expect(res.code, res.out).toBe(0);
    expect(res.out).toContain(`✗ cross.disagree ${cs[0]!.id}`);
    expect(res.out).toContain("a: confirmed (src/x.ts:12)");
    expect(res.out).toContain("b: unconfirmed — not found");
    expect(res.out).toContain("nothing was written and no verdict changed");
    expect(p.exists(RECORD)).toBe(false);
  });
});
