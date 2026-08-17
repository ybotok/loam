/**
 * The fleet gate: what `loam validate`, `loam list` and `loam show` are allowed
 * to stay silent about.
 *
 * These three commands are the whole surface a shared docs repo has — one is
 * its CI gate, two are how anybody looks at it — and every failure pinned here
 * is the same failure wearing a different hat: the command answered a question
 * it could not answer, in the words it uses for "checked, fine".
 *
 *  - a docsDir that does not exist reported an empty, valid fleet;
 *  - a docs repo with NO landscape.likec4 skipped the fleet cross-check rather
 *    than failing it, so the one artifact everything derives from could be
 *    missing entirely and CI stayed green;
 *  - an edge drawn into a modelled CONTAINER resolved to the container's title,
 *    so container-level calls left the C4↔API spine without a word;
 *  - one syntax error in the landscape printed its whole diagnostic cascade
 *    once per service, making the output grow with the fleet;
 *  - a living `Operations:` line was never resolved against the service's own
 *    OpenAPI — only feature deltas were checked, so a typo that shipped was
 *    green forever;
 *  - one unreadable file aborted the run and reported nothing about the other
 *    ninety-nine services;
 *  - `sources` that only another repo can resolve were counted under --all and
 *    invisible in single-service scope, which is how anyone actually looks;
 *  - the maturity ladder demanded an openapi.yaml of workers that have no HTTP
 *    surface, pinning their documentation state at `partial` forever;
 *  - `show` and `list` could not see arch.spec.md at all, so the architecture
 *    axis was unnavigable;
 *  - a positional argument that named both a service and a feature silently
 *    picked one, and an empty spec.md scored a green tick.
 */
import { describe, expect, it } from "vitest";
import { chmod, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  makeProject,
  makeTmpDir,
  runLoam,
  writeFiles,
  type Project,
} from "./helpers/harness.js";

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

const findings = (targets: Target[]): Finding[] => targets.flatMap((t) => t.findings);
const codesIn = (targets: Target[]): string[] => findings(targets).map((f) => f.code);
const target = (targets: Target[], id: string): Target => targets.find((t) => t.id === id)!;

/* ------------------------------------------------------------------ */
/* Fixture builders                                                    */
/* ------------------------------------------------------------------ */

