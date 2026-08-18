/**
 * `$ref` as a pair of plain questions — which ones does this tree contain, and
 * what does one point at — and the component closure the merge answers them
 * for: every local component reachable from the feature's path items rides
 * along into the living document.
 *
 * Formerly `refs.ts`, which held only the two questions; the closure moved in
 * beside them because it is their one caller outside tests, and the walk and
 * the questions drifting apart would change which components a merge copies.
 */
import { isDeepStrictEqual } from "node:util";
import type { Document } from "yaml";
import { withoutFeatureMarkers } from "./markers.js";

export function collectRefs(node: unknown): string[] {
  const out: string[] = [];
  const walk = (current: unknown): void => {
    if (Array.isArray(current)) {
      for (const value of current) walk(value);
      return;
    }
    if (current !== null && typeof current === "object") {
      for (const [key, value] of Object.entries(current)) {
        if (key === "$ref" && typeof value === "string") out.push(value);
        else walk(value);
      }
    }
  };
  walk(node);
  return out;
}

/** Resolve a local JSON pointer (`#/a/b~1c`) against a plain JS tree. */
export function resolvePointer(root: unknown, ref: string): { found: boolean; value: unknown } {
  let current: unknown = root;
  for (const raw of ref.slice(2).split("/")) {
    const segment = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return { found: false, value: undefined };
      }
      current = current[index];
    } else if (current !== null && typeof current === "object" && segment in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return { found: false, value: undefined };
    }
  }
  return { found: true, value: current };
}

/** What the closure computed: living components overwritten, and local refs nothing resolves. */
export interface ComponentClosureOutcome {
  componentsModified: string[];
  unresolved: Array<{ ref: string; from: string }>;
}

/**
 * Merge the feature's component closure into the living document: every local
 * component reachable from the feature's path items is copied in (recursively
 * — a component's own refs pull their targets in too), identical living
 * components are left alone, differing ones are overwritten, and a local ref
 * that resolves in NEITHER document is reported for the caller to gate.
 */
export function mergeComponentClosure(
  living: Document,
  featPlain: unknown,
  livingPlain: unknown,
  featPathEntries: Array<[string, unknown]>,
): ComponentClosureOutcome {
  const componentsModified: string[] = [];
  const unresolved: ComponentClosureOutcome["unresolved"] = [];
  const visited = new Set<string>();
  const copies: Array<{ kind: string; name: string; value: unknown }> = [];

  const visitRef = (ref: string, from: string): void => {
    if (!ref.startsWith("#/")) return;
    const match = /^#\/components\/([^/]+)\/([^/]+)(?:\/|$)/.exec(ref);
    if (!match) {
      if (!resolvePointer(featPlain, ref).found && !resolvePointer(livingPlain, ref).found) {
        unresolved.push({ ref, from });
      }
      return;
    }
    const kind = match[1]!;
    const name = match[2]!;
    const key = `${kind}/${name}`;
    if (visited.has(key)) return;
    visited.add(key);
    const inFeature = resolvePointer(featPlain, `#/components/${kind}/${name}`);
    if (inFeature.found) {
      copies.push({ kind, name, value: inFeature.value });
      walk(inFeature.value, `components/${key}`);
      return;
    }
    if (!resolvePointer(livingPlain, `#/components/${kind}/${name}`).found) {
      unresolved.push({ ref, from });
    }
  };

  const walk = (node: unknown, from: string): void => {
    for (const ref of collectRefs(node)) visitRef(ref, from);
  };

  for (const [path, featItemPlain] of featPathEntries) {
    walk(withoutFeatureMarkers(featItemPlain), `paths ${path}`);
  }

  for (const { kind, name, value } of copies) {
    const existing = living.getIn(["components", kind, name]);
    if (existing !== undefined) {
      const existingPlain = resolvePointer(livingPlain, `#/components/${kind}/${name}`);
      if (existingPlain.found && isDeepStrictEqual(existingPlain.value, value)) continue;
      componentsModified.push(`${kind}/${name}`);
    }
    living.setIn(["components", kind, name], value);
  }

  return { componentsModified, unresolved };
}
