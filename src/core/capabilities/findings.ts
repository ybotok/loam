/**
 * The capability grades, in every direction the axis is graded: a `Capability:`
 * entry the vocabulary does not declare, a vocabulary nobody can read, a
 * declared capability no living requirement realizes, a directory that declares
 * nothing, and the two rules an authored capability document itself must keep.
 * Values only — core never prints — and the join rule shaped twice (Finding for
 * validate, Issue for coherence), both spelled with literal codes so
 * test/codes-drift.test.ts can collect them.
 *
 * The opt-in rule lives here, and it deliberately DIVERGES from `Requires:`.
 * There the LINE is the opt-in: a `Requires:` entry against a missing
 * permissions.yaml errors, because an authorization join that resolves against
 * nothing is the failure that axis exists to prevent. Here the FLEET'S OWN
 * FILES are the opt-in — `architecture/capabilities.yaml`, the `capabilities/`
 * tree, or both — so a fleet holding neither stays finding-free however many
 * `Capability:` lines its requirements already carry. (The roadmap's exit
 * criterion was written when the YAML was the only side and says 'a fleet with
 * no architecture/capabilities.yaml produces no capability findings at all';
 * the authored tree is the second way to opt in, and `CapabilityVocabulary.present`
 * is where the two are combined.) An INVALID vocabulary is also silence for the
 * per-entry grades — `capability.invalid` is the honest finding there, and
 * grading a hundred entries against a file nobody can read is the cascade that
 * suppression exists to stop.
 */
import { closeIds } from "../c4/arch.js";
import { compareIds } from "../repo/entries.js";
import type { Requirement } from "../document/spec.js";
import type { Finding } from "../vocabulary/report.js";
import type { Issue } from "../vocabulary/issue.js";
import type { CapabilityVocabulary } from "./capabilities.js";
import type { CapabilityTree } from "./tree.js";
import type { CapabilityRequirementIndex } from "./realizes/join.js";

/** Which document is being graded, and under whose name the finding is filed. */
export interface CapabilityTarget {
  where: string;
  subject: string;
}

/**
 * THE LADDER, and the only place it is applied: the declared capability ids when
 * the vocabulary can be graded against at all, `null` when it cannot.
 *
 * Exported because the suppression is not this module's private business — the
 * use-case axis asks the same question about the same file
 * (`commands/validate/fleet/landscape.ts` hands the answer to
 * `usecases/capability-tag.ts`), and a hand-rolled
 * `present && invalid === undefined ? [...byId.keys()] : null` at each site is
 * three copies of one rule. The failure that costs is not hypothetical: the next
 * un-gradable state added to `CapabilityVocabulary` — "present but partially
 * readable" is the obvious one, since `readCapabilities` already treats a
 * non-mapping declaration body as `{}` — gets fixed wherever the greps land, and
 * any copy left behind answers with the whole key set. A half-read vocabulary
 * then reads as a complete one, and every `#cap-` tag whose capability lived in
 * the unreadable half becomes one `usecase.capability-unresolved` ERROR per
 * view: the cascade this ladder exists to prevent, arriving through the ladder.
 *
 * `null` rather than `[]`, and the two are never interchangeable: an empty list
 * is the real verdict "this fleet declares no capabilities" and every entry
 * fails against it, while `null` says there is nothing to grade against and
 * suspends the family. Callers that only need the boolean read `=== null`.
 */
export function gradableCapabilityIds(vocab: CapabilityVocabulary): readonly string[] | null {
  if (!vocab.present || vocab.invalid !== undefined) return null;
  return [...vocab.byId.keys()];
}

/** One unresolved entry: the requirement that wrote it, the entry, the close names. */
interface UnknownEntry {
  requirement: string;
  entry: string;
  close: string[];
}

/** Non-REMOVED requirements' entries the vocabulary does not declare — or nothing, per the opt-in rule above. */
function unknownEntries(reqs: Requirement[], vocab: CapabilityVocabulary): UnknownEntry[] {
  const known = gradableCapabilityIds(vocab);
  if (known === null) return [];
  const out: UnknownEntry[] = [];
  for (const r of reqs) {
    if (r.kind === "REMOVED") continue;
    for (const entry of r.capabilities) {
      if (vocab.byId.has(entry)) continue;
      out.push({ requirement: r.name, entry, close: closeIds(entry, known) });
    }
  }
  return out;
}

