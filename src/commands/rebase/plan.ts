/**
 * What each axis is missing a pin for, computed before anything is written.
 *
 * The requirement axis and the contract axis are planned by the same shape and
 * separately on purpose: a requirement is pinned by a `Based-On:` line inserted
 * by surgery, and an operation by an `x-loam-based-on` key the YAML writer
 * emits. Only the first has to preserve the author's sections and prose, which
 * is why it edits lines rather than reserializing.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { decodeDocument } from "../../core/kernel/document-bytes.js";
import { type PathableService } from "../../core/kernel/ids/service.js";
import { type SpecAxis } from "../../core/repo/paths.js";
import { livingCapabilityPaths } from "../../core/repo/authored/paths.js";
import { locateServicePaths } from "../../core/repo/service-target.js";
import { parseRequirements, readRequirementsDocument } from "../../core/document/parse.js";
import { requirementDigest, type Requirement } from "../../core/document/spec.js";
import { OpenapiMergeError } from "../../core/openapi/merge/error.js";
import { pinOpenapiOperations, type OpenapiPinPlan } from "../../core/openapi/merge/pin.js";
import { planOpenapiBaselines, type OpenapiBaselinePlan } from "../../core/openapi/baseline/plan.js";
import { AsyncapiMergeError } from "../../core/asyncapi/merge/error.js";
import { pinAsyncapiSlots, type AsyncapiPinPlan } from "../../core/asyncapi/merge/pin.js";
import { planAsyncapiBaselines, type AsyncapiBaselinePlan } from "../../core/asyncapi/baseline/plan.js";
import { applyEdits, pinEdit, type LineEdit } from "./edit.js";
import type { DocsDir } from "../../core/kernel/ids/dirs.js";
import type { FleetContext } from "../../core/fleet-context.js";

/**
 * How a planner reaches the living documents: the repo root plus the
 * command's shared read index. One record on purpose — `rebase` calls these
 * planners in a services × axes loop, and each `locateServicePaths` without
 * a context is a FULL fleet walk (readdir + a frontmatter read per service),
 * so a 20-service feature paid ~80 re-enumerations of a fleet that did not
 * change between them. The context makes that one walk per invocation.
 */
export interface RepoRead {
  docsDir: DocsDir;
  fleet?: FleetContext;
}

export type PinStatus =
  /** It had none and now has one. */
  | "pinned"
  /** It had a pin for an older living version; it now names the current one. */
  | "repinned"
  /** It already named the current living version — no write. */
  | "unchanged"
  /**
   * It addresses nothing living — a MODIFIED of a requirement another feature
   * in flight still introduces, or an operation this feature is adding. There
   * is no version to be based on, so inventing a pin would be inventing a
   * baseline; `loam validate` already reports the ordering where there is one
   * (`delta.modified-pending`).
   */
  | "unresolved"
  /**
   * The operation is written as a YAML alias. One shared value backs every use
   * of an anchor, so stamping "through" it would pin every other use too —
   * the same reason the merge refuses to edit aliases in place. Rare, legal,
   * and named rather than silently skipped.
   */
  | "unwritable";

/**
 * What happened to ONE pin, minus whose document it was in.
 *
 * Split from `PinOutcome` when the business corpus arrived: a capability delta
 * is pinned by the identical rule against an identical document, but it names
 * no service, and putting a capability id into a published field called
 * `service` would bend the `--json` contract into a lie. Everything a reader
 * acts on lives here; the two wrappers below add only the identity.
 */
export interface PinRecord {
  /** The axis's filename — "spec.md", "arch.spec.md", "openapi.yaml" or "asyncapi.yaml". */
  file: string;
  /**
   * MODIFIED/REMOVED for a requirement; the upper-case HTTP method for an
   * operation; COMPONENT for a `components/<kind>/<name>`; PATH-ITEM for a
   * path-item non-method key; the AsyncAPI section name (`channels`,
   * `operations`, `components.messages`) for an event slot.
   */
  kind: string;
  /** The requirement heading, `/path ('operationId')`, `<kind>/<name>`, `/path '<key>'`, or the asyncapi slot key. */
  target: string;
  status: PinStatus;
  /** The pin as it was, or null when there was none. */
  from: string | null;
  /** The pin as it now stands, or null when nothing living could be hashed. */
  to: string | null;
}

export interface PinOutcome extends PinRecord {
  service: string;
}

/** The same record on the business corpus, keyed by the promise instead of the service. */
export interface CapabilityPinOutcome extends PinRecord {
  capability: string;
}

export interface AxisPlan {
  outcomes: PinOutcome[];
  /** The rewritten document, or null when nothing about it changes. */
  content: string | null;
}

export interface CapabilityAxisPlan {
  outcomes: CapabilityPinOutcome[];
  content: string | null;
}

