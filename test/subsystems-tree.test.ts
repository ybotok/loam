/**
 * The subsystem tree's read model, end to end through the real CLI: the
 * three-way classification of everything under `services/`, the flat
 * namespace, the refusal shapes, and the property the whole design turns on —
 * a service id is its leaf directory name and placement is never part of any
 * identity, so filing a service into a subsystem changes not one byte of any
 * join key and not one answer of any command.
 *
 * The merge-race fixture is the exit criterion worth naming: a group directory
 * whose marker one branch deleted while another branch moved services in used
 * to be readable only as "one empty service" — the services beneath vanished
 * from the fleet with no finding. Here it is an ERROR that still names and
 * counts every stranded service, because a fleet gate must never go green over
 * a fleet it silently shrank.
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import {
  coherentFixture,
  LANDSCAPE,
  LIVING_OPENAPI,
  makeProject,
  pinFor,
  runLoam,
  treeHashes,
} from "./helpers/harness.js";

interface JsonFinding {
  severity: string;
  code: string;
  message: string;
  subject?: string;
  details?: string[];
}

/** Every finding of a `validate --all --json` payload, across all targets. */
function allFindings(stdout: string): JsonFinding[] {
  const payload = JSON.parse(stdout) as { targets: Array<{ findings: JsonFinding[] }> };
  return payload.targets.flatMap((t) => t.findings);
}

function subsystemFindings(stdout: string): JsonFinding[] {
  return allFindings(stdout).filter((f) => f.code.startsWith("subsystem."));
}

