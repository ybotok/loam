/**
 * The done-check: did the code that was built match the feature that was
 * designed?
 *
 * The original plan was to extract C4 from the built code and diff it against
 * the delta. There is no such extractor and there will not be one — nothing
 * deterministic reads a service and says what its architecture MEANS, and two
 * generated models of the same code disagree in wording every run, so the diff
 * would flap and be switched off inside a week.
 *
 * What survives of the idea is the part that was always deterministic: the
 * QUESTIONS. A feature's own artifacts say exactly what it promised — this
 * service will exist, it will expose this operation, that service will call it,
 * this scenario will have a test. loam derives that list mechanically from the
 * same files `validate` already reads, an agent answers each claim with
 * evidence, and `--record` writes the answers down beside the feature.
 *
 * A scenario claim is answered mechanically wherever it can be: `--results`
 * reads a cucumber JSON report and matches it by the digest tag `loam gherkin`
 * stamped, and only a green run confirms one (results.ts). Where it cannot —
 * a legacy service whose suite is months away, which is the fleet loam exists
 * for — `--record` may still take an agent's word for it, and the record marks
 * that answer ATTESTED rather than run: `verified` is reserved for a checklist
 * whose scenarios a run answered, and `verify.scenario-attested` says so on
 * every surface that reads the record.
 *
 * Two properties make the record worth keeping. The claim ids are a function of
 * the claim and of nothing else — so two runs are diffable, reordering the delta
 * renames nothing, and rewording a scenario DOES rename its claim, because an
 * answer about text nobody wrote must not carry over. And an answer set that
 * does not correspond to the current checklist is refused rather than merged:
 * an unchecked claim must never be able to masquerade as checked.
 *
 * loam does not judge the answers. It cannot: it never read the code. It only
 * guarantees that every question was asked and that every answer is on the
 * record next to the question it answers.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { elementService, loadFile, serviceOf, type Elem } from "./c4/likec4.js";
import { operationIds, operations } from "./openapi.js";
import { isRecord } from "./kernel/records.js";
import { featurePaths, featureSpecPaths, featureSpecServices, servicePaths } from "./repo/repo.js";
import { parseRequirements } from "./document/spec.js";

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

/* ------------------------------------------------------------------ */
/* The answers                                                         */
/* ------------------------------------------------------------------ */

/**
 * Two verdicts, deliberately. Anything an agent cannot show evidence for is
 * unconfirmed — a third value for "not applicable" would absorb every claim
 * nobody wanted to answer.
 */
export const VERDICTS = ["confirmed", "unconfirmed"] as const;
export type Verdict = (typeof VERDICTS)[number];

/**
 * Who answered a claim: the `runner` (a cucumber report's digest-tagged
 * scenarios, matched mechanically by `--results`) or an `agent` (somebody's
 * word about the code, taken back by `--record`). On the record so a reviewer
 * can tell a green run from an assertion.
 */
export const ANSWERED_BY = ["runner", "agent"] as const;
export type AnsweredBy = (typeof ANSWERED_BY)[number];

export interface Answer {
  id: string;
  verdict: Verdict;
  /** Where it can be seen — `file:line`, or a report scenario for the runner. Required for `confirmed`. */
  evidence: string[];
  note?: string;
  answered_by: AnsweredBy;
}

/** Why an answer set was refused. Each names a different way it fails to answer. */
export type AnswerRefusal = "answers-unreadable" | "answers-mismatch" | "answers-unevidenced";

export type AnswerCheck =
  /** The answers, re-ordered to the checklist, one per claim. */
  | { ok: true; answers: Answer[] }
  | { ok: false; code: AnswerRefusal; message: string };

/**
 * Accept an answer set only if it answers THIS checklist: every claim once, no
 * claim twice, nothing extra, and no "confirmed" that shows nothing.
 *
 * The refusals are the point of the command. If a stale or partial answer file
 * could be recorded, `verification.yaml` would say a claim was checked when
 * nobody ever asked it — and a record that can lie is worse than no record,
 * because it looks like evidence.
 *
 * `runnerOwned` is the composition rule under `--results`: ids the test runner
 * answers, which an answers file must therefore not touch. An entry naming one
 * refuses with its own diagnosis — the id IS on the feature's checklist, so
 * calling it unknown would send the caller hunting a staleness that is not
 * there.
 *
 * `context` is what turns the last line from a circle into an instruction. In a
 * fleet the commonest way to "miss" a claim is that it is not yours: the
 * checklist spans ten repositories and this one can only answer its own. Told
 * only to "answer the claims it lists", an agent in the payment-service repo
 * re-runs verify, sees the same checkout-web claims it cannot speak for, and
 * either loops or invents evidence. So when every unanswered claim belongs to
 * another service, say THAT, and name the command that records them.
 */
