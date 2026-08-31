/**
 * Feature-local capability deltas: `features/<FEAT>/capabilities/<id>/spec.md`,
 * graded by the delta algebra and merged by `loam archive`.
 *
 * What these tests hold that a plausible wrong implementation would break:
 *
 * ONE ALGEBRA, NOT A SECOND ONE. Every grade the service corpus earns applies
 * here with the capability id in `subject` — the whole reason the business
 * corpus was given deltas rather than a bespoke edit path. The cases below are
 * therefore chosen for the ways the CAPABILITY side can be wired up wrongly
 * while the service side stays green: the walk that grades nothing, the living
 * path resolved at the wrong depth, the merge that writes without grading, and
 * the grade that runs only after the merge has already landed.
 *
 * THE NESTED ID IS THE DISCRIMINATOR. `payments/refunds` spells its nesting in
 * the tree, and a reader that resolves it by its LEAF addresses a different
 * capability entirely — silently, in the worst possible way: the delta then
 * reads an empty living document, so every ADDED looks new, no `Based-On:` is
 * ever compared, and the merge lands over text nobody re-read. A flat id cannot
 * tell that apart from a correct resolution, which is why the stale-pin case
 * and the round trip below both use a nested one.
 *
 * REBASE IS PART OF THE FEATURE, NOT A FOLLOW-UP. `delta.baseline-missing`
 * gates archive and its message says to run `loam rebase <FEAT>`. The
 * missing-pin case therefore runs that exact command and archives afterwards:
 * a gate whose named exit does not work is worse than no gate.
 *
 * AND A FLEET THAT HAS NOT ADOPTED THE AXIS PAYS NOTHING. The last block is the
 * control. It is the assertion that fails if any read here becomes
 * unconditional.
 */
import { describe, expect, it, afterEach } from "vitest";
import { join } from "node:path";
import { featureCapabilityDeltas } from "../src/core/capabilities/delta/tree.js";
import { uncoveredIssues } from "../src/core/capabilities/delta/uncovered.js";
import { featureCoherence } from "../src/core/coherence/coherence.js";
import { parseRequirements } from "../src/core/document/parse.js";
import { type Requirement } from "../src/core/document/spec.js";
import { FleetContext } from "../src/core/fleet-context.js";
import { featureDirOf } from "../src/core/kernel/ids/dirs.js";
import {
  coherentFixture,
  FEATURE_SPEC,
  LANDSCAPE,
  makeProject,
  pinFor,
  runLoam,
  treeHashes,
  type Project,
} from "./helpers/harness.js";

const FEAT_DIR = "features/FEAT-1-split";
const SPLIT_SPEC = `${FEAT_DIR}/specs/payment-split-service/spec.md`;

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function project(files: Record<string, string>): Promise<Project> {
  const p = await makeProject(files, { service: "payment-service" });
  cleanups.push(() => p.destroy());
  return p;
}

/** One requirement, spelled the way both a living document and a delta spell it. */
function requirement(id: string, name: string, body = ""): string {
  return `### Requirement: ${name}
Requirement-ID: ${id}
${body}The fleet SHALL keep this promise.

#### Scenario: It is kept
- **Given** a customer
- **When** they ask
- **Then** it is kept
`;
}

/** A LIVING capability document: narrative, then the requirements run. */
function livingDoc(reqs: string[]): string {
  return `# Refunds

A customer can get their money back, and can see that it happened.

## Requirements

${reqs.join("\n")}`;
}

/** A capability DELTA under one delta heading. */
function delta(heading: string, reqs: string[]): string {
  return `# refunds — delta for FEAT-1

## ${heading}

${reqs.join("\n")}`;
}

/**
 * The canonical service delta, carrying a `Realizes:` line — the other half of
 * every fixture that ADDS a capability requirement.
 *
 * A promise a feature makes and nothing in the same feature keeps is
 * `capability.uncovered`, so a fixture demonstrating the merge has to write BOTH
 * halves or it is demonstrating the refusal instead.
 */
function realizing(entry: string): string {
  return FEATURE_SPEC.replace("Operations: createSplit", `Operations: createSplit\nRealizes: ${entry}`);
}

/** Every finding of one code, from a `--json` validate run. */
async function findings(
  p: Project,
  code: string,
  ...args: string[]
): Promise<Array<{ severity: string; subject?: string; message: string; gates?: boolean }>> {
  const res = await runLoam(p.workDir, "validate", ...args, "--json");
  const doc = JSON.parse(res.stdout);
  const targets: Array<{
    findings: Array<{ severity: string; code: string; subject?: string; message: string; gates?: boolean }>;
  }> = doc.targets ?? [];
  return targets.flatMap((t) => t.findings.filter((f) => f.code === code));
}

/** The refusal an `archive --json` produced: its error code and the issues attached. */
async function refusal(p: Project, ...args: string[]): Promise<{ code: string; issues: Array<{ code: string; subject?: string }> }> {
  const res = await runLoam(p.workDir, "archive", "FEAT-1", ...args, "--json");
  expect(res.code, res.out).toBe(1);
  const doc = JSON.parse(res.stdout);
  return { code: doc.error.code, issues: doc.issues ?? [] };
}

