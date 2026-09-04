/**
 * `c4.declaration-diverged` — where a STANDALONE model's copy of a shared
 * element disagrees with the fleet map's.
 *
 * The report: a model that is parsed alone must re-declare every element it
 * talks about, so `kafka`, `uaa` and each peer service appear twice with two
 * kinds, two titles, two tag lists and two bindings — 78 double declarations in
 * a 56-service fleet, and the copies had already drifted (`#platform` on the
 * map's elements, missing from the models'). Nothing read two documents
 * together, so nothing could say so.
 *
 * FOUR FIELDS ARE COMPARED and one deliberately is not. `kind`, `title`, the tag
 * SET and the `metadata { service }` binding each change what loam concludes or
 * what a view shows; `description` is prose that nothing joins on, and reporting
 * two differently-worded sentences would train a reader to ignore the code.
 */
import { describe, expect, it } from "vitest";
import { LIVING_OPENAPI, LIVING_SPEC, makeProject, runLoam, type Project } from "./helpers/harness.js";

interface JsonFinding {
  severity: string;
  code: string;
  subject?: string;
  message: string;
}

interface Payload {
  targets: Array<{ kind: string; id: string; findings: JsonFinding[] }>;
}

function codeFor(stdout: string, code: string): JsonFinding[] {
  return (JSON.parse(stdout) as Payload).targets.flatMap((t) => t.findings).filter((f) => f.code === code);
}

const SVC = "payment-service";
const CODE = "c4.declaration-diverged";

/** The map's declaration: a bound `softwareSystem` titled `payment-service`, tagged `#core`. */
const MAP = `specification {
  element softwareSystem
  element container
  tag core
}

model {
  paymentService = softwareSystem 'payment-service' {
    #core
    description 'The map says this'
    metadata { service 'payment-service' }
  }
}

views {
  view landscape {
    include *
  }
}
`;

/**
 * The model's own copy, in the STANDALONE shape. `body` replaces everything
 * between the element's braces, so each test below changes exactly one field
 * and every other field agrees with the map's declaration verbatim.
 */
function standalone(body: string): string {
  return `specification {
  element softwareSystem
  element container
  tag core
}

model {
  paymentService = softwareSystem 'payment-service' {
${body}    api = container 'api'
  }
}
`;
}

/** The declaration that agrees with the map on all four compared fields. */
const AGREES = "    #core\n    description 'The map says this'\n    metadata { service 'payment-service' }\n";

async function project(model: string, extra: Record<string, string> = {}): Promise<Project> {
  return makeProject({
    "architecture/landscape.likec4": MAP,
    [`services/${SVC}/model.likec4`]: model,
    [`services/${SVC}/spec.md`]: LIVING_SPEC,
    [`services/${SVC}/openapi.yaml`]: LIVING_OPENAPI,
    ...extra,
  });
}

async function divergences(p: Project): Promise<JsonFinding[]> {
  const res = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
  return codeFor(res.stdout, CODE);
}

