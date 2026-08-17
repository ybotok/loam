/**
 * The emission as a person reads it.
 *
 * A module of its own for `adopt/render.ts`'s reason: `--json` already carries
 * every field below, so this decides only how they read — and the two
 * per-scenario warnings are why that is worth separating. Both name something
 * in a scenario body that did NOT survive into the emission, while the file
 * that came out is valid Gherkin and the summary line counts it like any other.
 * They are the only place those losses are visible at all, so they must not
 * share a module with the write path that can grow past them.
 */
import { relative } from "node:path";
import { type Action, type ActionRow } from "./reconcile.js";

/** What the text view needs that the plan does not carry. */
export interface RenderContext {
  service: string;
  /** Repo-relative `<gherkinDir>/loam/`. */
  root: string;
  /** Absolute suite root — orphan paths are printed relative to it. */
  absRoot: string;
  featureId: string | null;
  dryRun: boolean;
  /** Feature ids still in flight, for naming who owns a kept file. */
  activeIds: Set<string>;
  writes: number;
  orphans: string[];
}

/**
 * `conflict` never reaches the renderer — the run refuses before it — but the
 * map is total so a future action cannot silently print `undefined`.
 */
const VERB: Record<Action, string> = {
  written: "write  ",
  replaced: "replace",
  kept: "keep   ",
  conflict: "CONFLICT",
};

/** Both per-scenario losses, in one shape: what was written, and what became of it. */
const LOSSES = [
  {
    of: (a: ActionRow): string[] => (a.action === "kept" ? [] : a.stepless),
    why:
      "has NO recognizable steps — cucumber runs it vacuously green and `verify --results` can never " +
      "confirm it; reword its body as `- **Given/When/Then**` bullets",
  },
  {
    of: (a: ActionRow): string[] => (a.action === "kept" ? [] : a.malformedExamples),
    why:
      "has a table loam could not read as Examples — every row must have the header's column count, " +
      "and a header needs at least one row under it. It stayed in the description, so this scenario " +
      "runs ONCE, not once per case",
  },
];

export function render(actions: ActionRow[], ctx: RenderContext): void {
  const { service, root, dryRun, featureId } = ctx;
  const head = featureId === null ? `${service} (living suite)` : `${featureId} · ${service}`;
  console.log(`gherkin ${head} → ${root}/${dryRun ? "  (dry run)" : ""}\n`);
  if (actions.length === 0) {
    console.log(
      featureId === null
        ? `  the living specs hold no requirements for ${service} — nothing to emit.`
        : `  ${featureId} has no ADDED or MODIFIED requirements for ${service} — nothing to emit.`,
    );
  }
  for (const a of actions) {
    if (a.action === "kept") {
      const owners = a.kept.tags.filter((t) => ctx.activeIds.has(t));
      console.log(
        `  keep     ${a.fileName}  —  ${a.requirement.name}  (in flight: @${owners.join(" @")} — \`loam gherkin ${owners[0]}\` regenerates it)`,
      );
      continue;
    }
    const n = a.digests.length;
    const arch = a.axis.key === "archSpec" ? ", arch" : "";
    console.log(
      `  ${VERB[a.action]}  ${a.fileName}  —  ${a.requirement.name}  (${n} scenario${n === 1 ? "" : "s"}${arch})`,
    );
    for (const loss of LOSSES) {
      for (const name of loss.of(a)) console.log(`      ⚠ scenario '${name}' ${loss.why}`);
    }
  }
  for (const o of ctx.orphans) {
    console.log(`  delete   ${relative(ctx.absRoot, o).split(/[\\/]/).join("/")}  —  no longer in this scope`);
  }
  const wrote = `${ctx.writes} file(s)`;
  const keptNote = actions.length > ctx.writes ? `, ${actions.length - ctx.writes} kept in flight` : "";
  const dropped = ctx.orphans.length > 0 ? `, ${ctx.orphans.length} deletion(s)` : "";
  console.log(
    dryRun
      ? `\n  ${wrote}${keptNote}${dropped} — dry run, nothing was written.`
      : `\n  ${wrote} written${keptNote}${dropped}. Write step definitions OUTSIDE ${root}/ — regeneration rewrites it.`,
  );
}
