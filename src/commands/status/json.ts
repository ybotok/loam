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
    // Additive (core/envelope/json.ts). Spread key by key rather than passed
    // through whole, so an optional `error` that is absent stays absent instead
    // of arriving as `undefined` — the shape every other payload here keeps.
    useCases: {
      unreadable: r.useCases.unreadable,
      ...(r.useCases.error === undefined ? {} : { error: r.useCases.error }),
      flows: r.useCases.flows,
    },
    next: r.next.map(executableNext),
  };
}

export function fleetJson(r: FleetStatusReport): Record<string, unknown> {
  return {
    interrupted: r.interrupted,
    service: r.service,
    services: r.services,
    features: r.features,
    order: r.order,
    next: r.next.map(executableNext),
  };
}

/* ------------------------------------------------------------------ */
/* Text                                                                */
/* ------------------------------------------------------------------ */
