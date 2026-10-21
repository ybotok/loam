/**
 * The cases a review of the human-output change found the first version
 * getting wrong — each one a sentence that was false for a state the report
 * could reach, or a fold that hid something a reader needed.
 *
 * - The coherence row said "0 would stop archive" over a feature archive
 *   refuses: archive's pre-plan refusals (an unknown service) carry no
 *   `gates`, so a `gating` count cannot say what stops it.
 * - Reading intent.md's title turned a directory in its place into a
 *   `repository-unavailable` refusal of `loam status` and `loam list`.
 * - Under `--service`, the header said "no service delta yet" over a feature
 *   whose services were in the very next row.
 * - The stage sentence guessed "interrupted commit" from an empty `blockedBy`
 *   and "ready to archive" in a form that grades nothing.
 * - Repeat grouping folded one service's five lines and dropped details.
 */
import { describe, expect, it } from "vitest";
import { coherentFixture, FEATURE_SPEC, makeProject, runLoam } from "./helpers/harness.js";
import { repeatedFindings } from "../src/commands/validate/render/repeats.js";
import { stageWords, type StageFacts } from "../src/core/status/feature/words.js";
import type { VerificationState } from "../src/core/status/report.js";
import type { Finding, TargetReport } from "../src/core/vocabulary/report.js";

const NO_RECORD: VerificationState = {
  state: "absent",
  recorded: null,
  verdict: "unverified",
  claims: 0,
  confirmed: 0,
  unconfirmed: 0,
  unanswered: 0,
  attested: 0,
  answered: { runner: 0, "external-runner": 0, agent: 0 },
};

function facts(over: Partial<StageFacts>): StageFacts {
  return {
    stage: "ready",
    archived: false,
    verification: NO_RECORD,
    asked: null,
    missing: [],
    narrowed: false,
    services: 1,
    blockedBy: [],
    interrupted: false,
    blocking: 0,
    ...over,
  };
}

describe("stageWords says only what it was told", () => {
  it("names the interrupted commit even when the feature also waits on another", () => {
    const words = stageWords(facts({ stage: "blocked", blockedBy: ["FEAT-1"], interrupted: true }));
    expect(words).toBe("blocked — an interrupted archive or unarchive has to be recovered first");
    // Without the journal, the dependency is the reason.
    expect(stageWords(facts({ stage: "blocked", blockedBy: ["FEAT-1"] }))).toBe(
      "blocked — waiting on FEAT-1 to archive first",
    );
  });

  it("never claims archive will take a feature the form did not grade", () => {
    expect(stageWords(facts({ stage: "done", blocking: null }))).not.toContain("ready to archive");
    expect(stageWords(facts({ stage: "done", blocking: 0 }))).toContain("ready to archive");
  });

  it("says 'no service delta' from the service count, and admits a narrowed view", () => {
    expect(stageWords(facts({ stage: "missing", services: 0 }))).toBe("being written — no service delta yet");
    expect(stageWords(facts({ stage: "missing", services: 2, narrowed: true }))).toBe(
      "being written — another service's artifacts are not written yet (drop --service to see which)",
    );
    expect(stageWords(facts({ stage: "missing", services: 2, narrowed: true, missing: ["spec (a)"] }))).toBe(
      "being written — not written yet: spec (a) (in this --service view; drop --service for the whole feature)",
    );
  });
});

describe("loam status <FEAT>, against what the gates do", () => {
  it("counts archive's pre-plan refusals among what stops the feature", async () => {
    // A per-service delta for a service that exists nowhere: archive refuses
    // it before planning (`delta.service-unknown`), with no `gates` on the issue.
    const files = coherentFixture();
    files["features/FEAT-1-split/specs/ghost-a/spec.md"] = FEATURE_SPEC.replace(/payment-service/g, "ghost-a");
    const p = await makeProject(files);
    try {
      const archive = await runLoam(p.workDir, "archive", "FEAT-1", "--dry-run", "--json");
      expect(archive.code).toBe(1);
      const out = (await runLoam(p.workDir, "status", "FEAT-1")).stdout;
      const row = out.split(/\r?\n/).find((l) => l.startsWith("  coherence"))!;
      const stopping = Number(/· (\d+) stop it/.exec(row)?.[1]);
      expect(stopping).toBeGreaterThan(0);
      expect(row).not.toContain("would stop archive");
    } finally {
      await p.destroy();
    }
  });

  it("reads an intent.md it cannot open as no title, never as a refusal", async () => {
    const files = coherentFixture();
    delete files["features/FEAT-1-split/intent.md"];
    files["features/FEAT-1-split/intent.md/.gitkeep"] = "";
    const p = await makeProject(files);
    try {
      const fleet = await runLoam(p.workDir, "status", "--json");
      expect(fleet.code, fleet.out).toBe(0);
      expect(JSON.parse(fleet.stdout).features[0].title).toBeNull();
      const list = await runLoam(p.workDir, "list", "features", "--json");
      expect(list.code, list.out).toBe(0);
      expect(JSON.parse(list.stdout).features[0].title).toBeNull();
    } finally {
      await p.destroy();
    }
  });

  it("under --service, does not call a feature with services one with no service delta", async () => {
    // payment-split-service is complete; a second service has only a contract.
    const files = coherentFixture();
    files["features/FEAT-1-split/specs/other-service/openapi.yaml"] = "openapi: 3.0.0\ninfo: {title: x, version: '1'}\npaths: {}\n";
    const p = await makeProject(files);
    try {
      const whole = await runLoam(p.workDir, "status", "FEAT-1", "--json");
      expect(JSON.parse(whole.stdout).feature.stage).toBe("missing");
      const header = (await runLoam(p.workDir, "status", "FEAT-1", "--service", "payment-split-service")).stdout.split(
        /\r?\n/,
      )[0]!;
      expect(header).not.toContain("no service delta yet");
      expect(header).toContain("drop --service");
    } finally {
      await p.destroy();
    }
  });
});

describe("validate's repeat grouping folds only what a counted line can stand for", () => {
  const finding = (over: Partial<Finding>): Finding => ({ severity: "warn", code: "x.repeated", message: "m", ...over });
  const target = (id: string, findings: Finding[]): TargetReport => ({ kind: "service", id, findings });

  it("leaves a service that raises the code twice in its own listing, and folds the rest", () => {
    const twice = [finding({ message: "a1" }), finding({ message: "a2" })];
    const once = ["b", "c", "d", "e"].map((id) => target(id, [finding({ message: id })]));
    const { groups, collapsed } = repeatedFindings([target("a", twice), ...once], () => true);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.services).toEqual(["b", "c", "d", "e"]);
    for (const f of twice) expect(collapsed.has(f)).toBe(false);
  });

  it("never folds a finding that carries details", () => {
    const withDetails = ["a", "b", "c", "d", "e"].map((id) => target(id, [finding({ details: [`${id}/x.md`] })]));
    const { groups, collapsed } = repeatedFindings(withDetails, () => true);
    expect(groups).toHaveLength(0);
    expect(collapsed.size).toBe(0);
  });
});
