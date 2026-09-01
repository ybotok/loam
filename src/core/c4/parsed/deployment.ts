/**
 * The DEPLOYMENT model a document declares — which physical nodes exist, which
 * containers are instanced where, and what talks to what across them.
 *
 * A `deployment { }` block has been legal in a docs repo since LikeC4 could
 * parse one, and until this reader existed loam saw none of it. The parser
 * resolved every `instanceOf` — so a container renamed out from under a
 * deployment node already failed the gate — and after that no requirement could
 * name a node, no `#obl-` tag on a datacenter was graded, and the context pack
 * an agent implements from did not mention topology at all. Integrity held at
 * the level of syntax and was absent at the level of requirements. ROADMAP's
 * deployment axis and `meta/docs/features/FEAT-1-the-deployment-axis/` are the
 * item and the specification; this module is its first half.
 *
 * ## Why this is a `parsed/` reader and not a package of its own
 *
 * It is the same job the three modules beside it do: take one corner of
 * LikeC4's parse output and hand back a loam-neutral record, defensively, with
 * its shape assumptions owned outright. `readSpecification`, `readDynamicViews`
 * and `readViewIds` are all called on the line above `flattenModel(model)` in
 * each of loam's three loaders, and so is this. FEAT-1's delta said
 * `src/core/c4/deploy/`; a package holding this alone would be a directory
 * pretending to be a subject (docs/DESIGN.md), and the delta was corrected
 * rather than the code bent to it — which is what an unarchived feature is for.
 *
 * **`parsed/` is now AT its five-file limit.** The next reader here needs a
 * split first, and the seam to split on is the one this file does not share:
 * `dynamic-views.ts` and `view-ids.ts` read `$data`, this one and
 * `specification.ts` read the model surface.
 *
 * ## What is read, and what is deliberately left
 *
 * Nodes, instances and relationships, with the ids, titles and tags each
 * carries. MEASURED at the 1.59.2 pin, and every line of it needed measuring
 * rather than assuming:
 *
 *  - `nodes()` returns deployment NODES only — an `instanceOf` is not among
 *    them, which is why instances are a second list rather than a filter.
 *  - an instance carries the LOGICAL element it deploys as `element.id`, and
 *    that is the whole join back to the C4 model: `eu.a.dbA -> orders.db`.
 *  - both nodes and instances carry `tags`, so `#obl-geo` on a datacenter is
 *    readable — the fail-open case that made this an item.
 *  - a relationship carries `tags` and `metadata` DIRECTLY (`r.metadata`, no
 *    `$relationship` indirection), and both model stages return byte-identical
 *    results, which is what lets `test/likec4-model-parity.test.ts` cover this
 *    read with the substitution it already pins.
 *  - a document with NO `deployment { }` block still returns a deployment
 *    object whose three iterators are empty. Absent and empty are therefore the
 *    same answer here, deliberately: no reader may distinguish "declares none"
 *    from "could not be read", because the second is what the defensive returns
 *    below produce and a fleet that draws no topology owes loam nothing.
 *
 * `metadata` is NOT carried on the records below, and neither is an instance's
 * `kind`. Both are readable; no check reads them yet, and a field carried
 * before a caller needs it is a field nobody notices going wrong. Add one with
 * the check that consumes it.
 */

/** One deployment node — a region, a datacenter, a cluster; the kinds are the fleet's own. */
export interface DeployNode {
  /** The dotted path LikeC4 gives it: `eu.dcA.k8sA`. */
  id: string;
  /** The `deploymentNode` kind the specification declares. */
  kind: string;
  title: string;
  tags: string[];
}

/** One deployed instance of a logical element. */
export interface DeployInstance {
  id: string;
  /**
   * The id of the C4 element this instance deploys — the join back to the
   * logical model, and the only reason an instance is worth reading at all.
   */
  element: string;
  title: string;
  tags: string[];
}

/** One edge between deployment objects — replication, failover, a network hop. */
export interface DeployRel {
  source: string;
  target: string;
  title?: string;
  tags: string[];
}