function unknownMessage(where: string, u: UnknownEntry): string {
  return (
    `${where}: requirement '${u.requirement}' — Capability: '${u.entry}' is declared neither in architecture/capabilities.yaml nor as capabilities/${u.entry}/spec.md` +
    (u.close.length > 0
      ? `. Did you mean: ${u.close.join(", ")}?`
      : ". Declare it in either — a name alone is a `capabilities: {<id>: {description, owner}}` entry, a name with prose behind it is the document — or fix the spelling")
  );
}

/**
 * `capability.unknown` as validate sees it — an ERROR, the same grade as
 * `Requires:` and for its reason: an invented capability reads exactly like a
 * real one in the requirement and in every rollup built over it.
 */
export function capabilityUnknownFindings(
  reqs: Requirement[],
  target: CapabilityTarget,
  vocab: CapabilityVocabulary,
): Finding[] {
  return unknownEntries(reqs, vocab).map((u) => ({
    severity: "error" as const,
    code: "capability.unknown",
    subject: target.subject,
    message: unknownMessage(target.where, u),
  }));
}

/**
 * The same rule shaped as coherence Issues, for a feature's delta documents: a
 * delta requirement naming an undeclared capability would merge a join that
 * resolves to nothing, so it gates `loam archive` like other errors and stays
 * `--approve`-overridable. The one new archive gate of this axis.
 */
export function capabilityUnknownIssues(
  reqs: Requirement[],
  target: CapabilityTarget,
  vocab: CapabilityVocabulary,
): Issue[] {
  return unknownEntries(reqs, vocab).map((u) => ({
    severity: "error" as const,
    code: "capability.unknown" as const,
    subject: target.subject,
    message: unknownMessage(target.where, u),
  }));
}

/**
 * `capability.invalid` — the whole run's ONE finding about an unreadable
 * vocabulary, spelling the expected shape. Every grade that RESOLVES AGAINST
 * the vocabulary stays suspended behind it (see the module comment); the
 * authored tree's own grades do not, because none of them consults it — a
 * directory holding no document, a requirement without a stable id and a
 * requirement carrying a service-level join are facts about files that a broken
 * YAML does not make untrue, and hiding them until an unrelated file parses is
 * suppression without the cascade that justifies it.
 */
export function invalidVocabularyFinding(vocab: CapabilityVocabulary): Finding | null {
  if (vocab.invalid === undefined) return null;
  return {
    severity: "error",
    code: "capability.invalid",
    message:
      `landscape: architecture/capabilities.yaml does not read as a vocabulary — ${vocab.invalid}. ` +
      "Every `Capability:` line in the fleet resolves against this file, so the whole capability family is suspended until it parses — fix the YAML first. " +
      "The shape is `capabilities: {<id>: {description, owner}}`, ids flat keys with `/` allowed for nesting.",
  };
}

/**
 * `capability.unrealized` — ONE warn per declared capability no living
 * non-REMOVED requirement names, subject = the id, sorted with compareIds.
 * Per capability rather than one rollup finding with details[] (the
 * permissions.unenforced shape) because the roadmap's own exit criterion is
 * 'one warning per capability, not one per service' — each is a distinct
 * promise nobody implemented, or a distinct word nobody adopted.
 */
export function unrealizedFindings(vocab: CapabilityVocabulary, used: ReadonlySet<string>): Finding[] {
  const declared = gradableCapabilityIds(vocab);
  if (declared === null) return [];
  return declared
    .filter((id) => !used.has(id))
    .sort(compareIds)
    .map((id) => ({
      severity: "warn" as const,
      code: "capability.unrealized",
      subject: id,
      message:
        `landscape: capability '${id}' is declared in ${declaredIn(vocab, id)} and no living requirement's \`Capability:\` line names it — ` +
        "either a promise nobody implemented or a word nobody adopted; write the requirement that realizes it, or drop the declaration",
    }));
}

/**
 * Where an id was declared, spelled for a message. The fix differs by side —
 * a YAML line is deleted, a document is deleted with its directory — and a
 * message naming the wrong file sends its reader to edit something that is not
 * there. `both` names both because either alone would leave the id declared.
 */
