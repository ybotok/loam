/**
 * The architectural obligation axis, graded against the fleet it is about.
 *
 * `core/obligations/obligations.ts` states what the axis IS and why it has this
 * shape. This module is the four questions asked of a fleet that has one, and
 * the order they are asked in — the same division `checks/fleet-shape.ts` keeps
 * for the authorization and capability vocabularies, which this sits beside on
 * the `landscape` target for their reason: an obligation crosses services by
 * construction, so no service target can answer for it.
 *
 * THE FOUR ARE TWO PAIRS, and each pair is one join read in both directions.
 * A tag nothing declares is an ERROR (`obligation.unknown`) and a declaration
 * nothing tags is a WARNING (`obligation.unapplied`) — exactly the asymmetry
 * `permissions.unknown`/`permissions.unenforced` already carry, and for the
 * same reason: a typo in a tag reads like a rule, while a word nobody has
 * adopted yet is an honest state. Then a tagged object no requirement covers is
 * a WARNING (`obligation.uncovered`) and an `adr:` naming no file is an ERROR
 * (`obligation.adr-missing`): the team's work being outstanding is normal, and
 * a pointer at a decision nobody can read is not.
 *
 * A FLOW IS A FOURTH KIND OF TAGGED OBJECT, beside an element, an edge and a
 * deployment object. `#obl-<id>` on a `dynamic view` in `architecture/usecases/`
 * resolves against the vocabulary like any tag (`obligation.unknown` names the
 * flow) and counts as an application (`obligation.unapplied` goes quiet), and
 * it applies the obligation to the relationship behind every hop the flow
 * draws — `core/usecases/obligations/flows.ts` says why that and not a label. Those
 * relationships then take the coverage question exactly as a tagged edge does,
 * once per obligation and relationship however many flows and tags reach it.
 *
 * `obligation.uncovered` IS THE PREREQUISITE THE ROADMAP NAMED. `c4.uncovered`
 * has always been able to say "this architecture object owes a requirement",
 * but only about a NEW tagged element in a feature's `delta.likec4` — never
 * about the map the fleet actually runs on. This asks the same question of the
 * LIVING landscape, against the union of every service's living `arch.spec.md`
 * `Covers:` lines, which is the index that did not exist before.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { type LoadedDoc } from "../../../../core/c4/likec4.js";
import {
  closeIds,
  coversDeployEdge,
  coversDeployNode,
  coversEdge,
  coversElement,
} from "../../../../core/c4/arch.js";
import { OBLIGATION_TAG_PREFIX, type ObligationVocabulary } from "../../../../core/obligations/obligations.js";
import { coversIndex } from "../../../../core/usecases/obligations/covers.js";
import { type ServiceEntry } from "../../../../core/repo/entries.js";
import { type Finding } from "../../../../core/vocabulary/report.js";
import { FleetContext } from "../../../../core/fleet-context.js";
import type { DocsDir } from "../../../../core/kernel/ids/dirs.js";
import { coverageObjects, taggedObjects, type Covered } from "./applied.js";

export interface ObligationCheck {
  docsDir: DocsDir;
  vocabulary: ObligationVocabulary;
  /**
   * The living landscape, PARSED. Not nullable, and the absence is the point:
   * the landscape target returns before it reaches this call when the map is
   * missing or did not parse, so a run that could not read the map asks none of
   * the three questions below rather than answering them empty. "Loam did not
   * look" is never the same answer as "there is nothing there" — an unreadable
   * map graded as empty would report every declared obligation as applied
   * nowhere — and the suspension lives at the call site because that is where
   * the fact is known. It is also why the vocabulary half is a separate
   * function: those two verdicts must survive exactly those early returns.
   */
  land: LoadedDoc;
  services: ServiceEntry[];
  fleet: FleetContext;
}

/**
 * The half that does not depend on the map: the file reads, and its `adr:`
 * pointers resolve.
 *
 * Separate from the map questions because the landscape target returns early
 * twice — an absent map, and one that did not parse — and a broken vocabulary
 * must still be named in exactly the runs where somebody is fixing something
 * else. The same placement `permissionFindings` and `capabilityFleetFindings`
 * already have, one level of precision finer.
 */
