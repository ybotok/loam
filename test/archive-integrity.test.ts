/**
 * `loam archive` is the only destructive command and the only one that writes
 * the shared source of truth. Everything here is a way the living docs used to
 * lose content with exit 0 and a green `validate` afterwards — the worst shape a
 * failure can take, because nothing downstream can tell that anything is gone.
 *
 * The four families:
 *  - YAML aliases in an OpenAPI delta, which the merge read as "no paths" or as
 *    "replace this whole path item", dropping living operations either way;
 *  - two writers in one docs checkout, where the second plan was computed
 *    against bytes the first had already replaced;
 *  - a rollback that cleaned up with a recursive remove over a directory that
 *    had become shared;
 *  - removals: an operation retired out from under a living consumer, a marker
 *    loam could not name, a path item left standing empty.
 */
import { chmod, rm, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { format } from "node:util";
import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { mergeOpenapiPaths } from "../src/core/openapi/merge/merge.js";
import { DOCS_LOCK } from "../src/core/staging/lock.js";
import { registerArchive } from "../src/commands/archive/archive.js";
import { coherentFixture, makeProject, runLoam, treeHashes, type Project } from "./helpers/harness.js";

const fsFault = vi.hoisted(() => ({
  onRename: undefined as undefined | ((from: string, to: string) => void),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: async (from: Parameters<typeof actual.rename>[0], to: Parameters<typeof actual.rename>[1]) => {
      fsFault.onRename?.(String(from), String(to));
      return actual.rename(from, to);
    },
  };
});

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

/** A living landscape where checkout-web calls two payment-service operations. */
const FLEET_LANDSCAPE = `specification {
  element softwareSystem
}

model {
  checkoutWeb = softwareSystem 'checkout-web' {
    description 'Customer-facing checkout UI'
  }
  paymentService = softwareSystem 'payment-service' {
    description 'Owns payment authorization and capture'
  }

  checkoutWeb -> paymentService 'Calls authorizePayment' {
    metadata { op 'authorizePayment' }
  }
  checkoutWeb -> paymentService 'Calls capturePayment' {
    metadata { op 'capturePayment' }
  }
}

views {
  view landscape {
    include *
  }
}
`;

/** The same landscape with the capturePayment edge deleted by hand. */
const FLEET_LANDSCAPE_NO_CAPTURE = FLEET_LANDSCAPE.replace(
  `  checkoutWeb -> paymentService 'Calls capturePayment' {
    metadata { op 'capturePayment' }
  }
`,
  "",
);

function serviceModel(id: string, variable: string): string {
  return `specification {
  element softwareSystem
  element container
}

model {
  ${variable} = softwareSystem '${id}' {
    api = container 'api'
  }
}

views {
  view of ${variable} {
    include *
  }
}
`;
}

const PAYMENT_SPEC = `---
service: payment-service
status: verified
---

# payment-service

## Requirements

### Requirement: Authorize a payment
The service SHALL authorize a payment before capture.

Operations: authorizePayment

#### Scenario: Successful authorization
- **Given** a valid card
- **When** authorization is requested
- **Then** the payment is authorized

### Requirement: Capture a payment
The service SHALL capture an authorized payment.

Operations: capturePayment

#### Scenario: Successful capture
- **Given** an authorized payment
- **When** capture is requested
- **Then** the funds are captured
`;

const PAYMENT_OPENAPI = `openapi: 3.1.0
info: { title: payment-service, version: "1.0" }
paths:
  /payments:
    post:
      operationId: authorizePayment
      responses: { "200": { description: ok } }
  /payments/capture:
    post:
      operationId: capturePayment
      responses: { "200": { description: ok } }
`;

const CHECKOUT_SPEC = `---
service: checkout-web
status: verified
---

# checkout-web

## Requirements

### Requirement: Take a payment at checkout
The UI SHALL take a payment when the customer confirms the order.

#### Scenario: Customer confirms
- **Given** a basket
- **When** the customer confirms
- **Then** a payment is taken
`;

/** Two living services, both fully documented, wired by the landscape above. */
function fleetFixture(landscape = FLEET_LANDSCAPE): Record<string, string> {
  return {
    "architecture/landscape.likec4": landscape,
    "services/payment-service/model.likec4": serviceModel("payment-service", "paymentService"),
    "services/payment-service/spec.md": PAYMENT_SPEC,
    "services/payment-service/openapi.yaml": PAYMENT_OPENAPI,
    "services/checkout-web/model.likec4": serviceModel("checkout-web", "checkoutWeb"),
    "services/checkout-web/spec.md": CHECKOUT_SPEC,
  };
}

/** A feature that retires capturePayment: REMOVED requirement + removal marker. */
function retireCapture(): Record<string, string> {
  return {
    "features/FEAT-50-retire-capture/specs/payment-service/spec.md": `# payment-service — delta for FEAT-50

## REMOVED Requirements

### Requirement: Capture a payment

Operations: capturePayment
`,
    "features/FEAT-50-retire-capture/specs/payment-service/openapi.yaml": `openapi: 3.1.0
paths:
  /payments/capture:
    post:
      operationId: capturePayment
      x-loam-remove: true
`,
  };
}

/** The living operationIds a service's contract defines right now. */
async function livingOps(p: Project, service: string): Promise<string[]> {
  if (!p.exists(`services/${service}/openapi.yaml`)) return [];
  const doc = parse(await p.read(`services/${service}/openapi.yaml`)) as {
    paths?: Record<string, Record<string, { operationId?: string }>>;
  };
  const out: string[] = [];
  for (const item of Object.values(doc.paths ?? {})) {
    for (const op of Object.values(item)) {
      if (typeof op?.operationId === "string") out.push(op.operationId);
    }
  }
  return out.sort();
}

/* ------------------------------------------------------------------ */
/* 1. YAML aliases in an OpenAPI delta                                 */
/* ------------------------------------------------------------------ */

describe("an aliased OpenAPI delta merges as what it resolves to", () => {
  const LIVING = `openapi: 3.1.0
info: { title: payment-service, version: "1.0" }
paths:
  /payments:
    post:
      operationId: authorizePayment
      responses: { "200": { description: ok } }
components:
  schemas:
    Payment: { type: object }
`;

  it("plans identically for an aliased delta and its inline twin", () => {
    const inline = `openapi: 3.1.0
paths:
  /refunds:
    post:
      operationId: createRefund
      responses: { "201": { description: created } }
`;
    // `paths` itself behind an alias. The shape test used to ask the AST node
    // (`isMap`), which an Alias never is, so this document read as "no paths to
    // merge" — the entire contract delta silently dropped, exit 0.
    const aliased = `openapi: 3.1.0
x-paths: &paths
  /refunds:
    post:
      operationId: createRefund
      responses: { "201": { description: created } }
paths: *paths
`;

    const a = mergeOpenapiPaths(LIVING, inline, "payment-service");
    const b = mergeOpenapiPaths(LIVING, aliased, "payment-service");

    expect(b.text).not.toBeNull();
    expect(b).toEqual(a);
    expect(parse(b.text!).paths["/refunds"].post.operationId).toBe("createRefund");
    expect(parse(b.text!).paths["/payments"].post.operationId).toBe("authorizePayment");
  });

  it("keeps every living operation on a path whose delta item is an alias", () => {
    // An aliased path ITEM used to miss the per-method merge and take the
    // wholesale-replace branch, deleting authorizePayment — an operation the
    // delta never mentions and nobody asked to remove.
    const feature = `openapi: 3.1.0
x-read: &read
  get:
    operationId: listPayments
    responses: { "200": { description: ok } }
paths:
  /payments: *read
`;
    const result = mergeOpenapiPaths(LIVING, feature, "payment-service");
    const merged = parse(result.text!);

    expect(merged.paths["/payments"].post.operationId).toBe("authorizePayment");
    expect(merged.paths["/payments"].get.operationId).toBe("listPayments");
    expect(result.removed).toEqual([]);
  });

  it("refuses a delta whose aliases cannot be resolved instead of merging nothing", () => {
    expect(() => mergeOpenapiPaths(LIVING, "paths: *nowhere\n", "payment-service")).toThrowError(
      /openapi for payment-service is not valid YAML/,
    );
  });

  it("never loses a living operation without recording it in openapiRemovals", async () => {
    const p = await makeProject({
      ...fleetFixture(),
      // The delta restates /payments through an alias: the living
      // authorizePayment must survive, and nothing may be reported removed.
      "features/FEAT-60-list/specs/payment-service/spec.md": `# payment-service — delta for FEAT-60

## ADDED Requirements

### Requirement: List payments
The service SHALL list payments.

Operations: listPayments

#### Scenario: A list is returned
- **Given** payments exist
- **When** the list is requested
- **Then** they are returned
`,
      "features/FEAT-60-list/specs/payment-service/openapi.yaml": `openapi: 3.1.0
x-read: &read
  get:
    operationId: listPayments
    responses: { "200": { description: ok } }
paths:
  /payments: *read
`,
    });
    try {
      const before = await livingOps(p, "payment-service");
      const res = await runLoam(p.workDir, "archive", "FEAT-60", "--json");
      expect(res.code).toBe(0);
      const payload = JSON.parse(res.stdout);
      const after = await livingOps(p, "payment-service");

      const recorded = (payload.openapiRemovals as Array<{ operations: string[] }>)
        .flatMap((r) => r.operations)
        .join(" ");
      for (const op of before) {
        if (after.includes(op)) continue;
        expect(recorded).toContain(op);
      }
      expect(after).toContain("authorizePayment");
      expect(after).toContain("listPayments");
    } finally {
      await p.destroy();
    }
  });
});

/* ------------------------------------------------------------------ */
/* 2. Two writers in one docs checkout                                 */
/* ------------------------------------------------------------------ */

/**
 * Run two loam commands with genuinely overlapping await points, in one
 * process. `runLoam` cannot do this: it saves and restores console.log per
 * call, so two overlapping calls can leave the patch installed, and they share
 * one `process.exitCode`. Here the capture is installed once around the pair
 * and every result is read out of the `--json` envelope instead — `emitJson`
 * writes the whole document in ONE console.log call, so each captured line that
 * starts with `{` is exactly one command's answer.
 */
async function runPair(cwd: string, argvs: string[][]): Promise<Array<Record<string, unknown>>> {
  const prevCwd = process.cwd();
  const prevExit = process.exitCode;
  const origLog = console.log;
  const origErr = console.error;
  const lines: string[] = [];
  console.log = (...a: unknown[]) => void lines.push(format(...a));
  console.error = (...a: unknown[]) => void lines.push(format(...a));
  try {
    process.chdir(cwd);
    await Promise.all(
      argvs.map((argv) => {
        const program = new Command();
        program.name("loam").exitOverride();
        registerArchive(program);
        return program.parseAsync(["node", "loam", ...argv]);
      }),
    );
  } finally {
    console.log = origLog;
    console.error = origErr;
    process.chdir(prevCwd);
    process.exitCode = prevExit;
  }
  return lines
    .filter((l) => l.startsWith("{"))
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

/** Two independent features, each adding one requirement + one operation to its own service. */
function twoFeatures(): Record<string, string> {
  const feature = (id: string, service: string, op: string): Record<string, string> => ({
    [`features/${id}-work/specs/${service}/spec.md`]: `# ${service} — delta for ${id}

## ADDED Requirements

### Requirement: ${op} behaviour
The service SHALL support ${op}.

Operations: ${op}

#### Scenario: It works
- **Given** a request
- **When** it is handled
- **Then** it succeeds
`,
    [`features/${id}-work/specs/${service}/openapi.yaml`]: `openapi: 3.1.0
paths:
  /${op}:
    post:
      operationId: ${op}
      responses: { "201": { description: created } }
`,
  });
  return {
    ...fleetFixture(),
    ...feature("FEAT-71", "payment-service", "refundPayment"),
    ...feature("FEAT-72", "checkout-web", "renderBasket"),
  };
}

describe("two archives in one docs checkout", () => {
  it("refuses with docs-busy while another writer holds the repo", async () => {
    const p = await makeProject(twoFeatures());
    try {
      const before = await treeHashes(p.docsDir);
      // A live pid on this host: the stale-lock break must NOT reclaim it.
      await writeFile(
        join(p.docsDir, DOCS_LOCK),
        JSON.stringify({ pid: process.pid, host: hostname(), at: new Date().toISOString() }) + "\n",
        "utf8",
      );

      const res = await runLoam(p.workDir, "archive", "FEAT-71", "--json");
      expect(res.code).toBe(1);
      expect(JSON.parse(res.stdout).error.code).toBe("docs-busy");

      await rm(join(p.docsDir, DOCS_LOCK));
      expect(await treeHashes(p.docsDir)).toEqual(before);
      expect((await runLoam(p.workDir, "archive", "FEAT-71")).code).toBe(0);
    } finally {
      await p.destroy();
    }
  });

  it("reclaims a lock whose holder is gone, so a crash cannot wedge the repo", async () => {
    const p = await makeProject(twoFeatures());
    try {
      await writeFile(
        join(p.docsDir, DOCS_LOCK),
        JSON.stringify({ pid: 0x7ffffffe, host: hostname(), at: new Date().toISOString() }) + "\n",
        "utf8",
      );
      expect((await runLoam(p.workDir, "archive", "FEAT-71")).code).toBe(0);
      expect(existsSync(join(p.docsDir, DOCS_LOCK))).toBe(false);
    } finally {
      await p.destroy();
    }
  });

  it("loses neither feature when two archives overlap, 20 times over", async () => {
    for (let iteration = 0; iteration < 20; iteration += 1) {
      const p = await makeProject(twoFeatures());
      try {
        const answers = await runPair(p.workDir, [
          ["archive", "FEAT-71", "--json"],
          ["archive", "FEAT-72", "--json"],
        ]);
        expect(answers).toHaveLength(2);

        const succeeded = new Set<string>();
        for (const answer of answers) {
          if (answer.ok === true) {
            succeeded.add(answer.feature as string);
            continue;
          }
          // The only acceptable refusals: it was told the repo was busy, or it
          // noticed the bytes it planned against had moved. Never a partial merge.
          expect(["docs-busy", "merge-failed"]).toContain((answer.error as { code: string }).code);
        }

        // Every feature is accounted for on all three axes — archived with its
        // whole merge landed, or still in flight with none of it. There is no
        // third state, and "in flight with the merge already applied" is the
        // one the lock exists to make impossible.
        for (const [feature, service, op] of [
          ["FEAT-71", "payment-service", "refundPayment"],
          ["FEAT-72", "checkout-web", "renderBasket"],
        ] as const) {
          const spec = await p.read(`services/${service}/spec.md`);
          if (succeeded.has(feature)) {
            expect(spec).toContain(`${op} behaviour`);
            expect(await livingOps(p, service)).toContain(op);
            expect(p.exists(`features/archive/${feature}-work`)).toBe(true);
            expect(p.exists(`features/${feature}-work`)).toBe(false);
          } else {
            expect(spec).not.toContain(`${op} behaviour`);
            expect(await livingOps(p, service)).not.toContain(op);
            expect(p.exists(`features/${feature}-work`)).toBe(true);
            expect(p.exists(`features/archive/${feature}-work`)).toBe(false);
          }
        }
        // At least one of the two always gets through: a lock that refused both
        // would be a deadlock wearing a refusal's clothes.
        expect(succeeded.size).toBeGreaterThanOrEqual(1);
        // Whatever happened, the lock is not left behind.
        expect(existsSync(join(p.docsDir, DOCS_LOCK))).toBe(false);
      } finally {
        await p.destroy();
      }
    }
  }, 120_000);

  it("the loser of a same-feature race does not roll back the winner's merge", async () => {
    const p = await makeProject(twoFeatures());
    try {
      const answers = await runPair(p.workDir, [
        ["archive", "FEAT-71", "--json"],
        ["archive", "FEAT-71", "--json"],
      ]);
      expect(answers).toHaveLength(2);
      const winners = answers.filter((a) => a.ok === true);
      expect(winners.length).toBeGreaterThanOrEqual(1);
      // The winner's merge is intact whatever the loser did on its way out.
      expect(await p.read("services/payment-service/spec.md")).toContain("refundPayment behaviour");
      expect(await livingOps(p, "payment-service")).toContain("refundPayment");
      expect(p.exists("features/archive/FEAT-71-work")).toBe(true);
      for (const loser of answers.filter((a) => a.ok !== true)) {
        expect(["docs-busy", "archive-exists", "unknown-target", "merge-failed", "not-coherent"]).toContain(
          (loser.error as { code: string }).code,
        );
      }
    } finally {
      await p.destroy();
    }
  }, 30_000);
});

/* ------------------------------------------------------------------ */
/* 3. Rollback is not a recursive remove                               */
/* ------------------------------------------------------------------ */

describe("a failed archive cleans up only what is still its own", () => {
  it("leaves a feature another archive put in features/archive/ untouched", async () => {
    const p = await makeProject(twoFeatures());
    try {
      const intruder = join(p.docsDir, "features", "archive", "FEAT-99-other");
      fsFault.onRename = (_from, to) => {
        if (!to.includes(join("features", "archive", "FEAT-71-work"))) return;
        // Between our mkdir of features/archive/ and the move that fails, a
        // second archive lands a whole feature — snapshot and all — inside it.
        // The rollback used to remove that directory recursively, because we
        // were the ones who created it.
        mkdirSync(join(intruder, ".loam-before"), { recursive: true });
        writeFileSync(join(intruder, "intent.md"), "another archive's work\n");
        throw new Error("injected archive move failure");
      };
      const res = await runLoam(p.workDir, "archive", "FEAT-71", "--json");
      fsFault.onRename = undefined;

      expect(res.code).toBe(1);
      expect(existsSync(join(intruder, "intent.md"))).toBe(true);
      expect(existsSync(join(intruder, ".loam-before"))).toBe(true);
      // And our own merge is gone again: the living spec is back to what it said.
      expect(await p.read("services/payment-service/spec.md")).not.toContain("refundPayment behaviour");
      expect(p.exists("features/FEAT-71-work")).toBe(true);
    } finally {
      fsFault.onRename = undefined;
      await p.destroy();
    }
  });

  it("removes an archive directory it created when nothing else moved in", async () => {
    const p = await makeProject(twoFeatures());
    try {
      fsFault.onRename = (_from, to) => {
        if (to.includes(join("features", "archive", "FEAT-71-work"))) throw new Error("injected move failure");
      };
      const before = await treeHashes(p.docsDir);
      const res = await runLoam(p.workDir, "archive", "FEAT-71", "--json");
      fsFault.onRename = undefined;
      expect(res.code).toBe(1);
      expect(await treeHashes(p.docsDir)).toEqual(before);
    } finally {
      fsFault.onRename = undefined;
      await p.destroy();
    }
  });

  it("unarchive refuses to restore into a docs repo another writer holds", async () => {
    const p = await makeProject(coherentFixture());
    try {
      expect((await runLoam(p.workDir, "archive", "FEAT-1")).code).toBe(0);
      const after = await treeHashes(p.docsDir);
      await writeFile(
        join(p.docsDir, DOCS_LOCK),
        JSON.stringify({ pid: process.pid, host: hostname(), at: new Date().toISOString() }) + "\n",
        "utf8",
      );

      const res = await runLoam(p.workDir, "unarchive", "FEAT-1", "--json");
      expect(res.code).toBe(1);
      expect(JSON.parse(res.stdout).error.code).toBe("docs-busy");

      await rm(join(p.docsDir, DOCS_LOCK));
      // A restore that never started: the archive's merge is exactly as it was.
      expect(await treeHashes(p.docsDir)).toEqual(after);
    } finally {
      await p.destroy();
    }
  });

  it("unarchive plans a restore of a deleted file as an exclusive create", async () => {
    const p = await makeProject(coherentFixture());
    try {
      expect((await runLoam(p.workDir, "archive", "FEAT-1")).code).toBe(0);
      const before = await treeHashes(p.docsDir);
      expect((await runLoam(p.workDir, "unarchive", "FEAT-1")).code).toBe(0);
      // The round trip is byte-exact, which is only true if the writes that
      // put files back went in the same way archive's creates came out.
      const after = await treeHashes(p.docsDir);
      expect(Object.keys(after)).not.toContain("services/payment-split-service/spec.md");
      expect(before["services/payment-split-service/spec.md"]).toBeDefined();
    } finally {
      await p.destroy();
    }
  });
});

/* ------------------------------------------------------------------ */
/* 4. (path, method) is the operation's identity                        */
/* ------------------------------------------------------------------ */

/** A feature that MOVES capturePayment to a new path: marker at the old slot, upsert at the new. */
function relocateCapture(markerFirst: boolean): Record<string, string> {
  const marker = `  /payments/capture:
    post:
      operationId: capturePayment
      x-loam-remove: true
`;
  const upsert = `  /payments/{id}/capture:
    post:
      operationId: capturePayment
      responses: { "200": { description: ok } }
`;
  return {
    "features/FEAT-80-move/specs/payment-service/openapi.yaml":
      `openapi: 3.1.0\npaths:\n${markerFirst ? marker + upsert : upsert + marker}`,
  };
}

describe("relocating an operation is not retiring it", () => {
  for (const markerFirst of [true, false]) {
    it(`archives cleanly with the removal marker ${markerFirst ? "before" : "after"} the new definition`, async () => {
      const p = await makeProject({ ...fleetFixture(), ...relocateCapture(markerFirst) });
      try {
        const res = await runLoam(p.workDir, "archive", "FEAT-80", "--json");
        // The requirement governing capturePayment stays; the operation only
        // changes address. Keying the reader by operationId hid one of the two
        // slots, and which one depended on document order.
        expect(JSON.stringify(res.out)).not.toContain("spec-api.op-undefined");
        expect(JSON.stringify(res.out)).not.toContain("remove-marker-unjustified");
        expect(res.code).toBe(0);

        const api = parse(await p.read("services/payment-service/openapi.yaml"));
        expect(api.paths["/payments/capture"]).toBeUndefined();
        expect(api.paths["/payments/{id}/capture"].post.operationId).toBe("capturePayment");
        expect(await p.read("services/payment-service/spec.md")).toContain("Operations: capturePayment");
      } finally {
        await p.destroy();
      }
    });
  }

  it("reports a living contract that claims one operationId in two slots", async () => {
    const p = await makeProject({
      ...fleetFixture(),
      "services/payment-service/openapi.yaml": `${PAYMENT_OPENAPI}  /payments/legacy:
    post:
      operationId: authorizePayment
      responses: { "200": { description: ok } }
`,
      ...relocateCapture(true),
    });
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-80", "--dry-run", "--json");
      const payload = JSON.parse(res.stdout);
      const warn = (payload.warnings as Array<{ code: string; message: string }>).find(
        (w) => w.code === "openapi.duplicate-operationid",
      );
      expect(warn).toBeDefined();
      expect(warn!.message).toContain("authorizePayment");
      expect(warn!.message).toContain("post /payments");
      expect(warn!.message).toContain("post /payments/legacy");
    } finally {
      await p.destroy();
    }
  });
});

/* ------------------------------------------------------------------ */
/* 5. Retiring an operation the fleet still calls                      */
/* ------------------------------------------------------------------ */

describe("a removal is checked against the living consumers", () => {
  it("refuses while a living landscape edge still calls the operation", async () => {
    const p = await makeProject({ ...fleetFixture(), ...retireCapture() });
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-50", "--json");
      expect(res.code).toBe(1);
      const payload = JSON.parse(res.stdout);
      expect(payload.error.code).toBe("not-coherent");
      const issue = (payload.issues as Array<{ code: string; message: string }>).find(
        (i) => i.code === "openapi.remove-op-consumed",
      );
      expect(issue).toBeDefined();
      expect(issue!.message).toContain("capturePayment");
      expect(issue!.message).toContain("checkout-web → payment-service");
      expect(issue!.message).toContain("--approve");
      // Refused at the gate: nothing was written.
      expect(await livingOps(p, "payment-service")).toContain("capturePayment");
    } finally {
      await p.destroy();
    }
  });

  it("passes once the consuming edge is gone, and the fleet stays green", async () => {
    const p = await makeProject({ ...fleetFixture(FLEET_LANDSCAPE_NO_CAPTURE), ...retireCapture() });
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-50", "--json");
      expect(res.code).toBe(0);
      expect(await livingOps(p, "payment-service")).toEqual(["authorizePayment"]);

      const after = await runLoam(p.workDir, "validate", "--all", "--json");
      const report = JSON.parse(after.stdout);
      const errors = (report.targets as Array<{ findings: Array<{ severity: string; message: string }> }>)
        .flatMap((t) => t.findings)
        .filter((f) => f.severity === "error");
      expect(errors).toEqual([]);
    } finally {
      await p.destroy();
    }
  });

  it("refuses while another service's living requirement names the operation", async () => {
    const p = await makeProject({
      ...fleetFixture(FLEET_LANDSCAPE_NO_CAPTURE),
      // checkout-web's own living spec claims the operation. Nothing in the
      // landscape draws it, so only the requirement axis can see the consumer.
      "services/checkout-web/spec.md": `${CHECKOUT_SPEC}
### Requirement: Capture on confirmation
The UI SHALL capture the payment when the order is confirmed.

Operations: capturePayment

#### Scenario: Capture happens
- **Given** an authorized payment
- **When** the order is confirmed
- **Then** it is captured
`,
      ...retireCapture(),
    });
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-50", "--json");
      expect(res.code).toBe(1);
      const issue = (JSON.parse(res.stdout).issues as Array<{ code: string; message: string }>).find(
        (i) => i.code === "openapi.remove-op-consumed",
      );
      expect(issue).toBeDefined();
      expect(issue!.message).toContain("checkout-web's living requirement 'Capture on confirmation'");
    } finally {
      await p.destroy();
    }
  });

  it("--approve is still the way to break it deliberately", async () => {
    const p = await makeProject({ ...fleetFixture(), ...retireCapture() });
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-50", "--approve", "--json");
      expect(res.code).toBe(0);
      const payload = JSON.parse(res.stdout);
      expect((payload.overridden as Array<{ code: string }>).map((i) => i.code)).toContain(
        "openapi.remove-op-consumed",
      );
    } finally {
      await p.destroy();
    }
  });
});

