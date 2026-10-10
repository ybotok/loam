/**
 * `loam new --modifies <Req-ID>`: the small-change lane's one hand step,
 * done by the scaffold.
 *
 * A change that rewrites a requirement the fleet already has used to cost a
 * hand copy and a second command: the scaffold offered only the ADDED example
 * inside its comment, so the author copied the living requirement into a
 * `## MODIFIED Requirements` section by hand — most of a small delta is that
 * copy — and then ran `loam rebase` to pin it. This module does both at
 * scaffold time: it finds each named requirement in the living specs of the
 * services the feature touches and writes it, UNCOMMENTED, under a MODIFIED
 * heading with its `Based-On:` pin already set.
 *
 * THE PIN IS REBASE'S PIN, not a second rule for one. `requirementDigest` of
 * the living requirement, selected by its `Requirement-ID:` exactly as
 * `selectLiving` (commands/rebase/plan.ts) selects one, and written where
 * `serializeRequirements` puts it — under the id line, where `pinEdit` inserts
 * it too. So a scaffold followed by `loam rebase` reports every pin
 * `unchanged`, and a living requirement that moves between this scaffold and
 * the archive is `delta.baseline-stale`, exactly as if the author had copied
 * and pinned it by hand at this moment. The gate is the same gate; only the
 * typing went away.
 *
 * WHY THE BLOCK SHIPS LIVE, when every other template example ships inside a
 * comment. Those examples are placeholder text nobody wrote, and a live one
 * once archived a literal TODO into the living spec — so they declare nothing
 * until a person copies them out. This block is the opposite: it is the
 * fleet's own current text, and the one honest state for it to be in is the
 * state archive would merge. Left unedited it merges as no change to the
 * living wording, which is why the comment above it says to edit in place.
 *
 * ADDRESSED BY `Requirement-ID:` ONLY. A requirement without that line is
 * addressed by its heading everywhere else, but a heading is free text with
 * spaces in it and no grammar a flag value can be checked against; offering it
 * here would teach identity-by-heading on the one path built to be typed.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { repoPath } from "../../core/envelope/json.js";
import { NotUtf8DocumentError } from "../../core/kernel/document-bytes.js";
import { parseRequirements, readRequirementsDocument } from "../../core/document/parse.js";
import {
  REQUIREMENT_ID_RE,
  requirementDigest,
  serializeRequirements,
  withoutBaseline,
  type Requirement,
} from "../../core/document/spec.js";
import { compareIds, nearestIds, type ServiceEntry } from "../../core/repo/entries.js";
import { SPEC_AXES, servicePathsAt, type SpecAxis } from "../../core/repo/paths.js";
import { enumeratedServices } from "../../core/repo/service-target.js";
import type { DocsDir } from "../../core/kernel/ids/dirs.js";
import { archSpecTemplate, specTemplate } from "./templates.js";

/** One living requirement `--modifies` named, where it lives, and the pin it is scaffolded with. */
export interface ModifiedTarget {
  readonly id: string;
  readonly service: string;
  readonly axis: SpecAxis;
  /** The living document it was copied from, repo-relative — what a message names. */
  readonly living: string;
  /** The living requirement, its pin set — the block the delta carries. */
  readonly requirement: Requirement;
}

export type ModifiesPlan =
  | { readonly ok: true; readonly targets: readonly ModifiedTarget[] }
  | { readonly ok: false; readonly code: "invalid-option" | "unknown-target" | "merge-failed"; readonly message: string };

/** Every identified requirement in one service's living spec files, one entry per (axis, requirement). */
async function livingRequirements(docsDir: DocsDir, entry: ServiceEntry): Promise<ModifiedTarget[]> {
  const paths = servicePathsAt(entry.dir);
  const found: ModifiedTarget[] = [];
  for (const axis of SPEC_AXES) {
    const path = paths[axis.key];
    if (!existsSync(path)) continue;
    for (const r of parseRequirements(await readRequirementsDocument(path))) {
      if (r.id === undefined) continue;
      // The pin is taken over the requirement WITHOUT any baseline it carries —
      // a living document should hold none (archive strips them), and one that
      // does must not end up with two `Based-On:` lines in the scaffold.
      const living = withoutBaseline(r);
      found.push({
        id: r.id,
        service: entry.id,
        axis,
        living: repoPath(docsDir, path),
        requirement: { ...living, basedOn: requirementDigest(living) },
      });
    }
  }
  return found;
}

/**
 * Which services OUTSIDE the touched set carry the id — read only on the
 * refusal path, where a fleet-wide walk is paid once by a run that is about to
 * stop anyway. The commonest way to miss is to name the right requirement and
 * the wrong (or no) `--touches`, and the useful refusal names the service.
 * An undecodable document there is skipped: this is a hint, not a grade.
 */
async function carriersElsewhere(docsDir: DocsDir, id: string, skip: ReadonlySet<string>): Promise<string[]> {
  const carriers: string[] = [];
  for (const entry of await enumeratedServices(docsDir)) {
    if (skip.has(entry.id)) continue;
    try {
      if ((await livingRequirements(docsDir, entry)).some((t) => t.id === id)) carriers.push(entry.id);
    } catch (err) {
      if (!(err instanceof NotUtf8DocumentError)) throw err;
    }
  }
  return carriers.sort(compareIds);
}

