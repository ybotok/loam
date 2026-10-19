/**
 * A landscape written in SEVERAL top-level `model { }` blocks — legal LikeC4,
 * which reads them as one model — archived like any other.
 *
 * The defect (a fleet on 0.2.0-alpha.7, 2026-10): the splice map read only the
 * FIRST block, so every declaration in a later one was invisible to placement.
 * `validate --all` was green, `status` said ready, and `loam archive` refused
 * `merge-failed` with "declares 'entityService' in a form placement cannot
 * locate — most often two declarations sharing one line", about a standalone
 * declaration on a line of its own. The reporter asked not to rewrite a valid
 * map merely to satisfy the message, and they were right.
 *
 * What placement does across blocks is the rule `src/core/c4/splice/placement.ts`
 * states: an anchored addition lands in its anchor's block, an unanchored one in
 * `HOME_BLOCK` (the first), and a single-block map places byte for byte as it
 * always did — the first case below pins that against bytes the pre-fix code
 * produced, so it cannot drift with the fix.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadSource } from "../src/core/c4/likec4.js";
import { scanModel } from "../src/core/c4/source-scan.js";
import type { ExtendingModel } from "../src/core/c4/splice/contract.js";
import { planLandscapeMerge } from "../src/core/c4/splice/landscape-merge.js";
import { spliceModel } from "../src/core/c4/splice/model/merge.js";
import { makeProject, runLoam, type Project } from "./helpers/harness.js";

const EXAMPLES = fileURLToPath(new URL("../examples/docs", import.meta.url));

const SPEC = `specification {
  element group
  element softwareSystem
  element container
  tag FEAT-7
  tag FEAT-8
}
`;

const VIEWS = `views {
  view index { include * }
}
`;

/** One block: the shape every map had before this fix, and the regression baseline. */
const SINGLE = `${SPEC}
model {
  shop = group 'Shop' {
    checkoutWeb = softwareSystem 'checkout-web'
    paymentService = softwareSystem 'payment-service' {
      description 'Owns payments'
    }
  }
  ledger = softwareSystem 'ledger-service'
  zeta = softwareSystem 'zeta-service'

  shop.checkoutWeb -> shop.paymentService 'Calls authorize'
  shop.paymentService -> ledger 'Posts entries'
}

${VIEWS}`;

/** The same model, ledger and zeta (and the edge into ledger) moved into a SECOND block below the views. */
const TWO = `${SPEC}
model {
  shop = group 'Shop' {
    checkoutWeb = softwareSystem 'checkout-web'
    paymentService = softwareSystem 'payment-service' {
      description 'Owns payments'
    }
  }

  shop.checkoutWeb -> shop.paymentService 'Calls authorize'
}

${VIEWS}
model {
  ledger = softwareSystem 'ledger-service'
  zeta = softwareSystem 'zeta-service'

  shop.paymentService -> ledger 'Posts entries'
}
`;

/** Ledger's side: nested in and anchored to ledger, plus one new service and its feed. */
const DELTA_A = `${SPEC}
model {
  shop = group 'Shop' {
    paymentService = softwareSystem 'payment-service'
  }
  ledger = softwareSystem 'ledger-service' {
    store = container 'Store' {
      #FEAT-7
    }
  }
  ledgerAudit = softwareSystem 'Ledger Audit' {
    #FEAT-7
    metadata { service 'ledger-service' }
  }
  mango = softwareSystem 'mango-service' {
    #FEAT-7
  }

  ledger -> mango 'Feeds' {
    #FEAT-7
  }
}
`;

/** The shop's side, touching none of ledger's services: a nested service, a new one, an unanchored edge. */
const DELTA_B = `${SPEC}
model {
  shop = group 'Shop' {
    refunds = softwareSystem 'refund-service' {
      #FEAT-8
    }
  }
  zeta = softwareSystem 'zeta-service'
  alpha = softwareSystem 'alpha-service' {
    #FEAT-8
  }

  alpha -> zeta 'Pings' {
    #FEAT-8
  }
}
`;

