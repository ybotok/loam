/**
 * `landscape.service-isolated` — the evidence-gated fleet warning for a
 * service the map draws and nothing reaches.
 *
 * The state it names is the one `loam seed --from fleet.yaml` leaves for every
 * service nobody listed under `calls:`: a bound element with no edge. Until
 * 2026-09-03 nothing reported it — `landscape.service-unmodelled` wants a
 * MISSING element, and the element is present — so a service could be adopted
 * with a full artifact set and stay invisible to every cross-service check
 * while `loam validate --all` ended on `landscape.matched`.
 *
 * What makes it a finding rather than a completeness guess is the GATE: it
 * fires only when the service's own `model.likec4` parses and declares at
 * least one call across its boundary. That is a join between two authored
 * documents — the model attests a call the map does not draw — and it is what
 * keeps the warning silent on a worker that genuinely calls nothing, on a
 * seeded fleet (seed writes no model), and on every fixture whose model
 * declares no relationship. Those silences are pinned here one by one, because
 * each is a fixture family this warning must never start reddening.
 */
import { describe, expect, it } from "vitest";
import { makeProject, runLoam, type Project } from "./helpers/harness.js";

const CODE = "landscape.service-isolated";

async function withProject(
  files: Record<string, string>,
  fn: (p: Project) => Promise<void>,
): Promise<void> {
  const p = await makeProject(files, {});
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

/** A landscape over two services and one external, with the edges `body` draws. */
function landscape(elements: string, edges: string): string {
  return `specification {
  element softwareSystem
  element container
  tag external
}

model {
  alphaService = softwareSystem 'alpha-service' {
    metadata { service 'alpha-service' }
  }
${elements}
  kafka = softwareSystem 'kafka' {
    #external
  }

  alphaService -> kafka
${edges}
}

views {
  view landscape {
    include *
  }
}
`;
}

/** The bound, edgeless element the whole file is about. */
const BETA_ELEMENT = `  betaService = softwareSystem 'beta-service' {
    metadata { service 'beta-service' }
  }
`;

/** A per-service model declaring no relationship at all — the harness shape. */
function quietModel(svc: string): string {
  return `specification { element softwareSystem }

model {
  s = softwareSystem '${svc}'
}
`;
}

/**
 * beta-service's model attesting one call across its boundary. The
 * counterpart's title equals its id on purpose, so the message assertion
 * below reads one spelling whichever the finding chooses to print.
 */
const BETA_MODEL = `specification {
  element softwareSystem
  element container
}

model {
  betaService = softwareSystem 'beta-service' {
    metadata { service 'beta-service' }
    api = container 'api'
  }
  stripe = softwareSystem 'stripe'
  betaService.api -> stripe 'Authorizes' {
    metadata { op 'authorize' }
  }
}
`;

/**
 * `null` is a beta-service with a directory and no model — a spec.md keeps the
 * directory enumerated, so the binding resolves and the only thing missing is
 * the evidence. Without any artifact there is no directory, and the finding
 * would be `landscape.binding-unknown` about a different defect.
 */
function fleet(model: string | null, edges = ""): Record<string, string> {
  return {
    "architecture/landscape.likec4": landscape(BETA_ELEMENT, edges),
    "services/alpha-service/model.likec4": quietModel("alpha-service"),
    ...(model === null
      ? { "services/beta-service/spec.md": "---\nservice: beta-service\nstatus: draft\n---\n" }
      : { "services/beta-service/model.likec4": model }),
  };
}

async function validateAll(p: Project): Promise<{ code: number; landscape: Target; all: Target[] }> {
  const res = await runLoam(p.workDir, "validate", "--all", "--json");
  const json = JSON.parse(res.stdout) as { targets: Target[] };
  const target = json.targets.find((t) => t.kind === "landscape");
  expect(target, "the fleet cross-check did not run").toBeDefined();
  return { code: res.code, landscape: target!, all: json.targets };
}

const codesOf = (t: Target): string[] => t.findings.map((f) => f.code);

describe("a drawn, bound, edgeless service whose model reaches other systems", () => {
  it("warns on the landscape target, names the attested call, and never gates", async () => {
    await withProject(fleet(BETA_MODEL), async (p) => {
      const { code, landscape } = await validateAll(p);
      const f = landscape.findings.find((x) => x.code === CODE);
      expect(f, `no ${CODE} in ${codesOf(landscape).join(", ")}`).toBeDefined();
      expect(f!.severity).toBe("warn");
      expect(f!.subject).toBe("beta-service");
      expect(f!.message).toContain("services/beta-service/ resolves to 'betaService'");
      expect(f!.message).toContain("services/beta-service/model.likec4 declares 1 call(s)");
      expect(f!.message).toContain("-> stripe (op 'authorize')");
      expect(f!.message).toContain("betaService");
      // A warning suppresses the confirmation, like every finding here…
      expect(codesOf(landscape)).not.toContain("landscape.matched");
      // …and gates nothing: the target stays valid and the run exits 0.
      expect(landscape.valid).toBe(true);
      expect(code).toBe(0);
    });
  });

  it("spells the repair in the direction the model attests — an inbound call is `<caller> -> <element>`", async () => {
    // The message used to hard-code the outbound form whatever the call's
    // direction, so an agent following it for an inbound call drew the
    // dependency backwards — and `op` must be an operationId the TARGET's
    // openapi.yaml defines, so the reversed edge then earned
    // `spine.op-undefined` against the wrong service.
    const inbound = BETA_MODEL.replace("betaService.api -> stripe 'Authorizes'", "stripe -> betaService.api 'Authorizes'");
    await withProject(fleet(inbound), async (p) => {
      const { landscape } = await validateAll(p);
      const f = landscape.findings.find((x) => x.code === CODE);
      expect(f, `no ${CODE} in ${codesOf(landscape).join(", ")}`).toBeDefined();
      expect(f!.message).toContain("<- stripe (op 'authorize')");
      expect(f!.message).toContain("<caller> -> betaService 'Calls <op>'");
      expect(f!.message).not.toContain("betaService -> <callee>");
    });
    // Calls both ways: both forms, so neither direction is guessed.
    // Spliced at the model's tail — the outbound edge's closing brace, then
    // `model`'s — the one place a second relationship fits.
    const mixed = BETA_MODEL.replace(
      "  }\n}\n",
      "  }\n  stripe -> betaService.api 'Notifies' {\n    metadata { op 'settle' }\n  }\n}\n",
    );
    await withProject(fleet(mixed), async (p) => {
      const { landscape } = await validateAll(p);
      const f = landscape.findings.find((x) => x.code === CODE);
      expect(f, `no ${CODE} in ${codesOf(landscape).join(", ")}`).toBeDefined();
      expect(f!.message).toContain("betaService -> <callee> 'Calls <op>'");
      expect(f!.message).toContain("<caller> -> betaService 'Calls <op>'");
    });
  });

  it("is a fleet fact: `--service` never reports it", async () => {
    await withProject(fleet(BETA_MODEL), async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", "beta-service", "--json");
      const json = JSON.parse(res.stdout) as { targets: Target[] };
      expect(json.targets.flatMap(codesOf)).not.toContain(CODE);
    });
  });
});

