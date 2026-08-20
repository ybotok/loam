/**
 * The feature lifecycle for a JOURNEY: `loam archive` merging a delta's
 * dynamic views into the living fleet, and `loam unarchive` taking them back.
 *
 * Everything else about flows was already covered — the reader
 * (test/flows.test.ts), the storage and the generated group views
 * (test/flow-groups.test.ts), the coverage findings
 * (test/flow-coverage.test.ts). None of it could reach the living docs, because
 * no path merged a `views { ... }` block at all. These are the properties that
 * gap left unpinned:
 *
 *  - a tagged view is merged REPLACE-OR-ADD on its id, not spliced: a view the
 *    fleet already declares is replaced in the document that declares it
 *    (landscape or a file under `architecture/flows/`), and a new one gets its
 *    own file named for the view;
 *  - a view the delta leaves UNTAGGED is invisible to the merge, and a delta
 *    that tags nothing at all is `delta.nothing-tagged` — the same grade the
 *    same mistake gets on elements;
 *  - two features claiming one journey are told about each other
 *    (`flow.view-conflict`), because a replace discards the other's work whole
 *    and no `Based-On:` pin protects a view;
 *  - a merge that would leave `architecture/` unparseable refuses before it
 *    writes, and the docs are byte-identical afterwards;
 *  - the commit is the same journaled, snapshotted transaction every other
 *    archive write goes through: a fault between two swaps rolls back whole,
 *    and `unarchive` restores every touched flow document byte for byte.
 */
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { stageWrites, swapStaged } from "../src/core/staging/commit.js";
import { writeCommitIntent } from "../src/core/staging/recovery/intent.js";
import { recoverInterruptedCommit } from "../src/core/staging/recovery/recover.js";
import { snapshotDir, writeSnapshot, type ServiceKey } from "../src/core/staging/snapshot.js";
import { planWrite } from "../src/core/staging/writes.js";
import { coherentFixture, makeProject, runLoam, treeHashes } from "./helpers/harness.js";

/**
 * Fault injection for the commit phase — archive-rollback.test.ts's
 * passthrough wrapper, verbatim. The harness runs commands in-process, so every
 * swap goes through this module graph's own node:fs/promises.
 */
const fsFault = vi.hoisted(() => ({
  onRename: undefined as undefined | ((from: string, to: string) => void),
  onLink: undefined as undefined | ((from: string, to: string) => void),
}));

// BOTH primitives, because the two cases this file cares about take different
// ones: `swapStaged` swaps an overwrite with rename(2) and CREATES with link(2)
// — the no-clobber counterpart — so a fault wired only to rename never fires on
// the journey file a feature adds.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: async (from: Parameters<typeof actual.rename>[0], to: Parameters<typeof actual.rename>[1]) => {
      fsFault.onRename?.(String(from), String(to));
      return actual.rename(from, to);
    },
    link: async (from: Parameters<typeof actual.link>[0], to: Parameters<typeof actual.link>[1]) => {
      fsFault.onLink?.(String(from), String(to));
      return actual.link(from, to);
    },
  };
});

const FLOW_FILE = "architecture/flows/splitJourney.likec4";

/**
 * The fleet map the archive merges into. `coherentFixture`'s landscape with the
 * two group tags declared: LikeC4 refuses an undeclared tag, so the living
 * `specification` block is what brings a suite into existence — and it is also
 * what a delta introducing a NEW group must extend first.
 */
const LANDSCAPE = `specification {
  element softwareSystem
  element person
  tag payments
  tag smoke
}

model {
  customer = person 'Customer'
  checkoutWeb = softwareSystem 'checkout-web' {
    description 'Customer-facing checkout UI'
  }
  paymentService = softwareSystem 'payment-service' {
    description 'Owns payment authorization/capture'
  }

  customer -> checkoutWeb 'Uses'
  checkoutWeb -> paymentService 'Calls authorizePayment' {
    metadata { op 'authorizePayment' }
  }
}

views {
  view landscape {
    include *
  }
}
`;

/**
 * FEAT-1's delta, with a dynamic view added to the one the harness ships.
 *
 * The feature tag sits in a COMMA-separated list beside the group tag, which is
 * the shape an author actually writes and the shape the strip has to survive:
 * removing `#FEAT-1` alone would leave `, #payments`, which does not parse.
 */
