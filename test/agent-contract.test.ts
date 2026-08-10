/**
 * The agent contract as a CONTRACT — the parts of AGENTS.md, the slash commands
 * and the adopt brief that an agent executes literally, checked against what the
 * binary actually does.
 *
 * test/agents.test.ts already pins that the files exist and name the cycle. This
 * file pins the harder property: that following them cannot destroy anything.
 * Three failures motivated every test below, and all three were failures of the
 * DOCUMENTS, not of the code:
 *
 *  - the adopt brief listed eight files to write and never once mentioned the
 *    fleet map, so a service could be fully documented, pass `validate
 *    --service`, and stay invisible to every cross-service check;
 *  - the verify recipe taught `loam verify <FEAT> --record answers.json`, the
 *    all-at-once form, to agents working one service repo at a time — where it
 *    overwrites nine other repositories' attestations;
 *  - the brief's `shape[]` stated rules nothing checks beside rules everything
 *    checks, which is how an agent learns that a green `validate` means more
 *    than it does.
 *
 * The mapping tables here are deliberately literal. A reworded rule must fail
 * this file and be re-mapped by hand — that is the review step, not an
 * inconvenience.
 */
import { describe, expect, it, afterEach } from "vitest";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { coherentFixture, makeProject, makeTmpDir, runLoam, type Project } from "./helpers/harness.js";
import { AGENTS_MD, PROTOCOLS } from "../src/core/agent.js";
import { UNCHECKED, VALIDATE_CHECKS } from "../src/core/brief.js";
import { loadFile } from "../src/core/likec4.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
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

async function brief(p: Project, ...args: string[]): Promise<Record<string, any>> {
  const res = await runLoam(p.workDir, "adopt", ...args, "--json");
  expect(res.code, res.out).toBe(0);
  return JSON.parse(res.stdout);
}

const readRepo = (name: string): Promise<string> => readFile(join(ROOT, name), "utf8");

/* ------------------------------------------------------------------ */
/* 1. The brief asks for the fleet map                                 */
/* ------------------------------------------------------------------ */

