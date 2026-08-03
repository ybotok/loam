/**
 * Tests for frontmatter and provenance (src/core/frontmatter.ts + the checks in
 * src/commands/validate.ts).
 *
 * When an LLM writes the docs, coherence alone is a closed-world property: the
 * corpus can agree with itself perfectly and describe nothing that exists. The
 * frontmatter is the one deterministic tie to reality — `sources:` says which
 * code an artifact was written from, `status` says whether a human has vouched
 * for it. SCHEMA.md has declared these since the start and nothing read them.
 *
 * Families:
 *  - the parser: present / absent / unterminated / scalar-vs-list / body
 *  - required fields, and the difference between absent and contradictory
 *  - `sources` resolution against the repo loam is running in
 *  - the draft/verified inventory in list and show
 */
import { describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  coherentFixture,
  makeProject,
  runLoam,
  LIVING_OPENAPI,
  SERVICE_MODEL,
  type Project,
} from "./helpers/harness.js";
import { parseFrontmatter, listField, stringField } from "../src/core/frontmatter.js";

const SVC = "payment-service";

async function withProject(
  files: Record<string, string>,
  opts: { service?: string },
  fn: (p: Project) => Promise<void>,
): Promise<void> {
  const p = await makeProject(files, opts);
  try {
    await fn(p);
  } finally {
    await p.destroy();
  }
}

/** A living spec with the given frontmatter block. */
function spec(frontmatter: string): string {
  return `---
${frontmatter}
---

# ${SVC}

## Requirements

### Requirement: Authorize a payment
The service SHALL authorize a payment before capture.

Operations: authorizePayment

#### Scenario: Successful authorization
- **Given** a valid card
- **When** authorization is requested
- **Then** the payment is authorized
`;
}

/** The coherent fixture with payment-service's spec frontmatter replaced. */
function fixtureWith(frontmatter: string): Record<string, string> {
  const files = coherentFixture();
  files[`services/${SVC}/spec.md`] = spec(frontmatter);
  return files;
}

const codesOf = (json: { targets: Array<{ findings: Array<{ code: string }> }> }): string[] =>
  json.targets[0]!.findings.map((f) => f.code);

describe("the parser", () => {
  it("reads a mapping and the body after it", () => {
    const fm = parseFrontmatter("---\nservice: payment\nstatus: verified\n---\n\n# Title\n\nBody\n");
    expect(fm.present).toBe(true);
    expect(stringField(fm, "service")).toBe("payment");
    expect(stringField(fm, "status")).toBe("verified");
    expect(fm.body.startsWith("# Title")).toBe(true);
  });

  it("reports absence rather than guessing", () => {
    const fm = parseFrontmatter("# Title\n\nNo frontmatter here.\n");
    expect(fm.present).toBe(false);
    expect(stringField(fm, "status")).toBeUndefined();
    expect(fm.body).toContain("# Title");
  });

  it("treats an unterminated block as no frontmatter, keeping the text whole", () => {
    const md = "---\nservice: payment\n\n# Title\n";
    const fm = parseFrontmatter(md);
    expect(fm.present).toBe(false);
    expect(fm.body).toBe(md);
  });

  it("stops at the FIRST closing fence — a later horizontal rule is body", () => {
    const fm = parseFrontmatter("---\nstatus: draft\n---\n\nIntro\n\n---\n\nMore\n");
    expect(stringField(fm, "status")).toBe("draft");
    expect(fm.body).toContain("Intro");
    expect(fm.body).toContain("More");
  });

  it("accepts an empty block", () => {
    const fm = parseFrontmatter("---\n---\n\n# Title\n");
    expect(fm.present).toBe(true);
    expect(stringField(fm, "status")).toBeUndefined();
  });

  it("takes a list field as a list, and a lone scalar as a list of one", () => {
    const list = parseFrontmatter("---\nsources:\n  - src/a\n  - src/b\n---\n");
    expect(listField(list, "sources")).toEqual(["src/a", "src/b"]);
    const scalar = parseFrontmatter("---\nsources: src/a\n---\n");
    expect(listField(scalar, "sources")).toEqual(["src/a"]);
    const absent = parseFrontmatter("---\nstatus: draft\n---\n");
    expect(listField(absent, "sources")).toEqual([]);
  });

  it("survives malformed YAML instead of throwing", () => {
    const fm = parseFrontmatter("---\nstatus: [unclosed\n---\n\n# Title\n");
    expect(fm.present).toBe(true);
    expect(stringField(fm, "status")).toBeUndefined();
    expect(fm.body).toContain("# Title");
  });

  it("coerces a non-string scalar to its text — a bare date is not a Date to us", () => {
    const fm = parseFrontmatter("---\nlast_verified: 2026-07-31\n---\n");
    expect(stringField(fm, "last_verified")).toBe("2026-07-31");
  });
});

