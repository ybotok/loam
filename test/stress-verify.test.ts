/**
 * Four real processes recording one feature at once — the concurrency the
 * verify lock exists for, scaled past the two-process pins in
 * verify-concurrency.test.ts and asserted on resulting bytes and trees, not
 * exit status alone.
 *
 * The accepted outcomes are stated up front, because the alternative is the
 * exact runner-vs-product ambiguity this suite exists to remove: the docs
 * lock is held across the feature's cold LikeC4 parse in every spawned child,
 * so on a slow host the fourth racer can exhaust the 5-second bounded wait.
 * That is the designed refusal, not a flake — a straggler may exit 1 with
 * error.code docs-busy and nothing else. What may never happen: any other
 * code, a lost attestation from a run that reported success, or a byte
 * changed outside the record.
 */
import { join } from "node:path";
import { existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { coherentFixture, makeProject, treeHashes } from "./helpers/harness.js";
import { readVerificationState } from "../src/core/verify/file.js";
import {
  DIR,
  PAYMENT,
  RECORD,
  SPLIT,
  answersFile,
  serviceClaims,
  serviceRepo,
  spawnRecord,
} from "./helpers/federated.js";
import { assertNoLiveChildren } from "./helpers/cli-process.js";

describe("four simultaneous federated records", () => {
  afterEach(() => assertNoLiveChildren());

  it("lands every winner's attestation whole, touches only the record, and refuses stragglers docs-busy", async () => {
    const p = await makeProject(coherentFixture(), { service: PAYMENT });
    try {
      // The -second repos attest the SAME service from a different checkout —
      // the same-service race — while A vs B is the different-service merge.
      const repoA1 = await serviceRepo(p, SPLIT);
      const repoA2 = await serviceRepo(p, SPLIT, `${SPLIT}-second`);
      const repoB1 = await serviceRepo(p, PAYMENT);
      const repoB2 = await serviceRepo(p, PAYMENT, `${PAYMENT}-second`);
      const runs = [
        { service: SPLIT, repo: repoA1, answers: await answersFile(repoA1, await serviceClaims(p, SPLIT), "proof.ts:1") },
        { service: SPLIT, repo: repoA2, answers: await answersFile(repoA2, await serviceClaims(p, SPLIT), "proof.ts:2") },
        { service: PAYMENT, repo: repoB1, answers: await answersFile(repoB1, await serviceClaims(p, PAYMENT), "proof.ts:1") },
        { service: PAYMENT, repo: repoB2, answers: await answersFile(repoB2, await serviceClaims(p, PAYMENT), "proof.ts:2") },
      ];
      const before = await treeHashes(p.docsDir);
      const results = await Promise.all(runs.map((r) => spawnRecord(r.repo, r.service, r.answers)));

      // Accepted outcomes, and nothing else: success, or the bounded wait's
      // own refusal. The first lock taker cannot lose, so at least one run
      // must land.
      for (const r of results) {
        if (r.code === 0) continue;
        const payload = JSON.parse(r.out) as { error?: { code?: string } };
        expect(payload.error?.code).toBe("docs-busy");
      }
      expect(results.some((r) => r.code === 0)).toBe(true);

      const state = await readVerificationState(join(p.docsDir, DIR));
      expect(state.state).toBe("ok");
      const record = state.state === "ok" ? state.verification : null;
      const attestations = record?.attestations ?? [];
      for (const service of [SPLIT, PAYMENT]) {
        const wins = results.filter((r, i) => r.code === 0 && runs[i]!.service === service);
        const attested = attestations.filter((a) => a.service === service);
        // A service with a winner has exactly ONE whole attestation; the
        // same-service pair collapses to one by design (last writer, whole
        // answer set) — never two, never a blend.
        expect(attested).toHaveLength(wins.length > 0 ? 1 : 0);
        if (wins.length > 0) {
          const evidence = new Set(
            record!.claims.filter((c) => c.subject === service && c.verdict === "confirmed").flatMap((c) => c.evidence ?? []),
          );
          // Whole-record semantics: every confirmed claim cites one run's
          // evidence file, not a mixture of both racers'.
          expect(evidence.size).toBeLessThanOrEqual(1);
        }
      }

      // The tree delta is confined to the record; no lock, no temp survives.
      const after = await treeHashes(p.docsDir);
      const changed = Object.keys({ ...before, ...after }).filter((k) => before[k] !== after[k]);
      expect(changed).toEqual([RECORD]);
      expect(existsSync(join(p.docsDir, ".loam-lock"))).toBe(false);
      expect(Object.keys(after).filter((k) => k.endsWith(".tmp"))).toEqual([]);
    } finally {
      await p.destroy();
    }
  }, 120_000);
});
