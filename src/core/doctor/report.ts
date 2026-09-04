/**
 * What a diagnosis IS: the finding shape, the report shape, and the agent
 * surface inside it.
 *
 * A module of its own because five checks fill this in and the command prints
 * it, so every one of them agrees about what a blocker means here — something
 * that stops loam running at all, as against a warning, which is something a
 * person should know before trusting an answer. That distinction is the whole
 * value of `doctor`, and it lives in the type rather than in five checks'
 * judgement.
 */
import { type WritePathResidue } from "../staging/recovery/residue.js";

export type DoctorSeverity = "blocker" | "warning";

export interface DoctorFinding {
  severity: DoctorSeverity;
  code: string;
  message: string;
  /**
   * The next command or edit that clears this finding. Mandatory, not optional:
   * a diagnostic that names a problem without naming its fix is a diagnostic
   * the reader has to research, and `doctor` is what someone runs precisely
   * because they do not yet know what loam wants from them.
   */
  fix: string;
}

export interface DoctorReport {
  healthy: boolean;
  runtime: {
    package: "@ybotok/loam";
    version: string;
    node: string;
    platform: NodeJS.Platform;
    arch: string;
  };
  config: {
    path: string;
    status: "missing" | "invalid" | "valid";
    error: string | null;
  };
  docs: {
    path: string | null;
    exists: boolean;
    readable: boolean;
    writable: boolean;
    servicesDir: boolean;
    landscape: boolean;
  };
  counts: { services: number; activeFeatures: number };
  currentService: {
    configured: string | null;
    status: "unbound" | "matched" | "unknown";
  };
  /** The agent surface of this repo — see `inspectAgentSurface`. */
  agents: AgentSurface;
  /**
   * The problem reports this repo has collected — see `scanReports`. State,
   * like `docs` and `counts`, and never a finding: a repository with eleven
   * open reports is not a broken repository, it is one that has been paying
   * attention. `healthy` does not move for anything in here.
   */
  reports: ProblemReports;
  /**
   * What a write that did not finish left in the docs repo, or null when
   * `docsDir` never resolved. Reported as state, like `docs` and `counts`: a
   * lock somebody is legitimately holding right now is a fact, not a complaint.
   */
  writePath: WritePathResidue | null;
  /**
   * The same scan over the service repo's owned `<gherkinDir>/loam/` root —
   * the one writer whose journal is not in the docs repo. Null when this repo
   * is not a service repo, or the root does not exist. Additive: a consumer
   * of the original envelope never sees a key it did not ask about removed.
   */
  serviceWritePath: WritePathResidue | null;
  findings: DoctorFinding[];
}

/**
 * Where one problem report got to, as its own `Status:` line says.
 *
 * `fixed` and `superseded` are the FIRST WORD of a longer line (`fixed in
 * 0.2.0-alpha.5`, `superseded by 010`), because the rest of that line is prose
 * an author writes for a reader and loam has no business parsing. `unstated`
 * covers both a report written before the field existed and one whose value is
 * a word this vocabulary does not know — loam counts what it can read and says
 * so, rather than inventing a sixth bucket for every synonym somebody types.
 */
export type ProblemReportStatus = "open" | "sent" | "fixed" | "superseded" | "unstated";

export interface ProblemReportEntry {
  /** The file's own name inside the reports directory — `012-2026-09-03-slug.md`. */
  file: string;
  /**
   * The leading zero-padded ordinal the protocol now asks for, or null for a
   * name written before it did (`2026-09-03-slug.md`). A report with no ordinal
   * is still a report: this directory predates the numbering.
   */
  ordinal: string | null;
  status: ProblemReportStatus;
}

/** The report corpus a repository has collected — see `scanReports`. */
export interface ProblemReports {
  /**
   * The ABSOLUTE path of the directory — `loam-reports/` beside the `loam.json`
   * that resolved, else beside the directory `doctor` ran in. Absolute because
   * the protocol tells an agent to write there, and a repo-relative spelling
   * left it to guess which repository "relative" meant: `doctor` is the
   * preflight that runs precisely when the config may not resolve, and in a
   * service repository the config's root is that repository, not the docs one.
   */
  dir: string;
  /** Whether that directory exists at all. A repo with no reports is normal. */
  present: boolean;
  total: number;
  /**
   * The ordinal the next report takes: one more than the highest present,
   * padded to at least three digits, `001` over an empty or absent directory —
   * it WIDENS past three rather than reusing a number once a corpus gets
   * there, which is what every page saying "at least three digits" describes.
   * This is the field the `loam-report` protocol tells an agent to read.
   */
  next: string;
  entries: ProblemReportEntry[];
}

export interface AgentSurface {
  /** Tool ids this repo has an agent surface for. Empty is legal (`init --no-commands`). */
  tools: string[];
  /** Workflow subset managed for those tools. */
  profile: "full" | "service" | "docs";
  /** Whether `tools` came from loam.json's own record or from what is on disk. */
  toolsSource: "config" | "disk";
  /** How many files the running binary would lay down for `tools`. */
  plannedFiles: number;
  /** Repo-relative paths of those files that are not there. */
  missingFiles: string[];
  /**
   * Repo-relative paths of the ones that ARE there carrying no version stamp,
   * or one older than this binary — see `staleAgentFiles`.
   */
  staleFiles: string[];
  stamp: {
    /** Where the docs repo's AGENTS.md is, or null when `docsDir` did not resolve. */
    path: string | null;
    /** Whether it could be read at all — absent and unstamped are different facts. */
    present: boolean;
    /** The version the stamp names, null when there is none (or an unparseable one). */
    version: string | null;
    /** Whether `agents.stale` fired: the stamp is missing or trails this binary. */
    stale: boolean;
  };
}
