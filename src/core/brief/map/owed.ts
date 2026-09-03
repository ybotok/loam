/**
 * The write one service still owes `architecture/landscape.likec4`: the
 * target the brief hands over (`landscapeArtifact` — its shape rules and the
 * example block or edges) and the instruction in prose (`instructionFor` —
 * the file, the block, and the consequence, in the four states a landscape
 * can be in). Both exist to stop an agent inventing a parallel model: the
 * fleet has already drawn some of these boxes and edges, and a baseline has to
 * attach.
 *
 * A sub-package of `core/brief/` because that package sits at its five-file
 * cap and `landscape.ts` — which READS what the map already says about the
 * service and decides which state it is in — had parked at the file ceiling
 * with its object literals collapsed onto single lines to fit. The two halves
 * are distinct subjects: one is a derivation over a parsed document, the other
 * is all of the prose. The only tie back to the parent is `import type
 * { BriefTarget }`, which `verbatimModuleSyntax` erases, so this package
 * value-imports nothing from `../` and the package graph stays acyclic.
 */
import { spellCall, edgeTemplates, type AttestedCall } from "../../c4/resolve/attested.js";
import type { BriefTarget } from "../targets.js";

/**
 * The LikeC4 identifier the fleet map's element for a service conventionally
 * carries: the directory name, camel-cased. A suggestion and nothing more —
 * `metadata { service '<id>' }` is what joins the element to the directory —
 * but a brief handing over a concrete block gets followed, and one describing
 * a block in prose gets improvised on.
 */
function elementIdFor(service: string): string {
  const parts = service.split(/[^A-Za-z0-9]+/).filter((p) => p !== "");
  if (parts.length === 0) return "service";
  const head = parts[0]!.toLowerCase();
  const tail = parts.slice(1).map((p) => p[0]!.toUpperCase() + p.slice(1).toLowerCase());
  const id = head + tail.join("");
  // LikeC4 identifiers cannot open with a digit; a service id can.
  return /^[0-9]/.test(id) ? `svc${id[0]!.toUpperCase()}${id.slice(1)}` : id;
}

/* ------------------------------------------------------------------ */
/* The target                                                          */
/* ------------------------------------------------------------------ */

/** What `landscapeArtifact` needs — one record, because the fields only ever travel together. */
export interface LandscapeArtifactRequest {
  service: string;
  expects: string[];
  present: boolean;
  servicePath: string;
  /** The element that already resolves to the service — set only in the edgeless state — and the calls its model attests. */
  elementId?: string;
  attested: AttestedCall[];
}

/**
 * The write this service still owes `architecture/landscape.likec4`.
 *
 * `expects` is what the fleet ALREADY calls on the service — those edges exist
 * in the map today, so the example draws the outbound side as a comment rather
 * than telling an agent to duplicate an edge that is already there. With
 * `elementId` set the example is EDGES ONLY, on the element that exists: a
 * block here would be the second box the edgeless state exists to refuse, and
 * the attested calls are listed as comments the agent turns into edges by
 * naming the other party as the map spells it.
 */
function landscapeBlock(req: LandscapeArtifactRequest): string {
  const { service, expects, present } = req;
  if (req.elementId !== undefined) {
    const id = req.elementId;
    return [
      "model {",
      `  // ... every element stays exactly as it is — ${id} already resolves to ${req.servicePath}/ ...`,
      "",
      "  // every call in or out of it, one edge each, on the existing element:",
      `  //   ${id} -> <callee> 'Calls <operationId>' { metadata { op '<operationId>' } }`,
      `  //   <caller> -> ${id} 'Calls <operationId>' { metadata { op '<operationId>' } }`,
      ...(req.attested.length > 0
        ? [
            `  // the calls ${req.servicePath}/model.likec4 already attests, as the model spells the other party:`,
            ...req.attested.map((c) => `  //   ${id} ${spellCall(c)}`),
          ]
        : []),
      "}",
    ].join("\n");
  }
  const id = elementIdFor(service);
  const calls =
    expects.length > 0
      ? expects.map((op) => `//   <caller> -> ${id} 'Calls ${op}' { metadata { op '${op}' } }`)
      : [`//   <caller> -> ${id} 'Calls <operationId>' { metadata { op '<operationId>' } }`];
  const model = [
    "model {",
    ...(present ? ["  // ... the fleet's other services stay exactly as they are ...", ""] : []),
    `  ${id} = softwareSystem '${service}' {`,
    "    description '<one line: what this service is responsible for>'",
    `    metadata { service '${service}' }`,
    "  }",
    "",
    "  // every call in or out of it, one edge each:",
    ...calls.map((line) => `  ${line}`),
    "}",
  ];
  // When the file does not exist the example is the WHOLE file, so it carries
  // the `specification` block a bare `model` would be rejected without: the
  // brief must never hand over a document `loam validate` refuses. When the file
  // does exist the example is a fragment to splice, and repeating a
  // `specification` block there would invite a second one.
  return present
    ? model.join("\n")
    : ["specification {", "  element softwareSystem", "}", "", ...model].join("\n");
}

