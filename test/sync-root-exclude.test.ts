/**
 * `loam subsystem sync` and the ROOT `likec4.config.json`'s `exclude` list —
 * the third thing that verb writes, and the first fact loam has ever read back
 * out of that file.
 *
 * The two model shapes need opposite answers from it. A model that STANDS ALONE
 * declares its own kinds, so inside the root project every one of them is a
 * duplicate blamed on the map as well: it must be excluded, and it gets a
 * project file of its own. A model that EXTENDS the map parses ONLY inside the
 * root project: it must not be excluded, and a project file beside it holds
 * nothing. So the `services/` half of the list is derived from the shapes on
 * disk on every run, while every other entry stays exactly where the team put
 * it.
 *
 * The GATE is what keeps an old repository untouched: a fleet whose models all
 * stand alone behind a blanket `services/**` is already correct, and rewriting
 * it into one entry per service would be a diff with no fact behind it.
 */
import { describe, expect, it } from "vitest";
import { LIVING_OPENAPI, LIVING_SPEC, makeProject, runLoam, treeHashes, type Project } from "./helpers/harness.js";

interface SyncPayload {
  ok: boolean;
  projects: {
    root: boolean;
    created: string[];
    removed: string[];
    current: number;
    exclude: { updated: boolean; entries: string[]; added: string[]; removed: string[]; unreadable: boolean };
  };
}

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

/** The extending shape: no kinds of its own, so the root project is where it parses. */
function extending(el: string): string {
  return `model {\n  extend ${el} {\n    api = container 'api'\n  }\n}\n`;
}

/** The standalone shape: its own `specification`, so the root project must exclude it. */
function standalone(el: string, id: string): string {
  return (
    `specification {\n  element softwareSystem\n  element container\n}\n\n` +
    `model {\n  ${el} = softwareSystem '${id}' {\n    metadata { service '${id}' }\n    api = container 'api'\n  }\n}\n`
  );
}

function rootConfig(exclude: readonly string[]): string {
  return `${JSON.stringify({ name: "fleet", title: "Fleet landscape", exclude: [...exclude] }, null, 2)}\n`;
}

async function fleet(models: Record<string, string>, exclude: readonly string[]): Promise<Project> {
  return makeProject({
    "likec4.config.json": rootConfig(exclude),
    "architecture/landscape.likec4": MAP,
    "services/svc-a/spec.md": LIVING_SPEC.replace(/payment-service/g, "svc-a"),
    "services/svc-a/openapi.yaml": LIVING_OPENAPI,
    "services/svc-b/spec.md": LIVING_SPEC.replace(/payment-service/g, "svc-b"),
    "services/svc-b/openapi.yaml": LIVING_OPENAPI,
    ...models,
  });
}

async function sync(p: Project): Promise<SyncPayload> {
  const res = await runLoam(p.workDir, "subsystem", "sync", "--json");
  expect(res.code, res.out).toBe(0);
  return JSON.parse(res.stdout) as SyncPayload;
}

const BOTH_EXTENDING = {
  "services/svc-a/model.likec4": extending("svcA"),
  "services/svc-b/model.likec4": extending("svcB"),
};
const BOTH_STANDALONE = {
  "services/svc-a/model.likec4": standalone("svcA", "svc-a"),
  "services/svc-b/model.likec4": standalone("svcB", "svc-b"),
};