function landscape(body: string): string {
  return `specification {
  element softwareSystem
  element container
  element person
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

/** A one-element per-service C4 model, bound to its directory. */
function serviceModel(id: string, ident: string): string {
  return `specification {
  element softwareSystem
}

model {
  ${ident} = softwareSystem '${id}' {
    metadata { service '${id}' }
  }
}

views {
  view of ${ident} {
    include *
  }
}
`;
}

interface SpecOptions {
  ops?: string[];
  sources?: string[];
  status?: string;
  digest?: string;
  requirement?: string;
}

function livingSpec(service: string, opts: SpecOptions = {}): string {
  const fm = [
    `service: ${service}`,
    `owner: team-${service}`,
    `status: ${opts.status ?? "draft"}`,
    ...(opts.sources ? ["sources:", ...opts.sources.map((s) => `  - ${s}`)] : []),
    ...(opts.digest ? [`sources_digest: ${opts.digest}`] : []),
  ].join("\n");
  const ops = opts.ops && opts.ops.length > 0 ? `\nOperations: ${opts.ops.join(", ")}\n` : "";
  return `---
${fm}
---

# ${service}

## Requirements

### Requirement: ${opts.requirement ?? "Do the thing"}
The service SHALL do the thing.
${ops}
#### Scenario: It is done
- **Given** a thing
- **When** it runs
- **Then** it is done
`;
}

function openapi(service: string, ops: string[]): string {
  const paths = ops
    .map(
      (op) => `  /${op}:
    post:
      operationId: ${op}
      responses:
        "200":
          description: ok`,
    )
    .join("\n");
  return `openapi: 3.1.0
info:
  title: ${service}
  version: "1.0"
paths:
${paths}
`;
}

/** A minimal complete service: model + spec + openapi, with one op. */
function service(id: string, ident: string, op: string): Record<string, string> {
  return {
    [`services/${id}/model.likec4`]: serviceModel(id, ident),
    [`services/${id}/spec.md`]: livingSpec(id, { ops: [op] }),
    [`services/${id}/openapi.yaml`]: openapi(id, [op]),
  };
}

/* ------------------------------------------------------------------ */
/* 1. A docsDir that is not a docs repo refuses; only a REAL empty one */
/*    is allowed to report zero services                               */
/* ------------------------------------------------------------------ */

/** A workdir whose loam.json names `docsDir` exactly as written — relative stays relative. */
async function workdirWith(docsDir: string): Promise<string> {
  const root = await makeTmpDir("fleet-gate-");
  await writeFiles(root, { "loam.json": JSON.stringify({ docsDir }, null, 2) + "\n" });
  return root;
}

describe("a docsDir that is not a docs repo is a refusal, never an empty fleet", () => {
  it("validate --all --strict on a docsDir that does not exist fails with docs-missing and no verdict", async () => {
    const dir = await workdirWith("./does-not-exist");
    try {
      const res = await runLoam(dir, "validate", "--all", "--strict", "--json");
      expect(res.code).toBe(1);
      const payload = JSON.parse(res.stdout);
      expect(payload.ok).toBe(false);
      expect(payload.error.code).toBe("docs-missing");
      // The one thing that must NOT be there: a verdict. "valid: true over zero
      // services" is the output this whole gate exists to make unreachable.
      expect(payload.valid).toBeUndefined();
      expect(payload.summary).toBeUndefined();
      expect(payload.error.message).toContain("does-not-exist");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("a directory with no services/ is services-missing, not a fleet of zero", async () => {
    const dir = await workdirWith("./docs");
    try {
      await mkdir(join(dir, "docs", "architecture"), { recursive: true });
      const res = await runLoam(dir, "validate", "--all", "--json");
      expect(res.code).toBe(1);
      const payload = JSON.parse(res.stdout);
      expect(payload.error.code).toBe("services-missing");
      expect(payload.valid).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("a REAL empty docs repo still validates green with zero services", async () => {
    // The state that must stay reachable: a docs repo before its first adopt.
    await withProject({ "services/.keep": "", "architecture/landscape.likec4": landscape("") }, {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(res.code).toBe(0);
      const payload = JSON.parse(res.stdout);
      expect(payload.valid).toBe(true);
      expect(payload.summary.services).toBe(0);
    });
  });

  it("list refuses the same two states with the same two codes", async () => {
    const missing = await workdirWith("./nope");
    try {
      const res = await runLoam(missing, "list", "--json");
      expect(res.code).toBe(1);
      expect(JSON.parse(res.stdout).error.code).toBe("docs-missing");
      // and the services table is absent, not empty
      expect(JSON.parse(res.stdout).services).toBeUndefined();
    } finally {
      await rm(missing, { recursive: true, force: true });
    }

    const noServices = await workdirWith("./docs");
    try {
      await mkdir(join(noServices, "docs"), { recursive: true });
      const res = await runLoam(noServices, "list", "--json");
      expect(res.code).toBe(1);
      expect(JSON.parse(res.stdout).error.code).toBe("services-missing");
    } finally {
      await rm(noServices, { recursive: true, force: true });
    }
  });

  it("show refuses a docsDir that does not exist instead of reporting 'no such target'", async () => {
    const dir = await workdirWith("./nope");
    try {
      const res = await runLoam(dir, "show", "payment-service", "--json");
      expect(res.code).toBe(1);
      expect(JSON.parse(res.stdout).error.code).toBe("docs-missing");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

/* ------------------------------------------------------------------ */
/* 2. An absent landscape is a finding, not a skipped check            */
/* ------------------------------------------------------------------ */

describe("a missing architecture/landscape.likec4", () => {
  it("fails validate --all with landscape.missing when services exist, and names the file", async () => {
    await withProject(service("payment-service", "paymentService", "authorize"), {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(res.code).toBe(1);
      const targets = JSON.parse(res.stdout).targets as Target[];
      const f = findings(targets).find((x) => x.code === "landscape.missing")!;
      expect(f.severity).toBe("error");
      expect(f.message).toContain("architecture/landscape.likec4");
      // and it says what to put in it, not merely that it is gone
      expect(f.message).toContain("metadata { service");
    });
  });

  it("hands back to the ordinary cross-check the moment a stub exists", async () => {
    const files = service("payment-service", "paymentService", "authorize");
    files["architecture/landscape.likec4"] = landscape("  other = softwareSystem 'other-service'");
    await withProject(files, {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(res.code).toBe(1);
      const codes = codesIn(JSON.parse(res.stdout).targets);
      expect(codes).not.toContain("landscape.missing");
      expect(codes).toContain("landscape.service-unmodelled");
    });
  });
});

/* ------------------------------------------------------------------ */
/* 3. An edge into a container is an edge into its service             */
/* ------------------------------------------------------------------ */

/** A landscape whose payment-service is drawn with an `api` container. */
const CONTAINER_LANDSCAPE = landscape(`  checkoutWeb = softwareSystem 'checkout-web' {
    metadata { service 'checkout-web' }
  }
  paymentService = softwareSystem 'payment-service' {
    metadata { service 'payment-service' }
    api = container 'api'
  }

  checkoutWeb -> paymentService.api 'Calls ghost' {
    metadata { op 'ghost' }
  }`);

describe("the C4↔API spine follows edges drawn into containers", () => {
  it("grades an op-edge into paymentService.api against payment-service's OpenAPI", async () => {
    const files = {
      ...service("payment-service", "paymentService", "authorize"),
      ...service("checkout-web", "checkoutWeb", "render"),
      "architecture/landscape.likec4": CONTAINER_LANDSCAPE,
    };
    await withProject(files, {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(res.code).toBe(1);
      const payment = target(JSON.parse(res.stdout).targets, "payment-service");
      const f = payment.findings.find((x) => x.code === "spine.op-undefined")!;
      expect(f.severity).toBe("error");
      expect(f.message).toContain("'ghost'");
      // the source resolves to the service too, not to a bare element id
      expect(f.message).toContain("checkout-web → payment-service");
    });
  });

  it("stops suppressing service.no-openapi for a service only called through a container", async () => {
    const files = {
      ...service("payment-service", "paymentService", "authorize"),
      ...service("checkout-web", "checkoutWeb", "render"),
      "architecture/landscape.likec4": CONTAINER_LANDSCAPE,
    };
    // The whole point: the contract is gone, and an inbound op-edge exists —
    // it is just drawn one level down. The grace must not fire.
    delete files["services/payment-service/openapi.yaml"];
    files["services/payment-service/spec.md"] = livingSpec("payment-service");
    await withProject(files, {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      const payment = target(JSON.parse(res.stdout).targets, "payment-service");
      expect(payment.findings.map((f) => f.code)).toContain("service.no-openapi");
    });
  });

  it("still keeps quiet for a service nothing calls at all", async () => {
    const files = {
      ...service("checkout-web", "checkoutWeb", "render"),
      "services/worker-service/model.likec4": serviceModel("worker-service", "workerService"),
      "services/worker-service/spec.md": livingSpec("worker-service"),
      "architecture/landscape.likec4": landscape(`  checkoutWeb = softwareSystem 'checkout-web' {
    metadata { service 'checkout-web' }
  }
  workerService = softwareSystem 'worker-service' {
    metadata { service 'worker-service' }
  }`),
    };
    await withProject(files, {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      const worker = target(JSON.parse(res.stdout).targets, "worker-service");
      expect(worker.findings.map((f) => f.code)).not.toContain("service.no-openapi");
    });
  });
});

/* ------------------------------------------------------------------ */
/* 4. One parse error, printed once                                    */
/* ------------------------------------------------------------------ */

const BROKEN_LANDSCAPE = `specification {
  element softwareSystem
}

model {
  a = bogusKind 'a'
  b = alsoBogus 'b'
  a -> b 'nope'
}
`;

describe("a landscape that does not parse", () => {
  /** Ten services, one broken fleet map — the shape a single typo takes in CI. */
  function tenServices(): Record<string, string> {
    const files: Record<string, string> = { "architecture/landscape.likec4": BROKEN_LANDSCAPE };
    for (let i = 1; i <= 10; i += 1) {
      Object.assign(files, service(`svc-${i}`, `svc${i}`, `op${i}`));
    }
    return files;
  }

  it("reports the parser output exactly once, and keeps the report proportionate", async () => {
    await withProject(tenServices(), {}, async (p) => {
      const text = await runLoam(p.workDir, "validate", "--all");
      expect(text.code).toBe(1);
      expect(text.out.split("\n").length).toBeLessThan(200);

      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(res.stdout.length).toBeLessThan(64 * 1024);
      const targets = JSON.parse(res.stdout).targets as Target[];

      // The parse diagnostics ride the landscape target and nowhere else.
      const withDetails = findings(targets).filter(
        (f) => (f.code === "landscape.invalid" || f.code === "spine.landscape-invalid") && f.details.length > 0,
      );
      expect(withDetails).toHaveLength(1);
      expect(withDetails[0]!.code).toBe("landscape.invalid");

      // Every service still says the spine could not run — the fact is not lost,
      // only the ten copies of the parser's cascade are.
      const perService = findings(targets).filter((f) => f.code === "spine.landscape-invalid");
      expect(perService).toHaveLength(10);
      expect(perService[0]!.message).toContain("reported once, on the landscape target");
    });
  });

  it("keeps the details in single-service scope, where no landscape target carries them", async () => {
    await withProject(tenServices(), {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", "svc-1", "--json");
      const f = findings(JSON.parse(res.stdout).targets).find(
        (x) => x.code === "spine.landscape-invalid",
      )!;
      expect(f.details.length).toBeGreaterThan(0);
    });
  });

  it("caps any one finding's details, marking what it dropped", async () => {
    // Twenty requirements with no scenario: the details array is the list of
    // names, and an uncapped one is the whole report for one service.
    const names = Array.from({ length: 20 }, (_, i) => `Requirement ${i}`);
    const body = names.map((n) => `### Requirement: ${n}\nThe service SHALL do it.\n`).join("\n");
    const files = service("payment-service", "paymentService", "authorize");
    files["services/payment-service/spec.md"] = `# payment-service\n\n## Requirements\n\n${body}`;
    await withProject(files, {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", "payment-service", "--json");
      const f = findings(JSON.parse(res.stdout).targets).find(
        (x) => x.code === "requirements.missing-scenarios",
      )!;
      expect(f.details).toHaveLength(11);
      expect(f.details[10]).toBe("… (+10 more)");
    });
  });
});

