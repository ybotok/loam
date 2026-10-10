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
      issues.push({
        severity: "error",
        code: "openapi.baseline-invalid",
        subject: service,
        message: `${service}: ${where} ('${op.id}') carries ${OPENAPI_BASELINE_KEY}, but the living contract has no operation at that slot — a new operation has no living version to be based on; drop the marker`,
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
    // RETIRED: absent from living, it reads exactly like a new one. Telling
    // the two apart takes the archived features' removal markers, which this
    // gate never reads — `openapi.op-revived` (core/coherence/retired/) asks
    // that question. `loam rebase` pins a whole service in one command;
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
