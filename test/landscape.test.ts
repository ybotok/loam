/**
 * The landscape ↔ services/ cross-check (`loam validate --all`).
 *
 * Two lists claim to name the same fleet: the directories under `services/` and
 * the elements drawn in `architecture/landscape.likec4`. Nothing used to compare
 * them, so a service could exist undrawn and an element could be drawn with
 * nothing behind it, both in silence. On 100+ services that silence IS the drift.
 *
 * What this file pins:
 *  - a directory nobody drew is an ERROR (`landscape.service-unmodelled`) — the
 *    fleet map is incomplete, and every diagram derived from it is wrong;
 *  - an element with no directory is a WARNING (`landscape.service-undocumented`) —
 *    it may legitimately be someone else's system, which is what `#external` says;
 *  - an element whose EXPLICIT `metadata { service '<id>' }` names a directory that
 *    does not exist is an ERROR (`landscape.binding-unknown`): a binding is a claim,
 *    not a guess, so it is graded harder than a title that merely fails to match;
 *  - which element the binding resolves — explicit binding first, title second —
 *    so renaming a box in a diagram no longer silently unlinks it from its service.
 *
 * The cross-check is fleet-level: it needs every directory and every element in
 * view at once, so it runs under `--all` and reports as its own target.
 */
import { describe, expect, it } from "vitest";
import { makeProject, runLoam, type Project } from "./helpers/harness.js";

const SVC = "payment-service";

async function withProject(
  files: Record<string, string>,
  opts: { service?: string },
  fn: (p: Project) => Promise<void>,
): Promise<void> {
  const p = await makeProject(files, opts);
  // A realistic fleet has run `subsystem sync` at least once, and since
  // `architecture/services.likec4` exists (2026-09-07) an absent one is
  // `subsystem.views-stale` on every `--all` run. Without this line every
  // fixture here carries that error into assertions about the LANDSCAPE
  // target's findings, which is noise from a different check.
  await runLoam(p.workDir, "subsystem", "sync");
  try {
    await fn(p);
  } finally {
    await p.destroy();
  }
}

interface Finding {
  severity: "ok" | "warn" | "error";
  code: string;
  subject?: string;
  message: string;
}
interface Target {
  kind: string;
  id: string;
  valid: boolean;
  findings: Finding[];
}

/** Wrap a model body in a landscape document declaring the vocabulary loam's checks use. */
function landscape(body: string): string {
  return `specification {
  element softwareSystem
  element container
  element database
  element person
  tag external
  tag platform
}

model {
${body}
}

views {
  view landscape {
    include *
  }
}
`;
}

/** The smallest valid per-service C4 model — enough for the service target to pass. */
function serviceModel(svc: string): string {
  return `specification { element softwareSystem }

model {
  s = softwareSystem '${svc}'
}

views {
  view index {
    include *
  }
}
`;
}

/**
 * An EXTENDING model: no `specification` block, so it is parsed inside the
 * fleet's own project and its ids ARE the map's. That is what lets the consumer
 * census join a call this file draws to an element the landscape declares.
 */
function extendingModel(body: string): string {
  return `model {
${body}
}
`;
}

async function validateAll(p: Project): Promise<{ code: number; targets: Target[]; out: string }> {
  const res = await runLoam(p.workDir, "validate", "--all", "--json");
  const json = JSON.parse(res.stdout) as { targets: Target[] };
  return { code: res.code, targets: json.targets, out: res.out };
}

/** The fleet-level target, or undefined when the cross-check did not run. */
function landscapeTarget(targets: Target[]): Target | undefined {
  return targets.find((t) => t.kind === "landscape");
}

function codesIn(targets: Target[]): string[] {
  return targets.flatMap((t) => t.findings.map((f) => f.code));
}

/* ------------------------------------------------------------------ */
/* services/ -> landscape                                              */
/* ------------------------------------------------------------------ */

describe("a service directory that nothing in the landscape draws", () => {
  it("is an error that names the service", async () => {
    const files = {
      "architecture/landscape.likec4": landscape(`  paymentService = softwareSystem '${SVC}'`),
      [`services/${SVC}/model.likec4`]: serviceModel(SVC),
      "services/ghost-service/model.likec4": serviceModel("ghost-service"),
    };
    await withProject(files, {}, async (p) => {
      const { code, targets } = await validateAll(p);
      expect(code).toBe(1);
      const f = landscapeTarget(targets)!.findings.find((x) => x.code === "landscape.service-unmodelled")!;
      expect(f.severity).toBe("error");
      expect(f.subject).toBe("ghost-service");
      expect(f.message).toContain("ghost-service");
    });
  });

  it("counts as drawn when an element's title matches it — every existing docs repo relies on that", async () => {
    const files = {
      "architecture/landscape.likec4": landscape(`  paymentService = softwareSystem '${SVC}'`),
      [`services/${SVC}/model.likec4`]: serviceModel(SVC),
    };
    await withProject(files, {}, async (p) => {
      const { code, targets } = await validateAll(p);
      expect(code).toBe(0);
      expect(codesIn(targets)).not.toContain("landscape.service-unmodelled");
    });
  });

  it("counts as drawn when an element BINDS to it, however the box is titled", async () => {
    // The point of the binding: renaming the box in the diagram must not unlink it.
    const files = {
      "architecture/landscape.likec4": landscape(`  payments = softwareSystem 'Payments API' {
    metadata { service '${SVC}' }
  }`),
      [`services/${SVC}/model.likec4`]: serviceModel(SVC),
    };
    await withProject(files, {}, async (p) => {
      const { code, targets } = await validateAll(p);
      expect(code).toBe(0);
      expect(codesIn(targets)).not.toContain("landscape.service-unmodelled");
      expect(codesIn(targets)).not.toContain("landscape.service-undocumented");
    });
  });
});

