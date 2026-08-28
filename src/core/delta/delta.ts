/**
 * Does the diff apply to the thing it claims to change?
 *
 * A requirement delta is a diff against a living spec, and nothing used to check
 * that it lands. Every failure mode here is silent today: MODIFIED of a
 * requirement that does not exist is merged as a creation, ADDED of one that
 * does exist REPLACES it (scenarios and all) while the author believes they are
 * adding, and a heading that nearly matches the delta grammar parses as plain
 * prose so archive merges nothing at all and says nothing about it.
 *
 * The last of those has a legal-looking cousin: a requirement under an ordinary
 * prose heading (`## Behavior`, `## Error Handling`) is BASE too, and BASE never
 * merges. Upstream OpenSpec deltas are written that way, so the answer is to name
 * what will be lost rather than to start merging prose sections.
 *
 * These run inside the archive gate, because the merge is where the damage lands.
 *
 * TWO CORPORA, ONE ALGEBRA. A feature's delta documents live in two places —
 * `specs/<svc>/{spec,arch.spec}.md` against the service tree, and
 * `capabilities/<id>/spec.md` against the authored business tree — and every
 * grade about a DOCUMENT and its living counterpart applies to both verbatim,
 * with the capability id in `subject` where a service id would be. That is not
 * a coincidence to exploit but the reason the business corpus was given deltas
 * at all: a capability document is a requirements document, so the diff that
 * changes one has exactly the same ways of not landing. A second implementation
 * would be a second set of answers to `delta.added-duplicate`.
 *
 * The exception is the four CROSS-FEATURE warnings — `delta.added-conflict`,
 * `delta.modified-conflict`, `delta.modified-pending`, `delta.removed-pending`
 * — which ask what OTHER features in flight claim. `./claims.ts` indexes the
 * service corpus only and states why; on the business axis those four are
 * silent, which is a missing warning and never a wrong answer.
 *
 * This module is only the walk: which documents get read, in what order, and how
 * each is handed a `DeltaScope`. The checks themselves are in `./document.ts`
 * (a document against itself) and `./select.ts` (the delta against the living
 * text). Their order is load-bearing and stays here, where it can be read in one
 * screen.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import { type FleetContext } from "../fleet-context.js";
import { parseRequirements } from "../document/parse.js";
import { type Requirement } from "../document/spec.js";
import { featureSpecPaths, SPEC_AXES } from "../repo/paths.js";
import { livingCapabilityPaths } from "../repo/authored/paths.js";
import { enumeratedServiceIds, locateServicePaths } from "../repo/service-target.js";
import { featureSpecServices } from "../repo/repo.js";
import { capabilityDocIssues } from "../capabilities/delta/doc.js";
import { featureCapabilityDeltas } from "../capabilities/delta/tree.js";
import {
  removedRealizedIssues,
  uncoveredIssues,
  type CapabilityDeltaDoc,
  type RealizingDoc,
} from "../capabilities/delta/uncovered.js";
import { type Issue } from "../vocabulary/issue.js";
import { claimLookup, type ClaimLookup } from "./claims.js";
import { deltaDocumentIssues, livingDocumentIssues } from "./document.js";
import { indexLiving, type DeltaScope, type LivingIndex } from "./scope.js";
import { selectionIssues } from "./select.js";
import type { DocsDir, FeatureDir } from "../kernel/ids/dirs.js";

/**
 * The business corpus's ONE axis. A capability document carries the promise and
 * nothing else — there is no `arch.spec.md` beside it, because "how it is
 * built" is precisely the altitude a capability requirement may not describe
 * (`capability.requirement-service-scoped` is that rule). It has no `key`
 * because it indexes no `ServicePaths`, which is why `DeltaScope.axis` is the
 * narrower `DeltaAxis` and not `SpecAxis`.
 */
const CAPABILITY_AXIS = { file: "spec.md" };

/**
 * What every document in one feature's walk shares.
 *
 * A record rather than two more parameters because both values are about the
 * WALK and not about the document being graded — `gradeDelta` would otherwise
 * read as a four-argument function whose last two arguments never vary within
 * a run, which is how the next value gets added as a fifth.
 */
