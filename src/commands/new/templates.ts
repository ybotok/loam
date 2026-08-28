/**
 * The six files `loam new` scaffolds, and what each one says.
 *
 * They are here rather than inline because every one of them is a document a
 * person edits next, and the wording IS the instruction: the delta's comments
 * teach the grammar `core/document/parse.ts` matches on, and the intent's
 * frontmatter is serialized rather than interpolated because a title is free
 * text somebody types — `Checkout: split payments` reopens the mapping and the
 * file stops parsing.
 */
import { stringify as stringifyYaml } from "yaml";
import { REQUIREMENT_ID_RE } from "../../core/document/spec.js";
import {
  ARCH_REQUIREMENT_SENTINEL,
  ARCH_SHALL_SENTINEL,
  CAPABILITY_REQUIREMENT_SENTINEL,
  CAPABILITY_SHALL_SENTINEL,
  REQUIREMENT_SENTINEL,
  SCENARIO_SENTINEL,
  SERVICE_DESCRIPTION_SENTINEL,
  GIVEN_SENTINEL,
  SHALL_SENTINEL,
  THEN_SENTINEL,
  WHEN_SENTINEL,
} from "../../core/coherence/authoring/sentinels.js";

function identifier(name: string, taken: Set<string>): string {
  const parts = name.split(/[^A-Za-z0-9]+/).filter((p) => p.length > 0);
  const head = (parts[0] ?? "svc").replace(/^\d+/, "") || "svc";
  const base =
    head[0]!.toLowerCase() +
    head.slice(1) +
    parts.slice(1).map((p) => p[0]!.toUpperCase() + p.slice(1)).join("");
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}${n}`;
  taken.add(id);
  return id;
}

/** `FEAT-101` -> `feat_101`: LikeC4 view names take no dashes. */
function viewName(featureId: string): string {
  return featureId.toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */

export function intentTemplate(featureId: string, title: string | undefined): string {
  const heading = title ?? featureId;
  // The frontmatter is SERIALIZED, never interpolated. A title is free text a
  // person types — `Checkout: split payments` used to be pasted straight after
  // `title: `, where the colon reopens the mapping and the file stops parsing;
  // `Orders #42 rework` lost everything from the `#` as a YAML comment, so the
  // feature quietly answered to a title nobody wrote. The yaml serializer is the
  // only thing that knows every case, and it is already how migrate-openspec
  // writes the same three keys.
  //
  // `owner` is deliberately NOT a key here. Scaffolding `owner:` writes an
  // explicit null, which is a claim ("this feature has no owner") rather than
  // the truth ("nobody has said yet") — and every reader then has to tell an
  // absent key from a null one. The prompt survives as a comment.
  const frontmatter = stringifyYaml(
    { feature: featureId, ...(title === undefined ? {} : { title }), status: "proposed" },
    { lineWidth: 0 },
  ).trimEnd();
  return `---
${frontmatter}
# owner: <the team or person who answers for this>
---

# ${heading}

## Why

<!-- The problem in business terms. This is what a reviewer reads first, and what
     the requirement deltas below have to be justified by. -->

## Scope

<!-- Which services this touches — and, more usefully, which it deliberately does not. -->
`;
}

