/**
 * The federated record is a DIRECTORY: one `verification/<svc>.yaml` per
 * attesting service, added up at read time.
 *
 * One shared `verification.yaml` was the wrong shape for a fleet that attests
 * from many docs-repo branches. Every record rewrote the same `summary`,
 * `recorded` and checklist-ordered `claims`, so two teams recording two
 * DIFFERENT services always conflicted when their PRs merged — and the
 * recovery path made it worse: the unreadable-record message said "delete it
 * and record again" about a file holding other teams' attestations, and a
 * hand merge that kept one side's summary was refused as miscounted with
 * advice ("record again") that `--record` itself refused. What is pinned here:
 *
 *  - two branches recording different services merge cleanly in git, and the
 *    merged record reads whole;
 *  - a one-file federated record written before the directory still reads,
 *    a service that records again supersedes its share of it, and the file is
 *    removed once nothing in it counts;
 *  - git conflict markers are named BEFORE parsing, and the advice never tells
 *    anyone to delete a file other services' attestations may be in;
 *  - every refusal's advice is one that works: following it ends in a record;
 *  - archive and unarchive carry the directory;
 *  - the union counts one version of the checklist.
 */
import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { coherentFixture, makeProject, runLoam, type Project } from "./helpers/harness.js";
import {
  answersFile,
  type Claim,
  DIR,
  FEAT,
  filedServices,
  PAYMENT,
  RECORD,
  RECORD_DIR,
  serviceClaims,
  serviceRecord,
  serviceRepo,
  SPLIT,
} from "./helpers/federated.js";
import { readVerificationState } from "../src/core/verify/read/file.js";
import { assembleRecord } from "../src/core/verify/read/union.js";
import { renderVerification } from "../src/core/verify/store/render.js";
import type { Verification } from "../src/core/verify/record.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function project(): Promise<Project> {
  const p = await makeProject(coherentFixture());
  cleanups.push(() => p.destroy());
  return p;
}

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", ["-c", "user.name=Loam Test", "-c", "user.email=loam@example.test", ...args], {
    cwd,
    encoding: "utf8",
  });

/**
 * The claims each service owns, read once per project: the read view refuses
 * while a record file is damaged, and the tests below record THROUGH that
 * damage on purpose, so the answers cannot be derived at that moment.
 */
const owned = new WeakMap<Project, Map<string, Claim[]>>();
async function claimsOf(p: Project, service: string): Promise<Claim[]> {
  const byService = owned.get(p) ?? new Map<string, Claim[]>();
  owned.set(p, byService);
  if (!byService.has(service)) byService.set(service, await serviceClaims(p, service));
  return byService.get(service)!;
}

/** Record one service's claims from its repo, every one confirmed on the same evidence. */
async function record(p: Project, repo: string, service: string, evidence = "proof.ts:2"): Promise<{ code: number; out: string; json: Record<string, any> }> {
  const answers = await answersFile(repo, await claimsOf(p, service), evidence, `${service}-${evidence.replace(/\W/g, "")}.json`);
  const res = await runLoam(repo, "verify", FEAT, "--service", service, "--record", answers, "--json");
  return { code: res.code, out: res.out, json: JSON.parse(res.stdout) as Record<string, any> };
}

async function readView(p: Project): Promise<Record<string, any>> {
  const res = await runLoam(p.workDir, "verify", FEAT, "--json");
  return { code: res.code, ...(JSON.parse(res.stdout) as Record<string, any>) };
}

/** The docs repo as a git checkout with one commit on `main`. */
function gitDocs(p: Project): void {
  git(p.docsDir, "init", "-q");
  git(p.docsDir, "checkout", "-q", "-b", "main");
  git(p.docsDir, "add", "-A");
  git(p.docsDir, "commit", "-qm", "docs");
}

/* ------------------------------------------------------------------ */
/* Parallel branches                                                   */
/* ------------------------------------------------------------------ */

