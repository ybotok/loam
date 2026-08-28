/**
 * `loam rebase --living` — re-pin the LIVING corpus's `Realizes:` entries to the
 * capability requirements they currently name.
 *
 * The other half of `capability.realizes-stale`. That finding says a promise
 * moved under a claim; this is the act that records having re-read it. The two
 * are deliberately separate commands and not one self-healing pass, for the
 * reason the finding's own comment gives: a stale pin has three legitimate
 * outcomes and only one of them is "the requirement was right as it stands".
 * loam cannot tell which, so it reports, and a human runs this when they have
 * decided.
 *
 * WHY IT IS NOT PART OF `rebase <FEAT>`. That command pins a FEATURE's deltas
 * against living text — bookkeeping inside a change window, thrown away when
 * the feature archives. This pins the living documents themselves, against the
 * living business tree, with no feature involved at all. Same verb because the
 * act is the same one (record which version I read), different scope because
 * the documents are.
 *
 * IT WRITES NOTHING ELSE. No `Based-On:`, no contract pins, no reserialize —
 * one `Realizes:` line per requirement that has one, through the same line
 * surgery `./edit.ts` performs for every other pin, so a living spec's headings,
 * prose and ordering survive byte for byte.
 */
import { existsSync } from "node:fs";
import { parseRequirements, readRequirementsDocument } from "../../core/document/parse.js";
import { NotUtf8DocumentError } from "../../core/kernel/document-bytes.js";
import { splitRealizesPin } from "../../core/document/spec.js";
import {
  resolveRealizes,
  splitRealizesEntry,
  type CapabilityRequirementIndex,
} from "../../core/capabilities/realizes/join.js";
import { capabilityRequirementIndex } from "../../core/capabilities/findings.js";
import { emitJson, fail } from "../../core/envelope/json.js";
import { FleetContext } from "../../core/fleet-context.js";
import type { DocsDir } from "../../core/kernel/ids/dirs.js";
import { listServices } from "../../core/repo/repo.js";
import { servicePathsAt, SPEC_AXES } from "../../core/repo/paths.js";
import { stageWrites } from "../../core/staging/commit.js";
import { commitStaged } from "../../core/staging/txn/transaction.js";
import type { PlannedWrite } from "../../core/staging/writes.js";
import { plural } from "../policy/format.js";
import { applyEdits, realizesPinEdit, type LineEdit } from "./edit.js";

/** What happened to one living `Realizes:` entry. */
export interface LivingPinOutcome {
  service: string;
  /** `spec.md` or `arch.spec.md` — which axis carried the line. */
  file: string;
  /** The requirement's `### Requirement:` heading. */
  target: string;
  /** The entry as authored, pin and all. */
  entry: string;
  /**
   * `pinned` — it carried none and now does. `repinned` — the promise moved and
   * this records the re-read. `unchanged` — already correct, no write.
   * `unresolved` — the entry names nothing the tree declares, so there is no
   * version to pin; `capability.realizes-unknown` is that entry's finding and
   * inventing a digest for it would put loam's stamp on a broken join.
   */
  status: "pinned" | "repinned" | "unchanged" | "unresolved";
  from: string | null;
  to: string | null;
}

export interface LivingAxisPlan {
  outcomes: LivingPinOutcome[];
  /** The rewritten document, or `null` when nothing changed. */
  content: string | null;
}

/**
 * Plan one living requirements document's pins against the capability index.
 *
 * The index is the caller's, built once for the whole run: it is the same
 * fleet-wide read `validate --all` takes, and rebuilding it per service would
 * re-parse every capability document once per service in the fleet.
 */
export async function planLivingRealizes(
  service: string,
  file: string,
  specPath: string,
  index: CapabilityRequirementIndex,
): Promise<LivingAxisPlan> {
  if (!existsSync(specPath)) return { outcomes: [], content: null };
  // The decoding read, for `planRequirementPins`'s reason one module over: line
  // surgery over bytes loam mis-decoded would write text nobody authored.
  const raw = await readRequirementsDocument(specPath);
  const reqs = parseRequirements(raw);

  const outcomes: LivingPinOutcome[] = [];
  const edits: LineEdit[] = [];
  for (const r of reqs) {
    // REMOVED is skipped wherever `Realizes:` is read; a requirement built in
    // memory has no document line to write into, so there is nothing truthful
    // to report about pinning it.
    if (r.kind === "REMOVED" || r.line === undefined) continue;
    if (r.realizes.length === 0) continue;

    // The resolution and the rewrite must agree entry for entry, so both read
    // the SAME claim list rather than each splitting the strings again.
    const wanted = new Map<string, string>();
    for (const claim of resolveRealizes(r.realizes, index)) {
      const base = { service, file, target: r.name, entry: claim.entry };
      if (claim.kind !== "resolved") {
        outcomes.push({ ...base, status: "unresolved", from: splitRealizesPin(claim.entry).pin, to: null });
        continue;
      }
      const { pin, current } = claim;
      if (current === null) {
        // Resolved against an index that carries no digest for it — the feature
        // overlay's shape, and not a state a living run reaches. Reported as
        // unresolved rather than silently skipped: a pin loam declined to write
        // must never look like a pin it wrote.
        outcomes.push({ ...base, status: "unresolved", from: pin, to: null });
        continue;
      }
      if (pin === current) {
        outcomes.push({ ...base, status: "unchanged", from: pin, to: pin });
        continue;
      }
      wanted.set(claim.entry, `${splitRealizesPin(claim.entry).target}@${current}`);
      outcomes.push({
        ...base,
        status: pin === null ? "pinned" : "repinned",
        from: pin,
        to: current,
      });
    }
    if (wanted.size === 0) continue;
    const edit = realizesPinEdit(r, r.line, (entry) => wanted.get(entry) ?? entry);
    if (edit !== null) edits.push(edit);
  }

  return { outcomes, content: edits.length === 0 ? null : applyEdits(raw, edits) };
}

