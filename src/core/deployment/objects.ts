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
import { elementService } from "../c4/resolve/service.js";

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
  prefix: string,
): TaggedDeployment[] {
  const owner = instanceOwners(deployment, elements);
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

/**
 * instance id → the service its logical element belongs to.
 *
 * Through `elementService`, which is the same binding-then-title join every
 * other check uses to decide which `services/<id>/` owns an element. An
 * instance of an element the landscape does not declare resolves to nothing and
 * is left unowned rather than filed under a fabricated name — LikeC4 refuses an
 * unresolved `instanceOf` outright, so that state is reachable only when the
 * caller hands in elements from a narrower document than the one the topology
 * was parsed with.
 */
function instanceOwners(deployment: DeploymentModel, elements: readonly Elem[]): Map<string, string> {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const out = new Map<string, string>();
  for (const instance of deployment.instances) {
    const element = byId.get(instance.element);
    if (element !== undefined) out.set(instance.id, elementService(element));
  }
  return out;
}
