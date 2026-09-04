/**
 * A `model.likec4` that EXTENDS the fleet map, end to end.
 *
 * The report this answers: every shared element was declared once per document,
 * so a 56-service fleet carried 78 double declarations whose tags had already
 * drifted, and nothing compared them. The fix is a second shape — a model that
 * declares no kinds, re-declares no partner, and says what is inside the element
 * the map already binds with `extend <fqn> { … }` — parsed INSIDE the
 * `architecture/` project rather than alone.
 *
 * What is pinned here is that every model-dependent grade still reads the
 * service's OWN slice of that project and not the fleet map: the counts, the
 * dependency reconciliation, `Covers:` resolution, the attested-call scan and
 * the service's own use cases. Too wide and a service is graded against the
 * whole fleet (every service would suddenly have relationships and every
 * dependency would resolve); too narrow and a service that models its partners
 * correctly is told it models nothing.
 */
import { describe, expect, it } from "vitest";
import { LIVING_OPENAPI, LIVING_SPEC, makeProject, runLoam, type Project } from "./helpers/harness.js";

interface JsonFinding {
  severity: string;
  code: string;
  subject?: string;
  message: string;
  details?: string[];
  locations?: Array<{ path: string; role: string }>;
}

interface Payload {
  targets: Array<{ kind: string; id: string; findings: JsonFinding[] }>;
}

function findings(stdout: string): JsonFinding[] {
  return (JSON.parse(stdout) as Payload).targets.flatMap((t) => t.findings);
}

function codeFor(stdout: string, code: string): JsonFinding[] {
  return findings(stdout).filter((f) => f.code === code);
}

const SVC = "payment-service";
const DIR = `services/${SVC}`;

/** An arch.spec.md whose one requirement covers `covers` — the line a broken map must not convict. */
function archSpec(service: string, covers: string): string {
  return (
    `---\nservice: ${service}\nstatus: draft\n---\n\n# ${service} — architecture\n\n` +
    "## Requirements\n\n### Requirement: The service is reachable\n" +
    "The service SHALL be reachable.\n\n" +
    `Covers: ${covers}\n\n#### Scenario: It answers\n` +
    "- **Given** a request\n- **When** it arrives\n- **Then** it is answered\n"
  );
}

/**
 * The fleet map, declaring every kind and every element the models below use.
 *
 * `kafka` carries a child `orderEvents` deliberately: health.yaml names the
 * dependency `kafka` while the model draws its edge at `kafka.orderEvents`, and
 * the slice has to carry the ANCESTOR as well as the endpoint or a fleet's
 * dependency declarations turn into findings the day its models migrate.
 */
