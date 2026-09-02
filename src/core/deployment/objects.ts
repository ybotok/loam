/**
 * The deployment axis: which objects on the fleet's TOPOLOGY carry a rule, and
 * who owns each of them.
 *
 * A `#obl-` tag is a claim about the object it sits on, and the object's model
 * is not a property any reader can see. Before this module the same undeclared
 * tag was `obligation.unknown` on a container and SILENCE on a datacenter,
 * because `validate/fleet/obligations.ts` walked the logical model only — the
 * fail-open case where a rule an architect placed does not exist for any check,
 * and a reviewer has no way to tell that from a rule that passed. This is the
 * derivation that closes it (FEAT-1's ARCH-LOAM-DEPLOY-TAGGED).
 *
 * ## The `where` string is the `Covers:` line
 *
 * Every finding about a tagged object tells its reader to write
 * `Covers: <where>`, so `where` is spelled as the grammar reads it —
 * `node:eu.dcA`, `node:a.db -> node:b.db` — and never as a bare id. A message
 * that names an object one way and asks for a line spelled another way sends
 * the reader round the loop twice.
 *
 * ## Who owns a datacenter
 *
 * Nobody, and the answer is `undefined` rather than a guess. An INSTANCE is
 * owned by the service its logical element belongs to, which is a real join
 * through the landscape's own binding; an edge between two instances of one
 * service is owned by that service; a region, a datacenter or a cluster is
 * owned by whoever runs the platform, and loam has no such concept. The finding
 * changes its sentence rather than naming a service that did not ask for the
 * work — "write it in payment-service's arch.spec.md" is actionable, and
 * "write it in <the wrong team>'s" is worse than no attribution at all.
 *
 * This package is one module today and gains its second with the feature-local
 * `features/<FEAT>/deployment/` slot, which is the step of the axis that needs
 * `repo` and `kernel`. Nothing here reads a path.
 */
import { type Elem } from "../c4/likec4.js";
import { type DeploymentModel, type DeployRel } from "../c4/parsed/deployment.js";
import { serviceResolver } from "../c4/resolve/service.js";

/** One deployment object carrying one obligation tag. */
export interface TaggedDeployment {
  /** The obligation id — the tag suffix, exactly as the logical walk reads it. */
  obligation: string;
  /**
   * How a `Covers:` line names this object, and how every message spells it:
   * `node:<id>` for a node or an instance, `node:<a> -> node:<b>` for an edge.
   */
  where: string;
  /** The service that owns it, where the topology says. Absent for a node nobody's service runs. */
  service?: string;
  /** The edge, when this object is one — the caller matches `Covers:` against it. */
  edge?: DeployRel;
  /** The node or instance id, when this object is one. */
  id?: string;
}

/**
 * Every `#obl-` tag on the deployment model, one entry per (obligation, object)
 * pair — the same shape, and the same bare-prefix tolerance, the logical walk
 * has: a bare `#obl-` slugs to the empty string and is KEPT, because the prefix
 * is the author's opt-in however little follows it, and dropping it would leave
 * an object that asked to be graded silently ungraded.
 */
export function taggedDeployment(
  deployment: DeploymentModel,
  elements: readonly Elem[],
  known: ReadonlySet<string>,
  prefix: string,
): TaggedDeployment[] {
  const owner = instanceOwners(deployment, elements, known);
  const out: TaggedDeployment[] = [];
  const push = (tags: readonly string[], rest: Omit<TaggedDeployment, "obligation">): void => {
    for (const tag of tags.filter((t) => t.startsWith(prefix))) {
      out.push({ obligation: tag.slice(prefix.length), ...rest });
    }
  };

  // Nodes first, then instances, then edges — the order the model declares them
  // in, so a fleet report reads top-down the way the document does.
  for (const node of deployment.nodes) push(node.tags, { where: `node:${node.id}`, id: node.id });
  for (const instance of deployment.instances) {
    const service = owner.get(instance.id);
    push(instance.tags, {
      where: `node:${instance.id}`,
      id: instance.id,
      ...(service === undefined ? {} : { service }),
    });
  }
  for (const edge of deployment.relationships) {
    // An edge is owned only when BOTH ends agree. A replication edge between
    // two instances of one service belongs to that service; one crossing
    // services belongs to neither, and picking the target — the rule the
    // logical walk uses, where the arrow means "calls" — says nothing here,
    // because a deployment edge is as often symmetric as directed.
    const from = owner.get(edge.source);
    const to = owner.get(edge.target);
    const service = from !== undefined && from === to ? from : undefined;
    push(edge.tags, {
      where: `node:${edge.source} -> node:${edge.target}`,
      edge,
      ...(service === undefined ? {} : { service }),
    });
  }
  return out;
}