function delta(view: string): string {
  return `specification {
  element softwareSystem
  tag FEAT-1
  tag payments
}

model {
  checkoutWeb = softwareSystem 'checkout-web'
  paymentService = softwareSystem 'payment-service'
  paymentSplitService = softwareSystem 'payment-split-service' {
    #FEAT-1
    description 'Splits a payment across payees'
  }

  paymentService -> paymentSplitService 'Calls createSplit' {
    #FEAT-1
    metadata { op 'createSplit' }
  }
}

views {
  view feat_1 {
    include *
  }

${view}}
`;
}

/** The journey FEAT-1 draws, tagged for the feature and for one suite. */
const SPLIT_JOURNEY = `  dynamic view splitJourney {
    #FEAT-1, #payments
    title 'Split a payment'
    checkoutWeb -> paymentService 'authorize'
    paymentService -> paymentSplitService 'createSplit'
  }
`;

/** The same journey with no feature tag: context, not a change. */
const UNTAGGED_JOURNEY = `  dynamic view splitJourney {
    #payments
    title 'Split a payment'
    checkoutWeb -> paymentService 'authorize'
  }
`;

function fixture(view: string = SPLIT_JOURNEY): Record<string, string> {
  return {
    ...coherentFixture(),
    "architecture/landscape.likec4": LANDSCAPE,
    "features/FEAT-1-split/delta.likec4": delta(view),
  };
}

function payload(stdout: string): Record<string, unknown> {
  return JSON.parse(stdout) as Record<string, unknown>;
}

/** Every warning code an `archive --json` run reported. */
function warningCodes(stdout: string): string[] {
  const out = payload(stdout).warnings as Array<{ code: string }>;
  return out.map((w) => w.code);
}

/* ------------------------------------------------------------------ */
/* Adding a journey the fleet does not have                            */
/* ------------------------------------------------------------------ */

