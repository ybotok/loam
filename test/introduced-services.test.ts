/**
 * What a feature INTRODUCES, graded the way the fleet its archive leaves will
 * grade it.
 *
 * Two families, both from the real-fleet review (2026-10-21), reproduced on a
 * copy of the shipped example and nothing else:
 *
 * - a delta element that is no service of ours — an `#external` producer, a
 *   grouping drawn around a new service, the stub of a living external system —
 *   was graded as a new service: `service.no-requirement-delta`, a
 *   `service.exists` unit in `loam tasks`, and `c4.uncovered` asking a group
 *   for a `Covers:` line. The archived fleet asks none of that of it;
 * - `loam status` owed an `openapi.yaml` to every service a feature
 *   introduces, even one nothing calls, so authors wrote `paths: {}` stubs and
 *   the archive published them as living contracts.
 *
 * Every case pins the feature-scope answer AND what `validate --all` says once
 * the archive has landed: a gate stricter than the fleet is as wrong as a
 * laxer one.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cp, readdir, rm } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Finding } from "../src/core/vocabulary/report.js";
import { makeTmpDir, runLoam } from "./helpers/harness.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

const SHIPPED_EXAMPLE = fileURLToPath(new URL("../examples/docs", import.meta.url));

interface Fleet {
  dir: string;
  write(rel: string, text: string): void;
  exists(rel: string): boolean;
  read(rel: string): string;
}

/** A byte copy of the shipped example holding only the in-flight features a case names. */
async function exampleFleet(keep: readonly string[] = []): Promise<Fleet> {
  const root = await makeTmpDir("loam-introduced-");
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const dir = join(root, "fleet");
  await cp(SHIPPED_EXAMPLE, dir, { recursive: true });
  for (const entry of await readdir(join(dir, "features"))) {
    if (entry !== "archive" && !keep.includes(entry)) await rm(join(dir, "features", entry), { recursive: true });
  }
  return {
    dir,
    write: (rel, text) => {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), text, "utf8");
    },
    exists: (rel) => existsSync(join(dir, rel)),
    read: (rel) => readFileSync(join(dir, rel), "utf8"),
  };
}

/** A feature directory: intent, delta and per-service spec deltas. */
function feature(f: Fleet, dirName: string, parts: { delta: string; specs: Record<string, string> }): void {
  const id = /^FEAT-\d+/.exec(dirName)![0];
  f.write(
    `features/${dirName}/intent.md`,
    `---\nfeature: ${id}\ntitle: ${dirName}\nstatus: in_progress\nowner: orders-team\n---\n\n# ${id}\n\n## Why\nThe fleet needs it.\n`,
  );
  f.write(
    `features/${dirName}/delta.likec4`,
    `specification {\n  element group\n  element softwareSystem\n  element container\n  tag external\n  tag ${id}\n}\n\nmodel {\n${parts.delta}\n}\n\nviews {\n  view ${id.replace("-", "_").toLowerCase()} {\n    include *\n  }\n}\n`,
  );
  for (const [rel, text] of Object.entries(parts.specs)) f.write(`features/${dirName}/specs/${rel}`, text);
}

/** One ADDED requirement with one scenario; `extra` carries its join lines. */
function added(service: string, id: string, name: string, extra = ""): string {
  return `# ${service} — delta for ${id}\n\n## ADDED Requirements\n\n### Requirement: ${name}\nThe service SHALL ${name.toLowerCase()}.\n${extra === "" ? "" : `\n${extra}\n`}\n#### Scenario: ${name} on request\n- **Given** a running fleet\n- **When** ${name.toLowerCase()} is requested\n- **Then** it is done\n`;
}

async function findingsOf(dir: string, ...args: string[]): Promise<Finding[]> {
  const run = await runLoam(dir, "validate", ...args, "--json");
  return (JSON.parse(run.stdout) as { targets: Array<{ findings: Finding[] }> }).targets.flatMap((t) => t.findings);
}

const ofCode = (all: readonly Finding[], code: string): Finding[] => all.filter((f) => f.code === code);

/** The `service.exists` subjects of a feature's checklist — the units `loam tasks` lists. */
async function existsClaims(dir: string, id: string): Promise<string[]> {
  const run = await runLoam(dir, "verify", id, "--json");
  expect(run.code, run.out).toBe(0);
  const claims = (JSON.parse(run.stdout) as { claims: Array<{ kind: string; subject: string }> }).claims;
  return claims.filter((c) => c.kind === "service.exists").map((c) => c.subject).sort();
}

