/**
 * A synthetic fleet at something like production shape: 30 services across
 * every maturity rung, a landscape chaining them with op-linked calls, and 10
 * active features adding cross-service operations with tagged deltas.
 *
 * Everything else in the suite validates fleets of one to three services, so
 * nothing pinned that `validate --all` and `list --json` stay CORRECT when the
 * numbers grow: that finding counts scale linearly with construction (no
 * accidental cross-product findings, no findings lost to short-circuiting),
 * that a clean fleet exits 0 at size, and that the maturity rollup adds up to
 * the fleet that was actually built. The fixture is generated programmatically
 * so the expected counts are DERIVED from the same constants that build it —
 * changing the shape changes both sides together.
 *
 * Wall-clock is gated, but only as a blowup alarm, and the ceiling has to
 * tolerate the fact that this file runs inside a 64-file parallel suite. What
 * it costs, measured: ~12s for `validate --all` on an idle box, ~30s with the
 * cores saturated, and 65-77s when the whole suite is running beside it. Those
 * numbers are the machine, not a regression — the same fixture on 4d8cb4b (the
 * commit before the hardening campaign) measures 11.9s against 12.1s today,
 * so the earlier "~4s on a dev laptop" in this header described hardware this
 * one is not.
 *
 * It exists to catch pathological blowups — an accidental per-service re-parse
 * of the landscape or a return of the per-feature double-load turns 40-odd
 * workspace spins into hundreds, and THAT is what must never land silently.
 * That class is an order of magnitude, so it trips this ceiling under any load;
 * vitest's own 120s testTimeout is the hard backstop behind it, and the ceiling
 * sits just under it so a blowup fails with the message below rather than an
 * opaque timeout.
 */
import { describe, it, expect } from "vitest";
import { makeProject, runLoam, type Project } from "./helpers/harness.js";

/* ------------------------------------------------------------------ */
/* Construction                                                        */
/* ------------------------------------------------------------------ */

/** Maturity distribution, in rung order. Empty is absent on purpose: a service
 * directory with no artifacts is a validate ERROR, and this fleet is clean. */
/**
 * svc-1 … svc-5: model + spec, no openapi.yaml, and NOTHING in the landscape
 * calls an operation on them — workers, crons and consumers common in
 * multi-service fleets. They are fully documented, and the maturity ladder used to pin
 * them at `partial` forever for missing a contract nobody wants; it now asks
 * for an OpenAPI only where the landscape proves an API is expected.
 */
const APILESS = 5;
const DOCUMENTED = 10; // svc-6  … svc-15  the full triple
const SOURCED = 10; //   svc-16 … svc-25  triple + sources declared
const VOUCHED = 5; //    svc-26 … svc-30  triple + sources + digest + verified
const SERVICES = APILESS + DOCUMENTED + SOURCED + VOUCHED;

const FEATURES = 10; // FEAT-1 … FEAT-10, each an edge svc-(15+i) → svc-(5+i)

const svc = (i: number): string => `svc-${i}`;
/** LikeC4 identifiers take no dashes. */
const ident = (i: number): string => `svc${i}`;
const hasOpenapi = (i: number): boolean => i > APILESS;

function model(i: number): string {
  return `specification {
  element softwareSystem
}

model {
  ${ident(i)} = softwareSystem '${svc(i)}' {
    metadata { service '${svc(i)}' }
  }
}

views {
  view of ${ident(i)} {
    include *
  }
}
`;
}

function spec(i: number): string {
  const sourced = i > APILESS + DOCUMENTED;
  const vouched = i > APILESS + DOCUMENTED + SOURCED;
  const fm = [
    `service: ${svc(i)}`,
    `status: ${vouched ? "verified" : "draft"}`,
    "owner: fleet-team",
    ...(sourced ? ["sources:", `  - src/${svc(i)}/`] : []),
    ...(vouched ? [`sources_digest: 0123456789abcdef`] : []),
  ].join("\n");
  const ops = hasOpenapi(i) ? `\nOperations: op_${i}_a, op_${i}_b\n` : "";
  return `---
${fm}
---

# ${svc(i)}

## Requirements

### Requirement: Do the ${svc(i)} job
The service SHALL do the ${svc(i)} job exactly once per request.
${ops}
#### Scenario: The job is done
- **Given** a request to ${svc(i)}
- **When** the job runs
- **Then** it completes exactly once
`;
}

