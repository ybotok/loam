/**
 * `loadProject` — a directory of `.likec4` documents read as ONE LikeC4
 * project, which is the only way a file that declares views over another
 * file's elements can be read at all.
 *
 * Its sibling `test/likec4-batch-parity.test.ts` pins the OPPOSITE contract:
 * `loadBatch` gives every document a project of its own so an author-written
 * `import` can never resolve against a neighbour. Both are deliberate, and this
 * suite exists partly so a reader can see the two side by side — the isolation
 * that protects a batch is exactly the isolation that makes a use-case file
 * unreadable.
 *
 * Two rules INVERT inside a project, and both are measured here rather than
 * assumed, because a fleet that gets either wrong fails in a way the message
 * does not explain:
 *
 *  - Exactly one document declares the `specification` block. Every `.likec4`
 *    file loam parses alone must declare its own; a second declaration inside
 *    one project is a duplicate error blamed on BOTH files.
 *  - Errors are per document, but the MODEL is all-or-nothing. loam's standing
 *    rule is that errors mean no model, and here the model belongs to the
 *    project — so a typo in one file blanks the set, while still being named
 *    against the file that holds it.
 */
import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asLoadedDoc, loadProject } from "../src/core/c4/project/load.js";
import { loadFile } from "../src/core/c4/likec4.js";
import { makeProject, runLoam } from "./helpers/harness.js";

interface JsonReport {
  targets: Array<{ kind: string; findings: Array<{ code: string; message: string }> }>;
}

const LANDSCAPE = `specification {
  element service
  tag cap-checkout
  tag cap-login
}
model {
  web = service 'checkout-web' {
    metadata { service 'checkout-web' }
  }
  orders = service 'order-service' {
    metadata { service 'order-service' }
  }
  web -> orders 'Calls createOrder' {
    metadata { op 'createOrder' }
  }
}
views {
  view fleet {
    include *
  }
}
`;

const CHECKOUT = `views {
  dynamic view uc_checkout {
    #cap-checkout
    title 'Checkout'
    web -> orders 'places the order'
    web <- orders 'the created order'
  }
}
`;

const LOGIN = `views {
  dynamic view uc_login {
    #cap-login
    web -> orders 'signs in'
  }
}
`;

/** Write a docs-repo-shaped `architecture/` directory and load it as one project. */
async function architecture(files: Record<string, string>): Promise<{
  dir: string;
  load: (only?: string[]) => ReturnType<typeof loadProject>;
  cleanup: () => Promise<void>;
}> {
  const root = await mkdtemp(join(tmpdir(), "loam-project-"));
  const dir = join(root, "architecture");
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(dir, ...rel.split("/"));
    await mkdir(join(abs, ".."), { recursive: true });
    await writeFile(abs, body, "utf8");
  }
  const all = Object.keys(files).map((rel) => join(dir, ...rel.split("/")));
  return {
    dir,
    load: (only) => loadProject(dir, only ?? all),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}


/**
 * A fleet use case in a file of its own — what this whole loader is for.
 *
 * Written against LANDSCAPE above, which this file owns: the end-to-end case
 * is about the LOADER, and a fixture it does not control would make a failure
 * ambiguous between the loader and whatever that fixture happens to declare.
 */
const FLEET_USECASE = `views {
  dynamic view uc_checkout {
    #cap-checkout
    title 'Checkout'
    web -> orders 'places the order'
  }
}
`;