describe("a delta's tagged dynamic view is merged into the living fleet", () => {
  it("lands a new journey in its own file, named for the view, with the feature tag stripped", async () => {
    const p = await makeProject(fixture());
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-1", "--json");
      expect(res.code, res.out).toBe(0);

      // The file exists at all — before this slice nothing merged a views block.
      expect(p.exists(FLOW_FILE)).toBe(true);
      const landed = await p.read(FLOW_FILE);
      expect(landed).toContain("dynamic view splitJourney {");
      expect(landed).toContain("title 'Split a payment'");
      // The tag list survived the strip: `#FEAT-1, #payments` is `#payments`,
      // not `, #payments`, and the group tag keeps its own indentation.
      expect(landed).toContain("\n    #payments\n");
      expect(landed).not.toContain("FEAT-1,");
      expect(landed).not.toContain("#FEAT-1");
      // The living fleet map keeps its own views block untouched.
      expect(await p.read("architecture/landscape.likec4")).not.toContain("dynamic view");

      const json = payload(res.stdout);
      expect(json.flowViews).toEqual([{ id: "splitJourney", path: FLOW_FILE, action: "added" }]);
      const plan = json.plan as Array<{ path: string; action: string }>;
      expect(plan).toContainEqual({ path: FLOW_FILE, action: "create" });
    } finally {
      await p.destroy();
    }
  });

  it("leaves a fleet whose journeys loam can still read, and a suite `loam flow env` can answer", async () => {
    const p = await makeProject(fixture());
    try {
      expect((await runLoam(p.workDir, "archive", "FEAT-1")).code).toBe(0);
      // `loam flow sync` is the one writer of the generated views file, and the
      // archive told the author to run it; running it must clear what the
      // archive reported. (The fleet stays red on the axis this archive never
      // claimed to finish — the new service has no `model.likec4` — which is
      // `service.no-model`'s subject, so the assertion is on the flow axis.)
      expect((await runLoam(p.workDir, "flow", "sync")).code).toBe(0);
      const validated = await runLoam(p.workDir, "validate", "--all", "--json");
      const flowCodes = (payload(validated.stdout).targets as Array<{
        findings: Array<{ code: string; severity: string }>;
      }>)
        .flatMap((t) => t.findings)
        .filter((f) => f.code.startsWith("flow.") && f.severity === "error")
        .map((f) => f.code);
      // The two errors this slice could have caused: a merged document the
      // fleet cannot read, and a generated file the sync did not settle.
      expect(flowCodes, validated.out).toEqual([]);

      const env = await runLoam(p.workDir, "flow", "env", "payments", "--json");
      expect(env.code, env.out).toBe(0);
      const groups = payload(env.stdout).groups as Array<{
        group: string;
        flows: string[];
        services: string[];
        unresolved: Array<{ service: string }>;
      }>;
      expect(groups).toHaveLength(1);
      expect(groups[0]!.flows).toEqual(["splitJourney"]);
      // The service the merge created is part of the suite's environment the
      // moment the journey naming it lands. `checkout-web` has no directory in
      // this fixture, so it is REPORTED as unresolved rather than dropped —
      // a shorter environment list is the failure `flow env` exists to prevent.
      expect(groups[0]!.services).toEqual(["payment-service", "payment-split-service"]);
      expect(groups[0]!.unresolved.map((u) => u.service)).toEqual(["checkout-web"]);
    } finally {
      await p.destroy();
    }
  });

  it("says the generated group views are now stale, and withholds the closing claim", async () => {
    const p = await makeProject(fixture());
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-1", "--json");
      expect(warningCodes(res.stdout)).toContain("flow.views-stale");

      const human = await makeProject(fixture());
      try {
        const text = await runLoam(human.workDir, "archive", "FEAT-1");
        expect(text.out).toContain("loam flow sync");
        // The closing line is a claim about the whole docs repo; this archive
        // has just made `validate --all` report a file.
        expect(text.out).not.toContain("living spec + landscape are now complete + current");
      } finally {
        await human.destroy();
      }
    } finally {
      await p.destroy();
    }
  });

  it("is not gated by it — the merge is correct, the generated file is the next step", async () => {
    const p = await makeProject(fixture());
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-1", "--json");
      expect(res.code).toBe(0);
      expect(payload(res.stdout).archived).toBe(true);
    } finally {
      await p.destroy();
    }
  });

  it("--dry-run computes the whole view merge — parse net included — and writes nothing", async () => {
    const p = await makeProject(fixture());
    try {
      const before = await treeHashes(p.docsDir);
      const res = await runLoam(p.workDir, "archive", "FEAT-1", "--dry-run", "--json");
      expect(res.code, res.out).toBe(0);
      const json = payload(res.stdout);
      expect(json.archived).toBe(false);
      // What WOULD happen is what DOES happen: the dry run's payload names the
      // same journey and the same destination the real merge lands.
      expect(json.flowViews).toEqual([{ id: "splitJourney", path: FLOW_FILE, action: "added" }]);
      expect(warningCodes(res.stdout)).toContain("flow.views-stale");
      expect(await treeHashes(p.docsDir)).toEqual(before);
    } finally {
      await p.destroy();
    }
  });
});

/* ------------------------------------------------------------------ */
/* Replacing a journey the fleet already has                           */
/* ------------------------------------------------------------------ */

