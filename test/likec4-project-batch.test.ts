/**
 * `loadProjectBatch` — many PROJECTS through one LikeC4 workspace, which is the
 * third isolation contract in `core/c4/` and the one a fleet of extending
 * models needs.
 *
 * Its two siblings pin the other two: `test/likec4-batch-parity.test.ts` gives
 * every document a project of its own so an author-written `import` can never
 * resolve, and `test/likec4-project-load.test.ts` puts a whole directory in one
 * project so a views-only file can be read at all. This one puts N of the
 * SECOND kind inside ONE workspace — the fleet map plus one service model, per
 * service — and everything that could go wrong is an attribution failure:
 *
 *  - an error attributed to the wrong project grades one service against
 *    another service's typo;
 *  - an error attributed to nobody grades its own project clean, which is
 *    failing open in the fleet gate;
 *  - a staged path leaking into a message sends the author to a temp directory
 *    that no longer exists.
 *
 * So parity here is against `loadProject` run per project — the loader that is
 * already pinned — rather than against hand-written expectations.
 */
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadProjectBatch, type ProjectRequest } from "../src/core/c4/project/batch.js";
import { loadProject, type ProjectDoc } from "../src/core/c4/project/load.js";
import { makeTmpDir, writeFiles } from "./helpers/harness.js";

/** The fleet map: three services bound to directories, plus a broker with a nested topic. */
const FLEET = `specification {
  element service
  element container
  element topic
}

model {
  web = service 'checkout-web' {
    metadata { service 'checkout-web' }
  }
  orders = service 'order-service' {
    metadata { service 'order-service' }
  }
  payments = service 'payment-service' {
    metadata { service 'payment-service' }
  }
  kafka = service 'kafka' {
    orderEvents = topic 'order events'
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

/** A fleet use case in its own file — every project carries it, as the renderer's root project does. */
const FLEET_USECASE = `views {
  dynamic view uc_fleet {
    title 'Checkout'
    web -> orders 'places the order'
  }
}
`;

/** An extending model: no specification, containers under the element the map binds. */
const PAYMENT_MODEL = `model {
  extend payments {
    api = container 'HTTP API'
  }
  payments.api -> kafka.orderEvents 'Publishes authorizations'
}
`;

/** The same, plus a use case of its own — the views a service declares beside its model. */
const CHECKOUT_MODEL = `model {
  extend web {
    spa = container 'Browser app'
  }
}