export function obligationVocabularyFindings(docsDir: DocsDir, vocabulary: ObligationVocabulary): Finding[] {
  if (!vocabulary.present) return [];
  if (vocabulary.invalid !== undefined) {
    // Reported ALONE, exactly as `permissions.invalid` and `capability.invalid`
    // are: every `#obl-` tag in the fleet resolves against this file, so grading
    // them on top of a broken vocabulary is a cascade, not a diagnosis.
    return [
      {
        severity: "error",
        code: "obligation.invalid",
        message:
          `landscape: architecture/obligations.yaml does not read as a vocabulary — ${vocabulary.invalid}. ` +
          "Every `#obl-` tag on the fleet map resolves against this file, so none of them can be graded until it parses. " +
          "The shape is `obligations: {<id>: {description, adr}}`, ids spelled with letters, digits, `_` and `-` only.",
      },
    ];
  }

  return adrFindings(docsDir, [...vocabulary.byId.values()]);
}

/** The three questions that need the map, suspended entirely when it could not be read. */
export async function obligationFindings(check: ObligationCheck): Promise<Finding[]> {
  const { vocabulary } = check;
  if (!vocabulary.present || vocabulary.invalid !== undefined) return [];
  const findings: Finding[] = [];

  // Which objects carry which obligation. Elements and edges are collected
  // together because every question below treats them alike: an obligation
  // applies to a thing on the map, and whether that thing is a box or an arrow
  // changes only how the message spells it and how `Covers:` matches it.
  // The enumerated fleet rides in for the deployment half of the walk: an
  // instance deploys a CONTAINER more often than a whole system, and resolving
  // which service owns one needs the ancestor walk `serviceResolver` performs.
  // It is the same set `uncoveredFindings` resolves edge endpoints with, or the
  // message would name one service and the coverage check count another.
  const known = new Set(check.services.map((s) => s.id));
  const tagged = taggedObjects(check.land, known);
  // A flow's tag is an application in its own right: it says where the
  // obligation applies, hop by hop, as surely as a tag on each edge would.
  const applied = new Set(tagged.map((t) => t.obligation));

  for (const id of [...applied].sort()) {
    if (vocabulary.byId.has(id)) continue;
    const close = closeIds(id, [...vocabulary.byId.keys()]);
    findings.push({
      severity: "error",
      code: "obligation.unknown",
      subject: id,
      message:
        `landscape: #${OBLIGATION_TAG_PREFIX}${id} tags ${count(tagged.filter((t) => t.obligation === id).length, "object")} on the fleet map, ` +
        `and architecture/obligations.yaml declares no obligation '${id}'` +
        (close.length > 0 ? ` — did you mean: ${close.join(", ")}?` : "") +
        ". A tag that resolves to nothing reads exactly like a rule the fleet keeps: declare it, or fix the tag.",
      details: tagged.filter((t) => t.obligation === id).map((t) => t.where),
    });
  }

  const unapplied = [...vocabulary.byId.keys()].filter((id) => !applied.has(id)).sort();
  if (unapplied.length > 0) {
    findings.push({
      severity: "warn",
      code: "obligation.unapplied",
      message:
        `landscape: ${unapplied.length} declared obligation(s) that no \`#${OBLIGATION_TAG_PREFIX}\` tag applies anywhere on the fleet map — ` +
        "either a decision that was reversed and left its word behind, or one nobody has placed yet. " +
        "Tag the elements and edges it governs, or drop the declaration; a vocabulary is worth what cites it.",
      details: unapplied,
    });
  }

  // ONLY A RESOLVED APPLICATION IS ASKED ABOUT COVERAGE. A tag naming no
  // declared obligation has already earned its error above, and "no requirement
  // covers #obl-typo" is not a second breach — it is the same one restated in
  // words that ask the reader to write a requirement for a rule that does not
  // exist. The use-case axis draws this line in the same place: only a resolved
  // `#cap-` claim keeps a promise.
  findings.push(...(await uncoveredFindings(check, coverageObjects(check.land, known, tagged.filter((t) => vocabulary.byId.has(t.obligation))))));
  return findings;
}