function unknownMessage(id: string, touched: readonly string[], known: readonly string[]): string {
  const where = touched.length === 0
    ? "this feature touches no service — name the one that owns it with --touches"
    : `it names no requirement in the living specs of ${touched.map((s) => `'${s}'`).join(", ")}`;
  const near = nearestIds(id, [...known]);
  return (
    `--modifies '${id}': ${where}.` +
    (near.length === 0 ? "" : ` Did you mean ${near.map((n) => `'${n}'`).join(" or ")}?`) +
    " A requirement is addressed by its `Requirement-ID:` line; one without that line cannot be named here."
  );
}

/**
 * Resolve every `--modifies` id against the living specs of the touched
 * services, before anything is written. In flag order, each id once.
 */
export async function planModifies(
  docsDir: DocsDir,
  touched: readonly string[],
  ids: readonly string[],
): Promise<ModifiesPlan> {
  for (const id of ids) {
    if (!REQUIREMENT_ID_RE.test(id)) {
      return {
        ok: false,
        code: "invalid-option",
        message: `--modifies '${id}' is not a Requirement-ID — it takes the value of a living requirement's \`Requirement-ID:\` line, not its heading.`,
      };
    }
  }
  const scope = new Set(touched);
  let living: ModifiedTarget[] = [];
  try {
    for (const entry of await enumeratedServices(docsDir)) {
      if (scope.has(entry.id)) living = living.concat(await livingRequirements(docsDir, entry));
    }
  } catch (err) {
    if (!(err instanceof NotUtf8DocumentError)) throw err;
    // A pin is a claim about text somebody read, and over a document loam could
    // not decode it would be a digest of mojibake — `loam rebase` refuses the
    // same document under the same code, and so does this, before any write.
    return { ok: false, code: "merge-failed", message: `--modifies cannot copy from a living spec loam cannot read — nothing was scaffolded: ${err.message}` };
  }
  const targets: ModifiedTarget[] = [];
  for (const id of new Set(ids)) {
    const hits = living.filter((t) => t.id === id);
    if (hits.length === 1) {
      targets.push(hits[0]!);
      continue;
    }
    if (hits.length > 1) {
      // A Requirement-ID is unique inside ONE document, so two touched
      // documents may both carry it (and a document that repeats one is its
      // own finding, `delta.living-duplicate-requirement`). Picking one would
      // be loam guessing which requirement the author means to rewrite.
      return {
        ok: false,
        code: "invalid-option",
        message:
          `--modifies '${id}' is a Requirement-ID in more than one living document this feature touches ` +
          `(${[...new Set(hits.map((t) => t.living))].join(", ")}), and an id is unique only inside its own document. ` +
          "Touch only the service whose requirement changes, and write the other service's delta by hand.",
      };
    }
    const elsewhere = await carriersElsewhere(docsDir, id, scope);
    const known = [...new Set(living.map((t) => t.id))];
    return {
      ok: false,
      code: "unknown-target",
      message: elsewhere.length > 0
        ? `--modifies '${id}' is a requirement of ${elsewhere.map((s) => `'${s}'`).join(", ")}, which this feature does not touch — add --touches ${elsewhere[0]}.`
        : unknownMessage(id, touched, known),
    };
  }
  return { ok: true, targets };
}

/**
 * The MODIFIED section one delta file carries, appended after the template's
 * own comment. The guidance sits ABOVE the H2 on purpose: below it, before the
 * first `### Requirement:`, it would be section prose of the very section the
 * merge reads, and no comment there is worth that question.
 */
export function modifiedSection(featureId: string, targets: readonly ModifiedTarget[]): string {
  return `
<!-- Each requirement below is the LIVING text, copied by \`loam new\` for an id you
     named and pinned (Based-On:) to the version you are rewriting — the pin
     \`loam rebase ${featureId}\` would write, so there is nothing to rebase unless the
     living text moves first.
     Edit it in place: a MODIFIED carries its full new text, and archive replaces the
     living requirement with exactly what is here — left as copied, it changes nothing.
     Keep the Requirement-ID: and Based-On: lines as they are. -->

## MODIFIED Requirements

${serializeRequirements(targets.map((t) => t.requirement))}`;
}

/**
 * The delta files `--modifies` writes or extends, keyed as `new` keys its
 * plan (relative to the feature directory). A business-axis target lands in
 * the `spec.md` the touched service already gets; an architecture-axis target
 * gets the `arch.spec.md` template a touched service is otherwise not handed,
 * because the requirement it rewrites lives there.
 */
export function modifiedFiles(
  featureId: string,
  targets: readonly ModifiedTarget[],
  planned: Readonly<Record<string, string>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of targets) {
    const rel = join("specs", t.service, t.axis.file);
    if (rel in out) continue;
    const mine = targets.filter((other) => other.service === t.service && other.axis.key === t.axis.key);
    const base = planned[rel] ?? (t.axis.key === "spec" ? specTemplate(featureId, t.service) : archSpecTemplate(featureId, t.service));
    out[rel] = base + modifiedSection(featureId, mine);
  }
  return out;
}
