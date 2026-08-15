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
import { loadConfig } from "../core/envelope/config.js";
import { decodeDocument, NotUtf8DocumentError } from "../core/kernel/document-bytes.js";
import { InvalidIdError, assertServiceId, type PathableService } from "../core/kernel/ids.js";
import { emitJson, fail, repoPath, reportNoConfig } from "../core/envelope/json.js";
import { compareIds } from "../core/repo/entries.js";
import { featureSpecPaths, servicePaths, SPEC_AXES, type SpecAxis } from "../core/repo/paths.js";
import { missingFeatureMessage, resolveFeature } from "../core/repo/repo.js";
import {
  DocsBusyError,
  acquireDocsLock,
  message,
  rollbackStaged,
  stageWrites,
  swapStaged,
  type PlannedWrite,
} from "../core/staging.js";
import {
  parseRequirements,
  readRequirementsDocument,
  requirementDigest,
  type Requirement,
} from "../core/document/spec.js";
import {
  OpenapiMergeError,
  pinOpenapiOperations,
  type OpenapiPinPlan,
} from "../core/openapi-merge.js";
import { plural } from "./format.js";

interface RebaseOptions {
  service?: string;
  json?: boolean;
  dryRun?: boolean;
}

/** What happened to one pin. */
type PinStatus =
  /** It had none and now has one. */
  | "pinned"
  /** It had a pin for an older living version; it now names the current one. */
  | "repinned"
  /** It already named the current living version — no write. */
  | "unchanged"
  /**
   * It addresses nothing living — a MODIFIED of a requirement another feature
   * in flight still introduces, or an operation this feature is adding. There
   * is no version to be based on, so inventing a pin would be inventing a
   * baseline; `loam validate` already reports the ordering where there is one
   * (`delta.modified-pending`).
   */
  | "unresolved"
  /**
   * The operation is written as a YAML alias. One shared value backs every use
   * of an anchor, so stamping "through" it would pin every other use too —
   * the same reason the merge refuses to edit aliases in place. Rare, legal,
   * and named rather than silently skipped.
   */
  | "unwritable";

interface PinOutcome {
  service: string;
  /** The axis's filename — "spec.md", "arch.spec.md" or "openapi.yaml". */
  file: string;
  /** MODIFIED/REMOVED for a requirement; the upper-case HTTP method for an operation. */
  kind: string;
  /** The requirement heading, or `/path ('operationId')`. */
  target: string;
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
      // one grammar for the whole tool (core/kernel/ids.ts).
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