/* ------------------------------------------------------------------ */
/* landscape -> services/                                              */
/* ------------------------------------------------------------------ */

describe("a landscape element with no service directory", () => {
  it("warns without gating — it may be someone else's system, which is a judgement call", async () => {
    const files = {
      "architecture/landscape.likec4": landscape(`  paymentService = softwareSystem '${SVC}'
  reporting = softwareSystem 'reporting-service'`),
      [`services/${SVC}/model.likec4`]: serviceModel(SVC),
    };
    await withProject(files, {}, async (p) => {
      const { code, targets } = await validateAll(p);
      expect(code).toBe(0);
      const f = landscapeTarget(targets)!.findings.find((x) => x.code === "landscape.service-undocumented")!;
      expect(f.severity).toBe("warn");
      expect(f.subject).toBe("reporting-service");
    });
  });

  it("says nothing about an element tagged #external — kafka is not ours to document", async () => {
    const files = {
      "architecture/landscape.likec4": landscape(`  paymentService = softwareSystem '${SVC}'
  kafka = softwareSystem 'kafka' {
    #external
  }`),
      [`services/${SVC}/model.likec4`]: serviceModel(SVC),
    };
    await withProject(files, {}, async (p) => {
      const { code, targets } = await validateAll(p);
      expect(code).toBe(0);
      expect(codesIn(targets)).not.toContain("landscape.service-undocumented");
    });
  });

  /**
   * The fact the topic-per-channel convention rests on, pinned because the
   * convention is documented in three places (the adopt brief's unchecked list,
   * AGENTS.md, SCHEMA.md) and all three would become wrong together if this
   * moved.
   *
   * `#external` on the broker does NOT reach the topics nested inside it —
   * LikeC4 has no tag inheritance, and `drawn` only skips descendants of an
   * element that stands for a SERVICE, which an external broker by definition
   * does not. So a fleet that splits its broker into topics to keep the map
   * readable gets one warning per topic asking for a services/ directory nobody
   * owes, unless the tag is carried by the KIND.
   */
  it("still asks about a topic nested in an #external broker — LikeC4 inherits no tags", async () => {
    const files = {
      "architecture/landscape.likec4": landscape(`  paymentService = softwareSystem '${SVC}'
  kafka = softwareSystem 'kafka' {
    #external
    paymentEvents = container 'payment.events'
  }`),
      [`services/${SVC}/model.likec4`]: serviceModel(SVC),
    };
    await withProject(files, {}, async (p) => {
      const { code, targets } = await validateAll(p);
      expect(code).toBe(0);
      const f = landscapeTarget(targets)!.findings.find((x) => x.code === "landscape.service-undocumented")!;
      expect(f.subject).toBe("payment.events");
    });
  });

  it("is silent when the topic KIND carries the tag — the one spelling that scales", async () => {
    const files = {
      "architecture/landscape.likec4": `specification {
  element softwareSystem
  element topic {
    #external
    style {
      shape queue
    }
  }
  tag external
}

model {
  paymentService = softwareSystem '${SVC}'
  kafka = softwareSystem 'kafka' {
    #external
    paymentEvents = topic 'payment.events'
    orderEvents = topic 'order.events'
  }

  paymentService -> kafka.paymentEvents 'Publishes'
}
`,
      [`services/${SVC}/model.likec4`]: serviceModel(SVC),
    };
    await withProject(files, {}, async (p) => {
      const { code, targets } = await validateAll(p);
      expect(code).toBe(0);
      expect(codesIn(targets)).not.toContain("landscape.service-undocumented");
      // And the edge into the topic still resolves as an edge into the fleet:
      // the service side of it is modelled, so nothing reads as unmapped.
      expect(codesIn(targets)).not.toContain("landscape.service-unmodelled");
    });
  });

  it("says nothing about a person — an actor is never a service directory", async () => {
    const files = {
      "architecture/landscape.likec4": landscape(`  customer = person 'Customer'
  paymentService = softwareSystem '${SVC}'`),
      [`services/${SVC}/model.likec4`]: serviceModel(SVC),
    };
    await withProject(files, {}, async (p) => {
      const { code, targets } = await validateAll(p);
      expect(code).toBe(0);
      expect(codesIn(targets)).not.toContain("landscape.service-undocumented");
    });
  });

  it("says nothing about a container nested in a system — services are top-level", async () => {
    const files = {
      "architecture/landscape.likec4": landscape(`  paymentService = softwareSystem '${SVC}' {
    api = container 'api'
  }`),
      [`services/${SVC}/model.likec4`]: serviceModel(SVC),
    };
    await withProject(files, {}, async (p) => {
      const { code, targets } = await validateAll(p);
      expect(code).toBe(0);
      expect(codesIn(targets)).not.toContain("landscape.service-undocumented");
    });
  });
});

/* ------------------------------------------------------------------ */
/* Explicit bindings are claims, not guesses                           */
/* ------------------------------------------------------------------ */