async function archived(dir: string, id: string): Promise<string> {
  const run = await runLoam(dir, "archive", id);
  expect(run.code, run.out).toBe(0);
  return run.stdout;
}

/* ------------------------------------------------------------------ */
/* 032 — what a delta draws that is no service of ours                  */
/* ------------------------------------------------------------------ */

describe("an #external producer a delta draws is somebody else's system", () => {
  it("owes no requirement delta and no service.exists unit, and the archived fleet agrees", async () => {
    const f = await exampleFleet();
    feature(f, "FEAT-301-rates", {
      delta: [
        "  marketplace = group 'Marketplace' {",
        "    orderService = softwareSystem 'order-service'",
        "  }",
        "  ratesFeed = softwareSystem 'rates-feed' {",
        "    #FEAT-301 #external",
        "    description 'Exchange rates published by a vendor'",
        "  }",
        // The control: a new system of OURS with no specs/ is still asked for one.
        "  reportingHub = softwareSystem 'reporting-hub' {",
        "    #FEAT-301",
        "    description 'Collects order reports'",
        "  }",
        "  ratesFeed -> marketplace.orderService 'Pushes exchange rates' {",
        "    #FEAT-301",
        "  }",
        "  marketplace.orderService -> reportingHub 'Sends order reports' {",
        "    #FEAT-301",
        "  }",
      ].join("\n"),
      specs: { "order-service/spec.md": added("order-service", "FEAT-301", "Price an order in the buyer's currency") },
    });

    const before = await findingsOf(f.dir, "--feature", "FEAT-301");
    expect(ofCode(before, "service.no-requirement-delta").map((x) => x.message)).toEqual([
      "new service reporting-hub has no requirement delta under specs/",
    ]);
    expect(await existsClaims(f.dir, "FEAT-301")).toEqual(["reporting-hub"]);

    const out = await archived(f.dir, "FEAT-301");
    expect(out).not.toContain("new service rates-feed");
    const after = await findingsOf(f.dir, "--all");
    // The prediction, both ways: the fleet asks the system of ours for a
    // directory, and never asks the external one.
    expect(ofCode(after, "landscape.service-undocumented").map((x) => x.subject)).toEqual(["reporting-hub"]);
    expect(f.exists("services/rates-feed")).toBe(false);
  });

  it("…and so is the stub of a living #external system, whose tag the delta does not repeat", async () => {
    // A delta re-declares what it attaches to without the living tags, and the
    // merge keeps the living element's: the map the archive leaves still says
    // `stripe` is not ours, so the stub is no new service either. The same
    // holds for the stub of a living service of ours — re-declaring is not
    // introducing.
    const f = await exampleFleet();
    feature(f, "FEAT-302-refunds", {
      delta: [
        "  marketplace = group 'Marketplace' {",
        "    paymentService = softwareSystem 'payment-service'",
        "    orderService = softwareSystem 'order-service' {",
        "      #FEAT-302",
        "    }",
        "  }",
        "  stripe = softwareSystem 'stripe' {",
        "    #FEAT-302",
        "  }",
        "  marketplace.paymentService -> stripe 'Requests card refunds' {",
        "    #FEAT-302",
        "  }",
      ].join("\n"),
      specs: { "payment-service/spec.md": added("payment-service", "FEAT-302", "Refund a captured card payment") },
    });

    expect(ofCode(await findingsOf(f.dir, "--feature", "FEAT-302"), "service.no-requirement-delta")).toEqual([]);
    // Neither stub is work to do: not the external one, and not the adopted
    // order-service, which a nested tag must not turn into "create service".
    expect(await existsClaims(f.dir, "FEAT-302")).toEqual([]);

    // Where the living map cannot be read, the delta answers alone — the
    // reading every element had before the map was asked.
    f.write("architecture/landscape.likec4", `${f.read("architecture/landscape.likec4")}\nmodel { broken (((\n`);
    expect(await existsClaims(f.dir, "FEAT-302")).toEqual(["stripe"]);
  });

  it("what a delta draws INSIDE a system that is not a grouping belongs to that system", async () => {
    // Only a grouping is looked through. A container drawn in a new system
    // that has no directory yet is that system's, and an endpoint drawn
    // inside a vendor is the vendor's — neither is a service of its own.
    const f = await exampleFleet();
    feature(f, "FEAT-307-webhooks", {
      delta: [
        "  marketplace = group 'Marketplace' {",
        "    paymentService = softwareSystem 'payment-service'",
        "  }",
        "  stripe = softwareSystem 'stripe' {",
        "    #external",
        "    webhooks = container 'Webhooks' {",
        "      #FEAT-307",
        "    }",
        "  }",
        "  ledgerHub = softwareSystem 'ledger-hub' {",
        "    #FEAT-307",
        "    api = container 'API' {",
        "      #FEAT-307",
        "    }",
        "  }",
        "  stripe.webhooks -> marketplace.paymentService 'Notifies refunds' {",
        "    #FEAT-307",
        "  }",
      ].join("\n"),
      specs: { "payment-service/spec.md": added("payment-service", "FEAT-307", "Settle a refund the acquirer confirms") },
    });
    expect(await existsClaims(f.dir, "FEAT-307")).toEqual(["ledger-hub"]);
  });
});

