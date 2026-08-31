/**
 * The `Realizes:` join taken INSIDE ONE FEATURE, in both directions: a promise
 * this feature makes that nothing in it keeps, and a promise it retires that
 * something outside it still keeps.
 *
 * `../realizes/findings.ts` grades the same join at the two places it can be
 * WRONG — an entry that resolves to nothing, a living requirement nothing
 * realizes. This module grades it at the one place it can silently COME APART:
 * the merge. Both directions are about a change, both are answered from
 * documents the archive gate already has parsed, and neither has any meaning
 * outside a feature — which is why they live together here and not beside their
 * fleet-scope siblings.
 *
 * TWO CODES, NOT ONE, and the decision is worth the paragraph because the shape
 * invites the opposite:
 *
 *   - The FIXES are different. `capability.uncovered` is fixed by writing the
 *     `Realizes:` line the promise is missing; `capability.remove-requirement-realized`
 *     is fixed by retiring the requirement that carries the line, or by dropping
 *     the line from it. A code is what a machine branches on and the branch is
 *     the fix, so a single code covering both would be a code neither caller can
 *     act on.
 *   - The SEVERITIES are different, and they are different for the reason
 *     `../../vocabulary/issue.ts` draws the distinction at all. `capability.uncovered`
 *     is a warning that GATES: the document is legal — writing a business promise
 *     ahead of the fleet is the recorded intended use, which is exactly why
 *     `capability.requirement-unrealized` warns and never gates — while the MERGE
 *     is what is unsafe, because once it lands the only thing that will ever
 *     mention the promise again is a fleet-scope warning nobody reads. The
 *     removal direction has no such legal reading: after that merge a LIVING
 *     service document nobody in the feature touched carries a pointer at
 *     nothing, and `capability.realizes-unknown` is already an ERROR there. So it
 *     is an error here, exactly as `openapi.remove-op-consumed` is one axis over
 *     for the identical shape — this feature retires a thing the living fleet
 *     still uses. One code carrying two severities is a code that says nothing.
 *   - The family already spells every direction of every join as its own code:
 *     `capability.unknown` / `capability.realizes-unknown` name the entry that
 *     resolves to nothing, `capability.unrealized` /
 *     `capability.requirement-unrealized` name the promise nobody keeps. A pair
 *     here is the shape a reader of that list already expects.
 *
 * A `#req-` TAGGED FLOW COUNTS AS COVER, and the reason it did not is worth
 * recording because it was a consequence rather than a policy. A `dynamic view`
 * used to be a fleet document with no feature-delta path, so a `#req-` tag
 * naming a capability requirement that was not living yet was ALREADY
 * `usecase.requirement-unresolved` — an error on `validate --all` — for the
 * whole window before the archive. At the moment this ran, a legal flow claim on
 * a newly-ADDED requirement could not exist, and the message said so: archive
 * with `--approve` first, tag the flow afterwards. That advice lands a promise
 * kept by nothing and relies on somebody coming back.
 *
 * `features/<FEAT>/usecases/` closed that (`core/usecases/delta/flows.ts`), so
 * the claim can now be legal at the moment it is graded, and the third arm of
 * `flows` below is it. What has NOT changed is which claims count: both tags
 * must resolve, against the vocabulary and requirement index this feature's own
 * merge would leave behind. A broken tag of either kind is an error in its own
 * right and must never also mark a promise kept — a typo that silenced this gate
 * would turn a mistake into a green archive.
 *
 * NO FILESYSTEM, deliberately, exactly as `../realizes/join.ts` has none — and
 * that is why the flows arrive as resolved pairs rather than as a docsDir. The
 * living side of the removal direction arrives as a thunk the caller supplies,
 * so the fleet-wide read happens only when this feature retires something, and
 * this module stays testable without a tree.
 */
import type { Requirement } from "../../document/spec.js";
import type { Issue } from "../../vocabulary/issue.js";
import { splitRealizesEntry } from "../realizes/join.js";
import { tagSlug } from "../usecase-join.js";

/**
 * One requirements document on the SERVICE side of the join, and the two facts
 * that address it: whose it is, and which axis. Both halves of the key are
 * needed because a feature's delta of `payment-service`'s `arch.spec.md`
 * supersedes the living `arch.spec.md` and says nothing at all about the living
 * `spec.md` beside it.
 */
export interface RealizingDoc {
  /** The service id. */
  service: string;
  /** The axis's filename — `spec.md` or `arch.spec.md`, as `SPEC_AXES` spells it. */
  file: string;
  reqs: readonly Requirement[];
}