const MAP = `specification {
  element softwareSystem
  element person
  element container
  element topic
  tag req-PAY
}

model {
  customer = person 'Customer'
  checkoutWeb = softwareSystem 'checkout-web' {
    metadata { service 'checkout-web' }
  }
  paymentService = softwareSystem 'payment-service' {
    description 'Owns payment authorization/capture'
    metadata { service 'payment-service' }
  }
  kafka = softwareSystem 'Kafka' {
    orderEvents = topic 'order.events'
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

/** The extending shape: no `specification`, no partner copy, one `extend` block. */
const EXTENDING = `model {
  extend paymentService {
    api = container 'api'
    api -> kafka.orderEvents 'Publishes'
  }
}
`;

/** payment-service, adopted, with an extending model — plus a second drawn service directory. */
function fixture(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "architecture/landscape.likec4": MAP,
    [`${DIR}/model.likec4`]: EXTENDING,
    [`${DIR}/spec.md`]: LIVING_SPEC,
    [`${DIR}/openapi.yaml`]: LIVING_OPENAPI,
    "services/checkout-web/spec.md": "---\nservice: checkout-web\nstatus: draft\n---\n\n# checkout-web\n",
    "services/checkout-web/model.likec4": "model {\n  extend checkoutWeb {\n  }\n}\n",
    ...extra,
  };
}

async function project(extra: Record<string, string> = {}): Promise<Project> {
  return makeProject(fixture(extra));
}

describe("an extending model is graded on its own slice of the project", () => {
  // Catches: the counts taken from the whole project (the map's `customer` and
  // its two edges would land in them), the standalone message reused, or the
  // slice collapsing to nothing.
  it("c4.valid names the shape and counts the OWN elements and edges, not the map's", async () => {
    const p = await project();
    try {
      const res = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      const [valid] = codeFor(res.stdout, "c4.valid");
      // own = paymentService + its api; partners = kafka.orderEvents and its
      // ancestor kafka. The project holds six elements and three edges.
      expect(valid?.message).toBe(`${SVC}: C4 model valid (extends the fleet map — 4 elements · 1 relationships)`);
      expect(codeFor(res.stdout, "c4.invalid")).toEqual([]);
    } finally {
      await p.destroy();
    }
  });

  // Catches: a slice that drops the ancestor of an edge endpoint. health.yaml
  // names services and top-level systems; the model draws at the topic.
  it("health.yaml's `kafka` resolves through the model's edge at kafka.orderEvents", async () => {
    // `nosuch` rides along so the silence above is a verdict rather than a
    // check that never ran: exactly one of the two dependencies is reported.
    const p = await project({ [`${DIR}/health.yaml`]: "dependencies:\n  - kafka\n  - nosuch\n" });
    try {
      const res = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      const found = codeFor(res.stdout, "health.dependency-unmodelled");
      expect(found).toHaveLength(1);
      expect(found[0]?.message).toContain("declares dependency 'nosuch'");
    } finally {
      await p.destroy();
    }
  });

  // Catches: a `Covers:` scope that does not include the model's own
  // containers — every arch requirement naming one would read as a typo.
  it("an arch requirement covering a container the model adds resolves", async () => {
    const p = await project({
      [`${DIR}/arch.spec.md`]:
        "---\nservice: payment-service\nstatus: draft\n---\n\n# payment-service — architecture\n\n" +
        "## Requirements\n\n### Requirement: The API publishes order events\nRequirement-ID: PAY\n" +
        "The service SHALL publish an event for every authorization.\n\n" +
        "Covers: paymentService.api\n\n#### Scenario: One event per authorization\n" +
        "- **Given** an authorization\n- **When** it commits\n- **Then** one event is published\n",
    });
    try {
      const res = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      expect(codeFor(res.stdout, "covers.unknown")).toEqual([]);
    } finally {
      await p.destroy();
    }
  });
});

describe("a fully-qualified element — the map nests its services", () => {
  // Catches: a slice keyed on anything but the leaf directory name, and an
  // `extend` the loader cannot resolve because the fqn carries a dot.
  it("extend marketplace.paymentService resolves and the slice is the service's own", async () => {
    const nested = MAP.replace(
      "  paymentService = softwareSystem 'payment-service' {\n    description 'Owns payment authorization/capture'\n    metadata { service 'payment-service' }\n  }\n",
      "  marketplace = softwareSystem 'Marketplace' {\n    paymentService = softwareSystem 'payment-service' {\n      metadata { service 'payment-service' }\n    }\n  }\n",
    )
      .replace("checkoutWeb -> paymentService", "checkoutWeb -> marketplace.paymentService");
    const p = await makeProject({
      ...fixture(),
      "architecture/landscape.likec4": nested,
      [`${DIR}/model.likec4`]: `model {\n  extend marketplace.paymentService {\n    api = container 'api'\n    api -> kafka.orderEvents 'Publishes'\n  }\n}\n`,
    });
    try {
      const res = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      expect(codeFor(res.stdout, "c4.invalid")).toEqual([]);
      const [valid] = codeFor(res.stdout, "c4.valid");
      expect(valid?.message).toBe(`${SVC}: C4 model valid (extends the fleet map — 4 elements · 1 relationships)`);
    } finally {
      await p.destroy();
    }
  });

  // Catches: `c4.no-relationships` counting "nested" by the dot in an id. On a
  // map that files its services under a group, the service's OWN element is
  // dotted too — so the evidence sentence counted the box the map drew as one of
  // the containers with no edge joining them. "Has a parent element in this
  // slice" is the one rule that reads the same for both shapes.
  it("the no-relationships evidence counts elements with a parent in the slice, not dotted ids", async () => {
    const nested = MAP.replace(
      "  paymentService = softwareSystem 'payment-service' {\n    description 'Owns payment authorization/capture'\n    metadata { service 'payment-service' }\n  }\n",
      "  marketplace = softwareSystem 'Marketplace' {\n    paymentService = softwareSystem 'payment-service' {\n      metadata { service 'payment-service' }\n    }\n  }\n",
    ).replace("checkoutWeb -> paymentService", "checkoutWeb -> marketplace.paymentService");
    const p = await makeProject({
      ...fixture(),
      "architecture/landscape.likec4": nested,
      [`${DIR}/model.likec4`]: `model {\n  extend marketplace.paymentService {\n    api = container 'api'\n    worker = container 'worker'\n  }\n}\n`,
    });
    try {
      const res = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      const [thin] = codeFor(res.stdout, "c4.no-relationships");
      // Three elements are in the slice and two of them have a parent in it.
      expect(thin?.message).toContain("declares 3 element(s) and 0 relationships");
      expect(thin?.message).toContain("2 nested elements with no edge joining them");
    } finally {
      await p.destroy();
    }
  });
});

describe("a container whose title happens to name another service", () => {
  /**
   * A map that binds BY TITLE — no `metadata { service }` anywhere — which is
   * what every docs repo written before the binding existed relies on, and what
   * makes `serviceResolver`'s second rung the deciding one.
   */
  const TITLE_MAP = `specification {
  element softwareSystem
  element container
  element database
}

