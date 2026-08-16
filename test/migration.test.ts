/**
 * The migration path, end to end: an actual OpenSpec-shaped repository walked
 * through MIGRATING-from-OpenSpec.md's own disposition table, then judged by
 * `loam validate --all` and merged by `loam archive`.
 *
 * This file is the doc's referee. Every step below cites the disposition it
 * performs, and the assertions pin what the doc PROMISES about the migrated
 * state: `loam new <id> --title "<old change name>"` reproduces the old name
 * as the slug and the id survives the directory round-trip; the adopted state
 * is green with the documented warning set (api.ops-unlinked among them, the
 * doc's own name for the unchecked API axis); and archiving the converted
 * change merges its requirement into the living spec. If the recipe and
 * reality disagree, the DOC is what gets fixed — a passing suite here means
 * the table can be followed literally.
 */
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { makeProject, runLoam, writeFiles, type Project } from "./helpers/harness.js";

/* ------------------------------------------------------------------ */
/* The OpenSpec repo being migrated (vendored-grammar shapes)          */
/* ------------------------------------------------------------------ */

const OS_PROJECT = `# Payments Platform

## Purpose
Everything the storefront needs to take money: authorization, capture, ledger.

## Conventions
- Money is integer minor units, never floats.
- Every externally visible operation is idempotent.
`;

/** Living capability spec — \`# H1\`, \`## Purpose\`, \`## Requirements\`, WHEN/THEN bullets. */
const OS_LIVING_SPEC = `# payments Specification

## Purpose
Owns payment authorization for orders placed in the storefront.

## Requirements

### Requirement: Authorize a payment
The system SHALL authorize a payment before any capture is attempted.

#### Scenario: Successful authorization
- **WHEN** a valid card is presented for authorization
- **THEN** the payment is authorized

#### Scenario: Declined card
- **WHEN** an expired card is presented
- **THEN** authorization is refused with a decline reason
`;

const OS_CAPABILITY_DESIGN = `## Context
The ledger is the source of truth for money movements.

## Established patterns
- Outbox events for every ledger write.
`;

const OS_PROPOSAL = `## Why
Customers cannot get money back without a support ticket.

## What Changes
- Add a refund operation to the payments capability.

## Impact
- Affected specs: payments
`;

const OS_TASKS = `## 1. Implementation
- [ ] 1.1 Add refund endpoint
- [ ] 1.2 Wire refund ledger entries
`;

/** Modern delta-sectioned change spec — carries over verbatim per the table. */
const OS_CHANGE_SPEC = `## ADDED Requirements

### Requirement: Refund a payment
The system SHALL refund a captured payment when a refund is requested.

#### Scenario: Full refund
- **WHEN** a refund is requested for a captured payment
- **THEN** the full captured amount is refunded
`;

const OS_CHANGE_DESIGN = `## Context
Refunds ride the existing ledger.

## Decision
Reuse the capture ledger with negative entries.
`;

const OS_ARCHIVED_CHANGE = `## ADDED Requirements

### Requirement: Authorize a payment
The system SHALL authorize a payment before any capture is attempted.
`;

/** What the `loam adopt` brief would have an agent write — the C4 center OpenSpec never had. */
const MODEL = `specification {
  element softwareSystem
  element container
}

model {
  paymentService = softwareSystem 'payment-service' {
    description 'Owns payment authorization for the storefront'
    api = container 'api'
  }
}

views {
  view of paymentService {
    include *
  }
}
`;

const LANDSCAPE = `specification {
  element softwareSystem
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
`;

/** The adopted contract. No requirement carries an Operations: line yet — the documented debt. */
const OPENAPI = `openapi: 3.1.0
info:
  title: payment-service
  version: "1.0"
paths:
  /payments/authorize:
    post:
      operationId: authorizePayment
      summary: Authorize a payment
      responses:
        "200":
          description: Authorized
`;

/* ------------------------------------------------------------------ */
/* The walk                                                            */
/* ------------------------------------------------------------------ */

