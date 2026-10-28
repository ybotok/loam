/**
 * A `navigateTo` whose view is declared in ANOTHER document of the renderer's
 * project — report 042 from a pilot fleet's audit, reproduced on
 * `examples/docs`.
 *
 * `navigateTo` is a click-through link between rendered views. loam reads
 * nothing it carries: measured at the 1.59.2 pin, with the clause unresolved
 * the parsed stage hands back the same elements, relationships, dynamic views
 * and view ids. But every load loam makes is NARROWER than the project the
 * renderer builds — the map alone for the archive's merge proof, `architecture/`
 * without the extending models for the map's own grade, one model per service
 * project — so the view a link names was routinely in a document the load did
 * not hold. LikeC4 resolved it (`likec4 validate` Valid) and loam failed:
 * `delta.merge-refused` on every active feature when the view sat beside the
 * map, and `landscape.invalid` plus one `spine.landscape-invalid` per service
 * when it sat in a service's extending model — every cross-service check
 * blinded by a link.
 *
 * The other half is pinned as hard as the fix: a link to a view declared
 * NOWHERE the renderer reads is still `landscape.invalid`, so tolerating a
 * reference loam cannot see never becomes accepting one nobody can.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { LANDSCAPE, SERVICE_MODEL, makeProject, makeTmpDir, runLoam, type Project } from "./helpers/harness.js";

const EXAMPLES = fileURLToPath(new URL("../examples/docs", import.meta.url));

interface JsonFinding {
  severity: string;
  code: string;
  message: string;
}

interface Payload {
  targets: Array<{ findings: JsonFinding[] }>;
}

let root: string | undefined;

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true });
  root = undefined;
});

/** A copy of `examples/docs` with `edit` applied, and the work dir whose loam.json points at it. */
async function example(edit: (docs: string) => Promise<void>): Promise<{ workDir: string; docs: string }> {
  root = await makeTmpDir();
  const workDir = join(root, "work");
  const docs = join(root, "docs");
  await mkdir(workDir, { recursive: true });
  await cp(EXAMPLES, docs, { recursive: true });
  await writeFile(join(workDir, "loam.json"), JSON.stringify({ docsDir: docs }, null, 2) + "\n", "utf8");
  await edit(docs);
  return { workDir, docs };
}

/** The map's `customer -> checkoutWeb` edge, given a body that links it to `view`. */
async function linkCustomerEdge(docs: string, view: string): Promise<void> {
  const path = join(docs, "architecture", "landscape.likec4");
  const text = await readFile(path, "utf8");
  const edge = "  customer -> marketplace.checkoutWeb 'Uses'";
  expect(text.split(edge)).toHaveLength(2);
  await writeFile(path, text.replace(edge, `${edge} {\n    navigateTo ${view}\n  }`), "utf8");
}

/** A dynamic view over two map elements — the only kind an edge's `navigateTo` may name. */
const dynamicView = (id: string): string =>
  `views {\n  dynamic view ${id} {\n    customer -> marketplace.checkoutWeb\n  }\n}\n`;

async function validateAll(workDir: string): Promise<{ code: number; findings: JsonFinding[] }> {
  const res = await runLoam(workDir, "validate", "--all", "--json");
  return { code: res.code, findings: (JSON.parse(res.stdout) as Payload).targets.flatMap((t) => t.findings) };
}

const errorCodes = (findings: JsonFinding[]): string[] =>
  findings.filter((f) => f.severity === "error").map((f) => f.code);