function openapi(i: number): string {
  // Responses carry a minimal schema so the synthetic fleet models contract
  // depth — a description-only response would fire openapi.response-undescribed
  // twenty-five times and drown the counts this suite derives by construction.
  return `openapi: 3.1.0
info:
  title: ${svc(i)}
  version: "1.0"
paths:
  /${svc(i)}/a:
    post:
      operationId: op_${i}_a
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  ok:
                    type: boolean
  /${svc(i)}/b:
    get:
      operationId: op_${i}_b
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  ok:
                    type: boolean
`;
}

/** All 30 services drawn (anything undrawn is a validate error), and a call
 * chain across the openapi-bearing ones: svc-k → svc-(k+1), op-linked. */
function landscape(): string {
  const els = Array.from({ length: SERVICES }, (_, k) => {
    const i = k + 1;
    return `  ${ident(i)} = softwareSystem '${svc(i)}' {
    metadata { service '${svc(i)}' }
  }`;
  });
  const edges: string[] = [];
  for (let i = APILESS + 1; i < SERVICES; i += 1) {
    edges.push(`  ${ident(i)} -> ${ident(i + 1)} 'Calls op_${i + 1}_a' {
    metadata { op 'op_${i + 1}_a' }
  }`);
  }
  return `specification {
  element softwareSystem
}

model {
${[...els, "", ...edges].join("\n")}
}

views {
  view landscape {
    include *
  }
}
`;
}

/** Feature i: svc-(15+i) starts calling a NEW operation on svc-(5+i). */
function featureFiles(i: number): Record<string, string> {
  const source = 15 + i;
  const target = 5 + i;
  const id = `FEAT-${i}`;
  const delta = `specification {
  element softwareSystem
  tag ${id}
}

model {
  ${ident(source)} = softwareSystem '${svc(source)}' {
    metadata { service '${svc(source)}' }
  }
  ${ident(target)} = softwareSystem '${svc(target)}' {
    metadata { service '${svc(target)}' }
  }

  ${ident(source)} -> ${ident(target)} 'Calls featOp_${i}' {
    #${id}
    metadata { op 'featOp_${i}' }
  }
}

views {
  view feat_${i} {
    include *
  }
}
`;
  const featSpec = `# ${svc(target)} — delta for ${id}

## ADDED Requirements

### Requirement: Serve feature ${i}
The service SHALL serve feature ${i} requests from ${svc(source)}.

Operations: featOp_${i}

#### Scenario: Feature ${i} request served
- **Given** a feature ${i} request from ${svc(source)}
- **When** ${svc(target)} receives it
- **Then** ${svc(target)} serves it
`;
  const featOpenapi = `openapi: 3.1.0
info:
  title: ${svc(target)}
  version: "1.0"
paths:
  /${svc(target)}/feat-${i}:
    post:
      operationId: featOp_${i}
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  ok:
                    type: boolean
`;
  // The architecture spec axis at fleet shape: every feature's tagged edge is
  // covered by an arch requirement, so a CLEAN fleet stays clean — and the
  // c4.uncovered obligation is exercised ${FEATURES} times without firing.
  const featArchSpec = `# ${svc(target)} — architecture delta for ${id}

## ADDED Requirements

### Requirement: Feature ${i} call survives retries
The service SHALL treat featOp_${i} as idempotent under caller retries.

Covers: ${ident(source)} -> ${ident(target)}

#### Scenario: A retried feature ${i} call is a no-op
- **Given** a feature ${i} request already served
- **When** ${svc(source)} retries it
- **Then** ${svc(target)} returns the original result and does nothing twice
`;
  // featureCoherence now gates on an unwritten intent (intent.empty), so each
  // generated feature states its Why in one authored sentence. Without this the
  // ten features would add ten warnings the construction does not predict, and
  // the derived counts below would stop being derived. The frontmatter is
  // complete on purpose: an intent that EXISTS is graded by featureProvenance,
  // and a missing header or owner would trade the ten intent.empty warnings for
  // ten frontmatter ones.
  const featIntent = `---
feature: ${id}
status: proposed
owner: fleet-team
---

# ${id}

Let ${svc(source)} call featOp_${i} on ${svc(target)} so the synthetic call chain gains one operation.
`;
  return {
    [`features/${id}-scale/intent.md`]: featIntent,
    [`features/${id}-scale/delta.likec4`]: delta,
    [`features/${id}-scale/specs/${svc(target)}/spec.md`]: featSpec,
    [`features/${id}-scale/specs/${svc(target)}/arch.spec.md`]: featArchSpec,
    [`features/${id}-scale/specs/${svc(target)}/openapi.yaml`]: featOpenapi,
  };
}

