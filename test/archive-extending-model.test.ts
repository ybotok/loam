/**
 * `loam archive` against a fleet whose services own their own interior.
 *
 * The report this answers (verification 2026-09-04, E1): a delta nesting a
 * container inside a service's element archived clean and landed the container
 * in `architecture/landscape.likec4`, so the moment the service's extending
 * model declared the same container — which is what the adopt brief tells it to
 * do — the service was `c4.invalid` (duplicate declaration). SCHEMA.md says the
 * opposite: an extending model is the only place a container can be written, so
 * the map holds no service's interior.
 *
 * What is pinned here is the ROUTING rule and nothing about placement beyond it:
 * an addition nested under a service whose model EXTENDS the map is spliced into
 * that model's `extend <fqn> { … }` block; a service-level element or edge stays
 * on the map; a service with a STANDALONE model or no model at all keeps the
 * pre-extending behaviour byte for byte (the existing archive suites pin that
 * half on their own fixtures).
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { loadFile } from "../src/core/c4/likec4.js";
import { LIVING_OPENAPI, LIVING_SPEC, makeProject, runLoam, treeHashes, type Project } from "./helpers/harness.js";

const LANDSCAPE_REL = "architecture/landscape.likec4";
const ORDER_MODEL_REL = "services/order-service/model.likec4";
const CHECKOUT_MODEL_REL = "services/checkout-web/model.likec4";

/**
 * The fleet map: a group holding two bound services, every kind an extending
 * model below needs declared here — which is the extending shape's own rule.
 */
const MAP = `specification {
  element group
  element softwareSystem
  element container
  element database
  element person
  element topic
  tag external
}

model {
  customer = person 'Customer'

  marketplace = group 'Marketplace' {
    checkoutWeb = softwareSystem 'checkout-web' {
      description 'Customer-facing checkout UI'
      metadata {
        service 'checkout-web'
      }
    }
    orderService = softwareSystem 'order-service' {
      description 'Owns the order lifecycle'
      metadata {
        service 'order-service'
      }
    }
  }

  kafka = softwareSystem 'kafka' {
    #external
    orderEvents = topic 'order.events'
  }

  customer -> marketplace.checkoutWeb 'Uses'
  marketplace.checkoutWeb -> marketplace.orderService 'Places orders'
}

views {
  view landscape {
    include *
  }
}
`;

/** order-service's own interior, in the extending shape. */
const ORDER_MODEL = `model {
  extend marketplace.orderService {
    api = container 'api'
  }
}
`;

/** checkout-web's, so the fleet has two extending models and a second owner. */
const CHECKOUT_MODEL = `model {
  extend marketplace.checkoutWeb {
    ui = container 'ui'
  }
}
`;

/** The living tree every case below starts from. */
function fleet(extra: Record<string, string> = {}): Record<string, string> {
  return {
    [LANDSCAPE_REL]: MAP,
    [ORDER_MODEL_REL]: ORDER_MODEL,
    "services/order-service/spec.md": LIVING_SPEC.replace(/payment-service/g, "order-service"),
    "services/order-service/openapi.yaml": LIVING_OPENAPI,
    [CHECKOUT_MODEL_REL]: CHECKOUT_MODEL,
    "services/checkout-web/spec.md": "---\nservice: checkout-web\nstatus: draft\n---\n\n# checkout-web\n",
    ...extra,
  };
}

/** A delta document with the given `model { }` body, tagged #FEAT-1. */
function delta(body: string): string {
  return `specification {
  element group
  element softwareSystem
  element container
  element database
  element topic
  tag FEAT-1
}

model {
${body}}

views {
  view feat_1 {
    include *
  }
}
`;
}

/** The delta of the report: one container nested inside an adopted service. */
const CACHE_DELTA = delta(`  marketplace = group 'Marketplace' {
    orderService = softwareSystem 'order-service' {
      cache = container 'Order cache' {
        #FEAT-1
        technology 'Redis'
      }
    }
  }
`);

function feature(deltaText: string, id = "FEAT-1", dir = "FEAT-1-cache"): Record<string, string> {
  return {
    [`features/${dir}/delta.likec4`]: deltaText,
    [`features/${dir}/intent.md`]: `---\nfeature: ${id}\nstatus: proposed\n---\n\n# ${id}\n\nA change.\n`,
  };
}

