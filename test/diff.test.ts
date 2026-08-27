/**
 * `loam diff --base <ref>` — the semantic branch diff of the docs repo.
 *
 * Every case here builds a real git history inside the fixture's docs dir
 * (the harness tmpdir is not inside any repository, so an un-inited fixture
 * genuinely has no git to ask), commits a base state, mutates the WORKING
 * TREE, and diffs. The load-bearing pins, each named at its case: the
 * monorepo prefix (a docs repo one level below the git root must not read as
 * all-added), the two victim kinds on a consumed removal (a landscape edge
 * into a modelled CONTAINER — the serviceResolver known-set lesson — and a
 * foreign living requirement), digest identity that ignores rebase pins, and
 * the containment rule that an unreadable base contract suspends the axis
 * instead of reporting mass-change.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  LIVING_ASYNCAPI,
  LIVING_OPENAPI,
  LIVING_SPEC,
  makeProject,
  runLoam,
  treeHashes,
  type Project,
} from "./helpers/harness.js";

function git(cwd: string, ...args: string[]): void {
  const res = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 30_000 });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
}

/** Init at `dir` (which may be ABOVE docsDir — the monorepo case) and commit everything as the base. */
function commitBase(dir: string): void {
  git(dir, "init", "-q", "-b", "main");
  git(dir, "add", "-A");
  git(dir, "-c", "user.email=diff@test.invalid", "-c", "user.name=Diff Test", "commit", "-q", "-m", "base");
}

interface JsonFinding {
  severity: string;
  code: string;
  message: string;
  details: string[];
}

interface JsonService {
  id: string;
  change: string;
  findings: JsonFinding[];
  unreadable: { side: string; axis: string; path: string; error: string }[];
}

interface JsonDiff {
  contractVersion?: string;
  ok?: boolean;
  error?: { code: string; message: string };
  base?: { ref: string; commit: string };
  services?: JsonService[];
  breaking?: boolean;
  summary?: { added: number; removed: number; modified: number; deprecated: number; unreadable: number };
}

async function diffJson(p: Project, ref: string): Promise<{ code: number; payload: JsonDiff }> {
  const res = await runLoam(p.workDir, "diff", "--base", ref, "--json");
  return { code: res.code, payload: JSON.parse(res.stdout) as JsonDiff };
}

function service(payload: JsonDiff, id: string): JsonService {
  const found = payload.services?.find((s) => s.id === id);
  if (found === undefined) throw new Error(`no service '${id}' in payload: ${JSON.stringify(payload.services?.map((s) => s.id))}`);
  return found;
}

function codes(s: JsonService): string[] {
  return s.findings.map((f) => f.code);
}

/** The consumer half of the fixtures: a UI service whose living requirement names the provider's op. */
const CONSUMER_SPEC = `---
service: checkout-web
status: draft
---

# checkout-web

## Requirements

### Requirement: Start checkout payment
The UI SHALL request authorization before capture.

Operations: authorizePayment

#### Scenario: Pay
- **Given** a cart
- **When** the customer pays
- **Then** the payment is authorized
`;

/**
 * A landscape whose consumer edge lands on the provider's CONTAINER — the
 * shape that made removal checks answer "nobody calls it" until the resolver
 * learned the enumerated fleet. If diff's victim join loses the `known` set,
 * this fixture's edge victim disappears and the case fails.
 */
const CONTAINER_EDGE_LANDSCAPE = `specification {
  element softwareSystem
  element container
}

model {
  checkoutWeb = softwareSystem 'checkout-web'
  paymentService = softwareSystem 'payment-service' {
    api = container 'api'
  }

  checkoutWeb -> paymentService.api 'Calls authorizePayment' {
    metadata { op 'authorizePayment' }
  }
}

views {
  view landscape {
    include *
  }
}
`;

