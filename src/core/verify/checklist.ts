/**
 * The questions: what a feature's own artifacts promised, derived mechanically.
 *
 * The original plan was to extract C4 from the built code and diff it against
 * the delta. There is no such extractor and there will not be one — nothing
 * deterministic reads a service and says what its architecture MEANS, and two
 * generated models of the same code disagree in wording every run, so the diff
 * would flap and be switched off inside a week.
 *
 * What survives of the idea is the part that was always deterministic, and it
 * is this module: a feature says this service will exist, it will expose this
 * operation, that service will call it, this scenario will have a test. The
 * list comes from the same files `validate` already reads.
 *
 * The claim ids are a function of the claim and of nothing else — so two runs
 * are diffable, reordering the delta renames nothing, and rewording a scenario
 * DOES rename its claim, because an answer about text nobody wrote must not
 * carry over.
 *
 * `scenarioBodyHash` lives in `core/gherkin/digest.ts` — one recipe shared
 * with `core/gherkin/stamp.ts`, which stamps the same digest as a tag on every
 * generated scenario so `--results` can match a cucumber report back to a
 * claim. A second spelling of the hash would silently stop every scenario
 * claim from being answerable by a run.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { readAsyncapi } from "../asyncapi/read.js";
import { type Elem } from "../c4/likec4.js";
import { elementService, serviceResolver } from "../c4/resolve/service.js";
import { ACTOR_KINDS } from "../vocabulary/maturity.js";
import { operationIds, operations } from "../openapi/doc.js";
import { featurePaths, featureSpecPaths } from "../repo/paths.js";
import { locateServicePaths } from "../repo/service-target.js";
import { featureSpecServices } from "../repo/repo.js";
import { enumeratedServiceIds } from "../repo/service-target.js";
import { FleetContext } from "../fleet-context.js";
import { parseRequirements } from "../document/parse.js";
import { scenarioBodyHash } from "../gherkin/digest.js";
import type { DocsDir, FeatureDir } from "../kernel/ids/dirs.js";
// The kind vocabulary and both hash recipes live in ./claims/identity.ts —
// one module for everything that decides whether two runs ask the same
// question, and this one for how the questions are derived.
import {
  checklistDigest,
  claimId,
  DIGEST_LENGTH,
  ID_LENGTH,
  type ClaimKind,
} from "./claims/identity.js";

export interface Claim {
  /** `<kind>-<8 hex>` — stable for the life of the claim. See `claimId`. */
  id: string;
  kind: ClaimKind;
  /** The service whose code answers this. A caller's claim is filed under the caller. */
  subject: string;
  /** The claim in one line, answerable without reading the feature's files. */
  claim: string;
  /**
   * `scenario.tested` only: the first {@link DIGEST_LENGTH} hex of the
   * scenario's body hash — the exact digest `loam gherkin` stamps as
   * `@loam-digest-…`, which is what a cucumber report scenario carries and
   * what `--results` matches on. Absent on every other kind.
   */
  digest?: string;
  /**
   * `api.exposes` only: the operationId the claim asserts, structurally — the
   * join key `--contract-results` matches a contract report's entries on,
   * exactly as `digest` is `--results`'s. Never parsed back out of the claim
   * text, which is prose and may be reworded. Absent on every other kind.
   */
  operation?: string;
  /**
   * The literal string the claim asserts of the cited artifact — the
   * operationId for `api.exposes`, the message name for `event.declares`, the
   * edge's op for `c4.calls` — carried structurally so evidence pins
   * (`./pins/pin.ts`) can stamp it at record time and the read side never
   * parses it back out of claim prose. A separate field from `operation` on
   * purpose: `contestedOperations` filters on `operation !== undefined` and
   * must not start seeing `c4.calls` claims. Absent where a claim asserts no
   * literal (`service.exists`, `scenario.tested`).
   */
  token?: string;
}

