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
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { coherentFixture, makeProject, makeTmpDir, runLoam, type Project } from "./helpers/harness.js";
import { AGENTS_MD } from "../src/core/agent/agents-md.js";
import { PROTOCOLS } from "../src/core/agent/protocol.js";
import { VALIDATE_CHECKS } from "../src/core/brief/checks.js";
import { UNCHECKED } from "../src/core/brief/unchecked.js";
import { loadFile } from "../src/core/c4/likec4.js";
import { explainSubject } from "../src/core/explain/lookup.js";
import { collectStableCodes } from "./helpers/stable-codes.js";

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

/**
 * Collapse whitespace runs, blockquote marks included, so a pinned sentence
 * matches whatever column the page is wrapped at. Every Markdown page in this
 * repository wraps at 100; a phrase assertion must survive that being changed.
 */
const flat = (text: string): string => text.replace(/^[ \t]*>[ \t]?/gm, "").replace(/\s+/g, " ");

/**
 * Every `.ts` under a package, concatenated. Naming a directory rather than a
 * file is what keeps a source-derived assertion honest across a split: reading
 * `src/core/verify.ts` stopped existing the day that module became a package,
 * and a test that reads one of five modules silently asks a fifth of its
 * question.
 */
const readPackage = async (dir: string): Promise<string> => {
  const entries = await readdir(join(ROOT, dir), { withFileTypes: true, recursive: true });
  const files = entries.filter((e) => e.isFile() && e.name.endsWith(".ts"));
  return (await Promise.all(files.map((e) => readFile(join(e.parentPath, e.name), "utf8")))).join("\n");
};

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

  it("says nothing at all once an element resolves to the service AND an edge touches it — no target, no instruction", async () => {
    // A service the map already draws AND reaches owes it nothing, and
    // briefing an edit there is how a second box for one service gets drawn.
    // payment-service has an inbound edge (`authorizePayment`), which is what
    // makes this the silent state rather than the edgeless one below.
    const p = await project(coherentFixture(), { service: SVC });
    const b = await brief(p);
    expect(b.landscape.modelled).toBe(true);
    expect(b.landscape.touched).toBe(true);
    expect(b.landscape.attested).toEqual([]);
    expect(b.landscape.instruction).toBe(null);
    expect(b.targets.map((t: { path: string }) => t.path)).not.toContain(
      "architecture/landscape.likec4",
    );
  });

  /**
   * The coherent fixture with a bound element for billing-service that no
   * edge touches — what `loam seed --from fleet.yaml` writes for every service
   * nobody listed under `calls:`. Element existence used to read as "the map
   * owes nothing" here, so the protocol's "make the landscape edit the brief
   * asks for" was followed to the letter by drawing no edge at all.
   */
  function edgelessFixture(): Record<string, string> {
    const files = coherentFixture();
    files["architecture/landscape.likec4"] = files["architecture/landscape.likec4"]!.replace(
      "  customer -> checkoutWeb 'Uses'",
      "  billingService = softwareSystem 'billing-service' {\n    metadata { service 'billing-service' }\n  }\n\n  customer -> checkoutWeb 'Uses'",
    );
    files["services/billing-service/spec.md"] = "---\nservice: billing-service\nstatus: draft\n---\n";
    return files;
  }

  it("asks again while an element resolves to the service and no edge touches it", async () => {
    const p = await project(edgelessFixture(), { service: "billing-service" });
    const b = await brief(p);
    expect(b.landscape.modelled).toBe(true);
    expect(b.landscape.touched).toBe(false);
    expect(typeof b.landscape.instruction).toBe("string");
    expect(b.landscape.instruction).toContain("billingService");
    const target = b.targets.find((t: { path: string }) => t.path === "architecture/landscape.likec4");
    expect(target, "no landscape target for an edgeless element").toBeDefined();
    expect(target.action).toBe("edit");
    expect(target.required).toBe(true);
    // The instruction refuses the failure the old silence invited: a second
    // element. What the map lacks is edges, and the shape says only that.
    expect(target.shape.join("\n")).toMatch(/Do NOT add a second one/);
    expect(target.example).not.toContain("metadata { service 'billing-service' }");
  });

  it("prints the edgeless instruction in the text view too, and flags the row EDGELESS rather than UNDRAWN", async () => {
    const p = await project(edgelessFixture(), { service: "billing-service" });
    const res = await runLoam(p.workDir, "adopt");
    expect(res.code, res.out).toBe(0);
    // The table flag: `UNDRAWN` is a lie for a drawn element, and a reader
    // acting on the word would look for a box that is already there.
    expect(res.out).toMatch(/landscape\.likec4\s+edit\s+EDGELESS/);
    expect(res.out).toContain("EDGELESS an element exists, no edge does");
    // The instruction lands under the landscape section, after the element
    // line, so the two views brief one write.
    const section = res.out.indexOf("what the fleet already says about this service");
    expect(section).toBeGreaterThan(-1);
    const element = res.out.indexOf("billingService = softwareSystem", section);
    expect(element).toBeGreaterThan(section);
    expect(res.out.replace(/\s+/g, " ").indexOf("draw NOTHING")).toBeGreaterThan(-1);
    expect(res.out.indexOf("draw NOTHING", element)).toBeGreaterThan(element);
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
    expect(agents).toMatch(/resolved against the directory\s+holding the/i);
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

  it("the generated contract exposes every current join and the read-only verify exception", () => {
    for (const fact of [
      "architecture/permissions.yaml",
      "`Requires: <subject>/<permission>`",
      "asyncapi.yaml",
      "`Publishes:`/`Consumes:`",
      "`Scenario Outline`",
    ]) {
      expect(SCAFFOLDED_DOCS, `the shipped contract never mentions ${fact}`).toContain(fact);
    }
    expect(SCAFFOLDED_DOCS).toMatch(/read-only verify checklist needs no\s+binding/);
    expect(SCAFFOLDED_DOCS).toMatch(/does not prove\s+the report was produced by executing the attested commit/);
  });

  it("the done-check teaches the federated recording form and warns about the other one", () => {
    expect(SCAFFOLDED_DOCS).toMatch(
      /loam verify FEAT-101 --service payment-service --results report\.json --record answers\.json/,
    );
    expect(SCAFFOLDED_DOCS).toContain("`record-federated`");
    expect(SCAFFOLDED_DOCS).toContain("attestation");
    // the destructiveness is stated, not implied
    expect(SCAFFOLDED_DOCS).toMatch(/silently erasing[\s\S]{0,30}evidence/);
  });

  it("/loam-verify records with --service, in the service's own repo", () => {
    const verify = PROTOCOLS["loam-verify"]!;
    // The contract flag sits between the two, bracketed: optional where a
    // contract suite exists, and part of the ONE recording form so an agent
    // never learns a second command shape for the same act.
    expect(verify).toMatch(
      /loam verify \$1 --service <id> --results report\.json \[--contract-results contract\.json\] --record answers\.json/,
    );
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

  /**
   * The hand-back asks for evidence, never for a verdict.
   *
   * "Is this enough to rebuild the service?" is the question this step is FOR,
   * and it is the one form it must not take: the only thing an agent can check
   * a sufficiency claim against is the document it just wrote, so the answer is
   * yes every time — including from the runs that documented a third of a
   * service. Both closing asks below are shaped to be falsifiable instead. Three
   * named gaps are three things a reviewer can go and look for; a branch count
   * beside a scenario count is two numbers whose disagreement needs no judgement
   * at all. Neither becomes a check — `REPRODUCIBILITY` stays in `UNCHECKED` —
   * so the wording is the whole mechanism, and rewording it belongs here.
   */
  it("/loam-adopt's hand-back asks for named gaps and two counts, not a sufficiency verdict", () => {
    const adopt = PROTOCOLS["loam-adopt"]!;
    expect(adopt).toContain("three behaviours");
    expect(adopt).toMatch(/documents do not describe/i);
    expect(adopt).toContain("two counts per operation");
    expect(adopt).toContain("how many scenarios you wrote");
    // The escape hatch is a claim, not a shrug: an agent that finds no gap has
    // to say it looked, which is itself checkable.
    expect(adopt).toMatch(/looked for three and found none/i);
  });
});

/* ------------------------------------------------------------------ */
/* 3. Every code the other workstreams added is documented             */
/* ------------------------------------------------------------------ */

describe("the code vocabulary reaches the contract loam ships", () => {
  // codes-drift.test.ts guards the whole corpus (AGENTS.md + every slash
  // command). This narrower list is the set an agent branches on most, and it
  // has to be reachable without a Claude-shaped runner.
  //
  // It used to say "and it has to be in AGENTS.md — the file that travels with
  // the docs repo and is the only one a non-Claude runner is pointed at". The
  // second half stopped being true when the reference pages were split out:
  // they travel with the BINARY, which is strictly more available than a file
  // written once at init, and AGENTS.md's own index names the command that
  // prints each. Requiring all of these in the auto-loaded file would undo the
  // split it took a 73% cut to earn.
  const SHIPPED_CODES = [
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
    const missing = SHIPPED_CODES.filter((c) => !SCAFFOLDED_DOCS.includes(`\`${c}\``));
    expect(missing, `undocumented in the shipped contract: ${missing.join(", ")}`).toEqual([]);
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
    expect(SCAFFOLDED_DOCS).toMatch(/per-service[\s\S]{0,40}`sources\.unverifiable-from-here`/);
  });

  it("the vouch-written fields are listed completely, sources_files included", () => {
    expect(SCAFFOLDED_DOCS).toContain("sources_files");
    expect(PROTOCOLS["loam-adopt"]).toContain("sources_files");
  });

  it("`c4.fleet-project-invalid`'s details format is spelled the way the finding emits it", async () => {
    // Re-verification 2026-09-04, D10: the row promised `<path> L<n>: <error>`
    // — no colon after the path — while `details[0]` is
    // `services/platform/notes.likec4: L2: Could not resolve …`. An agent
    // splitting on the documented separator split in the wrong place. Both
    // halves are pinned so neither can move alone: the row's spelling, and the
    // one expression in the fleet-project view that builds the string.
    // The row this check OWNS, not the first line naming the code:
    // `landscape.excluded`'s row names it too, one line above.
    const row = PROTOCOLS["loam-check"]!
      .split("\n")
      .find((line) => line.startsWith("| `c4.fleet-project-invalid`"));
    expect(row, "no /loam-check row for c4.fleet-project-invalid").toBeDefined();
    expect(row).toContain("`<path>: L<n>: <error>`");
    const source = await readRepo("src/commands/validate/fleet/views/fleet-project.ts");
    expect(
      source,
      "the finding must still join the path and the error with `: ` — move the protocol row with it",
    ).toContain("`${file}: ${errorText(err)}`");
  });
});

/* ------------------------------------------------------------------ */
/* 3b. the `loam explain` pointer that replaced the per-code gloss     */
/* ------------------------------------------------------------------ */

/**
 * The families `loam explain` does not answer — and therefore the families
 * whose gloss must stay WRITTEN OUT in AGENTS.md rather than pointed at.
 *
 * Each entry is a promise that the section still explains those codes inline.
 * The list may only shrink: when src/core/explain/ grows to cover a family,
 * the entry comes out here and the gloss comes out of AGENTS.md in the same
 * change, which is the only way the two stay in step. The stale-entry test
 * below is what forces that — an excused family that `explain` has since
 * learned to answer fails, rather than sitting here excusing nothing.
 */
const EXPLAIN_DOES_NOT_ANSWER: ReadonlyArray<readonly [RegExp, string]> = [
  [
    /^openspec\./,
    "the OpenSpec import surface grades a repository still in ANOTHER tool's shape — `loam audit-openspec` runs before the repo has a governed loop to look a code up from, and each finding already names its artifact and line — so src/core/explain leaves it unanswered and refusals.ts keeps the notes",
  ],
  [
    /^mapping\./,
    "the same import surface: the decision file `loam migrate-openspec --map` reads is deleted after one run, so its codes describe an artifact that does not outlive the command",
  ],
  [
    /^(archedge\.covered|gherkin\.current)$/,
    "the two `ok`-severity confirmations still in explain's own backlog (test/explain.test.ts's INTENTIONALLY_UNLISTED). AGENTS.md names them in its bare confirmations list, which never carried a gloss to remove",
  ],
];

/**
 * The document AGENTS.md used to be: the file itself plus the four reference
 * pages that were carved out of it.
 *
 * The split was a DELIVERY change and nothing else — `loam instructions
 * loam-codes` prints what `## Reading loam's output` used to hold, byte for
 * byte — so the property below is about the same prose it was always about,
 * and grading only the remaining file would have quietly narrowed it from 335
 * codes to 23. That is the failure this whole area exists to prevent, arriving
 * as a passing test.
 *
 * Deliberately NOT every protocol: the /loam-check fix tables are where
 * `explainSubject` reads its answers FROM, so including them would make the
 * assertion partly self-referential. This corpus is the teaching material,
 * which is the thing that can point at an explanation that does not exist.
 *
 * Every OTHER page is in, and the four reference pages are no longer the whole
 * of it. The workflow pages are teaching an agent fetches by name the same way
 * — the adoption done-test lives on `loam-adopt`, not on a reference page —
 * and excluding them made this corpus narrower than the thing it claims to
 * grade. `loam-check` stays out for the reason above, which is about that page
 * and no other.
 */
const SCAFFOLDED_DOCS =
  AGENTS_MD +
  Object.entries(PROTOCOLS)
    .filter(([name]) => name !== "loam-check")
    .map(([, body]) => body)
    .join("\n");

describe("AGENTS.md points at `loam explain`, and the pointer lands", () => {
  /**
   * `## Reading loam's output` was 48% of a 124 KB file because it glossed
   * every code where it listed it — 143 of them explained a second time, in
   * prose written independently of the /loam-check fix tables, inside a file
   * `loam init` writes once and never refreshes. The two drifted and nothing
   * could say which had rotted. What survives beside each code is a CONDITION
   * — when that invocation reaches it at all — which is the one thing a
   * per-code catalogue cannot say; meaning and fix come from
   * `loam explain <code>`.
   *
   * That trade is only safe while the pointer lands. This is the test that
   * makes it land, and it fails BY NAME on the code whose explanation is
   * missing — so a family can never again be de-glossed ahead of the
   * catalogue that is supposed to answer for it.
   *
   * The graded set is an intersection of two facts rather than a hand-list: a
   * code loam actually EMITS (the collector codes-drift.test.ts uses) that the
   * scaffolded docs actually NAME, backticked. A family added to the inventory
   * without an entry in the catalogue therefore fails here; a family deleted
   * from it stops being graded here, which is exactly what
   * codes-drift.test.ts refuses to allow.
   */
  it("every emitted code the scaffolded docs name is answered by `loam explain`", async () => {
    const { codes } = await collectStableCodes();
    const named = [...codes].filter((code) => SCAFFOLDED_DOCS.includes(`\`${code}\``)).sort();
    // The canary. Every assertion below passes vacuously over an empty set, and
    // the set is built by string matching over prose — the failure mode is the
    // section being reshaped so nothing matches, not a code being unexplained.
    expect(named.length, "the scaffolded docs stopped naming emitted codes — the extraction broke").toBeGreaterThan(300);

    const excused = (code: string) => EXPLAIN_DOES_NOT_ANSWER.some(([pattern]) => pattern.test(code));
    const unexplained = named.filter((code) => !excused(code) && explainSubject(code) === null);
    expect(
      unexplained,
      "The scaffolded docs name these codes and `loam explain` cannot answer them:\n  " +
        unexplained.join("\n  ") +
        "\nEither add them to src/core/explain/ (a fix-table row, or a families.ts entry), " +
        "or keep their gloss written out in src/core/agent/agents-md/ and add them to " +
        "EXPLAIN_DOES_NOT_ANSWER with the reason. Pointing at an explanation that does not " +
        "exist is the failure this whole section was rewritten to prevent.",
    ).toEqual([]);
  });

  it("the excuse list only shrinks — no entry outlives the hole it names", async () => {
    const { codes } = await collectStableCodes();
    const named = [...codes].filter((code) => SCAFFOLDED_DOCS.includes(`\`${code}\``));
    for (const [pattern, reason] of EXPLAIN_DOES_NOT_ANSWER) {
      const matched = named.filter((code) => pattern.test(code));
      expect(matched.length, `EXPLAIN_DOES_NOT_ANSWER entry ${pattern} matches no code the scaffolded docs name — ${reason}`)
        .toBeGreaterThan(0);
      const nowAnswered = matched.filter((code) => explainSubject(code) !== null);
      expect(
        nowAnswered,
        `\`loam explain\` now answers ${nowAnswered.join(", ")}, so ${pattern} no longer excuses anything. ` +
          "Delete the entry AND the inline gloss those codes still carry in src/core/agent/agents-md/ — " +
          "leaving the gloss is how the duplication grows back.",
      ).toEqual([]);
    }
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
    // The first row is the shape rule, and its code is the one that convicts the
    // OTHER shape: a model that declares its own kinds still parses, and what it
    // then risks is its copies of the map's elements drifting.
    ["No `specification` block of its own", "c4.declaration-diverged"],
    ["block whose body is", "c4.invalid"],
    ["The map's element is the binding", "landscape.service-unmodelled"],
    // The rule names two codes — `c4.element-unowned` for a copied element and
    // `spine.op-undefined` for the map's twin edge — and the row picks the one
    // the rule is ABOUT. Both are in the brief's checks[], and the assertion
    // below only asks that the rule name the code its row claims.
    ["A call to another system", "c4.element-unowned"],
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
   * and it fails the same way: silently, in the agent's hand-back.
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
    // A config-attested edge must meet the manifest that can veto it: outbound
    // calls are drawn before the runtime stop opens the deploy manifests. This
    // ordering is what turns "the config wires an optional service registry"
    // into a provisional edge
    // instead of a shipped requirement.
    expect(at("outbound calls")).toBeLessThan(at("the runtime"));
  });

  /**
   * The gap this prevents: every endpoint documented, and not one of the guards
   * behind them — the permission checks, the fields required only in
   * combination, the transitions a request is refused for. The walk's ORDER was
   * not the problem. The HTTP stop asked for the operation set and got exactly
   * that, so the decision layer INSIDE each operation was never read, and the
   * resulting service baseline could not describe how to rebuild it.
   *
   * Nothing downstream can catch it: `api.ungoverned` grades operations against
   * requirements, never branches against scenarios, and `UNCHECKED` says
   * COMPLETENESS is unmeasurable in principle. The instruction is therefore the
   * only place this is fixable at all, which is why it is pinned here.
   */
  it("the HTTP stop asks for the decisions inside an operation, not only the operation set", async () => {
    const p = await project({}, { service: SVC });
    const b = await brief(p);
    const walk = b.walk as Array<{ where: string; find: string; lands: string[] }>;
    const http = walk.find((s) => s.where.includes("HTTP surface"));
    expect(http).toBeDefined();
    for (const guard of ["permission", "required only when", "default", "transition"]) {
      expect(http!.find.toLowerCase(), `the HTTP stop never names ${guard}`).toContain(guard);
    }
    // Both counts, because one is the denominator of the other: twelve
    // operations says nothing about the thirty branches sitting inside them.
    expect(http!.find).toMatch(/count both/i);
    // A guard is refused behaviour, and refused behaviour is a scenario.
    expect(http!.lands).toContain("spec.md");
  });

  /**
   * In a synthetic example, a service is wired for an optional registry in its
   * repository while a deployment manifest disables that capability. Reading
   * only the service configuration then yields the wrong effective topology
   * unless the protocol states deployment precedence. This test pins that text
   * to the stop that opens the manifests.
   */
  it("the runtime stop states that the deploy manifest overrides configuration", async () => {
    const p = await project({}, { service: SVC });
    const b = await brief(p);
    const walk = b.walk as Array<{ where: string; find: string; lands: string[] }>;
    const runtime = walk.find((s) => s.where.split(" — ")[0] === "the runtime");
    expect(runtime).toBeDefined();
    expect(runtime!.find).toMatch(/override/i);
    expect(runtime!.find).toContain("another repository");
    // The finding's landing site: a disabled feature is a runbook fact, not an edge.
    expect(runtime!.find).toContain("configured but not a dependency");
    expect(runtime!.lands).toContain("runbook.md");
    // And the out-of-repo read must not be laundered into `sources`, where
    // sources.path-outside would grade the honesty an error.
    expect(runtime!.find).toContain("never in `sources`");
  });

  it("runbook.md's shape names the 'configured but not a dependency' list the runtime stop lands", async () => {
    const p = await project({}, { service: SVC });
    const b = await brief(p);
    const shape: string = b.targets
      .find((t: { artifact: string }) => t.artifact === "runbook.md")
      .shape.join("\n");
    expect(shape).toContain("configured but not a dependency, and why");
  });

  /**
   * The facts no artifact structurally holds — effective configuration,
   * library semantics — need a NAMED home, or two agent runs can file the same
   * fact two different ways. The convention is arch.spec.md, stated where the
   * facts are found (walk stops 1 and 8) and in the generated AGENTS.md; the
   * reproducibility bar those facts serve is stated beside COMPLETENESS in
   * unchecked[], because nothing checks either.
   */
  it("the walk lands library semantics and effective configuration in arch.spec.md", async () => {
    const p = await project({}, { service: SVC });
    const b = await brief(p);
    const walk = b.walk as Array<{ where: string; find: string; lands: string[] }>;
    const manifests = walk.find((s) => s.where.split(" — ")[0] === "the build and dependency manifests");
    expect(manifests!.find).toContain("arch requirement");
    expect(manifests!.lands).toContain("arch.spec.md");
    const runtime = walk.find((s) => s.where.split(" — ")[0] === "the runtime");
    expect(runtime!.find).toContain("EFFECTIVE configuration");
    expect(runtime!.lands).toContain("arch.spec.md");
  });

  it("unchecked[] states the reproducibility bar, and AGENTS.md names the convention and the done-test", async () => {
    const p = await project({}, { service: SVC });
    const b = await brief(p);
    const unchecked: string = (b.unchecked as string[]).join("\n");
    expect(unchecked).toContain("REPRODUCIBILITY");
    expect(unchecked).toContain("loam never verifies the values");
    expect(SCAFFOLDED_DOCS).toContain("Effective configuration and dependency semantics live here too");
    expect(SCAFFOLDED_DOCS).toContain("The bar this artifact set aims at is reproducibility");
    expect(SCAFFOLDED_DOCS).toContain("Done, stated once");
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
    // The command table carries the flags in a column of their own now, and
    // the per-command notes live in WORKFLOW.md — the binding sentence with
    // them. Both halves still have to be somewhere a reader will find them.
    const row = (await readRepo("README.md")).split("\n").find((line) => line.startsWith("| `loam init`"));
    expect(row, "README has no `loam init` row").toBeDefined();
    expect(row).toContain("--docs <dir>");
    expect(row).toContain("--service <id>");
    expect(flat(await readRepo("WORKFLOW.md"))).toMatch(/`--service <id>` is what a \*\*service\*\* repo needs/);
  });

  it("carries a numbered day-zero section covering all eleven repos", async () => {
    // Day zero moved to WORKFLOW.md, where the rest of the protocol lives;
    // README keeps the five-minute trial and links here. Bounded by the next
    // h2 rather than by a named sibling, so a heading added after it cannot
    // silently widen the slice to the rest of the file.
    const workflow = flat(await readRepo("WORKFLOW.md"));
    const from = workflow.indexOf("## Day zero");
    expect(from, "WORKFLOW.md has no day-zero section").toBeGreaterThan(-1);
    const to = workflow.indexOf("## ", from + 3);
    const section = workflow.slice(from, to === -1 ? undefined : to);
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
    // The `loam new` note moved to WORKFLOW.md with the rest of the command
    // notes; the claim it must not make is checked on both pages.
    const readme = flat(await readRepo("README.md"));
    const workflow = flat(await readRepo("WORKFLOW.md"));
    expect(readme).not.toContain("Validates clean out of the box");
    expect(workflow).not.toContain("Validates clean out of the box");
    expect(workflow).toContain("zero errors");
  });

  it("describes what `loam delta` actually prints", async () => {
    const readme = await readRepo("README.md");
    const row = readme.split("\n").find((l) => l.startsWith("| `loam delta"))!;
    expect(row).toMatch(/verbatim/);
    expect(row).toMatch(/Given\/When\/Then/);
  });

  it("describes what `--errors-only` actually drops", async () => {
    // The row said "`--errors-only` prints just the errors", and it never did:
    // the report filters `severity !== "ok"`, so the lever drops the
    // confirmations and keeps every warning. Measured on the example fleet,
    // `validate --all --errors-only` printed the same warning lines as the
    // unfiltered run. The flag's own `--help` string was honest and so was the
    // generated AGENTS.md; only this page lied, and a table is what a reader
    // consults instead of running `--help`. The wording pinned here is the one
    // src/core/agent/workflows/check.ts already uses, so a reader who meets the
    // flag on either surface meets the same sentence.
    const readme = await readRepo("README.md");
    const row = readme.split("\n").find((l) => l.startsWith("| `loam validate"))!;
    expect(row).toMatch(/drops the `ok` confirmations from the text view/);
    expect(row).not.toMatch(/just the errors/);
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
    expect(flat(section)).toMatch(/exactly as it was passed/);
  });

  it("describes the federated record: attestations, the merge, and the refusals", async () => {
    const schema = await readRepo("SCHEMA.md");
    expect(schema).toContain("attestations");
    expect(schema).toContain("`schema: 2`");
    expect(flat(schema)).toMatch(/one attestation per service/i);
  });

  it("every refusal code `loam verify` can emit is documented in SCHEMA", async () => {
    // verify.ts fails here until SCHEMA explains it.
    const schema = await readRepo("SCHEMA.md");
    const json = await readRepo("src/core/envelope/json.ts");
    const union = new Set(
      [...json.matchAll(/^\s*\|\s*"([a-z][a-z0-9-]*)"/gm)].map((m) => m[1]!),
    );
    // The three generic invocation failures are documented once, globally, not
    // per command — a `verify`-specific paragraph for "no such feature" would
    // be noise in a schema document.
    const GENERIC = new Set(["no-config", "config-invalid", "unknown-target", "invalid-option", "internal"]);
    const verifySrc =
      (await readPackage("src/commands/verify")) + (await readPackage("src/core/verify"));
    const emitted = [...new Set([...verifySrc.matchAll(/"([a-z][a-z0-9-]*)"/g)].map((m) => m[1]!))]
      .filter((c) => union.has(c) && !GENERIC.has(c))
      .sort();

    expect(emitted.length).toBeGreaterThan(4);
    const missing = emitted.filter((c) => !schema.includes(`\`${c}\``));
    expect(missing, `verify refusal codes missing from SCHEMA.md: ${missing.join(", ")}`).toEqual([]);
  });

  it("no longer claims an unreadable record counts as no record at all", async () => {
    const schema = await readRepo("SCHEMA.md");
    expect(flat(schema)).not.toMatch(/counts as \*\*no record at all\*\*/);
    expect(schema).toContain("`record-unreadable`");
    expect(flat(schema)).toMatch(/\*\*never overwritten\*\*/);
  });

  it("pins the digest recipe's two exclusions: what git ignores, and symlinks", async () => {
    const schema = await readRepo("SCHEMA.md");
    expect(schema).toContain("git check-ignore");
    expect(schema).toContain("`sources.skipped`");
    expect(schema).toContain("`sources.empty`");
    expect(schema).toContain("`sources_files`");
    // the direction of the fallback is the load-bearing part
    expect(flat(schema)).toMatch(/everything is hashed/i);
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
    expect(flat(schema)).toMatch(/error\*\* as soon as `services\/` holds at least one service/);
  });
});
