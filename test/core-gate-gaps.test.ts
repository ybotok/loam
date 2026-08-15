/**
 * The gate's blind spots in the READ model, and the two repo-root bugs.
 *
 * Every case here is a state loam graded as fine — a service that vanished from
 * every enumeration, a scenario that tested nothing, a document nobody wrote,
 * bytes that decoded to an empty baseline — plus the two commands that took
 * "this repo" from wherever the caller happened to be standing.
 *
 * Where the fix is a detector this workstream exports but another file has to
 * emit (validate.ts, doctor.ts), the test pins the DETECTOR and says so: it
 * must not pin the blindness, because the blindness is what the wiring closes.
 */
import { describe, expect, it } from "vitest";
import { mkdir, symlink, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  coherentFixture,
  LANDSCAPE,
  LIVING_OPENAPI,
  LIVING_SPEC,
  makeProject,
  runLoam,
  SERVICE_MODEL,
  writeFiles,
  type Project,
} from "./helpers/harness.js";
import { listFeatures, listServices, serviceIdFindings } from "../src/core/repo/repo.js";
import { serviceIdProblem } from "../src/core/kernel/ids.js";
import { decodeDocument, NotUtf8DocumentError } from "../src/core/kernel/document-bytes.js";
import {
  conflictMarkerLines,
  documentConflictFinding,
  FleetContext,
  landscapeConflictFinding,
} from "../src/core/fleet-context.js";
import { parseRequirements, steplessFindings, steplessScenarios } from "../src/core/document/spec.js";
import { renderFeature } from "../src/core/gherkin.js";
import { serviceBrief } from "../src/core/brief/brief.js";

/** The fixture every fleet-shaped case starts from: two services the landscape binds by title. */
function fleetFixture(): Record<string, string> {
  return {
    "architecture/landscape.likec4": LANDSCAPE,
    "services/payment-service/model.likec4": SERVICE_MODEL,
    "services/payment-service/spec.md": LIVING_SPEC,
    "services/payment-service/openapi.yaml": LIVING_OPENAPI,
    "services/checkout-web/model.likec4": SERVICE_MODEL.replace(/payment-service/g, "checkout-web").replace(
      /paymentService/g,
      "checkoutWeb",
    ),
    "services/checkout-web/spec.md": LIVING_SPEC.replace("payment-service", "checkout-web").replace(
      "\nOperations: authorizePayment\n",
      "\n",
    ),
  };
}

/** Move a directory out of the docs repo and leave a symlink where it was. */
async function externalise(p: Project, relPath: string, name: string): Promise<string> {
  const outside = join(dirname(p.docsDir), name);
  await mkdir(dirname(outside), { recursive: true });
  const { rename } = await import("node:fs/promises");
  await rename(join(p.docsDir, relPath), outside);
  await symlink(outside, join(p.docsDir, relPath));
  return outside;
}

