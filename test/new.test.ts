/**
 * Deep invariant tests for `loam new` (src/commands/new.ts).
 *
 * The forward flow starts with four files nobody wants to write from a blank
 * page: intent.md, delta.likec4, and a spec.md (plus an openapi.yaml) per
 * service. `loam new` scaffolds them, and the templates have two hard jobs that
 * pull against each other. A freshly scaffolded feature must VALIDATE WITHOUT
 * ERRORS — a scaffold that fails its own validator on the first run teaches
 * people to ignore the validator. And it must NOT ARCHIVE — the scaffold's
 * placeholder text is content nobody authored, and it used to reach the living
 * spec at exit 0 as a literal `TODO — name the behaviour` requirement. The line
 * between the two is the warn-that-gates: `intent.empty` and
 * `scaffold.placeholder` keep validate at exit 0 while refusing the archive.
 *
 * Families:
 *  - directory naming and id round-tripping
 *  - refusal to clobber an existing (or archived) feature
 *  - what each template contains, and that the delta parses
 *  - --touches vs --new-service
 *  - --capability, the inversion of --touches
 *  - the clean-validate criterion
 *  - --json contract and failure modes
 */
import { describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseRequirements } from "../src/core/document/parse.js";
import { REQUIREMENT_ID_RE } from "../src/core/document/spec.js";
import { makeProject, makeTmpDir, runLoam, treeHashes, type Project } from "./helpers/harness.js";
import { spawnLoam } from "./helpers/cli-process.js";
import { stageWrites, swapStaged } from "../src/core/staging/commit.js";
import { COMMIT_INTENT } from "../src/core/staging/interrupted.js";
import { writeTxnIntent } from "../src/core/staging/txn/journal.js";

/**
 * The floor of a docs repo: `services/` exists, even when it is empty — that is
 * what `loam init --create` scaffolds, and the enumeration refuses a directory
 * without it instead of reporting an empty fleet.
 */
const DOCS_REPO = { "services/.gitkeep": "" };

/**
 * The files that make `services/<svc>/` a living service. `--touches` names a
 * service that already exists (`--new-service` is what introduces one), so a
 * touched service with nothing behind it trips `delta.service-unknown`.
 */
function livingService(svc: string): Record<string, string> {
  return {
    [`services/${svc}/model.likec4`]: `specification {
  element softwareSystem
}

model {
  svc = softwareSystem '${svc}' {
    metadata {
      service '${svc}'
    }
  }
}
`,
    [`services/${svc}/spec.md`]: `# ${svc}

## Requirements

### Requirement: Exist
The service SHALL exist.

#### Scenario: It exists
- **Given** the fleet
- **When** it is listed
- **Then** ${svc} is in it
`,
  };
}

