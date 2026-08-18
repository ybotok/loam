/**
 * `verification.yaml` itself: rendered, read back, and refused when it cannot
 * be trusted.
 *
 * Reading is not the inverse of rendering here, which is why the two share a
 * module instead of being two halves of a codec. A record loam wrote is
 * re-graded on the way in — unreadable YAML, a shape that is not a
 * verification, a `summary` that disagrees with the claims below it — because
 * the file is data meant to survive without loam, and anything may have edited
 * it since. Putting the rendered bytes ON DISK is a separate concern with its
 * own failure modes: races and kills mid-write live in `store/commit.ts`, and
 * the lock that serialises writers is taken by `commands/verify/verify.ts`
 * before this module's authoritative read. Nothing here touches the
 * filesystem except to read.
 */
import { lstat, readFile } from "node:fs/promises";
import { parse, stringify } from "yaml";
import { isRecord } from "../kernel/records.js";
import { VERDICTS } from "./answers.js";
import { tallyAnswers, verificationPath, type Verification } from "./record.js";

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
  /**
   * `raw` is the exact bytes `verification` was parsed from. A writer merges
   * over the PARSE, but commits over the BYTES: `commitVerification` compares
   * these against the file immediately before its swap, so an edit that landed
   * between this read and that write — an editor, a writer that ignored the
   * docs lock — is refused and preserved instead of silently buried.
   */
  | { state: "ok"; verification: Verification; raw: Buffer };

export async function readVerificationState(featureDir: string): Promise<VerificationRead> {
  const path = verificationPath(featureDir);
  let raw: Buffer;
  try {
    raw = await readFile(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      // ENOENT is "absent" — except from a symlink whose target is gone, which
      // `existsSync` used to fold into the same answer. That mislabel was a
      // trap: the read said "no record" while the commit's exclusive link(2)
      // saw the link itself and refused EEXIST, so every `--record` answered
      // `record-raced` with advice (re-run) that could never work. The lstat
      // must CONFIRM the link before the message asserts one: a real file can
      // also appear between the two calls, and telling its owner to "remove
      // the link" would delete a valid record.
      let entry;
      try {
        entry = await lstat(path);
      } catch {
        return { state: "absent" };
      }
      if (entry.isSymbolicLink()) {
        return {
          state: "unreadable",
          reason: "it is a symlink whose target does not exist — replace the link with a real record, or remove it",
        };
      }
      return {
        state: "unreadable",
        reason: "it appeared while being read — another writer is landing; re-run",
      };
    }
    return { state: "unreadable", reason: err instanceof Error ? err.message : String(err) };
  }
  let doc: unknown;
  try {
    doc = parse(raw.toString("utf8"));
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
  if (miscount === null) return { state: "ok", verification, raw };
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
  // Before the arithmetic, because a negative count defeats it: `unanswered:
  // -2` is never something loam wrote, and it is the one value that lets a
  // hand-edited summary balance its own books — every comparison below then
  // agrees, and a record contradicting its claims reported `verified`.
  for (const [field, value] of Object.entries(v.summary)) {
    if (typeof value === "number" && value < 0) says.push(`carries a negative count (${field}: ${value})`);
  }
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

/**
 * A summary count: an integer. YAML hands back strings for anything quoted.
 * Negativity is deliberately NOT checked here: a negative count is a summary
 * that disagrees with the claims below it, and `summaryDisagreement` owns that
 * refusal — failing the SHAPE check instead made the message list five keys
 * that were all present, while the miscount branch one call away holds the
 * advice the case actually needs.
 */
function isCount(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v);
}