describe("a grouping a delta draws around a new service is scenery", () => {
  const LOYALTY_ARCH = (covers: string): string =>
    `# loyalty-service — architecture delta for FEAT-303\n\n## ADDED Requirements\n\n### Requirement: Points are written once\nThe service SHALL record each accrual exactly once.\n\n${covers}\n\n#### Scenario: A duplicate accrual\n- **Given** an accrual already recorded\n- **When** it arrives again\n- **Then** the balance is unchanged\n`;

  function loyalty(f: Fleet, covers: string): void {
    feature(f, "FEAT-303-loyalty", {
      delta: [
        "  marketplace = group 'Marketplace' {",
        "    orderService = softwareSystem 'order-service'",
        "    loyaltyDomain = group 'Loyalty' {",
        "      #FEAT-303",
        "      loyaltyService = softwareSystem 'loyalty-service' {",
        "        #FEAT-303",
        "        description 'Accrues points per order'",
        "        metadata {",
        "          service 'loyalty-service'",
        "        }",
        "      }",
        "    }",
        "  }",
      ].join("\n"),
      specs: {
        "loyalty-service/spec.md": added("loyalty-service", "FEAT-303", "Accrue points for a paid order"),
        "loyalty-service/arch.spec.md": LOYALTY_ARCH(covers),
      },
    });
  }

  it("owes no Covers: line of its own, while the service inside it is still graded", async () => {
    const covered = await exampleFleet();
    loyalty(covered, "Covers: loyalty-service");
    expect(ofCode(await findingsOf(covered.dir, "--feature", "FEAT-303"), "c4.uncovered")).toEqual([]);

    // The control: with the service's own Covers: line gone, the obligation is
    // the SERVICE's, and only the service's.
    const bare = await exampleFleet();
    loyalty(bare, "");
    const uncovered = ofCode(await findingsOf(bare.dir, "--feature", "FEAT-303"), "c4.uncovered");
    expect(uncovered.map((x) => x.subject)).toEqual(["loyalty-service"]);
  });

  it("is no service that has to exist, and the service drawn inside it is one", async () => {
    // Depth is not a fact about a service: the new service drawn inside the
    // map's own group — the shape the shipped FEAT-101 uses — was read as a
    // container because its id has a dot in it.
    const f = await exampleFleet();
    loyalty(f, "Covers: loyalty-service");
    expect(await existsClaims(f.dir, "FEAT-303")).toEqual(["loyalty-service"]);

    await archived(f.dir, "FEAT-303");
    const after = await findingsOf(f.dir, "--all");
    expect(ofCode(after, "landscape.service-undocumented")).toEqual([]);
    expect(f.exists("services/loyalty-service/spec.md")).toBe(true);
  });

  it("a TOP-LEVEL grouping is not called a service after its title either", async () => {
    const f = await exampleFleet();
    feature(f, "FEAT-304-rewards", {
      delta: [
        "  rewards = group 'Rewards' {",
        "    #FEAT-304",
        "    rewardsService = softwareSystem 'rewards-service' {",
        "      #FEAT-304",
        "      metadata {",
        "        service 'rewards-service'",
        "      }",
        "    }",
        "  }",
      ].join("\n"),
      specs: { "rewards-service/spec.md": added("rewards-service", "FEAT-304", "Grant a reward for a milestone") },
    });
    expect(await existsClaims(f.dir, "FEAT-304")).toEqual(["rewards-service"]);
    expect(ofCode(await findingsOf(f.dir, "--feature", "FEAT-304"), "service.no-requirement-delta")).toEqual([]);
  });

  it("the map's own group, re-declared around nothing but the new service, is still a grouping", async () => {
    // The delta declares `marketplace` and, inside it, only the service it
    // introduces — no sibling, so nothing IN THE DELTA shows the group holding
    // a service, and fraud-service has no directory or binding yet. The group
    // was then read as fraud-service's owner: no `service.exists`, no
    // `service.no-requirement-delta`, and — once the work packet learned to
    // keep non-services out — no service in `loam tasks` or `loam delta`
    // either, while the map the merge leaves draws it as a service like any
    // other. The living map's `marketplace` groups services, and that answers.
    const f = await exampleFleet();
    feature(f, "FEAT-305-fraud", {
      delta: [
        "  marketplace = group 'Marketplace' {",
        "    fraudService = softwareSystem 'fraud-service' {",
        "      #FEAT-305",
        "      description 'Scores a payment for fraud'",
        "    }",
        "  }",
        "  stripe = softwareSystem 'stripe'",
        "  marketplace.fraudService -> stripe 'Scores a card' {",
        "    #FEAT-305",
        "    metadata { op 'scoreCard' }",
        "  }",
      ].join("\n"),
      specs: {},
    });
    expect(await existsClaims(f.dir, "FEAT-305")).toEqual(["fraud-service"]);
    expect(ofCode(await findingsOf(f.dir, "--feature", "FEAT-305"), "service.no-requirement-delta").map((x) => x.message)).toEqual([
      "new service fraud-service has no requirement delta under specs/",
    ]);

    const tasks = JSON.parse((await runLoam(f.dir, "tasks", "FEAT-305", "--json")).stdout) as {
      services: string[];
      units: Array<{ kind: string; subject: string }>;
    };
    expect(tasks.services).toEqual(["fraud-service"]);
    expect(tasks.units.filter((u) => u.kind === "c4.calls").map((u) => u.subject)).toEqual(["fraud-service"]);

    const delta = await runLoam(f.dir, "delta", "FEAT-305", "--service", "fraud-service", "--json");
    expect(delta.code, delta.out).toBe(0);
    expect((JSON.parse(delta.stdout) as { services: string[] }).services).toEqual(["fraud-service"]);
  });
});