export function checkAnswers(
  claims: Claim[],
  raw: unknown,
  runnerOwned?: ReadonlySet<string>,
  context?: { feature: string; service?: string },
): AnswerCheck {
  const refuse = (code: AnswerRefusal, message: string): AnswerCheck => ({ ok: false, code, message });

  const list = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw["answers"])
      ? (raw["answers"] as unknown[])
      : null;
  if (list === null) {
    return refuse(
      "answers-unreadable",
      "Expected a JSON array of answers, or an object with an `answers` array: " +
        `[{ "id": "...", "verdict": "confirmed", "evidence": ["file:line"] }]`,
    );
  }

  const answers: Answer[] = [];
  for (const [i, entry] of list.entries()) {
    const where = `answer ${i + 1}`;
    if (!isRecord(entry)) return refuse("answers-unreadable", `${where} is not an object`);
    const id = entry["id"];
    if (typeof id !== "string" || id.length === 0) {
      return refuse("answers-unreadable", `${where} has no claim id`);
    }
    const verdict = entry["verdict"];
    if (typeof verdict !== "string" || !(VERDICTS as readonly string[]).includes(verdict)) {
      return refuse(
        "answers-unreadable",
        `${where} ('${id}') has verdict ${JSON.stringify(verdict)} — expected one of ${VERDICTS.join(", ")}`,
      );
    }
    const note = typeof entry["note"] === "string" ? entry["note"].trim() : "";
    answers.push({
      id,
      verdict: verdict as Verdict,
      evidence: stringList(entry["evidence"]),
      ...(note.length > 0 ? { note } : {}),
      answered_by: "agent",
    });
  }

  const byId = new Map<string, Answer>();
  const twice: string[] = [];
  for (const a of answers) {
    if (byId.has(a.id)) twice.push(a.id);
    else byId.set(a.id, a);
  }
  const known = new Set(claims.map((c) => c.id));
  const strayIds = [...new Set(answers.map((a) => a.id).filter((id) => !known.has(id)))];
  const runnerHit = strayIds.filter((id) => runnerOwned?.has(id) === true);
  const unknown = strayIds.filter((id) => runnerOwned?.has(id) !== true);
  const missingClaims = claims.filter((c) => !byId.has(c.id));
  const missing = missingClaims.map((c) => c.id);
  if (runnerHit.length + unknown.length + missing.length + twice.length > 0) {
    const parts = [
      runnerHit.length > 0
        ? `${runnerHit.length} answer(s) name scenario claim(s) the test runner owns under --results: ${runnerHit.join(", ")} — the report answers those; take them out of the answers file`
        : "",
      unknown.length > 0 ? `${unknown.length} answer(s) name a claim that is not on the checklist: ${unknown.join(", ")}` : "",
      missing.length > 0 ? `${missing.length} claim(s) have no answer: ${missing.join(", ")}` : "",
      twice.length > 0 ? `${twice.length} claim(s) answered more than once: ${[...new Set(twice)].join(", ")}` : "",
    ].filter((s) => s.length > 0);
    return refuse(
      "answers-mismatch",
      `These answers do not match the checklist — ${parts.join("; ")}. ` +
        missingAdvice(missingClaims, claims.filter((c) => byId.has(c.id)), context),
    );
  }

  const unevidenced = claims
    .map((c) => byId.get(c.id)!)
    .filter((a) => a.verdict === "confirmed" && a.evidence.length === 0)
    .map((a) => a.id);
  if (unevidenced.length > 0) {
    return refuse(
      "answers-unevidenced",
      `${unevidenced.length} claim(s) are confirmed with no evidence: ${unevidenced.join(", ")}. A confirmation with nothing behind it is an assertion — give a file:line, or answer 'unconfirmed'.`,
    );
  }

  // Checklist order, not the order they were written in: the record reads in the
  // order the questions were asked, whatever the agent did.
  return { ok: true, answers: claims.map((c) => byId.get(c.id)!) };
}

