/**
 * What a file must hold to be a verification record — the shape check and the
 * self-consistency check every file of the record passes on the way in.
 *
 * Moved out of `./file.ts` when the record became several files: that module
 * now owns WHICH files make up a record and how a damaged one is reported,
 * while this one owns what any single file has to say to be read at all. The
 * two are phases — find the files, then grade each — and the grading never
 * needed to know where its bytes came from.
 */
import { isRecord } from "../../kernel/records.js";
import { VERDICTS } from "../answers.js";
import { isEvidencePinList } from "../pins/pin.js";
import { tallyAnswers, type Verification } from "../record.js";

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
export function summaryDisagreement(v: Verification): string | null {
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

/**
 * The shape check `readVerificationState` (`./file.ts`) stands behind:
 * everything its readers
 * dereference (verify's report/frozen views, list's verification column) must
 * be present and typed, or the cast would manufacture a Verification that
 * crashes them. Deliberately no tighter than the readers need: extra keys pass
 * (a human may annotate), `answered_by` stays optional (absent in records that
 * predate `--results`) and is any string, like `kind` — the readers only ever
 * compare them, and a record written by a newer loam must not read as absent.
 */
export function asVerification(doc: unknown): Verification | null {
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
    // Absent fine, present whole — the isConsumedContractReport precedent, and
    // the guard body lives with the pin shape it vouches for (pins/pin.ts). A
    // broken pins block makes the whole record unreadable and therefore never
    // overwritten: skipping it instead would read a hand-damaged record as
    // drift-free.
    if (!isEvidencePinList(c["evidence_pins"])) return null;
  }
  if (doc["schema"] !== undefined && doc["schema"] !== 2) return null;
  if (!isConsumedReport(doc["report"])) return null;
  if (!isConsumedContractReport(doc["contractReport"])) return null;
  if (doc["attestations"] !== undefined) {
    if (!Array.isArray(doc["attestations"])) return null;
    for (const a of doc["attestations"]) {
      if (!isRecord(a)) return null;
      if (typeof a["service"] !== "string" || typeof a["commit"] !== "string" || typeof a["recorded"] !== "string") return null;
      if (!/^[0-9a-f]{40,64}$/i.test(a["commit"])) return null;
      if (!Array.isArray(a["claims"]) || a["claims"].some((id) => typeof id !== "string")) return null;
      // Absent fine, present whole: `gate` and `status` print the flag, so a
      // `dirty: "yes"` must not read as a clean attestation.
      if (a["dirty"] !== undefined && typeof a["dirty"] !== "boolean") return null;
      if (a["uncommitted"] !== undefined && (!Array.isArray(a["uncommitted"]) || a["uncommitted"].some((p) => typeof p !== "string"))) return null;
      if (!isConsumedReport(a["report"])) return null;
      if (!isConsumedContractReport(a["contractReport"])) return null;
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
 * The contract report's pin, exactly as loose as {@link isConsumedReport}:
 * absent fine, present whole — for the fields the readers dereference.
 * `format` is OPTIONAL here even though loam always writes it: nothing in the
 * readers dereferences it (it is provenance for a person, echoed only inside
 * whole-object payloads), and the generated AGENTS.md teaches the pin as
 * path/sha256/mtime/operation-count — so a hand-written block faithful to that
 * teaching must not make the WHOLE record unreadable over a field no reader
 * uses. When present it must be a string, and any string: a record written by
 * a newer loam that learned a second report format must not read as
 * unreadable here.
 */
function isConsumedContractReport(v: unknown): boolean {
  if (v === undefined) return true;
  return (
    isRecord(v) &&
    typeof v["path"] === "string" &&
    typeof v["digest"] === "string" &&
    typeof v["mtime"] === "string" &&
    isCount(v["operations"]) &&
    (v["format"] === undefined || typeof v["format"] === "string")
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