describe("the adopt brief asks for the write the fleet map is owed", () => {
  it("briefs architecture/landscape.likec4 as an eighth target when nothing models the service", async () => {
    const p = await project({}, { service: SVC });
    const b = await brief(p);
    const target = b.targets.find((t: { path: string }) => t.path === "architecture/landscape.likec4");
    expect(target, "no landscape target in the brief").toBeDefined();
    // The docs repo here has no landscape at all, so the action is `create`.
    expect(target.action).toBe("create");
    expect(target.required).toBe(true);
    // The block it hands over is concrete: the binding and the op-carrying edge,
    // which are the two things a described-but-not-shown rule gets improvised on.
    expect(target.example).toContain(`metadata { service '${SVC}' }`);
    expect(target.example).toContain("metadata { op ");
    expect(target.shape.join("\n")).toContain("landscape.service-unmodelled");
  });

  it("hands out a landscape example that parses when it is a whole new file", async () => {
    // Same rule as the model.likec4 example: a brief must never teach a document
    // `loam validate` rejects. With no landscape on disk the example IS the file,
    // so it carries the `specification` block a bare `model {}` is refused without.
    const p = await project({}, { service: SVC });
    const b = await brief(p);
    const example: string = b.targets.find(
      (t: { artifact: string }) => t.artifact === "landscape.likec4",
    ).example;
    const dir = await makeTmpDir("loam-landscape-");
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const path = join(dir, "landscape.likec4");
    await writeFile(path, example, "utf8");
    const loaded = await loadFile(path);
    expect(loaded.errors.map((e) => e.message)).toEqual([]);
    expect(loaded.elements.some((e) => e.service === SVC)).toBe(true);
  });

  it("hands out a splice fragment, without a second specification block, when the file exists", async () => {
    const p = await project(coherentFixture(), { service: "billing-service" });
    const b = await brief(p);
    const example: string = b.targets.find(
      (t: { artifact: string }) => t.artifact === "landscape.likec4",
    ).example;
    expect(example).not.toContain("specification {");
    expect(example).toMatch(/stay exactly as they are/);
  });

  it("says `edit`, not `diff`, on the shared map — and says never to rewrite it", async () => {
    // `diff` would be the wrong instruction: the file is the FLEET's, and what
    // this service owes it is an addition, not a disagreement to report.
    const files = coherentFixture();
    const p = await project(files, { service: "billing-service" });
    const b = await brief(p);
    const target = b.targets.find((t: { path: string }) => t.path === "architecture/landscape.likec4");
    expect(target.action).toBe("edit");
    expect(target.exists).toBe(true);
    expect(target.shape.join("\n")).toMatch(/never rewrite it/i);
  });

  it("carries the same instruction in `landscape.instruction`, for an agent reading only that key", async () => {
    const p = await project(coherentFixture(), { service: "billing-service" });
    const b = await brief(p);
    expect(typeof b.landscape.instruction).toBe("string");
    expect(b.landscape.instruction.length).toBeGreaterThan(0);
    expect(b.landscape.instruction).toContain("architecture/landscape.likec4");
    expect(b.landscape.instruction).toContain(`metadata { service 'billing-service' }`);
    expect(b.landscape.instruction).toContain("landscape.service-unmodelled");
  });

  it("says nothing at all once an element resolves to the service — no target, no instruction", async () => {
    // A service the map already draws owes it nothing, and briefing an edit
    // there is how a second box for one service gets drawn.
    const p = await project(coherentFixture(), { service: SVC });
    const b = await brief(p);
    expect(b.landscape.modelled).toBe(true);
    expect(b.landscape.instruction).toBe(null);
    expect(b.targets.map((t: { path: string }) => t.path)).not.toContain(
      "architecture/landscape.likec4",
    );
  });

  it("a landscape that does not parse gets its own instruction: fix the parse errors first", async () => {
    // "nothing models it" would be a claim about a document nobody could read,
    // and the useful instruction is a different one.
    const files = coherentFixture();
    files["architecture/landscape.likec4"] = "model {\n  broken !!! not likec4\n";
    const p = await project(files, { service: SVC });
    const b = await brief(p);
    expect(b.landscape.parses).toBe(false);
    expect(b.landscape.modelled).toBe(null);
    expect(b.landscape.instruction).toContain("landscape.invalid");
    expect(b.landscape.instruction).toMatch(/parse errors first/);
  });

  it("prints the instruction in the text view too, so the two views brief one write", async () => {
    const p = await project({}, { service: SVC });
    const res = await runLoam(p.workDir, "adopt");
    expect(res.code).toBe(0);
    expect(res.out).toContain("architecture/landscape.likec4");
    expect(res.out).toContain("landscape.service-unmodelled");
  });
});

/* ------------------------------------------------------------------ */
/* 2. The contract teaches the multi-repo forms                        */
/* ------------------------------------------------------------------ */

