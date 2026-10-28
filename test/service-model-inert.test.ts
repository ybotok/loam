/**
 * A model that declares NOTHING shares one parse of the map — and the answer it
 * gets is exactly the one its own project would have given.
 *
 * An extending model is read inside a project of its own: every
 * `architecture/` document plus that one file. On a fleet whose map is
 * thousands of lines and whose models are mostly comment-only placeholders,
 * those per-service copies of the map were most of a `validate --all` (a pilot
 * fleet: 56 s, docs/BENCHMARKS.md). A placeholder adds nothing to its project,
 * so all of them now share one parse of the architecture documents.
 *
 * The claim that makes that safe is pinned here directly rather than through a
 * finding: for every inert model, the shared answer DEEP-EQUALS the per-model
 * project load it replaces — on a clean map and on a broken one — and a file
 * that only looks empty (an unclosed block comment) is not shared at all.
 */
import { afterEach, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { FleetContext } from "../src/core/fleet-context.js";
import { asLoadedDoc, loadProject } from "../src/core/c4/project/load.js";
import { renderedViews } from "../src/core/c4/project/architecture.js";
import { modelProjectDocuments } from "../src/core/c4/service-model/documents.js";
import { batchServiceProjects } from "../src/core/c4/service-model/load.js";
import { modelInert } from "../src/core/c4/service-model/shape.js";
import { rawServiceId } from "../src/core/kernel/ids/service.js";
import type { DocsDir } from "../src/core/kernel/ids/dirs.js";
import { unfiledServicePaths } from "../src/core/repo/paths.js";
import { LANDSCAPE, makeProject, type Project } from "./helpers/harness.js";

const FLEET = LANDSCAPE.replace("  element person\n", "  element person\n  element container\n");

/** A views-only document beside the map, so a view's `sourcePath` is part of what must match. */
const DRILLDOWN = "views {\n  view pay_drill of paymentService {\n    include *\n  }\n}\n";

const INERT = {
  "payment-service": "// payment-service: interior not drawn yet.\n",
  "checkout-web": "\n  \n",
  "order-service": "/* drawn later */\n// and a line comment\n",
};

const DRAWN = "model {\n  extend identityService {\n    api = container 'api'\n  }\n}\n";

let project: Project | undefined;

afterEach(async () => {
  await project?.destroy();
  project = undefined;
});

async function fleet(map: string, models: Record<string, string>): Promise<Project> {
  project = await makeProject({
    "architecture/landscape.likec4": map,
    "architecture/drilldown.likec4": DRILLDOWN,
    ...Object.fromEntries(Object.entries(models).map(([id, body]) => [`services/${id}/model.likec4`, body])),
  });
  return project;
}

const modelOf = (p: Project, id: string): string => unfiledServicePaths(p.docsDir, rawServiceId(id)).model;

/** What the per-model project load answers — the load the shared parse replaces, its links graded the same way. */
async function ownProject(docsDir: DocsDir, model: string) {
  const documents = await modelProjectDocuments(docsDir, model);
  return asLoadedDoc(await loadProject(docsDir, documents, () => renderedViews(docsDir)));
}

describe("which bytes declare nothing", () => {
  it("is whitespace and closed comments, and nothing else", () => {
    expect(modelInert("")).toBe(true);
    expect(modelInert("// a note\n\n/* a block */\n")).toBe(true);
    // An unclosed block comment is masked to blanks, but LikeC4 refuses it.
    expect(modelInert("// fine\n/* never closed\n")).toBe(false);
    expect(modelInert("/*/")).toBe(false);
    expect(modelInert("model {\n}\n")).toBe(false);
    // A declaration inside a comment declares nothing; one outside it does.
    expect(modelInert("// extend paymentService { api = container 'api' }\n")).toBe(true);
    expect(modelInert("views {}\n")).toBe(false);
  });
});

describe("inert models share one parse of the map", () => {
  it("answers each inert model exactly as its own project would, from one parse", async () => {
    const p = await fleet(FLEET, { ...INERT, "identity-service": DRAWN });
    const models = [...Object.keys(INERT), "identity-service"].map((id) => modelOf(p, id));
    const batch = await batchServiceProjects(p.docsDir, models);
    // One project for the drawn model, ONE for every inert model together.
    expect(batch.parses).toBe(2);
    for (const model of models) {
      const shared = batch.projects.get(resolve(model));
      expect(shared, model).toBeDefined();
      expect(shared).toEqual(await ownProject(p.docsDir, model));
    }
    // A copy each, never one object behind three services.
    const [a, b] = Object.keys(INERT).map((id) => batch.projects.get(resolve(modelOf(p, id)))!);
    expect(a).not.toBe(b);
    expect(a!.elements).not.toBe(b!.elements);
  }, 120_000);

  it("carries the map's errors into each inert model exactly as its own project would", async () => {
    const broken = FLEET.replace("  customer -> checkoutWeb 'Uses'\n", "  customer -> nowhere 'Uses'\n");
    expect(broken).not.toBe(FLEET);
    const p = await fleet(broken, INERT);
    const models = Object.keys(INERT).map((id) => modelOf(p, id));
    const batch = await batchServiceProjects(p.docsDir, models);
    for (const model of models) {
      const shared = batch.projects.get(resolve(model))!;
      expect(shared.errors.length).toBeGreaterThan(0);
      expect(shared).toEqual(await ownProject(p.docsDir, model));
    }
  }, 120_000);

  it("gives a file that only LOOKS empty a project of its own", async () => {
    const p = await fleet(FLEET, { "payment-service": INERT["payment-service"], "checkout-web": "/* never closed\n" });
    const unclosed = modelOf(p, "checkout-web");
    const batch = await batchServiceProjects(p.docsDir, [modelOf(p, "payment-service"), unclosed]);
    expect(batch.parses).toBe(2);
    const own = batch.projects.get(resolve(unclosed))!;
    expect(own.errors.length).toBeGreaterThan(0);
    expect(own).toEqual(await ownProject(p.docsDir, unclosed));
  }, 120_000);

  it("parses the map once for every inert model a single-service read reaches, batched or not", async () => {
    const p = await fleet(FLEET, INERT);
    const context = new FleetContext();
    for (const id of Object.keys(INERT)) {
      const model = await context.serviceModel(p.docsDir, unfiledServicePaths(p.docsDir, rawServiceId(id)));
      expect(model.doc.errors).toEqual([]);
      expect(model.project).not.toBeNull();
    }
    // The memo filled one key per model, from ONE shared parse.
    expect(context.stats().projectLoads).toBe(1);
  }, 120_000);
});
