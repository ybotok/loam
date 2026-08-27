/**
 * Check 3 of `loam gate`: the verification records of every active feature
 * touching the gated service, read through `verificationState`'s own graded
 * verdicts — never a re-derivation of "verified" (that module's header is the
 * contract). Split from `./checks.ts` when the four checks outgrew the line
 * limit; this is the one check with a per-feature phase of its own, so it is
 * the seam.
 *
 * Report, never fail: every finding here is a warning, by the item's own
 * design — a deploy gate that hard-failed on unverified work would teach
 * everyone that the cheapest way past it is an empty record.
 */
import { inOrder } from "../kernel/concurrency.js";
import { verificationState } from "../status/verification.js";
import { listFeatures } from "../repo/repo.js";
import { featurePaths } from "../repo/paths.js";
import { compareIds, type FeatureEntry } from "../repo/entries.js";
import type { Finding } from "../vocabulary/report.js";
import type { VerificationState } from "../status/report.js";
import type { VerifyNotice } from "../verify/record.js";
import type { FleetContext } from "../fleet-context.js";
import type { DocsDir } from "../kernel/ids/dirs.js";
import type { RawServiceId } from "../kernel/ids/service.js";
import { unreadableSubject, type GateFeature } from "./report.js";

type VerificationRow =
  | { kind: "read"; feature: FeatureEntry; state: VerificationState; notice: VerifyNotice | null }
  | { kind: "unreadable"; finding: Finding };

export interface VerificationCheckRequest {
  docsDir: DocsDir;
  service: RawServiceId;
  fleet: FleetContext;
}

export async function verificationCheck(
  req: VerificationCheckRequest,
): Promise<{ features: GateFeature[]; findings: Finding[] }> {
  const active = await listFeatures(req.docsDir, {}, req.fleet);
  // "Touching" = carries a specs/<svc>/ delta — the same definition
  // `status --service` answers with. A feature whose C4 delta merely draws an
  // edge into the service is deliberately out: counting it needs a delta parse
  // per active feature, and it can be added additively if a fleet asks.
  const touching = active
    .filter((f) => f.services.includes(req.service))
    .sort((a, b) => compareIds(a.id, b.id));
  // COST ACCEPTED: each touching feature with a record derives its checklist,
  // which parses its delta. That is the per-feature cost
  // core/status/fleet/fleet.ts refuses for the WHOLE fleet; a deploy-time
  // command scoped to one service pays it for that service's features only —
  // with the invocation's context threaded through `verificationState` into
  // the derivation, so its enumerations are memo hits (one fleet walk per
  // run, not one per feature) and the batch prefetch below genuinely seeds
  // the delta parses. The prefetch is an accelerator only: a host that cannot
  // batch degrades to per-feature parses with identical findings.
  await req.fleet.prefetchLikeC4(
    touching.filter((f) => f.has.delta).map((f) => featurePaths(f.dir).delta),
  );
  // inOrder caps the workspaces in flight and keeps the rows in feature order.
  const rows = await inOrder(touching, async (f): Promise<VerificationRow> => {
    try {
      const { state, notice } = await verificationState(req.docsDir, f, req.fleet);
      return { kind: "read", feature: f, state, notice };
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
    features.push({ id: row.feature.id, ...row.state });
    findings.push(...featureFindings(row, req.service));
  }
  return { features, findings };
}

function featureFindings(
  row: { feature: FeatureEntry; state: VerificationState; notice: VerifyNotice | null },
  service: string,
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
  const message = (): string => {
    switch (state.state) {
      case "absent":
        return `${feature.id} touches '${service}' and has no verification record — nothing has been checked. Derive the checklist and answer it: ${verify}.`;
      case "unreadable":
        return `${feature.id}'s verification.yaml exists but does not read as a record — repair or delete it, then re-run ${verify}; nothing will overwrite it while it is unreadable.`;
      case "stale":
        return `${feature.id} moved after its record was written — the answers answer a checklist that is no longer the one being asked. Re-derive and re-answer: ${verify}.`;
      case "recorded":
        return state.claims === 0
          ? `${feature.id}'s record answers no claims at all — nothing was asked, so nothing was checked. ${verify} re-derives the checklist.`
          : `${open} of ${state.claims} claim(s) on ${feature.id} are open (${state.unconfirmed} unconfirmed, ${state.unanswered} unanswered) — close them with evidence: ${verify}.`;
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