describe("loadProject reads a directory the way the renderer does", () => {
  it("resolves a use-case file against the landscape's elements, and says which file each view came from", async () => {
    const fx = await architecture({
      "landscape.likec4": LANDSCAPE,
      "usecases/checkout.likec4": CHECKOUT,
      "usecases/login.likec4": LOGIN,
    });
    try {
      const doc = await fx.load();
      expect(doc.errors.size).toBe(0);
      expect(doc.clean).toBe(true);

      // The model is the landscape's, unchanged: the use-case files carry views
      // and nothing else, so nothing about the fleet map moved.
      expect(doc.elements.map((e) => e.id).sort()).toEqual(["orders", "web"]);
      expect(doc.relationships).toHaveLength(1);
      expect(doc.relationships[0]!.op).toBe("createOrder");

      // Both use cases are read, each naming its own file — the whole point of
      // letting them live outside the landscape.
      expect(doc.views.map((v) => `${v.id}@${v.sourcePath}`).sort()).toEqual([
        "uc_checkout@usecases/checkout.likec4",
        "uc_login@usecases/login.likec4",
      ]);
      expect(doc.views.find((v) => v.id === "uc_checkout")!.tags).toEqual(["cap-checkout"]);

      // And the census sees the landscape's own static view beside them.
      expect(doc.viewIds.map((c) => `${c.id}@${c.sourcePath}`).sort()).toEqual([
        "fleet@landscape.likec4",
        "uc_checkout@usecases/checkout.likec4",
        "uc_login@usecases/login.likec4",
      ]);
    } finally {
      await fx.cleanup();
    }
  }, 30_000);

  it("preserves the reply orientation across the file boundary", async () => {
    // The step LikeC4 records for `web <- orders` is already reversed and
    // flagged; nothing about reading it out of a second file changes that, and
    // a check that joins on it must not have to care which file it came from.
    const fx = await architecture({
      "landscape.likec4": LANDSCAPE,
      "usecases/checkout.likec4": CHECKOUT,
    });
    try {
      const steps = (await fx.load()).views.find((v) => v.id === "uc_checkout")!.steps;
      expect(steps.map((s) => `${s.ordinal}:${s.source}->${s.target}:${s.isBackward}`)).toEqual([
        "1:web->orders:false",
        "2:orders->web:true",
      ]);
    } finally {
      await fx.cleanup();
    }
  }, 30_000);

  it("is exactly what a views-only file CANNOT do alone — the reason this loader exists", async () => {
    const fx = await architecture({
      "landscape.likec4": LANDSCAPE,
      "usecases/checkout.likec4": CHECKOUT,
    });
    try {
      // Parsed alone, the way loam parses every other `.likec4`: the tag and
      // both elements are undefined, so the document is `c4.invalid`.
      const alone = await loadFile(join(fx.dir, "usecases", "checkout.likec4"));
      expect(alone.errors.length).toBeGreaterThan(0);
      expect(alone.errors.some((e) => /cap-checkout|web|orders/.test(e.message))).toBe(true);

      // In the project, zero.
      expect((await fx.load()).errors.size).toBe(0);
    } finally {
      await fx.cleanup();
    }
  }, 30_000);
});

describe("the two rules that invert inside one project", () => {
  it("refuses a second `specification` block, and blames both files", async () => {
    const fx = await architecture({
      "landscape.likec4": LANDSCAPE,
      "usecases/checkout.likec4": `specification {\n  element service\n  tag cap-checkout\n}\n${CHECKOUT}`,
    });
    try {
      const doc = await fx.load();
      expect(doc.clean).toBe(false);
      // Both, not one: this is why the authoring rule has to be stated, since
      // an author who adds the block to their own file gets an error pointing
      // at somebody else's.
      expect(doc.errors.size).toBe(2);
      for (const [path, errs] of doc.errors) {
        expect(errs.some((e) => /Duplicate/i.test(e.message)), `no duplicate error against ${path}`).toBe(true);
      }
    } finally {
      await fx.cleanup();
    }
  }, 30_000);

  it("names the file that holds a typo, and blanks the model for the whole project", async () => {
    const fx = await architecture({
      "landscape.likec4": LANDSCAPE,
      "usecases/checkout.likec4": `views {\n  dynamic view uc_bad {\n    #cap-checkout\n    web -> nosuch 'typo'\n  }\n}\n`,
    });
    try {
      const doc = await fx.load();
      expect(doc.clean).toBe(false);
      // Attribution is the improvement over keeping use cases in the landscape:
      // the error names the use-case file, not the fleet map.
      expect([...doc.errors.keys()]).toHaveLength(1);
      expect([...doc.errors.keys()][0]).toContain("checkout.likec4");
      // And the standing rule holds: errors mean no model.
      expect(doc.elements).toEqual([]);
      expect(doc.views).toEqual([]);
    } finally {
      await fx.cleanup();
    }
  }, 30_000);

  it("rewrites every error path back to the file the author wrote, never the staged copy", async () => {
    const fx = await architecture({
      "landscape.likec4": LANDSCAPE,
      "usecases/checkout.likec4": `views {\n  dynamic view uc_bad {\n    web -> nosuch 'typo'\n  }\n}\n`,
    });
    try {
      const doc = await fx.load();
      for (const [path, errs] of doc.errors) {
        for (const e of errs) {
          expect(e.sourceFsPath).toBe(path);
          // The mkdtemp workspace is this invocation's alone and must never
          // reach a message a person reads.
          expect(e.sourceFsPath).not.toContain("loam-c4-");
        }
      }
    } finally {
      await fx.cleanup();
    }
  }, 30_000);
});

