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
import { type UseCaseBlastRadius } from "../../core/usecases/touch.js";
import { type CapabilityDeltaSummary } from "../../core/capabilities/delta/summary.js";

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
export function printRequirements(reqs: Requirement[], label: string): void {
  if (reqs.length === 0) {
    console.log(`${label}: (none)\n`);
    return;
  }
  console.log(`${label}:`);
  for (const r of reqs) {
    const tag = r.kind === "BASE" ? "" : `[${r.kind}] `;
    const n = r.scenarios.length;
    console.log(`  ${tag}${r.name}  (${n} scenario${n === 1 ? "" : "s"})`);
    const body = r.text.join("\n").trim();
    if (body.length > 0) console.log(indent(body, "    "));
    if (r.operations.length > 0) console.log(`    Operations: ${r.operations.join(", ")}`);
    if (r.covers.length > 0) console.log(`    Covers: ${r.covers.join(", ")}`);
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

export function printApi(api: ApiSlice): void {
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
    const marker = op.remove ? "REMOVE " : "";
    console.log(
      `  ${marker}${op.method} ${op.path}  ${op.operationId}${op.summary === null ? "" : ` — ${op.summary}`}`,
    );
  }
  console.log();
}

export function printEvents(events: EventSlice): void {
  if (events.unreadable) {
    // Same wording stance as printApi above, `asyncapi.invalid` being the
    // validate finding on this file.
    console.log("Events: asyncapi.yaml does not parse");
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
    const marker = m.remove ? "REMOVE " : "";
    const direction = m.direction === null ? "" : `${m.direction.toUpperCase()} `;
    console.log(`  ${marker}${direction}${m.message}  (${m.slot})`);
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
 */
export function printUseCases(useCases: UseCaseBlastRadius, service: string): void {
  if (useCases.unreadable) {
    console.log("Use cases: architecture/ does not parse, so the flows through this service could not be read");
    if (useCases.error !== undefined) console.log(`  ${useCases.error}`);
    console.log();
    return;
  }
  if (useCases.flows.length === 0) {
    console.log(`Use cases: (no declared flow draws ${service})\n`);
    return;
  }
  console.log("Use cases (business flows this service is already a hop of):");
  for (const flow of useCases.flows) {
    console.log(`  ${flow.title ?? flow.id}  [${flow.id}]  ${flow.file}`);
    for (const step of flow.steps) {
      const label = step.title === undefined ? "" : ` '${step.title}'`;
      console.log(`    step ${step.ordinal}${label}: ${step.source} -> ${step.target}`);
    }
  }
  console.log();
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

export function indent(text: string, pad: string): string {
  return text
    .split("\n")
    .map((l) => (l.length > 0 ? pad + l : l))
    .join("\n");
}
