/**
 * The fleet's authorization vocabulary: which permissions exist, and on which
 * kind of subject each one is checked.
 *
 * It is a fleet document rather than a service one because permissions cross
 * services in the shape that matters — a permission a profile holds is owned by
 * whatever service owns profiles and enforced by every service that reads it,
 * and a per-service copy would be N copies of one word. `architecture/` is
 * where the fleet's shared documents already live.
 *
 * The unit is a PAIR, `<subject>/<permission>`, and that is the whole reason
 * this file exists instead of a `Requires:` line joined against OpenAPI's
 * `security`. OpenAPI carries permission NAMES only for oauth2 and
 * openIdConnect — for `http bearer` and `apiKey` the spec requires the scope
 * array to be empty — so a fleet on bearer tokens has nowhere in its contract
 * to say what it checks. And `security` answers only for the CALLER, while a
 * permission is as often checked on an entity inside the request.
 *
 * What this is NOT, deliberately: a domain model. Permissions are a flat list
 * of names under a subject kind — no entities, no relations, no resources.
 * Everything past that has no ground truth to check against, which is the same
 * reason the capability axis stops at declared names
 * (core/capabilities/capabilities.ts) and there is still no AUTHORED capability
 * layer (SCHEMA.md) — a vocabulary loam cannot
 * check is a vocabulary that drifts while looking authoritative. A permission
 * that varies by resource is separate names (`channel:send:sms`,
 * `channel:send:email`) or a column in a scenario's Examples table.
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { parse as parseYaml } from "yaml";

/** One declared permission, under the subject kind it is checked on. */
export interface Permission {
  /** The subject kind — `user`, `profile`, `service`. */
  subject: string;
  /** The permission name as `Requires:` spells it, without the subject. */
  name: string;
  /** `<subject>/<name>` — the token a requirement writes. */
  id: string;
  description?: string;
  /**
   * Where the permission is DEFINED — a service id, or `idp` for a vocabulary
   * some identity provider owns. Never resolved: see `UNCHECKED`. It is here
   * because "who would change this" is the first question a reader asks, and a
   * blank is a worse answer than an unverified one.
   */
  ownedBy?: string;
  /** Services that CHECK it. Never resolved, for the same reason. */
  enforcedBy: string[];
}

export interface Vocabulary {
  /** False when `architecture/permissions.yaml` does not exist — not an error. */
  present: boolean;
  /** Why the file could not be read as a vocabulary, when it could not. */
  invalid?: string;
  /** Declared subject kinds, in declaration order. */
  subjects: string[];
  /** Declared permissions, keyed by `<subject>/<name>`. */
  byId: Map<string, Permission>;
}

const EMPTY: Vocabulary = { present: false, subjects: [], byId: new Map() };

/**
 * Read the vocabulary. A missing file is not a finding — a fleet that gates
 * nothing on permissions owes no vocabulary, and the checks that read this stay
 * silent on an absent one exactly as the OpenAPI axis stays silent for a
 * service the landscape shows nobody calls.
 */
export async function readVocabulary(path: string): Promise<Vocabulary> {
  if (!existsSync(path)) return EMPTY;
  let doc: unknown;
  try {
    doc = parseYaml(await readFile(path, "utf8"));
  } catch (e) {
    return { ...EMPTY, present: true, invalid: e instanceof Error ? e.message : String(e) };
  }
  if (doc === null || doc === undefined) return { ...EMPTY, present: true };
  if (!isRecord(doc)) return { ...EMPTY, present: true, invalid: "the document is not a mapping" };

  const subjects = isRecord(doc["subjects"]) ? Object.keys(doc["subjects"]) : [];
  const permsBlock = doc["permissions"];
  if (permsBlock === undefined) return { present: true, subjects, byId: new Map() };
  if (!isRecord(permsBlock)) return { ...EMPTY, present: true, invalid: "`permissions` is not a mapping of subject kind to permissions" };

  const byId = new Map<string, Permission>();
  for (const [subject, block] of Object.entries(permsBlock)) {
    // A permission under an undeclared subject is the typo this shape exists to
    // make impossible: `Requires: profiles/channel:send` against a `profile`
    // block resolves nowhere, and without this the vocabulary would simply grow
    // a second subject kind nobody meant to declare.
    if (!subjects.includes(subject)) {
      return { ...EMPTY, present: true, invalid: `'${subject}' holds permissions but is not declared under \`subjects\`` };
    }
    if (!isRecord(block)) {
      return { ...EMPTY, present: true, invalid: `\`permissions.${subject}\` is not a mapping of permission name to its declaration` };
    }
    for (const [name, body] of Object.entries(block)) {
      const decl = isRecord(body) ? body : {};
      const enforced = decl["enforced_by"];
      byId.set(`${subject}/${name}`, {
        subject,
        name,
        id: `${subject}/${name}`,
        ...(typeof decl["description"] === "string" ? { description: decl["description"] } : {}),
        ...(typeof decl["owned_by"] === "string" ? { ownedBy: decl["owned_by"] } : {}),
        enforcedBy: Array.isArray(enforced) ? enforced.filter((s): s is string => typeof s === "string") : [],
      });
    }
  }
  return { present: true, subjects, byId };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