function declaredIn(vocab: CapabilityVocabulary, id: string): string {
  const source = vocab.byId.get(id)?.source;
  if (source === "tree") return `capabilities/${id}/spec.md`;
  if (source === "both") return `architecture/capabilities.yaml and capabilities/${id}/spec.md`;
  return "architecture/capabilities.yaml";
}

/* ------------------------------------------------------------------ */
/* The authored tree — the documents themselves, graded on their own    */
/* terms rather than on the join any requirement makes to them.         */
/* ------------------------------------------------------------------ */

/**
 * `capability.doc-missing` — a directory under `capabilities/` that holds no
 * `spec.md` and has no capability beneath it.
 *
 * WARN, not error, and the severity is the whole judgement: the state it names
 * is what `mkdir` leaves behind halfway through creating a capability, and a
 * half-finished authoring step must not fail somebody else's `loam validate`
 * on the same tree. What makes it worth a finding at all is that the directory
 * LOOKS declared — a reader browsing `capabilities/` counts it, and a
 * `Capability:` line naming it still reports `capability.unknown`, which is the
 * confusing pair this warning exists to join up.
 */
export function docMissingFindings(tree: CapabilityTree): Finding[] {
  return tree.undocumented.map((path) => ({
    severity: "warn" as const,
    code: "capability.doc-missing",
    subject: path,
    message:
      `${path}/ holds no spec.md and no capability beneath it — a directory under capabilities/ is a capability only when it holds the document, ` +
      `so this one declares nothing and a requirement naming it still reports capability.unknown. ` +
      `Write ${path}/spec.md (the narrative, then \`## Requirements\`), or remove the directory.`,
  }));
}

/**
 * The service-level joins, and the whole of what "names no service" is checked
 * as. Each entry is a `Requirement` field that is non-empty exactly when the
 * requirement wrote the line and named something in it.
 *
 * THE PROSE RULE IS NOT CHECKED AND MUST NOT BE FAKED. "A capability
 * requirement names no service" is an authoring rule about wording, and the
 * only mechanical reading of it — scanning the text for a declared service id —
 * is a heuristic that convicts a payments capability for the word "payments".
 * loam refuses that class of check everywhere else and refuses it here; PR
 * review holds the prose. What IS exact is the structural half: these four
 * lines resolve against a SERVICE's contract and model, so a requirement
 * carrying one has already left the business altitude whatever its wording
 * says. `Requires:` is deliberately absent — a permission is a domain fact
 * ("who may see a profile"), observable outside the fleet, and gating a
 * capability requirement on one is legitimate.
 */
const SERVICE_JOINS = [
  { field: "operations", line: "Operations:", names: "an operationId in a service's openapi.yaml" },
  { field: "covers", line: "Covers:", names: "a C4 element, edge or health signal" },
  { field: "publishes", line: "Publishes:", names: "an AsyncAPI message a service produces" },
  { field: "consumes", line: "Consumes:", names: "an AsyncAPI message a service consumes" },
] as const satisfies ReadonlyArray<{ field: keyof Requirement; line: string; names: string }>;

/**
 * The two joins that point INTO the capability tree, and are therefore inert
 * written inside it.
 *
 * Not "wrong at this altitude" like the four above — these are the axis's own
 * lines. They are refused here because nothing reads them: `capabilityRollup`
 * joins SERVICE requirements to capabilities, so a `Capability:` line in a
 * capability document is a requirement claiming the document it is already in,
 * and a `Realizes:` line there points at a promise loam will never see anybody
 * keep. Both parse, both look exactly like the working joins one directory
 * over, and both would sit in a reviewed document meaning nothing.
 *
 * A capability realizing ANOTHER capability's requirement — a nested
 * `payments/refunds` serving a promise made by `payments` — is a real idea and
 * is deliberately not being smuggled in as a line that happens to parse. It
 * would need a design: a second corpus of joins, its own cycle rule, and an
 * answer for what `capability.requirement-unrealized` means when the realizer
 * is itself unrealized. Refusing the line now is what keeps that decision open.
 */
const INTERNAL_JOINS = [
  {
    field: "capabilities",
    line: "Capability:",
    why: "the rollup joins SERVICE requirements to capabilities, so written here it claims the document it is already in",
  },
  {
    field: "realizes",
    line: "Realizes:",
    why: "a capability requirement is what gets realized, not what realizes — nothing reads this line inside the tree",
  },
] as const satisfies ReadonlyArray<{ field: keyof Requirement; line: string; why: string }>;

