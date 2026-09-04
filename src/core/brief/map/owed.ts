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
 * are distinct subjects: one is the derivation over a parsed document, the
 * other is all of the prose plus the vocabulary that prose reads (`BrokenMap`
 * and its builder live here for that reason — beside the arm that spends them,
 * not in the caller that fills them). The only tie back to the parent is
 * `import type { BriefTarget }`, which `verbatimModuleSyntax` erases, so this
 * package value-imports nothing from `../` and the package graph stays acyclic.
 */
import { relative } from "node:path";
import type { LikeC4Error } from "../../c4/likec4.js";
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
  /**
   * Whether that element carries `#external`. It changes what the brief may
   * PROMISE and nothing else: `landscape.service-isolated` removes every
   * `#external` element from its subject set, so on such a tree no warning holds
   * the agent accountable, and saying one will is the false promise this flag
   * exists to stop (verification 2026-09-04).
   */
  external?: boolean;
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

/** What the edgeless state costs when a check is watching — the ordinary case. */
const ISOLATED_RULE = (servicePath: string): string =>
  `\`loam validate --all\` reports \`landscape.service-isolated\` (warn) while this element has no edge and ` +
  `\`${servicePath}/model.likec4\` declares a call across its boundary; with no such call it stays silent, so ` +
  `an edgeless service that truly calls nothing is correct, and this brief says so.`;

/**
 * The same state under `#external`, where NO check is watching.
 *
 * `landscape.service-isolated` removes every `#external` element from its
 * subject set — the fix that stopped a foreign box answering for one of our
 * directories — so on this tree the warning the brief used to promise cannot
 * fire, measured: `validate --all` reports `landscape.matched` and the full
 * `--json` findings walk holds no isolation finding at all. A brief that names
 * a warning nothing will raise is worse than one that says nothing, because the
 * agent budgets against the check instead of against the sentence.
 */
const EXTERNAL_RULE = (elementId: string, servicePath: string): string =>
  `\`${elementId}\` carries \`#external\`, so \`landscape.service-isolated\` will NOT fire here whatever this ` +
  `element's edges are — the check skips every element the map marks as somebody else's, exactly as the two ` +
  `binding checks do. Nothing in \`loam validate --all\` names this state; this brief is the only place it is ` +
  `said. If \`${servicePath}/\` is ours, drop \`#external\` from the element and the check applies again; if it ` +
  `is genuinely somebody else's, the calls belong on the element of the service that makes them.`;

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
            req.external === true ? EXTERNAL_RULE(elementId, servicePath) : ISOLATED_RULE(servicePath),
          ],
    example: landscapeBlock(req),
  };
}

/* ------------------------------------------------------------------ */
/* The instruction                                                     */
/* ------------------------------------------------------------------ */

/** Which documents of `architecture/` failed, and how many errors they carry between them. */
export interface BrokenMap {
  /** Docs-relative POSIX paths, deduped and sorted — spelled as `landscape.invalid` spells them. */
  paths: string[];
  errors: number;
}

/**
 * That record, built from a project's diagnostics — beside the type it fills and
 * the arm that reads it, rather than in the caller.
 *
 * Spelled exactly as `commands/validate/fleet/landscape.ts` spells it for
 * `landscape.invalid` — deduped, relative to the docs root, `/`-joined — because
 * the two surfaces are read one after the other on the same tree and an agent
 * has to be able to tell that they name the same file.
 */
export function brokenDocuments(docsDir: string, land: { errors: readonly LikeC4Error[] }): BrokenMap {
  const paths = [...new Set(land.errors.map((e) => e.sourceFsPath).filter((p): p is string => p !== undefined))]
    .map((abs) => relative(docsDir, abs).split(/[\\/]/).join("/"))
    .sort();
  return { paths, errors: land.errors.length };
}

