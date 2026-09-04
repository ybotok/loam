/**
 * `c4.fleet-project-invalid` — the state no per-document grade can reach: every
 * document loam reads is clean, and the project the RENDERER builds out of them
 * is not.
 *
 * loam grades a fleet document by document on purpose, so one broken model
 * cannot blank the fleet. The renderer has no such rule: point `npx likec4
 * start` at the docs root and it merges the map, every extending model and every
 * `.likec4` beside one into ONE project. A tag or an element declared in two of
 * those documents is a duplicate THERE and nowhere else — two services, two
 * green grades, and a renderer that draws nothing.
 *
 * The second thing this load makes possible rides with it: an extending model's
 * authored view ids share the root project's flat namespace with the map's, so
 * the `subsystem.view-id-collision` census can finally see them.
 */
import { describe, expect, it } from "vitest";
import { LIVING_OPENAPI, LIVING_SPEC, makeProject, runLoam, type Project } from "./helpers/harness.js";

interface JsonFinding {
  severity: string;
  code: string;
  subject?: string;
  message: string;
  locations?: Array<{ path: string; role: string }>;
}

interface Payload {
  targets: Array<{ kind: string; id: string; findings: JsonFinding[] }>;
}

function codeFor(stdout: string, code: string): JsonFinding[] {
  return (JSON.parse(stdout) as Payload).targets.flatMap((t) => t.findings).filter((f) => f.code === code);
}

const CODE = "c4.fleet-project-invalid";

/** The map: two bound services, and the kinds their models extend with. */
const MAP = `specification {
  element softwareSystem
  element container
}

model {
  svcA = softwareSystem 'svc-a' {
    metadata { service 'svc-a' }
  }
  svcB = softwareSystem 'svc-b' {
    metadata { service 'svc-b' }
  }
}

views {
  view landscape {
    include *
  }
}
`;

/** An extending model, optionally carrying a tags-only `specification` of its own. */
function extending(el: string, spec = ""): string {
  return `${spec}model {\n  extend ${el} {\n    api = container 'api'\n  }\n}\n`;
}

function spec(id: string): string {
  return LIVING_SPEC.replace(/payment-service/g, id);
}

/** A root `likec4.config.json` with the given `exclude` list — `makeProject` writes none. */
function rootWith(exclude: readonly string[]): string {
  return `${JSON.stringify({ name: "fleet", title: "Fleet landscape", exclude: [...exclude] }, null, 2)}\n`;
}

async function fleet(files: Record<string, string>): Promise<Project> {
  return makeProject({
    "architecture/landscape.likec4": MAP,
    "services/svc-a/model.likec4": extending("svcA"),
    "services/svc-a/spec.md": spec("svc-a"),
    "services/svc-a/openapi.yaml": LIVING_OPENAPI,
    "services/svc-b/model.likec4": extending("svcB"),
    "services/svc-b/spec.md": spec("svc-b"),
    "services/svc-b/openapi.yaml": LIVING_OPENAPI,
    ...files,
  });
}