/**
 * Both grades a capability document earns on its own: every requirement needs
 * a stable id, and none may carry a service-level join.
 *
 * `where` is the document's repo-relative path and `subject` the capability id,
 * so a `--json` consumer can group by capability while a reader gets the file.
 * The two grades ride one walk because they ask about the same requirements and
 * a second pass is a second chance to disagree about which ones are graded.
 */
export function capabilityDocFindings(reqs: Requirement[], id: string): Finding[] {
  const where = `capabilities/${id}/spec.md`;
  const findings: Finding[] = [];
  for (const r of reqs) {
    if (r.id === undefined) {
      findings.push({
        severity: "error",
        code: "capability.requirement-unidentified",
        subject: id,
        message:
          `${where}: requirement '${r.name}' has no \`Requirement-ID:\` line. ` +
          "A capability document outlives every service that realizes it, so its requirements are identified by a stable id rather than by their heading — " +
          "without one, rewording the heading is a removal and an addition, and every join made to it breaks silently. " +
          "Add `Requirement-ID: <id>` as the first body line.",
      });
    }
    for (const join of SERVICE_JOINS) {
      if (r[join.field].length === 0) continue;
      findings.push({
        severity: "error",
        code: "capability.requirement-service-scoped",
        subject: id,
        message:
          `${where}: requirement '${r.name}' carries \`${join.line}\`, which names ${join.names}. ` +
          "A capability requirement must be observable outside the fleet — a promise a customer could check — and these lines resolve against one service's own contract, " +
          "so a requirement carrying one is a service requirement filed at the wrong altitude. " +
          "Move it into that service's spec.md, where the line resolves; what belongs here is the promise, not the mechanism.",
      });
    }
    for (const join of INTERNAL_JOINS) {
      if (r[join.field].length === 0) continue;
      findings.push({
        severity: "error",
        code: "capability.requirement-inert-join",
        subject: id,
        message:
          `${where}: requirement '${r.name}' carries \`${join.line}\`, which does nothing in a capability document — ` +
          `${join.why}. It parses and reads exactly like the working join one directory over, which is why it is refused ` +
          "rather than ignored. Delete the line; the join that matters is written on the SERVICE requirement, as " +
          `\`Realizes: ${id}#${r.id ?? "<Requirement-ID>"}\`.`,
      });
    }
  }
  return findings;
}

/**
 * The requirement ids each capability document declares, with THE LADDER
 * already applied — the one shape `Realizes:` is ever resolved against.
 *
 * Built here rather than at the three call sites for the reason
 * `gradableCapabilityIds` above is exported: the suppression rule and the index
 * it guards belong together. A caller that composed them itself would be a
 * fourth place where "can this be graded at all" is decided, and the first one
 * to be forgotten when a fifth un-gradable vocabulary state arrives.
 *
 * A requirement with no `Requirement-ID:` is absent from the index, so a
 * `Realizes:` entry naming its heading does not resolve. That is deliberate and
 * not a gap: an unidentified capability requirement is already an ERROR
 * (`capability.requirement-unidentified`), and letting a heading work as an
 * address would quietly reintroduce the identity-by-heading the tree exists to
 * refuse. REMOVED is skipped for the reason every other reader skips it.
 *
 * The reads are NOT wrapped: a `capabilities/<id>/spec.md` that cannot be
 * decoded takes the run down exactly as a service spec does — the rule
 * `capabilityFleetFindings` already states one directory over.
 */
export async function capabilityRequirementIndex(
  vocab: CapabilityVocabulary,
  read: (path: string) => Promise<Requirement[]>,
): Promise<CapabilityRequirementIndex> {
  const declared = gradableCapabilityIds(vocab);
  const byCapability = new Map<string, ReadonlySet<string>>();
  if (declared === null) return { declared, byCapability };
  for (const doc of vocab.tree.docs) {
    const reqs = await read(doc.spec);
    byCapability.set(
      doc.id,
      new Set(reqs.flatMap((r) => (r.kind === "REMOVED" || r.id === undefined ? [] : [r.id]))),
    );
  }
  return { declared, byCapability };
}