/** The inputs of `instructionFor` — a record, because the function sat at the parameter cap. */
export interface InstructionRequest {
  service: string;
  state: "absent" | "unparseable" | "unmodelled" | "edgeless";
  expects: string[];
  servicePath: string;
  /**
   * The documents that failed (`unparseable` state only). Optional so the other
   * three arms need not carry it, and the arm degrades to naming the project
   * rather than guessing a file when a caller has none.
   */
  broken?: BrokenMap;
  /** The element that already resolves to the service (edgeless state only), and its tags loam does not read. */
  elementId?: string;
  /** Whether that element carries `#external` — see `LandscapeArtifactRequest.external`. */
  external?: boolean;
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
  // state that ASKS for an element — the edgeless one by definition. (The
  // unparseable state can carry it, off the landscape-file fallback, and that
  // arm deliberately does not append this sentence: it asks for no element, so
  // "your element is what they will resolve to" would name one loam has not
  // read.) It is threaded through anyway rather than dropped: the caller
  // computes it once, and the day an unmodelled service can inherit an edge (a
  // container-level binding, say) the sentence is already here.
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
    // The map is the whole `architecture/` project, so the document that broke
    // is usually a SIBLING of the landscape — a use case, a palette. This arm
    // named `architecture/landscape.likec4` regardless and told an agent to go
    // and fix parse errors in a file that has none, contradicting the
    // `landscape.invalid` that `validate --all` prints on the same tree one
    // second later. The EDGELESS arm below carries the same rule in its own WHY:
    // never name bytes loam did not read.
    const b = req.broken;
    const named =
      b === undefined || b.paths.length === 0
        ? "The fleet map (architecture/) does not parse"
        : `${b.paths.join(", ")} ${b.paths.length === 1 ? "does" : "do"} not parse (${String(b.errors)} error(s)` +
          `${b.paths.length === 1 ? "" : " between them"}), so the fleet map (architecture/) cannot be read`;
    return (
      `${named} (\`landscape.invalid\`). Nothing can be said about what the map already models — not that it ` +
      `lacks an element for ${servicePath}/, and not that it holds one — so this brief asks for no edit to it. ` +
      `Fix the parse errors first (they blind every cross-service check at once, and \`loam validate --all\` ` +
      `names the same file), then re-run \`loam adopt --service ${service}\`: it will say whether the map already ` +
      `holds ${bind}, and adding one before then risks a second box for a service the map already draws ` +
      `(\`landscape.binding-duplicate\`).`
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
/**
 * Which sentence the attested arm may end on: what will hold the agent to this
 * edit, or the admission that nothing will.
 *
 * `landscape.service-isolated` skips every `#external` element, so on such a
 * tree the promise "reports it until an edge lands" is one the check cannot
 * keep — and the brief was making it on exactly the tree that fix was written
 * for (verification 2026-09-04). The `#external` arm says so instead, and says
 * how to make the check apply.
 */
function accountability(req: InstructionRequest, id: string): string {
  if (req.external === true) {
    return (
      `\`${id}\` carries \`#external\`, so \`landscape.service-isolated\` will NOT fire here whatever you draw — ` +
      `the check skips every element the map marks as somebody else's. Nothing in \`loam validate --all\` names ` +
      `this state; this brief is the only place it is said. Drop \`#external\` from the element if ` +
      `${req.servicePath}/ is ours, and the check applies again.`
    );
  }
  return (
    "`loam validate --all` reports `landscape.service-isolated` (warn) until an edge lands — ONE edge, on any " +
    "of them: the check is touched/untouched, not a set difference, so nothing will name the calls you leave " +
    "undrawn."
  );
}

function edgelessInstruction(req: InstructionRequest): string {
  const { servicePath, attested, foreignTags } = req;
  const id = req.elementId ?? elementIdFor(req.service);
  // "the fleet map (architecture/)" rather than the landscape FILE: the map is
  // the whole project, an element may be declared in any document of it, and
  // LikeC4 hands back no source document for an element — so naming a file
  // here would be a claim about bytes loam did not read. The write still lands
  // in `architecture/landscape.likec4`; the target's `path` says so.
  const opening =
    `\`${id}\` in the fleet map (architecture/) resolves to ${servicePath}/ and no edge in the map touches it — ` +
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
      `one already resolves. ${accountability(req, id)} Carry all of them up now, or say in the hand-back which ` +
      `you did not and why.${tags}`
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