/** Pin every MODIFIED/REMOVED requirement in one delta file against one living document. */
export async function planAxis(
  repo: RepoRead,
  service: PathableService,
  axis: SpecAxis,
  specPath: string,
): Promise<AxisPlan> {
  const livingPath = (await locateServicePaths(repo.docsDir, service, repo.fleet))[axis.key];
  const planned = await planRequirementPins(specPath, livingPath, axis.file);
  return { outcomes: planned.pins.map((pin) => ({ service, ...pin })), content: planned.content };
}

/**
 * The same, for one capability delta against its living document.
 *
 * NOT OPTIONAL, and not symmetry for its own sake: `delta.baseline-missing` is
 * a warning that GATES archive, and its message ends "Run `loam rebase <FEAT>`
 * to pin it". A capability delta graded by that rule while `rebase` skipped the
 * axis would have loam send an author to a command that does not pin the file
 * loam just named — a refusal with no exit, which is the one thing a gating
 * message may never be.
 *
 * The living path resolves through `livingCapabilityPaths` for the reason that
 * function states: the id's nesting is spelled by directories, so an unsplit
 * join reads an empty living document and every pin comes out `unresolved`
 * over a promise the fleet already made.
 */
export async function planCapabilityAxis(
  repo: RepoRead,
  capability: string,
  specPath: string,
): Promise<CapabilityAxisPlan> {
  const planned = await planRequirementPins(specPath, livingCapabilityPaths(repo.docsDir, capability).spec, "spec.md");
  return { outcomes: planned.pins.map((pin) => ({ capability, ...pin })), content: planned.content };
}

/**
 * The pin rule itself: every MODIFIED/REMOVED requirement in one delta document,
 * against one living document. Whose documents they are is the caller's
 * business — this is the part that must not fork, because a second copy is a
 * second answer to "was this delta written against what is there now".
 */
async function planRequirementPins(
  specPath: string,
  livingPath: string,
  file: string,
): Promise<{ pins: PinRecord[]; content: string | null }> {
  // Both sides through the decoding read: the delta because line surgery over a
  // document loam mis-decoded would write bytes nobody authored, the living
  // because it is what every digest below is taken over.
  const raw = await readRequirementsDocument(specPath);
  const reqs = parseRequirements(raw);
  const living = existsSync(livingPath)
    ? parseRequirements(await readRequirementsDocument(livingPath))
    : [];

  const pins: PinRecord[] = [];
  const edits: LineEdit[] = [];
  for (const r of reqs) {
    if (r.kind !== "MODIFIED" && r.kind !== "REMOVED") continue;
    // Every requirement parsed from a document carries its heading line
    // (core/document/parse.ts). One built in memory has no document to write into, and
    // there is nothing truthful to report about pinning it.
    const line = r.line;
    if (line === undefined) continue;
    const base = { file, kind: r.kind, target: r.name };
    const selected = selectLiving(living, r);
    if (selected === undefined) {
      pins.push({ ...base, status: "unresolved", from: r.basedOn ?? null, to: null });
      continue;
    }
    const digest = requirementDigest(selected);
    if (r.basedOn === digest) {
      pins.push({ ...base, status: "unchanged", from: digest, to: digest });
      continue;
    }
    pins.push({
      ...base,
      status: r.basedOn === undefined ? "pinned" : "repinned",
      from: r.basedOn ?? null,
      to: digest,
    });
    edits.push(pinEdit(r, line, digest));
  }

  return { pins, content: edits.length === 0 ? null : applyEdits(raw, edits) };
}

/**
 * Pin every operation in one feature contract against the living contract.
 *
 * The pin is always `operationDigest` of the LIVING operation, never of the
 * delta's own. That single rule produces both merge verdicts on its own: an
 * operation the author only QUOTED is byte-equal to living, so its pin equals
 * its own content and the merge skips it; one the author EDITED differs from
 * its pin, so the merge writes it. Nothing here has to guess at intent — the
 * document already records it, and the pin makes it legible.
 *
 * Slot-keyed (path + method), exactly as the merge upserts. An operationId that
 * moved to another slot is a new slot with nothing living behind it, which is
 * `unresolved` and correct: there is no living version of an operation at a
 * path the contract does not serve yet.
 */
