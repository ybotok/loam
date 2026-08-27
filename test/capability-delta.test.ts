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
import { featureCoherence } from "../src/core/coherence/coherence.js";
import { parseRequirements } from "../src/core/document/parse.js";
import { type Requirement } from "../src/core/document/spec.js";
import { FleetContext } from "../src/core/fleet-context.js";
import { featureDirOf } from "../src/core/kernel/ids/dirs.js";
import { coherentFixture, makeProject, pinFor, runLoam, treeHashes, type Project } from "./helpers/harness.js";

const FEAT_DIR = "features/FEAT-1-split";

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

/** Every finding of one code, from a `--json` validate run. */
async function findings(
  p: Project,
  code: string,
  ...args: string[]
): Promise<Array<{ subject?: string; message: string; gates?: boolean }>> {
  const res = await runLoam(p.workDir, "validate", ...args, "--json");
  const doc = JSON.parse(res.stdout);
  const targets: Array<{ findings: Array<{ code: string; subject?: string; message: string; gates?: boolean }> }> =
    doc.targets ?? [];
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
