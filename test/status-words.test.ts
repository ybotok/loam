/**
 * `loam status` tells a person the truth in words they can follow.
 *
 * The stage vocabulary is a frozen machine contract (core/status/report.ts),
 * and nothing here renames it. What these tests pin is the human side and the
 * additive keys beside it, each the repair of something a newcomer misread:
 *
 * - `ready` printed bare over a feature with nothing built or verified read as
 *   "ready to ship"; `done (archived)` over a never-verified feature read as
 *   "shipped and checked"; `next.archive` promised the feature "ships once
 *   everything above is done" although archive checks none of it.
 * - the fleet form put every service's adoption rung ahead of the features, so
 *   on a fleet mid-adoption the cap elided the one feature in flight as "more
 *   step(s) of the same kinds".
 * - in the repository of a service an active feature INTRODUCES, status told
 *   its developer to `loam adopt` code that does not exist yet.
 * - every feature row named an id and never what the change is called.
 */
import { describe, expect, it } from "vitest";
import { coherentFixture, FEATURE_SPEC, makeProject, runLoam, type Project } from "./helpers/harness.js";
import { FLEET_NEXT_LIMIT } from "../src/core/status/fleet/next.js";
import { featureTitle, listFeatures } from "../src/core/repo/repo.js";

interface Step {
  code: string;
  statement: string;
  command: string;
  service?: string;
}

async function statusJson(p: Project, ...args: string[]): Promise<Record<string, any>> {
  const run = await runLoam(p.workDir, "status", ...args, "--json");
  expect(run.code, run.out).toBe(0);
  return JSON.parse(run.stdout);
}

/** Zero-padded so alphabetical and numeric order agree in the expectations. */
const svc = (n: number): string => `svc-${String(n).padStart(2, "0")}`;

/** coherentFixture's one feature, plus `n` undocumented services — one `next.adopt` each. */
function withAdoptionDebt(n: number): Record<string, string> {
  return {
    ...coherentFixture(),
    ...Object.fromEntries(Array.from({ length: n }, (_, i) => [`services/${svc(i + 1)}/.gitkeep`, ""])),
  };
}