describe("a symlinked directory is a directory", () => {
  it("a symlinked services/<id>/ is enumerated, graded and seen by the fleet gate", async () => {
    const p = await makeProject(fleetFixture());
    try {
      await externalise(p, "services/checkout-web", "checkout-web-elsewhere");

      const services = (await listServices(p.docsDir)).map((s) => s.id);
      expect(services).toEqual(["checkout-web", "payment-service"]);

      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      const payload = JSON.parse(res.stdout) as {
        valid: boolean;
        targets: Array<{ kind: string; id: string; findings: Array<{ code: string }> }>;
      };
      // The service is graded — its own model/requirements were read...
      const target = payload.targets.find((t) => t.kind === "service" && t.id === "checkout-web");
      expect(target).toBeDefined();
      expect(target!.findings.map((f) => f.code)).toContain("requirements.covered");
      // ...and the fleet map no longer claims the directory is missing, which is
      // the lie the invisible service produced: an element bound to a service
      // that is right there, reported as binding to nothing.
      const codes = payload.targets.flatMap((t) => t.findings.map((f) => f.code));
      expect(codes).not.toContain("landscape.service-unmodelled");
      expect(codes).not.toContain("landscape.binding-unknown");
      expect(payload.valid).toBe(true);
    } finally {
      await p.destroy();
    }
  });

  it("a symlinked features/<id>/ is a feature, with its specs/ underneath", async () => {
    const p = await makeProject(coherentFixture());
    try {
      await externalise(p, "features/FEAT-1-split", "feat-1-elsewhere");

      const features = await listFeatures(p.docsDir);
      expect(features.map((f) => f.id)).toEqual(["FEAT-1"]);
      // The specs/ walk goes through the same enumeration, so a symlinked
      // feature must not become a feature with no services.
      expect(features[0]!.services).toEqual(["payment-split-service"]);
      expect(features[0]!.has).toEqual({ intent: true, delta: true });

      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json");
      expect(res.code).toBe(0);
    } finally {
      await p.destroy();
    }
  });

  it("a dangling symlink is not a service — it is nothing, exactly like an absent directory", async () => {
    const p = await makeProject(fleetFixture());
    try {
      await symlink(join(dirname(p.docsDir), "was-never-there"), join(p.docsDir, "services/ghost"));
      expect((await listServices(p.docsDir)).map((s) => s.id)).toEqual([
        "checkout-web",
        "payment-service",
      ]);
    } finally {
      await p.destroy();
    }
  });

  it("counts a symlinked ADR — the adrs/ walk had the same blind spot", async () => {
    const p = await makeProject(fleetFixture());
    try {
      const outside = join(dirname(p.docsDir), "adr-elsewhere.md");
      await writeFile(outside, "# 0001 — use an outbox\n", "utf8");
      await mkdir(join(p.docsDir, "services/payment-service/adrs"), { recursive: true });
      await symlink(outside, join(p.docsDir, "services/payment-service/adrs/0001-outbox.md"));

      const svc = (await listServices(p.docsDir)).find((s) => s.id === "payment-service")!;
      expect(svc.adrs).toBe(1);
    } finally {
      await p.destroy();
    }
  });
});

describe("the read model and the authoring commands agree about what a service id is", () => {
  it("grades a directory no loam command can author, in its own words", async () => {
    const p = await makeProject(fleetFixture());
    try {
      await writeFiles(p.docsDir, {
        "services/платежи/spec.md": LIVING_SPEC.replace("payment-service", "платежи"),
      });

      const services = await listServices(p.docsDir);
      const rogue = services.find((s) => s.id === "платежи")!;
      // Still enumerated: the directory exists and holds somebody's documents.
      expect(rogue).toBeDefined();
      expect(rogue.idProblem).toBeDefined();

      const findings = serviceIdFindings(services);
      expect(findings.map((f) => f.code)).toEqual(["service.id-invalid"]);
      expect(findings[0]!.severity).toBe("error");
      expect(findings[0]!.subject).toBe("платежи");
      expect(findings[0]!.message).toContain("Rename the directory");

      // The agreement itself: the sentence the finding carries is the sentence
      // the authoring refusal prints, because both come from serviceIdProblem.
      const adopt = await runLoam(p.workDir, "adopt", "--service", "платежи", "--json");
      expect(adopt.code).toBe(1);
      const err = (JSON.parse(adopt.stdout) as { error: { code: string; message: string } }).error;
      expect(err.code).toBe("invalid-option");
      expect(err.message).toContain("a service id must start with a letter or digit");
      expect(findings[0]!.message).toContain("a service id must start with a letter or digit");
    } finally {
      await p.destroy();
    }
  });

  it("says nothing about a fleet whose directories are all legal", async () => {
    const p = await makeProject(fleetFixture());
    try {
      expect(serviceIdFindings(await listServices(p.docsDir))).toEqual([]);
    } finally {
      await p.destroy();
    }
  });
});