export async function planOpenapi(repo: RepoRead, service: PathableService, openapiPath: string): Promise<AxisPlan> {
  const livingPath = (await locateServicePaths(repo.docsDir, service, repo.fleet)).openapi;
  // Decoded, not `readFile(…, "utf8")`, for the requirement axes' reason: a
  // contract read with U+FFFD substituted in defines no operation loam can
  // match, so every pin would come out `unresolved` — "this feature adds them
  // all" — over a living contract that already serves them. Read outside the
  // try below, whose job is the merge's own diagnosis and not this one.
  const living = existsSync(livingPath) ? decodeDocument(await readFile(livingPath), livingPath) : "";
  const delta = decodeDocument(await readFile(openapiPath), openapiPath);
  let plan: OpenapiPinPlan;
  let baselines: OpenapiBaselinePlan;
  try {
    plan = pinOpenapiOperations(delta, living, service);
    // The surface record, planned over the OPERATION pass's output so one run
    // writes one file once. Order is safe: a surface digest never includes an
    // operation pin (`restatedSurfaces` skips the methods entirely), and the
    // root record never enters an operation digest.
    baselines = planOpenapiBaselines(plan.text ?? delta, living, service);
  } catch (err) {
    // A document loam cannot read is validate's diagnosis to make
    // (`openapi.invalid`), not this command's to guess at — and stamping into a
    // broken parse would write a file nobody asked for.
    if (!(err instanceof OpenapiMergeError)) throw err;
    return { outcomes: [], content: null };
  }
  return {
    outcomes: [
      ...plan.pins.map((pin) => ({
        service,
        file: "openapi.yaml",
        kind: pin.method.toUpperCase(),
        target: pin.operationId.length === 0 ? pin.path : `${pin.path} ('${pin.operationId}')`,
        status: pin.status,
        from: pin.from,
        to: pin.to,
      })),
      ...baselines.pins.map((pin) => ({
        service,
        file: "openapi.yaml",
        kind: pin.kind === "component" ? "COMPONENT" : "PATH-ITEM",
        target: pin.target,
        status: pin.status,
        from: pin.from,
        to: pin.to,
      })),
    ],
    content: baselines.text ?? plan.text,
  };
}

/**
 * Pin every slot AND every component surface in one feature event contract
 * against the living contract — `planOpenapi`'s mirror on the event axis, in
 * both of its halves.
 *
 * The in-value `x-loam-based-on` reaches every SLOT, because a slot value is
 * always a mapping (core/asyncapi/digest.ts owns the slot model; inline
 * channel messages are channel interior and never pinned on their own). It
 * reaches nothing else: a `components/schemas/<name>` value is a JSON Schema,
 * where an in-value loam key would be a schema keyword — so the surfaces are
 * pinned by the same root `x-loam-baselines` record the OpenAPI axis uses, and
 * this function writes both. (This comment used to say the event pin has no
 * root record. It did not, and that is why a `components.schemas`-only delta
 * merged nothing at all.)
 */
export async function planAsyncapi(
  repo: RepoRead,
  service: PathableService,
  asyncapiPath: string,
): Promise<AxisPlan> {
  const livingPath = (await locateServicePaths(repo.docsDir, service, repo.fleet)).asyncapi;
  // Decoded, not `readFile(…, "utf8")`, for planOpenapi's reason: a contract
  // read with U+FFFD substituted in defines no slot loam can match, so every
  // pin would come out `unresolved` over a living contract that already
  // carries them.
  const living = existsSync(livingPath) ? decodeDocument(await readFile(livingPath), livingPath) : "";
  const delta = decodeDocument(await readFile(asyncapiPath), asyncapiPath);
  let plan: AsyncapiPinPlan;
  let baselines: AsyncapiBaselinePlan;
  try {
    plan = pinAsyncapiSlots(delta, living, service);
    // The surface record, planned over the SLOT pass's output so one run
    // writes one file once. Order is safe, and load-bearing in both
    // directions: a surface digest never includes a slot pin (`asyncapiSurfaces`
    // skips `components.messages` entirely, and no other section is a
    // surface), and the root record never enters a slot digest.
    baselines = planAsyncapiBaselines(plan.text ?? delta, living, service);
  } catch (err) {
    // A document loam cannot read is validate's diagnosis to make
    // (`asyncapi.invalid`), not this command's to guess at — and stamping
    // into a broken parse would write a file nobody asked for.
    if (!(err instanceof AsyncapiMergeError)) throw err;
    return { outcomes: [], content: null };
  }
  return {
    outcomes: [
      ...plan.pins.map((pin) => ({
        service,
        file: "asyncapi.yaml",
        kind: pin.section,
        target: pin.key,
        status: pin.status,
        from: pin.from,
        to: pin.to,
      })),
      ...baselines.pins.map((pin) => ({
        service,
        file: "asyncapi.yaml",
        kind: "COMPONENT",
        target: pin.target,
        status: pin.status,
        from: pin.from,
        to: pin.to,
      })),
    ],
    content: baselines.text ?? plan.text,
  };
}

/**
 * The living requirement a delta requirement addresses — the merge's own
 * resolution order (core/document/apply.ts `applyRequirementDelta`), so a pin is taken
 * over exactly the requirement archive would rewrite: the stable ID when the
 * delta carries one, the exact heading otherwise, and the FIRST match either
 * way (duplicates are refused upstream by `delta.living-duplicate-requirement`).
 */
export function selectLiving(living: Requirement[], r: Requirement): Requirement | undefined {
  if (r.id !== undefined) return living.find((candidate) => candidate.id === r.id);
  return living.find((candidate) => candidate.name === r.name);
}

/* ------------------------------------------------------------------ */
/* Line surgery                                                        */
/* ------------------------------------------------------------------ */