views {
  dynamic view uc_local {
    title 'Local checkout'
    web.spa -> orders 'places the order'
  }
}
`;

/**
 * A model naming a kind the map does not declare — ONE error, on this file.
 * The whole point of the batch is that this stays here.
 */
const BROKEN_MODEL = `model {
  extend orders {
    store = database 'Order store'
  }
}
`;

const MODELS: Record<string, string> = {
  "payment-service": PAYMENT_MODEL,
  "checkout-web": CHECKOUT_MODEL,
  "order-service": BROKEN_MODEL,
};

/** {message, line} per error — the two fields findings render. */
const errKeys = (doc: ProjectDoc): Record<string, { message: string; line?: number }[]> =>
  Object.fromEntries(
    [...doc.errors].map(([path, list]) => [path, list.map((e) => ({ message: e.message, line: e.line }))]),
  );

describe("loadProjectBatch answers exactly what loadProject answers, per project", () => {
  let root: string;
  let requests: ProjectRequest[];
  let batch: Map<string, ProjectDoc>;
  let singles: Map<string, ProjectDoc>;

  beforeAll(async () => {
    root = await makeTmpDir("loam-project-batch-");
    await writeFiles(root, {
      "architecture/landscape.likec4": FLEET,
      "architecture/usecases/fleet.likec4": FLEET_USECASE,
      ...Object.fromEntries(
        Object.entries(MODELS).map(([id, body]) => [`services/${id}/model.likec4`, body]),
      ),
    });
    const architecture = [
      join(root, "architecture", "landscape.likec4"),
      join(root, "architecture", "usecases", "fleet.likec4"),
    ];
    requests = Object.keys(MODELS).map((id) => ({
      key: id,
      base: root,
      paths: [...architecture, join(root, "services", id, "model.likec4")],
    }));
    batch = await loadProjectBatch(requests);
    singles = new Map();
    for (const req of requests) singles.set(req.key, await loadProject(req.base, req.paths));
  }, 120_000);

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("agrees on elements, relationships, views and every error's {message, line}", () => {
    for (const req of requests) {
      const batched = batch.get(req.key);
      const single = singles.get(req.key)!;
      expect(batched, req.key).toBeDefined();
      expect(batched!.clean, req.key).toBe(single.clean);
      expect(batched!.elements, req.key).toEqual(single.elements);
      expect(batched!.relationships, req.key).toEqual(single.relationships);
      expect(batched!.views, req.key).toEqual(single.views);
      expect(batched!.viewIds, req.key).toEqual(single.viewIds);
      expect(batched!.specification, req.key).toEqual(single.specification);
      expect(errKeys(batched!), req.key).toEqual(errKeys(single));
    }
    // Both verdicts are exercised, or the loop above proves nothing.
    expect(singles.get("payment-service")!.clean).toBe(true);
    expect(singles.get("order-service")!.clean).toBe(false);
  });

  it("keeps one project's error out of every other project", () => {
    // The isolation claim. One service's model naming an undeclared kind is
    // that service's `c4.invalid`; a fleet where it also blanked its
    // neighbours would report 56 broken services for one typo, and every one
    // of those findings would name a file its author never touched.
    const broken = batch.get("order-service")!;
    expect(broken.clean).toBe(false);
    expect([...broken.errors.keys()]).toEqual([join(root, "services", "order-service", "model.likec4")]);
    for (const id of ["payment-service", "checkout-web"]) {
      expect(batch.get(id)!.errors.size, id).toBe(0);
      expect(batch.get(id)!.clean, id).toBe(true);
      expect(batch.get(id)!.elements.length, id).toBeGreaterThan(0);
    }
  });

  it("carries every error back to the document the author wrote, never the staged copy", () => {
    for (const [path, errs] of batch.get("order-service")!.errors) {
      expect(errs.length).toBeGreaterThan(0);
      for (const err of errs) {
        expect(err.sourceFsPath).toBe(path);
        expect(err.sourceFsPath).not.toContain("loam-c4-");
        expect(err.message).not.toContain("loam-c4-");
      }
    }
  });

  it("spells every view's sourcePath from the caller's base, so a finding names a file in the repo", () => {
    // `base` is the docs root here, which is what makes a service's own view
    // come back as `services/<id>/model.likec4` — the spelling the model's own
    // views are filtered by, and the one a person can open.
    const checkout = batch.get("checkout-web")!;
    expect(checkout.views.map((v) => `${v.id}@${v.sourcePath}`).sort()).toEqual([
      "uc_fleet@architecture/usecases/fleet.likec4",
      "uc_local@services/checkout-web/model.likec4",
    ]);
  });
});

describe("loadProjectBatch degrades rather than inventing an answer", () => {
  it("an empty request list needs no workspace at all", async () => {
    expect((await loadProjectBatch([])).size).toBe(0);
  });

  it("drops a project whose documents cannot be staged, and keeps the rest", async () => {
    const root = await makeTmpDir("loam-project-batch-");
    try {
      await writeFiles(root, { "architecture/landscape.likec4": FLEET });
      const landscape = join(root, "architecture", "landscape.likec4");
      const batch = await loadProjectBatch([
        { key: "real", base: root, paths: [landscape] },
        { key: "gone", base: root, paths: [join(root, "services", "nobody", "model.likec4")] },
      ]);
      // Absent, not an error entry: the caller's ordinary per-project load owns
      // reproducing today's ENOENT, and a project staged EMPTY would parse
      // clean and grade a service against nothing at all.
      expect([...batch.keys()]).toEqual(["real"]);
      expect(batch.get("real")!.clean).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);
});