/**
 * One capability document a feature's delta changes, with the living text that
 * delta applies to.
 *
 * `living` is here rather than derived because a REMOVED requirement is exempt
 * from `capability.requirement-unidentified` and so may be spelled by heading
 * alone — the id it retires is then a fact about the LIVING document, and
 * without it the removal direction would silently grade nothing for the
 * commonest way a removal is written. Requirements rather than the delta
 * package's `LivingIndex`: `core/delta` imports this package, so importing it
 * back would be a package cycle the file-level cycle check cannot see.
 */
export interface CapabilityDeltaDoc {
  /** The capability id — the directory chain under `features/<FEAT>/capabilities/`. */
  id: string;
  reqs: readonly Requirement[];
  /** The LIVING `capabilities/<id>/spec.md` requirements, or `[]` when this feature creates it. */
  living: readonly Requirement[];
}

/**
 * The `(capability, requirement)` pair, keyed for a Set.
 *
 * NUL — the separator `core/delta/scope.ts`'s claim key already uses — rather
 * than `#`, because a key's separator must be one its halves cannot contain and
 * a capability id is a YAML key and a directory name, constrained nowhere.
 * Re-joining with `#` would make `a#b` + `C` and `a` + `b#C` one key, and the
 * second is unreachable only because the requirement grammar happens to exclude
 * `#` today.
 */
function pairKey(capability: string, requirement: string): string {
  return `${capability}\0${requirement}`;
}

/**
 * The pairs one requirement's `Realizes:` lines name.
 *
 * Through `splitRealizesEntry`, never a local split, and the LAST `#` is what
 * makes it right: the requirement half has a grammar that excludes `#` and the
 * capability half has none, so a first-`#` split mis-parses every id containing
 * one — silently, which is the failure this axis exists to refuse.
 */
function realizedPairs(r: Requirement): string[] {
  return r.realizes.flatMap((entry) => {
    const target = splitRealizesEntry(entry);
    return target === null ? [] : [pairKey(target.capability, target.requirement)];
  });
}

/** How a service document is named in a message — the axis only where it is not the default one. */
function docLabel(doc: RealizingDoc): string {
  return doc.file === "spec.md" ? doc.service : `${doc.service} (${doc.file})`;
}

/**
 * One promise a `#req-` tagged flow in the SAME feature keeps.
 *
 * Structurally typed rather than imported from `core/usecases/delta/claims.ts`,
 * where the caller builds it, and the reason is the package graph rather than
 * taste: `core/usecases/` already imports this package, so importing it back
 * would be a cycle that `import/no-cycle` cannot see — the acyclicity obligation
 * `scripts/package-graph.mjs` exists to hold. The shape is three fields; the
 * RULE that produced them (both tags resolved, or the claim does not count) is
 * that module's, and this one grades what it is handed.
 */
export interface KeptByFlow {
  capability: string;
  requirement: string;
  /** The view ids keeping it. Carried for a caller's report; nothing here reads it. */
  flows: readonly string[];
}

/**
 * The flow corpus, or the honest statement that there was not one to read.
 *
 * A TRI-STATE and not a possibly-empty list, because the message says what was
 * checked and an empty list would make it say something loam never looked at.
 * "No flow keeps this" and "the flows were not graded" are different sentences
 * and only one of them is an accusation — the standing rule this axis states
 * everywhere else, applied to the message rather than to a severity.
 *
 * `why` is printed, so it names the cause an author can act on: an
 * `architecture/` that did not parse is one thing, a `capabilities.yaml` that
 * does not read as a vocabulary is another, and inside a feature gate NOTHING
 * ELSE reports the second — `core/coherence/declared.ts` keeps
 * `capability.invalid` for `validate --all`. Without the sentence the run
 * refuses, names the wrong cause, and points at nothing.
 */
export type FlowCorpus =
  | { graded: true; kept: readonly KeptByFlow[] }
  | { graded: false; why: string };

