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
import type { DocsDir } from "../kernel/ids/dirs.js";
import { capabilitiesPath } from "../repo/paths.js";
import { capabilityDocsDir } from "../repo/authored/paths.js";
import { readCapabilityTree, type CapabilityTree } from "./tree.js";

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
  /**
   * Which side declared this id. `yaml` is a name in
   * `architecture/capabilities.yaml` with no document; `tree` is a
   * `capabilities/<id>/spec.md` the YAML does not name; `both` is the same id
   * on both sides, which is normal rather than a duplicate — the YAML declared
   * the word first and somebody has since written the document for it.
   *
   * Recorded rather than derived at each reader, because the two sides carry
   * different fixes: a `yaml`-only capability is fixed by writing the document,
   * a `tree`-only one needs no fix at all, and a message that could not tell
   * them apart would advise editing a file that may not exist.
   */
  source: "yaml" | "tree" | "both";
  /** `capabilities/<id>/spec.md`, absolute, when the tree declares this id. */
  spec?: string;
}

export interface CapabilityVocabulary {
  /**
   * False when NEITHER `architecture/capabilities.yaml` nor `capabilities/`
   * exists. Either one is the axis's opt-in, so a fleet holding neither
   * produces no capability finding at all, however many `Capability:` lines its
   * requirements already carry.
   */
  present: boolean;
  /**
   * Why `architecture/capabilities.yaml` could not be read as a vocabulary,
   * when it could not. The TREE has no such state: a directory either lists or
   * it does not, and an unreadable one is a filesystem failure the walk lets
   * throw rather than a document loam misread.
   */
  invalid?: string;
  /** Declared capabilities, keyed by the full id — the union of both sides. */
  byId: Map<string, Capability>;
  /** What the `capabilities/` walk found, for the graders that need the paths. */
  tree: CapabilityTree;
}

const NO_TREE: CapabilityTree = { present: false, docs: [], undocumented: [] };
const EMPTY: CapabilityVocabulary = { present: false, byId: new Map(), tree: NO_TREE };

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
  if (block === undefined) return { ...EMPTY, present: true };
  if (!isRecord(block)) {
    return { ...EMPTY, present: true, invalid: "`capabilities` is not a mapping of capability id to its declaration" };
  }

  const byId = new Map<string, Capability>();
  for (const [id, body] of Object.entries(block)) {
    const decl = isRecord(body) ? body : {};
    byId.set(id, {
      id,
      source: "yaml",
      ...(typeof decl["description"] === "string" ? { description: decl["description"] } : {}),
      ...(typeof decl["owner"] === "string" ? { owner: decl["owner"] } : {}),
    });
  }
  return { ...EMPTY, present: true, byId };
}

/**
 * THE vocabulary — both sides read and merged, and the only shape a grader
 * should ever be handed.
 *
 * `readCapabilities` above stays exported for the one reader that genuinely
 * means the file alone (its own tests), but nothing that grades a fleet may use
 * it: a `Capability:` line naming an id the tree declares and the YAML does not
 * would resolve through the union and fail through the file, so a second
 * spelling of "the vocabulary" is a second answer to `capability.unknown`.
 *
 * WHERE AN ID SITS ON BOTH SIDES THE YAML'S METADATA SURVIVES, and not by
 * precedence — the document has nothing to overwrite it with. `description` and
 * `owner` are fields, and this axis's own rule is that an entry without prose
 * stays a line in YAML; the document's contribution is the narrative and the
 * requirements, which are prose, and loam reads frontmatter, never prose. So a
 * capability declared only in the tree has no owner in `loam list
 * capabilities`, and that is the honest reading rather than a gap: nobody wrote
 * one down. What the merge adds on that side is `spec` and `source`.
 *
 * An UNREADABLE YAML suspends the whole family (`gradableCapabilityIds` in
 * `./findings.ts` is the one statement of that ladder), and the tree is still
 * walked and still carried: `capability.doc-missing` is a fact about
 * directories that no YAML failure makes untrue, and suppressing it behind an
 * unrelated broken file would hide a half-created capability until somebody
 * fixed a document it has nothing to do with.
 */
export async function readCapabilityVocabulary(docsDir: DocsDir): Promise<CapabilityVocabulary> {
  const [yaml, tree] = await Promise.all([
    readCapabilities(capabilitiesPath(docsDir)),
    readCapabilityTree(capabilityDocsDir(docsDir)),
  ]);
  const byId = new Map(yaml.byId);
  for (const doc of tree.docs) {
    const declared = byId.get(doc.id);
    byId.set(doc.id, {
      ...declared,
      id: doc.id,
      source: declared === undefined ? "tree" : "both",
      spec: doc.spec,
    });
  }
  return {
    ...yaml,
    present: yaml.present || tree.present,
    byId,
    tree,
  };
}