describe("one service-id grammar, and it is the strict one", () => {
  // The list migrate-openspec.ts refused all along while the primary authoring
  // path accepted it — the fork this closes. Windows cannot create any of them.
  const unusable = ["CON", "PRN", "AUX", "NUL", "COM1", "LPT9", "nul", "NUL.txt", "payments.", "payments "];

  it.each(unusable)("refuses '%s' everywhere, not only in the migration", (id) => {
    expect(serviceIdProblem(id)).not.toBeNull();
  });

  it.each(["payment-service", "svc_1", "a", "0-service", "payments.core", "CONSOLE", "COM10"])(
    "still accepts '%s'",
    (id) => {
      expect(serviceIdProblem(id)).toBeNull();
    },
  );

  it("refuses a reserved name through the CLI, and says why rather than quoting the alphabet", async () => {
    const p = await makeProject(fleetFixture());
    try {
      const res = await runLoam(p.workDir, "adopt", "--service", "CON", "--json");
      expect(res.code).toBe(1);
      const err = (JSON.parse(res.stdout) as { error: { code: string; message: string } }).error;
      expect(err.code).toBe("invalid-option");
      expect(err.message).toContain("reserved device name on Windows");
    } finally {
      await p.destroy();
    }
  });
});

describe("a scenario with no steps is not coverage", () => {
  const STEPLESS = `# payment-service

## Requirements

### Requirement: Authorize a payment
The service SHALL authorize a payment.

#### Scenario: Successful authorization
The card is valid, authorization is requested, and the payment is authorized.

#### Scenario: Declined authorization
- **Given** a card over its limit
- **Then** the payment is declined
`;

  it("passes the missing-scenario rule and is still reported", () => {
    const reqs = parseRequirements(STEPLESS);
    expect(reqs[0]!.scenarios).toHaveLength(2);
    const bare = steplessScenarios(reqs);
    expect(bare).toEqual([{ requirement: "Authorize a payment", scenario: "Successful authorization" }]);

    const findings = steplessFindings("payment-service: requirements", "payment-service", reqs);
    expect(findings.map((f) => f.code)).toEqual(["requirements.stepless-scenario"]);
    expect(findings[0]!.severity).toBe("error");
    expect(findings[0]!.details).toEqual(["Authorize a payment — Successful authorization"]);
  });

  it("uses `loam gherkin`'s own detector, so the gate and the emitted suite cannot disagree", () => {
    const reqs = parseRequirements(STEPLESS);
    const emitted = renderFeature(reqs[0]!, [], "0.0.0");
    expect(steplessScenarios(reqs).map((s) => s.scenario)).toEqual(emitted.stepless);
  });

  it("exempts a REMOVED requirement, exactly as the missing-scenario rule does", () => {
    const reqs = parseRequirements(
      `## REMOVED Requirements\n\n### Requirement: Retire it\n\n#### Scenario: Gone\nprose only\n`,
    );
    expect(steplessScenarios(reqs)).toEqual([]);
  });

  it("says nothing about a scenario written as steps", () => {
    expect(steplessScenarios(parseRequirements(LIVING_SPEC))).toEqual([]);
    expect(steplessFindings("x", "y", parseRequirements(LIVING_SPEC))).toEqual([]);
  });
});