describe("the agent contract teaches the multi-repo forms", () => {
  it("the generated AGENTS.md documents loam.json: docsDir, service, gherkinDir, and that the path stays relative", async () => {
    const dir = await makeTmpDir("loam-contract-");
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    await runLoam(dir, "init", "--docs", "./d", "--create");
    const agents = await readFile(join(dir, "d", "AGENTS.md"), "utf8");

    expect(agents).toContain("`loam.json`");
    for (const field of ["`docsDir`", "`service`", "`gherkinDir`"]) {
      expect(agents, `AGENTS.md never mentions ${field}`).toContain(field);
    }
    // The one fact that makes the file committable: it is resolved against
    // itself, so a relative path survives every clone.
    expect(agents).toMatch(/stored exactly as it was passed/i);
    expect(agents).toMatch(/resolved against the directory holding the/i);
    expect(agents).toContain("`doctor.docs-absolute`");
  });

  it("the cycle opens with step 0: init per service repo, then doctor", async () => {
    expect(AGENTS_MD).toMatch(/0\. \*\*Wire the repo\*\*/);
    expect(AGENTS_MD).toMatch(/loam init --docs [^\n]*--service/);
    expect(AGENTS_MD).toContain("loam doctor");
    // and `--docs` joins: creating is the explicit ask
    expect(AGENTS_MD).toMatch(/joins?\*{0,2} an existing docs repo/i);
    expect(AGENTS_MD).toContain("`--create`");
  });

  it("the done-check teaches the federated recording form and warns about the other one", () => {
    expect(AGENTS_MD).toMatch(
      /loam verify FEAT-101 --service payment-service --results report\.json --record answers\.json/,
    );
    expect(AGENTS_MD).toContain("`record-federated`");
    expect(AGENTS_MD).toContain("attestation");
    // the destructiveness is stated, not implied
    expect(AGENTS_MD).toMatch(/silently erasing[\s\S]{0,30}evidence/);
  });

  it("/loam-verify records with --service, in the service's own repo", () => {
    const verify = PROTOCOLS["loam-verify"]!;
    expect(verify).toMatch(/loam verify \$1 --service <id> --results report\.json --record answers\.json/);
    expect(verify).toMatch(/in each affected service's own repository/i);
    for (const code of ["record-federated", "record-unreadable", "service-mismatch", "repository-unavailable"]) {
      expect(verify, `/loam-verify does not branch on ${code}`).toContain(`\`${code}\``);
    }
  });

  it("no slash command hands over a `verify … --record` recipe without --service", () => {
    // The one legal mention of the bare form is the prohibition itself, which
    // says "Never" — a recipe line that merely omits --service is the bug.
    const offenders: string[] = [];
    for (const [name, body] of Object.entries(PROTOCOLS)) {
      for (const line of body.split("\n")) {
        if (!/loam verify \$1[^\n]*--record/.test(line)) continue;
        if (line.includes("--service") || /never/i.test(line)) continue;
        offenders.push(`${name}: ${line.trim()}`);
      }
    }
    expect(offenders, `recipes teaching the destructive form:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });

  it("the same rule holds inside AGENTS.md's own prose", () => {
    const offenders = AGENTS_MD.split("\n").filter(
      (line) =>
        /loam verify (FEAT-101|<FEAT>)[^\n]*--record/.test(line) &&
        !line.includes("--service") &&
        !/never|legacy/i.test(line),
    );
    expect(offenders).toEqual([]);
  });

  it("/loam-adopt closes on the fleet-level run, not only the per-service one", () => {
    const adopt = PROTOCOLS["loam-adopt"]!;
    expect(adopt).toContain("loam validate --service $1 --json");
    expect(adopt).toContain("loam validate --all --json");
    // and it wires the repo before briefing anything
    expect(adopt).toContain("loam init --docs");
    expect(adopt).toContain("loam doctor");
    expect(adopt.indexOf("loam validate --all --json")).toBeGreaterThan(
      adopt.indexOf("loam validate --service $1 --json"),
    );
  });
});

/* ------------------------------------------------------------------ */
/* 3. Every code the other workstreams added is documented             */
/* ------------------------------------------------------------------ */

describe("the code vocabulary reaches AGENTS.md itself", () => {
  // codes-drift.test.ts guards the whole corpus (AGENTS.md + every slash
  // command). This narrower list is the set an agent branches on most, and it
  // has to be in AGENTS.md — the file that travels with the docs repo and is
  // the only one a non-Claude runner is pointed at.
  const IN_AGENTS_MD = [
    "docs-missing",
    "services-missing",
    "landscape.missing",
    "landscape.invalid",
    "landscape.binding-duplicate",
    "doctor.landscape-invalid",
    "doctor.landscape-merge-conflict",
    "doctor.landscape-unreadable",
    "doctor.docs-absolute",
    "service.unreadable",
    "feature.unreadable",
    "spec-api.op-undefined",
    "spec.no-requirements",
    "target.ambiguous",
    "openapi.duplicate-operationid",
    "openapi.path-item-modified",
    "openapi.remove-op-consumed",
    "openapi.remove-marker-anonymous",
    "delta.living-duplicate-requirement",
    "delta.modified-conflict",
    "sources.empty",
    "sources.skipped",
    "record-federated",
    "record-unreadable",
    "gherkin-conflict",
    "vouch-raced",
    "docs-busy",
  ];

  it("each one appears backticked, the way every other code is quoted there", () => {
    const missing = IN_AGENTS_MD.filter((c) => !AGENTS_MD.includes(`\`${c}\``));
    expect(missing, `undocumented in AGENTS.md: ${missing.join(", ")}`).toEqual([]);
  });

  it("the ordering commands are on the agent surface, next to the findings that need them", () => {
    expect(AGENTS_MD).toContain("loam dependencies");
    expect(AGENTS_MD).toContain("loam doctor");
    const check = PROTOCOLS["loam-check"]!;
    // every "another feature in flight" finding points at the command that
    // computes the order, instead of leaving it to be worked out per finding
    for (const code of ["delta.modified-pending", "delta.added-conflict", "delta.modified-conflict"]) {
      const row = check.split("\n").find((l) => l.includes(`\`${code}\``));
      expect(row, `no /loam-check row for ${code}`).toBeDefined();
      expect(row, `${code} does not point at loam dependencies`).toContain("loam dependencies");
    }
  });

  it("sources.unverifiable-from-here is described as the per-service `ok` finding it now is", () => {
    // It used to be documented as "one fleet-level summary line, not per-service
    // findings", which is the opposite of what validate emits today.
    expect(AGENTS_MD).not.toContain("one fleet-level summary line, not per-service findings");
    expect(PROTOCOLS["loam-check"]).not.toContain(
      "one fleet-level summary line, not per-service findings",
    );
    expect(AGENTS_MD).toMatch(/per-service[\s\S]{0,40}`sources\.unverifiable-from-here`/);
  });

  it("the vouch-written fields are listed completely, sources_files included", () => {
    expect(AGENTS_MD).toContain("sources_files");
    expect(PROTOCOLS["loam-adopt"]).toContain("sources_files");
  });
});