describe("required fields", () => {
  it("a complete frontmatter produces no complaint", async () => {
    await withProject(
      fixtureWith("service: payment-service\nstatus: verified\nowner: payments-team"),
      { service: SVC },
      async (p) => {
        const res = await runLoam(p.workDir, "validate", "--json");
        expect(res.code).toBe(0);
        expect(codesOf(JSON.parse(res.stdout))).not.toContain("frontmatter.field-missing");
      },
    );
  });

  it("absence is a warning — an undocumented artifact is incomplete, not wrong", async () => {
    const files = coherentFixture();
    files[`services/${SVC}/spec.md`] = `# ${SVC}

## Requirements

### Requirement: Authorize a payment
The service SHALL authorize.

#### Scenario: Works
- **Given** a card
- **When** authorized
- **Then** ok
`;
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--json");
      expect(res.code).toBe(0);
      const finding = JSON.parse(res.stdout).targets[0].findings.find(
        (f: { code: string }) => f.code === "frontmatter.missing",
      );
      expect(finding.severity).toBe("warn");
    });
  });

  it("a missing field is named so it can be filled in", async () => {
    await withProject(fixtureWith("service: payment-service"), { service: SVC }, async (p) => {
      const json = JSON.parse((await runLoam(p.workDir, "validate", "--json")).stdout);
      const finding = json.targets[0].findings.find(
        (f: { code: string }) => f.code === "frontmatter.field-missing",
      );
      expect(finding.severity).toBe("warn");
      expect(finding.details).toContain("status");
    });
  });

  it("contradiction is an error — a spec claiming to be another service is a bug", async () => {
    await withProject(
      fixtureWith("service: some-other-service\nstatus: verified"),
      { service: SVC },
      async (p) => {
        const res = await runLoam(p.workDir, "validate", "--json");
        expect(res.code).toBe(1);
        const json = JSON.parse(res.stdout);
        expect(json.valid).toBe(false);
        const finding = json.targets[0].findings.find(
          (f: { code: string }) => f.code === "frontmatter.field-mismatch",
        );
        expect(finding.severity).toBe("error");
        expect(finding.message).toContain("some-other-service");
      },
    );
  });

  it("an unknown status is an error — `verifed` must not read as unverified", async () => {
    await withProject(
      fixtureWith("service: payment-service\nstatus: verifed"),
      { service: SVC },
      async (p) => {
        const res = await runLoam(p.workDir, "validate", "--json");
        expect(res.code).toBe(1);
        const finding = JSON.parse(res.stdout).targets[0].findings.find(
          (f: { code: string }) => f.code === "frontmatter.status-unknown",
        );
        expect(finding.severity).toBe("error");
        expect(finding.message).toContain("verifed");
      },
    );
  });

  it("a feature's intent is held to the feature vocabulary, not the service one", async () => {
    const files = coherentFixture();
    files["features/FEAT-1-split/intent.md"] = `---
feature: FEAT-1
status: draft
---

# Split payments
`;
    await withProject(files, {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json");
      expect(res.code).toBe(1);
      const finding = JSON.parse(res.stdout).targets[0].findings.find(
        (f: { code: string }) => f.code === "frontmatter.status-unknown",
      );
      expect(finding.message).toContain("proposed");
    });
  });

  it("an intent naming the wrong feature is an error", async () => {
    const files = coherentFixture();
    files["features/FEAT-1-split/intent.md"] = `---
feature: FEAT-99
status: proposed
---

# Split payments
`;
    await withProject(files, {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json");
      expect(res.code).toBe(1);
      expect(codesOf(JSON.parse(res.stdout))).toContain("frontmatter.field-mismatch");
    });
  });
});