describe("an explicit binding that names nothing", () => {
  it("is an error, unlike a title that merely fails to match", async () => {
    const files = {
      "architecture/landscape.likec4": landscape(`  payments = softwareSystem 'Payments API' {
    metadata { service 'no-such-service' }
  }`),
      // A real (if empty) services/ — an ABSENT one is now a refusal, not a fleet of zero.
      "services/.keep": "",
    };
    await withProject(files, {}, async (p) => {
      const { code, targets } = await validateAll(p);
      expect(code).toBe(1);
      const f = landscapeTarget(targets)!.findings.find((x) => x.code === "landscape.binding-unknown")!;
      expect(f.severity).toBe("error");
      expect(f.subject).toBe("no-such-service");
      expect(f.message).toContain("Payments API");
    });
  });

  it("is reported once — a broken binding is never also an undocumented element", async () => {
    const files = {
      "architecture/landscape.likec4": landscape(`  payments = softwareSystem 'Payments API' {
    metadata { service 'no-such-service' }
  }`),
      "services/.keep": "",
    };
    await withProject(files, {}, async (p) => {
      const { targets } = await validateAll(p);
      expect(codesIn(targets)).not.toContain("landscape.service-undocumented");
    });
  });
});

/* ------------------------------------------------------------------ */
/* When the cross-check runs, and when it cannot                       */
/* ------------------------------------------------------------------ */

describe("scope and preconditions", () => {
  it("reports agreement as its own ok finding when both lists match", async () => {
    const files = {
      "architecture/landscape.likec4": landscape(`  paymentService = softwareSystem '${SVC}'`),
      [`services/${SVC}/model.likec4`]: serviceModel(SVC),
    };
    await withProject(files, {}, async (p) => {
      const { code, targets } = await validateAll(p);
      expect(code).toBe(0);
      const t = landscapeTarget(targets)!;
      expect(t.valid).toBe(true);
      expect(t.findings.map((f) => f.code)).toEqual(["landscape.matched"]);
    });
  });

  it("is fleet-level: validating one service does not run it (it cannot see the other side)", async () => {
    const files = {
      "architecture/landscape.likec4": landscape(`  paymentService = softwareSystem '${SVC}'
  reporting = softwareSystem 'reporting-service'`),
      [`services/${SVC}/model.likec4`]: serviceModel(SVC),
      "services/ghost-service/model.likec4": serviceModel("ghost-service"),
    };
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--json");
      expect(res.code).toBe(0);
      const json = JSON.parse(res.stdout) as { targets: Target[] };
      expect(landscapeTarget(json.targets)).toBeUndefined();
      expect(codesIn(json.targets).filter((c) => c.startsWith("landscape."))).toEqual([]);
    });
  });

  it("says the cross-check is impossible when the landscape does not parse, instead of passing silently", async () => {
    const files = {
      "architecture/landscape.likec4": `specification {\n  element softwareSystem\n}\n\nmodel {\n  a = bogusKind 'a'\n}\n`,
      [`services/${SVC}/model.likec4`]: serviceModel(SVC),
    };
    await withProject(files, {}, async (p) => {
      const { code, targets } = await validateAll(p);
      expect(code).toBe(1);
      const f = landscapeTarget(targets)!.findings.find((x) => x.code === "landscape.invalid")!;
      expect(f.severity).toBe("error");
      // and it must NOT invent unmodelled services out of a document it could not read
      expect(codesIn(targets)).not.toContain("landscape.service-unmodelled");
    });
  });

  it("names every broken document, and the verb agrees with the LIST — as the service arm's does", async () => {
    // `landscape.invalid`'s head is `<named> <verb> N error(s)`, and `named` is
    // a comma-joined series once two of the project's documents broke. It said
    // "has" unconditionally, so a two-document run read "a, b has 4 error(s)"
    // on the fleet line and "a, b have 4 error(s)" on the service line right
    // under it — one report, two spellings of one fact (`service/spine.ts`
    // picked its verb off the same list a round earlier).
    const broken = `model {\n  x = \n}\n`;
    const files = {
      "architecture/landscape.likec4": landscape(`  paymentService = softwareSystem '${SVC}'`),
      "architecture/palette.likec4": broken,
      "architecture/usecases/flow.likec4": broken,
      [`services/${SVC}/model.likec4`]: serviceModel(SVC),
    };
    await withProject(files, {}, async (p) => {
      const { code, targets } = await validateAll(p);
      expect(code).toBe(1);
      const f = landscapeTarget(targets)!.findings.find((x) => x.code === "landscape.invalid")!;
      expect(f.message).toMatch(
        /^landscape: architecture\/palette\.likec4, architecture\/usecases\/flow\.likec4 have \d+ error\(s\)/,
      );
      // Byte-compatible with the arm that files the same fact on the service.
      const spine = targets
        .flatMap((t) => t.findings)
        .find((x) => x.code === "spine.landscape-invalid")!;
      expect(spine.message).toContain(
        "architecture/palette.likec4, architecture/usecases/flow.likec4 have",
      );
    });
  });

  it("one broken document keeps the singular", async () => {
    // The other half of the same rule: a one-document series must not read
    // "architecture/palette.likec4 have 1 error(s)".
    const files = {
      "architecture/landscape.likec4": landscape(`  paymentService = softwareSystem '${SVC}'`),
      "architecture/palette.likec4": `model {\n  x = \n}\n`,
      [`services/${SVC}/model.likec4`]: serviceModel(SVC),
    };
    await withProject(files, {}, async (p) => {
      const { targets } = await validateAll(p);
      const f = landscapeTarget(targets)!.findings.find((x) => x.code === "landscape.invalid")!;
      expect(f.message).toMatch(/^landscape: architecture\/palette\.likec4 has \d+ error\(s\)/);
    });
  });

  it("grades an ABSENT landscape as a finding, not a skipped check", async () => {
    // The whole point of the cross-check is that the fleet map exists. Returning
    // no target at all meant a docs repo with NO map validated green — the one
    // shape of drift that hides every other one.
    await withProject({ [`services/${SVC}/model.likec4`]: serviceModel(SVC) }, {}, async (p) => {
      const { code, targets } = await validateAll(p);
      expect(code).toBe(1);
      const f = landscapeTarget(targets)!.findings.find((x) => x.code === "landscape.missing")!;
      expect(f.severity).toBe("error");
      expect(f.message).toContain("architecture/landscape.likec4");
    });
  });

  it("downgrades the absence to a warning when services/ is empty — nothing to draw yet", async () => {
    await withProject({ "services/.keep": "" }, {}, async (p) => {
      const { code, targets } = await validateAll(p);
      expect(code).toBe(0);
      const f = landscapeTarget(targets)!.findings.find((x) => x.code === "landscape.missing")!;
      expect(f.severity).toBe("warn");
    });
  });

  it("prints the fleet-level findings in the human view too, not only in --json", async () => {
    const files = {
      "architecture/landscape.likec4": landscape(`  paymentService = softwareSystem '${SVC}'`),
      [`services/${SVC}/model.likec4`]: serviceModel(SVC),
      "services/ghost-service/model.likec4": serviceModel("ghost-service"),
    };
    await withProject(files, {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--all");
      expect(res.code).toBe(1);
      const line = res.out.split("\n").find((l) => l.includes("ghost-service") && l.includes("landscape"));
      expect(line).toBeDefined();
      expect(line).toContain("✗");
    });
  });
});