describe("the evidence gate — every silence is a fixture family that must stay green", () => {
  it("a model declaring no call across its boundary is silent, and the map still matches", async () => {
    // The harness's `serviceModel()` shape, and the one a worker that genuinely
    // calls nothing has: no evidence, no finding. An unconditional "no edge
    // touches it" would fire here with no correct fix.
    await withProject(fleet(quietModel("beta-service")), async (p) => {
      const { landscape } = await validateAll(p);
      expect(codesOf(landscape)).not.toContain(CODE);
      expect(codesOf(landscape)).toContain("landscape.matched");
    });
  });

  it("no model at all is silent — exactly the fleet `loam seed` leaves", async () => {
    await withProject(fleet(null), async (p) => {
      const { landscape } = await validateAll(p);
      expect(codesOf(landscape)).not.toContain(CODE);
      // `service.no-model` is the service target's own error; the map itself
      // agrees with services/, so the confirmation stands.
      expect(codesOf(landscape)).toContain("landscape.matched");
    });
  });

  it("a model that does not parse is silent — `c4.invalid` owns that", async () => {
    await withProject(fleet("model {\n  broken !!! not likec4\n"), async (p) => {
      const { landscape, all } = await validateAll(p);
      expect(codesOf(landscape)).not.toContain(CODE);
      expect(all.flatMap(codesOf)).toContain("c4.invalid");
    });
  });

  it("an intra-service edge on the map counts as touching — the brief's `touched` predicate, exactly", async () => {
    // beta-service drawn as containers with an edge between two of them: the
    // map draws an edge on this service, so it is not isolated. This is what
    // keeps a self-model whose one service is all container edges silent.
    const containers = `  betaService = softwareSystem 'beta-service' {
    metadata { service 'beta-service' }
    api = container 'api'
    db = container 'db'
  }
`;
    const files = {
      "architecture/landscape.likec4": landscape(containers, "  betaService.api -> betaService.db 'reads'"),
      "services/alpha-service/model.likec4": quietModel("alpha-service"),
      "services/beta-service/model.likec4": BETA_MODEL,
    };
    await withProject(files, async (p) => {
      const { landscape } = await validateAll(p);
      expect(codesOf(landscape)).not.toContain(CODE);
      expect(codesOf(landscape)).toContain("landscape.matched");
    });
  });

  it("an edge into the service's element is touching, whichever direction it runs", async () => {
    await withProject(fleet(BETA_MODEL, "  kafka -> betaService"), async (p) => {
      const { landscape } = await validateAll(p);
      expect(codesOf(landscape)).not.toContain(CODE);
    });
  });

  it("an #external element with no edge is never a subject — it is not an enumerated service", async () => {
    // `stripe` drawn on the map, edgeless, foreign: `#external` already exempts
    // it from `service-undocumented`, and this check walks services/ only.
    const files = fleet(quietModel("beta-service"), "");
    files["architecture/landscape.likec4"] = landscape(
      `${BETA_ELEMENT}  stripe = softwareSystem 'stripe' {\n    #external\n  }\n`,
      "",
    );
    await withProject(files, async (p) => {
      const { landscape } = await validateAll(p);
      expect(landscape.findings.filter((f) => f.code === CODE)).toEqual([]);
      expect(codesOf(landscape)).toContain("landscape.matched");
    });
  });

  it("an unmodelled service is `service-unmodelled`, never this", async () => {
    const files = fleet(BETA_MODEL);
    files["architecture/landscape.likec4"] = landscape("", "");
    await withProject(files, async (p) => {
      const { landscape } = await validateAll(p);
      expect(codesOf(landscape)).not.toContain(CODE);
      expect(codesOf(landscape)).toContain("landscape.service-unmodelled");
    });
  });
});
