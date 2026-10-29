/**
 * The delta as a person reads it: requirements, contract changes, the
 * architecture slice for one service, and the business promises the feature
 * changes.
 *
 * Rendering only. Everything printed here comes from `../../core/projection/`
 * or `../../core/capabilities/`, which is also what `--json` emits.
 */
import { type Requirement } from "../../core/document/spec.js";
import { type ApiSlice } from "../../core/projection/api.js";
import { type ArchSlice } from "../../core/projection/arch-slice.js";
import { type EventSlice } from "../../core/projection/events.js";
import { type RedrawClaim, type RedrawFlow, type ServiceUseCases } from "../../core/delta/flows/inside.js";
import { type HopInside, type JoinedUseCase } from "../../core/usecases/join/inside.js";
import { compareIds } from "../../core/repo/entries.js";
import { type CapabilityDeltaSummary } from "../../core/capabilities/delta/summary.js";
import { droppedSentence, type DroppedRow } from "../../core/document/apply.js";
import type { IntentRef } from "../../core/document/intent/reference.js";
import type { SpanOf } from "../../core/pack/requirement.js";
import type { Change, DiffLine, Review } from "../../core/projection/review.js";

/**
 * A diff as a reviewer reads it: `-` the living line the merge takes out, `+`
 * the line it writes, two spaces for a line both carry — the markers `git diff`
 * taught every reader, so nothing here needs a legend.
 */
function printDiff(diff: readonly DiffLine[], pad: string): void {
  for (const { op, line } of diff) console.log(`${pad}${op === "=" ? " " : op} ${line}`.trimEnd());
}

/** ` · edit` after a kind, or nothing — the `--diff` tag, absent without the flag. */
function changeTag(change: Change | null | undefined): string {
  return change === undefined ? "" : ` · ${change ?? "not compared"}`;
}

/**
 * The requirement delta, in full.
 *
 * The text view used to print headings and scenario NAMES only, which made it a
 * table of contents for a file the reader then had to open — while `--json`
 * carried the requirement body and the Given/When/Then lines verbatim. The two
 * are the same briefing, so they carry the same content: a person reading this
 * in a terminal is being asked to implement it, exactly like the agent reading
 * the payload.
 */
export function printRequirements(reqs: Requirement[], label: string, reviews?: readonly Review[]): void {
  if (reqs.length === 0) {
    console.log(`${label}: (none)\n`);
    return;
  }
  console.log(`${label}:`);
  for (const [i, r] of reqs.entries()) {
    const review = reviews?.[i];
    const tag = r.kind === "BASE" ? "" : `[${r.kind}${changeTag(review?.change)}] `;
    const n = r.scenarios.length;
    console.log(`  ${tag}${r.name}  (${n} scenario${n === 1 ? "" : "s"})`);
    // Under `--diff`, an edit or a removal is shown AS the change — the living
    // text with what goes and what comes marked — instead of the new text alone,
    // which is the reading the review needs and the brief does not.
    if (review?.diff !== undefined) {
      printDiff(review.diff, "    ");
      console.log();
      continue;
    }
    // The body VERBATIM, and that is the whole of the requirement's text —
    // `Operations:`, `Covers:`, `Publishes:`, `Consumes:`, `Requires:`,
    // `Realizes:`, `Requirement-ID:` and `Based-On:` are body lines, kept in
    // `text` on purpose so a requirement round-trips through
    // `serializeRequirements` and rides inside its own digest
    // (core/document/parse.ts states that rule).
    //
    // This used to print `Operations:` and `Covers:` AGAIN from the parsed
    // fields underneath, so every requirement carrying either line showed it
    // twice — and the other five directives, which have no such re-print, showed
    // it once. Nothing caught it: the human view is not asserted anywhere, and
    // the duplication is only visible on a requirement that has one. Found by
    // running `loam delta` over loam's own self-model, which is the kind of
    // pressure ROADMAP.md's self-hosting section says the axis buys.
    const body = r.text.join("\n").trim();
    if (body.length > 0) console.log(indent(body, "    "));
    for (const s of r.scenarios) {
      console.log(`\n    Scenario: ${s.name}`);
      // Verbatim, bullets and markdown emphasis included: these lines are the
      // acceptance criteria, and paraphrasing them here would put a second
      // wording of the contract in front of whoever implements it.
      for (const line of s.lines) console.log(`      ${line}`);
    }
    console.log();
  }
}