  // The enumeration's own id is what travels on when --service names one
  // (`entry.id` rather than the argument — repo/service-target.ts's rule):
  // equal as strings, and only one of them was produced by a readdir.
  const chosen = opts.service === undefined ? undefined : feature.services.find((s) => s === opts.service);
  if (opts.service !== undefined && chosen === undefined) {
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
  const services = (chosen === undefined ? [...feature.services] : [chosen]).sort(compareIds);

  const outcomes: PinOutcome[] = [];
  const writes: PlannedWrite[] = [];
  try {
    for (const service of services) {
      for (const axis of SPEC_AXES) {
        const specPath = featureSpecPaths(feature.dir, service)[axis.key];
        if (!existsSync(specPath)) continue;
        const planned = await planAxis(docsDir, service, axis, specPath);
        outcomes.push(...planned.outcomes);
        if (planned.content !== null) writes.push({ path: specPath, content: planned.content });
      }
      // The contract axis. It needs the pin more than the requirement axes do:
      // a requirement delta spells only the requirements it changes, while an
      // openapi delta is a COMPLETE document and spells the whole contract.
      const openapiPath = featureSpecPaths(feature.dir, service).openapi;
      if (existsSync(openapiPath)) {
        const planned = await planOpenapi(docsDir, service, openapiPath);
        outcomes.push(...planned.outcomes);
        if (planned.content !== null) writes.push({ path: openapiPath, content: planned.content });
      }
    }
  } catch (err) {
    if (!(err instanceof NotUtf8DocumentError)) throw err;
    // A pin is a claim about text somebody read. Over a document loam could not
    // decode it would be a digest of mojibake with loam's name on it — the
    // precise false claim this command exists to prevent — and the next archive
    // would land a stale delta over living text on the strength of it. So it
    // refuses by name and writes nothing, exactly as `loam archive` refuses a
    // merge it could not read, under archive's code. The refusal is here, in
    // the PLAN, so it lands before stageWrites: no file is touched, and a
    // feature spanning four services does not get two of them pinned.
    return fail(json, "merge-failed", `rebase ${id} failed — nothing was pinned: ${err.message}`);
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
      pins: outcomes,
      written: dryRun ? [] : writes.map((w) => repoPath(docsDir, w.path)),
    });
    return;
  }

  if (outcomes.length === 0) {
    console.log(
      `${id}: nothing to pin — a baseline only means something for a requirement or an operation that already exists.`,
    );
    return;
  }

  console.log(`${id}${dryRun ? " (dry run)" : ""}\n`);
  for (const o of outcomes) {
    const what = `${o.service}/${o.file}  ${o.kind} ${o.target}`;
    if (o.status === "unresolved") {
      console.log(`  · ${what} — not in the living docs yet, nothing to pin`);
    } else if (o.status === "unwritable") {
      console.log(`  ! ${what} — written as a YAML alias; loam will not stamp through a shared anchor`);
    } else if (o.status === "unchanged") {
      console.log(`  = ${what} — already ${o.to}`);
    } else if (o.status === "pinned") {
      console.log(`  + ${what} — pinned ${o.to}`);
    } else {
      console.log(`  ~ ${what} — ${o.from} → ${o.to}`);
    }
  }

  if (changed.length === 0) {
    console.log(`\nNothing to write: every pin already names the living version.`);
  } else if (dryRun) {
    console.log(`\n${plural(changed.length, "pin")} would be written. Nothing was written.`);
  } else {
    console.log(`\n${plural(changed.length, "pin")} written across ${plural(writes.length, "file")}.`);
    // The one sentence that keeps this command honest. A pin is a claim about
    // what its author read, and a `repinned` line means the living text moved
    // under a delta that still says what it said before — restamping does not
    // fold in the change it just stopped reporting.
    const repinned = changed.filter((o) => o.status === "repinned");
    if (repinned.length > 0) {
      console.log(
        `\n⚠ ${plural(repinned.length, "pin")} moved since this delta was written. A pin records what you read — ` +
          `re-read those living requirements and operations and fold in what you still mean, or the next archive lands your version over theirs with loam's blessing.`,
      );
    }
  }
  if (unresolved.length > 0) {
    console.log(
      `\n${plural(unresolved.length, "item")} could not be pinned because the living docs do not have them yet — ` +
        `for a requirement, \`loam dependencies ${id}\` says which feature introduces it first; for an operation, this feature is adding it.`,
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
  service: PathableService,
  axis: SpecAxis,
  specPath: string,
): Promise<AxisPlan> {
  // Both sides through the decoding read: the delta because line surgery over a
  // document loam mis-decoded would write bytes nobody authored, the living
  // because it is what every digest below is taken over.
  const raw = await readRequirementsDocument(specPath);
  const reqs = parseRequirements(raw);
  const livingPath = servicePaths(docsDir, service)[axis.key];
  const living = existsSync(livingPath)
    ? parseRequirements(await readRequirementsDocument(livingPath))
    : [];

  const outcomes: PinOutcome[] = [];
  const edits: LineEdit[] = [];
  for (const r of reqs) {
    if (r.kind !== "MODIFIED" && r.kind !== "REMOVED") continue;
    // Every requirement parsed from a document carries its heading line
    // (core/document/spec.ts). One built in memory has no document to write into, and
    // there is nothing truthful to report about pinning it.
    const line = r.line;
    if (line === undefined) continue;
    const base = { service, file: axis.file, kind: r.kind, target: r.name };
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
 * Pin every operation in one feature contract against the living contract.
 *
 * The pin is always `operationDigest` of the LIVING operation, never of the
 * delta's own. That single rule produces both merge verdicts on its own: an
 * operation the author only QUOTED is byte-equal to living, so its pin equals
 * its own content and the merge skips it; one the author EDITED differs from
 * its pin, so the merge writes it. Nothing here has to guess at intent — the
 * document already records it, and the pin makes it legible.
 *
 * Slot-keyed (path + method), exactly as the merge upserts. An operationId that
 * moved to another slot is a new slot with nothing living behind it, which is
 * `unresolved` and correct: there is no living version of an operation at a
 * path the contract does not serve yet.
 */
async function planOpenapi(docsDir: string, service: PathableService, openapiPath: string): Promise<AxisPlan> {
  const livingPath = servicePaths(docsDir, service).openapi;
  // Decoded, not `readFile(…, "utf8")`, for the requirement axes' reason: a
  // contract read with U+FFFD substituted in defines no operation loam can
  // match, so every pin would come out `unresolved` — "this feature adds them
  // all" — over a living contract that already serves them. Read outside the
  // try below, whose job is the merge's own diagnosis and not this one.
  const living = existsSync(livingPath) ? decodeDocument(await readFile(livingPath), livingPath) : "";
  const delta = decodeDocument(await readFile(openapiPath), openapiPath);
  let plan: OpenapiPinPlan;
  try {
    plan = pinOpenapiOperations(delta, living, service);
  } catch (err) {
    // A document loam cannot read is validate's diagnosis to make
    // (`openapi.invalid`), not this command's to guess at — and stamping into a
    // broken parse would write a file nobody asked for.
    if (!(err instanceof OpenapiMergeError)) throw err;
    return { outcomes: [], content: null };
  }
  return {
    outcomes: plan.pins.map((pin) => ({
      service,
      file: "openapi.yaml",
      kind: pin.method.toUpperCase(),
      target: pin.operationId.length === 0 ? pin.path : `${pin.path} ('${pin.operationId}')`,
      status: pin.status,
      from: pin.from,
      to: pin.to,
    })),
    content: plan.text,
  };
}

/**
 * The living requirement a delta requirement addresses — the merge's own
 * resolution order (core/document/spec.ts `applyRequirementDelta`), so a pin is taken
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
 * contiguously (core/document/spec.ts), so body line `i` is the 0-based document line
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