describe("a view the living fleet already declares is replaced where it is declared", () => {
  const LIVING_FLOW = `// hand-written, and this comment must survive the merge
views {
  dynamic view splitJourney {
    #payments
    title 'The old journey'
    checkoutWeb -> paymentService 'authorize'
  }
}
`;

  it("rewrites the file under architecture/flows/ that declares it, and creates no second file", async () => {
    const p = await makeProject({ ...fixture(), [FLOW_FILE]: LIVING_FLOW });
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-1", "--json");
      expect(res.code, res.out).toBe(0);

      const landed = await p.read(FLOW_FILE);
      expect(landed).toContain("hand-written, and this comment must survive");
      expect(landed).toContain("title 'Split a payment'");
      expect(landed).not.toContain("The old journey");
      // Replace-or-add is keyed on the id, so the whole declaration moved and
      // nothing was appended beside it.
      expect(landed.match(/dynamic view splitJourney/g)).toHaveLength(1);

      expect(payload(res.stdout).flowViews).toEqual([
        { id: "splitJourney", path: FLOW_FILE, action: "replaced" },
      ]);
    } finally {
      await p.destroy();
    }
  });

  it("rewrites the fleet map itself when that is where the view lives, in ONE write", async () => {
    const inLandscape = LANDSCAPE.replace(
      "views {\n",
      `views {\n  dynamic view splitJourney {\n    #payments\n    title 'The old journey'\n    checkoutWeb -> paymentService 'authorize'\n  }\n\n`,
    );
    const p = await makeProject({ ...fixture(), "architecture/landscape.likec4": inLandscape });
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-1", "--json");
      expect(res.code, res.out).toBe(0);

      const landed = await p.read("architecture/landscape.likec4");
      expect(landed).toContain("title 'Split a payment'");
      expect(landed).not.toContain("The old journey");
      // The model merge and the view merge share one landscape text: two
      // planned writes of one path would stage two swaps of the same file, and
      // the second one's compare-and-set would refuse the merge.
      expect(landed).toContain("payment-split-service");
      expect(p.exists(FLOW_FILE)).toBe(false);

      const plan = (payload(res.stdout).plan as Array<{ path: string }>).map((w) => w.path);
      expect(plan.filter((path) => path === "architecture/landscape.likec4")).toHaveLength(1);
    } finally {
      await p.destroy();
    }
  });
});

/* ------------------------------------------------------------------ */
/* Untagged views                                                      */
/* ------------------------------------------------------------------ */

describe("a view carrying no feature tag is invisible to the merge", () => {
  it("merges nothing for it, and writes no flow file", async () => {
    const p = await makeProject(fixture(UNTAGGED_JOURNEY));
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-1", "--json");
      expect(res.code, res.out).toBe(0);
      expect(payload(res.stdout).flowViews).toEqual([]);
      expect(p.exists(FLOW_FILE)).toBe(false);
    } finally {
      await p.destroy();
    }
  });

  it("is `delta.nothing-tagged` when it is the only thing the delta declares", async () => {
    // A views-only delta: before views were projected at all, this file
    // declared "nothing" and archived while merging nothing, in silence.
    const viewsOnly = `specification {
  element softwareSystem
  tag payments
}

model {
  checkoutWeb = softwareSystem 'checkout-web'
  paymentService = softwareSystem 'payment-service'
}

views {
${UNTAGGED_JOURNEY}}
`;
    const p = await makeProject({ ...fixture(), "features/FEAT-1-split/delta.likec4": viewsOnly });
    try {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json");
      expect(res.code).toBe(1);
      const codes = (payload(res.stdout).targets as Array<{ findings: Array<{ code: string }> }>)
        .flatMap((t) => t.findings)
        .map((f) => f.code);
      expect(codes).toContain("delta.nothing-tagged");
    } finally {
      await p.destroy();
    }
  });
});

/* ------------------------------------------------------------------ */
/* Two features, one journey                                           */
/* ------------------------------------------------------------------ */