const REMOVED_OP_OPENAPI = `openapi: 3.1.0
info:
  title: payment-service
  version: "1.0"
paths:
  /payments/capture:
    post:
      operationId: capturePayment
      summary: Capture a payment
      responses:
        "200":
          description: Captured
          content:
            application/json:
              schema:
                type: object
                properties:
                  status:
                    type: string
`;

function providerFixture(): Record<string, string> {
  return {
    "architecture/landscape.likec4": CONTAINER_EDGE_LANDSCAPE,
    "services/payment-service/spec.md": LIVING_SPEC,
    "services/payment-service/openapi.yaml": LIVING_OPENAPI,
    "services/checkout-web/spec.md": CONSUMER_SPEC,
  };
}

describe("loam diff — refusals", () => {
  it("a docs repo without git history refuses repository-unavailable, exit 1, envelope shape", async () => {
    const p = await makeProject(providerFixture());
    try {
      const { code, payload } = await diffJson(p, "main");
      expect(code).toBe(1);
      expect(payload.ok).toBe(false);
      expect(payload.contractVersion).toBe("1.0");
      expect(payload.error?.code).toBe("repository-unavailable");
      expect(payload.error?.message).toContain("git");
    } finally {
      await p.destroy();
    }
  });

  it("a ref that resolves to no commit refuses unknown-target, naming the ref", async () => {
    const p = await makeProject(providerFixture());
    try {
      commitBase(p.docsDir);
      const { code, payload } = await diffJson(p, "no-such-branch");
      expect(code).toBe(1);
      expect(payload.error?.code).toBe("unknown-target");
      expect(payload.error?.message).toContain("no-such-branch");
    } finally {
      await p.destroy();
    }
  });
});

