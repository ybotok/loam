import type { Command } from "commander";
import { existsSync } from "node:fs";
import { loadConfig } from "../core/config.js";
import { emitJson, fail, repoPath, reportNoConfig } from "../core/json.js";
import { loadFile, serviceResolver } from "../core/likec4.js";
import {
  MATURITY_LADDER,
  maturityGaps,
  maturityRollup,
  serviceMaturity,
  type Maturity,
  type MaturityInput,
} from "../core/maturity.js";
import {
  DocsRepoUnavailableError,
  compareIds,
  landscapePath,
  listFeatures,
  listServices,
  servicePaths,
  type FeatureEntry,
  type ServiceEntry,
} from "../core/repo.js";
import {
  featureChecklist,
  readVerification,
  tallyRecord,
  verificationVerdict,
  type VerificationVerdict,
} from "../core/verify.js";
import { docsRepoReady, reportDocsRepoError, reportRepositoryUnavailable } from "./docs-repo-gate.js";

type Section = "services" | "features";
const SECTIONS: Section[] = ["services", "features"];

interface ListOptions {
  json?: boolean;
  archived?: boolean;
  needsWork?: boolean;
}

export function registerList(program: Command): void {
  program
    .command("list")
    .argument("[section]", "services | features (default: both)")
    .description("List the services and features in the docs repo")
    .option("--json", "emit the machine contract instead of the human view")
    .option("--archived", "include archived features")
    .option(
      "--needs-work",
      "services only: the adoption worklist — every service below `vouched`, with what it is missing",
    )
    .action(async (section: string | undefined, opts: ListOptions) => {
      const json = opts.json === true;
      const wanted = opts.needsWork
        ? SECTIONS.filter((s) => s === "services")
        : section
          ? SECTIONS.filter((s) => s === section)
          : SECTIONS;
      if (section && !SECTIONS.includes(section as Section)) {
        // `invalid-option`, same as show's bad --type: one mistake class, one code.
        fail(json, "invalid-option", `Unknown section '${section}'. Expected: ${SECTIONS.join(" | ")}.`);
        return;
      }
      if (opts.needsWork && section === "features") {
        fail(json, "invalid-option", "--needs-work is the service adoption worklist; drop the 'features' section.");
        return;
      }

      const config = await loadConfig();
      if (!config) {
        reportNoConfig(json);
        return;
      }
      const { docsDir } = config;
      // A docsDir that is not a docs repo is refused, never rendered as an empty
      // fleet — the whole point of the gate (see docs-repo-gate.ts).
      // `list features` alone does not need services/, so it asks for less.
      if (!docsRepoReady(json, docsDir, wanted.includes("services") ? "services" : "docs")) return;

      try {
        const services = wanted.includes("services") ? await listServices(docsDir) : undefined;
        const views = services ? await serviceViews(docsDir, services, config.service) : undefined;
        const features = wanted.includes("features")
          ? await listFeatures(docsDir, { includeArchived: opts.archived })
          : undefined;
        const verification = features
          ? await Promise.all(features.map((f) => featureVerification(docsDir, f)))
          : undefined;

        const worklist = views?.filter((v) => v.maturity !== "vouched");

        if (json) {
          emitJson({
            docsDir,
            ...(views
              ? {
                  services: (opts.needsWork ? worklist! : views).map((v) => serviceJson(docsDir, v)),
                  maturity: maturityRollup(views),
                }
              : {}),
            ...(features
              ? { features: features.map((f, i) => featureJson(docsDir, f, verification![i] ?? null)) }
              : {}),
          });
          return;
        }

        if (opts.needsWork) {
          printWorklist(worklist!, views!.length);
          return;
        }
        if (views) printServices(views);
        if (views && features) console.log("");
        if (features) printFeatures(features, verification!);
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

/* ------------------------------------------------------------------ */
/* The per-service view                                                */
/* ------------------------------------------------------------------ */

/**
 * The graded view: the rung's own inputs (core/maturity.ts) plus the one fact
 * only this command knows — whether anyone standing here could check the
 * service's `sources`, which needs loam.json's binding, not the directory.
 */
interface ServiceView extends MaturityInput {
  /** True when this service's `sources` can only be resolved from its own repo. */
  unverifiableFromHere: boolean;
  maturity: Maturity;
  /** What stands between this service and the next rung, in fix order. */
  missing: string[];
}

/**
 * Read the living landscape ONCE and decide, per service, whether an API is
 * expected of it. `serviceResolver` is handed the real service ids so an edge
 * drawn into a modelled container (`paymentService.api`) counts for the service
 * that owns it — the same resolution `validate` uses, so the two commands
 * cannot disagree about who is called.
 */
async function serviceViews(
  docsDir: string,
  services: ServiceEntry[],
  boundService: string | undefined,
): Promise<ServiceView[]> {
  const known = new Set(services.map((s) => s.id));
  const lp = landscapePath(docsDir);
  const land = existsSync(lp) ? await loadFile(lp) : null;
  const called = new Set<string>();
  // Positive evidence only: with no landscape, or one that does not parse, we
  // know nothing about who is called and every service is assumed to have an
  // API — the conservative direction, because claiming a service needs no
  // contract is how a real one goes undocumented.
  const proven = land !== null && land.errors.length === 0;
  if (proven) {
    const svcOf = serviceResolver(land.elements, known);
    for (const r of land.relationships) {
      if (r.op !== undefined) called.add(svcOf(r.target));
    }
  }

  return services.map((entry) => {
    const archSpec = existsSync(servicePaths(docsDir, entry.id).archSpec);
    const apiExpected = !proven || called.has(entry.id);
    const view = {
      entry,
      archSpec,
      apiExpected,
      unverifiableFromHere: entry.sources.declared && boundService !== entry.id,
    };
    const missing = maturityGaps(view);
    return { ...view, maturity: serviceMaturity(view), missing };
  });
}

/* ------------------------------------------------------------------ */
/* JSON                                                                */
/* ------------------------------------------------------------------ */

function serviceJson(docsDir: string, v: ServiceView): Record<string, unknown> {
  const s = v.entry;
  return {
    id: s.id,
    path: repoPath(docsDir, s.dir),
    has: { ...s.has, archSpec: v.archSpec },
    adrs: s.adrs,
    status: s.status,
    maturity: v.maturity,
    missing: v.missing,
    apiExpected: v.apiExpected,
    // Never omitted when true: a consumer that filters this table into a
    // worklist has to be able to tell "checked and fine" from "not checkable
    // from here", and absence reads as the first one.
    ...(v.unverifiableFromHere ? { provenance: "unverifiable-from-here" } : {}),
  };
}

function featureJson(
  docsDir: string,
  f: FeatureEntry,
  verification: VerificationCell | null,
): Record<string, unknown> {
  return {
    id: f.id,
    dirName: f.dirName,
    path: repoPath(docsDir, f.dir),
    archived: f.archived,
    services: f.services,
    has: f.has,
    verification,
  };
}

/* ------------------------------------------------------------------ */
/* Verification                                                        */
/* ------------------------------------------------------------------ */

/** What the features table says about verification without N `loam verify` runs. */
interface VerificationCell {
  state: "recorded" | "stale";
  /** The day the record was written. */
  recorded: string;
  /**
   * `verify --json`'s own three-valued verdict, through `verificationVerdict` —
   * not a fourth opinion computed here. `attested` is the one this column got
   * wrong: a scenario confirmed on an agent's word printed as `11/11` under a
   * heading that said `verified`, and `list --json` is how the fleet is graded.
   */
  verdict: VerificationVerdict;
  /** Both counts are `tallyRecord`'s — the record's `claims[]`, never its `summary:` block. */
  confirmed: number;
  claims: number;
  /** Of the confirmed, the scenario claims on an agent's word (`attestedClaims`). */
  attested: number;
}

/**
 * The verification column. `readVerification` is one file read; the checklist
 * is derived only when there is a record to judge — on a fleet-sized repo most
 * features have none, and deriving N checklists to print N dashes is the cost
 * that would get this column dropped.
 *
 * An archived feature's record is frozen history (see verify.ts): archive
 * merged the feature's operations into the living openapi, so a re-derived
 * checklist can only mismatch — the record is reported as recorded, never
 * judged stale.
 */
async function featureVerification(
  docsDir: string,
  f: FeatureEntry,
): Promise<VerificationCell | null> {
  const v = await readVerification(f.dir);
  if (v === null) return null;
  const stale = f.archived
    ? false
    : (await featureChecklist(docsDir, f.dir, f.id)).digest !== v.checklist;
  const tally = tallyRecord(v);
  return {
    state: stale ? "stale" : "recorded",
    recorded: v.recorded,
    verdict: verificationVerdict(tally, stale),
    confirmed: tally.confirmed,
    claims: tally.claims,
    attested: tally.attested,
  };
}

/* ------------------------------------------------------------------ */
/* Text                                                                */
/* ------------------------------------------------------------------ */

/**
 * Fixed-width presence flags. `a` and `A` are deliberately the same letter in
 * two cases: the arch spec and the API are the two things a reader most often
 * mistakes for each other, and one is lowercase because it is optional.
 */
function serviceFlags(v: ServiceView): string {
  const s = v.entry;
  return [
    s.has.model ? "M" : "-",
    s.has.spec ? "S" : "-",
    v.archSpec ? "a" : "-",
    s.has.openapi ? "A" : "-",
    // The async contract, lowercase like the arch spec and for the same reason:
    // it is optional. A fleet where most services own no topic must not read as
    // a fleet with a column of gaps in it.
    s.has.asyncapi ? "e" : "-",
    s.has.runbook ? "R" : "-",
    s.has.health ? "H" : "-",
  ].join(" ");
}

function printServices(views: ServiceView[]): void {
  console.log(
    `services (${views.length})  [M]odel [S]pec [a]rch-spec [A]pi [R]unbook [H]ealth`,
  );
  const width = Math.max(0, ...views.map((v) => v.entry.id.length));
  const rungWidth = Math.max(0, ...views.map((v) => v.maturity.length));
  for (const v of views) {
    const s = v.entry;
    const adrs = s.adrs > 0 ? `  (${s.adrs} adr${s.adrs === 1 ? "" : "s"})` : "";
    // The rung per service, not only in the rollup: "12 partial" tells a reader
    // the fleet is unfinished and nothing about which twelve, which is the one
    // question the line is read to answer.
    console.log(
      `  ${serviceFlags(v)}  ${s.id.padEnd(width)}  ${v.maturity.padEnd(rungWidth)}${adrs}`.trimEnd(),
    );
  }
  // How much of the fleet anyone has actually vouched for. On 100+ services this
  // is the number that says whether the docs can be trusted at all.
  if (views.length > 0) {
    const counted = new Map<string, number>();
    for (const v of views) {
      const key = v.entry.status ?? "unmarked";
      counted.set(key, (counted.get(key) ?? 0) + 1);
    }
    const parts = [...counted.entries()]
      .sort((a, b) => compareIds(a[0], b[0]))
      .map(([status, n]) => `${n} ${status}`);
    console.log(`  status: ${parts.join(" · ")}`);
    // The campaign dial next to the trust dial: rungs in ladder order, so the
    // line reads as progress left to right. Presence and provenance state only
    // — completeness is unchecked, so this line never says "adopted".
    const rollup = maturityRollup(views);
    const rungs = MATURITY_LADDER.filter((m) => rollup[m] > 0).map((m) => `${rollup[m]} ${m}`);
    console.log(`  maturity: ${rungs.join(" · ")}`);
  }
}

/**
 * The one-shot adoption worklist. Onboarding ten legacy services means asking
 * "what is left" once a day for a month, and the answer used to require reading
 * a presence table and a rollup and joining them by eye. A service whose
 * provenance cannot be judged from here is LISTED, tagged, never dropped:
 * omitting it would read as done.
 */
function printWorklist(views: ServiceView[], total: number): void {
  if (views.length === 0) {
    console.log(`nothing to do — all ${total} service(s) are vouched`);
    return;
  }
  console.log(`${views.length} of ${total} service(s) need work`);
  const width = Math.max(0, ...views.map((v) => v.entry.id.length));
  const rungWidth = Math.max(0, ...views.map((v) => v.maturity.length));
  for (const v of views) {
    const note = v.unverifiableFromHere ? "  (provenance: unverifiable-from-here)" : "";
    console.log(
      `  ${v.entry.id.padEnd(width)}  ${v.maturity.padEnd(rungWidth)}  missing: ${v.missing.join(", ")}${note}`,
    );
  }
}

/** Narrow verification cell: confirmed/claims when a record answers, one word when it does not. */
function verificationMark(v: VerificationCell | null): string {
  if (v === null) return "-";
  if (v.state === "stale") return "stale";
  // `11/11` and `11/11 attested` are different facts — the first is a
  // digest-matched green run, the second is somebody's word about one. Without
  // the suffix a complete count is the same glyph either way, which is exactly
  // the reading `verify`, `status` and the JSON envelope stopped giving.
  return `${v.confirmed}/${v.claims}${v.verdict === "attested" ? " attested" : ""}`;
}

function printFeatures(features: FeatureEntry[], verification: (VerificationCell | null)[]): void {
  const active = features.filter((f) => !f.archived).length;
  const archived = features.length - active;
  const counts = `${active} active${archived > 0 ? `, ${archived} archived` : ""}`;
  // Not `verified`: the column reports three verdicts and only one of them is
  // that one. A heading that names the strong verdict makes every other cell
  // read as it.
  console.log(`features (${counts})  [I]ntent [D]elta  verification`);
  const width = Math.max(0, ...features.map((f) => f.id.length));
  const cells = verification.map(verificationMark);
  const cellWidth = Math.max(0, ...cells.map((c) => c.length));
  for (const [i, f] of features.entries()) {
    const flags = `${f.has.intent ? "I" : "-"} ${f.has.delta ? "D" : "-"}`;
    const svcs = f.services.length > 0 ? f.services.join(", ") : "—";
    const tag = f.archived ? "  (archived)" : "";
    console.log(`  ${flags}  ${f.id.padEnd(width)}  ${cells[i]!.padEnd(cellWidth)}  ${svcs}${tag}`);
  }
}