export function deltaTemplate(featureId: string, touched: string[], created: string[]): string {
  const taken = new Set<string>();
  const touchedIds = touched.map((s) => [identifier(s, taken), s] as const);
  const createdIds = created.map((s) => [identifier(s, taken), s] as const);

  const lines: string[] = [];
  if (touchedIds.length > 0) {
    // Context elements ship COMMENTED OUT, exactly like the example edge below.
    // Declared-and-untagged is the one shape `delta.nothing-tagged` exists to
    // refuse (an author who forgot the tags), so writing these live made every
    // `loam new --touches X` fail its own validator on the very first run —
    // which teaches people that the validator is noise. Uncomment a line when an
    // edge below actually needs the identifier.
    lines.push("  // Services this feature touches, as context for the diagram. Uncomment the");
    lines.push("  // ones an edge below names, and reuse the identifiers from");
    lines.push("  // architecture/landscape.likec4 so the merge lines up. They stay UNTAGGED:");
    lines.push(`  // only #${featureId} is the change, and everything else here is context.`);
    for (const [id, name] of touchedIds) lines.push(`  // ${id} = softwareSystem '${name}'`);
    lines.push("");
  }
  if (createdIds.length > 0) {
    lines.push("  // Services this feature introduces. The tag is what `loam archive` folds");
    lines.push("  // into the living landscape.");
    for (const [id, name] of createdIds) {
      lines.push(`  ${id} = softwareSystem '${name}' {`);
      lines.push(`    #${featureId}`);
      // Interpolated from sentinels.ts, never spelled here: the placeholder
      // gate refuses this exact string at archive, and a second spelling is
      // how a template rewording silently retires the check that guards it.
      lines.push(`    description '${SERVICE_DESCRIPTION_SENTINEL}'`);
      lines.push("  }");
    }
    lines.push("");
  }

  // The example edge uses identifiers already declared above when there are two
  // to join; otherwise placeholders, so it never invents a service.
  const from = touchedIds[0]?.[0] ?? createdIds[0]?.[0] ?? "consumer";
  const to = createdIds[0]?.[0] ?? touchedIds[1]?.[0] ?? "provider";
  lines.push("  // New calls. `metadata { op }` is the spine: it names the OpenAPI operationId");
  lines.push("  // the call uses, and `loam validate` checks it against the target's contract.");
  lines.push("  // Uncomment and adjust (both endpoints have to be declared above):");
  lines.push("  //");
  lines.push(`  // ${from} -> ${to} 'Calls createSplit' {`);
  lines.push(`  //   #${featureId}`);
  lines.push("  //   metadata { op 'createSplit' }");
  lines.push("  // }");

  return `// ${featureId} — architecture delta.
//
// Everything tagged #${featureId} is exactly what \`loam archive\` folds into
// architecture/landscape.likec4. Everything else here is context for the diagram.
//
// If ${featureId} changes no architecture, DELETE this file: a requirements-only
// feature is complete without it, and an empty \`model {}\` is just as legal.

specification {
  element softwareSystem
  tag ${featureId}
}

model {
${lines.join("\n")}
}

views {
  view ${viewName(featureId)} {
    include *
  }
}
`;
}

/**
 * The business axis, scaffolded with its example INSIDE the comment — the same
 * mechanism as `archSpecTemplate` below, for the same reason: this template
 * used to ship a live `### Requirement: TODO — name the behaviour` that
 * parsed as a real requirement, validated clean, and archived a literal TODO
 * into the living spec at exit 0. The indented headings sit past the
 * line-anchored patterns core/document/parse.ts matches on, so the scaffold
 * declares nothing until a person copies the block out and writes over the
 * fill-ins — and `scaffold.placeholder` gates the archive if the fill-ins
 * survive the copy.
 *
 * No nested HTML comments: the `Operations:` guidance that used to be its own
 * comment lives in this one's prose, because an inner `-->` would end the
 * outer comment early and re-expose the example to the parser.
 */
export function specTemplate(featureId: string, service: string): string {
  return `# ${service} — requirement delta for ${featureId}

<!-- Sections: ADDED / MODIFIED / REMOVED. Delete the ones you do not need.
     A MODIFIED requirement carries its full new text, not a diff.
     Every requirement needs at least one scenario — \`loam validate\` gates on it.

     An \`Operations:\` body line names the operationIds the requirement
     governs. \`loam validate\` checks each one against the service's OpenAPI,
     and \`loam archive\` refuses to merge a requirement that governs an
     operation nobody defines — add the line once the contract exists.

     A \`Publishes:\` / \`Consumes:\` body line does the same for event messages:
     it names what the requirement puts on or takes off the bus, checked
     against the service's AsyncAPI contract. If ${featureId} changes that
     contract, hand-create specs/${service}/asyncapi.yaml — a complete
     AsyncAPI 3.0 document, messages declared under \`components.messages\`
     (loam scaffolds none: an event contract is genuinely optional) — and run
     \`loam rebase ${featureId}\` so every restated slot pins as a quote.

     Copy the block below out of this comment, unindent it, and replace the
     TODOs and every <angle-bracket> fill-in — \`loam archive\` refuses the
     scaffold's own wording (\`scaffold.placeholder\`):

    ## ADDED Requirements

    ### Requirement: ${REQUIREMENT_SENTINEL}
    Requirement-ID: ${featureId}.${service}.requirement

    The service SHALL ${SHALL_SENTINEL}.

    #### Scenario: ${SCENARIO_SENTINEL}
    - **Given** ${GIVEN_SENTINEL}
    - **When** ${WHEN_SENTINEL}
    - **Then** ${THEN_SENTINEL}
-->
`;
}

