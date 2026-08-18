/**
 * The docs repo's advisory lock: take it, describe its holder, and break it
 * when that holder is a pid on this host that no longer exists.
 *
 * A module of its own because it is the only rule here that spans the whole
 * fleet rather than one file, and because the two readers of a held lock have
 * to agree on what "stale" means — `breakStaleLock` acts on the answer,
 * `lockIsStale` only reports it to `doctor`. They were written as twins and
 * stay together so they cannot drift into two definitions of a dead holder.
 */
import { link, readFile, unlink, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
// Every `isRecord` below guards a record loam itself wrote and is reading back
// — the lock, the snapshot manifest — whose fields are asked for on the very
// next line, inside a REFUSAL path. `JSON.parse` answers with any JSON value,
// not with an object, and that is where a thrown `TypeError` costs the most: it
// does not make the command fail safely, it replaces a designed refusal with
// `internal`.
import { isRecord } from "../kernel/records.js";
import { quietRm, tempPath } from "./commit.js";

/** The lock file, in the docs repo root — one writer at a time across the whole fleet. */
export const DOCS_LOCK = ".loam-lock";

/**
 * How long a WAITING writer sits out a live holder before answering
 * `docs-busy`. One spelling for every writer that waits — including gherkin,
 * whose lock guards the SERVICE repo's emission root rather than the docs
 * repo: long enough to cover another writer's sub-second commit window with a
 * margin for a loaded host, bounded so a wedged lock cannot hang anyone.
 */
export const LOCK_WAIT_MS = 5_000;

/** Another writer holds the docs repo. Commands map this to the `docs-busy` envelope code. */
export class DocsBusyError extends Error {
  override readonly name = "DocsBusyError";

  constructor(
    readonly lockPath: string,
    holder: string,
  ) {
    super(
      `another loam command is writing this docs repo (${holder}) — nothing was read or written. ` +
        `Wait for it to finish, or remove ${lockPath} if no such command is running.`,
    );
  }
}

/**
 * Take the docs repo's advisory lock for the whole plan+commit window, and
 * return the release.
 *
 * Advisory, and deliberately coarse: the destructive commands write the SAME
 * three shared files (a service spec, a service contract, the one landscape),
 * so two of them overlapping is not a merge to be resolved but a merge one of
 * them computed against a snapshot that no longer exists. Two archives used to
 * plan against the same landscape bytes and the second's splice silently
 * dropped the first's additions — exit 0 on both, and a `validate` that stayed
 * green because the surviving document was perfectly coherent.
 *
 * link(2) over a fully-written sibling is the primitive: as atomic as the
 * O_EXCL create it replaced, needs no daemon, and leaves a file a human can
 * read and delete — but unlike open-then-write, the lock file can never be
 * OBSERVED empty. `writeFile(path, …, "wx")` published existence first and
 * payload a syscall later, and in that window (or after a crash inside it) the
 * lock named no holder: `doctor` now grades exactly that shape as damage whose
 * fix is deletion, so the healthy path must never wear it, even for a
 * microsecond. A create that dies before its link leaves only a staging temp
 * `doctor` already names as litter. A holder that died without releasing would
 * otherwise wedge the repo forever, so a lock naming a pid on THIS host that
 * no longer exists is broken once and retried — two racers could both break
 * the same stale lock, which is why the pre-image check in `swapStaged`
 * remains the second line of defence rather than an optimisation.
 */
/**
 * Distinguishes concurrent acquires INSIDE one process. `tempPath` salts with
 * pid and a millisecond timestamp, which is unique across processes and not
 * within one: two in-process acquirers in the same millisecond shared a temp
 * name, the first's cleanup deleted it under the second, and the second's
 * link(2) surfaced ENOENT as `internal`. A bare counter is module-level
 * mutable state, tolerated here because it feeds nothing but name uniqueness —
 * no behaviour ever branches on its value.
 */
let lockAcquireSeq = 0;

export async function acquireDocsLock(docsDir: string): Promise<() => Promise<void>> {
  const path = join(docsDir, DOCS_LOCK);
  const payload = `${JSON.stringify({ pid: process.pid, host: hostname(), at: new Date().toISOString() })}\n`;
  lockAcquireSeq += 1;
  const tmp = tempPath(path, lockAcquireSeq);
  await writeFile(tmp, payload);
  try {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await link(tmp, path);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
        if (attempt === 0 && (await breakStaleLock(path))) continue;
        throw new DocsBusyError(path, await describeLock(path));
      }
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        await quietRm(path);
      };
    }
  } finally {
    await quietRm(tmp);
  }
}

