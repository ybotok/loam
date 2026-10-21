/**
 * `loam steps` — the step-phrase inventory of one service's living specs, or,
 * for a service an active feature introduces and `services/` does not hold
 * yet, of that feature's spec delta (the payload then says `living: false`).
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
import { decodeDocument, NotUtf8DocumentError } from "../../core/kernel/document-bytes.js";
import { configOrRefuse, emitJson, fail, NO_SERVICE_MESSAGE } from "../../core/envelope/json.js";
import { featureSpecPaths, SPEC_AXES, unfiledServicePaths, type SpecAxis } from "../../core/repo/paths.js";
import { locateServicePaths, resolveServiceTarget } from "../../core/repo/service-target.js";
import { type FeatureEntry } from "../../core/repo/entries.js";
import { introducingFeatures } from "../../core/projection/introduced.js";
import type { DocsDir } from "../../core/kernel/ids/dirs.js";
import type { RawServiceId } from "../../core/kernel/ids/service.js";
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
      const config = await configOrRefuse(json);
      if (config === null) return;
      const named = opts.service ?? config.service;
      if (named === undefined) return fail(json, "invalid-option", NO_SERVICE_MESSAGE);
      // The enumeration's own id, not the string the caller typed: only one of
      // them carries the fact that a `readdir` produced it, and it is what makes
      // the name pathable. Same resolution `validate --service` performs, so the
      // two commands cannot disagree about which directory a name means.
      const resolved = await resolveServiceTarget(config.docsDir, named, "--service");
      // A name `services/` does not hold may still be a service an active
      // feature INTRODUCES — the second enumeration, a readdir of the feature's
      // own specs/, so it is asked before the grammar refusal too. Its phrases
      // are the delta's: the implement protocol tells whoever builds a NEW
      // service to run this before writing a single step definition, and the
      // answer was "No living spec … run `loam adopt`" for code that does not
      // exist yet. The bound service (`config.service`) takes the same road.
      const introducing =
        resolved.ok && resolved.dir !== undefined ? [] : await introducingFeatures(config.docsDir, named);
      const introducedId = introducing[0]?.services.find((s) => s === named);
      let source: Source;
      if (introducedId !== undefined) {
        source = introducedSource(config.docsDir, introducedId, introducing);
      } else {
        if (!resolved.ok) return fail(json, "invalid-option", resolved.problem);
        const paths = await locateServicePaths(config.docsDir, resolved.id);
        if (!existsSync(paths.spec)) {
          return fail(
            json,
            "unknown-target",
            `No living spec at ${paths.spec}. Run \`loam adopt\` for '${resolved.id}' first.`,
          );
        }
        source = {
          service: resolved.id,
          files: SPEC_AXES.map((axis) => ({ axis, path: paths[axis.key] })),
          steps: paths.steps,
          introducedBy: [],
        };
      }
      const { service } = source;
      const axes: InventoryAxis[] = [];
      try {
        for (const { axis, path } of source.files) {
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
      const catalogue = await readStepCatalogue(source.steps);
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
      const where = docsRelative(config.docsDir, source.steps);
      const introducedBy = source.introducedBy.map((f) => f.id);
      if (json) {
        emitJson({
          command: "steps",
          docsDir: config.docsDir,
          service,
          // Present only for a service a feature introduces, so a living
          // service's payload stays byte-identical: `living: false` is the
          // marker, and `specs` names the delta files the phrases came from.
          ...(introducedBy.length === 0
            ? {}
            : {
                living: false,
                introducedBy,
                specs: source.files.filter((f) => existsSync(f.path)).map((f) => docsRelative(config.docsDir, f.path)),
              }),
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
      const origin = introducedBy.length === 0
        ? null
        : {
            by: introducedBy.join(", "),
            dirs: source.introducedBy.map((f) => `${docsRelative(config.docsDir, featureSpecPaths(f.dir, service).dir)}/`),
          };
      print(inv, { service, origin, duplicatesOnly: opts.duplicates === true });
      printCatalogue({ catalogue, against, where, introducedBy });
    });
}

/**
 * Where the phrases are read from. A living service reads its own spec pair; a
 * service an active feature introduces reads each introducing feature's delta
 * pair, because that is the only place its scenarios are written yet.
 */