/**
 * The last sentence of an `answers-mismatch`. "Re-run and answer the claims it
 * lists" is sound advice only when the caller CAN answer them. In a fleet the
 * checklist is federated — a feature's claims are filed under the service whose
 * code answers them — so the honest diagnosis for a repo that answered
 * everything it owns is "the rest is not yours", together with the form that
 * records the rest. Anything else sends the caller round the same loop.
 */
function missingAdvice(
  missing: Claim[],
  answered: Claim[],
  context?: { feature: string; service?: string },
): string {
  const generic = "Re-run `loam verify` and answer the claims it lists.";
  if (context === undefined || missing.length === 0 || answered.length === 0) return generic;
  // The signature of "I answered mine and the rest is not mine": the services
  // that own the unanswered claims and the services that own the answered ones
  // do not overlap. A single-service checklist with one claim forgotten fails
  // this test and keeps the generic advice, which is the right advice there —
  // that claim really is the caller's to answer.
  const owners = [...new Set(missing.map((c) => c.subject))].sort();
  const covered = new Set(answered.map((c) => c.subject));
  if (owners.some((s) => covered.has(s))) return generic;
  const form = `\`loam verify ${context.feature} --record answers.json --service <svc>\``;
  const mine = context.service;
  return mine === undefined
    ? `Those claims are owned by ${owners.join(", ")} — each service attests its own from its own repository (${form}); ` +
        "this all-at-once form has to answer the whole checklist in one file."
    : `Every unanswered claim belongs to a different service (${owners.join(", ")}) and this repository can only attest '${mine}' — ` +
        `run ${form} in each of those repositories instead.`;
}

function stringList(v: unknown): string[] {
  if (typeof v === "string") return v.trim().length > 0 ? [v.trim()] : [];
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter((s) => s.length > 0);
}

/* ------------------------------------------------------------------ */
/* The record                                                          */
/* ------------------------------------------------------------------ */

export interface RecordedClaim {
  id: string;
  kind: ClaimKind;
  /** Present in federated records; omitted by legacy records written before schema 2. */
  subject?: string;
  claim: string;
  verdict: Verdict;
  /** Who answered — absent only in records written before `--results` existed. */
  answered_by?: AnsweredBy;
  evidence: string[];
  note?: string;
}

/**
 * The test report a `--results` run consumed.
 *
 * Nothing can prove a JSON file came from executing a particular commit — a
 * report is bytes, and bytes are writable. What loam can do is stop leaving the
 * question open: it records exactly which file it read (inside the attesting
 * repository, resolved by the same path rules as evidence), the sha256 of the
 * bytes it read, the file's own mtime and how many digest-tagged scenarios it
 * carried. A reviewer holding the repository can tell whether this is that
 * file; before this, `answered_by: runner` named nothing at all.
 */
export interface ConsumedReport {
  /** As it was passed to `--results` — repo-relative in a federated record. */
  path: string;
  /** Full sha256 of the bytes read, so `shasum -a 256 <path>` answers the question. */
  digest: string;
  /** ISO-8601 mtime of the report file — when the run that wrote it finished. */
  mtime: string;
  /** How many digest-tagged scenarios the report carried. */
  scenarios: number;
}

/** A service repository's commit-bound contribution to a federated record. */
export interface ServiceAttestation {
  service: string;
  commit: string;
  recorded: string;
  /** Claim ids this commit answered. Kept explicit so stale answers can be pruned safely. */
  claims: string[];
  /** The report that answered this service's scenario claims, when `--results` did. */
  report?: ConsumedReport;
}

export interface Verification {
  /** Federated, partial records use schema 2. Absent means the original all-at-once format. */
  schema?: 2;
  feature: string;
  /** The day the answers were recorded. */
  recorded: string;
  /** The checklist digest they answer — how a later reader spots a record gone stale. */
  checklist: string;
  summary: { claims: number; confirmed: number; unconfirmed: number; unanswered?: number };
  claims: RecordedClaim[];
  /** The all-at-once form's consumed report; the federated form files it per attestation. */
  report?: ConsumedReport;
  attestations?: ServiceAttestation[];
}