describe("loam diff — removals and their victims", () => {
  it("a removed operation the fleet still names is diff.op-removed-consumed, with BOTH victim kinds, breaking, exit 1", async () => {
    const p = await makeProject(providerFixture());
    try {
      commitBase(p.docsDir);
      await p.write("services/payment-service/openapi.yaml", REMOVED_OP_OPENAPI);
      const { code, payload } = await diffJson(p, "main");
      expect(code).toBe(1);
      expect(payload.ok).toBe(true);
      expect(payload.breaking).toBe(true);
      const provider = service(payload, "payment-service");
      const removal = provider.findings.find((f) => f.code === "diff.op-removed-consumed");
      expect(removal, codes(provider).join(",")).toBeDefined();
      expect(removal!.severity).toBe("error");
      // The edge victim proves the container edge resolved THROUGH the
      // enumerated fleet: paymentService.api → payment-service.
      expect(removal!.details.some((d) => d.includes("edge checkout-web → payment-service"))).toBe(true);
      expect(removal!.details.some((d) => d.includes("checkout-web's living requirement"))).toBe(true);
      // The replacement op reads as an addition beside it, severity ok.
      expect(codes(provider)).toContain("diff.op-added");
    } finally {
      await p.destroy();
    }
  });

  it("a removed operation nobody names is only a warning, exit 0", async () => {
    const p = await makeProject({
      "services/payment-service/spec.md": LIVING_SPEC,
      "services/payment-service/openapi.yaml": LIVING_OPENAPI,
    });
    try {
      commitBase(p.docsDir);
      await p.write("services/payment-service/openapi.yaml", REMOVED_OP_OPENAPI);
      const { code, payload } = await diffJson(p, "main");
      expect(code).toBe(0);
      expect(payload.breaking).toBe(false);
      const provider = service(payload, "payment-service");
      // The provider's own requirement is not a foreign victim, and there is
      // no landscape edge — the removal warns instead of erroring.
      expect(codes(provider)).toContain("diff.op-removed");
      expect(codes(provider)).not.toContain("diff.op-removed-consumed");
    } finally {
      await p.destroy();
    }
  });

  it("deprecation introduced since base is diff.op-deprecated, consumers named, exit 0", async () => {
    const p = await makeProject(providerFixture());
    try {
      commitBase(p.docsDir);
      await p.write(
        "services/payment-service/openapi.yaml",
        LIVING_OPENAPI.replace("operationId: authorizePayment", "operationId: authorizePayment\n      deprecated: true"),
      );
      const { code, payload } = await diffJson(p, "main");
      expect(code).toBe(0);
      const provider = service(payload, "payment-service");
      const deprecated = provider.findings.find((f) => f.code === "diff.op-deprecated");
      expect(deprecated, codes(provider).join(",")).toBeDefined();
      expect(deprecated!.severity).toBe("warn");
      expect(deprecated!.details.some((d) => d.includes("checkout-web"))).toBe(true);
      expect(payload.summary?.deprecated).toBe(1);
    } finally {
      await p.destroy();
    }
  });

  it("a removed message still consumed — via an arch.spec.md Consumes: line — is diff.message-removed-consumed", async () => {
    const p = await makeProject({
      "services/payment-service/asyncapi.yaml": LIVING_ASYNCAPI,
      "services/checkout-web/spec.md": CONSUMER_SPEC,
      // The outbox lesson: the Consumes: line sits in arch.spec.md, where the
      // event scans read it — a spec.md-only victim scan misses this consumer.
      "services/checkout-web/arch.spec.md": `# checkout-web arch

## Requirements

### Requirement: React to authorization
The UI SHALL refresh when a payment authorizes.

Consumes: payment.Authorized

#### Scenario: Refresh
- **Given** an open checkout
- **When** payment.Authorized arrives
- **Then** the view refreshes
`,
    });
    try {
      commitBase(p.docsDir);
      await p.write("services/payment-service/asyncapi.yaml", `asyncapi: 3.0.0\ninfo:\n  title: payment-service events\n  version: "1.0"\n`);
      const { code, payload } = await diffJson(p, "main");
      expect(code).toBe(1);
      expect(payload.breaking).toBe(true);
      const provider = service(payload, "payment-service");
      const removal = provider.findings.find((f) => f.code === "diff.message-removed-consumed");
      expect(removal, codes(provider).join(",")).toBeDefined();
      expect(removal!.details.some((d) => d.includes("checkout-web's living requirement"))).toBe(true);
    } finally {
      await p.destroy();
    }
  });

  it("a deleted service directory is diff.service-removed plus its removals; a new one is diff.service-added", async () => {
    const p = await makeProject({
      "services/payment-service/spec.md": LIVING_SPEC,
      "services/payment-service/openapi.yaml": LIVING_OPENAPI,
    });
    try {
      commitBase(p.docsDir);
      await rm(join(p.docsDir, "services", "payment-service"), { recursive: true });
      await p.write("services/refund-service/spec.md", "# refund-service\n\n## Requirements\n\n### Requirement: Refund\nThe service SHALL refund.\n\n#### Scenario: R\n- **Given** a\n- **When** b\n- **Then** c\n");
      const { payload } = await diffJson(p, "main");
      const gone = service(payload, "payment-service");
      expect(gone.change).toBe("removed");
      expect(codes(gone)).toContain("diff.service-removed");
      expect(codes(gone)).toContain("diff.op-removed");
      expect(codes(gone)).toContain("diff.requirement-removed");
      const born = service(payload, "refund-service");
      expect(born.change).toBe("added");
      expect(codes(born)).toContain("diff.service-added");
      expect(codes(born)).toContain("diff.requirement-added");
    } finally {
      await p.destroy();
    }
  });
});