/**
 * Take the docs lock, waiting out a live holder instead of refusing on first
 * contact. Same lock, different caller contract: `archive` refuses fast because
 * its holder may be mid-merge for seconds and its caller can re-run, but two
 * `verify --record` runs for different services of one feature are BOTH
 * supposed to land — the second must wait for the first's sub-second window and
 * then merge over the record it left, or one service's attestation is refused
 * for no reason a user can see. The wait is bounded: a holder that outlives
 * `waitMs` yields the same `DocsBusyError` the fast form throws, so the caller
 * maps it to `docs-busy` either way and nothing hangs on a wedged lock.
 */
export async function acquireDocsLockWaiting(docsDir: string, waitMs: number): Promise<() => Promise<void>> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      return await acquireDocsLock(docsDir);
    } catch (err) {
      if (!(err instanceof DocsBusyError) || Date.now() >= deadline) throw err;
    }
    // Short enough that a released lock is picked up before a human notices;
    // long enough that the poll does not busy-spin the directory.
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/**
 * One read of the lock file, one interpretation, shared by every question
 * asked about it. These used to be four separate parse-and-guard copies
 * (`breakStaleLock`, `describeLock`, `lockIsStale`, `lockUnreadable`), each
 * catching to a different answer — which is how `doctor` came to read the file
 * three times in a row and report three different states of a lock that was
 * released between its reads.
 *
 * `absent` and `unreadable` are kept apart on purpose: a lock that is GONE is
 * the ordinary end of every command, while a lock that exists and cannot name
 * a holder — empty bytes from a crash between create and flush, JSON that is
 * not a record, a record with no string `host` or numeric `pid` — is damage:
 * `breakStaleLock` rightly refuses to guess about it, so nothing will ever
 * release it. A different host's lock is legible and simply not ours to judge.
 */
type LockHolder =
  | { kind: "absent" }
  | { kind: "unreadable" }
  | { kind: "held"; host: string; pid: number; at: string | undefined };

async function readLockHolder(path: string): Promise<LockHolder> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ENOENT" ? { kind: "absent" } : { kind: "unreadable" };
  }
  let holder: unknown;
  try {
    holder = JSON.parse(text);
  } catch {
    return { kind: "unreadable" };
  }
  // A lock file holding `null` (or a bare string, or an array) is JSON this
  // parses and nothing else understands. The dereference below used to run
  // outside the guard in `acquireDocsLock`'s breaker and threw, replacing the
  // `docs-busy` refusal — the designed answer — with an `internal` envelope.
  if (!isRecord(holder) || typeof holder.host !== "string" || typeof holder.pid !== "number") {
    return { kind: "unreadable" };
  }
  return { kind: "held", host: holder.host, pid: holder.pid, at: typeof holder.at === "string" ? holder.at : undefined };
}

/** Does this pid no longer exist on this host? Signal 0 asks without delivering; EPERM is alive-but-somebody-else's. */
function pidGone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ESRCH";
  }
}

/** Remove a lock whose holder is a dead process on this same host. Returns whether it did. */
async function breakStaleLock(path: string): Promise<boolean> {
  const holder = await readLockHolder(path);
  // Unreadable is deliberately NOT breakable: a lock we cannot understand is
  // the one case where guessing is worst. `doctor` reports it as damage.
  if (holder.kind !== "held" || holder.host !== hostname() || !pidGone(holder.pid)) return false;
  try {
    await unlink(path);
    return true;
  } catch {
    return false;
  }
}

export async function describeLock(path: string): Promise<string> {
  const holder = await readLockHolder(path);
  return holder.kind === "held" ? `pid ${holder.pid} on ${holder.host} since ${String(holder.at)}` : `see ${path}`;
}

/**
 * The lock's whole state for `doctor`, from ONE read. Null means no lock.
 * Three sequential reads used to answer this — exists, describe, stale — and a
 * lock released between them made `doctor` describe a file that was gone,
 * escalating an ordinary sub-second commit window into a blocker.
 */
export async function lockResidue(path: string): Promise<{ holder: string; stale: boolean; unreadable: boolean } | null> {
  const holder = await readLockHolder(path);
  if (holder.kind === "absent") return null;
  if (holder.kind === "unreadable") return { holder: `see ${path}`, stale: false, unreadable: true };
  return {
    holder: `pid ${holder.pid} on ${holder.host} since ${String(holder.at)}`,
    stale: holder.host === hostname() && pidGone(holder.pid),
    unreadable: false,
  };
}