describe("git conflict markers are a fact about any document, not about one file", () => {
  const CONFLICTED = LIVING_SPEC.replace(
    "- **Then** the payment is authorized",
    "<<<<<<< HEAD\n- **Then** the payment is authorized\n=======\n- **Then** an authorization id is returned\n>>>>>>> feature/id",
  );

  it("finds all three markers, by line", () => {
    expect(conflictMarkerLines(CONFLICTED)).toHaveLength(3);
    expect(conflictMarkerLines(LIVING_SPEC)).toEqual([]);
  });

  it("grades a conflicted living spec as an error naming the lines", () => {
    const finding = documentConflictFinding("payment-service: spec.md", "payment-service", CONFLICTED);
    expect(finding).not.toBeNull();
    expect(finding!.code).toBe("spec.merge-conflict");
    expect(finding!.severity).toBe("error");
    expect(finding!.subject).toBe("payment-service");
    expect(finding!.message).toMatch(/lines \d+, \d+, \d+/);
  });

  it("grades the fleet map under its own code — the same rule, a different blast radius", () => {
    const finding = landscapeConflictFinding(
      "architecture/landscape.likec4",
      LANDSCAPE.replace("model {", "model {\n<<<<<<< HEAD"),
    );
    expect(finding!.code).toBe("landscape.merge-conflict");
    expect(finding!.severity).toBe("error");
  });

  it("is silent on a clean document, whatever it is", () => {
    expect(documentConflictFinding("x", "y", LIVING_SPEC)).toBeNull();
    expect(landscapeConflictFinding("x", LANDSCAPE)).toBeNull();
  });

  it("does not mistake a markdown rule or a table for a marker", () => {
    // `=======` only counts at the start of a line, which is where git writes
    // it; a setext underline is shorter and indented content is not a marker.
    expect(conflictMarkerLines("title\n====\n\n  ======= indented\n")).toEqual([]);
  });
});