describe("two docs-repo branches recording different services", () => {
  it("merge without a conflict, and the merged record carries both attestations", async () => {
    const p = await project();
    gitDocs(p);
    const splitRepo = await serviceRepo(p, SPLIT, "split-work");
    const paymentRepo = await serviceRepo(p, PAYMENT, "payment-work");
    git(p.docsDir, "branch", "a");
    git(p.docsDir, "branch", "b");

    // Each team records from its own repo onto its own docs branch — the
    // staggered, overlapping PRs a fleet actually produces.
    git(p.docsDir, "checkout", "-q", "a");
    expect((await record(p, splitRepo, SPLIT)).code).toBe(0);
    git(p.docsDir, "add", "-A");
    git(p.docsDir, "commit", "-qm", "split attests");

    git(p.docsDir, "checkout", "-q", "b");
    expect((await record(p, paymentRepo, PAYMENT)).code).toBe(0);
    git(p.docsDir, "add", "-A");
    git(p.docsDir, "commit", "-qm", "payment attests");

    // The one-file record conflicted here every time (add/add from an empty
    // start); one file per service gives git two different paths to add.
    git(p.docsDir, "merge", "-q", "--no-edit", "a");
    expect(git(p.docsDir, "status", "--porcelain")).toBe("");
    expect(await filedServices(p)).toEqual([PAYMENT, SPLIT].sort());

    const view = await readView(p);
    expect(view.code).toBe(0);
    expect(view.recorded.attestations.map((a: { service: string }) => a.service)).toEqual([PAYMENT, SPLIT].sort());
    expect(view.summary.unanswered).toBe(0);
    expect(view.summary.confirmed).toBe(view.summary.claims);
  });

  it("a third branch merging after one attestation already landed is clean too", async () => {
    // The content-conflict case: with one attestation on main, a branch cut
    // before it used to collide on `summary:`, `claims:` and `attestations:`.
    const p = await project();
    gitDocs(p);
    const splitRepo = await serviceRepo(p, SPLIT, "split-work");
    const paymentRepo = await serviceRepo(p, PAYMENT, "payment-work");
    git(p.docsDir, "branch", "late");
    expect((await record(p, splitRepo, SPLIT)).code).toBe(0);
    git(p.docsDir, "add", "-A");
    git(p.docsDir, "commit", "-qm", "split attests on main");

    git(p.docsDir, "checkout", "-q", "late");
    expect((await record(p, paymentRepo, PAYMENT)).code).toBe(0);
    git(p.docsDir, "add", "-A");
    git(p.docsDir, "commit", "-qm", "payment attests late");
    git(p.docsDir, "merge", "-q", "--no-edit", "main");
    expect(git(p.docsDir, "status", "--porcelain")).toBe("");
    expect(await filedServices(p)).toEqual([PAYMENT, SPLIT].sort());
  });
});

/* ------------------------------------------------------------------ */
/* Git conflict markers                                                */
/* ------------------------------------------------------------------ */