describe("subsystem sync — the root project's exclude list", () => {
  // Catches: the blanket exclusion surviving a migration. Every model extends
  // the map now, so `services/**` renders every one of them as a box with
  // nothing inside — and the entry loam wrote is loam's to take back.
  it("removes services/** once the models extend the map, and writes no project file for them", async () => {
    const p = await fleet(BOTH_EXTENDING, ["**/node_modules/**", "services/**", "features/**"]);
    try {
      const payload = await sync(p);
      expect(payload.projects.exclude).toEqual({
        updated: true,
        entries: ["**/node_modules/**", "features/**"],
        added: [],
        removed: ["services/**"],
        unreadable: false,
      });
      expect(payload.projects.created).toEqual([]);
      // Nothing was created AND nothing was already there: `current` counts the
      // services owed a project file that have one, and an extending model is
      // owed none. Subtracted from every model the walk found, it reported two
      // files in place beside the two models that must not have one.
      expect(payload.projects.current).toBe(0);
      expect(p.exists("services/svc-a/likec4.config.json")).toBe(false);
      expect(p.exists("services/svc-b/likec4.config.json")).toBe(false);
      // Only `exclude` moved: every other key survives, in order, 2-space JSON.
      expect(await p.read("likec4.config.json")).toBe(rootConfig(["**/node_modules/**", "features/**"]));
    } finally {
      await p.destroy();
    }
  });

  // Catches: a standalone model left in the root project, where its own
  // `specification` block blanks the whole thing — the state
  // `service.model-unexcluded` reports and this run repairs.
  it("adds one services/<tree>/** per standalone model, and a project file beside each", async () => {
    const p = await fleet(BOTH_STANDALONE, ["**/node_modules/**", "features/**"]);
    try {
      const payload = await sync(p);
      expect(payload.projects.exclude).toEqual({
        updated: true,
        entries: ["**/node_modules/**", "features/**", "services/svc-a/**", "services/svc-b/**"],
        added: ["services/svc-a/**", "services/svc-b/**"],
        removed: [],
        unreadable: false,
      });
      expect(payload.projects.created).toEqual([
        "services/svc-a/likec4.config.json",
        "services/svc-b/likec4.config.json",
      ]);
    } finally {
      await p.destroy();
    }
  });

  // Catches: the gate dropped. An old repository — every model standalone,
  // `services/**` present — is already correct, and a rewrite into one entry
  // per service would be a diff with no fact behind it and a project file
  // per service that the blanket entry already covered.
  it("never touches an all-standalone repo that already says services/**", async () => {
    const p = await fleet(BOTH_STANDALONE, ["**/node_modules/**", "services/**", "features/**"]);
    try {
      const before = await treeHashes(p.docsDir);
      const payload = await sync(p);
      expect(payload.projects.exclude).toEqual({
        updated: false,
        entries: ["**/node_modules/**", "services/**", "features/**"],
        added: [],
        removed: [],
        unreadable: false,
      });
      expect(await p.read("likec4.config.json")).toBe(rootConfig(["**/node_modules/**", "services/**", "features/**"]));
      // The project files are still owed and still written; only the exclude
      // list is untouched.
      expect(payload.projects.created).toHaveLength(2);
      expect(Object.keys(before)).not.toContain("services/svc-a/likec4.config.json");
    } finally {
      await p.destroy();
    }
  });

  // Catches: a rewrite on a list that already says what this run would write —
  // the compare is on the parsed ARRAYS, so a file the team formatted their own
  // way is left exactly as they formatted it.
  it("is idempotent: a second sync reports the list and rewrites nothing", async () => {
    const p = await fleet(BOTH_STANDALONE, ["**/node_modules/**", "features/**"]);
    try {
      await sync(p);
      const before = await treeHashes(p.docsDir);
      const again = await sync(p);
      expect(again.projects.exclude.updated).toBe(false);
      expect(again.projects.exclude.entries).toEqual([
        "**/node_modules/**",
        "features/**",
        "services/svc-a/**",
        "services/svc-b/**",
      ]);
      expect(await treeHashes(p.docsDir)).toEqual(before);
    } finally {
      await p.destroy();
    }
  });

  // Catches: a rewrite that takes the team's own entries with it. The
  // `services/` half of the list is loam's; everything else is theirs, in the
  // order they wrote it.
  //
  // `services/legacy/**` is the sharp case: it LOOKS like one of loam's, and it
  // survives because `legacy` is not a service the enumeration found. The rule
  // is stated in `core/c4/service-model/renderer.ts` (`standaloneExclude`).
  it("keeps every entry that is not about an enumerated service, in order", async () => {
    const p = await fleet(
      { ...BOTH_EXTENDING, "services/svc-a/model.likec4": standalone("svcA", "svc-a") },
      ["**/node_modules/**", "drafts/**", "services/legacy/**", "services/**", "features/**"],
    );
    try {
      const payload = await sync(p);
      expect(payload.projects.exclude.entries).toEqual([
        "**/node_modules/**",
        "drafts/**",
        "services/legacy/**",
        "features/**",
        "services/svc-a/**",
      ]);
      expect(payload.projects.exclude.removed).toEqual(["services/**"]);
      expect(payload.projects.exclude.added).toEqual(["services/svc-a/**"]);
      // Only the standalone model is owed a project file.
      expect(payload.projects.created).toEqual(["services/svc-a/likec4.config.json"]);
    } finally {
      await p.destroy();
    }
  });

  // Catches: the `/**`-only reading of an entry. `services/svc-a` hides that
  // directory from the renderer exactly as `services/svc-a/**` does (measured at
  // the 1.59.2 pin), so a standalone model behind it is already excluded — the
  // grade must be silent and the rewrite must not put a second entry for the
  // same directory beside the team's (verification 2026-09-04, E2).
  it("reads a bare `services/<tree>` as covering, and never appends a twin for it", async () => {
    const p = await fleet(
      { ...BOTH_EXTENDING, "services/svc-a/model.likec4": standalone("svcA", "svc-a") },
      ["**/node_modules/**", "features/**", "services/svc-a"],
    );
    try {
      const before = JSON.parse((await runLoam(p.workDir, "validate", "--all", "--json")).stdout) as {
        targets: Array<{ findings: Array<{ code: string }> }>;
      };
      expect(before.targets.flatMap((t) => t.findings).map((f) => f.code)).not.toContain("service.model-unexcluded");

      const payload = await sync(p);
      // One entry for `services/svc-a`, in loam's own spelling — never two.
      expect(payload.projects.exclude.entries).toEqual([
        "**/node_modules/**",
        "features/**",
        "services/svc-a/**",
      ]);
      expect(payload.projects.exclude.entries.filter((e) => e.startsWith("services/svc-a"))).toHaveLength(1);
    } finally {
      await p.destroy();
    }
  });

  // Catches: the same reading in the gate. Every model stands alone and every
  // one of them is already covered — under the `/**`-only rule `uncovered` was
  // true forever, so every sync rewrote the file to add entries the renderer
  // already honoured.
  it("leaves an all-standalone repo alone when its entries use another spelling", async () => {
    const p = await fleet(BOTH_STANDALONE, ["**/node_modules/**", "features/**", "services/*"]);
    try {
      const payload = await sync(p);
      expect(payload.projects.exclude).toEqual({
        updated: false,
        entries: ["**/node_modules/**", "features/**", "services/*"],
        added: [],
        removed: [],
        unreadable: false,
      });
      expect(await p.read("likec4.config.json")).toBe(rootConfig(["**/node_modules/**", "features/**", "services/*"]));
    } finally {
      await p.destroy();
    }
  });

  // Catches: a writer that rewrites a file it could not read. Guessing at the
  // JSON a team hand-wrote is how a writer destroys a file it did not
  // understand, and the note is how a person finds out nothing happened.
  it("leaves a root config it cannot read as an object, and says so", async () => {
    const p = await fleet(BOTH_EXTENDING, []);
    try {
      await p.write("likec4.config.json", '["not", "an", "object"]\n');
      const payload = await sync(p);
      // `unreadable: true`, not `entries: []` alone. The two answers mean
      // opposite things about what the renderer will load — "excludes nothing"
      // versus "loam could not say" — and the payload collapsed them while the
      // text view below kept them apart (verification 2026-09-04, review C).
      expect(payload.projects.exclude).toEqual({
        updated: false,
        entries: [],
        added: [],
        removed: [],
        unreadable: true,
      });
      expect(await p.read("likec4.config.json")).toBe('["not", "an", "object"]\n');
      const text = await runLoam(p.workDir, "subsystem", "sync");
      expect(text.code).toBe(0);
      expect(text.stdout).toContain("is not a JSON object with a string `exclude` list");
    } finally {
      await p.destroy();
    }
  });

  // Catches: a rewrite reported only in `--json`. The file is the team's, so
  // the one run that changes it owes a person the entries it moved.
  it("the human view names the entries it added and removed", async () => {
    const p = await fleet(
      { ...BOTH_EXTENDING, "services/svc-a/model.likec4": standalone("svcA", "svc-a") },
      ["**/node_modules/**", "services/**", "features/**"],
    );
    try {
      const res = await runLoam(p.workDir, "subsystem", "sync");
      expect(res.code).toBe(0);
      expect(res.stdout).toContain("rewrote likec4.config.json's `exclude`");
      expect(res.stdout).toContain("+services/svc-a/**");
      expect(res.stdout).toContain("-services/**");
    } finally {
      await p.destroy();
    }
  });

  // Catches: the root gate dropped on the exclude half. Without the root file
  // there is no list to read and nothing to write beside it — `loam doctor`
  // prints the file first, and sync must not invent one.
  it("writes nothing at all without the root project file", async () => {
    const p = await makeProject({
      "architecture/landscape.likec4": MAP,
      ...BOTH_STANDALONE,
      "services/svc-a/spec.md": LIVING_SPEC.replace(/payment-service/g, "svc-a"),
      "services/svc-b/spec.md": LIVING_SPEC.replace(/payment-service/g, "svc-b"),
    });
    try {
      const before = await treeHashes(p.docsDir);
      const payload = await sync(p);
      expect(payload.projects.root).toBe(false);
      // `unreadable: false` here and true above: there is no root file to read,
      // which is a different state from a root file loam could not parse.
      expect(payload.projects.exclude).toEqual({
        updated: false,
        entries: [],
        added: [],
        removed: [],
        unreadable: false,
      });
      expect(await treeHashes(p.docsDir)).toEqual(before);
    } finally {
      await p.destroy();
    }
  });
});