describe("c4.declaration-diverged — two documents, two authorities on one element", () => {
  // Catches: the check dropped, or the tag set compared as an ordered list (a
  // model that lists the map's two tags the other way round is the SAME
  // declaration and must stay silent — the sort is what makes that true).
  it("a tag the map declares and the model does not is one warning naming both sides", async () => {
    const p = await project(standalone(AGREES.replace("    #core\n", "")));
    try {
      const found = await divergences(p);
      expect(found).toHaveLength(1);
      expect(found[0]?.severity).toBe("warn");
      expect(found[0]?.subject).toBe(SVC);
      expect(found[0]?.message).toContain("model.likec4 declares 'paymentService' as softwareSystem 'payment-service' [no tags, bound to payment-service]");
      // The other side is named by what loam actually read — the `architecture/`
      // PROJECT — never a filename nobody opened: the map's declaration may sit
      // in any document under it, and `Elem` carries no source path.
      expect(found[0]?.message).toContain("the fleet map (architecture/) declares it as softwareSystem 'payment-service' [core, bound to payment-service]");
      expect(found[0]?.message).not.toContain("architecture/landscape.likec4");
      expect(found[0]?.message).toContain("the tags differ");
      // Both repairs, because only one of them cannot drift again.
      expect(found[0]?.message).toContain("Copy the map's declaration verbatim");
      expect(found[0]?.message).toContain("migrate the model to extend the map");
    } finally {
      await p.destroy();
    }
  });

  // Catches: the title dropped from the compare — it is a resolver fallback, so
  // two titles are two answers to "which service is this element".
  it("a different title is reported, and names the field", async () => {
    const p = await project(standalone(AGREES).replace("softwareSystem 'payment-service' {", "softwareSystem 'Payments' {"));
    try {
      const found = await divergences(p);
      expect(found).toHaveLength(1);
      expect(found[0]?.message).toContain("the title differ");
      expect(found[0]?.message).toContain("'Payments'");
    } finally {
      await p.destroy();
    }
  });

  // Catches: the kind dropped — it decides which specification rule applies and
  // which exemptions (`ACTOR_KINDS`, `#external`) fire.
  it("a different kind is reported", async () => {
    const p = await project(
      standalone(AGREES)
        .replace("  element softwareSystem\n", "  element softwareSystem\n  element service\n")
        .replace("paymentService = softwareSystem 'payment-service' {", "paymentService = service 'payment-service' {"),
    );
    try {
      const found = await divergences(p);
      expect(found).toHaveLength(1);
      expect(found[0]?.message).toContain("the kind differ");
    } finally {
      await p.destroy();
    }
  });

  // Catches: the binding dropped — it decides which directory an edge is filed
  // under, which is the join every fleet check runs on.
  it("a missing metadata { service } binding is reported as the binding it is", async () => {
    const p = await project(standalone(AGREES.replace("    metadata { service 'payment-service' }\n", "")));
    try {
      const found = await divergences(p);
      expect(found).toHaveLength(1);
      expect(found[0]?.message).toContain("the service binding differ");
      expect(found[0]?.message).toContain("bound to unbound");
    } finally {
      await p.destroy();
    }
  });

  // Catches: `description` creeping into the compare. It is prose, nothing
  // joins on it, and a code that fires on two wordings is one nobody reads.
  it("a different description is NOT a divergence", async () => {
    const p = await project(standalone(AGREES.replace("The map says this", "The model says something else")));
    try {
      expect(await divergences(p)).toEqual([]);
    } finally {
      await p.destroy();
    }
  });

  // Catches: the check reading half a document. A diff against a map that did
  // not parse is invention, and `landscape.invalid` already owns that state.
  it("silent when the fleet map does not parse", async () => {
    const p = await project(standalone(AGREES.replace("    metadata { service 'payment-service' }\n", "")), {
      "architecture/usecases/bad.likec4": "views {\n  dynamic view uc_bad {\n    nosuch -> alsonosuch 'x'\n  }\n}\n",
    });
    try {
      expect(await divergences(p)).toEqual([]);
    } finally {
      await p.destroy();
    }
  });

  // Catches: the check applied to the other shape. An extending model declares
  // each element once by construction — there is no copy to diverge — and
  // `c4.element-unowned` is the question asked of it instead.
  it("silent for a model that extends the map, whatever the map says", async () => {
    const p = await project("model {\n  extend paymentService {\n    api = container 'api'\n  }\n}\n");
    try {
      expect(await divergences(p)).toEqual([]);
      const res = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      expect(codeFor(res.stdout, "c4.valid")).toHaveLength(1);
    } finally {
      await p.destroy();
    }
  });

  // Catches: the grammar. One field is "differs", two or more are "differ" —
  // "the kind differ" shipped, and a message a reader trips over is one they
  // stop reading.
  it("agrees with itself about number", async () => {
    const one = await project(standalone(AGREES).replace("softwareSystem 'payment-service' {", "softwareSystem 'Payments' {"));
    const two = await project(
      standalone(AGREES.replace("    metadata { service 'payment-service' }\n", "")).replace(
        "softwareSystem 'payment-service' {",
        "softwareSystem 'Payments' {",
      ),
    );
    try {
      expect((await divergences(one))[0]?.message).toContain("the title differs, so two documents");
      expect((await divergences(two))[0]?.message).toContain("the title, service binding differ, so two documents");
    } finally {
      await one.destroy();
      await two.destroy();
    }
  });

  // Catches: a warning turning into a gate. A standalone model is legal
  // forever; the divergence is a drift report, never a refusal.
  it("never gates: the run stays valid and exits 0", async () => {
    const p = await project(standalone(AGREES.replace("    metadata { service 'payment-service' }\n", "")));
    try {
      const res = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      expect(res.code).toBe(0);
      expect(JSON.parse(res.stdout).valid).toBe(true);
    } finally {
      await p.destroy();
    }
  });
});

