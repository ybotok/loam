/**
 * `delta.specification-not-merged` — a feature whose additions use a kind or a
 * tag the LIVING map does not declare.
 *
 * The archive merges what carries the feature tag and never a `specification`
 * declaration, so such an addition lands as a reference to nothing and the
 * merged map does not parse. 0.2.0-alpha.13 shipped the seven relationship
 * kinds in the maps `init` and `seed` write, and named the gap it left: on a
 * map that predates them — `examples/docs`' declares none — a delta drawing
 * `-[publishes]->` validated clean, `loam status <FEAT>` called it ready, and
 * `loam archive` refused with `merge-failed` ("Could not resolve reference to
 * RelationshipKind named 'publishes'"). The same held for an element kind and
 * for a tag. Neutral shapes only: the example fleet, edited.
 */
import { describe, expect, it } from "vitest";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSource } from "../src/core/c4/likec4.js";
import { UndeclaredNamesError, type ExtendingModel } from "../src/core/c4/splice/contract.js";
import { planLandscapeMerge } from "../src/core/c4/splice/landscape-merge.js";
import { makeTmpDir, runLoam, treeHashes } from "./helpers/harness.js";

const EXAMPLES = fileURLToPath(new URL("../examples/docs", import.meta.url));
const FEAT = "features/FEAT-101-payment-splitting";
const CODE = "delta.specification-not-merged";

/** One anchored edit: `from` must occur in the file exactly once. */
type Edit = [rel: string, from: string, to: string];

/** FEAT-101's publish edge drawn with a kind only the delta's own specification declares. */
const KINDED: Edit[] = [
  [`${FEAT}/delta.likec4`, "  tag FEAT-101\n", "  tag FEAT-101\n  relationship publishes\n"],
  [
    `${FEAT}/delta.likec4`,
    "marketplace.paymentSplitService -> kafka.paymentEvents 'Publishes PaymentSplit' {",
    "marketplace.paymentSplitService -[publishes]-> kafka.paymentEvents 'Publishes PaymentSplit' {",
  ],
];
/** The repair the finding names: the kind, declared once, in the map. */
const DECLARED_IN_MAP: Edit = ["architecture/landscape.likec4", "  tag external\n", "  tag external\n  relationship publishes\n"];

/** A copy of the example fleet with `edits` applied. */
async function exampleFleet(edits: readonly Edit[]): Promise<{ dir: string; done: () => Promise<void> }> {
  const root = await makeTmpDir("loam-spec-unmerged-");
  const dir = join(root, "fleet");
  await cp(EXAMPLES, dir, { recursive: true });
  for (const [rel, from, to] of edits) {
    const text = (await readFile(join(dir, rel), "utf8")).replace(/\r\n/g, "\n");
    expect(text.split(from).length, `${rel} must hold the anchor exactly once: ${from}`).toBe(2);
    await writeFile(join(dir, rel), text.replace(from, to), "utf8");
  }
  return { dir, done: () => rm(root, { recursive: true, force: true }) };
}

interface Found {
  code: string;
  severity: string;
  gates?: boolean;
  message: string;
  locations?: Array<{ path: string; role: string }>;
}

/** `validate --feature FEAT-101 --json`: its exit code and every finding it filed. */
async function validateFeature(dir: string): Promise<{ code: number; findings: Found[] }> {
  const run = await runLoam(dir, "validate", "--feature", "FEAT-101", "--json");
  const json = JSON.parse(run.stdout) as { targets: Array<{ findings: Found[] }> };
  return { code: run.code, findings: json.targets.flatMap((t) => t.findings) };
}

