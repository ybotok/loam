/**
 * What a living document that `loam archive` CREATES says above
 * `## Requirements` — the part of a new service spec, architecture spec or
 * capability document that the requirement algebra has nothing to say about.
 *
 * THE DEFECT THIS CLOSES. A created document used to be a fixed header —
 * `service`, `status: draft`, `# <id>` — and the requirements. Everything else
 * the delta said was dropped in silence: its title, the narrative a reader
 * needs before the first requirement, the frontmatter `owner`, any section
 * written after the last delta section. The requirements arrived byte for byte
 * and the document arrived unreadable to anyone who had not read the delta.
 *
 * WHY NOT CARRY THE WHOLE PREAMBLE. "loam merges requirements, never prose"
 * (SCHEMA) is not an aversion to prose; it is the observation that a delta's
 * prose is ABOUT THE CHANGE. The scaffold's own H1 is "<svc> — requirement
 * delta for <FEAT>" and its intro tells the reviewer what a delta is; carrying
 * either into the living document would make it describe a pull request that
 * merged months ago. A machine cannot tell narrative about the service from
 * narrative about the change, so loam carries only what the author MARKED as
 * the document's own, and says where the rest is:
 *
 * - `owner` from the delta's frontmatter — the one field that describes the
 *   service rather than the change or a vouch (copying `vouched_by` or a digest
 *   would forge a review nobody performed). A capability document carries no
 *   frontmatter by decision (`planCapabilities` says why), so it gets none.
 *   Where the delta names none, intent.md's `owner` — but only for a service
 *   the archive brings into being (`fallbackOwner` says why).
 * - the delta's H1, unless it is about the change — it names the feature or
 *   calls itself a delta, which is exactly what the scaffold writes.
 * - the delta's `## Purpose` section, verbatim — the explicit marker, and the
 *   one OpenSpec's living specs already use for the document's own narrative.
 * - a back-link to the archived delta, always, so nothing the merge left behind
 *   is unreachable from the document it created.
 *
 * Only on CREATION. A living document that already exists keeps its own
 * narrative, edited in place; a `## Purpose` in a delta against it merges as
 * nothing, and `planSpecs` says so rather than letting it vanish.
 */
import { dirname, relative, sep } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { parseFrontmatter, stringField } from "../../../../core/document/frontmatter.js";
import { serializeRequirements, type Requirement } from "../../../../core/document/spec.js";
import { repoPath } from "../../../../core/envelope/json.js";
import { fenceTracker } from "../../../../core/kernel/fences.js";
import type { DocsDir } from "../../../../core/kernel/ids/dirs.js";
import type { Retarget } from "./links.js";

/** A level-1 heading line. */
const H1_RE = /^#\s+(.+?)\s*$/;
/** The marked section — matched on the whole trimmed line, case-insensitively, like `## Requirements`. */
const PURPOSE_RE = /^##\s+Purpose\s*$/i;
/** Where a section ends: the next H1 or H2. Deeper headings are the section's own. */
const SECTION_END_RE = /^#{1,2}\s/;

/** One living document this archive creates, and the delta it is created from. */
export interface CreatedRequest {
  docsDir: DocsDir;
  featureId: string;
  /** The delta's path, where it sits BEFORE the archive moves the feature. */
  deltaPath: string;
  /** The delta's text, its links already re-expressed for `livingPath`'s directory. */
  delta: string;
  livingPath: string;
  /** Where each feature file will be after the archive — the back-link's target comes from it. */
  retarget: Retarget;
  /** The heading written when the delta carries no title of its own. */
  fallbackTitle: string;
  /** The `service:` the created frontmatter names; null for a document that carries no frontmatter. */
  service: string | null;
  /**
   * `partial` when the document is a service's FIRST spec.md and the service
   * existed before this feature — so what lands is the feature's slice and
   * not the service. Written to the frontmatter as `adoption: partial`
   * (SCHEMA.md), which the maturity ladder and `loam status` read as "not
   * adopted yet" until a person deletes the line.
   */
  adoption?: "partial";
  /**
   * intent.md's `owner`, written when the delta's own frontmatter names none —
   * and passed ONLY for a service this archive creates. The intent's owner
   * answers for the change, and a service the change brings into being has no
   * other owner on record: without it the new spec.md and arch.spec.md drew
   * `frontmatter.field-missing` the moment they landed, under an archive that
   * called the living docs complete. A service that existed before the feature
   * has an owner the feature's author does not get to name, so it gets none.
   */
  fallbackOwner?: string;
  requirements: Requirement[];
}

/**
 * The created document's whole text, and the one line that tells the person
 * reading the plan what came across from the delta and where the rest is.
 */
