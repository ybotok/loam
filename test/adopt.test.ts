/**
 * Tests for `loam adopt` (src/commands/adopt.ts, src/core/brief.ts) — the
 * bootstrap half of the two flows.
 *
 * `adopt` used to promise an extractor: read the code, emit the C4. That is not
 * a thing loam does. Nothing deterministic can read a legacy service and say
 * what its architecture MEANS, and an extractor that guesses produces a model
 * nobody can trust and everybody has to re-check. So adopt produces a BRIEF: the
 * work an agent has to do, stated precisely enough that the result is checkable.
 *
 * What that makes worth pinning is the difference between a brief and a hint:
 *
 *  - it names every target path AND whether the file is already there, because
 *    the one unrecoverable outcome is an agent overwriting a document a human
 *    wrote;
 *  - it states the GRAMMAR of each artifact, since every check downstream is a
 *    check of that grammar — and the model example it hands out has to parse,
 *    or the brief is teaching the agent to fail `loam validate`;
 *  - it reports what the landscape already says about this service, so the
 *    baseline binds to the fleet instead of describing a parallel one;
 *  - it is emphatic about `sources`, the only mechanical tie to the code;
 *  - it names the checks that follow, by code, and then names what loam CANNOT
 *    check — because everything in that second list is honesty the validator
 *    will never supply.
 *
 * And it writes nothing. A brief that touched the docs repo would be doing the
 * work it exists to hand over.
 */
import { describe, expect, it, afterEach } from "vitest";
import { join } from "node:path";
import { readFile, rm, writeFile } from "node:fs/promises";
import {
  coherentFixture,
  makeProject,
  makeTmpDir,
  runLoam,
  treeHashes,
  type Project,
} from "./helpers/harness.js";
import { loadFile } from "../src/core/likec4.js";

const SVC = "payment-service";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function project(files: Record<string, string>, opts: { service?: string } = {}): Promise<Project> {
  const p = await makeProject(files, opts);
  cleanups.push(() => p.destroy());
  return p;
}

/** The brief as the machine contract — what every test below reads. */
async function brief(p: Project, ...args: string[]): Promise<Record<string, any>> {
  const res = await runLoam(p.workDir, "adopt", ...args, "--json");
  expect(res.code, res.out).toBe(0);
  return JSON.parse(res.stdout);
}

/** Everything the brief says about one artifact. */
function target(b: Record<string, any>, artifact: string): Record<string, any> {
  const t = b.targets.find((x: { artifact: string }) => x.artifact === artifact);
  expect(t, `no target for ${artifact}`).toBeDefined();
  return t;
}

describe("the work it hands over", () => {
  it("names every artifact a baseline is made of, the fleet map last", async () => {
    const p = await project({}, { service: SVC });
    const b = await brief(p);
    expect(b.targets.map((t: { artifact: string }) => t.artifact)).toEqual([
      "model.likec4",
      "spec.md",
      "arch.spec.md",
      "openapi.yaml",
      "adrs/",
      "runbook.md",
      "health.yaml",
      // The eighth: not this service's file, but the one write without which the
      // other seven are invisible to every cross-service check.
      "landscape.likec4",
    ]);
  });

  it("puts every target under the service's own directory — except the fleet map, which is shared", async () => {
    // Repo-relative because the contract is diffed across machines; the absolute
    // anchor is `docsDir`, reported once.
    const p = await project({}, { service: SVC });
    const b = await brief(p);
    expect(b.path).toBe(`services/${SVC}`);
    for (const t of b.targets) {
      if (t.artifact === "landscape.likec4") {
        expect(t.path).toBe("architecture/landscape.likec4");
        continue;
      }
      expect(t.path.startsWith(`services/${SVC}/`)).toBe(true);
    }
    expect(b.docsDir).toBe(p.docsDir);
  });

  it("reports an artifact that is already there as present, and asks for a diff instead of a rewrite", async () => {
    // The failure this prevents is unrecoverable: an agent replacing a document a
    // human wrote, with no diff for anyone to review.
    const p = await project(coherentFixture(), { service: SVC });
    const b = await brief(p);
    expect(target(b, "spec.md").exists).toBe(true);
    expect(target(b, "spec.md").action).toBe("diff");
    expect(target(b, "runbook.md").exists).toBe(false);
    expect(target(b, "runbook.md").action).toBe("create");
    expect(JSON.stringify(b).toLowerCase()).toContain("do not overwrite");
  });

  it("writes nothing at all — a brief is a request for work, not the work", async () => {
    const p = await project(coherentFixture(), { service: SVC });
    const before = await treeHashes(p.docsDir);
    await runLoam(p.workDir, "adopt");
    expect(await treeHashes(p.docsDir)).toEqual(before);
  });
});

