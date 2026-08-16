/**
 * A requirement set as a `.feature` file: what gets written where, and what the
 * text says.
 *
 * The plan is separate from the render because the two answer to different
 * owners — where a suite lands is the service repository's layout question
 * (`./stamp.ts` owns the root), while what a scenario reads like is the
 * requirement's. Every emitted scenario carries the digest tag the claim
 * checklist matches on, which is why nothing here may reword a scenario body.
 */
import { type Requirement } from "../document/spec.js";
import { scenarioGherkin } from "../vocabulary/steps.js";
import { type SpecAxis } from "../repo/paths.js";
import { type ScenarioAxis } from "../verify/checklist.js";
import { gherkinStampLine, scenarioDigest, scenarioDigestTag } from "./stamp.js";

/** The axis label the machine contract speaks. */
export function axisLabel(axis: SpecAxis): "business" | "arch" {
  return axis.key === "archSpec" ? "arch" : "business";
}

/**
 * A requirement name as a file name: lowercase, every non-letter/digit run one
 * hyphen, edges trimmed.
 *
 * The keep-set is `\p{L}\p{N}`, not `[a-z0-9]`, because an ASCII-only slug is
 * not a slug of a non-Latin fleet — it is the empty string. Every requirement
 * written in Chinese, Japanese, Korean, Greek, Cyrillic or Hebrew slugged to
 * nothing, fell back to `requirement`, and the whole service's suite came out
 * as `requirement.feature`, `requirement-2.feature`, … : file names that name
 * nothing, in the one place the mapping is supposed to be legible. So letters
 * of every script survive as themselves.
 *
 * Accents are folded rather than kept, and that is the reason for NFKD first:
 * decomposing splits `é` into `e` + a combining acute, and dropping the
 * combining marks (`\p{M}`) leaves `e`. Without the fold `émojis` and `emojis`
 * would be two files that look identical in a directory listing — and on a
 * filesystem that normalises names (APFS, and HFS+ before it) they would be one
 * file, silently, with the second emission overwriting the first.
 *
 * A name this still leaves empty (all punctuation or emoji) falls back to
 * "requirement" and lets the collision counter number it. Runs collapse to a
 * SINGLE hyphen, which is what keeps the `arch--` prefix an axis marker no
 * business slug can spell.
 */
export function slugOf(name: string): string {
  const s = name
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return s.length > 0 ? s : "requirement";
}

export interface PlannedFeature {
  /** File name under `<gherkinDir>/loam/` — flat, never a subdirectory. */
  fileName: string;
  axis: SpecAxis;
  requirement: Requirement;
  /** One digest per scenario, in scenario order — what the stamps say. */
  digests: string[];
  /**
   * Names of scenarios that yielded ZERO steps — numbered-step or prose-only
   * legacy bodies. Their `Scenario:` blocks are description-only: cucumber
   * runs them vacuously green, while `--results` (which requires at least one
   * passed step) can never confirm them — so the emission must say so out
   * loud, and the fix is rewording the spec bullets, never editing the file.
   */
  stepless: string[];
  content: string;
}

/**
 * The emission plan for one scope: one `.feature` per requirement.
 *
 * File naming is the mapping's contract, so it is spelled here once:
 * `<slug>.feature` for the business axis, `arch--<slug>.feature` for the
 * architecture axis — flat and diffable, and collision-proof across axes
 * because slugs collapse punctuation runs to a single hyphen, so no business
 * slug can ever begin `arch--`. Two requirements slugging identically are
 * disambiguated in document order: the first keeps the bare slug, later ones
 * take `-2`, `-3`, … (counting up past any name that already owns the suffix).
 *
 * Tags ride the `Feature:` line and are inherited by every scenario in the
 * file: `@<FEAT>` in feature mode (living emissions carry no feature tag),
 * `@architecture` on the arch axis.
 *
 * `opts.service` is the suite's owner and salts every digest stamp — the same
 * service `loam verify` files the matching claims under. Required, not
 * defaulted: an emission that guessed it would stamp tags no claim matches.
 */
export function planEmission(
  byAxis: Array<{ axis: SpecAxis; reqs: Requirement[] }>,
  opts: { service: string; featureTag?: string; version: string },
): PlannedFeature[] {
  const used = new Set<string>();
  const out: PlannedFeature[] = [];
  for (const { axis, reqs } of byAxis) {
    for (const r of reqs) {
      const base = (axis.key === "archSpec" ? "arch--" : "") + slugOf(r.name);
      let fileName = `${base}.feature`;
      for (let n = 2; used.has(fileName); n += 1) fileName = `${base}-${n}.feature`;
      used.add(fileName);
      const tags = [
        ...(opts.featureTag === undefined ? [] : [`@${opts.featureTag}`]),
        ...(axis.key === "archSpec" ? ["@architecture"] : []),
      ];
      const { content, digests, stepless } = renderFeature(
        r,
        tags,
        opts.version,
        opts.service,
        axisLabel(axis),
      );
      out.push({ fileName, axis, requirement: r, digests, stepless, content });
    }
  }
  return out;
}

/**
 * One requirement as one `.feature` file: `Feature:` is the requirement name,
 * its body text (Operations:/Covers: lines included — they are part of what
 * the requirement says) becomes the feature description, and each scenario
 * renders under its `@loam-digest-…` tag — the tag line sits directly above
 * the `Scenario:` keyword, where Gherkin puts scenario-level tags, so the
 * runner attaches it to the scenario and carries it into the JSON report.
 * Deterministic to the byte.
 *
 * `service` is the owner of the suite being written, and it salts every digest
 * — the same service `loam verify` files the matching claims under. The two
 * have to be the same string or the stamps this writes match no claim at all.
 */
export function renderFeature(
  r: Requirement,
  tags: string[],
  version: string,
  service: string,
  axis: ScenarioAxis = "business",
): { content: string; digests: string[]; stepless: string[] } {
  const lines: string[] = [gherkinStampLine(version)];
  if (tags.length > 0) lines.push(tags.join(" "));
  lines.push(`Feature: ${r.name}`);
  const text = r.text.join("\n").trim();
  if (text.length > 0) {
    lines.push("");
    for (const l of text.split("\n")) lines.push(l.length > 0 ? `  ${l}` : "");
  }
  const digests: string[] = [];
  const stepless: string[] = [];
  for (const s of r.scenarios) {
    const digest = scenarioDigest(service, s.lines, axis);
    digests.push(digest);
    lines.push("", `  ${scenarioDigestTag(digest)}`, `  Scenario: ${s.name}`);
    const { description, steps } = scenarioGherkin(s.lines);
    if (steps.length === 0) stepless.push(s.name);
    for (const d of description) lines.push(`    ${d}`);
    for (const st of steps) lines.push(`    ${st}`);
  }
  return { content: lines.join("\n") + "\n", digests, stepless };
}