describe("a document that is not UTF-8 text is refused, not read as empty", () => {
  const utf16 = (s: string, bom: boolean): Buffer =>
    Buffer.from((bom ? "﻿" : "") + s, "utf16le");

  it("refuses UTF-16 with a byte-order mark — the shape PowerShell's `>` writes", () => {
    expect(() => decodeDocument(utf16(LIVING_SPEC, true), "/docs/spec.md")).toThrow(NotUtf8DocumentError);
  });

  it("refuses UTF-16 WITHOUT a mark, whose bytes are legal UTF-8 and decode to NULs", () => {
    const bytes = utf16(LIVING_SPEC, false);
    // The precondition that makes the second test necessary: these bytes pass
    // an isUtf8 check, which is why the byte test alone was not enough.
    expect(bytes.toString("utf8")).toContain(" ");
    expect(() => decodeDocument(bytes, "/docs/spec.md")).toThrow(/NUL characters/);
  });

  it("names the file and says how to fix it", () => {
    try {
      decodeDocument(utf16("x", true), "/docs/services/payment-service/spec.md");
      throw new Error("expected a refusal");
    } catch (err) {
      expect(err).toBeInstanceOf(NotUtf8DocumentError);
      expect((err as NotUtf8DocumentError).path).toBe("/docs/services/payment-service/spec.md");
      expect((err as Error).message).toContain("Out-File -Encoding utf8");
    }
  });

  it("reads ordinary UTF-8, accents and all", () => {
    expect(decodeDocument(Buffer.from("# André Muñoz\n", "utf8"), "/x.md")).toBe("# André Muñoz\n");
  });

  it("refuses through the read index every command shares", async () => {
    const p = await makeProject(fleetFixture());
    try {
      await writeFile(join(p.docsDir, "services/payment-service/spec.md"), utf16(LIVING_SPEC, true));
      const ctx = new FleetContext();
      await expect(ctx.readText(join(p.docsDir, "services/payment-service/spec.md"))).rejects.toThrow(
        NotUtf8DocumentError,
      );
    } finally {
      await p.destroy();
    }
  });

  it("stops `loam gherkin` deleting the suite it can no longer see a reason for", async () => {
    // The destructive half of the same read. A living run treats every
    // .feature under loam/ that is not in the plan as an orphan and UNLINKS
    // it, so a spec that decodes to zero requirements does not merely emit
    // nothing — it takes the whole generated suite with it.
    const p = await makeProject(fleetFixture(), { service: "payment-service" });
    try {
      const first = await runLoam(p.workDir, "gherkin", "--json");
      expect(first.code).toBe(0);
      const written = (JSON.parse(first.stdout) as { files: Array<{ path: string }> }).files.map(
        (f) => f.path,
      );
      expect(written.length).toBeGreaterThan(0);

      await writeFile(join(p.docsDir, "services/payment-service/spec.md"), utf16(LIVING_SPEC, true));
      const second = await runLoam(p.workDir, "gherkin", "--json");
      expect(second.code).toBe(1);
      const err = (JSON.parse(second.stdout) as { error: { code: string; message: string } }).error;
      expect(err.code).toBe("repository-unavailable");
      expect(err.message).toContain("not a UTF-8 text document");

      const { existsSync } = await import("node:fs");
      for (const f of written) expect(existsSync(join(p.workDir, f))).toBe(true);
    } finally {
      await p.destroy();
    }
  });

  it("stops `loam vouch` diagnosing a spec it could not decode as one that names no sources", async () => {
    // The wrong diagnosis this replaces: the substituted text has no
    // frontmatter loam can find, so vouch refused with `sources-absent` —
    // "names no sources" — over a file whose `sources:` line is right there.
    const p = await makeProject(
      {
        ...fleetFixture(),
        "services/payment-service/spec.md": LIVING_SPEC.replace(
          "status: verified",
          "status: draft\nowner: payments\nsources:\n  - src/main/",
        ),
      },
      { service: "payment-service" },
    );
    try {
      await mkdir(join(p.workDir, "src/main"), { recursive: true });
      await writeFile(join(p.workDir, "src/main/Payment.java"), "class Payment {}\n", "utf8");
      const spec = await p.read("services/payment-service/spec.md");
      await writeFile(join(p.docsDir, "services/payment-service/spec.md"), utf16(spec, true));

      const res = await runLoam(p.workDir, "vouch", "--yes", "--json");
      expect(res.code).toBe(1);
      const err = (JSON.parse(res.stdout) as { error: { code: string; message: string } }).error;
      expect(err.code).toBe("repository-unavailable");
      expect(err.code).not.toBe("sources-absent");
      expect(err.message).toContain("not valid UTF-8");
      // And nothing was stamped: the document is still the bytes the author saved.
      expect(await p.read("services/payment-service/spec.md")).not.toContain("last_verified");
    } finally {
      await p.destroy();
    }
  });

  it("makes the fleet gate red instead of reporting an empty baseline", async () => {
    const p = await makeProject(fleetFixture());
    try {
      await writeFile(join(p.docsDir, "services/payment-service/spec.md"), utf16(LIVING_SPEC, true));
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      const payload = JSON.parse(res.stdout) as {
        valid: boolean;
        targets: Array<{ id: string; findings: Array<{ severity: string; code: string; message: string }> }>;
      };
      expect(payload.valid).toBe(false);
      const errors = payload.targets
        .flatMap((t) => t.findings)
        .filter((f) => f.severity === "error");
      expect(errors.map((f) => f.code)).toContain("service.unreadable");
      expect(errors.map((f) => f.message).join("\n")).toContain("not a UTF-8 text document");
      // The state it replaces: "spec.md holds no '### Requirement:' blocks",
      // a warning, on a file that holds one.
      expect(payload.targets.flatMap((t) => t.findings).map((f) => f.code)).not.toContain(
        "spec.no-requirements",
      );
    } finally {
      await p.destroy();
    }
  });
});