interface Source {
  service: RawServiceId;
  files: Array<{ axis: SpecAxis; path: string }>;
  /** The catalogue's path — the service's own, or, for an introduced one, where its directory will land. */
  steps: string;
  /** The introducing features; empty for a living service. */
  introducedBy: FeatureEntry[];
}

/**
 * Every introducing feature's spec pair, not just the first: with two features
 * each introducing the service, the suite that exists once both merge needs the
 * glue for both, and this command has no flag to choose one. The catalogue path
 * is the unfiled spelling — where archive materialises a new service — and is
 * reported, never written: `printCatalogue` says why nobody should create it
 * yet.
 */
function introducedSource(docsDir: DocsDir, service: RawServiceId, introducedBy: FeatureEntry[]): Source {
  return {
    service,
    files: introducedBy.flatMap((f) => {
      const paths = featureSpecPaths(f.dir, service);
      return SPEC_AXES.map((axis) => ({ axis, path: paths[axis.key] }));
    }),
    steps: unfiledServicePaths(docsDir, service).steps,
    introducedBy,
  };
}

/** A docs-relative POSIX path, the spelling every path in this command's output uses. */
function docsRelative(docsDir: DocsDir, path: string): string {
  return relative(docsDir, path).split(/[\\/]/).join("/");
}

/** What the human headline prints from. */
interface PrintView {
  service: string;
  /** For a service a feature introduces: which features, and the delta directories read. Null when living. */
  origin: { by: string; dirs: string[] } | null;
  duplicatesOnly: boolean;
}

/**
 * The human view leads with the two numbers a team plans from — how many steps
 * are written, and how few definitions cover most of them — because the list
 * underneath is long by construction and the headline is what decides whether
 * anybody reads it.
 *
 * For an introduced service the source is said straight under the headline:
 * the same numbers read off a delta are a proposal, and a reader who takes them
 * for a living spec's would plan glue for scenarios review may still change.
 */
function print(inv: StepInventory, view: PrintView): void {
  const { service, origin, duplicatesOnly } = view;
  const from = origin === null
    ? null
    : `  read from the feature delta, not a living spec: ${origin.dirs.join(", ")} — ` +
      `${service} is introduced by ${origin.by} and is not in the living docs until it archives`;
  if (inv.steps === 0) {
    console.log(
      origin === null
        ? `steps ${service} — the living specs hold no scenario steps yet.\n`
        : `steps ${service} — the delta introducing it holds no scenario steps yet.\n${from}\n`,
    );
    return;
  }
  const covering = coveringPhrases(inv);
  const share = Math.round((100 * inv.phrases.reduce((a, p, i) => (i < covering ? a + p.count : a), 0)) / inv.steps);
  console.log(`steps ${service} — ${inv.steps} written step(s), ${inv.phrases.length} distinct phrase(s)`);
  if (from !== null) console.log(from);
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
  /** The features introducing the service, by id; empty for a living one. */
  introducedBy: string[];
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
function printCatalogue({ catalogue, against, where, introducedBy }: CatalogueView): void {
  // A service still in flight gets the opposite advice. `steps.yaml` is a
  // service artifact (repo/paths.ts), so writing one where it belongs mints the
  // service's directory — and the service with it — before its feature merges,
  // after which nothing reads the feature's specs/ as introducing it any more.
  if (!catalogue.present && introducedBy.length > 0) {
    console.log(`\n  no catalogue yet — ${where} lands with the service when ${introducedBy.join(", ")} archives.`);
    console.log("  Write it after the archive: a steps.yaml there now would put the service in the living docs before its feature merges.");
    return;
  }
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
