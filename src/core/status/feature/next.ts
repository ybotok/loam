/**
 * `next[]` — one feature.
 *
 * The payload's reason to exist. Each entry carries a stable `code` to branch
 * on, one sentence a person can read, and the literal command to run — ordered,
 * first entry first. `command` is the loam invocation that carries the step
 * forward: the one that does the work where loam does it (`rebase`, `archive`),
 * and the one that states or grades the work where the author does it (`delta`,
 * `validate`, `verify`). It is never a command that would write the artifact
 * behind the author's back — loam does not author.
 *
 * `next` is never empty. A feature with nothing outstanding still has a next
 * step (ship it), and a repository with nothing outstanding still has one (keep
 * the fleet green) — an empty array would be indistinguishable from a bug in
 * the caller's own parsing.
 */
import type { Finding } from "../../vocabulary/report.js";
import { recoverStep } from "../interrupted.js";
import type { ArtifactId, ArtifactState, NextStep } from "../report.js";
import { testStep, verifyStep } from "../verification.js";
import { type FeatureState } from "./state.js";

/**
 * Would either gate refuse this? Severity answers `validate`'s question and
 * `gates` answers archive's; a finding that fails EITHER is one an author has
 * work to do about, and collapsing them to `severity === "error"` is how
 * `status` came to print "ship it" beside a warning archive exits 1 on.
 */
export function unshippable(f: Finding): boolean {
  return f.severity === "error" || f.gates === true;
}

/** Codes whose one fix is `loam rebase`: a pin nobody ever wrote, on any of the three axes. */
const UNPINNED = new Set(["delta.baseline-missing", "openapi.baseline-missing", "asyncapi.baseline-missing"]);

export function featureNext(state: FeatureState, boundService: string | undefined): NextStep[] {
  const { feature, services, artifacts, findings, blockedBy, verification, scans, interrupted } = state;
  const id = feature.id;
  // Before the archived shortcut: the interrupted commit may be this feature's
  // own, and "it shipped" is not a thing to tell somebody whose living docs are
  // half-written.
  const first = interrupted === null ? [] : [recoverStep(interrupted)];
  if (feature.archived) {
    return [
      ...first,
      {
        code: "next.archived",
        statement: `${id} is archived — it shipped, and its delta is already folded into the living docs.`,
        command: `loam show ${id} --json`,
      },
    ];
  }

  const steps: NextStep[] = [...first];
  const owed = (kind: ArtifactId, service?: string): ArtifactState | undefined =>
    artifacts.find(
      (a) => a.id === kind && a.status === "missing" && (service === undefined || a.service === service),
    );

  const intent = owed("intent");
  if (intent !== undefined) {
    steps.push({
      code: "next.author-intent",
      statement: `Write ${intent.path} — what ${id} is for, in prose, before anything is derived from it.`,
      command: `loam validate ${id} --json`,
      artifact: "intent",
      path: intent.path,
    });
  }

  if (services.length === 0) {
    steps.push({
      code: "next.touch-service",
      statement: `${id} carries no per-service delta — add specs/<service>/spec.md for every service it changes.`,
      command: "loam list services --json",
    });
  }

  for (const svc of services) {
    const spec = owed("spec", svc);
    if (spec !== undefined) {
      steps.push({
        code: "next.author-spec",
        statement: `Write ${spec.path} — the ADDED/MODIFIED/REMOVED requirements ${id} makes to ${svc}, each with a scenario.`,
        command: `loam delta ${id} --service ${svc} --json`,
        artifact: "spec",
        service: svc,
        path: spec.path,
      });
    }
    const api = owed("openapi", svc);
    if (api !== undefined) {
      steps.push({
        code: "next.author-openapi",
        // Not "the service is not in the living docs": a service adopted
        // without a contract is the commoner case, and that wording sent a
        // reader looking for a directory that was right there. And not "the
        // operations it governs" either — this step also fires for a service
        // the feature INTRODUCES, where owesContract asks nothing about
        // operations and the delta may tag none, so naming them promised the
        // author a list they would go looking for and not find.
        statement: `Write ${api.path} — nothing gives ${svc} a living openapi.yaml, so this feature is the only thing that can write down its API surface.`,
        command: `loam delta ${id} --service ${svc} --json`,
        artifact: "openapi",
        service: svc,
        path: api.path,
      });
    }
  }

  // A requirement with no scenario yields no generated .feature and no
  // scenario.tested claim: a promise that reaches neither the suite nor the
  // done-check, and that nothing downstream will ever mention again. One entry
  // per service rather than per requirement — a delta with forty bare
  // requirements would otherwise BE the payload (validate caps its details for
  // the same reason).
  for (const gap of scans) {
    if (gap.bare.length === 0 || !services.includes(gap.service)) continue;
    steps.push({
      code: "next.author-scenarios",
      statement:
        `${gap.bare.length} requirement(s) in ${gap.service}'s delta have no '#### Scenario:' ` +
        `(starting with '${gap.bare[0]!.name}') — they generate no test and no verify claim.`,
      command: `loam delta ${id} --service ${gap.service} --json`,
      artifact: "spec",
      service: gap.service,
      path: gap.path,
    });
  }

  if (findings.some((f) => UNPINNED.has(f.code))) {
    steps.push({
      code: "next.rebase",
      statement: `${id} carries requirements or operations with no baseline pin — until they have one the merge cannot tell what it EDITS from what it merely quotes.`,
      command: `loam rebase ${id}`,
    });
  }

  if (blockedBy.length > 0) {
    steps.push({
      code: "next.archive-first",
      statement: `${id} builds on ${blockedBy.join(", ")}, which ${blockedBy.length === 1 ? "has" : "have"} to archive first.`,
      command: `loam dependencies ${id} --json`,
    });
  }

  // Everything either gate refuses on, not just the errors: a warning marked
  // `gates: true` stops archive exactly as hard, and leaving it out of the
  // steps was the other half of leaving it out of the stage.
  const blocking = findings.filter(unshippable);
  if (blocking.length > 0) {
    const gating = blocking.filter((f) => f.gates === true && f.severity !== "error").length;
    steps.push({
      code: "next.fix-coherence",
      statement:
        `${id} has ${blocking.length} finding(s) that stop it, starting with ${blocking[0]!.code}` +
        (gating > 0
          ? ` — ${gating} of them ${gating === 1 ? "is a warning that GATES" : "are warnings that GATE"} archive, ` +
            "which `validate` grades valid, so its exit code alone will not show you why archive refuses."
          : " — the axes disagree, and archive refuses."),
      command: `loam validate ${id} --json`,
    });
  }

  // The implementation half of the forward flow, which next[] never named at
  // all: an agent read "author the spec" and then "record the verification",
  // with nothing in between saying where a test comes from — so the only way
  // left to answer a scenario claim was its own word, through `--record`.
  steps.push(...testStep(id, verification, { services, scans, boundService }));
  steps.push(...verifyStep(id, verification, { artifacts, services, boundService }));

  // Always last, and always present: a feature whose every artifact holds and
  // whose record is complete still has one thing left to do, and an empty
  // `next[]` would leave a caller unable to tell "finished" from "this command
  // had nothing to say".
  steps.push({
    code: "next.archive",
    statement:
      steps.length === 0
        ? `${id} is authored, coherent and verified — ship it.`
        : `${id} ships once everything above is done; the dry run writes nothing and lists every file the merge would touch.`,
    command: `loam archive ${id} --dry-run --json`,
  });
  return steps;
}