/**
 * Build the OpenSpec tree, then perform every disposition in the doc's table.
 * The capability → service decision (the human call the doc refuses to
 * automate): capability `payments` is owned by service `payment-service`.
 */
async function migrate(): Promise<Project> {
  const p = await makeProject({});
  const openspec = join(p.workDir, "openspec");
  await writeFiles(openspec, {
    "project.md": OS_PROJECT,
    "AGENTS.md": "# OpenSpec instructions\n",
    "specs/payments/spec.md": OS_LIVING_SPEC,
    "specs/payments/design.md": OS_CAPABILITY_DESIGN,
    "changes/add-refunds/proposal.md": OS_PROPOSAL,
    "changes/add-refunds/tasks.md": OS_TASKS,
    "changes/add-refunds/design.md": OS_CHANGE_DESIGN,
    "changes/add-refunds/specs/payments/spec.md": OS_CHANGE_SPEC,
    "changes/archive/2025-01-01-initial-payments/specs/payments/spec.md": OS_ARCHIVED_CHANGE,
  });

  // `loam init` scaffolds the docs repo and writes ITS OWN AGENTS.md — the
  // openspec/AGENTS.md row says remove the old instructions, not port them.
  // --create because this docs repo does not exist yet: joining and creating
  // are separate intentions now, so a mistyped --docs cannot split the fleet.
  expect(
    (await runLoam(p.workDir, "init", "--create", "--docs", p.docsDir, "--no-commands")).code,
  ).toBe(0);

  // Row: project.md — "its content becomes the preamble and conventions of the
  // docs repo's AGENTS.md". Appended, keeping loam's stamp intact: the stamp
  // doctrine says a hand-curated file silences agents.stale by keeping it.
  const agents = await p.read("AGENTS.md");
  await p.write("AGENTS.md", `${agents}\n---\n\n${OS_PROJECT}`);

  // Row: specs/<capability>/spec.md — requirements move into the owning
  // service's spec.md under `## Requirements`, plus the frontmatter the doc
  // lists under "What must be added". The body rides verbatim: `## Purpose`
  // and the `# H1` are invisible to every check but legal to keep.
  await p.write(
    "services/payment-service/spec.md",
    `---\nservice: payment-service\nstatus: draft\nowner: payments-team\n---\n\n${OS_LIVING_SPEC}`,
  );

  // Row: specs/<capability>/design.md — a service-level ADR.
  await p.write("services/payment-service/adrs/0001-established-patterns.md", OS_CAPABILITY_DESIGN);

  // "What must be added": model.likec4 and a landscape element (the adopt
  // brief's job — written here as the agent would), and the OpenAPI contract.
  await p.write("services/payment-service/model.likec4", MODEL);
  await p.write("services/payment-service/openapi.yaml", OPENAPI);
  await p.write("architecture/landscape.likec4", LANDSCAPE);

  // Rows: changes/<id>/ in flight, converted. "Feature ids": assign a
  // sequential id and keep the old change name as the slug via --title.
  expect((await runLoam(p.workDir, "new", "FEAT-1", "--title", "Add refunds")).code).toBe(0);
  // proposal.md → intent.md — the same job under a different name.
  await p.write(
    "features/FEAT-1-add-refunds/intent.md",
    `---\nfeature: FEAT-1\ntitle: Add refunds\nstatus: proposed\nowner: payments-team\n---\n\n${OS_PROPOSAL}`,
  );
  // changes/<id>/specs/<capability>/spec.md → features/<FEAT>/specs/<svc>/spec.md,
  // verbatim — modern delta-sectioned files carry over.
  await p.write("features/FEAT-1-add-refunds/specs/payment-service/spec.md", OS_CHANGE_SPEC);
  // changes/<id>/design.md → a feature-level ADR, not an intent appendix.
  await p.write("features/FEAT-1-add-refunds/adrs/0001-refunds-ride-the-ledger.md", OS_CHANGE_DESIGN);
  // changes/<id>/tasks.md → DISCARDED, and changes/archive/ stays where it is.

  return p;
}