model {
  svcA = softwareSystem 'svc-a'
  db = softwareSystem 'db'

  svcA -> db 'Reads'
}

views {
  view landscape {
    include *
  }
}
`;

  /** svc-a's own store, named `db` — a word the fleet also uses for a service. */
  const OWN_MODEL = `model {
  extend svcA {
    api = container 'api'
    store = database 'db'
  }

  svcA.api -> db 'Reads'
}
`;

  const bareSpec = (id: string): string => `---\nservice: ${id}\nstatus: draft\n---\n\n# ${id}\n`;

  // Catches: a child written INSIDE the author's own `extend` block being
  // ejected from their slice by its TITLE. The resolver's second rung answers
  // with the nearest ancestor whose title names a real `services/<id>/`, and it
  // sees the child before the parent — so `store = database 'db'` resolved to
  // the service `db`, and svc-a was told its own store is somebody else's
  // internals, counted one element short, with its `Covers:` line convicted as
  // a typo. A standalone model was never filtered against its own file, so all
  // three are regressions of the second shape.
  it("stays in its author's own slice: counted, not unowned, and its Covers: line resolves", async () => {
    const p = await makeProject({
      "architecture/landscape.likec4": TITLE_MAP,
      "services/svc-a/model.likec4": OWN_MODEL,
      "services/svc-a/spec.md": bareSpec("svc-a"),
      "services/svc-a/arch.spec.md": archSpec("svc-a", "svcA.store"),
      "services/db/spec.md": bareSpec("db"),
    });
    try {
      const res = await runLoam(p.workDir, "validate", "--service", "svc-a", "--json");
      const [valid] = codeFor(res.stdout, "c4.valid");
      // own = svcA, its api and its store; partner = the `db` system its own
      // edge reaches. Three of those four are the ones the ejection lost.
      expect(valid?.message).toBe("svc-a: C4 model valid (extends the fleet map — 4 elements · 1 relationships)");
      expect(codeFor(res.stdout, "c4.element-unowned")).toEqual([]);
      expect(codeFor(res.stdout, "covers.unknown")).toEqual([]);
    } finally {
      await p.destroy();
    }
  });
});

