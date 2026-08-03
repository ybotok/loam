import type { Command } from "commander";
import { relative } from "node:path";
import { loadConfig } from "../core/config.js";
import { emitJson, emitJsonError, reportNoConfig } from "../core/json.js";
import {
  compareIds,
  listFeatures,
  listServices,
  type FeatureEntry,
  type ServiceEntry,
} from "../core/repo.js";
import { featureChecklist, readVerification } from "../core/verify.js";

type Section = "services" | "features";
const SECTIONS: Section[] = ["services", "features"];

interface ListOptions {
  json?: boolean;
  archived?: boolean;
}

export function registerList(program: Command): void {
  program
    .command("list")
    .argument("[section]", "services | features (default: both)")
    .description("List the services and features in the docs repo")
    .option("--json", "emit the machine contract instead of the human view")
    .option("--archived", "include archived features")
    .action(async (section: string | undefined, opts: ListOptions) => {
      const wanted = section ? SECTIONS.filter((s) => s === section) : SECTIONS;
      if (section && wanted.length === 0) {
        const msg = `Unknown section '${section}'. Expected: ${SECTIONS.join(" | ")}.`;
        // `invalid-option`, same as show's bad --type: one mistake class, one code.
        if (opts.json) emitJsonError("invalid-option", msg);
        else {
          console.error(msg);
          process.exitCode = 1;
        }
        return;
      }

      const config = await loadConfig();
      if (!config) {
        reportNoConfig(opts.json === true);
        return;
      }
      const { docsDir } = config;

      const services = wanted.includes("services") ? await listServices(docsDir) : undefined;
      const features = wanted.includes("features")
        ? await listFeatures(docsDir, { includeArchived: opts.archived })
        : undefined;
      const verification = features
        ? await Promise.all(features.map((f) => featureVerification(docsDir, f)))
        : undefined;

      if (opts.json) {
        emitJson({
          docsDir,
          ...(services ? { services: services.map((s) => serviceJson(docsDir, s)) } : {}),
          ...(features
            ? { features: features.map((f, i) => featureJson(docsDir, f, verification![i] ?? null)) }
            : {}),
        });
        return;
      }

      if (services) printServices(services);
      if (services && features) console.log("");
      if (features) printFeatures(features, verification!);
    });
}

/* ------------------------------------------------------------------ */
/* JSON                                                                */
/* ------------------------------------------------------------------ */

function serviceJson(docsDir: string, s: ServiceEntry): Record<string, unknown> {
  return { id: s.id, path: repoPath(docsDir, s.dir), has: s.has, adrs: s.adrs, status: s.status };
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

/** Paths in the contract are repo-relative, with forward slashes: diffable across machines. */
export function repoPath(docsDir: string, abs: string): string {
  return relative(docsDir, abs).split(/[\\/]/).join("/");
}

/* ------------------------------------------------------------------ */
/* Verification                                                        */
/* ------------------------------------------------------------------ */

/** What the features table says about verification without N `loam verify` runs. */
interface VerificationCell {
  state: "recorded" | "stale";
  /** The day the record was written. */
  recorded: string;
  confirmed: number;
  claims: number;
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
  return {
    state: stale ? "stale" : "recorded",
    recorded: v.recorded,
    confirmed: v.summary.confirmed,
    claims: v.summary.claims,
  };
}

/* ------------------------------------------------------------------ */
/* Text                                                                */
/* ------------------------------------------------------------------ */

/** Fixed-width presence flags: what a service has, and what it is missing. */
function serviceFlags(s: ServiceEntry): string {
  return [
    s.has.model ? "M" : "-",
    s.has.spec ? "S" : "-",
    s.has.openapi ? "A" : "-",
    s.has.runbook ? "R" : "-",
    s.has.health ? "H" : "-",
  ].join(" ");
}

function printServices(services: ServiceEntry[]): void {
  console.log(`services (${services.length})  [M]odel [S]pec [A]pi [R]unbook [H]ealth`);
  const width = Math.max(0, ...services.map((s) => s.id.length));
  for (const s of services) {
    const adrs = s.adrs > 0 ? `  (${s.adrs} adr${s.adrs === 1 ? "" : "s"})` : "";
    console.log(`  ${serviceFlags(s)}  ${s.id.padEnd(width)}${adrs}`.trimEnd());
  }
  // How much of the fleet anyone has actually vouched for. On 100+ services this
  // is the number that says whether the docs can be trusted at all.
  if (services.length > 0) {
    const counted = new Map<string, number>();
    for (const s of services) {
      const key = s.status ?? "unmarked";
      counted.set(key, (counted.get(key) ?? 0) + 1);
    }
    const parts = [...counted.entries()]
      .sort((a, b) => compareIds(a[0], b[0]))
      .map(([status, n]) => `${n} ${status}`);
    console.log(`  status: ${parts.join(" · ")}`);
  }
}

/** Narrow verification cell: confirmed/claims when a record answers, one word when it does not. */
function verificationMark(v: VerificationCell | null): string {
  if (v === null) return "-";
  return v.state === "stale" ? "stale" : `${v.confirmed}/${v.claims}`;
}

function printFeatures(features: FeatureEntry[], verification: (VerificationCell | null)[]): void {
  const active = features.filter((f) => !f.archived).length;
  const archived = features.length - active;
  const counts = `${active} active${archived > 0 ? `, ${archived} archived` : ""}`;
  console.log(`features (${counts})  [I]ntent [D]elta  verified`);
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