describe("a subsystem-wide exclude entry hides a filed service's model", () => {
  /** The map plus a third service, filed under `services/platform/`. */
  const FILED_MAP = MAP.replace(
    "  svcB = softwareSystem 'svc-b' {\n    metadata { service 'svc-b' }\n  }\n",
    "  svcB = softwareSystem 'svc-b' {\n    metadata { service 'svc-b' }\n  }\n" +
      "  svcC = softwareSystem 'svc-c' {\n    metadata { service 'svc-c' }\n  }\n",
  );

  /** svc-a and svc-b unfiled, svc-c under a subsystem, every model extending. */
  async function filedFleet(exclude: readonly string[]): Promise<Project> {
    const p = await fleet(BOTH_EXTENDING, exclude);
    await p.write("architecture/landscape.likec4", FILED_MAP);
    await p.write("services/platform/subsystem.yaml", "title: Platform\n");
    await p.write("services/platform/svc-c/model.likec4", extending("svcC"));
    await p.write("services/platform/svc-c/spec.md", LIVING_SPEC.replace(/payment-service/g, "svc-c"));
    await p.write("services/platform/svc-c/openapi.yaml", LIVING_OPENAPI);
    return p;
  }

  const excludedFindings = (stdout: string): Array<{ code: string; subject?: string }> =>
    (JSON.parse(stdout) as { targets: Array<{ findings: Array<{ code: string; subject?: string }> }> }).targets
      .flatMap((t) => t.findings)
      .filter((f) => f.code === "service.model-excluded");

  // Catches: the repair loop that never closed. `services/platform/**` names a
  // directory the enumeration never returns as a service, so the authorship
  // rule left it alone — while it hides `services/platform/svc-c` from the root
  // project exactly as `services/**` would. `service.model-excluded` named
  // `loam subsystem sync` as the repair and sync answered `updated: false`,
  // every run, forever.
  it("validate warns, ONE sync rewrites the entry, and the next validate is silent", async () => {
    const p = await filedFleet(["**/node_modules/**", "services/platform/**", "features/**"]);
    try {
      const before = await runLoam(p.workDir, "validate", "--all", "--json");
      const warned = excludedFindings(before.stdout);
      expect(warned).toHaveLength(1);
      expect(warned[0]?.subject).toBe("svc-c");

      const payload = await sync(p);
      expect(payload.projects.exclude).toEqual({
        updated: true,
        entries: ["**/node_modules/**", "features/**"],
        added: [],
        removed: ["services/platform/**"],
        unreadable: false,
      });
      // The model extends the map, so it is owed no project file either way.
      expect(payload.projects.created).toEqual([]);

      const after = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(excludedFindings(after.stdout)).toEqual([]);
    } finally {
      await p.destroy();
    }
  });

  // Catches: the effect rule eating an entry that hides nothing extending. The
  // same spelling, one directory over, is a team's own glob about their own
  // tree — and a sync that took it would be loam deleting a line it never wrote.
  it("leaves the same spelling alone when it covers no service directory", async () => {
    const p = await filedFleet(["**/node_modules/**", "services/legacy/**", "services/**", "features/**"]);
    try {
      const payload = await sync(p);
      expect(payload.projects.exclude.entries).toEqual([
        "**/node_modules/**",
        "services/legacy/**",
        "features/**",
      ]);
      expect(payload.projects.exclude.removed).toEqual(["services/**"]);
    } finally {
      await p.destroy();
    }
  });

  // Catches: the write side being weaker than the read side. The matcher names
  // a starred middle segment for `service.model-excluded` — and the message
  // sends its reader to `loam subsystem sync` — while the writer asked "which
  // directory does this entry name", which answers null for exactly that
  // spelling. So the entry was `kept` unconditionally and the warning fired
  // again, identically, after every sync (verification 2026-09-04, review C).
  it("takes back an entry that hides a filed model through a WILDCARD segment", async () => {
    const p = await filedFleet(["**/node_modules/**", "services/*/svc-c", "features/**"]);
    try {
      const before = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(excludedFindings(before.stdout)[0]?.subject).toBe("svc-c");

      const payload = await sync(p);
      expect(payload.projects.exclude.removed).toEqual(["services/*/svc-c"]);
      expect(payload.projects.exclude.entries).toEqual(["**/node_modules/**", "features/**"]);

      const after = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(excludedFindings(after.stdout)).toEqual([]);
    } finally {
      await p.destroy();
    }
  });
});

