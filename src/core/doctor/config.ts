/**
 * The config and the fleet map, read the way every other command reads them.
 *
 * `doctor` used to carry its own config validator. It agreed with `loadConfig`
 * on the fields both happened to check and disagreed everywhere else — it
 * accepted a `gherkinDir` of `"../shared"` that `loadConfig` refused outright,
 * so `doctor` reported a healthy repo in which no command could run. Two
 * validators are two opinions about one file, and the one the user reads is
 * never the one the commands obey.
 *
 * The landscape is READ, not stat'ed, for the same reason: `doctor` once
 * reported `landscape: yes` for a file full of conflict markers, which answers
 * "is there a file" — not the question anyone runs doctor to ask.
 */
import { access, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { configPath, parseConfig, type LoamConfig } from "../envelope/config.js";
import { errorText, loadFile } from "../c4/likec4.js";
import { conflictMarkerLines } from "../conflict-markers.js";
import { type DoctorFinding, type DoctorReport } from "./report.js";

export interface ConfigInspection {
  status: DoctorReport["config"]["status"];
  config: LoamConfig | null;
  error: string | null;
}

/**
 * Read and validate the config the way every other command does — through
 * `parseConfig`, never through a second implementation.
 *
 * doctor used to carry its own validator. It agreed with `loadConfig` on the
 * fields both happened to check and disagreed everywhere else: doctor accepted
 * a `gherkinDir` of `"../shared"` that `loadConfig` refused outright, so
 * `doctor` reported a healthy repo in which no command could run. Two
 * validators are two opinions about the same file, and the one the user reads
 * is never the one the commands obey.
 */
export async function inspectConfig(cwd: string): Promise<ConfigInspection> {
  const path = configPath(cwd);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { status: "missing", config: null, error: null };
    return {
      status: "invalid",
      config: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  try {
    return { status: "valid", error: null, config: parseConfig(raw, dirname(path)) };
  } catch (error) {
    return {
      status: "invalid",
      config: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function canAccess(path: string, mode: number): Promise<boolean> {
  try {
    await access(path, mode);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the landscape, don't just stat it. `doctor` reported `landscape: yes`
 * for a file full of conflict markers — the check answered "is there a file",
 * which is not the question anyone runs doctor to ask.
 */
export async function inspectLandscape(path: string, findings: DoctorFinding[]): Promise<void> {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    findings.push({
      severity: "blocker",
      code: "doctor.landscape-unreadable",
      message: `${path} exists but could not be read: ${error instanceof Error ? error.message : String(error)}`,
      fix: `Check permissions on ${path}.`,
    });
    return;
  }

  // The three-way merge left its markers in the file. Checked BEFORE the
  // parser, because a conflicted landscape does parse sometimes — both sides of
  // a conflict can be syntactically valid LikeC4 — and "your map contains two
  // halves of two different maps" is a more useful sentence than any parser
  // error. This is the failure mode of onboarding a fleet: ten people adopt ten
  // services into one landscape.likec4 in the same week.
  //
  // The scan itself is conflict-markers's, which is where the same rule already
  // grades every other document loam reads. doctor kept a second copy of it,
  // and a second copy of a rule is a second chance to spell it differently;
  // what doctor owns is what a conflicted landscape COSTS, which is the finding
  // below and not the search.
  const conflicted = conflictMarkerLines(source);
  if (conflicted.length > 0) {
    findings.push({
      severity: "blocker",
      code: "doctor.landscape-merge-conflict",
      message:
        `architecture/landscape.likec4 still contains merge conflict markers ` +
        `(line${conflicted.length === 1 ? "" : "s"} ${conflicted.join(", ")}).`,
      fix: `Resolve the conflict in ${path} — keep BOTH services' elements and edges, then re-run \`loam doctor\`.`,
    });
    return;
  }

  const doc = await loadFile(path);
  if (doc.errors.length > 0) {
    const first = doc.errors[0]!;
    findings.push({
      severity: "blocker",
      code: "doctor.landscape-invalid",
      // Through `errorText`, the one spelling of a diagnostic loam prints. This
      // site hand-rolled its own and passed the LSP range's line through raw, so
      // `doctor` named the line ABOVE the fault and disagreed with `validate
      // --all` about the same error on the same tree — the last formatter the
      // 1-based consolidation missed (verification 2026-09-04).
      message:
        `architecture/landscape.likec4 does not parse: ${errorText(first)}` +
        (doc.errors.length > 1 ? ` — and ${doc.errors.length - 1} more` : ""),
      fix: `Fix ${path}; every fleet-wide check is blind until it parses.`,
    });
  }
}

/**
 * The tool ids loam.json records `init` as having written files for, or null
 * when it records none we can plan for.
 *
 * `parseConfig` checks `agentTools`' SHAPE and deliberately not its contents —
 * a config written by a newer binary may name a tool this one has never heard
 * of, and refusing to load it would break every command, not just this check.
 * So the registry filter belongs here: `plannedCommandFiles` throws on an id it
 * does not know, and a config from the future must not turn the read-only
 * preflight into a crash. A tool we cannot plan files for is a tool we have
 * nothing to say about.
 */
