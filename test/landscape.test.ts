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
  element person
  tag external
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