const OP_EDGE_RULE =
  "Draw every cross-service call as an edge carrying the operation it uses: `a -> b 'Calls createSplit' { metadata { op 'createSplit' } }`. The `op` must be an operationId the TARGET's openapi.yaml defines, or `spine.op-undefined` (error) — a broken contract between services.";

/** The fleet map's own brief — assembled per service, because the write it owes names the service. */
export function landscapeArtifact(req: LandscapeArtifactRequest): Omit<BriefTarget, "path" | "exists" | "action"> {
  const { service, servicePath, elementId } = req;
  const whole =
    "This file is the WHOLE FLEET's, not this service's. Add to it; never rewrite it. Everything already in `model { ... }` belongs to the other services, and replacing the file destroys their map along with their edges.";
  return {
    artifact: "landscape.likec4",
    required: true,
    purpose: `the fleet map — ${
      elementId === undefined
        ? "until an element here resolves to this directory, the service is documented"
        : "an element here resolves to this directory and no edge touches it, so the service is drawn"
    } and invisible to every cross-service check`,
    shape:
      elementId === undefined
        ? [
            whole,
            `Add one top-level element for the service, bound to its directory: \`metadata { service '${service}' }\`. Until an element resolves to \`${servicePath}/\`, \`loam validate --all\` reports \`landscape.service-unmodelled\` (error).`,
            "Bind rather than rename: a binding whose id names no directory is `landscape.binding-unknown` (error), and two elements binding the SAME directory is `landscape.binding-duplicate` (warn) — every element→service join then picks one of them arbitrarily.",
            OP_EDGE_RULE,
            "If the file does not exist yet, create it with a `specification { ... }` block declaring the kinds you use, then the `model { ... }` block. A landscape that does not parse is `landscape.invalid` (error) and blinds every cross-service check at once.",
          ]
        : [
            whole,
            `An element already resolves to \`${servicePath}/\` (\`${elementId}\`). Do NOT add a second one — two elements resolving to one directory is \`landscape.binding-duplicate\` (warn) and every element→service join then picks one of them arbitrarily. What the map lacks is every call in or out of it.`,
            OP_EDGE_RULE,
            `\`loam validate --all\` reports \`landscape.service-isolated\` (warn) while this element has no edge and \`${servicePath}/model.likec4\` declares a call across its boundary; with no such call it stays silent, so an edgeless service that truly calls nothing is correct, and this brief says so.`,
          ],
    example: landscapeBlock(req),
  };
}

/* ------------------------------------------------------------------ */
/* The instruction                                                     */
/* ------------------------------------------------------------------ */

/** The inputs of `instructionFor` — a record, because the function sat at the parameter cap. */
export interface InstructionRequest {
  service: string;
  state: "absent" | "unparseable" | "unmodelled" | "edgeless";
  expects: string[];
  servicePath: string;
  /** The element that already resolves to the service (edgeless state only), and its tags loam does not read. */
  elementId?: string;
  attested: AttestedCall[];
  foreignTags: string[];
}

/**
 * The fleet-map instruction, in the four states a landscape can be in. It says
 * the file, the block, and the consequence, in that order. The consequence is
 * the part agents acted on: "add an element" reads as tidiness, "until you do,
 * `loam validate --all` fails and no cross-service check can see this service"
 * reads as work.
 */
