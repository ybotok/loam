import type { Command } from "commander";
import { loadConfig } from "../../core/envelope/config.js";
import { emitJson, fail, repoPath, reportNoConfig } from "../../core/envelope/json.js";
import { maturityRollup } from "../../core/vocabulary/maturity.js";
import { FleetContext } from "../../core/fleet-context.js";
import { DocsRepoUnavailableError } from "../../core/repo/state.js";
import { capabilityRollup, type CapabilityRow } from "../../core/capabilities/rollup.js";
import { invalidVocabularyFinding } from "../../core/capabilities/findings.js";
import { promisesKeptByFlows } from "../../core/usecases/capability.js";
import { fleetAdrCount, listFeatures, listFleetTree, listServices } from "../../core/repo/repo.js";
import { readGlossary } from "../../core/glossary/tree.js";
import { backlinkIndex } from "../../core/links/backlinks.js";
import { glossaryDir } from "../../core/repo/authored/paths.js";
import { docsRepoReady, reportDocsRepoError, reportRepositoryUnavailable } from "../policy/gate.js";
import { featureVerification, serviceViews, type ServiceView } from "./views.js";
import { capabilityJson, featureJson, glossaryJson, ownersJson, serviceRows, subsystemsJson } from "./json.js";
import {
  printCapabilities,
  printFeatures,
  printGlossary,
  printOwners,
  printServices,
  printWorklist,
} from "./print.js";
import { fanInByService, reviewLandscape, reviewOrder } from "./review.js";
import { resolveSubsystemSlice } from "./campaign/campaign.js";
import { ownersJoin, type OwnersJoin } from "./campaign/owners.js";

type Section = "services" | "features" | "capabilities" | "glossary";
const SECTIONS: Section[] = ["services", "features", "capabilities", "glossary"];
/**
 * What a bare `loam list` shows. `capabilities` is explicit-only, NEVER part
 * of this default: the no-argument output and its `--json` payload are a
 * frozen contract, byte-identical whether or not a fleet declares capabilities.
 */
const DEFAULT_SECTIONS: Section[] = ["services", "features"];

interface ListOptions {
  json?: boolean;
  archived?: boolean;
  needsWork?: boolean;
  reviewOrder?: boolean;
  subsystem?: string;
  owners?: string;
}