describe("the reported shape: a map that declares no kinds, a feature that draws one", () => {
  it("validate --feature refuses it, naming the declaration to add and where", async () => {
    const f = await exampleFleet(KINDED);
    try {
      const { code, findings } = await validateFeature(f.dir);
      const hit = findings.filter((x) => x.code === CODE);
      expect(hit, JSON.stringify(findings)).toHaveLength(1);
      expect(hit[0]!.severity).toBe("error");
      expect(hit[0]!.gates).toBe(true);
      expect(hit[0]!.message).toContain("Declare `relationship publishes` in architecture/landscape.likec4's specification");
      expect(hit[0]!.message).toContain("marketplace.paymentSplitService -> kafka.paymentEvents");
      expect(hit[0]!.locations).toEqual([
        { path: "architecture/landscape.likec4", role: "primary" },
        { path: `${FEAT}/delta.likec4`, role: "related" },
      ]);
      expect(code).toBe(1);
    } finally {
      await f.done();
    }
  });

  it("status <FEAT> calls it draft, with the finding stopping the archive", async () => {
    const f = await exampleFleet(KINDED);
    try {
      const run = await runLoam(f.dir, "status", "FEAT-101", "--json");
      const json = JSON.parse(run.stdout) as { feature: { stage: string }; checks: { issues: Found[] } };
      expect(json.feature.stage).toBe("draft");
      expect(json.checks.issues.filter((x) => x.code === CODE).map((x) => x.gates)).toEqual([true]);
    } finally {
      await f.done();
    }
  });

  it("archive refuses before it writes anything, and --approve does not move it", async () => {
    const f = await exampleFleet(KINDED);
    try {
      const before = await treeHashes(f.dir);
      for (const args of [["--dry-run"], [], ["--approve"]]) {
        const run = await runLoam(f.dir, "archive", "FEAT-101", ...args, "--json");
        const json = JSON.parse(run.stdout) as {
          ok: boolean;
          error: { code: string; message: string };
          issues: Array<Found & { overridable?: boolean }>;
        };
        expect(run.code, args.join(" ")).toBe(1);
        expect(json.ok).toBe(false);
        expect(json.error.code, json.error.message).toBe("not-coherent");
        const hit = json.issues.filter((x) => x.code === CODE);
        expect(hit.map((x) => x.overridable), JSON.stringify(json.issues)).toEqual([false]);
        expect(hit[0]!.message).toContain("Declare `relationship publishes`");
      }
      expect(await treeHashes(f.dir), "a refused archive writes nothing").toEqual(before);
    } finally {
      await f.done();
    }
  });

  it("declared in the map, the same feature validates and archives, and the edge lands as drawn", async () => {
    const f = await exampleFleet([...KINDED, DECLARED_IN_MAP]);
    try {
      const { code, findings } = await validateFeature(f.dir);
      expect(findings.filter((x) => x.code === CODE)).toEqual([]);
      expect(code).toBe(0);
      const run = await runLoam(f.dir, "archive", "FEAT-101");
      expect(run.code, run.stdout + run.stderr).toBe(0);
      const map = await readFile(join(f.dir, "architecture/landscape.likec4"), "utf8");
      expect(map).toContain("marketplace.paymentSplitService -[publishes]-> kafka.paymentEvents 'Publishes PaymentSplit'");
      expect((await loadSource(map)).errors).toEqual([]);
    } finally {
      await f.done();
    }
  });
});

describe("the other two tables, in the document each addition lands in", () => {
  it("an element kind on a container the archive routes into the service model it creates", async () => {
    const f = await exampleFleet([
      [`${FEAT}/delta.likec4`, "  tag FEAT-101\n", "  tag FEAT-101\n  element queue\n"],
      [`${FEAT}/delta.likec4`, "      api = container 'api' {\n", "      jobs = queue 'jobs'\n      api = container 'api' {\n"],
    ]);
    try {
      const { code, findings } = await validateFeature(f.dir);
      const hit = findings.filter((x) => x.code === CODE);
      expect(hit, JSON.stringify(findings)).toHaveLength(1);
      expect(hit[0]!.message).toContain("Declare `element queue` in architecture/landscape.likec4's specification");
      // Judged where the archive would put it: the new service's own model,
      // which borrows every kind from the map.
      expect(hit[0]!.message).toContain("marketplace.paymentSplitService.jobs, landing in services/payment-split-service/model.likec4");
      expect(code).toBe(1);
    } finally {
      await f.done();
    }
  });

  it("a tag on the new service, and never the feature's own tag", async () => {
    const f = await exampleFleet([
      [`${FEAT}/delta.likec4`, "  tag FEAT-101\n", "  tag FEAT-101\n  tag pci\n"],
      [`${FEAT}/delta.likec4`, "      #FEAT-101\n      description 'Splits", "      #FEAT-101 #pci\n      description 'Splits"],
    ]);
    try {
      const { findings } = await validateFeature(f.dir);
      const hit = findings.filter((x) => x.code === CODE);
      expect(hit, JSON.stringify(findings)).toHaveLength(1);
      expect(hit[0]!.message).toContain("Declare `tag pci` in architecture/landscape.likec4's specification");
      expect(hit[0]!.message).not.toContain("FEAT-101");
    } finally {
      await f.done();
    }
  });

  it("the shipped example fleet earns nothing: every name its delta declares, the map declares too", async () => {
    const f = await exampleFleet([]);
    try {
      const { code, findings } = await validateFeature(f.dir);
      expect(findings.filter((x) => x.code === CODE)).toEqual([]);
      expect(code).toBe(0);
    } finally {
      await f.done();
    }
  });
});

/** The merge itself: the refusal behind the gate, with the names as data. */
const MAP = `specification {
  element group
  element softwareSystem
  element container
  tag external
}

model {
  shop = group 'Shop' {
    orders = softwareSystem 'order-service' {
      metadata { service 'order-service' }
    }
    payments = softwareSystem 'payment-service' {
      metadata { service 'payment-service' }
    }
  }
  shop.orders -> shop.payments 'Calls authorize'
}
`;