/* ------------------------------------------------------------------ */
/* The verdict                                                         */
/* ------------------------------------------------------------------ */

/**
 * Anything carrying an answer, whichever surface holds it: a recorded claim, or
 * the read view's per-claim status. Structural on purpose — the same questions
 * are asked of both, and neither should have to convert into the other to be
 * counted.
 */
export interface AnsweredClaim {
  id: string;
  kind: string;
  verdict: string;
  answered_by?: string;
}

/**
 * The confirmed `scenario.tested` claims that no test run answered.
 *
 * A scenario claim's whole premise is that a run answers it — its digest IS the
 * tag `loam gherkin` stamps, and `--results` matches the two mechanically. An
 * agent may still answer one, because a legacy service has no runnable suite
 * for months and that fleet is who loam is for; but the answer is somebody's
 * word about a test, and it must not read as the run. A record written before
 * `--results` existed carries no `answered_by` at all: unknown counts as agent
 * here, because the alternative is to credit a run nobody can point at.
 */
export function attestedClaims(claims: readonly AnsweredClaim[]): string[] {
  return claims
    .filter((c) => c.kind === "scenario.tested" && c.verdict === "confirmed" && c.answered_by !== "runner")
    .map((c) => c.id);
}

/** How a set of answers counts up — recounted from the answers, never read off a `summary`. */
export interface RecordTally {
  /** Questions asked: answered, plus the ones a federated record leaves for other repos. */
  claims: number;
  confirmed: number;
  unconfirmed: number;
  unanswered: number;
  /** Of the confirmed, the scenario claims on an agent's word. See {@link attestedClaims}. */
  attested: number;
}

/**
 * `unanswered` is the count the answers themselves cannot show: a federated
 * record holds only what somebody answered, and the claims still owed to other
 * repositories exist on the checklist, not in `claims[]`. Read views that carry
 * an `unanswered` status inside the list pass 0 and are counted in place.
 */
export function tallyAnswers(claims: readonly AnsweredClaim[], unanswered = 0): RecordTally {
  const of = (verdict: string): number => claims.filter((c) => c.verdict === verdict).length;
  return {
    claims: claims.length + unanswered,
    confirmed: of("confirmed"),
    unconfirmed: of("unconfirmed"),
    unanswered: of("unanswered") + unanswered,
    attested: attestedClaims(claims).length,
  };
}

/**
 * The record's own answers, recounted. Never `v.summary`: the summary is what
 * whoever wrote the file said the answers add up to, and every reader that
 * believed it reported a record full of unconfirmed claims as fully confirmed.
 * `readVerificationState` refuses a record whose summary contradicts this, so a
 * caller holding a Verification may use either — and should use this one.
 */
export function tallyRecord(v: Verification): RecordTally {
  return tallyAnswers(v.claims, v.summary.unanswered ?? 0);
}

/**
 * Three states, because two were a lie. `verified` is the strong claim — every
 * question answered, every answer confirmed, and every scenario answered by a
 * digest-matched green run. `attested` is the same completeness resting, for at
 * least one scenario, on an agent's word. `unverified` is everything else:
 * nothing recorded, a record gone stale, a claim unanswered or unconfirmed, or
 * a checklist that asks nothing at all.
 */
export const VERIFICATION_VERDICTS = ["verified", "attested", "unverified"] as const;
export type VerificationVerdict = (typeof VERIFICATION_VERDICTS)[number];

export function verificationVerdict(t: RecordTally, stale = false): VerificationVerdict {
  if (stale || t.claims === 0 || t.confirmed !== t.claims) return "unverified";
  return t.attested > 0 ? "attested" : "verified";
}

/** A finding a verify surface reports about a record. Stable code, prose that may change. */
export interface VerifyNotice {
  code: string;
  severity: "warn";
  message: string;
  /** The claims it is about, when it is about claims. */
  claims?: string[];
}

/**
 * The one notice `verify`, `list` and `status` all show: this record's scenario
 * claims were confirmed without a run.
 *
 * It is a warning and it gates nothing — verify has never gated, and a service
 * with no suite yet has to be able to ship. What it must never do is read the
 * same as a green run.
 */