describe("a record file a merge left conflict markers in", () => {
  it("is named before parsing, and the recipe for a service's own file — delete it, record again — works", async () => {
    // The one conflict per-service files still allow: the SAME service
    // recorded on two branches. Both sides are that one service's word.
    const p = await project();
    gitDocs(p);
    const splitRepo = await serviceRepo(p, SPLIT, "split-work");
    git(p.docsDir, "branch", "other");
    expect((await record(p, splitRepo, SPLIT, "proof.ts:1")).code).toBe(0);
    git(p.docsDir, "add", "-A");
    git(p.docsDir, "commit", "-qm", "split, one way");
    git(p.docsDir, "checkout", "-q", "other");
    expect((await record(p, splitRepo, SPLIT, "proof.ts:2")).code).toBe(0);
    git(p.docsDir, "add", "-A");
    git(p.docsDir, "commit", "-qm", "split, the other way");
    expect(() => git(p.docsDir, "merge", "-q", "--no-edit", "main")).toThrow();
    expect(await p.read(serviceRecord(SPLIT))).toContain("<<<<<<<");

    const view = await readView(p);
    expect(view.code).toBe(1);
    expect(view.error.code).toBe("record-unreadable");
    expect(view.error.message).toContain(serviceRecord(SPLIT));
    expect(view.error.message).toContain("git conflict markers");
    expect(view.error.message).toContain("holds no other service's word");

    // `--record` refuses it too, and leaves the bytes alone…
    const conflicted = await p.read(serviceRecord(SPLIT));
    const refused = await record(p, splitRepo, SPLIT, "proof.ts:2");
    expect(refused.code).toBe(1);
    expect(refused.json.error.code).toBe("record-unreadable");
    expect(await p.read(serviceRecord(SPLIT))).toBe(conflicted);

    // …and the advice it gave is the way out, not a loop back into it.
    await rm(join(p.docsDir, serviceRecord(SPLIT)));
    const again = await record(p, splitRepo, SPLIT, "proof.ts:2");
    expect(again.code, again.out).toBe(0);
    expect((await readView(p)).code).toBe(0);
  });

  it("in the one-file record, says to take the merged-into branch's copy and never to delete it", async () => {
    const p = await project();
    const splitRepo = await serviceRepo(p, SPLIT, "split-work");
    expect((await record(p, splitRepo, SPLIT)).code).toBe(0);
    const state = await readVerificationState(join(p.docsDir, DIR));
    if (state.state !== "ok") throw new Error("fixture record unreadable");
    // A one-file federated record as an older loam wrote it, then a merge.
    const legacy = renderVerification(state.verification);
    await rm(join(p.docsDir, RECORD_DIR), { recursive: true });
    await p.write(RECORD, `${legacy}<<<<<<< HEAD\n# ours\n=======\n# theirs\n>>>>>>> branch\n`);

    const view = await readView(p);
    expect(view.error.code).toBe("record-unreadable");
    expect(view.error.message).toContain("git conflict markers");
    expect(view.error.message).toContain("do not delete it");
    expect(view.error.message).toContain("branch you merged into");
    expect(view.error.message).not.toContain("delete it and record");
  });

  /*
   * `verify` refused the file and `status`, `gate` and `tasks` reported it, but
   * `validate` — the PR gate a docs repo runs — said nothing: the only target
   * raising `evidence.record-unreadable` was the service one, which runs from
   * a service repo. The feature target now raises it from the docs repo too,
   * at the same severity, so `valid` and archive are untouched and `--strict`
   * is the lever.
   */
  it("is named by validate from the docs repo — on the feature target, under --all and --feature alike", async () => {
    const p = await project();
    const splitRepo = await serviceRepo(p, SPLIT, "split-work");
    expect((await record(p, splitRepo, SPLIT)).code).toBe(0);
    const validate = async (...mode: string[]): Promise<{ code: number; json: Record<string, any> }> => {
      const res = await runLoam(p.workDir, "validate", ...mode, "--json");
      return { code: res.code, json: JSON.parse(res.stdout) as Record<string, any> };
    };
    const recordFinding = (json: Record<string, any>): Record<string, any> | undefined =>
      (json.targets as Array<Record<string, any>>)
        .find((t) => t.kind === "feature" && t.id === FEAT)
        ?.findings.find((f: Record<string, any>) => f.code === "evidence.record-unreadable");
    const modes = [["--all"], ["--feature", FEAT]];
    const clean = await Promise.all(modes.map((mode) => validate(...mode)));
    for (const { json } of clean) expect(recordFinding(json)).toBeUndefined();

    // What a merge of the same service recorded on two branches leaves.
    const ours = await p.read(serviceRecord(SPLIT));
    await p.write(serviceRecord(SPLIT), `<<<<<<< HEAD\n${ours}=======\n${ours}>>>>>>> other\n`);
    for (const [i, mode] of modes.entries()) {
      const { code, json } = await validate(...mode);
      const finding = recordFinding(json);
      expect(finding, `${mode.join(" ")}: ${JSON.stringify(json.targets)}`).toBeDefined();
      expect(finding!.severity).toBe("warn");
      expect(finding!.message).toContain(serviceRecord(SPLIT));
      expect(finding!.message).toContain("git conflict markers");
      expect(finding!.message).toContain("holds no other service's word");
      expect(finding!.locations).toEqual([{ path: serviceRecord(SPLIT), role: "primary" }]);
      expect(json.fixes["evidence.record-unreadable"]).toBeDefined();
      // A warning, and only that: one more than the clean record drew, with
      // `valid` and the exit code what they were — `--strict` is the lever.
      expect(json.summary.warnings).toBe(clean[i]!.json.summary.warnings + 1);
      expect(json.summary.errors).toBe(clean[i]!.json.summary.errors);
      expect(json.valid).toBe(clean[i]!.json.valid);
      expect(code).toBe(clean[i]!.code);
    }
  });
});

/* ------------------------------------------------------------------ */
/* The miscounted loop                                                 */
/* ------------------------------------------------------------------ */