/** One merge of a delta declaring `spec` beside the map's kinds, with `body` as its model. */
async function plan(spec: string, body: string, models: ExtendingModel[] = []): ReturnType<typeof planLandscapeMerge> {
  const deltaText = `specification {\n  element group\n  element softwareSystem\n  element container\n  tag external\n  tag FEAT-7\n${spec}}\n\nmodel {\n${body}}\n`;
  const d = await loadSource(deltaText);
  expect(d.errors, "the delta must parse alone, or the case proves nothing").toEqual([]);
  return planLandscapeMerge({
    landscapeText: MAP,
    deltaText,
    deltaElements: d.elements,
    newEls: d.elements.filter((e) => e.tags.includes("FEAT-7")),
    newRels: d.relationships.filter((r) => r.tags.includes("FEAT-7")),
    featureId: "FEAT-7",
    deltaKindTags: d.specification?.relationshipKindTags ?? {},
    models,
  });
}

const STUBS = `  shop = group 'Shop' {
    orders = softwareSystem 'order-service'
    payments = softwareSystem 'payment-service'
  }
`;

describe("planLandscapeMerge names the declaration it would need", () => {
  it("refuses with the missing names as data, before it splices a byte", async () => {
    const refusal = await plan(
      "  relationship calls\n",
      `${STUBS}  shop.orders -[calls]-> shop.payments 'Calls capture' {\n    #FEAT-7\n  }\n`,
    ).catch((err: unknown) => err);
    expect(refusal).toBeInstanceOf(UndeclaredNamesError);
    expect((refusal as UndeclaredNamesError).missing).toEqual([
      { table: "relationship", name: "calls", document: "architecture/landscape.likec4", usedBy: "shop.orders -> shop.payments" },
    ]);
    expect((refusal as Error).message).toContain("Declare `relationship calls` in architecture/landscape.likec4's specification");
  });

  it("reads what rides inside a new block: an untagged child's kind, and an untagged edge drawn there", async () => {
    const refusal = await plan(
      "  element queue\n  relationship enqueues\n",
      `${STUBS}  ledger = softwareSystem 'ledger' {\n    #FEAT-7\n    inbox = queue 'inbox'\n    api = container 'api'\n    api -[enqueues]-> inbox\n  }\n`,
    ).catch((err: unknown) => err);
    expect(refusal).toBeInstanceOf(UndeclaredNamesError);
    expect((refusal as UndeclaredNamesError).missing.map((u) => `${u.table} ${u.name}`)).toEqual(["element queue", "relationship enqueues"]);
  });

  it("a kind the delta declares and no addition draws is nothing — the merge succeeds", async () => {
    const p = await plan("  relationship calls\n", `${STUBS}  shop.payments -> shop.orders 'Calls notify' {\n    #FEAT-7\n  }\n`);
    expect(p.content).toContain("shop.payments -> shop.orders 'Calls notify'");
    expect((await loadSource(p.content!)).errors).toEqual([]);
  });

  it("an edge the map already draws is no addition, whatever kind the delta writes it with", async () => {
    const p = await plan("  relationship calls\n", `${STUBS}  shop.orders -[calls]-> shop.payments 'Calls authorize' {\n    #FEAT-7\n  }\n`);
    expect(p.content).toBeNull();
    expect(p.addedRels).toEqual([]);
  });

  it("a tag the extending model declares itself serves what is routed into it", async () => {
    const model = (text: string): ExtendingModel => ({ service: "order-service", path: "services/order-service/model.likec4", text });
    const nested = `  shop = group 'Shop' {\n    orders = softwareSystem 'order-service' {\n      outbox = container 'outbox' {\n        #FEAT-7 #pci\n      }\n    }\n    payments = softwareSystem 'payment-service'\n  }\n`;
    // Without the declaration anywhere the routed container is refused...
    const refusal = await plan("  tag pci\n", nested, [model("model {\n}\n")]).catch((err: unknown) => err);
    expect(refusal).toBeInstanceOf(UndeclaredNamesError);
    expect((refusal as UndeclaredNamesError).missing).toEqual([
      { table: "tag", name: "pci", document: "services/order-service/model.likec4", usedBy: "shop.orders.outbox" },
    ]);
    // ...and the tags-only specification SCHEMA calls legal beside an `extend` serves it.
    const p = await plan("  tag pci\n", nested, [model("specification {\n  tag pci\n}\n\nmodel {\n}\n")]);
    expect(p.models.map((m) => m.els.map((e) => e.id))).toEqual([["shop.orders.outbox"]]);
  });
});