describe("loam diff — requirement identity", () => {
  it("changed requirement text is diff.requirement-modified; a rebase Based-On pin is NOT a change", async () => {
    const p = await makeProject({ "services/payment-service/spec.md": LIVING_SPEC });
    try {
      commitBase(p.docsDir);
      // A pin insertion alone: identical requirement, bookkeeping line added.
      await p.write(
        "services/payment-service/spec.md",
        LIVING_SPEC.replace("The service SHALL authorize a payment before capture.", "Based-On: 0123456789abcdef\nThe service SHALL authorize a payment before capture."),
      );
      const pinned = await diffJson(p, "main");
      expect(pinned.code).toBe(0);
      expect(service(pinned.payload, "payment-service").findings).toEqual([]);
      // A real edit moves the digest.
      await p.write(
        "services/payment-service/spec.md",
        LIVING_SPEC.replace("The service SHALL authorize a payment before capture.", "The service SHALL authorize and journal a payment before capture."),
      );
      const edited = await diffJson(p, "main");
      const findings = service(edited.payload, "payment-service").findings;
      expect(findings.map((f) => f.code)).toEqual(["diff.requirement-modified"]);
      expect(edited.payload.summary?.modified).toBe(1);
    } finally {
      await p.destroy();
    }
  });
});

describe("loam diff — cross-service joins", () => {
  it("a requirement newly naming another service's operation is diff.consumer-added on the PROVIDER", async () => {
    const p = await makeProject({
      "services/payment-service/spec.md": LIVING_SPEC,
      "services/payment-service/openapi.yaml": LIVING_OPENAPI,
      "services/checkout-web/spec.md": "# checkout-web\n",
    });
    try {
      commitBase(p.docsDir);
      await p.write("services/checkout-web/spec.md", CONSUMER_SPEC);
      const { code, payload } = await diffJson(p, "main");
      expect(code).toBe(0);
      const provider = service(payload, "payment-service");
      const join = provider.findings.find((f) => f.code === "diff.consumer-added");
      expect(join, codes(provider).join(",")).toBeDefined();
      expect(join!.message).toContain("checkout-web");
      expect(join!.message).toContain("authorizePayment");
      expect(codes(service(payload, "checkout-web"))).toContain("diff.requirement-added");
    } finally {
      await p.destroy();
    }
  });

  it("a join present at base and gone now is diff.consumer-removed", async () => {
    const p = await makeProject({
      "services/payment-service/spec.md": LIVING_SPEC,
      "services/payment-service/openapi.yaml": LIVING_OPENAPI,
      "services/checkout-web/spec.md": CONSUMER_SPEC,
    });
    try {
      commitBase(p.docsDir);
      await p.write("services/checkout-web/spec.md", "# checkout-web\n");
      const { payload } = await diffJson(p, "main");
      expect(codes(service(payload, "payment-service"))).toContain("diff.consumer-removed");
    } finally {
      await p.destroy();
    }
  });
});