export function attestedNotice(claims: readonly AnsweredClaim[], feature: string): VerifyNotice | null {
  const ids = attestedClaims(claims);
  if (ids.length === 0) return null;
  return {
    code: "verify.scenario-attested",
    severity: "warn",
    message:
      `${ids.length} scenario claim(s) are confirmed on an agent's word, not on a test run: ${ids.join(", ")}. ` +
      `Answer them mechanically once the suite runs: \`loam verify ${feature} --results <cucumber.json>\`.`,
    claims: ids,
  };
}

/**
 * Where the record lives: inside the feature, so `archive` carries it into
 * `features/archive/` with everything else and a reviewer finds it next to the
 * delta it is about. YAML rather than frontmatter or JSON — it is data, it has
 * to survive without loam, and one claim per block is a diff a person can read.
 */
export function verificationPath(featureDir: string): string {
  return join(featureDir, "verification.yaml");
}

export function buildVerification(
  checklist: Checklist,
  answers: Answer[],
  today: string,
  report?: ConsumedReport,
): Verification {
  const byId = new Map(answers.map((a) => [a.id, a]));
  const claims: RecordedClaim[] = checklist.claims.map((c) => {
    // Callers hand in an answer per claim — `runnerAnswers` is total over the
    // checklist, and both other callers map the checklist to build theirs. The
    // branch is here because the alternative to a diagnosis is a `TypeError` on
    // `a.verdict`, which cli.ts reports as `internal` with a stack about a
    // property of `undefined` and no word about which claim went missing.
    const a = byId.get(c.id);
    if (a === undefined) throw new Error(`buildVerification: no answer for claim ${c.id}`);
    return {
      id: c.id,
      kind: c.kind,
      claim: c.claim,
      verdict: a.verdict,
      answered_by: a.answered_by,
      evidence: a.evidence,
      ...(a.note === undefined ? {} : { note: a.note }),
    };
  });
  const confirmed = claims.filter((c) => c.verdict === "confirmed").length;
  return {
    feature: checklist.feature,
    recorded: today,
    checklist: checklist.digest,
    summary: { claims: claims.length, confirmed, unconfirmed: claims.length - confirmed },
    claims,
    ...(report === undefined ? {} : { report }),
  };
}

/**
 * An answer the previous record held that the new one does not carry.
 *
 * Dropping these is correct — see `buildFederatedVerification` — but doing it
 * silently is not: a schema-1 record answers the WHOLE checklist, so the first
 * federated write turns a green record into a partial one, and an operator who
 * is not told which answers went missing reads the drop as loam losing data.
 */
export interface DiscardedAnswer {
  id: string;
  claim: string;
  /** The service the record filed it under, when it said. Absent in schema-1 records. */
  subject?: string;
  /**
   * `off-checklist` — the feature changed and nobody asks this question any
   * more. `unattested` — the question still stands, but no service attestation
   * binds the answer to a commit, so it cannot be carried into a federated
   * record; the owning repository has to record it again.
   */
  reason: "off-checklist" | "unattested";
}

export interface FederatedBuild {
  verification: Verification;
  /** In checklist-independent record order — see {@link DiscardedAnswer}. */
  discarded: DiscardedAnswer[];
}

/**
 * Replace one service's contribution while retaining current contributions
 * from other repositories. Claim ids removed from the live checklist are
 * pruned from both the answers and their attestations, so a changed feature can
 * never keep a green answer to a question it no longer asks.
 */