/* ------------------------------------------------------------------ */
/* 5. `Operations:` on a living requirement resolves                   */
/* ------------------------------------------------------------------ */

describe("a living Operations: line is resolved against the service's own OpenAPI", () => {
  it("raises spec-api.op-undefined and offers the near miss", async () => {
    const files = {
      "services/payment-service/model.likec4": serviceModel("payment-service", "paymentService"),
      "services/payment-service/spec.md": livingSpec("payment-service", { ops: ["doXX"] }),
      "services/payment-service/openapi.yaml": openapi("payment-service", ["doX"]),
    };
    await withProject(files, { service: "payment-service" }, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--json");
      expect(res.code).toBe(1);
      const f = findings(JSON.parse(res.stdout).targets).find(
        (x) => x.code === "spec-api.op-undefined",
      )!;
      expect(f.severity).toBe("error");
      expect(f.message).toContain("doXX");
      expect(f.message).toContain("Did you mean: doX?");
    });
  });

  it("stays quiet when the contract itself does not parse — an unreadable file proves nothing", async () => {
    const files = {
      "services/payment-service/model.likec4": serviceModel("payment-service", "paymentService"),
      "services/payment-service/spec.md": livingSpec("payment-service", { ops: ["doXX"] }),
      "services/payment-service/openapi.yaml": "openapi: 3.1.0\npaths:\n  - [unbalanced\n",
    };
    await withProject(files, { service: "payment-service" }, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--json");
      const codes = codesIn(JSON.parse(res.stdout).targets);
      expect(codes).toContain("openapi.invalid");
      expect(codes).not.toContain("spec-api.op-undefined");
    });
  });
});

