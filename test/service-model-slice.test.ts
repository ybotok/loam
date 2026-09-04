/**
 * What a service OWNS inside a project that also holds the fleet map, and the
 * four arms `loadServiceModel` answers with.
 *
 * The slice is DERIVED, and it has to be: measured at the 1.59.2 pin,
 * `$data.elements[fqn]` carries no source-document field, so after the map and
 * an extending model are parsed together nothing in the parse output says which
 * file declared a given element. Everything below is therefore a claim about a
 * reconstruction — diff against the architecture-alone load, resolve the rest
 * through the element→service resolver — and every one of these assertions is a
 * check that would otherwise go quietly wrong:
 *
 *  - too WIDE and every service is graded against the whole fleet map: each one
 *    suddenly has relationships, and each one's health.yaml dependencies all
 *    resolve;
 *  - too NARROW and a service that models its partners correctly is told it
 *    models nothing — `c4.no-relationships` on a model full of edges.
 *
 * The fixture is the harness landscape widened by exactly what an extending
 * model needs (two kinds and a broker with a nested topic), so a failure here
 * is about the slice rather than about a fixture this file invented.
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FleetContext } from "../src/core/fleet-context.js";
import { loadFile } from "../src/core/c4/likec4.js";
import { rawServiceId } from "../src/core/kernel/ids/service.js";
import { unfiledServicePaths, type ServicePaths } from "../src/core/repo/paths.js";
import { LANDSCAPE, SERVICE_MODEL, makeProject, type Project } from "./helpers/harness.js";

/**
 * The harness landscape plus the two kinds an extending model needs and a
 * broker whose topic is NESTED — `kafka.orderEvents`, the shape that makes the
 * ancestor rule in `sliceForService` load-bearing.
 */
const FLEET = LANDSCAPE.replace("  element person\n", "  element person\n  element container\n  element topic\n").replace(
  "  customer -> checkoutWeb 'Uses'\n",
  "  kafka = softwareSystem 'kafka' {\n    orderEvents = topic 'order events'\n  }\n\n  customer -> checkoutWeb 'Uses'\n",
);

/** A fleet use case in its own file — the views a service model must NOT claim as its own. */
const FLEET_USECASE = `views {
  dynamic view uc_fleet {
    title 'Checkout'
    customer -> checkoutWeb 'starts checkout'
  }
}
`;

/**
 * payment-service's extending model, carrying one of everything the slice has
 * to tell apart: containers under its own element, an edge to a NESTED element
 * of another party, a re-draw of an edge the map already declares, a brand-new
 * top-level element, and a child added under ANOTHER service's element.
 */
const EXTENDING_MODEL = `model {
  extend paymentService {
    api = container 'api'
    worker = container 'worker'
  }

  checkoutWeb -> paymentService 'Calls authorizePayment' {
    metadata { op 'authorizePayment' }
  }

  paymentService.api -> kafka.orderEvents 'Publishes authorizations'

  ledger = softwareSystem 'ledger'

  extend checkoutWeb {
    spa = container 'spa'
  }
}

views {
  dynamic view uc_local {
    title 'Local authorization'
    checkoutWeb -> paymentService.api 'authorizes'
  }
}
`;

const ids = (elements: { id: string }[]): string[] => elements.map((e) => e.id).sort();
const edges = (rels: { source: string; target: string }[]): string[] =>
  rels.map((r) => `${r.source}->${r.target}`).sort();

/** A docs repo with the fleet map, a fleet use case, and whatever models the case needs. */
async function fixture(models: Record<string, string>): Promise<Project> {
  return makeProject({
    "architecture/landscape.likec4": FLEET,
    "architecture/usecases/fleet.likec4": FLEET_USECASE,
    ...Object.fromEntries(Object.entries(models).map(([id, body]) => [`services/${id}/model.likec4`, body])),
  });
}

const pathsFor = (project: Project, id: string): ServicePaths =>
  unfiledServicePaths(project.docsDir, rawServiceId(id));