async function archive(p: Project, id = "FEAT-1"): Promise<{ code: number; out: string }> {
  const res = await runLoam(p.workDir, "archive", id, "--approve");
  return { code: res.code, out: res.out };
}

describe("loam archive routes a delta's nested additions into the model that owns the interior", () => {
  it("a container nested under an adopted service lands in that service's extend block, not on the map", async () => {
    const p = await makeProject({ ...fleet(), ...feature(CACHE_DELTA) });
    try {
      const before = await p.read(LANDSCAPE_REL);
      const res = await archive(p);
      expect(res.code).toBe(0);
      expect(await p.read(LANDSCAPE_REL), "the map holds no service's interior").toBe(before);
      expect(await p.read(ORDER_MODEL_REL)).toBe(
        "model {\n" +
          "  extend marketplace.orderService {\n" +
          "    api = container 'api'\n" +
          "    cache = container 'Order cache' {\n" +
          "      technology 'Redis'\n" +
          "    }\n" +
          "  }\n" +
          "}\n",
      );
      expect(res.out, "the plan names the model it merged into").toContain(
        `merged into ${ORDER_MODEL_REL}`,
      );
    } finally {
      await p.destroy();
    }
  });

  it("the service that owns the container grades c4.valid, not c4.invalid — the report's symptom", async () => {
    const p = await makeProject({ ...fleet(), ...feature(CACHE_DELTA) });
    try {
      expect((await archive(p)).code).toBe(0);
      const res = await runLoam(p.workDir, "validate", "--service", "order-service", "--json");
      const payload = JSON.parse(res.stdout) as {
        targets: Array<{ findings: Array<{ severity: string; code: string; message: string }> }>;
      };
      const findings = payload.targets.flatMap((t) => t.findings);
      expect(findings.filter((f) => f.severity === "error").map((f) => `${f.code}: ${f.message}`)).toEqual([]);
      expect(findings.map((f) => f.code)).toContain("c4.valid");
    } finally {
      await p.destroy();
    }
  });

  it("a child of a new container rides inside its parent's spliced bytes, once", async () => {
    const p = await makeProject({
      ...fleet(),
      ...feature(
        delta(`  marketplace = group 'Marketplace' {
    orderService = softwareSystem 'order-service' {
      cache = container 'Order cache' {
        #FEAT-1
        node = container 'Cache node'
      }
    }
  }
`),
      ),
    });
    try {
      expect((await archive(p)).code).toBe(0);
      const model = await p.read(ORDER_MODEL_REL);
      expect(model).toContain(
        "    cache = container 'Order cache' {\n      node = container 'Cache node'\n    }\n",
      );
      expect(model.split("node = container").length, "the child must not be spliced a second time").toBe(2);
    } finally {
      await p.destroy();
    }
  });

  it("an edge between two of the service's own containers lands in the model", async () => {
    const p = await makeProject({
      ...fleet(),
      ...feature(
        delta(`  marketplace = group 'Marketplace' {
    orderService = softwareSystem 'order-service' {
      api = container 'api'
      cache = container 'Order cache' {
        #FEAT-1
      }
    }
  }

  marketplace.orderService.api -> marketplace.orderService.cache 'Reads' {
    #FEAT-1
  }
`),
      ),
    });
    try {
      const beforeMap = await p.read(LANDSCAPE_REL);
      expect((await archive(p)).code).toBe(0);
      expect(await p.read(LANDSCAPE_REL)).toBe(beforeMap);
      const model = await p.read(ORDER_MODEL_REL);
      expect(model).toContain("marketplace.orderService.api -> marketplace.orderService.cache 'Reads'");
      const land = await loadFile(join(p.docsDir, LANDSCAPE_REL));
      expect(land.errors).toEqual([]);
    } finally {
      await p.destroy();
    }
  });

  it("a container-level edge crossing a boundary lands in the SOURCE's model", async () => {
    const p = await makeProject({
      ...fleet(),
      ...feature(
        delta(`  marketplace = group 'Marketplace' {
    checkoutWeb = softwareSystem 'checkout-web' {
      ui = container 'ui'
    }
  }

  kafka = softwareSystem 'kafka' {
    orderEvents = topic 'order.events'
  }

  marketplace.checkoutWeb.ui -> kafka.orderEvents 'Publishes' {
    #FEAT-1
  }
`),
      ),
    });
    try {
      const beforeMap = await p.read(LANDSCAPE_REL);
      const beforeOrder = await p.read(ORDER_MODEL_REL);
      expect((await archive(p)).code).toBe(0);
      expect(await p.read(LANDSCAPE_REL)).toBe(beforeMap);
      expect(await p.read(ORDER_MODEL_REL)).toBe(beforeOrder);
      expect(await p.read(CHECKOUT_MODEL_REL)).toContain(
        "marketplace.checkoutWeb.ui -> kafka.orderEvents 'Publishes'",
      );
    } finally {
      await p.destroy();
    }
  });

  it("an edge whose target lives in ANOTHER service's model is refused: this project cannot see it", async () => {
    // The limit the routing inherits and does not invent: an extending model is
    // read beside the map and nothing else, so a container another service's
    // model declares resolves nowhere here — and would resolve nowhere on the
    // map either, which is the reason the map may not hold it.
    const p = await makeProject({
      ...fleet(),
      ...feature(
        delta(`  marketplace = group 'Marketplace' {
    checkoutWeb = softwareSystem 'checkout-web' {
      ui = container 'ui'
    }
    orderService = softwareSystem 'order-service' {
      api = container 'api'
    }
  }

  marketplace.checkoutWeb.ui -> marketplace.orderService.api 'Calls' {
    #FEAT-1
  }
`),
      ),
    });
    try {
      const before = await treeHashes(p.docsDir);
      const res = await archive(p);
      expect(res.code).toBe(1);
      expect(res.out).toContain(CHECKOUT_MODEL_REL);
      expect(res.out).toContain("ANOTHER service's interior");
      expect(await treeHashes(p.docsDir)).toEqual(before);
    } finally {
      await p.destroy();
    }
  });

  it("an edge INTO a service's own container lands in that service's model when the source is not interior", async () => {
    const p = await makeProject({
      ...fleet(),
      ...feature(
        delta(`  marketplace = group 'Marketplace' {
    checkoutWeb = softwareSystem 'checkout-web'
    orderService = softwareSystem 'order-service' {
      api = container 'api'
    }
  }

  marketplace.checkoutWeb -> marketplace.orderService.api 'Calls' {
    #FEAT-1
  }
`),
      ),
    });
    try {
      const beforeMap = await p.read(LANDSCAPE_REL);
      expect((await archive(p)).code).toBe(0);
      expect(await p.read(LANDSCAPE_REL)).toBe(beforeMap);
      expect(await p.read(ORDER_MODEL_REL)).toContain(
        "marketplace.checkoutWeb -> marketplace.orderService.api 'Calls'",
      );
    } finally {
      await p.destroy();
    }
  });

  it("a service-level edge stays on the map, where every fleet check reads it", async () => {
    const p = await makeProject({
      ...fleet(),
      ...feature(
        delta(`  marketplace = group 'Marketplace' {
    checkoutWeb = softwareSystem 'checkout-web'
    orderService = softwareSystem 'order-service'
  }

  marketplace.orderService -> marketplace.checkoutWeb 'Notifies' {
    #FEAT-1
  }
`),
      ),
    });
    try {
      const beforeOrder = await p.read(ORDER_MODEL_REL);
      expect((await archive(p)).code).toBe(0);
      expect(await p.read(LANDSCAPE_REL)).toContain(
        "marketplace.orderService -> marketplace.checkoutWeb 'Notifies'",
      );
      expect(await p.read(ORDER_MODEL_REL)).toBe(beforeOrder);
    } finally {
      await p.destroy();
    }
  });

  it("a model with no extend block for the parent gains one at the end of its model block", async () => {
    const p = await makeProject({
      ...fleet({ [ORDER_MODEL_REL]: "model {\n}\n" }),
      ...feature(CACHE_DELTA),
    });
    try {
      expect((await archive(p)).code).toBe(0);
      expect(await p.read(ORDER_MODEL_REL)).toBe(
        "model {\n" +
          "  extend marketplace.orderService {\n" +
          "    cache = container 'Order cache' {\n" +
          "      technology 'Redis'\n" +
          "    }\n" +
          "  }\n" +
          "}\n",
      );
    } finally {
      await p.destroy();
    }
  });

  it("a container the model already declares under another id is not spliced a second time", async () => {
    // The title join is the id-less half of the existence check, and it has to
    // read the models the merge now writes into: with only the map indexed, a
    // container the service already draws under its own identifier was added
    // beside itself and the service silently grew two boxes called 'Order
    // cache' (review of E1). The control is the map's own behaviour, pinned by
    // `test/archive.test.ts` — the same delta against the same title on the map
    // adds nothing.
    const p = await makeProject({
      ...fleet({
        [ORDER_MODEL_REL]: "model {\n  extend marketplace.orderService {\n    orderCache = container 'Order cache'\n  }\n}\n",
      }),
      ...feature(CACHE_DELTA),
    });
    try {
      const beforeMap = await p.read(LANDSCAPE_REL);
      const beforeModel = await p.read(ORDER_MODEL_REL);
      const res = await archive(p);
      expect(res.code).toBe(0);
      expect(await p.read(ORDER_MODEL_REL), "the service must not grow a second 'Order cache'").toBe(beforeModel);
      expect(await p.read(LANDSCAPE_REL)).toBe(beforeMap);
    } finally {
      await p.destroy();
    }
  });

  it("an extending model with no model block gains one rather than refusing the archive", async () => {
    // `service-model/shape.ts` calls an empty file extending on purpose, so the
    // routing hands it a nested addition; refusing there took a whole legal
    // shape away from the archive, and before the routing existed the same
    // delta merged onto the map (review of E1).
    const p = await makeProject({ ...fleet({ [ORDER_MODEL_REL]: "" }), ...feature(CACHE_DELTA) });
    try {
      const res = await archive(p);
      expect(res.code).toBe(0);
      expect(await p.read(ORDER_MODEL_REL)).toBe(
        "model {\n" +
          "  extend marketplace.orderService {\n" +
          "    cache = container 'Order cache' {\n" +
          "      technology 'Redis'\n" +
          "    }\n" +
          "  }\n" +
          "}\n",
      );
    } finally {
      await p.destroy();
    }
  });

  it("a views-only model keeps its views and gains the model block below them", async () => {
    const views = "views {\n  view svc {\n    include *\n  }\n}\n";
    const p = await makeProject({ ...fleet({ [ORDER_MODEL_REL]: views }), ...feature(CACHE_DELTA) });
    try {
      expect((await archive(p)).code).toBe(0);
      expect(await p.read(ORDER_MODEL_REL)).toBe(
        views +
          "model {\n" +
          "  extend marketplace.orderService {\n" +
          "    cache = container 'Order cache' {\n" +
          "      technology 'Redis'\n" +
          "    }\n" +
          "  }\n" +
          "}\n",
      );
    } finally {
      await p.destroy();
    }
  });

  it("a delta spelling the parent under its OWN name keeps the title join, and the map", async () => {
    // The legacy shape: the delta names `orderService` where the map says
    // `marketplace.orderService`. Routing it would open an `extend` block on an
    // fqn the map never heard of, and the spliced bytes would carry ids from the
    // delta's namespace into a document that shares the map's — so nothing is
    // routed unless the delta already writes in the map's own ids.
    const p = await makeProject({
      ...fleet(),
      ...feature(
        delta(`  orderService = softwareSystem 'order-service' {
    cache = container 'Order cache' {
      #FEAT-1
    }
  }
`),
      ),
    });
    try {
      const beforeModel = await p.read(ORDER_MODEL_REL);
      expect((await archive(p)).code).toBe(0);
      expect(await p.read(ORDER_MODEL_REL)).toBe(beforeModel);
      expect(await p.read(LANDSCAPE_REL)).toContain("cache = container 'Order cache'");
    } finally {
      await p.destroy();
    }
  });

  it("a service whose model is STANDALONE keeps the pre-extending behaviour: the addition lands on the map", async () => {
    const standalone = `specification {
  element softwareSystem
  element container
}

model {
  orderService = softwareSystem 'order-service' {
    api = container 'api'
  }
}
`;
    const p = await makeProject({
      ...fleet({ [ORDER_MODEL_REL]: standalone }),
      ...feature(CACHE_DELTA),
      "docs-note.md": "",
    });
    try {
      expect((await archive(p)).code).toBe(0);
      expect(await p.read(ORDER_MODEL_REL)).toBe(standalone);
      expect(await p.read(LANDSCAPE_REL)).toContain("cache = container 'Order cache'");
    } finally {
      await p.destroy();
    }
  });

  it("a service with no model.likec4 at all keeps the pre-extending behaviour", async () => {
    const files = fleet();
    delete files[ORDER_MODEL_REL];
    const p = await makeProject({ ...files, ...feature(CACHE_DELTA) });
    try {
      expect((await archive(p)).code).toBe(0);
      expect(await p.read(LANDSCAPE_REL)).toContain("cache = container 'Order cache'");
      expect(p.exists(ORDER_MODEL_REL)).toBe(false);
    } finally {
      await p.destroy();
    }
  });

  it("archiving the same additions twice adds nothing the second time", async () => {
    const p = await makeProject({
      ...fleet(),
      ...feature(
        delta(`  marketplace = group 'Marketplace' {
    orderService = softwareSystem 'order-service' {
      api = container 'api'
      cache = container 'Order cache' {
        #FEAT-1
      }
    }
  }

  marketplace.orderService.api -> marketplace.orderService.cache 'Reads' {
    #FEAT-1
  }
`),
      ),
    });
    try {
      expect((await archive(p)).code).toBe(0);
      const once = await p.read(ORDER_MODEL_REL);
      // The feature moved to features/archive/; unarchive puts it back so the
      // same merge can be replayed against the tree it already landed in.
      expect((await runLoam(p.workDir, "unarchive", "FEAT-1")).code).toBe(0);
      expect((await runLoam(p.workDir, "archive", "FEAT-1", "--approve")).code).toBe(0);
      const twice = await p.read(ORDER_MODEL_REL);
      // The first archive's own text is what the second must not double.
      expect(twice.split("cache = container").length).toBe(2);
      expect(twice.split("-> marketplace.orderService.cache").length).toBe(2);
      expect(once).toBe(twice);
    } finally {
      await p.destroy();
    }
  });

  it("unarchive restores the model the merge overwrote, byte for byte", async () => {
    const p = await makeProject({ ...fleet(), ...feature(CACHE_DELTA) });
    try {
      const before = await treeHashes(p.docsDir);
      expect((await archive(p)).code).toBe(0);
      expect(await p.read(ORDER_MODEL_REL)).not.toBe(ORDER_MODEL);
      expect((await runLoam(p.workDir, "unarchive", "FEAT-1")).code).toBe(0);
      expect(await treeHashes(p.docsDir)).toEqual(before);
    } finally {
      await p.destroy();
    }
  });

  it("a merged model that would not resolve refuses the archive and writes nothing", async () => {
    // `queue` is a kind no document in this fleet declares — legal in the delta,
    // which declares its own specification, and unresolvable in the model, which
    // takes the map's. The parse net has to catch it on the MODEL, because the
    // map never sees this addition at all.
    const p = await makeProject({
      ...fleet(),
      ...feature(
        `specification {
  element group
  element softwareSystem
  element queue
  tag FEAT-1
}

model {
  marketplace = group 'Marketplace' {
    orderService = softwareSystem 'order-service' {
      inbox = queue 'Order inbox' {
        #FEAT-1
      }
    }
  }
}

views {
  view feat_1 {
    include *
  }
}
`,
      ),
    });
    try {
      const before = await treeHashes(p.docsDir);
      const res = await runLoam(p.workDir, "archive", "FEAT-1", "--approve");
      expect(res.code).toBe(1);
      expect(res.out).toContain(ORDER_MODEL_REL);
      expect(await treeHashes(p.docsDir)).toEqual(before);
    } finally {
      await p.destroy();
    }
  });

  it("a delta spelling the parent under its OWN name INSIDE a group the map declares keeps the title join, and the map", async () => {
    // The grouped spelling of the case above, and the one every fleet whose map
    // draws a boundary actually writes — which is the shape `loam init --example`
    // ships. The guard used to accept any chain whose ANCESTOR was living, so the
    // living GROUP `marketplace` let `marketplace.orderSvc` through, the addition
    // was written as `extend marketplace.orderSvc` — an id the map has never
    // declared — and the model's parse net refused an archive that used to merge
    // (verification 2026-09-04, refutation of E1).
    const p = await makeProject({
      ...fleet(),
      ...feature(
        delta(`  marketplace = group 'Marketplace' {
    orderSvc = softwareSystem 'order-service' {
      cache = container 'Order cache' {
        #FEAT-1
      }
    }
  }
`),
      ),
    });
    try {
      const beforeModel = await p.read(ORDER_MODEL_REL);
      const res = await archive(p);
      expect(res.out).not.toContain("merge-failed");
      expect(res.code).toBe(0);
      expect(await p.read(ORDER_MODEL_REL)).toBe(beforeModel);
      const map = await p.read(LANDSCAPE_REL);
      expect(map).toContain("cache = container 'Order cache'");
      expect(map, "the title join lands it under the map's own id").toContain("marketplace.orderService");
      expect(map).not.toContain("orderSvc");
    } finally {
      await p.destroy();
    }
  });
});

