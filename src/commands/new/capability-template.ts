/**
 * The capability delta `loam new --capability` scaffolds, and the id shape it
 * offers.
 *
 * Split out of `./templates.ts` along the document-kind seam: the other five
 * templates scaffold a feature's own files and one service's deltas, while this
 * one is a delta against a fleet-level business document with its own altitude
 * rules and its own id grammar (`REQUIREMENT_ID_RE`, which nothing else here
 * reads). The sentinels stay single-sourced in `core/coherence/authoring/
 * sentinels.ts`, so the move changes no string the placeholder gate matches on.
 */
import { REQUIREMENT_ID_RE } from "../../core/document/spec.js";
import {
  CAPABILITY_REQUIREMENT_SENTINEL,
  CAPABILITY_SHALL_SENTINEL,
  GIVEN_SENTINEL,
  SCENARIO_SENTINEL,
  THEN_SENTINEL,
  WHEN_SENTINEL,
} from "../../core/coherence/authoring/sentinels.js";

/**
 * The BUSINESS axis, scaffolded by `--capability`: a delta against the living
 * `capabilities/<id>/spec.md`.
 *
 * Same idiom as the two spec templates in `./templates.ts`, for the same reason — the
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
 * No nested HTML comments, exactly as `specTemplate` (`./templates.ts`) states: an inner `-->`
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
