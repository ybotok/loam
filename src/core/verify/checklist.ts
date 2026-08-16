/**
 * The questions: what a feature's own artifacts promised, derived mechanically.
 *
 * The original plan was to extract C4 from the built code and diff it against
 * the delta. There is no such extractor and there will not be one — nothing
 * deterministic reads a service and says what its architecture MEANS, and two
 * generated models of the same code disagree in wording every run, so the diff
 * would flap and be switched off inside a week.
 *
 * What survives of the idea is the part that was always deterministic, and it
 * is this module: a feature says this service will exist, it will expose this
 * operation, that service will call it, this scenario will have a test. The
 * list comes from the same files `validate` already reads.
 *
 * The claim ids are a function of the claim and of nothing else — so two runs
 * are diffable, reordering the delta renames nothing, and rewording a scenario
 * DOES rename its claim, because an answer about text nobody wrote must not
 * carry over.
 *
 * `scenarioBodyHash` stays here for that reason and has a second consumer:
 * `core/gherkin.ts` stamps the same digest as a tag on every generated
 * scenario, and `--results` matches a cucumber report back to a claim by it. A
 * second spelling of the hash would silently stop every scenario claim from
 * being answerable by a run.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { elementService, loadFile, serviceOf, type Elem } from "../c4/likec4.js";
import { operationIds, operations } from "../openapi/doc.js";
import { featurePaths, featureSpecPaths, servicePaths } from "../repo/paths.js";
import { featureSpecServices } from "../repo/repo.js";
import { parseRequirements } from "../document/spec.js";

/**
 * What a claim is about. The order is the order the checklist comes back in,
 * and it reads as the story of the feature: the service exists, it exposes its
 * operations, the calls into it are wired, the behaviour is tested.
 */
export const CLAIM_KINDS = ["service.exists", "api.exposes", "c4.calls", "scenario.tested"] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];

export interface Claim {
  /** `<kind>-<8 hex>` — stable for the life of the claim. See `claimId`. */
  id: string;
  kind: ClaimKind;
  /** The service whose code answers this. A caller's claim is filed under the caller. */
  subject: string;
  /** The claim in one line, answerable without reading the feature's files. */
  claim: string;
  /**
   * `scenario.tested` only: the first {@link DIGEST_LENGTH} hex of the
   * scenario's body hash — the exact digest `loam gherkin` stamps as
   * `@loam-digest-…`, which is what a cucumber report scenario carries and
   * what `--results` matches on. Absent on every other kind.
   */
  digest?: string;
}

export interface Checklist {
  feature: string;
  claims: Claim[];
  /** A digest of the claim id SET — what says a record still answers this feature. */
  digest: string;
}

/**
 * How much of the sha256 goes into an id, and into a digest — the checklist's,
 * and a scenario claim's runner-matching one, which is deliberately the same
 * 16 hex `loam gherkin` stamps (its GHERKIN_DIGEST_LENGTH): the tag in a
 * cucumber report and the digest on a claim must be the same string.
 */
const ID_LENGTH = 8;
const DIGEST_LENGTH = 16;

/** C4 kinds that model people. A person is never a service. (Mirrors validate.ts.) */
const ACTOR_KINDS = new Set(["person", "actor", "user"]);

/**
 * Derive the checklist from a feature's own artifacts. No code is read here and
 * none should be: the whole design rests on the questions being computed from
 * documents that do not change between runs.
 */
