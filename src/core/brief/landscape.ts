/**
 * The fleet-map half of the adoption brief: what `architecture/landscape.likec4`
 * already says about one service — its elements, its inbound and outbound
 * edges, the operations the fleet already calls on it — and the block the
 * service still owes the file when nothing in it resolves to the service yet.
 * Both halves exist to stop an agent inventing a parallel model: the fleet has
 * already drawn some of these boxes and edges, and a baseline has to attach to
 * them.
 */
import { existsSync } from "node:fs";
import { elementService, loadFile, serviceResolver, type Elem } from "../c4/likec4.js";
import { landscapePath } from "../repo/paths.js";
import { listServices } from "../repo/repo.js";
import type { BriefTarget } from "./targets.js";

/**
 * The LikeC4 identifier the fleet map's element for a service conventionally
 * carries: the directory name, camel-cased. It is a suggestion and nothing
 * more — `metadata { service '<id>' }` is what actually joins the element to
 * the directory — but a brief that hands over a concrete block gets followed,
 * and one that describes a block in prose gets improvised on.
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

/**
 * The block this service still owes `architecture/landscape.likec4`.
 *
 * `expects` is what the fleet ALREADY calls on the service — those edges exist
 * in the map today, so the example draws the outbound side as a comment rather
 * than telling an agent to duplicate an edge that is already there.
 */