describe("a record file whose summary contradicts its claims", () => {
  it("in a service's own file: the advice is to delete it and record again, and doing so lands", async () => {
    // The loop this closes: "Record the answers again" — and `--record`
    // refusing that very file as unreadable.
    const p = await project();
    const splitRepo = await serviceRepo(p, SPLIT, "split-work");
    expect((await record(p, splitRepo, SPLIT)).code).toBe(0);
    const doc = parse(await p.read(serviceRecord(SPLIT))) as { summary: Record<string, number> };
    doc.summary["confirmed"] = doc.summary["confirmed"]! - 1;
    await p.write(serviceRecord(SPLIT), stringify(doc));

    const refused = await record(p, splitRepo, SPLIT);
    expect(refused.code).toBe(1);
    expect(refused.json.error.code).toBe("record-unreadable");
    expect(refused.json.error.message).toContain("verify.record-miscounted");
    expect(refused.json.error.message).toContain(`delete it and record ${SPLIT} again`);

    await rm(join(p.docsDir, serviceRecord(SPLIT)));
    expect((await record(p, splitRepo, SPLIT)).code).toBe(0);
  });

  it("in the one-file record: restore it, never delete it — other services' word may be in it", async () => {
    const p = await project();
    const splitRepo = await serviceRepo(p, SPLIT, "split-work");
    const paymentRepo = await serviceRepo(p, PAYMENT, "payment-work");
    expect((await record(p, splitRepo, SPLIT)).code).toBe(0);
    expect((await record(p, paymentRepo, PAYMENT)).code).toBe(0);
    const state = await readVerificationState(join(p.docsDir, DIR));
    if (state.state !== "ok") throw new Error("fixture record unreadable");
    const legacy = { ...state.verification, summary: { ...state.verification.summary, confirmed: 0 } };
    await rm(join(p.docsDir, RECORD_DIR), { recursive: true });
    await p.write(RECORD, renderVerification(legacy));

    const view = await readView(p);
    expect(view.error.code).toBe("record-unreadable");
    expect(view.error.message).toContain("verify.record-miscounted");
    expect(view.error.message).toContain("do not delete it");
    expect(view.error.message).toContain("restore it from version control");
  });
});

/* ------------------------------------------------------------------ */
/* The one-file federated record, read forever                         */
/* ------------------------------------------------------------------ */

describe("a one-file federated record written before the directory", () => {
  /** Two services' attestations in ONE verification.yaml, exactly the shape the previous loam wrote. */
  async function legacyFederated(p: Project): Promise<{ splitRepo: string; paymentRepo: string; bytes: string }> {
    const splitRepo = await serviceRepo(p, SPLIT, "split-work");
    const paymentRepo = await serviceRepo(p, PAYMENT, "payment-work");
    expect((await record(p, splitRepo, SPLIT)).code).toBe(0);
    expect((await record(p, paymentRepo, PAYMENT)).code).toBe(0);
    const state = await readVerificationState(join(p.docsDir, DIR));
    if (state.state !== "ok") throw new Error("fixture record unreadable");
    const bytes = renderVerification(state.verification);
    await rm(join(p.docsDir, RECORD_DIR), { recursive: true });
    await p.write(RECORD, bytes);
    return { splitRepo, paymentRepo, bytes };
  }

  it("still reads whole; a service recording again supersedes its share and leaves the file alone", async () => {
    const p = await project();
    const { splitRepo, paymentRepo, bytes } = await legacyFederated(p);
    const before = await readView(p);
    expect(before.code).toBe(0);
    expect(before.recorded.attestations.map((a: { service: string }) => a.service)).toEqual([PAYMENT, SPLIT].sort());
    expect(before.summary.unanswered).toBe(0);

    // SPLIT records again, citing other evidence: its file supersedes its
    // share of the one-file record, which is not rewritten.
    const again = await record(p, splitRepo, SPLIT, "proof.ts:1");
    expect(again.code, again.out).toBe(0);
    expect(await p.read(RECORD)).toBe(bytes);
    const mid = await readView(p);
    expect(mid.summary.unanswered).toBe(0);
    const split = mid.claims.filter((c: { subject: string }) => c.subject === SPLIT);
    expect(split.every((c: { evidence: string[] }) => c.evidence[0] === "proof.ts:1")).toBe(true);
    const payment = mid.claims.filter((c: { subject: string }) => c.subject === PAYMENT);
    expect(payment.every((c: { verdict: string }) => c.verdict === "confirmed")).toBe(true);

    // Once every service it names has a file of its own, nothing in it counts
    // any more, and the write that makes it so removes it.
    expect((await record(p, paymentRepo, PAYMENT)).code).toBe(0);
    expect(p.exists(RECORD)).toBe(false);
    expect(await filedServices(p)).toEqual([PAYMENT, SPLIT].sort());
    expect((await readView(p)).summary.unanswered).toBe(0);
  });

  it("is still read when archived, and archive carries the per-service directory with the feature", async () => {
    const p = await project();
    const splitRepo = await serviceRepo(p, SPLIT, "split-work");
    const paymentRepo = await serviceRepo(p, PAYMENT, "payment-work");
    expect((await record(p, splitRepo, SPLIT)).code).toBe(0);
    expect((await record(p, paymentRepo, PAYMENT)).code).toBe(0);
    const live = await readView(p);

    expect((await runLoam(p.workDir, "archive", FEAT)).code).toBe(0);
    const archived = "features/archive/FEAT-1-split/verification";
    expect(p.exists(`${archived}/${SPLIT}.yaml`)).toBe(true);
    expect(p.exists(`${archived}/${PAYMENT}.yaml`)).toBe(true);
    const frozen = await readView(p);
    expect(frozen.frozen).toBe(true);
    expect(frozen.recorded.path).toBe(archived);
    expect(frozen.recorded.attestations.map((a: { service: string }) => a.service)).toEqual([PAYMENT, SPLIT].sort());
    expect(frozen.verdict).toBe(live.verdict);
    expect(frozen.summary.claims).toBe(live.summary.claims);

    expect((await runLoam(p.workDir, "unarchive", FEAT)).code).toBe(0);
    expect(await filedServices(p)).toEqual([PAYMENT, SPLIT].sort());
    expect((await readView(p)).verdict).toBe(live.verdict);
  });
});

