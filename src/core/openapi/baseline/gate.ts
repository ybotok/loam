/**
 * The baseline axis of the feature gate: which of the surfaces this delta
 * SPELLS does it actually edit? A feature's openapi.yaml needs only what it
 * changes, but it may quote more — and until the pins existed the merge
 * upserted quotations too, which reverted whatever had landed on them since.
 *
 * Extracted from `coherence/declared.ts` when the operation pin grew its two
 * sibling surfaces (path-item non-method keys, components): the grading is one
 * subject with three families, and coherence/ is at its file limit. Everything
 * here is graded by the ONE classifier in `../digest.ts` over the ONE surface
 * enumeration in `./record.ts`, so the gate, the rebase plan and the merge
 * cannot drift into different ideas of what a delta restates.
 */
import { parse } from "yaml";
import type { Issue } from "../../vocabulary/issue.js";
import type { OpenapiDoc } from "../doc.js";
import {
  classifyBaselineDigests,
  OPENAPI_BASELINE_KEY,
  OPENAPI_BASELINES_KEY,
  OPERATION_DIGEST_LENGTH,
  OPERATION_DIGEST_RE,
  valueDigest,
} from "../digest.js";
import { entryFor, readBaselineRecord, restatedSurfaces, surfaceIn } from "./record.js";

/** Everything the gate needs about one service's pair of contracts. */
export interface BaselineGateInput {
  /** The FEATURE contract as `readOpenapi` parsed it — ops carry digests and pins. */
  featDoc: OpenapiDoc;
  /** The LIVING contract's parse; empty when the file is absent. */
  livingDoc: OpenapiDoc;
  /** The feature contract's text — the surface record and values are read from it. */
  featureText: string;
  /** The living contract's text, or undefined when no living contract exists. */
  livingText: string | undefined;
  service: string;
  featureId: string;
}

/**
 * Grade every baseline this feature contract carries — operation pins,
 * path-item keys, components — against the living contract. Slot-keyed for
 * operations, (path, key)-keyed and (kind/name)-keyed for the record, exactly
 * as the merge writes. With no living side there are no surface checks at all:
 * everything the delta spells is new, and a baseline only means something for
 * a value that already exists.
 */
