/**
 * Check 3 of `loam gate`: the verification records of every active feature
 * touching the gated service, read through `verificationState`'s own graded
 * verdicts — never a re-derivation of "verified" (that module's header is the
 * contract). Split from `./checks.ts` when the four checks outgrew the line
 * limit; this is the one check with a per-feature phase of its own, so it is
 * the seam.
 *
 * Without `--since` it reads IN-FLIGHT features only, so a feature leaves the
 * check the moment it is archived — and archive reads no verification record,
 * deliberately (verify never gates the merge). Under `--strict` that made
 * archiving the cheapest way past this check's warning, on a draft service
 * and on a vouched one alike when the feature changed only a contract
 * (`content_digest` covers the spec bodies, not openapi.yaml/asyncapi.yaml, so
 * freshness cannot catch it either). `--since <ref>` closes it without any
 * deployment state: every feature archived after the docs commit the pipeline last
 * deployed from is graded too, by the same `verificationState`, under the
 * same code, its row marked `archived: true` — "archived after" meaning its
 * archive directory was absent at the ref OR differs from what it held there,
 * since a feature unarchived, edited and archived again ships again from the
 * same path. Its record is frozen, but not ungraded: it is held to the
 * checklist `loam archive` captured as the feature merged
 * (`readSnapshotChecklist`), so a record that had stopped answering the
 * feature before it shipped is `stale` — archiving it no longer reads it
 * `verified` again. An archive that captured none (an older loam) is read as
 * frozen history, as before, and the row says so.
 *
 * Report, never fail: every finding here is a warning, by the item's own
 * design — a deploy gate that hard-failed on unverified work would teach
 * everyone that the cheapest way past it is an empty record.
 */
import { inOrder } from "../kernel/concurrency.js";
import { verificationState } from "../status/verification.js";
import { readSnapshotChecklist } from "../staging/snapshot/manifest.js";
import { listFeatures } from "../repo/repo.js";
import { featurePaths } from "../repo/paths.js";
import { compareIds, type FeatureEntry } from "../repo/entries.js";
import type { Finding } from "../vocabulary/report.js";
import type { VerificationState } from "../status/report.js";
import type { VerifyNotice } from "../verify/record.js";
import type { FleetContext } from "../fleet-context.js";
import type { DocsDir } from "../kernel/ids/dirs.js";
import type { RawServiceId } from "../kernel/ids/service.js";
import { unreadableSubject, type GateFeature, type GateSince } from "./report.js";

/**
 * One graded feature. `shipped` is set only on an archived row: the checklist
 * digest its archive captured, or null when it captured none.
 */
interface ReadRow {
  kind: "read";
  feature: FeatureEntry;
  state: VerificationState;
  notice: VerifyNotice | null;
  shipped?: string | null;
}

type VerificationRow = ReadRow | { kind: "unreadable"; finding: Finding };

export interface VerificationCheckRequest {
  docsDir: DocsDir;
  service: RawServiceId;
  fleet: FleetContext;
  since?: GateSince;
}

export async function verificationCheck(
  req: VerificationCheckRequest,
): Promise<{ features: GateFeature[]; findings: Finding[] }> {
  const { since } = req;
  const all = await listFeatures(req.docsDir, { includeArchived: since !== undefined }, req.fleet);
  // "Touching" = carries a specs/<svc>/ delta — the same definition
  // `status --service` answers with. A feature whose C4 delta merely draws an
  // edge into the service is deliberately out: counting it needs a delta parse
  // per active feature, and it can be added additively if a fleet asks. An
  // archived feature keeps its specs/ under features/archive/, so the one
  // definition answers for both sides. "Archived after the ref" is "its
  // archive directory was not there at the ref, or is not what it was there";
  // a feature whose directory was there UNCHANGED shipped in an earlier
  // deploy and is not this one's to answer for (`GateSince`).
  const touching = all
    .filter((f) => f.services.includes(req.service))
    .filter((f) => !f.archived || (since !== undefined && !since.shippedAtRef.has(f.dirName)))
    .sort((a, b) => compareIds(a.id, b.id) || compareIds(a.dirName, b.dirName));
  // COST ACCEPTED: each touching feature with a record derives its checklist,
  // which parses its delta. That is the per-feature cost
  // core/status/fleet/fleet.ts refuses for the WHOLE fleet; a deploy-time
  // command scoped to one service pays it for that service's features only —
  // with the invocation's context threaded through `verificationState` into
  // the derivation, so its enumerations are memo hits (one fleet walk per
  // run, not one per feature) and the batch prefetch below genuinely seeds
  // the delta parses. The prefetch is an accelerator only: a host that cannot
  // batch degrades to per-feature parses with identical findings.
  // An archived feature never derives a checklist (its record is frozen, see
  // `verificationState`, and held to the one its archive captured), so
  // prefetching its delta would parse for nobody.
  await req.fleet.prefetchLikeC4(
    touching.filter((f) => !f.archived && f.has.delta).map((f) => featurePaths(f.dir).delta),
  );
  // inOrder caps the workspaces in flight and keeps the rows in feature order.
  const rows = await inOrder(touching, async (f): Promise<VerificationRow> => {
    try {
      if (!f.archived) {
        const { state, notice } = await verificationState(req.docsDir, f, { fleet: req.fleet });
        return { kind: "read", feature: f, state, notice };
      }
      const shipped = await readSnapshotChecklist(f.dir);
      const { state, notice } = await verificationState(req.docsDir, f, { fleet: req.fleet, shipped });
      return { kind: "read", feature: f, state, notice, shipped };
    } catch (err) {
      return { kind: "unreadable", finding: unreadableSubject("feature", f.id, err) };
    }
  });
  const features: GateFeature[] = [];
  const findings: Finding[] = [];
  for (const row of rows) {
    if (row.kind === "unreadable") {
      findings.push(row.finding);
      continue;
    }
    features.push({
      id: row.feature.id,
      ...row.state,
      ...(row.shipped === undefined ? {} : { archived: true, checklistAtArchive: row.shipped }),
    });
    findings.push(...featureFindings(row, req.service, since?.ref));
  }
  return { features, findings };
}