interface DeltaReads {
  /** What OTHER features in flight claim — lazy, so the common case never scans. */
  claims: ClaimLookup;
  /** The invocation's read index, when the caller threaded one. */
  context?: FleetContext;
}

export async function deltaShapeIssues(
  docsDir: DocsDir,
  featureDir: FeatureDir,
  featureId: string,
  context?: FleetContext,
): Promise<Issue[]> {
  const issues: Issue[] = [];
  const services = await featureSpecServices(featureDir, context);
  // One `existsSync` for a feature that carries no capability delta, which is
  // every feature in a fleet that has not adopted the business axis.
  const capabilities =
    context === undefined ? await featureCapabilityDeltas(featureDir) : await context.featureCapabilityDeltas(featureDir);
  // The early return must ask about BOTH corpora. Asking only about services
  // meant a capability-only feature — a business change with no service touched
  // yet, which is exactly what an analyst writes first — was graded by nothing
  // and archived whatever its delta said.
  if (services.length === 0 && capabilities.docs.length === 0) return issues;

  // What OTHER features in flight claim. Only built when a claim has to be
  // checked — the common case never pays for the scan.
  const reads: DeltaReads = {
    claims: claimLookup(docsDir, featureId, context),
    ...(context === undefined ? {} : { context }),
  };

  // The two corpora's parsed requirements, kept as the walk produces them so
  // the `Realizes:` join below can be taken without re-reading a byte. That
  // join is the one question neither corpus can answer alone — which service
  // requirement keeps which business promise — and this is the only place in
  // loam where both sides are already open (`capabilities/delta/uncovered.ts`
  // holds the rules; nothing here decides anything).
  const serviceDeltas: RealizingDoc[] = [];
  const capabilityDeltas: CapabilityDeltaDoc[] = [];

  // Both requirement-carrying files per service run the same checks — one code
  // path parameterized by filename, the merge's own factoring. `where` names
  // the arch file in messages so a finding cannot be chased into the wrong
  // document; spec.md keeps its historical spelling.
  for (const service of services) {
    for (const axis of SPEC_AXES) {
      const specPath = featureSpecPaths(featureDir, service)[axis.key];
      if (!existsSync(specPath)) continue;
      const scope: DeltaScope = {
        kind: "service",
        subject: service,
        axis,
        featureId,
        docsDir,
        specPath,
        where: axis.key === "spec" ? service : `${service} (arch.spec.md)`,
        // How the axis's living document is named in messages — spec.md keeps
        // the historical "living spec", the arch axis says which file it means.
        livingDoc: axis.key === "spec" ? "living spec" : "living arch.spec.md",
      };
      const graded = await gradeDelta(scope, (await locateServicePaths(docsDir, service, context))[axis.key], reads);
      issues.push(...graded.issues);
      serviceDeltas.push({ service, file: axis.file, reqs: graded.reqs });
    }
  }

  for (const doc of capabilities.docs) {
    const scope: DeltaScope = {
      kind: "capability",
      subject: doc.id,
      axis: CAPABILITY_AXIS,
      featureId,
      docsDir,
      specPath: doc.spec,
      // `capability <id>`, not `capabilities/<id>` — the second reads as the
      // LIVING directory, and every message this labels is about the FEATURE's
      // delta of it. Sending an author to edit the wrong one of two files with
      // the same name is the whole reason `where` and `livingDoc` are separate.
      where: `capability ${doc.id}`,
      livingDoc: `living capabilities/${doc.id}/spec.md`,
    };
    // Absent is a real and ordinary answer on this axis: the first feature to
    // mention a capability is what creates its living document, so the whole
    // delta grades against `[]` and every requirement in it is legitimately an
    // addition.
    const graded = await gradeDelta(scope, livingCapabilityPaths(docsDir, doc.id).spec, reads);
    issues.push(...graded.issues);
    // The document's own three rules, on the requirements this delta would
    // MERGE — before the merge, where the author can still fix them. See
    // `capabilities/delta/doc.ts` for why grading only the living copy leaves a
    // hole straight through the altitude rule.
    issues.push(
      ...capabilityDocIssues(graded.reqs, {
        where: relative(docsDir, doc.spec).split(/[\\/]/).join("/"),
        subject: doc.id,
      }),
    );
    capabilityDeltas.push({ id: doc.id, reqs: graded.reqs, living: graded.living.all });
  }

  // The `Realizes:` join, both directions, over documents this walk has already
  // parsed. Skipped entirely when the feature carries no capability delta,
  // which is every feature in a fleet that has not adopted the business axis —
  // and the removal half asks for the living corpus only when something is
  // actually retired, so even an adopting fleet pays the fleet-wide read on the
  // features that earn it.
  if (capabilityDeltas.length > 0) {
    issues.push(...uncoveredIssues(capabilityDeltas, serviceDeltas));
    issues.push(
      ...(await removedRealizedIssues({
        capabilities: capabilityDeltas,
        deltas: serviceDeltas,
        living: () => livingRealizers(docsDir, context),
      })),
    );
  }

  return issues;
}

