/**
 * Member discovery for `loam open` — pure computation, no printing.
 *
 * The hard problem this module solves is binding DIRECTION: each service
 * repo's committed loam.json points AT the docs repo, and the docs repo knows
 * nothing about who points at it. So membership is a join computed at run
 * time — {candidate directory has a loam.json} ∧ {that config resolves its
 * docsDir to this docs repo} — over a deliberately bounded search: a depth-1
 * readdir of a handful of roots, never a disk walk. Same committed files plus
 * same filesystem always produce the same member set, in the same order.
 */
import { realpathSync, statSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { CONFIG_FILENAME, parseConfig, type LoamConfig } from "../envelope/config.js";
import { inOrder } from "../kernel/concurrency.js";
import type { DocsDir } from "../kernel/ids/dirs.js";
import type { ServiceId } from "../kernel/ids/service.js";
import { DocsRepoUnavailableError } from "../repo/state.js";

interface MemberFacts {
  /** Absolute path of the member's repository root. */
  path: string;
  /** Folder display name: the member's service id when bound, else its basename. */
  name: string;
  service: ServiceId | null;
}

/**
 * One folder of the workspace being derived, with where it came from. A
 * variant, not an optional field: `root` exists exactly when the member was
 * found by the scan, and the union makes an always-member carrying a scan
 * root — or a scan member missing one — unrepresentable. One arm per `via`
 * value (not "docs-repo" | "current-repo" folded into one), because a
 * single-literal discriminant is what the checker's narrowing filters on.
 */
export type WorkspaceMember =
  | (MemberFacts & { via: "docs-repo" })
  | (MemberFacts & { via: "current-repo" })
  | (MemberFacts & { via: "scan"; root: string });

/** Everything the scan learned, as data — the command decides what refuses. */
export interface Discovery {
  members: WorkspaceMember[];
  /** The roots actually scanned, deduped, in scan order. */
  scannedRoots: string[];
  /**
   * Roots whose depth-1 listing itself failed. Recorded, never swallowed:
   * "nothing is wrong" and "I could not look" are opposite facts, and only
   * the caller knows whether the root was a degradable default or an explicit
   * `--root` that owes a refusal.
   */
  unreadableRoots: { root: string; problem: string }[];
  /** Candidates whose loam.json exists but cannot be believed — reported, never members. */
  skipped: { path: string; problem: string }[];
  /** Service ids declared by two or more realpath-distinct member checkouts. */
  duplicates: { service: string; paths: string[] }[];
}

export interface DiscoverRequest {
  /** Resolved docs repo root — the identity every candidate binding is compared against. */
  docsDir: DocsDir;
  /** Root of the repo whose loam.json governs this invocation (`config.root`). */
  configRoot: string;
  /** The service that repo declares, when it declares one. */
  service?: ServiceId;
  /** Explicit scan roots. When present they REPLACE the defaults — an explicit scan is exactly what was asked. */
  roots?: string[];
}

/**
 * One directory's identity for "is this the same checkout?" comparisons.
 *
 * Realpath first, because two spellings of one directory (a symlinked sibling,
 * an 8.3 short name, a `..` route) must not become two workspace folders.
 * Case-folded only on win32, because NTFS resolves names case-insensitively
 * and `realpathSync` does not promise canonical case — without the fold,
 * `C:\Repos` and `c:\repos` read as two checkouts of one service and convict
 * an innocent tree of `binding-duplicate`. The fold is NOT applied elsewhere:
 * on a case-sensitive filesystem two genuinely distinct directories may differ
 * only by case, and folding there would silently merge them.
 *
 * `null` means the path names nothing on this machine — for a candidate's
 * docsDir that is the answer "bound to a missing or foreign fleet", never an
 * error.
 */
function identityOf(dir: string): string | null {
  try {
    const real = realpathSync(dir);
    return process.platform === "win32" ? real.toLowerCase() : real;
  } catch {
    // Unresolvable is a fact about the filesystem, not a failure of the scan.
    return null;
  }
}

/** A parsed candidate binding, or the reason it cannot be believed. */
type Candidate =
  | { kind: "config"; config: LoamConfig }
  | { kind: "unreadable"; problem: string }
  | { kind: "absent" };

/** Read and validate one candidate directory's committed binding. */
async function readBinding(dir: string): Promise<Candidate> {
  let raw: string;
  try {
    // The read stays inside the try that classifies it: a loam.json that is a
    // directory, or one whose permissions refuse us, is "exists but cannot be
    // believed", exactly as loadConfig treats the same failures.
    raw = await readFile(join(dir, CONFIG_FILENAME), "utf8");
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    // Not present reads as "not bound to anything" — most siblings of a docs
    // repo are ordinary directories, and silence is the honest answer for them.
    if (e.code === "ENOENT") return { kind: "absent" };
    return { kind: "unreadable", problem: err instanceof Error ? err.message : String(err) };
  }
  try {
    // THE config validator — a second opinion here would let `loam open` count
    // a checkout every other command refuses to load, or vice versa.
    return { kind: "config", config: parseConfig(raw, dir) };
  } catch (err) {
    return { kind: "unreadable", problem: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Depth-1 candidate directories under one scan root, sorted by name so the
 * member set never depends on readdir order — or the reason the root could
 * not be listed at all. The failure is DATA here, not a degrade: whether an
 * unlistable root reads as empty (a default root a CI sandbox denies) or as a
 * refusal (an explicit `--root` that owes an honest answer) is the caller's
 * decision, and this function deciding it would hide the second case forever.
 */
async function candidateDirs(
  root: string,
): Promise<{ kind: "listed"; dirs: string[] } | { kind: "unlistable"; problem: string }> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (err) {
    return { kind: "unlistable", problem: err instanceof Error ? err.message : String(err) };
  }
  const dirs: string[] = [];
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const candidate = join(root, entry.name);
    if (entry.isDirectory()) {
      dirs.push(candidate);
      continue;
    }
    if (!entry.isSymbolicLink()) continue;
    try {
      // A symlinked sibling is a real checkout on its other end — developers
      // link worktrees beside a docs repo — so it is classified by its target.
      if (statSync(candidate).isDirectory()) dirs.push(candidate);
    } catch {
      // A dangling link names nothing; there is no checkout to consider.
    }
  }
  return { kind: "listed", dirs };
}

/**
 * Derive the workspace member set from the committed bindings.
 *
 * The docs repo and the current repo are always members — their bindings are
 * the committed facts `loadConfig` already validated. A scanned sibling is a
 * member iff its loam.json parses and resolves its docsDir to this docs repo.
 * Ordering is deterministic: docs repo, current repo, then scan members
 * sorted by folder name and path.
 *
 * Throws `DocsRepoUnavailableError` when the docs repo's own identity cannot
 * be established — it passed the readiness gate moments ago, so an
 * unresolvable realpath here means it vanished mid-run. Failing closed is the
 * doctrine: comparing candidates against a guessed identity would silently
 * drop every member and answer `no-members` about a fleet nobody scanned.
 */
export async function discoverMembers(req: DiscoverRequest): Promise<Discovery> {
  const docsIdentity = identityOf(req.docsDir);
  if (docsIdentity === null) {
    throw new DocsRepoUnavailableError(
      { kind: "missing", path: req.docsDir },
      `The configured docs repo does not exist: ${req.docsDir}. ` +
        "Fix `docsDir` in loam.json, clone the docs repo there, " +
        "or run `loam init --docs <dir> --create` to make a new one.",
    );
  }
  const seen = new Set<string>([docsIdentity]);
  const docsMember: WorkspaceMember = {
    path: req.docsDir,
    name: basename(req.docsDir),
    service: null,
    via: "docs-repo",
  };

  // Run from the docs repo itself, the current repo IS the docs repo: one
  // member, and it answers as the docs repo — "docs-repo" is the stronger
  // fact. The `?? spelling` fallback only feeds the dedupe key: an
  // unresolvable configRoot still becomes a member, it just dedupes by its
  // own spelling instead of a canonical one.
  const currentIdentity = identityOf(req.configRoot) ?? req.configRoot;
  const currentMember: WorkspaceMember | null = seen.has(currentIdentity)
    ? null
    : {
        path: req.configRoot,
        name: req.service ?? basename(req.configRoot),
        service: req.service ?? null,
        via: "current-repo",
      };
  if (currentMember !== null) seen.add(currentIdentity);

  // Default roots: beside the docs repo and beside the current repo — the
  // side-by-side layout SCHEMA.md's "../docs-repo" example already assumes.
  // Usually one directory; identity-deduped so it is scanned once.
  const scannedRoots: string[] = [];
  const rootIds = new Set<string>();
  for (const root of req.roots ?? [dirname(req.docsDir), dirname(req.configRoot)]) {
    const id = identityOf(root) ?? root;
    if (rootIds.has(id)) continue;
    rootIds.add(id);
    scannedRoots.push(root);
  }

  const unreadableRoots: Discovery["unreadableRoots"] = [];
  const skipped: Discovery["skipped"] = [];
  const scanMembers: WorkspaceMember[] = [];
  // The ROOT loop is sequential on purpose: `seen` is a shared accumulator
  // and "the earlier root wins" is the documented tie-break for a checkout
  // reachable under two roots — scanning roots in parallel would make
  // membership depend on I/O timing. The candidates WITHIN a root carry no
  // such ordering, so their bindings are read through the shared pool;
  // `inOrder` returns them in listing order, which keeps the verdicts below
  // deterministic anyway.
  for (const root of scannedRoots) {
    const listing = await candidateDirs(root);
    if (listing.kind === "unlistable") {
      unreadableRoots.push({ root, problem: listing.problem });
      continue;
    }
    const bindings = await inOrder(listing.dirs, async (dir) => ({
      dir,
      binding: await readBinding(dir),
    }));
    for (const { dir, binding } of bindings) {
      // Identity first, before any verdict: a candidate that already IS a
      // member (the docs repo itself, the current repo, a symlink twin from
      // an earlier root) must not be re-reported — least of all as skipped,
      // which would call one checkout both a member and unreadable.
      const id = identityOf(dir) ?? dir;
      if (seen.has(id)) continue;
      if (binding.kind === "absent") continue;
      if (binding.kind === "unreadable") {
        // Reported, never fatal — "a file loam cannot read is reported, never
        // skipped" — but never a member either: an unreadable binding proves
        // nothing about which fleet the checkout belongs to.
        skipped.push({ path: join(dir, CONFIG_FILENAME), problem: binding.problem });
        continue;
      }
      // The join itself: bound to THIS docs repo, or not a member. `null`
      // (docsDir names nothing here) is a checkout of a missing or foreign
      // fleet — silently out, exactly like one bound elsewhere.
      if (identityOf(binding.config.docsDir) !== docsIdentity) continue;
      seen.add(id);
      scanMembers.push({
        path: dir,
        name: binding.config.service ?? basename(dir),
        service: binding.config.service ?? null,
        via: "scan",
        root,
      });
    }
  }
  scanMembers.sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );

  // Two realpath-DISTINCT checkouts declaring one service id: loam cannot know
  // which one speaks for the service, and a workspace is derived, not guessed.
  // The current repo participates — a scanned twin of the repo you are
  // standing in is the commonest way this happens (a second worktree).
  const byService = new Map<string, string[]>();
  for (const member of [...(currentMember === null ? [] : [currentMember]), ...scanMembers]) {
    if (member.service === null) continue;
    byService.set(member.service, [...(byService.get(member.service) ?? []), member.path]);
  }
  const duplicates = [...byService.entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(([service, paths]) => ({ service, paths }))
    .sort((a, b) => (a.service < b.service ? -1 : a.service > b.service ? 1 : 0));

  return {
    members: [docsMember, ...(currentMember === null ? [] : [currentMember]), ...scanMembers],
    scannedRoots,
    unreadableRoots,
    skipped,
    duplicates,
  };
}
