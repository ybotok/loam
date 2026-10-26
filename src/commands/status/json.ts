/**
 * The `--json` payloads, and the one rule they follow.
 *
 * `issues` go out through `findingJson`, the same serializer `validate` uses:
 * an `Issue` is a `Finding` without details, and one breach reported by two
 * commands must arrive in one shape or a consumer needs two parsers.
 */
import { findingJson } from "../../core/vocabulary/report.js";
import { executableNext } from "../../core/status/actions/execution.js";
import type { FeatureStatusReport, FleetStatusReport } from "../../core/status/report.js";
import type { UseCaseBlastRadius } from "../../core/usecases/touch.js";

export function featureJson(r: FeatureStatusReport): Record<string, unknown> {
  return {
    interrupted: r.interrupted,
    feature: r.feature,
    service: r.service,
    artifacts: r.artifacts,
    checks: {
      ...r.checks,
      issues: r.checks.issues.map((finding) =>
        findingJson(finding, { path: r.feature.path, role: "scope" }),
      ),
    },
    verification: r.verification,
    checklist: r.checklist,
    // Additive (core/envelope/json.ts). Spread key by key rather than passed
    // through whole, so an optional `error` that is absent stays absent instead
    // of arriving as `undefined` — the shape every other payload here keeps.
    useCases: {
      ...radiusJson(r.useCases),
      // The feature's own flows, as `loam delta` carries them: a key of their
      // own, so `flows` keeps meaning the living ones.
      ...(r.featureUseCases === undefined ? {} : { featureFlows: radiusJson(r.featureUseCases) }),
    },
    next: r.next.map(executableNext),
  };
}

/** One blast radius as JSON: an absent `error` stays absent rather than arriving as `undefined`. */
function radiusJson(u: UseCaseBlastRadius): Record<string, unknown> {
  return { unreadable: u.unreadable, ...(u.error === undefined ? {} : { error: u.error }), flows: u.flows };
}

export function fleetJson(r: FleetStatusReport): Record<string, unknown> {
  return {
    interrupted: r.interrupted,
    service: r.service,
    services: r.services,
    features: r.features,
    order: r.order,
    next: r.next.map(executableNext),
    serviceSteps: r.serviceSteps,
  };
}

/* ------------------------------------------------------------------ */
/* Text                                                                */
/* ------------------------------------------------------------------ */