/**
 * A service the feature INTRODUCES, whose directory already holds an extending
 * model. Its containers arrive inside the new element's authored bytes and carry
 * no feature tag of their own — LikeC4 does not inherit tags — so per-addition
 * routing cannot see them, and they rode onto the map: the model could then never
 * declare them, and writing the container `loam adopt` prescribes made the
 * service `c4.invalid` with a duplicate the renderer blamed on both files
 * (verification 2026-09-04, refutation of E1).
 */
describe("loam archive keeps an introduced service's interior out of the map", () => {
  const BILLING_MODEL_REL = "services/billing-service/model.likec4";
  const BILLING_DELTA = delta(`  marketplace = group 'Marketplace' {
    billing = softwareSystem 'billing-service' {
      #FEAT-1
      description 'Bills what was ordered'
      metadata {
        service 'billing-service'
      }
      api = container 'api' {
        technology 'Spring Boot'
      }
    }
  }
`);

  /** The service's directory as `loam adopt` leaves it before anything is written. */
  function adopted(): Record<string, string> {
    return {
      [BILLING_MODEL_REL]: "model {\n}\n",
      "services/billing-service/spec.md": "---\nservice: billing-service\nstatus: draft\n---\n\n# billing-service\n",
    };
  }

  it("the container lands in the model's extend block and the box on the map carries no interior", async () => {
    const p = await makeProject({ ...fleet(adopted()), ...feature(BILLING_DELTA) });
    try {
      const res = await archive(p);
      expect(res.code).toBe(0);
      const map = await p.read(LANDSCAPE_REL);
      expect(map, "the map takes the box").toContain("billing = softwareSystem 'billing-service'");
      expect(map, "and not its interior").not.toContain("api = container");
      expect(await p.read(BILLING_MODEL_REL)).toBe(
        "model {\n" +
          "  extend marketplace.billing {\n" +
          "    api = container 'api' {\n" +
          "      technology 'Spring Boot'\n" +
          "    }\n" +
          "  }\n" +
          "}\n",
      );
      expect(res.out).toContain(`merged into ${BILLING_MODEL_REL}`);
    } finally {
      await p.destroy();
    }
  });

  it("the model may then declare the container the adopt brief prescribes — the report's symptom", async () => {
    const p = await makeProject({ ...fleet(adopted()), ...feature(BILLING_DELTA) });
    try {
      expect((await archive(p)).code).toBe(0);
      // Byte for byte what `loam adopt --service billing-service` tells the team
      // to write. With the container also on the map this is a duplicate
      // declaration the renderer blames on both files, and the whole service is
      // `c4.invalid` — the failure the report measured.
      await p.write(
        BILLING_MODEL_REL,
        "model {\n  extend marketplace.billing {\n    api = container 'api' {\n      technology 'Spring Boot'\n    }\n  }\n}\n",
      );
      const res = await runLoam(p.workDir, "validate", "--service", "billing-service", "--json");
      const payload = JSON.parse(res.stdout) as {
        targets: Array<{ findings: Array<{ severity: string; code: string; message: string }> }>;
      };
      const findings = payload.targets.flatMap((t) => t.findings);
      expect(findings.filter((f) => f.severity === "error").map((f) => `${f.code}: ${f.message}`)).toEqual([]);
      expect(findings.map((f) => f.code)).toContain("c4.valid");
    } finally {
      await p.destroy();
    }
  });

  it("a service arriving with no directory at all keeps the whole block on the map", async () => {
    const p = await makeProject({ ...fleet(), ...feature(BILLING_DELTA) });
    try {
      expect((await archive(p)).code).toBe(0);
      expect(await p.read(LANDSCAPE_REL)).toContain("api = container 'api'");
      expect(p.exists(BILLING_MODEL_REL)).toBe(false);
    } finally {
      await p.destroy();
    }
  });

  it("a block that also draws an internal edge rides onto the map whole — the stated remainder", async () => {
    // An edge written inside the block names its endpoints by their LOCAL names,
    // and the model merge anchors a relationship at the model block's top level.
    // Splitting the two apart would leave the map naming children it no longer
    // declares and the parse net would refuse the archive outright, so the block
    // is left as it was before routing existed.
    const p = await makeProject({
      ...fleet(adopted()),
      ...feature(
        delta(`  marketplace = group 'Marketplace' {
    billing = softwareSystem 'billing-service' {
      #FEAT-1
      metadata {
        service 'billing-service'
      }
      api = container 'api'
      worker = container 'worker'
      api -> worker 'Enqueues'
    }
  }
`),
      ),
    });
    try {
      expect((await archive(p)).code).toBe(0);
      expect(await p.read(LANDSCAPE_REL)).toContain("api = container 'api'");
      expect(await p.read(BILLING_MODEL_REL)).toBe("model {\n}\n");
    } finally {
      await p.destroy();
    }
  });

  it("a block that rides whole keeps a FEATURE-TAGGED child too — one decision, not two", async () => {
    // The remainder above was stated for the untagged interior only, and the two
    // halves of the routing each answered the question on their own: the tagged
    // child was in `addedEls`, so per-addition routing sent it to the model,
    // while the block decision left the same child's bytes on the map. The merge
    // then declared `worker` twice and refused ITSELF — `merge-failed`, exit 1,
    // nothing written — on a delta neither half was wrong about
    // (re-verification 2026-09-04).
    const p = await makeProject({
      ...fleet(adopted()),
      ...feature(
        delta(`  marketplace = group 'Marketplace' {
    billing = softwareSystem 'billing-service' {
      #FEAT-1
      metadata {
        service 'billing-service'
      }
      api = container 'api'
      worker = container 'worker' {
        #FEAT-1
      }
      api -> worker 'Enqueues'
    }
  }
`),
      ),
    });
    try {
      const res = await archive(p);
      expect(res.out).not.toContain("merge-failed");
      expect(res.code).toBe(0);
      const map = await p.read(LANDSCAPE_REL);
      expect(map).toContain("api = container 'api'");
      expect(map, "the tagged child rides inside its parent, once").toContain("worker = container 'worker'");
      expect(map.split("worker = container").length, "and is not declared a second time").toBe(2);
      expect(await p.read(BILLING_MODEL_REL), "nothing is routed out of a block that rides whole").toBe(
        "model {\n}\n",
      );
      const land = await loadFile(join(p.docsDir, LANDSCAPE_REL));
      expect(land.errors).toEqual([]);
    } finally {
      await p.destroy();
    }
  });

  it("a block that rides whole keeps a FEATURE-TAGGED internal edge too", async () => {
    // The relationship half of the same one-decision rule. The edge names its
    // endpoints by their LOCAL names, so it reads only inside the block it is
    // written in; routing it to the model spliced `api -> worker` at that
    // model's top level, where neither name resolves, and the archive refused
    // itself (re-verification 2026-09-04).
    const p = await makeProject({
      ...fleet(adopted()),
      ...feature(
        delta(`  marketplace = group 'Marketplace' {
    billing = softwareSystem 'billing-service' {
      #FEAT-1
      metadata {
        service 'billing-service'
      }
      api = container 'api'
      worker = container 'worker'
      api -> worker 'Enqueues' {
        #FEAT-1
      }
    }
  }
`),
      ),
    });
    try {
      const res = await archive(p);
      expect(res.out).not.toContain("merge-failed");
      expect(res.code).toBe(0);
      expect(await p.read(LANDSCAPE_REL)).toContain("api -> worker 'Enqueues'");
      expect(await p.read(BILLING_MODEL_REL)).toBe("model {\n}\n");
      const land = await loadFile(join(p.docsDir, LANDSCAPE_REL));
      expect(land.errors).toEqual([]);
    } finally {
      await p.destroy();
    }
  });

  it("a split block routes a FEATURE-TAGGED child exactly once, and says so once", async () => {
    // The same delta without the internal edge, so the block splits. The child is
    // reachable by BOTH halves — per-addition routing sees its tag, the block
    // decision sees it among the parent's children — and it was pushed twice: the
    // model merge's `rides` net kept the second splice out of the file, but the
    // plan still announced `+3 element(s)` and listed `worker` twice for two
    // containers written (re-verification 2026-09-04).
    const p = await makeProject({
      ...fleet(adopted()),
      ...feature(
        delta(`  marketplace = group 'Marketplace' {
    billing = softwareSystem 'billing-service' {
      #FEAT-1
      metadata {
        service 'billing-service'
      }
      api = container 'api'
      worker = container 'worker' {
        #FEAT-1
      }
    }
  }
`),
      ),
    });
    try {
      const res = await archive(p);
      expect(res.code).toBe(0);
      expect(await p.read(LANDSCAPE_REL), "the map takes the box, not the interior").not.toContain(
        "= container",
      );
      expect(await p.read(BILLING_MODEL_REL)).toBe(
        "model {\n" +
          "  extend marketplace.billing {\n" +
          "    api = container 'api'\n" +
          "    worker = container 'worker'\n" +
          "  }\n" +
          "}\n",
      );
      expect(res.out).toContain(`merged into ${BILLING_MODEL_REL} — +2 element(s), +0 relationship(s)`);
      expect(res.out.split("+ worker (container)").length, "each written element is named once").toBe(2);
    } finally {
      await p.destroy();
    }
  });
});