/** Entries that would change — what the human view counts and `--dry-run` prints. */
export function changedPins(outcomes: readonly LivingPinOutcome[]): LivingPinOutcome[] {
  return outcomes.filter((o) => o.status === "pinned" || o.status === "repinned");
}

/**
 * The bare target of an entry — exported so a caller can report what an
 * unresolved entry pointed at without re-deriving the separator rule.
 */
export function entryTarget(entry: string): string {
  const target = splitRealizesEntry(entry);
  return target === null ? entry : `${target.capability}#${target.requirement}`;
}

/**
 * The whole `--living` run, under the lock the caller already holds.
 *
 * Order of operations mirrors `rebaseLocked`: read everything, plan everything,
 * then commit once. A fleet's `Realizes:` corpus is one claim about one version
 * of the business tree, so pinning four services against a tree that moved
 * between the second and the third is exactly the split reading the pin exists
 * to make impossible.
 */
export async function rebaseLivingLocked(
  docsDir: DocsDir,
  opts: { service?: string; json?: boolean; dryRun?: boolean },
): Promise<void> {
  const json = opts.json === true;
  const dryRun = opts.dryRun === true;
  const fleet = new FleetContext();

  const capabilities = await fleet.capabilities(docsDir);
  const index = await capabilityRequirementIndex(capabilities, (p) => fleet.readRequirements(p));
  if (index.declared === null) {
    // The ladder, one command over from where `../validate` applies it: a fleet
    // with no gradable capability vocabulary has no versions to pin against,
    // and stamping digests from a file loam could not read would be the false
    // claim the whole pin mechanism exists to refuse.
    return fail(
      json,
      "unknown-target",
      "this docs repo declares no readable capability vocabulary, so no `Realizes:` entry has a version to pin — " +
        "write `architecture/capabilities.yaml` or a `capabilities/<id>/spec.md` first, or fix the one that does not parse (`loam validate --all`).",
    );
  }

  const all = await listServices(docsDir, fleet);
  const services = opts.service === undefined ? all : all.filter((s) => s.id === opts.service);
  if (opts.service !== undefined && services.length === 0) {
    return fail(
      json,
      "unknown-target",
      `no service '${opts.service}' in this docs repo` +
        (all.length === 0 ? " — it holds none." : ` — it holds: ${all.map((s) => s.id).join(", ")}.`),
    );
  }

  const outcomes: LivingPinOutcome[] = [];
  const writes: PlannedWrite[] = [];
  try {
    for (const entry of services) {
      const paths = servicePathsAt(entry.dir);
      for (const axis of SPEC_AXES) {
        const planned = await planLivingRealizes(entry.id, axis.file, paths[axis.key], index);
        outcomes.push(...planned.outcomes);
        if (planned.content !== null) writes.push({ path: paths[axis.key], content: planned.content });
      }
    }
  } catch (err) {
    if (!(err instanceof NotUtf8DocumentError)) throw err;
    return fail(json, "merge-failed", `rebase --living failed — nothing was pinned: ${err.message}`);
  }

  const changed = changedPins(outcomes);
  if (!dryRun && writes.length > 0) {
    const staged = await stageWrites(writes);
    const committed = await commitStaged(
      { root: docsDir, command: "rebase", rerun: "loam rebase --living", target: "living" },
      staged,
      "pinned",
    );
    if (!committed.ok) {
      return fail(json, "merge-failed", `rebase --living failed — ${committed.message}`);
    }
  }

  if (json) {
    return emitJson({ ok: true, mode: "living", dryRun, pinned: changed.length, outcomes });
  }
  const unresolved = outcomes.filter((o) => o.status === "unresolved");
  console.log(
    changed.length === 0
      ? `Nothing to pin — every \`Realizes:\` entry in ${plural(services.length, "service")} already names the version it points at.`
      : `${dryRun ? "Would pin" : "Pinned"} ${changed.length} entr${changed.length === 1 ? "y" : "ies"} across ${plural(writes.length, "document")}.`,
  );
  for (const o of changed) {
    console.log(`  ${o.status === "pinned" ? "+" : "~"} ${o.service}/${o.file}: '${o.target}' → ${entryTarget(o.entry)}@${o.to}`);
  }
  for (const o of unresolved) {
    console.log(`  ? ${o.service}/${o.file}: '${o.target}' realizes ${entryTarget(o.entry)}, which nothing declares — not pinned`);
  }
  if (changed.length > 0 && !dryRun) {
    console.log(
      "\nA pin says you re-read the promise. Restamping without reading it is the one way to make this a lie with a digest on it.",
    );
  }
}