/** Where one service runs, and what its instances talk to across the topology. */
export interface ServiceTopology {
  /** This service's instances: the deployment id, and the element each one deploys. */
  instances: Array<{ id: string; element: string }>;
  /** Deployment edges with at least one end among them — replication, failover, a network hop. */
  edges: Array<{ source: string; target: string; title?: string }>;
}

/**
 * The topology one service is part of.
 *
 * Built for the CONTEXT PACK, which is the surface whose reader is an agent
 * about to write the implementation. Before this, that pack described a
 * service's calls and contracts and said nothing whatever about where it runs —
 * so a failover was implemented against a map nobody had read, which is the
 * gap FEAT-1's ARCH-LOAM-DEPLOY-UNCHECKED names alongside the sentence about
 * what a green axis does not mean.
 *
 * BOTH ENDS, not only the outbound one. A replication edge is as often read
 * from the standby's side as from the primary's, and a pack that showed only
 * what this service points at would hide the stream it receives.
 */
export function serviceTopology(
  deployment: DeploymentModel,
  elements: readonly Elem[],
  known: ReadonlySet<string>,
  service: string,
): ServiceTopology {
  const owner = instanceOwners(deployment, elements, known);
  const mine = deployment.instances.filter((i) => owner.get(i.id) === service);
  const ids = new Set(mine.map((i) => i.id));
  return {
    instances: mine.map((i) => ({ id: i.id, element: i.element })),
    edges: deployment.relationships
      .filter((r) => ids.has(r.source) || ids.has(r.target))
      .map((r) => ({ source: r.source, target: r.target, ...(r.title === undefined ? {} : { title: r.title }) })),
  };
}

/**
 * instance id → the service its logical element belongs to.
 *
 * Through `serviceResolver` and NOT `elementService`, and the difference is a
 * defect this axis shipped once. A deployment instances a CONTAINER far more
 * often than a whole system — `instanceOf orders.cache` is the ordinary way to
 * say where the Redis a service owns actually runs — and `elementService` reads
 * the binding or the TITLE of the element handed to it. A nested container
 * carries no `metadata { service }` of its own, so that read answered "order
 * cache", and `obligation.uncovered` told an author to write the requirement in
 * "order cache's arch.spec.md" — a service that has never existed. The
 * resolver's whole job is the ancestor walk that finds the bound system above
 * it, which is the same join every other check makes about a container.
 *
 * `known` rides in for the reason `coversEdge` takes it: without the enumerated
 * fleet the resolver's second tier — the nearest ancestor whose title names a
 * real `services/<id>/` — cannot run, and a fleet that binds by title rather
 * than by `metadata { service }` resolves to the title alone. It must be the
 * SAME set the caller's own findings resolve with, or the message names one
 * service and the check counts another.
 *
 * An instance of an element the landscape does not declare is left UNOWNED
 * rather than filed under a fabricated name. LikeC4 refuses an unresolved
 * `instanceOf` outright, so that state is reachable only when the caller hands
 * in elements from a narrower document than the one the topology was parsed
 * with.
 */
function instanceOwners(
  deployment: DeploymentModel,
  elements: readonly Elem[],
  known: ReadonlySet<string>,
): Map<string, string> {
  const ids = new Set(elements.map((e) => e.id));
  const resolve = serviceResolver([...elements], known);
  const out = new Map<string, string>();
  for (const instance of deployment.instances) {
    if (ids.has(instance.element)) out.set(instance.id, resolve(instance.element));
  }
  return out;
}