describe("one feature, in words", () => {
  it("says what `ready` means, with the claims counted, and keeps the machine value", async () => {
    const p = await makeProject(coherentFixture());
    try {
      const payload = await statusJson(p, "FEAT-1");
      // The contract is untouched: the stage is still the closed value.
      expect(payload.feature.stage).toBe("ready");
      // Additive: the title, and how many claims the feature asks.
      expect(payload.feature.title).toBe("Split payments");
      expect(payload.checklist.claims).toBeGreaterThan(0);

      const human = (await runLoam(p.workDir, "status", "FEAT-1")).stdout;
      const header = human.split(/\r?\n/)[0]!;
      expect(header).toBe(
        `loam status FEAT-1 (Split payments): docs ready — nothing verified yet (0 of ${payload.checklist.claims} claim(s) answered)`,
      );
      // The old header led with the bare word; nothing may print it that way.
      expect(header).not.toMatch(/— ready$/);
      expect(human).toMatch(/^ {2}stage +ready +\(`loam explain ready`/m);
      expect(human).toContain(`verification  none yet — ${payload.checklist.claims} claim(s) to answer`);
      expect(human).toMatch(/^ {4}none yet +verification /m);
    } finally {
      await p.destroy();
    }
  });

  it("never promises that archive checks what it does not", async () => {
    const p = await makeProject(coherentFixture());
    try {
      const next = (await statusJson(p, "FEAT-1")).next as Step[];
      const archive = next.find((s) => s.code === "next.archive")!;
      expect(archive.statement).not.toContain("ships once");
      expect(archive.statement).toContain("checks only the documents — not the code, not the verification record");
    } finally {
      await p.destroy();
    }
  });

  it("says an archived feature nobody verified was never verified, not `done`", async () => {
    const files = coherentFixture();
    // The same feature, moved under features/archive/ — archived, with no record.
    for (const key of Object.keys(files)) {
      if (!key.startsWith("features/FEAT-1-split/")) continue;
      files[key.replace("features/", "features/archive/")] = files[key]!;
      delete files[key];
    }
    const p = await makeProject(files);
    try {
      const payload = await statusJson(p, "FEAT-1");
      expect(payload.feature.archived).toBe(true);
      expect(payload.feature.stage).toBe("done");
      // Nothing is re-derived for history.
      expect(payload.checklist).toBeNull();
      const step = (payload.next as Step[]).find((s) => s.code === "next.archived")!;
      expect(step.statement).not.toContain("shipped");
      expect(step.statement).toContain("never verified (no verification record)");

      const header = (await runLoam(p.workDir, "status", "FEAT-1")).stdout.split(/\r?\n/)[0]!;
      expect(header).toBe("loam status FEAT-1 (Split payments): archived — never verified (no verification record)");
      expect(header).not.toContain("done");
    } finally {
      await p.destroy();
    }
  });
});

describe("the fleet worklist leads with the features", () => {
  it("puts the feature first, and the cap never elides it behind adoption rungs", async () => {
    const debt = FLEET_NEXT_LIMIT + 2;
    const p = await makeProject(withAdoptionDebt(debt));
    try {
      const payload = await statusJson(p);
      const next = payload.next as Step[];
      expect(next[0]!.code).toBe("next.feature");
      expect(next[0]!.command).toBe("loam status FEAT-1 --json");
      // The stage in words, never "FEAT-1 is at 'ready'".
      expect(next[0]!.statement).toBe("FEAT-1 (Split payments): docs ready — nothing verified yet (no verification record).");
      // Still capped, and the elided line counts what it left out by kind.
      const elided = next.find((s) => s.code === "next.elided")!;
      // coherentFixture's payment-service is documented and carries no vouch
      // stamp, so its first vouch is owed behind the adoption rungs.
      expect(elided.statement).toMatch(/^\d+ more step\(s\) were left out \(\d+ next\.adopt, 1 next\.vouch\)/);
      // Every rung, uncapped, beside the list.
      expect(payload.serviceSteps).toEqual([
        {
          code: "next.adopt",
          services: Array.from({ length: debt }, (_, i) => svc(i + 1)),
          command: `loam adopt --service ${svc(1)} --json`,
        },
        { code: "next.vouch", services: ["payment-service"], command: "loam vouch --service payment-service" },
      ]);
      expect(payload.features[0].title).toBe("Split payments");
    } finally {
      await p.destroy();
    }
  });

  it("folds the adoption backlog into one counted line under the features", async () => {
    const debt = FLEET_NEXT_LIMIT + 2;
    const p = await makeProject(withAdoptionDebt(debt));
    try {
      const out = (await runLoam(p.workDir, "status")).stdout;
      const steps = out.split(/\r?\n/).filter((l) => /^ {4}\d+\. /.test(l));
      expect(steps[0]).toMatch(/^ {4}1\. next\.feature: FEAT-1 \(Split payments\): docs ready/);
      expect(steps[1]).toMatch(new RegExp(`^ {4}2\\. next\\.adopt ×${debt}: ${debt} services with no spec\\.md`));
      expect(steps[1]).toContain(`, +${debt - 6} more.`);
      // One line for the whole backlog, and no "same kinds" elision line.
      expect(steps.filter((l) => l.includes("next.adopt"))).toHaveLength(1);
      expect(out).not.toContain("next.elided");
      expect(steps.at(-1)).toMatch(/next\.fleet-gate/);
      // The feature row names the change and says where it stands in words.
      expect(out).toMatch(/^ {4}FEAT-1 +Split payments$/m);
      expect(out).toContain("docs ready — nothing verified yet (no verification record) · payment-split-service");
      expect(out).not.toMatch(/^ {4}ready +FEAT-1/m);
    } finally {
      await p.destroy();
    }
  });
});

describe("a repository bound to a service its feature introduces", () => {
  /** coherentFixture, with FEAT-1 also introducing `split-service` — a specs/ directory and no services/ one. */
  function introducing(): Record<string, string> {
    return {
      ...coherentFixture(),
      "features/FEAT-1-split/specs/split-service/spec.md": FEATURE_SPEC.replace(/payment-service/g, "split-service"),
    };
  }

  it("points at the feature, never at `loam adopt` for code that does not exist yet", async () => {
    const p = await makeProject(introducing(), { service: "split-service" });
    try {
      const next = (await statusJson(p)).next as Step[];
      expect(next.map((s) => s.code)).not.toContain("next.adopt-bound");
      expect(next[0]!.code).toBe("next.feature");
      expect(next[0]!.command).toBe("loam status FEAT-1 --json");
      expect(next[0]!.statement).toContain("'split-service', which FEAT-1 introduces");
      // The introducing feature is named once, first — not again below.
      expect(next.filter((s) => s.command === "loam status FEAT-1 --json")).toHaveLength(1);
    } finally {
      await p.destroy();
    }
  });

  it("still sends a bound service nobody introduces to adopt it", async () => {
    // The counterfactual: the same tree, bound to a name no feature carries.
    const p = await makeProject(introducing(), { service: "ghost-service" });
    try {
      const next = (await statusJson(p)).next as Step[];
      expect(next[0]!.code).toBe("next.adopt-bound");
      expect(next[0]!.command).toBe("loam adopt --service ghost-service --json");
    } finally {
      await p.destroy();
    }
  });
});

describe("featureTitle", () => {
  it("prefers the frontmatter title, falls back to the H1 without the id, and is null with neither", async () => {
    const p = await makeProject({
      ...coherentFixture(),
      "features/FEAT-2-h1/intent.md": "# FEAT-2 — Refund a payment\n\nWhy.\n",
      "features/FEAT-3-titled/intent.md": "---\nfeature: FEAT-3\ntitle: Retire the v1 API\n---\n\n# Something else\n",
      "features/FEAT-4-bare/delta.likec4": "model {}\n",
    });
    try {
      const features = await listFeatures(p.docsDir);
      const titles = Object.fromEntries(
        await Promise.all(features.map(async (f) => [f.id, await featureTitle(f)] as const)),
      );
      expect(titles).toEqual({
        "FEAT-1": "Split payments",
        "FEAT-2": "Refund a payment",
        "FEAT-3": "Retire the v1 API",
        "FEAT-4": null,
      });
    } finally {
      await p.destroy();
    }
  });
});