/* ------------------------------------------------------------------ */
/* 6. One unreadable file does not zero the fleet report               */
/* ------------------------------------------------------------------ */

describe("an unreadable artifact", () => {
  it("is one service's error, and every other service is still graded", async () => {
    const files = {
      ...service("svc-a", "svcA", "opA"),
      ...service("svc-b", "svcB", "opB"),
      "architecture/landscape.likec4": landscape(`  svcA = softwareSystem 'svc-a' {
    metadata { service 'svc-a' }
  }
  svcB = softwareSystem 'svc-b' {
    metadata { service 'svc-b' }
  }`),
    };
    await withProject(files, {}, async (p) => {
      const model = join(p.docsDir, "services", "svc-a", "model.likec4");
      await chmod(model, 0o000);
      try {
        const res = await runLoam(p.workDir, "validate", "--all", "--json");
        const payload = JSON.parse(res.stdout);
        // Running as root ignores the mode bits; there is nothing to test then.
        const targets = payload.targets as Target[] | undefined;
        if (targets === undefined || !codesIn(targets).includes("service.unreadable")) return;

        expect(res.code).toBe(1);
        expect(payload.ok).toBe(true);
        expect(res.stdout).not.toContain('"internal"');

        const f = target(targets, "svc-a").findings.find((x) => x.code === "service.unreadable")!;
        expect(f.severity).toBe("error");
        expect(f.message).toContain("model.likec4");

        // svc-b is reported in full — the run did not stop at svc-a
        const b = target(targets, "svc-b");
        expect(b.valid).toBe(true);
        expect(b.findings.map((x) => x.code)).toContain("c4.valid");
      } finally {
        await chmod(model, 0o644);
      }
    });
  });

  /**
   * The one artifact whose unreadability cannot be localised: the enumeration
   * reads every living spec's frontmatter to build the service list, so without
   * it there IS no list and nothing was checked. What must never happen is the
   * old behaviour — an escaping exception, `internal` in the envelope, no file
   * named.
   */
  it("names the file when the failure is in the enumeration itself, instead of throwing", async () => {
    await withProject(service("svc-a", "svcA", "opA"), {}, async (p) => {
      const spec = join(p.docsDir, "services", "svc-a", "spec.md");
      await chmod(spec, 0o000);
      try {
        for (const argv of [
          ["list", "services", "--json"],
          ["validate", "--all", "--json"],
        ]) {
          const res = await runLoam(p.workDir, ...argv);
          if (res.code === 0) return; // root: the mode bits mean nothing
          const payload = JSON.parse(res.stdout);
          expect(payload.error.code).toBe("repository-unavailable");
          expect(payload.error.message).toContain("spec.md");
        }
      } finally {
        await chmod(spec, 0o644);
      }
    });
  });
});

/* ------------------------------------------------------------------ */
/* 7. Provenance is visible in single-service scope too                */
/* ------------------------------------------------------------------ */

