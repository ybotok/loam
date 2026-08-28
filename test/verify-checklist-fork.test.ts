/**
 * An attestation says what it answered, and against which version of the
 * question set — `checklist` and `docsCommit` on `ServiceAttestation`.
 *
 * The hole these close is a correctness one, not an ergonomic one. A federated
 * record carries ONE top-level `checklist` digest, so two services attesting a
 * week apart across a rewritten delta wrote the same field, and the record
 * could not represent the disagreement at all: the staleness check flagged both
 * or neither and never said which answers went stale. `commit` pinned the
 * service repo — the code the evidence points into — and nothing pinned the
 * side the QUESTION came from.
 *
 * Three properties are pinned here, and the third is the one a well-meaning
 * change would break: an attestation with no `checklist` field must NOT be read
 * as a third version. Silence is not disagreement, and treating it as one would
 * fire `verify.checklist-forked` on every record written before the field
 * existed.
 */
import { describe, expect, it, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { forkedChecklistNotices } from "../src/commands/verify/frozen.js";
import type { Verification } from "../src/core/verify/record.js";
import { coherentFixture, makeProject, runLoam, type Project } from "./helpers/harness.js";
import { answersFile, FEAT, RECORD, serviceClaims, serviceRepo, SPLIT } from "./helpers/federated.js";

function record(attestations: { service: string; checklist?: string }[]): Verification {
  return {
    schema: 2,
    feature: FEAT,
    recorded: "2026-08-29",
    checklist: "aaaaaaaaaaaaaaaa",
    summary: { claims: 0, confirmed: 0, unconfirmed: 0 },
    claims: [],
    attestations: attestations.map((a) => ({
      service: a.service,
      commit: "0".repeat(40),
      recorded: "2026-08-29",
      claims: [],
      ...(a.checklist === undefined ? {} : { checklist: a.checklist }),
    })),
  };
}

let project: Project | null = null;
afterEach(async () => {
  await project?.destroy();
  project = null;
});

const CURRENT = "1111111111111111";

describe("verify.checklist-forked", () => {
  it("says nothing when every attestation answered the question set being asked now", () => {
    expect(forkedChecklistNotices(record([
      { service: "a", checklist: CURRENT },
      { service: "b", checklist: CURRENT },
    ]), CURRENT)).toEqual([]);
  });

  it("names the services that answered something else, not merely a disagreement", () => {
    const notices = forkedChecklistNotices(record([
      { service: "b", checklist: "2222222222222222" },
      { service: "a", checklist: CURRENT },
    ]), CURRENT);
    expect(notices).toHaveLength(1);
    expect(notices[0]!.code).toBe("verify.checklist-forked");
    // Never an error and never a gate: services attest as they finish, and a
    // feature legitimately changes between the first and the last.
    expect(notices[0]!.severity).toBe("warn");
    expect(notices[0]!.message).toContain("2222222222222222 (b)");
    // 'a' is current, so it is not named as stale.
    expect(notices[0]!.message).not.toContain(`${CURRENT} (a)`);
  });

  it("fires when every attestation agrees with the others and none with the present", () => {
    // The case a pairwise comparison calls clean and a reader most needs: three
    // services attested against a delta that has since been rewritten. They
    // agree with each other perfectly, and every one of them is stale.
    const notices = forkedChecklistNotices(record([
      { service: "a", checklist: "3333333333333333" },
      { service: "b", checklist: "3333333333333333" },
    ]), CURRENT);
    expect(notices).toHaveLength(1);
    expect(notices[0]!.message).toContain("3333333333333333 (a, b)");
  });

  it("treats a missing checklist as no claim, not as a stale one", () => {
    // A record written before the field existed. Reading its silence as an
    // answer to some other checklist would flag every pre-existing federated
    // record in the world.
    expect(forkedChecklistNotices(record([{ service: "a" }, { service: "b" }]), CURRENT)).toEqual([]);
    expect(forkedChecklistNotices(record([
      { service: "a", checklist: CURRENT },
      { service: "b" },
    ]), CURRENT)).toEqual([]);
    expect(forkedChecklistNotices(null, CURRENT)).toEqual([]);
  });

  it("records the checklist it answered, and the docs commit when git can say", async () => {
    project = await makeProject(coherentFixture(), { service: SPLIT });
    const repo = await serviceRepo(project, SPLIT, "primary");
    // The docs repo is a git checkout here, so the docs side of the pin is
    // answerable. The fixture's own workdir is the service repo.
    execFileSync("git", ["init", "-q"], { cwd: project.docsDir });
    execFileSync("git", ["add", "-A"], { cwd: project.docsDir });
    execFileSync(
      "git",
      ["-c", "user.name=Loam Test", "-c", "user.email=loam@example.test", "commit", "-qm", "docs"],
      { cwd: project.docsDir },
    );
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: project.docsDir }).toString().trim();

    const claims = await serviceClaims(project, SPLIT);
    const answers = await answersFile(repo, claims);
    const run = await runLoam(project.workDir, "verify", FEAT, "--service", SPLIT, "--record", answers);
    expect(run.code, run.out).toBe(0);

    const written = parse(await readFile(join(project.docsDir, RECORD), "utf8")) as Verification;
    const mine = written.attestations!.find((a) => a.service === SPLIT)!;
    expect(mine.checklist).toBe(written.checklist);
    expect(mine.docsCommit).toBe(head);
    // The service side is still pinned separately — the two answer different
    // questions and neither replaces the other.
    expect(mine.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(mine.commit).not.toBe(head);
  });

  it("omits docsCommit rather than refusing when the docs repo is not a git checkout", async () => {
    project = await makeProject(coherentFixture(), { service: SPLIT });
    const repo = await serviceRepo(project, SPLIT, "primary");
    const claims = await serviceClaims(project, SPLIT);
    const answers = await answersFile(repo, claims);
    const run = await runLoam(project.workDir, "verify", FEAT, "--service", SPLIT, "--record", answers);
    // A docs repo is not obliged to be a git checkout. Refusing the record over
    // an optional field would break a working fleet for bookkeeping.
    expect(run.code, run.out).toBe(0);

    const written = parse(await readFile(join(project.docsDir, RECORD), "utf8")) as Verification;
    const mine = written.attestations!.find((a) => a.service === SPLIT)!;
    expect(mine.docsCommit).toBeUndefined();
    expect(mine.checklist).toBe(written.checklist);
  });
});
