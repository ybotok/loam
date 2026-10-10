/**
 * A record kept as per-service files answers the checklist being asked NOW,
 * not whichever file carries the latest date.
 *
 * The union used to pick the version of the checklist it counted by the
 * newest `recorded` — a DATE, ties broken by service id. A service that
 * recorded the current checklist this morning lost the tie to a service with a
 * later id that had recorded an older one an hour before (or a day later, from
 * a docs branch that was behind): the current answers were dropped, `verify`,
 * `status`, `list`, `tasks` and `gate` all called the record stale and said
 * "re-derive and re-answer", and the writer printed a tally its own answers
 * were not in, with no notice saying why. Pinned here:
 *
 *  - given the live digest, the union counts the files that answered it
 *    (the reviewer's tie repro, verbatim), and falls back to the newest only
 *    when nobody answered it or nobody knows;
 *  - end to end, the same-day fork leaves every reader agreeing that the
 *    record is current, and the writer names the service that is behind;
 *  - the per-service files are read in parallel, and a refusal still names the
 *    first unreadable file by name.
 */
import { afterEach, describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { coherentFixture, FEATURE_SPEC, makeProject, runLoam, type Project } from "./helpers/harness.js";
import { answersFile, DIR, FEAT, PAYMENT, RECORD_DIR, serviceClaims, serviceRepo, SPLIT } from "./helpers/federated.js";
import { assembleRecord } from "../src/core/verify/read/union.js";
import type { Verification } from "../src/core/verify/record.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

/** The reviewer's `part`: one service's file of a four-claim checklist. */
function part(service: string, checklist: string, recorded: string, ids: string[]): Verification {
  return {
    schema: 2,
    feature: "F",
    recorded,
    checklist,
    summary: { claims: 4, confirmed: ids.length, unconfirmed: 0, unanswered: 4 - ids.length },
    claims: ids.map((id) => ({ id, kind: "service.exists", subject: service, claim: id, verdict: "confirmed", answered_by: "agent", evidence: ["x"] })),
    attestations: [{ service, commit: "0".repeat(40), recorded, claims: ids, checklist }],
  };
}

describe("assembleRecord, told which checklist is being asked", () => {
  it("counts the files that answered it — the same-day tie no longer goes to the older checklist", () => {
    // billing recorded against the CURRENT checklist NEW; orders earlier the same day against OLD.
    const parts = [part("billing", "NEW", "2026-10-10", ["b1", "b2"]), part("orders", "OLD", "2026-10-10", ["o1"])];
    const v = assembleRecord(null, parts, "NEW")!;
    expect(v.checklist).toBe("NEW");
    expect(v.claims.map((c) => c.id)).toEqual(["b1", "b2"]);
    expect(v.summary).toEqual({ claims: 4, confirmed: 2, unconfirmed: 0, unanswered: 2 });
    // The service behind keeps its attestation — the forked notice names it.
    expect(v.attestations!.map((a) => [a.service, a.checklist])).toEqual([["billing", "NEW"], ["orders", "OLD"]]);
  });

  it("…and a day later, from a docs branch that was behind", () => {
    const v = assembleRecord(null, [part("billing", "NEW", "2026-10-10", ["b1"]), part("orders", "OLD", "2026-10-11", ["o1"])], "NEW")!;
    expect(v.checklist).toBe("NEW");
    expect(v.recorded).toBe("2026-10-10");
    expect(v.claims.map((c) => c.id)).toEqual(["b1"]);
  });

  it("falls back to the newest file when nobody answered the live checklist, or nobody says what it is", () => {
    const parts = [part("billing", "NEW", "2026-10-10", ["b1", "b2"]), part("orders", "OLD", "2026-10-10", ["o1"])];
    // No caller knows (the frozen view of an archived feature): newest, by date then id.
    expect(assembleRecord(null, parts)!.checklist).toBe("OLD");
    // Nobody answered it: stale whichever part stands for the record, and the newest is the one a reader recognises.
    expect(assembleRecord(null, parts, "NEWER")!.checklist).toBe("OLD");
  });
});

async function project(): Promise<Project> {
  const p = await makeProject(coherentFixture());
  cleanups.push(() => p.destroy());
  return p;
}

async function json(cwd: string, ...args: string[]): Promise<Record<string, any>> {
  const res = await runLoam(cwd, ...args, "--json");
  expect(res.code, res.out).toBe(0);
  return JSON.parse(res.stdout) as Record<string, any>;
}

describe("a same-day record against an older checklist", () => {
  it("drops nobody's current answers — the writer, verify, status, list, tasks and gate agree", async () => {
    const p = await project();
    // A living home for the split service, so `gate --service` has a service
    // to grade: its directory changes no claim (it carries no openapi.yaml, so
    // every operation the delta adds is still new).
    await p.write(
      "services/payment-split-service/spec.md",
      "---\nservice: payment-split-service\nstatus: draft\n---\n\n# payment-split-service\n\n## Requirements\n",
    );
    const split = await serviceRepo(p, SPLIT);
    const payment = await serviceRepo(p, PAYMENT);
    // payment-service's claims (its calls into the split service) survive the
    // edit below unchanged, so they can be read once, here.
    const paymentClaims = await serviceClaims(p, PAYMENT);
    expect(paymentClaims.length).toBeGreaterThan(0);

    // The split service records against the checklist as it stands.
    const splitAnswers = await answersFile(split, await serviceClaims(p, SPLIT));
    const first = await runLoam(split, "verify", FEAT, "--service", SPLIT, "--record", splitAnswers, "--json");
    expect(first.code, first.out).toBe(0);
    const old = JSON.parse(first.stdout).digest as string;

    // The feature moves: rewording a scenario body renames its claim, so the
    // checklist digest changes while payment-service's claims do not.
    await writeFile(
      join(p.docsDir, DIR, "specs/payment-split-service/spec.md"),
      FEATURE_SPEC.replace("two shares are recorded", "two shares are recorded and announced"),
      "utf8",
    );
    const live = (await json(p.workDir, "verify", FEAT)).digest as string;
    expect(live).not.toBe(old);

    // payment-service records the CURRENT checklist, the same day. It sorts
    // before payment-split-service, so a date tie used to go to the split
    // service's file and its older checklist.
    const paymentAnswers = await answersFile(payment, paymentClaims);
    const wrote = await runLoam(payment, "verify", FEAT, "--service", PAYMENT, "--record", paymentAnswers, "--json");
    expect(wrote.code, wrote.out).toBe(0);
    const written = JSON.parse(wrote.stdout) as Record<string, any>;
    expect(written.recorded).toBe(JSON.parse(first.stdout).recorded);
    // The writer's tally is the record its own answers are in…
    expect(written.digest).toBe(live);
    expect(written.summary.confirmed).toBe(paymentClaims.length);
    // …and it names the service whose answers it left out, and why.
    const forked = (written.notices as Array<{ code: string; message: string }>).find((n) => n.code === "verify.checklist-forked");
    expect(forked?.message).toContain(`${old} (${SPLIT})`);

    // Every reader agrees the record answers the feature as it stands.
    const read = await json(p.workDir, "verify", FEAT);
    expect(read.recorded).toMatchObject({ checklist: live, stale: false });
    expect((await json(p.workDir, "status", FEAT)).verification.state).toBe("recorded");
    const listed = (await json(p.workDir, "list", "features")).features.find((f: { id: string }) => f.id === FEAT);
    expect(listed.verification.state).toBe("recorded");
    expect((await json(p.workDir, "tasks", FEAT)).record).toBe("recorded");
    // The gate's exit code is about this bare fixture's partners, not the
    // record; the verification row is the part under test.
    const gate = JSON.parse((await runLoam(p.workDir, "gate", "--service", SPLIT, "--json")).stdout) as Record<string, any>;
    expect(gate.features).toEqual([expect.objectContaining({ id: FEAT, state: "recorded" })]);
  });
});

describe("the per-service files are read in parallel", () => {
  it("and a refusal still names the first unreadable one by name, whichever read failed first", async () => {
    const p = await project();
    // Two damaged files, written in reverse order: the answer must not depend
    // on which read happened to finish first.
    await p.write(`${RECORD_DIR}/zz-service.yaml`, "{ not: yaml\n");
    await p.write(`${RECORD_DIR}/aa-service.yaml`, "{ not: yaml\n");
    for (let run = 0; run < 3; run++) {
      const res = await runLoam(p.workDir, "verify", FEAT, "--json");
      expect(res.code).toBe(1);
      const err = JSON.parse(res.stdout).error as { code: string; message: string };
      expect(err.code).toBe("record-unreadable");
      expect(err.message).toContain(`${RECORD_DIR}/aa-service.yaml`);
      expect(err.message).not.toContain("zz-service");
    }
  });
});
