/**
 * Federation: the one place ten repositories meet.
 *
 * A fleet's docs repo holds the questions; the answers live in ten service
 * repos, and only the repo that owns a claim can attest it — against its own
 * git HEAD, with evidence inside its own tree. Everything here pins the
 * properties that make that trustworthy rather than merely possible:
 *
 *  - a record with other services' attestations on it is NEVER overwritten by
 *    the legacy all-at-once form. That form answers the whole checklist on one
 *    repo's word, and what it replaced the federated record with looked
 *    perfectly well-formed afterwards — the erasure was undetectable;
 *  - `--service X` is a claim about the repository loam is standing in, so the
 *    repository has to say it is X. `--service` may be omitted there (it is
 *    already written down in loam.json) but omitting it must never fall back to
 *    the all-at-once form;
 *  - a federated write is a PARTIAL write, so it drops answers it cannot bind
 *    to a commit — and it says which, because silence reads as loam losing them;
 *  - federation has to be discoverable from the command itself: the read view
 *    narrows to a service, every claim line names its subject, and the footer
 *    prints the form that will actually work from THIS repo;
 *  - a verification.yaml that exists but will not parse is a third state, not
 *    "no record": it is somebody's answers, and overwriting it silently is how
 *    a fleet loses a week of attestations.
 *
 * And, orthogonally, the two writers that name files after prose: `loam
 * gherkin` must not overwrite another in-flight feature's .feature file, and
 * its slugs must survive a fleet that does not write in ASCII.
 */
import { describe, expect, it, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import {
  coherentFixture,
  makeProject,
  runLoam,
  FEATURE_SPEC,
  LANDSCAPE,
  LIVING_OPENAPI,
  LIVING_SPEC,
  pinFor,
  type Project,
} from "./helpers/harness.js";
import { slugOf } from "../src/core/gherkin/emit.js";
import { parseStampedFeature } from "../src/core/gherkin/read.js";
import { scenarioDigest } from "../src/core/gherkin/stamp.js";
import { parseRequirements } from "../src/core/document/parse.js";

const FEAT = "FEAT-1";
const DIR = "features/FEAT-1-split";
const RECORD = `${DIR}/verification.yaml`;
const SPLIT = "payment-split-service";
const PAYMENT = "payment-service";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function project(files: Record<string, string> = coherentFixture()): Promise<Project> {
  const p = await makeProject(files);
  cleanups.push(() => p.destroy());
  return p;
}

interface Claim {
  id: string;
  kind: string;
  subject: string;
  claim: string;
  verdict: string;
}

/**
 * A service repository beside the docs project: its own loam.json naming the
 * service, one committed file to point evidence at, and a git HEAD to bind to.
 */
async function serviceRepo(p: Project, service: string, name = service): Promise<string> {
  const repo = join(dirname(p.workDir), name);
  await mkdir(repo, { recursive: true });
  await writeFile(
    join(repo, "loam.json"),
    JSON.stringify({ docsDir: p.docsDir, service }, null, 2) + "\n",
    "utf8",
  );
  await writeFile(join(repo, "proof.ts"), "export const proof = true;\n// implementation evidence\n", "utf8");
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["add", "loam.json", "proof.ts"], { cwd: repo });
  execFileSync(
    "git",
    ["-c", "user.name=Loam Test", "-c", "user.email=loam@example.test", "commit", "-qm", "fixture"],
    { cwd: repo },
  );
  return repo;
}

const head = (repo: string): string =>
  execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();

/** The whole checklist, read from the docs project (nothing is narrowed). */
async function allClaims(p: Project): Promise<Claim[]> {
  const res = await runLoam(p.workDir, "verify", FEAT, "--json");
  expect(res.code, res.out).toBe(0);
  return JSON.parse(res.stdout).claims as Claim[];
}

async function answersFile(dir: string, claims: Claim[], name = "answers.json"): Promise<string> {
  await writeFile(
    join(dir, name),
    JSON.stringify(
      claims.map((c) => ({ id: c.id, verdict: "confirmed", evidence: ["proof.ts:2"] })),
      null,
      2,
    ) + "\n",
    "utf8",
  );
  return name;
}

