/**
 * `docs.binary-behind` — the docs repo was written by a NEWER loam than the one
 * reading it.
 *
 * This is the only finding in the product that changes what a PASS means rather
 * than reporting a defect. Every check loam has is an existence constraint over
 * a value the parser recognised, so a binary that predates a grammar addition
 * does not fail on the newer directive: it reads it as prose, produces no
 * value, has nothing to join, and reports green. The corpus was checked less
 * than the run implies, and before this nothing anywhere said so —
 * `agents.stale` grades only the opposite direction and explicitly declines
 * this case.
 *
 * The tests below pin the three states apart, because collapsing any two of
 * them re-opens the hole: older stamp is `agents.stale` (the file trails),
 * equal is silence, newer is this. And a repo with no stamp at all must stay
 * out of it — that is `agents.stale`'s own missing-stamp arm, not a claim that
 * the binary is behind something.
 */
import { describe, expect, it } from "vitest";
import {
  agentsStaleFinding,
  agentsStampLine,
  binaryBehindFinding,
  versionAhead,
} from "../src/core/agent/agents-stamp.js";

const stamped = (v: string): string => `${agentsStampLine(v)}\n\n# AGENTS\n`;

describe("docs.binary-behind", () => {
  it("fires only when the stamp is ahead of the binary", () => {
    expect(binaryBehindFinding(stamped("0.2.0"), "0.1.0")?.code).toBe("docs.binary-behind");
    expect(binaryBehindFinding(stamped("0.1.0"), "0.1.0")).toBeNull();
    expect(binaryBehindFinding(stamped("0.1.0"), "0.2.0")).toBeNull();
  });

  it("compares prereleases, where a grammar change actually lands", () => {
    // The `agents.stale` comment records why this matters: beta.2 is the
    // release that changed the FORM of every generated file. A check blind to
    // prerelease identifiers is blind to the bump shape most likely to move
    // grammar in a 0.x product.
    expect(versionAhead("0.1.0-beta.4", "0.1.0-beta.3")).toBe(true);
    expect(versionAhead("0.1.0-beta.3", "0.1.0-beta.3")).toBe(false);
    expect(versionAhead("0.1.0-beta.2", "0.1.0-beta.3")).toBe(false);
    // A final release outranks any prerelease of the same triple.
    expect(versionAhead("0.1.0", "0.1.0-beta.9")).toBe(true);
  });

  it("is a warning, and says a pass from this binary is incomplete", () => {
    const f = binaryBehindFinding(stamped("0.9.0"), "0.1.0")!;
    // Warn, not error: a mixed-version fleet is ordinary and failing every
    // command in that repo aims a refusal at the wrong person. `--strict` is
    // the lever for a fleet that wants it to gate.
    expect(f.severity).toBe("warn");
    expect(f.message).toContain("0.9.0");
    expect(f.message).toContain("green");
    // It must never send anyone to edit AGENTS.md: the documents are right.
    expect(f.message).not.toContain("stamp line");
  });

  it("stays out of the cases that belong to agents.stale", () => {
    // No file, and no stamp: both are silence here and a finding there.
    expect(binaryBehindFinding(null, "0.1.0")).toBeNull();
    expect(binaryBehindFinding("# AGENTS\nno stamp\n", "0.1.0")).toBeNull();
    expect(agentsStaleFinding("# AGENTS\nno stamp\n", "0.1.0")?.code).toBe("agents.stale");
    // The two never fire together on one file — they are opposite directions.
    const older = stamped("0.1.0");
    expect(agentsStaleFinding(older, "0.2.0")?.code).toBe("agents.stale");
    expect(binaryBehindFinding(older, "0.2.0")).toBeNull();
  });
});
