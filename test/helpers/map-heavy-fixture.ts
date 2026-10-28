/**
 * A synthetic fleet whose weight is in the MAP — the shape the 120-service
 * benchmark fleet (`./fleet-fixture.ts`) never had.
 *
 * That fixture stresses the number of documents: 120 services, each a tiny
 * STANDALONE model, around a one-line-per-service landscape. A pilot fleet
 * audited on 2026-10-28 measured `validate --all` at 56 s and
 * `validate --feature` at 27 s against that fixture's ~0.7 s, and its shape was
 * the opposite one: few, mostly empty, EXTENDING models around a map of
 * thousands of lines. An extending model is read inside a project of its own —
 * the whole `architecture/` project plus that one model — so the map is parsed
 * once per service, and nothing in the old fixture could see what that costs.
 *
 * Nothing here comes from that fleet but its counts; every name is generated
 * (`d<n>`, `a<n>`, `svc<n>`, `x<n>`). The counts are the ones it reported:
 * an ~8k-line landscape with 110 systems (78 of them services), 40 stores, 86
 * groups, 876 edges over 8 relationship kinds and 50 tags, 92 views; 78
 * extending models, most of them comment-only; 18 subsystems; a hand-written
 * file of 78 more views beside the two generated ones; and one active feature
 * touching 14 services with 125 requirements.
 *
 * Like `./fleet-fixture.ts` it imports nothing from vitest and nothing from
 * src/, so `scripts/bench-validate.ts` can load it under tsx. The generated
 * `architecture/subsystems.likec4` and `architecture/services.likec4` are NOT
 * written here: their bytes are whatever `loam subsystem sync` writes for this
 * map, so each consumer runs that command once over the written tree rather
 * than this module freezing a second copy of the renderer.
 */

export interface MapHeavyShape {
  /** Directories under `services/` that each hold several service directories. */
  subsystems: number;
  /** Services — each a bound map element with a directory and an extending model. */
  services: number;
  /** `#external` systems on the map, owned by nobody in the fleet. */
  externals: number;
  /** Stores, one inside each of the first `databases` services. */
  databases: number;
  /** Top-level groups; the rest of `groups` are areas nested in them. */
  domains: number;
  groups: number;
  edges: number;
  /** Declared relationship kinds, every edge drawn with one. */
  kinds: number;
  tags: number;
  /** Views on the map itself. */
  mapViews: number;
  /** Views in the hand-written `architecture/drilldown.likec4`, one per service at most. */
  drilldownViews: number;
  /** Models that carry an `extend` block; every other model is comment-only. */
  drawnModels: number;
  /** Operations each service's contract defines, and the op-linked edges draw on. */
  opsPerService: number;
  /** The one active feature: how many services it touches, and its requirement count over them. */
  featureServices: number;
  featureRequirements: number;
}

/** The pilot fleet's counts, as reported (see the banner). */
export const MAP_HEAVY_SHAPE: MapHeavyShape = {
  subsystems: 18,
  services: 78,
  externals: 32,
  databases: 40,
  domains: 6,
  groups: 86,
  edges: 876,
  kinds: 8,
  tags: 50,
  mapViews: 92,
  drilldownViews: 78,
  drawnModels: 18,
  opsPerService: 8,
  featureServices: 14,
  featureRequirements: 125,
};

/** The feature this fleet carries, for a consumer that validates it by id. */
export const MAP_HEAVY_FEATURE = "FEAT-1";

const svc = (i: number): string => `svc-${i}`;
const ident = (i: number): string => `svc${i}`;
const tag = (n: number, shape: MapHeavyShape): string => `t${String((n % shape.tags) + 1).padStart(2, "0")}`;
const kind = (n: number, shape: MapHeavyShape): string => `rk${(n % shape.kinds) + 1}`;
const op = (target: number, j: number): string => `op_${target}_${j}`;

/** Where each service sits: its area (and with it its domain), and its subsystem directory. */
interface Placement {
  areas: number;
  /** Area index (0-based) → its domain index (0-based). */
  domainOf: (area: number) => number;
  /** Service number (1-based) → its area index. */
  areaOf: (service: number) => number;
  /** Service number → `services/<sub>/<svc>`. */
  dir: (service: number) => string;
}

function placement(shape: MapHeavyShape): Placement {
  const areas = shape.groups - shape.domains;
  return {
    areas,
    domainOf: (area) => area % shape.domains,
    areaOf: (service) => (service - 1) % areas,
    dir: (service) => `services/sub-${((service - 1) % shape.subsystems) + 1}/${svc(service)}`,
  };
}

/** A service's fully qualified id on the map. */
function fqn(shape: MapHeavyShape, service: number): string {
  const place = placement(shape);
  const area = place.areaOf(service);
  return `d${place.domainOf(area) + 1}.a${area + 1}.${ident(service)}`;
}