/**
 * A merge composes bytes from two files, and the delta's newlines are not
 * necessarily the living document's. On a repository without `core.autocrlf`
 * normalisation both merges left a handful of bare-LF lines in the spliced
 * region of a CRLF document — two conventions in one file (verification
 * 2026-09-04, W-CRLF).
 */
describe("loam archive splices with the document's own line endings", () => {
  const crlf = (text: string): string => text.replace(/\n/g, "\r\n");
  const bareLf = (text: string): number => (text.match(/(?<!\r)\n/g) ?? []).length;

  it("a CRLF model comes back with one convention, not two", async () => {
    const p = await makeProject({
      ...fleet({ [ORDER_MODEL_REL]: crlf(ORDER_MODEL) }),
      ...feature(CACHE_DELTA),
    });
    try {
      expect((await archive(p)).code).toBe(0);
      const model = await p.read(ORDER_MODEL_REL);
      expect(model).toContain("cache = container 'Order cache'");
      expect(bareLf(model), "the splice must not leave bare-LF lines in a CRLF model").toBe(0);
    } finally {
      await p.destroy();
    }
  });

  it("a CRLF landscape comes back with one convention, not two", async () => {
    const p = await makeProject({
      ...fleet({ [LANDSCAPE_REL]: crlf(MAP) }),
      ...feature(
        delta(`  billing = softwareSystem 'billing-service' {
    #FEAT-1
    description 'Bills what was ordered'
  }
`),
      ),
    });
    try {
      expect((await archive(p)).code).toBe(0);
      const map = await p.read(LANDSCAPE_REL);
      expect(map).toContain("billing = softwareSystem 'billing-service'");
      expect(bareLf(map), "the splice must not leave bare-LF lines in a CRLF landscape").toBe(0);
    } finally {
      await p.destroy();
    }
  });

  it("a CRLF delta's blank lines do not arrive carrying the target indent", async () => {
    const p = await makeProject({
      ...fleet(),
      ...feature(
        crlf(
          delta(`  marketplace = group 'Marketplace' {
    orderService = softwareSystem 'order-service' {
      cache = container 'Order cache' {
        #FEAT-1

        technology 'Redis'
      }
    }
  }
`),
        ),
      ),
    });
    try {
      expect((await archive(p)).code).toBe(0);
      const model = await p.read(ORDER_MODEL_REL);
      expect(model).toContain("technology 'Redis'");
      expect(/[ \t]+\r?\n/.test(model), "a blank line must arrive blank, not indented").toBe(false);
      expect(bareLf(model), "an LF model takes the CRLF delta's block as LF").toBe(model.split("\n").length - 1);
    } finally {
      await p.destroy();
    }
  });
});