describe("`this repo` is where loam.json is, not where the caller is standing", () => {
  /** A service repo with a source tree, a subdirectory to run from, and a vouchable spec. */
  async function serviceRepo(): Promise<Project> {
    const p = await makeProject({
      ...fleetFixture(),
      "services/payment-service/spec.md": LIVING_SPEC.replace(
        "status: verified",
        "status: draft\nowner: payments\nsources:\n  - src/main/",
      ),
    }, { service: "payment-service" });
    await mkdir(join(p.workDir, "src/main"), { recursive: true });
    await mkdir(join(p.workDir, "src/deep/deeper"), { recursive: true });
    await writeFile(join(p.workDir, "src/main/Payment.java"), "class Payment {}\n", "utf8");
    return p;
  }

  it("gherkin writes into the repo root's suite, not into the directory it was called from", async () => {
    const p = await serviceRepo();
    try {
      const res = await runLoam(join(p.workDir, "src/deep/deeper"), "gherkin", "--json");
      expect(res.code).toBe(0);
      const payload = JSON.parse(res.stdout) as { root: string; files: Array<{ path: string }> };
      expect(payload.root).toBe("features/loam");
      expect(payload.files[0]!.path.startsWith("features/loam/")).toBe(true);
      // The bytes, not just the report: the suite is at the root and the source
      // tree is untouched.
      const { existsSync } = await import("node:fs");
      expect(existsSync(join(p.workDir, "features/loam"))).toBe(true);
      expect(existsSync(join(p.workDir, "src/deep/deeper/features"))).toBe(false);
      expect(existsSync(join(p.workDir, "src/deep/features"))).toBe(false);
    } finally {
      await p.destroy();
    }
  });

  it("gherkin from a subdirectory regenerates the SAME files a root run wrote — not a second suite", async () => {
    const p = await serviceRepo();
    try {
      const fromRoot = await runLoam(p.workDir, "gherkin", "--json");
      const fromDeep = await runLoam(join(p.workDir, "src/deep"), "gherkin", "--json");
      const paths = (r: { stdout: string }): string[] =>
        (JSON.parse(r.stdout) as { files: Array<{ path: string; action: string }> }).files.map((f) => f.path);
      expect(paths(fromDeep)).toEqual(paths(fromRoot));
      // Second run REPLACES rather than writes: it found the first run's files.
      const actions = (JSON.parse(fromDeep.stdout) as { files: Array<{ action: string }> }).files.map(
        (f) => f.action,
      );
      expect(new Set(actions)).toEqual(new Set(["replaced"]));
    } finally {
      await p.destroy();
    }
  });

  it("vouch resolves `sources` against the repo root, from anywhere inside it", async () => {
    const p = await serviceRepo();
    try {
      const res = await runLoam(join(p.workDir, "src/deep/deeper"), "vouch", "--yes", "--json");
      expect(res.code).toBe(0);
      const payload = JSON.parse(res.stdout) as {
        status: string;
        sources: string[];
        sources_digest: string;
        files: number;
      };
      expect(payload.status).toBe("verified");
      expect(payload.sources).toEqual(["src/main/"]);
      expect(payload.files).toBe(1);
      expect(payload.sources_digest).toMatch(/^[0-9a-f]{16}$/);
      expect(await p.read("services/payment-service/spec.md")).toContain("status: verified");
    } finally {
      await p.destroy();
    }
  });

  it("vouch stamps the same digest from the root and from a subdirectory", async () => {
    const p = await serviceRepo();
    try {
      const root = JSON.parse((await runLoam(p.workDir, "vouch", "--yes", "--json")).stdout) as {
        sources_digest: string;
      };
      const deep = JSON.parse(
        (await runLoam(join(p.workDir, "src/deep"), "vouch", "--yes", "--json")).stdout,
      ) as { sources_digest: string };
      expect(deep.sources_digest).toBe(root.sources_digest);
    } finally {
      await p.destroy();
    }
  });

  it("still refuses to vouch for a service this repo is not", async () => {
    const p = await serviceRepo();
    try {
      const res = await runLoam(join(p.workDir, "src/deep"), "vouch", "--yes", "--service", "checkout-web", "--json");
      expect(res.code).toBe(1);
      expect(res.stdout).toContain("run it there");
    } finally {
      await p.destroy();
    }
  });
});