export interface Checklist {
  feature: string;
  claims: Claim[];
  /** A digest of the claim id SET — what says a record still answers this feature. */
  digest: string;
}

/**
 * Derive the checklist from a feature's own artifacts. No code is read here and
 * none should be: the whole design rests on the questions being computed from
 * documents that do not change between runs.
 */
export async function featureChecklist(
  docsDir: DocsDir,
  featureDir: FeatureDir,
  featureId: string,
  fleet?: FleetContext,
): Promise<Checklist> {
  // The per-service loop below resolves living contracts through the
  // enumeration twice per service; without a shared context each of those is
  // a full fleet walk, so deriving one checklist cost O(services²) reads. A
  // caller-supplied context is used when given; otherwise one is created for
  // this derivation alone — the loop still pays a single walk either way.
  const ctx = fleet ?? new FleetContext();
  const seen = new Map<string, number>();
  const claim = (kind: ClaimKind, subject: string, parts: string[], text: string): Claim => ({
    id: claimId(featureId, kind, parts, seen),
    kind,
    subject,
    claim: text,
  });

  const exists: Claim[] = [];
  const exposes: Claim[] = [];
  const declares: Claim[] = [];
  const calls: Claim[] = [];
  const scenarios: Claim[] = [];

  const specServices = await featureSpecServices(featureDir, ctx);

  // Architecture — what the delta promised the fleet would look like. Loaded
  // through the context rather than a bare parse, so a caller that derives
  // several checklists in one invocation (`loam gate`'s verification check,
  // the fleet forms) shares one parse per delta — and a batch prefetch
  // (`FleetContext.prefetchLikeC4`) genuinely seeds this load.
  const deltaPath = featurePaths(featureDir).delta;
  if (existsSync(deltaPath)) {
    const res = await ctx.loadLikeC4(deltaPath);
    // A delta nobody can parse promises nothing checkable. `validate` already
    // reports it; inventing claims out of a broken document would only add noise.
    if (res.errors.length === 0) {
      const elements: Elem[] = res.elements;
      for (const e of elements) {
        if (!e.tags.includes(featureId)) continue;
        // A dotted id is a container INSIDE a service, and an actor is nobody's
        // repository. Neither is a service that has to exist.
        if (e.id.includes(".") || ACTOR_KINDS.has(e.kind.toLowerCase())) continue;
        const svc = elementService(e);
        exists.push(claim("service.exists", svc, [svc], `service '${svc}' exists`));
      }
      // The enumerated fleet — `services/` plus this feature's own `specs/`
      // directories, the only place a service the feature INTRODUCES has a
      // directory at all — rides into the resolver so a claim about an edge
      // drawn into a modelled container names the service that owns it. A
      // claim against a service called "api" that has never existed is one no
      // evidence in any repository could ever answer, and the fleet half alone
      // still derived exactly that claim for an introduced service's own
      // container. Unenumerable services/ degrades to the feature's names.
      const svcOf = serviceResolver(
        elements,
        new Set<string>([...(await enumeratedServiceIds(docsDir, ctx)), ...specServices]),
      );
      for (const r of res.relationships) {
        // Untagged edges are context for the diagram; an edge with no operation
        // names nothing specific enough to look for in the code.
        if (!r.tags.includes(featureId) || r.op === undefined) continue;
        const from = svcOf(r.source);
        const to = svcOf(r.target);
        calls.push({
          ...claim("c4.calls", from, [from, to, r.op], `${from} calls '${r.op}' on ${to}`),
          // The same string as the provider's api.exposes token, scanned in the
          // CALLER's cited file — a call site plausibly spells the operationId.
          token: r.op,
        });
      }
    }
  }

  for (const svc of specServices) {
    const paths = featureSpecPaths(featureDir, svc);

    // Contract — only what is NEW. A delta's openapi.yaml is a whole document,
    // not a patch, so authors restate the living API inside it; asking whether a
    // service still exposes what it already exposed is noise.
    const featOps = (await operations(paths.openapi))
      .filter((operation) => !operation.remove)
      .map((operation) => operation.id);
    if (featOps.length > 0) {
      const living = new Set(await operationIds((await locateServicePaths(docsDir, svc, ctx)).openapi));
      for (const op of featOps) {
        if (living.has(op)) continue;
        exposes.push({
          ...claim("api.exposes", svc, [svc, op], `${svc} exposes operationId '${op}'`),
          operation: op,
          token: op,
        });
      }
    }

    // Events — the same NEW-only discipline on the async axis: a delta's
    // asyncapi.yaml is a complete document too, so what the living contract
    // already sends or receives is restatement, not a promise. Removals are
    // not questions either — the reader already keeps marked declarations out
    // of the sent/received sets — and an unreadable delta promises nothing
    // checkable, exactly like the broken C4 delta above.
    const events = await readAsyncapi(paths.asyncapi);
    if (events.sent.length > 0 || events.received.length > 0) {
      const living = await readAsyncapi((await locateServicePaths(docsDir, svc, ctx)).asyncapi);
      const directions = [
        { direction: "sends", feat: events.sent, known: new Set(living.sent) },
        { direction: "receives", feat: events.received, known: new Set(living.received) },
      ] as const;
      for (const d of directions) {
        for (const name of d.feat) {
          if (d.known.has(name)) continue;
          declares.push({
            ...claim(
              "event.declares",
              svc,
              [svc, d.direction, name],
              `${svc} declares it ${d.direction} message '${name}'`,
            ),
            token: name,
          });
        }
      }
    }

    // Behaviour — the scenarios of the requirements this feature CHANGES. A BASE
    // requirement is the living state quoted inside the delta, and a REMOVED one
    // is being retired: neither is work anybody has to have done.
    if (existsSync(paths.spec)) {
      for (const r of parseRequirements(await readFile(paths.spec, "utf8"))) {
        if (r.kind === "BASE" || r.kind === "REMOVED") continue;
        for (const s of r.scenarios) {
          const body = scenarioBodyHash(svc, s.lines);
          scenarios.push({
            ...claim(
              "scenario.tested",
              svc,
              [svc, r.id ?? r.name, s.name, body.slice(0, ID_LENGTH)],
              `scenario '${s.name}' of requirement '${r.name}' (${svc}) is covered by a test`,
            ),
            digest: body.slice(0, DIGEST_LENGTH),
          });
        }
      }
    }

    // The architecture spec axis, same walk: an arch scenario is a promise like
    // any other — the outbox test nobody was going to write IS the point of the
    // axis. The source file rides in the id tuple AND in the body hash itself
    // (two axes are two namespaces: identically-worded scenarios must stay two
    // questions, and the axis-salted digest is what keeps a business-only test
    // run from answering the arch claim) and in the claim text, so the
    // answering agent knows it is being asked for an integration/ops test, not
    // an acceptance test.
    if (existsSync(paths.archSpec)) {
      for (const r of parseRequirements(await readFile(paths.archSpec, "utf8"))) {
        if (r.kind === "BASE" || r.kind === "REMOVED") continue;
        for (const s of r.scenarios) {
          const body = scenarioBodyHash(svc, s.lines, "arch");
          scenarios.push({
            ...claim(
              "scenario.tested",
              svc,
              [svc, "arch.spec.md", r.id ?? r.name, s.name, body.slice(0, ID_LENGTH)],
              `scenario '${s.name}' of arch requirement '${r.name}' (${svc}, arch.spec.md) is covered by a test`,
            ),
            digest: body.slice(0, DIGEST_LENGTH),
          });
        }
      }
    }
  }

  const claims = [...exists, ...exposes, ...declares, ...calls, ...scenarios];
  return { feature: featureId, claims, digest: checklistDigest(claims.map((c) => c.id)) };
}
