/**
 * What `loam validate` used to answer "checked, fine" to.
 *
 * Every case here is a false GREEN in the command a hundred repositories run in
 * CI — the gate saw a fleet it could not actually grade, and said nothing:
 *
 *  - a landscape that groups services under a parent element (ordinary C4) had
 *    every nested element thrown away by an id filter, so a bound service read
 *    as unmodelled and a binding one level down was never checked at all;
 *  - a deleted or misspelled openapi.yaml SILENCED the whole API axis instead
 *    of failing it, and the same absence then produced one spine error per
 *    inbound edge — the report scaled with consumers instead of root causes;
 *  - a feature delta addressed to a service that does not exist validated
 *    green, and archive then created `services/<typo>/` out of it;
 *  - `c4.uncovered` fired on every edge a delta re-declares, because the two
 *    sides of one lookup joined their key with different separators;
 *  - `openapi.duplicate-operationid` was documented as a `validate --service`
 *    code and reachable only through an unrelated feature's delta.
 *
 * And one that is not a finding at all: `--all` runs its targets concurrently
 * now, so the report's ORDER is pinned here — byte-identical to the serial run
 * it replaces, or every consumer diffing two runs reads noise as change.
 */
import { describe, expect, it } from "vitest";
import { makeProject, runLoam, type Project } from "./helpers/harness.js";

interface Finding {
  severity: "ok" | "warn" | "error";
  code: string;
  subject?: string;
  message: string;
  details: string[];
}
interface Target {
  kind: string;
  id: string;
  valid: boolean;
  findings: Finding[];
}
interface Payload {
  valid: boolean;
  summary: Record<string, number>;
  targets: Target[];
}

async function withProject(
  files: Record<string, string>,
  fn: (p: Project) => Promise<void>,
  opts: { service?: string } = {},
): Promise<void> {
  const p = await makeProject(files, opts);
  try {
    await fn(p);
  } finally {
    await p.destroy();
  }
}

const payload = (stdout: string): Payload => JSON.parse(stdout) as Payload;
const target = (p: Payload, id: string): Target => p.targets.find((t) => t.id === id)!;
const codes = (t: Target): string[] => t.findings.map((f) => f.code);
const all = (p: Payload): Finding[] => p.targets.flatMap((t) => t.findings);
const byCode = (p: Payload, code: string): Finding[] => all(p).filter((f) => f.code === code);

/* ------------------------------------------------------------------ */
/* Fixture builders                                                    */
/* ------------------------------------------------------------------ */

function serviceModel(id: string, ident: string): string {
  return `specification {
  element softwareSystem
}

model {
  ${ident} = softwareSystem '${id}' {
    metadata { service '${id}' }
  }
}
`;
}

function livingSpec(id: string, ops: string[] = []): string {
  return `---
service: ${id}
owner: team-${id}
status: draft
---

# ${id}

## Requirements

### Requirement: Do the thing
The service SHALL do the thing.
${ops.length > 0 ? `\nOperations: ${ops.join(", ")}\n` : ""}
#### Scenario: It is done
- **Given** a thing
- **When** it runs
- **Then** it is done
`;
}

function openapi(id: string, ops: string[]): string {
  return `openapi: 3.1.0
info:
  title: ${id}
  version: "1.0"
paths:
${ops
  .map(
    (op) => `  /${op}:
    post:
      operationId: ${op}
      responses:
        "200":
          description: ok`,
  )
  .join("\n")}
`;
}