describe("what an extending model gets wrong", () => {
  // Catches: a kind the map does not declare read as anything but this model's
  // own parse error — measured at the 1.59.2 pin as ONE error on the model.
  it("an undeclared kind is c4.invalid, naming model.likec4 and a line", async () => {
    const p = await project({ [`${DIR}/model.likec4`]: "model {\n  extend paymentService {\n    db = database 'Ledger'\n  }\n}\n" });
    try {
      const res = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      const [invalid] = codeFor(res.stdout, "c4.invalid");
      expect(invalid?.severity).toBe("error");
      expect(codeFor(res.stdout, "c4.valid")).toEqual([]);
      expect(invalid?.details?.join("\n")).toMatch(/services\/payment-service\/model\.likec4 L\d+:/);
    } finally {
      await p.destroy();
    }
  });

  // Catches: an `extend` of an id the map does not declare passing silently —
  // the placeholder case (`extend x {}` is legal) must not swallow a typo'd id.
  it("extending an element the map does not declare is c4.invalid", async () => {
    const p = await project({ [`${DIR}/model.likec4`]: "model {\n  extend paymentServiceTypo {\n    api = container 'api'\n  }\n}\n" });
    try {
      const res = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      expect(codeFor(res.stdout, "c4.invalid")).toHaveLength(1);
      expect(codeFor(res.stdout, "c4.valid")).toEqual([]);
    } finally {
      await p.destroy();
    }
  });

  // Catches: an element declared outside the service's own going ungraded —
  // both directions, since each has a different right home.
  it("c4.element-unowned names a new top-level element and a child under another service's", async () => {
    const p = await project({
      [`${DIR}/model.likec4`]:
        "model {\n  ledger = softwareSystem 'Ledger'\n  extend paymentService {\n    api = container 'api'\n  }\n" +
        "  extend checkoutWeb {\n    spa = container 'spa'\n  }\n}\n",
    });
    try {
      const res = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      const unowned = codeFor(res.stdout, "c4.element-unowned");
      expect(unowned.map((f) => f.severity)).toEqual(["warn", "warn"]);
      expect(unowned.every((f) => f.subject === SVC)).toBe(true);
      const messages = unowned.map((f) => f.message).join("\n");
      expect(messages).toContain("declares 'ledger' (softwareSystem) outside this service's own element");
      expect(messages).toContain("declares 'checkoutWeb.spa' (container) outside this service's own element");
      expect(messages).toContain("architecture/landscape.likec4");
      // The model still parses, so the shape grade stands beside the warnings.
      expect(codeFor(res.stdout, "c4.valid")).toHaveLength(1);
    } finally {
      await p.destroy();
    }
  });

  // Catches: an extending model graded `c4.valid (0 elements · 0 relationships)`
  // when the map binds nothing to its directory — a file full of architecture
  // reported as an empty one.
  it("no element resolving to the service is one landscape.service-unmodelled on the SERVICE target", async () => {
    const p = await makeProject({
      ...fixture(),
      "architecture/landscape.likec4": MAP.replace("    metadata { service 'payment-service' }\n", "")
        .replace("  paymentService = softwareSystem 'payment-service' {", "  paymentService = softwareSystem 'billing' {"),
      [`${DIR}/model.likec4`]: "model {\n  extend paymentService {\n    api = container 'api'\n  }\n}\n",
    });
    try {
      const res = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      const unmodelled = codeFor(res.stdout, "landscape.service-unmodelled");
      expect(unmodelled).toHaveLength(1);
      expect(unmodelled[0]?.severity).toBe("error");
      expect(unmodelled[0]?.subject).toBe(SVC);
      expect(unmodelled[0]?.message).toContain(`no element in architecture/landscape.likec4 resolves to ${DIR}/`);
      // Neither grade may be claimed about a model nothing could be read into.
      expect(codeFor(res.stdout, "c4.valid")).toEqual([]);
      expect(codeFor(res.stdout, "c4.element-unowned")).toEqual([]);
    } finally {
      await p.destroy();
    }
  });
});