/* ------------------------------------------------------------------ */
/* The binding drives every check that used to match on the title      */
/* ------------------------------------------------------------------ */

describe("resolution order: explicit binding first, title second", () => {
  /** A landscape whose payment box is titled 'Payments API' and bound to payment-service. */
  const RENAMED = landscape(`  checkoutWeb = softwareSystem 'checkout-web'
  payments = softwareSystem 'Payments API' {
    metadata { service '${SVC}' }
  }

  checkoutWeb -> payments 'Calls authorizePayment' {
    metadata { op 'authorizePayment' }
  }`);

  const OPENAPI = `openapi: 3.1.0
info:
  title: ${SVC}
  version: "1.0"
paths:
  /payments/authorize:
    post:
      operationId: authorizePayment
      responses:
        "200":
          description: Authorized
`;

  it("the landscape spine still finds inbound edges after the box is renamed", async () => {
    // Before the binding existed this check matched element.title against the
    // directory name: renaming the box made the spine quietly check nothing.
    const files = {
      "architecture/landscape.likec4": RENAMED,
      [`services/${SVC}/model.likec4`]: serviceModel(SVC),
      [`services/${SVC}/openapi.yaml`]: OPENAPI,
    };
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--json");
      const json = JSON.parse(res.stdout) as { targets: Target[] };
      expect(json.targets[0]!.findings.map((f) => f.code)).toContain("spine.resolved");
    });
  });

  it("a renamed box calling an operation the service does not expose is still caught", async () => {
    const files = {
      "architecture/landscape.likec4": RENAMED.replace("op 'authorizePayment'", "op 'chargeCard'"),
      [`services/${SVC}/model.likec4`]: serviceModel(SVC),
      [`services/${SVC}/openapi.yaml`]: OPENAPI,
    };
    await withProject(files, { service: SVC }, async (p) => {
      const res = await runLoam(p.workDir, "validate");
      expect(res.code).toBe(1);
      expect(res.out).toContain("chargeCard");
    });
  });

  it("`loam show` files the edge under the bound service id, not the drawn title", async () => {
    const files = {
      "architecture/landscape.likec4": RENAMED,
      [`services/${SVC}/model.likec4`]: serviceModel(SVC),
      "services/checkout-web/model.likec4": serviceModel("checkout-web"),
    };
    await withProject(files, {}, async (p) => {
      const res = await runLoam(p.workDir, "show", "checkout-web", "--json");
      const json = JSON.parse(res.stdout) as { landscape: { outbound: { service: string }[] } };
      expect(json.landscape.outbound.map((e) => e.service)).toEqual([SVC]);
    });
  });
});

/* ------------------------------------------------------------------ */
/* fleet shape: platform candidates and datastores                     */
/* ------------------------------------------------------------------ */

function threeServices(): Record<string, string> {
  return {
    "services/svc-a/model.likec4": serviceModel("svc-a"),
    "services/svc-b/model.likec4": serviceModel("svc-b"),
    "services/svc-c/model.likec4": serviceModel("svc-c"),
  };
}