describe("the shape of each artifact", () => {
  it("spells the requirement grammar every later check is a check of", async () => {
    const p = await project({}, { service: SVC });
    const shape = target(await brief(p), "spec.md").shape.join("\n");
    expect(shape).toContain("### Requirement:");
    expect(shape).toContain("#### Scenario:");
    expect(shape).toContain("Operations:");
  });

  it("spells both C4 spines: the operation on an edge and the service on an element", async () => {
    const p = await project({}, { service: SVC });
    const shape = target(await brief(p), "model.likec4").shape.join("\n");
    expect(shape).toContain("metadata { op");
    expect(shape).toContain("metadata { service");
  });

  it("hands out a model example that actually parses — the brief must not teach a file loam rejects", async () => {
    const p = await project({}, { service: SVC });
    const example = target(await brief(p), "model.likec4").example as string;
    const dir = await makeTmpDir("loam-brief-");
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const path = join(dir, "model.likec4");
    await writeFile(path, example, "utf8");
    const loaded = await loadFile(path);
    expect(loaded.errors.map((e) => e.message)).toEqual([]);
    // and it is a model of THIS service, bound to this directory
    expect(loaded.elements.some((e) => e.service === SVC)).toBe(true);
  });

  it("says operationId is one token spelled three ways, not three names", async () => {
    const p = await project({}, { service: SVC });
    const shape = target(await brief(p), "openapi.yaml").shape.join("\n");
    expect(shape).toContain("operationId");
    expect(shape).toMatch(/identical|same/i);
  });
});

describe("what already exists around the service", () => {
  it("shows the landscape elements that stand for it, so the baseline binds to reality", async () => {
    const p = await project(coherentFixture(), { service: SVC });
    const b = await brief(p);
    expect(b.landscape.present).toBe(true);
    expect(b.landscape.elements.map((e: { id: string }) => e.id)).toContain("paymentService");
  });

  it("names the operations other services already call on it — the OpenAPI has to define them", async () => {
    // An adopted contract that omits an operation the fleet already calls breaks
    // `spine.op-undefined` the moment it lands. The brief says so up front.
    const p = await project(coherentFixture(), { service: SVC });
    const b = await brief(p);
    expect(b.landscape.inbound).toContainEqual(
      expect.objectContaining({ from: "checkout-web", op: "authorizePayment" }),
    );
    expect(b.landscape.expects).toEqual(["authorizePayment"]);
  });

  it("reports the calls out of the service too — they are edges the model owes", async () => {
    const p = await project(coherentFixture(), { service: "checkout-web" });
    const b = await brief(p);
    expect(b.landscape.outbound).toContainEqual(
      expect.objectContaining({ to: SVC, op: "authorizePayment" }),
    );
  });

  it("says plainly when nothing in the landscape models this service yet", async () => {
    // Adopting a service the fleet map has never heard of is the common case, and
    // it is an ERROR at `loam validate --all` until an element exists.
    const p = await project(coherentFixture(), { service: "billing-service" });
    const b = await brief(p);
    expect(b.landscape.elements).toEqual([]);
    expect(b.landscape.modelled).toBe(false);
    expect(JSON.stringify(b)).toContain("landscape.service-unmodelled");
  });

  it("degrades honestly when the landscape does not parse, instead of reporting an empty fleet", async () => {
    const files = coherentFixture();
    files["architecture/landscape.likec4"] = "model {\n  broken !!! not likec4\n";
    const p = await project(files, { service: SVC });
    const b = await brief(p);
    expect(b.landscape.present).toBe(true);
    expect(b.landscape.parses).toBe(false);
    expect(b.landscape.elements).toEqual([]);
    // "nothing models it" would be a lie about a document nobody could read
    expect(b.landscape.modelled).toBe(null);
  });
});

