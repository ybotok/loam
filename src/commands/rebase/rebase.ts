import type { Command } from "commander";
import { existsSync } from "node:fs";
import { loadConfig } from "../../core/envelope/config.js";
import { NotUtf8DocumentError } from "../../core/kernel/document-bytes.js";
import { InvalidIdError, assertServiceId } from "../../core/kernel/ids/service.js";
import { emitJson, fail, repoPath, reportNoConfig } from "../../core/envelope/json.js";
import { compareIds } from "../../core/repo/entries.js";
import { featureSpecPaths, SPEC_AXES } from "../../core/repo/paths.js";
import { missingFeatureMessage, resolveFeature } from "../../core/repo/repo.js";
import { stageWrites } from "../../core/staging/commit.js";
import { type CommitRecovery, InterruptedCommitError } from "../../core/staging/interrupted.js";
import { acquireDocsLock, DocsBusyError } from "../../core/staging/lock.js";
import { recoverInterruptedCommit } from "../../core/staging/recovery/recover.js";
import { commitStaged } from "../../core/staging/txn/transaction.js";
import { type PlannedWrite } from "../../core/staging/writes.js";
import { plural, sayRecovered } from "../policy/format.js";
import { FleetContext } from "../../core/fleet-context.js";
import {
  planAsyncapi,
  planAxis,
  planCapabilityAxis,
  planOpenapi,
  type CapabilityPinOutcome,
  type PinOutcome,
} from "./plan.js";
import type { DocsDir } from "../../core/kernel/ids/dirs.js";

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

interface RebaseOptions {
  service?: string;
  json?: boolean;
  dryRun?: boolean;
}

/** What happened to one pin. */

export function registerRebase(program: Command): void {
  program
    .command("rebase")
    .argument("<featureId>", "feature id, e.g. FEAT-101")
    .description("Pin a feature's MODIFIED/REMOVED requirements to the living text they are written against")
    .option("--service <id>", "restrict to one service (default: every service the feature touches)")
    .option(
      "--dry-run",
      "print what would be pinned and write nothing — beyond first finishing a predecessor's interrupted commit, exactly as a real run would",
    )
    .option("--json", "emit the machine contract instead of the human view")
    .action(async (featureId: string, opts: RebaseOptions) => {
      const json = opts.json === true;
      const loaded = await loadConfig();
      if (loaded.kind !== "loaded") {
        reportNoConfig(json, loaded);
        return;
      }
      const config = loaded.config;

      // The id grammar on the RAW argument, before it reaches a path join —
      // one grammar for the whole tool (core/kernel/ids/service.ts).
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
        // A journal in the repo means the LAST write never finished — reading
        // living documents to compute pins over a half-commit would digest
        // bytes no run ever produced. Recover (or refuse) first, under the
        // same lock the commit will hold.
        let recovered: CommitRecovery | null;
        try {
          recovered = await recoverInterruptedCommit(config.docsDir);
        } catch (err) {
          if (!(err instanceof InterruptedCommitError)) throw err;
          return fail(json, "commit-interrupted", err.message);
        }
        await rebaseLocked(config.docsDir, featureId, { ...opts, recovered });
      } finally {
        await release();
      }
    });
}