/** Both sides in ONE delta, under one feature: the N-addition archive the sequential pair must equal. */
const DELTA_AB = `${SPEC}
model {
  shop = group 'Shop' {
    paymentService = softwareSystem 'payment-service'
    refunds = softwareSystem 'refund-service' {
      #FEAT-7
    }
  }
  ledger = softwareSystem 'ledger-service' {
    store = container 'Store' {
      #FEAT-7
    }
  }
  ledgerAudit = softwareSystem 'Ledger Audit' {
    #FEAT-7
    metadata { service 'ledger-service' }
  }
  mango = softwareSystem 'mango-service' {
    #FEAT-7
  }
  zeta = softwareSystem 'zeta-service'
  alpha = softwareSystem 'alpha-service' {
    #FEAT-7
  }

  ledger -> mango 'Feeds' {
    #FEAT-7
  }
  alpha -> zeta 'Pings' {
    #FEAT-7
  }
}
`;

/** One archive's landscape merge, as `loam archive` plans it; the landscape unchanged when nothing lands. */
async function merge(land: string, deltaText: string, featureId: string, models?: ExtendingModel[]): Promise<string> {
  const delta = await loadSource(deltaText);
  expect(delta.errors).toEqual([]);
  const plan = await planLandscapeMerge({
    landscapeText: land,
    deltaText,
    deltaElements: delta.elements,
    newEls: delta.elements.filter((e) => e.tags.includes(featureId)),
    newRels: delta.relationships.filter((r) => r.tags.includes(featureId)),
    featureId,
    ...(models === undefined ? {} : { models }),
  });
  return plan.content ?? land;
}

/** `land` after A then B, or B then A. */
async function inOrder(land: string, order: "AB" | "BA"): Promise<string> {
  return order === "AB"
    ? merge(await merge(land, DELTA_A, "FEAT-7"), DELTA_B, "FEAT-8")
    : merge(await merge(land, DELTA_B, "FEAT-8"), DELTA_A, "FEAT-7");
}

/** Which block of `text` a declaration (by id) or an edge (by title) was written into. */
function blockOf(text: string, which: { id?: string; title?: string }): number | undefined {
  const scan = scanModel(text)!;
  if (which.id !== undefined) return scan.elements.find((e) => e.id === which.id && e.extend !== true)?.block;
  return scan.rels.find((r) => r.title === which.title)?.block;
}

describe("a single-block landscape places byte for byte as it did before blocks existed", () => {
  // Captured from the pre-fix code (main at 171555d) on exactly these inputs:
  // an addition nested in a living parent with a body, one gaining a body, one
  // nested in a group, an element anchored to its service, two unanchored
  // services sorted into the trailing region, an anchored edge and an
  // unanchored one. A literal, not a recomputation, so it cannot follow a
  // regression in the code it pins.
  const BEFORE_BLOCKS = `${SPEC}
model {
  alpha = softwareSystem 'alpha-service'
  shop = group 'Shop' {
    checkoutWeb = softwareSystem 'checkout-web'
    paymentService = softwareSystem 'payment-service' {
      description 'Owns payments'
    }
    refunds = softwareSystem 'refund-service'
  }
  ledger = softwareSystem 'ledger-service' {
    store = container 'Store'
  }
  ledgerAudit = softwareSystem 'Ledger Audit' {
    metadata { service 'ledger-service' }
  }
  mango = softwareSystem 'mango-service'
  zeta = softwareSystem 'zeta-service'

  alpha -> zeta 'Pings'
  shop.checkoutWeb -> shop.paymentService 'Calls authorize'
  shop.paymentService -> ledger 'Posts entries'
  ledger -> mango 'Feeds'
}

${VIEWS}`;

  it("A then B, B then A and one A+B archive all write the pre-fix bytes", async () => {
    expect(await inOrder(SINGLE, "AB")).toBe(BEFORE_BLOCKS);
    expect(await inOrder(SINGLE, "BA")).toBe(BEFORE_BLOCKS);
    expect(await merge(SINGLE, DELTA_AB, "FEAT-7")).toBe(BEFORE_BLOCKS);
  });
});