/* ------------------------------------------------------------------ */
/* 4. adopt warns about the typo and the binding                       */
/* ------------------------------------------------------------------ */

describe("adopt says when the id is suspicious, without refusing", () => {
  it("a near-miss against an existing service id is a warning and exit 0", async () => {
    const files = coherentFixture();
    files["services/billing-service/spec.md"] = "---\nservice: billing-service\nstatus: draft\n---\n";
    const p = await project(files, { service: "billing-service" });

    const res = await runLoam(p.workDir, "adopt", "--service", "biling-service", "--json");
    expect(res.code, res.out).toBe(0);
    const b = JSON.parse(res.stdout);
    expect(b.warnings.length).toBeGreaterThan(0);
    expect(b.warnings.join("\n")).toContain("billing-service");
    // adopting a genuinely new service is the normal case, so it is never a refusal
    expect(b.service).toBe("biling-service");
  });

  it("the warning is in the header of the text view, before any shape", async () => {
    const files = coherentFixture();
    files["services/billing-service/spec.md"] = "---\nservice: billing-service\nstatus: draft\n---\n";
    const p = await project(files, { service: "billing-service" });
    const res = await runLoam(p.workDir, "adopt", "--service", "biling-service");
    expect(res.code).toBe(0);
    expect(res.out.indexOf("billing-service")).toBeLessThan(res.out.indexOf("artifacts"));
  });

  it("an id nothing resembles produces no near-miss noise", async () => {
    const p = await project(coherentFixture(), { service: SVC });
    const b = await brief(p, "--service", SVC);
    expect(b.warnings).toEqual([]);
  });

  it("says so when loam.json binds this repo to a different service", async () => {
    const p = await project(coherentFixture(), { service: SVC });
    const b = await brief(p, "--service", "quite-other-service");
    expect(b.warnings.join("\n")).toContain(SVC);
    expect(b.warnings.join("\n")).toMatch(/vouch/);
  });

  it("an id that is not a legal directory name is refused, before anything reads the repo", async () => {
    const p = await project(coherentFixture(), { service: SVC });
    const res = await runLoam(p.workDir, "adopt", "--service", "../../etc", "--json");
    expect(res.code).toBe(1);
    const json = JSON.parse(res.stdout);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("invalid-option");
    expect(json.error.message).toContain("../../etc");
  });

  it("an empty --service is refused the same way", async () => {
    const p = await project(coherentFixture(), { service: SVC });
    const res = await runLoam(p.workDir, "adopt", "--service", "", "--json");
    expect(res.code).toBe(1);
    expect(JSON.parse(res.stdout).error.code).toBe("invalid-option");
  });
});