function landscapeBlock(service: string, expects: string[], present: boolean): string {
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

/** The fleet map's own brief — assembled per service, because the block it owes names the service. */
export function landscapeArtifact(
  service: string,
  expects: string[],
  present: boolean,
): Omit<BriefTarget, "path" | "exists" | "action"> {
  return {
    artifact: "landscape.likec4",
    required: true,
    purpose:
      "the fleet map — until an element here resolves to this directory, the service is documented and invisible to every cross-service check",
    shape: [
      "This file is the WHOLE FLEET's, not this service's. Add to it; never rewrite it. Everything already in `model { ... }` belongs to the other services, and replacing the file destroys their map along with their edges.",
      `Add one top-level element for the service, bound to its directory: \`metadata { service '${service}' }\`. Until an element resolves to \`services/${service}/\`, \`loam validate --all\` reports \`landscape.service-unmodelled\` (error).`,
      "Bind rather than rename: a binding whose id names no directory is `landscape.binding-unknown` (error), and two elements binding the SAME directory is `landscape.binding-duplicate` (warn) — every element→service join then picks one of them arbitrarily.",
      "Draw every cross-service call as an edge carrying the operation it uses: `a -> b 'Calls createSplit' { metadata { op 'createSplit' } }`. The `op` must be an operationId the TARGET's openapi.yaml defines, or `spine.op-undefined` (error) — a broken contract between services.",
      "If the file does not exist yet, create it with a `specification { ... }` block declaring the kinds you use, then the `model { ... }` block. A landscape that does not parse is `landscape.invalid` (error) and blinds every cross-service check at once.",
    ],
    example: landscapeBlock(service, expects, present),
  };
}

/* ------------------------------------------------------------------ */
/* What the fleet already says about this service                      */
/* ------------------------------------------------------------------ */

export interface LandscapeElement {
  id: string;
  title: string;
  kind: string;
  tags: string[];
  /** True when the element binds explicitly with `metadata { service }`. */
  bound: boolean;
}

export interface LandscapeEdge {
  from?: string;
  to?: string;
  op: string | null;
  title: string | null;
}

export interface LandscapeContext {
  present: boolean;
  /** False when the landscape exists but does not parse. */
  parses: boolean;
  /** Whether any element resolves to this service — null when nothing could be read. */
  modelled: boolean | null;
  elements: LandscapeElement[];
  inbound: LandscapeEdge[];
  outbound: LandscapeEdge[];
  /** Operations other services already call on this one: the contract owes them. */
  expects: string[];
  /**
   * The write this service still owes the fleet map, in prose — null once an
   * element resolves to it.
   *
   * It duplicates the `landscape.likec4` target's shape rules on purpose: an
   * agent driving off `--json` reads `landscape` to learn what the fleet
   * already says, and every `targets[]` consumer walks the artifact list. Only
   * one of those two readers used to exist, so `adopt` briefed eight files and
   * never once said the ninth thing — that a documented service nobody drew is
   * invisible to the whole cross-service layer.
   */
  instruction: string | null;
}

/**
 * The service ids the resolver may fall back on when an element carries no
 * `metadata { service }` binding — the same positive evidence `validate` and
 * `list` hand it. A docs repo that cannot be enumerated (no `services/` yet:
 * `adopt` runs there) leaves the resolver with bindings alone, which is what it
 * had before.
 */
async function knownServices(docsDir: string): Promise<ReadonlySet<string>> {
  try {
    return new Set((await listServices(docsDir)).map((s) => s.id));
  } catch {
    return new Set();
  }
}

/**
 * What the living landscape already says about this service.
 *
 * This is the half of the brief that stops an agent inventing a parallel model:
 * the fleet has already drawn some of these boxes and edges, and the baseline has
 * to attach to them. A landscape that does not parse yields `modelled: null` —
 * "nothing models it" would be a claim about a document nobody could read.
 */
export async function landscapeContext(docsDir: string, service: string): Promise<LandscapeContext> {
  const path = landscapePath(docsDir);
  const empty: LandscapeContext = {
    present: existsSync(path),
    parses: false,
    modelled: null,
    elements: [],
    inbound: [],
    outbound: [],
    expects: [],
    instruction: null,
  };
  if (!empty.present)
    return { ...empty, modelled: false, instruction: instructionFor(service, "absent", []) };

  const land = await loadFile(path);
  if (land.errors.length > 0)
    return { ...empty, instruction: instructionFor(service, "unparseable", []) };

  const mine = (e: Elem): boolean => elementService(e) === service;
  const elements: LandscapeElement[] = land.elements.filter(mine).map((e) => ({
    id: e.id,
    title: e.title,
    kind: e.kind,
    tags: e.tags,
    bound: e.service !== undefined,
  }));

  // One resolver for the whole scan, built with the real service ids: an edge
  // drawn into a modelled container (`paymentService.api`) is an edge into the
  // service, and `expects` — which now decides whether this service owes an
  // OpenAPI contract at all — has to see it. Building it once also stops the
  // per-edge rebuild the old `serviceOf(land.elements, id)` call did.
  const svcOf = serviceResolver(land.elements, await knownServices(docsDir));
  const inbound: LandscapeEdge[] = [];
  const outbound: LandscapeEdge[] = [];
  for (const r of land.relationships) {
    const edge = { op: r.op ?? null, title: r.title ?? null };
    if (svcOf(r.target) === service) inbound.push({ from: svcOf(r.source), ...edge });
    else if (svcOf(r.source) === service) outbound.push({ to: svcOf(r.target), ...edge });
  }

  const expects = [...new Set(inbound.map((e) => e.op).filter((op): op is string => op !== null))];
  return {
    present: true,
    parses: true,
    modelled: elements.length > 0,
    elements,
    inbound,
    outbound,
    expects,
    instruction:
      elements.length > 0 ? null : instructionFor(service, "unmodelled", expects),
  };
}

/**
 * The fleet-map instruction, in the three states a landscape can be in.
 *
 * It says the file, the block, and the consequence, in that order. The
 * consequence is the part agents acted on: "add an element" reads as tidiness,
 * "until you do, `loam validate --all` fails and no cross-service check can see
 * this service" reads as work.
 */
function instructionFor(
  service: string,
  state: "absent" | "unparseable" | "unmodelled",
  expects: string[],
): string {
  const id = elementIdFor(service);
  const bind = `an element bound with \`metadata { service '${service}' }\``;
  const consequence =
    `Until one resolves, \`loam validate --all\` reports \`landscape.service-unmodelled\` (error) for ` +
    `services/${service}/: the service is documented and invisible — no edge into it can be checked ` +
    `against its openapi.yaml, and no feature can draw a call to it.`;
  // `expects` is reachable only through elements that already resolve to this
  // service, so it is empty in every state that produces an instruction. It is
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
  return (
    `Nothing in architecture/landscape.likec4 resolves to services/${service}/. ADD to that file — do not rewrite ` +
    `it, every other service's map is in there — ${bind}, conventionally ` +
    `\`${id} = softwareSystem '${service}'\`, inside the existing \`model { ... }\` block, and draw each ` +
    `cross-service call as an edge carrying \`metadata { op '<operationId>' }\`. ${consequence}${owed}`
  );
}