describe("loam diff — containment: nobody could look is not nothing changed", () => {
  it("a second working-tree directory claiming an id suspends the subject — never a fabricated change story", async () => {
    const p = await makeProject({
      "services/payment-service/spec.md": LIVING_SPEC,
      "services/payment-service/openapi.yaml": LIVING_OPENAPI,
    });
    try {
      commitBase(p.docsDir);
      // The live shape validate grades subsystem.name-collision: a second
      // directory claims payment-service. A last-writer-wins collapse used to
      // diff WHICHEVER claimant won against the base — here the new, thinner
      // one — and report removals about a service that never changed.
      await p.write("services/billing/subsystem.yaml", "");
      await p.write("services/billing/payment-service/spec.md", "# payment-service copy\n");
      const { code, payload } = await diffJson(p, "main");
      expect(code).toBe(1);
      expect(payload.ok).toBe(true);
      expect(payload.breaking).toBe(false);
      const subject = service(payload, "payment-service");
      expect(subject.findings).toEqual([]);
      const ambiguous = (subject as unknown as { ambiguous?: string[] }).ambiguous;
      expect(ambiguous).toBeDefined();
      expect(ambiguous!.some((d) => d.includes("services/payment-service"))).toBe(true);
      expect(ambiguous!.some((d) => d.includes("services/billing/payment-service"))).toBe(true);
      expect(payload.summary!.unreadable).toBeGreaterThan(0);
      const human = await runLoam(p.workDir, "diff", "--base", "main");
      expect(human.stdout).toContain("service identity ambiguous");
      expect(human.stdout).toContain("services/billing/payment-service");
    } finally {
      await p.destroy();
    }
  });

  it("an unreadable CONSUMER spec suspends the victim scan — never a confident 'nobody names it'", async () => {
    const p = await makeProject({
      "services/payment-service/spec.md": LIVING_SPEC,
      "services/payment-service/openapi.yaml": LIVING_OPENAPI,
      "services/checkout-web/spec.md": CONSUMER_SPEC,
    });
    try {
      commitBase(p.docsDir);
      await p.write("services/payment-service/openapi.yaml", REMOVED_OP_OPENAPI);
      // UTF-16 bytes: decodeDocument refuses them, so checkout-web's living
      // requirements — which DO name authorizePayment — cannot be scanned. A
      // scan that treated that as "consuming nothing" asserted a negative
      // about a file loam refused to read.
      await writeFile(join(p.docsDir, "services", "checkout-web", "spec.md"), Buffer.from("# checkout-web\n", "utf16le"));
      const { code, payload } = await diffJson(p, "main");
      expect(code).toBe(1);
      const provider = service(payload, "payment-service");
      const removal = provider.findings.find((f) => f.code === "diff.op-removed");
      expect(removal, codes(provider).join(",")).toBeDefined();
      // The false-negative string must never print over a suspended scan.
      expect(removal!.message).not.toContain("no current landscape edge or living requirement names it");
      expect(removal!.message).toContain("could NOT be fully answered");
      expect(removal!.details.some((d) => d.includes("checkout-web"))).toBe(true);
      const consumer = service(payload, "checkout-web");
      expect(consumer.unreadable.some((u) => u.side === "current" && u.path.endsWith("spec.md"))).toBe(true);
    } finally {
      await p.destroy();
    }
  });

  it("an unreadable BASE contract suspends the op axis — never mass-addition — and exits 1", async () => {
    const p = await makeProject({
      "services/payment-service/spec.md": LIVING_SPEC,
      "services/payment-service/openapi.yaml": "paths: [broken",
    });
    try {
      commitBase(p.docsDir);
      await p.write("services/payment-service/openapi.yaml", LIVING_OPENAPI);
      const { code, payload } = await diffJson(p, "main");
      expect(code).toBe(1);
      expect(payload.ok).toBe(true);
      expect(payload.breaking).toBe(false);
      const provider = service(payload, "payment-service");
      // The one wrong answer this case exists to forbid: the working
      // contract's ops read as "added" off a base nobody could read.
      expect(codes(provider)).not.toContain("diff.op-added");
      expect(provider.unreadable.some((u) => u.side === "base" && u.path.endsWith("openapi.yaml"))).toBe(true);
      expect(payload.summary?.unreadable).toBeGreaterThan(0);
    } finally {
      await p.destroy();
    }
  });

  it("an unreadable CURRENT contract suspends the axis the same way — never mass-removal", async () => {
    const p = await makeProject({
      "services/payment-service/spec.md": LIVING_SPEC,
      "services/payment-service/openapi.yaml": LIVING_OPENAPI,
    });
    try {
      commitBase(p.docsDir);
      await p.write("services/payment-service/openapi.yaml", "paths: [broken");
      const { code, payload } = await diffJson(p, "main");
      expect(code).toBe(1);
      const provider = service(payload, "payment-service");
      expect(codes(provider)).not.toContain("diff.op-removed");
      expect(codes(provider)).not.toContain("diff.op-removed-consumed");
      expect(provider.unreadable.some((u) => u.side === "current")).toBe(true);
    } finally {
      await p.destroy();
    }
  });
});