/** `coherentFixture()` with payment-service filed into a marked subsystem — same bytes, new address. */
function nestedFixture(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const [path, content] of Object.entries(coherentFixture())) {
    files[path.replace(/^services\/payment-service\//, "services/payments-group/payment-service/")] = content;
  }
  files["services/payments-group/subsystem.yaml"] = "title: Payments\n";
  return files;
}

/** The service ids `loam list --json` reports. */
async function listedIds(workDir: string): Promise<string[]> {
  const res = await runLoam(workDir, "list", "--json");
  expect(res.code).toBe(0);
  return (JSON.parse(res.stdout) as { services: Array<{ id: string }> }).services.map((s) => s.id);
}

describe("three-way classification", () => {
  it("a marked directory is a subsystem and is walked: the nested service is enumerated and the fleet stays green", async () => {
    const p = await makeProject(nestedFixture());
    try {
      expect(await listedIds(p.workDir)).toContain("payment-service");
      // A fleet WITH subsystems owes the generated views file (its absence is
      // `subsystem.views-stale` — test/subsystems-views.test.ts pins that);
      // one sync writes it, and the rest of this test is about the walk.
      expect((await runLoam(p.workDir, "subsystem", "sync")).code).toBe(0);
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(res.code).toBe(0);
      expect(subsystemFindings(res.stdout)).toEqual([]);
    } finally {
      await p.destroy();
    }
  });

  it("a directory holding a service artifact is a service and is NOT walked deeper — no phantom services from its insides", async () => {
    const files = coherentFixture();
    // A subdirectory inside the service: notes, vendored docs, whatever. It
    // must not be read as a service (or as a stranded one) of its own.
    files["services/payment-service/notes/scratch.md"] = "# scratch\n";
    const p = await makeProject(files);
    try {
      const ids = await listedIds(p.workDir);
      expect(ids).toContain("payment-service");
      expect(ids).not.toContain("notes");
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(subsystemFindings(res.stdout)).toEqual([]);
    } finally {
      await p.destroy();
    }
  });

  it("a service's own reserved subdirectory is never read as a service, even when it is the only thing in the directory", async () => {
    // The trap `loam init` + `loam seed` build together: seed leaves every
    // `services/<id>/` holding only `.gitkeep`, and the AGENTS.md init just
    // scaffolded documents `usecases/<name>.likec4` as the service's flow slot.
    // Writing it used to make the walk read `usecases` as a service and the
    // parent as an unmarked GROUP — three errors, one of them saying the fleet
    // was losing services, for following the instruction (verification
    // 2026-09-04). `usecases`, `adrs` and `ui` are SCHEMA's service layout.
    const files = coherentFixture();
    for (const slot of ["usecases/flow.likec4", "ui/pages/checkout.page.yaml"]) {
      files[`services/slot-only/${slot}`] = "";
    }
    const p = await makeProject(files);
    try {
      const ids = await listedIds(p.workDir);
      expect(ids).toContain("slot-only");
      expect(ids).not.toContain("usecases");
      expect(ids).not.toContain("ui");
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(subsystemFindings(res.stdout)).toEqual([]);
      // …and nothing downstream ever saw the phantom either.
      const codes = allFindings(res.stdout).map((f) => f.code);
      expect(codes).not.toContain("landscape.binding-unknown");
    } finally {
      await p.destroy();
    }
  });

  it("a reserved subdirectory beside a real nested service never hides it — the group still refuses and names it", async () => {
    // The reason `usecases` is a WALK exclusion rather than a service artifact:
    // as an artifact it would classify its parent as a service, and the real
    // service filed beside it would vanish — the silent shrink the walk refuses.
    const files = coherentFixture();
    files["services/mixed-group/usecases/flow.likec4"] = "";
    files["services/mixed-group/svc-c/spec.md"] = "# svc-c\n\n## Requirements\n";
    const p = await makeProject(files);
    try {
      const ids = await listedIds(p.workDir);
      expect(ids).toContain("svc-c");
      expect(ids).not.toContain("usecases");
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      const unmarked = subsystemFindings(res.stdout).filter((f) => f.code === "subsystem.unmarked");
      expect(unmarked).toHaveLength(1);
      expect(unmarked[0]!.details).toEqual(["services/mixed-group/svc-c"]);
    } finally {
      await p.destroy();
    }
  });

  it("an empty directory under services/ is still a service — today's flat behaviour, unchanged", async () => {
    const p = await makeProject(coherentFixture());
    try {
      await mkdir(join(p.docsDir, "services/empty-thing"));
      expect(await listedIds(p.workDir)).toContain("empty-thing");
    } finally {
      await p.destroy();
    }
  });

  it("THE MERGE RACE: an unmarked group refuses, names every stranded service, and the fleet is never reported smaller", async () => {
    const files = coherentFixture();
    files["services/stranded-group/svc-a/spec.md"] = "# svc-a\n\n## Requirements\n";
    files["services/stranded-group/svc-b/spec.md"] = "# svc-b\n\n## Requirements\n";
    const p = await makeProject(files);
    try {
      // Still counted: list must show the stranded services, error and all.
      const ids = await listedIds(p.workDir);
      expect(ids).toEqual(expect.arrayContaining(["svc-a", "svc-b", "payment-service"]));

      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(res.code).toBe(1);
      const unmarked = subsystemFindings(res.stdout).filter((f) => f.code === "subsystem.unmarked");
      expect(unmarked).toHaveLength(1);
      expect(unmarked[0]!.severity).toBe("error");
      expect(unmarked[0]!.subject).toBe("services/stranded-group");
      expect(unmarked[0]!.message).toContain("svc-a");
      expect(unmarked[0]!.message).toContain("svc-b");
      expect(unmarked[0]!.details).toEqual([
        "services/stranded-group/svc-a",
        "services/stranded-group/svc-b",
      ]);
    } finally {
      await p.destroy();
    }
  });
});

describe("one flat namespace", () => {
  it("one service id at two depths is one identity claimed twice — the error names both directories", async () => {
    const files = coherentFixture();
    files["services/group-a/subsystem.yaml"] = "title: A\n";
    files["services/group-a/dup-svc/spec.md"] = "# dup-svc\n\n## Requirements\n";
    files["services/dup-svc/spec.md"] = "# dup-svc\n\n## Requirements\n";
    const p = await makeProject(files);
    try {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(res.code).toBe(1);
      const collisions = subsystemFindings(res.stdout).filter((f) => f.code === "subsystem.name-collision");
      expect(collisions).toHaveLength(1);
      expect(collisions[0]!.subject).toBe("dup-svc");
      expect(collisions[0]!.details).toEqual(["services/dup-svc", "services/group-a/dup-svc"]);
    } finally {
      await p.destroy();
    }
  });

  it("a name that is both a subsystem and a service id collides exactly the same way", async () => {
    const files = coherentFixture();
    files["services/x-group/subsystem.yaml"] = "title: X\n";
    files["services/other-group/subsystem.yaml"] = "title: Other\n";
    files["services/other-group/x-group/spec.md"] = "# x-group\n\n## Requirements\n";
    const p = await makeProject(files);
    try {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(res.code).toBe(1);
      const collisions = subsystemFindings(res.stdout).filter((f) => f.code === "subsystem.name-collision");
      expect(collisions).toHaveLength(1);
      expect(collisions[0]!.subject).toBe("x-group");
      expect(collisions[0]!.details).toEqual(["services/other-group/x-group", "services/x-group"]);
    } finally {
      await p.destroy();
    }
  });
});

describe("the marker", () => {
  it("a marker beside service artifacts is an error, and the directory stays an addressable service", async () => {
    const files = coherentFixture();
    files["services/payment-service/subsystem.yaml"] = "title: Not a group\n";
    const p = await makeProject(files);
    try {
      expect(await listedIds(p.workDir)).toContain("payment-service");
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(res.code).toBe(1);
      const misplaced = subsystemFindings(res.stdout).filter((f) => f.code === "subsystem.marker-misplaced");
      expect(misplaced).toHaveLength(1);
      expect(misplaced[0]!.subject).toBe("payment-service");
    } finally {
      await p.destroy();
    }
  });

  it("a marker beside artifacts still walks the subtree: services beneath stay enumerated and the finding names them", async () => {
    // A subsystem that GAINED stray artifacts (one errant mv into the group
    // directory) still holds real services. Classifying it a service and
    // returning without descent made every one of them vanish from the fleet
    // — list shrank, archive graded them absent — with only the marker
    // finding, which named nobody, to hint why. The walk's own header forbids
    // exactly that: the fleet is never reported smaller.
    const files = coherentFixture();
    files["services/payment-service/subsystem.yaml"] = "";
    files["services/payment-service/inner-svc/spec.md"] = "---\nservice: inner-svc\nstatus: draft\n---\n\n# inner-svc\n";
    const p = await makeProject(files);
    try {
      expect(await listedIds(p.workDir)).toContain("inner-svc");
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      const misplaced = subsystemFindings(res.stdout).filter((f) => f.code === "subsystem.marker-misplaced");
      expect(misplaced).toHaveLength(1);
      expect(misplaced[0]!.details).toEqual(["services/payment-service/inner-svc"]);
      expect(misplaced[0]!.message).toContain("inner-svc");
    } finally {
      await p.destroy();
    }
  });

  it("an unreadable marker still classifies the directory as a subsystem — exactly one subsystem.invalid, services beneath enumerated", async () => {
    const files = coherentFixture();
    files["services/broken-group/subsystem.yaml"] = "{{{ not yaml";
    files["services/broken-group/inner-svc/spec.md"] = "# inner-svc\n\n## Requirements\n";
    const p = await makeProject(files);
    try {
      expect(await listedIds(p.workDir)).toContain("inner-svc");
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(res.code).toBe(1);
      const invalid = subsystemFindings(res.stdout).filter((f) => f.code === "subsystem.invalid");
      expect(invalid).toHaveLength(1);
      expect(invalid[0]!.message).toContain("services/broken-group/subsystem.yaml");
      // Classified as a subsystem, so no unmarked error rides along.
      expect(subsystemFindings(res.stdout).map((f) => f.code)).not.toContain("subsystem.unmarked");
    } finally {
      await p.destroy();
    }
  });

  it("a members list is invalid — the directory itself is the membership record", async () => {
    const files = coherentFixture();
    files["services/listed-group/subsystem.yaml"] = "title: Listed\nmembers:\n  - payment-service\n";
    const p = await makeProject(files);
    try {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      const invalid = subsystemFindings(res.stdout).filter((f) => f.code === "subsystem.invalid");
      expect(invalid).toHaveLength(1);
      expect(invalid[0]!.message).toContain("members");
    } finally {
      await p.destroy();
    }
  });

  it("an illegal subsystem name is an error, and its services stay enumerated anyway", async () => {
    const files = coherentFixture();
    files["services/bad name/subsystem.yaml"] = "title: Bad\n";
    files["services/bad name/named-svc/spec.md"] = "# named-svc\n\n## Requirements\n";
    const p = await makeProject(files);
    try {
      expect(await listedIds(p.workDir)).toContain("named-svc");
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(res.code).toBe(1);
      const named = subsystemFindings(res.stdout).filter((f) => f.code === "subsystem.name-invalid");
      expect(named).toHaveLength(1);
      expect(named[0]!.subject).toBe("bad name");
    } finally {
      await p.destroy();
    }
  });
});

describe("what is NOT a finding", () => {
  it("an empty subsystem is legal — `subsystem new` must be usable before anything moves in", async () => {
    const files = coherentFixture();
    files["services/empty-group/subsystem.yaml"] = "title: Empty on purpose\n";
    const p = await makeProject(files);
    try {
      // The one obligation a subsystem brings is the generated views file —
      // an empty group renders an empty view, and the fleet is then green.
      expect((await runLoam(p.workDir, "subsystem", "sync")).code).toBe(0);
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(res.code).toBe(0);
      expect(subsystemFindings(res.stdout)).toEqual([]);
    } finally {
      await p.destroy();
    }
  });

  it("unfiled services are permanent, normal and SILENT — the flat fleet is the compatibility case", async () => {
    const p = await makeProject(coherentFixture());
    try {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(res.code).toBe(0);
      expect(subsystemFindings(res.stdout)).toEqual([]);
    } finally {
      await p.destroy();
    }
  });
});

describe("placement is never part of any identity", () => {
  it("every command answers byte-identically over the filed fleet — the join keys did not move", async () => {
    const flat = await makeProject(coherentFixture());
    const nested = await makeProject(nestedFixture());
    try {
      // The filed fleet carries its generated views file (the one artifact
      // filing adds); it appears in no command's output below, so the sweep
      // still compares byte for byte.
      expect((await runLoam(nested.workDir, "subsystem", "sync")).code).toBe(0);
      // The sweep: same fleet, same feature, same service — one filed, one
      // not. Identical answers, byte for byte, because every join runs on the
      // id and every path resolves through the enumeration. `list --json` is
      // deliberately compared on ids only: its services[].path truthfully
      // reports the new address, which is the one honest difference.
      // Two masks, both deliberate: each fixture lives in its own tmpdir and
      // `status --json` reports the absolute docsDir (a harness artefact); and
      // `show`'s `path` value truthfully reports the service's real address —
      // the ONE honest difference placement makes, exactly like list's
      // services[].path. Everything else must not differ by a byte.
      const masked = (stdout: string, docsDir: string): string =>
        stdout
          .split(docsDir)
          .join("<docs>")
          .split("services/payments-group/payment-service")
          .join("services/payment-service");
      for (const args of [
        ["validate", "--all", "--json"],
        ["validate", "--service", "payment-service", "--json"],
        ["status", "FEAT-1", "--json"],
        ["show", "payment-service", "--json"],
      ]) {
        const a = await runLoam(flat.workDir, ...args);
        const b = await runLoam(nested.workDir, ...args);
        expect(b.code, args.join(" ")).toBe(a.code);
        expect(masked(b.stdout, nested.docsDir), args.join(" ")).toBe(masked(a.stdout, flat.docsDir));
      }
      expect(await listedIds(nested.workDir)).toEqual(await listedIds(flat.workDir));
    } finally {
      await flat.destroy();
      await nested.destroy();
    }
  });

  it("archive merges INTO the filed directory, materialises the introduced service unfiled, and unarchive is a byte round trip", async () => {
    const p = await makeProject(nestedModifyFixture());
    try {
      const before = await treeHashes(p.docsDir);
      expect((await runLoam(p.workDir, "archive", "FEAT-20")).code).toBe(0);
      // The merge followed the enumeration: the living spec inside the
      // subsystem carries the modification, and no root-level
      // services/payment-service/ was invented beside it.
      expect(await p.read("services/payments-group/payment-service/spec.md")).toContain("within 2 seconds");
      expect(p.exists("services/payment-service")).toBe(false);

      expect((await runLoam(p.workDir, "unarchive", "FEAT-20")).code).toBe(0);
      expect(await treeHashes(p.docsDir)).toEqual(before);
    } finally {
      await p.destroy();
    }
  });
});

/**
 * `unarchive.test.ts`'s modify fixture with payment-service already filed —
 * the pin is computed the same way, so the delta merges rather than gating on
 * `delta.baseline-missing`.
 */
function nestedModifyFixture(): Record<string, string> {
  const living = `---
service: payment-service
status: verified
---

# payment-service

## Requirements

### Requirement: Authorize a payment
The service SHALL authorize a payment before capture.

Operations: authorizePayment

#### Scenario: Successful authorization
- **Given** a valid card
- **When** authorization is requested
- **Then** the payment is authorized
`;
  return {
    "architecture/landscape.likec4": LANDSCAPE,
    "services/payments-group/subsystem.yaml": "title: Payments\n",
    "services/payments-group/payment-service/spec.md": living,
    "services/payments-group/payment-service/openapi.yaml": LIVING_OPENAPI,
    "features/FEAT-20-faster/specs/payment-service/spec.md":
      `# payment-service — delta for FEAT-20\n\n## MODIFIED Requirements\n\n` +
      `### Requirement: Authorize a payment\nBased-On: ${pinFor(living, "Authorize a payment")}\n` +
      `The service SHALL authorize a payment within 2 seconds.\n\nOperations: authorizePayment\n\n` +
      `#### Scenario: Fast authorization\n- **Given** a valid card\n- **When** authorization is requested\n- **Then** it completes within 2 seconds\n`,
    "features/FEAT-20-faster/intent.md":
      "---\nfeature: FEAT-20\nstatus: proposed\n---\n\n# Faster authorization\n\nAuthorize within two seconds.\n",
  };
}
