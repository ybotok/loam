/**
 * The work packet: one feature's unit-of-work list, derived and never stored.
 *
 * It is a READ. Nothing here writes, nothing caches, and there is no state
 * anywhere that says a unit is finished — done is "the unit no longer appears",
 * which is what makes the list impossible to falsify by editing a checkbox. The
 * inputs are the same documents `loam verify` derives its questions from
 * (`core/verify/checklist.ts`), the same delta scans `loam status` reads, the
 * record beside the feature, and — only when standing in the bound service repo
 * — the stamps in the generated suite.
 *
 * Everything the packet reports is therefore re-derivable from the tree by
 * anybody holding it, which is the property an agent orchestrating other agents
 * actually needs: it can ask again and compare, rather than trusting a report.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { stripFrontmatter } from "../document/frontmatter.js";
import { intentReference, withIntentRef, type IntentRef } from "../document/intent/reference.js";
import { repoPath } from "../envelope/json.js";
import { FleetContext } from "../fleet-context.js";
import type { DocsDir } from "../kernel/ids/dirs.js";
import { compareIds, type FeatureEntry } from "../repo/entries.js";
import { featurePaths } from "../repo/paths.js";
import { featureChecklist, type Claim } from "../verify/checklist.js";
import { readRecordView, settledClaims, type RecordState } from "./record.js";
import { readStamps, type GherkinBinding, type StampReading } from "./stamps.js";
import {
  axisSize,
  describeUnits,
  readContracts,
  readDeltaAxes,
  scenarioSources,
  type DeltaSize,
  type MintedSource,
  type Unreadable,
} from "./sources.js";
import { doneCheck, FRONTIER_LIMIT, isOpen, linkDependencies, sortUnits, type TaskStep, type TaskUnit } from "./unit.js";

export interface PacketRequest {
  docsDir: DocsDir;
  /** Active only — an archived feature is refused by the caller, and why is stated there. */
  feature: FeatureEntry;
  /**
   * The `--service` lens, or null when none was asked for. A lens, never a
   * binding check. Null is not always the whole feature: `lensOf` falls back to
   * the bound service, and the packet's `service` says which lens was applied.
   */
  lens: string | null;
  binding: GherkinBinding;
}

/** An open unit in another service that one of this lens's units is waiting on. */
export interface WaitingOn {
  id: string;
  subject: string;
  kind: string;
  claim: string;
}

export interface WorkPacket {
  feature: string;
  /** The lens applied — the flag's, else the bound service's (`lensOf`) — or null for the whole feature. */
  service: string | null;
  services: string[];
  path: string;
  /** The checklist digest — how a consumer detects that the question set itself moved. */
  checklist: string;
  record: RecordState;
  stamps: "read" | "unknown";
  intent: string | null;
  /**
   * The size of the DELTA, not of the open work: how much this feature says,
   * whatever has been answered. A packet that shrank as work closed would make
   * "this feature is small" and "this feature is nearly done" the same sentence.
   */
  size: DeltaSize;
  units: TaskUnit[];
  counts: { open: number; done: number; attested: number };
  frontier: string[];
  frontierElided: number;
  waitingOn?: WaitingOn[];
  contracts: { expose: string[]; call: string[] };
  review: string[];
  unreadable: Unreadable;
}

/** The step a claim-backed unit is waiting at. */
function stepFor(claim: Claim, stamps: StampReading): TaskStep {
  if (claim.kind !== "scenario.tested") return "implement";
  // Only this repository's suite may be graded. Another service's tests live in
  // another repository, and reporting `generate` for them would be a claim about
  // a directory this run has never seen.
  if (stamps.state !== "read" || stamps.service !== claim.subject) return "implement";
  return claim.digest !== undefined && stamps.digests.has(claim.digest) ? "implement" : "generate";
}

/**
 * The claim-backed units: every claim the record has not closed.
 *
 * The claim's own fields ride through verbatim — the task id IS the claim id,
 * so a unit can be handed straight back to `loam verify` and two runs of
 * `loam tasks` are diffable exactly as two checklists are.
 */