describe("a map that does not parse takes the model with it", () => {
  const BROKEN = "views {\n  dynamic view uc_bad {\n    title 'Bad'\n    nosuch -> alsonosuch 'x'\n  }\n}\n";

  // Catches: `c4.invalid` blaming a service for a document it does not own, a
  // `c4.valid` claimed over a model nobody read, and — under `--service` — the
  // whole class going silent, which is what reading `landscape.likec4` alone
  // used to do.
  it.each([
    ["--service", ["validate", "--service", SVC, "--json"]],
    ["--all", ["validate", "--all", "--json"]],
  ])("%s: no c4.* grade, and spine.landscape-invalid says the model went unread", async (_mode, args) => {
    const p = await project({ "architecture/usecases/bad.likec4": BROKEN });
    try {
      const res = await runLoam(p.workDir, ...args);
      const mine = findings(res.stdout).filter((f) => f.subject === SVC || f.code.startsWith("c4."));
      expect(mine.filter((f) => f.code === "c4.valid" || f.code === "c4.invalid")).toEqual([]);
      const [spine] = codeFor(res.stdout, "spine.landscape-invalid");
      expect(spine?.message).toContain("and model.likec4 extends it, so the model cannot be read either");
    } finally {
      await p.destroy();
    }
  });

  // Catches: `covers.unknown` cascading out of a document nobody could read.
  // An extending model whose map does not parse comes back with no elements,
  // and the landscape half of the `Covers:` scope is empty for the very same
  // reason — so every `Covers:` line of every migrated service resolved to
  // nothing. One unparseable `architecture/usecases/*.likec4` produced
  // services × Covers-lines warnings, under the code whose whole job is to
  // catch a typo.
  it("no covers.unknown from any service: nothing may be graded out of a map nobody could read", async () => {
    const p = await project({
      "architecture/usecases/bad.likec4": BROKEN,
      [`${DIR}/arch.spec.md`]: archSpec(SVC, "paymentService.api"),
      "services/checkout-web/arch.spec.md": archSpec("checkout-web", "checkoutWeb"),
    });
    try {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      // The two findings that ARE owed, so the silence above is a verdict
      // rather than a run that graded nothing: the map's own parse error once,
      // and the per-service sentence saying the model went unread with it.
      expect(codeFor(res.stdout, "landscape.invalid")).toHaveLength(1);
      expect(codeFor(res.stdout, "spine.landscape-invalid")).toHaveLength(2);
      expect(codeFor(res.stdout, "covers.unknown")).toEqual([]);
    } finally {
      await p.destroy();
    }
  });

  // The control, and it is what keeps the suspension honest: a STANDALONE model
  // is parsed alone, so a broken map costs it nothing it could have resolved —
  // and a `Covers:` line naming an element only the map declares is exactly as
  // unresolved as it has always been.
  it("a standalone model keeps today's covers.unknown when the map does not parse", async () => {
    const p = await project({
      "architecture/usecases/bad.likec4": BROKEN,
      [`${DIR}/model.likec4`]:
        "specification {\n  element softwareSystem\n  element container\n}\n\n" +
        "model {\n  paymentService = softwareSystem 'payment-service' {\n" +
        "    metadata { service 'payment-service' }\n    api = container 'api'\n  }\n}\n",
      [`${DIR}/arch.spec.md`]: archSpec(SVC, "kafka"),
    });
    try {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      const unknown = codeFor(res.stdout, "covers.unknown");
      expect(unknown).toHaveLength(1);
      expect(unknown[0]?.subject).toBe(SVC);
      expect(unknown[0]?.message).toContain("Covers: 'kafka' resolves to nothing");
    } finally {
      await p.destroy();
    }
  });
});