describe("sources — the tie to the code", () => {
  /** A project whose workDir doubles as the service repo, with real files in it. */
  async function repoProject(
    sources: string,
    repoFiles: string[],
  ): Promise<Project> {
    const p = await makeProject(fixtureWith(`service: ${SVC}\nstatus: verified\n${sources}`), {
      service: SVC,
    });
    for (const rel of repoFiles) {
      const path = join(p.workDir, rel);
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, "// code\n", "utf8");
    }
    return p;
  }

  it("resolves listed paths against the repo loam is running in", async () => {
    const p = await repoProject("sources:\n  - src/payment.ts", ["src/payment.ts"]);
    try {
      const res = await runLoam(p.workDir, "validate", "--json");
      expect(res.code).toBe(0);
      const finding = JSON.parse(res.stdout).targets[0].findings.find(
        (f: { code: string }) => f.code === "sources.resolved",
      );
      expect(finding.severity).toBe("ok");
      expect(finding.message).toContain("1");
    } finally {
      await p.destroy();
    }
  });

  it("a source that no longer exists is an error — the doc points into the void", async () => {
    const p = await repoProject("sources:\n  - src/gone.ts", []);
    try {
      const res = await runLoam(p.workDir, "validate", "--json");
      expect(res.code).toBe(1);
      const finding = JSON.parse(res.stdout).targets[0].findings.find(
        (f: { code: string }) => f.code === "sources.path-missing",
      );
      expect(finding.severity).toBe("error");
      expect(finding.message).toContain("src/gone.ts");
    } finally {
      await p.destroy();
    }
  });

  it("a glob is satisfied by its deepest real directory (documented limitation)", async () => {
    const ok = await repoProject("sources:\n  - src/main/**/*.java", ["src/main/App.java"]);
    try {
      const res = await runLoam(ok.workDir, "validate", "--json");
      expect(res.code).toBe(0);
    } finally {
      await ok.destroy();
    }

    const bad = await repoProject("sources:\n  - src/absent/**/*.java", ["src/main/App.java"]);
    try {
      const res = await runLoam(bad.workDir, "validate", "--json");
      expect(res.code).toBe(1);
      expect(codesOf(JSON.parse(res.stdout))).toContain("sources.path-missing");
    } finally {
      await bad.destroy();
    }
  });

  it("is not checked for a service this repo is not — paths would be meaningless", async () => {
    // loam.json says this repo is checkout-web; payment-service's sources describe
    // a different repository, so resolving them here would be nonsense.
    const files = fixtureWith(`service: ${SVC}\nstatus: verified\nsources:\n  - src/gone.ts`);
    files["services/checkout-web/model.likec4"] = SERVICE_MODEL;
    await withProject(files, { service: "checkout-web" }, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      expect(res.code).toBe(0);
      const codes = codesOf(JSON.parse(res.stdout));
      expect(codes).not.toContain("sources.path-missing");
      expect(codes).not.toContain("sources.resolved");
    });
  });

  it("missing sources are a warning, not silence — an unanchored doc is the thing to count", async () => {
    await withProject(
      fixtureWith("service: payment-service\nstatus: verified"),
      { service: SVC },
      async (p) => {
        const res = await runLoam(p.workDir, "validate", "--json");
        expect(res.code).toBe(0);
        const finding = JSON.parse(res.stdout).targets[0].findings.find(
          (f: { code: string }) => f.code === "sources.absent",
        );
        expect(finding.severity).toBe("warn");
      },
    );
  });
});

describe("the draft/verified inventory", () => {
  function twoServices(): Record<string, string> {
    const files = coherentFixture();
    files[`services/${SVC}/spec.md`] = spec("service: payment-service\nstatus: verified");
    files["services/checkout-web/model.likec4"] = SERVICE_MODEL;
    files["services/checkout-web/spec.md"] = `---
service: checkout-web
status: draft
---

# checkout-web
`;
    files["services/checkout-web/openapi.yaml"] = LIVING_OPENAPI;
    return files;
  }

  it("list counts how much of the fleet is vouched for", async () => {
    await withProject(twoServices(), {}, async (p) => {
      const res = await runLoam(p.workDir, "list", "services");
      expect(res.out).toContain("1 verified");
      expect(res.out).toContain("1 draft");
    });
  });

  it("list --json carries each service's status", async () => {
    await withProject(twoServices(), {}, async (p) => {
      const json = JSON.parse((await runLoam(p.workDir, "list", "--json")).stdout);
      const byId = Object.fromEntries(
        json.services.map((s: { id: string; status: string | null }) => [s.id, s.status]),
      );
      expect(byId["payment-service"]).toBe("verified");
      expect(byId["checkout-web"]).toBe("draft");
    });
  });

  it("a service with no frontmatter counts as unmarked, not as verified", async () => {
    const files = twoServices();
    files["services/checkout-web/spec.md"] = "# checkout-web\n";
    await withProject(files, {}, async (p) => {
      const res = await runLoam(p.workDir, "list", "services");
      expect(res.out).toContain("1 unmarked");
      const json = JSON.parse((await runLoam(p.workDir, "list", "--json")).stdout);
      const web = json.services.find((s: { id: string }) => s.id === "checkout-web");
      expect(web.status).toBeNull();
    });
  });

  it("show reports the status and the sources of one service", async () => {
    await withProject(
      fixtureWith("service: payment-service\nstatus: draft\nowner: payments-team\nsources:\n  - src/payment.ts"),
      {},
      async (p) => {
        const res = await runLoam(p.workDir, "show", SVC);
        expect(res.out).toContain("draft");
        expect(res.out).toContain("src/payment.ts");

        const json = JSON.parse((await runLoam(p.workDir, "show", SVC, "--json")).stdout);
        expect(json.frontmatter.status).toBe("draft");
        expect(json.frontmatter.owner).toBe("payments-team");
        expect(json.frontmatter.sources).toEqual(["src/payment.ts"]);
      },
    );
  });
});