function claimUnits(
  claims: readonly Claim[],
  settled: { done: Set<string>; attested: Set<string> },
  stamps: StampReading,
  sources: ReadonlyMap<string, MintedSource>,
): TaskUnit[] {
  const out: TaskUnit[] = [];
  for (const claim of claims) {
    if (settled.done.has(claim.id)) continue;
    const source = sources.get(claim.id);
    out.push({
      id: claim.id,
      kind: claim.kind,
      subject: claim.subject,
      at: settled.attested.has(claim.id) ? "attested" : stepFor(claim, stamps),
      claim: claim.claim,
      ...(claim.digest === undefined ? {} : { digest: claim.digest }),
      ...(claim.operation === undefined ? {} : { operation: claim.operation }),
      ...(claim.token === undefined ? {} : { token: claim.token }),
      dependsOn: [],
      // The digest cross-check is the belt on the id join (`./sources.ts`): a
      // source whose words hash to something else is somebody ELSE's
      // Given/When/Then, and no source at all is the honest answer.
      ...(source !== undefined && source.digest === claim.digest ? { source: source.source } : {}),
      done: { check: doneCheck(claim) },
    });
  }
  return out;
}

/**
 * The four standing review instructions, computed with this feature's own ids.
 *
 * They are on the payload rather than in the docs because the reviewer of a
 * packet is usually another agent, and an agent that has to go fetch a protocol
 * to learn how to check the work is an agent that will not. Each one names a
 * failure that has actually happened: trusting a checkmark instead of
 * re-deriving, taking one answer set on faith, hand-editing a generated suite
 * (whose digests are what `--results` matches on), and implementing one half of
 * a contract.
 */
function reviewNotes(feature: string, gherkinDir: string): string[] {
  return [
    `re-derive, do not trust checkmarks: loam tasks ${feature} --json and compare open units against the implementer's claim`,
    `cross-examine recorded answers: loam verify ${feature} --diff-answers <a.json> <b.json>`,
    `generated suite is read-only: no edits under ${gherkinDir}/loam/, and step definitions must not paraphrase scenarios`,
    "honour the contract in both directions: every expose[] operationId exists under exactly that id; every call[] op is actually called",
  ];
}

/** The operations this lens promises to expose, and the ones it promises to call. */
function contractTokens(claims: readonly Claim[], lens: string | null): { expose: string[]; call: string[] } {
  const scoped = claims.filter((claim) => lens === null || claim.subject === lens);
  const pick = (kind: string, field: "operation" | "token"): string[] =>
    [...new Set(scoped.filter((c) => c.kind === kind).map((c) => c[field]).filter((v): v is string => v !== undefined))].sort(
      compareIds,
    );
  return { expose: pick("api.exposes", "operation"), call: pick("c4.calls", "token") };
}

/**
 * The lens the packet is actually cut to.
 *
 * An explicit lens wins. Without one, a run from a service repository is about
 * THAT service whenever the feature touches it, because the stamps that tell
 * `generate` from `implement` are read from this repository's suite alone
 * (`./stamps.ts`): in a whole-feature view from here, every other service's
 * scenario reads `implement` whatever its own suite holds — a verdict about a
 * directory this run has never seen, printed beside one about a directory it
 * has, in the same words. A feature that does not touch the bound service keeps
 * the whole view, because narrowing to a service with nothing in it prints an
 * empty packet, and an agent reads an empty packet as "nothing to do".
 *
 * Decided here rather than by the caller because "touches" is the packet's own
 * service list, which includes a service only the C4 delta names — learning it
 * first would cost the caller a second checklist derivation of the same delta.
 */
function lensOf(request: PacketRequest, services: readonly string[]): string | null {
  if (request.lens !== null) return request.lens;
  const bound = request.binding.service;
  return bound !== undefined && services.includes(bound) ? bound : null;
}