async function withProject(
  files: Record<string, string>,
  fn: (p: Project) => Promise<void>,
): Promise<void> {
  const p = await makeProject({ ...DOCS_REPO, ...files });
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

/**
 * `--capability`, the INVERSION of `--touches`: the analyst opens the document
 * that changes, and the service work is derived from it rather than named
 * before the business change is written.
 *
 * What these hold that a plausible wrong implementation would break:
 *
 * THE NESTED ID IS THE DISCRIMINATOR, exactly as it is in capability-delta.test.ts.
 * `payments/refunds` spells its nesting in the TREE, so a scaffold that joined
 * the id whole, escaped the slash, or resolved by the leaf would produce a
 * directory the walk in `core/capabilities/tree.ts` reads as a different
 * capability — or as none at all — and every downstream grade would then be
 * silently about the wrong document. A flat id cannot tell those apart.
 *
 * AND THE ID IS PATH INPUT. `capabilities/<id>/` is a chain of directories, so
 * `--capability ../../evil` lands `features/evil/spec.md` — a directory
 * `listFeatures` then enumerates as a feature — and one `..` further reaches the
 * docs-repo root. Both stay inside the repo, which is precisely the case
 * `resolveInside` cannot refuse, and the reason the grammar check exists at the
 * command boundary.
 */
describe("--capability", () => {
  const CAP = "features/FEAT-1/capabilities";

  it("scaffolds the capability delta and NO service spec — the services are not known yet", async () => {
    await withProject({}, async (p) => {
      const res = await runLoam(p.workDir, "new", "FEAT-1", "--capability", "refunds");
      expect(res.code, res.out).toBe(0);
      expect(p.exists(`${CAP}/refunds/spec.md`)).toBe(true);
      // The inversion, stated as an assertion: naming a capability must not
      // invent a service delta for a service nobody has named. intent.md and
      // delta.likec4 are unconditional and stay — `--capability` is additive,
      // and subtracting a file on the presence of a flag would change what
      // `loam new` means.
      expect(p.exists("features/FEAT-1/specs")).toBe(false);
      expect(p.exists("features/FEAT-1/intent.md")).toBe(true);
      expect(p.exists("features/FEAT-1/delta.likec4")).toBe(true);
    });
  });

  it("spells a nested id as one directory per segment, never by its leaf or as one name", async () => {
    await withProject({}, async (p) => {
      const res = await runLoam(p.workDir, "new", "FEAT-1", "--capability", "payments/refunds");
      expect(res.code, res.out).toBe(0);
      expect(p.exists(`${CAP}/payments/refunds/spec.md`)).toBe(true);
      // The three wrong answers, each named: the leaf alone is a DIFFERENT
      // capability, and either flattened spelling is a directory the walk reads
      // as one capability called something nobody wrote.
      expect(p.exists(`${CAP}/refunds`)).toBe(false);
      expect(p.exists(`${CAP}/payments%2Frefunds`)).toBe(false);
      expect(p.exists(`${CAP}/payments-refunds`)).toBe(false);
      // And the document names the capability by its full id, so the delta and
      // the living document it merges into cannot disagree about which it is.
      expect(await p.read(`${CAP}/payments/refunds/spec.md`)).toContain("payments/refunds");
    });
  });

  it("composes with --touches: one feature can carry the promise and a service that keeps it", async () => {
    // Refusing the combination would fight this axis's own archive gate —
    // `capability.uncovered` refuses a promise nothing in the same feature
    // keeps, and the fix it names IS a `--touches` service's `Realizes:` line.
    await withProject(livingService("payment-service"), async (p) => {
      const res = await runLoam(
        p.workDir, "new", "FEAT-1", "--capability", "refunds", "--touches", "payment-service",
      );
      expect(res.code, res.out).toBe(0);
      expect(p.exists(`${CAP}/refunds/spec.md`)).toBe(true);
      expect(p.exists("features/FEAT-1/specs/payment-service/spec.md")).toBe(true);
    });
  });

  it("is repeatable, and a parent capability may be scaffolded beside one nested in it", async () => {
    await withProject({}, async (p) => {
      const res = await runLoam(
        p.workDir, "new", "FEAT-1", "--capability", "payments", "--capability", "payments/refunds",
      );
      expect(res.code, res.out).toBe(0);
      expect(p.exists(`${CAP}/payments/spec.md`)).toBe(true);
      expect(p.exists(`${CAP}/payments/refunds/spec.md`)).toBe(true);
    });
  });

  it("refuses an id that would write outside the feature, and writes nothing at all", async () => {
    // Inside the docs repo but outside the feature: `resolveInside` sees a path
    // under docsDir and permits it, so the grammar is the only thing standing
    // between argv and these two. Both paths are asserted because they are two
    // different escapes — `features/evil/` is a directory `listFeatures`
    // enumerates as a feature, `<docsDir>/evil/` is loose in the repo root —
    // and each is the path the guard's own comment names.
    await withProject({}, async (p) => {
      for (const [bad, landing] of [
        ["../../evil", "features/evil"],
        ["../../../evil", "evil"],
      ]) {
        const res = await runLoam(p.workDir, "new", "FEAT-1", "--capability", bad!, "--json");
        expect(res.code, `'${bad}' must be refused`).toBe(1);
        expect(JSON.parse(res.stdout).error.code).toBe("invalid-option");
        expect(p.exists(landing!), `nothing may land at ${landing}`).toBe(false);
        expect(p.exists("features/FEAT-1")).toBe(false);
      }
    });
  });

  it("refuses an empty segment and a Windows-hostile one, before any write", async () => {
    await withProject({}, async (p) => {
      for (const bad of ["", "payments/", "payments/CON", "payments/refunds."]) {
        const res = await runLoam(p.workDir, "new", "FEAT-1", "--capability", bad, "--json");
        expect(res.code, `'${bad}' must be refused`).toBe(1);
        expect(JSON.parse(res.stdout).error.code).toBe("invalid-option");
      }
      expect(p.exists("features/FEAT-1")).toBe(false);
    });
  });

  it("scaffolds a body that declares nothing until a person copies it out", async () => {
    // The same idiom as the two spec templates: the example sits INSIDE an HTML
    // comment, indented past the line-anchored heading patterns, so a fresh
    // scaffold parses to zero requirements. That is what keeps `loam validate`
    // green on a scaffold nobody has touched — while `scaffold.placeholder`
    // still refuses the archive once the block is copied out unedited
    // (capability-delta.test.ts holds that half).
    await withProject({}, async (p) => {
      await runLoam(p.workDir, "new", "FEAT-1", "--capability", "refunds");
      const doc = await p.read(`${CAP}/refunds/spec.md`);
      expect(parseRequirements(doc)).toEqual([]);
      expect(doc).toContain("TODO — name the promise");
      // The altitude rule the document invites breaking, spelled where the
      // author reads it: the four service-scoped lines are errors here.
      expect(doc).toContain("Operations:");
      expect(doc).toContain("Realizes: refunds#<Requirement-ID>");
    });
  });

  it("a fresh --capability scaffold validates without errors", async () => {
    await withProject({}, async (p) => {
      await runLoam(p.workDir, "new", "FEAT-1", "--capability", "refunds");
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json");
      expect(res.code, res.out).toBe(0);
      expect(JSON.parse(res.stdout).valid).toBe(true);
    });
  });

  it("--json lists the capability delta among what it created, and notes the unnamed capability", async () => {
    await withProject({}, async (p) => {
      const res = await runLoam(p.workDir, "new", "FEAT-1", "--capability", "refunds", "--json");
      expect(res.code).toBe(0);
      const json = JSON.parse(res.stdout);
      expect(json.created).toContain("features/FEAT-1/capabilities/refunds/spec.md");
      // A NOTE, not a refusal: a capability the fleet has never named is exactly
      // what an analyst opening a new business area types, and the archive that
      // lands this feature is what creates the living document.
      expect(json.notes.join("\n")).toContain("has not named yet");
      expect(json.notes.join("\n")).toContain("capabilities/refunds/spec.md");
    });
  });

  it("offers the close names, and points the way out at THIS feature's directory", async () => {
    // The failure a refusal would have caught, kept catchable without one:
    // `refund` against a living `refunds` is a second capability created out of
    // nothing, with the promise filed where nobody looks.
    await withProject(
      { "capabilities/refunds/spec.md": "# refunds\n\n## Requirements\n" },
      async (p) => {
        const res = await runLoam(p.workDir, "new", "FEAT-1", "--capability", "refund", "--json");
        expect(res.code).toBe(0);
        const notes = JSON.parse(res.stdout).notes.join("\n") as string;
        expect(notes).toContain("'refunds'");
        // loam ships instructions people and agents type back, and `features/`
        // holds every in-flight feature in a SHARED docs repo — so the way out
        // names this feature's own directory and nothing wider.
        expect(notes).toContain("features/FEAT-1/capabilities/refund/");
        expect(notes).toContain("delete features/FEAT-1/");
        expect(notes).not.toMatch(/delete features\/(?![A-Za-z])/);
      },
    );
  });

  it("does not report a nested capability's own PARENT as a near-miss", async () => {
    // Nesting spelled by the tree is this axis's headline shape, so a rule that
    // matches on substring reports `payments/refunds` as a misspelling of
    // `payments` — and then instructs the author to re-scaffold at the wrong
    // altitude. `nearestIds` (edit distance) is the "did you misspell a
    // directory" rule; `closeIds` (substring/prefix) answers a different
    // question and belongs to the C4 element resolver.
    await withProject(
      { "capabilities/payments/spec.md": "# payments\n\n## Requirements\n" },
      async (p) => {
        const res = await runLoam(p.workDir, "new", "FEAT-1", "--capability", "payments/refunds", "--json");
        expect(res.code).toBe(0);
        const notes = JSON.parse(res.stdout).notes.join("\n") as string;
        expect(notes).toContain("has not named yet");
        expect(notes).not.toContain("If you meant");
      },
    );
  });

  it("scaffolds a Requirement-ID hint the requirement grammar actually accepts", async () => {
    // A capability id may start with a digit (`3ds`, `2fa`, `1099-filing`) —
    // `dirNameHazard` allows an alphanumeric head — while REQUIREMENT_ID_RE
    // demands a LETTER. The obvious slug hands the author `3DS-1`, and
    // `delta.requirement-id-invalid` then refuses them for using the shape the
    // scaffold offered.
    await withProject({}, async (p) => {
      await runLoam(p.workDir, "new", "FEAT-1", "--capability", "3ds");
      const doc = await p.read(`${CAP}/3ds/spec.md`);
      const hint = /Requirement-ID: (\S+)/.exec(doc)?.[1];
      expect(hint, "the template must offer a Requirement-ID").toBeDefined();
      expect(REQUIREMENT_ID_RE.test(hint!), `'${hint!}' must satisfy the requirement-id grammar`).toBe(true);
    });
  });

  it("tells a YAML-only capability apart from one nobody has named", async () => {
    // The ordinary mid-adoption state: the fleet declared the word and nobody
    // has written the prose. The two notes point at different fixes — write the
    // document, versus check you meant this word at all — so a message that
    // could not tell them apart would send its reader the wrong way.
    await withProject(
      { "architecture/capabilities.yaml": "capabilities:\n  refunds:\n    owner: payments-team\n" },
      async (p) => {
        const res = await runLoam(p.workDir, "new", "FEAT-1", "--capability", "refunds", "--json");
        expect(res.code).toBe(0);
        const notes = JSON.parse(res.stdout).notes.join("\n");
        expect(notes).toContain("declared in architecture/capabilities.yaml");
        expect(notes).not.toContain("has not named yet");
      },
    );
  });

  it("names the living document's requirement ids — what a MODIFIED delta addresses", async () => {
    await withProject(
      {
        "capabilities/refunds/spec.md":
          "# refunds\n\n## Requirements\n\n### Requirement: Refund within five days\nRequirement-ID: REF-1\n\nThe fleet SHALL refund within five days.\n\n#### Scenario: It is refunded\n- **Given** a customer\n- **When** they ask\n- **Then** it is refunded\n",
      },
      async (p) => {
        const res = await runLoam(p.workDir, "new", "FEAT-1", "--capability", "refunds", "--json");
        expect(res.code).toBe(0);
        const notes = JSON.parse(res.stdout).notes.join("\n");
        expect(notes).toContain("already has capabilities/refunds/spec.md");
        expect(notes).toContain("REF-1");
      },
    );
  });
});

describe("a fresh scaffold validates without errors, and cannot archive", () => {
  it("passes `validate --feature` with no parse errors — the unauthored state is warnings, not failure", async () => {
    // payment-split-service is introduced by the delta's own tagged element;
    // payment-service is merely touched, so it has to already exist.
    await withProject(livingService("payment-service"), async (p) => {
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
      const findings = json.targets[0].findings as Array<{ code: string; gates?: boolean; severity: string }>;
      const codes = findings.map((f) => f.code);
      expect(codes).toContain("delta.valid");
      expect(codes).not.toContain("delta.invalid");
      // The unauthored state is named, as warnings that GATE the archive: the
      // intent says nothing and the new service's description is the template's
      // TODO. The comment-only spec example declares no requirement, so no
      // requirement-level sentinel can fire on a fresh scaffold.
      for (const code of ["intent.empty", "scaffold.placeholder"]) {
        const f = findings.find((x) => x.code === code);
        expect(f, code).toBeDefined();
        expect(f!.severity).toBe("warn");
        expect(f!.gates).toBe(true);
      }
    });
  });

  it("the archive refuses the unauthored scaffold — placeholders never reach the living docs", async () => {
    await withProject({}, async (p) => {
      await runLoam(p.workDir, "new", "FEAT-1", "--title", "Split", "--new-service", "svc-a");
      const blocked = await runLoam(p.workDir, "archive", "FEAT-1", "--json");
      expect(blocked.code).toBe(1);
      const refusal = JSON.parse(blocked.stdout + blocked.stderr) as {
        error: { code: string };
        issues: Array<{ code: string; gates: boolean; overridable: boolean }>;
      };
      expect(refusal.error.code).toBe("not-coherent");
      for (const code of ["intent.empty", "scaffold.placeholder"]) {
        expect(refusal.issues).toContainEqual(
          expect.objectContaining({ code, gates: true, overridable: true }),
        );
      }
      // Nothing was merged: the service the scaffold would have created is not there.
      expect(p.exists("services/svc-a")).toBe(false);
    });
  });

  /**
   * Scaffold FEAT-1 with NO service, then put intent.md back through `rewrite`.
   *
   * No service on purpose. A scaffolded service description raises
   * `scaffold.placeholder` and refuses the archive on its own, which is exactly
   * how the encoding hole below stayed invisible: with the description gone,
   * the unwritten intent is the only thing standing between the scaffold and
   * the living docs, so the EXIT CODE discriminates and not merely the issue
   * list. `--title Split` fixes the directory as features/FEAT-1-split.
   */
  const scaffoldThenRewriteIntent = async (
    p: Project,
    rewrite: (text: string) => string,
  ): Promise<void> => {
    await runLoam(p.workDir, "new", "FEAT-1", "--title", "Split");
    const path = "features/FEAT-1-split/intent.md";
    await p.write(path, rewrite(await p.read(path)));
  };

  it("a CRLF rewrite of the scaffolded intent.md says no more than it did — the archive still refuses", async () => {
    // The hole this pins: `hasProse` matched the frontmatter fence with `^---\n`,
    // so in a CRLF file `---\r` was not the fence, the frontmatter survived the
    // strip and counted as the author's prose. `intent.empty` went quiet and the
    // untouched scaffold archived at exit 0 through the exact gate built to
    // refuse it — and any editor on Windows produces this file by saving it.
    await withProject({}, async (p) => {
      await scaffoldThenRewriteIntent(p, (text) => text.replace(/\n/g, "\r\n"));
      const before = await treeHashes(p.docsDir);

      const blocked = await runLoam(p.workDir, "archive", "FEAT-1", "--json");
      expect(blocked.code).toBe(1);
      const refusal = JSON.parse(blocked.stdout + blocked.stderr) as {
        error: { code: string };
        issues: Array<{ code: string; gates: boolean }>;
      };
      expect(refusal.error.code).toBe("not-coherent");
      expect(refusal.issues).toContainEqual(
        expect.objectContaining({ code: "intent.empty", gates: true }),
      );
      // A refusal that half-merged would be the worse defect: the feature is
      // still in flight, and not one byte of the docs repo moved.
      expect(await treeHashes(p.docsDir)).toEqual(before);
    });
  });

  it("a byte-order mark in front of the scaffolded intent.md does not make it authored either", async () => {
    // Same hole, reached by the other invisible byte: with a BOM ahead of it the
    // opening `---` was no longer at index 0, the fence did not match, and the
    // frontmatter read as prose. The mark is spelled as an escape here for the
    // reason sentinels.ts gives — a raw one is invisible in review and to grep.
    await withProject({}, async (p) => {
      await scaffoldThenRewriteIntent(p, (text) => `\uFEFF${text}`);
      const before = await treeHashes(p.docsDir);

      const blocked = await runLoam(p.workDir, "archive", "FEAT-1", "--json");
      expect(blocked.code).toBe(1);
      const refusal = JSON.parse(blocked.stdout + blocked.stderr) as {
        error: { code: string };
        issues: Array<{ code: string; gates: boolean }>;
      };
      expect(refusal.error.code).toBe("not-coherent");
      expect(refusal.issues).toContainEqual(
        expect.objectContaining({ code: "intent.empty", gates: true }),
      );
      expect(await treeHashes(p.docsDir)).toEqual(before);
    });
  });

  it("one line of authored prose clears intent.empty and the same scaffold archives", async () => {
    // The control the two tests above need: this fixture is one sentence away
    // from shipping, so their exit 1 is the unwritten intent being refused and
    // not some unrelated thing the archive dislikes about a service-less feature.
    await withProject({}, async (p) => {
      await scaffoldThenRewriteIntent(p, (text) =>
        text.replace("## Why\n", "## Why\n\nPayments arrive as one amount and land on several ledgers.\n"),
      );
      const shipped = await runLoam(p.workDir, "archive", "FEAT-1", "--json");
      expect(shipped.code).toBe(0);
      expect(JSON.parse(shipped.stdout).ok).toBe(true);
      expect(p.exists("features/archive/FEAT-1-split/intent.md")).toBe(true);
    });
  });

  it("passes `validate --all` alongside everything else", async () => {
    await withProject({}, async (p) => {
      await runLoam(p.workDir, "new", "FEAT-1", "--new-service", "svc-a");
      const res = await runLoam(p.workDir, "validate", "--all");
      expect(res.code).toBe(0);
    });
  });

  it("the scaffolded feature is projectable onto its service right away — and declares nothing", async () => {
    await withProject({}, async (p) => {
      await runLoam(p.workDir, "new", "FEAT-1", "--new-service", "svc-a");
      const res = await runLoam(p.workDir, "delta", "FEAT-1", "--service", "svc-a", "--json");
      expect(res.code).toBe(0);
      const json = JSON.parse(res.stdout);
      expect(json.architecture.isNew).toBe(true);
      // ZERO requirements, deliberately: the template's example lives inside an
      // HTML comment, past the line-anchored heading patterns, so the scaffold
      // ships no requirement nobody wrote. It used to ship exactly one — a
      // literal `TODO — name the behaviour` that archived into the living spec.
      expect(json.requirements).toHaveLength(0);
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

  it("refuses a docsDir that is not a docs repo instead of scaffolding into it", async () => {
    // `makeProject` rather than `withProject`: that helper lays down the
    // `services/` floor every other test in this file needs, and its absence IS
    // the case. `features/<id>/**` lands happily in any directory, so before
    // the gate `new` reported ok over a scaffold no enumeration downstream will
    // ever see — and every id passed to --touches/--new-service is a claim
    // about `services/<id>/`, so a run without that directory is guessing.
    const p = await makeProject({});
    try {
      const res = await runLoam(p.workDir, "new", "FEAT-1", "--title", "Split", "--json");
      expect(res.code).toBe(1);
      const json = JSON.parse(res.stdout);
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe("services-missing");
      expect(json.error.message).toContain("no services/ directory");
      expect(p.exists("features"), "the refusal must come before the first write").toBe(false);
    } finally {
      await p.destroy();
    }
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

/* ------------------------------------------------------------------ */
/* A scaffold killed mid-commit                                        */
/* ------------------------------------------------------------------ */

/**
 * `new` used to be a sequential `writeFile` loop with no plan, no lock and no
 * journal: a crash left a partial feature directory that every later run
 * refused as `already-exists`, so the half scaffold was permanent. It now
 * builds the whole plan in memory, takes the docs lock, and commits through the
 * journaled transaction — every write an exclusive create, because the feature
 * must not exist.
 */
const NEW_ARGS = ["new", "FEAT-9", "--title", "Split", "--new-service", "svc-a"];
const FEAT_9 = "features/FEAT-9-split";

interface Scaffold {
  tree: Record<string, string>;
  created: string[];
  bytes: string[];
}

/** A scaffold nothing interrupted: the tree it leaves, and the bytes of every file in it. */
async function cleanScaffold(): Promise<Scaffold> {
  const p = await makeProject(DOCS_REPO);
  try {
    const res = await runLoam(p.workDir, ...NEW_ARGS, "--json");
    expect(res.code, res.out).toBe(0);
    const created = JSON.parse(res.stdout).created as string[];
    return {
      tree: await treeHashes(p.docsDir),
      created,
      bytes: await Promise.all(created.map((rel) => p.read(rel))),
    };
  } finally {
    await p.destroy();
  }
}

/**
 * Drive the scaffold's exclusive creates to a boundary and stop there, as a
 * SIGKILL after the k-th link(2) would: the journal is fsynced, the temps hold
 * the rest, and `links` of the files exist.
 */
async function killMidScaffold(p: Project, scaffold: Scaffold, links: number): Promise<void> {
  const staged = await stageWrites(
    scaffold.created.map((rel, i) => ({ path: join(p.docsDir, rel), content: scaffold.bytes[i]!, exclusive: true })),
  );
  await writeTxnIntent(
    { root: p.docsDir, command: "new", rerun: "loam new FEAT-9", target: "FEAT-9" },
    staged,
  );
  await swapStaged(staged.slice(0, links));
}

/** Only the killed feature's files — the rest of a docs repo is not under comparison. */
function subtree(tree: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(tree).filter(([k]) => k.startsWith(FEAT_9)));
}

describe("a scaffold killed after the k-th link", () => {
  it("leaves a journal, and doctor names the command that owns the repair", async () => {
    const scaffold = await cleanScaffold();
    await withProject({}, async (p) => {
      await killMidScaffold(p, scaffold, 1);
      // Half a feature: intent.md landed, the four files behind it did not.
      expect(p.exists(`${FEAT_9}/intent.md`)).toBe(true);
      expect(p.exists(`${FEAT_9}/delta.likec4`)).toBe(false);
      expect(p.exists(COMMIT_INTENT)).toBe(true);

      const finding = JSON.parse((await runLoam(p.workDir, "doctor", "--json")).stdout).findings.find(
        (f: { code: string }) => f.code === "doctor.commit-interrupted",
      );
      expect(finding).toBeDefined();
      expect(finding.severity).toBe("blocker");
      expect(finding.fix).toContain("loam new FEAT-9");
      expect(finding.message).toContain(`${FEAT_9}/delta.likec4`);
    });
  });

  it("is completed by the re-run doctor prints, which then refuses already-exists over a WHOLE scaffold", async () => {
    // Both halves of the pair, in one run and in this order. There is no
    // unlocked existence fast-path: staging creates the feature directory at
    // plan time, so a half-scaffold resolves like a finished feature, and an
    // unlocked refusal here answered `already-exists` over the run's own
    // wreckage without ever reaching the recovery that completes it — while
    // `doctor` printed exactly this re-run as the fix. Existence is now asked
    // once, under the lock, AFTER recovery: the refusal is still exit 1, but it
    // is now true, and the scaffold behind it is whole.
    const scaffold = await cleanScaffold();
    await withProject({}, async (p) => {
      await killMidScaffold(p, scaffold, 1);

      const res = await runLoam(p.workDir, ...NEW_ARGS, "--json");
      expect(res.code).toBe(1);
      expect(JSON.parse(res.stdout).error.code).toBe("already-exists");

      // Recovery ran first: every file the killed run planned is there, byte
      // for byte what a clean scaffold writes, and the journal is gone.
      for (const rel of scaffold.created) expect(p.exists(rel), rel).toBe(true);
      expect(subtree(await treeHashes(p.docsDir))).toEqual(subtree(scaffold.tree));
      expect(p.exists(COMMIT_INTENT)).toBe(false);
    });
  });

  it("completes the scaffold from every boundary, including one where nothing had linked yet", async () => {
    // The refusal is the same at k=0, k=1 and k=all — what differs is how much
    // roll-forward had to do, and the answer must not depend on that.
    const scaffold = await cleanScaffold();
    for (const links of [0, scaffold.created.length]) {
      await withProject({}, async (p) => {
        await killMidScaffold(p, scaffold, links);
        const res = await runLoam(p.workDir, ...NEW_ARGS, "--json");
        expect(res.code, `links=${links}`).toBe(1);
        expect(JSON.parse(res.stdout).error.code, `links=${links}`).toBe("already-exists");
        expect(subtree(await treeHashes(p.docsDir)), `links=${links}`).toEqual(subtree(scaffold.tree));
        expect(p.exists(COMMIT_INTENT), `links=${links}`).toBe(false);
      });
    }
  });

  it("is completed by the next `new` that gets as far as the lock, byte for byte", async () => {
    // A different id passes the pre-check above, so this run reaches the
    // recovery — and rolls the FEAT-9 scaffold forward to exactly the files a
    // clean run wrote, before scaffolding its own.
    const scaffold = await cleanScaffold();
    await withProject({}, async (p) => {
      await killMidScaffold(p, scaffold, 1);

      const res = await runLoam(p.workDir, "new", "FEAT-10", "--title", "Other", "--json");
      expect(res.code, res.out).toBe(0);
      expect(JSON.parse(res.stdout).recovered).toMatchObject({
        command: "new",
        feature: "FEAT-9",
        outcome: "repaired",
      });
      for (const rel of scaffold.created) expect(p.exists(rel), rel).toBe(true);
      expect(subtree(await treeHashes(p.docsDir))).toEqual(subtree(scaffold.tree));
      expect(p.exists(COMMIT_INTENT)).toBe(false);
    });
  });
});

describe("two real processes scaffolding one feature", () => {
  it("produces exactly one scaffold, a stable refusal for the loser, and no residue", async () => {
    const scaffold = await cleanScaffold();
    await withProject({}, async (p) => {
      const runs = await Promise.all([
        spawnLoam(p.workDir, ...NEW_ARGS, "--json"),
        spawnLoam(p.workDir, ...NEW_ARGS, "--json"),
      ]);
      const output = runs.map((r) => r.stdout + r.stderr).join("\n---\n");
      expect(runs.filter((r) => r.code === 0), output).toHaveLength(1);

      // The loser lost the under-lock re-check or the exclusive create; either
      // way the answer is the same stable refusal, never a merged scaffold.
      const loser = JSON.parse(runs.find((r) => r.code !== 0)!.stdout);
      expect(loser.ok).toBe(false);
      expect(["already-exists", "docs-busy"]).toContain(loser.error.code);

      // One complete scaffold, byte for byte, with neither dotfile behind it.
      expect(subtree(await treeHashes(p.docsDir))).toEqual(subtree(scaffold.tree));
      expect((await readdir(p.docsDir)).filter((n) => n.startsWith("."))).toEqual([]);
    });
  }, 60_000);
});