/**
 * Every LIVING service requirements document in the fleet, for the one question
 * that has to ask about services this feature never mentions: does anything out
 * there still realize a capability requirement this feature retires?
 *
 * The same shape and the same cost `openapi.remove-op-consumed` pays through
 * `coherence/lookups.ts` one axis over, and for the same reason — the merge
 * deletes the promise while the `Realizes:` line stays, so the very next
 * `validate --all` reports a breach on a repository whose author was never in
 * this feature. Called behind a thunk (`removedRealizedIssues` invokes it only
 * when something is retired), so a feature that removes nothing never runs it.
 */
async function livingRealizers(docsDir: DocsDir, context?: FleetContext): Promise<RealizingDoc[]> {
  const out: RealizingDoc[] = [];
  for (const service of await enumeratedServiceIds(docsDir, context)) {
    const paths = await locateServicePaths(docsDir, service, context);
    for (const axis of SPEC_AXES) {
      const path = paths[axis.key];
      if (!existsSync(path)) continue;
      const reqs =
        context === undefined ? parseRequirements(await readFile(path, "utf8")) : await context.readRequirements(path);
      out.push({ service, file: axis.file, reqs });
    }
  }
  return out;
}

/**
 * One delta document against one living document: the three passes, in the
 * order that makes their messages readable.
 *
 * The order is load-bearing. `deltaDocumentIssues` settles what the delta says
 * about itself, `livingDocumentIssues` settles whether the living text can be
 * selected in at all, and only then does `selectionIssues` compare them — a pin
 * the document pass already refused must not also be reported stale, which
 * would send its author to `loam rebase` for a problem rebase does not fix.
 *
 * The parsed delta requirements come back with the issues because the capability
 * corpus grades them a second way (`capabilityDocIssues`) and re-reading the
 * file to do it would be a second parse of bytes already in hand — and, without
 * a context, a second chance for the two passes to disagree about the document.
 * The LIVING index rides back for the same reason once more: the removal
 * direction of the `Realizes:` join has to resolve a REMOVED spelled by heading
 * into the id it retires, and that id is a fact about the living document.
 */
async function gradeDelta(
  scope: DeltaScope,
  livingPath: string,
  reads: DeltaReads,
): Promise<{ issues: Issue[]; reqs: Requirement[]; living: LivingIndex }> {
  const { claims, context } = reads;
  const raw = context === undefined ? await readFile(scope.specPath, "utf8") : await context.readText(scope.specPath);
  const reqs = context === undefined ? parseRequirements(raw) : await context.readRequirements(scope.specPath);
  const living = indexLiving(
    !existsSync(livingPath)
      ? []
      : context === undefined
        ? parseRequirements(await readFile(livingPath, "utf8"))
        : await context.readRequirements(livingPath),
  );
  return {
    reqs,
    living,
    issues: [
      ...deltaDocumentIssues(scope, raw, reqs),
      ...livingDocumentIssues(scope, living),
      ...(await selectionIssues(scope, reqs, living, claims)),
    ],
  };
}