describe("a navigateTo LikeC4 resolves in another document is never a loam error", () => {
  it("resolves a view declared in another architecture/ document — the map alone is not the project", async () => {
    // FEAT-101 is active in the example, so its merge preview parses the map
    // ALONE: this used to be `delta.merge-refused` ("landscape.likec4 has 1
    // error(s)") and an archive refused for a link it cannot see.
    const { workDir } = await example(async (docs) => {
      await linkCustomerEdge(docs, "checkoutDetail");
      await writeFile(join(docs, "architecture", "zz.likec4"), dynamicView("checkoutDetail"), "utf8");
    });
    const run = await validateAll(workDir);
    expect(errorCodes(run.findings)).toEqual([]);
    expect(run.code).toBe(0);
  });

  it("resolves a view declared in an extending service model — the renderer's root project holds it", async () => {
    // The reported shape: `landscape.invalid` and five `spine.landscape-invalid`
    // while `likec4 validate` at the docs root said Valid.
    const { workDir } = await example(async (docs) => {
      await linkCustomerEdge(docs, "orderFlow");
      const model = join(docs, "services", "order-service", "model.likec4");
      await writeFile(model, (await readFile(model, "utf8")) + "\n" + dynamicView("orderFlow"), "utf8");
    });
    const run = await validateAll(workDir);
    expect(errorCodes(run.findings)).toEqual([]);
    expect(run.findings.map((f) => f.code)).not.toContain("c4.fleet-project-invalid");
    expect(run.code).toBe(0);
  });

  it("resolves an include-with link into a view loam generates — the renderer loads services.likec4", async () => {
    // `include … with { navigateTo }` names ANY view, so a hand-written view
    // can click through to a generated per-service overview. Every loam load
    // leaves the generated documents out on purpose (a stale one must not blank
    // the map), and that was enough to fail the map over a link into one.
    const { workDir } = await example(async (docs) => {
      await writeFile(
        join(docs, "architecture", "zz.likec4"),
        "views {\n  view orders_entry {\n    include marketplace.orderService with {\n" +
          "      navigateTo service_order_2dservice\n    }\n  }\n}\n",
        "utf8",
      );
    });
    const run = await validateAll(workDir);
    expect(errorCodes(run.findings)).toEqual([]);
    expect(run.findings.map((f) => f.code)).not.toContain("c4.fleet-project-invalid");
    expect(run.code).toBe(0);
  });

  it("still reports a link to a view declared nowhere the renderer reads — a comment naming it declares nothing", async () => {
    const { workDir } = await example(async (docs) => {
      await linkCustomerEdge(docs, "ghostFlow");
      // The view's name in a comment and in a string, beside a real view: a
      // scan that read either as a declaration would accept the dangling link.
      // The comment sits exactly where a declaration would — directly inside
      // the `views` block — so only the mask can tell the two apart.
      await writeFile(
        join(docs, "architecture", "zz.likec4"),
        "views {\n  // dynamic view ghostFlow { } was retired\n" +
          "  dynamic view realFlow {\n    title 'not dynamic view ghostFlow'\n" +
          "    customer -> marketplace.checkoutWeb\n  }\n}\n",
        "utf8",
      );
    });
    const run = await validateAll(workDir);
    const invalid = run.findings.filter((f) => f.code === "landscape.invalid");
    expect(invalid).toHaveLength(1);
    expect(invalid[0]!.message).toContain("architecture/landscape.likec4");
    expect(run.code).toBe(1);
  });

  it("still reports an edge's link to a STATIC view — LikeC4 resolves an edge's navigateTo against dynamic views only", async () => {
    // `service_order_2dservice` is declared (a generated per-service view), but
    // as a static one: `likec4 validate` refuses the edge, so loam must too. A
    // scan keyed on the id alone would have accepted it.
    const { workDir } = await example(async (docs) => {
      await linkCustomerEdge(docs, "service_order_2dservice");
    });
    const run = await validateAll(workDir);
    expect(run.findings.filter((f) => f.code === "landscape.invalid")).toHaveLength(1);
    expect(run.code).toBe(1);
  });
});

/** order-service's consume edge, given a body line that links it to `view`. */
async function linkModelEdge(docs: string, view: string): Promise<void> {
  const model = join(docs, "services", "order-service", "model.likec4");
  const text = await readFile(model, "utf8");
  const edge = "  kafka.paymentEvents -> marketplace.orderService.consumer 'PaymentAuthorized advances the order' {";
  expect(text.split(edge)).toHaveLength(2);
  await writeFile(model, text.replace(edge, `${edge}\n    navigateTo ${view}`), "utf8");
}

/** FEAT-101's tagged `createSplit` edge, linked to `view`. */
async function linkDeltaEdge(docs: string, view: string): Promise<void> {
  const delta = join(docs, "features", "FEAT-101-payment-splitting", "delta.likec4");
  const text = await readFile(delta, "utf8");
  const edge = "  marketplace.paymentService -> marketplace.paymentSplitService 'Calls createSplit' {\n    #FEAT-101\n";
  const crlf = edge.replace(/\n/g, "\r\n");
  const spelled = text.includes(crlf) ? crlf : edge;
  expect(text.split(spelled)).toHaveLength(2);
  await writeFile(delta, text.replace(spelled, `${spelled}    navigateTo ${view}\n`), "utf8");
}

