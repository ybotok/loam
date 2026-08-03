/**
 * Deep invariant tests for `loam new` (src/commands/new.ts).
 *
 * The forward flow starts with four files nobody wants to write from a blank
 * page: intent.md, delta.likec4, and a spec.md (plus an openapi.yaml) per
 * service. `loam new` scaffolds them, and the templates have one hard job — a
 * freshly scaffolded feature must VALIDATE CLEAN. A scaffold that fails its own
 * validator on the first run teaches people to ignore the validator.
 *
 * Families:
 *  - directory naming and id round-tripping
 *  - refusal to clobber an existing (or archived) feature
 *  - what each template contains, and that the delta parses
 *  - --touches vs --new-service
 *  - the clean-validate criterion
 *  - --json contract and failure modes
 */
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { makeProject, makeTmpDir, runLoam, type Project } from "./helpers/harness.js";

async function withProject(
  files: Record<string, string>,
  fn: (p: Project) => Promise<void>,
): Promise<void> {
  const p = await makeProject(files);
  try {
    await fn(p);
  } finally {
    await p.destroy();
  }
}

describe("directory naming", () => {
  it("builds <id>-<slug> from the title", async () => {
    await withProject({}, async (p) => {
      const res = await runLoam(p.workDir, "new", "FEAT-101", "--title", "Payment splitting");
      expect(res.code).toBe(0);
      expect(p.exists("features/FEAT-101-payment-splitting/intent.md")).toBe(true);
    });
  });

  it("slugifies punctuation and casing", async () => {
    await withProject({}, async (p) => {
      await runLoam(p.workDir, "new", "FEAT-1", "--title", "Split  a Payment (v2)!");
      expect(p.exists("features/FEAT-1-split-a-payment-v2/intent.md")).toBe(true);
    });
  });

  it("uses the bare id when there is no usable slug", async () => {
    await withProject({}, async (p) => {
      await runLoam(p.workDir, "new", "FEAT-2");
      expect(p.exists("features/FEAT-2/intent.md")).toBe(true);

      await runLoam(p.workDir, "new", "FEAT-3", "--title", "!!!");
      expect(p.exists("features/FEAT-3/intent.md")).toBe(true);
    });
  });

  it("refuses an id the directory name could not give back", async () => {
    // `payment` has no number run, so `payment-split` would resolve to the id
    // `payment-split` — the feature would answer to a name it was not given.
    await withProject({}, async (p) => {
      const res = await runLoam(p.workDir, "new", "payment", "--title", "Split");
      expect(res.code).toBe(1);
      expect(res.out).toContain("payment");
      expect(p.exists("features/payment-split")).toBe(false);
    });
  });

  it("accepts any <word>-<number> id, not just FEAT", async () => {
    await withProject({}, async (p) => {
      const res = await runLoam(p.workDir, "new", "BUG-42", "--title", "Crash on save");
      expect(res.code).toBe(0);
      expect(p.exists("features/BUG-42-crash-on-save/intent.md")).toBe(true);
    });
  });

  it("is found by the id it was created with", async () => {
    await withProject({}, async (p) => {
      await runLoam(p.workDir, "new", "FEAT-101", "--title", "Payment splitting");
      const res = await runLoam(p.workDir, "show", "FEAT-101", "--json");
      expect(res.code).toBe(0);
      expect(JSON.parse(res.stdout).id).toBe("FEAT-101");
    });
  });
});

describe("refusal to clobber", () => {
  it("will not touch an existing feature directory", async () => {
    await withProject({ "features/FEAT-1-split/intent.md": "# mine\n" }, async (p) => {
      const res = await runLoam(p.workDir, "new", "FEAT-1", "--title", "Something else");
      expect(res.code).toBe(1);
      expect(await p.read("features/FEAT-1-split/intent.md")).toBe("# mine\n");
      expect(p.exists("features/FEAT-1-something-else")).toBe(false);
    });
  });

  it("will not reuse the id of an archived feature", async () => {
    await withProject({ "features/archive/FEAT-1-old/intent.md": "# shipped\n" }, async (p) => {
      const res = await runLoam(p.workDir, "new", "FEAT-1", "--title", "Take two");
      expect(res.code).toBe(1);
      expect(res.out.toLowerCase()).toContain("archive");
    });
  });
});