describe("an extending model's own slice", () => {
  let project: Project;
  let fleet: FleetContext;
  let paths: ServicePaths;

  beforeAll(async () => {
    project = await fixture({ "payment-service": EXTENDING_MODEL, "checkout-web": "model {\n}\n" });
    fleet = new FleetContext();
    paths = pathsFor(project, "payment-service");
  }, 120_000);

  afterAll(async () => {
    await project.destroy();
  });

  it("reads the model beside the map, and reports no errors", async () => {
    const model = await fleet.serviceModel(project.docsDir, paths);
    expect(model.shape).toBe("extending");
    expect(model.mapUnreadable).toBe(false);
    expect(model.doc.errors).toEqual([]);
  });

  it("owns the bound element and everything under it — and nothing the map owns", async () => {
    const model = await fleet.serviceModel(project.docsDir, paths);
    // The service's own three, plus the partners its own edges reach. NOT
    // `customer` (the map's, and no edge of this model touches it), NOT
    // `ledger` and NOT `checkoutWeb.spa` — those are unowned, below.
    expect(ids(model.doc.elements)).toEqual([
      "checkoutWeb",
      "kafka",
      "kafka.orderEvents",
      "paymentService",
      "paymentService.api",
      "paymentService.worker",
    ]);
  });

  it("keeps the ANCESTOR of a nested partner, because health.yaml names the ancestor", async () => {
    const model = await fleet.serviceModel(project.docsDir, paths);
    // A standalone model had to declare `kafka` in order to draw an edge at
    // `kafka.orderEvents`, and a fleet's health.yaml therefore names the
    // dependency `kafka`. Dropping the ancestor here would turn every such
    // declaration into `health.dependency-unmodelled` on the day a fleet
    // migrated its models, with nothing in the docs having changed.
    expect(ids(model.doc.elements)).toContain("kafka");
    expect(ids(model.doc.elements)).toContain("kafka.orderEvents");
  });

  it("keeps an edge the model draws even when the map draws the same one", async () => {
    const model = await fleet.serviceModel(project.docsDir, paths);
    // A MULTISET difference, not a set one. The map declares
    // `checkoutWeb -> paymentService` and so does this model, spelled
    // identically — which is exactly what an attested call looks like. Under a
    // set difference the model's copy would vanish, and `attestedCalls`,
    // `landscape.service-isolated`, the brief's attested list and
    // `c4.no-relationships` would all then be answering about a model they
    // believe declares nothing.
    expect(edges(model.doc.relationships)).toEqual([
      "checkoutWeb->paymentService",
      "paymentService.api->kafka.orderEvents",
    ]);
    expect(model.doc.relationships.find((r) => r.target === "paymentService")?.op).toBe("authorizePayment");
  });

  it("does NOT inherit the map's other edges as the model's own", async () => {
    const model = await fleet.serviceModel(project.docsDir, paths);
    // `customer -> checkoutWeb` is the map's alone and resolves to nothing
    // here; the map's own copy of the authorize edge is cancelled by the
    // model's. Two edges, not four.
    expect(model.doc.relationships).toHaveLength(2);
    expect(edges(model.project!.relationships)).toContain("customer->checkoutWeb");
  });

  it("names what the model added outside its own element", async () => {
    const model = await fleet.serviceModel(project.docsDir, paths);
    // A new top-level element and a child under another service's element —
    // the two `c4.element-unowned` cases. Neither is in the map, and neither
    // resolves to this service.
    expect(ids(model.unowned)).toEqual(["checkoutWeb.spa", "ledger"]);
  });

  it("carries the model file's OWN views, and the whole project beside them", async () => {
    const model = await fleet.serviceModel(project.docsDir, paths);
    // Without the filter every service in the fleet would report every
    // fleet-level use case as one of its own — the views live in one project
    // now, and only `sourcePath` tells them apart.
    expect(model.doc.views?.map((v) => v.id)).toEqual(["uc_local"]);
    expect(model.project?.views?.map((v) => v.id).sort()).toEqual(["uc_fleet", "uc_local"]);
    // The specification is the PROJECT's: an extending model takes the map's
    // kinds, so "what this model may use" is the map's table — and a reader
    // that found none would grade the model against an empty vocabulary.
    expect(model.doc.specification).toEqual(model.project?.specification);
    expect(model.doc.specification?.metadataKeys).toContain("op");
  });

  it("is memoised per model path, and counts ONE project parse", async () => {
    const before = fleet.stats().projectLoads;
    await fleet.serviceModel(project.docsDir, paths);
    await fleet.serviceModel(project.docsDir, paths);
    expect(fleet.stats().projectLoads).toBe(before);
    expect(before).toBe(1);
  });
});