export function buildFederatedVerification(
  checklist: Checklist,
  service: string,
  answers: Answer[],
  previous: Verification | null,
  recorded: string,
  commit: string,
  report?: ConsumedReport,
): FederatedBuild {
  const currentById = new Map(checklist.claims.map((claim) => [claim.id, claim]));
  const localIds = new Set(checklist.claims.filter((claim) => claim.subject === service).map((claim) => claim.id));

  // An old all-at-once record remains readable, but its answers have no commit
  // attestation and therefore cannot silently become somebody else's
  // federated contribution. The first schema-2 write starts a clean federation.
  const previouslyAttested = new Set((previous?.attestations ?? []).flatMap((a) => a.claims));
  const retained = (previous?.schema === 2 ? previous.claims : []).filter((claim) => {
    const current = currentById.get(claim.id);
    return current !== undefined && current.subject !== service && previouslyAttested.has(claim.id);
  });
  const local = answers.map((answer): RecordedClaim => {
    // Same contract as `buildVerification`: an answer is built from the live
    // checklist, so it always names a current claim. Off-checklist answers do
    // NOT belong here — `discarded` means "an answer the PREVIOUS record held",
    // and routing an incoming stray into it would change what the printed
    // notice tells an operator. A caller that reaches this gets told which
    // answer it was rather than a `TypeError` on `claim.kind`.
    const claim = currentById.get(answer.id);
    if (claim === undefined) {
      throw new Error(`buildFederatedVerification: answer ${answer.id} names no current claim`);
    }
    return {
      id: claim.id,
      kind: claim.kind,
      subject: claim.subject,
      claim: claim.claim,
      verdict: answer.verdict,
      answered_by: answer.answered_by,
      evidence: answer.evidence,
      ...(answer.note === undefined ? {} : { note: answer.note }),
    };
  });
  const byId = new Map([...retained, ...local].map((claim) => [claim.id, claim]));
  const claims = checklist.claims.flatMap((claim) => {
    const answer = byId.get(claim.id);
    if (answer === undefined) return [];
    // Normalize retained legacy entries to the current question text and add
    // the subject schema 2 needs for future independent replacement.
    return [{ ...answer, kind: claim.kind, subject: claim.subject, claim: claim.claim }];
  });

  const retainedAttestations = (previous?.attestations ?? []).flatMap((attestation) => {
    if (attestation.service === service) return [];
    const ids = attestation.claims.filter(
      (id) => currentById.get(id)?.subject === attestation.service && byId.has(id),
    );
    return ids.length === 0 ? [] : [{ ...attestation, claims: ids }];
  });
  const attestations: ServiceAttestation[] = [
    ...retainedAttestations,
    {
      service,
      commit,
      recorded,
      claims: checklist.claims.filter((c) => localIds.has(c.id)).map((c) => c.id),
      // Filed with the attestation, not the record: the report is one
      // repository's run, and it is pruned or retained with that repository's
      // answers rather than outliving them.
      ...(report === undefined ? {} : { report }),
    },
  ].sort((a, b) => a.service.localeCompare(b.service));

  const confirmed = claims.filter((claim) => claim.verdict === "confirmed").length;
  const unconfirmed = claims.length - confirmed;
  const unanswered = checklist.claims.length - claims.length;

  // Everything the old record answered that the new one does not. The caller
  // prints it; nothing here decides it is acceptable.
  const discarded = (previous?.claims ?? [])
    .filter((claim) => !byId.has(claim.id))
    .map((claim): DiscardedAnswer => ({
      id: claim.id,
      claim: claim.claim,
      ...(claim.subject === undefined ? {} : { subject: claim.subject }),
      reason: currentById.has(claim.id) ? "unattested" : "off-checklist",
    }));

  return {
    verification: {
      schema: 2,
      feature: checklist.feature,
      recorded,
      checklist: checklist.digest,
      summary: { claims: checklist.claims.length, confirmed, unconfirmed, unanswered },
      claims,
      attestations,
    },
    discarded,
  };
}

/**
 * The record as a file. The header explains what the reader is looking at,
 * because the whole point is that this is legible to someone who has never run
 * loam — including the part loam cannot vouch for.
 */
export function renderVerification(v: Verification): string {
  const header = [
    `# Verification record for ${v.feature} — written by \`loam verify ${v.feature}\` (--results / --record).`,
    "#",
    "# Every claim below was derived mechanically from this feature's own artifacts:",
    "# delta.likec4, specs/<svc>/spec.md, specs/<svc>/arch.spec.md and specs/<svc>/",
    "# openapi.yaml. Each verdict names who answered it: `answered_by: runner` means a",
    "# cucumber JSON report's digest-tagged scenarios answered it mechanically;",
    "# `answered_by: agent` means somebody's word about the code, which loam did not",
    "# check. Nothing gates on either.",
    "#",
    "# A `scenario.tested` claim confirmed by an agent is ATTESTED, not run: loam",
    "# reports it as `verify.scenario-attested` and the feature does not count as",
    "# verified until a report answers it. `report:` records the file a --results run",
    "# read — its sha256 and mtime say WHICH file, not that it came from that commit;",
    "# no digest can say that.",
    "#",
    "# `checklist` is a digest of the claim ids. If `loam verify` stops reporting the same",
    "# one, the feature changed after this was recorded and these answers are stale.",
    ...(v.schema === 2
      ? [
          "#",
          "# Schema 2 is federated: each service entry under `attestations` binds its claim ids",
          "# and file:line evidence to that repository's git commit. Missing claims are honestly",
          "# unanswered; another service run may add them without rewriting existing attestations.",
        ]
      : []),
    "",
  ].join("\n");
  // lineWidth 0: never fold a claim onto a second line — these are grepped and diffed.
  return header + stringify(v, { lineWidth: 0 });
}