/**
 * `obligation.uncovered` — a tagged object no living arch requirement covers.
 *
 * The index is the union of EVERY service's living `arch.spec.md` and
 * `spec.md` `Covers:` lines (`coversIndex`, which says why fleet-wide and why
 * both documents). It already drops REMOVED requirements: a retired
 * requirement covers nothing.
 *
 * ONE FINDING PER TAGGED OBJECT, subject = the service that owns it, so a
 * fleet-wide report reads as a worklist per team rather than as one line naming
 * forty edges.
 */
async function uncoveredFindings(check: ObligationCheck, tagged: Covered[]): Promise<Finding[]> {
  if (tagged.length === 0) return [];
  // The LIVING index: the feature gate asks the same question of the index its
  // merge would leave (`core/usecases/obligations/covers.ts`).
  const covers = await coversIndex({ services: check.services, read: (path) => check.fleet.readRequirements(path) });
  const elements = check.land.elements;
  const known = new Set(check.services.map((s) => s.id));
  const covered = (t: Covered): boolean => {
    switch (t.kind) {
      case "element":
        return covers.some((c) => coversElement(c, t.element));
      case "edge":
        return covers.some((c) => coversEdge(c, t.edge, elements, known));
      case "deployed": {
        const d = t.deployed;
        return d.edge === undefined
          ? covers.some((c) => coversDeployNode(c, d.id!))
          : covers.some((c) => coversDeployEdge(c, d.edge!.source, d.edge!.target));
      }
    }
  };
  return tagged
    .filter((t) => !covered(t))
    .map((t) => ({
      severity: "warn" as const,
      code: "obligation.uncovered",
      ...(t.subject === undefined ? {} : { subject: t.subject }),
      message:
        `${t.where} carries #${OBLIGATION_TAG_PREFIX}${t.obligation}` +
        // An edge nobody tagged is asked about because a flow rides it, and the
        // sentence has to say so or the reader goes looking for a tag that is
        // not on the map.
        (t.kind !== "edge" || t.via === undefined ? "" : ` — ${t.via} rides it, and a flow's tag applies to every hop it draws —`) +
        ` and no living arch requirement covers it — ` +
        `the obligation is placed and nothing says it is met. Write the requirement in ` +
        // A region, a datacenter or a cluster is owned by no service, and
        // neither is an edge between two things that are not ours, so the
        // sentence stays general rather than naming a team at random. Every
        // other object here has a real owner and keeps the actionable form.
        `${t.subject === undefined ? `the arch.spec.md of whichever service answers for this ${t.kind === "deployed" ? "topology" : "edge"}` : `${t.subject}'s arch.spec.md`}` +
        ` with \`Covers: ${t.where}\` and a scenario that proves it, or drop the tag if the decision no longer applies here.`,
    }));
}

/**
 * `obligation.adr-missing` — an `adr:` path that names no file.
 *
 * The path is relative to the docs repo root rather than to
 * `architecture/obligations.yaml`, because that is how a reader of a fleet
 * document thinks about a fleet path, and because the value is a YAML field
 * rather than a markdown link — `link.unresolved` grades links written in prose,
 * and this one is written in a slot loam defined.
 */
function adrFindings(docsDir: DocsDir, obligations: readonly { id: string; adr?: string }[]): Finding[] {
  return obligations
    .filter((o) => o.adr !== undefined && !existsSync(join(docsDir, o.adr)))
    .map((o) => ({
      severity: "error" as const,
      code: "obligation.adr-missing",
      subject: o.id,
      message:
        `landscape: obligation '${o.id}' names \`adr: ${o.adr!}\` and no such file exists — ` +
        "the ADR is where the decision itself is written, so a pointer at nothing leaves every tag citing a rule nobody can read. " +
        "Fix the path (it is relative to the docs repo root), write the record, or drop the field.",
    }));
}

/** `1 object` / `3 objects` — the plural spelled once, because three messages count things. */
function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