function featureFindings(
  row: ReadRow,
  service: string,
  since: string | undefined,
): Finding[] {
  const { feature, state, notice } = row;
  if (state.verdict === "verified") return [];
  if (state.verdict === "attested") {
    // attestedNotice's own words — the one notice verify, list and status all
    // show, converted to a Finding rather than re-derived. The code string
    // (`verify.scenario-attested`) is spelled literally at its one emit site,
    // core/verify/record.ts, where the drift guard collects it.
    return notice === null
      ? []
      : [
          {
            severity: notice.severity,
            code: notice.code,
            subject: feature.id,
            message: notice.message,
            ...(notice.claims === undefined ? {} : { details: notice.claims }),
          },
        ];
  }
  const verify = `\`loam verify ${feature.id} --json\``;
  const open = state.unconfirmed + state.unanswered;
  const claimsOpen = `${open} of ${state.claims} claim(s) on ${feature.id} are open (${state.unconfirmed} unconfirmed, ${state.unanswered} unanswered)`;
  const message = (): string => {
    // A row `--since` added. Its record is frozen history: `loam verify` reads
    // it back and refuses to re-record it (commands/verify/verify.ts), so the
    // in-flight remedies below — derive, answer, re-derive — would send a
    // deploy pipeline to a command that cannot run. What it CAN be told is
    // that this deploy carries the feature unchecked, and the one way to
    // reopen it. An archived record is `stale` only against the checklist its
    // archive captured — the feature had moved under it before it shipped.
    if (feature.archived) {
      const shipped = `${feature.id} touches '${service}' and was archived after ${since ?? "the --since ref"}`;
      const reopen = `Its record is frozen history: ${verify} reads it back, and \`loam unarchive ${feature.id}\` re-opens the feature if its claims must be answered before this deploy.`;
      if (state.state === "absent") return `${shipped} with no verification record — nothing was checked before it shipped. ${reopen}`;
      // The file that failed may be one service's `verification/<svc>.yaml`
      // as well as the one-file record; `loam verify` names which.
      if (state.state === "unreadable") return `${shipped} with a verification record that does not read as a record — ${verify} names the file that failed. ${reopen}`;
      if (state.state === "stale") {
        return `${shipped}, and it had moved after its record was written — the record answers a checklist that was no longer the one it asked when it was archived, so what shipped was not what was checked. ${reopen}`;
      }
      return state.claims === 0
        ? `${shipped} with a record that answers no claims at all. ${reopen}`
        : `${shipped}, and ${claimsOpen}. ${reopen}`;
    }
    switch (state.state) {
      case "absent":
        return `${feature.id} touches '${service}' and has no verification record — nothing has been checked. Derive the checklist and answer it: ${verify}.`;
      case "unreadable":
        return `${feature.id}'s verification record does not read as a record — ${verify} names the file that failed and its safe repair (never delete a file other services' attestations may be in); nothing will overwrite it while it is unreadable.`;
      case "stale":
        return `${feature.id} moved after its record was written — the answers answer a checklist that is no longer the one being asked. Re-derive and re-answer: ${verify}.`;
      case "recorded":
        return state.claims === 0
          ? `${feature.id}'s record answers no claims at all — nothing was asked, so nothing was checked. ${verify} re-derives the checklist.`
          : `${claimsOpen} — close them with evidence: ${verify}.`;
      default: {
        // A fifth record state must land here as a build failure, not fall
        // through into some rung nobody decided (verificationStatus holds the
        // same guard for the same reason).
        const unreachable: never = state.state;
        throw new Error(`gate: no wording for verification state '${String(unreachable)}'`);
      }
    }
  };
  return [
    {
      severity: "warn",
      code: "gate.feature-unverified",
      subject: feature.id,
      message: message(),
    },
  ];
}
