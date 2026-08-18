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
import { readFile, unlink, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
// Every `isRecord` below guards a record loam itself wrote and is reading back
// — the lock, the snapshot manifest — whose fields are asked for on the very
// next line, inside a REFUSAL path. `JSON.parse` answers with any JSON value,
// not with an object, and that is where a thrown `TypeError` costs the most: it
// does not make the command fail safely, it replaces a designed refusal with
// `internal`.
import { isRecord } from "../kernel/records.js";
import { quietRm } from "./commit.js";

/** The lock file, in the docs repo root — one writer at a time across the whole fleet. */
export const DOCS_LOCK = ".loam-lock";

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
 * O_EXCL create is the primitive: it is atomic on every filesystem loam runs
 * on, needs no daemon, and leaves a file a human can read and delete. A holder
 * that died without releasing would otherwise wedge the repo forever, so a lock
 * naming a pid on THIS host that no longer exists is broken once and retried —
 * two racers could both break the same stale lock, which is why the pre-image
 * check in `swapStaged` remains the second line of defence rather than an
 * optimisation.
 */
export async function acquireDocsLock(docsDir: string): Promise<() => Promise<void>> {
  const path = join(docsDir, DOCS_LOCK);
  const payload = `${JSON.stringify({ pid: process.pid, host: hostname(), at: new Date().toISOString() })}\n`;
  for (let attempt = 0; ; attempt += 1) {
    try {
      await writeFile(path, payload, { flag: "wx" });
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

/** Remove a lock whose holder is a dead process on this same host. Returns whether it did. */
async function breakStaleLock(path: string): Promise<boolean> {
  let holder: unknown;
  try {
    holder = JSON.parse(await readFile(path, "utf8"));
  } catch {
    // Unreadable or not ours to interpret — treat it as held. A lock file we
    // cannot understand is the one case where guessing is worst.
    return false;
  }
  // A lock file holding `null` (or a bare string, or an array) is JSON this
  // parses and nothing else understands. Treat it as held, exactly as an
  // unparseable one is: the dereference below used to run outside the try and
  // threw out of `acquireDocsLock`, replacing the `docs-busy` refusal — the
  // designed answer — with an `internal` envelope.
  if (!isRecord(holder)) return false;
  if (holder.host !== hostname() || typeof holder.pid !== "number") return false;
  try {
    // Signal 0 asks "does this pid exist" without delivering anything. EPERM
    // means it exists and belongs to somebody else — alive either way.
    process.kill(holder.pid, 0);
    return false;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ESRCH") return false;
  }
  try {
    await unlink(path);
    return true;
  } catch {
    return false;
  }
}

export async function describeLock(path: string): Promise<string> {
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as { pid?: unknown; host?: unknown; at?: unknown };
    return `pid ${String(raw.pid)} on ${String(raw.host)} since ${String(raw.at)}`;
  } catch {
    return `see ${path}`;
  }
}

/** Does the lock name a pid on THIS host that no longer exists? Read-only twin of breakStaleLock. */
export async function lockIsStale(path: string): Promise<boolean> {
  let holder: unknown;
  try {
    holder = JSON.parse(await readFile(path, "utf8"));
  } catch {
    return false;
  }
  // Same shape guard as `breakStaleLock`, for the same reason: this one is read
  // by `doctor`, which must be able to describe a broken repo without becoming
  // the next thing that breaks.
  if (!isRecord(holder)) return false;
  if (holder.host !== hostname() || typeof holder.pid !== "number") return false;
  try {
    process.kill(holder.pid, 0);
    return false;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ESRCH";
  }
}