describe("an external hub every service leans on", () => {
  it("warns landscape.platform-candidate at three distinct consumers — one via a nested child", async () => {
    const files = {
      "architecture/landscape.likec4": landscape(`  svcA = softwareSystem 'svc-a'
  svcB = softwareSystem 'svc-b'
  svcC = softwareSystem 'svc-c'
  identityProvider = softwareSystem 'Identity Provider' {
    #external
    tokens = container 'token store'
  }
  svcA -> identityProvider 'authenticates'
  svcB -> identityProvider 'authenticates'
  svcC -> identityProvider.tokens 'introspects'`),
      ...threeServices(),
    };
    await withProject(files, {}, async (p) => {
      const { code, targets } = await validateAll(p);
      expect(code).toBe(0);
      const t = landscapeTarget(targets)!;
      const f = t.findings.find((x) => x.code === "landscape.platform-candidate")!;
      expect(f.severity).toBe("warn");
      expect(f.subject).toBe("Identity Provider");
      expect(f.message).toContain("tag platform");
      // Distinct consumers, sorted — and the edge into
      // `identityProvider.tokens` counted for `identityProvider`, or svc-c
      // would be missing and the threshold never met.
      expect(f.message).toContain("svc-a, svc-b, svc-c");
      // A map with a shape warning did not fully agree.
      expect(t.findings.map((x) => x.code)).not.toContain("landscape.matched");
    });
  });

  it("counts services, not edges — two edges from one service are one consumer", async () => {
    const files = {
      "architecture/landscape.likec4": landscape(`  svcA = softwareSystem 'svc-a'
  svcB = softwareSystem 'svc-b'
  visitor = person 'Visitor'
  identityProvider = softwareSystem 'Identity Provider' {
    #external
    tokens = container 'token store'
  }
  svcA -> identityProvider 'authenticates'
  svcA -> identityProvider.tokens 'introspects'
  svcB -> identityProvider 'authenticates'
  visitor -> identityProvider 'signs in'`),
      "services/svc-a/model.likec4": serviceModel("svc-a"),
      "services/svc-b/model.likec4": serviceModel("svc-b"),
    };
    await withProject(files, {}, async (p) => {
      const { targets } = await validateAll(p);
      // Two distinct services (the person never counts): below the threshold.
      expect(codesIn(targets)).not.toContain("landscape.platform-candidate");
    });
  });

  it("is silenced by #platform — the tag IS the fix", async () => {
    const files = {
      "architecture/landscape.likec4": landscape(`  svcA = softwareSystem 'svc-a'
  svcB = softwareSystem 'svc-b'
  svcC = softwareSystem 'svc-c'
  identityProvider = softwareSystem 'Identity Provider' {
    #external
    #platform
  }
  svcA -> identityProvider 'authenticates'
  svcB -> identityProvider 'authenticates'
  svcC -> identityProvider 'authenticates'`),
      ...threeServices(),
    };
    await withProject(files, {}, async (p) => {
      const { targets } = await validateAll(p);
      const t = landscapeTarget(targets)!;
      expect(t.findings.map((x) => x.code)).not.toContain("landscape.platform-candidate");
      expect(t.findings.map((x) => x.code)).toContain("landscape.matched");
    });
  });
});

/**
 * Infrastructure the fleet OWNS, drawn at fleet level.
 *
 * The stance this block encodes changed on 2026-09-07 and the old one is worth
 * naming, because every fixture below used to be built around it: a `database`
 * with one consumer at fleet level was `landscape.datastore-private`, whose
 * whole message prescribed deleting the peer and nesting the store inside its
 * owner. WHERE A STORE IS DRAWN IS NOW THE TEAM'S CHOICE — nested and peer are
 * both first-class, loam grades neither — so that code is retired and this
 * block pins the criterion that replaced it.
 *
 * The criterion, and it is absolute: a `database` drawn at fleet level, owned by
 * the fleet (no `#external`, no `metadata { service }`), consumed by exactly one
 * service, earns ZERO findings from `loam validate --all` and from `loam gate`.
 * Three surfaces used to fire on exactly that element — `landscape.datastore-private`
 * here, `landscape.service-undocumented` from the census, and
 * `gate.partner-undocumented` on its consumer (that third one is pinned in
 * test/gate-command.test.ts, which has the gate harness) — and between them they
 * offered five remedies, not one of which was true of a Postgres the fleet runs.
 * The suite's own damage is the evidence: the first fixture here used to tag an
 * owned Redis `#external` purely to silence the census, and the datastore
 * warning fired anyway.
 *
 * `landscape.datastore-shared` is untouched by all of it, in both its branches.
 * Stating that two services reach the same data is a fact about coupling, not a
 * restriction on where a box is drawn, and half of these cases exist to prove
 * the retirement did not take it with it.
 */