describe("the delta algebra applies to a capability document unchanged", () => {
  it("ADDED of a requirement the living document already has is delta.added-duplicate, and archive refuses", async () => {
    const p = await project({
      ...coherentFixture(),
      "capabilities/refunds/spec.md": livingDoc([requirement("REF-1", "Refund within five days")]),
      [`${FEAT_DIR}/capabilities/refunds/spec.md`]: delta("ADDED Requirements", [
        requirement("REF-1", "Refund within five days"),
      ]),
    });
    const before = await treeHashes(p.docsDir);
    const found = await findings(p, "delta.added-duplicate", "--feature", "FEAT-1");
    expect(found).toHaveLength(1);
    expect(found[0]!.subject).toBe("refunds");
    expect(found[0]!.message).toContain("living capabilities/refunds/spec.md");

    // Refused BEFORE anything is written: an ADDED that lands on a living
    // requirement REPLACES it, scenarios and all. A merge that ran without the
    // selection pass first would archive at exit 0 and drop the living text.
    expect((await refusal(p)).issues.map((i) => i.code)).toContain("delta.added-duplicate");
    expect(await treeHashes(p.docsDir)).toEqual(before);
  });

  it("a requirement under a prose heading is delta.requirement-not-merged", async () => {
    const p = await project({
      ...coherentFixture(),
      "capabilities/refunds/spec.md": livingDoc([requirement("REF-1", "Refund within five days")]),
      [`${FEAT_DIR}/capabilities/refunds/spec.md`]: `# refunds — delta for FEAT-1

## Notes

${requirement("REF-2", "Show the refund on the statement")}`,
    });
    const found = await findings(p, "delta.requirement-not-merged", "--feature", "FEAT-1");
    expect(found).toHaveLength(1);
    expect(found[0]!.subject).toBe("refunds");
    expect(found[0]!.gates).toBe(true);
    expect((await refusal(p)).issues.map((i) => i.code)).toContain("delta.requirement-not-merged");
  });

  it("requirements with no delta heading anywhere are delta.no-delta-sections", async () => {
    const p = await project({
      ...coherentFixture(),
      [`${FEAT_DIR}/capabilities/refunds/spec.md`]: `# refunds

## Requirements

${requirement("REF-1", "Refund within five days")}`,
    });
    const found = await findings(p, "delta.no-delta-sections", "--feature", "FEAT-1");
    expect(found).toHaveLength(1);
    // The path is named, so a reader is sent to the file rather than to the id.
    expect(found[0]!.message).toContain(`${FEAT_DIR}/capabilities/refunds/spec.md`);
  });

  it("a MODIFIED with no pin gates archive, and `loam rebase` — the command the message names — fixes it", async () => {
    const living = livingDoc([requirement("REF-1", "Refund within five days")]);
    const p = await project({
      ...coherentFixture(),
      "capabilities/refunds/spec.md": living,
      [`${FEAT_DIR}/capabilities/refunds/spec.md`]: delta("MODIFIED Requirements", [
        requirement("REF-1", "Refund within three days"),
      ]),
    });
    const found = await findings(p, "delta.baseline-missing", "--feature", "FEAT-1");
    expect(found).toHaveLength(1);
    expect(found[0]!.subject).toBe("refunds");
    expect(found[0]!.gates).toBe(true);
    // The message names the exit. If it names a command that does not pin this
    // file, the gate has no exit at all.
    expect(found[0]!.message).toContain("loam rebase FEAT-1");
    expect((await runLoam(p.workDir, "archive", "FEAT-1", "--json")).code).toBe(1);

    const rebased = await runLoam(p.workDir, "rebase", "FEAT-1", "--json");
    expect(rebased.code, rebased.out).toBe(0);
    const payload = JSON.parse(rebased.stdout);
    expect(payload.capabilities).toEqual(["refunds"]);
    expect(payload.capabilityPins).toEqual([
      {
        capability: "refunds",
        file: "spec.md",
        kind: "MODIFIED",
        target: "Refund within three days",
        status: "pinned",
        from: null,
        to: pinFor(living, "Refund within five days"),
      },
    ]);
    // `pins[]` is the published SERVICE list and must not have quietly grown a
    // capability row wearing a `service` field.
    expect(payload.pins.every((o: { service: string }) => o.service !== "refunds")).toBe(true);
    expect(await p.read(`${FEAT_DIR}/capabilities/refunds/spec.md`)).toContain(
      `Based-On: ${pinFor(living, "Refund within five days")}`,
    );

    expect(await findings(p, "delta.baseline-missing", "--feature", "FEAT-1")).toEqual([]);
    const archived = await runLoam(p.workDir, "archive", "FEAT-1", "--json");
    expect(archived.code, archived.out).toBe(0);
    const merged = await p.read("capabilities/refunds/spec.md");
    expect(merged).toContain("Refund within three days");
    expect(merged).not.toContain("Refund within five days");
    // The narrative above `## Requirements` is preserved byte for byte — the
    // merge rewrites the run and nothing else.
    expect(merged).toContain("A customer can get their money back, and can see that it happened.");
  });

  it("a stale pin on a NESTED capability is caught, which an unsplit living path could not see", async () => {
    const living = livingDoc([requirement("REF-1", "Refund within five days")]);
    const p = await project({
      ...coherentFixture(),
      "capabilities/payments/refunds/spec.md": living,
      [`${FEAT_DIR}/capabilities/payments/refunds/spec.md`]: delta("MODIFIED Requirements", [
        requirement("REF-1", "Refund within three days", `Based-On: ${pinFor(living, "Refund within five days")}\n`),
      ]),
    });
    // Somebody lands a change to the living document underneath the delta.
    await p.write(
      "capabilities/payments/refunds/spec.md",
      livingDoc([requirement("REF-1", "Refund within four days")]),
    );
    const before = await treeHashes(p.docsDir);
    const found = await findings(p, "delta.baseline-stale", "--feature", "FEAT-1");
    // The living path resolved at the wrong depth would read `[]` here, so the
    // pin would never be compared and this list would be empty.
    expect(found).toHaveLength(1);
    expect(found[0]!.subject).toBe("payments/refunds");
    expect(found[0]!.message).toContain("living capabilities/payments/refunds/spec.md");
    expect((await runLoam(p.workDir, "archive", "FEAT-1", "--json")).code).toBe(1);
    expect(await treeHashes(p.docsDir)).toEqual(before);
  });
});

describe("a capability and a service may share a name without sharing a claim", () => {
  /** A feature whose SERVICE delta adds `Split a payment` to a service called `refunds`. */
  const serviceClaimant = (id: string, dir: string): Record<string, string> => ({
    [`features/${dir}/intent.md`]: `---\nfeature: ${id}\nstatus: proposed\n---\n\n# Refund handling\n\nA service that issues refunds.\n`,
    [`features/${dir}/specs/refunds/spec.md`]: delta("ADDED Requirements", [
      requirement("REF-1", "Refund within five days"),
    ]),
  });

  it("two service deltas on one service DO collide — the claim index works", async () => {
    const p = await project({
      ...coherentFixture(),
      ...serviceClaimant("FEAT-2", "FEAT-2-a"),
      ...serviceClaimant("FEAT-3", "FEAT-3-b"),
    });
    const found = await findings(p, "delta.added-conflict", "--feature", "FEAT-2");
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain("FEAT-3");
  });

  it("a capability delta of the same name and the same requirement does NOT", async () => {
    // The claim key carries the KIND. Without it, this capability's ADDED
    // matches the service claim above — and loam reports a collision against a
    // document the two features have nothing to do with each other about.
    const p = await project({
      ...coherentFixture(),
      ...serviceClaimant("FEAT-3", "FEAT-3-b"),
      "features/FEAT-2-a/intent.md": "---\nfeature: FEAT-2\nstatus: proposed\n---\n\n# Promise a refund\n\nCustomers get their money back.\n",
      "features/FEAT-2-a/capabilities/refunds/spec.md": delta("ADDED Requirements", [
        requirement("REF-1", "Refund within five days"),
      ]),
    });
    expect(await findings(p, "delta.added-conflict", "--feature", "FEAT-2")).toEqual([]);
  });
});