describe("nesting outranks a title guess", () => {
  /** The fleet plus a service literally called `db`, and the kind a store needs. */
  const DB_FLEET = FLEET.replace("  element topic\n", "  element topic\n  element database\n").replace(
    "  customer -> checkoutWeb 'Uses'\n",
    "  db = softwareSystem 'db'\n\n  customer -> checkoutWeb 'Uses'\n",
  );

  /** A store written INSIDE the author's own extend block, titled with another service's id. */
  const COLLIDING = `model {
  extend paymentService {
    api = container 'api'
    store = database 'db'
  }

  paymentService.api -> db 'Reads'
}
`;

  // Catches: `serviceResolver`'s second rung deciding ownership of a child the
  // author wrote inside their own `extend`. It resolves the nearest ancestor
  // whose TITLE names a real `services/<id>/` and it tries the child first, so
  // `store = database 'db'` answered `db` while the parent is bound by title
  // only — and the store left its author's slice for somebody else's `unowned`
  // list. Id nesting under the extended element is evidence nobody guessed at.
  it("keeps a child of the extended element whose title names another service", async () => {
    const project = await makeProject({
      "architecture/landscape.likec4": DB_FLEET,
      "architecture/usecases/fleet.likec4": FLEET_USECASE,
      "services/payment-service/model.likec4": COLLIDING,
      "services/db/model.likec4": "model {\n}\n",
    });
    try {
      const fleet = new FleetContext();
      const model = await fleet.serviceModel(project.docsDir, pathsFor(project, "payment-service"));
      expect(model.doc.errors).toEqual([]);
      expect(ids(model.doc.elements)).toEqual([
        // The partner its own edge reaches, then its own three.
        "db",
        "paymentService",
        "paymentService.api",
        "paymentService.store",
      ]);
      // And nothing to tell its author about: the store is theirs.
      expect(model.unowned).toEqual([]);
    } finally {
      await project.destroy();
    }
  }, 60_000);

  // The other half of the same rule, and the reason nesting is not simply
  // absolute: an explicit `metadata { service }` binding is a claim somebody
  // wrote down, so a map that files one service's element under another's keeps
  // both on the right side of the line.
  it("does NOT swallow a nested element the map explicitly binds to another service", async () => {
    const nested = FLEET.replace(
      "  paymentService = softwareSystem 'payment-service' {\n    description 'Owns payment authorization/capture'\n  }\n",
      "  paymentService = softwareSystem 'payment-service' {\n    metadata { service 'payment-service' }\n" +
        "    ledger = softwareSystem 'ledger-service' {\n      metadata { service 'ledger-service' }\n    }\n  }\n",
    );
    const project = await makeProject({
      "architecture/landscape.likec4": nested,
      "services/payment-service/model.likec4": "model {\n  extend paymentService {\n    api = container 'api'\n  }\n}\n",
      "services/ledger-service/model.likec4": "model {\n}\n",
    });
    try {
      const fleet = new FleetContext();
      const model = await fleet.serviceModel(project.docsDir, pathsFor(project, "payment-service"));
      expect(model.doc.errors).toEqual([]);
      expect(ids(model.doc.elements)).toEqual(["paymentService", "paymentService.api"]);
    } finally {
      await project.destroy();
    }
  }, 60_000);
});