describe("a datastore drawn at fleet level", () => {
  it("earns ZERO findings when the fleet owns it and one service consumes it", async () => {
    // THE acceptance criterion, and the fixture is deliberately the plainest
    // shape a fleet can write: an owned `database` beside its one consumer, no
    // tag bought to buy silence, no binding invented to answer a check.
    const files = {
      "architecture/landscape.likec4": landscape(`  svcA = softwareSystem 'svc-a' {
    metadata { service 'svc-a' }
  }
  redis = database 'Redis'
  orphan = database 'Orphan'
  svcA -> redis 'caches sessions'`),
      "services/svc-a/model.likec4": extendingModel(`  extend svcA {
    api = container 'api'
  }`),
    };
    await withProject(files, {}, async (p) => {
      const { code, targets } = await validateAll(p);
      expect(code).toBe(0);
      const t = landscapeTarget(targets)!;
      // Nothing at all names the store — not the retired private warning, not
      // the census's undocumented warning, not anything else that may arrive
      // later. Asserting the SUBJECT set rather than a list of codes is what
      // makes this a criterion instead of three exemptions.
      expect(t.findings.filter((x) => x.subject === "Redis")).toEqual([]);
      expect(t.findings.filter((x) => x.subject === "Orphan")).toEqual([]);
      expect(t.findings.map((x) => x.code)).toEqual(["landscape.matched"]);
      // And nothing on this target is even a warning, which is the half that
      // used to bite hardest: `validate --strict` exits 1 on a warning, so the
      // two retired findings did not merely nag — they failed the pipeline of
      // every fleet that drew a store it owns as a peer.
      expect(t.findings.filter((x) => x.severity !== "ok")).toEqual([]);
    });
  });

  it("exempts every kind loam reads as infrastructure, not the datastore alone", async () => {
    // INFRA_KINDS is `database, queue, topic, cache, bucket`. A queue and a
    // topic were never datastore-graded, but they earned the census's
    // `service-undocumented` for exactly the same wrong reason — and the topic
    // case is the one `core/brief/unchecked.ts` has been documenting as a known
    // wart, since a topic nested in an `#external` broker inherits no tag.
    // The `landscape()` helper declares only the four kinds the rest of this
    // file needs, so the specification is spelled out here — the point of the
    // case is precisely the kinds it does not carry.
    const files = {
      "architecture/landscape.likec4": `specification {
  element softwareSystem
  element container
  element database
  element queue
  element topic
  element cache
  element bucket
  tag external
}

model {
  svcA = softwareSystem 'svc-a' {
    metadata { service 'svc-a' }
  }
  orders = database 'Order store'
  jobs = queue 'Job queue'
  events = topic 'payment.events'
  sessions = cache 'Session cache'
  blobs = bucket 'Invoice blobs'
  svcA -> orders 'reads'
  svcA -> jobs 'enqueues'
  svcA -> events 'publishes'
  svcA -> sessions 'caches'
  svcA -> blobs 'stores'
}

views {
  view landscape {
    include *
  }
}
`,
      "services/svc-a/model.likec4": extendingModel(`  extend svcA {
    api = container 'api'
  }`),
    };
    await withProject(files, {}, async (p) => {
      const { targets } = await validateAll(p);
      expect(landscapeTarget(targets)!.findings.map((x) => x.code)).toEqual(["landscape.matched"]);
    });
  });

  it("names the infrastructure kinds as the third remedy when an element really is undocumented", async () => {
    // The hook is a kind NAME, so a fleet whose specification spells its store
    // `postgres` still lands on `service-undocumented` — and that message used
    // to offer exactly two remedies, both false of a store the fleet runs. The
    // list is spelled from INFRA_KINDS itself, so this assertion also pins that
    // the message and the census cannot drift apart.
    const files = {
      "architecture/landscape.likec4": landscape(`  svcA = softwareSystem 'svc-a' {
    metadata { service 'svc-a' }
  }
  store = softwareSystem 'Postgres cluster'
  svcA -> store 'reads'`),
      "services/svc-a/model.likec4": extendingModel(`  extend svcA {
    api = container 'api'
  }`),
    };
    await withProject(files, {}, async (p) => {
      const { targets } = await validateAll(p);
      const f = landscapeTarget(targets)!.findings.find((x) => x.code === "landscape.service-undocumented")!;
      expect(f, "no service-undocumented finding").toBeDefined();
      expect(f.subject).toBe("Postgres cluster");
      expect(f.message).toContain("database, queue, topic, cache, bucket");
    });
  });

  it("the kind is a fallback, never an override: a BOUND database naming nothing is still an error", async () => {
    // `standsForService` wins over the kind everywhere the exemption is
    // spelled. Without that guard a `database` carrying a binding would drop
    // out of the census, and `landscape.binding-unknown` — an ERROR, because a
    // binding is a claim about this repo rather than a guess at one — would go
    // silent for every store somebody bound by mistake.
    const files = {
      "architecture/landscape.likec4": landscape(`  svcA = softwareSystem 'svc-a' {
    metadata { service 'svc-a' }
  }
  orders = database 'Order store' {
    metadata { service 'ghost-service' }
  }
  svcA -> orders 'reads'`),
      "services/svc-a/model.likec4": extendingModel(`  extend svcA {
    api = container 'api'
  }`),
    };
    await withProject(files, {}, async (p) => {
      const { code, targets } = await validateAll(p);
      expect(code).toBe(1);
      const f = landscapeTarget(targets)!.findings.find((x) => x.code === "landscape.binding-unknown")!;
      expect(f.severity).toBe("error");
      expect(f.subject).toBe("ghost-service");
    });
  });

  it("a store nested under its owner on the map is silent at one consumer, exactly as a peer now is", async () => {
    const files = {
      "architecture/landscape.likec4": landscape(`  svcA = softwareSystem 'svc-a' {
    redis = database 'Redis'
  }`),
      "services/svc-a/model.likec4": serviceModel("svc-a"),
    };
    await withProject(files, {}, async (p) => {
      const { targets } = await validateAll(p);
      const t = landscapeTarget(targets)!;
      expect(t.findings.map((x) => x.code)).toEqual(["landscape.matched"]);
    });
  });

  it("counts consumers its extending models attest, not only edges on the map", async () => {
    // R1: the census walked the map's relationships alone, so a store whose
    // consuming edges are drawn in the consumers' own models was graded against
    // whatever the map happened to draw — which for the extending shape, the
    // shape `loam adopt` briefs, was nothing at all. Neither consuming edge
    // below is on the map, and the coupling is still stated.
    const files = {
      "architecture/landscape.likec4": landscape(`  svcA = softwareSystem 'svc-a' {
    metadata { service 'svc-a' }
  }
  svcB = softwareSystem 'svc-b' {
    metadata { service 'svc-b' }
  }
  orderDb = database 'Order store'`),
      "services/svc-a/model.likec4": extendingModel(`  extend svcA {
    api = container 'api'
  }
  svcA.api -> orderDb 'Reads orders'`),
      "services/svc-b/model.likec4": extendingModel(`  extend svcB {
    api = container 'api'
  }
  svcB.api -> orderDb 'Reads orders'`),
    };
    await withProject(files, {}, async (p) => {
      const { targets } = await validateAll(p);
      const t = landscapeTarget(targets)!;
      const f = t.findings.find((x) => x.code === "landscape.datastore-shared")!;
      expect(f, `no datastore finding in ${t.findings.map((x) => x.code).join(", ")}`).toBeDefined();
      expect(f.subject).toBe("Order store");
      expect(f.message).toContain("svc-a, svc-b");
    });
  });

  it("takes no evidence from a STANDALONE consumer — its ids are its own file's", async () => {
    // The id-space rule, which the retired message used to state in prose and
    // which now shows only through the count: svc-b's model declares its own
    // `specification`, so it is parsed alone and its `orderDb` is a coincidence
    // of spelling, not the map's element. One counted consumer, and silence.
    const files = {
      "architecture/landscape.likec4": landscape(`  svcA = softwareSystem 'svc-a' {
    metadata { service 'svc-a' }
  }
  svcB = softwareSystem 'svc-b' {
    metadata { service 'svc-b' }
  }
  orderDb = database 'Order store'`),
      "services/svc-a/model.likec4": extendingModel(`  extend svcA {
    api = container 'api'
  }
  svcA.api -> orderDb 'Reads orders'`),
      "services/svc-b/model.likec4": `specification {
  element softwareSystem
  element database
}

model {
  s = softwareSystem 'svc-b'
  orderDb = database 'Order store'
  s -> orderDb 'Reads orders'
}

views {
  view index {
    include *
  }
}
`,
    };
    await withProject(files, {}, async (p) => {
      const { targets } = await validateAll(p);
      const t = landscapeTarget(targets)!;
      expect(t.findings.map((x) => x.code)).not.toContain("landscape.datastore-shared");
    });
  });

  it("is shared when one service reaches it through the map and another through its model", async () => {
    const files = {
      "architecture/landscape.likec4": landscape(`  svcA = softwareSystem 'svc-a' {
    metadata { service 'svc-a' }
  }
  svcB = softwareSystem 'svc-b' {
    metadata { service 'svc-b' }
  }
  orderDb = database 'Order store'
  svcB -> orderDb 'Reads orders'`),
      "services/svc-a/model.likec4": extendingModel(`  extend svcA {
    api = container 'api'
  }
  svcA.api -> orderDb 'Writes orders'`),
      "services/svc-b/model.likec4": extendingModel(`  extend svcB {
    api = container 'api'
  }`),
    };
    await withProject(files, {}, async (p) => {
      const { targets } = await validateAll(p);
      const t = landscapeTarget(targets)!;
      const f = t.findings.find((x) => x.code === "landscape.datastore-shared")!;
      expect(f, `no datastore finding in ${t.findings.map((x) => x.code).join(", ")}`).toBeDefined();
      expect(f.message).toContain("svc-a, svc-b");
    });
  });

  it("grades a NESTED store two services reach — the coupling the peer census could never see", async () => {
    // The store sits inside its owner's element, which is one of the two
    // placements a team may choose; a second service draws the container-level
    // edge in its own model. `landscape.datastore-shared` could not fire for a
    // nested store at all, so this coupling rendered and was graded nowhere (E3).
    const files = {
      "architecture/landscape.likec4": landscape(`  svcA = softwareSystem 'svc-a' {
    metadata { service 'svc-a' }
    store = database 'orders'
  }
  svcB = softwareSystem 'svc-b' {
    metadata { service 'svc-b' }
  }
  svcB -> svcA 'Reads orders'`),
      "services/svc-a/model.likec4": extendingModel(`  extend svcA {
    api = container 'api'
  }
  svcA.api -> svcA.store 'Writes orders'`),
      "services/svc-b/model.likec4": extendingModel(`  extend svcB {
    api = container 'api'
  }
  svcB.api -> svcA.store 'Reads orders'`),
    };
    await withProject(files, {}, async (p) => {
      const { targets } = await validateAll(p);
      const t = landscapeTarget(targets)!;
      const f = t.findings.find((x) => x.code === "landscape.datastore-shared")!;
      expect(f, `no datastore finding in ${t.findings.map((x) => x.code).join(", ")}`).toBeDefined();
      expect(f.subject).toBe("orders");
      expect(f.message).toContain("svc-a, svc-b");
      // The store's OWN id, said as its own id: the clause read "nested under
      // 'svcA.store'", which sends a reader looking for an element that HOLDS
      // the store when that id IS the store.
      expect(f.message).toContain("svc-a's own store, written as 'svcA.store'");
      expect(f.message).not.toContain("nested under 'svcA.store'");
      // And the reversibility, DIRECTIONALLY. The clause used to read "moving
      // the declaration between them rewrites no edge", which is false in every
      // state this finding fires in: the second consumer's edge resolves only
      // against the MAP's declaration, so performing the move it called free
      // costs `c4.invalid` on that consumer's model or `landscape.invalid` on
      // the map (verification 2026-09-04). The store is on the map here, so the
      // message says the move OUT of the map is the one that breaks. This is
      // the LOAD-BEARING half of the old stance, and it survives the retirement
      // of `landscape.datastore-private` because it is a fact about LikeC4
      // rather than a preference about where a box goes.
      expect(f.message).toContain("give it the same id, svcA.store");
      expect(f.message).toContain("ONE-WAY");
      expect(f.message).toContain("svc-b's edge resolves only against a declaration the MAP holds");
      expect(f.message).toContain("Out of svc-a's `extend` block onto svc-a's element on the map is always safe");
      expect(f.message).toContain("moving it back INTO the `extend` block breaks that edge");
      expect(f.message).not.toContain("rewrites no edge and no `Covers:` line");
    });
  });

  it("takes no evidence from a consumer whose model does not parse", async () => {
    // svc-b's model would supply the second consumer; it does not parse, so it
    // attests nothing and the coupling is not asserted out of bytes nobody read.
    const files = {
      "architecture/landscape.likec4": landscape(`  svcA = softwareSystem 'svc-a' {
    metadata { service 'svc-a' }
  }
  svcB = softwareSystem 'svc-b' {
    metadata { service 'svc-b' }
  }
  orderDb = database 'Order store'`),
      "services/svc-a/model.likec4": extendingModel(`  extend svcA {
    api = container 'api'
  }
  svcA.api -> orderDb 'Reads orders'`),
      "services/svc-b/model.likec4": "model {\n  broken !!! not likec4\n",
    };
    await withProject(files, {}, async (p) => {
      const { targets } = await validateAll(p);
      const t = landscapeTarget(targets)!;
      expect(t.findings.map((x) => x.code)).not.toContain("landscape.datastore-shared");
      expect(codesIn(targets)).toContain("c4.invalid");
    });
  });

  it("warns landscape.datastore-shared when a second service reaches the same data", async () => {
    const files = {
      "architecture/landscape.likec4": landscape(`  svcA = softwareSystem 'svc-a'
  svcB = softwareSystem 'svc-b'
  store = database 'Category store'
  svcA -> store 'reads categories'
  svcA -> store 'writes categories'
  svcB -> store 'reads categories'`),
      "services/svc-a/model.likec4": serviceModel("svc-a"),
      "services/svc-b/model.likec4": serviceModel("svc-b"),
    };
    await withProject(files, {}, async (p) => {
      const { targets } = await validateAll(p);
      const t = landscapeTarget(targets)!;
      const f = t.findings.find((x) => x.code === "landscape.datastore-shared")!;
      expect(f.severity).toBe("warn");
      expect(f.message).toContain("svc-a, svc-b");
      expect(f.message).toContain("DATA");
      // The shared store is the ONLY thing said about it — the store is owned
      // and untagged, so nothing asks for a services/Category store/ either.
      expect(t.findings.map((x) => x.code)).toEqual(["landscape.datastore-shared"]);
    });
  });

  it("--strict escalates the shared-store warning to exit 1", async () => {
    const files = {
      "architecture/landscape.likec4": landscape(`  svcA = softwareSystem 'svc-a'
  svcB = softwareSystem 'svc-b'
  store = database 'Category store'
  svcA -> store 'reads categories'
  svcB -> store 'reads categories'`),
      "services/svc-a/model.likec4": serviceModel("svc-a"),
      "services/svc-b/model.likec4": serviceModel("svc-b"),
    };
    await withProject(files, {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--all", "--strict");
      expect(res.code).toBe(1);
    });
  });

  it("never fires on a NESTED datastore that IS a service of the fleet", async () => {
    // The peer half skips an element that stands for a directory — a datastore
    // bound to one is the binding checks' subject — and the nested half did not.
    // So `services/svc-b/` drawn as a `database` inside svc-a's element became a
    // store "owned" by its own binding, and one more reader made it a shared
    // datastore: the team was advised to give each service a private copy of a
    // service.
    const files = {
      "architecture/landscape.likec4": landscape(`  svcA = softwareSystem 'svc-a' {
    metadata { service 'svc-a' }
    bDb = database 'svc-b store' {
      metadata { service 'svc-b' }
    }
  }
  svcC = softwareSystem 'svc-c' {
    metadata { service 'svc-c' }
  }
  svcC -> svcA.bDb 'reads'`),
      "services/svc-a/model.likec4": extendingModel(""),
      "services/svc-b/model.likec4": extendingModel(""),
      "services/svc-c/model.likec4": extendingModel(""),
    };
    await withProject(files, {}, async (p) => {
      const { targets } = await validateAll(p);
      const t = landscapeTarget(targets)!;
      expect(t.findings.map((x) => x.code)).not.toContain("landscape.datastore-shared");
      expect(t.findings.map((x) => x.code)).toContain("landscape.matched");
    });
  });

  it("never fires on a datastore that IS a service of the fleet — and keeps it in the census", async () => {
    // The other half of the fallback rule: a `database` whose TITLE names a
    // real services/<id>/ is an adopted service that happens to be drawn as a
    // store. Dropping it for its kind would take a genuinely adopted service
    // out of the scorecard's `c4.elements` denominator and out of both binding
    // passes at once — silently, since nothing would then say a word about it.
    const files = {
      "architecture/landscape.likec4": landscape(`  svcA = softwareSystem 'svc-a'
  catalogDb = database 'catalog-db'
  svcA -> catalogDb 'queries'`),
      "services/svc-a/model.likec4": serviceModel("svc-a"),
      "services/catalog-db/model.likec4": serviceModel("catalog-db"),
    };
    await withProject(files, {}, async (p) => {
      const { targets } = await validateAll(p);
      const t = landscapeTarget(targets)!;
      expect(t.findings.map((x) => x.code)).not.toContain("landscape.datastore-shared");
      // `landscape.matched` means the map and services/ agree — which for
      // catalog-db means the census still sees it as the service it is, rather
      // than skipping it and leaving `landscape.service-unmodelled` to fire.
      expect(t.findings.map((x) => x.code)).toEqual(["landscape.matched"]);
    });
  });
});
