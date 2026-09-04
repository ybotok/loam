/**
 * The context pack as a Markdown document on stdout — for pasting into an
 * agent's context, or reading in a terminal that renders neither.
 *
 * Rendering only. Everything printed here comes from `core/pack/`, which is
 * also what `--json` emits, so a printed section can never disagree with the
 * payload beside it. Requirement bodies and Given/When/Then lines go out
 * VERBATIM — they are the acceptance criteria, and paraphrasing them here
 * would put a second wording of the contract in front of whoever implements
 * it. The living sections use the canonical `### Requirement:` /
 * `#### Scenario:` heading levels; the in-flight blocks print the same lines
 * one level deeper, because each sits under its feature's own `###` heading.
 */
import { type ContextPack } from "../../core/pack/pack.js";
import { type PackRequirement } from "../../core/pack/living.js";
import { type PackFeature } from "../../core/pack/features.js";

export function printPack(pack: ContextPack): void {
  console.log(`# ${pack.service} — context pack\n`);
  const badge = [pack.frontmatter.status, pack.frontmatter.owner].filter((s) => s !== null);
  console.log(`${pack.path} · ${pack.maturity}${badge.length > 0 ? ` · ${badge.join(" · ")}` : ""}`);
  if (pack.missing.length > 0) console.log(`missing: ${pack.missing.join(", ")}`);
  if (pack.frontmatter.last_verified !== null) console.log(`last_verified: ${pack.frontmatter.last_verified}`);
  // Under the date it qualifies: that vouch read the sections this names and
  // no others, so `verified` above covers less of the document than it looks.
  if (pack.frontmatter.vouch_scope !== null) {
    console.log(`vouch_scope: ${pack.frontmatter.vouch_scope} — the rest was not read at that vouch`);
  }
  // Per axis and named, `show`'s discipline: the sample is per FILE, so one
  // run can read a short spec.md in full and stamp a long arch.spec.md
  // sampled. Printing only the first line said `verified` over arch
  // requirements this pack then reproduced verbatim, half of them unread.
  if (pack.archSpec.vouch_scope !== null) {
    console.log(
      `archSpec.vouch_scope: ${pack.archSpec.vouch_scope} — the rest of arch.spec.md was not read at that vouch`,
    );
  }
  for (const s of pack.frontmatter.sources) console.log(`sources: ${s}`);
  console.log();

  // Unreadable documents are said FIRST and without hedging (explore's print
  // discipline): every empty section below could otherwise be read as "nothing
  // here", which is the one conclusion an unreadable document never supports.
  if (pack.landscape.present && !pack.landscape.parses) {
    // The `architecture/` PROJECT is what `parses` answers for, so the document
    // at fault is very often a SIBLING beside a landscape that reads perfectly
    // — and naming the landscape sent a reader to bytes loam read fine
    // (verification 2026-09-04). `adopt` and `validate --all` name the file; so
    // does this. The project keeps the fallback: a failure LikeC4 reports with
    // no source document behind it is still a project that does not parse.
    const broken = pack.landscape.broken;
    const named = broken.length === 0 ? "the fleet map (architecture/)" : broken.join(", ");
    // `> 1`, not `=== 1`: the empty arm's subject is the singular "fleet map".
    const verb = broken.length > 1 ? "do" : "does";
    console.log(`! ${named} ${verb} not parse — no edge below is derived, and none is missing either\n`);
  }
  if (pack.openapi.unreadable) {
    console.log(`! openapi.yaml does not parse — nothing here lists what ${pack.service} exposes`);
    if (pack.openapi.error !== undefined) console.log(`  ${pack.openapi.error}`);
    console.log();
  }
  if (pack.asyncapi.unreadable) {
    console.log(`! asyncapi.yaml does not parse — nothing here lists what ${pack.service} publishes or consumes`);
    if (pack.asyncapi.error !== undefined) console.log(`  ${pack.asyncapi.error}`);
    console.log();
  }
  // The vocabulary failures lead with the contract failures: each empties a
  // section below into something that reads as an answer ("declared: false"
  // on every permission, "(none realized here)"), and a warning printed down
  // beside the section is a warning a reader pasting the top of the pack
  // never sees.
  if (pack.permissionsVocabulary.invalid !== undefined) {
    console.log("! architecture/permissions.yaml does not read as a vocabulary — every permission below reports declared: false because nobody could look");
    console.log(`  ${pack.permissionsVocabulary.invalid}`);
    console.log();
  }
  if (pack.capabilitiesVocabulary.invalid !== undefined) {
    console.log("! architecture/capabilities.yaml does not read as a vocabulary — no capability below is derived, and none is missing either");
    console.log(`  ${pack.capabilitiesVocabulary.invalid}`);
    console.log();
  }
  for (const path of pack.capabilitiesUnread) {
    console.log(`! ${path} could not be read while joining capabilities — that service's realizations are missing from the rollup this pack filtered`);
  }
  if (pack.capabilitiesUnread.length > 0) console.log();
  if (pack.useCaseScan.unreadable) {
    console.log("! architecture/ does not parse as one LikeC4 project — every use case below is missing because nobody could look, not because none is drawn");
    if (pack.useCaseScan.error !== undefined) console.log(`  ${pack.useCaseScan.error}`);
    console.log();
  }

  printRequirements("Requirements", pack.requirements);
  printRequirements("Arch requirements", pack.archRequirements);

  console.log("## Operations\n");
  if (pack.operations.length === 0) console.log(pack.openapi.unreadable ? "(unreadable — see above)\n" : "(none)\n");
  for (const op of pack.operations) {
    const by = op.governedBy.length > 0
      ? `governed by ${op.governedBy.map((n) => `"${n}"`).join(", ")}`
      : "not governed by any requirement";
    console.log(`- ${op.method} ${op.path}  ${op.id} — ${by}`);
  }
  if (pack.operations.length > 0) console.log();

  console.log("## Messages\n");
  if (pack.messages.length === 0) console.log(pack.asyncapi.unreadable ? "(unreadable — see above)\n" : "(none)\n");
  for (const m of pack.messages) {
    const direction = m.direction === null ? "declared, not wired" : m.direction.toUpperCase();
    console.log(`- ${direction}  ${m.name}  (${m.slot})`);
  }
  if (pack.messages.length > 0) console.log();

  console.log("## Permissions\n");
  if (pack.permissions.length === 0) console.log("(none required)\n");
  for (const p of pack.permissions) {
    if (!p.declared) {
      console.log(`- ${p.id} — not declared in architecture/permissions.yaml`);
      continue;
    }
    const notes = [
      ...(p.description === undefined ? [] : [p.description]),
      ...(p.ownedBy === undefined ? [] : [`owned by ${p.ownedBy}`]),
      ...(p.enforcedBy.length === 0 ? [] : [`enforced by ${p.enforcedBy.join(", ")}`]),
    ];
    console.log(`- ${p.id}${notes.length > 0 ? ` — ${notes.join("; ")}` : ""}`);
  }
  if (pack.permissions.length > 0) console.log();

  console.log("## Capabilities\n");
  if (pack.capabilities.length === 0) {
    console.log(pack.capabilitiesVocabulary.invalid !== undefined ? "(unreadable — see above)\n" : "(none realized here)\n");
  }
  for (const c of pack.capabilities) {
    const label = c.description === undefined ? c.id : `${c.id} — ${c.description}`;
    console.log(`- ${label} (realized by: ${c.requirements.map((n) => `"${n}"`).join(", ")})`);
    // The flows that claim the capability, fleet-wide — the answer to "what is
    // this requirement FOR", which the requirement's own text rarely gives.
    for (const flow of c.useCases) console.log(`  - flow: ${flow.title ?? flow.id} [${flow.id}]  ${flow.file}`);
  }
  if (pack.capabilities.length > 0) console.log();

  console.log("## Use cases\n");
  if (pack.useCaseSteps.length === 0) {
    console.log(pack.useCaseScan.unreadable ? "(unreadable — see above)\n" : "(no declared flow draws this service)\n");
  }
  for (const flow of pack.useCaseSteps) {
    console.log(`- ${flow.title ?? flow.id} [${flow.id}]  ${flow.file}`);
    for (const step of flow.steps) {
      const label = step.title === undefined ? "" : ` '${step.title}'`;
      console.log(`  - step ${step.ordinal}${label}: ${step.source} -> ${step.target}`);
    }
  }
  if (pack.useCaseSteps.length > 0) console.log();

  console.log("## Landscape\n");
  if (!pack.landscape.present) console.log("(no architecture/landscape.likec4)\n");
  else if (!pack.landscape.parses) console.log("(unreadable — see above)\n");
  else {
    if (!pack.landscape.modelled) console.log(`${pack.service} is not in the fleet map — no edge into it can be checked`);
    for (const e of pack.landscape.inbound) console.log(`- ← ${e.service}${edgeNote(e.op, e.title)}`);
    for (const e of pack.landscape.outbound) console.log(`- → ${e.service}${edgeNote(e.op, e.title)}`);
    if (pack.landscape.modelled && pack.landscape.inbound.length === 0 && pack.landscape.outbound.length === 0) {
      console.log("(modelled, no edges touch it)");
    }
    console.log();
  }

  console.log("## Pointers\n");
  const mark = (present: boolean): string => (present ? "present" : "absent");
  console.log(`- runbook: ${mark(pack.pointers.runbook.present)} (${pack.pointers.runbook.path})`);
  console.log(`- health: ${mark(pack.pointers.health.present)} (${pack.pointers.health.path})`);
  console.log(`- adrs: ${pack.pointers.adrs.count} (${pack.pointers.adrs.path})`);
  console.log();

  // The narrowing is said in the heading: a narrowed pack differs from the
  // default only by what it leaves OUT, and a reader (or a diff) must not
  // mistake one for a fleet gone quiet.
  console.log(pack.feature === null ? "## In flight\n" : `## In flight (narrowed to ${pack.feature})\n`);
  if (pack.features.length === 0) console.log("(no active feature touches this service)");
  for (const f of pack.features) printFeature(f, pack.service);
}