describe("the capability document's own rules are graded on the DELTA, before the merge", () => {
  it("an Operations: line in a capability delta is refused rather than merged", async () => {
    const p = await project({
      ...coherentFixture(),
      [`${FEAT_DIR}/capabilities/refunds/spec.md`]: delta("ADDED Requirements", [
        requirement("REF-1", "Refund within five days", "Operations: authorizePayment\n"),
      ]),
    });
    const before = await treeHashes(p.docsDir);
    const found = await findings(p, "capability.requirement-service-scoped", "--feature", "FEAT-1");
    expect(found).toHaveLength(1);
    expect(found[0]!.subject).toBe("refunds");
    // The message points at the FEATURE's copy, which is the one the author can
    // still fix. Graded only on the living document, this requirement merges
    // clean and earns its error against a file nobody can un-merge.
    expect(found[0]!.message).toContain(`${FEAT_DIR}/capabilities/refunds/spec.md`);
    expect((await refusal(p)).issues.map((i) => i.code)).toContain("capability.requirement-service-scoped");
    expect(await treeHashes(p.docsDir)).toEqual(before);
    // A judgment about the feature, so `--approve` moves it — exactly as it
    // moves `capability.unknown`.
    expect((await runLoam(p.workDir, "archive", "FEAT-1", "--approve", "--json")).code).toBe(0);
  });

  it("an ADDED requirement with no Requirement-ID is refused; a REMOVED one is not", async () => {
    const p = await project({
      ...coherentFixture(),
      [`${FEAT_DIR}/capabilities/refunds/spec.md`]: `# refunds — delta for FEAT-1

## ADDED Requirements

### Requirement: Refund within five days
The fleet SHALL return a customer's money within five days.

#### Scenario: It is kept
- **Given** a customer
- **When** they ask
- **Then** it is kept
`,
    });
    expect(await findings(p, "capability.requirement-unidentified", "--feature", "FEAT-1")).toHaveLength(1);

    const removing = await project({
      ...coherentFixture(),
      "capabilities/refunds/spec.md": livingDoc([requirement("REF-1", "Refund within five days")]),
      [`${FEAT_DIR}/capabilities/refunds/spec.md`]: `# refunds — delta for FEAT-1

## REMOVED Requirements

### Requirement: Refund within five days
`,
    });
    // A REMOVED requirement is being retired. Demanding a stable id on it would
    // ask for an edit to text that is about to stop existing.
    expect(await findings(removing, "capability.requirement-unidentified", "--feature", "FEAT-1")).toEqual([]);
  });
});