/** A cucumber report whose one scenario carries FEATURE_SPEC's digest and ran green. */
function greenReport(): unknown {
  const digest = scenarioDigest(SPLIT, parseRequirements(FEATURE_SPEC)[0]!.scenarios[0]!.lines);
  return [
    {
      uri: "features/loam/split-a-payment.feature",
      name: "Split a payment",
      elements: [
        {
          name: "Split across two payees",
          type: "scenario",
          tags: [{ name: `@loam-digest-${digest}` }],
          steps: [{ result: { status: "passed" } }],
        },
      ],
    },
  ];
}

/** Attest this service's claims from its own repo, the way a service agent does. */
async function attest(p: Project, repo: string, service: string): Promise<Record<string, any>> {
  const local = (await allClaims(p)).filter((c) => c.subject === service);
  const file = await answersFile(repo, local);
  const result = await runLoam(repo, "verify", FEAT, "--service", service, "--record", file, "--json");
  return { result, json: JSON.parse(result.stdout), local };
}

/* ------------------------------------------------------------------ */
/* 1. The legacy form never erases a federated record                  */
/* ------------------------------------------------------------------ */

describe("legacy --record over a federated record", () => {
  it("refuses with record-federated, names the attestors, and leaves the file byte-identical", async () => {
    const p = await project();
    const splitRepo = await serviceRepo(p, SPLIT, "split-work");
    const attested = await attest(p, splitRepo, SPLIT);
    expect(attested.result.code, attested.result.out).toBe(0);

    const before = await p.read(RECORD);
    // A complete, well-formed all-at-once answer set — the refusal is about
    // WHAT it would replace, not about the answers being wrong.
    const all = await allClaims(p);
    const file = await answersFile(p.workDir, all, "all.json");

    const res = await runLoam(p.workDir, "verify", FEAT, "--record", file, "--json");
    expect(res.code).toBe(1);
    const err = JSON.parse(res.stdout).error;
    expect(err.code).toBe("record-federated");
    // it names who would be erased, and the form that would not erase them
    expect(err.message).toContain(SPLIT);
    expect(err.message).toContain("--service");
    expect(await p.read(RECORD)).toBe(before);

    // the prose mode refuses identically — no half-written record either way
    const prose = await runLoam(p.workDir, "verify", FEAT, "--record", file);
    expect(prose.code).toBe(1);
    expect(await p.read(RECORD)).toBe(before);
  });

  it("still writes the legacy record when nothing has been attested", async () => {
    const p = await project();
    const all = await allClaims(p);
    const file = await answersFile(p.workDir, all, "all.json");
    const res = await runLoam(p.workDir, "verify", FEAT, "--record", file, "--json");
    expect(res.code, res.out).toBe(0);
    const doc = parse(await p.read(RECORD)) as Record<string, any>;
    expect(doc.schema).toBeUndefined();
    expect(doc.attestations).toBeUndefined();
  });

  it("a schema-1 record's answers are listed, not silently dropped, when federation starts", async () => {
    const p = await project();
    // an all-at-once record answering all four claims...
    const all = await allClaims(p);
    const legacy = await answersFile(p.workDir, all, "all.json");
    expect((await runLoam(p.workDir, "verify", FEAT, "--record", legacy)).code).toBe(0);
    const foreign = all.find((c) => c.subject === PAYMENT)!;

    // ...and then the first federated write, which can carry over nothing that
    // no commit attests
    const splitRepo = await serviceRepo(p, SPLIT, "split-work");
    const attested = await attest(p, splitRepo, SPLIT);
    expect(attested.result.code, attested.result.out).toBe(0);
    expect(attested.json.discarded).toEqual([
      expect.objectContaining({ id: foreign.id, reason: "unattested" }),
    ]);
    expect(attested.json.summary.unanswered).toBe(1);
  });

  it("says the same out loud in the human view", async () => {
    const p = await project();
    const all = await allClaims(p);
    expect((await runLoam(p.workDir, "verify", FEAT, "--record", await answersFile(p.workDir, all, "all.json"))).code).toBe(0);
    const foreign = all.find((c) => c.subject === PAYMENT)!;

    const splitRepo = await serviceRepo(p, SPLIT, "split-work");
    const file = await answersFile(splitRepo, all.filter((c) => c.subject === SPLIT));
    const prose = await runLoam(splitRepo, "verify", FEAT, "--service", SPLIT, "--record", file);
    expect(prose.code, prose.out).toBe(0);
    expect(prose.out).toContain("not carried into this record");
    expect(prose.out).toContain(foreign.id);
    expect(prose.out).toContain("must record it again");
  });
});