/**
 * What is on disk beside a feature: nothing, something unreadable, or a record.
 *
 * The three are kept apart because they call for opposite handling. "Absent" is
 * a feature nobody has verified — verify starts a fresh record over it without
 * a second thought. "Unreadable" is a file that IS somebody's record: it parses
 * as garbage, or its shape is not a record's, and every answer and attestation
 * it holds is unaccounted for. Collapsing the two (which this function used to
 * do, returning null for both) meant a hand-edited or half-written
 * verification.yaml read as "not verified" and the next `--record` overwrote a
 * whole fleet's attestations without a word.
 */
export type VerificationRead =
  | { state: "absent" }
  /**
   * `reason` names the YAML line when the parser gave one — the file is the
   * thing to fix. `code` is set for the one unreadable that parses perfectly: a
   * record whose `summary` contradicts its own `claims[]`. That lives here
   * rather than in a state of its own so every reader which already refuses an
   * unreadable record refuses this one too, without a line of new code.
   */
  | { state: "unreadable"; reason: string; code?: "verify.record-miscounted" }
  | { state: "ok"; verification: Verification };

export async function readVerificationState(featureDir: string): Promise<VerificationRead> {
  const path = verificationPath(featureDir);
  if (!existsSync(path)) return { state: "absent" };
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    return { state: "unreadable", reason: err instanceof Error ? err.message : String(err) };
  }
  let doc: unknown;
  try {
    doc = parse(text);
  } catch (err) {
    return { state: "unreadable", reason: yamlReason(err) };
  }
  const verification = asVerification(doc);
  if (verification === null) {
    return {
      state: "unreadable",
      reason:
        "it parses as YAML but does not have a verification record's shape (feature, recorded, checklist, summary and claims)",
    };
  }
  const miscount = summaryDisagreement(verification);
  if (miscount === null) return { state: "ok", verification };
  return {
    state: "unreadable",
    // Spelled twice on purpose: the field is what a caller branches on, the
    // prose is what a terminal prints and what somebody greps for.
    code: "verify.record-miscounted",
    reason: `verify.record-miscounted: ${miscount}`,
  };
}

/**
 * Does the record's `summary` add up from its own `claims[]`?
 *
 * The summary is what wrote the file; the claims are what it answered. Nothing
 * ever compared them, so every reader that took the shortcut — verify's frozen
 * verdict for a shipped feature, list's column, status's block — reported a
 * record full of unconfirmed claims as fully confirmed. Believing either side
 * over the other would be a guess about which half was tampered with, so a
 * record that contradicts itself is refused like any other file loam cannot
 * use. The code is in the reason: it travels wherever the reason is printed.
 */
function summaryDisagreement(v: Verification): string | null {
  const t = tallyAnswers(v.claims);
  const unanswered = v.summary.unanswered ?? 0;
  const says: string[] = [];
  if (v.summary.confirmed !== t.confirmed) {
    says.push(`says ${v.summary.confirmed} confirmed where claims[] holds ${t.confirmed}`);
  }
  if (v.summary.unconfirmed !== t.unconfirmed) {
    says.push(`says ${v.summary.unconfirmed} unconfirmed where claims[] holds ${t.unconfirmed}`);
  }
  if (v.summary.claims !== v.claims.length + unanswered) {
    says.push(
      `says ${v.summary.claims} claim(s)${unanswered === 0 ? "" : ` including ${unanswered} unanswered`} where claims[] holds ${v.claims.length}`,
    );
  }
  return says.length === 0
    ? null
    : `its summary ${says.join(", ")} — the record contradicts itself, so neither half can be believed`;
}

