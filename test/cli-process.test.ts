/**
 * The spawned-CLI vocabulary's two guarantees, pinned on themselves: a child
 * that outlives its deadline is killed and reported, and the live-child
 * registry is empty the moment every child has closed.
 *
 * Before this helper existed, cli-entry.test.ts and verify-concurrency's
 * spawns ran with NO timeout — a wedged tsx child leaked past its test and
 * surfaced three files later as a 120-second runner timeout: a failure that
 * reads as runner-policy with a cause that was product-side all along.
 */
import { describe, expect, it } from "vitest";
import { assertNoLiveChildren, spawnProcess } from "./helpers/cli-process.js";

describe("spawnProcess", () => {
  it("kills a child that exceeds its deadline and reports it as never reaching an exit", async () => {
    const result = await spawnProcess(process.execPath, ["-e", "setTimeout(() => {}, 60_000)"], {
      timeoutMs: 500,
    });
    // -1 is the sentinel for "no exit status": the deadline kill must never
    // borrow a real exit code a caller reads meaning into.
    expect(result.code).toBe(-1);
    assertNoLiveChildren();
  });

  it("a child that exits on its own leaves the registry empty", async () => {
    const result = await spawnProcess(process.execPath, ["-e", "process.exit(0)"]);
    expect(result.code).toBe(0);
    assertNoLiveChildren();
  });
});
