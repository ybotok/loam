/**
 * The fleet's capability vocabulary: which business capabilities exist, by
 * declared name, so a requirement's `Capability:` line resolves or refuses
 * instead of silently labelling.
 *
 * It is a fleet document (`architecture/capabilities.yaml`, beside the
 * landscape and the permissions vocabulary) because a capability crosses
 * services by definition — "registration" is realized by requirements in four
 * repositories, and a per-service copy would be N spellings of one word.
 *
 * What this is NOT, deliberately: a domain model, and not an authored prose
 * layer either. SCHEMA.md rejected a free-text `capability:` label because
 * nothing could check it; a DECLARED name is different in exactly the way that
 * mattered there — the id exists in this file or it does not, so an unknown
 * name is an error with close candidates, a declaration nothing realizes is a
 * warning, and the vocabulary cannot drift while looking authoritative. The
 * long-lived capability documents themselves (one page per capability, revised
 * by features) stay outside loam — that is the roadmap's evidence-gated Later
 * item, and the rollup built over these names is the evidence that decides it.
 *
 * The OPT-IN also differs from the authorization axis, on purpose: there the
 * `Requires:` line is the opt-in and a missing permissions.yaml is an error at
 * the line; here the FILE is the opt-in — a fleet with no capabilities.yaml
 * produces no capability findings at all (`core/capabilities/findings.ts`
 * holds the rule and the reason).
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { isRecord } from "../kernel/records.js";

/** One declared capability. The id is the full key, slashes preserved. */
export interface Capability {
  /**
   * The token a requirement's `Capability:` line writes. Nesting is spelled
   * INSIDE the id (`payments/refunds`) and never collapsed — the key is
   * exactly the string a requirement names, greppable as written.
   */
  id: string;
  description?: string;
  /**
   * A team or a person — deliberately `owner:`, not permissions' `owned_by:`,
   * because that field carries "defining service" semantics a capability does
   * not have. Never resolved against anything; a blank is a worse answer than
   * an unverified one.
   */
  owner?: string;
}

export interface CapabilityVocabulary {
  /** False when `architecture/capabilities.yaml` does not exist — not an error. */
  present: boolean;
  /** Why the file could not be read as a vocabulary, when it could not. */
  invalid?: string;
  /** Declared capabilities, keyed by the full id. */
  byId: Map<string, Capability>;
}

const EMPTY: CapabilityVocabulary = { present: false, byId: new Map() };

/**
 * Read the vocabulary — exactly `permissions.ts`'s defensive ladder, because
 * the two files fail the same ways: a missing file is silence, a YAML error or
 * a non-mapping shape is `invalid` (one finding for the whole run, the family
 * suppressed behind it), an empty document is a present-and-empty vocabulary,
 * and a declaration whose body is not a mapping is treated as `{}` rather than
 * refusing the whole file over one leaf.
 */
export async function readCapabilities(path: string): Promise<CapabilityVocabulary> {
  if (!existsSync(path)) return EMPTY;
  let doc: unknown;
  try {
    doc = parseYaml(await readFile(path, "utf8"));
  } catch (e) {
    return { ...EMPTY, present: true, invalid: e instanceof Error ? e.message : String(e) };
  }
  if (doc === null || doc === undefined) return { ...EMPTY, present: true };
  if (!isRecord(doc)) return { ...EMPTY, present: true, invalid: "the document is not a mapping" };

  const block = doc["capabilities"];
  if (block === undefined) return { present: true, byId: new Map() };
  if (!isRecord(block)) {
    return { ...EMPTY, present: true, invalid: "`capabilities` is not a mapping of capability id to its declaration" };
  }

  const byId = new Map<string, Capability>();
  for (const [id, body] of Object.entries(block)) {
    const decl = isRecord(body) ? body : {};
    byId.set(id, {
      id,
      ...(typeof decl["description"] === "string" ? { description: decl["description"] } : {}),
      ...(typeof decl["owner"] === "string" ? { owner: decl["owner"] } : {}),
    });
  }
  return { present: true, byId };
}
