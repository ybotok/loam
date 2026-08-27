/**
 * What a person is shown before they answer a sampled vouch's question, and
 * the additive `--json` shape of what it stamped.
 *
 * The reading list is the whole interface of `--sample <n>`: the sections
 * picked, where they start, the preamble that is always read, and — said
 * plainly, before the prompt rather than after the stamp — that the sections
 * NOT listed will have been read by nobody, and what every later surface will
 * say about that. A flag that quietly reduces assurance would be a bad trade;
 * one that states the reduction to the person making it is the trade this
 * feature is.
 *
 * Kept out of `vouch.ts` because that file is the flag boundary and is at its
 * line limit, and out of `plan.ts` because a derivation that prints cannot be
 * called by the reading pack, which renders the same sample its own way.
 */
import { plural } from "../../policy/format.js";
import type { VouchScope } from "../../../core/provenance/sample/scope.js";
import type { PlannedAxis, SamplePlan } from "./plan.js";

/** `spec.md:42` — a body-relative section line put back on the file it came from. */
function sectionAt(axis: PlannedAxis, line: number): string {
  return `${axis.file}:${line + axis.lineOffset}`;
}

/**
 * The sampled claim in one sentence, for the reading list and the prompt: what
 * will be stamped, and what every later reader will therefore say.
 */
function claim(axis: PlannedAxis & { mode: "sampled" }, service: string): string {
  return (
    `${axis.file} will be stamped \`vouch_scope: sampled ${axis.picked.length}/${axis.of} seed=${axis.seed}\` — ` +
    `the other ${plural(axis.of - axis.picked.length, "section")} will have been read by nobody. \`loam list\` shows ` +
    `it as \`vouched (sampled)\` and \`loam validate\` reports \`sources.sampled-vouch\` until a person runs a full ` +
    `\`loam vouch --service ${service}\`.`
  );
}

/**
 * The reading list, printed before the confirmation. Text mode only — a
 * `--json` run cannot be asked a question at all (`vouch-unattended`), so
 * there is nobody on the other end of this list.
 */
export function printReadingList(plan: SamplePlan, service: string): void {
  console.log(`\n${service} — sampled vouch: ${plural(plan.n, "section")} per spec file. Read what is listed here.\n`);
  for (const axis of plan.axes) {
    if (axis.mode === "full") {
      // Said, not skipped: somebody who asked for a sample of four and got the
      // whole document needs to know which of the two they are vouching for.
      console.log(
        `  ${axis.file} — ${plural(axis.of, "section")}, at or under the sample: the whole file is the read, ` +
          `and it is stamped as an ordinary vouch with no scope.\n`,
      );
      continue;
    }
    console.log(`  ${axis.file} — ${axis.picked.length} of ${plural(axis.of, "section")}, seed=${axis.seed}`);
    console.log(`      the preamble above the first heading — always read, never part of the count`);
    for (const section of axis.picked) console.log(`      ${sectionAt(axis, section.line)}  ${section.heading}`);
    // The FULL declared sources, deliberately not a sample of them: nothing in
    // loam maps a source file to a doc section, and inventing that mapping
    // ("these files back those sections") is exactly the meaning-derivation
    // this tool refuses to do. The sample is of sections; the digest still
    // covers every source, and so does the claim.
    console.log(
      `      sources — ${axis.sources.entries.length} entr${axis.sources.entries.length === 1 ? "y" : "ies"}, ${plural(axis.sources.files, "file")}, all of them under the stamp:`,
    );
    for (const entry of axis.sources.entries) console.log(`          ${entry}`);
    console.log("");
  }
  for (const axis of plan.axes) if (axis.mode === "sampled") console.log(`  ${claim(axis, service)}\n`);
}

/**
 * The sampled half of the confirmation's own text, so the question a person
 * answers names the same sections the list above it did.
 */
export function promptClaim(plan: SamplePlan, service: string): string {
  // A type predicate, not a bare `.filter`: TypeScript does not narrow a union
  // through `filter`, and the alternative at the two use sites below is a cast
  // or a second impossible branch — both of which are a way to be wrong about
  // which arm this is.
  const sampled = plan.axes.filter((axis): axis is PlannedAxis & { mode: "sampled" } => axis.mode === "sampled");
  if (sampled.length === 0) {
    return (
      "You asked for a sample, and it covers every section of every file — so this is an ordinary full vouch " +
      "and nothing will record a partial read."
    );
  }
  return [
    `You are vouching for a SAMPLE: ${sampled
      .map((axis) => `${axis.file} ${axis.picked.length}/${axis.of}`)
      .join(", ")}. Everything else stays unread, and the document will say so.`,
    ...sampled.map((axis) => claim(axis, service)),
  ].join("\n");
}

/**
 * The additive `vouchScope` payload — the stamped scope plus the headings it
 * chose, so a consumer never has to re-derive the sample to find out what was
 * read. Null for a file vouched in full, because that IS the whole answer for
 * one, and a consumer that omitted the key could not tell it from an older
 * loam that never wrote one.
 */
export function scopeJson(scope: VouchScope | null, axis: PlannedAxis | undefined): Record<string, unknown> | null {
  if (scope === null) return null;
  return {
    mode: "sampled",
    sections: scope.sections,
    of: scope.of,
    seed: scope.seed,
    // Joined by file at the call site; an axis that does not answer leaves the
    // headings out rather than inventing them — the seed and the counts are
    // still enough to recompute the list.
    ...(axis === undefined || axis.mode !== "sampled"
      ? {}
      : { headings: axis.picked.map((section) => section.heading) }),
  };
}
