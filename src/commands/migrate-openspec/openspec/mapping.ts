/**
 * The mapping document on the way in: YAML a human edited, graded into an
 * `OpenSpecMapping` or refused with the line to fix.
 *
 * Split from `./decisions.ts`, which is the same document on the way out — the
 * blank skeleton, the normalized record written beside a migration, and the
 * routing query. Reading is where every refusal lives and writing is where none
 * do, so the two halves have almost no vocabulary in common beyond the type.
 */
import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { serviceIdProblem } from "../../../core/kernel/ids.js";
import { asRecord, dictionary } from "../../../core/kernel/records.js";
import { type OpenSpecMapping } from "../../../core/openspec-inventory.js";
import { message } from "../../../core/staging.js";
import { OpenSpecCommandError } from "./error.js";
import { decodeSource } from "./read.js";

/**
 * `Array.isArray` narrows an `unknown` to `any[]`, so the element check below it
 * proved nothing to tsc and the elements had to be asserted back to `string` at
 * the point of use. One predicate makes the narrowing carry the check.
 */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function stringList(value: unknown, label: string): string[] {
  if (typeof value === "string") return value.trim() === "" ? [] : [value.trim()];
  if (!isStringArray(value)) {
    throw new OpenSpecCommandError("invalid-option", `${label} must be a string or an array of service ids.`);
  }
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
}

/**
 * The service ids a mapping may name, checked against the ONE grammar.
 *
 * This used to carry its own copy of the rule — the same alphabet regex, the
 * `.`/`..` tests, the trailing dot and the Windows device names — which is how
 * the two spellings drifted apart to begin with: for a while migrate was the
 * STRICTER of the two, so the primary authoring path accepted ids a migration
 * refused. ids.ts owns the grammar now, so a mapping can only ever name a
 * `services/<id>/` the authoring commands can still address.
 *
 * The refusal keeps migrate's own shape — `OpenSpecCommandError` with
 * `invalid-option`, not an `Issue` — and `serviceIdProblem`'s label carries the
 * mapping key, so the message still points at the line of the YAML to edit.
 */
function serviceList(value: unknown, label: string): string[] {
  const services = stringList(value, label);
  for (const service of services) {
    const problem = serviceIdProblem(service, label);
    if (problem !== null) throw new OpenSpecCommandError("invalid-option", problem);
  }
  return services;
}

export async function readMapping(path: string): Promise<OpenSpecMapping> {
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (error) {
    throw new OpenSpecCommandError("unknown-target", `Cannot read OpenSpec mapping ${path}: ${message(error)}`);
  }
  // Decoded rather than assumed: a mapping saved as UTF-16 parses as YAML with
  // no capabilities block, and the refusal would name a missing decision
  // instead of the encoding that hid it.
  const raw = decodeSource(bytes, path, "OpenSpec mapping");
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (error) {
    throw new OpenSpecCommandError("invalid-option", `OpenSpec mapping ${path} is invalid YAML: ${message(error)}`);
  }
  const document = asRecord(parsed);
  if (document === null || document.version !== 1) {
    throw new OpenSpecCommandError("invalid-option", `OpenSpec mapping ${path} must be a YAML mapping with version: 1.`);
  }
  const sourceNode = asRecord(document.source);
  const source = sourceNode !== null
    && typeof sourceNode.root === "string"
    && typeof sourceNode.inventoryDigest === "string"
    ? { root: sourceNode.root, inventoryDigest: sourceNode.inventoryDigest }
    : null;
  const capabilitiesNode = asRecord(document.capabilities);
  if (capabilitiesNode === null) {
    throw new OpenSpecCommandError("invalid-option", `OpenSpec mapping ${path} must contain a capabilities mapping.`);
  }
  const capabilities = dictionary<OpenSpecMapping["capabilities"][string]>();
  for (const [capability, value] of Object.entries(capabilitiesNode)) {
    const record = asRecord(value);
    const services = serviceList(record?.services ?? value, `capabilities.${capability}.services`);
    const requirementServices = dictionary<string[]>();
    if (record?.requirementServices !== undefined) {
      const allocations = asRecord(record.requirementServices);
      if (allocations === null) {
        throw new OpenSpecCommandError(
          "invalid-option",
          `capabilities.${capability}.requirementServices must be a mapping.`,
        );
      }
      for (const [requirement, selected] of Object.entries(allocations)) {
        requirementServices[requirement] = serviceList(
          selected,
          `capabilities.${capability}.requirementServices.${requirement}`,
        );
      }
    }
    capabilities[capability] = { services, requirementServices };
  }

  const changesNode = asRecord(document.changes);
  if (changesNode === null) {
    throw new OpenSpecCommandError("invalid-option", `OpenSpec mapping ${path} must contain a changes mapping.`);
  }
  const changes = dictionary<OpenSpecMapping["changes"][string]>();
  for (const [change, value] of Object.entries(changesNode)) {
    const record = asRecord(value);
    if (record === null) {
      throw new OpenSpecCommandError(
        "invalid-option",
        `changes.${change} must be a mapping with explicit feature and title fields.`,
      );
    }
    const featureValue = record.feature;
    if (featureValue !== null && typeof featureValue !== "string") {
      throw new OpenSpecCommandError("invalid-option", `changes.${change}.feature must be a string or null.`);
    }
    if (typeof record.title !== "string") {
      throw new OpenSpecCommandError("invalid-option", `changes.${change}.title must be a string.`);
    }
    changes[change] = {
      feature: typeof featureValue === "string" && featureValue.trim() !== "" ? featureValue.trim() : null,
      title: record.title,
    };
  }

  const renames = dictionary<string>();
  if (document.renames !== undefined) {
    const renamesNode = asRecord(document.renames);
    if (renamesNode === null) {
      throw new OpenSpecCommandError("invalid-option", `OpenSpec mapping ${path} renames must be a mapping.`);
    }
    for (const [key, value] of Object.entries(renamesNode)) {
      const record = asRecord(value);
      const requirementId = record !== null && "requirementId" in record ? record.requirementId : value;
      // A freshly generated skeleton deliberately uses null: it remains a
      // needsIdentity decision rather than becoming a malformed mapping.
      if (requirementId === null || requirementId === "") continue;
      if (typeof requirementId !== "string") {
        throw new OpenSpecCommandError("invalid-option", `renames.${key}.requirementId must be a string or null.`);
      }
      renames[key] = requirementId.trim();
    }
  }
  // Recorded as written. Naming the disposition union here only meant asserting
  // an unreviewed string into it: `mapping.invalid-artifact-disposition` is what
  // actually grades this value, and it has to see what the human typed to be
  // able to name it back to them.
  const artifacts = dictionary<string>();
  if (document.artifacts !== undefined) {
    const artifactsNode = asRecord(document.artifacts);
    if (artifactsNode === null) {
      throw new OpenSpecCommandError("invalid-option", `OpenSpec mapping ${path} artifacts must be a mapping.`);
    }
    for (const [artifactPath, value] of Object.entries(artifactsNode)) {
      const record = asRecord(value);
      const disposition = record !== null && "disposition" in record ? record.disposition : value;
      if (disposition === null || disposition === "") continue;
      if (typeof disposition !== "string") {
        throw new OpenSpecCommandError("invalid-option", `artifacts.${artifactPath}.disposition must be a string or null.`);
      }
      artifacts[artifactPath] = disposition;
    }
  }
  return { source, capabilities, changes, renames, artifacts };
}