/** A document's whole deployment model, flattened. */
export interface DeploymentModel {
  nodes: DeployNode[];
  instances: DeployInstance[];
  relationships: DeployRel[];
}

/** No topology — what an absent block and an unreadable one both come back as. */
export const NO_DEPLOYMENT: DeploymentModel = { nodes: [], instances: [], relationships: [] };

/** Is there anything here? The opt-in every deployment check is gated on. */
export function hasDeployment(d: DeploymentModel): boolean {
  return d.nodes.length > 0 || d.instances.length > 0 || d.relationships.length > 0;
}

/** A record, or nothing — the parse surface hands back `unknown`. */
function record(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

/** An iterable produced by `name()`, or an empty one when the surface is not what we measured. */
function iterate(source: Record<string, unknown>, name: string): unknown[] {
  const fn = source[name];
  if (typeof fn !== "function") return [];
  try {
    const out: unknown = (fn as () => unknown).call(source);
    // A generator satisfies this; so does an array. Anything else is a shape
    // change upstream, and the honest answer to one is "no topology read".
    return out !== null && typeof out === "object" && Symbol.iterator in (out as object)
      ? [...(out as Iterable<unknown>)]
      : [];
  } catch {
    return [];
  }
}

/** A string field, or the empty string — never `undefined` leaking into a record. */
function str(o: Record<string, unknown>, key: string): string {
  const v = o[key];
  return typeof v === "string" ? v : "";
}

/** Tags as loam models them: a plain array of strings, always present. */
function tags(o: Record<string, unknown>): string[] {
  const v = o["tags"];
  return Array.isArray(v) ? v.filter((t): t is string => typeof t === "string") : [];
}

/**
 * Read the deployment model off an awaited `parsedModel()`.
 *
 * Defensive throughout, in the shape `readViewIds` established: an entry
 * missing the one field that identifies it is DROPPED rather than reported with
 * a hole, and a surface that is not what was measured yields an empty model
 * instead of throwing. A check that cannot see the topology must say
 * could-not-look through its own silence, never fail the fleet's parse.
 */
export function readDeployment(model: unknown): DeploymentModel {
  const root = record(model);
  if (root === undefined) return NO_DEPLOYMENT;
  const deployment = record(root["deployment"]);
  if (deployment === undefined) return NO_DEPLOYMENT;

  const nodes: DeployNode[] = [];
  for (const raw of iterate(deployment, "nodes")) {
    const n = record(raw);
    if (n === undefined) continue;
    const id = str(n, "id");
    if (id === "") continue;
    nodes.push({ id, kind: str(n, "kind"), title: str(n, "title"), tags: tags(n) });
  }

  const instances: DeployInstance[] = [];
  for (const raw of iterate(deployment, "instances")) {
    const i = record(raw);
    if (i === undefined) continue;
    const id = str(i, "id");
    // The logical element is the whole point of the record. An instance whose
    // element cannot be read joins to nothing, so reporting it would put a
    // deployed thing on the map that no requirement could ever cover.
    const element = record(i["element"]);
    if (id === "" || element === undefined) continue;
    const elementId = str(element, "id");
    if (elementId === "") continue;
    instances.push({ id, element: elementId, title: str(i, "title"), tags: tags(i) });
  }

  const relationships: DeployRel[] = [];
  for (const raw of iterate(deployment, "relationships")) {
    const r = record(raw);
    if (r === undefined) continue;
    const source = record(r["source"]);
    const target = record(r["target"]);
    if (source === undefined || target === undefined) continue;
    const from = str(source, "id");
    const to = str(target, "id");
    if (from === "" || to === "") continue;
    // LikeC4 reports an untitled edge as `title: null` — normalized to the
    // declared optional exactly as `flattenModel` does for the logical model.
    const title = typeof r["title"] === "string" ? r["title"] : undefined;
    relationships.push({ source: from, target: to, ...(title === undefined ? {} : { title }), tags: tags(r) });
  }

  return { nodes, instances, relationships };
}