describe("the fleet checks that read a model read this one", () => {
  // Catches: `attestedCalls` reading the model as a lone file — every migrated
  // service would attest nothing, and this whole check would go quiet fleet-wide
  // without a word.
  it("landscape.service-isolated fires for an extending model whose element no map edge touches", async () => {
    const map = MAP.replace(
      "  kafka = softwareSystem 'Kafka' {",
      "  ledgerService = softwareSystem 'ledger-service' {\n    metadata { service 'ledger-service' }\n  }\n  kafka = softwareSystem 'Kafka' {",
    );
    const p = await makeProject({
      ...fixture(),
      "architecture/landscape.likec4": map,
      "services/ledger-service/spec.md": "---\nservice: ledger-service\nstatus: draft\n---\n\n# ledger-service\n",
      "services/ledger-service/model.likec4":
        "model {\n  extend ledgerService {\n    api = container 'api'\n  }\n  ledgerService.api -> paymentService 'Calls authorize'\n}\n",
    });
    try {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      const isolated = codeFor(res.stdout, "landscape.service-isolated");
      expect(isolated.map((f) => f.subject)).toEqual(["ledger-service"]);
      expect(isolated[0]?.message).toContain("declares 1 call(s) across its boundary");
    } finally {
      await p.destroy();
    }
  });

  // Catches: a service flow beside an extending model staged in the SERVICE
  // directory, where a hop naming the map's element cannot resolve at all — and
  // a `sourcePath` left docs-relative, which would name the file twice over.
  it("a sibling flow is graded, and the finding names it relative to the service directory", async () => {
    const p = await project({
      [`${DIR}/usecases/pay.likec4`]:
        "views {\n  dynamic view uc_pay {\n    #req-PAY\n    title 'Authorize'\n" +
        "    paymentService.api -> kafka.orderEvents 'Publishes'\n" +
        "    paymentService.api -> checkoutWeb 'Calls back'\n  }\n}\n",
      [`${DIR}/arch.spec.md`]:
        "---\nservice: payment-service\nstatus: draft\n---\n\n# payment-service — architecture\n\n" +
        "## Requirements\n\n### Requirement: Publishing\nRequirement-ID: PAY\nThe service SHALL publish.\n\n" +
        "#### Scenario: One event\n- **Given** an authorization\n- **When** it commits\n- **Then** one event is published\n",
    });
    try {
      const res = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      const unbacked = codeFor(res.stdout, "usecase.step-unbacked");
      expect(unbacked).toHaveLength(1);
      expect(unbacked[0]?.message).toContain(`${SVC}: ${DIR}/usecases/pay.likec4 — dynamic view 'uc_pay'`);
      // The FLEET's own use cases live in the same project and belong to nobody
      // here: a service must never be graded for one.
      expect(unbacked[0]?.message).not.toContain("architecture/");
    } finally {
      await p.destroy();
    }
  });
});