/** model + spec + openapi for one service, all three consistent. */
function service(id: string, ident: string, ops: string[]): Record<string, string> {
  return {
    [`services/${id}/model.likec4`]: serviceModel(id, ident),
    [`services/${id}/spec.md`]: livingSpec(id, ops),
    ...(ops.length > 0 ? { [`services/${id}/openapi.yaml`]: openapi(id, ops) } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* 1. A landscape that groups its services                             */
/* ------------------------------------------------------------------ */

/** Ordinary C4: both services live inside a `Platform` grouping element. */
const GROUPED_LANDSCAPE = `specification {
  element group
  element softwareSystem
  element container
}

model {
  platform = group 'Platform' {
    checkoutWeb = softwareSystem 'checkout-web' {
      metadata { service 'checkout-web' }
    }
    paymentService = softwareSystem 'payment-service' {
      metadata { service 'payment-service' }
      api = container 'api'
    }

    checkoutWeb -> paymentService 'Calls authorizePayment' {
      metadata { op 'authorizePayment' }
    }
  }
}
`;

function groupedFleet(): Record<string, string> {
  return {
    "architecture/landscape.likec4": GROUPED_LANDSCAPE,
    ...service("payment-service", "paymentService", ["authorizePayment"]),
    ...service("checkout-web", "checkoutWeb", []),
  };
}

describe("nested landscape elements are resolved, not discarded", () => {
  it("a service grouped under a parent element is modelled — not unmodelled on every service", async () => {
    await withProject(groupedFleet(), async (p) => {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      const out = payload(res.stdout);
      // The old `elements.filter(e => !e.id.includes("."))` kept only the
      // grouping itself, so BOTH services were reported undrawn — an error
      // apiece, on a landscape that binds both of them explicitly.
      expect(byCode(out, "landscape.service-unmodelled")).toEqual([]);
      // And the grouping is not a service nobody adopted: it CONTAINS services,
      // which is the one thing a grouping is, so there is nothing to bind.
      expect(byCode(out, "landscape.service-undocumented")).toEqual([]);
      expect(codes(target(out, "landscape"))).toEqual(["landscape.matched"]);
      expect(out.valid).toBe(true);
      expect(res.code).toBe(0);
    });
  });

  it("the spine still resolves through an edge drawn inside the grouping", async () => {
    await withProject(groupedFleet(), async (p) => {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      const out = payload(res.stdout);
      expect(codes(target(out, "payment-service"))).toContain("spine.resolved");
    });
  });

  it("a binding one level down is checked too — it used to be invisible", async () => {
    const files = groupedFleet();
    files["architecture/landscape.likec4"] = GROUPED_LANDSCAPE.replace(
      "      api = container 'api'\n",
      "      api = container 'api' {\n        metadata { service 'paymnet-service' }\n      }\n",
    );
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      const out = payload(res.stdout);
      const [unknown] = byCode(out, "landscape.binding-unknown");
      expect(unknown).toBeDefined();
      expect(unknown!.severity).toBe("error");
      expect(unknown!.subject).toBe("paymnet-service");
      expect(res.code).toBe(1);
      // The container's parent still models payment-service, so the bogus
      // binding must not also report the real service as undrawn.
      expect(byCode(out, "landscape.service-unmodelled")).toEqual([]);
    });
  });

  it("a container inside a service is not a second element claiming that service", async () => {
    const files = groupedFleet();
    files["architecture/landscape.likec4"] = GROUPED_LANDSCAPE.replace(
      "      api = container 'api'\n",
      "      api = container 'api' {\n        metadata { service 'payment-service' }\n      }\n",
    );
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      // Both resolve to payment-service, and every join agrees which service an
      // edge into either one belongs to — that is not the ambiguity
      // landscape.binding-duplicate exists to name.
      expect(byCode(payload(res.stdout), "landscape.binding-duplicate")).toEqual([]);
    });
  });
});

/* ------------------------------------------------------------------ */
/* 2 + 6. A contract that is not there                                 */
/* ------------------------------------------------------------------ */

function landscape(body: string): string {
  return `specification {
  element softwareSystem
}

model {
${body}
}
`;
}

/** Three consumers, all calling operations on payment-service. */
const THREE_CONSUMERS = landscape(`  paymentService = softwareSystem 'payment-service' {
    metadata { service 'payment-service' }
  }
  a = softwareSystem 'svc-a' {
    metadata { service 'svc-a' }
  }
  b = softwareSystem 'svc-b' {
    metadata { service 'svc-b' }
  }
  c = softwareSystem 'svc-c' {
    metadata { service 'svc-c' }
  }

  a -> paymentService 'Calls authorizePayment' {
    metadata { op 'authorizePayment' }
  }
  b -> paymentService 'Calls authorizePayment' {
    metadata { op 'authorizePayment' }
  }
  c -> paymentService 'Calls authorizePayment' {
    metadata { op 'authorizePayment' }
  }`);

function consumerFleet(): Record<string, string> {
  return {
    "architecture/landscape.likec4": THREE_CONSUMERS,
    ...service("payment-service", "paymentService", ["authorizePayment"]),
    ...service("svc-a", "a", []),
    ...service("svc-b", "b", []),
    ...service("svc-c", "c", []),
  };
}

