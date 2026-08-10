/**
 * How much of loam may happen at once, and in what order the answers come back.
 *
 * One rule, because there is one resource being rationed: a LikeC4/Langium
 * workspace. `validate --all` opens one per service and per feature, the
 * dependency graph opens one per feature, and an unbounded `Promise.all` over
 * either opens all of them — on a big fleet that is not a faster run, it is a
 * bigger one. The cap and the ordering guarantee travel together because a
 * caller that wants the first cannot afford to lose the second.
 */
import { cpus } from "node:os";

/**
 * How many units of work may be in flight at once.
 *
 * Capped as well as scaled: each in-flight unit holds a whole LikeC4/Langium
 * workspace, so a 64-core box would open sixty-four of them at once and buy
 * memory pressure rather than throughput (peak RSS on an 80-service fleet:
 * 385 MB serial, ~500 MB pooled). That measurement is the entire justification
 * for the cap, and it is why the cap lives with the work rather than inside one
 * command: `loam dependencies` and the fleet form of `loam status` fan out over
 * the same workspaces `validate --all` does, and used to do it uncapped.
 *
 * Do not quote a speedup for this. The measured cost is CPU inside the Langium
 * parse, which one thread cannot divide however the loop is shaped; what the
 * pool overlaps is the I/O half — the spec, contract and health reads around
 * each parse. On an 80-service fleet it measures as a wash (11–13 s either way,
 * on a box that was itself loaded). The number that moves these commands is
 * workspaces per run, not awaits per loop.
 */
export const TARGET_CONCURRENCY = Math.max(1, Math.min(cpus().length, 8));

/**
 * Run `work` over `items` with a bounded number in flight, returning the
 * results in INPUT order.
 *
 * The order is the contract, not an accident: the text report and the `--json`
 * envelope are diffed between runs and between machines, so a concurrent run
 * has to be byte-identical to the serial one for the same input. That is why
 * results are written by index — nothing is appended as it finishes, and a slow
 * item cannot reorder the fleet around it.
 */
export async function inOrder<T, R>(
  items: readonly T[],
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  let next = 0;
  const workers = Math.min(TARGET_CONCURRENCY, items.length);
  await Promise.all(
    Array.from({ length: workers }, async () => {
      for (let i = next++; i < items.length; i = next++) out[i] = await work(items[i]!);
    }),
  );
  return out;
}
