/**
 * The capability grades, both directions: a `Capability:` entry the vocabulary
 * does not declare, a vocabulary nobody can read, and a declared capability no
 * living requirement realizes. Values only — core never prints — and the same
 * rule shaped twice (Finding for validate, Issue for coherence), both spelled
 * with literal codes so test/codes-drift.test.ts can collect them.
 *
 * The opt-in rule lives here, and it deliberately DIVERGES from `Requires:`.
 * There the LINE is the opt-in: a `Requires:` entry against a missing
 * permissions.yaml errors, because an authorization join that resolves against
 * nothing is the failure that axis exists to prevent. Here the FILE is the
 * opt-in: the roadmap's exit criterion is 'a fleet with no
 * architecture/capabilities.yaml produces no capability findings at all', so a
 * fleet that has not adopted the axis stays finding-free however many
 * `Capability:` lines its requirements already carry. An INVALID vocabulary is
 * also silence for the per-entry grades — `capability.invalid` is the honest
 * finding there, and grading a hundred entries against a file nobody can read
 * is the cascade that suppression exists to stop.
 */
import { closeIds } from "../c4/arch.js";
import { compareIds } from "../repo/entries.js";
import type { Requirement } from "../document/spec.js";
import type { Finding } from "../vocabulary/report.js";
import type { Issue } from "../vocabulary/issue.js";
import type { CapabilityVocabulary } from "./capabilities.js";

/** Which document is being graded, and under whose name the finding is filed. */
export interface CapabilityTarget {
  where: string;
  subject: string;
}

/** One unresolved entry: the requirement that wrote it, the entry, the close names. */
interface UnknownEntry {
  requirement: string;
  entry: string;
  close: string[];
}

/** Non-REMOVED requirements' entries the vocabulary does not declare — or nothing, per the opt-in rule above. */
function unknownEntries(reqs: Requirement[], vocab: CapabilityVocabulary): UnknownEntry[] {
  if (!vocab.present || vocab.invalid !== undefined) return [];
  const known = [...vocab.byId.keys()];
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
    `${where}: requirement '${u.requirement}' — Capability: '${u.entry}' is not declared in architecture/capabilities.yaml` +
    (u.close.length > 0
      ? `. Did you mean: ${u.close.join(", ")}?`
      : ". Declare it there (`capabilities: {<id>: {description, owner}}`), or fix the spelling")
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
 * vocabulary, spelling the expected shape. Everything else in the family stays
 * suspended behind it (see the module comment).
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
  if (!vocab.present || vocab.invalid !== undefined) return [];
  return [...vocab.byId.keys()]
    .filter((id) => !used.has(id))
    .sort(compareIds)
    .map((id) => ({
      severity: "warn" as const,
      code: "capability.unrealized",
      subject: id,
      message:
        `landscape: capability '${id}' is declared in architecture/capabilities.yaml and no living requirement's \`Capability:\` line names it — ` +
        "either a promise nobody implemented or a word nobody adopted; write the requirement that realizes it, or drop the declaration",
    }));
}
