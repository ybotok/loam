/**
 * `loam rebase` — pin a feature's MODIFIED/REMOVED requirements to the living
 * text they are written against.
 *
 * The counterpart to `loam vouch`: vouch stamps a digest of the CODE a living
 * spec was written from, this stamps a digest of the LIVING REQUIREMENT a delta
 * was written from. Both exist so a later `loam validate` can tell "still true"
 * from "something moved underneath", and both are worth exactly what they claim
 * — so this command computes every pin from what is on disk right now and never
 * invents one for a requirement that addresses nothing living.
 *
 * It is the fix `delta.baseline-stale` sends people to, which is why the
 * rewrite is line SURGERY rather than a reserialize: a delta document is
 * authored prose — section headings, comments, the order the author chose — and
 * `serializeRequirements` would flatten all of it into a bare requirement run.
 * One line changes per requirement; every other byte is copied.
 *
 * Restamping is the LAST step of resolving a collision, never the resolution
 * itself: a pin says "I read this version", so running it without re-reading
 * makes it a lie with a digest on it. The output says so on the way out.
 */
import type { Command } from "commander";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { loadConfig } from "../core/config.js";
import { InvalidIdError, assertServiceId } from "../core/ids.js";
import { emitJson, fail, repoPath, reportNoConfig } from "../core/json.js";
import {
  compareIds,
  featureSpecPaths,
  missingFeatureMessage,
  resolveFeature,
  servicePaths,
  SPEC_AXES,
  type SpecAxis,
} from "../core/repo.js";
import {
  DocsBusyError,
  acquireDocsLock,
  message,
  rollbackStaged,
  stageWrites,
  swapStaged,
  type PlannedWrite,
} from "../core/staging.js";
import { parseRequirements, requirementDigest, type Requirement } from "../core/spec.js";

interface RebaseOptions {
  service?: string;
  json?: boolean;
  dryRun?: boolean;
}

/** What happened to one MODIFIED/REMOVED requirement's pin. */
type PinStatus =
  /** It had none and now has one. */
  | "pinned"
  /** It had a pin for an older version of the living requirement; it now names the current one. */
  | "repinned"
  /** It already named the current living version — no write. */
  | "unchanged"
  /**
   * It addresses nothing in the living spec — a MODIFIED of a requirement
   * another feature in flight still introduces, most often. There is no version
   * to be based on yet, so inventing a pin would be inventing a baseline;
   * `loam validate` already reports the ordering (`delta.modified-pending`).
   */
  | "unresolved";

interface PinOutcome {
  service: string;
  /** The axis's filename — "spec.md" or "arch.spec.md". */
  file: string;
  kind: Requirement["kind"];
  requirement: string;
  status: PinStatus;
  /** The pin as it was, or null when there was none. */
  from: string | null;
  /** The pin as it now stands, or null when nothing living could be hashed. */
  to: string | null;
}

export function registerRebase(program: Command): void {
  program
    .command("rebase")
    .argument("<featureId>", "feature id, e.g. FEAT-101")
    .description("Pin a feature's MODIFIED/REMOVED requirements to the living text they are written against")
    .option("--service <id>", "restrict to one service (default: every service the feature touches)")
    .option("--dry-run", "print what would be pinned and write nothing")
    .option("--json", "emit the machine contract instead of the human view")
    .action(async (featureId: string, opts: RebaseOptions) => {
      const json = opts.json === true;
      const config = await loadConfig();
      if (!config) {
        reportNoConfig(json);
        return;
      }

      // The id grammar on the RAW argument, before it reaches a path join —
      // one grammar for the whole tool (core/ids.ts).
      if (opts.service !== undefined) {
        try {
          assertServiceId(opts.service, "--service");
        } catch (err) {
          if (!(err instanceof InvalidIdError)) throw err;
          return fail(json, "invalid-option", err.message);
        }
      }

      // The living specs must not move between the read that computes a pin and
      // the write that records it: a digest taken over a document an archive
      // replaced a millisecond later is precisely the false "I read this" the
      // pin exists to make impossible. One writer per docs repo, refusing
      // rather than queueing, exactly as archive takes it.
      let release: () => Promise<void>;
      try {
        release = await acquireDocsLock(config.docsDir);
      } catch (err) {
        if (!(err instanceof DocsBusyError)) throw err;
        return fail(json, "docs-busy", err.message);
      }
      try {
        await rebaseLocked(config.docsDir, featureId, opts);
      } finally {
        await release();
      }
    });
}