describe("a landscape with two model blocks merges, each addition in the block the rules name", () => {
  it("anchored additions land in their anchor's (second) block, unanchored ones in the first", async () => {
    const merged = await inOrder(TWO, "AB");
    expect((await loadSource(merged)).errors).toEqual([]);
    // Anchored to ledger, which lives in the second block: nested inside it,
    // beside it, and after the edge already touching its service.
    expect(blockOf(merged, { id: "ledger.store" })).toBe(1);
    expect(blockOf(merged, { id: "ledgerAudit" })).toBe(1);
    expect(blockOf(merged, { title: "Feeds" })).toBe(1);
    // Nested in shop, which lives in the first.
    expect(blockOf(merged, { id: "shop.refunds" })).toBe(0);
    // Anchored to nothing: the home block, insertion-sorted as a single block is.
    expect(blockOf(merged, { id: "mango" })).toBe(0);
    expect(blockOf(merged, { id: "alpha" })).toBe(0);
    expect(blockOf(merged, { title: "Pings" })).toBe(0);
    expect(merged).toBe(`${SPEC}
model {
  alpha = softwareSystem 'alpha-service'
  mango = softwareSystem 'mango-service'
  shop = group 'Shop' {
    checkoutWeb = softwareSystem 'checkout-web'
    paymentService = softwareSystem 'payment-service' {
      description 'Owns payments'
    }
    refunds = softwareSystem 'refund-service'
  }

  alpha -> zeta 'Pings'
  shop.checkoutWeb -> shop.paymentService 'Calls authorize'
}

${VIEWS}
model {
  ledger = softwareSystem 'ledger-service' {
    store = container 'Store'
  }
  ledgerAudit = softwareSystem 'Ledger Audit' {
    metadata { service 'ledger-service' }
  }
  zeta = softwareSystem 'zeta-service'

  shop.paymentService -> ledger 'Posts entries'
  ledger -> mango 'Feeds'
}
`);
  });

  it("order-independent across blocks: A then B, B then A and one A+B archive are the same bytes", async () => {
    const ab = await inOrder(TWO, "AB");
    expect(await inOrder(TWO, "BA")).toBe(ab);
    expect(await merge(TWO, DELTA_AB, "FEAT-7")).toBe(ab);
  });

  it("an addition the delta writes in ITS second model block is located there", async () => {
    // The delta is read by the same scan, so a delta authored in two blocks lost
    // every addition after the first one: "cannot locate 'kiwi' in delta.likec4".
    const delta = `${SPEC}
model {
  ledger = softwareSystem 'ledger-service'
}

model {
  kiwi = softwareSystem 'kiwi-service' {
    #FEAT-7
  }
}
`;
    const merged = await merge(SINGLE, delta, "FEAT-7");
    expect(merged).toContain("model {\n  kiwi = softwareSystem 'kiwi-service'\n  shop = group 'Shop' {\n");
  });
});

describe("the reported shape: the shipped example fleet with a second model block appended", () => {
  const SECOND = "\nmodel {\n  entityService = softwareSystem 'Entity Service' {\n    description 'Holds entities'\n  }\n}\n";

  /** The example fleet, its map optionally extended, FEAT-101 archived; returns the merged map. */
  async function archived(p: Project, extra: string): Promise<{ dry: { ok: boolean; error?: { code: string } }; map: string }> {
    await cp(EXAMPLES, p.docsDir, { recursive: true });
    await p.write("architecture/landscape.likec4", (await p.read("architecture/landscape.likec4")) + extra);
    const dry = JSON.parse((await runLoam(p.workDir, "archive", "FEAT-101", "--dry-run", "--json")).stdout);
    expect((await runLoam(p.workDir, "archive", "FEAT-101")).code).toBe(0);
    return { dry, map: await p.read("architecture/landscape.likec4") };
  }

  it("archive FEAT-101 succeeds, and lands exactly what it lands on the one-block map", async () => {
    const one = await makeProject({});
    const two = await makeProject({});
    try {
      const plain = await archived(one, "");
      const reported = await archived(two, SECOND);
      // It used to be ok:false, merge-failed, naming entityService.
      expect(reported.dry.ok, JSON.stringify(reported.dry)).toBe(true);
      // FEAT-101 anchors in the first block (nested in `marketplace`, its edges
      // beside their services'), so the second block rides along untouched.
      expect(reported.map).toBe(plain.map + SECOND);
      expect((await loadSource(reported.map)).errors).toEqual([]);
    } finally {
      await one.destroy();
      await two.destroy();
    }
  });
});