/**
 * `--outline`'s view of a requirement section: one line per requirement — where
 * it is, what opening it costs, how many scenarios it owns — and nothing it
 * says. The words are in the file, between the lines named. Under `--diff` the
 * review rides along as it does in the JSON outline: the change tag on the
 * line, and an edit's or a removal's changed lines under it.
 */
export function printOutline(section: { reqs: readonly Requirement[]; spanOf: SpanOf; label: string }, reviews?: readonly Review[]): void {
  const { reqs, spanOf, label } = section;
  if (reqs.length === 0) {
    console.log(`${label}: (none)\n`);
    return;
  }
  console.log(`${label} (outline of ${spanOf(reqs[0]!).path}):`);
  for (const [i, r] of reqs.entries()) {
    const span = spanOf(r);
    const review = reviews?.[i];
    const n = r.scenarios.length;
    const tag = r.kind === "BASE" ? "" : `[${r.kind}${changeTag(review?.change)}] `;
    const id = r.id === undefined ? "" : `${r.id} · `;
    console.log(`  ${tag}${id}${r.name}  (lines ${span.line}–${span.endLine}, ${span.bytes.toLocaleString("en-US")} bytes, ${n} scenario${n === 1 ? "" : "s"})`);
    if (review?.diff !== undefined) printDiff(review.diff, "    ");
  }
  console.log();
}

export function printApi(api: ApiSlice, reviews?: ReadonlyMap<string, Review>): void {
  if (api.unreadable) {
    // Worded like `loam show`'s answer for the same failure on a living
    // contract, and deliberately WITHOUT a "run `loam validate`" hint: the
    // parser's own message is already quoted below and the exit code carries
    // the failure, so another command adds a hop, not information.
    // (`validate --feature` does grade `openapi.invalid` on this same file
    // these days; the fix is still in the YAML, not in its output.)
    console.log("API: openapi.yaml does not parse");
    if (api.error !== undefined) console.log(`  ${api.error}`);
    console.log();
    return;
  }
  if (api.changes.length === 0) {
    console.log("API: (the openapi delta defines no operations)\n");
    return;
  }
  console.log("API (this feature's openapi.yaml for the service):");
  for (const op of api.changes) {
    const review = reviews?.get(`${op.method} ${op.path}`);
    // The review's tag says `remove` already; the marker would say it twice.
    const marker = op.remove && review === undefined ? "REMOVE " : "";
    const tag = review === undefined ? "" : `[${review.change ?? "not compared"}] `;
    console.log(
      `  ${tag}${marker}${op.method} ${op.path}  ${op.operationId}${op.summary === null ? "" : ` — ${op.summary}`}`,
    );
    if (review?.diff !== undefined) printDiff(review.diff, "    ");
  }
  console.log();
}

export function printEvents(events: EventSlice, reviews?: ReadonlyMap<string, Change>): void {
  if (events.unreadable) {
    // Same wording stance as printApi above, `asyncapi.invalid` being the
    // validate finding on this file.
    console.log("Events: asyncapi.yaml does not read as AsyncAPI 3.0");
    if (events.error !== undefined) console.log(`  ${events.error}`);
    console.log();
    return;
  }
  if (events.changes.length === 0) {
    console.log("Events: (the asyncapi delta declares no messages)\n");
    return;
  }
  console.log("Events (this feature's asyncapi.yaml for the service):");
  for (const m of events.changes) {
    const change = reviews?.get(m.slot);
    const marker = m.remove && change === undefined ? "REMOVE " : "";
    const direction = m.direction === null ? "" : `${m.direction.toUpperCase()} `;
    console.log(`  ${change === undefined ? "" : `[${change}] `}${marker}${direction}${m.message}  (${m.slot})`);
  }
  console.log();
}

export function printArchSlice(arch: ArchSlice, service: string): void {
  if (arch.errors.length > 0) {
    console.log("Architecture: delta.likec4 has errors — run `loam validate`.");
    return;
  }
  console.log("Architecture:");
  if (arch.isNew) console.log(`  NEW service — create ${service}`);
  if (arch.outbound.length > 0) {
    console.log("  Outbound (new calls from this service):");
    for (const e of arch.outbound) console.log(`    → ${e.service}  "${e.title ?? ""}"`);
  }
  if (arch.inbound.length > 0) {
    console.log("  Inbound (this service is newly called):");
    for (const e of arch.inbound) console.log(`    ← ${e.service}  "${e.title ?? ""}"`);
  }
  if (!arch.isNew && arch.outbound.length === 0 && arch.inbound.length === 0) {
    console.log("  (no architecture change for this service)");
  }
  console.log();
}