describe("loam diff — identity across placement, prefix, and runs", () => {
  it("a service moved into a subsystem diffs as UNCHANGED — placement is navigation, not identity", async () => {
    const p = await makeProject({
      "services/payment-service/spec.md": LIVING_SPEC,
      "services/payment-service/openapi.yaml": LIVING_OPENAPI,
      "services/billing/subsystem.yaml": "",
      "services/billing/refund-service/spec.md": "# refund-service\n\n## Requirements\n\n### Requirement: Refund\nThe service SHALL refund.\n\n#### Scenario: R\n- **Given** a\n- **When** b\n- **Then** c\n",
    });
    try {
      commitBase(p.docsDir);
      await p.write("services/billing/payment-service/spec.md", LIVING_SPEC);
      await p.write("services/billing/payment-service/openapi.yaml", LIVING_OPENAPI);
      await rm(join(p.docsDir, "services", "payment-service"), { recursive: true });
      const { code, payload } = await diffJson(p, "main");
      expect(code).toBe(0);
      expect(service(payload, "payment-service").change).toBe("unchanged");
      expect(service(payload, "payment-service").findings).toEqual([]);
      expect(service(payload, "refund-service").change).toBe("unchanged");
    } finally {
      await p.destroy();
    }
  });

  it("an empty (not-yet-adopted) base directory is not a phantom addition — the walk's leaf rule holds at the base ref", async () => {
    const p = await makeProject({
      "services/payment-service/spec.md": LIVING_SPEC,
      // No service artifact, no marker, nothing beneath: the live walk calls
      // this a not-yet-adopted service, and the base classification must too,
      // or an unchanged tree reads as diff.service-added.
      //
      // BOTH spellings, because the filename is what decides the code path.
      // A non-dot file (README.md) reaches the leaf rule through the base
      // tree's ordinary file listing. A DOT-named one does not: dot-named
      // entries are invisible to the live walk, and the base classification
      // used to drop the whole path before any directory was derived from it —
      // so a directory whose only file is dot-named never became a candidate
      // at all. `.gitkeep` is not a hypothetical spelling: it is exactly and
      // only what `loam seed` writes into every service directory it creates
      // (src/commands/seed/plan.ts), so `loam seed` + commit + `loam diff
      // --base HEAD` reported every seeded service as added on an unchanged
      // tree.
      "services/idle-service/README.md": "# idle-service\n",
      "services/seeded-service/.gitkeep": "",
    });
    try {
      commitBase(p.docsDir);
      const { code, payload } = await diffJson(p, "main");
      expect(code).toBe(0);
      expect(service(payload, "idle-service").change).toBe("unchanged");
      expect(service(payload, "seeded-service").change).toBe("unchanged");
      expect(payload.services?.every((s) => s.findings.length === 0)).toBe(true);
      expect(payload.summary).toMatchObject({ added: 0, removed: 0, modified: 0 });
    } finally {
      await p.destroy();
    }
  });

  it("services beneath a marker-beside-artifacts directory stay enumerated at base — the walk's stranded descent holds", async () => {
    const p = await makeProject({
      // subsystem.yaml BESIDE spec.md: the live walk classifies gateway a
      // service AND still descends, so inner-service stays enumerated. The
      // base classification must agree, or an unchanged inner-service reads
      // as diff.service-added.
      "services/gateway/subsystem.yaml": "",
      "services/gateway/spec.md": "# gateway\n",
      "services/gateway/inner-service/spec.md": LIVING_SPEC,
    });
    try {
      commitBase(p.docsDir);
      const { code, payload } = await diffJson(p, "main");
      expect(code).toBe(0);
      expect(service(payload, "gateway").change).toBe("unchanged");
      expect(service(payload, "inner-service").change).toBe("unchanged");
      expect(payload.services?.every((s) => s.findings.length === 0)).toBe(true);
    } finally {
      await p.destroy();
    }
  });

  it("a docs repo INSIDE a larger repository (git root one level up) still reads its base — the prefix pin", async () => {
    const p = await makeProject({
      "services/payment-service/spec.md": LIVING_SPEC,
      "services/payment-service/openapi.yaml": LIVING_OPENAPI,
    });
    try {
      // The git root is the fixture root ABOVE docsDir; every base path now
      // needs the `docs/` prefix — dropping it reports the fleet as all-added.
      commitBase(join(p.docsDir, ".."));
      const { code, payload } = await diffJson(p, "main");
      expect(code).toBe(0);
      expect(payload.base?.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(payload.services?.every((s) => s.change === "unchanged")).toBe(true);
      expect(payload.summary).toEqual({ added: 0, removed: 0, modified: 0, deprecated: 0, unreadable: 0 });
    } finally {
      await p.destroy();
    }
  });

  it("diff writes nothing: the docs tree, .git included, hashes identically before and after", async () => {
    const p = await makeProject(providerFixture());
    try {
      commitBase(p.docsDir);
      await p.write("services/payment-service/openapi.yaml", REMOVED_OP_OPENAPI);
      const before = await treeHashes(p.docsDir);
      await diffJson(p, "main");
      await runLoam(p.workDir, "diff", "--base", "main");
      expect(await treeHashes(p.docsDir)).toEqual(before);
    } finally {
      await p.destroy();
    }
  });

  it("identical states, identical bytes: two runs of the same diff emit the same JSON", async () => {
    const p = await makeProject(providerFixture());
    try {
      commitBase(p.docsDir);
      await p.write("services/payment-service/openapi.yaml", REMOVED_OP_OPENAPI);
      const first = await runLoam(p.workDir, "diff", "--base", "main", "--json");
      const second = await runLoam(p.workDir, "diff", "--base", "main", "--json");
      expect(second.stdout).toBe(first.stdout);
    } finally {
      await p.destroy();
    }
  });
});

describe("loam diff — output modes", () => {
  it("no changes: zero findings, exit 0, and the human view says so", async () => {
    const p = await makeProject(providerFixture());
    try {
      commitBase(p.docsDir);
      const { code, payload } = await diffJson(p, "main");
      expect(code).toBe(0);
      expect(payload.breaking).toBe(false);
      expect(payload.services?.every((s) => s.change === "unchanged" && s.findings.length === 0)).toBe(true);
      const human = await runLoam(p.workDir, "diff", "--base", "main");
      expect(human.code).toBe(0);
      expect(human.stdout).toContain("no fleet-meaningful changes");
    } finally {
      await p.destroy();
    }
  });

  it("the human view carries the glyphs, the victims, and the BREAKING summary", async () => {
    const p = await makeProject(providerFixture());
    try {
      commitBase(p.docsDir);
      await p.write("services/payment-service/openapi.yaml", REMOVED_OP_OPENAPI);
      const human = await runLoam(p.workDir, "diff", "--base", "main");
      expect(human.code).toBe(1);
      expect(human.stdout).toContain("diff vs main");
      expect(human.stdout).toContain("✗ diff.op-removed-consumed");
      expect(human.stdout).toContain("- edge checkout-web → payment-service");
      expect(human.stdout).toContain("BREAKING");
    } finally {
      await p.destroy();
    }
  });

  it("the --json envelope: contractVersion, ok, command, a 40-hex base commit", async () => {
    const p = await makeProject(providerFixture());
    try {
      commitBase(p.docsDir);
      const { payload } = await diffJson(p, "main");
      expect(payload.contractVersion).toBe("1.0");
      expect(payload.ok).toBe(true);
      expect(payload.error).toBeUndefined();
      expect((payload as Record<string, unknown>)["command"]).toBe("diff");
      expect(payload.base?.ref).toBe("main");
      expect(payload.base?.commit).toMatch(/^[0-9a-f]{40}$/);
    } finally {
      await p.destroy();
    }
  });
});