/* ------------------------------------------------------------------ */
/* 5. Every shape rule is a rule something checks                      */
/* ------------------------------------------------------------------ */

describe("the brief promises only what a check can keep", () => {
  /**
   * Rule -> the code that enforces it, keyed by a distinctive fragment of the
   * rule's text. Every model.likec4 `shape[]` entry must match exactly one row:
   * a new rule fails here until somebody names the check behind it, and a rule
   * with no check belongs in UNCHECKED instead.
   */
  const RULE_CODE: Array<[fragment: string, code: string]> = [
    ["`specification { ... }` block", "c4.invalid"],
    ["`model { ... }` block holding", "c4.invalid"],
    ["binds to this directory", "landscape.service-unmodelled"],
    ["A call to another service", "spine.op-undefined"],
  ];

  it("every model.likec4 shape rule maps to a code the brief itself lists as a check", async () => {
    const p = await project({}, { service: SVC });
    const b = await brief(p);
    const shape: string[] = b.targets.find((t: { artifact: string }) => t.artifact === "model.likec4")
      .shape;
    const known = new Set(VALIDATE_CHECKS.map((c) => c.code));

    for (const rule of shape) {
      const rows = RULE_CODE.filter(([fragment]) => rule.includes(fragment));
      expect(rows.length, `no rule->code row for: ${rule}`).toBe(1);
      const [, code] = rows[0]!;
      expect(known.has(code), `${code} is not among the brief's own checks[]`).toBe(true);
      // and the rule names its code, so the agent does not have to consult a table
      expect(rule, `${rule}\n  does not name ${code}`).toContain(code);
    }
    expect(shape.length).toBe(RULE_CODE.length);
  });

  /**
   * The walk's `lands` and the brief's `targets` are one list seen twice. Left
   * unjoined, a stop could feed an artifact nobody was asked to write — which is
   * the same class of defect as a shape rule naming a check that does not exist,
   * and it fails the same way: silently, in an agent's head, at adoption time.
   */
  it("every walk stop lands in an artifact the same brief hands over", async () => {
    const p = await project({}, { service: SVC });
    const b = await brief(p);
    const artifacts = new Set<string>(b.targets.map((t: { artifact: string }) => t.artifact));
    expect(b.walk.length).toBeGreaterThan(0);
    for (const stop of b.walk as Array<{ where: string; find: string; lands: string[] }>) {
      expect(stop.lands.length, `walk stop feeds nothing: ${stop.where}`).toBeGreaterThan(0);
      for (const artifact of stop.lands) {
        expect(artifacts.has(artifact), `walk lands in '${artifact}', which is not a target`).toBe(true);
      }
    }
  });

  it("the walk fixes the shape of the service before it enumerates any surface", async () => {
    // The order is the whole point of stating it: an agent that opens the HTTP
    // routes first has concluded the service is an API before it meets the
    // scheduler, and the consumer group never gets written down. If a reorder
    // is intended, move this assertion deliberately — do not delete it.
    const p = await project({}, { service: SVC });
    const b = await brief(p);
    const walk = b.walk as Array<{ where: string }>;
    const at = (fragment: string): number => walk.findIndex((s) => s.where.includes(fragment));
    expect(at("entry points")).toBeLessThan(at("HTTP surface"));
    expect(at("entry points")).toBeLessThan(at("message surface"));
    expect(at("build and dependency manifests")).toBeLessThan(at("entry points"));
  });

  it("the brief's walk survives the text view — an agent reading either gets the same order", async () => {
    const p = await project({}, { service: SVC });
    const b = await brief(p);
    const res = await runLoam(p.workDir, "adopt", "--json");
    expect(res.code).toBe(0);
    const text = (await runLoam(p.workDir, "adopt")).out;
    for (const [i, stop] of (b.walk as Array<{ where: string }>).entries()) {
      expect(text, `walk stop ${String(i + 1)} is missing from the text view`).toContain(
        stop.where.split(" — ")[0]!,
      );
    }
    // And the close, which is the half that asks for the account of what was skipped.
    expect(text).toContain("sources.unwalked");
  });

  it("the two rules nothing checks live in unchecked[], and nowhere else", async () => {
    const p = await project({}, { service: SVC });
    const b = await brief(p);
    const unchecked: string[] = b.unchecked;
    expect(unchecked.join("\n")).toContain("views { ... }");
    expect(unchecked.join("\n")).toMatch(/exactly ONE top-level element/);

    const shape: string = b.targets
      .find((t: { artifact: string }) => t.artifact === "model.likec4")
      .shape.join("\n");
    expect(shape).not.toContain("views {");
    expect(shape).not.toMatch(/ONE top-level element/);
  });

  it("no unchecked[] entry is restated as a shape rule anywhere in the brief", async () => {
    // The duplication this forbids is the one that makes the list useless: a
    // sentence that appears in both reads as enforced.
    const p = await project({}, { service: SVC });
    const b = await brief(p);
    const shape: string = b.targets
      .flatMap((t: { shape: string[] }) => t.shape)
      .join("\n")
      .toLowerCase();
    for (const entry of UNCHECKED) {
      // compare on the entry's opening clause — the identifying part
      const clause = entry.split(/[.,]/)[0]!.toLowerCase();
      expect(shape.includes(clause), `unchecked entry restated as a shape rule: ${clause}`).toBe(false);
    }
  });

  it("the `Operations:` promise stays in shape[], because service scope now checks it", async () => {
    const p = await project({}, { service: SVC });
    const b = await brief(p);
    const spec: string = b.targets
      .find((t: { artifact: string }) => t.artifact === "spec.md")
      .shape.join("\n");
    expect(spec).toContain("Operations:");
    expect(spec).toContain("spec-api.op-undefined");
    expect(VALIDATE_CHECKS.some((c) => c.code === "spec-api.op-undefined")).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* 6. README — day zero for eleven repositories                        */
/* ------------------------------------------------------------------ */

describe("README describes the fleet that exists", () => {
  it("spells init with its optional service binding", async () => {
    const readme = await readRepo("README.md");
    expect(readme).toContain("loam init --docs <dir> [--service <id>]");
    expect(readme).toMatch(/`--service <id>` is what a \*\*service\*\* repo needs/);
  });

  it("carries a numbered day-zero section covering all eleven repos", async () => {
    const readme = await readRepo("README.md");
    const section = readme.slice(readme.indexOf("## Day zero"), readme.indexOf("## Two flows"));
    expect(section.length).toBeGreaterThan(0);
    for (const step of [
      "loam init --docs . --create",
      "architecture/landscape.likec4",
      "loam init --docs ../docs-repo --service",
      "loam adopt --service",
      "loam validate --all --json",
      "loam vouch --service",
    ]) {
      expect(section, `day zero never says ${step}`).toContain(step);
    }
    // and it says the landscape is required, not a nicety
    expect(section).toContain("landscape.missing");
  });

  it("states the Node floor the package actually declares, in every place it states one", async () => {
    const readme = await readRepo("README.md");
    const pkg = JSON.parse(await readRepo("package.json")) as { engines: { node: string } };
    const version = pkg.engines.node.replace(/^[^\d]*/, "");
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    // three claims: the badge, setup.sh's description, the prerequisite
    expect(readme.split(version).length - 1).toBeGreaterThanOrEqual(3);
    for (const stale of ["node-%3E%3D20-", "Node ≥ 20", "node >= 20"]) {
      expect(readme, `README still claims "${stale}"`).not.toContain(stale);
    }
  });

  it("does not claim the scaffold validates warning-free, because it does not", async () => {
    const readme = await readRepo("README.md");
    expect(readme).not.toContain("Validates clean out of the box");
    expect(readme).toContain("zero errors");
  });

  it("describes what `loam delta` actually prints", async () => {
    const readme = await readRepo("README.md");
    const row = readme.split("\n").find((l) => l.startsWith("| `loam delta"))!;
    expect(row).toMatch(/verbatim/);
    expect(row).toMatch(/Given\/When\/Then/);
  });
});

/* ------------------------------------------------------------------ */
/* 7. SCHEMA — config, the federated record, the digest recipe         */
/* ------------------------------------------------------------------ */

describe("SCHEMA documents the parts the CLI now depends on", () => {
  it("has a loam.json section beside the artifact grammars", async () => {
    const schema = await readRepo("SCHEMA.md");
    expect(schema).toContain("## `loam.json`");
    const section = schema.slice(schema.indexOf("## `loam.json`"), schema.indexOf("## Conventions"));
    for (const fact of ["docsDir", "service", "gherkinDir", "docs-missing", "services-missing", "--create"]) {
      expect(section, `the loam.json section never mentions ${fact}`).toContain(fact);
    }
    expect(section).toMatch(/exactly as it was passed/);
  });

  it("describes the federated record: attestations, the merge, and the refusals", async () => {
    const schema = await readRepo("SCHEMA.md");
    expect(schema).toContain("attestations");
    expect(schema).toContain("`schema: 2`");
    expect(schema).toMatch(/one attestation per service/i);
  });

  it("every refusal code `loam verify` can emit is documented in SCHEMA", async () => {
    // Derived from the source, not from a hand list: a new refusal code in
    // verify.ts fails here until SCHEMA explains it.
    const schema = await readRepo("SCHEMA.md");
    const json = await readRepo("src/core/json.ts");
    const union = new Set(
      [...json.matchAll(/^\s*\|\s*"([a-z][a-z0-9-]*)"/gm)].map((m) => m[1]!),
    );
    // The three generic invocation failures are documented once, globally, not
    // per command — a `verify`-specific paragraph for "no such feature" would
    // be noise in a schema document.
    const GENERIC = new Set(["no-config", "config-invalid", "unknown-target", "invalid-option", "internal"]);
    const verifySrc =
      (await readRepo("src/commands/verify.ts")) + (await readRepo("src/core/verify.ts"));
    const emitted = [...new Set([...verifySrc.matchAll(/"([a-z][a-z0-9-]*)"/g)].map((m) => m[1]!))]
      .filter((c) => union.has(c) && !GENERIC.has(c))
      .sort();

    expect(emitted.length).toBeGreaterThan(4);
    const missing = emitted.filter((c) => !schema.includes(`\`${c}\``));
    expect(missing, `verify refusal codes missing from SCHEMA.md: ${missing.join(", ")}`).toEqual([]);
  });

  it("no longer claims an unreadable record counts as no record at all", async () => {
    const schema = await readRepo("SCHEMA.md");
    expect(schema).not.toMatch(/counts as \*\*no record at all\*\*/);
    expect(schema).toContain("`record-unreadable`");
    expect(schema).toMatch(/\*\*never overwritten\*\*/);
  });

  it("pins the digest recipe's two exclusions: what git ignores, and symlinks", async () => {
    const schema = await readRepo("SCHEMA.md");
    expect(schema).toContain("git check-ignore");
    expect(schema).toContain("`sources.skipped`");
    expect(schema).toContain("`sources.empty`");
    expect(schema).toContain("`sources_files`");
    // the direction of the fallback is the load-bearing part
    expect(schema).toMatch(/everything is hashed/i);
  });

  it("gives the docs repo its own bootstrap step at fleet scale", async () => {
    const schema = await readRepo("SCHEMA.md");
    const section = schema.slice(schema.indexOf("## Operating at fleet scale"));
    expect(section).toContain("loam init --docs . --create");
    expect(section).toContain(`"docsDir": "."`);
    expect(section).toContain("loam doctor");
  });

  it("says the landscape is required, and how its absence is graded", async () => {
    const schema = await readRepo("SCHEMA.md");
    expect(schema).toContain("`landscape.missing`");
    expect(schema).toMatch(/error\*\* as soon as `services\/` holds at least one service/);
  });
});