describe("the adopt brief never asks for an API contract nobody expects", () => {
  it("marks openapi.yaml required for a service the fleet calls", async () => {
    const p = await makeProject(fleetFixture());
    try {
      await rm(join(p.docsDir, "services/payment-service/openapi.yaml"));
      const brief = await serviceBrief(p.docsDir, "payment-service");
      const api = brief.targets.find((t) => t.artifact === "openapi.yaml")!;
      expect(brief.landscape.expects).toEqual(["authorizePayment"]);
      expect(api.required).toBe(true);
    } finally {
      await p.destroy();
    }
  });

  it("does NOT require one of a UI nothing calls — the guess it used to instruct", async () => {
    const p = await makeProject(fleetFixture());
    try {
      const brief = await serviceBrief(p.docsDir, "checkout-web");
      expect(brief.landscape.parses).toBe(true);
      expect(brief.landscape.expects).toEqual([]);
      expect(brief.targets.find((t) => t.artifact === "openapi.yaml")!.required).toBe(false);

      // And the human view stops shouting it: `MISSING` is reserved for a
      // required artifact, and an agent reads capitals as an instruction.
      const res = await runLoam(p.workDir, "adopt", "--service", "checkout-web");
      expect(res.stdout).toMatch(/openapi\.yaml\s+create\s+missing/);
      expect(res.stdout).not.toMatch(/openapi\.yaml\s+create\s+MISSING/);
    } finally {
      await p.destroy();
    }
  });

  it("keeps requiring one when the landscape cannot prove anything", async () => {
    for (const damage of ["absent", "unparseable"] as const) {
      const p = await makeProject(fleetFixture());
      try {
        if (damage === "absent") await rm(join(p.docsDir, "architecture/landscape.likec4"));
        else await p.write("architecture/landscape.likec4", "model { this does not parse\n");
        const brief = await serviceBrief(p.docsDir, "checkout-web");
        expect(brief.landscape.parses).toBe(false);
        // Positive evidence only: a landscape nobody can read proves nothing
        // about who calls this service, so the contract is still owed.
        expect(brief.targets.find((t) => t.artifact === "openapi.yaml")!.required).toBe(true);
      } finally {
        await p.destroy();
      }
    }
  });

  it("agrees with `loam list` — one derivation, not two opinions", async () => {
    const p = await makeProject(fleetFixture());
    try {
      const res = await runLoam(p.workDir, "list", "--json");
      const listed = (JSON.parse(res.stdout) as { services: Array<{ id: string; apiExpected: boolean }> })
        .services;
      for (const s of listed) {
        const brief = await serviceBrief(p.docsDir, s.id);
        expect(brief.targets.find((t) => t.artifact === "openapi.yaml")!.required).toBe(s.apiExpected);
      }
      // Not vacuous: the two services disagree with each other.
      expect(new Set(listed.map((s) => s.apiExpected))).toEqual(new Set([true, false]));
    } finally {
      await p.destroy();
    }
  });

  it("resolves an edge drawn into a modelled CONTAINER, like validate and list do", async () => {
    const p = await makeProject({
      ...fleetFixture(),
      "architecture/landscape.likec4": `specification {
  element softwareSystem
  element container
}

model {
  checkoutWeb = softwareSystem 'checkout-web' {
    metadata { service 'checkout-web' }
  }
  paymentService = softwareSystem 'payment-service' {
    metadata { service 'payment-service' }
    api = container 'HTTP API'
  }
  checkoutWeb -> paymentService.api 'Calls authorizePayment' { metadata { op 'authorizePayment' } }
}
`,
    });
    try {
      const brief = await serviceBrief(p.docsDir, "payment-service");
      expect(brief.landscape.expects).toEqual(["authorizePayment"]);
      expect(brief.targets.find((t) => t.artifact === "openapi.yaml")!.required).toBe(true);
    } finally {
      await p.destroy();
    }
  });
});