async function rebaseLocked(docsDir: string, featureId: string, opts: RebaseOptions): Promise<void> {
  const json = opts.json === true;
  const dryRun = opts.dryRun === true;

  const feature = await resolveFeature(docsDir, featureId, "exclude");
  if (!feature) {
    return fail(json, "unknown-target", await missingFeatureMessage(docsDir, featureId));
  }
  const { id } = feature;

  if (opts.service !== undefined && !feature.services.includes(opts.service)) {
    // The refusal names the choices, the way `loam delta`'s does: a typo must
    // never be indistinguishable from a feature with nothing to pin.
    return fail(
      json,
      "unknown-target",
      `${id} carries no requirement delta for '${opts.service}'` +
        (feature.services.length === 0
          ? " — it touches no service at all."
          : ` — it touches: ${[...feature.services].sort(compareIds).join(", ")}.`),
    );
  }
  const services = (opts.service === undefined ? [...feature.services] : [opts.service]).sort(compareIds);

  const outcomes: PinOutcome[] = [];
  const writes: PlannedWrite[] = [];
  for (const service of services) {
    for (const axis of SPEC_AXES) {
      const specPath = featureSpecPaths(feature.dir, service)[axis.key];
      if (!existsSync(specPath)) continue;
      const planned = await planAxis(docsDir, service, axis, specPath);
      outcomes.push(...planned.outcomes);
      if (planned.content !== null) writes.push({ path: specPath, content: planned.content });
    }
  }

  if (!dryRun && writes.length > 0) {
    // Staged and swapped like every other multi-file write in loam
    // (core/staging.ts): a feature spanning four services is one act, and a
    // full disk between its second and third file must not leave two of them
    // pinned to a reading the other two never saw.
    const staged = await stageWrites(writes);
    try {
      await swapStaged(staged);
    } catch (err) {
      const failures = await rollbackStaged(staged);
      return fail(
        json,
        failures.length === 0 ? "merge-failed" : "rollback-incomplete",
        failures.length === 0
          ? `rebase ${id} failed and was rolled back — nothing was pinned: ${message(err)}`
          : `rebase ${id} failed and the rollback did not complete; these files are in an unknown state: ${failures.join(", ")} — ${message(err)}`,
      );
    }
  }

  const changed = outcomes.filter((o) => o.status === "pinned" || o.status === "repinned");
  const unresolved = outcomes.filter((o) => o.status === "unresolved");

  if (json) {
    emitJson({
      feature: id,
      services,
      dryRun,
      requirements: outcomes,
      written: dryRun ? [] : writes.map((w) => repoPath(docsDir, w.path)),
    });
    return;
  }

  if (outcomes.length === 0) {
    console.log(
      `${id}: no MODIFIED or REMOVED requirements to pin — a baseline only means something for a requirement that already exists.`,
    );
    return;
  }

  console.log(`${id}${dryRun ? " (dry run)" : ""}\n`);
  for (const o of outcomes) {
    const where = `${o.service}/${o.file}`;
    if (o.status === "unresolved") {
      console.log(`  · ${where}  ${o.kind} ${o.requirement} — not in the living spec yet, nothing to pin`);
    } else if (o.status === "unchanged") {
      console.log(`  = ${where}  ${o.kind} ${o.requirement} — already ${o.to}`);
    } else if (o.status === "pinned") {
      console.log(`  + ${where}  ${o.kind} ${o.requirement} — pinned ${o.to}`);
    } else {
      console.log(`  ~ ${where}  ${o.kind} ${o.requirement} — ${o.from} → ${o.to}`);
    }
  }

  if (changed.length === 0) {
    console.log(`\nNothing to write: every pin already names the living text.`);
  } else if (dryRun) {
    console.log(`\n${plural(changed.length, "requirement")} would be pinned. Nothing was written.`);
  } else {
    console.log(`\n${plural(changed.length, "requirement")} pinned across ${plural(writes.length, "file")}.`);
    // The one sentence that keeps this command honest. A pin is a claim about
    // what its author read, and a `repinned` line means the living text moved
    // under a delta that still says what it said before — restamping does not
    // fold in the change it just stopped reporting.
    const repinned = changed.filter((o) => o.status === "repinned");
    if (repinned.length > 0) {
      console.log(
        `\n⚠ ${plural(repinned.length, "requirement")} moved since this delta was written. A pin records what you read — ` +
          `re-read those living requirements and fold in what you still mean, or the next archive lands your text over theirs with loam's blessing.`,
      );
    }
  }
  if (unresolved.length > 0) {
    console.log(
      `\n${plural(unresolved.length, "requirement")} could not be pinned because the living spec does not have them yet — ` +
        `\`loam dependencies ${id}\` says which feature introduces them first.`,
    );
  }
}

interface AxisPlan {
  outcomes: PinOutcome[];
  /** The rewritten document, or null when nothing about it changes. */
  content: string | null;
}