/**
 * The business flows this service already appears in.
 *
 * Printed even when it is empty, unlike the sections above, which are skipped
 * when the feature has no such file. Those absences are facts about the FEATURE
 * — no asyncapi.yaml means this change declares no events — while this one is a
 * fact about the fleet, and "no use case draws this service" is the answer an
 * implementer most needs to see stated rather than inferred from a missing
 * heading.
 *
 * The unreadable arm exists so that emptiness is never ambiguous: an
 * `architecture/` that does not parse produces the same empty list as a fleet
 * that draws nothing, and only this line tells the two apart.
 *
 * Under each hop the service answers, what the hop is inside it: the service's
 * flows claiming a requirement that holds the hop's key, grouped by that
 * requirement — or the plain fact that none does, which is information and
 * never a finding (docs/DESIGN.md rule 26). Then the feature's own flows, which
 * are what this change is for, and the service's flows it makes untrue.
 */
export function printUseCases(useCases: ServiceUseCases, service: string): void {
  const living = useCases.living;
  if (living.unreadable) {
    console.log("Use cases: architecture/ does not parse, so the flows through this service could not be read");
    if (living.error !== undefined) console.log(`  ${living.error}`);
    console.log();
  } else if (living.flows.length === 0) {
    console.log(`Use cases: (no declared flow draws ${service})\n`);
  } else {
    console.log("Use cases (business flows this service is already a hop of):");
    printFlows(living.flows, service);
    console.log();
  }
  const feature = useCases.feature;
  if (feature.unreadable) {
    console.log("Use cases this feature brings: its usecases/ could not be read against the map its merge leaves");
    if (feature.error !== undefined) console.log(`  ${feature.error}`);
    console.log();
  } else if (feature.flows.length > 0) {
    console.log("Use cases this feature brings (its own flows through this service):");
    printFlows(feature.flows, service);
    console.log();
  }
  if (useCases.inside.unreadable) {
    console.log(`Inside ${service}: its own flows could not be read, so no hop above says what it is inside the service`);
    if (useCases.inside.error !== undefined) console.log(`  ${useCases.inside.error}`);
    console.log();
  }
  if (useCases.redraw.length > 0) {
    console.log(`Flows of ${service} this change makes untrue:`);
    for (const flow of useCases.redraw) {
      console.log(`  ${flow.file}  [${flow.id}]`);
      for (const claim of flow.claims) console.log(`    claims ${claim.requirement}, which this feature ${claim.change}: ${redrawFix(flow, claim)}`);
    }
    console.log();
  }
}

/**
 * The fix for one claim, which depends on what the merge does to its tag.
 * Only a tag that still resolves can be kept by restating the flow; for a broken
 * one that would trade one gating error for another, so the fix is the one the
 * finding gives (`usecase.requirement-unresolved`).
 */
function redrawFix(flow: RedrawFlow, claim: RedrawClaim): string {
  if (claim.breaks === "collides") {
    return "an id this feature adds flattens to the same tag, which gates the archive — rename one of the colliding ids";
  }
  if (claim.breaks === "unresolved") {
    const at = flow.slot === undefined ? "in place" : `by a redrawn flow at ${flow.slot}, or a document there holding only comments, which retires it`;
    return `its tag stops resolving, which gates the archive — drop the tag or point it at the promise that replaces it (${at}), or MODIFY the requirement instead`;
  }
  return flow.slot === undefined ? "redraw it in place if it no longer holds" : `redraw it at ${flow.slot}, or put it there unchanged if it still holds`;
}

function printFlows(flows: readonly JoinedUseCase[], service: string): void {
  for (const flow of flows) {
    console.log(`  ${flow.title ?? flow.id}  [${flow.id}]  ${flow.file}`);
    for (const step of flow.steps) {
      const label = step.title === undefined ? "" : ` '${step.title}'`;
      console.log(`    step ${step.ordinal}${label}: ${step.source} -> ${step.target}`);
      if (step.inside !== undefined) printInside(step.inside, service);
    }
  }
}