describe("a link that lands nowhere is still an error wherever it was one", () => {
  it("is c4.invalid on an extending model — once, and not again as the fleet project failing", async () => {
    // A per-service project is narrower than the renderer's, so it grades its
    // links against the renderer's views rather than dropping them: aimed at a
    // view another model declares the link is fine, aimed at nothing it is the
    // `c4.invalid` it always was — in `--service` as in `--all`.
    const { workDir } = await example(async (docs) => linkModelEdge(docs, "ghostFlow"));
    const run = await validateAll(workDir);
    const invalid = run.findings.filter((f) => f.code === "c4.invalid");
    expect(invalid).toHaveLength(1);
    expect(run.findings.map((f) => f.code)).not.toContain("c4.fleet-project-invalid");
    expect(run.code).toBe(1);
    const single = await runLoam(workDir, "validate", "order-service", "--json");
    expect(single.code).toBe(1);
    expect(single.stdout).toContain("c4.invalid");
  });

  it("is delta.invalid on a feature, and the archive refuses it — it would land a broken link in the map", async () => {
    const { workDir, docs } = await example(async (d) => linkDeltaEdge(d, "ghostFlow"));
    const feature = await runLoam(workDir, "validate", "--feature", "FEAT-101-payment-splitting", "--json");
    expect(feature.code).toBe(1);
    expect(feature.stdout).toContain("delta.invalid");
    const before = await readFile(join(docs, "architecture", "landscape.likec4"), "utf8");
    const archive = await runLoam(workDir, "archive", "FEAT-101-payment-splitting", "--json");
    expect(archive.code).toBe(1);
    expect(await readFile(join(docs, "architecture", "landscape.likec4"), "utf8")).toBe(before);
  });

  it("passes a feature whose link names a view the renderer reads", async () => {
    // Before the fix ANY link in a delta was `delta.invalid`: the delta is
    // parsed alone, and no view it names is in it.
    const { workDir } = await example(async (docs) => {
      await writeFile(join(docs, "architecture", "zz.likec4"), dynamicView("checkoutDetail"), "utf8");
      await linkDeltaEdge(docs, "checkoutDetail");
    });
    const feature = await runLoam(workDir, "validate", "--feature", "FEAT-101-payment-splitting", "--json");
    expect(feature.stdout).not.toContain("delta.invalid");
    expect(feature.code).toBe(0);
  });

  it("makes doctor agree with validate about whether the map parses", async () => {
    const dangling = await example(async (docs) => linkCustomerEdge(docs, "ghostFlow"));
    const blocked = await runLoam(dangling.workDir, "doctor", "--json");
    expect(blocked.stdout).toContain("doctor.landscape-invalid");
    expect(blocked.code).toBe(1);
    await rm(root!, { recursive: true, force: true });
    const placed = await example(async (docs) => {
      await linkCustomerEdge(docs, "orderFlow");
      const model = join(docs, "services", "order-service", "model.likec4");
      await writeFile(model, (await readFile(model, "utf8")) + "\n" + dynamicView("orderFlow"), "utf8");
    });
    const healthy = await runLoam(placed.workDir, "doctor", "--json");
    expect(healthy.stdout).not.toContain("doctor.landscape-invalid");
  });

  it("reads a view declared after a BODYLESS one — a view's body is optional", async () => {
    // `view stub` is a whole declaration in the pinned grammar; a scan that ran
    // on to the next `{` swallowed the view after it, and the link into that
    // view failed the whole map again.
    const { workDir } = await example(async (docs) => {
      await linkCustomerEdge(docs, "orderFlow");
      const model = join(docs, "services", "order-service", "model.likec4");
      const views = "views {\n  view stub\n  dynamic view orderFlow {\n    customer -> marketplace.checkoutWeb\n  }\n}\n";
      await writeFile(model, (await readFile(model, "utf8")) + "\n" + views, "utf8");
    });
    const run = await validateAll(workDir);
    expect(errorCodes(run.findings)).toEqual([]);
    expect(run.code).toBe(0);
  });
});

/** A STANDALONE payment-service model whose one edge links to `view`. */
const standaloneModel = (view: string): string =>
  SERVICE_MODEL.replace("    api = container 'api'\n", "    api = container 'api'\n    worker = container 'worker'\n").replace(
    "\n}\n\nviews {",
    `\n  paymentService.api -> paymentService.worker 'Enqueues' {\n    navigateTo ${view}\n  }\n}\n\nviews {`,
  );

describe("a standalone model is a project of its own", () => {
  let project: Project | undefined;
  afterEach(async () => {
    await project?.destroy();
    project = undefined;
  });

  it("keeps a link into nothing as c4.invalid, and accepts one into its own sibling flow", async () => {
    expect(standaloneModel("x")).toContain("navigateTo x");
    const flow = "views {\n  dynamic view localFlow {\n    paymentService.api -> paymentService.worker\n  }\n}\n";
    project = await makeProject({
      "architecture/landscape.likec4": LANDSCAPE,
      "services/payment-service/model.likec4": standaloneModel("ghostFlow"),
      "services/payment-service/usecases/local.likec4": flow,
    });
    const dangling = await runLoam(project.workDir, "validate", "payment-service", "--json");
    expect(dangling.stdout).toContain("c4.invalid");
    expect(dangling.code).toBe(1);
    await project.write("services/payment-service/model.likec4", standaloneModel("localFlow"));
    const placed = await runLoam(project.workDir, "validate", "payment-service", "--json");
    expect(placed.stdout).not.toContain("c4.invalid");
  });
});