/** A deterministic sequence, so every run writes the same fleet. */
function sequence(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state;
  };
}

function specification(shape: MapHeavyShape): string {
  const kinds = Array.from({ length: shape.kinds }, (_, k) => `  relationship rk${k + 1}`);
  const tags = Array.from({ length: shape.tags }, (_, t) => `  tag ${tag(t, shape)}`);
  return [
    "specification {",
    "  element group",
    "  element softwareSystem",
    "  element container",
    "  element database",
    ...kinds,
    "  tag external",
    ...tags,
    "}",
  ].join("\n");
}

/** A service, and its store BESIDE it: LikeC4 refuses an edge from an element to its own child. */
function serviceElement(shape: MapHeavyShape, i: number): string {
  const store =
    i <= shape.databases
      ? [`      ${ident(i)}Db = database '${svc(i)} store' {`, "        technology 'PostgreSQL'", "      }"]
      : [];
  return [
    `      ${ident(i)} = softwareSystem '${svc(i)}' {`,
    `        #${tag(i, shape)}`,
    `        description 'Synthetic service ${i}, one slice of the generated fleet'`,
    "        technology 'Kotlin'",
    "        metadata {",
    `          service '${svc(i)}'`,
    "        }",
    "      }",
    ...store,
  ].join("\n");
}

function groups(shape: MapHeavyShape): string {
  const place = placement(shape);
  const out: string[] = [];
  for (let d = 0; d < shape.domains; d += 1) {
    out.push(`  d${d + 1} = group 'Domain ${d + 1}' {`, `    description 'Generated domain ${d + 1}'`);
    for (let a = 0; a < place.areas; a += 1) {
      if (place.domainOf(a) !== d) continue;
      out.push(`    a${a + 1} = group 'Area ${a + 1}' {`, `      description 'Generated area ${a + 1}'`);
      for (let i = 1; i <= shape.services; i += 1) if (place.areaOf(i) === a) out.push(serviceElement(shape, i));
      out.push("    }");
    }
    out.push("  }");
  }
  for (let x = 1; x <= shape.externals; x += 1) {
    out.push(
      `  x${x} = softwareSystem 'External ${x}' {`,
      "    #external",
      `    description 'A generated system outside the fleet'`,
      "  }",
    );
  }
  return out.join("\n");
}

/** One edge, the multi-line body a hand-written map gives most of its calls. */
function edge(shape: MapHeavyShape, n: number, ends: { from: string; to: string; title: string; op?: string }): string {
  return [
    `  ${ends.from} -[${kind(n, shape)}]-> ${ends.to} '${ends.title}' {`,
    `    #${tag(n * 7, shape)}`,
    `    description 'Generated edge ${n}'`,
    "    technology 'HTTPS'",
    ...(ends.op === undefined ? [] : ["    metadata {", `      op '${ends.op}'`, "    }"]),
    "  }",
  ].join("\n");
}

/**
 * Every edge: each store from its owner, then service-to-service calls — each
 * naming one of the TARGET's operations, so the spine resolves — and the rest
 * to external systems. Pairs are drawn from a fixed sequence and never repeat
 * an (edge, operation), so no two edges are one edge drawn twice.
 */
function edges(shape: MapHeavyShape): string[] {
  const out: string[] = [];
  for (let i = 1; i <= shape.databases; i += 1) {
    out.push(edge(shape, out.length, { from: fqn(shape, i), to: `${fqn(shape, i)}Db`, title: "Reads and writes" }));
  }
  const external = Math.round((shape.edges - shape.databases) * 0.15);
  const calls = shape.edges - shape.databases - external;
  const next = sequence(42);
  const seen = new Set<string>();
  while (out.length < shape.databases + calls) {
    const from = (next() % shape.services) + 1;
    const to = (next() % shape.services) + 1;
    const j = (next() % shape.opsPerService) + 1;
    const key = `${from}>${to}#${j}`;
    if (from === to || seen.has(key)) continue;
    seen.add(key);
    out.push(edge(shape, out.length, { from: fqn(shape, from), to: fqn(shape, to), title: `Calls ${op(to, j)}`, op: op(to, j) }));
  }
  for (let e = 0; e < external; e += 1) {
    const from = (e % shape.services) + 1;
    const to = (e % shape.externals) + 1;
    out.push(edge(shape, out.length, { from: fqn(shape, from), to: `x${to}`, title: `Syncs batch ${e + 1}` }));
  }
  return out;
}

