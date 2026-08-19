/**
 * The event axis of the feature gate: do the C4 delta's tagged edges, the
 * requirement deltas' `Publishes:`/`Consumes:` lines, and the asyncapi
 * contracts agree about what each service puts on the wire?
 *
 * The package's orchestrator, called once from featureCoherence with the
 * delta facts it already holds (tagged relationships and the element
 * resolver): ./declared.ts walks the feature's own contracts and grades
 * what one service's pair of documents can settle; ./lookups.ts answers the
 * fleet questions lazily; this module joins the three axes — the exact
 * shape coherence.ts gives the operation join, on the message name.
 *
 * A package of its own rather than lines in coherence.ts because that file
 * ran at its 300-line limit before the event axis existed; the seam is
 * real, not cosmetic — everything here joins on a message name, nothing
 * there does.
 */
import { type Rel } from "../../c4/likec4.js";
import { type PathableService } from "../../kernel/ids/service.js";
import type { Issue } from "../../vocabulary/issue.js";
import { servicePaths } from "../../repo/paths.js";
import { enumeratedServiceIndex } from "../../repo/service-target.js";
import { readAsyncapi, type AsyncapiDoc } from "../../asyncapi/read.js";
import type { FleetContext } from "../../fleet-context.js";
import { declaredEvents, deltaEventLines, type EventDeltaScope } from "./declared.js";
import { eventLookups } from "./lookups.js";

/** What featureCoherence hands the event axis — the delta facts it already computed. */
export interface EventCoherenceRequest {
  scope: EventDeltaScope;
  /** The services this feature's specs/ touch — the walk's subjects. */
  svcNames: PathableService[];
  /** The delta's tagged relationships — the edges the landscape merge would splice. */
  taggedRels: Rel[];
  /** The element→service resolver over the delta's elements plus the enumerated fleet. */
  svcOf: (id: string) => string;
  context?: FleetContext;
}