/* ------------------------------------------------------------------ */
/* 033 — a contract owed on evidence, not on newness                     */
/* ------------------------------------------------------------------ */

interface StatusArtifact {
  id: string;
  service: string | null;
  required: boolean;
  status: string;
}

async function featureStatus(dir: string, id: string): Promise<{ stage: string; openapi: StatusArtifact[]; next: string[] }> {
  const run = await runLoam(dir, "status", id, "--json");
  const payload = JSON.parse(run.stdout) as {
    feature: { stage: string };
    artifacts: StatusArtifact[];
    next: Array<{ code: string }>;
  };
  return {
    stage: payload.feature.stage,
    openapi: payload.artifacts.filter((a) => a.id === "openapi"),
    next: payload.next.map((s) => s.code),
  };
}

async function fleetMissing(dir: string, id: string): Promise<string[]> {
  const run = await runLoam(dir, "status", "--json");
  const payload = JSON.parse(run.stdout) as { features: Array<{ id: string; missing: string[] }> };
  return payload.features.find((x) => x.id === id)!.missing;
}

/** A new service whose only edge goes OUT: nothing calls it, no requirement governs an operation on it. */
function auditFeature(f: Fleet, extraDelta = ""): void {
  feature(f, "FEAT-305-audit", {
    delta: [
      "  marketplace = group 'Marketplace' {",
      "    orderService = softwareSystem 'order-service'",
      "    auditService = softwareSystem 'audit-service' {",
      "      #FEAT-305",
      "      description 'Keeps an audit trail of order changes'",
      "      metadata {",
      "        service 'audit-service'",
      "      }",
      "    }",
      "  }",
      "  stripe = softwareSystem 'stripe'",
      "  marketplace.auditService -> stripe 'Reads settlement reports' {",
      "    #FEAT-305",
      "  }",
      extraDelta,
    ].join("\n"),
    specs: { "audit-service/spec.md": added("audit-service", "FEAT-305", "Record every order change") },
  });
}