/** The map's own views: one per area, one per domain, and the fleet-wide rest. */
function mapViews(shape: MapHeavyShape): string {
  const place = placement(shape);
  const out: string[] = [];
  for (let a = 0; a < place.areas && out.length < shape.mapViews; a += 1) {
    out.push(`  view area_${a + 1} of d${place.domainOf(a) + 1}.a${a + 1} {\n    include *\n  }`);
  }
  for (let d = 0; d < shape.domains && out.length < shape.mapViews; d += 1) {
    out.push(`  view domain_${d + 1} of d${d + 1} {\n    include *\n  }`);
  }
  for (let n = 1; out.length < shape.mapViews; n += 1) {
    const d = (n % shape.domains) + 1;
    out.push(`  view fleet_${n} {\n    title 'Fleet slice ${n}'\n    include d${d}.*, x${n}\n  }`);
  }
  return out.join("\n");
}

function landscape(shape: MapHeavyShape): string {
  return [
    "// A generated fleet map: the shape of a real one, none of its names.",
    specification(shape),
    "",
    "model {",
    groups(shape),
    "",
    ...edges(shape),
    "}",
    "",
    "views {",
    mapViews(shape),
    "}",
    "",
  ].join("\n");
}

/** The hand-written view file beside the map: one drill-down per service. */
function drilldown(shape: MapHeavyShape): string {
  const views = Array.from({ length: Math.min(shape.drilldownViews, shape.services) }, (_, k) => {
    const id = fqn(shape, k + 1);
    return `  view drill_${ident(k + 1)} of ${id} {\n    title 'Drill-down ${svc(k + 1)}'\n    include *\n    include ${id} -> *\n  }`;
  });
  return ["// Hand-written drill-downs, one per service.", "views {", ...views, "}", ""].join("\n");
}

/** An extending model: the first `drawnModels` draw an interior, the rest are comment-only. */
function model(shape: MapHeavyShape, i: number): string {
  const header = `// ${svc(i)}: what is inside the service. It EXTENDS the fleet map, which binds it.\n`;
  if (i > shape.drawnModels) return `${header}// Interior not drawn yet.\n`;
  return (
    `${header}model {\n  extend ${fqn(shape, i)} {\n` +
    "    api = container 'api' {\n      technology 'Kotlin'\n    }\n" +
    "    worker = container 'worker'\n\n    api -> worker 'Enqueues the job'\n  }\n}\n"
  );
}

/** A service's living spec: every operation of its contract governed by one requirement. */
function spec(shape: MapHeavyShape, i: number): string {
  const ops = Array.from({ length: shape.opsPerService }, (_, j) => op(i, j + 1)).join(", ");
  return `---
service: ${svc(i)}
status: draft
owner: fleet-team
---

# ${svc(i)}

## Requirements

### Requirement: Serve the ${svc(i)} API
The service SHALL answer every operation of its contract exactly once per request.

Operations: ${ops}

#### Scenario: A request is answered
- **Given** a request to ${svc(i)}
- **When** it arrives
- **Then** it is answered exactly once
`;
}

/** One operation, with the minimal response schema `./fleet-fixture.ts` gives its contracts. */
function operation(id: string, path: string): string {
  return `  ${path}:
    post:
      operationId: ${id}
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

function openapi(shape: MapHeavyShape, i: number): string {
  const paths = Array.from({ length: shape.opsPerService }, (_, j) => operation(op(i, j + 1), `/${svc(i)}/op-${j + 1}`));
  return `openapi: 3.1.0\ninfo:\n  title: ${svc(i)}\n  version: "1.0"\npaths:\n${paths.join("")}`;
}

/**
 * The one feature: service `k` of the touched set starts calling a new
 * operation on service `k + featureServices`, and the requirements are spread
 * over the targets — the operation's own requirement first, plain ones after.
 * The delta re-declares the groups each end sits in, because an element's id
 * is its path through them and the merge matches on it.
 */
function feature(shape: MapHeavyShape): Record<string, string> {
  const dir = `features/${MAP_HEAVY_FEATURE}-map-heavy`;
  const pairs = Array.from({ length: shape.featureServices }, (_, k) => ({ from: k + 1, to: k + 1 + shape.featureServices }));
  const files: Record<string, string> = {
    [`${dir}/intent.md`]: `---
feature: ${MAP_HEAVY_FEATURE}
status: proposed
owner: fleet-team
---

# ${MAP_HEAVY_FEATURE}

Let ${shape.featureServices} services each call one new operation, so the generated fleet carries a feature as wide as the pilot's.
`,
    [`${dir}/delta.likec4`]: delta(shape, pairs),
  };
  const per = Math.floor(shape.featureRequirements / pairs.length);
  pairs.forEach(({ from, to }, k) => {
    const count = per + (k < shape.featureRequirements % pairs.length ? 1 : 0);
    const reqs = Array.from({ length: count }, (_, r) => requirement(k + 1, r, r === 0 ? `featOp_${k + 1}` : null));
    files[`${dir}/specs/${svc(to)}/spec.md`] = `# ${svc(to)} — delta for ${MAP_HEAVY_FEATURE}\n\n## ADDED Requirements\n\n${reqs.join("\n")}`;
    files[`${dir}/specs/${svc(to)}/openapi.yaml`] =
      `openapi: 3.1.0\ninfo:\n  title: ${svc(to)}\n  version: "1.0"\npaths:\n${operation(`featOp_${k + 1}`, `/${svc(to)}/feat-${k + 1}`)}`;
    files[`${dir}/specs/${svc(to)}/arch.spec.md`] = `# ${svc(to)} — architecture delta for ${MAP_HEAVY_FEATURE}

## ADDED Requirements

### Requirement: Feature call ${k + 1} survives retries
The service SHALL treat featOp_${k + 1} as idempotent under caller retries.

Covers: ${fqn(shape, from)} -> ${fqn(shape, to)}

#### Scenario: A retried call is a no-op
- **Given** a call already served
- **When** ${svc(from)} retries it
- **Then** ${svc(to)} returns the original result
`;
  });
  return files;
}