describe("the frontmatter it must write", () => {
  it("requires status draft, and says promotion is a human's command", async () => {
    const p = await project({}, { service: SVC });
    const b = await brief(p);
    expect(b.frontmatter.fields.status).toContain("draft");
    const text = JSON.stringify(b.frontmatter);
    expect(text).toContain("loam vouch");
    expect(text).toMatch(/last_verified|sources_digest/);
  });

  it("is emphatic about `sources`, and says why it is the field that matters", async () => {
    // Everything else loam checks is internal consistency, which a fluent fiction
    // satisfies perfectly. If the agent takes one instruction seriously it has to
    // be this one, so the brief has to argue for it, not just list it.
    const p = await project({}, { service: SVC });
    const b = await brief(p);
    const text = JSON.stringify(b.frontmatter);
    expect(text).toContain("sources");
    expect(text).toMatch(/only .*tie|internal consistency/i);
    expect(b.frontmatter.fields.sources).toMatch(/read/i);
  });
});

describe("what happens next, and what will never happen", () => {
  it("names the checks `loam validate --service` will run, by code", async () => {
    const p = await project({}, { service: SVC });
    const codes = (await brief(p)).checks.map((c: { code: string }) => c.code);
    for (const code of [
      "c4.invalid",
      "requirements.missing-scenarios",
      "spine.op-undefined",
      "sources.path-missing",
      "landscape.service-unmodelled",
    ]) {
      expect(codes).toContain(code);
    }
  });

  it("grades those checks, so the agent knows which ones stop it", async () => {
    const p = await project({}, { service: SVC });
    const checks = (await brief(p)).checks;
    expect(checks.some((c: { severity: string }) => c.severity === "error")).toBe(true);
    expect(checks.some((c: { severity: string }) => c.severity === "warn")).toBe(true);
  });

  it("attributes every check to the invocation that surfaces it — --service does not run the fleet cross-check", async () => {
    // landscape.service-unmodelled only fires under --all; a brief crediting it
    // to `--service <id>` sent agents chasing a finding that run never reports.
    const p = await project({}, { service: SVC });
    const checks = (await brief(p)).checks;
    for (const c of checks) {
      expect(["loam validate --service <id>", "loam validate --all"], c.code).toContain(c.via);
    }
    const byCode = (code: string): Record<string, any> =>
      checks.find((c: { code: string }) => c.code === code);
    expect(byCode("landscape.service-unmodelled").via).toBe("loam validate --all");
    expect(byCode("c4.invalid").via).toBe("loam validate --service <id>");
  });

  it("splits the prose the same way — the --all-only check is not promised to --service", async () => {
    const p = await project({}, { service: SVC });
    const res = await runLoam(p.workDir, "adopt");
    expect(res.code).toBe(0);
    expect(res.out).toContain("what `loam validate --service " + SVC + "` then checks");
    const allHeader = res.out.indexOf("and what only `loam validate --all` surfaces");
    expect(allHeader).toBeGreaterThan(-1);
    // the fleet check sits under the --all header, after every --service check
    expect(res.out.indexOf("landscape.service-unmodelled", allHeader)).toBeGreaterThan(allHeader);
    // The CHECK LIST above the header holds no --all-only code. (The fixture's
    // landscape does model this service, so the fleet-map target — which quotes
    // the same code in its shape rules — is not briefed at all here.)
    const serviceSection = res.out.slice(
      res.out.indexOf("what `loam validate --service " + SVC + "` then checks"),
      allHeader,
    );
    expect(serviceSection).not.toContain("landscape.service-unmodelled");
  });

  it("meters partial adoption honestly: a missing spec or openapi is a warn in the brief, as in validate", async () => {
    // The brief marks spec.md/openapi.yaml required (for a COMPLETE baseline);
    // validate grades their absence a warn. Both statements have to be made, or
    // the brief and the checker disagree about what "required" means.
    const p = await project({}, { service: SVC });
    const checks = (await brief(p)).checks;
    for (const code of ["service.no-spec", "service.no-openapi", "api.ops-unlinked"]) {
      const c = checks.find((x: { code: string }) => x.code === code);
      expect(c, `no check for ${code}`).toBeDefined();
      expect(c.severity, code).toBe("warn");
    }
  });

  it("lists what loam cannot check — the part where honesty is on the agent", async () => {
    const p = await project({}, { service: SVC });
    const unchecked = (await brief(p)).unchecked.join("\n").toLowerCase();
    expect(unchecked.length).toBeGreaterThan(0);
    // the three that matter most: truth, completeness, and the contract's body
    expect(unchecked).toMatch(/true|truth|actually/);
    expect(unchecked).toMatch(/complete/);
    expect(unchecked).toMatch(/schema|operationid/);
  });

  it("ends by handing the result to a person", async () => {
    const p = await project({}, { service: SVC });
    const res = await runLoam(p.workDir, "adopt");
    expect(res.code).toBe(0);
    expect(res.out).toContain(`loam validate --service ${SVC}`);
    expect(res.out).toContain(`loam vouch --service ${SVC}`);
  });
});