function printRequirements(label: string, reqs: PackRequirement[], level = "##"): void {
  console.log(`${level} ${label}\n`);
  if (reqs.length === 0) console.log("(none)\n");
  for (const r of reqs) {
    const tag = r.kind === "BASE" ? "" : `[${r.kind}] `;
    console.log(`${level}# Requirement: ${tag}${r.name}`);
    if (r.text.length > 0) console.log(r.text);
    for (const s of r.scenarios) {
      console.log(`\n${level}## Scenario: ${s.name}`);
      // Verbatim, bullets and markdown emphasis included: these lines are the
      // acceptance criteria.
      for (const line of s.lines) console.log(line);
    }
    console.log();
  }
}

function printFeature(f: PackFeature, service: string): void {
  console.log(`### ${f.feature} (${f.path})\n`);
  if (!f.services.includes(service)) {
    console.log(`(no delta for ${service} — ${f.feature} touches: ${f.services.length > 0 ? f.services.join(", ") : "(no services)"})\n`);
  }
  // Intent prose arrives with its own headings — usually an H1 title — and
  // pasted raw under this feature's `###` those restructure the whole pack: a
  // second H1 splits the document, and an intent section named "Operations"
  // collides with the pack's own. Demoted three levels (below the feature
  // heading), capped at H6 because a seventh `#` renders as literal text.
  // Body lines are untouched — the demotion is structural, not a paraphrase.
  if (f.intent !== null && f.intent.length > 0) console.log(`${demoteHeadings(f.intent)}\n`);
  if (f.requirements.length > 0) printRequirements("Requirement delta", f.requirements, "###");
  if (f.archRequirements.length > 0) printRequirements("Arch requirement delta", f.archRequirements, "###");

  if (f.openapi.unreadable) {
    // Worded like the delta brief's answer for the same failure, and without a
    // "run `loam validate`" hint: the parser's own message is quoted and the
    // exit code carries the failure.
    console.log("API: openapi.yaml does not parse");
    if (f.openapi.error !== undefined) console.log(`  ${f.openapi.error}`);
    console.log();
  } else if (f.api.length > 0) {
    console.log("API changes:");
    for (const op of f.api) {
      const marker = op.remove ? "REMOVE " : "";
      console.log(`- ${marker}${op.method} ${op.path}  ${op.operationId}${op.summary === null ? "" : ` — ${op.summary}`}`);
    }
    console.log();
  }

  if (f.events.unreadable) {
    console.log("Events: asyncapi.yaml does not parse");
    if (f.events.error !== undefined) console.log(`  ${f.events.error}`);
    console.log();
  } else if (f.events.changes.length > 0) {
    console.log("Event changes:");
    for (const m of f.events.changes) {
      const marker = m.remove ? "REMOVE " : "";
      const direction = m.direction === null ? "" : `${m.direction.toUpperCase()} `;
      console.log(`- ${marker}${direction}${m.message}  (${m.slot})`);
    }
    console.log();
  }

  const arch = f.architecture;
  if (arch.errors.length > 0) {
    console.log("Architecture: delta.likec4 has errors");
    for (const e of arch.errors) console.log(`  ${e}`);
    console.log();
  } else if (arch.isNew || arch.inbound.length > 0 || arch.outbound.length > 0) {
    console.log("Architecture:");
    if (arch.isNew) console.log(`- NEW service — create ${service}`);
    for (const e of arch.outbound) console.log(`- → ${e.service}${edgeNote(e.op, e.title)}`);
    for (const e of arch.inbound) console.log(`- ← ${e.service}${edgeNote(e.op, e.title)}`);
    console.log();
  }

  // Both interpolants passed their grammars at the boundary — the service
  // through assertServiceId, the feature id as the CANONICAL id the
  // enumeration derived — so the printed command parses. That property is the
  // exact lesson explore's `--as` records: this line is assembled from data,
  // which is the one shape test/agent-commands-runnable.test.ts cannot see.
  console.log(`next: loam delta ${f.feature} --service ${service}\n`);
}

function edgeNote(op: string | null, title: string | null): string {
  if (op !== null) return `  ${op}`;
  return title !== null && title.length > 0 ? `  "${title}"` : "";
}

/** Every ATX heading pushed three levels down, capped at H6 — see the intent comment above. */
function demoteHeadings(md: string): string {
  return md.replace(/^(#{1,6})(?= )/gm, (h) => "#".repeat(Math.min(6, h.length + 3)));
}