export async function eventCoherence(request: EventCoherenceRequest): Promise<Issue[]> {
  const { scope, svcNames, taggedRels, svcOf, context } = request;
  const issues: Issue[] = [];
  const declared = await declaredEvents(scope, svcNames, issues, context);
  const lookups = eventLookups({ docsDir: scope.docsDir, featureId: scope.featureId }, context);

  // Retiring a message the fleet still consumes — openapi.remove-op-consumed's
  // twin, and like it a question neither exactness nor justification asks:
  // the merge deletes the declaration while the consumes edge and the other
  // repo's requirement stay, so the next `validate --all` breaks on a
  // repository whose author was never in this feature.
  for (const [svc, net] of declared.netRemoved) {
    for (const message of net) {
      const consumers = await lookups.messageConsumers(svc, message);
      if (consumers.length === 0) continue;
      issues.push({
        severity: "error",
        code: "asyncapi.remove-message-consumed",
        subject: svc,
        message: `${svc}: this feature retires message '${message}', but the living fleet still consumes it — ${consumers.join("; ")}. Retire the consumer in the same feature (drop the consumes edge from architecture/landscape.likec4, or the requirement that names it), or archive with --approve to break it deliberately.`,
      });
    }
  }

  // Two features declaring one (service, message): both deltas apply
  // cleanly, so whichever archives second replaces the other's declaration
  // wholesale — delta.added-conflict's shape on the message join.
  for (const [svc, doc] of declared.featureDocs) {
    for (const m of doc.messages) {
      if (m.remove === true) continue;
      const other = await lookups.messageDefinedElsewhere(svc, m.name);
      if (other === undefined) continue;
      issues.push({
        severity: "warn",
        code: "asyncapi.message-conflict",
        subject: svc,
        message: `${svc}: this feature declares message '${m.name}', which in-flight ${other} also adds or edits — whichever archives second replaces the other's declaration wholesale; coordinate before either ships`,
      });
    }
  }

  // The bound service's contract as the feature would leave it: feature ∪
  // living send/receive sets, living read lazily per service — an edge may
  // bind a service the feature carries no specs/ directory for.
  const livingDocs = new Map<PathableService, AsyncapiDoc>();
  const livingOf = async (svc: PathableService): Promise<AsyncapiDoc> => {
    let doc = livingDocs.get(svc);
    if (doc === undefined) {
      doc = await readAsyncapi(servicePaths(scope.docsDir, svc).asyncapi, context);
      livingDocs.set(svc, doc);
    }
    return doc;
  };
  // undefined = no verdict: an unreadable LIVING contract proves nothing
  // about the message (validate's asyncapi.invalid owns that file), and
  // grading against its empty parse would blame every edge for one broken
  // document.
  const declares = async (
    svc: PathableService,
    direction: "publishes" | "consumes",
    message: string,
  ): Promise<boolean | undefined> => {
    const living = await livingOf(svc);
    if (living.unreadable) return undefined;
    const feat = declared.featureDocs.get(svc);
    return direction === "publishes"
      ? living.sent.includes(message) || (feat?.sent.includes(message) ?? false)
      : living.received.includes(message) || (feat?.received.includes(message) ?? false);
  };
  const action = (direction: "publishes" | "consumes"): string => (direction === "publishes" ? "send" : "receive");

  // The declared→enumerated bridge coherence.ts uses for op edges, for the
  // same reason: every lookup below joins into services/<id>/ or the
  // feature's own specs/. A bound element NEITHER knows is skipped rather
  // than graded — an #external producer is the documented shape for a
  // message produced outside the fleet (spine.message-external), so grading
  // its edge against an absent service directory would turn the worked
  // example red.
  const enumeratedTarget = enumeratedServiceIndex(scope.docsDir, svcNames, context);

  // Tagged edges: `publishes` binds the edge's SOURCE, `consumes` its
  // TARGET — the same reading validate's event spine takes of the living
  // landscape, applied to the delta.
  for (const r of taggedRels) {
    const bound: { direction: "publishes" | "consumes"; message: string; name: string; edge: string }[] = [];
    const edge = `${svcOf(r.source)} → ${svcOf(r.target)}`;
    if (r.publishes !== undefined) bound.push({ direction: "publishes", message: r.publishes, name: svcOf(r.source), edge });
    if (r.consumes !== undefined) bound.push({ direction: "consumes", message: r.consumes, name: svcOf(r.target), edge });
    for (const b of bound) {
      const pathable = await enumeratedTarget(b.name);
      if (pathable === undefined) continue;
      // asyncapi.invalid already gates; one breach, one finding.
      if (declared.unreadable.has(pathable)) continue;
      const ok = await declares(pathable, b.direction, b.message);
      if (ok !== false) continue;
      const other = await lookups.messageDefinedElsewhere(pathable, b.message);
      if (other !== undefined) {
        issues.push({
          severity: "warn",
          code: "c4-event.message-pending",
          message: `edge ${b.edge} ${b.direction} '${b.message}', defined by in-flight ${other} — archive it first`,
        });
      } else {
        issues.push({
          severity: "error",
          code: "c4-event.message-undefined",
          message: `edge ${b.edge} ${b.direction} '${b.message}', but ${b.name}'s asyncapi contract (feature and living alike) declares no operation with action: ${action(b.direction)} for it`,
        });
      }
    }
  }

  // The requirement deltas' own lines, graded the same way — the same
  // sentence validate gives the living-side breach, under the same code, so
  // one breach keeps one name across scopes.
  for (const svc of svcNames) {
    if (declared.unreadable.has(svc)) continue;
    const { links } = await deltaEventLines(scope, svc, context);
    for (const link of links) {
      const ok = await declares(svc, link.direction, link.message);
      if (ok !== false) continue;
      const other = await lookups.messageDefinedElsewhere(svc, link.message);
      if (other !== undefined) {
        issues.push({
          severity: "warn",
          code: "spec-event.message-pending",
          subject: svc,
          message: `${svc}: requirement '${link.requirement}' ${link.direction} '${link.message}', defined by in-flight ${other} — archive it first`,
        });
      } else {
        issues.push({
          severity: "error",
          code: "spec-event.message-undefined",
          subject: svc,
          message: `${svc}: requirement '${link.requirement}' ${link.direction} '${link.message}', but ${svc}'s asyncapi.yaml declares no operation with action: ${action(link.direction)} for it`,
        });
      }
    }
  }

  return issues;
}