export function createdDocument(request: CreatedRequest): { text: string; note: string } {
  const archived = request.retarget(request.deltaPath);
  // Percent-escaped spaces, as `rebaseLinks` writes a route it computed: a bare
  // space would end the link target at the first word.
  const backLink = relative(dirname(request.livingPath), archived).split(sep).join("/").split(" ").join("%20");
  const head = createdHead({ ...request, backLink });
  const where = repoPath(request.docsDir, archived);
  const note =
    head.carried.length > 0
      ? `carried from the delta: ${head.carried.join(", ")} — the rest of its prose stays in ${where}, linked from the new document`
      : `the delta's prose stays in ${where}, linked from the new document — mark what belongs here '## Purpose' and archive carries it`;
  return { text: `${head.text}## Requirements\n\n${serializeRequirements(request.requirements)}`, note };
}

interface HeadRequest {
  delta: string;
  featureId: string;
  fallbackTitle: string;
  service: string | null;
  adoption?: "partial";
  fallbackOwner?: string;
  /** The created document's relative link to the archived delta. */
  backLink: string;
}

interface CreatedHead {
  /** Everything above `## Requirements`, ending in a blank line. */
  text: string;
  /** What the delta contributed, in the words the per-file note prints. */
  carried: string[];
}

/** The head of a document archive creates — see the module comment for what goes in it and why. */
function createdHead(request: HeadRequest): CreatedHead {
  const fm = parseFrontmatter(request.delta);
  const marked = markedParts(fm.body, request.featureId);
  const declared = request.service === null ? undefined : stringField(fm, "owner");
  const owner = request.service === null ? undefined : (declared ?? request.fallbackOwner);
  const carried: string[] = [];
  let text = "";
  if (request.service !== null) {
    const fields = {
      service: request.service,
      status: "draft",
      ...(request.adoption === undefined ? {} : { adoption: request.adoption }),
      ...(owner === undefined ? {} : { owner }),
    };
    text += `---\n${stringifyYaml(fields, { lineWidth: 0 })}---\n\n`;
    if (declared !== undefined) carried.push("owner");
    else if (owner !== undefined) carried.push("owner (from intent.md)");
  }
  text += `# ${marked.title ?? request.fallbackTitle}\n\n`;
  if (marked.title !== undefined) carried.push("its title");
  text += `Created when ${request.featureId} was archived; [its delta](${request.backLink}) keeps the prose written for that change.\n\n`;
  if (marked.purpose !== undefined) {
    text += `## Purpose\n\n${marked.purpose}\n\n`;
    carried.push("its ## Purpose");
  }
  return { text, carried };
}

/** Does the delta carry a `## Purpose` section at all — the question a merge into an EXISTING document asks. */
export function hasPurpose(delta: string): boolean {
  return markedParts(parseFrontmatter(delta).body, "").purpose !== undefined;
}

/**
 * Is this H1 the CHANGE's title rather than the document's? Two mechanical
 * signals, both in words loam owns: it names the feature, or it calls itself a
 * delta — which no living document does, and which every delta title loam
 * scaffolds does both of ("<svc> — requirement delta for <FEAT>"). Anything
 * else is a title an author chose for the thing itself, the shape a domain
 * written into a feature in one go arrives in.
 */
function namesTheChange(title: string, featureId: string): boolean {
  const lower = title.toLowerCase();
  return (featureId !== "" && lower.includes(featureId.toLowerCase())) || /\bdelta\b/.test(lower);
}

/**
 * The delta's title and `## Purpose` body, each only when the author wrote one
 * that belongs to the living document. Fence-aware, like every heading walk in
 * loam: a heading inside a fenced block is quoted text, and a fenced block
 * inside the Purpose is part of it.
 */
function markedParts(body: string, featureId: string): { title?: string; purpose?: string } {
  const fenced = fenceTracker();
  let title: string | undefined;
  let seenSection = false;
  let purpose: string[] | null = null;
  let purposeEnded = false;
  for (const line of body.split(/\r?\n/)) {
    const quoted = fenced(line);
    if (purpose !== null && !purposeEnded) {
      if (quoted || !SECTION_END_RE.test(line)) {
        purpose.push(line);
        continue;
      }
      purposeEnded = true;
    }
    if (quoted) continue;
    const h1 = H1_RE.exec(line);
    // The document's title is an H1 above its first section; one further down
    // is a heading inside the text, not the name of the document.
    if (h1 !== null && !seenSection && title === undefined) title = h1[1]!;
    if (/^##\s/.test(line)) {
      seenSection = true;
      if (purpose === null && PURPOSE_RE.test(line.trim())) purpose = [];
    }
  }
  // Blank LINES trimmed, never leading spaces: an indented code block opening
  // the section is the author's text.
  const purposeText = purpose?.join("\n").replace(/^(?:[ \t]*\n)+/, "").trimEnd();
  return {
    ...(title === undefined || namesTheChange(title, featureId) ? {} : { title }),
    ...(purposeText === undefined || purposeText === "" ? {} : { purpose: purposeText }),
  };
}