/**
 * The architecture axis, scaffolded EMPTY on purpose.
 *
 * Same grammar as spec.md, so the template body has to be unparseable as
 * requirements or the scaffold would ship a requirement nobody wrote — the
 * headings are therefore indented inside an HTML comment, which puts them past
 * the line-anchored `## ADDED Requirements` / `### Requirement:` patterns
 * core/document/parse.ts matches on. Copy the block out of the comment and unindent it.
 */
export function archSpecTemplate(featureId: string, service: string): string {
  return `# ${service} — architecture requirement delta for ${featureId}

<!-- The architecture axis: the obligations no business scenario was ever going
     to mention — the outbox, the retries, the timeouts, the alerts.

     \`Covers:\` is to an arch requirement what \`Operations:\` is to a business
     one — it names the MODEL OBJECTS the scenarios below exercise, so coverage
     is derived instead of trusted. Three forms, comma-separated:

       Covers: ${service}                 a C4 element — its id, or the service a
                                          bound/titled element stands for
       Covers: consumer -> ${service}     an edge, each side resolved the same way
       Covers: alert:<id>, sli:<id>       a signal declared in health.yaml

     Every tagged element and edge in delta.likec4 wants one (\`c4.uncovered\`).
     Delete this file if ${featureId} adds no architectural obligation.

     Copy the block below out of this comment and unindent it:

    ## ADDED Requirements

    ### Requirement: ${ARCH_REQUIREMENT_SENTINEL}
    Requirement-ID: ${featureId}.${service}.arch

    The service SHALL ${ARCH_SHALL_SENTINEL}.

    Covers: ${service}

    #### Scenario: ${SCENARIO_SENTINEL}
    - **Given** ${GIVEN_SENTINEL}
    - **When** ${WHEN_SENTINEL}
    - **Then** ${THEN_SENTINEL}
-->
`;
}

/**
 * The BUSINESS axis, scaffolded by `--capability`: a delta against the living
 * `capabilities/<id>/spec.md`.
 *
 * Same idiom as the two spec templates above and for the same reason — the
 * example lives INSIDE an HTML comment, indented past the line-anchored
 * `## ADDED Requirements` / `### Requirement:` patterns core/document/parse.ts
 * matches on — so the scaffold declares nothing until a person copies the block
 * out. That is what lets a freshly scaffolded feature validate clean while
 * still being refused by `loam archive` the moment the block is copied out and
 * left unedited (`scaffold.placeholder`, which reads
 * `features/<FEAT>/capabilities/` as well as `features/<FEAT>/specs/`).
 *
 * WHAT THE COMMENT TEACHES IS THE ALTITUDE, because that is the mistake this
 * document invites. A capability requirement is a promise a customer could
 * check; the four service-scoped lines (`Operations:`, `Covers:`, `Publishes:`,
 * `Consumes:`) and the axis's own two (`Capability:`, `Realizes:`) are all
 * ERRORS here — `capability.requirement-service-scoped` and
 * `capability.requirement-inert-join` — and every one of them parses, so an
 * author who is not told writes one and finds out at archive. `Requirement-ID:`
 * is spelled as mandatory for the same reason: a capability document outlives
 * every service that realizes it, so identity by heading is refused
 * (`capability.requirement-unidentified`).
 *
 * No nested HTML comments, exactly as `specTemplate` states: an inner `-->`
 * would end the outer comment early and re-expose the example to the parser.
 */
