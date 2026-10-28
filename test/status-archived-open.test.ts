/**
 * Open work does not disappear at archive.
 *
 * Reproduced on the QUICKSTART walk (2026-10-28): a feature archived with one of
 * seven claims confirmed. `loam status <FEAT>` said "archived — not fully
 * verified", and nothing repository-wide said anything — the fleet form walked
 * active features only, and `loam list --needs-work` printed "nothing to do"
 * while the claims stood open. The record is frozen once the feature archives
 * (`loam verify` refuses to re-answer it), so the fleet form now LISTS every
 * archived feature whose verdict is not `verified` — `unverifiedArchived` in
 * `--json`, a section in text, one `next.archived` step each — and the worklist
 * names them instead of denying them.
 */
import { cp, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { printWorklist } from "../src/commands/list/print.js";
import type { ArchivedFeatureState } from "../src/core/status/fleet/report.js";
import { coherentFixture, makeProject, makeTmpDir, runLoam } from "./helpers/harness.js";

const EXAMPLES = fileURLToPath(new URL("../examples/docs", import.meta.url));

interface Step {
  code: string;
  command: string;
  statement: string;
}

interface FleetPayload {
  features: Array<{ id: string }>;
  unverifiedArchived: Array<{ id: string; verification: { state: string; verdict: string } }>;
  next: Step[];
}

async function fleetStatus(dir: string, ...args: string[]): Promise<FleetPayload> {
  const run = await runLoam(dir, "status", ...args, "--json");
  expect(run.code, run.out).toBe(0);
  return JSON.parse(run.stdout) as FleetPayload;
}

describe("an archived feature nobody verified stays on the repository-wide status", () => {
  it("lists it under unverifiedArchived, prints it, and gives it the next.archived step its own status gives", async () => {
    const p = await makeProject(coherentFixture());
    try {
      expect((await runLoam(p.workDir, "archive", "FEAT-1")).code).toBe(0);
      const fleet = await fleetStatus(p.workDir);
      expect(fleet.features).toEqual([]);
      expect(fleet.unverifiedArchived.map((f) => [f.id, f.verification.state])).toEqual([["FEAT-1", "absent"]]);

      // The same step, word for word, `loam status FEAT-1` gives — one builder.
      const own = JSON.parse((await runLoam(p.workDir, "status", "FEAT-1", "--json")).stdout) as { next: Step[] };
      const archivedStep = fleet.next.find((s) => s.code === "next.archived");
      expect(archivedStep).toMatchObject({ command: own.next[0]!.command, statement: own.next[0]!.statement });

      const text = await runLoam(p.workDir, "status");
      expect(text.stdout).toContain("archived, not verified");
      expect(text.stdout).toContain("never verified (no verification record)");
    } finally {
      await p.destroy();
    }
  }, 60_000);

  it("leaves out a verified archived feature, keeps an attested one, and honours --service", async () => {
    const root = await makeTmpDir("loam-archived-open-");
    const dir = join(root, "fleet");
    try {
      await cp(EXAMPLES, dir, { recursive: true });
      const fleet = await fleetStatus(dir);
      const ids = fleet.unverifiedArchived.map((f) => f.id);
      // FEAT-120's record is verified; FEAT-088's rests on an agent's word.
      expect(ids).not.toContain("FEAT-120");
      expect(ids).toContain("FEAT-088");
      expect(fleet.unverifiedArchived.find((f) => f.id === "FEAT-088")!.verification.verdict).toBe("attested");
      // FEAT-088 touches order-service and payment-service, never checkout-web.
      const narrowed = await fleetStatus(dir, "--service", "checkout-web");
      expect(narrowed.unverifiedArchived.map((f) => f.id)).not.toContain("FEAT-088");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("loam list --needs-work does not deny open archived work", () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  afterEach(() => log.mockClear());
  const archived: ArchivedFeatureState[] = [
    {
      id: "FEAT-7",
      title: "Payments",
      dirName: "FEAT-7-payments",
      path: "features/archive/FEAT-7-payments",
      services: ["payment-service"],
      verification: {
        state: "recorded",
        recorded: "2026-10-28",
        verdict: "unverified",
        claims: 7,
        confirmed: 1,
        unconfirmed: 6,
        unanswered: 0,
        attested: 0,
        answered: { runner: 1, "external-runner": 0, agent: 0 },
      },
    },
  ];
  const printed = (): string => log.mock.calls.map((call) => String(call[0])).join("\n");

  it("never says nothing to do over an archived feature with open claims", () => {
    printWorklist([], 3, { archived });
    expect(printed()).not.toContain("nothing to do");
    expect(printed()).toContain("1 archived feature(s) are not verified");
    expect(printed()).toContain("FEAT-7  not fully verified (1 of 7 claim(s) confirmed)");
  });

  it("still says nothing to do when nothing is open anywhere", () => {
    printWorklist([], 3, {});
    expect(printed()).toBe("nothing to do — all 3 service(s) are vouched");
  });

  it("names them after the service rows when services need work too", async () => {
    const p = await makeProject(coherentFixture());
    try {
      expect((await runLoam(p.workDir, "archive", "FEAT-1")).code).toBe(0);
      const res = await runLoam(p.workDir, "list", "--needs-work");
      expect(res.code, res.out).toBe(0);
      expect(res.stdout).toContain("and 1 archived feature(s) are not verified:");
      expect(res.stdout).toContain("FEAT-1  never verified (no verification record)");
    } finally {
      await p.destroy();
    }
  }, 60_000);
});