/**
 * The join, which is what decides whether the check has anything to say at all.
 *
 * Measured on the tree: a map that GROUPS its services — loam's own example
 * nests them under `marketplace` — declares `marketplace.paymentService`, a
 * standalone model declares `paymentService`, and the literal-id join never met
 * them. Kind, title and tags could all differ and the code was silent, on the
 * shape it exists for.
 */
describe("which two declarations are one element", () => {
  /** The map above with its services nested one level down. `body` is the service element's. */
  function grouped(body: string): string {
    return `specification {
  element softwareSystem
  element container
  tag core
}

model {
  marketplace = softwareSystem 'Marketplace' {
${body}  }
}

views {
  view landscape {
    include *
  }
}
`;
  }

  // Catches: the literal-id join. `paymentService` and `marketplace.paymentService`
  // are one element declared twice, and the dotted TAIL is what says so.
  it("joins a model's id to the map's dotted tail, and names the id the map spells", async () => {
    const p = await project(
      "specification {\n  element softwareSystem\n  element container\n}\n\nmodel {\n  paymentService = softwareSystem 'Payments' {\n    api = container 'api'\n  }\n}\n",
      { "architecture/landscape.likec4": grouped("    paymentService = softwareSystem 'payment-service' {\n    }\n") },
    );
    try {
      const found = await divergences(p);
      expect(found).toHaveLength(1);
      expect(found[0]?.message).toContain("model.likec4 declares 'paymentService' as softwareSystem 'Payments'");
      expect(found[0]?.message).toContain("the fleet map (architecture/) declares 'marketplace.paymentService' as softwareSystem 'payment-service'");
      expect(found[0]?.message).toContain("the title differs");
    } finally {
      await p.destroy();
    }
  });

  // Catches: a join that needs the ids to look alike. Both documents wrote
  // `metadata { service }` — the strongest evidence there is that they mean one
  // element — and the map is free to call it anything.
  it("joins on the metadata { service } binding when the ids share nothing", async () => {
    const p = await project(
      "specification {\n  element softwareSystem\n  element container\n}\n\nmodel {\n  paymentService = softwareSystem 'Payments' {\n    metadata { service 'payment-service' }\n  }\n}\n",
      {
        "architecture/landscape.likec4": grouped(
          "    pay = softwareSystem 'payment-service' {\n      metadata { service 'payment-service' }\n    }\n",
        ),
      },
    );
    try {
      const found = await divergences(p);
      expect(found).toHaveLength(1);
      expect(found[0]?.message).toContain("the fleet map (architecture/) declares 'marketplace.pay'");
      expect(found[0]?.message).toContain("the title differs");
    } finally {
      await p.destroy();
    }
  });

  // Catches: the bare last segment joining somebody else's interior. A tail
  // carrying a DOT names the owner as well as the leaf, so the two documents
  // are demonstrably talking about one element — and that rung stays.
  it("joins a container to the map's container under the same service", async () => {
    const p = await project(
      "specification {\n  element softwareSystem\n  element container\n}\n\nmodel {\n  paymentService = softwareSystem 'payment-service' {\n    api = container 'api'\n  }\n}\n",
      {
        "architecture/landscape.likec4": grouped(
          "    paymentService = softwareSystem 'payment-service' {\n      api = container 'the api tier'\n    }\n",
        ),
      },
    );
    try {
      const found = await divergences(p);
      expect(found).toHaveLength(1);
      expect(found[0]?.message).toContain("model.likec4 declares 'paymentService.api' as container 'api'");
      expect(found[0]?.message).toContain("the fleet map (architecture/) declares 'marketplace.paymentService.api' as container 'the api tier'");
    } finally {
      await p.destroy();
    }
  });

  // Catches: the bare last segment as a join key. loam's own meta/docs hit this
  // — a top-level `agent` joined `loam.core.agent`, a container of
  // src/core/agent/, and the warning told the author to copy a declaration
  // belonging to a different subject (verification 2026-09-04). Here it is one
  // service's private cache against another service's store: two elements owned
  // by two services, not one element declared twice.
  it("never joins a top-level element to a container nested inside another service", async () => {
    const p = await project(
      "specification {\n  element softwareSystem\n  element container\n}\n\nmodel {\n  db = container 'the basket cache (Redis)'\n  paymentService = softwareSystem 'payment-service' {\n  }\n}\n",
      {
        "architecture/landscape.likec4": grouped(
          "    paymentService = softwareSystem 'payment-service' {\n    }\n" +
            "    orderService = softwareSystem 'order-service' {\n      metadata { service 'order-service' }\n      db = container 'the orders store'\n    }\n",
        ),
      },
    );
    try {
      expect(await divergences(p)).toEqual([]);
    } finally {
      await p.destroy();
    }
  });

  // The other half of the pair above, and the one the words got wrong. Three
  // pages described the bare-tail guard as "a top-level element, or one bound
  // with `metadata { service }` or titled like a real services/<id>/" — and the
  // code's guard is `serviceLevelElements`, "no ancestor stands for a service",
  // which also admits a box the map draws inside a plain GROUP (verification
  // 2026-09-04, second pass). The code is right and the words were not:
  // grouping is a drawing convenience, so `marketplace.cache` is the FLEET's
  // cache, and a model that declares its own top-level `cache` gives one name
  // two meanings. Above: a container inside a SERVICE, which is that service's
  // interior and joins nothing. Here: a child of a group, which does.
  it("joins a bare tail to a box the map draws inside a plain group", async () => {
    const p = await project(
      "specification {\n  element softwareSystem\n  element container\n  tag core\n}\n\nmodel {\n" +
        "  paymentService = softwareSystem 'payment-service' {\n    #core\n" +
        "    metadata { service 'payment-service' }\n    api = container 'api'\n  }\n" +
        "  cache = container 'the payment cache'\n}\n",
      {
        "architecture/landscape.likec4": grouped(
          "    paymentService = softwareSystem 'payment-service' {\n      #core\n" +
            "      metadata { service 'payment-service' }\n    }\n" +
            "    cache = container 'the fleet cache'\n",
        ),
      },
    );
    try {
      const found = await divergences(p);
      expect(found).toHaveLength(1);
      expect(found[0]?.message).toContain("model.likec4 declares 'cache' as container 'the payment cache'");
      expect(found[0]?.message).toContain("the fleet map (architecture/) declares 'marketplace.cache' as container 'the fleet cache'");
      expect(found[0]?.message).toContain("the title differs");
    } finally {
      await p.destroy();
    }
  });

  // Catches: a tail join that picks one of two. A divergence reported against
  // the wrong peer is worse than the silence it replaced, so an ambiguous key
  // joins nothing at all.
  it("stays silent when two map elements answer to the same tail", async () => {
    const p = await project(
      "specification {\n  element softwareSystem\n  element container\n}\n\nmodel {\n  paymentService = softwareSystem 'Payments' {\n  }\n}\n",
      {
        "architecture/landscape.likec4": grouped(
          "    paymentService = softwareSystem 'payment-service' {\n    }\n" +
            "    legacy = softwareSystem 'Legacy' {\n      paymentService = softwareSystem 'old payment-service' {\n      }\n    }\n",
        ),
      },
    );
    try {
      expect(await divergences(p)).toEqual([]);
    } finally {
      await p.destroy();
    }
  });

  // Catches: "copy the map's declaration verbatim" told to an author whose
  // declaration is ALREADY byte-identical. Since LikeC4 1.59.0 a kind can carry
  // tags and they arrive on every element of that kind, so the two documents
  // disagree about a tag neither of them wrote on the element.
  it("points at the specification block when the difference is inherited from the kind", async () => {
    const p = await project(
      "specification {\n  element softwareSystem\n  element container\n  tag core\n}\n\nmodel {\n  paymentService = softwareSystem 'payment-service' {\n    description 'The map says this'\n    metadata { service 'payment-service' }\n  }\n}\n",
      {
        // `#core` is on the KIND here and on no element, so the map's
        // declaration is byte-identical to the model's and its element still
        // arrives carrying the tag.
        "architecture/landscape.likec4": `specification {
  element softwareSystem {
    #core
  }
  element container
  tag core
}

model {
  paymentService = softwareSystem 'payment-service' {
    description 'The map says this'
    metadata { service 'payment-service' }
  }
}

views {
  view landscape {
    include *
  }
}
`,
      },
    );
    try {
      const found = await divergences(p);
      expect(found).toHaveLength(1);
      expect(found[0]?.message).toContain("the tags differ");
      expect(found[0]?.message).toContain("specification { element softwareSystem { … } }");
      expect(found[0]?.message).toContain("match the two specification blocks on that kind");
      expect(found[0]?.message).not.toContain("Copy the map's declaration verbatim");
      // The block to open is named on the side that HAS it: here the map's.
      expect(found[0]?.message).toContain(
        "which the fleet map (architecture/) declares tags on and model.likec4 does not",
      );
    } finally {
      await p.destroy();
    }
  });

  // Catches: the same no-op remedy in the OTHER direction, which the first
  // version of the arm above missed. It switched on "both literal tag lists are
  // equal", so a model that WRITES `#core` on an element whose map twin inherits
  // `#core #platform` from `element softwareSystem { … }` was told to copy the
  // map's bare declaration — and doing exactly that produced the other arm of
  // this same message. Measured on examples/docs' order-service and its
  // `element topic { #external #platform }` (verification 2026-09-04, second
  // pass). The predicate now SIMULATES the copy instead of matching one shape.
  it("points at the specification block when the model writes a tag the map's kind grants", async () => {
    const p = await project(
      "specification {\n  element softwareSystem\n  element container\n  tag core\n}\n\nmodel {\n" +
        "  paymentService = softwareSystem 'payment-service' {\n    #core\n" +
        "    metadata { service 'payment-service' }\n  }\n}\n",
      {
        // The map's declaration is the bare line: BOTH its tags come off the
        // kind, so there is nothing on it to copy.
        "architecture/landscape.likec4": `specification {
  element softwareSystem {
    #core
    #platform
  }
  element container
  tag core
  tag platform
}

model {
  paymentService = softwareSystem 'payment-service' {
    metadata { service 'payment-service' }
  }
}

views {
  view landscape {
    include *
  }
}
`,
      },
    );
    try {
      const found = await divergences(p);
      expect(found).toHaveLength(1);
      expect(found[0]?.message).toContain("the tags differ");
      expect(found[0]?.message).toContain("copying the map's declaration would not clear it");
      expect(found[0]?.message).toContain("specification { element softwareSystem { … } }");
      expect(found[0]?.message).toContain(
        "which the fleet map (architecture/) declares tags on and model.likec4 does not",
      );
      expect(found[0]?.message).not.toContain("Copy the map's declaration verbatim");
    } finally {
      await p.destroy();
    }
  });

  // The control for both arms: a tag difference a copy DOES fix keeps the
  // verbatim remedy. Here the map writes `#core` on the element itself, so
  // copying the declaration across ends the divergence — and the message must
  // not send the author into a specification block that explains nothing.
  it("keeps the verbatim remedy when the map's tag is on the element and copying clears it", async () => {
    const p = await project(
      "specification {\n  element softwareSystem\n  element container\n  tag core\n}\n\nmodel {\n" +
        "  paymentService = softwareSystem 'payment-service' {\n" +
        "    metadata { service 'payment-service' }\n  }\n}\n",
    );
    try {
      const found = await divergences(p);
      expect(found).toHaveLength(1);
      expect(found[0]?.message).toContain("the tags differ");
      expect(found[0]?.message).toContain("Copy the map's declaration verbatim");
      expect(found[0]?.message).not.toContain("specification { element softwareSystem { … } }");
    } finally {
      await p.destroy();
    }
  });
});