export async function workPacket(request: PacketRequest): Promise<WorkPacket> {
  const { docsDir, feature, binding } = request;
  // One read index for the whole derivation: the checklist, the delta axes and
  // the architecture parse all reach the same documents, and without a shared
  // context each would be its own fleet walk.
  const context = new FleetContext();
  const checklist = await featureChecklist(docsDir, feature.dir, feature.id, context);
  const view = await readRecordView(feature.dir, checklist);
  const settled = settledClaims(view);
  const axes = await readDeltaAxes(docsDir, feature.dir, feature.services, context);
  const stamps = await readStamps(binding);
  const contracts = await readContracts(docsDir, feature.dir, feature.services, context);

  const all = sortUnits(withDependencies([
    ...describeUnits(feature.id, axes),
    ...claimUnits(checklist.claims, settled, stamps, scenarioSources(feature.id, axes)),
  ]));
  const services = [...new Set([...feature.services, ...checklist.claims.map((c) => c.subject)])].sort(compareIds);
  const lens = lensOf(request, services);
  const units = lens === null ? all : all.filter((unit) => unit.subject === lens);
  const open = units.filter(isOpen);

  const paths = featurePaths(feature.dir);
  const intent = existsSync(paths.intent)
    ? stripFrontmatter(await readFile(paths.intent, "utf8")).trim()
    : null;

  return {
    feature: feature.id,
    service: lens,
    services,
    path: repoPath(docsDir, feature.dir),
    checklist: checklist.digest,
    record: view.state,
    stamps: stamps.state,
    intent,
    size: { ...axisSize(axes), operations: contracts.operations, messages: contracts.messages, calls: countCalls(checklist.claims, lens) },
    units,
    counts: {
      open: open.length,
      done: checklist.claims.filter((c) => settled.done.has(c.id) && (lens === null || c.subject === lens)).length,
      attested: units.filter((unit) => unit.at === "attested").length,
    },
    frontier: open.slice(0, FRONTIER_LIMIT).map((unit) => unit.id),
    frontierElided: Math.max(0, open.length - FRONTIER_LIMIT),
    ...(lens === null ? {} : { waitingOn: waitingOn(units, all, lens) }),
    contracts: contractTokens(checklist.claims, lens),
    review: reviewNotes(feature.id, binding.gherkinDir ?? "features"),
    unreadable: contracts.unreadable,
  };
}

/** A packet whose intent rides by reference — what `--intent-ref` emits. */
export type ReferencedPacket = Omit<WorkPacket, "intent"> & { intentRef: IntentRef | null };

/**
 * The packet with its verbatim `intent` swapped for a reference to the file
 * (`core/document/intent/reference.ts` says what one holds, and why the leaf a
 * worker is handed must not be the size of the intent).
 *
 * The questions kept are the ones naming the services the packet is ABOUT: the
 * lens when there is one, else the subjects of the units it shows — so a leaf
 * keeps its own unit's questions, and a whole-feature packet every unit's.
 * Taken from the packet as shown rather than as derived, because `--next` cuts
 * the units after the derivation and the reference must follow the cut.
 */
export async function packetByReference(packet: WorkPacket, docsDir: DocsDir, feature: FeatureEntry): Promise<ReferencedPacket> {
  const services = packet.service !== null ? [packet.service] : [...new Set(packet.units.map((unit) => unit.subject))];
  const path = featurePaths(feature.dir).intent;
  // The BYTES, so the digest is the file's — and a file that is not UTF-8 throws
  // `NotUtf8DocumentError` out of here for the command to refuse on.
  const ref = existsSync(path) ? intentReference(await readFile(path), repoPath(docsDir, path), services) : null;
  return withIntentRef(packet, ref);
}

/** `linkDependencies` mutates in place; this is the expression form the assembly above reads in. */
function withDependencies(units: TaskUnit[]): TaskUnit[] {
  linkDependencies(units);
  return units;
}

/** How many call edges this lens carries — the c4.calls claims, answered or not. */
function countCalls(claims: readonly Claim[], lens: string | null): number {
  return claims.filter((claim) => claim.kind === "c4.calls" && (lens === null || claim.subject === lens)).length;
}

/**
 * What this service is waiting on somebody else for.
 *
 * Under a lens the dependency edges point out of the view, and a consumer that
 * could not see where would read `dependsOn` as a dangling id. These are the
 * units on the other end: OPEN, in another service, and named with enough text
 * that the reader knows which repository to go ask. Attested units are left out
 * — they are complete work, and nobody is blocked on somebody else's
 * outstanding cucumber run.
 */
function waitingOn(units: readonly TaskUnit[], all: readonly TaskUnit[], lens: string): WaitingOn[] {
  const byId = new Map(all.map((unit) => [unit.id, unit]));
  const out = new Map<string, WaitingOn>();
  for (const unit of units) {
    for (const id of unit.dependsOn) {
      const provider = byId.get(id);
      if (provider === undefined || provider.subject === lens || !isOpen(provider)) continue;
      out.set(id, { id, subject: provider.subject, kind: provider.kind, claim: provider.claim });
    }
  }
  return [...out.values()].sort((a, b) => compareIds(a.id, b.id));
}