describe("migrating an OpenSpec repo, by the doc's own table", () => {
  it("the recipe's mechanical promises hold: slug, id round-trip, discarded tasks, untouched archive", async () => {
    const p = await migrate();
    try {
      // "loam new FEAT-12 --title 'Add two factor auth' scaffolds
      // features/FEAT-12-add-two-factor-auth" — the old change name survives
      // as the slug, and the directory reads back as exactly the id.
      expect(p.exists("features/FEAT-1-add-refunds/intent.md")).toBe(true);
      const list = await runLoam(p.workDir, "list", "features", "--json");
      const features = JSON.parse(list.stdout).features as Array<Record<string, unknown>>;
      expect(features).toHaveLength(1);
      expect(features[0]).toMatchObject({ id: "FEAT-1", dirName: "FEAT-1-add-refunds", archived: false });

      // tasks.md was discarded, not carried.
      expect(p.exists("features/FEAT-1-add-refunds/tasks.md")).toBe(false);
      // changes/archive/ was NOT converted: loam's features/archive starts empty.
      expect(p.exists("features/archive")).toBe(false);
      const archived = await readFile(
        join(p.workDir, "openspec/changes/archive/2025-01-01-initial-payments/specs/payments/spec.md"),
        "utf8",
      );
      expect(archived).toBe(OS_ARCHIVED_CHANGE);
    } finally {
      await p.destroy();
    }
  });

  it("the adopted state validates green with the documented warning set", async () => {
    const p = await migrate();
    try {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(res.code).toBe(0);
      const json = JSON.parse(res.stdout);
      expect(json.valid).toBe(true);
      expect(json.summary.errors).toBe(0);

      const findings = (json.targets as Array<{ findings: Array<{ severity: string; code: string }> }>).flatMap(
        (t) => t.findings,
      );
      // The warning set the doc documents for a freshly migrated repo, exactly:
      //  - api.ops-unlinked — "until requirements carry Operations: lines, the
      //    API axis is unchecked and loam validate says so per service";
      //  - api.ungoverned — the same debt seen from the operations' side;
      //  - openapi.response-undescribed — OpenSpec never carried response
      //    schemas, so the carried-over contract genuinely has none; the warn
      //    is the honest post-migration state, naming the fill-in work;
      //  - sources.absent — frontmatter added, `sources:` still to be filled in.
      const warns = findings.filter((f) => f.severity === "warn").map((f) => f.code);
      expect(warns.sort()).toEqual([
        "api.ops-unlinked",
        "api.ungoverned",
        "openapi.response-undescribed",
        "sources.absent",
      ]);
      // The landscape element and the carried-over `## Requirements` satisfy
      // the checks the doc names as errors when absent.
      const codes = findings.map((f) => f.code);
      expect(codes).toContain("landscape.matched");
      expect(codes).toContain("requirements.covered");
      // Appending project.md to AGENTS.md kept the stamp, so the agent
      // contract is not reported stale.
      expect(codes).not.toContain("agents.stale");
    } finally {
      await p.destroy();
    }
  });

  it("archiving the converted change merges its requirement into the living spec", async () => {
    const p = await migrate();
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-1");
      expect(res.code).toBe(0);

      const living = await p.read("services/payment-service/spec.md");
      // The refund requirement landed inside `## Requirements`, scenario and all…
      expect(living).toContain("### Requirement: Refund a payment");
      expect(living).toContain("the full captured amount is refunded");
      // …next to the carried-over requirement, under the prose the doc says
      // the merge preserves (it rewrites only the requirements run).
      expect(living).toContain("### Requirement: Authorize a payment");
      expect(living).toContain("## Purpose");
      expect(living).toContain("service: payment-service");

      expect(p.exists("features/archive/FEAT-1-add-refunds/intent.md")).toBe(true);
      expect(p.exists("features/FEAT-1-add-refunds")).toBe(false);

      // The repo is still green after the merge — the migration ends on a
      // fleet loam can keep judging.
      const after = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(after.code).toBe(0);
      expect(JSON.parse(after.stdout).valid).toBe(true);
    } finally {
      await p.destroy();
    }
  });
});