export async function featureChecklist(
  docsDir: string,
  featureDir: string,
  featureId: string,
): Promise<Checklist> {
  const seen = new Map<string, number>();
  const claim = (kind: ClaimKind, subject: string, parts: string[], text: string): Claim => ({
    id: claimId(featureId, kind, parts, seen),
    kind,
    subject,
    claim: text,
  });

  const exists: Claim[] = [];
  const exposes: Claim[] = [];
  const calls: Claim[] = [];
  const scenarios: Claim[] = [];

  // Architecture — what the delta promised the fleet would look like.
  const deltaPath = featurePaths(featureDir).delta;
  if (existsSync(deltaPath)) {
    const res = await loadFile(deltaPath);
    // A delta nobody can parse promises nothing checkable. `validate` already
    // reports it; inventing claims out of a broken document would only add noise.
    if (res.errors.length === 0) {
      const elements: Elem[] = res.elements;
      for (const e of elements) {
        if (!e.tags.includes(featureId)) continue;
        // A dotted id is a container INSIDE a service, and an actor is nobody's
        // repository. Neither is a service that has to exist.
        if (e.id.includes(".") || ACTOR_KINDS.has(e.kind.toLowerCase())) continue;
        const svc = elementService(e);
        exists.push(claim("service.exists", svc, [svc], `service '${svc}' exists`));
      }
      for (const r of res.relationships) {
        // Untagged edges are context for the diagram; an edge with no operation
        // names nothing specific enough to look for in the code.
        if (!r.tags.includes(featureId) || r.op === undefined) continue;
        const from = serviceOf(elements, r.source);
        const to = serviceOf(elements, r.target);
        calls.push(
          claim("c4.calls", from, [from, to, r.op], `${from} calls '${r.op}' on ${to}`),
        );
      }
    }
  }

  for (const svc of await featureSpecServices(featureDir)) {
    const paths = featureSpecPaths(featureDir, svc);

    // Contract — only what is NEW. A delta's openapi.yaml is a whole document,
    // not a patch, so authors restate the living API inside it; asking whether a
    // service still exposes what it already exposed is noise.
    const featOps = (await operations(paths.openapi))
      .filter((operation) => !operation.remove)
      .map((operation) => operation.id);
    if (featOps.length > 0) {
      const living = new Set(await operationIds(servicePaths(docsDir, svc).openapi));
      for (const op of featOps) {
        if (living.has(op)) continue;
        exposes.push(
          claim("api.exposes", svc, [svc, op], `${svc} exposes operationId '${op}'`),
        );
      }
    }

    // Behaviour — the scenarios of the requirements this feature CHANGES. A BASE
    // requirement is the living state quoted inside the delta, and a REMOVED one
    // is being retired: neither is work anybody has to have done.
    if (existsSync(paths.spec)) {
      for (const r of parseRequirements(await readFile(paths.spec, "utf8"))) {
        if (r.kind === "BASE" || r.kind === "REMOVED") continue;
        for (const s of r.scenarios) {
          const body = scenarioBodyHash(svc, s.lines);
          scenarios.push({
            ...claim(
              "scenario.tested",
              svc,
              [svc, r.id ?? r.name, s.name, body.slice(0, ID_LENGTH)],
              `scenario '${s.name}' of requirement '${r.name}' (${svc}) is covered by a test`,
            ),
            digest: body.slice(0, DIGEST_LENGTH),
          });
        }
      }
    }

    // The architecture spec axis, same walk: an arch scenario is a promise like
    // any other — the outbox test nobody was going to write IS the point of the
    // axis. The source file rides in the id tuple AND in the body hash itself
    // (two axes are two namespaces: identically-worded scenarios must stay two
    // questions, and the axis-salted digest is what keeps a business-only test
    // run from answering the arch claim) and in the claim text, so the
    // answering agent knows it is being asked for an integration/ops test, not
    // an acceptance test.
    if (existsSync(paths.archSpec)) {
      for (const r of parseRequirements(await readFile(paths.archSpec, "utf8"))) {
        if (r.kind === "BASE" || r.kind === "REMOVED") continue;
        for (const s of r.scenarios) {
          const body = scenarioBodyHash(svc, s.lines, "arch");
          scenarios.push({
            ...claim(
              "scenario.tested",
              svc,
              [svc, "arch.spec.md", r.id ?? r.name, s.name, body.slice(0, ID_LENGTH)],
              `scenario '${s.name}' of arch requirement '${r.name}' (${svc}, arch.spec.md) is covered by a test`,
            ),
            digest: body.slice(0, DIGEST_LENGTH),
          });
        }
      }
    }
  }

  const claims = [...exists, ...exposes, ...calls, ...scenarios];
  return { feature: featureId, claims, digest: checklistDigest(claims) };
}

/**
 * A claim's identity: a hash of what it says, and nothing about how it was
 * produced.
 *
 * The feature id is part of it so an answers file for one feature can never
 * validate against another. Two claims that really are identical (the same
 * scenario name twice under one requirement) are distinguished by occurrence, in
 * document order — they are still two questions, and answering one must not
 * answer the other.
 *
 * The hash is short because the claim text sits next to it everywhere it is
 * shown; it identifies a question, it does not authenticate one.
 */