describe("the slash command that drives it", () => {
  it("is laid down by init and runs the real flow: brief, write, validate, hand to a human", async () => {
    const dir = await makeTmpDir("loam-adopt-cmd-");
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    // `--create`: `--docs` joins an existing docs repo, and ./d does not exist.
    await runLoam(dir, "init", "--docs", "./d", "--create");
    const body = await readFile(join(dir, ".claude", "commands", "loam-adopt.md"), "utf8");
    expect(body).toContain("loam adopt --service");
    expect(body).toContain("loam validate --service");
    expect(body).toContain("loam vouch --service");
    // the two instructions that make the difference between a baseline and a fiction
    expect(body).toContain("sources");
    expect(body).toContain("status: draft");
    // and the fleet-level run that catches a landscape edit which never landed
    expect(body).toContain("loam validate --all --json");
  });
});

describe("the machine contract", () => {
  it("--service overrides the configured service", async () => {
    const p = await project({}, { service: SVC });
    const b = await brief(p, "--service", "billing-service");
    expect(b.service).toBe("billing-service");
    expect(b.path).toBe("services/billing-service");
  });

  it("refuses when no service is configured or passed — a brief for '<service>' is nobody's work", async () => {
    const p = await project({});
    const res = await runLoam(p.workDir, "adopt", "--json");
    expect(res.code).toBe(1);
    const json = JSON.parse(res.stdout);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("invalid-option");
  });

  it("reports a missing loam.json under the same code as every other command", async () => {
    const dir = await makeTmpDir("loam-adopt-");
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const res = await runLoam(dir, "adopt", "--service", SVC, "--json");
    expect(res.code).toBe(1);
    expect(JSON.parse(res.stdout).error.code).toBe("no-config");
  });

  it("prints the same brief in prose when there is no --json", async () => {
    const p = await project(coherentFixture(), { service: SVC });
    const res = await runLoam(p.workDir, "adopt");
    expect(res.code).toBe(0);
    expect(res.out).toContain(SVC);
    expect(res.out).toContain("model.likec4");
    expect(res.out).toContain("### Requirement:");
    expect(res.out).toContain("sources");
    expect(res.out).toContain("authorizePayment");
  });
});