describe("validate --all --base reads the edges of every block of the map", () => {
  function git(cwd: string, ...args: string[]): void {
    const res = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 30_000 });
    if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
  }

  it("an op misspelt on an edge in the SECOND block is graded against its provider", async () => {
    // `--base` grades the call edges the branch introduced, read off the same
    // scan; an edge in a second block was in no scan, so a misspelt op there
    // merged green through the PR gate test/validate-base.test.ts pins.
    const edge = (op: string): string =>
      `\nmodel {\n  marketplace.checkoutWeb -> marketplace.orderService 'Calls cancelOrder' {\n    metadata { op '${op}' }\n  }\n}\n`;
    const p = await makeProject({});
    try {
      await cp(EXAMPLES, p.docsDir, { recursive: true });
      const map = "architecture/landscape.likec4";
      const base = await p.read(map);
      await p.write(map, base + edge("cancelOrder"));
      git(p.docsDir, "init", "-q", "-b", "main");
      git(p.docsDir, "add", "-A");
      git(p.docsDir, "-c", "user.email=base@test.invalid", "-c", "user.name=Base Test", "commit", "-q", "-m", "base");
      await p.write(map, base + edge("cancelOrdr"));
      const res = await runLoam(p.workDir, "validate", "--all", "--base", "main", "--json");
      const payload = JSON.parse(res.stdout) as { targets?: { id: string; findings?: { code: string; message: string }[] }[] };
      const spine = (payload.targets ?? []).flatMap((t) => (t.findings ?? []).filter((f) => f.code === "spine.op-undefined"));
      expect(spine.map((f) => f.message).join("\n")).toContain("cancelOrdr");
      expect(res.code).toBe(1);
    } finally {
      await p.destroy();
    }
  });
});

describe("the service-model splice and the existence join read every block of an extending model", () => {
  const MAP = `${SPEC}
model {
  ledger = softwareSystem 'ledger-service'
  zeta = softwareSystem 'zeta-service'
}
`;
  // ledger's model, its `extend ledger` frame only in the SECOND block.
  const MODEL = `model {
  ledger -> zeta 'Reads'
}

${VIEWS}
model {
  extend ledger {
    db = container 'DB'
  }
}
`;
  const ledgerModel = (): ExtendingModel => ({ service: "ledger-service", path: "services/ledger-service/model.likec4", text: MODEL });

  it("a container the model declares in its second block is existence, not an addition", async () => {
    // Read as new, it was routed to the model and spliced in a second time — a
    // duplicate declaration only the caller's project parse would catch.
    const delta = `${SPEC}
model {
  ledger = softwareSystem 'ledger-service' {
    db = container 'DB' {
      #FEAT-7
    }
  }
}
`;
    const parsed = await loadSource(delta);
    const plan = await planLandscapeMerge({
      landscapeText: MAP,
      deltaText: delta,
      deltaElements: parsed.elements,
      newEls: parsed.elements.filter((e) => e.tags.includes("FEAT-7")),
      newRels: [],
      featureId: "FEAT-7",
      models: [ledgerModel()],
    });
    expect(plan).toEqual({ content: null, addedEls: [], addedRels: [], models: [] });
  });

  it("a child of ledger lands inside the model's existing `extend ledger` frame, wherever its block", async () => {
    const delta = `${SPEC}
model {
  ledger = softwareSystem 'ledger-service' {
    worker = container 'Worker' {
      #FEAT-7
    }
  }
  zeta = softwareSystem 'zeta-service'
  ledger.worker -> zeta 'Calls' {
    #FEAT-7
  }
}
`;
    const parsed = await loadSource(delta);
    const merged = spliceModel({
      additions: {
        model: ledgerModel(),
        els: parsed.elements.filter((e) => e.tags.includes("FEAT-7")),
        rels: parsed.relationships.filter((r) => r.tags.includes("FEAT-7")),
      },
      deltaText: delta,
      featureId: "FEAT-7",
    });
    // One frame, not a second one minted in the first block beside it.
    expect(merged.match(/extend ledger \{/g)).toHaveLength(1);
    expect(merged).toContain("  extend ledger {\n    db = container 'DB'\n    worker = container 'Worker'\n  }\n");
    // The edge has the home block's own anchor, the edge already there.
    expect(merged).toContain("  ledger -> zeta 'Reads'\n  ledger.worker -> zeta 'Calls'\n}\n");
    // And the model is legal against the map it extends: one document, two
    // files' worth of blocks, exactly how LikeC4 merges a project.
    expect((await loadSource(MAP + merged)).errors).toEqual([]);
  });
});
