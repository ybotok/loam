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
 * evidence, and `--record` writes the answers down beside the feature. The
 * scenario claims do not even take the agent's word: `--results` answers them
 * from a cucumber JSON report, matched by the digest tag `loam gherkin`
 * stamped — only a green run may say a scenario is tested (results.ts).
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
import { elementService, loadFile, serviceOf, type Elem } from "./likec4.js";
import { operationIds } from "./openapi.js";
import { featurePaths, featureSpecPaths, featureSpecServices, servicePaths } from "./repo.js";
import { parseRequirements } from "./spec.js";

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
    const featOps = await operationIds(paths.openapi);
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
          const body = scenarioBodyHash(s.lines);
          scenarios.push({
            ...claim(
              "scenario.tested",
              svc,
              [svc, r.name, s.name, body.slice(0, ID_LENGTH)],
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
          const body = scenarioBodyHash(s.lines, "arch");
          scenarios.push({
            ...claim(
              "scenario.tested",
              svc,
              [svc, "arch.spec.md", r.name, s.name, body.slice(0, ID_LENGTH)],
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
 * The AXIS is part of the identity: an arch scenario salts the body with its
 * file name, so identically-worded scenarios across `spec.md` and
 * `arch.spec.md` can never share a digest. Without the salt a green BUSINESS
 * run answered the arch claim too — an integration test nobody wrote read as
 * run — collapsing the two-questions doctrine exactly where `--results` was
 * supposed to hold it mechanically.
 */
export function scenarioBodyHash(lines: string[], axis: ScenarioAxis = "business"): string {
  // NUL-separated like claimId's tuples: no business body can spell the arch
  // salt by starting with the file name, so the namespaces stay disjoint.
  const body = lines.join("\n").trim();
  return createHash("sha256")
    .update(axis === "arch" ? `arch.spec.md\u0000${body}` : body)
    .digest("hex");
}

/**
 * A digest of the claim id SET — sorted, so reordering the artifacts does not
 * make a record look stale. It changes when a claim is added, removed or
 * reworded, which is exactly when an answer set stops describing the feature.
 */
export function checklistDigest(claims: Claim[]): string {
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
 */
export function checkAnswers(
  claims: Claim[],
  raw: unknown,
  runnerOwned?: ReadonlySet<string>,
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
  const missing = claims.filter((c) => !byId.has(c.id)).map((c) => c.id);
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
      `These answers do not match the checklist — ${parts.join("; ")}. Re-run \`loam verify\` and answer the claims it lists.`,
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

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
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
  claim: string;
  verdict: Verdict;
  /** Who answered — absent only in records written before `--results` existed. */
  answered_by?: AnsweredBy;
  evidence: string[];
  note?: string;
}

export interface Verification {
  feature: string;
  /** The day the answers were recorded. */
  recorded: string;
  /** The checklist digest they answer — how a later reader spots a record gone stale. */
  checklist: string;
  summary: { claims: number; confirmed: number; unconfirmed: number };
  claims: RecordedClaim[];
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
): Verification {
  const byId = new Map(answers.map((a) => [a.id, a]));
  const claims: RecordedClaim[] = checklist.claims.map((c) => {
    const a = byId.get(c.id)!;
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
    "# `checklist` is a digest of the claim ids. If `loam verify` stops reporting the same",
    "# one, the feature changed after this was recorded and these answers are stale.",
    "",
  ].join("\n");
  // lineWidth 0: never fold a claim onto a second line — these are grepped and diffed.
  return header + stringify(v, { lineWidth: 0 });
}

/**
 * Read the record beside a feature. Missing is null, and so is unreadable: a
 * file nobody can parse is not a record of anything, and `--record` overwrites
 * it wholesale anyway.
 */
export async function readVerification(featureDir: string): Promise<Verification | null> {
  const path = verificationPath(featureDir);
  if (!existsSync(path)) return null;
  let doc: unknown;
  try {
    doc = parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
  if (!isRecord(doc) || !Array.isArray(doc["claims"])) return null;
  return doc as unknown as Verification;
}

export async function writeVerification(featureDir: string, v: Verification): Promise<string> {
  const path = verificationPath(featureDir);
  await writeFile(path, renderVerification(v), "utf8");
  return path;
}