export function registerList(program: Command): void {
  program
    .command("list")
    .argument("[section]", "services | features | capabilities | glossary (default: services + features)")
    .description("List the services and features in the docs repo")
    .option("--json", "emit the machine contract instead of the human view")
    .option("--archived", "include archived features")
    .option(
      "--needs-work",
      "services only: the adoption worklist — every service below `vouched`, with what it is missing",
    )
    .option(
      "--review-order",
      "with --needs-work: order the worklist by blast radius — services the most other services depend on first",
    )
    .option(
      "--subsystem <name>",
      "services only: limit the listing to services filed under this subsystem, at any depth ('unfiled' selects the ones filed under none, while nothing in the tree claims that name)",
    )
    .option(
      "--owners <path>",
      "services only: group the listing by owning team from this CODEOWNERS file, resolved from the current directory (directory-pattern rules only; unsupported rules are listed as skipped, never guessed)",
    )
    .action(async (section: string | undefined, opts: ListOptions) => {
      const json = opts.json === true;
      // The campaign flags grade services, so — exactly like --needs-work —
      // they narrow a bare `loam list` to the services section instead of
      // printing a features table the filter silently does not apply to.
      const campaign = opts.subsystem !== undefined || opts.owners !== undefined;
      const wanted =
        opts.needsWork || campaign
          ? DEFAULT_SECTIONS.filter((s) => s === "services")
          : section
            ? SECTIONS.filter((s) => s === section)
            : DEFAULT_SECTIONS;
      if (section && !SECTIONS.includes(section as Section)) {
        // `invalid-option`, same as show's bad --type: one mistake class, one code.
        fail(json, "invalid-option", `Unknown section '${section}'. Expected: ${SECTIONS.join(" | ")}.`);
        return;
      }
      if (opts.needsWork && section === "features") {
        fail(json, "invalid-option", "--needs-work is the service adoption worklist; drop the 'features' section.");
        return;
      }
      if (campaign && section !== undefined && section !== "services") {
        fail(json, "invalid-option", `--subsystem and --owners grade the services section; drop the '${section}' section.`);
        return;
      }
      // The flag ORDERS the worklist, so it requires the worklist explicitly:
      // silently implying --needs-work would make one flag change which rows
      // exist, not only their order.
      if (opts.reviewOrder && !opts.needsWork) {
        fail(json, "invalid-option", "--review-order sorts the adoption worklist; add --needs-work.");
        return;
      }

      const loaded = await loadConfig();
      if (loaded.kind !== "loaded") {
        reportNoConfig(json, loaded);
        return;
      }
      const config = loaded.config;
      const { docsDir } = config;
      // A docsDir that is not a docs repo is refused, never rendered as an empty
      // fleet — the whole point of the gate (see docs-repo-gate.ts).
      // `list features` alone does not need services/, so it asks for less;
      // the capability rollup walks every service's spec files, so it asks for them.
      const needsServices =
        wanted.includes("services") || wanted.includes("capabilities") || wanted.includes("glossary");
      if (!docsRepoReady(json, docsDir, needsServices ? "services" : "docs")) return;

      try {
        // One context, one walk: the tree memo answers both the service
        // entries and the subsystem/unfiled counts beside them.
        const fleet = new FleetContext();
        const tree = wanted.includes("services") ? await listFleetTree(docsDir, fleet) : undefined;
        const services = wanted.includes("services") ? await listServices(docsDir, fleet) : undefined;
        // --review-order parses the landscape ONCE for both of its consumers —
        // serviceViews' `called` set (handed in as `preloaded`) and the fan-in
        // joins below. Without the flag, `undefined` keeps serviceViews' own
        // load-if-exists behaviour and the run byte-identical to today's.
        const land =
          opts.reviewOrder === true && services !== undefined
            ? await reviewLandscape(docsDir, fleet)
            : undefined;
        const views = services ? await serviceViews(docsDir, services, config.service, land) : undefined;
        // The slice is resolved AFTER the full-fleet views, and rows are
        // filtered rather than re-derived: fan-in, apiExpected and the missing
        // lists are fleet facts, and a slice-first derivation would recompute
        // them against a fleet with the callers outside the slice erased. The
        // composition is pinned as filter-first-then-rank — ranks stay
        // contiguous within the filtered set (test/list-campaign.test.ts).
        // `tree !== undefined` is a type NARROWING, not a branch: a campaign
        // flag forces the services section, so the tree always exists here.
        const slice =
          opts.subsystem !== undefined && tree !== undefined
            ? resolveSubsystemSlice(tree, opts.subsystem, json)
            : undefined;
        if (slice === null) return;
        // Membership is by DIRECTORY: leaf ids can collide across a broken
        // tree (`subsystem.name-collision`), and the directory is the row's
        // actual identity — campaign.ts's SubsystemSlice says why.
        const shown = slice === undefined ? views : views?.filter((v) => slice.members.has(v.entry.dir));
        // The fleet's own decision records. Read unconditionally — it is one
        // existsSync over `architecture/adrs/` and it belongs to the docs repo
        // rather than to any section, so `loam list features --json` reports it
        // as truthfully as `loam list services --json` does. Nothing grades it:
        // an absent directory is 0 and 0 is a fine, permanent answer.
        const fleetAdrs = await fleetAdrCount(docsDir);
        const features = wanted.includes("features")
          ? await listFeatures(docsDir, { includeArchived: opts.archived }, fleet)
          : undefined;
        const verification = features
          ? await Promise.all(features.map((f) => featureVerification(docsDir, f)))
          : undefined;

        // The capability section: the vocabulary's own verdict decides the shape.
        // An INVALID file refuses with `repository-unavailable` — an
        // empty-looking success over a broken file is the silent hole this
        // command already refuses elsewhere — while an ABSENT one is an honest
        // empty answer, because the file is the axis's opt-in. The message is
        // `capability.invalid`'s own sentence, not the fs-error helper's: the
        // file WAS read, it just is not a vocabulary, and one diagnosis should
        // have one spelling wherever it surfaces.
        const capabilityVocab = wanted.includes("capabilities")
          ? await fleet.capabilities(docsDir)
          : undefined;
        const brokenVocab = capabilityVocab === undefined ? null : invalidVocabularyFinding(capabilityVocab);
        if (brokenVocab !== null) {
          fail(json, "repository-unavailable", brokenVocab.message);
          return;
        }
        // The SECOND corpus behind a capability's promises: the `#cap-`/`#req-`
        // tagged flows. Read only under `loam list capabilities`, and
        // `promisesKeptByFlows` carries `readUseCases`' byte gate, so a fleet
        // whose architecture/ never mentions the reserved tag prefix pays a
        // readdir here rather than a LikeC4 workspace.
        //
        // AN UNREADABLE architecture/ DEGRADES, it does not refuse — the
        // opposite of the invalid vocabulary above, and the difference is which
        // corpus broke. `architecture/capabilities.yaml` is what the ROWS are
        // built from: unreadable, there is no listing to print, so refusing is
        // the only honest answer. The flows are a second corpus over rows that
        // are already true, and refusing the whole listing because a use-case
        // document has a syntax error would take `loam list capabilities` away
        // during exactly the minutes somebody is fixing that document, while
        // `validate` already reports it as `landscape.invalid`. So the join is
        // withheld instead — every `keptBy` absent rather than `[]` — and the
        // reason is stated, which is `core/pack/joins.ts`' holes idiom: carry
        // what is true, name what could not be looked at, never let the two read
        // the same.
        const entries = capabilityVocab === undefined ? undefined : await listServices(docsDir, fleet);
        const promises =
          capabilityVocab === undefined || entries === undefined
            ? undefined
            : await promisesKeptByFlows({
                docsDir,
                vocab: capabilityVocab,
                known: new Set(entries.map((e) => e.id)),
                read: (p) => fleet.readRequirements(p),
              });
        const capabilities: CapabilityRow[] | undefined =
          capabilityVocab === undefined || entries === undefined
            ? undefined
            : await capabilityRollup({
                services: entries,
                vocab: capabilityVocab,
                read: (p) => fleet.readRequirements(p),
                ...(promises?.kind === "read" ? { keptByFlows: promises.kept } : {}),
              });

        // The glossary section: the tree, and who cites each term. The
        // citation index is the expensive half — it reads every authored
        // document in the repository — so it is built only when the section is
        // asked for, and not at all when `glossary/` does not exist. The
        // directory's existence is the axis's opt-in, exactly as it is for
        // `capabilities/`, so a fleet without one prints an empty section
        // rather than paying for a fleet-wide walk to say so.
        const glossary = wanted.includes("glossary") ? await readGlossary(glossaryDir(docsDir)) : undefined;
        const citations =
          glossary !== undefined && glossary.terms.length > 0 ? await backlinkIndex(docsDir, fleet) : undefined;
        const terms = glossary?.terms.map((term) => ({
          term,
          linkedBy: citations === undefined ? [] : citations.linkersOf(term.path),
        }));

        const worklist = (shown ?? []).filter((v) => v.maturity !== "vouched");
        // The ranked review queue, derived never stored: fan-in is computed
        // FLEET-WIDE (the joins need every service's slice anyway — and a
        // --subsystem filter must never change a service's count, only which
        // rows appear) while ranks are assigned over the WORKLIST only — a
        // vouched service needs no review, and ranking it would put gaps in
        // the queue. The worklist is already sliced, so under --subsystem the
        // ranks are contiguous within the filtered set.
        let ranked: { queue: ServiceView[]; fanIn: ReadonlyMap<string, number> } | undefined;
        if (opts.reviewOrder === true && services !== undefined) {
          const fanIn = await fanInByService(services, fleet, land ?? null);
          ranked = { queue: reviewOrder(worklist, fanIn), fanIn };
        }

        // THE row set of this listing, spelled once: the owners join, the
        // `services[]` payload and the text view must all be about the same
        // rows — `owners.teams[]` is only "that team's campaign worklist"
        // while it was computed over the rows `services[]` lists — and three
        // copies of this expression is how they would drift apart.
        const rows = shown === undefined ? undefined : (ranked?.queue ?? (opts.needsWork ? worklist : shown));

        let owned: OwnersJoin | undefined;
        if (opts.owners !== undefined && rows !== undefined) {
          const join = await ownersJoin({
            path: opts.owners,
            rows: rows.map((v) => ({ id: v.entry.id, repoDir: repoPath(docsDir, v.entry.dir) })),
            json,
          });
          if (join === null) return;
          owned = join;
        }

        if (json) {
          emitJson({
            command: "list",
            docsDir,
            // Additive, unconditional and flat, mirroring the per-service
            // `adrs` key one row down rather than inventing a second shape for
            // the same number. Not nested under the services section: the fleet
            // has decision records whether or not this run listed services.
            fleetAdrs,
            ...(rows && shown
              ? {
                  services: serviceRows(docsDir, ranked ?? rows),
                  // Under --subsystem the dial is the SLICE's — the filter's
                  // whole answer — while unfiltered runs keep the full fleet's
                  // rollup, byte-identical to before the flag existed.
                  maturity: maturityRollup(shown),
                  // The tree beside the table — additive keys, wave 3 of the
                  // subsystem item: the groups, and how many services sit
                  // unfiled (a permanent, normal state, so a count, never a
                  // finding). Under --subsystem the rows narrow to the named
                  // group and its descendants; memberCount stays transitive
                  // because the full tree's services back the modified copy.
                  subsystems: subsystemsJson(
                    docsDir,
                    slice === undefined ? tree! : { ...tree!, subsystems: slice.subsystems },
                  ),
                  // `unfiledServices` is a fleet-root fact: under a filter it
                  // is omitted rather than reported as 0, which would lie.
                  ...(slice === undefined
                    ? { unfiledServices: tree!.services.filter((s) => s.subsystem.length === 0).length }
                    : {}),
                }
              : {}),
            ...(owned !== undefined ? { owners: ownersJson(owned) } : {}),
            ...(features
              ? { features: features.map((f, i) => featureJson(docsDir, f, verification![i] ?? null)) }
              : {}),
            ...(capabilities ? { capabilities: capabilities.map(capabilityJson) } : {}),
            ...(terms ? { glossary: terms.map((t) => glossaryJson(t.term, t.linkedBy, docsDir)) } : {}),
            // What the citation walk could not read, beside the rows it
            // decorates — `useCases` below is the same shape for the same
            // reason. An empty `linkedBy` means loam read every authored
            // document and none cites the term; this key is how a reader tells
            // that from "one of them would not decode".
            ...(citations ? { links: { unreadable: citations.unreadable } } : {}),
            // The use-case corpus's own health, beside the rows it decorates —
            // `status --json` and `delta --json` already spell this key this
            // way. It is what makes an absent `keptBy` legible: `unreadable:
            // false` with no `keptBy` on a row means the document declares that
            // promise and no flow keeps it, while `unreadable: true` means
            // nobody could look. Emitted only with the capabilities section, so
            // bare `loam list --json` is untouched.
            ...(promises === undefined
              ? {}
              : {
                  useCases: {
                    unreadable: promises.kind === "unreadable",
                    ...(promises.kind === "unreadable" && promises.errors[0] !== undefined
                      ? { error: promises.errors[0] }
                      : {}),
                  },
                }),
          });
          return;
        }

        if (slice !== undefined && shown !== undefined) {
          console.log(`filtered to ${slice.label}: ${shown.length} of ${views!.length} service(s)`);
        }
        if (owned !== undefined && rows !== undefined && shown !== undefined) {
          if (opts.needsWork && rows.length === 0) {
            // printWorklist's own affordance, kept under the grouping flag:
            // empty owner groups would answer "who owns the work" without
            // saying there is none.
            console.log(`nothing to do — all ${shown.length} service(s) are vouched`);
            return;
          }
          const kind = opts.needsWork
            ? `${rows.length} of ${shown.length} service(s) need work`
            : `services (${rows.length})`;
          const ordered =
            ranked === undefined ? "" : " — review order (fan-in: services depending on each)";
          console.log(`${kind} — by owner (${owned.path})${ordered}`);
          printOwners(owned, new Map(rows.map((v) => [repoPath(docsDir, v.entry.dir), v])), ranked?.fanIn);
          return;
        }
        if (opts.needsWork) {
          printWorklist(ranked === undefined ? worklist : ranked.queue, shown!.length, ranked?.fanIn);
          return;
        }
        // Under --subsystem the tree dial (subsystem and unfiled counts) is a
        // fleet-root fact the filtered table must not claim, so no tree. The
        // fleet's ADR count is not derived from the rows at all and stays.
        if (shown) printServices(shown, { tree: slice === undefined ? tree : undefined, adrs: fleetAdrs });
        if (views && features) console.log("");
        if (features) printFeatures(features, verification!);
        if (capabilities) {
          if (capabilityVocab!.present) printCapabilities(capabilities, promises!);
          else console.log("no architecture/capabilities.yaml — the fleet declares no capabilities");
        }
        if (terms && glossary) {
          if (glossary.present) {
            printGlossary(
              terms.map((t) => ({ id: t.term.id, linkedBy: t.linkedBy })),
              citations?.unreadable ?? [],
            );
          } else {
            console.log("no glossary/ — the fleet defines no domain terms");
          }
        }
      } catch (err) {
        if (err instanceof DocsRepoUnavailableError) {
          reportDocsRepoError(json, err);
          return;
        }
        // One unreadable file used to escape as a stack trace (`internal` in
        // --json), naming nothing. The enumeration is all-or-nothing — it reads
        // every service's frontmatter to build one table — so the honest answer
        // is a refusal that says WHICH path could not be read.
        reportRepositoryUnavailable(json, err, "the listing would be missing a service", docsDir);
      }
    });
}

