/**
 * The synthetic-fleet generator, parameterized by shape.
 *
 * Extracted from test/scale.test.ts so that scripts/bench-validate.ts can build
 * the same fleet at benchmark size (120 services) without importing a vitest
 * file — this module deliberately imports nothing from vitest and nothing from
 * src/, so tsx can load it standalone. The scale suite keeps its 5/10/10/5 + 10
 * shape and derives every pinned count from the same constants it passes in;
 * the benchmark records its own shape in docs/BENCHMARKS.md. One generator, two
 * consumers, so the fixture the numbers describe is the fixture the suite pins.
 */

/**
 * Maturity distribution, in rung order. Empty is absent on purpose: a service
 * directory with no artifacts is a validate ERROR, and generated fleets are
 * clean.
 *
 * `apiless` (svc-1 … svc-<apiless>): model + spec, no openapi.yaml, and NOTHING
 * in the landscape calls an operation on them — workers, crons and consumers
 * common in multi-service fleets. They are fully documented, and the maturity
 * ladder used to pin them at `partial` forever for missing a contract nobody
 * wants; it now asks for an OpenAPI only where the landscape proves an API is
 * expected. `documented` services carry the full triple, `sourced` adds
 * declared sources, `vouched` adds the digest + verified status.
 */
export interface FleetShape {
  apiless: number;
  documented: number;
  sourced: number;
  vouched: number;
  /** Active features; feature i adds one cross-service op-linked tagged edge. */
  features: number;
}

export function serviceCount(shape: FleetShape): number {
  return shape.apiless + shape.documented + shape.sourced + shape.vouched;
}

const svc = (i: number): string => `svc-${i}`;
/** LikeC4 identifiers take no dashes. */
const ident = (i: number): string => `svc${i}`;
const hasOpenapi = (shape: FleetShape, i: number): boolean => i > shape.apiless;

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

function spec(shape: FleetShape, i: number): string {
  const sourced = i > shape.apiless + shape.documented;
  const vouched = i > shape.apiless + shape.documented + shape.sourced;
  const fm = [
    `service: ${svc(i)}`,
    `status: ${vouched ? "verified" : "draft"}`,
    "owner: fleet-team",
    ...(sourced ? ["sources:", `  - src/${svc(i)}/`] : []),
    ...(vouched ? [`sources_digest: 0123456789abcdef`] : []),
  ].join("\n");
  const ops = hasOpenapi(shape, i) ? `\nOperations: op_${i}_a, op_${i}_b\n` : "";
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
  // once per contract-bearing service and drown the counts the scale suite
  // derives by construction.
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

/** All services drawn (anything undrawn is a validate error), and a call
 * chain across the openapi-bearing ones: svc-k → svc-(k+1), op-linked. */
function landscape(shape: FleetShape): string {
  const services = serviceCount(shape);
  const els = Array.from({ length: services }, (_, k) => {
    const i = k + 1;
    return `  ${ident(i)} = softwareSystem '${svc(i)}' {
    metadata { service '${svc(i)}' }
  }`;
  });
  const edges: string[] = [];
  for (let i = shape.apiless + 1; i < services; i += 1) {
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

/**
 * Feature i: the i-th `sourced` service starts calling a NEW operation on the
 * i-th `documented` one — always cross-service, always between openapi-bearing
 * services, at every shape (`features` must not exceed `documented` or
 * `sourced`). At the scale suite's 5/10/10/5 shape this is the original
 * svc-(15+i) → svc-(5+i).
 */
function featureFiles(shape: FleetShape, i: number): Record<string, string> {
  const source = shape.apiless + shape.documented + i;
  const target = shape.apiless + i;
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
  // c4.uncovered obligation is exercised `features` times without firing.
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
  // featureCoherence gates on an unwritten intent (intent.empty), so each
  // generated feature states its Why in one authored sentence. Without this the
  // features would each add a warning the construction does not predict, and
  // the derived counts in the scale suite would stop being derived. The
  // frontmatter is complete on purpose: an intent that EXISTS is graded by
  // featureProvenance, and a missing header or owner would trade the
  // intent.empty warnings for frontmatter ones.
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

/** The whole fleet as relPath → content, ready for makeProject/writeFiles. */
export function fleetFiles(shape: FleetShape): Record<string, string> {
  const services = serviceCount(shape);
  const files: Record<string, string> = { "architecture/landscape.likec4": landscape(shape) };
  for (let i = 1; i <= services; i += 1) {
    files[`services/${svc(i)}/model.likec4`] = model(i);
    files[`services/${svc(i)}/spec.md`] = spec(shape, i);
    if (hasOpenapi(shape, i)) files[`services/${svc(i)}/openapi.yaml`] = openapi(i);
  }
  for (let i = 1; i <= shape.features; i += 1) Object.assign(files, featureFiles(shape, i));
  return files;
}