describe("a missing openapi.yaml fails the API axis instead of silencing it", () => {
  it("a living Operations: line with no contract is an error, not a warning nobody reads", async () => {
    const files = {
      "architecture/landscape.likec4": landscape(`  paymentService = softwareSystem 'payment-service' {
    metadata { service 'payment-service' }
  }`),
      ...service("payment-service", "paymentService", ["authorizePayment"]),
    };
    // The contract is deleted; the requirement that governs its operation stays.
    delete files["services/payment-service/openapi.yaml"];
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      const out = payload(res.stdout);
      const [missing] = byCode(out, "service.no-openapi");
      expect(missing).toBeDefined();
      expect(missing!.severity).toBe("error");
      // The join it strands is named, so the reader is not left grepping.
      expect(missing!.details).toEqual(["authorizePayment"]);
      expect(res.code).toBe(1);
      expect(out.valid).toBe(false);
    });
  });

  it("one missing contract is ONE finding, not one per inbound edge", async () => {
    const files = consumerFleet();
    delete files["services/payment-service/openapi.yaml"];
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      const out = payload(res.stdout);
      expect(byCode(out, "service.no-openapi")).toHaveLength(1);
      // The three inbound edges are not three landscape defects: the landscape
      // is correct and the file is missing. Grading them against an empty
      // operation set made the report scale with consumers.
      expect(byCode(out, "spine.op-undefined")).toEqual([]);
      // …and no false all-clear either.
      expect(byCode(out, "spine.resolved")).toEqual([]);
      expect(res.code).toBe(1);
    });
  });

  it("a service nothing calls, governing nothing, still says nothing", async () => {
    // The documented grace: the landscape parsed, no edge calls an operation
    // here, and no requirement names one. A worker with no API is not missing
    // one, and a fleet mid-rollout must not go yellow for it.
    const files = {
      "architecture/landscape.likec4": landscape(`  workerService = softwareSystem 'worker-service' {
    metadata { service 'worker-service' }
  }`),
      ...service("worker-service", "workerService", []),
    };
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(byCode(payload(res.stdout), "service.no-openapi")).toEqual([]);
      expect(res.code).toBe(0);
    });
  });

  it("with no landscape to prove anything, the absence is a warning as before", async () => {
    await withProject({ ...service("payment-service", "paymentService", []) }, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", "payment-service", "--json");
      const [missing] = byCode(payload(res.stdout), "service.no-openapi");
      expect(missing).toBeDefined();
      expect(missing!.severity).toBe("warn");
      expect(res.code).toBe(0);
    });
  });
});

/* ------------------------------------------------------------------ */
/* 5. Two slots, one operationId, in a LIVING contract                 */
/* ------------------------------------------------------------------ */

describe("openapi.duplicate-operationid is reachable from service scope", () => {
  it("validate --service reports one id defined in two slots", async () => {
    const files = service("payment-service", "paymentService", ["authorizePayment"]);
    files["services/payment-service/openapi.yaml"] += `  /authorize-v2:
    post:
      operationId: authorizePayment
      responses:
        "200":
          description: ok
`;
    await withProject(
      files,
      async (p) => {
        const res = await runLoam(p.workDir, "validate", "--service", "payment-service", "--json");
        const [dup] = byCode(payload(res.stdout), "openapi.duplicate-operationid");
        expect(dup).toBeDefined();
        expect(dup!.severity).toBe("warn");
        expect(dup!.subject).toBe("payment-service");
        expect(dup!.message).toContain("post /authorize");
        expect(dup!.message).toContain("post /authorize-v2");
        // A warning: the document is legal, the ambiguity is in what joins on it.
        expect(res.code).toBe(0);
      },
      { service: "payment-service" },
    );
  });
});

/* ------------------------------------------------------------------ */
/* 3. A feature delta addressed to a service that does not exist       */
/* ------------------------------------------------------------------ */

const NEW_SERVICE_DELTA = `specification {
  element softwareSystem
  tag FEAT-1
}

model {
  paymentService = softwareSystem 'payment-service'
  splitService = softwareSystem 'payment-split-service' {
    #FEAT-1
  }

  paymentService -> splitService 'Calls createSplit' {
    #FEAT-1
    metadata { op 'createSplit' }
  }
}
`;