describe("two features changing one journey", () => {
  /** A second active feature whose delta claims the same view id. */
  function rival(): Record<string, string> {
    return {
      "features/FEAT-9-rework/intent.md":
        "---\nfeature: FEAT-9\nstatus: proposed\nowner: platform\n---\n\n# Rework checkout\n\nRedraw the split journey.\n",
      "features/FEAT-9-rework/delta.likec4": `specification {
  element softwareSystem
  tag FEAT-9
  tag payments
}

model {
  checkoutWeb = softwareSystem 'checkout-web'
  paymentService = softwareSystem 'payment-service'
}

views {
  dynamic view splitJourney {
    #FEAT-9, #payments
    title 'A different split'
    checkoutWeb -> paymentService 'authorize'
  }
}
`,
    };
  }

  it("warns each of them, naming the other, because a replace discards the other's journey whole", async () => {
    const p = await makeProject({ ...fixture(), ...rival() });
    try {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json");
      const findings = (payload(res.stdout).targets as Array<{ findings: Array<Record<string, unknown>> }>)
        .flatMap((t) => t.findings)
        .filter((f) => f.code === "flow.view-conflict");
      expect(findings).toHaveLength(1);
      expect(findings[0]!.severity).toBe("warn");
      expect(findings[0]!.subject).toBe("splitJourney");
      expect(String(findings[0]!.message)).toContain("FEAT-9");
      expect(String(findings[0]!.message)).toContain("splitJourney");
    } finally {
      await p.destroy();
    }
  });

  it("never gates — both deltas apply, and only the two authors can say which wins", async () => {
    const p = await makeProject({ ...fixture(), ...rival() });
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-1", "--json");
      expect(res.code, res.out).toBe(0);
      expect(warningCodes(res.stdout)).toContain("flow.view-conflict");
    } finally {
      await p.destroy();
    }
  });

  it("says nothing about a rival's UNTAGGED view — context clobbers nothing", async () => {
    const context = rival();
    context["features/FEAT-9-rework/delta.likec4"] = context["features/FEAT-9-rework/delta.likec4"]!.replace(
      "#FEAT-9, #payments",
      "#payments",
    );
    const p = await makeProject({ ...fixture(), ...context });
    try {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json");
      const codes = (payload(res.stdout).targets as Array<{ findings: Array<{ code: string }> }>)
        .flatMap((t) => t.findings)
        .map((f) => f.code);
      expect(codes).not.toContain("flow.view-conflict");
    } finally {
      await p.destroy();
    }
  });
});

/* ------------------------------------------------------------------ */
/* The parse net                                                       */
/* ------------------------------------------------------------------ */

describe("a merge that would leave architecture/ unparseable", () => {
  it("refuses at plan time and writes nothing, naming what the landscape does not declare", async () => {
    // `#regression` parses inside the delta (which declares it) and resolves to
    // nothing once the view lands beside a fleet map that does not.
    const undeclared = delta(SPLIT_JOURNEY.replace("#FEAT-1, #payments", "#FEAT-1, #regression")).replace(
      "  tag payments\n",
      "  tag payments\n  tag regression\n",
    );
    const p = await makeProject({ ...fixture(), "features/FEAT-1-split/delta.likec4": undeclared });
    try {
      const before = await treeHashes(p.docsDir);
      const res = await runLoam(p.workDir, "archive", "FEAT-1", "--json");
      expect(res.code).toBe(1);
      const err = payload(res.stdout).error as { code: string; message: string };
      expect(err.code).toBe("merge-failed");
      expect(err.message).toContain("specification block");
      expect(await treeHashes(p.docsDir), "nothing may be written by a refused merge").toEqual(before);
    } finally {
      await p.destroy();
    }
  });

  it("refuses rather than overwrite a document already standing where a new journey would land", async () => {
    const p = await makeProject({
      ...fixture(),
      [FLOW_FILE]: "// somebody else's journey, under this journey's name\nviews {\n  dynamic view other {\n    checkoutWeb -> paymentService 'x'\n  }\n}\n",
    });
    try {
      const before = await treeHashes(p.docsDir);
      const res = await runLoam(p.workDir, "archive", "FEAT-1", "--json");
      expect(res.code).toBe(1);
      expect((payload(res.stdout).error as { code: string }).code).toBe("merge-failed");
      expect(await treeHashes(p.docsDir)).toEqual(before);
    } finally {
      await p.destroy();
    }
  });
});

/* ------------------------------------------------------------------ */
/* The transaction                                                     */
/* ------------------------------------------------------------------ */