export function capabilityDeltaTemplate(featureId: string, capability: string): string {
  return `# ${capability} — capability delta for ${featureId}

<!-- The business axis. This is a DELTA against the living
     capabilities/${capability}/spec.md, not the document itself: sections are
     ADDED / MODIFIED / REMOVED, delete the ones you do not need, and a MODIFIED
     requirement carries its full new text rather than a diff. If the fleet has
     no capabilities/${capability}/spec.md yet, this feature's archive creates it.

     WHAT BELONGS HERE is a promise somebody outside the fleet could check —
     'a refund reaches the customer's card within five days'. What does NOT is
     the mechanism: \`Operations:\`, \`Covers:\`, \`Publishes:\` and \`Consumes:\`
     all resolve against ONE service's own contract or model, so a requirement
     carrying one is a service requirement filed at the wrong altitude and
     \`loam validate\` says so. \`Capability:\` and \`Realizes:\` are refused here
     too — they are the joins written on the SERVICE requirement that keeps this
     promise, one directory over in specs/<svc>/spec.md, as
     \`Realizes: ${capability}#<Requirement-ID>\`.

     \`Requirement-ID:\` is mandatory on every requirement below. A capability
     document outlives the services that realize it, so its requirements are
     addressed by a stable id rather than by their heading — rewording a heading
     would otherwise be a removal and an addition, and every \`Realizes:\` line
     pointed at it would break in silence.

     A MODIFIED or REMOVED requirement also needs a \`Based-On:\` pin quoting the
     living text it rewrites, so two features touching one capability collide
     loudly instead of overwriting each other. Run \`loam rebase ${featureId}\`
     and the pins are written for you.

     Copy the block below out of this comment, unindent it, and replace the TODO
     and every <angle-bracket> fill-in — \`loam archive\` refuses the scaffold's
     own wording (\`scaffold.placeholder\`):

    ## ADDED Requirements

    ### Requirement: ${CAPABILITY_REQUIREMENT_SENTINEL}
    Requirement-ID: ${idHint(capability)}

    The fleet SHALL ${CAPABILITY_SHALL_SENTINEL}.

    #### Scenario: ${SCENARIO_SENTINEL}
    - **Given** ${GIVEN_SENTINEL}
    - **When** ${WHEN_SENTINEL}
    - **Then** ${THEN_SENTINEL}
-->
`;
}

/**
 * A plausible `Requirement-ID:` for a capability, offered as a shape rather than
 * a name: `payments/refunds` -> `PAYMENTS-REFUNDS-1`.
 *
 * Deliberately NOT the feature id. A service requirement's scaffolded id is
 * `<FEAT>.<svc>.requirement` because that requirement is created by, and lives
 * and dies with, one feature; a capability requirement outlives every feature
 * that touches it, so an id carrying the id of the feature that happened to
 * introduce it is exactly the identity-by-accident this axis refuses. The
 * suffix is `-1` and not a count of anything: it is a placeholder digit inside
 * a placeholder id, and the author is being asked to name the promise.
 *
 * CHECKED AGAINST THE REAL GRAMMAR, never assumed to satisfy it. A capability id
 * may begin with a digit (`3ds`, `2fa`, `1099-filing` — `dirNameHazard` allows an
 * alphanumeric head) while `REQUIREMENT_ID_RE` demands a LETTER, so the obvious
 * slug hands the author `3DS-1` and `loam validate` then refuses it with
 * `delta.requirement-id-invalid` — the author refused for using the shape the
 * scaffold offered. Length is the same class of failure at 128 characters. The
 * fallback prefixes rather than truncates, because a truncated id is a plausible
 * name that means something else.
 */
function idHint(capability: string): string {
  const slug = capability.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const candidate = `${slug}-1`;
  if (REQUIREMENT_ID_RE.test(candidate)) return candidate;
  const prefixed = `CAP-${candidate}`;
  return REQUIREMENT_ID_RE.test(prefixed) ? prefixed : "CAP-1";
}

export function openapiTemplate(service: string): string {
  return `openapi: 3.1.0
info:
  title: ${service}
  version: "0.1"

# The operations this feature adds. \`operationId\` is the token the C4 edge
# (metadata { op }) and the requirement (Operations:) both point at — keep the
# three spellings identical or \`loam validate\` will say so.
paths: {}
#  /splits:
#    post:
#      operationId: createSplit
#      responses:
#        "201":
#          description: Created
`;
}