describe("a new service is owed a contract only when something joins into it", () => {
  it("one nothing calls owes none — in both status forms, as validate already says", async () => {
    const f = await exampleFleet();
    auditFeature(f);
    const status = await featureStatus(f.dir, "FEAT-305");
    expect(status.openapi).toEqual([expect.objectContaining({ service: "audit-service", required: false, status: "done" })]);
    expect(status.stage).not.toBe("missing");
    expect(status.next).not.toContain("next.author-openapi");
    expect(await fleetMissing(f.dir, "FEAT-305")).toEqual([]);
    expect(ofCode(await findingsOf(f.dir, "--feature", "FEAT-305"), "c4-api.op-undefined")).toEqual([]);
  });

  it("an op-linked edge INTO it owes one, with no Operations: line written", async () => {
    const f = await exampleFleet();
    auditFeature(f, "  marketplace.orderService -> marketplace.auditService 'Calls recordChange' {\n    #FEAT-305\n    metadata { op 'recordChange' }\n  }");
    const status = await featureStatus(f.dir, "FEAT-305");
    expect(status.openapi).toEqual([expect.objectContaining({ service: "audit-service", required: true, status: "missing" })]);
    expect(status.next).toContain("next.author-openapi");
    expect(await fleetMissing(f.dir, "FEAT-305")).toEqual(["audit-service/openapi"]);
  });

  it("…and so does an ADOPTED service with no contract, which status used to wave through beside the gate's error", async () => {
    // checkout-web is living and has no openapi.yaml, on purpose. An edge this
    // feature draws INTO it with an op is `c4-api.op-undefined` at the gate —
    // so "none owed" in the same payload was the projection contradicting itself.
    const f = await exampleFleet();
    feature(f, "FEAT-306-receipts", {
      delta: [
        "  marketplace = group 'Marketplace' {",
        "    orderService = softwareSystem 'order-service'",
        "    checkoutWeb = softwareSystem 'checkout-web'",
        "  }",
        "  marketplace.orderService -> marketplace.checkoutWeb 'Calls pushReceipt' {",
        "    #FEAT-306",
        "    metadata { op 'pushReceipt' }",
        "  }",
      ].join("\n"),
      specs: { "checkout-web/spec.md": added("checkout-web", "FEAT-306", "Show the receipt the moment it is issued") },
    });
    expect(ofCode(await findingsOf(f.dir, "--feature", "FEAT-306"), "c4-api.op-undefined")).toHaveLength(1);
    const status = await featureStatus(f.dir, "FEAT-306");
    expect(status.openapi).toEqual([expect.objectContaining({ service: "checkout-web", required: true, status: "missing" })]);
    expect(await fleetMissing(f.dir, "FEAT-306")).toEqual(["checkout-web/openapi"]);
  });
});

describe("the archive does not publish a contract that describes nothing", () => {
  const STUB = `openapi: 3.1.0\ninfo:\n  title: audit-service\n  version: "1.0"\npaths: {}\n`;

  it("a paths: {} stub for a new service is not copied into a living openapi.yaml", async () => {
    const f = await exampleFleet();
    auditFeature(f);
    f.write("features/FEAT-305-audit/specs/audit-service/openapi.yaml", STUB);
    const out = await archived(f.dir, "FEAT-305");
    expect(out).toContain("openapi: audit-service — nothing to merge");
    expect(out).not.toContain("created ()");
    expect(f.exists("services/audit-service/spec.md")).toBe(true);
    expect(f.exists("services/audit-service/openapi.yaml")).toBe(false);
    // And the fleet the archive leaves has nothing to say about the absence:
    // nothing calls the service, so `service.no-openapi` is the documented silence.
    expect(ofCode(await findingsOf(f.dir, "--all"), "service.no-openapi").filter((x) => x.subject === "audit-service")).toEqual([]);
  });

  it("…while one that carries only a shared schema is still created", async () => {
    const f = await exampleFleet();
    auditFeature(f);
    f.write(
      "features/FEAT-305-audit/specs/audit-service/openapi.yaml",
      `${STUB}components:\n  schemas:\n    AuditEntry:\n      type: object\n`,
    );
    await archived(f.dir, "FEAT-305");
    expect(f.read("services/audit-service/openapi.yaml")).toContain("AuditEntry");
  });
});