function featureSpec(service: string, op?: string): string {
  return `# ${service} — delta for FEAT-1

## ADDED Requirements

### Requirement: Split a payment
The service SHALL split a payment.
${op === undefined ? "" : `\nOperations: ${op}\n`}
#### Scenario: Split
- **Given** a payment
- **When** it is split
- **Then** two shares are recorded
`;
}

function featureIntent(): string {
  return `---
feature: FEAT-1
owner: team
status: proposed
---

# Split payments
`;
}

describe("a feature delta must address a service that exists, or one it introduces", () => {
  const base = {
    "architecture/landscape.likec4": landscape(`  paymentService = softwareSystem 'payment-service' {
    metadata { service 'payment-service' }
  }`),
    ...service("payment-service", "paymentService", ["authorizePayment"]),
  };

  it("a one-character typo in --touches is an error, and names the near miss", async () => {
    await withProject(
      {
        ...base,
        "features/FEAT-1-typo/intent.md": featureIntent(),
        "features/FEAT-1-typo/specs/paymnet-service/spec.md": featureSpec("paymnet-service"),
      },
      async (p) => {
        const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json");
        const [unknown] = byCode(payload(res.stdout), "delta.service-unknown");
        expect(unknown).toBeDefined();
        expect(unknown!.severity).toBe("error");
        expect(unknown!.subject).toBe("paymnet-service");
        expect(unknown!.message).toContain("Did you mean: payment-service?");
        expect(res.code).toBe(1);
      },
    );
  });

  it("a service the feature's own delta introduces is fine", async () => {
    await withProject(
      {
        ...base,
        "features/FEAT-1-split/intent.md": featureIntent(),
        "features/FEAT-1-split/delta.likec4": NEW_SERVICE_DELTA,
        "features/FEAT-1-split/specs/payment-split-service/spec.md": featureSpec(
          "payment-split-service",
          "createSplit",
        ),
        "features/FEAT-1-split/specs/payment-split-service/openapi.yaml": openapi(
          "payment-split-service",
          ["createSplit"],
        ),
      },
      async (p) => {
        const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json");
        expect(byCode(payload(res.stdout), "delta.service-unknown")).toEqual([]);
      },
    );
  });

  it("a delta that did not parse suspends the question instead of guessing", async () => {
    await withProject(
      {
        ...base,
        "features/FEAT-1-broken/intent.md": featureIntent(),
        "features/FEAT-1-broken/delta.likec4": "specification {\n  element softwareSystem\n}\n\nmodel {\n  x = nosuchkind 'x'\n}\n",
        "features/FEAT-1-broken/specs/paymnet-service/spec.md": featureSpec("paymnet-service"),
      },
      async (p) => {
        const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json");
        const out = payload(res.stdout);
        expect(byCode(out, "delta.invalid").length).toBeGreaterThan(0);
        // Whether the delta introduces that service is exactly what nobody can
        // read here — the finding is about the file, not about its contents.
        expect(byCode(out, "delta.service-unknown")).toEqual([]);
      },
    );
  });
});

