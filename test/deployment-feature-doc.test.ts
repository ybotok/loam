/**
 * A feature can bring TOPOLOGY — `features/<FEAT>/deployment/<name>.likec4`,
 * end to end.
 *
 * A `deployment { }` block is refused inside `delta.likec4` and always will be:
 * that document re-declares the landscape's own identifiers and carries its own
 * `specification`, so it cannot be staged beside the map in one LikeC4 project.
 * Until this slot existed the consequence was that a change standing up a
 * standby cluster had to be written in two places at once — the requirement in
 * the feature, the topology edited straight into `architecture/` — which is the
 * two-pull-request shape the use-case axis had already been through once.
 *
 * Three properties, each failing against a different wrong implementation:
 *
 * THE DOCUMENT SHIPS AND UNSHIPS WITH THE FEATURE, byte for byte. The merge is
 * a whole-file copy into `architecture/`, and undoing it is a delete the
 * snapshot manifest already records — no unarchive code of its own.
 *
 * `extend` REACHES THE LIVING MAP. This is the property the whole slot rests on
 * and the one that was measured before any of it was written: a feature adds a
 * datacenter INSIDE a region the living document declares, from a file of its
 * own, and the merged project resolves. If it did not, the slot would only ever
 * be able to introduce topology disconnected from what the fleet already runs.
 *
 * THE COLLISION IS ON THE FILE, NEVER ON WHAT IS INSIDE IT. A feature whose
 * document names a file the living tree holds is refused before anything is
 * written, and `--approve` does not reach it. But two features extending ONE
 * living region from two documents of their own both archive — refusing that
 * would make the slot useless for the fleet-wide change it exists for.
 */
import { afterEach, describe, expect, it } from "vitest";
import { makeProject, runLoam, SERVICE_MODEL, treeHashes, type Project } from "./helpers/harness.js";

const FEAT = "FEAT-1";
const FEAT_DIR = "features/FEAT-1-split";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

/**
 * The living map, with the deployment kinds declared in it.
 *
 * The kinds have to be HERE rather than in the topology document, because
 * `architecture/` is one LikeC4 project and a second `specification` block is a
 * duplicate error blamed on both files — the same constraint the use-case slot
 * lives under, and the reason both slots hold documents that declare no
 * specification of their own.
 */
const LANDSCAPE = `specification {
  element softwareSystem
  deploymentNode region
  deploymentNode datacenter
  deploymentNode cluster
  tag FEAT-1
}

model {
  paymentService = softwareSystem 'payment-service' {
    metadata { service 'payment-service' }
  }
}

views {
  view landscape {
    include *
  }
}
`;

/** The living topology: one region with one datacenter in it. */
const LIVING_DEPLOYMENT = `deployment {
  eu = region 'EU' {
    dcA = datacenter 'DC-A' {
      k8sA = cluster 'cluster-a' {
        instanceOf paymentService
      }
    }
  }
}
`;

/** What a feature brings: a second datacenter INSIDE the living region. */
const STANDBY = `deployment {
  extend eu {
    dcB = datacenter 'DC-B' {
      k8sB = cluster 'cluster-b' {
        instanceOf paymentService
      }
    }
  }
  eu.dcA.k8sA -> eu.dcB.k8sB 'Replicates asynchronously'
}
`;

function spec(service: string): string {
  return `---\nservice: ${service}\nstatus: draft\nowner: x\n---\n\n# ${service}\n`;
}

function fleet(files: Record<string, string>): Record<string, string> {
  return {
    "architecture/landscape.likec4": LANDSCAPE,
    "architecture/deployment.likec4": LIVING_DEPLOYMENT,
    "services/payment-service/spec.md": spec("payment-service"),
    // The service needs its own model, or every run here carries
    // `service.no-model` and the exit-code assertions below would say nothing
    // about topology at all.
    "services/payment-service/model.likec4": SERVICE_MODEL,
    [`${FEAT_DIR}/intent.md`]: `---\nfeature: ${FEAT}\nstatus: proposed\n---\n\n# Standby cluster\n\nStand a standby cluster up in a second datacenter.\n`,
    ...files,
  };
}

async function project(files: Record<string, string>): Promise<Project> {
  const p = await makeProject(fleet(files), { service: "payment-service" });
  cleanups.push(() => p.destroy());
  return p;
}

interface Refusal {
  ok: boolean;
  error?: { code: string; message: string };
  issues?: Array<{ code: string; message: string; overridable?: boolean }>;
}

function issuesOf(stdout: string, code: string): Array<{ code: string; message: string; overridable?: boolean }> {
  const payload = JSON.parse(stdout) as Refusal;
  return (payload.issues ?? []).filter((i) => i.code === code);
}

