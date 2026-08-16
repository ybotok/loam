/**
 * Where the workspace is, how its paths are spelled, and the record every
 * reader of it carries.
 *
 * `Ingest` exists because the five readers below it all need the same four
 * things — the root, the mapping being checked, and the two lists they append
 * findings to — and none of them may take four parameters plus its own. It is
 * the read in progress, so the accumulators live in it: a scan that returned
 * its findings instead would have to merge five arrays whose ORDER is what the
 * `--json` contract pins.
 */
import { existsSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { type OpenSpecMapping } from "../model/mapping.js";
import { type OpenSpecRenamedUsage, type OpenSpecUnsupportedShape, OpenSpecRootError } from "../model/model.js";
import { isDirectory, isSymbolicLink } from "./walk.js";

/** The one read of one OpenSpec workspace, in progress. */
export interface Ingest {
  /** The canonical `openspec/` directory every path below is spelled relative to. */
  root: string;
  /** The mapping being graded against this workspace; empty when auditing. */
  mapping: OpenSpecMapping;
  /** Every RENAMED pair seen, resolved later against the living source. */
  renamed: OpenSpecRenamedUsage[];
  /** Shapes that block migration. Archive-scope findings go to their own list. */
  unsupported: OpenSpecUnsupportedShape[];
}

export async function looksLikeOpenSpec(path: string): Promise<boolean> {
  return existsSync(join(path, "config.yaml"))
    || existsSync(join(path, "project.md"))
    || existsSync(join(path, ".openspec.yaml"))
    || await isDirectory(join(path, "specs"))
    || await isDirectory(join(path, "changes"));
}

export async function locateOpenSpecRoot(
  input: string,
): Promise<{ inputRoot: string; root: string; kind: "project" | "store" | "openspec-root" }> {
  const requestedRoot = resolve(input);
  if (!await isDirectory(requestedRoot)) {
    throw new OpenSpecRootError(`OpenSpec root is missing or is not a directory: ${requestedRoot}`);
  }
  const inputRoot = await realpath(requestedRoot);
  const nested = join(inputRoot, "openspec");
  const storeMarker = join(inputRoot, ".openspec-store", "store.yaml");
  const hasNestedShape = await looksLikeOpenSpec(nested);
  const hasDirectShape = await looksLikeOpenSpec(inputRoot);
  if (hasNestedShape && hasDirectShape) {
    throw new OpenSpecRootError(
      `Ambiguous OpenSpec root ${inputRoot}: both the directory itself and ${nested} contain OpenSpec planning shapes. Pass the intended root explicitly.`,
    );
  }
  if (hasNestedShape) {
    await assertPlanningRootNotLinked(nested);
    return { inputRoot, root: nested, kind: existsSync(storeMarker) ? "store" : "project" };
  }
  // The shape decides the root, the Store marker only decides the kind. Deciding
  // "store" first sent `root` to <store>/openspec for a checkout that keeps its
  // planning shape at the checkout root: a directory that does not exist reads
  // as an empty, fully compatible workspace, and apply then stages nothing.
  if (hasDirectShape) {
    const parentStoreMarker = basename(inputRoot) === "openspec"
      ? join(dirname(inputRoot), ".openspec-store", "store.yaml")
      : "";
    const store = existsSync(storeMarker) || (parentStoreMarker !== "" && existsSync(parentStoreMarker));
    return { inputRoot, root: inputRoot, kind: store ? "store" : "openspec-root" };
  }
  // OpenSpec stores may omit empty planning directories. Keep their canonical
  // future root at <store>/openspec so paths do not change after the first spec
  // — but only when that directory is really there. Auditing a root that does
  // not exist is how a Store checkout came back `ready` over invisible content.
  if (existsSync(storeMarker)) {
    await assertPlanningRootNotLinked(nested);
    if (!await isDirectory(nested)) {
      throw new OpenSpecRootError(
        `Store checkout ${inputRoot} has no OpenSpec planning content: neither ${nested} nor config.yaml, project.md, specs/ or changes/ at the checkout root.`,
      );
    }
    return { inputRoot, root: nested, kind: "store" };
  }
  throw new OpenSpecRootError(
    `No OpenSpec workspace found at ${inputRoot} (expected openspec/config.yaml, specs/, changes/, project.md, or .openspec-store/store.yaml).`,
  );
}

export async function assertPlanningRootNotLinked(path: string): Promise<void> {
  if (await isSymbolicLink(path)) {
    throw new OpenSpecRootError(
      `OpenSpec planning root must not be a symbolic link: ${path}. Pass the canonical planning directory explicitly.`,
    );
  }
}