describe("a specs/ directory name must be a legal service id, whoever vouches for the service", () => {
  const base = {
    "architecture/landscape.likec4": landscape(`  paymentService = softwareSystem 'payment-service' {
    metadata { service 'payment-service' }
  }`),
    ...service("payment-service", "paymentService", ["authorizePayment"]),
  };

  it("specs/Payment Service/ is an error even when a tagged element's title introduces it", async () => {
    // The false green this pins: the title fallback made `introduces` contain
    // 'Payment Service', so delta.service-unknown stayed quiet — and nothing
    // else ever asked the grammar. validate exited 0 and archive materialised
    // services/Payment Service/, a directory service.id-invalid then fails.
    await withProject(
      {
        ...base,
        "features/FEAT-1-space/intent.md": featureIntent(),
        "features/FEAT-1-space/delta.likec4": `specification {
  element softwareSystem
  tag FEAT-1
}

model {
  paymentSvc = softwareSystem 'Payment Service' {
    #FEAT-1
  }
}
`,
        "features/FEAT-1-space/specs/Payment Service/spec.md": featureSpec("Payment Service"),
      },
      async (p) => {
        const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json");
        const [invalid] = byCode(payload(res.stdout), "delta.service-id-invalid");
        expect(invalid).toBeDefined();
        expect(invalid!.severity).toBe("error");
        expect(invalid!.subject).toBe("Payment Service");
        expect(invalid!.message).toContain("service id must start with");
        // The two findings are disjoint questions: the title INTRODUCES the
        // service, so the unknown-service half must stay quiet here.
        expect(byCode(payload(res.stdout), "delta.service-unknown")).toEqual([]);
        expect(res.code).toBe(1);
      },
    );
  });

  // The two names below cannot exist on a Windows checkout at all — NUL is a
  // reserved device, a trailing dot is stripped on create — which is exactly
  // why the grammar refuses them: a docs repo carrying either works on only
  // some of the machines that clone it. The fixtures are creatable on POSIX
  // only, so the pins run there.
  it.skipIf(process.platform === "win32")("specs/NUL/ trips the Windows-reserved-name branch", async () => {
    await withProject(
      {
        ...base,
        "features/FEAT-1-nul/intent.md": featureIntent(),
        "features/FEAT-1-nul/specs/NUL/spec.md": featureSpec("NUL"),
      },
      async (p) => {
        const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json");
        const [invalid] = byCode(payload(res.stdout), "delta.service-id-invalid");
        expect(invalid).toBeDefined();
        expect(invalid!.severity).toBe("error");
        expect(invalid!.subject).toBe("NUL");
        expect(invalid!.message).toContain("reserved device name on Windows");
        expect(res.code).toBe(1);
      },
    );
  });

  it.skipIf(process.platform === "win32")("specs/payments./ trips the trailing-dot branch", async () => {
    await withProject(
      {
        ...base,
        "features/FEAT-1-dot/intent.md": featureIntent(),
        "features/FEAT-1-dot/specs/payments./spec.md": featureSpec("payments."),
      },
      async (p) => {
        const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json");
        const [invalid] = byCode(payload(res.stdout), "delta.service-id-invalid");
        expect(invalid).toBeDefined();
        expect(invalid!.severity).toBe("error");
        expect(invalid!.subject).toBe("payments.");
        expect(invalid!.message).toContain("may not end with '.'");
        expect(res.code).toBe(1);
      },
    );
  });
});

/* ------------------------------------------------------------------ */
/* 4. c4.uncovered on an edge the delta merely re-declares             */
/* ------------------------------------------------------------------ */

const LIVING_EDGE_LANDSCAPE = landscape(`  checkoutWeb = softwareSystem 'checkout-web' {
    metadata { service 'checkout-web' }
  }
  paymentService = softwareSystem 'payment-service' {
    metadata { service 'payment-service' }
  }

  checkoutWeb -> paymentService 'Calls authorizePayment' {
    metadata { op 'authorizePayment' }
  }`);

const REDECLARING_DELTA = `specification {
  element softwareSystem
  tag FEAT-2
}

model {
  checkoutWeb = softwareSystem 'checkout-web'
  paymentService = softwareSystem 'payment-service'

  checkoutWeb -> paymentService 'Calls authorizePayment' {
    #FEAT-2
    metadata { op 'authorizePayment' }
  }
}
`;

describe("c4.uncovered is an obligation on NEW architecture only", () => {
  const base = {
    "architecture/landscape.likec4": LIVING_EDGE_LANDSCAPE,
    ...service("payment-service", "paymentService", ["authorizePayment"]),
    ...service("checkout-web", "checkoutWeb", []),
  };
  const feature = {
    "features/FEAT-2-record/intent.md": featureIntent().replace(/FEAT-1/, "FEAT-2"),
    "features/FEAT-2-record/delta.likec4": REDECLARING_DELTA,
    "features/FEAT-2-record/specs/payment-service/spec.md": `# payment-service — delta for FEAT-2

## ADDED Requirements

### Requirement: Record the authorization attempt
The service SHALL record every authorization attempt.

Operations: authorizePayment

#### Scenario: Attempt recorded
- **Given** an authorization request
- **When** it is handled
- **Then** the attempt is recorded
`,
  };

  it("an edge the living landscape already holds, re-declared verbatim, is not reported", async () => {
    await withProject({ ...base, ...feature }, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-2", "--json");
      // The two sides of the exemption used to join their key with different
      // separators, so this never matched and every delta was told to write a
      // decorative arch requirement for architecture it does not add.
      expect(byCode(payload(res.stdout), "c4.uncovered")).toEqual([]);
    });
  });

  it("an edge that is genuinely new still is", async () => {
    const files = { ...base, ...feature };
    files["features/FEAT-2-record/delta.likec4"] = REDECLARING_DELTA.replace(
      "  checkoutWeb -> paymentService 'Calls authorizePayment' {",
      "  ledger = softwareSystem 'ledger-service' {\n    #FEAT-2\n  }\n\n  paymentService -> ledger 'Calls postEntry' {",
    );
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-2", "--json");
      const uncovered = byCode(payload(res.stdout), "c4.uncovered");
      expect(uncovered.length).toBeGreaterThan(0);
      expect(uncovered.some((f) => f.message.includes("ledger-service"))).toBe(true);
    });
  });
});