/** A YAML failure with its line, when the parser located one: that line is the fix. */
function yamlReason(err: unknown): string {
  const message = err instanceof Error ? err.message.split("\n")[0]!.trim() : String(err);
  const pos = (err as { linePos?: Array<{ line: number; col: number }> } | null)?.linePos;
  const line = Array.isArray(pos) ? pos[0]?.line : undefined;
  return line === undefined ? `YAML error: ${message}` : `YAML error at line ${line}: ${message}`;
}

/**
 * The record beside a feature, or null when there is none loam can use. Kept
 * for readers that have nothing to say about the difference (`loam list`'s
 * verification column shows one glyph either way); anything that WRITES must
 * use {@link readVerificationState} instead, or it overwrites what it could not
 * read.
 *
 * A record whose summary contradicts its own claims is one of the nulls now, so
 * no reader can print its counts as fact. Reading it as ABSENT is the safe half
 * of the truth and not the whole of it: a reader that can say why should take
 * {@link readVerificationState} and its `code`.
 */
export async function readVerification(featureDir: string): Promise<Verification | null> {
  const read = await readVerificationState(featureDir);
  return read.state === "ok" ? read.verification : null;
}

/**
 * The shape check `readVerification` stands behind: everything its readers
 * dereference (verify's report/frozen views, list's verification column) must
 * be present and typed, or the cast would manufacture a Verification that
 * crashes them. Deliberately no tighter than the readers need: extra keys pass
 * (a human may annotate), `answered_by` stays optional (absent in records that
 * predate `--results`) and is any string, like `kind` — the readers only ever
 * compare them, and a record written by a newer loam must not read as absent.
 */
function asVerification(doc: unknown): Verification | null {
  if (!isRecord(doc)) return null;
  const summary = doc["summary"];
  if (
    typeof doc["feature"] !== "string" ||
    typeof doc["recorded"] !== "string" ||
    typeof doc["checklist"] !== "string" ||
    !isRecord(summary) ||
    !isCount(summary["claims"]) ||
    !isCount(summary["confirmed"]) ||
    !isCount(summary["unconfirmed"]) ||
    (summary["unanswered"] !== undefined && !isCount(summary["unanswered"])) ||
    !Array.isArray(doc["claims"])
  ) {
    return null;
  }
  for (const c of doc["claims"]) {
    if (!isRecord(c)) return null;
    if (typeof c["id"] !== "string" || typeof c["kind"] !== "string" || typeof c["claim"] !== "string") return null;
    if (c["subject"] !== undefined && typeof c["subject"] !== "string") return null;
    if (typeof c["verdict"] !== "string" || !(VERDICTS as readonly string[]).includes(c["verdict"])) return null;
    // The frozen view iterates evidence per claim — a scalar here would crash it.
    if (!Array.isArray(c["evidence"]) || c["evidence"].some((e) => typeof e !== "string")) return null;
    if (c["note"] !== undefined && typeof c["note"] !== "string") return null;
    if (c["answered_by"] !== undefined && typeof c["answered_by"] !== "string") return null;
  }
  if (doc["schema"] !== undefined && doc["schema"] !== 2) return null;
  if (!isConsumedReport(doc["report"])) return null;
  if (doc["attestations"] !== undefined) {
    if (!Array.isArray(doc["attestations"])) return null;
    for (const a of doc["attestations"]) {
      if (!isRecord(a)) return null;
      if (typeof a["service"] !== "string" || typeof a["commit"] !== "string" || typeof a["recorded"] !== "string") return null;
      if (!/^[0-9a-f]{40,64}$/i.test(a["commit"])) return null;
      if (!Array.isArray(a["claims"]) || a["claims"].some((id) => typeof id !== "string")) return null;
      if (!isConsumedReport(a["report"])) return null;
    }
  }
  return doc as unknown as Verification;
}

/** Absent is fine — most records answer nothing from a report. Present must be whole: it is printed. */
function isConsumedReport(v: unknown): boolean {
  if (v === undefined) return true;
  return (
    isRecord(v) &&
    typeof v["path"] === "string" &&
    typeof v["digest"] === "string" &&
    typeof v["mtime"] === "string" &&
    isCount(v["scenarios"])
  );
}

/** A summary count: a finite number. YAML hands back strings for anything quoted. */
function isCount(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export async function writeVerification(featureDir: string, v: Verification): Promise<string> {
  const path = verificationPath(featureDir);
  await writeFile(path, renderVerification(v), "utf8");
  return path;
}
