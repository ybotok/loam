/**
 * The read verbs: `subsystem list` (the tree with member and unfiled counts)
 * and `subsystem history` (how a service or subsystem moved, asked of git).
 *
 * `history` stays inside the provenance doctrine (`core/provenance/git.ts`):
 * loam asks git and never tells it, and every way git declines reads as "git
 * will not say" — nothing to answer, exit 0, no finding. The question
 * follows a representative FILE (a service's first surviving artifact, a
 * subsystem's marker), because `git log --follow` is defined for one file
 * and prints nothing at all for a directory path; each hop's directories are
 * read off the file's own rename record.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { DocsDir } from "../../core/kernel/ids/dirs.js";
import { emitJson, fail, repoPath } from "../../core/envelope/json.js";
import { gitRenameHops, gitRenamePairingAmbiguous } from "../../core/provenance/gitq/moves.js";
import { servicePathsAt } from "../../core/repo/paths.js";
import { listFleetTree } from "../../core/repo/repo.js";
import { findInTree, nearestTreeNames, servicesUnder, treeNames } from "../../core/repo/tree/find.js";
import { SUBSYSTEM_MARKER } from "../../core/repo/tree/marker.js";
import type { SubsystemEntry } from "../../core/repo/tree/walk.js";

export async function runList(docsDir: DocsDir, json: boolean): Promise<void> {
  const tree = await listFleetTree(docsDir);
  const sorted = [...tree.subsystems].sort((a, b) => (a.path.join("/") < b.path.join("/") ? -1 : 1));
  const unfiled = tree.services.filter((s) => s.subsystem.length === 0).length;
  const memberCount = (sub: SubsystemEntry): number => servicesUnder(tree, sub).length;
  if (json) {
    emitJson({
      subsystems: sorted.map((sub) => ({
        name: sub.name,
        path: repoPath(docsDir, sub.dir),
        title: sub.meta.title ?? null,
        memberCount: memberCount(sub),
      })),
      unfiledServices: unfiled,
      services: tree.services.length,
    });
    return;
  }
  if (sorted.length === 0) {
    console.log(`no subsystems — the fleet is flat (${tree.services.length} service(s), all unfiled).`);
    return;
  }
  console.log(`subsystems (${sorted.length})`);
  for (const sub of sorted) {
    const indent = "  ".repeat(sub.path.length);
    const title = sub.meta.title === undefined ? "" : `  ${sub.meta.title}`;
    console.log(`${indent}${sub.name}${title}  — ${memberCount(sub)} service(s)`);
  }
  console.log(`unfiled: ${unfiled} of ${tree.services.length} service(s)`);
}

export async function runHistory(docsDir: DocsDir, name: string, json: boolean): Promise<void> {
  const tree = await listFleetTree(docsDir);
  const hit = findInTree(tree, name);
  if (hit === null) {
    const close = nearestTreeNames(name, treeNames(tree));
    fail(
      json,
      "unknown-target",
      `No service or subsystem '${name}' in the tree.` +
        (close.length > 0 ? ` Close names: ${close.join(", ")}.` : ""),
    );
    return;
  }
  const kind = hit.kind;
  const file = representativeFile(hit);
  const followed = file === null ? null : await gitRenameHops(docsDir, repoPath(docsDir, file));
  // Every hop is cross-checked against its own commit before it is repeated:
  // `--follow` pairs paths by content, and identical files moved together
  // (empty markers above all) make that pairing a guess — a hop from a
  // directory this subsystem never inhabited. A guessed hop, or a commit the
  // check cannot read, poisons the whole answer, because the hops chain: one
  // untrusted link makes every earlier "from" untrustworthy too.
  let ambiguous = false;
  for (const h of followed ?? []) {
    if ((await gitRenamePairingAmbiguous(docsDir, h.commit, h.to)) !== false) {
      ambiguous = true;
      break;
    }
  }
  const hops = ambiguous ? null : followed;
  const parent = (rel: string): string => rel.slice(0, Math.max(0, rel.lastIndexOf("/")));
  const moves = (hops ?? []).map((h) => ({ from: parent(h.from), to: parent(h.to), commit: h.commit }));
  if (json) {
    // Additive honesty key: `answered: false` is git DECLINING (or nothing to
    // follow, or a rename record too ambiguous to trust), not git answering
    // "never moved" — exit 0 either way, no finding.
    emitJson({ name, kind, moves, answered: hops !== null });
    return;
  }
  if (ambiguous) {
    console.log(
      `git will not say — a commit in this file's history moved identical files together, ` +
        `so \`git log --follow\` pairs them by guesswork and the hops cannot be trusted. No finding either way.`,
    );
    return;
  }
  if (hops === null) {
    console.log(`git will not say — not a repository, git unavailable, or nothing here to follow. No finding either way.`);
    return;
  }
  if (moves.length === 0) {
    console.log(`no recorded moves for '${name}'.`);
    return;
  }
  for (const m of moves) console.log(`${m.from} -> ${m.to}  (${m.commit.slice(0, 7)})`);
}

/**
 * The file whose rename record carries the directory's history: a
 * subsystem's own marker; for a service, the first artifact that exists
 * today, in the fixed artifact order — deterministic, so two runs follow the
 * same file. A service with no artifact on disk gives git nothing to follow.
 */
function representativeFile(hit: NonNullable<ReturnType<typeof findInTree>>): string | null {
  if (hit.kind === "subsystem") return join(hit.subsystem.dir, SUBSYSTEM_MARKER);
  const p = servicePathsAt(hit.service.dir);
  return [p.spec, p.model, p.archSpec, p.openapi, p.asyncapi, p.runbook, p.health].find(existsSync) ?? null;
}