/* ------------------------------------------------------------------ */
/* 3. --service is a claim about THIS repository                       */
/* ------------------------------------------------------------------ */

describe("--service requires the repository to declare itself", () => {
  it("refuses from a repo that declares no service at all", async () => {
    const p = await project();
    const local = (await allClaims(p)).filter((c) => c.subject === PAYMENT);
    const file = await answersFile(p.workDir, local);
    const res = await runLoam(p.workDir, "verify", FEAT, "--service", PAYMENT, "--record", file, "--json");
    expect(res.code).toBe(1);
    const err = JSON.parse(res.stdout).error;
    expect(err.code).toBe("repository-unavailable");
    expect(err.message).toContain("loam.json");
    expect(p.exists(RECORD)).toBe(false);
  });

  it("attests from the service's own repo, bound to THAT repo's HEAD", async () => {
    const p = await project();
    const paymentRepo = await serviceRepo(p, PAYMENT, "payment-work");
    const attested = await attest(p, paymentRepo, PAYMENT);
    expect(attested.result.code, attested.result.out).toBe(0);
    expect(attested.json.attestations).toEqual([
      expect.objectContaining({ service: PAYMENT, commit: head(paymentRepo) }),
    ]);
  });

  it("refuses from a repo that declares a different service", async () => {
    const p = await project();
    const web = await serviceRepo(p, "checkout-web", "web-work");
    const local = (await allClaims(p)).filter((c) => c.subject === PAYMENT);
    const file = await answersFile(web, local);
    const res = await runLoam(web, "verify", FEAT, "--service", PAYMENT, "--record", file, "--json");
    expect(res.code).toBe(1);
    expect(JSON.parse(res.stdout).error.code).toBe("service-mismatch");
    expect(p.exists(RECORD)).toBe(false);
  });

  it("omitting --service in a bound repo federates rather than answering for the fleet", async () => {
    const p = await project();
    const splitRepo = await serviceRepo(p, SPLIT, "split-work");
    const local = (await allClaims(p)).filter((c) => c.subject === SPLIT);
    const file = await answersFile(splitRepo, local);
    const res = await runLoam(splitRepo, "verify", FEAT, "--record", file, "--json");
    expect(res.code, res.out).toBe(0);
    const doc = parse(await p.read(RECORD)) as Record<string, any>;
    expect(doc.schema).toBe(2);
    expect(doc.attestations.map((a: Record<string, unknown>) => a.service)).toEqual([SPLIT]);
    expect(doc.summary.unanswered).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* 3b. "This repo" is the repo, not the directory it was typed in      */
/* ------------------------------------------------------------------ */

/**
 * `loam.json` is discovered by walking UP, so a command may legitimately be run
 * from anywhere inside the repository — and every attestation is a statement
 * about the repository, never about the caller's directory. Off `process.cwd()`
 * an agent standing one directory deeper had to spell its evidence relative to
 * that directory to be believed, which is a different claim about a different
 * tree, and one no reviewer holding the repo could re-check. `gherkin` and
 * `vouch` were fixed for the same reason; this is the third site.
 */
describe("recording from a subdirectory of the service repo", () => {
  it("resolves evidence, the --results report and the commit against the repo root", async () => {
    const p = await project();
    const repo = await serviceRepo(p, SPLIT, "split-work");
    const deep = join(repo, "src", "impl");
    await mkdir(deep, { recursive: true });

    const local = (await allClaims(p)).filter((c) => c.subject === SPLIT);
    const scenario = local.filter((c) => c.kind === "scenario.tested");
    expect(scenario).toHaveLength(1);

    // The report and the evidence live at the repo root, spelled the way the
    // repository spells them. Neither exists under the cwd — so a run that
    // resolves either against the cwd cannot succeed by accident.
    await writeFile(join(repo, "report.json"), JSON.stringify(greenReport(), null, 2), "utf8");
    expect(existsSync(join(deep, "report.json"))).toBe(false);
    expect(existsSync(join(deep, "proof.ts"))).toBe(false);

    // The answer set is the caller's own file and stays cwd-relative: nothing
    // on the record points at it, and it is not part of the tree being attested.
    const file = await answersFile(deep, local.filter((c) => c.kind !== "scenario.tested"));

    const res = await runLoam(
      deep, "verify", FEAT, "--service", SPLIT, "--record", file, "--results", "report.json", "--json",
    );
    expect(res.code, res.out).toBe(0);
    const json = JSON.parse(res.stdout);
    expect(json.attestations).toEqual([
      expect.objectContaining({
        service: SPLIT,
        commit: head(repo),
        report: expect.objectContaining({ path: "report.json" }),
      }),
    ]);
    // The report the ROOT holds answered the scenario, so nothing here rests on
    // an agent's word. (The record is still `unverified`: one claim on this
    // checklist belongs to payment-service and no repo has answered it yet.)
    expect(json.attested).toBe(0);

    const doc = parse(await p.read(RECORD)) as Record<string, any>;
    expect(
      doc.claims.find((c: Record<string, unknown>) => c.kind === "scenario.tested").answered_by,
    ).toBe("runner");
    const agentAnswered = doc.claims.filter((c: Record<string, unknown>) => c.answered_by === "agent");
    expect(agentAnswered.length).toBeGreaterThan(0);
    expect(agentAnswered.map((c: Record<string, unknown>) => c.evidence)).toEqual(
      agentAnswered.map(() => ["proof.ts:2"]),
    );
  });

  it("refuses evidence that is only real relative to the cwd", async () => {
    const p = await project();
    const repo = await serviceRepo(p, SPLIT, "split-work");
    const deep = join(repo, "src", "impl");
    await mkdir(deep, { recursive: true });
    // A file that exists, is committed, and is spelled as the CWD sees it. The
    // repository spells it `src/impl/local.ts`; `local.ts` is not a path in it.
    await writeFile(join(deep, "local.ts"), "export const local = true;\n", "utf8");
    execFileSync("git", ["add", "-A"], { cwd: repo });
    execFileSync(
      "git",
      ["-c", "user.name=Loam Test", "-c", "user.email=loam@example.test", "commit", "-qm", "local"],
      { cwd: repo },
    );

    const local = (await allClaims(p)).filter((c) => c.subject === SPLIT);
    await writeFile(
      join(deep, "answers.json"),
      JSON.stringify(local.map((c) => ({ id: c.id, verdict: "confirmed", evidence: ["local.ts:1"] }))),
      "utf8",
    );
    const res = await runLoam(deep, "verify", FEAT, "--service", SPLIT, "--record", "answers.json", "--json");
    expect(res.code).toBe(1);
    expect(JSON.parse(res.stdout).error.code).toBe("answers-unevidenced");
    expect(p.exists(RECORD)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* 4. Federation is discoverable from the command                      */
/* ------------------------------------------------------------------ */

describe("the read view teaches federation", () => {
  it("--service narrows the checklist to that service's claims", async () => {
    const p = await project();
    const res = await runLoam(p.workDir, "verify", FEAT, "--service", PAYMENT, "--json");
    expect(res.code, res.out).toBe(0);
    const json = JSON.parse(res.stdout);
    expect(json.service).toBe(PAYMENT);
    expect(json.claims.map((c: Claim) => c.subject)).toEqual([PAYMENT]);
    expect(json.summary.claims).toBe(1);
    // the full checklist is still reported, so a consumer cannot mistake one
    // service's verdict for the feature's
    expect(json.checklistClaims).toBe(4);
    expect(json.services).toEqual([PAYMENT, SPLIT]);
  });

  it("every claim line names the service that has to answer it", async () => {
    const p = await project();
    const res = await runLoam(p.workDir, "verify", FEAT);
    expect(res.code, res.out).toBe(0);
    expect(res.out).toContain(`[${SPLIT}]`);
    expect(res.out).toContain(`[${PAYMENT}]`);
  });

  it("the footer prints the form that works from THIS repo", async () => {
    const p = await project();
    const splitRepo = await serviceRepo(p, SPLIT, "split-work");

    const bound = await runLoam(splitRepo, "verify", FEAT);
    expect(bound.out).toContain(`loam verify ${FEAT} --record answers.json --service ${SPLIT}`);
    expect(bound.out).toContain(`attests only ${SPLIT}'s claims`);
    expect(bound.out).toContain(PAYMENT);

    // from the docs repo there is no repository to attest for, so the footer
    // teaches the shape instead of a service it cannot know
    const unbound = await runLoam(p.workDir, "verify", FEAT);
    expect(unbound.out).toContain("--service <svc>");
    expect(unbound.out).toContain("from its own repository");
  });

  it("answering only your own claims says whose the rest are, not 're-run and answer them'", async () => {
    const p = await project();
    const mine = (await allClaims(p)).filter((c) => c.subject === SPLIT);
    const file = await answersFile(p.workDir, mine, "mine.json");
    const res = await runLoam(p.workDir, "verify", FEAT, "--record", file, "--json");
    expect(res.code).toBe(1);
    const err = JSON.parse(res.stdout).error;
    expect(err.code).toBe("answers-mismatch");
    expect(err.message).toContain(PAYMENT);
    expect(err.message).toContain("--service");
    expect(err.message).not.toContain("answer the claims it lists");
  });

  it("keeps the plain advice when the forgotten claim really is the caller's", async () => {
    // The cross-service message must not fire on an ordinary incomplete answer
    // set: if a claim of a service you already answered for is missing, it IS
    // yours to answer, and being told to go to another repository is a dead end.
    const p = await project();
    const mine = (await allClaims(p)).filter((c) => c.subject === SPLIT);
    const file = await answersFile(p.workDir, mine.slice(1), "partial.json");
    const res = await runLoam(p.workDir, "verify", FEAT, "--record", file, "--json");
    expect(res.code).toBe(1);
    const err = JSON.parse(res.stdout).error;
    expect(err.code).toBe("answers-mismatch");
    expect(err.message).toContain("answer the claims it lists");
  });
});

/* ------------------------------------------------------------------ */
/* 5. Unreadable is not absent                                         */
/* ------------------------------------------------------------------ */

describe("an unreadable verification.yaml", () => {
  const BROKEN = 'feature: FEAT-1\nrecorded: "2026-08-04\nchecklist: [oops\n';

  it("reads as unreadable — with the YAML line — never as 'no verification.yaml'", async () => {
    const p = await project();
    await p.write(RECORD, BROKEN);
    const res = await runLoam(p.workDir, "verify", FEAT, "--json");
    expect(res.code).toBe(1);
    const err = JSON.parse(res.stdout).error;
    expect(err.code).toBe("record-unreadable");
    expect(err.message).toContain(RECORD);
    expect(err.message).toMatch(/line \d+/);

    const prose = await runLoam(p.workDir, "verify", FEAT);
    expect(prose.code).toBe(1);
    expect(prose.out).not.toContain("no features/FEAT-1-split/verification.yaml");
  });

  it("--record over it refuses instead of overwriting what it could not read", async () => {
    const p = await project();
    const all = await allClaims(p);
    const file = await answersFile(p.workDir, all, "all.json");
    await p.write(RECORD, BROKEN);
    const res = await runLoam(p.workDir, "verify", FEAT, "--record", file, "--json");
    expect(res.code).toBe(1);
    expect(JSON.parse(res.stdout).error.code).toBe("record-unreadable");
    expect(await p.read(RECORD)).toBe(BROKEN);
  });

  it("a federated --record refuses over it too — the attestations it holds are unaccounted for", async () => {
    const p = await project();
    const splitRepo = await serviceRepo(p, SPLIT, "split-work");
    const local = (await allClaims(p)).filter((c) => c.subject === SPLIT);
    const file = await answersFile(splitRepo, local);
    await p.write(RECORD, BROKEN);
    const res = await runLoam(splitRepo, "verify", FEAT, "--service", SPLIT, "--record", file, "--json");
    expect(res.code).toBe(1);
    expect(JSON.parse(res.stdout).error.code).toBe("record-unreadable");
    expect(await p.read(RECORD)).toBe(BROKEN);
  });
});

/* ------------------------------------------------------------------ */
/* 2. gherkin never overwrites another feature's in-flight file        */
/* ------------------------------------------------------------------ */

const FILE = "features/loam/authorize-a-payment.feature";

/**
 * A MODIFIED delta of the living "Authorize a payment" requirement. It carries
 * a Based-On pin because delta.baseline-missing now gates archive, and one of
 * these features is archived mid-scenario below — an unpinned MODIFIED
 * requirement would stop that archive before the gherkin behaviour under test
 * is ever reached.
 */
function modified(scenario: string, then: string): string {
  return `# payment-service — delta

## MODIFIED Requirements

### Requirement: Authorize a payment
Based-On: ${pinFor(LIVING_SPEC, "Authorize a payment")}
The service SHALL authorize a payment before capture.

Operations: authorizePayment

#### Scenario: Successful authorization
- **Given** a valid card
- **When** authorization is requested
- **Then** the payment is authorized

#### Scenario: ${scenario}
- **Given** a card
- **When** authorization is requested
- **Then** ${then}
`;
}

function twoFeatures(): Record<string, string> {
  return {
    "architecture/landscape.likec4": LANDSCAPE,
    "services/payment-service/spec.md": LIVING_SPEC,
    "services/payment-service/openapi.yaml": LIVING_OPENAPI,
    // Each feature states its Why: intent.empty now gates archive, and the
    // scenario below archives FEAT-2 to release its .feature file to FEAT-3.
    "features/FEAT-2-decline/intent.md": `---\nfeature: FEAT-2\nstatus: proposed\n---\n\n# Decline authorization\n\nLet an authorization be declined instead of silently failing.\n`,
    "features/FEAT-2-decline/specs/payment-service/spec.md": modified(
      "Declined authorization",
      "the payment is declined",
    ),
    "features/FEAT-3-retry/intent.md": `---\nfeature: FEAT-3\nstatus: proposed\n---\n\n# Retry authorization\n\nLet a failed authorization be retried safely.\n`,
    "features/FEAT-3-retry/specs/payment-service/spec.md": modified(
      "Retried authorization",
      "the authorization is retried",
    ),
  };
}

describe("gherkin feature mode and a file another feature owns", () => {
  async function bound(): Promise<Project> {
    const p = await makeProject(twoFeatures(), { service: PAYMENT });
    cleanups.push(() => p.destroy());
    return p;
  }

  it("refuses rather than reverting the owning feature's wording and digests", async () => {
    const p = await bound();
    expect((await runLoam(p.workDir, "gherkin", "FEAT-2")).code).toBe(0);
    const owned = await readFile(join(p.workDir, FILE), "utf8");
    expect(owned).toContain("@FEAT-2");

    const res = await runLoam(p.workDir, "gherkin", "FEAT-3", "--json");
    expect(res.code).toBe(1);
    const payload = JSON.parse(res.stdout);
    expect(payload.error.code).toBe("gherkin-conflict");
    expect(payload.error.message).toContain("FEAT-2");
    expect(payload.conflicts).toEqual([
      expect.objectContaining({ path: FILE, action: "conflict", inFlight: ["FEAT-2"] }),
    ]);

    // the owning feature's file is untouched: same bytes, same tags, same digests
    expect(await readFile(join(p.workDir, FILE), "utf8")).toBe(owned);
    const stamped = parseStampedFeature(owned)!;
    expect(stamped.tags).toContain("FEAT-2");
    expect(stamped.scenarios.map((s) => s.digest)).toHaveLength(2);

    // prose mode refuses the same way, and writes nothing either
    const prose = await runLoam(p.workDir, "gherkin", "FEAT-3");
    expect(prose.code).toBe(1);
    expect(prose.out).toContain("FEAT-2");
    expect(await readFile(join(p.workDir, FILE), "utf8")).toBe(owned);
  });

  it("a dry run refuses too — the plan is not one loam can carry out", async () => {
    const p = await bound();
    expect((await runLoam(p.workDir, "gherkin", "FEAT-2")).code).toBe(0);
    const res = await runLoam(p.workDir, "gherkin", "FEAT-3", "--dry-run", "--json");
    expect(res.code).toBe(1);
    expect(JSON.parse(res.stdout).error.code).toBe("gherkin-conflict");
  });

  it("regenerating the OWNING feature is never a conflict with itself", async () => {
    const p = await bound();
    expect((await runLoam(p.workDir, "gherkin", "FEAT-2")).code).toBe(0);
    const again = await runLoam(p.workDir, "gherkin", "FEAT-2", "--json");
    expect(again.code, again.out).toBe(0);
    expect(JSON.parse(again.stdout).files[0].action).toBe("replaced");
  });

  it("once the owning feature archives, the other feature emits normally", async () => {
    const p = await bound();
    expect((await runLoam(p.workDir, "gherkin", "FEAT-2")).code).toBe(0);
    const archived = await runLoam(p.workDir, "archive", "FEAT-2");
    expect(archived.code, archived.out).toBe(0);

    const res = await runLoam(p.workDir, "gherkin", "FEAT-3", "--json");
    expect(res.code, res.out).toBe(0);
    expect(JSON.parse(res.stdout).files[0].action).toBe("replaced");
    const now = await readFile(join(p.workDir, FILE), "utf8");
    expect(now).toContain("@FEAT-3");
    expect(now).not.toContain("@FEAT-2");
  });

  it("an unstamped hand-written file is still replaceable — it is nobody's emission", async () => {
    const p = await bound();
    await mkdir(join(p.workDir, "features", "loam"), { recursive: true });
    await writeFile(join(p.workDir, FILE), "Feature: hand written\n", "utf8");
    const res = await runLoam(p.workDir, "gherkin", "FEAT-3", "--json");
    expect(res.code, res.out).toBe(0);
    expect(JSON.parse(res.stdout).files[0].action).toBe("replaced");
    expect(existsSync(join(p.workDir, FILE))).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* 6. Slugs of a fleet that does not write in ASCII                    */
/* ------------------------------------------------------------------ */

describe("requirement slugs outside ASCII", () => {
  it("keeps letters of any script instead of collapsing to 'requirement'", () => {
    expect(slugOf("支付授权")).toBe("支付授权");
    expect(slugOf("決済の認可")).toBe("決済の認可");
    expect(slugOf("Авторизация платежа")).toBe("авторизация-платежа");
    // two different non-Latin names must stay two different files
    expect(slugOf("支付授权")).not.toBe(slugOf("支付退款"));
    // only genuinely nameless input falls back
    expect(slugOf("!!! ??? —")).toBe("requirement");
  });

  it("folds accents so a name cannot collide with itself on a normalising filesystem", () => {
    expect(slugOf("émojis")).toBe("emojis");
    expect(slugOf("Facturación diferida")).toBe("facturacion-diferida");
    // the arch-- axis prefix stays unspellable by a business slug
    expect(slugOf("arch -- retries")).toBe("arch-retries");
  });

  it("emits distinguishable file names for a non-Latin living suite", async () => {
    const spec = `---
service: payment-service
status: draft
---

# payment-service

## Requirements

### Requirement: 支付授权
The service SHALL authorize a payment.

#### Scenario: 正常授权
- **Given** a valid card
- **When** authorization is requested
- **Then** the payment is authorized

### Requirement: 支付退款
The service SHALL refund a payment.

#### Scenario: 正常退款
- **Given** a captured payment
- **When** a refund is requested
- **Then** the payment is refunded
`;
    const p = await makeProject(
      { "architecture/landscape.likec4": LANDSCAPE, "services/payment-service/spec.md": spec },
      { service: PAYMENT },
    );
    cleanups.push(() => p.destroy());
    const res = await runLoam(p.workDir, "gherkin", "--json");
    expect(res.code, res.out).toBe(0);
    const names = (JSON.parse(res.stdout).files as Array<{ path: string }>).map((f) => f.path);
    expect(new Set(names).size).toBe(2);
    expect(names).not.toContain("features/loam/requirement.feature");
    expect(names).toContain("features/loam/支付授权.feature");
    expect(names).toContain("features/loam/支付退款.feature");
  });
});