describe("a service-local flow is graded the same wherever it is written", () => {
  /** One hop, and it is an edge the FLEET MAP draws — the case the two arms disagreed about. */
  const VIEW = `views {
  dynamic view uc_pay {
    #req-PAY
    title 'Authorize'
    checkoutWeb -> paymentService 'Calls authorizePayment'
  }
}
`;

  const ARCH =
    "---\nservice: payment-service\nstatus: draft\n---\n\n# payment-service — architecture\n\n" +
    "## Requirements\n\n### Requirement: Publishing\nRequirement-ID: PAY\nThe service SHALL publish.\n\n" +
    "#### Scenario: One event\n- **Given** an authorization\n- **When** it commits\n- **Then** one event is published\n";

  // Catches: the no-sibling arm grading a view against the service's own SLICE
  // while the sibling arm grades the same view against the whole per-service
  // project. `checkoutWeb -> paymentService` is the map's edge, so it is in the
  // project and not in the slice — and a hop backed by it was
  // `usecase.step-unbacked` (an error, exit 1) in model.likec4 and clean the
  // moment the identical view moved one file over. One question, two answers,
  // decided by where the author happened to type it.
  it.each([
    ["inside model.likec4", (): Record<string, string> => ({ [`${DIR}/model.likec4`]: `${EXTENDING}\n${VIEW}` })],
    ["in a sibling usecases/ file", (): Record<string, string> => ({ [`${DIR}/usecases/pay.likec4`]: VIEW })],
  ])("%s: the map's own edge backs the hop", async (_where, files) => {
    const p = await project({ [`${DIR}/arch.spec.md`]: ARCH, ...files() });
    try {
      const res = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      expect(codeFor(res.stdout, "usecase.step-unbacked")).toEqual([]);
      expect(codeFor(res.stdout, "usecase.flow-invalid")).toEqual([]);
      expect(res.code).toBe(0);
    } finally {
      await p.destroy();
    }
  });

  // The control, because a backed hop earns no finding at all and a silence
  // that cannot break is not a verdict: with the map's edge deleted, the very
  // same view in the very same file must report exactly one unbacked hop.
  it.each([
    ["inside model.likec4", (): Record<string, string> => ({ [`${DIR}/model.likec4`]: `${EXTENDING}\n${VIEW}` })],
    ["in a sibling usecases/ file", (): Record<string, string> => ({ [`${DIR}/usecases/pay.likec4`]: VIEW })],
  ])("%s: and the same hop IS reported once the map draws no such edge", async (_where, files) => {
    const p = await makeProject({
      ...fixture({ [`${DIR}/arch.spec.md`]: ARCH, ...files() }),
      "architecture/landscape.likec4": MAP.replace(
        "  checkoutWeb -> paymentService 'Calls authorizePayment' {\n    metadata { op 'authorizePayment' }\n  }\n",
        "",
      ),
    });
    try {
      const res = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      const unbacked = codeFor(res.stdout, "usecase.step-unbacked");
      expect(unbacked).toHaveLength(1);
      expect(unbacked[0]?.message).toContain("dynamic view 'uc_pay'");
    } finally {
      await p.destroy();
    }
  });
});