describe("sources loam cannot resolve from here", () => {
  it("says so on the service itself, not only in the --all rollup", async () => {
    const files = service("payment-service", "paymentService", "authorize");
    files["services/payment-service/spec.md"] = livingSpec("payment-service", {
      ops: ["authorize"],
      sources: ["src/payment.ts"],
    });
    // No `service` in loam.json: this is the docs repo, not payment-service's.
    await withProject(files, {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", "payment-service", "--json");
      const payload = JSON.parse(res.stdout);
      const f = findings(payload.targets).find(
        (x) => x.code === "sources.unverifiable-from-here",
      )!;
      // `ok`, not a warning: nothing is wrong with the docs — the check simply
      // cannot run here, and a permanently-yellow fleet gate teaches nothing.
      expect(f.severity).toBe("ok");
      expect(f.message).toContain("not payment-service's repository");
      expect(payload.sourcesUnverifiableFromHere).toBe(1);
      // and it does not gate, in either direction
      expect(res.code).toBe(0);
      expect(payload.valid).toBe(true);
    });
  });

  it("does not fire from inside the service's own repo — the check ran there", async () => {
    const files = service("payment-service", "paymentService", "authorize");
    files["services/payment-service/spec.md"] = livingSpec("payment-service", {
      ops: ["authorize"],
      sources: ["src/payment.ts"],
    });
    const p = await makeProject(files, { service: "payment-service" });
    try {
      await writeFiles(p.workDir, { "src/payment.ts": "// code\n" });
      const res = await runLoam(p.workDir, "validate", "--json");
      const codes = codesIn(JSON.parse(res.stdout).targets);
      expect(codes).not.toContain("sources.unverifiable-from-here");
      expect(codes).toContain("sources.resolved");
    } finally {
      await p.destroy();
    }
  });
});

describe("a sources list that covers no files", () => {
  it("is graded by validate in the exact words vouch refuses with", async () => {
    const files = service("payment-service", "paymentService", "authorize");
    files["services/payment-service/spec.md"] = livingSpec("payment-service", {
      ops: ["authorize"],
      sources: ["src"],
    });
    const p = await makeProject(files, { service: "payment-service" });
    try {
      // The directory exists — so no `sources.path-missing` — and holds nothing.
      await mkdir(join(p.workDir, "src"), { recursive: true });

      const validated = await runLoam(p.workDir, "validate", "--json");
      const f = findings(JSON.parse(validated.stdout).targets).find(
        (x) => x.code === "sources.empty",
      )!;
      expect(f.severity).toBe("warn");

      const vouched = await runLoam(p.workDir, "vouch", "--yes", "--json");
      expect(vouched.code).toBe(1);
      const refusal = JSON.parse(vouched.stdout);
      expect(refusal.error.code).toBe("sources-absent");
      // One diagnosis, one sentence: a green validate followed by a refusal
      // nobody could have predicted is what this closes.
      expect(refusal.error.message).toBe(f.message);
    } finally {
      await p.destroy();
    }
  });
});

/* ------------------------------------------------------------------ */
/* 8. The maturity ladder asks for an API only where one is expected   */
/* ------------------------------------------------------------------ */

describe("the maturity ladder", () => {
  /** A worker: fully documented, vouched, and nothing in the fleet calls it. */
  function workerFleet(): Record<string, string> {
    return {
      "services/worker-service/model.likec4": serviceModel("worker-service", "workerService"),
      "services/worker-service/spec.md": livingSpec("worker-service", {
        sources: ["src/worker.ts"],
        status: "verified",
        digest: "0123456789abcdef",
      }),
      "architecture/landscape.likec4": landscape(`  workerService = softwareSystem 'worker-service' {
    metadata { service 'worker-service' }
  }`),
    };
  }

  it("calls an API-less worker `vouched`, not `partial`", async () => {
    await withProject(workerFleet(), {}, async (p) => {
      const json = JSON.parse((await runLoam(p.workDir, "list", "--json")).stdout);
      const worker = json.services.find((s: { id: string }) => s.id === "worker-service");
      expect(worker.maturity).toBe("vouched");
      expect(worker.apiExpected).toBe(false);
      expect(worker.missing).toEqual([]);
    });
  });

  it("keeps a called service without an openapi.yaml at `partial`", async () => {
    const files = {
      ...workerFleet(),
      "services/gateway/model.likec4": serviceModel("gateway", "gateway"),
      "services/gateway/spec.md": livingSpec("gateway"),
    };
    files["architecture/landscape.likec4"] = landscape(`  gateway = softwareSystem 'gateway' {
    metadata { service 'gateway' }
  }
  workerService = softwareSystem 'worker-service' {
    metadata { service 'worker-service' }
    api = container 'api'
  }

  gateway -> workerService.api 'Calls enqueue' {
    metadata { op 'enqueue' }
  }`);
    await withProject(files, {}, async (p) => {
      const json = JSON.parse((await runLoam(p.workDir, "list", "--json")).stdout);
      const byId = new Map(
        (json.services as Array<{ id: string; maturity: string; missing: string[] }>).map((s) => [
          s.id,
          s,
        ]),
      );
      // The op-edge lands on a CONTAINER of worker-service, and it still counts.
      expect(byId.get("worker-service")!.maturity).toBe("partial");
      expect(byId.get("worker-service")!.missing).toEqual(["openapi.yaml"]);
    });
  });

  it("prints the rung per service, not only in the rollup", async () => {
    await withProject(workerFleet(), {}, async (p) => {
      const res = await runLoam(p.workDir, "list", "services");
      const line = res.out.split("\n").find((l) => l.includes("worker-service"))!;
      expect(line).toContain("vouched");
    });
  });
});