/** Pin every MODIFIED/REMOVED requirement in one delta file against one living document. */
async function planAxis(
  docsDir: string,
  service: string,
  axis: SpecAxis,
  specPath: string,
): Promise<AxisPlan> {
  const raw = await readFile(specPath, "utf8");
  const reqs = parseRequirements(raw);
  const livingPath = servicePaths(docsDir, service)[axis.key];
  const living = existsSync(livingPath) ? parseRequirements(await readFile(livingPath, "utf8")) : [];

  const outcomes: PinOutcome[] = [];
  const edits: LineEdit[] = [];
  for (const r of reqs) {
    if (r.kind !== "MODIFIED" && r.kind !== "REMOVED") continue;
    // Every requirement parsed from a document carries its heading line
    // (core/spec.ts). One built in memory has no document to write into, and
    // there is nothing truthful to report about pinning it.
    const line = r.line;
    if (line === undefined) continue;
    const base = { service, file: axis.file, kind: r.kind, requirement: r.name };
    const selected = selectLiving(living, r);
    if (selected === undefined) {
      outcomes.push({ ...base, status: "unresolved", from: r.basedOn ?? null, to: null });
      continue;
    }
    const digest = requirementDigest(selected);
    if (r.basedOn === digest) {
      outcomes.push({ ...base, status: "unchanged", from: digest, to: digest });
      continue;
    }
    outcomes.push({
      ...base,
      status: r.basedOn === undefined ? "pinned" : "repinned",
      from: r.basedOn ?? null,
      to: digest,
    });
    edits.push(pinEdit(r, line, digest));
  }

  return { outcomes, content: edits.length === 0 ? null : applyEdits(raw, edits) };
}

/**
 * The living requirement a delta requirement addresses — the merge's own
 * resolution order (core/spec.ts `applyRequirementDelta`), so a pin is taken
 * over exactly the requirement archive would rewrite: the stable ID when the
 * delta carries one, the exact heading otherwise, and the FIRST match either
 * way (duplicates are refused upstream by `delta.living-duplicate-requirement`).
 */
function selectLiving(living: Requirement[], r: Requirement): Requirement | undefined {
  if (r.id !== undefined) return living.find((candidate) => candidate.id === r.id);
  return living.find((candidate) => candidate.name === r.name);
}

/* ------------------------------------------------------------------ */
/* Line surgery                                                        */
/* ------------------------------------------------------------------ */

interface LineEdit {
  /** 0-based line index, as `parseRequirements` counts lines. */
  at: number;
  /** Replace that line, or insert a new one before it. */
  mode: "replace" | "insert";
  text: string;
}

/**
 * Where this requirement's `Based-On:` line goes, and whether it replaces one.
 *
 * `headingLine` is 1-based and `text` captures every body line after it
 * contiguously (core/spec.ts), so body line `i` is the 0-based document line
 * `headingLine + i` — no rescan of the document, and no second opinion about
 * where a requirement begins. A new pin lands directly under `Requirement-ID:`
 * when there is one, matching what `serializeRequirements` writes, and
 * otherwise as the first body line: the two identity lines are read together,
 * so they are kept together.
 */
function pinEdit(r: Requirement, headingLine: number, digest: string): LineEdit {
  const text = `Based-On: ${digest}`;
  const existing = r.text.findIndex((line) => /^\s*Based-On:/i.test(line));
  if (existing >= 0) return { at: headingLine + existing, mode: "replace", text };
  const afterId = r.text.findIndex((line) => /^\s*Requirement-ID:/i.test(line));
  return { at: headingLine + afterId + 1, mode: "insert", text };
}

/** One line of the document with the terminator it was written with. */
interface Line {
  text: string;
  /** "\n", "\r\n", or "" for a last line the file does not terminate. */
  eol: string;
}

/**
 * Split into lines that remember their own terminator, indexed exactly as
 * `parseRequirements` counts them.
 */
function toLines(raw: string): Line[] {
  // split with a captured separator yields [content, sep, content, sep, …, content].
  const parts = raw.split(/(\r?\n)/);
  const lines: Line[] = [];
  for (let i = 0; i < parts.length; i += 2) lines.push({ text: parts[i]!, eol: parts[i + 1] ?? "" });
  return lines;
}

/**
 * Apply line edits to a document, preserving every byte they do not name.
 *
 * Each line keeps its own terminator, so a CRLF document stays CRLF and a file
 * that ends without a newline does not grow one — rejoining on a single
 * "detected" newline would rewrite the line endings of a whole file whose
 * author asked for one line to change. Edits are applied bottom-up so an
 * insertion never shifts the index of one still to come.
 */
function applyEdits(raw: string, edits: LineEdit[]): string {
  const lines = toLines(raw);
  const eol = lines.find((line) => line.eol !== "")?.eol ?? "\n";
  for (const edit of [...edits].sort((a, b) => b.at - a.at)) {
    if (edit.mode === "replace") {
      lines[edit.at]!.text = edit.text;
      continue;
    }
    const before = edit.at > 0 ? lines[edit.at - 1] : undefined;
    if (before !== undefined && before.eol === "") {
      // Inserting past a file that ends without a newline: the old last line
      // needs a terminator, and the new line inherits its unterminated end so
      // the file keeps the shape its author gave it.
      before.eol = eol;
      lines.splice(edit.at, 0, { text: edit.text, eol: "" });
    } else {
      lines.splice(edit.at, 0, { text: edit.text, eol: before?.eol ?? eol });
    }
  }
  return lines.map((line) => line.text + line.eol).join("");
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