async function rebaseLocked(
  docsDir: DocsDir,
  featureId: string,
  opts: RebaseOptions & { recovered: CommitRecovery | null },
): Promise<void> {
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

  // One read index for the whole loop below: every planner resolves its
  // living document through `locateServicePaths`, and without a shared
  // context each of those calls is a fresh fleet walk — services × axes of
  // them per run, on a tree that cannot change under the lock this holds.
  const repo = { docsDir, fleet: new FleetContext() };
  const outcomes: PinOutcome[] = [];
  const capabilityOutcomes: CapabilityPinOutcome[] = [];
  const writes: PlannedWrite[] = [];
  // The business corpus this feature changes. Skipped entirely under `--service`:
  // that flag means "restrict to one service", and a capability names none — so
  // pinning capability deltas under it would write files the caller narrowed the
  // command to exclude. One `existsSync` when the feature carries no capability
  // delta, which is every feature in a fleet that has not adopted the axis.
  const capabilities =
    chosen === undefined ? (await repo.fleet.featureCapabilityDeltas(feature.dir)).docs : [];
  try {
    for (const service of services) {
      for (const axis of SPEC_AXES) {
        const specPath = featureSpecPaths(feature.dir, service)[axis.key];
        if (!existsSync(specPath)) continue;
        const planned = await planAxis(repo, service, axis, specPath);
        outcomes.push(...planned.outcomes);
        if (planned.content !== null) writes.push({ path: specPath, content: planned.content });
      }
      // The contract axis. It needs the pin more than the requirement axes do:
      // a requirement delta spells only the requirements it changes, while an
      // openapi delta is a COMPLETE document and spells the whole contract.
      const openapiPath = featureSpecPaths(feature.dir, service).openapi;
      if (existsSync(openapiPath)) {
        const planned = await planOpenapi(repo, service, openapiPath);
        outcomes.push(...planned.outcomes);
        if (planned.content !== null) writes.push({ path: openapiPath, content: planned.content });
      }
      // The event axis, for the openapi reason: a feature's asyncapi.yaml is
      // a complete document too, so its quotes need pins or the merge cannot
      // tell them from edits.
      const asyncapiPath = featureSpecPaths(feature.dir, service).asyncapi;
      if (existsSync(asyncapiPath)) {
        const planned = await planAsyncapi(repo, service, asyncapiPath);
        outcomes.push(...planned.outcomes);
        if (planned.content !== null) writes.push({ path: asyncapiPath, content: planned.content });
      }
    }
    // The business axis, after the services and in the same transaction: a
    // feature that changes a promise and the services keeping it is ONE act,
    // and half of it pinned is the state the journal exists to prevent.
    for (const doc of capabilities) {
      const planned = await planCapabilityAxis(repo, doc.id, doc.spec);
      capabilityOutcomes.push(...planned.outcomes);
      if (planned.content !== null) writes.push({ path: doc.spec, content: planned.content });
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
    // Staged and committed through the journaled transaction: a feature
    // spanning four services is one act, and neither a full disk between its
    // second and third file NOR a kill between two renames may leave two of
    // them pinned to a reading the other two never saw — the journal makes
    // the second case recoverable where rollback alone could not see it.
    const staged = await stageWrites(writes);
    const committed = await commitStaged(
      { root: docsDir, command: "rebase", rerun: `loam rebase ${id}`, target: id },
      staged,
      "pinned",
    );
    if (!committed.ok) {
      return fail(
        json,
        committed.code,
        committed.code === "merge-failed" ? `rebase ${id} failed — nothing was pinned: ${committed.message}` : committed.message,
      );
    }
  }

  // One line per pin, whichever corpus it came from: what to call the document,
  // and the record itself. The two lists are reported separately in `--json`
  // (the published `pins[]`/`services[]` keys keep meaning exactly what they
  // meant) and together here, because a human rebasing one feature wants one
  // list in one order.
  const lines = [
    ...outcomes.map((o) => ({ where: `${o.service}/${o.file}`, pin: o })),
    ...capabilityOutcomes.map((o) => ({ where: `capabilities/${o.capability}/${o.file}`, pin: o })),
  ];
  const changed = lines.filter((l) => l.pin.status === "pinned" || l.pin.status === "repinned");
  const unresolved = lines.filter((l) => l.pin.status === "unresolved");

  if (json) {
    emitJson({
      feature: id,
      services,
      dryRun,
      pins: outcomes,
      // Additive, and separate from `pins[]` on purpose: `PinOutcome.service`
      // is a published field, and a capability id written into it would say
      // something false to every consumer that already reads it.
      capabilities: capabilities.map((c) => c.id),
      capabilityPins: capabilityOutcomes,
      written: dryRun ? [] : writes.map((w) => repoPath(docsDir, w.path)),
      ...(opts.recovered === null ? {} : { recovered: opts.recovered }),
    });
    return;
  }

  if (lines.length === 0) {
    console.log(
      `${id}: nothing to pin — a baseline only means something for a requirement, an operation, a path-level key, a component or an event slot that already exists in the living docs.`,
    );
    return;
  }

  if (opts.recovered !== null) console.log(`${sayRecovered(opts.recovered)}\n`);
  console.log(`${id}${dryRun ? " (dry run)" : ""}\n`);
  for (const { where, pin: o } of lines) {
    const what = `${where}  ${o.kind} ${o.target}`;
    if (o.status === "unresolved") {
      console.log(`  · ${what} — not in the living docs yet, nothing to pin`);
    } else if (o.status === "unwritable") {
      console.log(`  ! ${what} — a YAML alias (or a key loam cannot address by name); loam will not stamp through it`);
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
    const repinned = changed.filter((l) => l.pin.status === "repinned");
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