/* ------------------------------------------------------------------ */
/* 9. show and list can see arch.spec.md                               */
/* ------------------------------------------------------------------ */

const ARCH_SPEC = `---
service: payment-service
owner: payments-team
status: draft
---

# payment-service — architecture

## Requirements

### Requirement: Outbox delivery
Every state change SHALL be published through the transactional outbox.

Covers: paymentService

#### Scenario: A publish failure is retried
- **Given** the broker is down
- **When** a state change is written
- **Then** the outbox retries it

### Requirement: Authorization latency
The p99 of authorization SHALL stay under 300ms.

#### Scenario: Under load
- **Given** peak traffic
- **When** authorization runs
- **Then** p99 stays under 300ms
`;

describe("the architecture axis is navigable", () => {
  it("show --json carries arch.spec.md's counts and its requirements", async () => {
    const files = service("payment-service", "paymentService", "authorize");
    files["services/payment-service/arch.spec.md"] = ARCH_SPEC;
    files["services/payment-service/adrs/0001-outbox.md"] = "# ADR 1\n";
    await withProject(files, {}, async (p) => {
      const json = JSON.parse((await runLoam(p.workDir, "show", "payment-service", "--json")).stdout);
      expect(json.has.archSpec).toBe(true);
      expect(json.archSpec.requirements).toBe(2);
      expect(json.archSpec.scenarios).toBe(2);
      expect(json.archSpec.entries[0].name).toBe("Outbox delivery");
      // the Covers: line is what makes the axis traceable — it must survive
      expect(json.archSpec.entries[0].covers).toEqual(["paymentService"]);
      expect(json.adrs).toBe(1);
    });
  });

  it("show's human view lists arch requirements and the decision count", async () => {
    const files = service("payment-service", "paymentService", "authorize");
    files["services/payment-service/arch.spec.md"] = ARCH_SPEC;
    files["services/payment-service/adrs/0001-outbox.md"] = "# ADR 1\n";
    await withProject(files, {}, async (p) => {
      const res = await runLoam(p.workDir, "show", "payment-service");
      expect(res.out).toContain("arch.spec.md");
      expect(res.out).toContain("arch requirements");
      expect(res.out).toContain("Outbox delivery");
      expect(res.out).toContain("1 decision");
    });
  });

  it("list --json and the legend both admit arch.spec.md exists", async () => {
    const files = service("payment-service", "paymentService", "authorize");
    files["services/payment-service/arch.spec.md"] = ARCH_SPEC;
    await withProject(files, {}, async (p) => {
      const json = JSON.parse((await runLoam(p.workDir, "list", "services", "--json")).stdout);
      expect(json.services[0].has.archSpec).toBe(true);

      const text = await runLoam(p.workDir, "list", "services");
      expect(text.out).toContain("[a]rch-spec");
      expect(text.out.split("\n").find((l) => l.includes("payment-service"))).toContain("M S a A");
    });
  });

  it("show reports an unreadable openapi.yaml instead of an empty operation list", async () => {
    const files = service("payment-service", "paymentService", "authorize");
    files["services/payment-service/openapi.yaml"] = "openapi: 3.1.0\npaths:\n  - [unbalanced\n";
    await withProject(files, {}, async (p) => {
      const json = JSON.parse((await runLoam(p.workDir, "show", "payment-service", "--json")).stdout);
      expect(json.openapi.unreadable).toBe(true);
      expect(json.openapi.error).toBeDefined();
      expect(json.operations).toEqual([]);

      const text = await runLoam(p.workDir, "show", "payment-service");
      expect(text.out).toContain("does not parse");
    });
  });

  it("hides x-loam-remove markers from the operation list — they are deletions, not endpoints", async () => {
    const files = service("payment-service", "paymentService", "authorize");
    files["services/payment-service/openapi.yaml"] = openapi("payment-service", [
      "authorize",
    ]).replace("      operationId: authorize\n", "      operationId: authorize\n      x-loam-remove: true\n");
    await withProject(files, {}, async (p) => {
      const json = JSON.parse((await runLoam(p.workDir, "show", "payment-service", "--json")).stdout);
      expect(json.operations).toEqual([]);
      expect(json.openapi.unreadable).toBe(false);
    });
  });
});

/* ------------------------------------------------------------------ */
/* 10. A working fleet worklist, and proportionate output              */
/* ------------------------------------------------------------------ */