function printInside(inside: HopInside, service: string): void {
  const pad = "      ";
  if (inside.state === "keyless") {
    console.log(`${pad}inside ${service}: the edge behind this hop names no operation or message, so nothing joins it`);
  } else if (inside.state === "contested") {
    const ops = inside.candidates.map((op) => op ?? "(none)").join(", ");
    console.log(`${pad}inside ${service}: not joined — the edges behind this hop name ${ops}, and its title picks none`);
  } else if (inside.state === "unbacked") {
    console.log(`${pad}inside ${service}: not joined — nothing in the model backs this hop`);
  } else {
    const keys = inside.keys.map((k) => `${k.kind} ${k.name}`).join(", ");
    if (inside.state === "unread") {
      console.log(`${pad}inside ${service}, by ${keys}: not read — its flows could not be read`);
    } else if (inside.flows.length === 0) {
      console.log(`${pad}inside ${service}, by ${keys}: no flow claims a requirement holding it — a fact, not a finding`);
    } else {
      console.log(`${pad}inside ${service}, by ${keys}:`);
      const ids = [...new Set(inside.flows.flatMap((f) => f.via))].sort(compareIds);
      for (const id of ids) {
        for (const f of inside.flows.filter((flow) => flow.via.includes(id))) {
          console.log(`${pad}  ${id}: ${f.id}  ${f.file}${f.origin === "feature" ? "  (this feature's)" : ""}`);
        }
      }
    }
  }
}

/**
 * The business promises this feature changes, and the exact `Realizes:` entry
 * each one is addressed by.
 *
 * SILENT WHEN THERE ARE NONE, unlike the use-case section above, and the
 * asymmetry is deliberate. "No declared flow draws this service" is an answer
 * about the FLEET — the flows exist and none of them names you — so saying so
 * is informative. A feature with no capability delta is the normal state of
 * every feature in a fleet that has not adopted the business axis, and a line
 * announcing that on every projection would be the noise that teaches people to
 * skim the brief.
 *
 * The entry is printed WHOLE (`Realizes: refunds#REF-1`) rather than as a
 * capability and an id a reader has to assemble: it is text somebody is about
 * to paste into a requirement, and the one spelling mistake it can carry —
 * the `#` — is the one nothing downstream can suggest a fix for.
 */
export function printCapabilities(capabilities: readonly CapabilityDeltaSummary[]): void {
  if (capabilities.length === 0) return;
  console.log("Capabilities (business promises this feature changes):");
  for (const c of capabilities) {
    console.log(`  ${c.id}  +${c.added} ~${c.modified} -${c.removed}`);
    for (const p of c.promises) {
      const entry = p.id === null ? "(no Requirement-ID: yet)" : `Realizes: ${c.id}#${p.id}`;
      console.log(`    ${p.kind} '${p.name}' — ${entry}`);
    }
  }
  console.log();
}

/**
 * What the merge would take out of the living documents, per document — the
 * archive plan's own lines (`core/document/apply.ts`), printed BEFORE the
 * archive, which is the only moment a reader can still put a scenario back.
 * Silent when nothing is taken: a section that said "(none)" on every
 * additive feature would teach the reader to skip it.
 */
export function printDropped(rows: ReadonlyArray<DroppedRow & { path: string }>): void {
  if (rows.length === 0) return;
  console.log("Taken out of the living docs by the merge:");
  for (const row of rows) console.log(`  ${row.path}: ${row.kind === "REMOVED" ? "-" : "~"} ${droppedSentence(row)}`);
  console.log();
}

/**
 * The feature's why, whole, then how many of its open questions name this
 * service — the line that tells a team which of the questions above are theirs
 * to answer. Nothing is printed for an intent with no open questions.
 */
export function printIntent(intent: string | null, questions: { total: number; naming: number }, service: string): void {
  if (intent) {
    console.log(indent(intent, "  "));
    console.log();
  }
  if (questions.total > 0) {
    console.log(`  open questions: ${questions.total}, ${questions.naming} of them naming ${service}\n`);
  }
}

/**
 * `--intent-ref`'s view of the same section: where the why lives and what it
 * costs to read, then the lines of the open questions naming this service —
 * the part of the intent that is this team's work, read in the file the
 * reference names rather than reprinted here.
 */
export function printIntentRef(ref: IntentRef | null, service: string): void {
  if (ref === null) return;
  console.log(`  intent: ${ref.path} — ${ref.bytes.toLocaleString("en-US")} bytes, sha256 ${ref.sha256.slice(0, 12)}…, not inlined`);
  const { total, naming } = ref.questions;
  if (total > 0) console.log(`  open questions: ${total}, ${naming.length} of them naming ${service}`);
  if (naming.length > 0) console.log(`    at lines ${naming.map((q) => q.line).join(", ")}`);
  console.log();
}

export function indent(text: string, pad: string): string {
  return text
    .split("\n")
    .map((l) => (l.length > 0 ? pad + l : l))
    .join("\n");
}