describe("c4.fleet-project-invalid — clean apart, broken together", () => {
  // Catches: the merged load dropped, and the whole class going invisible. A
  // tags-only `specification { tag req-X }` in an extending model is LEGAL
  // (measured at the 1.59.2 pin) and lands the tag in the project's table — so
  // the SAME tag in a second model is a duplicate blamed on both files, while
  // each service's own project holds only one of them and grades green.
  it("two extending models declaring one tag locally: one finding per file, subject = its service", async () => {
    const p = await fleet({
      "services/svc-a/model.likec4": extending("svcA", "specification {\n  tag req-X\n}\n\n"),
      "services/svc-b/model.likec4": extending("svcB", "specification {\n  tag req-X\n}\n\n"),
    });
    try {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      // Every document still grades clean where loam reads it.
      expect(codeFor(res.stdout, "c4.invalid")).toEqual([]);
      expect(codeFor(res.stdout, "c4.valid")).toHaveLength(2);

      const merged = codeFor(res.stdout, CODE);
      expect(merged.length).toBeGreaterThanOrEqual(2);
      expect(merged.every((f) => f.severity === "warn")).toBe(true);
      expect([...new Set(merged.map((f) => f.subject))].sort()).toEqual(["svc-a", "svc-b"]);
      const messages = merged.map((f) => f.message).join("\n");
      expect(messages).toContain("services/svc-a/model.likec4:");
      expect(messages).toContain("services/svc-b/model.likec4:");
      expect(messages).toContain("the renderer merges every `.likec4` the root project reads except the generated subsystems.likec4");
      // A warning: the picture is broken, nothing loam concludes is.
      expect(res.code).toBe(0);
      expect(JSON.parse(res.stdout).valid).toBe(true);
    } finally {
      await p.destroy();
    }
  });

  // Catches: the check running where it cannot see the fleet. A single-target
  // run has not enumerated the models, so it cannot build the project at all —
  // and half an answer here would be a finding that comes and goes with a flag.
  it("silent under --service, which cannot build the project at all", async () => {
    const p = await fleet({
      "services/svc-a/model.likec4": extending("svcA", "specification {\n  tag req-X\n}\n\n"),
      "services/svc-b/model.likec4": extending("svcB", "specification {\n  tag req-X\n}\n\n"),
    });
    try {
      const res = await runLoam(p.workDir, "validate", "--service", "svc-a", "--json");
      expect(codeFor(res.stdout, CODE)).toEqual([]);
      expect(codeFor(res.stdout, "c4.valid")).toHaveLength(1);
    } finally {
      await p.destroy();
    }
  });

  // Catches: the set difference narrowed to documents somebody opted into. A
  // sibling that mentions no reserved tag is loaded by NEITHER the per-service
  // project nor the flow scan, so the merged project is the only reader that
  // can report it — and it is renderer-fatal for the whole root project.
  it("a broken sibling nobody opted into is reported here, and nowhere else", async () => {
    const p = await fleet({ "services/svc-a/usecases/hand-drawn.likec4": "views {\n  view broken {\n    include nosuchelement\n" });
    try {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      const merged = codeFor(res.stdout, CODE);
      expect(merged.length).toBeGreaterThanOrEqual(1);
      expect(merged.every((f) => f.subject === "svc-a")).toBe(true);
      expect(merged.map((f) => f.message).join("\n")).toContain("services/svc-a/usecases/hand-drawn.likec4:");
      // The model itself still parses where loam grades it.
      expect(codeFor(res.stdout, "c4.invalid")).toEqual([]);
    } finally {
      await p.destroy();
    }
  });

  // Catches: the set difference dropped, so an error the service target already
  // reported is repeated here under a second code — N copies of one cascade
  // being the exact failure this check's own gate exists to avoid.
  it("an error already reported as c4.invalid is not repeated", async () => {
    const p = await fleet({ "services/svc-a/model.likec4": "model {\n  extend svcA {\n    db = database 'x'\n  }\n}\n" });
    try {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(codeFor(res.stdout, "c4.invalid")).toHaveLength(1);
      expect(codeFor(res.stdout, CODE)).toEqual([]);
    } finally {
      await p.destroy();
    }
  });

  // Catches: the document set built from three ROOTS rather than from the tree.
  // `services/platform/notes.likec4` — the parent of service directories — was
  // in none of them, so `validate --all` came back byte-identical to baseline
  // and never named the file while `npx likec4 validate --project fleet .`
  // reported Invalid over the same tree (verification 2026-09-04, R2). The same
  // file one directory lower was a loud error.
  it("reads a `.likec4` in a SUBSYSTEM directory, above every service", async () => {
    const p = await fleet({
      "services/platform/subsystem.yaml": "title: Platform\n",
      "services/platform/notes.likec4": "model {\n  svcA = softwareSystem 'a second svc-a'\n}\n",
    });
    try {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      const merged = codeFor(res.stdout, CODE);
      expect(merged.length, res.stdout).toBeGreaterThanOrEqual(1);
      const named = merged.find((f) => f.message.includes("services/platform/notes.likec4"));
      expect(named, res.stdout).toBeDefined();
      // The file the error is IN — `locations[0].path` used to be the map on
      // every one of these, so a reader acting on the payload opened the wrong
      // document (verification 2026-09-04, D10).
      expect(named?.locations).toEqual([{ path: "services/platform/notes.likec4", role: "primary" }]);
      // 1-based, the way an editor counts: the duplicate is on line 2 of a
      // three-line document. LikeC4 hands over an LSP range that starts at 0.
      expect(named?.message).toContain("services/platform/notes.likec4: L2:");
      // And the tail names the failure it actually is.
      expect(named?.message).toContain("declared twice there");
    } finally {
      await p.destroy();
    }
  });

  // Catches: the tail that always blamed a double declaration. An unresolved
  // reference has no second declaration to find, and telling its reader to
  // "declare it once" sends them looking for one (verification 2026-09-04, D10).
  it("names the error class it actually is, not always a double declaration", async () => {
    const p = await fleet({ "services/svc-a/usecases/hand.likec4": "views {\n  view v {\n    include ghostElement\n  }\n}\n" });
    try {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      const merged = codeFor(res.stdout, CODE);
      expect(merged.length, res.stdout).toBeGreaterThanOrEqual(1);
      const messages = merged.map((f) => f.message).join("\n");
      expect(messages).not.toContain("declared twice there");
      expect(messages).toContain("no document in the project declares");
    } finally {
      await p.destroy();
    }
  });

  // Catches: this grade run against a project the root `exclude` already broke.
  // The architecture loader keeps the map whatever that list says; THIS load has
  // no such floor, on purpose, because its whole claim is to read what the
  // renderer reads — so an entry covering `architecture/landscape.likec4` leaves
  // every extending model's `extend <fqn>` resolving against nothing. Measured
  // on `examples/docs` with `architecture/*.likec4` in the list: one authored
  // line came back as 1 × `landscape.excluded` + 161 × this code. That is the
  // cascade discipline `permissions.invalid` and `capability.invalid` already
  // state — a grade that resolves against a document nobody loaded is not a
  // diagnosis — so the code stands down and the entry is the finding.
  it("is not graded at all when the root `exclude` hides the map — landscape.excluded is the whole answer", async () => {
    const p = await fleet({
      "services/svc-a/model.likec4": extending("svcA", "specification {\n  tag req-X\n}\n\n"),
      "services/svc-b/model.likec4": extending("svcB", "specification {\n  tag req-X\n}\n\n"),
      "likec4.config.json": rootWith(["**/node_modules/**", "architecture/*.likec4", "features/**"]),
    });
    try {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      const excluded = codeFor(res.stdout, "landscape.excluded");
      expect(excluded, res.stdout).toHaveLength(1);
      expect(excluded[0]?.message).toContain("is NOT graded while this entry stands");
      expect(codeFor(res.stdout, CODE), res.stdout).toEqual([]);
      // Neither code gates, and loam's own reading of the map is unchanged —
      // which is the property that made this state invisible in the first place.
      expect(res.code).toBe(0);
      expect(codeFor(res.stdout, "c4.valid")).toHaveLength(2);
    } finally {
      await p.destroy();
    }
  });

  // The control, and the half that keeps the suppression honest: the SAME fleet
  // with a root config whose list leaves the map alone still reports the merged
  // failure. Without this, a gate that suppressed the code unconditionally would
  // pass the test above.
  it("is graded as before when the same root config leaves the map alone", async () => {
    const p = await fleet({
      "services/svc-a/model.likec4": extending("svcA", "specification {\n  tag req-X\n}\n\n"),
      "services/svc-b/model.likec4": extending("svcB", "specification {\n  tag req-X\n}\n\n"),
      "likec4.config.json": rootWith(["**/node_modules/**", "features/**"]),
    });
    try {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(codeFor(res.stdout, "landscape.excluded")).toEqual([]);
      const merged = codeFor(res.stdout, CODE);
      expect(merged.length, res.stdout).toBeGreaterThanOrEqual(2);
      expect([...new Set(merged.map((f) => f.subject))].sort()).toEqual(["svc-a", "svc-b"]);
    } finally {
      await p.destroy();
    }
  });

  // Catches: the load made on a fleet that has no such project — every model
  // standing alone means every one of them is excluded from the root, so there
  // is nothing to merge and nothing to say.
  it("silent on a fleet whose models all stand alone", async () => {
    const standalone = (el: string, id: string): string =>
      `specification {\n  element softwareSystem\n  element container\n  tag req-X\n}\n\n` +
      `model {\n  ${el} = softwareSystem '${id}' {\n    metadata { service '${id}' }\n    api = container 'api'\n  }\n}\n`;
    const p = await fleet({
      "services/svc-a/model.likec4": standalone("svcA", "svc-a"),
      "services/svc-b/model.likec4": standalone("svcB", "svc-b"),
    });
    try {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(codeFor(res.stdout, CODE)).toEqual([]);
    } finally {
      await p.destroy();
    }
  });
});