/* ------------------------------------------------------------------ */
/* 7. --all runs concurrently and reports in one fixed order           */
/* ------------------------------------------------------------------ */

/** A fleet wide enough that the pool has more than one worker in flight. */
function fleet(n: number, features: number): Record<string, string> {
  const files: Record<string, string> = {};
  const body: string[] = [];
  for (let i = 1; i <= n; i += 1) {
    const id = `svc-${i}`;
    Object.assign(files, service(id, `svc${i}`, i > 1 ? [`op${i}`] : []));
    body.push(`  svc${i} = softwareSystem '${id}' {
    metadata { service '${id}' }
  }`);
  }
  for (let i = 2; i <= n; i += 1) {
    body.push(`  svc${i - 1} -> svc${i} 'Calls op${i}' {
    metadata { op 'op${i}' }
  }`);
  }
  files["architecture/landscape.likec4"] = landscape(body.join("\n"));
  for (let f = 1; f <= features; f += 1) {
    const dir = `features/FEAT-${f}-change`;
    files[`${dir}/intent.md`] = featureIntent().replace(/FEAT-1/, `FEAT-${f}`);
    files[`${dir}/specs/svc-${f + 1}/spec.md`] = `# svc-${f + 1} — delta for FEAT-${f}

## ADDED Requirements

### Requirement: Extra ${f}
The service SHALL do extra ${f}.

#### Scenario: Extra done
- **Given** a thing
- **When** it runs
- **Then** extra ${f} happens
`;
  }
  return files;
}

describe("--all is concurrent, and its output is not", () => {
  it("targets come back in input order: the landscape, services by id, then features by id", async () => {
    await withProject(fleet(9, 3), async (p) => {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      const out = payload(res.stdout);
      expect(out.targets.map((t) => `${t.kind}:${t.id}`)).toEqual([
        "landscape:landscape",
        ...Array.from({ length: 9 }, (_, i) => `service:svc-${i + 1}`),
        ...Array.from({ length: 3 }, (_, i) => `feature:FEAT-${i + 1}`),
      ]);
    });
  });

  it("repeated runs over one tree are byte-identical, in JSON and in text", async () => {
    await withProject(fleet(9, 3), async (p) => {
      const runs = [];
      for (let i = 0; i < 3; i += 1) {
        runs.push(await runLoam(p.workDir, "validate", "--all", "--json"));
        runs.push(await runLoam(p.workDir, "validate", "--all"));
      }
      const json = runs.filter((_, i) => i % 2 === 0).map((r) => r.stdout);
      const text = runs.filter((_, i) => i % 2 === 1).map((r) => r.stdout);
      // Not a probabilistic assertion about scheduling: results are written by
      // index, so a slow target cannot reorder the fleet around it.
      expect(new Set(json).size).toBe(1);
      expect(new Set(text).size).toBe(1);
    });
  });

  it("a target that throws is still reported in its own place, not at the end", async () => {
    const files = fleet(6, 0);
    // svc-4's model is a directory, so loading it raises EISDIR inside the pool.
    delete files["services/svc-4/model.likec4"];
    files["services/svc-4/model.likec4/keep"] = "";
    await withProject(files, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      const out = payload(res.stdout);
      expect(out.targets.map((t) => t.id)).toEqual([
        "landscape",
        ...Array.from({ length: 6 }, (_, i) => `svc-${i + 1}`),
      ]);
      expect(codes(target(out, "svc-4"))).toContain("service.unreadable");
      expect(res.code).toBe(1);
    });
  });
});