describe("output sized to the question being asked", () => {
  /** Ten clean services, one landscape drawing all of them, nothing called. */
  function cleanFleet(): Record<string, string> {
    const files: Record<string, string> = {};
    const body: string[] = [];
    for (let i = 1; i <= 10; i += 1) {
      files[`services/svc-${i}/model.likec4`] = serviceModel(`svc-${i}`, `svc${i}`);
      files[`services/svc-${i}/spec.md`] = livingSpec(`svc-${i}`, {
        sources: [`src/svc${i}.ts`],
        status: "verified",
        digest: "0123456789abcdef",
      });
      body.push(`  svc${i} = softwareSystem 'svc-${i}' {
    metadata { service 'svc-${i}' }
  }`);
    }
    files["architecture/landscape.likec4"] = landscape(body.join("\n"));
    return files;
  }

  it("validate --all --errors-only prints the summary and nothing else on a clean fleet", async () => {
    await withProject(cleanFleet(), {}, async (p) => {
      const full = await runLoam(p.workDir, "validate", "--all");
      const quiet = await runLoam(p.workDir, "validate", "--all", "--errors-only");
      expect(quiet.code).toBe(0);
      expect(full.code).toBe(0);
      // Only the blank line + the summary + the unverifiable rollup survive.
      const lines = quiet.out.split("\n").filter((l) => l.trim() !== "");
      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain("10 services, 0 features");
      expect(quiet.out.length).toBeLessThan(full.out.length);
    });
  });

  it("--errors-only is a rendering lever: the --json payload is untouched", async () => {
    await withProject(cleanFleet(), {}, async (p) => {
      const plain = await runLoam(p.workDir, "validate", "--all", "--json");
      const quiet = await runLoam(p.workDir, "validate", "--all", "--errors-only", "--json");
      expect(quiet.stdout).toBe(plain.stdout);
    });
  });

  it("list --needs-work names exactly the unfinished services and why", async () => {
    const files = cleanFleet();
    // svc-3 never got a spec; svc-7 has one but nobody declared its sources.
    delete files["services/svc-3/spec.md"];
    files["services/svc-7/spec.md"] = livingSpec("svc-7");
    await withProject(files, {}, async (p) => {
      const res = await runLoam(p.workDir, "list", "--needs-work");
      expect(res.code).toBe(0);
      const lines = res.out.split("\n").filter((l) => l.startsWith("  "));
      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain("svc-3");
      expect(lines[0]).toContain("partial");
      expect(lines[0]).toContain("missing: spec.md");
      expect(lines[1]).toContain("svc-7");
      expect(lines[1]).toContain("documented");
      expect(lines[1]).toContain("sources");
      expect(res.out).toContain("2 of 10 service(s) need work");
    });
  });

  it("marks a service whose provenance cannot be judged from here, instead of dropping it", async () => {
    const files = cleanFleet();
    files["services/svc-4/spec.md"] = livingSpec("svc-4", { sources: ["src/svc4.ts"] });
    await withProject(files, {}, async (p) => {
      const res = await runLoam(p.workDir, "list", "--needs-work");
      const line = res.out.split("\n").find((l) => l.includes("svc-4"))!;
      expect(line).toContain("sourced");
      expect(line).toContain("provenance: unverifiable-from-here");

      const json = JSON.parse((await runLoam(p.workDir, "list", "--needs-work", "--json")).stdout);
      const svc4 = json.services.find((s: { id: string }) => s.id === "svc-4");
      expect(svc4.provenance).toBe("unverifiable-from-here");
    });
  });

  it("says so plainly when there is nothing left to do", async () => {
    const p = await makeProject(cleanFleet(), { service: "svc-1" });
    try {
      const res = await runLoam(p.workDir, "list", "--needs-work");
      expect(res.out).toContain("nothing to do");
      expect(res.out).toContain("all 10 service(s) are vouched");
    } finally {
      await p.destroy();
    }
  });
});

/* ------------------------------------------------------------------ */
/* 11. Small honesties                                                 */
/* ------------------------------------------------------------------ */

describe("a positional argument that names two different things", () => {
  it("warns target.ambiguous and reports which reading it took", async () => {
    const files = {
      ...service("billing-7", "billing7", "charge"),
      "architecture/landscape.likec4": landscape(`  billing7 = softwareSystem 'billing-7' {
    metadata { service 'billing-7' }
  }`),
      "features/billing-7/intent.md": "---\nfeature: billing-7\nstatus: proposed\n---\n\n# billing\n",
    };
    await withProject(files, {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "billing-7", "--json");
      const payload = JSON.parse(res.stdout);
      expect(payload.resolvedKind).toBe("feature");
      const f = findings(payload.targets).find((x) => x.code === "target.ambiguous")!;
      expect(f.severity).toBe("warn");
      expect(f.message).toContain("--service billing-7");
    });
  });

  it("stays silent when only one reading exists", async () => {
    await withProject(service("payment-service", "paymentService", "authorize"), {}, async (p) => {
      const payload = JSON.parse(
        (await runLoam(p.workDir, "validate", "payment-service", "--json")).stdout,
      );
      expect(payload.resolvedKind).toBe("service");
      expect(codesIn(payload.targets)).not.toContain("target.ambiguous");
    });
  });
});