describe("the view-id census sees an extending model's views", () => {
  // Catches: the census still taken from the `architecture/` project alone. An
  // extending model's views live in the ROOT project beside the map's, so an id
  // loam generates into architecture/subsystems.likec4 collides with one
  // authored in a model — and until this load existed nothing could see it.
  it("a model authoring `view subsystem_<name>` collides with the generated id, and the finding names the model", async () => {
    const p = await fleet({
      "services/platform/subsystem.yaml": "title: Platform\n",
      "services/platform/svc-c/model.likec4":
        "model {\n}\n\nviews {\n  view subsystem_platform {\n    include *\n  }\n}\n",
      "services/platform/svc-c/spec.md": spec("svc-c"),
    });
    try {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      const collision = codeFor(res.stdout, "subsystem.view-id-collision");
      expect(collision).toHaveLength(1);
      expect(collision[0]?.subject).toBe("subsystem_platform");
      expect(collision[0]?.locations).toEqual([{ path: "services/platform/svc-c/model.likec4", role: "primary" }]);
      expect(collision[0]?.message).toContain("services/platform/svc-c/model.likec4 declares `view subsystem_platform`");
    } finally {
      await p.destroy();
    }
  });

  // Catches: the landscape's own claims losing their `architecture/` prefix when
  // the census moved. The map is the census's original subject and must keep
  // naming its file correctly whether or not a merged project was built.
  it("the map's own colliding view is still named at architecture/landscape.likec4", async () => {
    const p = await fleet({
      "services/platform/subsystem.yaml": "title: Platform\n",
      "services/platform/svc-c/model.likec4": extending("svcA").replace("extend svcA", "extend svcA"),
      "services/platform/svc-c/spec.md": spec("svc-c"),
      "architecture/landscape.likec4": MAP.replace("  view landscape {", "  view subsystem_platform {\n    include *\n  }\n  view landscape {"),
    });
    try {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      const collision = codeFor(res.stdout, "subsystem.view-id-collision");
      expect(collision).toHaveLength(1);
      expect(collision[0]?.locations).toEqual([{ path: "architecture/landscape.likec4", role: "primary" }]);
    } finally {
      await p.destroy();
    }
  });
});