/**
 * `capability.uncovered` — a capability requirement this feature ADDS that no
 * `Realizes:` line in the same feature's service deltas names.
 *
 * ADDED ONLY. A MODIFIED changes a promise the living fleet may already
 * realize, so demanding a re-declaration would force an edit with nothing to
 * change — the same exemption `c4.uncovered` takes one axis over. A requirement
 * with no `Requirement-ID:` is SKIPPED rather than reported: it is already
 * `capability.requirement-unidentified`, and there is nothing for a `Realizes:`
 * line to address, so two findings for one mistake is the failure to avoid.
 *
 * The covering side is ADDED or MODIFIED, never BASE and never REMOVED. A BASE
 * requirement in a delta quotes living context and the merge never writes it,
 * so a `Realizes:` line there lands nowhere; a REMOVED one is on its way out and
 * cannot keep a promise after it is gone.
 *
 * Feature scope, deliberately. The fleet-scope version already ships as
 * `capability.requirement-unrealized`, and grading a feature-ADDED requirement
 * against the LIVING fleet is vacuous — no living `Realizes:` can name it
 * without being `capability.realizes-unknown` today.
 */
export function uncoveredIssues(
  capabilities: readonly CapabilityDeltaDoc[],
  services: readonly RealizingDoc[],
  // REQUIRED, with no default. A default would have to be one of the two arms,
  // and either choice is wrong for a caller that forgot: `graded: true` with an
  // empty list makes the message assert a negative, and `graded: false` makes it
  // quietly stop checking a corpus the caller does have. The compiler asking is
  // cheaper than either.
  flows: FlowCorpus,
): Issue[] {
  if (capabilities.length === 0) return [];
  const kept = new Set<string>();
  for (const doc of services) {
    for (const r of doc.reqs) {
      if (r.kind !== "ADDED" && r.kind !== "MODIFIED") continue;
      for (const pair of realizedPairs(r)) kept.add(pair);
    }
  }
  // The other carrier, through the SAME `pairKey` as the `Realizes:` side: two
  // corpora answering one question must not be able to disagree about which
  // promise a claim addresses. The caller resolved these; a claim whose tags did
  // not both resolve never reaches here, which is what stops a typo from
  // silencing the gate.
  if (flows.graded) for (const flow of flows.kept) kept.add(pairKey(flow.capability, flow.requirement));
  // What the message may CLAIM about the flow half. Ungraded, it claims nothing
  // and says so — the `Realizes:` half was still checked and is still worth
  // gating on, so the finding stands; what must not stand is a sentence
  // convicting a flow nobody resolved.
  const flowClause = flows.graded
    ? "and no `dynamic view` under this feature's usecases/ resolves a `#req-` tag to it. "
    : `and the flow half of the join was NOT checked — ${flows.why}, so a \`#req-\` claim could not be resolved either way. `;
  const issues: Issue[] = [];
  for (const doc of capabilities) {
    for (const r of doc.reqs) {
      if (r.kind !== "ADDED" || r.id === undefined) continue;
      if (kept.has(pairKey(doc.id, r.id))) continue;
      const entry = `${doc.id}#${r.id}`;
      issues.push({
        severity: "warn",
        gates: true,
        code: "capability.uncovered",
        subject: doc.id,
        message:
          `capability ${doc.id}: ADDED requirement '${r.name}' (${r.id}) is realized by nothing this feature changes — ` +
          `no ADDED or MODIFIED requirement in its specs/ deltas carries \`Realizes: ${entry}\`, ` +
          flowClause +
          "The document is legal; the MERGE is what is unsafe: once it lands, the only thing that will ever mention " +
          "this promise again is a fleet-scope warning (capability.requirement-unrealized) nobody reads. " +
          `Three ways on: add \`Realizes: ${entry}\` to the service requirement that carries part of it; ` +
          `if the promise CROSSES services, write the flow that keeps it as features/<FEAT>/usecases/<name>.likec4 and ` +
          `tag its \`dynamic view\` \`#cap-${tagSlug(doc.id)}\` and \`#req-${tagSlug(r.id)}\` — the archive merges it into ` +
          "architecture/usecases/ with everything else this feature lands; or archive with --approve to land the promise " +
          "ahead of the fleet and let capability.requirement-unrealized carry it.",
      });
    }
  }
  return issues;
}

/** Everything the removal direction needs, and nothing it would have to read twice. */
export interface RemovalJoin {
  /** This feature's capability deltas, each with the living document it applies to. */
  capabilities: readonly CapabilityDeltaDoc[];
  /** This feature's own service delta documents, already parsed by the same walk. */
  deltas: readonly RealizingDoc[];
  /**
   * Every LIVING service requirements document in the fleet. A thunk, called at
   * most once and only when this feature actually retires a capability
   * requirement — the overwhelming majority of features retire none, and this
   * read is the whole fleet's `spec.md` and `arch.spec.md`.
   */
  living: () => Promise<readonly RealizingDoc[]>;
}

