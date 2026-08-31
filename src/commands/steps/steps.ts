/**
 * `loam steps` — the step-phrase inventory of one service's living specs.
 *
 * A READ, and that is the whole design. It emits no finding, sets no exit code
 * beyond a refusal, writes nothing, and needs no service repo to stand in: it
 * parses `spec.md` and `arch.spec.md` from the docs repo exactly as `validate
 * --service` does. `loam gherkin` refuses outside the service's own repository
 * because it WRITES there; this answers a question about documents, so the
 * restriction would buy nothing and cost the analyst who wants the number
 * before anybody has scaffolded a repo.
 *
 * What it is for is in `core/gherkin/steps/inventory.ts`. In one line: the glue
 * layer is where a generated suite dies, and until this existed nobody could
 * tell a suite needing forty step definitions from one needing four hundred.
 */
import type { Command } from "commander";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import { loadConfig } from "../../core/envelope/config.js";
import { decodeDocument, NotUtf8DocumentError } from "../../core/kernel/document-bytes.js";
import { emitJson, fail, NO_SERVICE_MESSAGE, reportNoConfig } from "../../core/envelope/json.js";
import { SPEC_AXES } from "../../core/repo/paths.js";
import { locateServicePaths, resolveServiceTarget } from "../../core/repo/service-target.js";
import { parseRequirements } from "../../core/document/parse.js";
import { axisLabel } from "../../core/gherkin/emit.js";
import {
  coveringPhrases,
  stepInventory,
  type InventoryAxis,
  type StepInventory,
} from "../../core/gherkin/steps/inventory.js";
import {
  compareToCatalogue,
  readStepCatalogue,
  type CatalogueComparison,
  type StepCatalogue,
} from "../../core/gherkin/steps/catalogue.js";

interface StepsOptions {
  service?: string;
  duplicates?: boolean;
  json?: boolean;
}

export function registerSteps(program: Command): void {
  program
    .command("steps")
    .description("Inventory the step phrases of a service's scenarios — how many step definitions its suite needs")
    .option("--service <id>", "service to inventory (defaults to the configured service)")
    .option("--duplicates", "list only the near-duplicate groups — phrases that differ by an article or a trailing clause")
    .option("--json", "emit the machine contract instead of the human view")
    .action(async (opts: StepsOptions) => {
      const json = opts.json === true;
      const loaded = await loadConfig();
      if (loaded.kind !== "loaded") {
        reportNoConfig(json, loaded);
        return;
      }
      const config = loaded.config;
      const named = opts.service ?? config.service;
      if (named === undefined) return fail(json, "invalid-option", NO_SERVICE_MESSAGE);
      // The enumeration's own id, not the string the caller typed: only one of
      // them carries the fact that a `readdir` produced it, and it is what makes
      // the name pathable. Same resolution `validate --service` performs, so the
      // two commands cannot disagree about which directory a name means.
      const resolved = await resolveServiceTarget(config.docsDir, named, "--service");
      if (!resolved.ok) return fail(json, "invalid-option", resolved.problem);
      const service = resolved.id;

      const paths = await locateServicePaths(config.docsDir, service);
      if (!existsSync(paths.spec)) {
        return fail(
          json,
          "unknown-target",
          `No living spec at ${paths.spec}. Run \`loam adopt\` for '${service}' first.`,
        );
      }
      const axes: InventoryAxis[] = [];
      try {
        for (const axis of SPEC_AXES) {
          const path = paths[axis.key];
          // An absent arch.spec.md is not a finding anywhere else and is not one
          // here: partial adoption is supported, and an empty axis contributes
          // no phrases rather than an empty section nobody asked for.
          const reqs = existsSync(path)
            ? parseRequirements(decodeDocument(await readFile(path), path))
            : [];
          axes.push({ axis: axisLabel(axis), reqs });
        }
      } catch (err) {
        if (!(err instanceof NotUtf8DocumentError)) throw err;
        return fail(json, "repository-unavailable", `Cannot inventory steps: ${err.message}`);
      }

      const inv = stepInventory(axes);
      // The catalogue is what makes the report a DIFF rather than a
      // recomputation: without it every run says the same thing about a suite
      // whose glue somebody has already written. Absent is the ordinary state
      // and costs one `existsSync` (`core/gherkin/steps/catalogue.ts`).
      const catalogue = await readStepCatalogue(paths.steps);
      const against = catalogue.present && catalogue.unreadable === undefined
        ? compareToCatalogue(inv, catalogue)
        : null;
      // Computed ONCE, above the branch, and derived from the path
      // `locateServicePaths` resolved rather than joined from the id. A filed
      // service lives wherever the tree walk found it — `services/commerce/
      // checkout/`, not `services/checkout/` — and `core/repo/service-target.ts`
      // says so at length. Two outputs of one command spelling the path two
      // ways is how the human view came to name a directory that does not
      // exist, and here that would be worse than cosmetic: `steps.yaml` is a
      // service artifact now, so an author who created the file where this told
      // them to would mint a second, empty service in the enumeration.
      const where = relative(config.docsDir, paths.steps).split(/[\\/]/).join("/");
      if (json) {
        emitJson({
          command: "steps",
          docsDir: config.docsDir,
          service,
          steps: inv.steps,
          phrases: inv.phrases.length,
          covering80: coveringPhrases(inv),
          rows: inv.phrases.map((p) => ({
            key: p.key,
            count: p.count,
            keywords: p.keywords,
            uses: p.uses,
          })),
          nearDuplicates: inv.nearDuplicates,
          // Additive, and one key rather than columns spread through `rows`: a
          // consumer that has not adopted the catalogue reads exactly what it
          // read before. `present: false` and `unreadable` are different
          // answers and both are real — "nobody has catalogued anything" is not
          // "loam could not look".
          catalogue: {
            present: catalogue.present,
            path: where,
            entries: catalogue.entries.length,
            ...(catalogue.unreadable === undefined ? {} : { unreadable: catalogue.unreadable }),
            ...(against === null ? {} : against),
          },
        });
        return;
      }
      print(inv, service, opts.duplicates === true);
      printCatalogue({ catalogue, against, where });
    });
}