describe("a living spec with nothing written in it", () => {
  it("warns spec.no-requirements instead of ticking 'requirements covered (0 requirements)'", async () => {
    const files = service("payment-service", "paymentService", "authorize");
    files["services/payment-service/spec.md"] =
      "---\nservice: payment-service\nowner: payments-team\nstatus: draft\n---\n\n# payment-service\n\n## Requirements\n";
    await withProject(files, {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--service", "payment-service", "--json");
      const codes = codesIn(JSON.parse(res.stdout).targets);
      expect(codes).toContain("spec.no-requirements");
      expect(codes).not.toContain("requirements.covered");
      // a warning, not a gate: half the fleet looks like this mid-adoption
      expect(res.code).toBe(0);
    });
  });
});

describe("two landscape elements standing for one service", () => {
  it("warns landscape.binding-duplicate — the element→service join would pick one at random", async () => {
    const files = {
      ...service("x", "x", "opX"),
      "architecture/landscape.likec4": landscape(`  xOne = softwareSystem 'X one' {
    metadata { service 'x' }
  }
  xTwo = softwareSystem 'X two' {
    metadata { service 'x' }
  }`),
    };
    await withProject(files, {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      const f = findings(JSON.parse(res.stdout).targets).find(
        (x) => x.code === "landscape.binding-duplicate",
      )!;
      expect(f.severity).toBe("warn");
      expect(f.subject).toBe("x");
      expect(f.message).toContain("xOne");
      expect(f.message).toContain("xTwo");
    });
  });
});

describe("c4.uncovered is an obligation on NEW architecture", () => {
  it("does not fire for a tagged element the living landscape already resolves", async () => {
    const files = {
      ...service("payment-service", "paymentService", "authorize"),
      "architecture/landscape.likec4": landscape(`  paymentService = softwareSystem 'payment-service' {
    metadata { service 'payment-service' }
  }`),
      // A requirements-only feature: it re-declares the element it touches (a
      // delta must, to attach anything to it) and tags it. Nothing is ADDED.
      "features/FEAT-9-tweak/delta.likec4": `specification {
  element softwareSystem
  tag FEAT-9
}

model {
  paymentService = softwareSystem 'payment-service' {
    #FEAT-9
    metadata { service 'payment-service' }
  }
}

views {
  view feat9 {
    include *
  }
}
`,
      "features/FEAT-9-tweak/intent.md":
        "---\nfeature: FEAT-9\nstatus: proposed\n---\n\n# tweak\n",
      "features/FEAT-9-tweak/specs/payment-service/spec.md": `# payment-service — delta

## MODIFIED Requirements

### Requirement: Do the thing
The service SHALL do the thing, faster.

#### Scenario: It is done
- **Given** a thing
- **When** it runs
- **Then** it is done quickly
`,
    };
    await withProject(files, {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-9", "--json");
      expect(codesIn(JSON.parse(res.stdout).targets)).not.toContain("c4.uncovered");
    });
  });

  it("still fires for an element the living landscape has never heard of", async () => {
    const files = {
      ...service("payment-service", "paymentService", "authorize"),
      "architecture/landscape.likec4": landscape(`  paymentService = softwareSystem 'payment-service' {
    metadata { service 'payment-service' }
  }`),
      "features/FEAT-8-new/delta.likec4": `specification {
  element softwareSystem
  tag FEAT-8
}

model {
  ledgerService = softwareSystem 'ledger-service' {
    #FEAT-8
  }
}

views {
  view feat8 {
    include *
  }
}
`,
      "features/FEAT-8-new/intent.md": "---\nfeature: FEAT-8\nstatus: proposed\n---\n\n# ledger\n",
    };
    await withProject(files, {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-8", "--json");
      expect(codesIn(JSON.parse(res.stdout).targets)).toContain("c4.uncovered");
    });
  });
});

/* ------------------------------------------------------------------ */

describe("the gate holds together on a fleet-shaped repo", () => {
  it("ten services, one landscape, one feature: green, and green means checked", async () => {
    const files: Record<string, string> = {};
    const body: string[] = [];
    for (let i = 1; i <= 10; i += 1) {
      Object.assign(files, service(`svc-${i}`, `svc${i}`, `op${i}`));
      body.push(`  svc${i} = softwareSystem 'svc-${i}' {
    metadata { service 'svc-${i}' }
    api = container 'api'
  }`);
    }
    for (let i = 2; i <= 10; i += 1) {
      body.push(`  svc${i - 1} -> svc${i}.api 'Calls op${i}' {
    metadata { op 'op${i}' }
  }`);
    }
    files["architecture/landscape.likec4"] = landscape(body.join("\n"));
    await withProject(files, {}, async (p) => {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      const payload = JSON.parse(res.stdout);
      expect(payload.valid).toBe(true);
      expect(res.code).toBe(0);
      // Every container edge resolved — the spine actually ran on all nine.
      const resolved = findings(payload.targets).filter((f) => f.code === "spine.resolved");
      expect(resolved).toHaveLength(9);
    });
  });
});