function fleet(): Record<string, string> {
  const files: Record<string, string> = { "architecture/landscape.likec4": landscape() };
  for (let i = 1; i <= SERVICES; i += 1) {
    files[`services/${svc(i)}/model.likec4`] = model(i);
    files[`services/${svc(i)}/spec.md`] = spec(i);
    if (hasOpenapi(i)) files[`services/${svc(i)}/openapi.yaml`] = openapi(i);
  }
  for (let i = 1; i <= FEATURES; i += 1) Object.assign(files, featureFiles(i));
  return files;
}

/* ------------------------------------------------------------------ */
/* Pins                                                                */
/* ------------------------------------------------------------------ */

describe(`the synthetic fleet: ${SERVICES} services, ${FEATURES} features`, () => {
  async function fleetProject(): Promise<Project> {
    return makeProject(fleet());
  }

  it("validate --all is green at fleet size, with finding counts derived from construction", async () => {
    const p = await fleetProject();
    try {
      const started = performance.now();
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      const elapsed = performance.now() - started;
      expect(res.code).toBe(0);
      const json = JSON.parse(res.stdout);
      expect(json.valid).toBe(true);
      expect(json.summary).toEqual({
        services: SERVICES,
        features: FEATURES,
        errors: 0,
        // The one warning a clean adopted fleet still carries: every service
        // whose frontmatter declares no `sources` (partial + documented).
        warnings: APILESS + DOCUMENTED,
      });
      // Services that DO declare sources can only be checked from their own
      // repos — the fleet gate must say so rather than read as "verified".
      expect(json.sourcesUnverifiableFromHere).toBe(SOURCED + VOUCHED);

      const findings = (json.targets as Array<{ findings: Array<{ severity: string; code: string }> }>).flatMap(
        (t) => t.findings,
      );
      const count = (code: string): number => findings.filter((f) => f.code === code).length;
      expect(count("landscape.matched")).toBe(1);
      expect(count("c4.valid")).toBe(SERVICES);
      // Every service in the call chain except the first is called with an op.
      expect(count("spine.resolved")).toBe(DOCUMENTED + SOURCED + VOUCHED - 1);
      // One living spec per service, plus one requirement delta and one arch
      // requirement delta per feature.
      expect(count("requirements.covered")).toBe(SERVICES + 2 * FEATURES);
      // Every tagged edge is covered by its feature's arch delta.
      expect(count("c4.uncovered")).toBe(0);
      expect(count("covers.unknown")).toBe(0);
      expect(count("sources.absent")).toBe(APILESS + DOCUMENTED);
      expect(count("delta.valid")).toBe(FEATURES);
      expect(count("archedge.covered")).toBe(FEATURES);
      expect(count("coherence.ok")).toBe(FEATURES);
      // No finding slipped in that the construction does not predict.
      expect(findings.filter((f) => f.severity === "error")).toEqual([]);
      expect(
        findings.filter((f) => f.severity === "warn" && f.code !== "sources.absent"),
      ).toEqual([]);

      // The blowup alarm (see header): sized for a loaded box inside the
      // parallel suite, and kept under vitest's 120s testTimeout so a real
      // blowup reports this message instead of timing out.
      expect(
        elapsed,
        `validate --all over ${SERVICES} services / ${FEATURES} features took ${Math.round(elapsed)}ms`,
      ).toBeLessThan(110_000);
    } finally {
      await p.destroy();
    }
  });

  it("list --json's maturity rollup adds up to the fleet that was built", async () => {
    const p = await fleetProject();
    try {
      const res = await runLoam(p.workDir, "list", "--json");
      expect(res.code).toBe(0);
      const json = JSON.parse(res.stdout);
      expect(json.maturity).toEqual({
        empty: 0,
        // Nothing is `partial`: every service in this fleet has the artifacts
        // that are actually expected of it. The five API-less ones sit at
        // `documented` beside the ten with contracts — the rung means "has what
        // it needs", not "has an openapi.yaml".
        partial: 0,
        documented: APILESS + DOCUMENTED,
        sourced: SOURCED,
        vouched: VOUCHED,
      });
      expect(json.services).toHaveLength(SERVICES);
      expect(json.features).toHaveLength(FEATURES);
      // Spot-check the rungs land on the intended services, not just in the
      // intended quantities.
      const byId = new Map(
        (json.services as Array<{ id: string; maturity: string }>).map((s) => [s.id, s.maturity]),
      );
      expect(byId.get("svc-1")).toBe("documented");
      expect(byId.get("svc-6")).toBe("documented");
      expect(byId.get("svc-16")).toBe("sourced");
      expect(byId.get("svc-30")).toBe("vouched");
    } finally {
      await p.destroy();
    }
  });
});