describe("the other three arms", () => {
  it("a standalone model is parsed ALONE, exactly as it always was", async () => {
    const project = await fixture({ "payment-service": SERVICE_MODEL });
    try {
      const fleet = new FleetContext();
      const paths = pathsFor(project, "payment-service");
      const model = await fleet.serviceModel(project.docsDir, paths);
      expect(model.shape).toBe("standalone");
      // Byte for byte today's answer: the file, on its own, with its own
      // specification and its own re-declared elements.
      expect(model.doc).toEqual(await loadFile(paths.model));
      expect(model.project).toBeNull();
      expect(model.unowned).toEqual([]);
      expect(model.mapUnreadable).toBe(false);
      // And no project was staged for it — a standalone model owes none.
      expect(fleet.stats().projectLoads).toBe(0);
      // Nor was the fleet map parsed, which is observed through the MEMO rather
      // than a counter because there is no counter for that parse and
      // `core/fleet-context.ts` has no line left to grow one: break the
      // landscape on disk now, and ask the same context for the map. A context
      // that had already read it answers with the clean parse it remembers; this
      // one remembered nothing, so it reads the broken file. The loader used to
      // take the map as a VALUE, so every reader of ANY model — `loam show`, the
      // adopt brief — spun a workspace over `architecture/` before the shape was
      // consulted, and a project that failed to load took a command whose model
      // read is one `readFile` down with it.
      await writeFile(join(project.docsDir, "architecture/landscape.likec4"), "model { nosuch -> alsonosuch }\n", "utf8");
      expect((await fleet.architecture(project.docsDir)).errors.length).toBeGreaterThan(0);
    } finally {
      await project.destroy();
    }
  }, 60_000);

  it("an unreadable MAP means the model cannot be read at all — and is not the model's fault", async () => {
    const project = await makeProject({
      "architecture/landscape.likec4": FLEET.replace("checkoutWeb -> paymentService", "checkoutWeb -> nosuchService"),
      "services/payment-service/model.likec4": EXTENDING_MODEL,
    });
    try {
      const model = await new FleetContext().serviceModel(project.docsDir, pathsFor(project, "payment-service"));
      expect(model.mapUnreadable).toBe(true);
      // No errors of its own: the fleet already reports `spine.landscape-invalid`,
      // and a second finding here would blame every service for one broken file.
      expect(model.doc.errors).toEqual([]);
      expect(model.doc.elements).toEqual([]);
      expect(model.project).toBeNull();
    } finally {
      await project.destroy();
    }
  }, 60_000);

  it("a model naming an undeclared kind is ONE error, against the model", async () => {
    const project = await fixture({
      "payment-service": "model {\n  extend paymentService {\n    store = database 'Order store'\n  }\n}\n",
    });
    try {
      const paths = pathsFor(project, "payment-service");
      const model = await new FleetContext().serviceModel(project.docsDir, paths);
      expect(model.mapUnreadable).toBe(false);
      expect(model.doc.errors.length).toBeGreaterThan(0);
      // Every error is this model's — the map parsed alone and came back clean
      // — and each names the file the author has to open.
      expect(model.doc.errors.every((e) => e.sourceFsPath === paths.model)).toBe(true);
      expect(model.doc.errors.some((e) => /database/.test(e.message))).toBe(true);
      // Errors mean no model, at project altitude too.
      expect(model.doc.elements).toEqual([]);
      expect(model.project).toBeNull();
      expect(model.unowned).toEqual([]);
    } finally {
      await project.destroy();
    }
  }, 60_000);
});

describe("the fleet prefetch prepares every model in two workspaces", () => {
  it("seeds the per-service project memo, so a later read parses nothing", async () => {
    const project = await fixture({
      "payment-service": EXTENDING_MODEL,
      "checkout-web": "model {\n  extend checkoutWeb {\n    spa = container 'spa'\n  }\n}\n",
      "order-service": SERVICE_MODEL,
      // A second standalone model, because `prefetchLikeC4` deliberately does
      // nothing for a single miss — one document gains no isolation it does not
      // already have. Two is what makes the document batch actually run.
      "billing-service": SERVICE_MODEL.replace("payment-service", "billing-service"),
    });
    try {
      const fleet = new FleetContext();
      const services = ["payment-service", "checkout-web", "order-service", "billing-service"];
      const paths = services.map((id) => pathsFor(project, id));
      await fleet.prefetchServiceModels(project.docsDir, paths);
      // Two extending models, batched: two project parses and no more.
      expect(fleet.stats().projectLoads).toBe(2);
      const before = fleet.stats();
      const model = await fleet.serviceModel(project.docsDir, paths[0]!);
      expect(model.doc.errors).toEqual([]);
      expect(ids(model.doc.elements)).toContain("paymentService.api");
      // The read is a memo hit: the batch already staged this project.
      expect(fleet.stats().projectLoads).toBe(before.projectLoads);
      // And the two standalone ones went through the DOCUMENT batch instead,
      // which is what `likec4Loads` counts: two shapes, two workspaces.
      expect(fleet.stats().likec4Loads).toBe(2);
    } finally {
      await project.destroy();
    }
  }, 120_000);

  it("answers every model's shape from one read of its bytes", async () => {
    const project = await fixture({ "payment-service": EXTENDING_MODEL, "order-service": SERVICE_MODEL });
    try {
      const fleet = new FleetContext();
      const paths = ["payment-service", "order-service"].map((id) => pathsFor(project, id));
      const shapes = await fleet.modelShapes(paths.map((p) => p.model));
      expect(shapes.get(paths[0]!.model)).toBe("extending");
      expect(shapes.get(paths[1]!.model)).toBe("standalone");
      // A path nobody wrote classifies as standalone, so the reader that forgot
      // to check gets today's per-file error rather than a slice of the map.
      const missing = pathsFor(project, "never-adopted");
      expect((await fleet.modelShapes([missing.model])).get(missing.model)).toBe("standalone");
    } finally {
      await project.destroy();
    }
  }, 60_000);
});