describe("templates", () => {
  const scaffold = async (p: Project): Promise<void> => {
    await runLoam(
      p.workDir,
      "new",
      "FEAT-101",
      "--title",
      "Payment splitting",
      "--touches",
      "payment-service",
      "--new-service",
      "payment-split-service",
    );
  };

  it("intent.md carries the feature id and a proposed status", async () => {
    await withProject({}, async (p) => {
      await scaffold(p);
      const intent = await p.read("features/FEAT-101-payment-splitting/intent.md");
      expect(intent.startsWith("---")).toBe(true);
      expect(intent).toContain("feature: FEAT-101");
      expect(intent).toContain("status: proposed");
      expect(intent).toContain("Payment splitting");
    });
  });

  it("delta.likec4 declares the feature tag and tags only the new service", async () => {
    await withProject({}, async (p) => {
      await scaffold(p);
      const delta = await p.read("features/FEAT-101-payment-splitting/delta.likec4");
      expect(delta).toContain("tag FEAT-101");
      expect(delta).toContain("'payment-split-service'");
      expect(delta).toContain("'payment-service'");
      // the new service is tagged; the pre-existing one is not
      const newBlock = delta.slice(delta.indexOf("'payment-split-service'"));
      expect(newBlock).toContain("#FEAT-101");
      const existingLine = delta
        .split("\n")
        .find((l) => l.includes("'payment-service'") && !l.includes("split"))!;
      expect(existingLine).not.toContain("#FEAT-101");
    });
  });

  it("delta.likec4 shows the operationId spine in a commented example", async () => {
    await withProject({}, async (p) => {
      await scaffold(p);
      const delta = await p.read("features/FEAT-101-payment-splitting/delta.likec4");
      expect(delta).toContain("metadata { op");
    });
  });

  it("a spec delta is written for every service, with an ADDED section and a scenario", async () => {
    await withProject({}, async (p) => {
      await scaffold(p);
      for (const svc of ["payment-service", "payment-split-service"]) {
        const spec = await p.read(`features/FEAT-101-payment-splitting/specs/${svc}/spec.md`);
        expect(spec).toContain("## ADDED Requirements");
        expect(spec).toContain("### Requirement:");
        expect(spec).toContain("#### Scenario:");
        expect(spec).toContain("SHALL");
      }
    });
  });

  it("the Operations line is present but commented — an unfilled template must not claim a contract", async () => {
    await withProject({}, async (p) => {
      await scaffold(p);
      const spec = await p.read(
        "features/FEAT-101-payment-splitting/specs/payment-split-service/spec.md",
      );
      expect(spec).toContain("Operations:");
      const opsLine = spec.split("\n").find((l) => l.includes("Operations:"))!;
      expect(opsLine.trimStart().startsWith("Operations:")).toBe(false);
    });
  });

  it("only a new service gets an openapi.yaml stub", async () => {
    await withProject({}, async (p) => {
      await scaffold(p);
      const base = "features/FEAT-101-payment-splitting/specs";
      expect(p.exists(`${base}/payment-split-service/openapi.yaml`)).toBe(true);
      expect(p.exists(`${base}/payment-service/openapi.yaml`)).toBe(false);
    });
  });

  it("the openapi stub is valid YAML with no operations yet", async () => {
    await withProject({}, async (p) => {
      await scaffold(p);
      const yaml = await p.read(
        "features/FEAT-101-payment-splitting/specs/payment-split-service/openapi.yaml",
      );
      expect(yaml).toContain("openapi:");
      expect(yaml).toContain("payment-split-service");
      const { parse } = await import("yaml");
      expect(parse(yaml).paths).toEqual({});
    });
  });

  it("scaffolds a feature with no services at all, and it still parses", async () => {
    await withProject({}, async (p) => {
      const res = await runLoam(p.workDir, "new", "FEAT-7", "--title", "Just an idea");
      expect(res.code).toBe(0);
      expect(p.exists("features/FEAT-7-just-an-idea/delta.likec4")).toBe(true);
      expect(p.exists("features/FEAT-7-just-an-idea/specs")).toBe(false);

      // an empty model with a view is the shape most likely to trip the parser
      const validated = await runLoam(p.workDir, "validate", "--feature", "FEAT-7", "--json");
      expect(validated.code).toBe(0);
      const codes = JSON.parse(validated.stdout).targets[0].findings.map(
        (f: { code: string }) => f.code,
      );
      expect(codes).toContain("delta.valid");
    });
  });

  it("reports every file it created", async () => {
    await withProject({}, async (p) => {
      const res = await runLoam(p.workDir, "new", "FEAT-1", "--new-service", "svc-a");
      expect(res.out).toContain("intent.md");
      expect(res.out).toContain("delta.likec4");
      expect(res.out).toContain("spec.md");
      expect(res.out).toContain("openapi.yaml");
    });
  });
});