describe("the human view is honest about what one run wrote", () => {
  // Catches: the "nothing to write" tail surviving a run that rewrote the root
  // config. The tail counted the project files created and removed and not the
  // third thing this verb writes, so it contradicted the very next line of
  // output (verification 2026-09-04, review C).
  it("drops `nothing to write` when the run rewrote the root exclude beside a current views file", async () => {
    const p = await fleet(BOTH_EXTENDING, ["**/node_modules/**", "services/**", "features/**"]);
    try {
      // First run: the views file lands and the exclude is repaired together.
      expect((await runLoam(p.workDir, "subsystem", "sync")).code).toBe(0);
      // Put the blanket entry back, so the SECOND run has a current views file
      // and one rewrite to make.
      await p.write("likec4.config.json", rootConfig(["**/node_modules/**", "services/**", "features/**"]));

      const res = await runLoam(p.workDir, "subsystem", "sync");
      expect(res.code, res.out).toBe(0);
      expect(res.stdout).toContain("rewrote likec4.config.json's `exclude`");
      expect(res.stdout).toContain("architecture/subsystems.likec4 is current");
      expect(res.stdout).not.toContain("nothing to write");
    } finally {
      await p.destroy();
    }
  });
});

describe("validate names what sync repairs", () => {
  // Catches: the grader and the writer disagreeing about a shape. One run of
  // the advertised repair has to clear every renderer finding, or the loop
  // never closes.
  it("one sync clears service.model-excluded, service.model-unexcluded and service.likec4-config-stray", async () => {
    const p = await fleet(
      { ...BOTH_EXTENDING, "services/svc-b/model.likec4": standalone("svcB", "svc-b") },
      ["**/node_modules/**", "services/**", "features/**"],
    );
    try {
      // An extending model with a stray project file beside it, on top.
      await p.write("services/svc-a/likec4.config.json", '{"name":"svc-a"}\n');
      const before = JSON.parse((await runLoam(p.workDir, "validate", "--all", "--json")).stdout) as {
        targets: Array<{ findings: Array<{ code: string; subject?: string }> }>;
      };
      const codes = before.targets.flatMap((t) => t.findings).map((f) => f.code);
      expect(codes).toContain("service.model-excluded");
      expect(codes).toContain("service.likec4-config-stray");

      // ONE run, and the stray goes with it: the nested project claims the model
      // out of the root project, so the file is not a harmless leftover and
      // every surface has always named `sync` as the repair.
      const payload = await sync(p);
      expect(payload.projects.removed).toEqual(["services/svc-a/likec4.config.json"]);
      expect(p.exists("services/svc-a/likec4.config.json")).toBe(false);

      const after = JSON.parse((await runLoam(p.workDir, "validate", "--all", "--json")).stdout) as {
        targets: Array<{ findings: Array<{ code: string }> }>;
      };
      const left = after.targets.flatMap((t) => t.findings).map((f) => f.code);
      for (const code of [
        "service.model-excluded",
        "service.model-unexcluded",
        "service.likec4-config-stray",
        "service.likec4-config-missing",
      ]) {
        expect(left, code).not.toContain(code);
      }
    } finally {
      await p.destroy();
    }
  });

  // Catches: the removal widened past the one state that earns it. A STANDALONE
  // model is owed its project file — that file is the only thing that renders it
  // — so deleting one would be `sync` undoing its own create on the next run.
  it("never removes the project file a STANDALONE model is owed, and says nothing about one", async () => {
    const p = await fleet(BOTH_STANDALONE, ["**/node_modules/**", "features/**"]);
    try {
      const first = await sync(p);
      expect(first.projects.created).toHaveLength(2);
      expect(first.projects.removed).toEqual([]);
      const again = await sync(p);
      expect(again.projects.removed).toEqual([]);
      expect(p.exists("services/svc-a/likec4.config.json")).toBe(true);
      expect(p.exists("services/svc-b/likec4.config.json")).toBe(true);
    } finally {
      await p.destroy();
    }
  });

  // Catches: a walk that deletes `likec4.config.json` wherever it finds one. The
  // survey only ever reaches a directory holding a `model.likec4`, so a team's
  // own project file over a subsystem — or beside a model that is gone — is not
  // loam's to take.
  it("never touches a likec4.config.json that is not beside a model", async () => {
    const p = await fleet(BOTH_EXTENDING, ["**/node_modules/**", "features/**"]);
    try {
      await p.write("services/platform/subsystem.yaml", "title: Platform\n");
      await p.write("services/platform/likec4.config.json", '{"name":"platform"}\n');
      await p.write("services/gone/likec4.config.json", '{"name":"gone"}\n');
      const payload = await sync(p);
      expect(payload.projects.removed).toEqual([]);
      expect(await p.read("services/platform/likec4.config.json")).toBe('{"name":"platform"}\n');
      expect(await p.read("services/gone/likec4.config.json")).toBe('{"name":"gone"}\n');
    } finally {
      await p.destroy();
    }
  });

  // Catches: the removal reported only in `--json`. It is a DELETE of a file the
  // team may have written, so a person is owed the path and the reason.
  it("the human view names the file it removed and why", async () => {
    const p = await fleet(BOTH_EXTENDING, ["**/node_modules/**", "features/**"]);
    try {
      await p.write("services/svc-b/likec4.config.json", '{"name":"svc-b"}\n');
      const res = await runLoam(p.workDir, "subsystem", "sync");
      expect(res.code, res.out).toBe(0);
      expect(res.stdout).toContain("removed services/svc-b/likec4.config.json");
      // The certain harm first — a second renderer project at that directory —
      // and the interior loss as the case it is (re-measured: on `examples/docs`
      // the fleet export was byte-identical with and without the file).
      expect(res.stdout).toContain("registers a second renderer project");
      expect(res.stdout).toContain("wherever that project claims the model");
    } finally {
      await p.destroy();
    }
  });

  // Catches the defect verbatim (re-verification 2026-09-04, area C item 2).
  // Measured at the 1.59.2 pin: `services\svc-a\**` leaves every source file
  // loaded — picomatch escapes a backslash to a literal, so it is never a
  // separator — and loam read it as covering the tree. `validate --all` warned
  // `service.model-excluded` about a service the renderer loads perfectly, and
  // this run then rewrote the team's file to delete the line.
  it("leaves a BACKSLASH-spelled entry alone, because the renderer reads it as covering nothing", async () => {
    const entry = "services\\svc-a\\**";
    const p = await fleet(BOTH_EXTENDING, ["**/node_modules/**", entry, "features/**"]);
    try {
      const payload = await sync(p);
      expect(payload.projects.exclude.updated).toBe(false);
      expect(payload.projects.exclude.entries).toEqual(["**/node_modules/**", entry, "features/**"]);
      expect(await p.read("likec4.config.json")).toBe(rootConfig(["**/node_modules/**", entry, "features/**"]));
      const validate = await runLoam(p.workDir, "validate", "--all");
      expect(validate.stdout).not.toContain("service.model-excluded");
    } finally {
      await p.destroy();
    }
  });

  // The OTHER direction of the same defect, which is the dangerous one: a
  // STANDALONE model behind a backslash entry is in the root project right now,
  // where every kind it declares is a duplicate blamed on the map as well. loam
  // read the entry as covering the tree and said nothing (the refuter measured
  // ✗ Invalid, 42 errors, with only `service.likec4-config-missing` reported);
  // the entry covers nothing, so the real entry is owed.
  it("still owes a real entry for a standalone tree a BACKSLASH entry only appears to cover", async () => {
    const entry = "services\\svc-a\\**";
    const p = await fleet(BOTH_STANDALONE, ["**/node_modules/**", entry, "features/**"]);
    try {
      const payload = await sync(p);
      expect(payload.projects.exclude.added).toEqual(["services/svc-a/**", "services/svc-b/**"]);
      expect(payload.projects.exclude.removed).toEqual([]);
      expect(payload.projects.exclude.entries).toEqual([
        "**/node_modules/**",
        entry,
        "features/**",
        "services/svc-a/**",
        "services/svc-b/**",
      ]);
    } finally {
      await p.destroy();
    }
  });

  // Catches the defect verbatim (area C item 3). PowerShell's `Out-File` writes
  // `ef bb bf` by default on this platform, so a Windows shell saving the very
  // file loam wrote left `JSON.parse` throwing here while the renderer went on
  // applying `services/**`: `npx likec4 validate .` at 3 source files of 8 and
  // loam reporting the list unreadable, writing nothing, grading nothing.
  it("reads and rewrites a root config a Windows shell saved with a byte-order mark", async () => {
    const p = await fleet(BOTH_EXTENDING, ["**/node_modules/**", "features/**"]);
    try {
      await p.write("likec4.config.json", `﻿${rootConfig(["**/node_modules/**", "services/**", "features/**"])}`);
      const payload = await sync(p);
      expect(payload.projects.exclude).toEqual({
        updated: true,
        entries: ["**/node_modules/**", "features/**"],
        added: [],
        removed: ["services/**"],
        unreadable: false,
      });
      // Rewritten through the same serialiser as every other sync, so the mark
      // does not survive a rewrite — the same normalisation the file's own
      // 2-space, LF, one-trailing-newline form already performs.
      expect(await p.read("likec4.config.json")).toBe(rootConfig(["**/node_modules/**", "features/**"]));
    } finally {
      await p.destroy();
    }
  });

  // The `null` arm is UNCHANGED, and this pins it beside the BOM case so a
  // tolerant reader cannot widen into it: `"exclude": "services/**"` is a config
  // the renderer REJECTS on its schema ("Invalid input: expected array, received
  // string", "loaded 0 projects out of 1"), and loam saying nothing about a file
  // nobody is applying is the honest answer (area C item 4 — measured, already
  // the behaviour).
  it("reports a non-array `exclude` as unreadable, writes nothing, and says so", async () => {
    const p = await fleet(BOTH_EXTENDING, ["**/node_modules/**", "features/**"]);
    try {
      const bytes = '{"name":"fleet","title":"Fleet landscape","exclude":"services/**"}\n';
      await p.write("likec4.config.json", bytes);
      const payload = await sync(p);
      expect(payload.projects.exclude).toEqual({
        updated: false,
        entries: [],
        added: [],
        removed: [],
        unreadable: true,
      });
      expect(await p.read("likec4.config.json")).toBe(bytes);
      const res = await runLoam(p.workDir, "subsystem", "sync");
      expect(res.stdout).toContain("is not a JSON object with a string `exclude` list");
    } finally {
      await p.destroy();
    }
  });

  // Catches the ordering defect (area C item 6). `surveyProjects` sorts by
  // SERVICE ID, so `services/svc-a/…` came out before `services/platform/svc-d/…`
  // — an order no lexicographic sort of the paths produces, while SCHEMA and
  // CHANGELOG both call the key a sorted path list.
  it("emits `created` and `removed` sorted by PATH, not by service id", async () => {
    const p = await fleet(BOTH_STANDALONE, ["**/node_modules/**", "features/**"]);
    try {
      await p.write("services/platform/subsystem.yaml", "title: Platform\n");
      await p.write("services/platform/svc-d/model.likec4", standalone("svcD", "svc-d"));
      const created = (await sync(p)).projects.created;
      expect(created).toEqual([
        "services/platform/svc-d/likec4.config.json",
        "services/svc-a/likec4.config.json",
        "services/svc-b/likec4.config.json",
      ]);
      expect(created).toEqual([...created].sort());
    } finally {
      await p.destroy();
    }
  });
});