/* ------------------------------------------------------------------ */
/* 6. Duplicate requirement names in the LIVING document               */
/* ------------------------------------------------------------------ */

describe("two living requirements under one heading", () => {
  const twinSpec = (secondName: string): string => `---
service: order-service
status: verified
---

# order-service

## Requirements

### Requirement: Cancel an order
The service SHALL cancel an order before dispatch.

#### Scenario: Cancelled in time
- **Given** an undispatched order
- **When** cancellation is requested
- **Then** it is cancelled

### Requirement: ${secondName}
The service SHALL refuse to cancel a dispatched order.

#### Scenario: Too late
- **Given** a dispatched order
- **When** cancellation is requested
- **Then** it is refused
`;

  const modifyCancel = {
    "features/FEAT-90-cancel/specs/order-service/spec.md": `# order-service — delta for FEAT-90

## MODIFIED Requirements

### Requirement: Cancel an order
The service SHALL cancel an order before dispatch, refunding any hold.

#### Scenario: Cancelled in time
- **Given** an undispatched order
- **When** cancellation is requested
- **Then** it is cancelled and the hold is released
`,
  };

  it("gates the archive, because MODIFIED edits one twin and REMOVED deletes both", async () => {
    const p = await makeProject({
      "services/order-service/spec.md": twinSpec("Cancel an order"),
      ...modifyCancel,
    });
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-90", "--json");
      expect(res.code).toBe(1);
      const payload = JSON.parse(res.stdout);
      const issue = (payload.issues as Array<{ code: string; message: string }>).find(
        (i) => i.code === "delta.living-duplicate-requirement",
      );
      expect(issue).toBeDefined();
      expect(issue!.message).toContain("'Cancel an order'");
    } finally {
      await p.destroy();
    }
  });

  it("passes once the two are told apart", async () => {
    const p = await makeProject({
      "services/order-service/spec.md": twinSpec("Refuse to cancel a dispatched order"),
      ...modifyCancel,
    });
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-90", "--json");
      expect(res.code).toBe(0);
      const living = await p.read("services/order-service/spec.md");
      expect(living).toContain("refunding any hold");
      expect(living).toContain("Refuse to cancel a dispatched order");
    } finally {
      await p.destroy();
    }
  });
});