export function openapiBaselineIssues(input: BaselineGateInput): Issue[] {
  const { featDoc, livingDoc, service, featureId } = input;
  const issues: Issue[] = [];
  const livingBySlot = new Map(livingDoc.ops.map((op) => [`${op.method} ${op.path}`, op]));
  let unpinned = 0;
  for (const op of featDoc.ops) {
    // A removal marker is not a restatement of anything; its own exactness
    // check (`openapi.remove-target-mismatch`) already guards the slot.
    if (op.remove) continue;
    const where = `${op.method.toUpperCase()} ${op.path}`;
    const livingOp = livingBySlot.get(`${op.method} ${op.path}`);
    if (op.basedOn !== undefined && !OPERATION_DIGEST_RE.test(op.basedOn)) {
      issues.push({
        severity: "error",
        code: "openapi.baseline-invalid",
        subject: service,
        message: `${service}: ${where} has invalid ${OPENAPI_BASELINE_KEY} '${op.basedOn}' — expected ${OPERATION_DIGEST_LENGTH} lowercase hex characters, as \`loam rebase\` writes them`,
      });
      continue;
    }
    const verdict = classifyBaselineDigests(op.basedOn, op.digest, livingOp?.digest);
    if (verdict === "unfounded") {
      // Three ways here, and the message must not pick the wrong one for the
      // author. A pin is only ever written over a living operation, so a pin
      // with nothing living behind it usually means the operation was there
      // and LEFT — a parallel feature retired it, or MOVED it to another slot
      // (moving an endpoint is the most common contract edit there is). This
      // used to say "drop the marker", and dropping it is exactly how the
      // quote then archived as an addition and put the operation back — and
      // for a move the retirement advice is wrong too: the id still lives, so
      // archiving past `openapi.op-revived` would answer it at both slots.
      // The living contract says which: a move leaves the id at another slot
      // (and so does a retirement here followed by a re-add there, which
      // reads the same from this side). The third way — a pin hand-written
      // onto a genuinely new operation — is the rare one. The two addresses
      // are a condition ("while it still lives there"), not a forecast: a
      // delta swapping the id back defines another operation at the address
      // it lives at, with or without an operationId, and the merge replaces
      // it there. The revival check (coherence/retired/revival/) reads the
      // contract that merge would write and stands down whenever it answers
      // the id at one address, so this must not tell the author otherwise —
      // and for that delta a removal marker at the address cannot be written
      // beside the other operation, hence the second remedy.
      const movedTo = livingDoc.ops.filter((l) => !l.remove && l.id === op.id).map((l) => `${l.method.toUpperCase()} ${l.path}`);
      issues.push({
        severity: "error",
        code: "openapi.baseline-invalid",
        subject: service,
        message: movedTo.length > 0
          ? `${service}: ${where} ('${op.id}') carries ${OPENAPI_BASELINE_KEY}, but the living contract has no operation at that slot — '${op.id}' lives at ${movedTo.join(" and ")} now: a parallel feature moved it there (or retired it here, and another re-added it there). Re-read it there and delete this operation from the delta, making any change at its new address; archived while it still lives there, it would put '${op.id}' back at ${where} as well, one operationId at two addresses. To move it back on purpose, drop the pin and add a removal marker for '${op.id}' at ${movedTo.join(" and ")} to this delta, or define another operation there.`
          : `${service}: ${where} ('${op.id}') carries ${OPENAPI_BASELINE_KEY}, but the living contract has no operation at that slot — the version it was pinned to is gone. If a parallel feature retired it, re-read the living contract and delete this operation from the delta, unless this feature deliberately brings it back (then drop the pin and archive with --approve past \`openapi.op-revived\`). A genuinely new operation has no living version to be based on and carries no pin.`,
      });
    } else if (verdict === "stale") {
      issues.push({
        severity: "error",
        code: "openapi.baseline-stale",
        subject: service,
        message: `${service}: ${where} ('${op.id}') was written against living version ${op.basedOn}, but the living contract now holds ${livingOp!.digest} — somebody landed a change to it in between, and merging this would replace theirs outright. Re-read the living operation, fold in what you still mean, then run \`loam rebase ${featureId}\`.`,
      });
    } else if (verdict === "unpinned" && livingOp !== undefined) {
      // Counted, not listed. A delta over a thirty-operation service quotes
      // twenty-nine of them, and twenty-nine identical warnings naming a fix
      // that is ONE command teaches people to filter the code out.
      unpinned += 1;
    }
  }

  // The two surfaces the operation pin cannot reach, graded from the
  // `x-loam-baselines` record by the same classifier. Unreadable documents
  // never get here on the feature side (`openapi.invalid` suspends the axis);
  // an unreadable LIVING side is that contract's own `openapi.invalid`, and
  // grading against its empty parse would call every restatement new.
  const missing = { keys: 0, components: 0 };
  if (input.livingText !== undefined && !featDoc.unreadable && !livingDoc.unreadable) {
    const featPlain: unknown = parse(input.featureText);
    const livingPlain: unknown = parse(input.livingText);
    const { record, problems } = readBaselineRecord(featPlain);
    for (const problem of problems) {
      issues.push({
        severity: "error",
        code: "openapi.baseline-invalid",
        subject: service,
        message: `${service}: ${problem} — the record is \`loam rebase\`'s bookkeeping and cannot be graded as it stands; re-run \`loam rebase ${featureId}\` to rebuild it`,
      });
    }
    const surfaces = restatedSurfaces(featPlain);
    // An entry pinning a surface the delta does not restate is a claim about
    // nothing — usually a surface the author deleted after rebasing. Distinct
    // from `unfounded` below, where the surface IS restated and the LIVING
    // side is what vanished.
    const restated = new Set(surfaces.map((s) => (s.kind === "path-item" ? `${s.path}\0${s.key}` : s.id)));
    for (const [path, keys] of Object.entries(record.pathItems)) {
      for (const key of Object.keys(keys)) {
        if (restated.has(`${path}\0${key}`)) continue;
        issues.push({
          severity: "error",
          code: "openapi.baseline-invalid",
          subject: service,
          message: `${service}: ${OPENAPI_BASELINES_KEY} pins '${key}' (${path}), but this feature's openapi.yaml does not restate that key — re-run \`loam rebase ${featureId}\` to rebuild the record`,
        });
      }
    }
    for (const id of Object.keys(record.components)) {
      if (restated.has(id)) continue;
      issues.push({
        severity: "error",
        code: "openapi.baseline-invalid",
        subject: service,
        message: `${service}: ${OPENAPI_BASELINES_KEY} pins component '${id}', but this feature's openapi.yaml does not declare it — re-run \`loam rebase ${featureId}\` to rebuild the record`,
      });
    }
    for (const s of surfaces) {
      const label = s.kind === "path-item" ? `path-level key '${s.key}' (${s.path})` : `component '${s.id}'`;
      const entry = entryFor(record, s);
      const living = surfaceIn(livingPlain, s);
      const livingDigest = living.found ? valueDigest(living.value) : undefined;
      const verdict = classifyBaselineDigests(entry, valueDigest(s.value), livingDigest);
      if (verdict === "unpinned") {
        if (living.found) {
          if (s.kind === "path-item") missing.keys += 1;
          else missing.components += 1;
        }
      } else if (verdict === "stale") {
        issues.push({
          severity: "error",
          code: "openapi.baseline-stale",
          subject: service,
          message: `${service}: ${label} was pinned to living version ${entry}, but the living contract now holds ${livingDigest} — somebody landed a change to it in between, and merging this would replace theirs outright. Re-read the living value, fold in what you still mean, then run \`loam rebase ${featureId}\`.`,
        });
      } else if (verdict === "unfounded") {
        issues.push({
          severity: "error",
          code: "openapi.baseline-invalid",
          subject: service,
          message: `${service}: ${label} is pinned to ${entry}, but the living contract no longer has that surface — the pin is structurally unresolvable; re-read the living contract, then run \`loam rebase ${featureId}\``,
        });
      }
    }
  }

  if (unpinned > 0 || missing.keys > 0 || missing.components > 0) {
    // A warning that GATES archive, same doctrine as `delta.baseline-missing`
    // (delta/select.ts): the document is legal, but an unpinned quote is
    // exactly the shape that reverts another feature's landed change at exit
    // 0, and every count covers only values the living contract already has —
    // a genuinely new operation, key or component never trips it. That is
    // also why it cannot see a quote of an operation a parallel feature
    // RETIRED: absent from living, it reads exactly like a new one — nor of
    // one a parallel feature MOVED, quoted at the slot it left, since nothing
    // living stands at that slot. Telling either apart from an addition takes
    // the archived features' removal markers, which this gate never reads —
    // `openapi.op-revived` (core/coherence/retired/) asks that question. `loam rebase` pins a whole service in one command;
    // `--approve` says the unpinned merge is meant.
    issues.push({
      severity: "warn",
      gates: true,
      code: "openapi.baseline-missing",
      subject: service,
      message: `${service}: ${unpinned} operation(s), ${missing.keys} path-level key(s) and ${missing.components} component(s) in this feature's openapi.yaml carry no baseline pin (${OPENAPI_BASELINE_KEY} / ${OPENAPI_BASELINES_KEY}), so the merge cannot tell which ones this delta EDITS from the ones it merely restates — it will upsert all of them, reverting anything that landed on the restated ones. Run \`loam rebase ${featureId} --service ${service}\`, or archive with --approve to merge unpinned deliberately.`,
    });
  }
  return issues;
}