/**
 * The human view leads with the two numbers a team plans from — how many steps
 * are written, and how few definitions cover most of them — because the list
 * underneath is long by construction and the headline is what decides whether
 * anybody reads it.
 */
function print(inv: StepInventory, service: string, duplicatesOnly: boolean): void {
  if (inv.steps === 0) {
    console.log(`steps ${service} — the living specs hold no scenario steps yet.\n`);
    return;
  }
  const covering = coveringPhrases(inv);
  const share = Math.round((100 * inv.phrases.reduce((a, p, i) => (i < covering ? a + p.count : a), 0)) / inv.steps);
  console.log(`steps ${service} — ${inv.steps} written step(s), ${inv.phrases.length} distinct phrase(s)`);
  console.log(`  ${covering} phrase(s) cover ${share}% of them — that is the size of the step-definition registry\n`);

  if (!duplicatesOnly) {
    for (const p of inv.phrases) {
      console.log(`  ${String(p.count).padStart(4)}  ${p.key}`);
      console.log(`        ${p.keywords.join("/")} · ${[...new Set(p.uses.map((u) => u.requirement))].join(", ")}`);
    }
    console.log();
  }

  if (inv.nearDuplicates.length === 0) {
    console.log("  no near-duplicate phrases.");
    return;
  }
  console.log(`  ${inv.nearDuplicates.length} near-duplicate group(s) — one definition was probably meant:`);
  for (const g of inv.nearDuplicates) {
    console.log(`    ${g.family}`);
    for (const k of g.keys) console.log(`      · ${k}`);
  }
}

/** What the catalogue columns print from — the read and, when it was worth making, the comparison. */
interface CatalogueView {
  catalogue: StepCatalogue;
  /** Null when there was nothing readable to compare against. */
  against: CatalogueComparison | null;
  /**
   * The catalogue's docs-relative path, RESOLVED — never `services/<id>/…`
   * rejoined from the service name, which is right for an unfiled service and
   * wrong for every filed one. The same string `--json` reports.
   */
  where: string;
}

/**
 * The catalogue columns, printed after the inventory rather than woven into
 * them.
 *
 * Separate because the two answers have different lifetimes: the inventory is a
 * fact about the specs and is always true, while this is a diff against a
 * decision that may not have been made yet. Weaving a "not catalogued" marker
 * through every phrase row of a service with no `steps.yaml` would mark the
 * whole report as work owed, which is the opposite of what an absent catalogue
 * means.
 *
 * Nothing here is a finding and nothing changes the exit code. `loam steps` is a
 * read, and a phrase written before its glue is the normal order of work.
 */
function printCatalogue({ catalogue, against, where }: CatalogueView): void {
  if (!catalogue.present) {
    console.log(`\n  no ${where} — nothing records which phrases this suite has decided to define.`);
    console.log("  Write one (a `steps:` list of step texts) and this report becomes a diff instead of a recount.");
    return;
  }
  if (catalogue.unreadable !== undefined) {
    console.log(`\n  ${where} could not be read — ${catalogue.unreadable}.`);
    console.log("  The catalogue columns are blank: loam did not look, which is not the same as nothing being catalogued.");
    return;
  }
  if (against === null) return;
  console.log(`\n  ${catalogue.entries.length} phrase(s) catalogued in ${where}`);
  console.log(
    `  ${against.uncatalogued.length} written but not catalogued · ${against.unwritten.length} catalogued but not written`,
  );
  for (const key of against.uncatalogued) console.log(`    + ${key}`);
  for (const key of against.unwritten) console.log(`    - ${key}`);
  if (against.duplicated.length === 0) return;
  console.log(`  ${against.duplicated.length} catalogue entr(ies) collapse onto a phrase already listed:`);
  for (const dup of against.duplicated) {
    console.log(`    ${dup.key}`);
    for (const text of dup.texts) console.log(`      · ${text}`);
  }
}