/* ------------------------------------------------------------------ */
/* 7. A new service arrives without its model                          */
/* ------------------------------------------------------------------ */

describe("archive does not claim the docs are complete when they are not", () => {
  it("names the missing model.likec4 and drops the closing claim", async () => {
    const p = await makeProject(coherentFixture());
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-1");
      expect(res.code).toBe(0);
      expect(res.out).toContain("services/payment-split-service/model.likec4");
      expect(res.out).toContain("loam adopt");
      expect(res.out).not.toContain("living spec + landscape are now complete + current.");
    } finally {
      await p.destroy();
    }
  });

  it("carries the same finding in --json, for a dry run too", async () => {
    const p = await makeProject(coherentFixture());
    try {
      for (const argv of [["archive", "FEAT-1", "--dry-run", "--json"], ["archive", "FEAT-1", "--json"]]) {
        const res = await runLoam(p.workDir, ...argv);
        const warn = (JSON.parse(res.stdout).warnings as Array<{ code: string; gates: boolean }>).find(
          (w) => w.code === "service.no-model",
        );
        expect(warn).toBeDefined();
        // Non-gating: the feature is coherent and the merge is correct.
        expect(warn!.gates).toBe(false);
      }
    } finally {
      await p.destroy();
    }
  });

  it("says nothing when the merge touches only services that already exist", async () => {
    const p = await makeProject(twoFeatures());
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-71", "--json");
      expect(res.code).toBe(0);
      expect((JSON.parse(res.stdout).warnings as Array<{ code: string }>).map((w) => w.code)).not.toContain(
        "service.no-model",
      );
    } finally {
      await p.destroy();
    }
  });
});