/* ------------------------------------------------------------------ */
/* The union                                                           */
/* ------------------------------------------------------------------ */

/** One service's file of a four-claim checklist. */
function part(service: string, checklist: string, recorded: string, ids: string[]): Verification {
  const total = 4;
  return {
    schema: 2,
    feature: FEAT,
    recorded,
    checklist,
    summary: { claims: total, confirmed: ids.length, unconfirmed: 0, unanswered: total - ids.length },
    claims: ids.map((id) => ({
      id,
      kind: "service.exists",
      subject: service,
      claim: id,
      verdict: "confirmed",
      answered_by: "agent",
      evidence: ["x.ts:1"],
    })),
    attestations: [{ service, commit: "0".repeat(40), recorded, claims: ids, checklist }],
  };
}

describe("assembleRecord", () => {
  it("adds agreeing files up and recomputes the summary instead of reading one", () => {
    const v = assembleRecord(null, [part("a", "D", "2026-10-01", ["a1", "a2"]), part("b", "D", "2026-10-02", ["b1"])])!;
    expect(v.checklist).toBe("D");
    expect(v.recorded).toBe("2026-10-02");
    expect(v.summary).toEqual({ claims: 4, confirmed: 3, unconfirmed: 0, unanswered: 1 });
    expect(v.attestations!.map((a) => a.service)).toEqual(["a", "b"]);
  });

  it("counts only the newest checklist's answers; a file behind it keeps its attestation and loses its say", () => {
    // 'b' answered an older question set. Its id 'b-old' is not a question
    // the newest checklist asks — counting it would let a stale answer fill
    // the slot of whichever question replaced it.
    const v = assembleRecord(null, [part("a", "NEW", "2026-10-03", ["a1"]), part("b", "OLD", "2026-10-01", ["b-old"])])!;
    expect(v.checklist).toBe("NEW");
    expect(v.claims.map((c) => c.id)).toEqual(["a1"]);
    expect(v.summary.unanswered).toBe(3);
    expect(v.attestations!.map((a) => [a.service, a.checklist])).toEqual([["a", "NEW"], ["b", "OLD"]]);
  });

  it("returns a one-file record verbatim when no service has a file of its own", () => {
    const legacy = part("a", "D", "2026-10-01", ["a1"]);
    expect(assembleRecord(legacy, [])).toBe(legacy);
    expect(assembleRecord(null, [])).toBeNull();
  });

  it("drops an all-at-once file entirely once a service has a file — its answers carry no attestation", () => {
    const allAtOnce: Verification = { ...part("x", "D", "2026-10-05", ["a1", "b1"]), schema: undefined, attestations: undefined };
    const v = assembleRecord(allAtOnce, [part("a", "D", "2026-10-01", ["a1"])])!;
    expect(v.claims.map((c) => c.id)).toEqual(["a1"]);
    expect(v.attestations!.map((a) => a.service)).toEqual(["a"]);
  });
});
