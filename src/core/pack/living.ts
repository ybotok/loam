/**
 * The living slice of one service's context pack: its requirements verbatim,
 * its two contracts, its provenance, its maturity, and the fleet edges around
 * it — everything the docs repo says about the service TODAY, before any
 * feature in flight is consulted.
 *
 * Split from `./pack.ts` because it answers about the LIVING documents while
 * `./features.ts` answers about the deltas over them — two phases of one
 * briefing, and the line limit is what asked the question.
 */
import { existsSync } from "node:fs";
import { FleetContext } from "../fleet-context.js";
import { serviceResolver } from "../c4/resolve/service.js";
import { repoPath } from "../envelope/json.js";
import { listField, parseFrontmatter, stringField, type Frontmatter } from "../document/frontmatter.js";
import { scopeText } from "../provenance/sample/scope.js";
import { type Requirement } from "../document/spec.js";
import {
  landscapeEvidence,
  maturityGaps,
  serviceMaturity,
  type LandscapeEdge,
  type Maturity,
} from "../vocabulary/maturity.js";
import { type ServiceEntry } from "../repo/entries.js";
import { landscapePath, servicePathsAt } from "../repo/paths.js";
import type { DocsDir } from "../kernel/ids/dirs.js";
import { hasDeployment, NO_DEPLOYMENT } from "../c4/parsed/deployment.js";
import { loadArchitecture } from "../c4/project/architecture.js";
import { serviceTopology, type ServiceTopology } from "../deployment/objects.js";

/**
 * A requirement as the pack carries it: the delta brief's `reqJson` shape plus
 * the four join lines (`Requires:`, `Capability:`, `Publishes:`, `Consumes:`)
 * the brief never needed. Verbatim on purpose — the pack is the briefing, and
 * a heading without its body is a table of contents for a file the reader then
 * has to open.
 */
export interface PackRequirement {
  kind: Requirement["kind"];
  id?: string;
  name: string;
  text: string;
  operations: string[];
  covers: string[];
  requires: string[];
  capabilities: string[];
  publishes: string[];
  consumes: string[];
  /** Verbatim: the acceptance criteria, and the source for the tests whoever picks this up writes. */
  scenarios: Array<{ name: string; lines: string[] }>;
}

export function packRequirement(r: Requirement): PackRequirement {
  return {
    kind: r.kind,
    ...(r.id === undefined ? {} : { id: r.id }),
    name: r.name,
    text: r.text.join("\n").trim(),
    operations: r.operations,
    covers: r.covers,
    requires: r.requires,
    capabilities: r.capabilities,
    publishes: r.publishes,
    consumes: r.consumes,
    scenarios: r.scenarios.map((s) => ({ name: s.name, lines: s.lines })),
  };
}

export interface LivingSlice {
  maturity: Maturity;
  /** What stands between the service and `vouched` — `maturityGaps`, so it matches `list --needs-work`. */
  missing: string[];
  /**
   * `vouch_scope` rides beside `status` because this pack is read by an agent
   * about to work on the service, and a bare `status: verified` over a vouch
   * that read a recorded sample of the document would be read as the whole of
   * it having been checked. Verbatim, null when there is none.
   *
   * spec.md's header ALONE — arch.spec.md carries its own, below.
   */
  frontmatter: {
    status: string | null;
    owner: string | null;
    last_verified: string | null;
    vouch_scope: string | null;
    sources: string[];
  };
  /**
   * arch.spec.md's own `vouch_scope`, under `show --json`'s spelling
   * (`archSpec.vouch_scope`) so the two surfaces name one fact one way.
   *
   * The sample is per FILE: one `loam vouch --sample` run reads a short
   * spec.md in full and stamps a long arch.spec.md sampled, and the pack read
   * only the first header. Every other trust surface — list, show,
   * `vouch --pack`, `validate --all`, status — reported that service as
   * sampled; context printed `verified`, `vouch_scope: null`, and then all of
   * arch.spec.md's requirements verbatim, of which nobody had read half. It is
   * the one surface whose reader is an agent that will act on the licence, and
   * `loam_context` exposes it as an MCP tool besides.
   */
  archSpec: { vouch_scope: string | null };
  /**
   * `present`/`parses` ride beside the edges (explore's shape) so silence is
   * evidence, not absence: an empty edge list under `parses: false` says
   * "nobody could look", not "nobody calls this".
   */
  landscape: {
    present: boolean;
    parses: boolean;
    modelled: boolean;
    inbound: LandscapeEdge[];
    outbound: LandscapeEdge[];
  };
  /**
   * Where this service runs, off the landscape's `deployment { }` model, and
   * the deployment edges touching it — replication, failover, a network hop.
   *
   * Both ends, not only the outbound one: a replication edge is as often read
   * from the standby's side as from the primary's. Empty for a fleet that draws
   * no topology, and empty is not a finding here any more than it is anywhere
   * else on this axis.
   *
   * WHAT IT IS NOT. A green deployment axis means the documents agree with each
   * other — never that the second cluster exists, is reachable, or holds the
   * data a requirement claims. `core/brief/unchecked.ts` says so beside the
   * sixteen statements that say the same about the rest of the map, and an
   * agent reading this slice is exactly the reader that sentence is for.
   */
  deployment: ServiceTopology;
  requirements: PackRequirement[];
  archRequirements: PackRequirement[];
  /** Whether the living contract could be read at all — the vacuously-green guard every sibling carries. */
  openapi: { unreadable: boolean; error?: string };
  operations: Array<{ id: string; method: string; path: string; governedBy: string[] }>;
  asyncapi: { unreadable: boolean; error?: string };
  messages: Array<{ name: string; slot: string; direction: "send" | "receive" | null }>;
  /** Free-form prose stays a pointer: unbounded documents do not belong in a bounded pack. */
  pointers: {
    runbook: { present: boolean; path: string };
    health: { present: boolean; path: string };
    adrs: { count: number; path: string };
  };
}