describe("a feature brings topology", () => {
  it("archives it into architecture/ and unarchives byte-identically", async () => {
    const p = await project({ [`${FEAT_DIR}/deployment/standby.likec4`]: STANDBY });
    const before = await treeHashes(p.docsDir);

    const archived = await runLoam(p.workDir, "archive", FEAT, "--json");
    expect(archived.code, archived.out).toBe(0);
    expect(p.exists("architecture/standby.likec4")).toBe(true);
    expect(await p.read("architecture/standby.likec4")).toBe(STANDBY);

    const restored = await runLoam(p.workDir, "unarchive", FEAT, "--json");
    expect(restored.code, restored.out).toBe(0);
    // The merge CREATED the file, so undoing it is a delete — the snapshot
    // manifest's own rule, with no unarchive code of its own.
    expect(p.exists("architecture/standby.likec4")).toBe(false);
    expect(await treeHashes(p.docsDir)).toEqual(before);
  });

  it("extends a region the LIVING document declares, and the merged project resolves", async () => {
    // The measurement the whole slot rests on. Without cross-document `extend`
    // the merge would be a splice into the living file, which is the thing this
    // design refuses to be.
    const p = await project({ [`${FEAT_DIR}/deployment/standby.likec4`]: STANDBY });
    expect((await runLoam(p.workDir, "archive", FEAT, "--json")).code).toBe(0);

    const validated = await runLoam(p.workDir, "validate", "--all", "--json");
    expect(validated.code, validated.out).toBe(0);
    const payload = JSON.parse(validated.stdout) as { targets: Array<{ findings: Array<{ code: string }> }> };
    const codes = payload.targets.flatMap((t) => t.findings.map((f) => f.code));
    // The proof the extension LANDED rather than merely parsed: a document
    // whose `extend eu` did not resolve makes the whole project unreadable, and
    // that is the code the landscape target reports.
    expect(codes).not.toContain("landscape.invalid");
  });

  it("refuses a document the living architecture/ already holds, and --approve does not move it", async () => {
    const p = await project({ [`${FEAT_DIR}/deployment/deployment.likec4`]: STANDBY });
    const before = await treeHashes(p.docsDir);

    const refused = await runLoam(p.workDir, "archive", FEAT, "--json");
    expect(refused.code, refused.out).toBe(1);
    const found = issuesOf(refused.stdout, "deployment.doc-exists");
    expect(found.length, refused.stdout).toBe(1);
    expect(found[0]!.overridable).toBe(false);
    // The fix is spelled two ways, because there are two intents behind the
    // collision: replace the living file (edit it directly), or add to what it
    // declares (rename and `extend`).
    expect(found[0]!.message).toContain("extend");
    expect(await treeHashes(p.docsDir), "a refusal must write nothing").toEqual(before);

    const approved = await runLoam(p.workDir, "archive", FEAT, "--approve", "--json");
    expect(approved.code, approved.out).toBe(1);
    expect(await treeHashes(p.docsDir)).toEqual(before);
  });

  it("a deployment block inside delta.likec4 is still refused, and the message names the slot", async () => {
    // The refusal is mechanical and permanent. What changed is where it sends
    // the author: at the living landscape, a feature introducing topology with
    // the change that makes it true had nowhere to put it.
    // The delta has to PARSE standalone to reach the merge's refusal at all —
    // LikeC4 reads it as its own project — so it declares its own kinds and
    // instances its own element. A delta that merely fails to parse is
    // `delta.invalid` and says nothing about this rule.
    const p = await project({
      [`${FEAT_DIR}/delta.likec4`]: `specification {\n  element softwareSystem\n  deploymentNode region\n  tag FEAT-1\n}\n\nmodel {\n  ghost = softwareSystem 'ghost' {\n    #FEAT-1\n    metadata { service 'ghost' }\n  }\n}\n\ndeployment {\n  dr = region 'DR' {\n    instanceOf ghost\n  }\n}\n`,
      [`${FEAT_DIR}/specs/ghost/spec.md`]: `# ghost — delta for ${FEAT}\n\n## ADDED Requirements\n\n### Requirement: Exist\nThe service SHALL exist.\n\n#### Scenario: It exists\n- **Given** nothing\n- **When** asked\n- **Then** it exists\n`,
    });
    const before = await treeHashes(p.docsDir);
    const refused = await runLoam(p.workDir, "archive", FEAT, "--json");
    expect(refused.code, refused.out).toBe(1);
    expect(refused.stdout).toContain("features/<FEAT>/deployment/<name>.likec4");
    expect(await treeHashes(p.docsDir)).toEqual(before);
  });

  it("instances an element only this feature's delta adds — the post-merge map is the corpus", async () => {
    // The case this axis needs the merge preview for, and it is the ordinary
    // one: a feature that stands a NEW service up in a cluster declares the
    // service in `delta.likec4` and instances it here, so the element the
    // topology names exists only after the merge. Read against the LIVING
    // landscape it is unresolved, LikeC4 refuses the whole project, and the
    // archive would refuse a document whose only fault is arriving with the
    // change that makes it true.
    const p = await project({
      [`${FEAT_DIR}/delta.likec4`]: `specification {\n  element softwareSystem\n  tag FEAT-1\n}\n\nmodel {\n  splitService = softwareSystem 'payment-split-service' {\n    #FEAT-1\n    metadata { service 'payment-split-service' }\n  }\n}\n`,
      [`${FEAT_DIR}/specs/payment-split-service/spec.md`]: `# payment-split-service — delta for ${FEAT}\n\n## ADDED Requirements\n\n### Requirement: Split a payment\nThe service SHALL split a payment.\n\n#### Scenario: Two payees\n- **Given** a payment\n- **When** it is split\n- **Then** two shares are recorded\n`,
      [`${FEAT_DIR}/deployment/standby.likec4`]: `deployment {\n  extend eu {\n    dcB = datacenter 'DC-B' {\n      k8sB = cluster 'cluster-b' {\n        instanceOf splitService\n      }\n    }\n  }\n}\n`,
    });
    const archived = await runLoam(p.workDir, "archive", FEAT, "--json");
    expect(archived.code, archived.out).toBe(0);
    expect(p.exists("architecture/standby.likec4")).toBe(true);
    // And the merged tree really does hold together — the proof the preview was
    // the same map the merge wrote, rather than a second opinion beside it.
    // Asserted on the PROJECT's own verdict rather than the exit code: the
    // feature introduces a service, so the merged fleet legitimately carries
    // `service.no-model` until somebody runs `loam adopt` for it, and that is a
    // different axis saying a true thing.
    const validated = await runLoam(p.workDir, "validate", "--all", "--json");
    const payload = JSON.parse(validated.stdout) as { targets: Array<{ findings: Array<{ code: string }> }> };
    expect(payload.targets.flatMap((t) => t.findings.map((f) => f.code))).not.toContain("landscape.invalid");
  });

  it("refuses a document naming an element the merge does not land, and --approve does not move it", async () => {
    const p = await project({
      [`${FEAT_DIR}/deployment/standby.likec4`]: `deployment {\n  extend eu {\n    dcB = datacenter 'DC-B' {\n      k8sB = cluster 'cluster-b' {\n        instanceOf ghostService\n      }\n    }\n  }\n}\n`,
    });
    const before = await treeHashes(p.docsDir);

    const refused = await runLoam(p.workDir, "archive", FEAT, "--json");
    expect(refused.code, refused.out).toBe(1);
    const found = issuesOf(refused.stdout, "deployment.doc-invalid");
    expect(found.length, refused.stdout).toBe(1);
    expect(found[0]!.overridable).toBe(false);
    // The message names the AUTHORED file, never the temp tree the staging
    // parsed in — a finding naming a directory that no longer exists is one
    // nobody can act on.
    expect(found[0]!.message).toContain("standby.likec4");
    expect(found[0]!.message).not.toContain("loam-staged-");
    expect(await treeHashes(p.docsDir), "a refusal must write nothing").toEqual(before);

    const approved = await runLoam(p.workDir, "archive", FEAT, "--approve", "--json");
    expect(approved.code, approved.out).toBe(1);
    expect(await treeHashes(p.docsDir)).toEqual(before);
  });

  it("refuses a name loam owns inside architecture/, whether or not the target exists", async () => {
    // The merge writes STRAIGHT into `architecture/` — unlike a flow, which
    // lands under `usecases/` — so the document's name is free to collide with
    // what loam owns there, and two of the three fail silently: nothing parses
    // `subsystems.likec4` and `loam subsystem sync` overwrites it wholesale, so
    // topology copied there is gone and invisible in the same breath. Neither
    // target exists in this fixture, which is the case `deployment.doc-exists`
    // cannot see.
    const p = await project({
      [`${FEAT_DIR}/deployment/subsystems.likec4`]: STANDBY,
      [`${FEAT_DIR}/deployment/usecases/nested.likec4`]: STANDBY,
    });
    expect(p.exists("architecture/subsystems.likec4")).toBe(false);
    const before = await treeHashes(p.docsDir);

    const refused = await runLoam(p.workDir, "archive", FEAT, "--json");
    expect(refused.code, refused.out).toBe(1);
    const found = issuesOf(refused.stdout, "deployment.doc-reserved");
    expect(found.map((i) => i.message.includes("subsystems.likec4"))).toContain(true);
    expect(found).toHaveLength(2);
    expect(found.every((i) => i.overridable === false)).toBe(true);
    expect(await treeHashes(p.docsDir)).toEqual(before);

    const approved = await runLoam(p.workDir, "archive", FEAT, "--approve", "--json");
    expect(approved.code, approved.out).toBe(1);
    expect(await treeHashes(p.docsDir)).toEqual(before);
  });

  it("the refusal headline names what actually refused, not element bindings", async () => {
    // It said "N element binding(s) name an illegal service id" for every code
    // in the never-overridable register, and had done since the use-case slot
    // put a second one there — about features that bind nothing. A headline
    // describing the wrong breach sends its reader to the wrong file first.
    const p = await project({ [`${FEAT_DIR}/deployment/subsystems.likec4`]: STANDBY });
    const refused = await runLoam(p.workDir, "archive", FEAT);
    expect(refused.code).toBe(1);
    expect(refused.out).not.toContain("element binding(s) name an illegal service id");
    expect(refused.out).toContain("deployment.doc-reserved");
  });

  it("refuses a document instancing an element the merge routes into a service's own model", async () => {
    // The same preview the use-case slot rests on, and the same fail-open. The
    // merge routes an addition NESTED inside a service into that service's
    // extending `model.likec4`, so `paymentService.cache` is never on the map —
    // and a topology document lands in `architecture/`, where the models are
    // not read. Previewed without the fleet's models the element sat on the map,
    // this parsed, and the archive copied a document into `architecture/` that
    // resolves against nothing (verification 2026-09-04, review F8).
    const p = await project({
      // EXTENDING, unlike the fixture's default `SERVICE_MODEL`: no
      // `specification` block, so the map owns the kinds and this file owns the
      // interior. That one difference is what routes the delta's addition.
      "services/payment-service/model.likec4": `model {\n  extend paymentService {\n    api = softwareSystem 'api'\n  }\n}\n`,
      [`${FEAT_DIR}/delta.likec4`]: `specification {\n  element softwareSystem\n  tag FEAT-1\n}\n\nmodel {\n  paymentService = softwareSystem 'payment-service' {\n    cache = softwareSystem 'Payment cache' {\n      #FEAT-1\n    }\n  }\n}\n`,
      [`${FEAT_DIR}/deployment/standby.likec4`]: `deployment {\n  extend eu {\n    dcB = datacenter 'DC-B' {\n      k8sB = cluster 'cluster-b' {\n        instanceOf paymentService.cache\n      }\n    }\n  }\n}\n`,
    });
    const before = await treeHashes(p.docsDir);

    const refused = await runLoam(p.workDir, "archive", FEAT, "--approve", "--json");
    expect(refused.code, refused.out).toBe(1);
    const found = issuesOf(refused.stdout, "deployment.doc-invalid");
    expect(found.length, refused.stdout).toBe(1);
    expect(found[0]!.overridable).toBe(false);
    expect(found[0]!.message).toContain("standby.likec4");
    expect(await treeHashes(p.docsDir), "a refusal must write nothing").toEqual(before);
    expect(p.exists("architecture/standby.likec4")).toBe(false);
  });

  it("two features extending one region both archive — the file is the collision, not the region", async () => {
    const OTHER = "features/FEAT-2-third/";
    const p = await project({
      [`${FEAT_DIR}/deployment/standby.likec4`]: STANDBY,
      [`${OTHER}intent.md`]: `---\nfeature: FEAT-2\nstatus: proposed\n---\n\n# Third site\n\nAdd a third datacenter.\n`,
      [`${OTHER}deployment/third-site.likec4`]: `deployment {\n  extend eu {\n    dcC = datacenter 'DC-C' {\n      k8sC = cluster 'cluster-c' {\n        instanceOf paymentService\n      }\n    }\n  }\n}\n`,
    });
    expect((await runLoam(p.workDir, "archive", FEAT, "--json")).code).toBe(0);
    const second = await runLoam(p.workDir, "archive", "FEAT-2", "--json");
    expect(second.code, second.out).toBe(0);
    expect(p.exists("architecture/standby.likec4")).toBe(true);
    expect(p.exists("architecture/third-site.likec4")).toBe(true);
    expect((await runLoam(p.workDir, "validate", "--all", "--json")).code).toBe(0);
  });
});