export function instructionFor(req: InstructionRequest): string {
  const { service, state, expects, servicePath } = req;
  const id = elementIdFor(service);
  const bind = `an element bound with \`metadata { service '${service}' }\``;
  const consequence =
    `Until one resolves, \`loam validate --all\` reports \`landscape.service-unmodelled\` (error) for ` +
    `${servicePath}/: the service is documented and invisible — no edge into it can be checked ` +
    `against its openapi.yaml, and no feature can draw a call to it.`;
  // `expects` is reachable only through inbound edges, so it is empty in every
  // state that produces an instruction — the edgeless one by definition. It is
  // threaded through anyway rather than dropped: the caller computes it once,
  // and the day an unmodelled service can inherit an edge (a container-level
  // binding, say) the sentence is already here instead of being noticed missing.
  const owed =
    expects.length > 0
      ? ` The fleet already calls ${expects.map((o) => `'${o}'`).join(", ")} on this service, so those edges exist; your element is what they will resolve to.`
      : "";

  if (state === "absent") {
    return (
      `architecture/landscape.likec4 does not exist yet. Create it with a \`specification { ... }\` block ` +
      `declaring the kinds you use and a \`model { ... }\` block containing ${bind} ` +
      `(conventionally \`${id} = softwareSystem '${service}'\`), plus one edge per cross-service call, each ` +
      `carrying \`metadata { op '<operationId>' }\`. ${consequence}${owed}`
    );
  }
  if (state === "unparseable") {
    return (
      `architecture/landscape.likec4 exists but does not parse (\`landscape.invalid\`), so nothing can be said ` +
      `about what it already models. Fix the parse errors first — they blind every cross-service check at once — ` +
      `then make sure it holds ${bind}. ${consequence}`
    );
  }
  if (state === "edgeless") return edgelessInstruction(req);
  return (
    `Nothing in architecture/landscape.likec4 resolves to ${servicePath}/. ADD to that file — do not rewrite ` +
    `it, every other service's map is in there — ${bind}, conventionally ` +
    `\`${id} = softwareSystem '${service}'\`, inside the existing \`model { ... }\` block, and draw each ` +
    `cross-service call as an edge carrying \`metadata { op '<operationId>' }\`. ${consequence}${owed}`
  );
}

/**
 * The fourth state, in two arms: with attested calls it names each and says to
 * carry it up as ONE edge on the existing element; without, it points at the
 * walk stops that produce the evidence and otherwise says draw NOTHING — an
 * invented edge is a dependency the fleet then plans against. Neither arm asks
 * for a second element, and both name the tags loam does not read.
 */
function edgelessInstruction(req: InstructionRequest): string {
  const { servicePath, attested, foreignTags } = req;
  const id = req.elementId ?? elementIdFor(req.service);
  const opening =
    `\`${id}\` in architecture/landscape.likec4 resolves to ${servicePath}/ and no edge in the map touches it — ` +
    `the service is drawn and invisible to every cross-service check.`;
  const tags =
    foreignTags.length === 0
      ? ""
      : ` The element carries ${foreignTags.map((t) => `#${t}`).join(", ")} — tags loam does not read; if one marks a ` +
        `placeholder drawn ahead of adoption, clearing it is part of this edit, because a view written ` +
        `\`exclude element.tag = #<that>\` keeps an adopted service hidden.`;
  if (attested.length > 0) {
    // The edge form follows the calls' direction (`edgeTemplates`): this arm
    // used to spell the outbound form alone, so an inbound call was carried
    // up backwards.
    const forms = edgeTemplates(id, attested)
      .map((t) => `\`${t}\``)
      .join(" or ");
    return (
      `${opening} ${servicePath}/model.likec4 already declares ${attested.length} call(s) across its boundary: ` +
      `${attested.map(spellCall).join(", ")}. Carry each one up as ONE edge on \`${id}\`, collapsed to the ` +
      `service — ${forms} for a call, \`publishes\`/\`consumes\` ` +
      `for an event — naming the other party as the map already spells it; where the model's word names a ` +
      `different thing in the map, say so in the hand-back instead of drawing it. Do not add a second element: ` +
      `one already resolves. \`loam validate --all\` reports \`landscape.service-isolated\` (warn) until an edge lands.${tags}`
    );
  }
  return (
    `${opening} Nothing in ${servicePath}/model.likec4 attests a call across its boundary — absent, unparseable ` +
    `and internal-only read alike here, because this brief may only name calls already attested. Draw the ones ` +
    `the walk's outbound and message stops (stops 4 and 7) find, each as one edge on \`${id}\` carrying ` +
    `\`metadata { op '<operationId>' }\` for a call or \`publishes\`/\`consumes\` for an event; if the service ` +
    `genuinely makes and receives no call, draw NOTHING — an invented edge is a dependency the fleet then plans ` +
    `against, and an edgeless element that is TRUE is a fact. Do not add a second element: one already resolves. ` +
    `Nothing in \`loam validate --all\` names this state while the model attests no call; this brief is the only ` +
    `place it is said.${tags}`
  );
}