function claimId(
  featureId: string,
  kind: ClaimKind,
  parts: string[],
  seen: Map<string, number>,
): string {
  // NUL-joined so no claim's own text can spell another claim's tuple by
  // containing the separator: ['a b','c'] and ['a','b c'] stay two questions.
  const tuple = [featureId, kind, ...parts].join("\u0000");
  const n = (seen.get(tuple) ?? 0) + 1;
  seen.set(tuple, n);
  const canonical = n === 1 ? tuple : `${tuple}\u0000#${n}`;
  return `${kind}-${createHash("sha256").update(canonical).digest("hex").slice(0, ID_LENGTH)}`;
}

/** The axis a scenario's words live on: `spec.md` or `arch.spec.md`. */
export type ScenarioAxis = "business" | "arch";

/**
 * The full sha256 of a scenario's body — its lines joined and edge-trimmed,
 * exactly as `serializeRequirements` frames them. The BODY, not the title,
 * because rewriting the Given/When/Then under an unchanged heading is new text
 * nobody answered for, and the promise — rewording a scenario renames its
 * claim — has to hold for the words that actually specify the behaviour.
 *
 * ONE recipe with three consumers, deliberately in one place:
 * `scenario.tested` claim ids fold in its first {@link ID_LENGTH} hex
 * characters, a claim's `digest` and the `@loam-digest-<16hex>` tag `loam
 * gherkin` stamps both take its first {@link DIGEST_LENGTH} — so the claim,
 * the stamp and the report `--results` reads can never disagree about what a
 * scenario says.
 *
 * The identity is (SERVICE, AXIS, body), and both salts are there for the same
 * reason: a digest that spans two namespaces lets one green run answer a
 * question nobody ran a test for.
 *
 * - The AXIS salt keeps `spec.md` and `arch.spec.md` apart. Without it a green
 *   BUSINESS run answered the arch claim too — an integration test nobody wrote
 *   read as run.
 * - The SERVICE salt keeps two repositories apart. "the service returns 404 for
 *   an unknown id" is worded the same way in nine services of a real fleet;
 *   unsalted, all nine shared one digest, `loam gherkin` stamped one tag into
 *   nine repositories, and one repository's green run confirmed the other
 *   eight's claims — across suites that never ran each other's tests.
 *
 * The service salt is what makes that case CORRECT rather than merely refused:
 * `contestedDigests` could only decline to answer a shared digest, which left a
 * fleet with ordinary repeated wording holding claims nothing could ever
 * answer.
 *
 * Both salts renamed every claim id and every stamped tag on the day they
 * landed, and both readings are legible rather than silent: an existing
 * `verification.yaml` answers a checklist digest that is no longer derived and
 * reports STALE, and an existing generated `.feature` carries digests the
 * living spec no longer computes and reports `gherkin.stale` beside the
 * `gherkin.missing` for the new ones. One `loam gherkin` and one re-record
 * clear both.
 */
export function scenarioBodyHash(
  service: string,
  lines: string[],
  axis: ScenarioAxis = "business",
): string {
  // NUL-separated like claimId's tuples, and for its reason: no body can spell
  // the salt in front of it, so the namespaces stay disjoint. Spelled as an
  // escape and never as a raw NUL in the literal — a raw one makes this file
  // read as `data` to `file(1)` and invisible to `grep`.
  const body = lines.join("\n").trim();
  const onAxis = axis === "arch" ? `arch.spec.md\u0000${body}` : body;
  return createHash("sha256").update(`${service}\u0000${onAxis}`).digest("hex");
}

/**
 * A digest of the claim id SET — sorted, so reordering the artifacts does not
 * make a record look stale. It changes when a claim is added, removed or
 * reworded, which is exactly when an answer set stops describing the feature.
 */
function checklistDigest(claims: Claim[]): string {
  const ids = claims.map((c) => c.id).sort();
  return createHash("sha256").update(ids.join("\n")).digest("hex").slice(0, DIGEST_LENGTH);
}