/** The living requirements a delta document supersedes — MODIFIED and REMOVED both restate or delete. */
function supersedes(delta: RealizingDoc | undefined, living: Requirement): boolean {
  if (delta === undefined) return false;
  return delta.reqs.some((r) => {
    if (r.kind !== "MODIFIED" && r.kind !== "REMOVED") return false;
    return r.id === undefined ? r.name === living.name : r.id === living.id;
  });
}

/**
 * `capability.remove-requirement-realized` — this feature retires a capability
 * requirement that something the merge LEAVES BEHIND still realizes.
 *
 * The hole the forward direction does not close, and the one this whole module
 * exists to make impossible: a feature that REMOVES a capability requirement a
 * living service requirement realizes used to archive at exit 0, and the next
 * `loam validate --all` then failed with `capability.realizes-unknown` against a
 * service document nobody had touched. An archive that leaves the fleet red
 * against an untouched document is the exact class of silent damage the product
 * exists to refuse.
 *
 * GRADED AGAINST THE POST-MERGE FLEET, which is the only reading under which
 * the two escape hatches fall out instead of being special-cased. A living
 * requirement that this feature's own delta MODIFIES or REMOVES is gone as
 * written — a MODIFIED carries its FULL new text, so restating the requirement
 * without its `Realizes:` line IS how an author drops the join — and the delta's
 * own ADDED/MODIFIED requirements are what stands in its place. So: retire the
 * realizer in the same change and there is no breach; keep the line and there
 * is.
 *
 * A `#req-` tagged flow realizing the promise is NOT consulted, and that is the
 * other subject rather than a gap: the tag names the requirement directly, so a
 * removal turns it into `usecase.requirement-unresolved` on the living view —
 * loud, in the document that has to change, and nothing here would make it
 * louder.
 *
 * A REMOVED spelled by heading resolves through the living document, so it
 * grades exactly what the merge would delete. One that selects nothing is
 * already `delta.removed-unknown` and retires nothing, so it is skipped here —
 * two findings for one mistake, again.
 */
export async function removedRealizedIssues(join: RemovalJoin): Promise<Issue[]> {
  const retired = new Map<string, { capability: string; id: string; name: string }>();
  for (const doc of join.capabilities) {
    for (const r of doc.reqs) {
      if (r.kind !== "REMOVED") continue;
      const selected = doc.living.filter((l) => (r.id === undefined ? l.name === r.name : l.id === r.id));
      for (const l of selected) {
        if (l.id === undefined) continue;
        retired.set(pairKey(doc.id, l.id), { capability: doc.id, id: l.id, name: l.name });
      }
    }
  }
  if (retired.size === 0) return [];

  // Who still realizes each retired pair after the merge: the living
  // requirements this feature does not supersede, plus the requirements its own
  // deltas add or restate.
  const realizers = new Map<string, string[]>();
  const record = (pair: string, who: string): void => {
    if (!retired.has(pair)) return;
    const found = realizers.get(pair) ?? [];
    found.push(who);
    realizers.set(pair, found);
  };
  for (const doc of await join.living()) {
    const delta = join.deltas.find((d) => d.service === doc.service && d.file === doc.file);
    for (const r of doc.reqs) {
      if (supersedes(delta, r)) continue;
      for (const pair of realizedPairs(r)) record(pair, `${docLabel(doc)}'s living requirement '${r.name}'`);
    }
  }
  for (const doc of join.deltas) {
    for (const r of doc.reqs) {
      if (r.kind !== "ADDED" && r.kind !== "MODIFIED") continue;
      for (const pair of realizedPairs(r)) record(pair, `this feature's ${docLabel(doc)} delta requirement '${r.name}'`);
    }
  }

  const issues: Issue[] = [];
  for (const [pair, promise] of retired) {
    const who = realizers.get(pair);
    if (who === undefined) continue;
    const entry = `${promise.capability}#${promise.id}`;
    issues.push({
      severity: "error",
      code: "capability.remove-requirement-realized",
      subject: promise.capability,
      message:
        `capability ${promise.capability}: this feature REMOVES '${promise.name}' (${promise.id}), but ${who.join("; ")} ` +
        `still carries \`Realizes: ${entry}\`. After the merge that line points at a promise no document declares, and ` +
        "the very next `loam validate --all` reports capability.realizes-unknown against whatever carries it — for a " +
        "LIVING realizer, a service document this feature never touched. Retire the realizing requirement in the same " +
        "feature, or drop its `Realizes:` line (a MODIFIED does that by restating the requirement without it), or " +
        "archive with --approve to break the join deliberately.",
    });
  }
  return issues;
}