describe("archive merges the business corpus", () => {
  it("the first feature to mention a capability CREATES its living document, and says the fleet just opted in", async () => {
    const p = await project({
      ...coherentFixture(),
      [SPLIT_SPEC]: realizing("refunds#REF-1"),
      [`${FEAT_DIR}/capabilities/refunds/spec.md`]: delta("ADDED Requirements", [
        requirement("REF-1", "Refund within five days"),
      ]),
    });
    expect(p.exists("capabilities")).toBe(false);

    const dry = await runLoam(p.workDir, "archive", "FEAT-1", "--dry-run", "--json");
    expect(dry.code, dry.out).toBe(0);
    // The directory IS the list on this axis, so an archive that merged into a
    // file it refused to create would make the whole delta merge nothing.
    expect(JSON.parse(dry.stdout).plan).toContainEqual({
      path: "capabilities/refunds/spec.md",
      action: "create",
    });

    const run = await runLoam(p.workDir, "archive", "FEAT-1");
    expect(run.code, run.out).toBe(0);
    // Creating `capabilities/` opts the whole fleet into the axis, so the merge
    // must not do it silently.
    expect(run.stdout).toContain("opts the fleet into the business axis");
    const created = await p.read("capabilities/refunds/spec.md");
    // The preamble is what THIS merge decides, byte for byte: the id as the
    // heading and nothing else. No frontmatter, deliberately — nothing reads a
    // capability document's, and a `status:` invented here would be a second
    // list nothing keeps current. The requirement run below it is
    // `serializeRequirements`' framing, checked by re-parsing rather than
    // re-encoded here.
    expect(created.startsWith("# refunds\n\n## Requirements\n\n")).toBe(true);
    expect(created).not.toContain("---");
    const reparsed = parseRequirements(created);
    expect(reparsed.map((r) => [r.name, r.id, r.kind])).toEqual([
      ["Refund within five days", "REF-1", "BASE"],
    ]);
    expect(reparsed[0]!.scenarios).toHaveLength(1);
    // And the document is now a real declaration the rest of loam can see.
    const list = await runLoam(p.workDir, "list", "capabilities", "--json");
    expect((JSON.parse(list.stdout).capabilities as Array<{ id: string }>).map((c) => c.id)).toEqual(["refunds"]);
  });

  it("a nested id merges into its nested living path, and unarchive is a byte-exact round trip", async () => {
    const p = await project({
      ...coherentFixture(),
      "capabilities/payments/spec.md": livingDoc([requirement("PAY-1", "Take money for an order")]),
      [SPLIT_SPEC]: realizing("payments/refunds#REF-1"),
      [`${FEAT_DIR}/capabilities/payments/refunds/spec.md`]: delta("ADDED Requirements", [
        requirement("REF-1", "Refund within five days"),
      ]),
    });
    const before = await treeHashes(p.docsDir);

    const archived = await runLoam(p.workDir, "archive", "FEAT-1", "--json");
    expect(archived.code, archived.out).toBe(0);
    // Resolved by its LEAF this would have merged into capabilities/refunds/ —
    // a different capability, created out of nothing, while the one the feature
    // named stayed empty.
    expect(p.exists("capabilities/payments/refunds/spec.md")).toBe(true);
    expect(p.exists("capabilities/refunds")).toBe(false);
    expect(await p.read("capabilities/payments/refunds/spec.md")).toContain("Requirement-ID: REF-1");
    // The sibling capability at the parent level is untouched — a group
    // directory that is also a capability is the normal shape here.
    expect(await p.read("capabilities/payments/spec.md")).toContain("Requirement-ID: PAY-1");

    const restored = await runLoam(p.workDir, "unarchive", "FEAT-1", "--json");
    expect(restored.code, restored.out).toBe(0);
    // The snapshot manifest keys only `services/` rows, so a `capabilities/`
    // row is key-less exactly like a landscape row — the version-3 rule
    // `readServiceKey` already enforces. If a key were written onto one, the
    // whole manifest would be refused as snapshot-missing rather than restored.
    expect(JSON.parse(restored.stdout).removed).toContain("capabilities/payments/refunds/spec.md");
    // And the directories the archive created are gone with it: the tree is
    // byte-for-byte what it was, empty directories included.
    expect(await treeHashes(p.docsDir)).toEqual(before);
  });

  it("a capability-only feature is graded — it touches no service at all", async () => {
    // The early return used to ask only about `specs/`, so a business change
    // with no service touched yet was graded by nothing and archived whatever
    // its delta said. It is also the first thing an analyst writes.
    const p = await project({
      ...coherentFixture(),
      "features/FEAT-2-promise/intent.md":
        "---\nfeature: FEAT-2\nstatus: proposed\n---\n\n# Promise a refund\n\nCustomers must be able to get their money back.\n",
      "features/FEAT-2-promise/capabilities/refunds/spec.md": `# refunds — delta for FEAT-2

## MODIFIED Requirements

${requirement("REF-1", "Refund within five days")}`,
    });
    const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-2", "--json");
    const codes = (JSON.parse(res.stdout).targets as Array<{ findings: Array<{ code: string }> }>)
      .flatMap((t) => t.findings.map((f) => f.code));
    expect(codes).toContain("delta.modified-unknown");
    expect(res.code).toBe(1);
  });

  it("git conflict markers in a LIVING capability document block the merge", async () => {
    const p = await project({
      ...coherentFixture(),
      "capabilities/refunds/spec.md": `# Refunds

## Requirements

### Requirement: Refund within five days
Requirement-ID: REF-1
<<<<<<< HEAD
The fleet SHALL return the money in five days.
=======
The fleet SHALL return the money in three days.
>>>>>>> feature/faster

#### Scenario: It is kept
- **Given** a customer
- **When** they ask
- **Then** it is kept
`,
      [`${FEAT_DIR}/capabilities/refunds/spec.md`]: delta("ADDED Requirements", [
        requirement("REF-2", "Show the refund on the statement"),
      ]),
    });
    const before = await treeHashes(p.docsDir);
    const refused = await runLoam(p.workDir, "archive", "FEAT-1", "--json");
    expect(refused.code).toBe(1);
    expect(JSON.parse(refused.stdout).error.code).toBe("merge-failed");
    // The requirements rewrite would delete whichever marker lines fall inside
    // the run it owns, turning a conflict anyone can see into a file nobody can
    // tell is wrong. `--approve` does not reach it.
    expect((await runLoam(p.workDir, "archive", "FEAT-1", "--approve", "--json")).code).toBe(1);
    expect(await treeHashes(p.docsDir)).toEqual(before);
  });

  it("git conflict markers in the capability DELTA are reported, exactly as in a service delta", async () => {
    // Graded here or nowhere. A conflicted delta parses as prose, so every
    // other check reads it as a valid document — and the merge then
    // re-serializes both sides of somebody's merge into the LIVING capability
    // document, where nothing walks them again once the feature is archived.
    const p = await project({
      ...coherentFixture(),
      [`${FEAT_DIR}/capabilities/refunds/spec.md`]: `# refunds — delta for FEAT-1

## ADDED Requirements

### Requirement: Refund within five days
Requirement-ID: REF-1
<<<<<<< HEAD
The fleet SHALL return the money in five days.
=======
The fleet SHALL return the money in three days.
>>>>>>> feature/faster

#### Scenario: It is kept
- **Given** a customer
- **When** they ask
- **Then** it is kept
`,
    });
    const found = await findings(p, "spec.merge-conflict", "--feature", "FEAT-1");
    expect(found).toHaveLength(1);
    expect(found[0]!.subject).toBe("refunds");
    // The label names the capability, not the living directory: the file to fix
    // is the feature's, and two documents share the name.
    expect(found[0]!.message).toContain("capability refunds: spec.md");
    expect((await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json")).code).toBe(1);
  });

  it("a LIVING capability requirement outside '## Requirements' blocks the merge", async () => {
    const p = await project({
      ...coherentFixture(),
      "capabilities/refunds/spec.md": `# Refunds

## Requirements

${requirement("REF-1", "Refund within five days")}
## Notes

${requirement("REF-9", "Something filed in the wrong section")}`,
      [SPLIT_SPEC]: realizing("refunds#REF-2"),
      [`${FEAT_DIR}/capabilities/refunds/spec.md`]: delta("ADDED Requirements", [
        requirement("REF-2", "Show the refund on the statement"),
      ]),
    });
    const before = await treeHashes(p.docsDir);
    const refused = await refusal(p);
    expect(refused.code).toBe("living-outside-requirements");
    // The rewrite replaces only the run inside `## Requirements` while
    // parseRequirements collects from every section, so the strayed one would
    // keep its authored copy in the prose AND land again in the run.
    expect(refused.issues.map((i) => i.subject)).toContain("refunds");
    expect((await runLoam(p.workDir, "archive", "FEAT-1", "--approve", "--json")).code).toBe(1);
    expect(await treeHashes(p.docsDir)).toEqual(before);
  });
});

/* ------------------------------------------------------------------ */
/* The `Realizes:` join, taken inside the feature that changes it       */
/* ------------------------------------------------------------------ */

/**
 * ONE JOIN, TWO DIRECTIONS, and each has its own way of going wrong silently.
 *
 * Forward: a feature ADDS a business promise and nothing in the same feature
 * keeps it. The document is legal and the merge is what is unsafe, so the grade
 * is a warning that GATES — the shape `scaffold.placeholder` already has, not
 * the shape `c4.uncovered` has (that one is a validate-only Finding and never
 * reaches the archive gate at all). `--approve` lands it.
 *
 * Removal: a feature RETIRES a promise something outside it still keeps. That
 * one archived at exit 0 until now, and the next `loam validate --all` failed
 * with `capability.realizes-unknown` against a service document nobody had
 * touched — an archive leaving the fleet red against an untouched file, which
 * is the class of damage this product exists to refuse. An ERROR, exactly as
 * `openapi.remove-op-consumed` is for the identical shape one axis over.
 */
describe("a promise this feature adds that nothing in it keeps", () => {
  /** A feature whose capability delta ADDs `refunds#REF-1`, and whatever else the case needs. */
  const adding = (extra: Record<string, string> = {}): Record<string, string> => ({
    ...coherentFixture(),
    [`${FEAT_DIR}/capabilities/refunds/spec.md`]: delta("ADDED Requirements", [
      requirement("REF-1", "Refund within five days"),
    ]),
    ...extra,
  });

  it("gates archive as a WARNING, writes nothing, and --approve lands it under overridden[]", async () => {
    const p = await project(adding());
    const before = await treeHashes(p.docsDir);
    const found = await findings(p, "capability.uncovered", "--feature", "FEAT-1");
    expect(found).toHaveLength(1);
    expect(found[0]!.subject).toBe("refunds");
    expect(found[0]!.gates).toBe(true);
    // A warning, NOT an error: `validate` grades the document valid, because
    // writing a promise ahead of the fleet is the recorded intended use. An
    // error here would fail the gate on every corpus written that way.
    expect(found[0]!.severity).toBe("warn");
    expect((await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json")).code).toBe(0);
    // The message names all three exits — the line to write, the flag, and the
    // flow route that only opens once the promise is living.
    expect(found[0]!.message).toContain("Realizes: refunds#REF-1");
    expect(found[0]!.message).toContain("--approve");
    // The third way on used to be "archive with --approve and tag the flow
    // afterwards, because a dynamic view has no feature-delta path". It has one
    // now, so the advice names the slot and the two tags to write.
    expect(found[0]!.message).toContain("features/<FEAT>/usecases/<name>.likec4");
    expect(found[0]!.message).toContain("#req-REF-1");

    const refused = await refusal(p);
    expect(refused.code).toBe("not-coherent");
    expect(refused.issues.map((i) => i.code)).toContain("capability.uncovered");
    expect(await treeHashes(p.docsDir)).toEqual(before);

    const approved = await runLoam(p.workDir, "archive", "FEAT-1", "--approve", "--json");
    expect(approved.code, approved.out).toBe(0);
    const payload = JSON.parse(approved.stdout);
    expect(payload.overridden.map((i: { code: string }) => i.code)).toContain("capability.uncovered");
    // And the promise it landed is exactly the one the fleet warning now
    // carries — the hand-off the message told the author to expect.
    const fleet = await runLoam(p.workDir, "validate", "--all", "--json");
    expect(fleet.stdout).toContain("capability.requirement-unrealized");
  });

  it("a `Realizes:` line on an ADDED service requirement in the same feature silences it", async () => {
    const p = await project(adding({ [SPLIT_SPEC]: realizing("refunds#REF-1") }));
    expect(await findings(p, "capability.uncovered", "--feature", "FEAT-1")).toEqual([]);
    expect((await runLoam(p.workDir, "archive", "FEAT-1", "--dry-run", "--json")).code).toBe(0);
  });

  it("naming the same capability but a DIFFERENT requirement does not silence it", async () => {
    // Both halves of the entry are the address. Matching on the capability
    // alone would let one realized promise vouch for every other promise the
    // same document makes.
    const p = await project(adding({ [SPLIT_SPEC]: realizing("refunds#REF-9") }));
    const found = await findings(p, "capability.uncovered", "--feature", "FEAT-1");
    expect(found).toHaveLength(1);
    // ...and the entry that resolves to nothing earns its own error beside it.
    expect(await findings(p, "capability.realizes-unknown", "--feature", "FEAT-1")).toHaveLength(1);
  });

  it("a `Realizes:` line on a BASE requirement in the delta does not silence it", async () => {
    // BASE means the requirement sits under no delta heading, so the merge
    // writes none of it — including the `Realizes:` line. A cover that never
    // lands is not a cover.
    const p = await project(
      adding({
        [SPLIT_SPEC]: `# payment-split-service — delta for FEAT-1

## Behavior

### Requirement: Something already true
Realizes: refunds#REF-1
The service SHALL keep doing what it does.

#### Scenario: It keeps doing it
- **Given** a service
- **When** time passes
- **Then** nothing changes
`,
      }),
    );
    expect(await findings(p, "capability.uncovered", "--feature", "FEAT-1")).toHaveLength(1);
  });

  it("MODIFYING a living capability requirement with no `Realizes:` anywhere is silent", async () => {
    // A MODIFIED changes a promise something living may already realize;
    // demanding a re-declaration would force an edit with nothing to change.
    const living = livingDoc([requirement("REF-1", "Refund within five days")]);
    const p = await project({
      ...coherentFixture(),
      "capabilities/refunds/spec.md": living,
      [`${FEAT_DIR}/capabilities/refunds/spec.md`]: delta("MODIFIED Requirements", [
        requirement("REF-1", "Refund within three days", `Based-On: ${pinFor(living, "Refund within five days")}\n`),
      ]),
    });
    expect(await findings(p, "capability.uncovered", "--feature", "FEAT-1")).toEqual([]);
    expect((await runLoam(p.workDir, "archive", "FEAT-1", "--dry-run", "--json")).code).toBe(0);
  });

  it("a requirement with no Requirement-ID earns ONE finding, not two", async () => {
    // `capability.requirement-unidentified` already gates it and there is
    // nothing for a `Realizes:` line to address, so a second finding would send
    // its reader to write a line that cannot be written yet.
    const p = await project({
      ...coherentFixture(),
      [`${FEAT_DIR}/capabilities/refunds/spec.md`]: `# refunds — delta for FEAT-1

## ADDED Requirements

### Requirement: Refund within five days
The fleet SHALL return a customer's money within five days.

#### Scenario: It is kept
- **Given** a customer
- **When** they ask
- **Then** it is kept
`,
    });
    expect(await findings(p, "capability.requirement-unidentified", "--feature", "FEAT-1")).toHaveLength(1);
    expect(await findings(p, "capability.uncovered", "--feature", "FEAT-1")).toEqual([]);
  });

  it("joins on the LAST separator, so a capability id carrying one still matches", () => {
    // A unit test, because the discriminating fixture is a capability
    // DIRECTORY named `pay#ments` and no tree should have to hold one. The
    // entry `pay#ments#REF-1` addresses capability `pay#ments`; split at the
    // FIRST separator it addresses `pay`, the cover stops matching, and the
    // feature is refused for a promise it demonstrably keeps.
    const promise = parseRequirements(delta("ADDED Requirements", [requirement("REF-1", "A promise")]));
    const cover = parseRequirements(`# svc — delta for FEAT-1

## ADDED Requirements

### Requirement: Keeps the promise
Realizes: pay#ments#REF-1
The service SHALL keep it.

#### Scenario: It is kept
- **Given** a customer
- **When** they ask
- **Then** it is kept
`);
    expect(
      uncoveredIssues(
        [{ id: "pay#ments", reqs: promise, living: [] }],
        [{ service: "svc", file: "spec.md", reqs: cover }],
        // The `Realizes:` half covers it, so the flow arm decides nothing here —
        // stated rather than defaulted, because the two arms say different
        // things in the message and a caller must pick one on purpose.
        { graded: true, kept: [] },
      ),
    ).toEqual([]);
  });

  it("a living `#req-` tagged flow does NOT silence it — the flow route opens later", async () => {
    // A feature-local flow DOES cover a promise now
    // (`test/usecase-feature-flow.test.ts`), and this is the other half of that
    // rule rather than a leftover from before it: only the feature's OWN flows
    // count. A living `dynamic view` in `architecture/` is claiming a promise
    // that is not merged yet — which is `usecase.requirement-unresolved` on
    // every `validate --all` until the archive lands — so letting it silence the
    // gate would let a broken living claim wave a merge through.
    const p = await project(
      adding({
        "architecture/landscape.likec4": LANDSCAPE.replace(
          "  element person\n",
          "  element person\n  tag cap-refunds\n  tag req-REF-1\n",
        ),
        "architecture/capabilities.yaml": "capabilities:\n  refunds: {}\n",
        "architecture/usecases/refunds.likec4": `views {
  dynamic view refundFlow {
    #cap-refunds
    #req-REF-1
    title 'A customer is refunded'
    checkoutWeb -> paymentService 'asks for the money back'
  }
}
`,
      }),
    );
    expect(await findings(p, "capability.uncovered", "--feature", "FEAT-1")).toHaveLength(1);
    expect((await runLoam(p.workDir, "archive", "FEAT-1", "--json")).code).toBe(1);
    // And the tag is ALREADY red, which is the whole reason the gate does not
    // look: it names a promise that is not living yet.
    expect((await runLoam(p.workDir, "validate", "--all", "--json")).stdout).toContain(
      "usecase.requirement-unresolved",
    );
  });
});

describe("a promise this feature retires that something else still keeps", () => {
  /** A living service spec whose requirement realizes `refunds#REF-1`. */
  const LIVING_REALIZER = `---
service: payment-service
status: verified
---

# payment-service

## Requirements

### Requirement: Authorize a payment
The service SHALL authorize a payment before capture.

Operations: authorizePayment
Realizes: refunds#REF-1

#### Scenario: Successful authorization
- **Given** a valid card
- **When** authorization is requested
- **Then** the payment is authorized
`;

  const living = (): string => livingDoc([requirement("REF-1", "Refund within five days")]);

  /**
   * A feature retiring `refunds#REF-1`, spelled BY HEADING — the commoner way,
   * and the one that only grades at all because the removal reads the living
   * document to learn which id the heading retires (`capability.requirement-unidentified`
   * exempts REMOVED, so a stable id here is optional).
   */
  const retiring = (extra: Record<string, string> = {}): Record<string, string> => ({
    ...coherentFixture(),
    "services/payment-service/spec.md": LIVING_REALIZER,
    "capabilities/refunds/spec.md": living(),
    [`${FEAT_DIR}/capabilities/refunds/spec.md`]: `# refunds — delta for FEAT-1

## REMOVED Requirements

### Requirement: Refund within five days
Based-On: ${pinFor(living(), "Refund within five days")}
`,
    ...extra,
  });

  it("is refused, writes nothing, and --approve leaves exactly the red the gate predicted", async () => {
    const p = await project(retiring());
    // The premise: the document that goes red is coherent BEFORE the merge.
    // Without it the red below could predate the feature.
    expect((await runLoam(p.workDir, "validate", "payment-service", "--json")).code).toBe(0);

    const before = await treeHashes(p.docsDir);
    const refused = await refusal(p);
    expect(refused.code).toBe("not-coherent");
    const broken = refused.issues.filter((i) => i.code === "capability.remove-requirement-realized");
    expect(broken).toHaveLength(1);
    expect(broken[0]!.subject).toBe("refunds");
    expect(await treeHashes(p.docsDir)).toEqual(before);

    // The message names the realizer by file and heading — the document a
    // reader has to open is not one this feature contains.
    const found = await findings(p, "capability.remove-requirement-realized", "--feature", "FEAT-1");
    expect(found[0]!.message).toContain("payment-service's living requirement 'Authorize a payment'");
    // An ERROR, not a warning that gates: unlike the forward direction there is
    // no reading under which the merge is legal, so `validate` refuses it too.
    expect(found[0]!.severity).toBe("error");
    expect((await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json")).code).toBe(1);

    // A judgement about the feature, so --approve breaks the join deliberately
    // — and the fleet is then red exactly where the refusal said it would be.
    const approved = await runLoam(p.workDir, "archive", "FEAT-1", "--approve", "--json");
    expect(approved.code, approved.out).toBe(0);
    expect(JSON.parse(approved.stdout).overridden.map((i: { code: string }) => i.code)).toContain(
      "capability.remove-requirement-realized",
    );
    const after = await runLoam(p.workDir, "validate", "payment-service", "--json");
    expect(after.code).toBe(1);
    expect(after.stdout).toContain("capability.realizes-unknown");
  });

  it("a MODIFIED that restates the realizer WITHOUT its `Realizes:` line is not a breach", async () => {
    const p = await project(
      retiring({
        [`${FEAT_DIR}/specs/payment-service/spec.md`]: `# payment-service — delta for FEAT-1

## MODIFIED Requirements

### Requirement: Authorize a payment
Based-On: ${pinFor(LIVING_REALIZER, "Authorize a payment")}
The service SHALL authorize a payment before capture.

Operations: authorizePayment

#### Scenario: Successful authorization
- **Given** a valid card
- **When** authorization is requested
- **Then** the payment is authorized
`,
      }),
    );
    // A MODIFIED carries its FULL new text, so dropping the line from it IS how
    // an author retires the join. Graded against the LIVING corpus alone this
    // would refuse the very change that fixes it.
    const res = await runLoam(p.workDir, "archive", "FEAT-1", "--dry-run", "--json");
    expect(res.code, res.out).toBe(0);
    expect(res.stdout).not.toContain("capability.remove-requirement-realized");
  });

  it("a MODIFIED that KEEPS the `Realizes:` line is still a breach", async () => {
    const p = await project(
      retiring({
        [`${FEAT_DIR}/specs/payment-service/spec.md`]: `# payment-service — delta for FEAT-1

## MODIFIED Requirements

### Requirement: Authorize a payment
Based-On: ${pinFor(LIVING_REALIZER, "Authorize a payment")}
The service SHALL authorize a payment before capture, twice.

Operations: authorizePayment
Realizes: refunds#REF-1

#### Scenario: Successful authorization
- **Given** a valid card
- **When** authorization is requested
- **Then** the payment is authorized
`,
      }),
    );
    // Supersession is not exoneration: what the merge writes is what counts, and
    // this delta writes the pointer back.
    const found = await findings(p, "capability.remove-requirement-realized", "--feature", "FEAT-1");
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain("this feature's payment-service delta requirement");
  });

  it("a delta that touches the same document but NOT the realizer is no exoneration", async () => {
    // Supersession is per REQUIREMENT, never per document. Asking only "does
    // this feature have a delta for that service" exonerates every requirement
    // in a file the feature merely adds to — which is the commonest delta there
    // is, and would silently switch the whole check off for it.
    const p = await project(
      retiring({
        [`${FEAT_DIR}/specs/payment-service/spec.md`]: `# payment-service — delta for FEAT-1

## ADDED Requirements

### Requirement: Log every authorization
The service SHALL write an audit line for each authorization.

#### Scenario: An authorization is logged
- **Given** an authorization
- **When** it completes
- **Then** an audit line exists
`,
      }),
    );
    const found = await findings(p, "capability.remove-requirement-realized", "--feature", "FEAT-1");
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain("payment-service's living requirement 'Authorize a payment'");
  });

  it("REMOVING the realizing service requirement in the same feature is not a breach", async () => {
    const p = await project(
      retiring({
        [`${FEAT_DIR}/specs/payment-service/spec.md`]: `# payment-service — delta for FEAT-1

## REMOVED Requirements

### Requirement: Authorize a payment
Based-On: ${pinFor(LIVING_REALIZER, "Authorize a payment")}
`,
      }),
    );
    expect(await findings(p, "capability.remove-requirement-realized", "--feature", "FEAT-1")).toEqual([]);
  });

  it("an arch.spec.md realizer counts too — both requirement documents carry the line", async () => {
    const p = await project({
      ...retiring(),
      // The living spec.md loses its `Realizes:` line; the arch document one
      // directory over keeps it. Scanning only spec.md would call this clean.
      "services/payment-service/spec.md": LIVING_REALIZER.replace("Realizes: refunds#REF-1\n", ""),
      "services/payment-service/arch.spec.md": `# payment-service — architecture requirements

## Requirements

### Requirement: Hold the refund ledger
The service SHALL keep a durable refund ledger.

Realizes: refunds#REF-1

#### Scenario: A ledger entry survives a restart
- **Given** a written entry
- **When** the service restarts
- **Then** the entry is still there
`,
    });
    const found = await findings(p, "capability.remove-requirement-realized", "--feature", "FEAT-1");
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain("payment-service (arch.spec.md)'s living requirement");
  });

  it("a REMOVED that selects nothing living earns delta.removed-unknown and nothing else", async () => {
    const p = await project({
      ...coherentFixture(),
      "services/payment-service/spec.md": LIVING_REALIZER,
      "capabilities/refunds/spec.md": living(),
      [`${FEAT_DIR}/capabilities/refunds/spec.md`]: `# refunds — delta for FEAT-1

## REMOVED Requirements

### Requirement: A promise nobody ever wrote
`,
    });
    expect(await findings(p, "delta.removed-unknown", "--feature", "FEAT-1")).toHaveLength(1);
    expect(await findings(p, "capability.remove-requirement-realized", "--feature", "FEAT-1")).toEqual([]);
  });

  it("a feature that retires nothing never reads the living fleet's requirements", async () => {
    // The scan is every service's spec.md and arch.spec.md. It exists for one
    // question, and a feature that asks it of nobody must not pay for it — the
    // rule `openapi.remove-op-consumed` follows for the identical scan.
    const p = await project({
      ...coherentFixture(),
      // Present, so the assertion is about a file that could be read rather
      // than one that does not exist.
      "services/payment-service/arch.spec.md": `# payment-service — architecture requirements

## Requirements

### Requirement: Hold the refund ledger
The service SHALL keep a durable refund ledger.

#### Scenario: A ledger entry survives a restart
- **Given** a written entry
- **When** the service restarts
- **Then** the entry is still there
`,
      [SPLIT_SPEC]: realizing("refunds#REF-1"),
      [`${FEAT_DIR}/capabilities/refunds/spec.md`]: delta("ADDED Requirements", [
        requirement("REF-1", "Refund within five days"),
      ]),
    });
    const read: string[] = [];
    class Recording extends FleetContext {
      override readRequirements(path: string): Promise<Requirement[]> {
        read.push(path.split(/[\\/]/).join("/"));
        return super.readRequirements(path);
      }
    }
    const featureDir = featureDirOf(join(p.docsDir, FEAT_DIR));
    await featureCoherence({ docsDir: p.docsDir, featureDir, featureId: "FEAT-1", context: new Recording() });
    expect(read.filter((path) => path.endsWith("services/payment-service/arch.spec.md"))).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* The authoring round trip: new -> author -> archive -> unarchive      */
/* ------------------------------------------------------------------ */

/**
 * `loam new --capability` is the front door of this axis, and until it existed
 * every fixture in this file was hand-built — which proves the merge and proves
 * nothing about the path an analyst actually walks.
 *
 * The round trip below is one test and it is worth more than the rest of this
 * block: it starts from the command, writes a real promise into the scaffold
 * the command produced, archives it into a LIVING capability document, and
 * takes it back byte for byte. Every link is one somebody could break without
 * any other test noticing — the scaffold path, the walk that finds it, the
 * grade before the merge, the merge itself, and the snapshot that undoes it.
 *
 * NESTED, for the reason this file's banner states: a flat id cannot tell a
 * correct resolution from one taken by the leaf.
 */
describe("loam new --capability, authored and shipped", () => {
  /** The example block as an author copies it: out of the HTML comment, unindented. */
  function copiedOut(scaffold: string): string {
    const start = scaffold.indexOf("    ## ADDED Requirements");
    const end = scaffold.indexOf("\n-->");
    expect(start, "the scaffold must carry its example block").toBeGreaterThan(-1);
    return scaffold
      .slice(start, end)
      .split("\n")
      .map((l) => l.replace(/^ {4}/, ""))
      .join("\n");
  }

  it("scaffolds, archives into the living tree and unarchives byte-identically", async () => {
    const p = await project(coherentFixture());
    const scaffolded = await runLoam(
      p.workDir, "new", "FEAT-9", "--capability", "payments/refunds", "--touches", "payment-service",
    );
    expect(scaffolded.code, scaffolded.out).toBe(0);
    expect(p.exists("features/FEAT-9/capabilities/payments/refunds/spec.md")).toBe(true);

    // Authoring, over the scaffold the command wrote: the promise, the service
    // requirement that keeps it, and a Why. Nothing here is a fixture written
    // beside the command — every path came out of `loam new`.
    await p.write(
      "features/FEAT-9/capabilities/payments/refunds/spec.md",
      delta("ADDED Requirements", [requirement("REF-1", "Refund within five days")]).replace(
        "# refunds — delta for FEAT-1",
        "# payments/refunds — capability delta for FEAT-9",
      ),
    );
    await p.write(
      "features/FEAT-9/specs/payment-service/spec.md",
      `# payment-service — requirement delta for FEAT-9

## ADDED Requirements

### Requirement: Issue the refund
Realizes: payments/refunds#REF-1

The service SHALL issue a refund to the original card.

#### Scenario: A refund is issued
- **Given** a captured payment
- **When** a refund is requested
- **Then** the money returns to the card
`,
    );
    await p.write(
      "features/FEAT-9/intent.md",
      "---\nfeature: FEAT-9\nstatus: proposed\n---\n\n# Refunds\n\n## Why\n\nCustomers must be able to get their money back.\n",
    );
    expect((await runLoam(p.workDir, "validate", "--feature", "FEAT-9", "--json")).code).toBe(0);
    const before = await treeHashes(p.docsDir);

    const archived = await runLoam(p.workDir, "archive", "FEAT-9", "--json");
    expect(archived.code, archived.out).toBe(0);
    // The living document the scaffold's id addresses, at its nested path —
    // and the promise inside it, addressable by the id the `Realizes:` line
    // names. Resolved by the leaf this would be `capabilities/refunds/`.
    expect(p.exists("capabilities/payments/refunds/spec.md")).toBe(true);
    expect(p.exists("capabilities/refunds")).toBe(false);
    const living = parseRequirements(await p.read("capabilities/payments/refunds/spec.md"));
    expect(living.map((r) => [r.id, r.kind])).toEqual([["REF-1", "BASE"]]);
    // And the fleet now answers the question the whole axis exists for.
    const rollup = JSON.parse((await runLoam(p.workDir, "list", "capabilities", "--json")).stdout);
    const row = (rollup.capabilities as Array<{ id: string; services: string[] }>).find(
      (c) => c.id === "payments/refunds",
    );
    expect(row?.services).toEqual(["payment-service"]);

    const restored = await runLoam(p.workDir, "unarchive", "FEAT-9", "--json");
    expect(restored.code, restored.out).toBe(0);
    expect(JSON.parse(restored.stdout).removed).toContain("capabilities/payments/refunds/spec.md");
    expect(await treeHashes(p.docsDir)).toEqual(before);
  });

  it("the copied-out block, left unedited, is refused by scaffold.placeholder", async () => {
    // The gate this template was written to be caught by. Without it the
    // scaffold's own words reach a LIVING capability document — worse than the
    // service case the gate was built for, because a capability document
    // outlives every service that realizes it and a `Realizes:` line pointed at
    // the placeholder's id is a join to a promise nobody wrote.
    const p = await project(coherentFixture());
    expect((await runLoam(p.workDir, "new", "FEAT-9", "--capability", "refunds")).code).toBe(0);
    const scaffold = await p.read("features/FEAT-9/capabilities/refunds/spec.md");
    await p.write(
      "features/FEAT-9/capabilities/refunds/spec.md",
      `# refunds — capability delta for FEAT-9\n\n${copiedOut(scaffold)}\n`,
    );
    await p.write(
      "features/FEAT-9/intent.md",
      "---\nfeature: FEAT-9\nstatus: proposed\n---\n\n# Refunds\n\n## Why\n\nMoney back.\n",
    );
    const before = await treeHashes(p.docsDir);

    const refused = await runLoam(p.workDir, "archive", "FEAT-9", "--json");
    expect(refused.code).toBe(1);
    const payload = JSON.parse(refused.stdout + refused.stderr) as {
      error: { code: string };
      issues: Array<{ code: string; subject?: string; gates: boolean; message: string }>;
    };
    expect(payload.error.code).toBe("not-coherent");
    const placeholder = payload.issues.find(
      (i) => i.code === "scaffold.placeholder" && i.subject === "refunds",
    );
    expect(placeholder, JSON.stringify(payload.issues)).toBeDefined();
    expect(placeholder!.gates).toBe(true);
    expect(placeholder!.message).toContain("TODO — name the promise");
    // A warning that GATES: the document is legal, the MERGE is what is unsafe.
    expect((await runLoam(p.workDir, "validate", "--feature", "FEAT-9", "--json")).code).toBe(0);
    // And nothing landed.
    expect(await treeHashes(p.docsDir)).toEqual(before);
    expect(p.exists("capabilities")).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* The half-created directory, on the FEATURE side                      */
/* ------------------------------------------------------------------ */

/**
 * `capability.doc-missing` used to run over the LIVING tree only, so the same
 * `mkdir` mistake inside `features/<FEAT>/capabilities/` earned nothing at all.
 *
 * It is the quieter of the two. An empty directory is not a delta: the walk
 * finds no document, so the delta algebra grades nothing, the merge carries
 * nothing and `loam show` lists nothing — the author's business change ships as
 * zero, at exit 0, with every command agreeing that all is well.
 *
 * THE DISCRIMINATOR IS THE GROUP DIRECTORY. `payments/` holding only
 * `payments/refunds/spec.md` is a legal and ordinary shape — nesting is spelled
 * by the tree — and a check that warned about it would fire on every nested
 * capability in the fleet. That case is the second test here, and it is the one
 * a naive "directory without a spec.md" implementation fails.
 */
describe("a half-created capability directory inside a feature", () => {
  /** Every `capability.doc-missing` a `validate --feature` run reports. */
  const docMissing = (p: Project): Promise<Array<{ severity: string; subject?: string; message: string }>> =>
    findings(p, "capability.doc-missing", "--feature", "FEAT-1");

  it("earns the warning, with the path a reader can actually open", async () => {
    const p = await project({
      ...coherentFixture(),
      // A directory and nothing under it. `makeProject` writes files, so the
      // empty directory is spelled as its own `.gitkeep` — which is exactly what
      // a half-finished `mkdir` plus a commit leaves behind, and the walk skips
      // dotfiles so it stays a directory holding no document.
      [`${FEAT_DIR}/capabilities/half-made/.gitkeep`]: "",
    });
    const found = await docMissing(p);
    expect(found).toHaveLength(1);
    expect(found[0]!.severity).toBe("warn");
    // The DIRECTORY name, not the feature id: `features/FEAT-1/…` is a path
    // nobody can open on this tree.
    expect(found[0]!.subject).toBe(`${FEAT_DIR}/capabilities/half-made`);
    expect(found[0]!.message).toContain(`${FEAT_DIR}/capabilities/half-made/spec.md`);
    expect(found[0]!.message).toContain("ADDED Requirements");
    // A warning, so the run still passes: a half-finished authoring step must
    // not fail somebody else's validate on the same tree.
    expect((await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json")).code).toBe(0);
  });

  it("says nothing about a GROUP directory that holds a capability beneath it", async () => {
    const p = await project({
      ...coherentFixture(),
      [`${FEAT_DIR}/capabilities/payments/refunds/spec.md`]: delta("ADDED Requirements", [
        requirement("REF-1", "Refund within five days"),
      ]),
      [SPLIT_SPEC]: realizing("payments/refunds#REF-1"),
    });
    // `payments/` holds no spec.md and is not a defect: it is the nesting the
    // tree spells. A check that could not tell a group from a half-made
    // capability would warn once per nested capability in every fleet.
    expect(await docMissing(p)).toEqual([]);
  });

  it("stays silent for a feature with no capabilities/ directory at all", async () => {
    const p = await project(coherentFixture());
    expect(await docMissing(p)).toEqual([]);
  });
});

describe("a fleet that has not adopted the business axis pays nothing and sees nothing", () => {
  it("no capability.* finding, no refusal, and every command still exits 0", async () => {
    const p = await project(coherentFixture());
    expect(p.exists("capabilities")).toBe(false);
    expect(p.exists("architecture/capabilities.yaml")).toBe(false);

    for (const args of [
      ["validate", "--all"],
      ["validate", "--feature", "FEAT-1"],
      ["status"],
      ["list", "capabilities"],
      ["rebase", "FEAT-1", "--dry-run"],
      ["archive", "FEAT-1", "--dry-run"],
    ]) {
      const res = await runLoam(p.workDir, ...args, "--json");
      expect(res.code, `${args.join(" ")}: ${res.out}`).toBe(0);
      expect(res.stdout, args.join(" ")).not.toContain("capability.");
    }
  });

  it("a capability-only feature never scans the fleet for claims it cannot match", async () => {
    // The in-flight claim index holds SERVICE claims only, so a capability
    // scope's question is `undefined` by construction. Asking it anyway costs a
    // `listFeatures` walk plus a parse of every OTHER active feature's every
    // delta document — paid, on this fixture, to learn nothing. The assertion
    // is on what was READ rather than on a count, because a count moves for
    // reasons that have nothing to do with this rule.
    const p = await project({
      ...coherentFixture(),
      "features/FEAT-2-promise/intent.md":
        "---\nfeature: FEAT-2\nstatus: proposed\n---\n\n# Promise a refund\n\nCustomers must be able to get their money back.\n",
      "features/FEAT-2-promise/capabilities/refunds/spec.md": `# refunds — delta for FEAT-2

## MODIFIED Requirements

${requirement("REF-1", "Refund within five days")}`,
    });
    const read: string[] = [];
    class Recording extends FleetContext {
      override readRequirements(path: string): Promise<Requirement[]> {
        read.push(path.split(/[\\/]/).join("/"));
        return super.readRequirements(path);
      }
    }
    const featureDir = featureDirOf(join(p.docsDir, "features/FEAT-2-promise"));
    await featureCoherence({ docsDir: p.docsDir, featureDir, featureId: "FEAT-2", context: new Recording() });
    // Its own delta, and nothing belonging to the other feature in flight.
    expect(read.some((path) => path.endsWith("features/FEAT-2-promise/capabilities/refunds/spec.md"))).toBe(true);
    expect(read.filter((path) => path.includes("FEAT-1-split"))).toEqual([]);
  });

  it("the walk short-circuits on the absent directory, and the memo runs it once", async () => {
    const p = await project(coherentFixture());
    const featureDir = featureDirOf(join(p.docsDir, FEAT_DIR));

    // `present: false` and no throw. An unconditional readdir of a directory
    // that is not there raises ENOENT, so this resolving at all is the
    // short-circuit's proof.
    const tree = await featureCapabilityDeltas(featureDir);
    expect(tree).toEqual({ present: false, docs: [], undocumented: [] });

    // Two readers ask for this in one coherence run — the delta-shape walk and
    // the capability overlay — and the memo is what keeps that one walk.
    const fleet = new FleetContext();
    await featureCoherence({ docsDir: p.docsDir, featureDir, featureId: "FEAT-1", context: fleet });
    expect(fleet.stats().featureCapabilityWalks).toBe(1);
  });
});