describe("the global style census is the PROJECT's, as the renderer's is", () => {
  /** A palette kept in a file of its own, targeting a tag the landscape's specification declares. */
  const PALETTE = "global {\n  styleGroup subsystems {\n    style element.tag = #cap-checkout { color gray }\n  }\n}\n";

  it("answers a group declared in a sibling document, through asLoadedDoc, sorted beside the landscape's own", async () => {
    // The generated subsystem views reference `global style subsystems` when
    // the project declares that id, and the renderer resolves the reference
    // against every document in `architecture/` — so a census that read the
    // landscape alone would leave the line unwritten for a fleet whose palette
    // lives in `usecases/style.likec4`, while the renderer could have shown it.
    const fx = await architecture({
      "landscape.likec4": `${LANDSCAPE}global {\n  style fleetWide element.tag = #cap-login { color muted }\n}\n`,
      "usecases/style.likec4": PALETTE,
      "usecases/checkout.likec4": CHECKOUT,
    });
    try {
      const project = await fx.load();
      expect(project.clean).toBe(true);
      expect(project.globalStyles).toEqual(["fleetWide", "subsystems"]);
      const doc = asLoadedDoc(project);
      expect(doc.globalStyles).toEqual(["fleetWide", "subsystems"]);
      // The rest of the record is untouched by a global block: the palette
      // file declares no model and no view.
      expect(doc.views?.map((v) => v.id)).toEqual(["uc_checkout"]);
    } finally {
      await fx.cleanup();
    }
  }, 30_000);

  it("answers NO census for a project that did not parse — errors mean no model, and the census is part of it", async () => {
    // Fail closed: a generated view referencing a group out of a map nobody
    // can read would be a second parse error behind the first.
    const fx = await architecture({
      "landscape.likec4": LANDSCAPE,
      "usecases/style.likec4": PALETTE,
      "usecases/checkout.likec4": `views {\n  dynamic view uc_bad {\n    web -> nosuch 'typo'\n  }\n}\n`,
    });
    try {
      const project = await fx.load();
      expect(project.clean).toBe(false);
      expect(project.globalStyles).toEqual([]);
      expect(asLoadedDoc(project).globalStyles).toBeUndefined();
    } finally {
      await fx.cleanup();
    }
  }, 30_000);
});

describe("loadProject degrades rather than inventing an answer", () => {
  it("an empty set is clean and empty — a fleet with no architecture documents owes nothing", async () => {
    const doc = await loadProject(tmpdir(), []);
    expect(doc).toMatchObject({ clean: true, elements: [], relationships: [], views: [], viewIds: [], globalStyles: [] });
    expect(doc.errors.size).toBe(0);
  });

  it("drops a path it cannot stage rather than failing the set", async () => {
    const fx = await architecture({ "landscape.likec4": LANDSCAPE });
    try {
      const doc = await fx.load([join(fx.dir, "landscape.likec4"), join(fx.dir, "gone.likec4")]);
      expect(doc.clean).toBe(true);
      expect(doc.elements.map((e) => e.id).sort()).toEqual(["orders", "web"]);
    } finally {
      await fx.cleanup();
    }
  }, 30_000);

  it("keeps two same-named files in different subdirectories apart", async () => {
    // Flattening to basenames would have one overwrite the other on copy, and
    // every finding would name a file the author cannot find.
    const fx = await architecture({
      "landscape.likec4": LANDSCAPE,
      "usecases/checkout.likec4": CHECKOUT,
      "usecases/inner/checkout.likec4": LOGIN,
    });
    try {
      const doc = await fx.load();
      expect(doc.clean).toBe(true);
      expect(doc.views.map((v) => v.sourcePath).sort()).toEqual([
        "usecases/checkout.likec4",
        "usecases/inner/checkout.likec4",
      ]);
    } finally {
      await fx.cleanup();
    }
  }, 30_000);
});

describe("validate --all reads architecture/ as that project", () => {
  it("loads a use case out of its own file, and names THAT file when it breaks", async () => {
    // The end-to-end proof of why the loader exists. A use case in its own
    // file used to be unreadable; a typo in it used to be reported as the
    // landscape having errors, which sent the author to the wrong file with a
    // line number pointing at somebody else's text.
    const p = await makeProject({
      "architecture/landscape.likec4": LANDSCAPE,
      "architecture/usecases/checkout.likec4": FLEET_USECASE,
      // `validate --all` refuses a docs repo with no `services/` at all, and this
      // case is about the loader rather than about that gate.
      "services/.gitkeep": "",
    });
    try {
      const clean = await runLoam(p.workDir, "validate", "--all", "--json");
      const landscape = (JSON.parse(clean.stdout) as JsonReport).targets.find((t) => t.kind === "landscape")!;
      expect(landscape.findings.map((f) => f.code)).not.toContain("landscape.invalid");

      // The same file, one element renamed to something nothing declares.
      await p.write("architecture/usecases/checkout.likec4", FLEET_USECASE.replace("orders", "nosuchService"));
      const broken = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(broken.code).toBe(1);
      const invalid = (JSON.parse(broken.stdout) as JsonReport).targets
        .flatMap((t) => t.findings)
        .find((f) => f.code === "landscape.invalid");
      expect(invalid).toBeDefined();
      expect(invalid!.message).toContain("architecture/usecases/checkout.likec4");
      expect(invalid!.message).not.toContain("architecture/landscape.likec4");
    } finally {
      await p.destroy();
    }
  }, 60_000);
});