function requirement(pair: number, r: number, operationId: string | null): string {
  return `### Requirement: Feature step ${pair}.${r + 1} is honoured
The service SHALL honour feature step ${pair}.${r + 1} exactly once per request.
${operationId === null ? "" : `\nOperations: ${operationId}\n`}
#### Scenario: Step ${pair}.${r + 1} is honoured
- **Given** a request carrying step ${pair}.${r + 1}
- **When** it arrives
- **Then** the step is honoured exactly once
`;
}

function delta(shape: MapHeavyShape, pairs: readonly { from: number; to: number }[]): string {
  const place = placement(shape);
  const involved = [...new Set(pairs.flatMap(({ from, to }) => [from, to]))];
  const byArea = new Map<number, number[]>();
  for (const i of involved) byArea.set(place.areaOf(i), [...(byArea.get(place.areaOf(i)) ?? []), i]);
  const domains = new Map<number, number[]>();
  for (const area of byArea.keys()) domains.set(place.domainOf(area), [...(domains.get(place.domainOf(area)) ?? []), area]);
  const elements: string[] = [];
  for (const [d, areas] of [...domains].sort(([a], [b]) => a - b)) {
    elements.push(`  d${d + 1} = group 'Domain ${d + 1}' {`);
    for (const a of areas.sort((x, y) => x - y)) {
      elements.push(`    a${a + 1} = group 'Area ${a + 1}' {`);
      for (const i of byArea.get(a)!) {
        elements.push(`      ${ident(i)} = softwareSystem '${svc(i)}' {`, `        metadata {\n          service '${svc(i)}'\n        }`, "      }");
      }
      elements.push("    }");
    }
    elements.push("  }");
  }
  const added = pairs.map(
    ({ from, to }, k) =>
      `  ${fqn(shape, from)} -[rk1]-> ${fqn(shape, to)} 'Calls featOp_${k + 1}' {\n    #${MAP_HEAVY_FEATURE}\n    metadata {\n      op 'featOp_${k + 1}'\n    }\n  }`,
  );
  return [
    "specification {",
    "  element group",
    "  element softwareSystem",
    "  relationship rk1",
    `  tag ${MAP_HEAVY_FEATURE}`,
    "}",
    "",
    "model {",
    ...elements,
    "",
    ...added,
    "}",
    "",
  ].join("\n");
}

/** The whole fleet as relPath → content, minus the two documents `loam subsystem sync` writes. */
export function mapHeavyFiles(shape: MapHeavyShape): Record<string, string> {
  const place = placement(shape);
  const files: Record<string, string> = {
    "likec4.config.json": `${JSON.stringify({ name: "fleet", exclude: ["**/node_modules/**", "features/**"] }, null, 2)}\n`,
    "architecture/landscape.likec4": landscape(shape),
    "architecture/drilldown.likec4": drilldown(shape),
  };
  for (let s = 1; s <= shape.subsystems; s += 1) {
    files[`services/sub-${s}/subsystem.yaml`] = `title: Subsystem ${s}\ndescription: Generated subsystem ${s}\n`;
  }
  for (let i = 1; i <= shape.services; i += 1) {
    files[`${place.dir(i)}/model.likec4`] = model(shape, i);
    files[`${place.dir(i)}/spec.md`] = spec(shape, i);
    files[`${place.dir(i)}/openapi.yaml`] = openapi(shape, i);
  }
  return { ...files, ...feature(shape) };
}

/** A service's directory under the docs root, for a consumer that names one. */
export function mapHeavyServiceDir(shape: MapHeavyShape, service: number): string {
  return placement(shape).dir(service);
}