describe("a fresh scaffold validates clean", () => {
  it("passes `validate --feature` with no parse errors and no findings against it", async () => {
    await withProject({}, async (p) => {
      await runLoam(
        p.workDir,
        "new",
        "FEAT-101",
        "--title",
        "Payment splitting",
        "--touches",
        "payment-service",
        "--new-service",
        "payment-split-service",
      );
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-101", "--json");
      expect(res.code).toBe(0);
      const json = JSON.parse(res.stdout);
      expect(json.valid).toBe(true);
      const codes = json.targets[0].findings.map((f: { code: string }) => f.code);
      expect(codes).toContain("delta.valid");
      expect(codes).toContain("coherence.ok");
      expect(codes).not.toContain("delta.invalid");
    });
  });

  it("passes `validate --all` alongside everything else", async () => {
    await withProject({}, async (p) => {
      await runLoam(p.workDir, "new", "FEAT-1", "--new-service", "svc-a");
      const res = await runLoam(p.workDir, "validate", "--all");
      expect(res.code).toBe(0);
    });
  });

  it("the scaffolded feature is projectable onto its service right away", async () => {
    await withProject({}, async (p) => {
      await runLoam(p.workDir, "new", "FEAT-1", "--new-service", "svc-a");
      const res = await runLoam(p.workDir, "delta", "FEAT-1", "--service", "svc-a", "--json");
      expect(res.code).toBe(0);
      const json = JSON.parse(res.stdout);
      expect(json.architecture.isNew).toBe(true);
      expect(json.requirements).toHaveLength(1);
      expect(json.requirements[0].scenarios).toHaveLength(1);
    });
  });
});

describe("--json contract and failures", () => {
  it("returns the feature id, its path and everything created", async () => {
    await withProject({}, async (p) => {
      const res = await runLoam(
        p.workDir,
        "new",
        "FEAT-101",
        "--title",
        "Payment splitting",
        "--new-service",
        "svc-a",
        "--json",
      );
      expect(res.code).toBe(0);
      const json = JSON.parse(res.stdout);
      expect(json.ok).toBe(true);
      expect(json.feature).toBe("FEAT-101");
      expect(json.path).toBe("features/FEAT-101-payment-splitting");
      expect(json.created).toContain("features/FEAT-101-payment-splitting/intent.md");
      expect(json.created).toContain("features/FEAT-101-payment-splitting/delta.likec4");
      expect(json.created).toContain(
        "features/FEAT-101-payment-splitting/specs/svc-a/openapi.yaml",
      );
    });
  });

  it("reports a clobber refusal inside the envelope", async () => {
    await withProject({ "features/FEAT-1-split/intent.md": "# mine\n" }, async (p) => {
      const res = await runLoam(p.workDir, "new", "FEAT-1", "--json");
      expect(res.code).toBe(1);
      const json = JSON.parse(res.stdout);
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("already-exists");
    });
  });

  it("reports a bad id inside the envelope", async () => {
    await withProject({}, async (p) => {
      const res = await runLoam(p.workDir, "new", "nonsense", "--json");
      expect(res.code).toBe(1);
      expect(JSON.parse(res.stdout).error.code).toBe("invalid-option");
    });
  });

  it("reports a missing config inside the envelope", async () => {
    const bare = await makeTmpDir();
    const res = await runLoam(bare, "new", "FEAT-1", "--json");
    expect(res.code).toBe(1);
    expect(JSON.parse(res.stdout).error.code).toBe("no-config");
  });

  it("writes nothing when the id is rejected", async () => {
    await withProject({}, async (p) => {
      await runLoam(p.workDir, "new", "nonsense");
      expect(p.exists("features")).toBe(false);
    });
  });

  it("does not create the same service twice when it is named both ways", async () => {
    await withProject({}, async (p) => {
      const res = await runLoam(
        p.workDir,
        "new",
        "FEAT-1",
        "--touches",
        "svc-a",
        "--new-service",
        "svc-a",
      );
      expect(res.code).toBe(0);
      const delta = await p.read("features/FEAT-1/delta.likec4");
      // declared once, as the new service it was flagged to be
      expect(delta.split("'svc-a'").length - 1).toBe(1);
      expect(await readFile(`${p.docsDir}/features/FEAT-1/specs/svc-a/spec.md`, "utf8")).toContain(
        "ADDED",
      );
    });
  });
});