describe("the flow merge commits through the same transaction as every other write", () => {
  it("rolls back byte-identically when the flow file's own swap fails mid-commit", async () => {
    const p = await makeProject(fixture());
    try {
      const before = await treeHashes(p.docsDir);
      fsFault.onLink = (_from, to) => {
        if (to.endsWith(join("architecture", "flows", "splitJourney.likec4"))) {
          throw new Error("injected: the flow document's swap failed");
        }
      };
      const res = await runLoam(p.workDir, "archive", "FEAT-1", "--json");
      fsFault.onLink = undefined;

      expect(res.code).toBe(1);
      const err = payload(res.stdout).error as { code: string; message: string };
      expect(err.code).toBe("merge-failed");
      expect(err.message.toLowerCase()).toContain("rolled back");
      // Every earlier swap is undone from its snapshot pre-image, the created
      // flow file is gone, and so is the directory the staging made for it.
      expect(await treeHashes(p.docsDir), "the rollback must be byte-identical, tree-wide").toEqual(before);
      expect(p.exists("architecture/flows")).toBe(false);
      expect(p.exists("features/FEAT-1-split/.loam-before")).toBe(false);
    } finally {
      fsFault.onLink = undefined;
      await p.destroy();
    }
  });

  it("re-runs cleanly after that rollback", async () => {
    const p = await makeProject(fixture());
    try {
      fsFault.onLink = (_from, to) => {
        if (to.endsWith("splitJourney.likec4")) throw new Error("injected: the flow document's swap failed");
      };
      expect((await runLoam(p.workDir, "archive", "FEAT-1")).code).toBe(1);
      fsFault.onLink = undefined;

      expect((await runLoam(p.workDir, "archive", "FEAT-1")).code).toBe(0);
      expect(await p.read(FLOW_FILE)).toContain("title 'Split a payment'");
    } finally {
      fsFault.onLink = undefined;
      await p.destroy();
    }
  });

  it("is repaired by the next command when the process is killed between two swaps", async () => {
    // The on-disk state a SIGKILL leaves, built from staging's OWN primitives
    // in archive's own order (write-path-integrity.test.ts's technique — there
    // are no fault-injection hooks in src/). The FLOW file is the swap that
    // landed, so the repair is the interesting one: its pre-image is null, so
    // putting the docs back means DELETING it, and the directory the staging
    // made for it has to go with it.
    const p = await makeProject(fixture());
    try {
      const clean = await treeHashes(p.docsDir);
      const featureDir = join(p.docsDir, "features/FEAT-1-split");
      const landscape = join(p.docsDir, "architecture/landscape.likec4");
      const landscapeBefore = await readFile(landscape);
      const writes = [
        planWrite(join(p.docsDir, FLOW_FILE), "views {\n  dynamic view splitJourney {\n    #payments\n  }\n}\n"),
        planWrite(landscape, `${landscapeBefore.toString("utf8").replace("model {", "model {\n  // merged by FEAT-1")}`),
      ];
      const staged = await stageWrites(writes);
      await writeSnapshot({
        featureDir,
        docsDir: p.docsDir,
        feature: { featureId: "FEAT-1", dirName: "FEAT-1-split" },
        staged,
        serviceKeyOf: (rel: string): ServiceKey | null => {
          const m = /^services\/([^/]+)\/(.+)$/.exec(rel);
          return m ? { service: m[1]!, artifact: m[2]! } : null;
        },
        serviceDirOf: (service: string): string => `services/${service}`,
      });
      await writeCommitIntent(
        p.docsDir,
        {
          command: "archive",
          restore: "before",
          feature: "FEAT-1",
          moveFrom: featureDir,
          moveTo: join(p.docsDir, "features/archive/FEAT-1-split"),
        },
        staged,
      );
      await swapStaged(staged.slice(0, 1));
      // The half-merge is real: the journey landed, the fleet map did not.
      expect(p.exists(FLOW_FILE)).toBe(true);
      expect((await readFile(landscape)).equals(landscapeBefore)).toBe(true);

      const recovery = await recoverInterruptedCommit(p.docsDir);
      expect(recovery?.outcome).toBe("repaired");
      expect(recovery?.repaired).toEqual([FLOW_FILE]);
      // Back to the bytes the killed run found — the created file gone, and
      // the directory it was created in gone with it.
      await rm(snapshotDir(featureDir), { recursive: true, force: true });
      expect(await treeHashes(p.docsDir)).toEqual(clean);

      // And the archive it interrupted still works.
      expect((await runLoam(p.workDir, "archive", "FEAT-1")).code).toBe(0);
      expect(await p.read(FLOW_FILE)).toContain("title 'Split a payment'");
    } finally {
      await p.destroy();
    }
  });

  it("leaves the whole old flow document or the whole new one when a LATER swap fails", async () => {
    // The replace case: the flow document already exists, so a fault after its
    // swap has to restore the complete pre-image, never a spliced fragment.
    const living = `views {
  dynamic view splitJourney {
    #payments
    title 'The old journey'
    checkoutWeb -> paymentService 'authorize'
  }
}
`;
    const p = await makeProject({ ...fixture(), [FLOW_FILE]: living });
    try {
      let flowSwapped = false;
      fsFault.onRename = (_from, to) => {
        if (to.endsWith("splitJourney.likec4")) flowSwapped = true;
        else if (flowSwapped && to.includes(join("features", "archive"))) {
          throw new Error("injected: the feature move failed after every swap");
        }
      };
      const res = await runLoam(p.workDir, "archive", "FEAT-1", "--json");
      fsFault.onRename = undefined;
      expect(res.code).toBe(1);

      const after = await p.read(FLOW_FILE);
      expect(after === living || after.includes("title 'Split a payment'")).toBe(true);
      // Whichever it is, it is a whole document: it still parses as part of the
      // project, which is what `loam flow sync` refuses to run without.
      expect((await runLoam(p.workDir, "flow", "sync", "--json")).code).toBe(0);
    } finally {
      fsFault.onRename = undefined;
      await p.destroy();
    }
  });
});

