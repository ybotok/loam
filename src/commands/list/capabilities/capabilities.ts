/**
 * The capability section's text — `loam list capabilities`: the table, and the
 * promises cells beside each row.
 *
 * Split out of `../print.ts` when the archived features' worklist lines took
 * that file past its line limit, along the seam the section already had: the
 * capability rows are built from `architecture/capabilities.yaml` and the
 * use-case corpus, not from the service enumeration every other printer there
 * reads, and nothing here shares a helper with them.
 */
import { type CapabilityRow } from "../../../core/capabilities/rollup.js";
import { compareIds } from "../../../core/repo/entries.js";
import type { PromisesKept } from "../../../core/usecases/capability.js";

/**
 * The capability table: what the fleet promises, and how much of each promise
 * anything claims to implement. The `0 — unrealized` marker is the row's whole
 * point — a declared capability nothing realizes is the drift this section
 * exists to make visible — and the draft/verified split says how much of a
 * realized one rests on vouched documents rather than drafts.
 *
 * `promises` is the use-case corpus's health, and it is a REQUIRED argument
 * rather than an optional decoration: the two states it separates are "no flow
 * keeps this promise" and "loam could not read the flows", and a default would
 * silently pick the first. A caller with nothing to say here has no business
 * printing a promises column at all.
 */
export function printCapabilities(rows: CapabilityRow[], promises: PromisesKept): void {
  console.log(`capabilities (${rows.length})`);
  if (rows.length === 0) return;
  const width = Math.max(0, ...rows.map((row) => row.id.length));
  for (const row of rows) {
    const count = row.realizedBy.length;
    const cells =
      count === 0
        ? ["0 — unrealized"]
        : [
            `${count} requirement${count === 1 ? "" : "s"}`,
            row.services.join(", "),
            Object.entries(row.statuses)
              .map(([status, n]) => `${n} ${status}`)
              .join(" · "),
          ];
    cells.push(...promiseCells(row, promises.kind === "read"));
    const owner = row.owner === undefined ? "" : `  (owner: ${row.owner})`;
    console.log(`  ${row.id.padEnd(width)}  ${cells.join("  ·  ")}${owner}`);
  }
  // ONE note for the table, not one per row: every row is equally unanswered,
  // and the reader needs to be told the column is missing rather than empty.
  // The wording says UNKNOWN rather than none deliberately — this is the same
  // refusal `capability.requirement-unrealized` makes under `validate` when the
  // project did not parse, and the two surfaces must not read differently. The
  // parser's own message goes on its own line, exactly as `loam context` and
  // `loam delta` print theirs: a LikeC4 error is several lines of expected-token
  // list, and inlining it would push the sentence off the reader's screen.
  if (promises.kind === "unreadable") {
    console.log(
      "  note: architecture/ did not parse, so no business flow could be read — " +
        "which promises a use case keeps is UNKNOWN here, not none",
    );
    if (promises.errors[0] !== undefined) console.log(`  ${promises.errors[0]}`);
  }
}

/**
 * The promises cell(s) for one row: how many of a capability document's own
 * requirements anything keeps, and which flows keep any of them.
 *
 * Only for a capability that HAS a document — `requirements` absent means there
 * is no document to promise anything, and a `0 of 0` on such a row would read as
 * a gap where there is not even a claim.
 *
 * `flowsRead` false marks the count as PARTIAL in the cell itself and not only
 * in the note below the table. Without the suffix, a fleet whose promises are
 * all kept by flows prints `0 of 4 promises kept` over an unreadable
 * `architecture/` — a number a reader would act on before reaching the note,
 * and the exact false negative this axis exists to refuse.
 */
function promiseCells(row: CapabilityRow, flowsRead: boolean): string[] {
  if (row.requirements === undefined) return [];
  const total = row.requirements.length;
  if (total === 0) return [];
  const kept = row.requirements.filter(
    (req) => req.realizedBy.length > 0 || (req.keptBy?.length ?? 0) > 0,
  ).length;
  // Distinct flows across the whole capability, sorted: the per-requirement
  // lists are already sorted, and a reader scanning this column wants the
  // documents to open, not the pairing (the `--json` rows carry that).
  const flows = [...new Set(row.requirements.flatMap((req) => req.keptBy ?? []))].sort(compareIds);
  const partial = flowsRead ? "" : " (flows unread)";
  return [`${kept} of ${total} promise${total === 1 ? "" : "s"} kept${partial}`]
    .concat(flows.length === 0 ? [] : [`flows: ${flows.join(", ")}`]);
}