/* ------------------------------------------------------------------ */
/* 8. MODIFIED vs MODIFIED                                             */
/* ------------------------------------------------------------------ */

describe("two features changing one living requirement", () => {
  function contested(): Record<string, string> {
    const delta = (id: string, wording: string): Record<string, string> => ({
      [`features/${id}-cancel/specs/order-service/spec.md`]: `# order-service — delta for ${id}

## MODIFIED Requirements

### Requirement: Cancel an order
${wording}

#### Scenario: Cancelled in time
- **Given** an undispatched order
- **When** cancellation is requested
- **Then** it is cancelled
`,
    });
    return {
      "services/order-service/spec.md": `---
service: order-service
status: verified
---

# order-service

## Requirements

### Requirement: Cancel an order
The service SHALL cancel an order before dispatch.

#### Scenario: Cancelled in time
- **Given** an undispatched order
- **When** cancellation is requested
- **Then** it is cancelled
`,
      ...delta("FEAT-101", "The service SHALL cancel an order before dispatch, refunding any hold."),
      ...delta("FEAT-102", "The service SHALL cancel an order before dispatch, notifying the warehouse."),
    };
  }

  it("warns on both features' validate, naming the other one", async () => {
    const p = await makeProject(contested());
    try {
      for (const [self, other] of [["FEAT-101", "FEAT-102"], ["FEAT-102", "FEAT-101"]]) {
        const res = await runLoam(p.workDir, "validate", "--feature", self, "--json");
        const codes = JSON.stringify(res.stdout);
        expect(codes).toContain("delta.modified-conflict");
        expect(codes).toContain(other!);
      }
    } finally {
      await p.destroy();
    }
  });

  it("shows it in archive --dry-run, before anything is written", async () => {
    const p = await makeProject(contested());
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-102", "--dry-run", "--json");
      expect(res.code).toBe(0);
      const warn = (JSON.parse(res.stdout).warnings as Array<{ code: string; message: string }>).find(
        (w) => w.code === "delta.modified-conflict",
      );
      expect(warn).toBeDefined();
      expect(warn!.message).toContain("FEAT-101");
      // A warning, never a gate: only the two authors can say whether the
      // second rewrite is meant.
      expect((JSON.parse(res.stdout).warnings as Array<{ gates: boolean }>).every((w) => w.gates === false)).toBe(true);
    } finally {
      await p.destroy();
    }
  });

  it("still applies the second delta cleanly once the first has archived", async () => {
    const p = await makeProject(contested());
    try {
      expect((await runLoam(p.workDir, "archive", "FEAT-101")).code).toBe(0);
      expect(await p.read("services/order-service/spec.md")).toContain("refunding any hold");
      const res = await runLoam(p.workDir, "archive", "FEAT-102", "--json");
      expect(res.code).toBe(0);
      const living = await p.read("services/order-service/spec.md");
      expect(living).toContain("notifying the warehouse");
      // ONE requirement, not two: the identity is preserved, so B's archive is
      // a replacement rather than a silent duplication.
      expect(living.match(/### Requirement: Cancel an order/g)).toHaveLength(1);
    } finally {
      await p.destroy();
    }
  });
});

/* ------------------------------------------------------------------ */
/* 9. The small merge losses                                           */
/* ------------------------------------------------------------------ */

describe("merge details that used to pass in silence", () => {
  it("reports a path-level key the delta overwrites", async () => {
    const p = await makeProject({
      ...fleetFixture(),
      "services/payment-service/openapi.yaml": `openapi: 3.1.0
info: { title: payment-service, version: "1.0" }
paths:
  /payments:
    parameters:
      - { name: X-Tenant, in: header, required: true, schema: { type: string } }
    post:
      operationId: authorizePayment
      responses: { "200": { description: ok } }
  /payments/capture:
    post:
      operationId: capturePayment
      responses: { "200": { description: ok } }
`,
      // The delta restates /payments with a SHORTER parameters list. The
      // difference check skipped every non-method key, so the shared header
      // parameter vanished from every operation on the path, silently.
      "features/FEAT-81-params/specs/payment-service/openapi.yaml": `openapi: 3.1.0
paths:
  /payments:
    parameters: []
    post:
      operationId: authorizePayment
      responses: { "200": { description: ok } }
`,
    });
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-81", "--dry-run", "--json");
      const warn = (JSON.parse(res.stdout).warnings as Array<{ code: string; message: string }>).find(
        (w) => w.code === "openapi.path-item-modified",
      );
      expect(warn).toBeDefined();
      expect(warn!.message).toContain("'parameters' (/payments)");
    } finally {
      await p.destroy();
    }
  });

  it("never writes x-loam-remove into a contract it creates", async () => {
    const p = await makeProject({
      ...fleetFixture(),
      // A marker with no operationId: invisible to the operation reader, so the
      // strip used to be skipped and the marker was published as living API.
      "features/FEAT-82-new/specs/new-service/openapi.yaml": `openapi: 3.1.0
info: { title: new-service, version: "1.0" }
paths:
  /ghost:
    post:
      x-loam-remove: true
  /real:
    post:
      operationId: realOp
      responses: { "201": { description: created } }
`,
      "features/FEAT-82-new/specs/new-service/spec.md": `# new-service — delta for FEAT-82

## ADDED Requirements

### Requirement: Do the real thing
The service SHALL do the real thing.

Operations: realOp

#### Scenario: It happens
- **Given** a request
- **When** it arrives
- **Then** the thing is done
`,
    });
    try {
      // The anonymous marker gates on its own — loam cannot say what it retires.
      const gated = await runLoam(p.workDir, "archive", "FEAT-82", "--json");
      expect(gated.code).toBe(1);
      const issue = (JSON.parse(gated.stdout).issues as Array<{ code: string; message: string }>).find(
        (i) => i.code === "openapi.remove-marker-anonymous",
      );
      expect(issue).toBeDefined();
      expect(issue!.message).toContain("post /ghost");

      // And even when an author walks past it, the marker never reaches the
      // living contract, and the path it emptied goes with it.
      expect((await runLoam(p.workDir, "archive", "FEAT-82", "--approve")).code).toBe(0);
      const text = await p.read("services/new-service/openapi.yaml");
      expect(text).not.toContain("x-loam-remove");
      expect(parse(text).paths["/ghost"]).toBeUndefined();
      expect(parse(text).paths["/real"].post.operationId).toBe("realOp");
    } finally {
      await p.destroy();
    }
  });

  it("says the marker is there but unnamed, instead of saying there is none", async () => {
    const p = await makeProject({
      ...fleetFixture(FLEET_LANDSCAPE_NO_CAPTURE),
      "features/FEAT-83-retire/specs/payment-service/spec.md": `# payment-service — delta for FEAT-83

## REMOVED Requirements

### Requirement: Capture a payment

Operations: capturePayment
`,
      "features/FEAT-83-retire/specs/payment-service/openapi.yaml": `openapi: 3.1.0
paths:
  /payments/capture:
    post:
      x-loam-remove: true
`,
    });
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-83", "--json");
      expect(res.code).toBe(1);
      const issue = (JSON.parse(res.stdout).issues as Array<{ code: string; message: string }>).find(
        (i) => i.code === "openapi.remove-marker-missing",
      );
      expect(issue).toBeDefined();
      expect(issue!.message).toContain("no operationId");
      expect(issue!.message).not.toContain("has no matching x-loam-remove");
    } finally {
      await p.destroy();
    }
  });

  it("leaves no empty path item behind when the last method is removed", async () => {
    const p = await makeProject({ ...fleetFixture(FLEET_LANDSCAPE_NO_CAPTURE), ...retireCapture() });
    try {
      expect((await runLoam(p.workDir, "archive", "FEAT-50")).code).toBe(0);
      const api = parse(await p.read("services/payment-service/openapi.yaml"));
      expect(api.paths["/payments/capture"]).toBeUndefined();
      expect(Object.keys(api.paths)).toEqual(["/payments"]);
    } finally {
      await p.destroy();
    }
  });

  it("reports a staging failure as merge-failed, not as an internal error", async () => {
    if (typeof process.getuid === "function" && process.getuid() === 0) return;
    const p = await makeProject(twoFeatures());
    try {
      const dir = join(p.docsDir, "services", "payment-service");
      await chmod(dir, 0o555);
      try {
        const res = await runLoam(p.workDir, "archive", "FEAT-71", "--json");
        expect(res.code).toBe(1);
        const payload = JSON.parse(res.stdout);
        expect(payload.error.code).toBe("merge-failed");
        expect(payload.error.message).toContain("nothing was written");
      } finally {
        await chmod(dir, 0o755);
      }
    } finally {
      await p.destroy();
    }
  });
});
