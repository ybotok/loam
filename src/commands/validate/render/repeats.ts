/**
 * Repeat grouping: on a fleet run, a warning or error that MORE THAN
 * `REPEAT_THRESHOLD` services raise prints once, as itself, followed by one
 * counted line naming the services — instead of once per service.
 *
 * A fleet mid-adoption raises the same finding on most of its services: forty
 * services with no `sources:` print forty near-identical warnings, and the one
 * warning that is actually different sits somewhere among them. The reader of
 * a CI log needs the pattern once and the exceptions individually; the per-
 * service copies are what the `--json` payload and a single-service run are
 * for, and both still carry every one.
 *
 * It is the same kind of lever as `--errors-only` and axis grouping
 * (`./text.ts`), and holds the same discipline: the report, the footer's
 * counts, `--json` and `--strict` are computed from the UNFILTERED findings,
 * and nothing is dropped — every finding a group stands for is counted on its
 * line and its service named there (capped, the remainder counted). Each
 * boundary below is chosen so a group cannot hide something a reader needs:
 *
 * - SERVICE targets only. A feature's block is that feature's work list, and
 *   the landscape's findings are each about a different place on the map, so
 *   neither is "the same finding again".
 * - Warnings and errors only. An `ok` line confirms a per-service fact (how
 *   many elements, how many requirements), and `--errors-only` already exists
 *   for a reader who wants confirmations gone.
 * - Keyed on severity AND code. `service.no-openapi` is an error or a warning
 *   depending on what already points into the missing file; one key would file
 *   an error under a ⚠.
 * - The threshold counts distinct SERVICES, not findings, and only a service
 *   raising the finding exactly ONCE is folded. One service raising
 *   `covers.unknown` five times is five broken lines in one document, and each
 *   of them has to print — that is not a fleet-wide pattern, it is a worklist —
 *   so its five lines stay in its own listing even when four other services
 *   raise the code once each and are folded.
 * - A finding that carries `details` is never folded. Details are evidence
 *   about one service (which links dangle into the missing file, which ids do
 *   not resolve), and a counted line could only drop them.
 */
import type { Finding, TargetReport } from "../../../core/vocabulary/report.js";
import { plural } from "../../policy/format.js";
import { cappedNames } from "./rollups.js";

/**
 * More than three services: three can be a coincidence of one team's
 * services, and three lines are still read one by one. Past that the lines
 * stop being read and start being scrolled.
 */
const REPEAT_THRESHOLD = 3;

export interface RepeatGroup {
  /** The group's first finding in report order — printed in full, as itself. */
  readonly example: Finding;
  /** How many findings the group stands for, the example included. */
  readonly findings: number;
  /** The distinct services raising it, in report order. */
  readonly services: readonly string[];
}

export interface Repeats {
  /** Errors first, then warnings; within each, the order the report raised them in. */
  readonly groups: readonly RepeatGroup[];
  /** Every finding a group stands for — exactly what the per-service listing skips. */
  readonly collapsed: ReadonlySet<Finding>;
}

/**
 * The groups over `services`, considering only the findings `shown` would
 * print. The predicate is the listing's own, so a finding another lever
 * already took out of the listing (`--errors-only`, an axis banner, a lead) is
 * neither counted here nor printed twice.
 */
export function repeatedFindings(
  services: readonly TargetReport[],
  shown: (f: Finding) => boolean,
): Repeats {
  // Per key, the foldable finding of each service that raises the key exactly
  // once — a Map iterates in insertion order, so the names keep the report's.
  const byKey = new Map<string, Map<string, Finding | null>>();
  for (const t of services) {
    for (const f of t.findings) {
      if (f.severity === "ok" || !shown(f)) continue;
      const key = `${f.severity} ${f.code}`;
      const perService = byKey.get(key) ?? new Map<string, Finding | null>();
      // A second finding from the same service, or one carrying details, makes
      // that service's entry unfoldable (null): its lines print as themselves.
      const foldable = !perService.has(t.id) && (f.details ?? []).length === 0;
      perService.set(t.id, foldable ? f : null);
      byKey.set(key, perService);
    }
  }
  const groups: RepeatGroup[] = [];
  const collapsed = new Set<Finding>();
  for (const perService of byKey.values()) {
    const folded = [...perService].filter((entry): entry is [string, Finding] => entry[1] !== null);
    const [first] = folded;
    if (first === undefined || folded.length <= REPEAT_THRESHOLD) continue;
    groups.push({ example: first[1], findings: folded.length, services: folded.map(([id]) => id) });
    for (const [, f] of folded) collapsed.add(f);
  }
  // A stable sort, so the report order survives inside each severity.
  groups.sort((a, b) => severityRank(a.example) - severityRank(b.example));
  return { groups, collapsed };
}

function severityRank(f: Finding): number {
  return f.severity === "error" ? 0 : 1;
}

/**
 * Each group as its example — through `lineOf`, the listing's own line, so it
 * keeps the severity marker and the `(code)` suffix exactly as any finding
 * does — and one indented line saying how far it repeats. No member carries
 * details (those are never folded), so nothing is left out of either line.
 */
export function printRepeats(groups: readonly RepeatGroup[], lineOf: (f: Finding) => string): void {
  for (const g of groups) {
    console.log(lineOf(g.example));
    console.log(
      `    same code ×${g.findings} on ${plural(g.services.length, "service")}: ` +
        `${cappedNames(g.services)} — every finding is in --json`,
    );
  }
}