describe("every other reader of model.likec4 goes through the same door", () => {
  // Catches: `loam show` opening the file alone. An extending model read that
  // way is a screenful of parse errors for a document that is perfectly valid
  // where it is read — on the screen a person opens to find out what a service
  // holds.
  it("loam show reports the own slice, not a pile of parse errors", async () => {
    const p = await project();
    try {
      const res = await runLoam(p.workDir, "show", SVC, "--json");
      expect(res.code).toBe(0);
      const shown = JSON.parse(res.stdout) as { model: { elements: number; relationships: number; errors: string[] } };
      expect(shown.model).toEqual({ elements: 4, relationships: 1, errors: [] });
    } finally {
      await p.destroy();
    }
  });

  // Catches: the adopt brief reading the model alone. The edgeless instruction
  // states what that file ATTESTS, so a model it could not read would have the
  // brief tell every migrated service that its map owes nothing.
  it("the adopt brief names the calls an extending model attests", async () => {
    const map = MAP.replace(
      "  kafka = softwareSystem 'Kafka' {",
      "  ledgerService = softwareSystem 'ledger-service' {\n    metadata { service 'ledger-service' }\n  }\n  kafka = softwareSystem 'Kafka' {",
    );
    const p = await makeProject({
      ...fixture(),
      "architecture/landscape.likec4": map,
      "services/ledger-service/spec.md": "---\nservice: ledger-service\nstatus: draft\n---\n\n# ledger-service\n",
      "services/ledger-service/model.likec4":
        "model {\n  extend ledgerService {\n    api = container 'api'\n  }\n  ledgerService.api -> paymentService 'Calls authorize'\n}\n",
    });
    try {
      const res = await runLoam(p.workDir, "adopt", "--service", "ledger-service", "--json");
      expect(res.code).toBe(0);
      const brief = JSON.parse(res.stdout) as { landscape: { touched: boolean; attested: Array<{ counterpart: string }> } };
      expect(brief.landscape.touched).toBe(false);
      expect(brief.landscape.attested.map((c) => c.counterpart)).toEqual(["payment-service"]);
    } finally {
      await p.destroy();
    }
  });

  // Catches: the feature target's `Covers:` widening reading the model alone.
  // A delta's arch requirement may legitimately cover a container the SERVICE
  // already declares, and the lazy second pass is where that is resolved — read
  // as a lone file, an extending model is parse errors, so every such line
  // would be convicted as a typo.
  it("a delta's Covers: resolves against a container the extending model declares", async () => {
    const p = await project({
      "features/FEAT-9-cover/intent.md": "---\nfeature: FEAT-9\nstatus: proposed\n---\n\n# Cover\n\nWrite to a ledger.\n",
      "features/FEAT-9-cover/delta.likec4":
        "specification {\n  element softwareSystem\n  tag FEAT-9\n}\n\nmodel {\n  paymentService = softwareSystem 'payment-service'\n" +
        "  ledger = softwareSystem 'ledger' {\n    #FEAT-9\n  }\n  paymentService -> ledger 'Writes' {\n    #FEAT-9\n  }\n}\n",
      "features/FEAT-9-cover/specs/payment-service/arch.spec.md":
        "# payment-service — architecture delta for FEAT-9\n\n## ADDED Requirements\n\n" +
        "### Requirement: The API writes to the ledger\nThe service SHALL write every authorization to the ledger.\n\n" +
        "Covers: paymentService.api, ledger\n\n#### Scenario: A write\n" +
        "- **Given** an authorization\n- **When** it commits\n- **Then** the ledger has a row\n",
    });
    try {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-9", "--json");
      expect(codeFor(res.stdout, "covers.unknown")).toEqual([]);
    } finally {
      await p.destroy();
    }
  });

  // Catches: the brief handing an agent `extend <fqn> {` verbatim. The example
  // is written to be copied, and the placeholder is filled in from the map that
  // was just read.
  it("the brief's model example names the element this service actually extends", async () => {
    const p = await project();
    try {
      const res = await runLoam(p.workDir, "adopt", "--service", SVC, "--json");
      const brief = JSON.parse(res.stdout) as { targets: Array<{ artifact: string; example?: string }> };
      const model = brief.targets.find((t) => t.artifact === "model.likec4");
      expect(model?.example).toContain("extend paymentService {");
      expect(model?.example).not.toContain("<fqn>");
    } finally {
      await p.destroy();
    }
  });
});

describe("--all and --service agree", () => {
  // Catches: the prefetch seeding a different answer from the per-service load
  // — a fleet gate whose verdict depends on which flag was passed.
  it("the service's findings are identical whichever mode graded them", async () => {
    const p = await project({ [`${DIR}/health.yaml`]: "dependencies:\n  - kafka\n" });
    try {
      const one = await runLoam(p.workDir, "validate", "--service", SVC, "--json");
      const all = await runLoam(p.workDir, "validate", "--all", "--json");
      const mine = (stdout: string): string[] =>
        (JSON.parse(stdout) as Payload).targets
          .filter((t) => t.kind === "service" && t.id === SVC)
          .flatMap((t) => t.findings.map((f) => `${f.code} ${f.message}`))
          .sort();
      // `spine.landscape-invalid` is the one message that legitimately differs
      // (`--all` reports the parser output once, on the landscape target), and
      // this fixture's map parses, so nothing here is exempt.
      expect(mine(all.stdout)).toEqual(mine(one.stdout));
    } finally {
      await p.destroy();
    }
  });
});