/* ------------------------------------------------------------------ */
/* Unarchive                                                           */
/* ------------------------------------------------------------------ */

describe("unarchive puts every flow document back byte for byte", () => {
  it("removes a journey file the archive created, and the directory it created for it", async () => {
    const p = await makeProject(fixture());
    try {
      const before = await treeHashes(p.docsDir);
      expect((await runLoam(p.workDir, "archive", "FEAT-1")).code).toBe(0);
      expect(p.exists(FLOW_FILE)).toBe(true);

      const res = await runLoam(p.workDir, "unarchive", "FEAT-1", "--json");
      expect(res.code, res.out).toBe(0);
      expect(payload(res.stdout).removed).toContain(FLOW_FILE);
      expect(await treeHashes(p.docsDir), "the undo must be byte-identical, tree-wide").toEqual(before);
    } finally {
      await p.destroy();
    }
  });

  it("restores a journey file the archive REWROTE, from the snapshot pre-image", async () => {
    const living = `// hand-written; every byte of this file must come back
views {
  dynamic view splitJourney {
    #payments
    title 'The old journey'
    checkoutWeb -> paymentService 'authorize'
  }
}
`;
    const p = await makeProject({ ...fixture(), [FLOW_FILE]: living });
    try {
      const before = await treeHashes(p.docsDir);
      expect((await runLoam(p.workDir, "archive", "FEAT-1")).code).toBe(0);
      expect(await p.read(FLOW_FILE)).toContain("title 'Split a payment'");

      // The snapshot has to carry the flow document, or there is nothing to
      // restore from: the previous text of a replaced view exists nowhere else.
      const manifest = JSON.parse(
        await readFile(join(p.docsDir, "features/archive/FEAT-1-split/.loam-before/manifest.json"), "utf8"),
      ) as { files: Array<{ path: string; existed: boolean }> };
      expect(manifest.files.map((f) => f.path)).toContain(FLOW_FILE);
      expect(manifest.files.find((f) => f.path === FLOW_FILE)!.existed).toBe(true);

      expect((await runLoam(p.workDir, "unarchive", "FEAT-1")).code).toBe(0);
      expect(await p.read(FLOW_FILE)).toBe(living);
      expect(await treeHashes(p.docsDir)).toEqual(before);
    } finally {
      await p.destroy();
    }
  });

  it("refuses to call it an undo once the restored journey has been edited since", async () => {
    const p = await makeProject(fixture());
    try {
      expect((await runLoam(p.workDir, "archive", "FEAT-1")).code).toBe(0);
      await p.write(FLOW_FILE, `${await p.read(FLOW_FILE)}\n// a later hand edit\n`);
      const res = await runLoam(p.workDir, "unarchive", "FEAT-1", "--json");
      expect(res.code).toBe(1);
      expect((payload(res.stdout).error as { code: string }).code).toBe("snapshot-stale");
      expect((await runLoam(p.workDir, "unarchive", "FEAT-1", "--force")).code).toBe(0);
      expect(p.exists(FLOW_FILE)).toBe(false);
    } finally {
      await p.destroy();
    }
  });
});