export interface LivingRequest {
  docsDir: DocsDir;
  entry: ServiceEntry;
  context: FleetContext;
}

export async function buildLiving(req: LivingRequest): Promise<LivingSlice> {
  const { docsDir, entry, context } = req;
  const paths = servicePathsAt(entry.dir);

  // Independent reads, fanned out together; each is memoized on the shared
  // context, so anything `./joins.ts` or `./features.ts` re-asks is free.
  const [reqs, archReqs, api, events, specText, archText, land] = await Promise.all([
    entry.has.spec ? context.readRequirements(paths.spec) : [],
    existsSync(paths.archSpec) ? context.readRequirements(paths.archSpec) : [],
    context.readOpenapi(paths.openapi),
    context.readAsyncapi(paths.asyncapi),
    entry.has.spec ? context.readText(paths.spec) : null,
    // Both headers, exactly as `show` reads both (commands/show/service.ts):
    // a memo hit on the same read the requirements above already paid for.
    existsSync(paths.archSpec) ? context.readText(paths.archSpec) : null,
    existsSync(landscapePath(docsDir)) ? context.loadLikeC4(landscapePath(docsDir)) : null,
  ]);

  const present = land !== null;
  const parses = land !== null && land.errors.length === 0;
  const elements = parses ? land.elements : [];
  // Edges are filed under the service an element is BOUND to, with the
  // enumerated fleet riding in — the same resolution `show`, `explore` and
  // `validate` use, so no two commands can disagree about who calls whom.
  const known = new Set((await context.listServices(docsDir)).map((s) => s.id));
  const svcOf = serviceResolver(elements, known);
  // The partition, the modelled probe and the apiExpected rule are ONE shared
  // derivation (core/vocabulary/maturity.ts `landscapeEvidence`) — the same
  // one explore's describe uses, so the pack and explore cannot grade the
  // same service differently.
  const { inbound, outbound, modelled, apiExpected } = landscapeEvidence({
    id: entry.id,
    parses,
    relationships: parses ? land.relationships : [],
    elementIds: elements.map((e) => e.id),
    svcOf,
  });
  // Where this service RUNS, from the landscape's own deployment model. The
  // pack's reader is an agent about to write the implementation, and until this
  // slice existed it described a service's calls and contracts while saying
  // nothing whatever about its topology — so a failover got written against a
  // map nobody had read. Empty for every fleet that draws none, which is the
  // axis's opt-in and not a finding.
  //
  // Read through the PROJECT when the landscape file itself declares none, for
  // the reason `validate/service/specs.ts` pays the same load: `architecture/`
  // is one LikeC4 project and a fleet's `deployment { }` block is ordinarily a
  // file beside the landscape, not inside it. A single-file read would report
  // "this service runs nowhere" over a repo that draws it, which is the one
  // answer a briefing must never give.
  const topology = parses ? (land.deployment ?? NO_DEPLOYMENT) : NO_DEPLOYMENT;
  const deployment = serviceTopology(
    hasDeployment(topology) || !parses ? topology : ((await loadArchitecture(docsDir)).deployment ?? NO_DEPLOYMENT),
    elements,
    entry.id,
  );

  const input = { entry, archSpec: existsSync(paths.archSpec), apiExpected };

  const header = (text: string | null): Frontmatter =>
    text === null ? { present: false, malformed: false, data: {}, body: "" } : parseFrontmatter(text);
  const fm: Frontmatter = header(specText);

  const governs = (op: string): string[] =>
    reqs.filter((r) => r.operations.includes(op)).map((r) => r.name);
  const sent = new Set(events.sent);
  const received = new Set(events.received);

  return {
    maturity: serviceMaturity(input),
    missing: maturityGaps(input),
    frontmatter: {
      status: stringField(fm, "status") ?? null,
      owner: stringField(fm, "owner") ?? null,
      last_verified: stringField(fm, "last_verified") ?? null,
      // Through `scopeText`, not `stringField`: a scope whose value is not
      // text is still a stamped partial read, and this pack is read by an
      // agent that will otherwise take `status: verified` at face value.
      vouch_scope: scopeText(fm),
      sources: listField(fm, "sources"),
    },
    archSpec: { vouch_scope: scopeText(header(archText)) },
    landscape: { present, parses, modelled, inbound, outbound },
    deployment,
    requirements: reqs.map(packRequirement),
    archRequirements: archReqs.map(packRequirement),
    openapi: { unreadable: api.unreadable, ...(api.error === undefined ? {} : { error: api.error }) },
    // Document order — a fact of the file, hence of the state. `x-loam-remove`
    // markers are filtered exactly as `show` filters them: they are deletion
    // markers from a delta, not operations anybody can call.
    operations: api.ops
      .filter((o) => !o.remove)
      .map((o) => ({ id: o.id, method: o.method.toUpperCase(), path: o.path, governedBy: governs(o.id) })),
    asyncapi: { unreadable: events.unreadable, ...(events.error === undefined ? {} : { error: events.error }) },
    messages: events.messages
      .filter((m) => m.remove !== true)
      .map((m) => ({
        name: m.name,
        slot: m.slot,
        direction: sent.has(m.name) ? "send" : received.has(m.name) ? "receive" : null,
      })),
    pointers: {
      runbook: { present: entry.has.runbook, path: repoPath(docsDir, paths.runbook) },
      health: { present: entry.has.health, path: repoPath(docsDir, paths.health) },
      // The enumeration already counted the ADRs; a second readdir here could
      // only disagree with it.
      adrs: { count: entry.adrs, path: repoPath(docsDir, paths.adrsDir) },
    },
  };
}
